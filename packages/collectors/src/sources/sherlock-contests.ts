import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const SHERLOCK_URL = 'https://mainnet-contest.sherlock.xyz/contests';
const MAX_PAGES = 20;

const RawContest = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  prize_pool: z.number().nullish(),
  rewards: z.number().nullish(),
  starts_at: z.number(),
  ends_at: z.number(),
  status: z.string().nullish(),
  private: z.boolean().nullish(),
});

/** Danh sách trả về trong envelope có phân trang, không phải mảng trần. */
const Envelope = z.object({
  items: z.array(z.unknown()),
  has_next: z.boolean().nullish(),
  next_page: z.number().nullish(),
});

const SKIP_STATUSES = new Set(['DRAFT', 'CANCELLED']);

function toIso(epochSeconds: number): string | null {
  const d = new Date(epochSeconds * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function parseSherlockContests(raw: unknown): RawObservation<ProgramPayload>[] {
  const env = Envelope.safeParse(raw);
  const items = env.success ? env.data.items : Array.isArray(raw) ? raw : [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of items) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) continue;
    // Contest private chỉ mở cho người được mời — xếp hạng nó là mục tiêu
    // không hành động được.
    if (c.private) continue;

    const externalId = String(c.id);
    const pool = c.prize_pool ?? c.rewards ?? null;
    const payload: ProgramPayload = {
      platform: 'sherlock',
      externalId,
      title: c.title,
      url: `https://audits.sherlock.xyz/contests/${externalId}`,
      poolUsd: pool && pool > 0 ? pool : null,
      kind: 'contest',
      publishedAt: toIso(c.starts_at),
      startsAt: toIso(c.starts_at),
      endsAt: toIso(c.ends_at),
      // Endpoint danh sách không kèm repo; phải lấy từ trang chi tiết (pha sau).
      repoUrl: null,
      sponsor: null,
    };
    out.push(makeObservation('sherlock-contests', payload.url, payload));
  }
  return out;
}

export function nextPage(raw: unknown): number | null {
  const env = Envelope.safeParse(raw);
  if (!env.success) return null;
  if (env.data.has_next === false) return null;
  return env.data.next_page ?? null;
}

export const sherlockContests: Collector<ProgramPayload> = {
  id: 'sherlock-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    let page: number | null = 1;
    for (let i = 0; i < MAX_PAGES && page !== null; i++) {
      const url = `${SHERLOCK_URL}?page=${page}`;
      const raw: unknown = await fetchJson<unknown>(url, { limit: this.rateLimit });
      yield* parseSherlockContests(raw);
      page = nextPage(raw);
    }
  },
};
