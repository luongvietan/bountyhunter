import { describe, expect, it } from 'vitest';
import { contentHash, makeObservation } from '../src/types.js';

describe('contentHash', () => {
  it('ổn định bất kể thứ tự khoá', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it('đổi khi nội dung đổi', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('xử lý được mảng lồng nhau', () => {
    expect(contentHash({ xs: [1, { y: 2 }] })).toBe(contentHash({ xs: [1, { y: 2 }] }));
  });
});

describe('makeObservation', () => {
  it('gắn collectorId, sourceUrl và hash', () => {
    const o = makeObservation('c4-contests', 'https://example.com/a', { id: 1 });
    expect(o.collectorId).toBe('c4-contests');
    expect(o.sourceUrl).toBe('https://example.com/a');
    expect(o.contentHash).toBe(contentHash({ id: 1 }));
  });

  it('keeps payload hashing independent from observation health', () => {
    const payload = { id: 1 };
    const healthy = makeObservation('snapshot', 'https://example.com/repo', payload, {
      ok: true,
    });
    const failed = makeObservation('snapshot', 'https://example.com/repo', payload, {
      ok: false,
      error: 'temporary failure',
    });

    expect(healthy.contentHash).toBe(failed.contentHash);
    expect(healthy.health).toEqual({ ok: true });
    expect(failed.health).toEqual({ ok: false, error: 'temporary failure' });
  });
});
