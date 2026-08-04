import { describe, expect, it } from 'vitest';
import { exclusionFor, parseExclusions, repoOwner } from '../src/exclusions.js';

const NOW = new Date('2026-08-04T00:00:00Z');

const exclusions = parseExclusions(`
owners:
  - owner: code-423n4
    reason: Contest mirror of the sponsor's code
  - owner: Sherlock-Scoping
    reason: Scoping fork; the bounty pays out upstream
`);

describe('repoOwner', () => {
  it('reads the owner out of a repo key', () => {
    expect(repoOwner('github.com/makerdao/ngt')).toBe('makerdao');
  });

  it('lowercases so the rule list is not case sensitive', () => {
    expect(repoOwner('github.com/MakerDAO/NGT')).toBe('makerdao');
  });

  it('returns null for a contract key or a missing key', () => {
    expect(repoOwner('ethereum:0xabc')).toBeNull();
    expect(repoOwner(null)).toBeNull();
    expect(repoOwner('github.com/onlyowner')).toBeNull();
  });
});

describe('exclusionFor', () => {
  it('keeps a live program on a normal repository', () => {
    const v = exclusionFor({ hardKey: 'github.com/makerdao/ngt', endsAt: null }, exclusions, NOW);
    expect(v.excluded).toBe(false);
    expect(v.reason).toBeNull();
  });

  it('drops a program that has already closed', () => {
    const v = exclusionFor(
      { hardKey: 'github.com/makerdao/ngt', endsAt: new Date('2026-05-27T00:00:00Z') },
      exclusions,
      NOW,
    );
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('closed_program');
    expect(v.detail).toContain('2026-05-27');
  });

  it('keeps a program whose deadline has not passed', () => {
    const v = exclusionFor(
      { hardKey: 'github.com/makerdao/ngt', endsAt: new Date('2026-09-01T00:00:00Z') },
      exclusions,
      NOW,
    );
    expect(v.excluded).toBe(false);
  });

  it('drops an excluded owner and says why', () => {
    const v = exclusionFor(
      { hardKey: 'github.com/code-423n4/2026-04-monetrix', endsAt: null },
      exclusions,
      NOW,
    );
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('excluded_owner');
    expect(v.detail).toBe("Contest mirror of the sponsor's code");
  });

  it('matches the owner rule regardless of case on either side', () => {
    const v = exclusionFor(
      { hardKey: 'github.com/Sherlock-Scoping/aave__aave-v4', endsAt: null },
      exclusions,
      NOW,
    );
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('excluded_owner');
  });

  it('does not match an owner that merely contains an excluded name', () => {
    // Substring matching would drop a legitimate project called, say,
    // "code-423n4-tools" that has nothing to do with the mirror org.
    const v = exclusionFor(
      { hardKey: 'github.com/code-423n4-tools/helper', endsAt: null },
      exclusions,
      NOW,
    );
    expect(v.excluded).toBe(false);
  });

  it('reports the closed program first when both rules apply', () => {
    // The deadline is the harder fact: no submission is possible either way,
    // and it explains the exclusion without needing the owner list.
    const v = exclusionFor(
      {
        hardKey: 'github.com/code-423n4/2026-04-monetrix',
        endsAt: new Date('2026-05-04T00:00:00Z'),
      },
      exclusions,
      NOW,
    );
    expect(v.reason).toBe('closed_program');
  });

  it('accepts an empty rule file', () => {
    const empty = parseExclusions('owners: []');
    expect(exclusionFor({ hardKey: 'github.com/a/b', endsAt: null }, empty, NOW).excluded).toBe(
      false,
    );
  });
});
