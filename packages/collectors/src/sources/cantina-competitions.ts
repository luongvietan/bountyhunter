import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const CANTINA_URL = 'https://cantina.xyz/api/v0/competitions';

const RawCompetition = z.object({
  id: z.string(),
  name: z.string(),
  totalPrize: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  repositoryUrl: z.string().optional(),
  state: z.string().optional(),
});

const Envelope = z.object({ competitions: z.array(z.unknown()) });

const SKIP_STATES = new Set(['archived', 'draft']);

export function parseCantinaCompetitions(raw: unknown): RawObservation<ProgramPayload>[] {
  const env = Envelope.safeParse(raw);
  if (!env.success) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of env.data.competitions) {
    const parsed = RawCompetition.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.state && SKIP_STATES.has(c.state.toLowerCase())) continue;

    const payload: ProgramPayload = {
      platform: 'cantina',
      externalId: c.id,
      title: c.name,
      url: `https://cantina.xyz/competitions/${c.id}`,
      poolUsd: c.totalPrize && c.totalPrize > 0 ? c.totalPrize : null,
      kind: 'contest',
      publishedAt: c.startDate ?? null,
      startsAt: c.startDate ?? null,
      endsAt: c.endDate ?? null,
      repoUrl: c.repositoryUrl ? normalizeRepoUrl(c.repositoryUrl) : null,
      sponsor: null,
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
