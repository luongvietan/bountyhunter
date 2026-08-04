import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CorrelationPanel } from '../src/app/outcomes/correlation-panel.js';
import { OutcomeHistory } from '../src/app/outcomes/outcome-history.js';
import { parseOutcomeForm } from '../src/app/outcomes/outcome-parser.js';
import type { CorrelationReport, SignalCorrelation } from '../src/lib/outcome-correlation.js';
import { parseResultFilter } from '../src/lib/outcomes.js';

function outcomeForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const fields: Record<string, string> = {
    scopeId: 'scope-1',
    action: 'submit',
    result: 'accepted',
    submittedAt: '2026-08-04T12:00:00.000Z',
    payoutUsd: '1500',
    notes: 'Paid out promptly',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe('parseOutcomeForm', () => {
  it('accepts a complete valid outcome submission', () => {
    const result = parseOutcomeForm(outcomeForm());

    expect(result).toEqual({
      ok: true,
      value: {
        scopeId: 'scope-1',
        action: 'submit',
        result: 'accepted',
        submittedAt: new Date('2026-08-04T12:00:00.000Z'),
        payoutUsd: 1500,
        notes: 'Paid out promptly',
      },
    });
  });

  it('accepts a submission with no payout or notes', () => {
    const formData = outcomeForm();
    formData.delete('payoutUsd');
    formData.delete('notes');

    const result = parseOutcomeForm(formData);

    expect(result).toEqual({
      ok: true,
      value: {
        scopeId: 'scope-1',
        action: 'submit',
        result: 'accepted',
        submittedAt: new Date('2026-08-04T12:00:00.000Z'),
        payoutUsd: null,
        notes: null,
      },
    });
  });

  it('trims notes and treats blank notes as null', () => {
    const result = parseOutcomeForm(outcomeForm({ notes: '   ' }));

    expect(result).toMatchObject({ ok: true, value: { notes: null } });
  });

  it('rejects a missing scopeId', () => {
    const formData = outcomeForm();
    formData.delete('scopeId');

    expect(parseOutcomeForm(formData)).toEqual({
      ok: false,
      message: 'Check the outcome fields and try again.',
    });
  });

  it('rejects an unsupported action', () => {
    expect(parseOutcomeForm(outcomeForm({ action: 'delete' }))).toEqual({
      ok: false,
      message: 'Check the outcome fields and try again.',
    });
  });

  it('rejects an unsupported result', () => {
    expect(parseOutcomeForm(outcomeForm({ result: 'unknown' }))).toEqual({
      ok: false,
      message: 'Check the outcome fields and try again.',
    });
  });

  it('rejects an unparsable submittedAt', () => {
    const formData = outcomeForm({ submittedAt: 'not-a-date' });

    expect(parseOutcomeForm(formData)).toEqual({
      ok: false,
      message: 'submittedAt must be a valid date.',
    });
  });

  it('accepts a plain date string for submittedAt', () => {
    const result = parseOutcomeForm(outcomeForm({ submittedAt: '2026-08-04' }));

    expect(result).toMatchObject({ ok: true, value: { submittedAt: new Date('2026-08-04') } });
  });

  it('rejects a negative payoutUsd', () => {
    expect(parseOutcomeForm(outcomeForm({ payoutUsd: '-5' }))).toEqual({
      ok: false,
      message: 'payoutUsd must be a non-negative number.',
    });
  });

  it('rejects a non-numeric payoutUsd', () => {
    expect(parseOutcomeForm(outcomeForm({ payoutUsd: 'not-a-number' }))).toEqual({
      ok: false,
      message: 'payoutUsd must be a non-negative number.',
    });
  });

  it('accepts a zero payoutUsd', () => {
    const result = parseOutcomeForm(outcomeForm({ payoutUsd: '0' }));

    expect(result).toMatchObject({ ok: true, value: { payoutUsd: 0 } });
  });

  it('treats an empty payoutUsd string as null', () => {
    const result = parseOutcomeForm(outcomeForm({ payoutUsd: '' }));

    expect(result).toMatchObject({ ok: true, value: { payoutUsd: null } });
  });
});

describe('parseResultFilter', () => {
  it.each(['accepted', 'duplicate', 'invalid', 'pending', 'all'] as const)(
    'accepts %s as-is',
    (value) => {
      expect(parseResultFilter(value)).toBe(value);
    },
  );

  it('defaults undefined to all', () => {
    expect(parseResultFilter(undefined)).toBe('all');
  });

  it('defaults an unsupported value to all', () => {
    expect(parseResultFilter('garbage')).toBe('all');
  });

  it('defaults an array value to all', () => {
    expect(parseResultFilter(['accepted', 'duplicate'])).toBe('all');
  });
});

function unstableCorrelation(sampleSize = 3): SignalCorrelation {
  return {
    sampleSize,
    unstable: true,
    pearson: null,
    spearman: null,
    tertiles: [
      { label: 'low', count: 0, avgPayoutUsd: null },
      { label: 'mid', count: 0, avgPayoutUsd: null },
      { label: 'high', count: 0, avgPayoutUsd: null },
    ],
  };
}

function stableCorrelation(): SignalCorrelation {
  return {
    sampleSize: 6,
    unstable: false,
    pearson: 0.42,
    spearman: 0.5,
    tertiles: [
      { label: 'low', count: 2, avgPayoutUsd: 100 },
      { label: 'mid', count: 2, avgPayoutUsd: 400 },
      { label: 'high', count: 2, avgPayoutUsd: 1500 },
    ],
  };
}

describe('CorrelationPanel', () => {
  it('renders an insufficient-samples banner for an unstable signal', () => {
    const report: CorrelationReport = {
      bySignal: {
        audit_gap: unstableCorrelation(3),
        freshness: stableCorrelation(),
        competition: unstableCorrelation(0),
        value_at_risk: unstableCorrelation(0),
      },
    };

    const markup = renderToStaticMarkup(
      createElement(CorrelationPanel, { correlation: report, minConfidence: 0.5 }),
    );

    expect(markup).toContain('Insufficient samples');
    expect(markup).toContain('n=3');
  });

  it('renders formatted payout figures for a stable signal without the banner for that card', () => {
    const report: CorrelationReport = {
      bySignal: {
        audit_gap: stableCorrelation(),
        freshness: unstableCorrelation(0),
        competition: unstableCorrelation(0),
        value_at_risk: unstableCorrelation(0),
      },
    };

    const markup = renderToStaticMarkup(
      createElement(CorrelationPanel, { correlation: report, minConfidence: 0.5 }),
    );

    expect(markup).toContain('$1,500');
    expect(markup).toContain('$400');
    expect(markup).toContain('$100');
  });
});

describe('OutcomeHistory', () => {
  it('renders a payout figure and result chip for each recorded outcome', () => {
    const markup = renderToStaticMarkup(
      createElement(OutcomeHistory, {
        outcomes: [
          {
            id: 'outcome-1',
            scopeId: 'scope-1',
            title: 'Aave V3',
            platform: 'immunefi',
            action: 'submit',
            result: 'accepted',
            submittedAt: '2026-08-04T12:00:00.000Z',
            payoutUsd: 1500,
            notes: 'Paid promptly',
          },
        ],
      }),
    );

    expect(markup).toContain('$1,500');
    expect(markup).toContain('accepted');
    expect(markup).toContain('Aave V3');
  });

  it('renders an empty state when no outcomes are recorded', () => {
    const markup = renderToStaticMarkup(createElement(OutcomeHistory, { outcomes: [] }));

    expect(markup).toContain('No outcomes recorded');
  });
});
