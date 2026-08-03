import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  decideMergeCandidate,
  normalizeAuditHintKey,
} from '../src/lib/merge-decisions.js';
import { withSafeIntegrationDatabase } from '../../worker/tests/integration-database.js';

const prisma = new PrismaClient();
const expectedDatabaseName =
  process.env.KRITT_RADAR_INTEGRATION_DATABASE ?? 'kritt_radar_integration';
let safeDatabaseValidated = false;

async function currentDatabaseName(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  return rows[0]?.name ?? '';
}

async function removeReportRelinkFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "test_fail_report_relink" ON "AuditReport"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_report_relink()');
  await prisma.$executeRawUnsafe('DROP SEQUENCE IF EXISTS test_report_relink_attempts');
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "test_force_serialization_failure" ON "MergeCandidate"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_force_serialization_failure()');
  await prisma.$executeRawUnsafe('DROP SEQUENCE IF EXISTS test_serialization_attempts');
}

async function cleanDatabase(): Promise<void> {
  await withSafeIntegrationDatabase(
    await currentDatabaseName(),
    expectedDatabaseName,
    async () => {
      await removeReportRelinkFailureTrigger();
      await prisma.$transaction([
        prisma.mergeCandidate.deleteMany(),
        prisma.entityAlias.deleteMany(),
        prisma.auditReport.deleteMany(),
        prisma.score.deleteMany(),
        prisma.signal.deleteMany(),
        prisma.scope.deleteMany(),
        prisma.program.deleteMany(),
        prisma.entity.deleteMany(),
        prisma.collectorRun.deleteMany(),
        prisma.observation.deleteMany(),
      ]);
    },
  );
}

async function snapshotMergeData() {
  return {
    entities: await prisma.entity.findMany({ orderBy: { id: 'asc' } }),
    aliases: await prisma.entityAlias.findMany({ orderBy: { id: 'asc' } }),
    reports: await prisma.auditReport.findMany({ orderBy: { id: 'asc' } }),
    candidates: await prisma.mergeCandidate.findMany({ orderBy: { id: 'asc' } }),
  };
}

async function createCanonicalEntity(id: string) {
  return prisma.entity.create({
    data: {
      id,
      slug: id,
      canonicalName: id,
      programs: {
        create: {
          id: `${id}-program`,
          platform: 'immunefi',
          externalId: `${id}-program`,
          title: id,
          url: `https://programs.example/${id}`,
          kind: 'bounty',
        },
      },
    },
  });
}

async function createApprovalFixture(input: { leftIsProvisional?: boolean } = {}) {
  const provisional = await prisma.entity.create({
    data: {
      id: 'provisional',
      slug: 'provisional',
      canonicalName: 'Aave V3 review',
    },
  });
  const canonical = await createCanonicalEntity('canonical');
  const siblingCanonical = await createCanonicalEntity('sibling-canonical');

  await prisma.auditReport.createMany({
    data: [
      {
        id: 'report-one',
        entityId: provisional.id,
        firm: 'Trail of Bits',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        projectHint: ' AAVE-V3-Review ',
        observationIds: [],
        reportUrl: 'https://reports.example/one',
        coveredPaths: [],
      },
      {
        id: 'report-two',
        entityId: provisional.id,
        firm: 'OpenZeppelin',
        publishedAt: new Date('2026-07-02T00:00:00.000Z'),
        projectHint: 'aave-v3-review',
        observationIds: [],
        reportUrl: 'https://reports.example/two',
        coveredPaths: [],
      },
    ],
  });

  const leftIsProvisional = input.leftIsProvisional ?? true;
  const candidate = await prisma.mergeCandidate.create({
    data: {
      id: 'selected-candidate',
      leftEntityId: leftIsProvisional ? provisional.id : canonical.id,
      rightEntityId: leftIsProvisional ? canonical.id : provisional.id,
      similarity: 0.91,
      reason: { tokenJaccard: 0.9 },
    },
  });
  const sibling = await prisma.mergeCandidate.create({
    data: {
      id: 'sibling-candidate',
      leftEntityId: siblingCanonical.id,
      rightEntityId: provisional.id,
      similarity: 0.8,
      reason: { tokenJaccard: 0.8 },
    },
  });

  return { provisional, canonical, siblingCanonical, candidate, sibling };
}

beforeAll(async () => {
  await withSafeIntegrationDatabase(await currentDatabaseName(), expectedDatabaseName, async () => {});
  safeDatabaseValidated = true;
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  try {
    if (safeDatabaseValidated) await cleanDatabase();
  } finally {
    await prisma.$disconnect();
  }
});

describe('decideMergeCandidate approval', () => {
  it.each([
    { label: 'left relation', leftIsProvisional: true },
    { label: 'right relation', leftIsProvisional: false },
  ])('approves when the provisional entity is on the $label', async ({ leftIsProvisional }) => {
    const { provisional, canonical, candidate, sibling } = await createApprovalFixture({
      leftIsProvisional,
    });
    const now = new Date('2026-08-04T12:00:00.000Z');

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
      now,
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'approve',
      candidateId: candidate.id,
      reportsMoved: 2,
      siblingsRejected: 1,
    });
    expect(
      await prisma.entityAlias.findUnique({
        where: { kind_key: { kind: 'audit_hint', key: 'aave-v3-review' } },
      }),
    ).toMatchObject({ entityId: canonical.id, source: 'manual' });
    expect(await prisma.auditReport.count({ where: { entityId: canonical.id } })).toBe(2);
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'approved',
      decidedAt: now,
    });
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: sibling.id } })).toMatchObject({
      status: 'rejected',
      decidedAt: now,
    });
    expect(await prisma.entity.findUnique({ where: { id: provisional.id } })).not.toBeNull();
  });

  it('normalizes audit hints exactly like the foundation materializer', () => {
    expect(normalizeAuditHintKey(' AAVE-V3-Review ')).toBe('aave-v3-review');
  });

  it('returns not_found for a missing candidate', async () => {
    await expect(
      decideMergeCandidate(prisma, { candidateId: 'missing', action: 'approve' }),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
  });

  it.each([
    {
      label: 'both entities are provisional',
      arrange: async () => {
        await prisma.program.deleteMany({ where: { entityId: 'canonical' } });
      },
    },
    {
      label: 'both entities are canonical',
      arrange: async () => {
        await prisma.program.create({
          data: {
            entityId: 'provisional',
            platform: 'sherlock',
            externalId: 'provisional-program',
            title: 'Provisional program',
            url: 'https://programs.example/provisional',
            kind: 'contest',
          },
        });
      },
    },
  ])('fails closed when $label', async ({ arrange }) => {
    const { candidate } = await createApprovalFixture();
    await arrange();
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'not_approvable' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('fails closed when the provisional entity has no audit reports', async () => {
    const { candidate } = await createApprovalFixture();
    await prisma.auditReport.deleteMany({ where: { entityId: 'provisional' } });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'not_approvable' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('fails closed when a normalized project hint is empty', async () => {
    const { candidate } = await createApprovalFixture();
    await prisma.auditReport.update({
      where: { id: 'report-one' },
      data: { projectHint: '   ' },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'not_approvable' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it.each(['manual', 'config'])('does not overwrite a conflicting %s alias', async (source) => {
    const { candidate, siblingCanonical } = await createApprovalFixture();
    await prisma.entityAlias.create({
      data: {
        id: `conflicting-${source}-alias`,
        entityId: siblingCanonical.id,
        kind: 'audit_hint',
        key: 'aave-v3-review',
        source,
      },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('preflights every hint before creating any alias', async () => {
    const { candidate, siblingCanonical } = await createApprovalFixture();
    await prisma.auditReport.update({
      where: { id: 'report-two' },
      data: { projectHint: 'z-conflicting-hint' },
    });
    await prisma.entityAlias.create({
      data: {
        id: 'later-conflicting-alias',
        entityId: siblingCanonical.id,
        kind: 'audit_hint',
        key: 'z-conflicting-hint',
        source: 'config',
      },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
    expect(
      await prisma.entityAlias.findUnique({
        where: { kind_key: { kind: 'audit_hint', key: 'aave-v3-review' } },
      }),
    ).toBeNull();
  });

  it('permits an existing same-target alias and records the manual decision source', async () => {
    const { candidate, canonical } = await createApprovalFixture();
    await prisma.entityAlias.create({
      data: {
        id: 'same-target-alias',
        entityId: canonical.id,
        kind: 'audit_hint',
        key: 'aave-v3-review',
        source: 'config',
      },
    });

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: true, action: 'approve' });
    expect(await prisma.entityAlias.findUniqueOrThrow({ where: { id: 'same-target-alias' } })).toMatchObject({
      entityId: canonical.id,
      source: 'manual',
    });
  });

  it('returns conflict when another request already rejected the candidate', async () => {
    const { candidate } = await createApprovalFixture();
    const otherDecisionTime = new Date('2026-08-04T11:00:00.000Z');
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'rejected', decidedAt: otherDecisionTime },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('keeps an approved candidate immutable when approval is submitted again', async () => {
    const { candidate } = await createApprovalFixture();
    const approvedAt = new Date('2026-08-04T10:00:00.000Z');
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'approved', decidedAt: approvedAt },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('rolls back candidate status, aliases, and report links after a database error', async () => {
    const { candidate, provisional } = await createApprovalFixture();
    await prisma.$executeRawUnsafe('CREATE SEQUENCE test_report_relink_attempts START 1');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_report_relink() RETURNS trigger AS $$
      BEGIN
        PERFORM nextval('test_report_relink_attempts');
        RAISE EXCEPTION 'forced report relink failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "test_fail_report_relink"
      BEFORE UPDATE OF "entityId" ON "AuditReport"
      FOR EACH STATEMENT EXECUTE FUNCTION test_fail_report_relink()
    `);

    try {
      await expect(
        decideMergeCandidate(prisma, {
          candidateId: candidate.id,
          action: 'approve',
          now: new Date('2026-08-04T12:00:00.000Z'),
        }),
      ).rejects.toThrow();
      const [{ attempts }] = await prisma.$queryRaw<Array<{ attempts: number }>>`
        SELECT last_value::int AS attempts FROM test_report_relink_attempts
      `;
      expect(attempts).toBe(1);
    } finally {
      await removeReportRelinkFailureTrigger();
    }

    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'pending',
      decidedAt: null,
    });
    expect(await prisma.entityAlias.count()).toBe(0);
    expect(await prisma.auditReport.count({ where: { entityId: provisional.id } })).toBe(2);
  });

  it('retries only serialization conflicts and stops after two retries', async () => {
    const { candidate } = await createApprovalFixture();
    await prisma.$executeRawUnsafe('CREATE SEQUENCE test_serialization_attempts START 1');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_force_serialization_failure() RETURNS trigger AS $$
      BEGIN
        PERFORM nextval('test_serialization_attempts');
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'forced serialization failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "test_force_serialization_failure"
      BEFORE UPDATE ON "MergeCandidate"
      FOR EACH ROW EXECUTE FUNCTION test_force_serialization_failure()
    `);

    try {
      await expect(
        decideMergeCandidate(prisma, { candidateId: candidate.id, action: 'approve' }),
      ).rejects.toThrow();
      const [{ attempts }] = await prisma.$queryRaw<Array<{ attempts: number }>>`
        SELECT last_value::int AS attempts FROM test_serialization_attempts
      `;
      expect(attempts).toBe(3);
    } finally {
      await removeReportRelinkFailureTrigger();
    }

    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'pending',
      decidedAt: null,
    });
    expect(await prisma.entityAlias.count()).toBe(0);
  });
});

describe('decideMergeCandidate reject and reopen', () => {
  it('transitions pending to rejected and rejected back to pending', async () => {
    const { candidate, canonical } = await createApprovalFixture();
    await prisma.entityAlias.create({
      data: {
        id: 'preserved-alias',
        entityId: canonical.id,
        kind: 'config_slug',
        key: 'aave-v3',
        source: 'config',
      },
    });
    const entitiesBefore = await prisma.entity.findMany({ orderBy: { id: 'asc' } });
    const aliasesBefore = await prisma.entityAlias.findMany({ orderBy: { id: 'asc' } });
    const reportsBefore = await prisma.auditReport.findMany({ orderBy: { id: 'asc' } });
    const rejectedAt = new Date('2026-08-04T13:00:00.000Z');

    const rejected = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'reject',
      now: rejectedAt,
    });

    expect(rejected).toEqual({
      ok: true,
      action: 'reject',
      candidateId: candidate.id,
      reportsMoved: 0,
      siblingsRejected: 0,
    });
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'rejected',
      decidedAt: rejectedAt,
    });
    expect(await prisma.entity.findMany({ orderBy: { id: 'asc' } })).toEqual(entitiesBefore);
    expect(await prisma.entityAlias.findMany({ orderBy: { id: 'asc' } })).toEqual(aliasesBefore);
    expect(await prisma.auditReport.findMany({ orderBy: { id: 'asc' } })).toEqual(reportsBefore);

    const reopened = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'reopen',
      now: new Date('2026-08-04T14:00:00.000Z'),
    });

    expect(reopened).toEqual({
      ok: true,
      action: 'reopen',
      candidateId: candidate.id,
      reportsMoved: 0,
      siblingsRejected: 0,
    });
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'pending',
      decidedAt: null,
    });
    expect(await prisma.entity.findMany({ orderBy: { id: 'asc' } })).toEqual(entitiesBefore);
    expect(await prisma.entityAlias.findMany({ orderBy: { id: 'asc' } })).toEqual(aliasesBefore);
    expect(await prisma.auditReport.findMany({ orderBy: { id: 'asc' } })).toEqual(reportsBefore);
  });

  it('returns conflict when rejecting a candidate that is no longer pending', async () => {
    const { candidate } = await createApprovalFixture();
    const decidedAt = new Date('2026-08-04T10:00:00.000Z');
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'rejected', decidedAt },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'reject',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('returns conflict when reopening a candidate that is still pending', async () => {
    const { candidate } = await createApprovalFixture();
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'reopen',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });

  it('does not reopen an approved candidate', async () => {
    const { candidate } = await createApprovalFixture();
    const approvedAt = new Date('2026-08-04T10:00:00.000Z');
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'approved', decidedAt: approvedAt },
    });
    const before = await snapshotMergeData();

    const result = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'reopen',
    });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await snapshotMergeData()).toEqual(before);
  });
});
