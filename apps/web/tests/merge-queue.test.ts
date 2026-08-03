import type { PrismaClient } from '@kritt-radar/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionForm } from '../src/app/merge-queue/decision-form.js';
import { CandidateCard } from '../src/app/merge-queue/candidate-card.js';
import { parseDecisionForm } from '../src/app/merge-queue/decision-parser.js';
import { isDatabaseSetupError } from '../src/app/merge-queue/database-setup.js';
import {
  inferCandidateRoles,
  listMergeQueue,
  parseQueueStatus,
  type QueueCandidate,
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
  newestReport: null,
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
  newestReport: null,
};

function candidate(overrides: Partial<QueueCandidate> = {}): QueueCandidate {
  return {
    id: 'candidate-1',
    status: 'pending',
    similarity: 0.84,
    tokenJaccard: 0.8,
    editSimilarity: 0.88,
    approvalEvidence: null,
    normalizedAliasCount: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    decidedAt: null,
    source: provisional,
    target: canonical,
    approvable: true,
    blockedReason: null,
    ...overrides,
  };
}

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
            auditReports: [
              {
                id: 'report-1',
                projectHint: ' AAVE-V3-Review ',
                firm: 'Trail of Bits',
                publishedAt: new Date('2026-08-01T00:00:00.000Z'),
                reportUrl: 'https://reports.example/report-1',
              },
              {
                id: 'report-2',
                projectHint: 'aave-v3-review',
                firm: 'OpenZeppelin',
                publishedAt: new Date('2026-07-31T00:00:00.000Z'),
                reportUrl: 'https://reports.example/report-2',
              },
            ],
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
      entityAlias: {
        findMany: async () => [],
      },
    } as unknown as PrismaClient;

    const page = await listMergeQueue(prisma, 'pending');

    expect(page.candidates[0]).toMatchObject({
      tokenJaccard: null,
      editSimilarity: null,
      createdAt: '2026-08-03T12:00:00.000Z',
      normalizedAliasCount: 1,
    });
    expect(Number.isNaN(page.candidates[0]!.tokenJaccard)).toBe(false);
    expect(Number.isNaN(page.candidates[0]!.editSimilarity)).toBe(false);
  });
});

function decisionForm(candidateId: FormDataEntryValue, action: FormDataEntryValue): FormData {
  const formData = new FormData();
  formData.set('candidateId', candidateId);
  formData.set('action', action);
  if (action === 'approve') formData.set('confirmed', 'on');
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

  it('rejects approval without a server-visible confirmation', () => {
    const formData = decisionForm('candidate-1', 'approve');
    formData.delete('confirmed');

    expect(parseDecisionForm(formData)).toEqual({
      ok: false,
      message: 'Confirm the candidate identities before approval.',
    });
  });

  it.each(['repeated', 'non-text'] as const)('rejects %s approval confirmation', (kind) => {
    const formData = decisionForm('candidate-1', 'approve');
    if (kind === 'repeated') formData.append('confirmed', 'on');
    else formData.set('confirmed', new File(['on'], 'confirmation.txt'));

    expect(parseDecisionForm(formData)).toEqual({
      ok: false,
      message: 'Invalid approval confirmation.',
    });
  });

  it.each(['reject', 'reopen'] as const)('does not require confirmation for %s', (action) => {
    const formData = decisionForm('candidate-1', action);

    expect(parseDecisionForm(formData)).toEqual({
      ok: true,
      value: { candidateId: 'candidate-1', action },
    });
  });
});

describe('merge decision controls', () => {
  it('keeps rejection independent from the required approval confirmation', () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionForm, {
        candidate: candidate(),
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

  it('renders the normalized alias count instead of distinct raw hint count', () => {
    const markup = renderToStaticMarkup(createElement(DecisionForm, {
      candidate: candidate({
        normalizedAliasCount: 1,
        source: {
          ...provisional,
          projectHints: [' AAVE-V3-Review ', 'aave-v3-review'],
          auditReportCount: 2,
        },
      }),
    }));

    expect(markup).toContain('Approval creates 1 manual audit alias');
    expect(markup).not.toContain('Approval creates 2 manual audit aliases');
  });

  it('hides approval and renders the precise safety banner for a blocked candidate', () => {
    const markup = renderToStaticMarkup(createElement(CandidateCard, {
      candidate: candidate({
        approvable: false,
        blockedReason: 'Provisional entity has no audit reports to merge.',
      }),
    }));

    expect(markup).not.toContain('Approve match');
    expect(markup).toContain('Approval blocked');
    expect(markup).toContain('Provisional entity has no audit reports to merge.');
  });

  it('renders newest audit report provenance with a durable URL and date', () => {
    const newestReport = {
      firm: 'OpenZeppelin',
      projectHint: 'aave-v3-security',
      publishedAt: '2026-07-03T00:00:00.000Z',
      reportUrl: 'https://reports.example/aave-z',
    };
    const markup = renderToStaticMarkup(createElement(CandidateCard, {
      candidate: candidate({ source: { ...provisional, newestReport } }),
    }));

    expect(markup).toContain('href="https://reports.example/aave-z"');
    expect(markup).toContain('OpenZeppelin');
    expect(markup).toContain('Jul 3, 2026');
  });

  it('renders the persisted affected count and provenance in approved history', () => {
    const newestReport = {
      firm: 'OpenZeppelin',
      projectHint: 'aave-v3-security',
      publishedAt: '2026-07-03T00:00:00.000Z',
      reportUrl: 'https://reports.example/aave-z',
    };
    const markup = renderToStaticMarkup(createElement(CandidateCard, {
      candidate: candidate({
        status: 'approved',
        decidedAt: '2026-08-04T08:00:00.000Z',
        approvable: false,
        approvalEvidence: {
          reportsMoved: 3,
          aliasKeys: ['aave-v3-review', 'aave-v3-security'],
          newestReport,
        },
      }),
    }));

    expect(markup).toContain('3 reports moved');
    expect(markup).toContain('2 manual aliases');
    expect(markup).toContain('href="https://reports.example/aave-z"');
    expect(markup).toContain('Jul 3, 2026');
  });
});

describe('database setup errors', () => {
  it('classifies a missing-table P2021 without exposing database details', () => {
    expect(isDatabaseSetupError({ code: 'P2021' }, 'postgresql://configured')).toBe(true);
    expect(isDatabaseSetupError({ code: 'P2002' }, 'postgresql://configured')).toBe(false);
  });

  it('treats a missing database URL as setup state', () => {
    expect(isDatabaseSetupError(new Error('not connected'), undefined)).toBe(true);
  });
});
