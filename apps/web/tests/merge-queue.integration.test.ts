import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listMergeQueue } from '../src/lib/merge-queue.js';
import { decideMergeCandidate } from '../src/lib/merge-decisions.js';
import { withSafeIntegrationDatabase } from '../../worker/tests/integration-database.js';

const prisma = new PrismaClient();
const expectedDatabaseName =
  process.env.KRITT_RADAR_INTEGRATION_DATABASE ?? 'kritt_radar_integration';
let safeDatabaseValidated = false;

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

async function createCandidate(input: {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  similarity: number;
  createdAt: Date;
  decidedAt?: Date;
  reason?: object;
  withEvidence?: boolean;
}): Promise<void> {
  const source = await prisma.entity.create({
    data: { id: `${input.id}-source`, slug: `${input.id}-source`, canonicalName: `${input.id} source` },
  });
  const target = await prisma.entity.create({
    data: {
      id: `${input.id}-target`,
      slug: `${input.id}-target`,
      canonicalName: `${input.id} target`,
      programs: {
        create: input.withEvidence
          ? [
              {
                id: `${input.id}-program-z`,
                platform: 'immunefi',
                externalId: `${input.id}-program-z`,
                title: 'Aave V3',
                url: `https://programs.example/${input.id}-z`,
                kind: 'bounty',
                scopes: {
                  create: {
                    id: `${input.id}-scope-z`,
                    kind: 'repo',
                    hardKey: 'github.com/aave/aave-v3-origin',
                    pathGlobs: [],
                  },
                },
              },
              {
                id: `${input.id}-program-a`,
                platform: 'code4rena',
                externalId: `${input.id}-program-a`,
                title: 'Aave Governance',
                url: `https://programs.example/${input.id}-a`,
                kind: 'contest',
                scopes: {
                  create: {
                    id: `${input.id}-scope-a`,
                    kind: 'repo',
                    hardKey: 'github.com/aave/aave-governance-v3',
                    pathGlobs: [],
                  },
                },
              },
              {
                id: `${input.id}-program-m`,
                platform: 'immunefi',
                externalId: `${input.id}-program-m`,
                title: 'Aave V3',
                url: `https://programs.example/${input.id}-m`,
                kind: 'bounty',
                scopes: {
                  create: {
                    id: `${input.id}-scope-m`,
                    kind: 'repo',
                    hardKey: 'github.com/aave/aave-v3-origin',
                    pathGlobs: [],
                  },
                },
              },
            ]
          : {
              platform: 'immunefi',
              externalId: `${input.id}-program`,
              title: `${input.id} program`,
              url: `https://programs.example/${input.id}`,
              kind: 'bounty',
            },
      },
    },
  });

  if (input.withEvidence) {
    await prisma.auditReport.createMany({
      data: [
        {
          id: `${input.id}-report-z`,
          entityId: source.id,
          firm: 'OpenZeppelin',
          publishedAt: new Date('2026-07-03T00:00:00.000Z'),
          projectHint: 'aave-v3-security',
          observationIds: [],
          reportUrl: `https://reports.example/${input.id}-z`,
          coveredPaths: [],
        },
        {
          id: `${input.id}-report-a`,
          entityId: source.id,
          firm: 'Trail of Bits',
          publishedAt: new Date('2026-07-01T00:00:00.000Z'),
          projectHint: 'aave-v3-review',
          observationIds: [],
          reportUrl: `https://reports.example/${input.id}-a`,
          coveredPaths: [],
        },
        {
          id: `${input.id}-report-m`,
          entityId: source.id,
          firm: 'OpenZeppelin',
          publishedAt: new Date('2026-07-02T00:00:00.000Z'),
          projectHint: 'aave-v3-review',
          observationIds: [],
          reportUrl: `https://reports.example/${input.id}-m`,
          coveredPaths: [],
        },
      ],
    });
  }

  await prisma.mergeCandidate.create({
    data: {
      id: input.id,
      leftEntityId: source.id,
      rightEntityId: target.id,
      status: input.status,
      similarity: input.similarity,
      reason: input.reason ?? { tokenJaccard: 0.9, editSimilarity: 0.8 },
      createdAt: input.createdAt,
      decidedAt: input.decidedAt,
    },
  });
}

beforeAll(async () => {
  await withSafeIntegrationDatabase(await currentDatabaseName(), expectedDatabaseName, async () => {});
  safeDatabaseValidated = true;
});

beforeEach(async () => {
  await cleanDatabase();
  await createCandidate({
    id: 'highest-score',
    status: 'pending',
    similarity: 0.99,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    reason: { tokenJaccard: 'malformed', editSimilarity: 'malformed' },
    withEvidence: true,
  });
  await createCandidate({
    id: 'older-tie',
    status: 'pending',
    similarity: 0.8,
    createdAt: new Date('2026-08-01T11:00:00.000Z'),
  });
  await createCandidate({
    id: 'newer-tie',
    status: 'pending',
    similarity: 0.8,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
  });
  await createCandidate({
    id: 'approved-candidate',
    status: 'approved',
    similarity: 0.7,
    createdAt: new Date('2026-08-01T13:00:00.000Z'),
    decidedAt: new Date('2026-08-02T09:30:00.000Z'),
  });
  await createCandidate({
    id: 'rejected-candidate',
    status: 'rejected',
    similarity: 0.6,
    createdAt: new Date('2026-08-01T14:00:00.000Z'),
  });
});

afterAll(async () => {
  try {
    if (safeDatabaseValidated) await cleanDatabase();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listMergeQueue', () => {
  it('returns stable pending candidates with global status counts', async () => {
    const page = await listMergeQueue(prisma, 'pending');

    expect(page.counts).toEqual({ pending: 3, approved: 1, rejected: 1 });
    expect(page.candidates.map((row) => row.id)).toEqual([
      'highest-score',
      'older-tie',
      'newer-tie',
    ]);
    expect(page.candidates[0]).toMatchObject({
      tokenJaccard: null,
      editSimilarity: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      decidedAt: null,
      approvable: true,
      blockedReason: null,
    });
  });

  it('serializes a non-null decision timestamp to the exact ISO value', async () => {
    const page = await listMergeQueue(prisma, 'approved');

    expect(page.candidates[0]!.decidedAt).toBe('2026-08-02T09:30:00.000Z');
  });

  it('deduplicates evidence lists in deterministic relation order', async () => {
    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]!.source?.projectHints).toEqual([
      'aave-v3-review',
      'aave-v3-security',
    ]);
    expect(page.candidates[0]!.source?.auditFirms).toEqual(['Trail of Bits', 'OpenZeppelin']);
    expect(page.candidates[0]!.target?.platforms).toEqual(['code4rena', 'immunefi']);
    expect(page.candidates[0]!.target?.programTitles).toEqual(['Aave Governance', 'Aave V3']);
    expect(page.candidates[0]!.target?.repoScopes).toEqual([
      'github.com/aave/aave-governance-v3',
      'github.com/aave/aave-v3-origin',
    ]);
    expect(page.candidates[0]!.source?.newestReport).toEqual({
      firm: 'OpenZeppelin',
      projectHint: 'aave-v3-security',
      publishedAt: '2026-07-03T00:00:00.000Z',
      reportUrl: 'https://reports.example/highest-score-z',
    });
  });

  it('blocks approval when the provisional entity has no audit reports', async () => {
    await prisma.auditReport.deleteMany({ where: { entityId: 'highest-score-source' } });

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({
      approvable: false,
      blockedReason: 'Provisional entity has no audit reports to merge.',
    });
  });

  it('blocks approval when any normalized audit hint is empty', async () => {
    await prisma.auditReport.update({
      where: { id: 'highest-score-report-z' },
      data: { projectHint: '   ' },
    });

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({
      approvable: false,
      blockedReason: 'Audit report project hints must not be empty.',
    });
  });

  it('blocks approval when an audit hint alias belongs to another entity', async () => {
    await prisma.entityAlias.create({
      data: {
        entityId: 'older-tie-target',
        kind: 'audit_hint',
        key: 'aave-v3-review',
        source: 'config',
      },
    });

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({
      approvable: false,
      blockedReason: 'An audit hint alias belongs to another entity.',
    });
  });

  it('keeps approval available when an audit hint alias already targets the canonical entity', async () => {
    await prisma.entityAlias.create({
      data: {
        entityId: 'highest-score-target',
        kind: 'audit_hint',
        key: 'aave-v3-review',
        source: 'config',
      },
    });

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({ approvable: true, blockedReason: null });
  });

  it('renders durable affected evidence after approval moves reports', async () => {
    const decidedAt = new Date('2026-08-04T08:00:00.000Z');

    await expect(
      decideMergeCandidate(prisma, {
        candidateId: 'highest-score',
        action: 'approve',
        now: decidedAt,
      }),
    ).resolves.toMatchObject({ ok: true, reportsMoved: 3 });

    const page = await listMergeQueue(prisma, 'approved');
    const approved = page.candidates.find((candidate) => candidate.id === 'highest-score');

    expect(approved).toMatchObject({
      decidedAt: decidedAt.toISOString(),
      approvalEvidence: {
        reportsMoved: 3,
        aliasKeys: ['aave-v3-review', 'aave-v3-security'],
        newestReport: {
          firm: 'OpenZeppelin',
          projectHint: 'aave-v3-security',
          publishedAt: '2026-07-03T00:00:00.000Z',
          reportUrl: 'https://reports.example/highest-score-z',
        },
      },
    });
    expect(approved?.source?.auditReportCount).toBe(0);
  });
});
