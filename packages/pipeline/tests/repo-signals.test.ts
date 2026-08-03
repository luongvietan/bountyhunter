import type { RepoSnapshotPayload, RepoTarget } from '@kritt-radar/collectors';
import { describe, expect, it } from 'vitest';
import { snapshotToAuditGap } from '../src/repo-signals.js';

const target: RepoTarget = {
  repoKey: 'github.com/acme/protocol',
  pathGlobs: ['src/**/*.sol'],
  lastAuditAt: '2026-07-01T00:00:00.000Z',
  coveredCommit: 'base000',
};

const completeAudited: RepoSnapshotPayload = {
  repoKey: target.repoKey,
  cutoff: { lastAuditAt: target.lastAuditAt, baseCommit: target.coveredCommit },
  headSha: 'abc123',
  headAuthoredAt: '2026-08-01T00:00:00.000Z',
  files: ['src/Pool.sol', 'src/Router.sol'],
  totalLoc: 1000,
  locMethod: 'estimated_from_bytes',
  changedFiles: [
    { path: 'src/Pool.sol', changedLoc: 42 },
    { path: 'src/Router.sol', changedLoc: 8 },
    { path: 'docs/architecture.md', changedLoc: 999 },
  ],
  commits: ['change001', 'change002'],
  complete: true,
  truncated: false,
  error: null,
};

describe('snapshotToAuditGap', () => {
  it('materializes audited snapshot math with the complete evidence contract', () => {
    const signal = snapshotToAuditGap(completeAudited, target);

    expect(signal.evidence).toEqual({
      headSha: 'abc123',
      sinceCommit: 'base000',
      sinceDate: '2026-07-01T00:00:00.000Z',
      files: ['src/Pool.sol', 'src/Router.sol'],
      commits: ['change001', 'change002'],
      changedLoc: 50,
      totalLoc: 1000,
      locMethod: 'estimated_from_bytes',
      complete: true,
      truncated: false,
    });
    expect(signal.confidence).toBe(0.7);
  });

  it('represents a complete target with no public audit as a full audit gap', () => {
    const noAuditTarget: RepoTarget = { ...target, lastAuditAt: null, coveredCommit: null };
    const noAudit: RepoSnapshotPayload = {
      ...completeAudited,
      cutoff: { lastAuditAt: null, baseCommit: null },
      changedFiles: [],
      commits: [],
    };

    const signal = snapshotToAuditGap(noAudit, noAuditTarget);

    expect(signal.value).toBe(1);
    expect(signal.confidence).toBe(0.7);
    expect(signal.evidence).toMatchObject({
      reason: 'no_public_audit',
      files: ['src/Pool.sol', 'src/Router.sol'],
      changedLoc: 0,
    });
  });

  it('marks a failed snapshot as no data without interpreting zeroes as evidence', () => {
    const failed: RepoSnapshotPayload = {
      ...completeAudited,
      headSha: 'partial-head',
      files: [],
      totalLoc: 0,
      changedFiles: [],
      commits: [],
      complete: false,
      truncated: true,
      error: 'GitHub returned 503',
    };

    const signal = snapshotToAuditGap(failed, target);

    expect(signal.confidence).toBe(0);
    expect(signal.evidence).toMatchObject({
      reason: 'snapshot_failed',
      error: 'GitHub returned 503',
      complete: false,
    });
  });

  it('accepts a collector failure before HEAD as a valid diagnostic snapshot', () => {
    const failedBeforeHead: RepoSnapshotPayload = {
      ...completeAudited,
      headSha: null,
      headAuthoredAt: null,
      files: [],
      totalLoc: 0,
      changedFiles: [],
      commits: [],
      complete: false,
      truncated: false,
      error: 'HEAD request failed',
    };

    const signal = snapshotToAuditGap(failedBeforeHead, target);

    expect(signal.confidence).toBe(0);
    expect(signal.evidence.reason).toBe('snapshot_failed');
  });

  it.each([
    {
      name: 'empty HEAD SHA',
      snapshot: { ...completeAudited, headSha: '' },
      expected: target,
    },
    {
      name: 'empty commit SHA',
      snapshot: { ...completeAudited, commits: [''] },
      expected: target,
    },
    {
      name: 'complete snapshot without HEAD',
      snapshot: { ...completeAudited, headSha: null },
      expected: target,
    },
    {
      name: 'simultaneously complete and truncated snapshot',
      snapshot: { ...completeAudited, truncated: true },
      expected: target,
    },
    {
      name: 'error state marked complete',
      snapshot: { ...completeAudited, error: 'compare failed' },
      expected: target,
    },
    {
      name: 'healthy state that is neither complete nor truncated',
      snapshot: { ...completeAudited, complete: false },
      expected: target,
    },
    {
      name: 'healthy audited state without a base commit',
      snapshot: {
        ...completeAudited,
        cutoff: { lastAuditAt: target.lastAuditAt, baseCommit: null },
      },
      expected: { ...target, coveredCommit: null },
    },
  ])('rejects an impossible $name', ({ snapshot, expected }) => {
    const signal = snapshotToAuditGap(snapshot, expected);

    expect(signal.confidence).toBe(0);
    expect(signal.evidence.reason).toBe('invalid_snapshot');
  });

  it('caps truncated estimated data confidence at 0.35', () => {
    const truncated: RepoSnapshotPayload = {
      ...completeAudited,
      complete: false,
      truncated: true,
    };

    expect(snapshotToAuditGap(truncated, target).confidence).toBe(0.35);
  });

  it.each([
    {
      name: 'covered commit',
      expected: target,
      cutoff: { lastAuditAt: target.lastAuditAt, baseCommit: 'older-base' },
    },
    {
      name: 'audit date',
      expected: { ...target, coveredCommit: null },
      cutoff: { lastAuditAt: '2026-06-01T00:00:00.000Z', baseCommit: 'dated-base' },
    },
  ])('rejects a snapshot collected for a stale $name cutoff', ({ expected, cutoff }) => {
    const signal = snapshotToAuditGap({ ...completeAudited, cutoff }, expected);

    expect(signal.confidence).toBe(0);
    expect(signal.evidence.reason).toBe('stale_cutoff');
  });

  it('rejects a snapshot from another repo even when its cutoff matches', () => {
    const signal = snapshotToAuditGap(
      { ...completeAudited, repoKey: 'github.com/other/protocol' },
      target,
    );

    expect(signal.confidence).toBe(0);
    expect(signal.evidence.reason).toBe('stale_cutoff');
  });
});
