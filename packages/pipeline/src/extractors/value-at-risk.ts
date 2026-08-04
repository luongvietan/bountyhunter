import { clamp01, type SignalValue } from '@kritt-radar/core';

export interface ValueAtRiskInput {
  scopeId: string;
  poolUsd: number | null;
  tvlUsd: number | null;
  defillamaSlug: string | null;
}

export function nearestRankPercentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length) - 1;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank));
  return sortedAsc[idx]!;
}

export function extractValueAtRiskBatch(
  inputs: readonly ValueAtRiskInput[],
): Map<string, SignalValue> {
  const dollars = new Map<string, number>();
  for (const row of inputs) {
    const candidates = [row.poolUsd, row.tvlUsd].filter(
      (n): n is number => n != null && Number.isFinite(n) && n > 0,
    );
    if (candidates.length > 0) dollars.set(row.scopeId, Math.max(...candidates));
  }

  const raws = [...dollars.values()].map((d) => Math.log1p(d)).sort((a, b) => a - b);
  const ceiling = nearestRankPercentile(raws, 0.95);
  const out = new Map<string, SignalValue>();

  for (const row of inputs) {
    const d = dollars.get(row.scopeId);
    if (d == null || !(ceiling > 0)) {
      out.set(row.scopeId, {
        type: 'value_at_risk',
        value: 0,
        confidence: 0,
        evidence: { reason: d == null ? 'no_pool_or_tvl' : 'empty_p95_batch' },
      });
      continue;
    }
    const raw = Math.log1p(d);
    const hasPool = row.poolUsd != null && row.poolUsd > 0;
    const hasTvl = row.tvlUsd != null && row.tvlUsd > 0;
    const basis = hasPool && hasTvl ? 'both' : hasPool ? 'pool' : 'tvl';
    out.set(row.scopeId, {
      type: 'value_at_risk',
      value: clamp01(raw / ceiling),
      confidence: 1,
      evidence: {
        poolUsd: row.poolUsd,
        tvlUsd: row.tvlUsd,
        dollars: d,
        raw,
        ceiling,
        p95BatchSize: raws.length,
        defillamaSlug: row.defillamaSlug,
        basis,
      },
    });
  }
  return out;
}
