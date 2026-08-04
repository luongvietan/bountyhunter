import type { PrismaClient } from '@kritt-radar/db';
import type { OutcomeFormValue } from '../app/outcomes/outcome-parser';

export async function createOutcome(prisma: PrismaClient, input: OutcomeFormValue) {
  const scope = await prisma.scope.findUnique({
    where: { id: input.scopeId },
    include: { signals: true },
  });
  if (!scope) return { ok: false as const, message: 'Scope not found.' };

  const signalSnapshot: Record<string, { value: number; confidence: number }> = {};
  for (const s of scope.signals) {
    signalSnapshot[s.type] = { value: s.value, confidence: s.confidence };
  }

  const row = await prisma.outcome.create({
    data: {
      scopeId: input.scopeId,
      action: input.action,
      submittedAt: input.submittedAt,
      result: input.result,
      payoutUsd: input.payoutUsd,
      notes: input.notes,
      signalSnapshot,
    },
  });
  return { ok: true as const, id: row.id };
}
