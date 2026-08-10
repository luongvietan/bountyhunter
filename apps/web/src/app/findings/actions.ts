'use server';

import { prisma } from '@kritt-radar/db';
import { revalidatePath } from 'next/cache';
import { openOutcomeForFinding } from '../../lib/outcome-mutations';

export interface FindingDecisionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

const ALLOWED = new Set(['reviewed', 'submitted', 'dismissed', 'new']);

/**
 * Moves a finding through the queue. This records what the operator decided;
 * it does not contact a bounty platform. Submitting remains a deliberate act
 * performed by a person against the platform's own form.
 */
export async function decideFinding(
  _previous: FindingDecisionState,
  formData: FormData,
): Promise<FindingDecisionState> {
  const id = String(formData.get('findingId') ?? '').trim();
  const next = String(formData.get('status') ?? '').trim();

  if (!id) return { status: 'error', message: 'No finding was identified.' };
  if (!ALLOWED.has(next)) return { status: 'error', message: `Unknown decision "${next}".` };

  try {
    const existing = await prisma.finding.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return { status: 'error', message: 'That finding no longer exists.' };

    const decidedAt = new Date();
    const viewedAt = next === 'reviewed' || next === 'submitted' || next === 'dismissed' ? decidedAt : null;
    await prisma.finding.update({
      where: { id },
      data: {
        status: next,
        decidedAt: next === 'new' ? null : decidedAt,
        decidedBy: next === 'new' ? null : 'operator',
        viewedAt: next === 'new' ? null : viewedAt,
      },
    });
    revalidatePath('/findings');

    if (next !== 'submitted') return { status: 'success', message: `Marked ${next}.` };

    // Opening the outcome here is what closes the loop back onto the weights:
    // the signal snapshot has to be taken while it still describes the target
    // as it was when the operator decided to submit.
    const outcome = await openOutcomeForFinding(prisma, id, decidedAt);
    if (!outcome.ok) {
      return {
        status: 'success',
        message: 'Marked submitted, but no outcome was opened. Record one on the outcomes page.',
      };
    }
    revalidatePath('/outcomes');
    return {
      status: 'success',
      message: outcome.created
        ? 'Marked submitted. Record the payout or rejection on the outcomes page.'
        : 'Marked submitted. This finding already has an outcome.',
    };
  } catch (error) {
    console.error('Finding decision failed.', error);
    return { status: 'error', message: 'The decision could not be saved.' };
  }
}
