'use server';

import { prisma } from '@kritt-radar/db';
import { revalidatePath } from 'next/cache';

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

    await prisma.finding.update({
      where: { id },
      data: { status: next, decidedAt: next === 'new' ? null : new Date() },
    });
    revalidatePath('/findings');
    return { status: 'success', message: `Marked ${next}.` };
  } catch (error) {
    console.error('Finding decision failed.', error);
    return { status: 'error', message: 'The decision could not be saved.' };
  }
}
