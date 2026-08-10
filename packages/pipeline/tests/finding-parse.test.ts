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

describe('post-script enrichment', () => {
  const chain = (results: Array<Record<string, unknown>>) =>
    finding({
      enrichments: results.map((result, i) => ({
        postScriptName: `script-${i}`,
        result,
        stub: false,
      })),
    });

  it('reads the report, the proof, and the scope verdict off the chain', () => {
    const [f] = parseFindings([
      chain([
        { _reserved_poc: 'diff --git a/test/Exploit.t.sol' },
        { _reserved_report: '# Reentrancy in withdraw' },
        { _chip_is_in_scope: true, is_valid: true },
      ]),
    ]);

    expect(f!.pocDiff).toBe('diff --git a/test/Exploit.t.sol');
    expect(f!.krittReport).toBe('# Reentrancy in withdraw');
    expect(f!.inScope).toBe(true);
    expect(f!.postScriptValid).toBe(true);
  });

  it('records an out-of-scope verdict rather than dropping it', () => {
    const [f] = parseFindings([chain([{ _chip_is_in_scope: false, is_valid: true }])]);
    expect(f!.inScope).toBe(false);
    expect(f!.postScriptValid).toBe(true);
  });

  it('reads the boolean words an agent writes instead of a JSON boolean', () => {
    const [f] = parseFindings([chain([{ _chip_is_in_scope: 'no', is_valid: 'confirmed' }])]);
    expect(f!.inScope).toBe(false);
    expect(f!.postScriptValid).toBe(true);
  });

  it('ignores a stub, so a script with nothing to say cannot blank an earlier answer', () => {
    const [f] = parseFindings([
      finding({
        enrichments: [
          { postScriptName: 'PoC Creator', result: { _reserved_poc: 'diff' }, stub: false },
          { postScriptName: 'Report Creator', result: { _reserved_poc: '' }, stub: true },
        ],
      }),
    ]);
    expect(f!.pocDiff).toBe('diff');
  });

  it('treats an empty string as nothing produced', () => {
    const [f] = parseFindings([chain([{ _reserved_poc: '   ', _reserved_report: '' }])]);
    expect(f!.pocDiff).toBeNull();
    expect(f!.krittReport).toBeNull();
  });

  it('leaves every field null when no post-script ran', () => {
    const [f] = parseFindings([finding()]);
    expect(f!.pocDiff).toBeNull();
    expect(f!.krittReport).toBeNull();
    expect(f!.inScope).toBeNull();
    expect(f!.postScriptValid).toBeNull();
  });

  it('still reads the single postScriptAnswer Kritt returns for a one-script scan', () => {
    const [f] = parseFindings([finding({ postScriptAnswer: { _reserved_report: '# Report' } })]);
    expect(f!.krittReport).toBe('# Report');
  });

  it('reads the Finding Triage verdict from enrichments', () => {
    const [f] = parseFindings([
      finding({
        enrichments: [
          { postScriptName: 'Finding Triage', result: { triage_verdict: 'noise' }, stub: false },
        ],
      }),
    ]);
    expect(f!.triageVerdict).toBe('noise');
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
