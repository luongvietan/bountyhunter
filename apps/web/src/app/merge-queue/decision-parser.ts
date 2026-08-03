import { z } from 'zod';
import type { MergeDecisionAction } from '../../lib/merge-decisions';

export type ParsedDecisionForm =
  | {
      ok: true;
      value: { candidateId: string; action: MergeDecisionAction };
    }
  | { ok: false; message: string };

const decisionSchema = z.object({
  candidateId: z.string().trim().min(1),
  action: z.enum(['approve', 'reject', 'reopen']),
});

export function parseDecisionForm(formData: FormData): ParsedDecisionForm {
  const candidateIds = formData.getAll('candidateId');
  const actions = formData.getAll('action');

  if (candidateIds.length === 0 || actions.length === 0) {
    return { ok: false, message: 'Missing candidate decision.' };
  }
  if (candidateIds.length !== 1 || actions.length !== 1) {
    return { ok: false, message: 'Invalid candidate decision.' };
  }

  const candidateId = candidateIds[0];
  const action = actions[0];
  if (typeof candidateId !== 'string' || typeof action !== 'string') {
    return { ok: false, message: 'Invalid candidate decision.' };
  }

  const parsed = decisionSchema.safeParse({ candidateId, action });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: 'Invalid candidate decision.' };
}
