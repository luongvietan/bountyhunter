import { describe, expect, it } from 'vitest';
import { parseFindingStatus, reportBlockers } from '../src/lib/finding-queue';

describe('parseFindingStatus', () => {
  it('accepts the states the queue exposes', () => {
    expect(parseFindingStatus('submitted')).toBe('submitted');
    expect(parseFindingStatus('dismissed')).toBe('dismissed');
  });

  it('defaults to the review queue rather than an empty page', () => {
    expect(parseFindingStatus(undefined)).toBe('new');
    expect(parseFindingStatus('nonsense')).toBe('new');
    expect(parseFindingStatus(['new', 'submitted'])).toBe('new');
  });
});

describe('reportBlockers', () => {
  const complete = {
    maliciousInput: 'withdraw(type(uint256).max)',
    exploitable: true,
    explanation: 'The balance is written after the external call.',
    filePath: 'contracts/Vault.sol',
  };

  it('clears a finding that carries its own proof', () => {
    expect(reportBlockers(complete)).toEqual([]);
  });

  it('names a missing proof of concept, the usual reason a report is rejected', () => {
    expect(reportBlockers({ ...complete, maliciousInput: null })).toContain('No proof of concept');
    expect(reportBlockers({ ...complete, maliciousInput: '  ' })).toContain('No proof of concept');
  });

  it('treats unconfirmed and ruled-out exploitability alike', () => {
    expect(reportBlockers({ ...complete, exploitable: null })).toContain(
      'Exploitability not confirmed',
    );
    expect(reportBlockers({ ...complete, exploitable: false })).toContain(
      'Exploitability not confirmed',
    );
  });

  it('names a missing explanation and a missing location', () => {
    const blockers = reportBlockers({
      maliciousInput: null,
      exploitable: null,
      explanation: null,
      filePath: null,
    });
    expect(blockers).toHaveLength(4);
  });

  it('accepts a PoC diff in place of a described input', () => {
    expect(
      reportBlockers({ ...complete, maliciousInput: null, pocDiff: 'diff --git a/test/E.t.sol' }),
    ).toEqual([]);
  });

  it('blocks a finding the scope post-script ruled ineligible', () => {
    expect(reportBlockers({ ...complete, inScope: false })).toContain(
      'Attacker is out of scope for this program',
    );
  });

  it('blocks a finding the chain could not re-confirm', () => {
    expect(reportBlockers({ ...complete, postScriptValid: false })).toContain(
      'Post-script could not confirm the finding',
    );
  });

  it('does not block when the chain did not run', () => {
    expect(reportBlockers({ ...complete, inScope: null, postScriptValid: null })).toEqual([]);
  });
});
