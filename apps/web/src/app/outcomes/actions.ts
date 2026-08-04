'use server';

import { prisma } from '@kritt-radar/db';
import { revalidatePath } from 'next/cache';
import { createOutcome } from '../../lib/outcome-mutations';
import { parseOutcomeForm } from './outcome-parser';

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
