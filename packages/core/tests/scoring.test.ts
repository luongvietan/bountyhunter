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

  it('breakdown cộng lại đúng bằng tổng', () => {
    const r = score([sig('audit_gap', 0.8), sig('freshness', 0.3), sig('value_at_risk', 0.6)], W);
    const sum = r.breakdown.reduce((a, b) => a + b.contribution, 0);
    expect(sum).toBeCloseTo(r.total, 6);
  });
});
