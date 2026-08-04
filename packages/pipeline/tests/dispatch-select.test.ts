import { describe, expect, it } from 'vitest';
import {
  dispatchKey,
  planDispatch,
  summarizeSkips,
  type DispatchCandidate,
} from '../src/dispatch-select.js';

const candidate = (over: Partial<DispatchCandidate> & { repoKey: string }): DispatchCandidate => ({
  scopeId: `scope-${over.repoKey}`,
  commitSha: 'a'.repeat(40),
  score: 50,
  measuredAuditGap: true,
  changedFileCount: 12,
  excluded: false,
  ...over,
});

const limits = (max = 3, already: string[] = []) => ({
  maxScans: max,
  alreadyDispatched: new Set(already),
});

describe('planDispatch', () => {
  it('takes the highest scoring targets first', () => {
    const plan = planDispatch(
      [
        candidate({ repoKey: 'github.com/a/low', score: 10 }),
        candidate({ repoKey: 'github.com/a/high', score: 90 }),
        candidate({ repoKey: 'github.com/a/mid', score: 50 }),
      ],
      limits(2),
    );
    expect(plan.selected.map((c) => c.repoKey)).toEqual(['github.com/a/high', 'github.com/a/mid']);
  });

  it('never dispatches a closed program or an excluded owner', () => {
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/code-423n4/x', score: 99, excluded: true })],
      limits(),
    );
    expect(plan.selected).toEqual([]);
    expect(plan.skipped[0]).toEqual({ repoKey: 'github.com/code-423n4/x', reason: 'excluded' });
  });

  it('refuses a target with no commit, because the scan could not be pinned', () => {
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/a/b', commitSha: null })],
      limits(),
    );
    expect(plan.selected).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe('no_commit');
  });

  it('refuses an assumed audit gap, which is a guess rather than evidence', () => {
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/a/b', measuredAuditGap: false, score: 99 })],
      limits(),
    );
    expect(plan.selected).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe('assumed_audit_gap');
  });

  it('refuses a target with nothing changed since the audit', () => {
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/a/b', changedFileCount: 0 })],
      limits(),
    );
    expect(plan.skipped[0]!.reason).toBe('no_changed_files');
  });

  it('BẤT BIẾN: never pays twice for the same repository at the same commit', () => {
    // This is what makes a daily schedule affordable: a run only spends on
    // code that moved since the last one.
    const sha = 'b'.repeat(40);
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/a/b', commitSha: sha })],
      limits(3, [dispatchKey('github.com/a/b', sha)]),
    );
    expect(plan.selected).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe('already_scanned');
  });

  it('dispatches the same repository again once its HEAD moves', () => {
    const plan = planDispatch(
      [candidate({ repoKey: 'github.com/a/b', commitSha: 'c'.repeat(40) })],
      limits(3, [dispatchKey('github.com/a/b', 'b'.repeat(40))]),
    );
    expect(plan.selected).toHaveLength(1);
  });

  it('scans a repository once per run even when two programs cover it', () => {
    const plan = planDispatch(
      [
        candidate({ repoKey: 'github.com/a/b', scopeId: 's1', score: 80 }),
        candidate({ repoKey: 'github.com/a/b', scopeId: 's2', score: 70 }),
      ],
      limits(),
    );
    expect(plan.selected).toHaveLength(1);
    expect(plan.skipped[0]!.reason).toBe('already_scanned');
  });

  it('stops at the run limit and records what it left behind', () => {
    const plan = planDispatch(
      [
        candidate({ repoKey: 'github.com/a/1', score: 90 }),
        candidate({ repoKey: 'github.com/a/2', score: 80 }),
        candidate({ repoKey: 'github.com/a/3', score: 70 }),
      ],
      limits(2),
    );
    expect(plan.selected).toHaveLength(2);
    expect(summarizeSkips(plan).over_limit).toBe(1);
  });

  it('a limit of zero dispatches nothing', () => {
    const plan = planDispatch([candidate({ repoKey: 'github.com/a/b' })], limits(0));
    expect(plan.selected).toEqual([]);
  });

  it('counts every skip, so a quiet run can still explain itself', () => {
    const plan = planDispatch(
      [
        candidate({ repoKey: 'github.com/a/1', excluded: true }),
        candidate({ repoKey: 'github.com/a/2', commitSha: null }),
        candidate({ repoKey: 'github.com/a/3', measuredAuditGap: false }),
      ],
      limits(),
    );
    const counts = summarizeSkips(plan);
    expect(counts.excluded).toBe(1);
    expect(counts.no_commit).toBe(1);
    expect(counts.assumed_audit_gap).toBe(1);
  });
});
