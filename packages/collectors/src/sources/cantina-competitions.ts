import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const CANTINA_URL = 'https://cantina.xyz/api/v0/competitions';

const RawCompetition = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullish(),
  status: z.string().nullish(),
  currencyCode: z.string().nullish(),
  totalRewardPot: z.union([z.string(), z.number()]).nullish(),
  timeframe: z.object({ start: z.string().nullish(), end: z.string().nullish() }).nullish(),
  company: z
    .object({ name: z.string().nullish(), github: z.string().nullish() })
    .nullish(),
});

const SKIP_STATES = new Set(['complete', 'archived', 'draft']);

/** totalRewardPot về dưới dạng chuỗi. Không đọc được thì null, không phải 0. */
function toPool(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseCantinaCompetitions(raw: unknown): RawObservation<ProgramPayload>[] {
  // API trả về mảng trần.
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { competitions?: unknown[] }).competitions)
      ? (raw as { competitions: unknown[] }).competitions
      : [];

  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of items) {
    const parsed = RawCompetition.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.status && SKIP_STATES.has(c.status.toLowerCase())) continue;

    const payload: ProgramPayload = {
      platform: 'cantina',
      externalId: c.id,
      title: c.name,
      url: c.url ?? `https://cantina.xyz/competitions/${c.id}`,
      poolUsd: toPool(c.totalRewardPot),
      kind: 'contest',
      publishedAt: c.timeframe?.start ?? null,
      startsAt: c.timeframe?.start ?? null,
      endsAt: c.timeframe?.end ?? null,
      // `company.github` là URL tổ chức chứ không phải repo, nên không dùng làm
      // scope. Repo thật nằm ở trang chi tiết (pha sau).
      repoUrl: c.company?.github ? normalizeRepoUrl(c.company.github) : null,
      sponsor: c.company?.name ?? null,
    };
    out.push(makeObservation('cantina-competitions', payload.url, payload));
  }
  return out;
}

export const cantinaCompetitions: Collector<ProgramPayload> = {
  id: 'cantina-competitions',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(CANTINA_URL, { limit: this.rateLimit });
    yield* parseCantinaCompetitions(raw);
  },
};
