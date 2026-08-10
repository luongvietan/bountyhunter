import { describe, expect, it } from 'vitest';
import { ingestBadge, parseFindingFilters } from '../src/lib/finding-queue';
import { parseRepoKey, sliceSnippet } from '../src/lib/github-snippet';

describe('ingestBadge', () => {
  it('marks findings never opened as unseen', () => {
    expect(ingestBadge({ viewedAt: null, fetchedAt: '2026-08-04T10:00:00.000Z' })).toBe('unseen');
  });

  it('marks re-ingested findings as updated when fetched after view', () => {
    expect(
      ingestBadge({
        viewedAt: '2026-08-04T10:00:00.000Z',
        fetchedAt: '2026-08-04T11:00:00.000Z',
      }),
    ).toBe('updated');
  });

  it('marks viewed findings as seen when ingest did not change them', () => {
    expect(
      ingestBadge({
        viewedAt: '2026-08-04T11:00:00.000Z',
        fetchedAt: '2026-08-04T10:00:00.000Z',
      }),
    ).toBe('seen');
  });
});

describe('parseFindingFilters', () => {
  it('reads severity, rank, program, blocker, and ingest from the query string', () => {
    expect(
      parseFindingFilters({
        severity: 'high',
        rank: '3',
        program: 'prog_1',
        blocker: 'No proof of concept',
        ingest: 'updated',
      }),
    ).toEqual({
      severity: 'high',
      maxBountyRank: 3,
      programId: 'prog_1',
      blocker: 'No proof of concept',
      ingest: 'updated',
    });
  });
});

describe('github snippet helpers', () => {
  it('parses github.com repo keys', () => {
    expect(parseRepoKey('github.com/acme/vault')).toEqual({ owner: 'acme', repo: 'vault' });
  });

  it('highlights the target line in a snippet window', () => {
    const snippet = sliceSnippet(
      'contracts/Vault.sol',
      'abc123',
      'line1\nline2\nline3\n',
      2,
      1,
    );
    expect(snippet.lines.map((row) => row.highlight)).toEqual([false, true, false]);
  });
});
