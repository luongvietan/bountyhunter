import type { Collector, RawObservation } from './types.js';

export interface HarnessDeps {
  env: Record<string, string | undefined>;
  save: (items: RawObservation[]) => Promise<number>;
  now?: () => Date;
}

export interface CollectorRunResult {
  collectorId: string;
  status: 'ok' | 'error' | 'skipped';
  itemCount: number;
  error?: string;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Chạy một collector và luôn TRẢ VỀ kết quả, không bao giờ ném.
 * Một nguồn hỏng không được phép làm chết cả lượt thu thập — nếu ném, collector
 * đứng sau nó trong danh sách sẽ không bao giờ chạy.
 */
export async function runCollector(
  collector: Collector,
  deps: HarnessDeps,
): Promise<CollectorRunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const base = { collectorId: collector.id, startedAt };

  if (collector.requiresCredential && !deps.env[collector.requiresCredential]) {
    return {
      ...base,
      status: 'skipped',
      itemCount: 0,
      error: `missing credential ${collector.requiresCredential}`,
      finishedAt: now(),
    };
  }

  const buffer: RawObservation[] = [];
  try {
    for await (const obs of collector.fetch({ env: deps.env, now })) {
      buffer.push(obs);
    }
    const saved = await deps.save(buffer);
    return { ...base, status: 'ok', itemCount: saved, finishedAt: now() };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      itemCount: 0,
      error: err instanceof Error ? err.message : String(err),
      finishedAt: now(),
    };
  }
}
