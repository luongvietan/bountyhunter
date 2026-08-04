import { describe, expect, it } from 'vitest';
import { isReviewable, parseFindings, type ParsedFinding } from '../src/finding-parse.js';

const finding = (over: Record<string, unknown> = {}) => ({
  id: 101,
  rank: 1,
  summary: 'Reentrancy in withdraw lets a caller drain the vault',
  explanation: 'The balance is written after the external call.',
  file_path: 'contracts/Vault.sol',
  line: 142,
  malicious_input_example: 'withdraw(type(uint256).max)',
  malicious_actor: 'Any depositor',
  trigger_flow: ['deposit()', 'withdraw()', 'fallback re-enters withdraw()'],
  vulnerability_type: 'reentrancy',
  exploitable: true,
  severity: 'critical',
  dedupe: { isCanonical: true, clusterId: 'cluster-1' },
  bountyRank: {
    rank: 1,
    impactLevel: 'critical',
    minimumReward: '50000',
    maximumReward: '250000',
    reasoning: 'Direct loss of user funds.',
  },
  ...over,
});

describe('parseFindings', () => {
  it('reads the fields a submission needs', () => {
    const [f] = parseFindings([finding()]);
    expect(f).toMatchObject({
      krittVulnId: '101',
      title: 'Reentrancy in withdraw lets a caller drain the vault',
      filePath: 'contracts/Vault.sol',
      line: 142,
      severity: 'critical',
      exploitable: true,
      vulnerabilityType: 'reentrancy',
      maliciousInput: 'withdraw(type(uint256).max)',
      minRewardUsd: 50000,
      maxRewardUsd: 250000,
      impactLevel: 'critical',
    } satisfies Partial<ParsedFinding>);
    expect(f!.triggerFlow).toHaveLength(3);
  });

  it('drops duplicates Kritt already clustered', () => {
    // The endpoint filters these by default, but a caller who asked for
    // duplicates should still not get two rows for one bug.
    const out = parseFindings([
      finding(),
      finding({ id: 102, dedupe: { isCanonical: false, clusterId: 'cluster-1' } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.krittVulnId).toBe('101');
  });

  it('drops a finding with nothing to review', () => {
    expect(parseFindings([finding({ id: 9, summary: null, explanation: null })])).toEqual([]);
    expect(parseFindings([finding({ id: 9, summary: '   ', explanation: null })])).toEqual([]);
  });

  it('orders by Kritt rank, with unranked findings last', () => {
    const out = parseFindings([
      finding({ id: 3, rank: null }),
      finding({ id: 1, rank: 1 }),
      finding({ id: 2, rank: 2 }),
    ]);
    expect(out.map((f) => f.krittVulnId)).toEqual(['1', '2', '3']);
  });

  it('reads reward figures whether they arrive as strings or numbers', () => {
    const [f] = parseFindings([
      finding({ bountyRank: { minimumReward: 1000, maximumReward: '9000' } }),
    ]);
    expect(f!.minRewardUsd).toBe(1000);
    expect(f!.maxRewardUsd).toBe(9000);
  });

  it('keeps an unknown exploitability as unknown rather than assuming false', () => {
    const [f] = parseFindings([finding({ exploitable: null })]);
    expect(f!.exploitable).toBeNull();
  });

  it('reads the string forms an agent writes for exploitability', () => {
    expect(parseFindings([finding({ exploitable: 'yes' })])[0]!.exploitable).toBe(true);
    expect(parseFindings([finding({ exploitable: 'false' })])[0]!.exploitable).toBe(false);
    expect(parseFindings([finding({ exploitable: 'maybe' })])[0]!.exploitable).toBeNull();
  });

  it('survives a garbage entry without losing the good ones', () => {
    const out = parseFindings([{ nonsense: true }, finding()]);
    expect(out).toHaveLength(1);
  });

  it('accepts a bare array or an items envelope', () => {
    expect(parseFindings([finding()])).toHaveLength(1);
    expect(parseFindings({ items: [finding()] })).toHaveLength(1);
    expect(parseFindings({ nope: 1 })).toEqual([]);
  });

  it('truncates a runaway summary rather than storing an essay as a title', () => {
    const [f] = parseFindings([finding({ summary: 'x'.repeat(500) })]);
    expect(f!.title).toHaveLength(300);
    expect(f!.title.endsWith('...')).toBe(true);
  });
});

describe('isReviewable', () => {
  it('keeps a confirmed or undetermined finding', () => {
    expect(isReviewable(parseFindings([finding({ exploitable: true })])[0]!)).toBe(true);
    expect(isReviewable(parseFindings([finding({ exploitable: null })])[0]!)).toBe(true);
  });

  it('sets aside one the workflow ruled out', () => {
    expect(isReviewable(parseFindings([finding({ exploitable: false })])[0]!)).toBe(false);
  });
});
