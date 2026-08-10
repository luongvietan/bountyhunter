import { describe, expect, it } from 'vitest';
import { triageDismissVerdict } from '../src/finding-triage.js';
import type { ParsedFinding } from '../src/finding-parse.js';

function baseFinding(overrides: Partial<ParsedFinding> = {}): ParsedFinding {
  return {
    krittVulnId: '1',
    rank: 1,
    title: 'Test',
    vulnerabilityType: null,
    filePath: null,
    line: null,
    severity: null,
    exploitable: true,
    explanation: null,
    maliciousInput: null,
    maliciousActor: null,
    triggerFlow: [],
    bountyRank: null,
    impactLevel: null,
    minRewardUsd: null,
    maxRewardUsd: null,
    rankReasoning: null,
    clusterId: null,
    krittReport: null,
    pocDiff: null,
    inScope: null,
    postScriptValid: null,
    triageVerdict: null,
    triageReason: null,
    raw: {},
    ...overrides,
  };
}

describe('triageDismissVerdict', () => {
  it('auto-dismisses out-of-scope findings', () => {
    const verdict = triageDismissVerdict(baseFinding({ inScope: false }));
    expect(verdict.dismiss).toBe(true);
    expect(verdict.decidedBy).toBe('auto');
  });

  it('auto-dismisses invalid post-script findings', () => {
    const verdict = triageDismissVerdict(baseFinding({ postScriptValid: false }));
    expect(verdict.dismiss).toBe(true);
    expect(verdict.decidedBy).toBe('auto');
  });

  it('ai-dismisses noise triage verdicts', () => {
    const verdict = triageDismissVerdict(baseFinding({ triageVerdict: 'noise' }));
    expect(verdict.dismiss).toBe(true);
    expect(verdict.decidedBy).toBe('ai');
  });

  it('keeps reviewable findings in the human queue', () => {
    const verdict = triageDismissVerdict(baseFinding({ triageVerdict: 'review' }));
    expect(verdict.dismiss).toBe(false);
  });
});
