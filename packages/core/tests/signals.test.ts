import { describe, expect, it } from 'vitest';
import { SIGNAL_TYPES, isSignalType, clamp01 } from '../src/signals.js';

describe('signals', () => {
  it('liệt kê đúng các loại tín hiệu', () => {
    expect([...SIGNAL_TYPES]).toEqual(['audit_gap', 'freshness', 'competition', 'value_at_risk']);
  });

  it('nhận diện loại hợp lệ', () => {
    expect(isSignalType('audit_gap')).toBe(true);
    expect(isSignalType('nonsense')).toBe(false);
  });

  it('clamp01 kẹp về [0,1] và biến NaN thành 0', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
