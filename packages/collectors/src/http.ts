export interface RateLimit {
  rps: number;
  burst: number;
}

/** Token bucket theo từng host, để một collector chậm không kéo cả pipeline. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly limit: RateLimit) {
    this.tokens = limit.burst;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.limit.burst, this.tokens + elapsedSec * this.limit.rps);
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async take(): Promise<void> {
    while (!this.tryTake()) {
      await new Promise((r) => setTimeout(r, Math.ceil(1000 / this.limit.rps)));
    }
  }
}

const MAX_DELAY_MS = 60_000;

/**
 * Header Retry-After của máy chủ luôn thắng phép tính của ta — bỏ qua nó là
 * cách nhanh nhất để bị chặn IP. Không có thì backoff luỹ thừa có jitter.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS);
    }
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) {
      return Math.min(Math.max(at - Date.now(), 0), MAX_DELAY_MS);
    }
  }
  const base = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

export const USER_AGENT =
  'kritt-radar/0.1 (bug bounty target discovery; contact: luongvietan.231123@gmail.com)';

const buckets = new Map<string, TokenBucket>();

export async function fetchJson<T>(
  url: string,
  opts: { limit: RateLimit; headers?: Record<string, string>; maxAttempts?: number },
): Promise<T> {
  const host = new URL(url).host;
  let bucket = buckets.get(host);
  if (!bucket) {
    bucket = new TokenBucket(opts.limit);
    buckets.set(host, bucket);
  }

  const maxAttempts = opts.maxAttempts ?? 4;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await bucket.take();
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...opts.headers },
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) =>
          setTimeout(r, retryDelayMs(attempt, res.headers.get('retry-after'))),
        );
        lastError = new Error(`${res.status} ${res.statusText} for ${url}`);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt, null)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`fetch failed: ${url}`);
}
