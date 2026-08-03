import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listMergeQueue } from '../src/lib/merge-queue.js';
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
        create: {
          platform: 'immunefi',
          externalId: `${input.id}-program`,
          title: `${input.id} program`,
          url: `https://programs.example/${input.id}`,
          kind: 'bounty',
          scopes: input.withEvidence
            ? { create: { kind: 'repo', hardKey: 'github.com/aave/aave-v3-origin', pathGlobs: [] } }
            : undefined,
        },
      },
      auditReports: input.withEvidence
        ? {
            create: {
              firm: 'Trail of Bits',
              publishedAt: new Date('2026-07-01T00:00:00.000Z'),
              projectHint: 'target-report',
              observationIds: [],
              reportUrl: `https://reports.example/${input.id}-target`,
              coveredPaths: [],
            },
          }
        : undefined,
    },
  });

  if (input.withEvidence) {
    await prisma.auditReport.create({
      data: {
        entityId: source.id,
        firm: 'OpenZeppelin',
        publishedAt: new Date('2026-07-02T00:00:00.000Z'),
        projectHint: 'aave-v3-review',
        observationIds: [],
        reportUrl: `https://reports.example/${input.id}-source`,
        coveredPaths: [],
      },
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
  it('returns stable pending candidates with serializable evidence and global status counts', async () => {
    const page = await listMergeQueue(prisma, 'pending');

    expect(page.counts).toEqual({ pending: 3, approved: 1, rejected: 1 });
    expect(page.candidates.map((row) => row.id)).toEqual([
      'highest-score',
      'older-tie',
      'newer-tie',
    ]);
    expect(page.candidates[0]!.source?.projectHints).toEqual(['aave-v3-review']);
    expect(page.candidates[0]!.target?.repoScopes).toContain('github.com/aave/aave-v3-origin');
    expect(page.candidates[0]).toMatchObject({
      tokenJaccard: null,
      editSimilarity: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      approvable: true,
      blockedReason: null,
    });
  });
});
