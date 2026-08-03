import { describe, expect, it } from 'vitest';
import { parseWeights } from '../src/weights.js';

describe('parseWeights', () => {
  it('parse file hợp lệ', () => {
    const w = parseWeights(`
version: v1-equal
minConfidence: 0.3
weights:
  audit_gap: 1
  freshness: 1
  competition: 1
  value_at_risk: 1
`);
    expect(w.version).toBe('v1-equal');
    expect(w.minConfidence).toBe(0.3);
    expect(w.weights.audit_gap).toBe(1);
  });

  it('báo lỗi khi thiếu một loại tín hiệu', () => {
    expect(() =>
      parseWeights(`
version: bad
minConfidence: 0.3
weights:
  audit_gap: 1
`),
    ).toThrow(/freshness/);
  });

  it('từ chối trọng số âm', () => {
    expect(() =>
      parseWeights(`
version: bad
minConfidence: 0.3
weights:
  audit_gap: -1
  freshness: 1
  competition: 1
  value_at_risk: 1
`),
    ).toThrow();
  });

  it('từ chối minConfidence ngoài [0,1]', () => {
    expect(() =>
      parseWeights(`
version: bad
minConfidence: 1.5
weights:
  audit_gap: 1
  freshness: 1
  competition: 1
  value_at_risk: 1
`),
    ).toThrow();
  });
});
