import { z } from 'zod';

const FormSchema = z.object({
  outcomeId: z.string().min(1),
  result: z.enum(['accepted', 'duplicate', 'invalid', 'pending']),
  payoutUsd: z.string().optional(),
  notes: z.string().optional(),
});

export type OutcomeResultValue = {
  outcomeId: string;
  result: 'accepted' | 'duplicate' | 'invalid' | 'pending';
  payoutUsd: number | null;
  /** null leaves the recorded note alone rather than clearing it. */
  notes: string | null;
};

/**
 * Read the settle-an-outcome form. Separate from the record-an-outcome parser
 * because settling may not move the scope, the finding, or the submission date:
 * those are what the row is evidence of.
 */
export function parseOutcomeResultForm(
  formData: FormData,
): { ok: true; value: OutcomeResultValue } | { ok: false; message: string } {
  const parsed = FormSchema.safeParse({
    outcomeId: formData.get('outcomeId'),
    result: formData.get('result'),
    payoutUsd: formData.get('payoutUsd') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return { ok: false, message: 'Check the outcome fields and try again.' };

  let payoutUsd: number | null = null;
  if (parsed.data.payoutUsd != null && parsed.data.payoutUsd !== '') {
    const n = Number(parsed.data.payoutUsd);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: 'payoutUsd must be a non-negative number.' };
    }
    payoutUsd = n;
  }

  if (parsed.data.result === 'accepted' && payoutUsd === null) {
    return { ok: false, message: 'An accepted outcome needs the payout it earned.' };
  }

  return {
    ok: true,
    value: {
      outcomeId: parsed.data.outcomeId,
      result: parsed.data.result,
      payoutUsd,
      notes: parsed.data.notes?.trim() || null,
    },
  };
}
