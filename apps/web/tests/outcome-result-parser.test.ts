import { describe, expect, it } from 'vitest';
import { parseOutcomeResultForm } from '../src/app/outcomes/outcome-result-parser';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe('parseOutcomeResultForm', () => {
  it('reads an accepted result and its payout', () => {
    const parsed = parseOutcomeResultForm(
      form({ outcomeId: 'o1', result: 'accepted', payoutUsd: '7500' }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: { outcomeId: 'o1', result: 'accepted', payoutUsd: 7500, notes: null },
    });
  });

  it('refuses an accepted result with no payout, which would read as a zero-value hit', () => {
    const parsed = parseOutcomeResultForm(form({ outcomeId: 'o1', result: 'accepted' }));
    expect(parsed).toEqual({ ok: false, message: 'An accepted outcome needs the payout it earned.' });
  });

  it('accepts duplicate and invalid without a payout', () => {
    for (const result of ['duplicate', 'invalid']) {
      const parsed = parseOutcomeResultForm(form({ outcomeId: 'o1', result }));
      expect(parsed.ok).toBe(true);
    }
  });

  it('rejects a negative payout', () => {
    const parsed = parseOutcomeResultForm(
      form({ outcomeId: 'o1', result: 'accepted', payoutUsd: '-1' }),
    );
    expect(parsed).toEqual({ ok: false, message: 'payoutUsd must be a non-negative number.' });
  });

  it('rejects an unknown result and a missing outcome', () => {
    expect(parseOutcomeResultForm(form({ outcomeId: 'o1', result: 'maybe' })).ok).toBe(false);
    expect(parseOutcomeResultForm(form({ result: 'invalid' })).ok).toBe(false);
  });

  it('leaves notes null when the field is blank, so a recorded note survives', () => {
    const parsed = parseOutcomeResultForm(form({ outcomeId: 'o1', result: 'invalid', notes: '  ' }));
    expect(parsed).toMatchObject({ ok: true, value: { notes: null } });
  });
});
