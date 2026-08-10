const SUCCESS_TERMINAL = new Set(['completed', 'complete', 'finished', 'done']);

const FAILED_TERMINAL = new Set([
  'failed',
  'error',
  'stopped',
  'cancelled',
  'canceled',
]);

/** Kritt statuses that mean the scan is still in flight or waiting on quota. */
export const STILL_RUNNING_STATUSES = new Set([
  'queued',
  'pending',
  'prewarming_cache',
  'running',
  'post_processing',
  'rate_limited',
  'paused',
]);

export type KrittScanPhase = 'success' | 'failed' | 'running';

export function classifyKrittScanStatus(status: string): KrittScanPhase {
  const normalized = status.trim().toLowerCase();
  if (SUCCESS_TERMINAL.has(normalized)) return 'success';
  if (FAILED_TERMINAL.has(normalized)) return 'failed';
  return 'running';
}

export function isTerminalKrittScanStatus(status: string): boolean {
  const phase = classifyKrittScanStatus(status);
  return phase === 'success' || phase === 'failed';
}
