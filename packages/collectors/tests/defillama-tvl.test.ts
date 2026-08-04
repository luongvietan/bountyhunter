import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/defillama-protocols.json' with { type: 'json' };
import { parseDefillamaProtocols } from '../src/sources/defillama-tvl.js';

describe('parseDefillamaProtocols', () => {
  it('keeps protocols with slug and positive tvl', () => {
    const out = parseDefillamaProtocols(fixture);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      slug: 'uniswap',
      name: 'Uniswap',
      tvlUsd: 4123456789.12,
      chains: ['Ethereum', 'Arbitrum'],
    });
    expect(out[0]!.collectorId).toBe('defillama-tvl');
    expect(out[0]!.sourceUrl).toBe('https://api.llama.fi/protocol/uniswap');
  });

  it('returns empty array for non-array body', () => {
    expect(parseDefillamaProtocols({ not: 'array' })).toEqual([]);
  });
});
