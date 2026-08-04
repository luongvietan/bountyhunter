import { describe, expect, it } from 'vitest';
import {
  extractValueAtRiskBatch,
  nearestRankPercentile,
} from '../src/extractors/value-at-risk.js';

describe('nearestRankPercentile', () => {
  it('uses ceil(p*n)-1 nearest-rank', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRankPercentile(xs, 0.95)).toBe(10);
  });
});

describe('extractValueAtRiskBatch', () => {
  const inputs = [
    { scopeId: 'a', poolUsd: 1000, tvlUsd: null as number | null, defillamaSlug: null as string | null },
    { scopeId: 'b', poolUsd: null, tvlUsd: 1_000_000, defillamaSlug: 'uni' },
    { scopeId: 'c', poolUsd: null, tvlUsd: null, defillamaSlug: null },
    { scopeId: 'd', poolUsd: 50_000_000, tvlUsd: 10, defillamaSlug: 'big' },
  ];

  it('marks missing dollars as confidence 0', () => {
    const map = extractValueAtRiskBatch(inputs);
    expect(map.get('c')).toMatchObject({
      type: 'value_at_risk',
      confidence: 0,
      evidence: { reason: 'no_pool_or_tvl' },
    });
  });

  it('uses max(pool, tvl) and clamps at p95', () => {
    const map = extractValueAtRiskBatch(inputs);
    expect(map.get('d')!.value).toBe(1);
    expect(map.get('d')!.confidence).toBe(1);
    expect(map.get('d')!.evidence.basis).toBe('both');
    expect(map.get('a')!.value).toBeGreaterThan(0);
    expect(map.get('a')!.value).toBeLessThan(1);
    expect(map.get('b')!.evidence.basis).toBe('tvl');
  });

  it('is deterministic on the same batch', () => {
    const a = extractValueAtRiskBatch(inputs).get('a')!.value;
    const b = extractValueAtRiskBatch(inputs).get('a')!.value;
    expect(a).toBe(b);
  });
});
