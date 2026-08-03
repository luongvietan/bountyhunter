import { describe, expect, it } from 'vitest';
import { rankScopes } from '../src/run.js';
import type { Weights } from '@kritt-radar/core';

const W: Weights = {
  version: 'v1-equal',
  minConfidence: 0.3,
  weights: { audit_gap: 1, freshness: 1, competition: 1, value_at_risk: 1 },
};

describe('rankScopes', () => {
  it('xếp giảm dần theo điểm', () => {
    const out = rankScopes(
      [
        {
          scopeId: 'a',
          title: 'A',
          signals: [{ type: 'audit_gap', value: 0.2, confidence: 1, evidence: {} }],
        },
        {
          scopeId: 'b',
          title: 'B',
          signals: [{ type: 'audit_gap', value: 0.9, confidence: 1, evidence: {} }],
        },
      ],
      W,
    );
    expect(out.map((r) => r.scopeId)).toEqual(['b', 'a']);
  });

  it('giữ breakdown để giải thích được điểm', () => {
    const out = rankScopes(
      [
        {
          scopeId: 'a',
          title: 'A',
          signals: [{ type: 'freshness', value: 0.5, confidence: 1, evidence: {} }],
        },
      ],
      W,
    );
    expect(out[0]!.score.breakdown[0]!.type).toBe('freshness');
    expect(out[0]!.score.weightsVersion).toBe('v1-equal');
  });

  it('scope không có tín hiệu dùng được vẫn xuất hiện với điểm 0', () => {
    const out = rankScopes([{ scopeId: 'a', title: 'A', signals: [] }], W);
    expect(out).toHaveLength(1);
    expect(out[0]!.score.total).toBe(0);
  });
});
