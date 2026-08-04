import { describe, expect, it } from 'vitest';
import { score } from '../src/scoring.js';
import type { SignalValue } from '../src/signals.js';
import type { Weights } from '../src/scoring.js';

/** Three signals carry weight; competition is not implemented and carries none. */
const W: Weights = {
  version: 'test-1',
  minConfidence: 0.3,
  weights: { audit_gap: 1, freshness: 1, competition: 0, value_at_risk: 1 },
};

const sig = (type: SignalValue['type'], value: number, confidence = 1): SignalValue => ({
  type,
  value,
  confidence,
  evidence: {},
});

const all = (value: number, confidence = 1): SignalValue[] => [
  sig('audit_gap', value, confidence),
  sig('freshness', value, confidence),
  sig('value_at_risk', value, confidence),
];

describe('score', () => {
  it('luôn nằm trong [0,100]', () => {
    expect(score(all(1), W).total).toBe(100);
    expect(score(all(0), W).total).toBe(0);
    expect(score(all(5), W).total).toBe(100);
    expect(score(all(-5), W).total).toBe(0);
  });

  it('chỉ đạt trần khi đo được toàn bộ thang điểm', () => {
    expect(score(all(1), W).coverage).toBe(1);
    expect(score(all(1), W).total).toBe(100);
  });

  it('BẤT BIẾN: một tín hiệu duy nhất KHÔNG thể đạt trần', () => {
    // 1425 scope thật chỉ có một tín hiệu. Bản chuẩn hoá-lại cho chúng 100 điểm
    // và đẩy chúng lên trên những target được đo bằng cả ba.
    const one = score([sig('value_at_risk', 1)], W);
    expect(one.total).toBeCloseTo(100 / 3, 6);
    expect(one.coverage).toBeCloseTo(1 / 3, 6);
  });

  it('BẤT BIẾN: đo được ba thứ thắng đo được một thứ, dù giá trị thấp hơn', () => {
    const measuredThree = score(
      [sig('audit_gap', 0.5), sig('freshness', 0.5), sig('value_at_risk', 0.5)],
      W,
    );
    const measuredOne = score([sig('value_at_risk', 1)], W);
    expect(measuredThree.total).toBeGreaterThan(measuredOne.total);
  });

  it('BẤT BIẾN: tín hiệu confidence=0 không làm đổi tổng điểm', () => {
    const a = score(all(1), W);
    const b = score([...all(1), sig('competition', 1, 0)], W);
    expect(b.total).toBe(a.total);
    expect(b.skipped).toEqual(['competition']);
  });

  it('tín hiệu trọng số 0 không chặn trần điểm', () => {
    // competition chưa được cài đặt; nếu nó ăn trọng số thì mọi target đều bị
    // chặn ở 75 vì một phép đo không tồn tại.
    expect(score(all(1), W).total).toBe(100);
  });

  it('đơn điệu tăng theo từng giá trị tín hiệu', () => {
    const lo = score([sig('audit_gap', 0.2), sig('freshness', 0.5)], W).total;
    const hi = score([sig('audit_gap', 0.9), sig('freshness', 0.5)], W).total;
    expect(hi).toBeGreaterThan(lo);
  });

  it('confidence thấp làm giảm cả đóng góp lẫn độ phủ', () => {
    const confident = score(all(1, 1), W);
    const shaky = score(all(1, 0.35), W);
    expect(shaky.total).toBeLessThan(confident.total);
    expect(shaky.coverage).toBeLessThan(confident.coverage);
  });

  it('bằng chứng đo được thắng phỏng đoán dù phỏng đoán có value cao hơn', () => {
    const measured = score(
      [sig('audit_gap', 0.83, 0.7), sig('freshness', 0.24, 1), sig('value_at_risk', 0.5, 1)],
      W,
    );
    const guessed = score(
      [sig('audit_gap', 1, 0.35), sig('freshness', 0.01, 1), sig('value_at_risk', 0.5, 1)],
      W,
    );
    expect(measured.total).toBeGreaterThan(guessed.total);
  });

  it('bỏ tín hiệu dưới ngưỡng minConfidence', () => {
    const r = score([sig('audit_gap', 1), sig('freshness', 1, 0.1)], W);
    expect(r.skipped).toEqual(['freshness']);
    expect(r.total).toBeCloseTo(100 / 3, 6);
  });

  it('không có tín hiệu dùng được thì điểm 0, độ phủ 0', () => {
    const r = score([sig('audit_gap', 1, 0)], W);
    expect(r.total).toBe(0);
    expect(r.usedSignals).toBe(0);
    expect(r.coverage).toBe(0);
  });

  it('breakdown cộng lại đúng bằng tổng', () => {
    const r = score([sig('audit_gap', 0.8), sig('freshness', 0.3), sig('value_at_risk', 0.6)], W);
    const sum = r.breakdown.reduce((a, b) => a + b.contribution, 0);
    expect(sum).toBeCloseTo(r.total, 6);
  });

  it('trọng số đã chuẩn hoá cộng lại bằng độ phủ, không phải bằng 1', () => {
    const r = score([sig('audit_gap', 0.4, 0.35), sig('freshness', 0.9, 1)], W);
    const sum = r.breakdown.reduce((a, b) => a + b.normalizedWeight, 0);
    expect(sum).toBeCloseTo(r.coverage, 6);
    expect(sum).toBeLessThan(1);
  });
});
