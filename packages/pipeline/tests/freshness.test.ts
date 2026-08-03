import { describe, expect, it } from 'vitest';
import { extractFreshness } from '../src/extractors/freshness.js';

const NOW = new Date('2026-08-03T00:00:00Z');

describe('extractFreshness', () => {
  it('mới publish thì gần 1', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-08-03T00:00:00Z') }, NOW);
    expect(s.value).toBeCloseTo(1, 3);
    expect(s.confidence).toBe(1);
  });

  it('sau đúng một chu kỳ bán rã 72h thì bằng exp(-1)', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-07-31T00:00:00Z') }, NOW);
    expect(s.value).toBeCloseTo(Math.exp(-1), 3);
  });

  it('giảm đơn điệu theo tuổi', () => {
    const a = extractFreshness({ publishedAt: new Date('2026-08-02T00:00:00Z') }, NOW).value;
    const b = extractFreshness({ publishedAt: new Date('2026-07-25T00:00:00Z') }, NOW).value;
    expect(a).toBeGreaterThan(b);
  });

  it('BẤT BIẾN: không có ngày thì confidence 0, KHÔNG phải value 0', () => {
    const s = extractFreshness({}, NOW);
    expect(s.confidence).toBe(0);
    expect(s.evidence.reason).toBe('no_date');
  });

  it('lấy mốc mới hơn giữa publishedAt và scopeChangedAt', () => {
    const s = extractFreshness(
      {
        publishedAt: new Date('2026-06-01T00:00:00Z'),
        scopeChangedAt: new Date('2026-08-02T00:00:00Z'),
      },
      NOW,
    );
    expect(s.value).toBeGreaterThan(0.6);
    expect(s.evidence.basis).toBe('scope_changed');
  });

  it('ngày trong tương lai vẫn kẹp ở 1', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-09-01T00:00:00Z') }, NOW);
    expect(s.value).toBe(1);
  });
});
