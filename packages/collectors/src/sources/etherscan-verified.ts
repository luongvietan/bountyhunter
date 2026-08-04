import { normalizeChainAddress } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import {
  makeObservation,
  type Collector,
  type FetchCtx,
  type RawObservation,
} from '../types.js';

const CHAIN_IDS: Readonly<Record<string, number>> = {
  ethereum: 1,
  mainnet: 1,
  optimism: 10,
  bsc: 56,
  gnosis: 100,
  polygon: 137,
  fantom: 250,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  linea: 59144,
  scroll: 534352,
};

const rateLimit = { rps: 0.2, burst: 1 };

export interface ContractTarget {
  chain: string;
  address: string;
}

export interface EtherscanVerifiedPayload {
  chain: string;
  address: string;
  verified: boolean;
  contractName: string | null;
  compiler: string | null;
  sourceUrl: string;
}

type EtherscanRequestOptions = Parameters<typeof fetchJson>[1];
export type EtherscanJsonFetcher = (
  url: string,
  options: EtherscanRequestOptions,
) => Promise<unknown>;

const defaultEtherscanJsonFetcher: EtherscanJsonFetcher = (url, options) =>
  fetchJson<unknown>(url, options);

export function chainIdFor(chain: string): number | null {
  return CHAIN_IDS[chain.trim().toLowerCase()] ?? null;
}

export function parseEtherscanSource(
  chain: string,
  address: string,
  raw: unknown,
): EtherscanVerifiedPayload | null {
  const hardKey = normalizeChainAddress(chain, address);
  if (!hardKey) return null;

  const separator = hardKey.indexOf(':');
  const normalizedChain = hardKey.slice(0, separator);
  const normalizedAddress = hardKey.slice(separator + 1);
  const result = (raw as { result?: unknown } | null)?.result;
  const row = Array.isArray(result) ? result[0] : null;
  if (!row || typeof row !== 'object') return null;

  const sourceCode = String((row as { SourceCode?: unknown }).SourceCode ?? '');
  const verified = sourceCode.trim().length > 0;
  const chainId = chainIdFor(normalizedChain);
  const sourceUrl = chainId === null
    ? `etherscan:unmapped:${hardKey}`
    : `https://api.etherscan.io/v2/api?chainid=${chainId}` +
      `&module=contract&action=getsourcecode&address=${normalizedAddress}`;

  return {
    chain: normalizedChain,
    address: normalizedAddress,
    verified,
    contractName: verified
      ? String((row as { ContractName?: unknown }).ContractName ?? '') || null
      : null,
    compiler: verified
      ? String((row as { CompilerVersion?: unknown }).CompilerVersion ?? '') || null
      : null,
    sourceUrl,
  };
}

export function makeEtherscanVerified(
  listTargets: () => Promise<ContractTarget[]>,
  requestJson: EtherscanJsonFetcher = defaultEtherscanJsonFetcher,
): Collector<EtherscanVerifiedPayload> {
  return {
    id: 'etherscan-verified',
    cadence: '0 */12 * * *',
    rateLimit,
    requiresCredential: 'ETHERSCAN_API_KEY',
    async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<EtherscanVerifiedPayload>> {
      const apiKey = ctx.env.ETHERSCAN_API_KEY;
      const targets = await listTargets();

      for (const target of targets) {
        const chainId = chainIdFor(target.chain);
        if (chainId === null) continue;

        const hardKey = normalizeChainAddress(target.chain, target.address);
        if (!hardKey) continue;
        const address = hardKey.slice(hardKey.indexOf(':') + 1);
        const requestUrl =
          `https://api.etherscan.io/v2/api?chainid=${chainId}` +
          `&module=contract&action=getsourcecode&address=${address}` +
          `&apikey=${encodeURIComponent(apiKey ?? '')}`;
        const raw = await requestJson(requestUrl, { limit: rateLimit });
        const payload = parseEtherscanSource(target.chain, address, raw);
        if (!payload) continue;

        yield makeObservation('etherscan-verified', payload.sourceUrl, payload);
      }
    },
  };
}
