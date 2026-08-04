import type { PrismaClient } from '@kritt-radar/db';

export interface DefillamaObservationRow {
  id: string;
  fetchedAt: Date;
  payload: { slug: string; name: string; tvlUsd: number; chains: string[] };
}

export interface ProtocolTvlRow {
  slug: string;
  name: string;
  tvlUsd: number;
  chains: string[];
  observationId: string;
  fetchedAt: Date;
}

export function planProtocolTvlUpserts(
  rows: readonly DefillamaObservationRow[],
): ProtocolTvlRow[] {
  const best = new Map<string, ProtocolTvlRow>();
  for (const row of rows) {
    const slug = row.payload.slug.trim().toLowerCase();
    if (!slug || !(row.payload.tvlUsd > 0)) continue;
    const next: ProtocolTvlRow = {
      slug,
      name: row.payload.name,
      tvlUsd: row.payload.tvlUsd,
      chains: row.payload.chains,
      observationId: row.id,
      fetchedAt: row.fetchedAt,
    };
    const prev = best.get(slug);
    if (!prev || prev.fetchedAt.getTime() <= next.fetchedAt.getTime()) best.set(slug, next);
  }
  return [...best.values()];
}

export async function materializeProtocolTvl(prisma: PrismaClient): Promise<number> {
  const observations = await prisma.observation.findMany({
    where: { collectorId: 'defillama-tvl' },
    orderBy: { fetchedAt: 'asc' },
    select: { id: true, fetchedAt: true, payload: true },
  });
  const planned = planProtocolTvlUpserts(
    observations.map((observation) => ({
      id: observation.id,
      fetchedAt: observation.fetchedAt,
      payload: observation.payload as DefillamaObservationRow['payload'],
    })),
  );
  for (const row of planned) {
    await prisma.protocolTvl.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        name: row.name,
        tvlUsd: row.tvlUsd,
        chains: row.chains,
        observationId: row.observationId,
        fetchedAt: row.fetchedAt,
      },
      update: {
        name: row.name,
        tvlUsd: row.tvlUsd,
        chains: row.chains,
        observationId: row.observationId,
        fetchedAt: row.fetchedAt,
      },
    });
  }
  return planned.length;
}
