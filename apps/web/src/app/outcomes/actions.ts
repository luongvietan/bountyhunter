'use server';

import { prisma } from '@kritt-radar/db';
import { revalidatePath } from 'next/cache';
import { createOutcome, recordOutcomeResult } from '../../lib/outcome-mutations';
import { parseOutcomeForm } from './outcome-parser';
import { parseOutcomeResultForm } from './outcome-result-parser';

export interface OutcomeActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

export async function submitOutcome(
  _previous: OutcomeActionState,
  formData: FormData,
): Promise<OutcomeActionState> {
  const parsed = parseOutcomeForm(formData);
  if (!parsed.ok) return { status: 'error', message: parsed.message };

  try {
    const result = await createOutcome(prisma, parsed.value);
    if (!result.ok) return { status: 'error', message: result.message };

    revalidatePath('/outcomes');
    return { status: 'success', message: 'Outcome recorded.' };
  } catch (error) {
    console.error('Unexpected outcome submission failure.', error);
    return {
      status: 'error',
      message: 'The outcome could not be saved. Check the server log and try again.',
    };
  }
}

/**
 * Settle an outcome a submitted finding opened. This is what turns the review
 * queue into a training sample: until a result lands here, correlation has the
 * signals but not the payout they were supposed to predict.
 */
export async function settleOutcome(
  _previous: OutcomeActionState,
  formData: FormData,
): Promise<OutcomeActionState> {
  const parsed = parseOutcomeResultForm(formData);
  if (!parsed.ok) return { status: 'error', message: parsed.message };

  try {
    const result = await recordOutcomeResult(prisma, parsed.value);
    if (!result.ok) return { status: 'error', message: result.message };

    revalidatePath('/outcomes');
    revalidatePath('/findings');
    return { status: 'success', message: `Recorded ${parsed.value.result}.` };
  } catch (error) {
    console.error('Unexpected outcome settlement failure.', error);
    return {
      status: 'error',
      message: 'The result could not be saved. Check the server log and try again.',
    };
  }
}
