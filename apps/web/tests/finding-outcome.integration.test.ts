import { PrismaClient } from '@kritt-radar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openOutcomeForFinding, recordOutcomeResult } from '../src/lib/outcome-mutations.js';
import { listFindingQueue } from '../src/lib/finding-queue.js';
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
        prisma.outcome.deleteMany(),
        prisma.finding.deleteMany(),
        prisma.scanDispatch.deleteMany(),
        prisma.score.deleteMany(),
        prisma.signal.deleteMany(),
        prisma.scope.deleteMany(),
        prisma.program.deleteMany(),
        prisma.entity.deleteMany(),
      ]);
    },
  );
}

async function createFixtureFinding(): Promise<{ findingId: string; scopeId: string }> {
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
              commitish: 'abc123',
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

  await prisma.scanDispatch.create({
    data: {
      id: 'dispatch-1',
      scopeId: 'scope-aave',
      repoKey: 'github.com/aave/aave-v3-origin',
      commitSha: 'abc123',
      status: 'complete',
      score: 42,
      krittScanId: '7',
    },
  });

  const finding = await prisma.finding.create({
    data: {
      dispatchId: 'dispatch-1',
      krittVulnId: '101',
      title: 'Reentrancy in withdraw lets a caller drain the vault',
      filePath: 'contracts/Vault.sol',
      explanation: 'The balance is written after the external call.',
      maliciousInput: 'withdraw(type(uint256).max)',
      exploitable: true,
      triggerFlow: [],
      pocDiff: 'diff --git a/test/Exploit.t.sol',
      krittReport: '# Reentrancy in withdraw',
      inScope: true,
      postScriptValid: true,
      raw: {},
    },
  });

  return { findingId: finding.id, scopeId: 'scope-aave' };
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

describe('openOutcomeForFinding', () => {
  it('opens a pending outcome carrying the scope signals as they stood', async () => {
    const { findingId, scopeId } = await createFixtureFinding();

    const opened = await openOutcomeForFinding(prisma, findingId, new Date('2026-08-04T12:00:00Z'));
    expect(opened).toMatchObject({ ok: true, created: true });
    if (!opened.ok) return;

    const stored = await prisma.outcome.findUniqueOrThrow({ where: { id: opened.id } });
    expect(stored.scopeId).toBe(scopeId);
    expect(stored.findingId).toBe(findingId);
    expect(stored.result).toBe('pending');
    expect(stored.action).toBe('submit');
    expect(stored.signalSnapshot).toEqual({ audit_gap: { value: 0.7, confidence: 0.9 } });
  });

  it('is idempotent, so re-marking a finding does not open a second outcome', async () => {
    const { findingId } = await createFixtureFinding();

    const first = await openOutcomeForFinding(prisma, findingId, new Date());
    const second = await openOutcomeForFinding(prisma, findingId, new Date());

    expect(second).toMatchObject({ ok: true, created: false });
    if (!first.ok || !second.ok) return;
    expect(second.id).toBe(first.id);
    expect(await prisma.outcome.count()).toBe(1);
  });

  it('reports a finding that no longer exists', async () => {
    expect(await openOutcomeForFinding(prisma, 'gone', new Date())).toEqual({
      ok: false,
      message: 'That finding no longer exists.',
    });
  });
});

describe('recordOutcomeResult', () => {
  it('settles an accepted outcome with its payout', async () => {
    const { findingId } = await createFixtureFinding();
    const opened = await openOutcomeForFinding(prisma, findingId, new Date());
    if (!opened.ok) throw new Error('fixture failed');

    await recordOutcomeResult(prisma, {
      outcomeId: opened.id,
      result: 'accepted',
      payoutUsd: 7500,
      notes: null,
    });

    const stored = await prisma.outcome.findUniqueOrThrow({ where: { id: opened.id } });
    expect(stored.result).toBe('accepted');
    expect(Number(stored.payoutUsd)).toBe(7500);
    // The note the queue wrote survives a settle that left the field blank.
    expect(stored.notes).toBe('Reentrancy in withdraw lets a caller drain the vault');
  });

  it('clears any payout on a duplicate, which earned nothing', async () => {
    const { findingId } = await createFixtureFinding();
    const opened = await openOutcomeForFinding(prisma, findingId, new Date());
    if (!opened.ok) throw new Error('fixture failed');

    await recordOutcomeResult(prisma, {
      outcomeId: opened.id,
      result: 'duplicate',
      payoutUsd: 7500,
      notes: 'Already reported by someone else',
    });

    const stored = await prisma.outcome.findUniqueOrThrow({ where: { id: opened.id } });
    expect(stored.result).toBe('duplicate');
    expect(stored.payoutUsd).toBeNull();
    expect(stored.notes).toBe('Already reported by someone else');
  });
});

describe('listFindingQueue', () => {
  it('carries the post-script output and the linked outcome into the queue', async () => {
    const { findingId } = await createFixtureFinding();
    await prisma.finding.update({ where: { id: findingId }, data: { status: 'submitted' } });
    const opened = await openOutcomeForFinding(prisma, findingId, new Date());
    if (!opened.ok) throw new Error('fixture failed');

    const page = await listFindingQueue(prisma, 'submitted');
    const [queued] = page.findings;

    expect(queued?.pocDiff).toBe('diff --git a/test/Exploit.t.sol');
    expect(queued?.krittReport).toBe('# Reentrancy in withdraw');
    expect(queued?.blockers).toEqual([]);
    expect(queued?.outcome).toEqual({ id: opened.id, result: 'pending', payoutUsd: null });
  });
});
