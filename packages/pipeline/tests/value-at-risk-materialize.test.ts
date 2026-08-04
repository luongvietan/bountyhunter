import { describe, expect, it } from 'vitest';
import { buildValueAtRiskInputs } from '../src/value-at-risk-materialize.js';

describe('buildValueAtRiskInputs', () => {
  it('joins scope dollars with protocol TVL by DefiLlama slug', () => {
    expect(
      buildValueAtRiskInputs(
        [
          { scopeId: 's1', poolUsd: 100, defillamaSlug: 'uniswap' },
          { scopeId: 's2', poolUsd: null, defillamaSlug: null },
        ],
        new Map([['uniswap', 999]]),
      ),
    ).toEqual([
      { scopeId: 's1', poolUsd: 100, tvlUsd: 999, defillamaSlug: 'uniswap' },
      { scopeId: 's2', poolUsd: null, tvlUsd: null, defillamaSlug: null },
    ]);
  });
});
