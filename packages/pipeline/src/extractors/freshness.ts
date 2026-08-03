import { clamp01, type SignalValue } from '@kritt-radar/core';

const HALF_LIFE_HOURS = 72;

export interface FreshnessInput {
  publishedAt?: Date | undefined;
  /** Thời điểm contentHash của scope đổi — dấu hiệu scope vừa được mở rộng. */
  scopeChangedAt?: Date | undefined;
}

/**
 * Phân rã mũ theo tuổi, chu kỳ 72h.
 * Lợi thế thời gian tan rất nhanh, nên hàm tuyến tính sẽ đánh giá quá cao một
 * program đã mở được hai tuần.
 */
export function extractFreshness(input: FreshnessInput, now: Date): SignalValue {
  const candidates: Array<{ at: Date; basis: string }> = [];
  if (input.publishedAt) candidates.push({ at: input.publishedAt, basis: 'published' });
  if (input.scopeChangedAt) candidates.push({ at: input.scopeChangedAt, basis: 'scope_changed' });

  if (candidates.length === 0) {
    return { type: 'freshness', value: 0, confidence: 0, evidence: { reason: 'no_date' } };
  }

  const newest = candidates.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
  const ageHours = (now.getTime() - newest.at.getTime()) / 3_600_000;
  const value = ageHours <= 0 ? 1 : clamp01(Math.exp(-ageHours / HALF_LIFE_HOURS));

  return {
    type: 'freshness',
    value,
    confidence: 1,
    evidence: { basis: newest.basis, at: newest.at.toISOString(), ageHours: Math.round(ageHours) },
  };
}
