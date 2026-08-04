import { PrismaClient } from '@kritt-radar/db';
import type { Weights } from '@kritt-radar/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOutcome } from '../src/lib/outcome-mutations.js';
import { listOutcomesPage } from '../src/lib/outcomes.js';
import { withSafeIntegrationDatabase } from '../../worker/tests/integration-database.js';

const prisma = new PrismaClient();
const expectedDatabaseName =
  process.env.KRITT_RADAR_INTEGRATION_DATABASE ?? 'kritt_radar_integration';
let safeDatabaseValidated = false;

const weights: Weights = {
  version: 'test',
  minConfidence: 0.5,
  weights: { audit_gap: 1, freshness: 1, competition: 1, value_at_risk: 1 },
};

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
        prisma.outcome.deleteMany(),
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

async function createFixtureScope(): Promise<{ scopeId: string }> {
  await prisma.entity.create({
    data: {
      id: 'entity-aave',
      slug: 'entity-aave',
      canonicalName: 'Aave',
      programs: {
        create: {
          id: 'program-aave',
          platform: 'immunefi',
          externalId: 'program-aave',
          title: 'Aave V3',
          url: 'https://programs.example/aave-v3',
          kind: 'bounty',
          scopes: {
            create: {
              id: 'scope-aave',
              kind: 'repo',
              hardKey: 'github.com/aave/aave-v3-origin',
              pathGlobs: [],
              signals: {
                create: [
                  {
                    id: 'signal-audit-gap',
                    type: 'audit_gap',
                    value: 0.7,
                    confidence: 0.9,
                    evidence: {},
                    observationIds: [],
                  },
                ],
              },
            },
          },
        },
      },
    },
  });
  return { scopeId: 'scope-aave' };
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

describe('createOutcome', () => {
  it('freezes the signal snapshot from the scope at submission time', async () => {
    const { scopeId } = await createFixtureScope();

    const result = await createOutcome(prisma, {
      scopeId,
      action: 'submit',
      result: 'accepted',
      submittedAt: new Date('2026-08-04T12:00:00.000Z'),
      payoutUsd: 1500,
      notes: 'Paid promptly',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.outcome.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored.signalSnapshot).toEqual({
      audit_gap: { value: 0.7, confidence: 0.9 },
    });

    // Mutate the live signal after the outcome was recorded.
    await prisma.signal.update({
      where: { id: 'signal-audit-gap' },
      data: { value: 0.1, confidence: 0.2 },
    });

    const afterMutation = await prisma.outcome.findUniqueOrThrow({ where: { id: result.id } });
    expect(afterMutation.signalSnapshot).toEqual({
      audit_gap: { value: 0.7, confidence: 0.9 },
    });
  });

  it('returns not-found for a missing scope', async () => {
    const result = await createOutcome(prisma, {
      scopeId: 'missing-scope',
      action: 'submit',
      result: 'accepted',
      submittedAt: new Date('2026-08-04T12:00:00.000Z'),
      payoutUsd: null,
      notes: null,
    });

    expect(result).toEqual({ ok: false, message: 'Scope not found.' });
  });
});

describe('listOutcomesPage', () => {
  it('returns the created row joined with program identity and a matching correlation sample', async () => {
    const { scopeId } = await createFixtureScope();
    await createOutcome(prisma, {
      scopeId,
      action: 'submit',
      result: 'accepted',
      submittedAt: new Date('2026-08-04T12:00:00.000Z'),
      payoutUsd: 1500,
      notes: 'Paid promptly',
    });

    const page = await listOutcomesPage(prisma, weights, 'all');

    expect(page.resultFilter).toBe('all');
    expect(page.minConfidence).toBe(0.5);
    expect(page.outcomes).toHaveLength(1);
    expect(page.outcomes[0]).toMatchObject({
      scopeId,
      title: 'Aave V3',
      platform: 'immunefi',
      action: 'submit',
      result: 'accepted',
      submittedAt: '2026-08-04T12:00:00.000Z',
      payoutUsd: 1500,
      notes: 'Paid promptly',
    });
    expect(page.scopeOptions).toContainEqual({
      id: scopeId,
      title: 'Aave V3',
      platform: 'immunefi',
    });
    expect(page.correlation.bySignal.audit_gap?.sampleSize).toBe(1);
  });

  it('filters the history by result while leaving other outcomes out of the shown rows', async () => {
    const { scopeId } = await createFixtureScope();
    await createOutcome(prisma, {
      scopeId,
      action: 'submit',
      result: 'accepted',
      submittedAt: new Date('2026-08-04T12:00:00.000Z'),
      payoutUsd: 1500,
      notes: null,
    });
    await createOutcome(prisma, {
      scopeId,
      action: 'submit',
      result: 'invalid',
      submittedAt: new Date('2026-08-03T12:00:00.000Z'),
      payoutUsd: null,
      notes: null,
    });

    const all = await listOutcomesPage(prisma, weights, 'all');
    expect(all.outcomes).toHaveLength(2);

    const accepted = await listOutcomesPage(prisma, weights, 'accepted');
    expect(accepted.outcomes).toHaveLength(1);
    expect(accepted.outcomes[0]).toMatchObject({ result: 'accepted' });
  });

  it('excludes signals below minConfidence from the correlation sample', async () => {
    const { scopeId } = await createFixtureScope();
    await prisma.signal.update({
      where: { id: 'signal-audit-gap' },
      data: { confidence: 0.1 },
    });
    await createOutcome(prisma, {
      scopeId,
      action: 'submit',
      result: 'accepted',
      submittedAt: new Date('2026-08-04T12:00:00.000Z'),
      payoutUsd: 1500,
      notes: null,
    });

    const page = await listOutcomesPage(prisma, weights, 'all');

    expect(page.correlation.bySignal.audit_gap?.sampleSize).toBe(0);
  });
});
