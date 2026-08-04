import { describe, expect, it } from 'vitest';
import {
  isMeasuredAuditGap,
  parseMeasuredOnly,
  parsePlatform,
  groupByRepo,
  partitionScopeFiles,
  type RankedTarget,
  type TargetSignal,
} from '../src/lib/target-ranking';

const signal = (
  type: TargetSignal['type'],
  value: number,
  confidence: number,
  evidence: Record<string, unknown> = {},
): TargetSignal => ({ type, value, confidence, evidence, computedAt: '2026-08-04T00:00:00.000Z' });

describe('isMeasuredAuditGap', () => {
  it('counts a gap computed from a real audit cutoff', () => {
    expect(
      isMeasuredAuditGap([signal('audit_gap', 0.83, 0.7, { sinceDate: '2025-09-01', files: ['a.sol'] })]),
    ).toBe(true);
  });

  it('rejects an assumed gap, however high its value', () => {
    // value 1.0 with reason no_public_audit is the extractor saying it never
    // found an audit, not that the repo changed completely.
    expect(isMeasuredAuditGap([signal('audit_gap', 1, 0.35, { reason: 'no_public_audit' })])).toBe(false);
  });

  it('rejects a gap the collector could not produce', () => {
    expect(isMeasuredAuditGap([signal('audit_gap', 0, 0, { reason: 'snapshot_failed' })])).toBe(false);
  });

  it('rejects a target with no audit gap signal at all', () => {
    expect(isMeasuredAuditGap([signal('freshness', 0.4, 1)])).toBe(false);
  });
});

describe('parsePlatform', () => {
  const allowed = ['immunefi', 'code4rena'];

  it('accepts a known platform', () => {
    expect(parsePlatform('immunefi', allowed)).toBe('immunefi');
  });

  it('ignores an unknown platform rather than returning an empty result set', () => {
    expect(parsePlatform('nonsense', allowed)).toBeNull();
  });

  it('ignores repeated query parameters', () => {
    expect(parsePlatform(['immunefi', 'code4rena'], allowed)).toBeNull();
  });

  it('ignores a missing parameter', () => {
    expect(parsePlatform(undefined, allowed)).toBeNull();
  });
});

describe('parseMeasuredOnly', () => {
  it('reads the truthy forms a link can produce', () => {
    expect(parseMeasuredOnly('1')).toBe(true);
    expect(parseMeasuredOnly('true')).toBe(true);
  });

  it('defaults to showing everything', () => {
    expect(parseMeasuredOnly(undefined)).toBe(false);
    expect(parseMeasuredOnly('0')).toBe(false);
    expect(parseMeasuredOnly(['1', '1'])).toBe(false);
  });
});

describe('groupByRepo', () => {
  const target = (
    repoKey: string,
    scopeId: string,
    total: number,
    program: { title: string; poolUsd: number | null },
  ): RankedTarget => ({
    scopeId,
    repoKey,
    programTitle: program.title,
    programUrl: `https://example.test/${scopeId}`,
    platform: 'immunefi',
    poolUsd: program.poolUsd,
    endsAt: null,
    programs: [
      {
        scopeId,
        title: program.title,
        platform: 'immunefi',
        url: `https://example.test/${scopeId}`,
        poolUsd: program.poolUsd,
      },
    ],
    commitish: null,
    score: {
      total,
      breakdown: [],
      usedSignals: 1,
      skipped: [],
      weightsVersion: 'test',
    },
    signals: [],
    scopeFiles: [],
    auditGapReason: null,
  });

  it('collapses one repository covered by several programs into one row', () => {
    const grouped = groupByRepo([
      target('github.com/a/b', 's1', 38.2, { title: 'Ancillaries', poolUsd: 200_000 }),
      target('github.com/a/b', 's2', 38.2, { title: 'Ancillaries II', poolUsd: 100_000 }),
      target('github.com/c/d', 's3', 20, { title: 'Other', poolUsd: null }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.find((t) => t.repoKey === 'github.com/a/b')?.programs).toHaveLength(2);
  });

  it('names the best-paying program on the row', () => {
    const grouped = groupByRepo([
      target('github.com/a/b', 's1', 38.2, { title: 'Small', poolUsd: 100_000 }),
      target('github.com/a/b', 's2', 38.2, { title: 'Large', poolUsd: 500_000 }),
    ]);

    expect(grouped[0]!.programTitle).toBe('Large');
    expect(grouped[0]!.poolUsd).toBe(500_000);
  });

  it('keeps the highest-scoring scope as the representative', () => {
    const grouped = groupByRepo([
      target('github.com/a/b', 'low', 10, { title: 'Rich', poolUsd: 900_000 }),
      target('github.com/a/b', 'high', 40, { title: 'Poor', poolUsd: 1 }),
    ]);

    // Score comes from the code, the named program from the money.
    expect(grouped[0]!.score.total).toBe(40);
    expect(grouped[0]!.scopeId).toBe('high');
    expect(grouped[0]!.programTitle).toBe('Rich');
  });

  it('treats a program without a pool as the least valuable, not the most', () => {
    const grouped = groupByRepo([
      target('github.com/a/b', 's1', 10, { title: 'Unknown pool', poolUsd: null }),
      target('github.com/a/b', 's2', 10, { title: 'Known pool', poolUsd: 5 }),
    ]);

    expect(grouped[0]!.programTitle).toBe('Known pool');
  });
});

describe('partitionScopeFiles', () => {
  it('keeps source files a scan should read', () => {
    const { code } = partitionScopeFiles([
      'src/Pool.sol',
      'contracts/Vault.sol',
      'crates/node/src/lib.rs',
      'packages/core/src/index.ts',
      'package.json',
    ]);
    expect(code).toEqual([
      'src/Pool.sol',
      'contracts/Vault.sol',
      'crates/node/src/lib.rs',
      'packages/core/src/index.ts',
      'package.json',
    ]);
  });

  it('sets aside files that cannot hold a vulnerability', () => {
    const { other } = partitionScopeFiles([
      '.github/workflows/ci.yml',
      '.claude/settings.json',
      '.env.example',
      'README.md',
      'LICENSE',
      'docs/architecture.md',
      'assets/logo.svg',
      'pnpm-lock.yaml',
    ]);
    expect(other).toContain('.github/workflows/ci.yml');
    expect(other).toContain('.claude/settings.json');
    expect(other).toContain('.env.example');
    expect(other).toContain('README.md');
    expect(other).toContain('LICENSE');
    expect(other).toContain('docs/architecture.md');
    expect(other).toContain('assets/logo.svg');
  });

  it('loses nothing: the two halves always reconstruct the input', () => {
    const files = ['src/A.sol', 'README.md', '.github/x.yml', 'lib/B.rs', 'img.png'];
    const { code, other } = partitionScopeFiles(files);
    expect([...code, ...other].sort()).toEqual([...files].sort());
  });

  it('does not mistake a nested source directory for a docs directory', () => {
    const { code } = partitionScopeFiles(['src/documents/Registry.sol']);
    expect(code).toEqual(['src/documents/Registry.sol']);
  });

  it('classifies dotfiles and licence directories, which have no extension to strip', () => {
    const { other, code } = partitionScopeFiles([
      '.gitignore',
      '.gitmodules',
      'LICENSES/BUSL-1.1',
      '.env.production',
      'CODEOWNERS',
      'src/Pool.sol',
    ]);
    expect(other.sort()).toEqual(['.env.production', '.gitignore', '.gitmodules', 'CODEOWNERS', 'LICENSES/BUSL-1.1'].sort());
    expect(code).toEqual(['src/Pool.sol']);
  });

  it('handles an empty list', () => {
    expect(partitionScopeFiles([])).toEqual({ code: [], other: [] });
  });
});
