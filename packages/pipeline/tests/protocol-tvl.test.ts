import { describe, expect, it } from 'vitest';
import { planProtocolTvlUpserts } from '../src/protocol-tvl.js';

describe('planProtocolTvlUpserts', () => {
  it('keeps latest observation per slug', () => {
    const rows = planProtocolTvlUpserts([
      {
        id: 'old',
        fetchedAt: new Date('2026-08-01T00:00:00Z'),
        payload: { slug: 'uniswap', name: 'Uniswap', tvlUsd: 1, chains: ['Ethereum'] },
      },
      {
        id: 'new',
        fetchedAt: new Date('2026-08-02T00:00:00Z'),
        payload: { slug: 'uniswap', name: 'Uniswap', tvlUsd: 2, chains: ['Ethereum', 'Base'] },
      },
    ]);
    expect(rows).toEqual([
      {
        slug: 'uniswap',
        name: 'Uniswap',
        tvlUsd: 2,
        chains: ['Ethereum', 'Base'],
        observationId: 'new',
        fetchedAt: new Date('2026-08-02T00:00:00Z'),
      },
    ]);
  });
});
