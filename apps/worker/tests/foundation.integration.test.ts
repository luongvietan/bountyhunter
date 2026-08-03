import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countDroppedContestPrograms,
  listRepoTargets,
  materializeCatalogFoundation,
  materializeRepoSignals,
} from '../src/foundation.js';
import { withSafeIntegrationDatabase } from './integration-database.js';

const prisma = new PrismaClient();
const now = new Date('2026-08-03T12:00:00.000Z');
const expectedDatabaseName =
  process.env.KRITT_RADAR_INTEGRATION_DATABASE ?? 'kritt_radar_integration';
let safeDatabaseValidated = false;

const aliasesYaml = `
repo-github-com-uniswap-v4-core:
  canonicalName: uniswap/v4-core
  match:
    - auditHint: uniswap-v4
`;

const repoAndPlatformAliasesYaml = `
repo-precedence-target:
  canonicalName: Repo precedence target
  match:
    - repo: github.com/uniswap/v4-core
platform-precedence-target:
  canonicalName: Platform precedence target
  match:
    - platformName: { platform: code4rena, name: "Uniswap v4" }
`;

const platformAliasOnlyYaml = `
platform-precedence-target:
  canonicalName: Platform precedence target
  match:
    - platformName: { platform: code4rena, name: "Uniswap v4" }
`;

const collisionAliasYaml = `
config-aave-target:
  canonicalName: Config Aave target
  match:
    - repo: github.com/aave/v3
`;

async function currentDatabaseName(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  return rows[0]?.name ?? '';
}

async function cleanDatabase(): Promise<void> {
  await withSafeIntegrationDatabase(
    await currentDatabaseName(),
    expectedDatabaseName,
    async () => {
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

async function seedObservations(): Promise<void> {
  await prisma.entity.create({
    data: { slug: 'unrelated-existing-entity', canonicalName: 'Unrelated existing entity' },
  });
  await prisma.observation.createMany({
    data: [
      {
        collectorId: 'c4-contests',
        sourceUrl: 'https://code4rena.com/audits/uniswap-v4',
        fetchedAt: now,
        contentHash: 'program-uniswap-v4',
        payload: {
          platform: 'code4rena',
          externalId: 'uniswap-v4',
          title: 'Uniswap v4',
          url: 'https://code4rena.com/audits/uniswap-v4',
          poolUsd: 100_000,
          kind: 'contest',
          publishedAt: '2026-07-01T00:00:00.000Z',
          startsAt: '2026-07-01T00:00:00.000Z',
          endsAt: '2026-07-31T00:00:00.000Z',
          repoUrl: 'github.com/uniswap/v4-core',
        },
      },
      {
        collectorId: 'c4-contests',
        sourceUrl: 'https://code4rena.com/audits/aave-v3',
        fetchedAt: now,
        contentHash: 'program-aave-v3',
        payload: {
          platform: 'code4rena',
          externalId: 'aave-v3',
          title: 'Aave v3',
          url: 'https://code4rena.com/audits/aave-v3',
          poolUsd: 80_000,
          kind: 'contest',
          publishedAt: '2026-07-02T00:00:00.000Z',
          startsAt: '2026-07-02T00:00:00.000Z',
          endsAt: '2026-07-30T00:00:00.000Z',
          repoUrl: 'github.com/aave/v3',
        },
      },
      {
        collectorId: 'c4-contests',
        sourceUrl: 'https://code4rena.com/audits/no-repository',
        fetchedAt: now,
        contentHash: 'program-without-repository',
        payload: {
          platform: 'code4rena',
          externalId: 'no-repository',
          title: 'No repository',
          url: 'https://code4rena.com/audits/no-repository',
          poolUsd: 10_000,
          kind: 'contest',
          publishedAt: '2026-07-03T00:00:00.000Z',
          startsAt: '2026-07-03T00:00:00.000Z',
          endsAt: '2026-07-29T00:00:00.000Z',
          repoUrl: null,
        },
      },
      {
        collectorId: 'audit-report-repos',
        sourceUrl: 'https://api.github.com/repos/auditor/reports/git/trees/HEAD',
        fetchedAt: now,
        contentHash: 'audit-uniswap-and-aave',
        payload: [
          {
            firm: 'auditor',
            projectHint: 'uniswap-v4',
            publishedAt: '2026-06-01T00:00:00.000Z',
            reportUrl: 'https://reports.example/uniswap-v4.pdf',
          },
          {
            firm: 'auditor',
            projectHint: 'aave-v3-review',
            publishedAt: '2026-06-02T00:00:00.000Z',
            reportUrl: 'https://reports.example/aave-v3-review.pdf',
          },
        ],
      },
    ],
  });
}

async function foundationCounts(): Promise<Record<string, number>> {
  const [entities, aliases, programs, scopes, reports, candidates] = await Promise.all([
    prisma.entity.count(),
    prisma.entityAlias.count(),
    prisma.program.count(),
    prisma.scope.count(),
    prisma.auditReport.count(),
    prisma.mergeCandidate.count(),
  ]);
  return { entities, aliases, programs, scopes, reports, candidates };
}

beforeAll(async () => {
  await withSafeIntegrationDatabase(await currentDatabaseName(), expectedDatabaseName, async () => {});
  safeDatabaseValidated = true;
});

beforeEach(async () => {
  await cleanDatabase();
  await seedObservations();
});

afterAll(async () => {
  try {
    if (safeDatabaseValidated) await cleanDatabase();
  } finally {
    await prisma.$disconnect();
  }
});

describe('materializeCatalogFoundation', () => {
  it('returns per-invocation counts and deterministically materializes exact and fallback entities', async () => {
    const result = await materializeCatalogFoundation(prisma, aliasesYaml, now);

    expect(result).toEqual({ programs: 2, scopes: 2, entities: 3, reports: 2, candidates: 1 });
    expect(await countDroppedContestPrograms(prisma)).toBe(1);
    expect(await prisma.entity.count()).toBe(4);
    expect(await prisma.entityAlias.count()).toBe(1);
    expect(await prisma.program.count({ where: { entityId: null } })).toBe(0);

    const uniswapProgram = await prisma.program.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'code4rena', externalId: 'uniswap-v4' } },
    });
    const uniswapReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/uniswap-v4.pdf' },
    });
    expect(uniswapReport.entityId).toBe(uniswapProgram.entityId);

    const aaveProgram = await prisma.program.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'code4rena', externalId: 'aave-v3' } },
      include: { entity: true },
    });
    expect(aaveProgram.entity).toMatchObject({
      slug: 'repo-github-com-aave-v3',
      canonicalName: 'aave/v3',
    });

    const firstCounts = await foundationCounts();
    expect(await materializeCatalogFoundation(prisma, aliasesYaml, now)).toEqual(result);
    expect(await foundationCounts()).toEqual(firstCounts);
  });

  it('keeps a manually approved report link and candidate decision during fuzzy replay', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const aaveProgram = await prisma.program.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'code4rena', externalId: 'aave-v3' } },
    });
    const aaveReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/aave-v3-review.pdf' },
    });
    const candidate = await prisma.mergeCandidate.findFirstOrThrow({
      where: { leftEntityId: aaveReport.entityId, rightEntityId: aaveProgram.entityId! },
    });
    const decidedAt = new Date(now.getTime() + 1_000);
    await prisma.$transaction([
      prisma.auditReport.update({ where: { id: aaveReport.id }, data: { entityId: aaveProgram.entityId! } }),
      prisma.mergeCandidate.update({
        where: { id: candidate.id },
        data: { status: 'approved', decidedAt },
      }),
    ]);

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 2_000));

    expect((await prisma.auditReport.findUniqueOrThrow({ where: { id: aaveReport.id } })).entityId).toBe(
      aaveProgram.entityId,
    );
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'approved',
      decidedAt,
    });
  });

  it('uses repo aliases before platform aliases and removes stale config aliases', async () => {
    await materializeCatalogFoundation(prisma, repoAndPlatformAliasesYaml, now);
    const where = { platform_externalId: { platform: 'code4rena', externalId: 'uniswap-v4' } };
    expect((await prisma.program.findUniqueOrThrow({ where, include: { entity: true } })).entity?.slug).toBe(
      'repo-precedence-target',
    );

    await materializeCatalogFoundation(prisma, platformAliasOnlyYaml, now);

    expect(await prisma.entityAlias.findUnique({
      where: { kind_key: { kind: 'repo', key: 'github.com/uniswap/v4-core' } },
    })).toBeNull();
    expect((await prisma.program.findUniqueOrThrow({ where, include: { entity: true } })).entity?.slug).toBe(
      'platform-precedence-target',
    );
  });

  it('atomically preserves a manual alias collision and rejected candidate decision', async () => {
    await materializeCatalogFoundation(prisma, collisionAliasYaml, now);
    const alias = await prisma.entityAlias.findUniqueOrThrow({
      where: { kind_key: { kind: 'repo', key: 'github.com/aave/v3' } },
    });
    const manualTarget = await prisma.entity.findUniqueOrThrow({
      where: { slug: 'unrelated-existing-entity' },
    });
    const candidate = await prisma.mergeCandidate.findFirstOrThrow();
    const decidedAt = new Date(now.getTime() + 1_000);
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'rejected', decidedAt },
    });

    let replay: Promise<unknown> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EntityAlias" WHERE "id" = ${alias.id} FOR UPDATE`;
      replay = materializeCatalogFoundation(prisma, collisionAliasYaml, new Date(now.getTime() + 2_000));
      await new Promise((resolve) => setTimeout(resolve, 150));
      await tx.entityAlias.update({
        where: { id: alias.id },
        data: { entityId: manualTarget.id, source: 'manual' },
      });
    });
    await replay;

    expect(await prisma.entityAlias.findUniqueOrThrow({ where: { id: alias.id } })).toMatchObject({
      entityId: manualTarget.id,
      source: 'manual',
    });
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'rejected',
      decidedAt,
    });

    await materializeCatalogFoundation(prisma, '', new Date(now.getTime() + 3_000));
    expect(await prisma.entityAlias.findUniqueOrThrow({ where: { id: alias.id } })).toMatchObject({
      entityId: manualTarget.id,
      source: 'manual',
    });
  });

  it('preserves existing scope signals during replay', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const aaveScope = await prisma.scope.findFirstOrThrow({
      where: { program: { platform: 'code4rena', externalId: 'aave-v3' } },
    });
    await prisma.signal.create({
      data: {
        scopeId: aaveScope.id,
        type: 'audit_gap',
        value: 0.75,
        confidence: 0.8,
        evidence: { fixture: true },
        observationIds: [],
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 1_000));

    expect(await prisma.signal.count({ where: { scopeId: aaveScope.id, type: 'audit_gap' } })).toBe(1);
  });
});

describe('materializeRepoSignals', () => {
  it('uses deterministic current targets and snapshots while isolating a failed repo', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const [uniswapProgram, aaveProgram, auditSource] = await Promise.all([
      prisma.program.findUniqueOrThrow({
        where: { platform_externalId: { platform: 'code4rena', externalId: 'uniswap-v4' } },
      }),
      prisma.program.findUniqueOrThrow({
        where: { platform_externalId: { platform: 'code4rena', externalId: 'aave-v3' } },
      }),
      prisma.observation.findFirstOrThrow({ where: { collectorId: 'audit-report-repos' } }),
    ]);
    const [uniswapScope, aaveScope, aaveReport] = await Promise.all([
      prisma.scope.findFirstOrThrow({ where: { programId: uniswapProgram.id } }),
      prisma.scope.findFirstOrThrow({ where: { programId: aaveProgram.id } }),
      prisma.auditReport.findUniqueOrThrow({
        where: { reportUrl: 'https://reports.example/aave-v3-review.pdf' },
      }),
    ]);

    await prisma.$transaction([
      prisma.scope.update({
        where: { id: aaveScope.id },
        data: { commitish: 'previous-good-head' },
      }),
      prisma.auditReport.update({
        where: { id: aaveReport.id },
        data: { entityId: aaveProgram.entityId!, coveredCommit: 'aave-base' },
      }),
      prisma.observation.create({
        data: {
          id: 'audit-tie-a',
          collectorId: 'audit-report-repos',
          sourceUrl: 'https://reports.example/index-a',
          fetchedAt: now,
          contentHash: 'audit-tie-a',
          payload: [],
        },
      }),
      prisma.observation.create({
        data: {
          id: 'audit-tie-z',
          collectorId: 'audit-report-repos',
          sourceUrl: 'https://reports.example/index-z',
          fetchedAt: now,
          contentHash: 'audit-tie-z',
          payload: [],
        },
      }),
      prisma.auditReport.create({
        data: {
          entityId: uniswapProgram.entityId!,
          firm: 'auditor-a',
          publishedAt: new Date('2026-07-15T00:00:00.000Z'),
          projectHint: 'uniswap-v4',
          observationIds: ['audit-tie-a'],
          reportUrl: 'https://reports.example/a-tied.pdf',
          coveredCommit: 'base-a',
          coveredPaths: [],
        },
      }),
      prisma.auditReport.create({
        data: {
          entityId: uniswapProgram.entityId!,
          firm: 'auditor-z',
          publishedAt: new Date('2026-07-15T00:00:00.000Z'),
          projectHint: 'uniswap-v4',
          observationIds: ['audit-tie-z'],
          reportUrl: 'https://reports.example/z-tied.pdf',
          coveredCommit: 'base-z',
          coveredPaths: [],
        },
      }),
    ]);

    const targets = await listRepoTargets(prisma);
    expect(targets.find(({ scopeId }) => scopeId === uniswapScope.id)).toMatchObject({
      repoKey: 'github.com/uniswap/v4-core',
      lastAuditAt: '2026-07-15T00:00:00.000Z',
      coveredCommit: 'base-a',
      auditObservationIds: ['audit-tie-a'],
    });
    expect(targets.find(({ scopeId }) => scopeId === aaveScope.id)).toMatchObject({
      coveredCommit: 'aave-base',
      auditObservationIds: [auditSource.id],
    });

    const uniswapPayload = {
      repoKey: 'github.com/uniswap/v4-core',
      cutoff: { lastAuditAt: '2026-07-15T00:00:00.000Z', baseCommit: 'base-a' },
      headSha: 'abc123',
      headAuthoredAt: '2026-08-01T00:00:00.000Z',
      files: ['src/Pool.sol'],
      totalLoc: 1000,
      locMethod: 'estimated_from_bytes',
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      commits: ['change001'],
      complete: false,
      truncated: true,
      error: null,
    };
    await prisma.observation.createMany({
      data: [
        {
          id: 'snapshot-a',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/uniswap/v4-core',
          fetchedAt: now,
          contentHash: 'snapshot-a',
          payload: { ...uniswapPayload, headSha: 'ignored-tie' },
        },
        {
          id: 'snapshot-z',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/uniswap/v4-core',
          fetchedAt: now,
          contentHash: 'snapshot-z',
          payload: uniswapPayload,
        },
        {
          id: 'snapshot-failed',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/aave/v3',
          fetchedAt: now,
          contentHash: 'snapshot-failed',
          payload: {
            repoKey: 'github.com/aave/v3',
            cutoff: { lastAuditAt: '2026-06-02T00:00:00.000Z', baseCommit: 'aave-base' },
            headSha: 'failed-new-head',
            headAuthoredAt: '2026-08-01T00:00:00.000Z',
            files: [],
            totalLoc: 0,
            locMethod: 'estimated_from_bytes',
            changedFiles: [],
            commits: [],
            complete: false,
            truncated: false,
            error: 'GitHub returned 503',
          },
        },
      ],
    });

    expect(await materializeRepoSignals(prisma, now)).toEqual({ scopes: 2, noData: 1 });
    const [savedUniswapScope, savedAaveScope, uniswapSignal, aaveSignal] = await Promise.all([
      prisma.scope.findUniqueOrThrow({ where: { id: uniswapScope.id } }),
      prisma.scope.findUniqueOrThrow({ where: { id: aaveScope.id } }),
      prisma.signal.findUniqueOrThrow({
        where: { scopeId_type: { scopeId: uniswapScope.id, type: 'audit_gap' } },
      }),
      prisma.signal.findUniqueOrThrow({
        where: { scopeId_type: { scopeId: aaveScope.id, type: 'audit_gap' } },
      }),
    ]);
    expect(savedUniswapScope.commitish).toBe('abc123');
    expect(savedAaveScope.commitish).toBe('previous-good-head');
    expect(uniswapSignal.observationIds).toEqual(['audit-tie-a', 'snapshot-z']);
    expect(uniswapSignal.confidence).toBe(0.35);
    expect(uniswapSignal.evidence).toMatchObject({ headSha: 'abc123', sinceCommit: 'base-a' });
    expect(aaveSignal.confidence).toBe(0);
    expect(aaveSignal.evidence).toMatchObject({ reason: 'snapshot_failed' });
    expect(aaveSignal.observationIds).toEqual([auditSource.id, 'snapshot-failed']);

    const signalIds = [uniswapSignal.id, aaveSignal.id].sort();
    expect(await materializeRepoSignals(prisma, new Date(now.getTime() + 1_000))).toEqual({
      scopes: 2,
      noData: 1,
    });
    expect(
      (
        await prisma.signal.findMany({
          where: { type: 'audit_gap' },
          orderBy: { id: 'asc' },
        })
      ).map(({ id }) => id).sort(),
    ).toEqual(signalIds);
    expect(await prisma.signal.count({ where: { type: 'audit_gap' } })).toBe(2);
  });

  it('uses the latest exact source observation and refuses a stale cutoff fallback', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const [uniswapScope, aaveScope] = await Promise.all([
      prisma.scope.findFirstOrThrow({
        where: { program: { platform: 'code4rena', externalId: 'uniswap-v4' } },
      }),
      prisma.scope.findFirstOrThrow({
        where: { program: { platform: 'code4rena', externalId: 'aave-v3' } },
      }),
    ]);
    const report = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/uniswap-v4.pdf' },
    });
    await prisma.$transaction([
      prisma.auditReport.update({
        where: { id: report.id },
        data: { coveredCommit: 'current-base' },
      }),
      prisma.scope.update({
        where: { id: aaveScope.id },
        data: { commitish: 'previous-aave-head' },
      }),
    ]);

    const payload = {
      repoKey: 'github.com/uniswap/v4-core',
      cutoff: { lastAuditAt: '2026-06-01T00:00:00.000Z', baseCommit: 'current-base' },
      headSha: 'current-head',
      headAuthoredAt: '2026-08-01T00:00:00.000Z',
      files: ['src/Pool.sol'],
      totalLoc: 1000,
      locMethod: 'estimated_from_bytes',
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      commits: ['change001'],
      complete: true,
      truncated: false,
      error: null,
    };
    await prisma.observation.createMany({
      data: [
        {
          id: 'snapshot-current-older',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/uniswap/v4-core',
          fetchedAt: new Date(now.getTime() - 2_000),
          contentHash: 'snapshot-current-older',
          payload,
        },
        {
          id: 'snapshot-stale-newer',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/uniswap/v4-core',
          fetchedAt: new Date(now.getTime() - 1_000),
          contentHash: 'snapshot-stale-newer',
          payload: {
            ...payload,
            cutoff: { lastAuditAt: payload.cutoff.lastAuditAt, baseCommit: 'stale-base' },
            headSha: 'stale-head',
          },
        },
        {
          id: 'snapshot-foreign-source',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/other/protocol',
          fetchedAt: now,
          contentHash: 'snapshot-foreign-source',
          payload,
        },
        {
          id: 'snapshot-invalid-aave',
          collectorId: 'github-repo-snapshot',
          sourceUrl: 'https://api.github.com/repos/aave/v3',
          fetchedAt: now,
          contentHash: 'snapshot-invalid-aave',
          payload: {
            repoKey: 'github.com/aave/v3',
            cutoff: { lastAuditAt: null, baseCommit: null },
            headSha: 'invalid-head',
            headAuthoredAt: null,
            files: [],
            totalLoc: 0,
            locMethod: 'estimated_from_bytes',
            changedFiles: [],
            commits: [],
            complete: true,
            truncated: false,
            error: null,
          },
        },
      ],
    });

    expect(await materializeRepoSignals(prisma, now)).toEqual({ scopes: 2, noData: 2 });

    const signal = await prisma.signal.findUniqueOrThrow({
      where: { scopeId_type: { scopeId: uniswapScope.id, type: 'audit_gap' } },
    });
    expect(signal.confidence).toBe(0);
    expect(signal.evidence).toMatchObject({ reason: 'stale_cutoff', headSha: 'stale-head' });
    expect(signal.observationIds).toContain('snapshot-stale-newer');
    expect(signal.observationIds).not.toContain('snapshot-current-older');
    expect(signal.observationIds).not.toContain('snapshot-foreign-source');

    const invalidSignal = await prisma.signal.findUniqueOrThrow({
      where: { scopeId_type: { scopeId: aaveScope.id, type: 'audit_gap' } },
    });
    expect(invalidSignal.confidence).toBe(0);
    expect(invalidSignal.evidence).toMatchObject({ reason: 'invalid_snapshot' });
    expect(invalidSignal.observationIds).toContain('snapshot-invalid-aave');
    expect((await prisma.scope.findUniqueOrThrow({ where: { id: aaveScope.id } })).commitish).toBe(
      'previous-aave-head',
    );
  });
});
