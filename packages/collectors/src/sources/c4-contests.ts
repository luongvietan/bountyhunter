import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const C4_URL = 'https://code4rena.com/api/v1/audits?perPage=100&page=1';

const RawContest = z.object({
  contestId: z.union([z.number(), z.string()]),
  title: z.string(),
  slug: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  formattedAmount: z.string().nullish(),
  repo: z.string().optional(),
  org: z.object({ name: z.string().optional() }).optional(),
});

const RawResponse = z.object({
  data: z.object({ audits: z.array(z.unknown()) }),
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
  const response = RawResponse.safeParse(raw);
  if (!response.success) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of response.data.data.audits) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;

    const externalId = String(c.contestId);
    const payload: ProgramPayload = {
      platform: 'code4rena',
      externalId,
      title: c.title,
      url: `https://code4rena.com/audits/${c.slug}`,
      poolUsd: parsePoolUsd(c.formattedAmount ?? undefined),
      kind: 'contest',
      publishedAt: c.startTime,
      startsAt: c.startTime,
      endsAt: c.endTime,
      repoUrl: c.repo ? normalizeRepoUrl(c.repo) : null,
      sponsor: c.org?.name ?? null,
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
