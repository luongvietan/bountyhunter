import { createHash } from 'node:crypto';
import type { RateLimit } from './http.js';

export interface ObservationHealth {
  ok: boolean;
  error?: string;
}

export interface RawObservation<T = unknown> {
  collectorId: string;
  sourceUrl: string;
  payload: T;
  contentHash: string;
  health?: ObservationHealth;
}

export interface FetchCtx {
  /** Chỉ nạp secret từ env. Thiếu thì collector tự bỏ qua, không phải lỗi. */
  env: Record<string, string | undefined>;
  now: () => Date;
}

export interface Collector<T = unknown> {
  readonly id: string;
  readonly cadence: string;
  readonly rateLimit: RateLimit;
  /** Tên biến env bắt buộc. Thiếu thì harness bỏ qua collector này. */
  readonly requiresCredential?: string;
  fetch(ctx: FetchCtx): AsyncIterable<RawObservation<T>>;
}

/** Serialise ổn định để cùng nội dung luôn ra cùng hash bất kể thứ tự khoá. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}

export function contentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function makeObservation<T>(
  collectorId: string,
  sourceUrl: string,
  payload: T,
  health?: ObservationHealth,
): RawObservation<T> {
  return {
    collectorId,
    sourceUrl,
    payload,
    contentHash: contentHash(payload),
    ...(health ? { health } : {}),
  };
}
