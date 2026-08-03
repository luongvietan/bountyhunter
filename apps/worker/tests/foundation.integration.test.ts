import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { materializeCatalogFoundation } from '../src/foundation.js';

const prisma = new PrismaClient();
const now = new Date('2026-08-03T12:00:00.000Z');

const aliasesYaml = `
repo-github-com-uniswap-v4-core:
  canonicalName: uniswap/v4-core
  match:
    - auditHint: uniswap-v4
`;

async function cleanDatabase(): Promise<void> {
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
}

async function seedObservations(): Promise<void> {
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
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!/(?:integration|test)/i.test(rows[0]?.name ?? '')) {
    throw new Error('foundation integration tests require a dedicated integration/test database');
  }
  await cleanDatabase();
  await seedObservations();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe('materializeCatalogFoundation', () => {
  it('materializes exact aliases and reviewable fuzzy candidates idempotently', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);

    expect(await prisma.entityAlias.count()).toBe(1);
    expect(await prisma.program.count()).toBe(2);
    expect(await prisma.program.count({ where: { entityId: null } })).toBe(0);
    expect(await prisma.auditReport.count()).toBe(2);
    expect(await prisma.mergeCandidate.count({ where: { status: 'pending' } })).toBe(1);

    const uniswapProgram = await prisma.program.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'code4rena', externalId: 'uniswap-v4' } },
    });
    const uniswapReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/uniswap-v4.pdf' },
    });
    expect(uniswapReport.entityId).toBe(uniswapProgram.entityId);

    const aaveProgram = await prisma.program.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'code4rena', externalId: 'aave-v3' } },
    });
    const aaveReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/aave-v3-review.pdf' },
    });
    expect(aaveReport.entityId).not.toBe(aaveProgram.entityId);

    const firstCounts = await foundationCounts();
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    expect(await foundationCounts()).toEqual(firstCounts);

    const candidate = await prisma.mergeCandidate.findFirstOrThrow();
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: { status: 'rejected', decidedAt: now },
    });
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    expect((await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe(
      'rejected',
    );
    const aaveScope = await prisma.scope.findFirstOrThrow({ where: { programId: aaveProgram.id } });
    await prisma.entityAlias.create({
      data: {
        entityId: aaveProgram.entityId!,
        kind: 'platform_name',
        key: 'manual:aave-v3',
        source: 'manual',
      },
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

    expect(await prisma.entityAlias.count({ where: { source: 'manual' } })).toBe(1);
    expect(await prisma.signal.count({ where: { scopeId: aaveScope.id, type: 'audit_gap' } })).toBe(1);
  });
});
