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
  auditHint: 'zephyr-perps-security-review',
  repoKey: 'github.com/zephyr-fi/perps-core',
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
              id: 'e2e-scope',
              kind: 'repo',
              hardKey: SEED.repoKey,
              repoUrl: SEED.repoKey,
              pathGlobs: [],
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
              id: 'e2e-scope-other',
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
