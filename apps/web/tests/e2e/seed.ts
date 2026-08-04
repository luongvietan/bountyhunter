import { PrismaClient } from '@kritt-radar/db';

/**
 * Fixed ids and timestamps so assertions can name exact rows and the rendered
 * order never depends on insertion timing.
 */
export const SEED = {
  approvableCandidateId: 'e2e-candidate-approvable',
  blockedCandidateId: 'e2e-candidate-blocked',
  provisionalEntityId: 'e2e-entity-provisional',
  canonicalEntityId: 'e2e-entity-canonical',
  emptyProvisionalEntityId: 'e2e-entity-provisional-empty',
  otherCanonicalEntityId: 'e2e-entity-canonical-other',
  measuredScopeId: 'e2e-scope',
  assumedScopeId: 'e2e-scope-other',
  sherlockScopeId: 'e2e-scope-sherlock',
  auditHint: 'zephyr-perps-security-review',
  repoKey: 'github.com/zephyr-fi/perps-core',
  sherlockRepoKey: 'github.com/acme/vault',
  headCommit: 'abc123def4567890',
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  auditPublishedAt: new Date('2026-03-14T00:00:00.000Z'),
} as const;

/**
 * Two candidates covering the branch the operator cares about most: one that
 * can be approved, and one the read model refuses to approve because the
 * provisional side carries no audit report to move.
 */
export async function seedMergeQueue(prisma: PrismaClient): Promise<void> {
  await prisma.entity.create({
    data: {
      id: SEED.provisionalEntityId,
      slug: 'audit-zephyr-perps',
      canonicalName: 'zephyr perps',
      createdAt: SEED.createdAt,
      auditReports: {
        create: {
          id: 'e2e-report',
          firm: 'trailofbits',
          projectHint: SEED.auditHint,
          publishedAt: SEED.auditPublishedAt,
          reportUrl: 'https://github.com/trailofbits/publications/blob/HEAD/reviews/e2e.pdf',
          observationIds: [],
          coveredPaths: [],
        },
      },
    },
  });

  await prisma.entity.create({
    data: {
      id: SEED.canonicalEntityId,
      slug: 'repo-github-com-zephyr-fi-perps-core',
      canonicalName: 'zephyr-fi/perps-core',
      createdAt: SEED.createdAt,
      programs: {
        create: {
          id: 'e2e-program',
          platform: 'immunefi',
          externalId: 'zephyr-perps',
          title: 'Zephyr Perps',
          url: 'https://immunefi.com/bounty/zephyr-perps/',
          kind: 'bounty',
          publishedAt: SEED.createdAt,
          scopes: {
            create: {
              id: SEED.measuredScopeId,
              kind: 'repo',
              hardKey: SEED.repoKey,
              repoUrl: SEED.repoKey,
              pathGlobs: [],
              commitish: SEED.headCommit,
            },
          },
        },
      },
    },
  });

  // Provisional with no audit report: roles resolve, but approval is blocked.
  await prisma.entity.create({
    data: {
      id: SEED.emptyProvisionalEntityId,
      slug: 'audit-orbit-lending',
      canonicalName: 'orbit lending',
      createdAt: SEED.createdAt,
    },
  });

  await prisma.entity.create({
    data: {
      id: SEED.otherCanonicalEntityId,
      slug: 'repo-github-com-orbit-fi-lending',
      canonicalName: 'orbit-fi/lending',
      createdAt: SEED.createdAt,
      programs: {
        create: {
          id: 'e2e-program-other',
          platform: 'immunefi',
          externalId: 'orbit-lending',
          title: 'Orbit Lending',
          url: 'https://immunefi.com/bounty/orbit-lending/',
          kind: 'bounty',
          publishedAt: SEED.createdAt,
          scopes: {
            create: {
              id: SEED.assumedScopeId,
              kind: 'repo',
              hardKey: 'github.com/orbit-fi/lending',
              repoUrl: 'github.com/orbit-fi/lending',
              pathGlobs: [],
            },
          },
        },
      },
    },
  });

  await prisma.mergeCandidate.create({
    data: {
      id: SEED.approvableCandidateId,
      leftEntityId: SEED.provisionalEntityId,
      rightEntityId: SEED.canonicalEntityId,
      similarity: 0.84,
      status: 'pending',
      reason: { tokenJaccard: 1, editSimilarity: 0.6 },
      createdAt: SEED.createdAt,
    },
  });

  await prisma.mergeCandidate.create({
    data: {
      id: SEED.blockedCandidateId,
      leftEntityId: SEED.emptyProvisionalEntityId,
      rightEntityId: SEED.otherCanonicalEntityId,
      similarity: 0.71,
      status: 'pending',
      reason: { tokenJaccard: 0.75, editSimilarity: 0.57 },
      createdAt: SEED.createdAt,
    },
  });
}

/**
 * Targets need measured and assumed audit gaps on distinct platforms so the
 * ranking page can prove ordering, filters, and the Open-Kritt handoff.
 */
export async function seedTargets(prisma: PrismaClient): Promise<void> {
  await prisma.entity.create({
    data: {
      id: 'e2e-entity-sherlock',
      slug: 'repo-github-com-acme-vault',
      canonicalName: 'acme/vault',
      createdAt: SEED.createdAt,
      programs: {
        create: {
          id: 'e2e-program-sherlock',
          platform: 'sherlock',
          externalId: '42',
          title: 'Acme Vault',
          url: 'https://audits.sherlock.xyz/contests/42',
          kind: 'contest',
          publishedAt: SEED.createdAt,
          endsAt: new Date('2026-09-01T00:00:00.000Z'),
          scopes: {
            create: {
              id: SEED.sherlockScopeId,
              kind: 'repo',
              hardKey: SEED.sherlockRepoKey,
              repoUrl: SEED.sherlockRepoKey,
              pathGlobs: [],
              commitish: 'deadbeef1234567890',
            },
          },
        },
      },
    },
  });

  await prisma.signal.createMany({
    data: [
      {
        scopeId: SEED.measuredScopeId,
        type: 'audit_gap',
        value: 0.85,
        confidence: 0.7,
        evidence: {
          sinceDate: SEED.auditPublishedAt.toISOString(),
          files: ['src/Pool.sol', 'src/Router.sol', 'README.md'],
          changedLoc: 420,
          totalLoc: 1000,
        },
        observationIds: [],
        computedAt: SEED.createdAt,
      },
      {
        scopeId: SEED.measuredScopeId,
        type: 'freshness',
        value: 0.4,
        confidence: 1,
        evidence: {},
        observationIds: [],
        computedAt: SEED.createdAt,
      },
      {
        scopeId: SEED.assumedScopeId,
        type: 'audit_gap',
        value: 1,
        confidence: 0.25,
        evidence: { reason: 'no_public_audit' },
        observationIds: [],
        computedAt: SEED.createdAt,
      },
      {
        scopeId: SEED.sherlockScopeId,
        type: 'audit_gap',
        value: 0.55,
        confidence: 0.7,
        evidence: {
          sinceDate: '2026-01-01T00:00:00.000Z',
          files: ['contracts/Vault.sol'],
          changedLoc: 200,
          totalLoc: 800,
        },
        observationIds: [],
        computedAt: SEED.createdAt,
      },
      {
        scopeId: SEED.sherlockScopeId,
        type: 'freshness',
        value: 0.2,
        confidence: 1,
        evidence: {},
        observationIds: [],
        computedAt: SEED.createdAt,
      },
    ],
  });
}

/**
 * Five paid submissions on the already-seeded Zephyr Perps scope (measured
 * audit gap + freshness live above), with varied signal snapshots so the
 * payout correlation panel has enough of an audit_gap sample (>=5) to leave
 * "unstable" while freshness (only present on three rows) stays below the
 * floor and keeps showing the insufficient-samples banner.
 */
export async function seedOutcomes(prisma: PrismaClient): Promise<void> {
  await prisma.outcome.createMany({
    data: [
      {
        id: 'e2e-outcome-1',
        scopeId: SEED.measuredScopeId,
        action: 'submit',
        submittedAt: new Date('2026-07-01T10:00:00.000Z'),
        result: 'accepted',
        payoutUsd: 12_000,
        notes: 'First payout on record.',
        signalSnapshot: {
          audit_gap: { value: 0.2, confidence: 0.7 },
          freshness: { value: 0.1, confidence: 0.9 },
        },
      },
      {
        id: 'e2e-outcome-2',
        scopeId: SEED.measuredScopeId,
        action: 'submit',
        submittedAt: new Date('2026-07-06T10:00:00.000Z'),
        result: 'duplicate',
        payoutUsd: 5_000,
        notes: null,
        signalSnapshot: {
          audit_gap: { value: 0.3, confidence: 0.5 },
        },
      },
      {
        id: 'e2e-outcome-3',
        scopeId: SEED.measuredScopeId,
        action: 'scan',
        submittedAt: new Date('2026-07-11T10:00:00.000Z'),
        result: 'accepted',
        payoutUsd: 28_000,
        notes: 'Escalated after triage.',
        signalSnapshot: {
          audit_gap: { value: 0.45, confidence: 0.65 },
          freshness: { value: 0.3, confidence: 0.9 },
        },
      },
      {
        id: 'e2e-outcome-4',
        scopeId: SEED.measuredScopeId,
        action: 'submit',
        submittedAt: new Date('2026-07-16T10:00:00.000Z'),
        result: 'accepted',
        payoutUsd: 41_000,
        notes: null,
        signalSnapshot: {
          audit_gap: { value: 0.6, confidence: 0.8 },
        },
      },
      {
        id: 'e2e-outcome-5',
        scopeId: SEED.measuredScopeId,
        action: 'submit',
        submittedAt: new Date('2026-07-21T10:00:00.000Z'),
        result: 'accepted',
        payoutUsd: 63_000,
        notes: 'Largest payout to date.',
        signalSnapshot: {
          audit_gap: { value: 0.85, confidence: 0.9 },
          freshness: { value: 0.6, confidence: 0.9 },
        },
      },
    ],
  });
}
