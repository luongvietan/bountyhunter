import type { PrismaClient } from '@kritt-radar/db';
import type { OutcomeFormValue } from '../app/outcomes/outcome-parser';
import type { OutcomeResultValue } from '../app/outcomes/outcome-result-parser';

type SignalRow = { type: string; value: number; confidence: number };

/**
 * Freeze the signals as they stood when the work was submitted. Correlation
 * compares payouts against these, so a later re-score must not rewrite the
 * evidence a past decision was made on.
 */
function snapshotSignals(signals: readonly SignalRow[]): Record<string, { value: number; confidence: number }> {
  const snapshot: Record<string, { value: number; confidence: number }> = {};
  for (const signal of signals) {
    snapshot[signal.type] = { value: signal.value, confidence: signal.confidence };
  }
  return snapshot;
}

export async function createOutcome(prisma: PrismaClient, input: OutcomeFormValue) {
  const scope = await prisma.scope.findUnique({
    where: { id: input.scopeId },
    include: { signals: true },
  });
  if (!scope) return { ok: false as const, message: 'Scope not found.' };

  const row = await prisma.outcome.create({
    data: {
      scopeId: input.scopeId,
      action: input.action,
      submittedAt: input.submittedAt,
      result: input.result,
      payoutUsd: input.payoutUsd,
      notes: input.notes,
      signalSnapshot: snapshotSignals(scope.signals),
    },
  });
  return { ok: true as const, id: row.id };
}

/**
 * Open the outcome that a submitted finding will eventually settle into. It
 * starts `pending` because nobody knows yet whether the program pays: the point
 * is that the signal snapshot is taken now, while it still describes what the
 * decision was made on.
 */
export async function openOutcomeForFinding(
  prisma: PrismaClient,
  findingId: string,
  submittedAt: Date,
) {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: {
      outcome: { select: { id: true } },
      dispatch: { include: { scope: { include: { signals: true } } } },
    },
  });
  if (!finding) return { ok: false as const, message: 'That finding no longer exists.' };
  if (finding.outcome) return { ok: true as const, id: finding.outcome.id, created: false };

  const row = await prisma.outcome.create({
    data: {
      scopeId: finding.dispatch.scopeId,
      findingId: finding.id,
      action: 'submit',
      submittedAt,
      result: 'pending',
      notes: finding.title,
      signalSnapshot: snapshotSignals(finding.dispatch.scope.signals),
    },
  });
  return { ok: true as const, id: row.id, created: true };
}

/**
 * Settle an outcome. Only the result and payout move: the scope, the finding,
 * and the snapshot are what the row is evidence of and stay as recorded.
 */
export async function recordOutcomeResult(prisma: PrismaClient, input: OutcomeResultValue) {
  const existing = await prisma.outcome.findUnique({
    where: { id: input.outcomeId },
    select: { id: true },
  });
  if (!existing) return { ok: false as const, message: 'That outcome no longer exists.' };

  await prisma.outcome.update({
    where: { id: input.outcomeId },
    data: {
      result: input.result,
      // A duplicate or invalid submission pays nothing; storing a leftover
      // figure there would inflate every correlation drawn from this row.
      payoutUsd: input.result === 'accepted' ? input.payoutUsd : null,
      ...(input.notes === null ? {} : { notes: input.notes }),
    },
  });
  return { ok: true as const, id: input.outcomeId };
}
