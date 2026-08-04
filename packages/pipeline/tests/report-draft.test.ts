import { describe, expect, it } from 'vitest';
import {
  buildReport,
  reportFormatFor,
  type ReportFinding,
  type ReportTarget,
} from '../src/report-draft.js';

const target: ReportTarget = {
  repoKey: 'github.com/acme/vault',
  commitSha: '7b48d243f505aa11',
  programTitle: 'Acme Vault',
  platform: 'immunefi',
};

const finding = (over: Partial<ReportFinding> = {}): ReportFinding => ({
  title: 'Reentrancy in withdraw drains the vault',
  vulnerabilityType: 'reentrancy',
  severity: 'critical',
  impactLevel: 'critical',
  filePath: 'contracts/Vault.sol',
  line: 142,
  explanation: 'The balance is written after the external call.',
  maliciousInput: 'withdraw(type(uint256).max)',
  maliciousActor: 'Any depositor',
  triggerFlow: ['deposit()', 'withdraw()', 'fallback re-enters'],
  exploitable: true,
  minRewardUsd: 50000,
  maxRewardUsd: 250000,
  ...over,
});

describe('reportFormatFor', () => {
  it('matches the platforms with a shape worth following', () => {
    expect(reportFormatFor('immunefi')).toBe('immunefi');
    expect(reportFormatFor('Code4rena')).toBe('code4rena');
    expect(reportFormatFor('sherlock')).toBe('code4rena');
    expect(reportFormatFor('somewhere-else')).toBe('generic');
  });
});

describe('buildReport', () => {
  it('pins the repository and commit so the reader can check the claim', () => {
    const md = buildReport(finding(), target);
    expect(md).toContain('github.com/acme/vault');
    expect(md).toContain('7b48d243f505aa11');
  });

  it('links the exact line at the audited commit, not at HEAD', () => {
    // HEAD moves; a permalink at the scanned commit still shows the code the
    // finding is about a month later.
    expect(buildReport(finding(), target)).toContain(
      'https://github.com/acme/vault/blob/7b48d243f505aa11/contracts/Vault.sol#L142',
    );
  });

  it('numbers the trigger flow as reproduction steps', () => {
    const md = buildReport(finding(), target);
    expect(md).toContain('1. deposit()');
    expect(md).toContain('3. fallback re-enters');
  });

  it('follows the Immunefi section order', () => {
    const md = buildReport(finding(), target);
    expect(md.indexOf('## Brief')).toBeLessThan(md.indexOf('## Vulnerability Details'));
    expect(md.indexOf('## Impact')).toBeLessThan(md.indexOf('## Proof of Concept'));
  });

  it('uses the contest layout for a contest platform', () => {
    const md = buildReport(finding(), { ...target, platform: 'sherlock' });
    expect(md).toContain('## Lines of code');
    expect(md).not.toContain('## Brief');
  });

  it('BẤT BIẾN: says when there is no proof of concept instead of reading complete', () => {
    // A report that looks finished while missing its proof is the kind that
    // gets an account banned.
    const md = buildReport(finding({ maliciousInput: null }), target);
    expect(md).toContain('No proof of concept');
    expect(md).toContain('Most programs reject reports without one');
  });

  it('BẤT BIẾN: warns when exploitability was never established', () => {
    expect(buildReport(finding({ exploitable: null }), target)).toContain(
      'Exploitability was **not established**',
    );
  });

  it('BẤT BIẾN: warns when the workflow ruled the finding out', () => {
    expect(buildReport(finding({ exploitable: false }), target)).toContain(
      'judged this **not exploitable**',
    );
  });

  it('always says the draft came from an automated scan', () => {
    expect(buildReport(finding(), target)).toContain('Verify every claim before submitting');
  });

  it('marks a missing summary rather than leaving the section blank', () => {
    expect(buildReport(finding({ explanation: null }), target)).toContain(
      'Needs a written summary before submission',
    );
    expect(buildReport(finding({ explanation: '   ' }), target)).toContain(
      'Needs a written summary',
    );
  });

  it('falls back to a plain location when there is no file', () => {
    const md = buildReport(finding({ filePath: null, line: null }), target);
    expect(md).toContain('_Not identified._');
    expect(md).not.toContain('/blob/');
  });

  it('omits the line anchor when only a file is known', () => {
    const md = buildReport(finding({ line: null }), target);
    expect(md).toContain('/contracts/Vault.sol');
    expect(md).not.toContain('#L');
  });

  it('does not leave a run of blank lines where a section was skipped', () => {
    expect(buildReport(finding({ vulnerabilityType: null }), target)).not.toMatch(/\n{3,}/);
  });
});
