import { normalizeRepoUrl } from '@kritt-radar/core';
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

const RawScopeEntry = z.object({
  repo: z.string().min(1),
  commit_hash: z.string().min(1),
  files: z.array(z.object({ name: z.string().min(1) })).optional(),
});

/** Danh sách trả về trong envelope có phân trang, không phải mảng trần. */
const Envelope = z.object({
  items: z.array(z.unknown()),
  has_next: z.boolean().nullish(),
  next_page: z.number().nullish(),
});

const SKIP_STATUSES = new Set(['DRAFT', 'CANCELLED']);

export interface SherlockScopeEntry {
  repoKey: string;
  commitHash: string;
  files: string[];
}

export interface SherlockProgramPayload extends ProgramPayload {
  platform: 'sherlock';
  scopes: SherlockScopeEntry[];
}

function toIso(epochSeconds: number): string | null {
  const d = new Date(epochSeconds * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normalizeSherlockRepo(repo: string): string | null {
  const trimmed = repo.trim();
  if (!trimmed) return null;
  if (trimmed.includes('://') || trimmed.startsWith('github.com/')) {
    return normalizeRepoUrl(trimmed);
  }
  return normalizeRepoUrl(`https://github.com/${trimmed}`);
}

export function parseSherlockScopes(detail: unknown): SherlockScopeEntry[] {
  const rawScope =
    typeof detail === 'object' && detail !== null
      ? (detail as { scope?: unknown }).scope
      : undefined;
  if (!Array.isArray(rawScope)) return [];

  const out: SherlockScopeEntry[] = [];
  for (const item of rawScope) {
    const parsed = RawScopeEntry.safeParse(item);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const repoKey = normalizeSherlockRepo(entry.repo);
    if (!repoKey) continue;
    out.push({
      repoKey,
      commitHash: entry.commit_hash,
      files: (entry.files ?? []).map((file) => file.name),
    });
  }
  return out;
}

/**
 * Gộp list item + detail thành payload đa-scope.
 * Trả null khi không có repo+commit hoặc không parse được mốc audit.
 */
export function buildSherlockPayload(
  listItem: unknown,
  detail: unknown,
): SherlockProgramPayload | null {
  const parsed = RawContest.safeParse(listItem);
  if (!parsed.success) return null;
  const c = parsed.data;
  if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) return null;
  if (c.private) return null;

  const scopes = parseSherlockScopes(detail);
  if (scopes.length === 0) return null;

  const endsAt = toIso(c.ends_at);
  const startsAt = toIso(c.starts_at);
  if (!endsAt && !startsAt) return null;

  const externalId = String(c.id);
  const pool = c.prize_pool ?? c.rewards ?? null;
  return {
    platform: 'sherlock',
    externalId,
    title: c.title,
    url: `https://audits.sherlock.xyz/contests/${externalId}`,
    poolUsd: pool && pool > 0 ? pool : null,
    kind: 'contest',
    publishedAt: startsAt,
    startsAt,
    endsAt,
    repoUrl: scopes[0]!.repoKey,
    sponsor: null,
    scopes,
  };
}

/** @deprecated Chỉ parse list; không có scope/commit. Dùng buildSherlockPayload trong fetch. */
export function parseSherlockContests(raw: unknown): RawObservation<ProgramPayload>[] {
  const env = Envelope.safeParse(raw);
  const items = env.success ? env.data.items : Array.isArray(raw) ? raw : [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of items) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) continue;
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

export const sherlockContests: Collector<SherlockProgramPayload> = {
  id: 'sherlock-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    let page: number | null = 1;
    for (let i = 0; i < MAX_PAGES && page !== null; i++) {
      const url = `${SHERLOCK_URL}?page=${page}`;
      const raw: unknown = await fetchJson<unknown>(url, { limit: this.rateLimit });
      const env = Envelope.safeParse(raw);
      const items = env.success ? env.data.items : [];

      for (const item of items) {
        const parsed = RawContest.safeParse(item);
        if (!parsed.success) continue;
        const c = parsed.data;
        if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) continue;
        if (c.private) continue;

        const externalId = String(c.id);
        const detail: unknown = await fetchJson<unknown>(`${SHERLOCK_URL}/${externalId}`, {
          limit: this.rateLimit,
        });
        const payload = buildSherlockPayload(c, detail);
        if (!payload) continue;
        yield makeObservation('sherlock-contests', payload.url, payload);
      }

      page = nextPage(raw);
    }
  },
};
