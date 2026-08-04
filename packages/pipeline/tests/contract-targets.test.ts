import { describe, expect, it } from 'vitest';
import { buildContractTargets } from '../src/contract-targets.js';

describe('buildContractTargets', () => {
  it('normalizes, deduplicates, and drops invalid contract targets', () => {
    expect(
      buildContractTargets([
        {
          chain: 'Ethereum',
          address: '0x0000000000000000000000000000000000000AbC',
        },
        {
          chain: 'ethereum',
          address: '0x0000000000000000000000000000000000000abc',
        },
        { chain: 'ethereum', address: 'not-an-address' },
        { chain: null, address: null },
      ]),
    ).toEqual([
      {
        chain: 'ethereum',
        address: '0x0000000000000000000000000000000000000abc',
      },
    ]);
  });
});
