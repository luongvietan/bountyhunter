import { describe, expect, it } from 'vitest';
import { correlateOutcomes } from '../src/lib/outcome-correlation';

const rows = [
  { payoutUsd: 0, signals: { audit_gap: { value: 0.1, confidence: 1 } } },
  { payoutUsd: 100, signals: { audit_gap: { value: 0.5, confidence: 1 } } },
  { payoutUsd: 500, signals: { audit_gap: { value: 0.9, confidence: 1 } } },
  { payoutUsd: 50, signals: { audit_gap: { value: 0.4, confidence: 1 } } },
  { payoutUsd: 300, signals: { audit_gap: { value: 0.8, confidence: 1 } } },
];

describe('correlateOutcomes', () => {
  it('flags unstable when n < 5 after filters', () => {
    const r = correlateOutcomes(rows.slice(0, 3), ['audit_gap'], 0.05);
    expect(r.bySignal.audit_gap.sampleSize).toBe(3);
    expect(r.bySignal.audit_gap.unstable).toBe(true);
  });

  it('computes pearson/spearman and tertiles when n >= 5', () => {
    const r = correlateOutcomes(rows, ['audit_gap'], 0.05);
    expect(r.bySignal.audit_gap.unstable).toBe(false);
    expect(r.bySignal.audit_gap.pearson).toBeGreaterThan(0.5);
    expect(r.bySignal.audit_gap.tertiles).toHaveLength(3);
  });

  it('drops low-confidence and null payout', () => {
    const r = correlateOutcomes(
      [
        ...rows,
        { payoutUsd: null, signals: { audit_gap: { value: 1, confidence: 1 } } },
        { payoutUsd: 999, signals: { audit_gap: { value: 1, confidence: 0 } } },
      ],
      ['audit_gap'],
      0.05,
    );
    expect(r.bySignal.audit_gap.sampleSize).toBe(5);
  });
});
