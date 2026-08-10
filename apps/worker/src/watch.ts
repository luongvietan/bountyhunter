import type { PrismaClient } from '@kritt-radar/db';
import { KrittClient } from '@kritt-radar/pipeline';
import { formatIngest, ingestFindings } from './ingest.js';
import { recordOpsEvent } from './ops-event.js';
import { formatRetry, retryFailedDispatches, type RetryConfig } from './retry.js';

export interface WatchOptions {
  intervalMs?: number;
  maxIterations?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldContinueWatching(running: number, pendingRetry: number): boolean {
  return running > 0 || pendingRetry > 0;
}

/**
 * Poll ingest while scans are still running on Kritt. Exits when nothing is
 * in flight and no failed row remains eligible for auto-retry.
 */
export async function watchScans(
  prisma: PrismaClient,
  client: KrittClient,
  config: RetryConfig,
  options: WatchOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? Number(process.env.KRITT_WATCH_INTERVAL_MS ?? 30_000);
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const ingestResult = await ingestFindings(prisma, client);
    const retryResult = await retryFailedDispatches(prisma, client, config);

    await recordOpsEvent(prisma, 'watch', 'ok', undefined, {
      iteration,
      ingest: ingestResult,
      retry: retryResult,
    });

    console.log(formatIngest(ingestResult));
    if (retryResult.attempted > 0) console.log(formatRetry(retryResult));

    const [running, pendingRetry] = await Promise.all([
      prisma.scanDispatch.count({ where: { status: 'running' } }),
      prisma.scanDispatch.count({ where: { status: 'error', retryCount: { lt: 2 } } }),
    ]);

    if (!shouldContinueWatching(running, pendingRetry)) break;
    if (iteration + 1 >= maxIterations) break;

    await sleep(intervalMs);
  }
}
