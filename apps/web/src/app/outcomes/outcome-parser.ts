import { z } from 'zod';

const FormSchema = z.object({
  scopeId: z.string().min(1),
  action: z.enum(['scan', 'submit', 'note']),
  result: z.enum(['accepted', 'duplicate', 'invalid', 'pending']),
  submittedAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  payoutUsd: z.string().optional(),
  notes: z.string().optional(),
});

export type OutcomeFormValue = {
  scopeId: string;
  action: 'scan' | 'submit' | 'note';
  result: 'accepted' | 'duplicate' | 'invalid' | 'pending';
  submittedAt: Date;
  payoutUsd: number | null;
  notes: string | null;
};

export function parseOutcomeForm(
  formData: FormData,
): { ok: true; value: OutcomeFormValue } | { ok: false; message: string } {
  const parsed = FormSchema.safeParse({
    scopeId: formData.get('scopeId'),
    action: formData.get('action'),
    result: formData.get('result'),
    submittedAt: formData.get('submittedAt'),
    payoutUsd: formData.get('payoutUsd') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return { ok: false, message: 'Check the outcome fields and try again.' };
  const submittedAt = new Date(parsed.data.submittedAt);
  if (!Number.isFinite(submittedAt.getTime())) {
    return { ok: false, message: 'submittedAt must be a valid date.' };
  }
  let payoutUsd: number | null = null;
  if (parsed.data.payoutUsd != null && parsed.data.payoutUsd !== '') {
    const n = Number(parsed.data.payoutUsd);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'payoutUsd must be a non-negative number.' };
    payoutUsd = n;
  }
  return {
    ok: true,
    value: {
      scopeId: parsed.data.scopeId,
      action: parsed.data.action,
      result: parsed.data.result,
      submittedAt,
      payoutUsd,
      notes: parsed.data.notes?.trim() || null,
    },
  };
}
