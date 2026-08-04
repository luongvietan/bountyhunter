import { describe, expect, it } from 'vitest';
import { parseOutcomeForm } from '../src/app/outcomes/outcome-parser.js';
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
