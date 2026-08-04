import { githubRepoSnapshotSourceKey, type RepoTarget } from '@kritt-radar/collectors';
import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countDroppedContestPrograms,
  listRepoTargets,
  materializeCatalogFoundation,
  materializeRepoSignals,
} from '../src/foundation.js';
import { withSafeIntegrationDatabase } from './integration-database.js';
import { sync } from '../src/cli.js';
import { decideMergeCandidate } from '../../web/src/lib/merge-decisions.js';

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

function snapshotSource(target: RepoTarget): string {
  return githubRepoSnapshotSourceKey(target);
}

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

    expect(result).toEqual({
      programs: 2,
      scopes: 2,
      entities: 2,
      reports: 2,
      // Immunefi seeds carry no audits[], so the structural bridge contributes nothing here.
      programAudits: 0,
      candidates: 0,
    });
    expect(await countDroppedContestPrograms(prisma)).toBe(1);
    expect(await prisma.entity.count()).toBe(3);
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
    const aaveReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/aave-v3-review.pdf' },
    });
    expect(aaveReport.entityId).toBe(aaveProgram.entityId);

    const firstCounts = await foundationCounts();
    expect(await materializeCatalogFoundation(prisma, aliasesYaml, now)).toEqual(result);
    expect(await foundationCounts()).toEqual(firstCounts);
  });

  it('keeps a manually approved report link and candidate decision during fuzzy replay', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const fuzzyEntity = await prisma.entity.create({
      data: { slug: 'protocol-a', canonicalName: 'protocol a' },
    });
    const longToken = 'a'.repeat(53);
    const secondFuzzyEntity = await prisma.entity.create({
      data: { slug: 'long-token-protocol', canonicalName: longToken },
    });
    await prisma.program.createMany({
      data: [
        {
          entityId: fuzzyEntity.id,
          platform: 'fixture',
          externalId: 'protocol-a',
          title: 'Protocol A',
          url: 'https://programs.example/protocol-a',
          kind: 'bounty',
        },
        {
          entityId: secondFuzzyEntity.id,
          platform: 'fixture',
          externalId: 'long-token-protocol',
          title: 'Long token protocol',
          url: 'https://programs.example/long-token-protocol',
          kind: 'bounty',
        },
      ],
    });
    await prisma.observation.create({
      data: {
        collectorId: 'audit-report-repos',
        sourceUrl: 'https://reports.example/fuzzy-index',
        fetchedAt: new Date(now.getTime() + 1_000),
        contentHash: 'audit-fuzzy-protocol-a',
        payload: [
          {
            firm: 'auditor',
            projectHint: 'a protocol',
            publishedAt: '2026-06-03T00:00:00.000Z',
            reportUrl: 'https://reports.example/fuzzy-protocol-a.pdf',
          },
          {
            firm: 'auditor',
            projectHint: `${longToken} v2`,
            publishedAt: '2026-06-03T00:00:00.000Z',
            reportUrl: 'https://reports.example/fuzzy-long-token.pdf',
          },
        ],
      },
    });
    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 2_000));

    const fuzzyReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/fuzzy-protocol-a.pdf' },
    });
    const candidate = await prisma.mergeCandidate.findFirstOrThrow({
      where: { leftEntityId: fuzzyReport.entityId, rightEntityId: fuzzyEntity.id },
    });
    expect(candidate).toMatchObject({ status: 'pending', similarity: 0.84 });
    expect(fuzzyReport.entityId).not.toBe(fuzzyEntity.id);
    const secondFuzzyReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/fuzzy-long-token.pdf' },
    });
    const secondCandidate = await prisma.mergeCandidate.findFirstOrThrow({
      where: {
        leftEntityId: secondFuzzyReport.entityId,
        rightEntityId: secondFuzzyEntity.id,
      },
    });
    expect(secondCandidate.status).toBe('pending');
    expect(secondCandidate.similarity).toBeCloseTo(0.6785714285714286);
    expect(secondFuzzyReport.entityId).not.toBe(secondFuzzyEntity.id);

    const decidedAt = new Date(now.getTime() + 3_000);
    await expect(decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
      now: decidedAt,
    })).resolves.toMatchObject({ ok: true, reportsMoved: 1 });
    const approved = await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const approvedReason = approved.reason as Record<string, unknown>;
    const approvalEvidence = approvedReason.approvalEvidence;
    expect(approvalEvidence).toMatchObject({
      reportsMoved: 1,
      aliasKeys: ['a protocol'],
      newestReport: {
        firm: 'auditor',
        projectHint: 'a protocol',
        publishedAt: '2026-06-03T00:00:00.000Z',
        reportUrl: 'https://reports.example/fuzzy-protocol-a.pdf',
      },
    });
    await prisma.mergeCandidate.update({
      where: { id: candidate.id },
      data: {
        similarity: 0.01,
        reason: {
          tokenJaccard: 0.01,
          editSimilarity: 0.02,
          approvalEvidence: approvalEvidence as object,
        },
      },
    });
    await prisma.observation.create({
      data: {
        collectorId: 'audit-report-repos',
        sourceUrl: 'https://reports.example/fuzzy-replay-index',
        fetchedAt: new Date(now.getTime() + 4_000),
        contentHash: 'audit-fuzzy-protocol-a-reformatted',
        payload: [{
          firm: 'auditor-two',
          projectHint: ' A---PROTOCOL security review ',
          publishedAt: '2026-06-04T00:00:00.000Z',
          reportUrl: 'https://reports.example/fuzzy-protocol-a-reformatted.pdf',
        }],
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 5_000));

    expect((await prisma.auditReport.findUniqueOrThrow({ where: { id: fuzzyReport.id } })).entityId).toBe(
      fuzzyEntity.id,
    );
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
      status: 'approved',
      decidedAt,
      similarity: 0.84,
      reason: {
        tokenJaccard: 1,
        editSimilarity: 0.6,
        approvalEvidence,
      },
    });
  });

  it('keeps ambiguous normalized identities provisional and pending', async () => {
    const entities = await Promise.all([
      prisma.entity.create({
        data: { slug: 'ambiguous-protocol-one', canonicalName: 'Ambiguous Protocol' },
      }),
      prisma.entity.create({
        data: { slug: 'ambiguous-protocol-two', canonicalName: 'ambiguous-protocol' },
      }),
    ]);
    await prisma.program.createMany({
      data: entities.map((entity, index) => ({
        entityId: entity.id,
        platform: 'fixture',
        externalId: `ambiguous-${index}`,
        title: `Ambiguous ${index}`,
        url: `https://programs.example/ambiguous-${index}`,
        kind: 'bounty',
      })),
    });
    await prisma.observation.create({
      data: {
        collectorId: 'audit-report-repos',
        sourceUrl: 'https://reports.example/ambiguous-index',
        fetchedAt: new Date(now.getTime() + 1_000),
        contentHash: 'audit-ambiguous-protocol',
        payload: [{
          firm: 'auditor',
          projectHint: 'ambiguous-protocol',
          publishedAt: '2026-06-04T00:00:00.000Z',
          reportUrl: 'https://reports.example/ambiguous-protocol.pdf',
        }],
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 2_000));

    const report = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/ambiguous-protocol.pdf' },
    });
    expect(entities.map(({ id }) => id)).not.toContain(report.entityId);
    expect(await prisma.mergeCandidate.findMany({
      where: { leftEntityId: report.entityId, rightEntityId: { in: entities.map(({ id }) => id) } },
      select: { status: true, similarity: true },
      orderBy: { rightEntityId: 'asc' },
    })).toEqual([
      { status: 'pending', similarity: 1 },
      { status: 'pending', similarity: 1 },
    ]);
  });

  it('keeps explicit audit aliases ahead of normalized canonical identities', async () => {
    const normalizedEntity = await prisma.entity.create({
      data: { slug: 'normalized-uniswap-v4', canonicalName: 'Uniswap v4' },
    });
    await prisma.program.create({
      data: {
        entityId: normalizedEntity.id,
        platform: 'fixture',
        externalId: 'normalized-uniswap-v4',
        title: 'Uniswap v4',
        url: 'https://programs.example/normalized-uniswap-v4',
        kind: 'bounty',
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, now);

    const [alias, report] = await Promise.all([
      prisma.entityAlias.findUniqueOrThrow({
        where: { kind_key: { kind: 'audit_hint', key: 'uniswap-v4' } },
      }),
      prisma.auditReport.findUniqueOrThrow({
        where: { reportUrl: 'https://reports.example/uniswap-v4.pdf' },
      }),
    ]);
    expect(report.entityId).toBe(alias.entityId);
    expect(report.entityId).not.toBe(normalizedEntity.id);
  });

  it('auto-links a unique exact slug identity but never an empty normalized identity', async () => {
    const [slugEntity, emptyEntity] = await Promise.all([
      prisma.entity.create({
        data: { slug: 'slug-only-protocol', canonicalName: 'Unrelated canonical identity' },
      }),
      prisma.entity.create({
        data: { slug: 'noise-only-program', canonicalName: 'Audit Report' },
      }),
    ]);
    await prisma.program.createMany({
      data: [
        {
          entityId: slugEntity.id,
          platform: 'fixture',
          externalId: 'slug-only-protocol',
          title: 'Slug only protocol',
          url: 'https://programs.example/slug-only-protocol',
          kind: 'bounty',
        },
        {
          entityId: emptyEntity.id,
          platform: 'fixture',
          externalId: 'noise-only-program',
          title: 'Noise only program',
          url: 'https://programs.example/noise-only-program',
          kind: 'bounty',
        },
      ],
    });
    await prisma.observation.create({
      data: {
        collectorId: 'audit-report-repos',
        sourceUrl: 'https://reports.example/exact-slug-index',
        fetchedAt: new Date(now.getTime() + 1_000),
        contentHash: 'audit-exact-slug-and-empty',
        payload: [
          {
            firm: 'auditor',
            projectHint: 'slug-only-protocol',
            publishedAt: '2026-06-05T00:00:00.000Z',
            reportUrl: 'https://reports.example/slug-only-protocol.pdf',
          },
          {
            firm: 'auditor',
            projectHint: 'Security Assessment',
            publishedAt: '2026-06-05T00:00:00.000Z',
            reportUrl: 'https://reports.example/noise-only.pdf',
          },
        ],
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 2_000));

    const [slugReport, emptyReport] = await Promise.all([
      prisma.auditReport.findUniqueOrThrow({
        where: { reportUrl: 'https://reports.example/slug-only-protocol.pdf' },
      }),
      prisma.auditReport.findUniqueOrThrow({
        where: { reportUrl: 'https://reports.example/noise-only.pdf' },
      }),
    ]);
    expect(slugReport.entityId).toBe(slugEntity.id);
    expect(emptyReport.entityId).not.toBe(emptyEntity.id);
  });

  it('preserves manually enriched audit coverage during observation replay', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const report = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/aave-v3-review.pdf' },
    });
    await prisma.auditReport.update({
      where: { id: report.id },
      data: {
        coveredCommit: 'manually-covered-commit',
        coveredPaths: ['contracts/core/**', 'contracts/periphery/**'],
      },
    });

    await materializeCatalogFoundation(prisma, aliasesYaml, new Date(now.getTime() + 1_000));

    expect(await prisma.auditReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({
      coveredCommit: 'manually-covered-commit',
      coveredPaths: ['contracts/core/**', 'contracts/periphery/**'],
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
          sourceUrl: snapshotSource({
            repoKey: 'github.com/uniswap/v4-core',
            pathGlobs: [],
            lastAuditAt: '2026-07-15T00:00:00.000Z',
            coveredCommit: 'base-a',
          }),
          fetchedAt: now,
          contentHash: 'snapshot-a',
          payload: { ...uniswapPayload, headSha: 'ignored-tie' },
        },
        {
          id: 'snapshot-z',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource({
            repoKey: 'github.com/uniswap/v4-core',
            pathGlobs: [],
            lastAuditAt: '2026-07-15T00:00:00.000Z',
            coveredCommit: 'base-a',
          }),
          fetchedAt: now,
          contentHash: 'snapshot-z',
          payload: uniswapPayload,
        },
        {
          id: 'snapshot-failed',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource({
            repoKey: 'github.com/aave/v3',
            pathGlobs: [],
            lastAuditAt: '2026-06-02T00:00:00.000Z',
            coveredCommit: 'aave-base',
          }),
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

    expect(await materializeRepoSignals(prisma, now)).toEqual({ scopes: 2, noData: 1, auditCoverage: 'unsearched' });
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
      auditCoverage: 'unsearched',
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
          sourceUrl: snapshotSource({
            repoKey: 'github.com/uniswap/v4-core',
            pathGlobs: [],
            lastAuditAt: '2026-06-01T00:00:00.000Z',
            coveredCommit: 'current-base',
          }),
          fetchedAt: new Date(now.getTime() - 2_000),
          contentHash: 'snapshot-current-older',
          payload,
        },
        {
          id: 'snapshot-stale-newer',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource({
            repoKey: 'github.com/uniswap/v4-core',
            pathGlobs: [],
            lastAuditAt: '2026-06-01T00:00:00.000Z',
            coveredCommit: 'current-base',
          }),
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
          sourceUrl: snapshotSource({
            repoKey: 'github.com/other/protocol',
            pathGlobs: [],
            lastAuditAt: '2026-06-01T00:00:00.000Z',
            coveredCommit: 'current-base',
          }),
          fetchedAt: now,
          contentHash: 'snapshot-foreign-source',
          payload,
        },
        {
          id: 'snapshot-invalid-aave',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource({
            repoKey: 'github.com/aave/v3',
            pathGlobs: [],
            lastAuditAt: '2026-06-02T00:00:00.000Z',
            coveredCommit: null,
          }),
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

    expect(await materializeRepoSignals(prisma, now)).toEqual({ scopes: 2, noData: 2, auditCoverage: 'unsearched' });

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

  it('isolates snapshots and evidence for two scopes on the same repository', async () => {
    await materializeCatalogFoundation(prisma, aliasesYaml, now);
    const firstScope = await prisma.scope.findFirstOrThrow({
      where: { program: { platform: 'code4rena', externalId: 'uniswap-v4' } },
    });
    const firstReport = await prisma.auditReport.findUniqueOrThrow({
      where: { reportUrl: 'https://reports.example/uniswap-v4.pdf' },
    });
    const secondEntity = await prisma.entity.create({
      data: { slug: 'second-uniswap-scope', canonicalName: 'Second Uniswap scope' },
    });
    const secondProgram = await prisma.program.create({
      data: {
        entityId: secondEntity.id,
        platform: 'fixture',
        externalId: 'second-uniswap-scope',
        title: 'Second Uniswap scope',
        url: 'https://programs.example/second-uniswap-scope',
        kind: 'bounty',
      },
    });
    const secondScope = await prisma.scope.create({
      data: {
        programId: secondProgram.id,
        kind: 'repo',
        hardKey: 'github.com/uniswap/v4-core',
        repoUrl: 'https://github.com/uniswap/v4-core',
        pathGlobs: ['contracts/periphery/**'],
      },
    });
    await prisma.$transaction([
      prisma.scope.update({
        where: { id: firstScope.id },
        data: { pathGlobs: ['contracts/core/**'] },
      }),
      prisma.auditReport.update({
        where: { id: firstReport.id },
        data: { coveredCommit: 'core-base' },
      }),
      prisma.auditReport.create({
        data: {
          entityId: secondEntity.id,
          firm: 'auditor',
          publishedAt: new Date('2026-05-01T00:00:00.000Z'),
          projectHint: 'second-uniswap-scope',
          observationIds: ['audit-second-scope'],
          reportUrl: 'https://reports.example/second-uniswap-scope.pdf',
          coveredCommit: 'periphery-base',
          coveredPaths: ['contracts/periphery/**'],
        },
      }),
    ]);

    const targets = await listRepoTargets(prisma);
    const firstTarget = targets.find(({ scopeId }) => scopeId === firstScope.id)!;
    const secondTarget = targets.find(({ scopeId }) => scopeId === secondScope.id)!;
    expect(firstTarget.repoKey).toBe(secondTarget.repoKey);
    expect(snapshotSource(firstTarget)).not.toBe(snapshotSource(secondTarget));

    await prisma.observation.createMany({
      data: [
        {
          id: 'snapshot-core-scope',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource(firstTarget),
          fetchedAt: now,
          contentHash: 'snapshot-core-scope',
          payload: {
            repoKey: firstTarget.repoKey,
            cutoff: {
              lastAuditAt: firstTarget.lastAuditAt,
              baseCommit: firstTarget.coveredCommit,
            },
            headSha: 'core-head',
            headAuthoredAt: '2026-08-01T00:00:00.000Z',
            files: ['contracts/core/Pool.sol'],
            totalLoc: 1000,
            locMethod: 'estimated_from_bytes',
            changedFiles: [{ path: 'contracts/core/Pool.sol', changedLoc: 100 }],
            commits: ['core-change'],
            complete: true,
            truncated: false,
            error: null,
          },
        },
        {
          id: 'snapshot-periphery-scope',
          collectorId: 'github-repo-snapshot',
          sourceUrl: snapshotSource(secondTarget),
          fetchedAt: new Date(now.getTime() + 1_000),
          contentHash: 'snapshot-periphery-scope',
          payload: {
            repoKey: secondTarget.repoKey,
            cutoff: {
              lastAuditAt: secondTarget.lastAuditAt,
              baseCommit: secondTarget.coveredCommit,
            },
            headSha: 'periphery-head',
            headAuthoredAt: '2026-08-02T00:00:00.000Z',
            files: ['contracts/periphery/Router.sol'],
            totalLoc: 2000,
            locMethod: 'estimated_from_bytes',
            changedFiles: [{ path: 'contracts/periphery/Router.sol', changedLoc: 400 }],
            commits: ['periphery-change'],
            complete: true,
            truncated: false,
            error: null,
          },
        },
      ],
    });

    expect(await materializeRepoSignals(prisma, new Date(now.getTime() + 2_000))).toEqual({
      scopes: 3,
      noData: 1,
      auditCoverage: 'unsearched',
    });
    const [firstSignal, secondSignal] = await Promise.all([
      prisma.signal.findUniqueOrThrow({
        where: { scopeId_type: { scopeId: firstScope.id, type: 'audit_gap' } },
      }),
      prisma.signal.findUniqueOrThrow({
        where: { scopeId_type: { scopeId: secondScope.id, type: 'audit_gap' } },
      }),
    ]);
    expect(firstSignal).toMatchObject({
      value: 0.6680104684941067,
      observationIds: expect.arrayContaining(['snapshot-core-scope']),
      evidence: expect.objectContaining({
        headSha: 'core-head',
        sinceCommit: 'core-base',
        files: ['contracts/core/Pool.sol'],
      }),
    });
    expect(firstSignal.observationIds).not.toContain('snapshot-periphery-scope');
    expect(secondSignal).toMatchObject({
      value: 0.7885336367522783,
      observationIds: ['audit-second-scope', 'snapshot-periphery-scope'],
      evidence: expect.objectContaining({
        headSha: 'periphery-head',
        sinceCommit: 'periphery-base',
        files: ['contracts/periphery/Router.sol'],
      }),
    });
    expect(secondSignal.observationIds).not.toContain('snapshot-core-scope');
  });
});

describe('sync', () => {
  it('runs the two-phase catalog and GitHub stages in exact dependency order', async () => {
    const calls: string[] = [];
    const stage = (name: string) => async () => {
      calls.push(name);
    };

    await sync({
      collectCatalog: stage('collect-catalog'),
      materializeCatalog: stage('materialize-catalog'),
      collectGithub: stage('collect-github'),
      materializeSignals: stage('materialize-signals'),
      rank: stage('rank'),
    });

    expect(calls).toEqual([
      'collect-catalog',
      'materialize-catalog',
      'collect-github',
      'materialize-signals',
      'rank',
    ]);
  });

  it('continues materialization and ranking after a partial GitHub run', async () => {
    const calls: string[] = [];
    const stage = (name: string) => async () => {
      calls.push(name);
    };

    await sync({
      collectCatalog: stage('collect-catalog'),
      materializeCatalog: stage('materialize-catalog'),
      collectGithub: async () => {
        calls.push('collect-github:partial');
        return { status: 'partial' as const };
      },
      materializeSignals: stage('materialize-signals'),
      rank: stage('rank'),
    });

    expect(calls).toEqual([
      'collect-catalog',
      'materialize-catalog',
      'collect-github:partial',
      'materialize-signals',
      'rank',
    ]);
  });

  it('rejects a hard stage error and does not run later stages', async () => {
    const calls: string[] = [];
    const hardError = new Error('catalog materialization failed');
    const stage = (name: string) => async () => {
      calls.push(name);
    };

    await expect(
      sync({
        collectCatalog: stage('collect-catalog'),
        materializeCatalog: async () => {
          calls.push('materialize-catalog');
          throw hardError;
        },
        collectGithub: stage('collect-github'),
        materializeSignals: stage('materialize-signals'),
        rank: stage('rank'),
      }),
    ).rejects.toBe(hardError);
    expect(calls).toEqual(['collect-catalog', 'materialize-catalog']);
  });
});
