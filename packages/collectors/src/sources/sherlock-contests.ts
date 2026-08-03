import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const SHERLOCK_URL = 'https://mainnet-contest.sherlock.xyz/contests';

const RawContest = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  prize_pool: z.number().optional(),
  starts_at: z.number(),
  ends_at: z.number(),
  repo_urls: z.array(z.string()).optional(),
  status: z.string().optional(),
});

const SKIP_STATUSES = new Set(['DRAFT', 'CANCELLED']);

function toIso(epochSeconds: number): string | null {
  const d = new Date(epochSeconds * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function parseSherlockContests(raw: unknown): RawObservation<ProgramPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of raw) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) continue;

    const externalId = String(c.id);
    const firstRepo = c.repo_urls?.[0];
    const payload: ProgramPayload = {
      platform: 'sherlock',
      externalId,
      title: c.title,
      url: `https://audits.sherlock.xyz/contests/${externalId}`,
      poolUsd: c.prize_pool && c.prize_pool > 0 ? c.prize_pool : null,
      kind: 'contest',
      publishedAt: toIso(c.starts_at),
      startsAt: toIso(c.starts_at),
      endsAt: toIso(c.ends_at),
      repoUrl: firstRepo ? normalizeRepoUrl(firstRepo) : null,
      sponsor: null,
    };
    out.push(makeObservation('sherlock-contests', payload.url, payload));
  }
  return out;
}

export const sherlockContests: Collector<ProgramPayload> = {
  id: 'sherlock-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(SHERLOCK_URL, { limit: this.rateLimit });
    yield* parseSherlockContests(raw);
  },
};
