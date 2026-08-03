import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const C4_URL = 'https://code4rena.com/api/contests';

const RawContest = z.object({
  contestid: z.union([z.number(), z.string()]),
  title: z.string(),
  sponsor: z.string().optional(),
  start_time: z.string(),
  end_time: z.string(),
  amount: z.string().optional(),
  repo: z.string().optional(),
  hide: z.boolean().optional(),
});

export interface ProgramPayload {
  platform: string;
  externalId: string;
  title: string;
  url: string;
  poolUsd: number | null;
  kind: 'contest' | 'bounty';
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  repoUrl: string | null;
  sponsor: string | null;
}

/** "$100,000 USDC" -> 100000. Trả null khi không đọc được, KHÔNG trả 0. */
export function parsePoolUsd(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseC4Contests(raw: unknown): RawObservation<ProgramPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of raw) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.hide) continue;

    const externalId = String(c.contestid);
    const payload: ProgramPayload = {
      platform: 'code4rena',
      externalId,
      title: c.title,
      url: `https://code4rena.com/contests/${externalId}`,
      poolUsd: parsePoolUsd(c.amount),
      kind: 'contest',
      publishedAt: c.start_time,
      startsAt: c.start_time,
      endsAt: c.end_time,
      repoUrl: c.repo ? normalizeRepoUrl(c.repo) : null,
      sponsor: c.sponsor ?? null,
    };
    out.push(makeObservation('c4-contests', payload.url, payload));
  }
  return out;
}

export const c4Contests: Collector<ProgramPayload> = {
  id: 'c4-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(C4_URL, { limit: this.rateLimit });
    yield* parseC4Contests(raw);
  },
};
