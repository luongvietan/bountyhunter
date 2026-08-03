'use server';

import { prisma } from '@kritt-radar/db';
import { revalidatePath } from 'next/cache';
import {
  decideMergeCandidate,
  type MergeDecisionResult,
} from '../../lib/merge-decisions';
import { parseDecisionForm } from './decision-parser';

export interface DecisionActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

function successMessage(result: Extract<MergeDecisionResult, { ok: true }>): string {
  if (result.action === 'approve') {
    const reportLabel = result.reportsMoved === 1 ? 'report' : 'reports';
    const siblingLabel = result.siblingsRejected === 1 ? 'candidate' : 'candidates';
    return `Approved match. ${result.reportsMoved} audit ${reportLabel} moved; ${result.siblingsRejected} competing ${siblingLabel} rejected.`;
  }
  return result.action === 'reject'
    ? 'Rejected match. Entity evidence was left unchanged.'
    : 'Reopened match for review.';
}

export async function submitMergeDecision(
  _previous: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState> {
  const parsed = parseDecisionForm(formData);
  if (!parsed.ok) return { status: 'error', message: parsed.message };

  try {
    const result = await decideMergeCandidate(prisma, parsed.value);
    if (!result.ok) return { status: 'error', message: result.message };

    revalidatePath('/merge-queue');
    return { status: 'success', message: successMessage(result) };
  } catch (error) {
    console.error('Unexpected merge decision failure.', error);
    return {
      status: 'error',
      message: 'The decision could not be saved. Check the server log and try again.',
    };
  }
}
