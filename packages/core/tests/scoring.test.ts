import { describe, expect, it } from 'vitest';
import { score } from '../src/scoring.js';
import type { SignalValue } from '../src/signals.js';
import type { Weights } from '../src/scoring.js';

const W: Weights = {
  version: 'test-1',
  minConfidence: 0.3,
  weights: { audit_gap: 1, freshness: 1, competition: 1, value_at_risk: 1 },
};

const sig = (type: SignalValue['type'], value: number, confidence = 1): SignalValue => ({
  type,
  value,
  confidence,
  evidence: {},
});

describe('score', () => {
  it('luôn nằm trong [0,100]', () => {
    expect(score([sig('audit_gap', 1)], W).total).toBe(100);
    expect(score([sig('audit_gap', 0)], W).total).toBe(0);
    expect(score([sig('audit_gap', 5)], W).total).toBe(100);
    expect(score([sig('audit_gap', -5)], W).total).toBe(0);
  });

  it('BẤT BIẾN: tín hiệu confidence=0 không làm đổi tổng điểm', () => {
    const a = score([sig('audit_gap', 1)], W);
    const b = score([sig('audit_gap', 1), sig('competition', 0, 0)], W);
    expect(b.total).toBe(a.total);
    expect(b.skipped).toEqual(['competition']);
  });

  it('đơn điệu tăng theo từng giá trị tín hiệu', () => {
    const lo = score([sig('audit_gap', 0.2), sig('freshness', 0.5)], W).total;
    const hi = score([sig('audit_gap', 0.9), sig('freshness', 0.5)], W).total;
    expect(hi).toBeGreaterThan(lo);
  });

  it('chuẩn hoá lại trọng số trên các tín hiệu còn dùng được', () => {
    const r = score([sig('audit_gap', 1), sig('freshness', 0)], W);
    expect(r.total).toBeCloseTo(50, 6);
    expect(r.usedSignals).toBe(2);
  });

  it('bỏ tín hiệu dưới ngưỡng minConfidence', () => {
    const r = score([sig('audit_gap', 1), sig('freshness', 1, 0.1)], W);
    expect(r.skipped).toEqual(['freshness']);
    expect(r.total).toBe(100);
  });

  it('không có tín hiệu dùng được thì điểm 0 và usedSignals 0', () => {
    const r = score([sig('audit_gap', 1, 0)], W);
    expect(r.total).toBe(0);
    expect(r.usedSignals).toBe(0);
  });

  it('confidence thấp làm giảm đóng góp, không chỉ là cổng chặn', () => {
    // Nếu confidence chỉ chặn, hai trường hợp này bằng điểm nhau và một phỏng
    // đoán mơ hồ leo lên ngang một phép đo chắc chắn.
    const confident = score([sig('audit_gap', 1, 1), sig('freshness', 0, 1)], W).total;
    const shaky = score([sig('audit_gap', 1, 0.35), sig('freshness', 0, 1)], W).total;
    expect(shaky).toBeLessThan(confident);
  });

  it('bằng chứng đo được thắng phỏng đoán dù phỏng đoán có value cao hơn', () => {
    // Đây là tình huống thật: 395 scope chưa rõ audit đoán 1.0 @ 0.35 đã chèn
    // hết những scope đo được thật ra khỏi đầu bảng.
    const measured = score([sig('audit_gap', 0.83, 0.7), sig('freshness', 0.24, 1)], W).total;
    const guessed = score([sig('audit_gap', 1, 0.35), sig('freshness', 0.01, 1)], W).total;
    expect(measured).toBeGreaterThan(guessed);
  });

  it('tín hiệu cùng độ tin cậy vẫn chia trọng số đều như cũ', () => {
    const r = score([sig('audit_gap', 1, 0.5), sig('freshness', 0, 0.5)], W);
    expect(r.total).toBeCloseTo(50, 6);
  });

  it('trọng số đã chuẩn hoá luôn cộng lại bằng 1', () => {
    const r = score([sig('audit_gap', 0.4, 0.35), sig('freshness', 0.9, 1), sig('value_at_risk', 0.5, 0.6)], W);
    expect(r.breakdown.reduce((a, b) => a + b.normalizedWeight, 0)).toBeCloseTo(1, 6);
  });

  it('breakdown cộng lại đúng bằng tổng', () => {
    const r = score([sig('audit_gap', 0.8), sig('freshness', 0.3), sig('value_at_risk', 0.6)], W);
    const sum = r.breakdown.reduce((a, b) => a + b.contribution, 0);
    expect(sum).toBeCloseTo(r.total, 6);
  });
});
