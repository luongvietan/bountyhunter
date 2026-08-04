import { describe, expect, it } from 'vitest';
import verified from './__fixtures__/etherscan-source-verified.json' with { type: 'json' };
import unverified from './__fixtures__/etherscan-source-unverified.json' with { type: 'json' };
import {
  chainIdFor,
  makeEtherscanVerified,
  parseEtherscanSource,
} from '../src/sources/etherscan-verified.js';

describe('chainIdFor', () => {
  it('maps ethereum and common L2s', () => {
    expect(chainIdFor('ethereum')).toBe(1);
    expect(chainIdFor('arbitrum')).toBe(42161);
  });

  it('returns null for unknown / solana', () => {
    expect(chainIdFor('solana')).toBeNull();
    expect(chainIdFor('something-new')).toBeNull();
  });
});

describe('parseEtherscanSource', () => {
  it('marks ABI present as verified', () => {
    const payload = parseEtherscanSource(
      'ethereum',
      '0x0000000000000000000000000000000000000AbC',
      verified,
    );
    expect(payload).toMatchObject({
      chain: 'ethereum',
      address: '0x0000000000000000000000000000000000000abc',
      verified: true,
    });
  });

  it('marks empty SourceCode as unverified', () => {
    const payload = parseEtherscanSource(
      'ethereum',
      '0x0000000000000000000000000000000000000AbC',
      unverified,
    );
    expect(payload?.verified).toBe(false);
  });
});

describe('makeEtherscanVerified', () => {
  it('skips unmapped chains and never stores the API key in sourceUrl', async () => {
    const requests: string[] = [];
    const collector = makeEtherscanVerified(
      async () => [
        { chain: 'solana', address: '11111111111111111111111111111111' },
        { chain: 'ethereum', address: '0x0000000000000000000000000000000000000AbC' },
      ],
      async (url) => {
        requests.push(url);
        return verified;
      },
    );

    const observations = [];
    for await (const observation of collector.fetch({
      env: { ETHERSCAN_API_KEY: 'etherscan-secret' },
      now: () => new Date('2026-08-04T00:00:00.000Z'),
    })) {
      observations.push(observation);
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('chainid=1');
    expect(requests[0]).toContain('apikey=etherscan-secret');
    expect(observations).toHaveLength(1);
    expect(observations[0]!.sourceUrl).not.toContain('etherscan-secret');
    expect(observations[0]!.sourceUrl).not.toContain('apikey=');
  });
});
