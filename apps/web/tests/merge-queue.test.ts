import type { PrismaClient } from '@kritt-radar/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionForm } from '../src/app/merge-queue/decision-form.js';
import { parseDecisionForm } from '../src/app/merge-queue/decision-parser.js';
import {
  inferCandidateRoles,
  listMergeQueue,
  parseQueueStatus,
  type QueueEntity,
} from '../src/lib/merge-queue.js';

const provisional: QueueEntity = {
  id: 'provisional',
  slug: 'provisional-aave',
  canonicalName: 'Aave v3 review',
  provisional: true,
  auditReportCount: 1,
  projectHints: ['aave-v3-review'],
  auditFirms: ['Trail of Bits'],
  programCount: 0,
  platforms: [],
  programTitles: [],
  repoScopes: [],
};

const canonical: QueueEntity = {
  id: 'canonical',
  slug: 'aave-v3',
  canonicalName: 'Aave v3',
  provisional: false,
  auditReportCount: 0,
  projectHints: [],
  auditFirms: [],
  programCount: 1,
  platforms: ['immunefi'],
  programTitles: ['Aave V3'],
  repoScopes: ['github.com/aave/aave-v3-origin'],
};

describe('merge queue read model', () => {
  it('defaults unsupported queue-status filters to pending', () => {
    expect(parseQueueStatus(undefined)).toBe('pending');
    expect(parseQueueStatus('approved')).toBe('approved');
    expect(parseQueueStatus('garbage')).toBe('pending');
  });

  it('makes the sole provisional entity the source and blocks ambiguous pairs', () => {
    const roles = inferCandidateRoles(provisional, canonical);
    expect(roles.source?.id).toBe(provisional.id);
    expect(roles.target?.id).toBe(canonical.id);
    expect(inferCandidateRoles(provisional, { ...provisional, id: 'another-provisional' }).blockedReason)
      .toContain('exactly one provisional');
  });

  it('serializes finite reason scores and timestamps at the Prisma boundary', async () => {
    const prisma = {
      mergeCandidate: {
        findMany: async () => [{
          id: 'malformed-score',
          status: 'pending',
          similarity: 0.92,
          reason: { tokenJaccard: 'not-a-number' },
          createdAt: new Date('2026-08-03T12:00:00.000Z'),
          decidedAt: null,
          leftEntity: {
            id: provisional.id,
            slug: provisional.slug,
            canonicalName: provisional.canonicalName,
            auditReports: [{ projectHint: 'aave-v3-review', firm: 'Trail of Bits' }],
            programs: [],
          },
          rightEntity: {
            id: canonical.id,
            slug: canonical.slug,
            canonicalName: canonical.canonicalName,
            auditReports: [],
            programs: [{
              platform: 'immunefi',
              title: 'Aave V3',
              scopes: [{ kind: 'repo', hardKey: 'github.com/aave/aave-v3-origin' }],
            }],
          },
        }],
        groupBy: async () => [{ status: 'pending', _count: { _all: 1 } }],
      },
    } as unknown as PrismaClient;

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({
      tokenJaccard: null,
      editSimilarity: null,
      createdAt: '2026-08-03T12:00:00.000Z',
    });
    expect(Number.isNaN(page.candidates[0]!.tokenJaccard)).toBe(false);
    expect(Number.isNaN(page.candidates[0]!.editSimilarity)).toBe(false);
  });
});

function decisionForm(candidateId: FormDataEntryValue, action: FormDataEntryValue): FormData {
  const formData = new FormData();
  formData.set('candidateId', candidateId);
  formData.set('action', action);
  return formData;
}

describe('merge decision form parsing', () => {
  it('rejects a form with missing decision fields', () => {
    expect(parseDecisionForm(new FormData())).toEqual({
      ok: false,
      message: 'Missing candidate decision.',
    });
  });

  it.each(['approve', 'reject', 'reopen'] as const)('accepts a valid %s decision', (action) => {
    expect(parseDecisionForm(decisionForm('candidate-1', action))).toEqual({
      ok: true,
      value: { candidateId: 'candidate-1', action },
    });
  });

  it('rejects an unsupported decision action', () => {
    expect(parseDecisionForm(decisionForm('candidate-1', 'delete'))).toEqual({
      ok: false,
      message: 'Invalid candidate decision.',
    });
  });

  it.each(['', '   '])('rejects an empty candidate ID %j', (candidateId) => {
    expect(parseDecisionForm(decisionForm(candidateId, 'approve'))).toEqual({
      ok: false,
      message: 'Invalid candidate decision.',
    });
  });

  it.each(['candidateId', 'action'] as const)('rejects repeated %s fields', (field) => {
    const formData = decisionForm('candidate-1', 'approve');
    formData.append(field, field === 'candidateId' ? 'candidate-2' : 'reject');

    expect(parseDecisionForm(formData)).toEqual({
      ok: false,
      message: 'Invalid candidate decision.',
    });
  });

  it.each(['candidateId', 'action'] as const)('rejects non-text %s fields', (field) => {
    const formData = decisionForm('candidate-1', 'approve');
    formData.set(field, new File(['not text'], 'decision.txt', { type: 'text/plain' }));

    expect(parseDecisionForm(formData)).toEqual({
      ok: false,
      message: 'Invalid candidate decision.',
    });
  });
});

describe('merge decision controls', () => {
  it('keeps rejection independent from the required approval confirmation', () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionForm, {
        candidate: {
          id: 'candidate-1',
          status: 'pending',
          similarity: 0.84,
          tokenJaccard: 0.8,
          editSimilarity: 0.88,
          createdAt: '2026-08-04T00:00:00.000Z',
          decidedAt: null,
          source: provisional,
          target: canonical,
          approvable: true,
          blockedReason: null,
        },
      }),
    );
    const forms = [...markup.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([formMarkup]) => formMarkup);
    const approvalForm = forms.find((formMarkup) => formMarkup.includes('value="approve"'));
    const rejectionForm = forms.find((formMarkup) => formMarkup.includes('value="reject"'));

    expect(forms).toHaveLength(2);
    expect(approvalForm).toContain('type="checkbox"');
    expect(approvalForm).toContain('required=""');
    expect(rejectionForm).not.toContain('type="checkbox"');
    expect(rejectionForm).not.toContain('required=""');
  });
});
