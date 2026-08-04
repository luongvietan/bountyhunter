import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type RawObservation } from '../types.js';

const PROTOCOLS_URL = 'https://api.llama.fi/protocols';

const RawProtocol = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tvl: z.number().finite().positive(),
  chains: z.array(z.string()).default([]),
});

export interface DefillamaTvlPayload {
  slug: string;
  name: string;
  tvlUsd: number;
  chains: string[];
}

export function parseDefillamaProtocols(
  raw: unknown,
): RawObservation<DefillamaTvlPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<DefillamaTvlPayload>[] = [];
  for (const item of raw) {
    const parsed = RawProtocol.safeParse(item);
    if (!parsed.success) continue;
    const slug = parsed.data.slug.trim().toLowerCase();
    const payload: DefillamaTvlPayload = {
      slug,
      name: parsed.data.name,
      tvlUsd: parsed.data.tvl,
      chains: parsed.data.chains,
    };
    out.push(
      makeObservation('defillama-tvl', `https://api.llama.fi/protocol/${slug}`, payload),
    );
  }
  return out;
}

export const defillamaTvl: Collector<DefillamaTvlPayload> = {
  id: 'defillama-tvl',
  cadence: '0 */6 * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(ctx) {
    const raw = await fetchJson<unknown>(PROTOCOLS_URL, { limit: this.rateLimit });
    const items = parseDefillamaProtocols(raw);
    if (items.length === 0) {
      throw new Error('defillama-tvl: parsed 0 protocols from HTTP 200 body');
    }
    yield* items;
  },
};
