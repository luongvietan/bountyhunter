export interface SnapshotSignal {
  value: number;
  confidence: number;
}

export interface OutcomeCorrRow {
  payoutUsd: number | null;
  signals: Record<string, SnapshotSignal | undefined>;
}

export interface TertileBucket {
  label: 'low' | 'mid' | 'high';
  count: number;
  avgPayoutUsd: number | null;
}

export interface SignalCorrelation {
  sampleSize: number;
  unstable: boolean;
  pearson: number | null;
  spearman: number | null;
  tertiles: TertileBucket[];
}

export interface CorrelationReport {
  bySignal: Record<string, SignalCorrelation>;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j < indexed.length && indexed[j]!.v === indexed[i]!.v) j += 1;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k += 1) ranks[indexed[k]!.i] = avg;
    i = j;
  }
  return ranks;
}

function tertiles(xs: number[], ys: number[]): TertileBucket[] {
  if (xs.length < 3) {
    return [
      { label: 'low', count: 0, avgPayoutUsd: null },
      { label: 'mid', count: 0, avgPayoutUsd: null },
      { label: 'high', count: 0, avgPayoutUsd: null },
    ];
  }
  const order = xs.map((v, i) => ({ v, y: ys[i]! })).sort((a, b) => a.v - b.v);
  const n = order.length;
  const cuts = [Math.floor(n / 3), Math.floor((2 * n) / 3)];
  const groups: number[][] = [[], [], []];
  order.forEach((row, idx) => {
    const bucket = idx < cuts[0]! ? 0 : idx < cuts[1]! ? 1 : 2;
    groups[bucket]!.push(row.y);
  });
  const labels: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];
  return labels.map((label, i) => {
    const g = groups[i]!;
    return {
      label,
      count: g.length,
      avgPayoutUsd: g.length ? mean(g) : null,
    };
  });
}

export function correlateOutcomes(
  rows: readonly OutcomeCorrRow[],
  signalTypes: readonly string[],
  minConfidence: number,
): CorrelationReport {
  const bySignal: Record<string, SignalCorrelation> = {};
  for (const type of signalTypes) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const row of rows) {
      if (row.payoutUsd == null || !Number.isFinite(row.payoutUsd)) continue;
      const sig = row.signals[type];
      if (!sig || sig.confidence < minConfidence) continue;
      xs.push(sig.value);
      ys.push(row.payoutUsd);
    }
    bySignal[type] = {
      sampleSize: xs.length,
      unstable: xs.length < 5,
      pearson: pearson(xs, ys),
      spearman: xs.length ? pearson(rank(xs), rank(ys)) : null,
      tertiles: tertiles(xs, ys),
    };
  }
  return { bySignal };
}
