import { describe, expect, it, vi } from 'vitest';
import { TokenBucket, retryDelayMs } from '../src/http.js';

describe('TokenBucket', () => {
  it('cho qua tới hạn burst rồi mới chặn', async () => {
    const b = new TokenBucket({ rps: 1000, burst: 3 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it('nạp lại token theo thời gian', () => {
    vi.useFakeTimers();
    const b = new TokenBucket({ rps: 10, burst: 1 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(b.tryTake()).toBe(true);
    vi.useRealTimers();
  });
});

describe('retryDelayMs', () => {
  it('ưu tiên Retry-After tính bằng giây', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
  });

  it('backoff luỹ thừa khi không có Retry-After', () => {
    const d0 = retryDelayMs(0, null);
    const d2 = retryDelayMs(2, null);
    expect(d2).toBeGreaterThan(d0);
  });

  it('có jitter nên hai lần gọi không bằng nhau', () => {
    const xs = new Set(Array.from({ length: 20 }, () => retryDelayMs(3, null)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('chặn trên ở 60 giây', () => {
    expect(retryDelayMs(50, null)).toBeLessThanOrEqual(60_000);
  });
});
