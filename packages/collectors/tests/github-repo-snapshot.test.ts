import { describe, expect, it } from 'vitest';
import headFixture from './__fixtures__/github-head.json' with { type: 'json' };
import treeFixture from './__fixtures__/github-tree.json' with { type: 'json' };
import compareFixture from './__fixtures__/github-compare.json' with { type: 'json' };
import {
  makeGithubRepoSnapshots,
  parseCompare,
  parseHead,
  parseTree,
  type RepoTarget,
} from '../src/sources/github-repo-snapshot.js';

const target: RepoTarget = {
  repoKey: 'github.com/acme/protocol',
  pathGlobs: ['src/**/*.sol'],
  lastAuditAt: '2026-07-01T00:00:00.000Z',
  coveredCommit: 'base000',
};

async function collectSnapshot(
  repoTarget: RepoTarget,
  responses: (url: string) => unknown,
) {
  const requests: Array<{
    url: string;
    headers: Record<string, string> | undefined;
  }> = [];
  const collector = makeGithubRepoSnapshots(
    async () => [repoTarget],
    async (url, options) => {
      requests.push({ url, headers: options.headers });
      return responses(url);
    },
  );
  const observations = [];
  for await (const observation of collector.fetch({
    env: { GITHUB_TOKEN: 'github-secret' },
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  })) {
    observations.push(observation);
  }
  return { observation: observations[0]!, requests };
}

describe('GitHub snapshot parsers', () => {
  it('extracts HEAD sha, authored date, and tree sha from a commit response', () => {
    expect(parseHead(headFixture)).toEqual({
      sha: 'abc123',
      authoredAt: '2026-07-31T10:20:30Z',
      treeSha: 'tree456',
    });
  });

  it('accepts a valid ISO authored timestamp with an explicit offset', () => {
    const authoredAt = '2026-07-31T17:20:30+07:00';
    expect(
      parseHead({
        ...headFixture,
        commit: {
          ...headFixture.commit,
          author: { ...headFixture.commit.author, date: authoredAt },
        },
      }).authoredAt,
    ).toBe(authoredAt);
  });

  it('keeps only scoped blobs and sums their bytes', () => {
    expect(parseTree(treeFixture, ['src/**/*.sol'])).toEqual({
      files: ['src/Pool.sol'],
      totalBytes: 4000,
      truncated: false,
    });
  });

  it('accepts a submodule commit tree node without a blob size', () => {
    expect(
      parseTree(
        {
          ...treeFixture,
          tree: [
            {
              path: 'vendor/library',
              mode: '160000',
              type: 'commit',
              sha: 'submodule-sha',
              url: 'https://api.github.com/repos/acme/protocol/git/commits/submodule-sha',
            },
          ],
        },
        [],
      ),
    ).toEqual({ files: [], totalBytes: 0, truncated: false });
  });

  it('preserves recursive-tree truncation', () => {
    expect(parseTree({ ...treeFixture, truncated: true }, [])).toMatchObject({
      truncated: true,
    });
  });

  it('keeps only scoped changes and uses additions plus deletions', () => {
    expect(parseCompare(compareFixture, ['src/**/*.sol'])).toEqual({
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      commits: ['commit-one', 'abc123'],
      truncated: false,
    });
  });

  it('marks a compare response truncated at the GitHub 300-file boundary', () => {
    const file = compareFixture.files[0]!;
    const boundaryFixture = {
      ...compareFixture,
      files: Array.from({ length: 300 }, (_, index) => ({
        ...file,
        filename: `src/File${index}.sol`,
      })),
    };

    expect(parseCompare(boundaryFixture, ['src/**/*.sol']).truncated).toBe(true);
  });

  it('keeps first-page files complete when all 100 commits were returned', () => {
    const commit = compareFixture.commits[0]!;
    const boundaryFixture = {
      ...compareFixture,
      total_commits: 100,
      commits: Array.from({ length: 100 }, (_, index) => ({
        ...commit,
        sha: `commit-${index}`,
      })),
    };

    expect(parseCompare(boundaryFixture, ['src/**/*.sol'])).toMatchObject({
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      truncated: false,
    });
  });

  it('keeps first-page files but marks 101 total commits truncated after 100 returned', () => {
    const commit = compareFixture.commits[0]!;
    const boundaryFixture = {
      ...compareFixture,
      total_commits: 101,
      commits: Array.from({ length: 100 }, (_, index) => ({
        ...commit,
        sha: `commit-${index}`,
      })),
    };

    expect(parseCompare(boundaryFixture, ['src/**/*.sol'])).toMatchObject({
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      truncated: true,
    });
  });

  it.each([
    {
      name: 'a malformed authored timestamp',
      parse: () =>
        parseHead({
          ...headFixture,
          commit: {
            ...headFixture.commit,
            author: { ...headFixture.commit.author, date: '2026-02-30T10:20:30Z' },
          },
        }),
    },
    {
      name: 'an unknown recursive-tree node type',
      parse: () =>
        parseTree(
          {
            ...treeFixture,
            tree: [{ ...treeFixture.tree[0]!, type: 'symlink' }],
          },
          [],
        ),
    },
    {
      name: 'a fractional blob size',
      parse: () =>
        parseTree(
          {
            ...treeFixture,
            tree: [{ ...treeFixture.tree[0]!, size: 1.5 }],
          },
          [],
        ),
    },
    {
      name: 'an infinite blob size',
      parse: () =>
        parseTree(
          {
            ...treeFixture,
            tree: [{ ...treeFixture.tree[0]!, size: Number.POSITIVE_INFINITY }],
          },
          [],
        ),
    },
    {
      name: 'negative additions',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, additions: -1 }],
          },
          [],
        ),
    },
    {
      name: 'fractional additions',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, additions: 1.5 }],
          },
          [],
        ),
    },
    {
      name: 'negative deletions',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, deletions: -1 }],
          },
          [],
        ),
    },
    {
      name: 'fractional deletions',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, deletions: 1.5 }],
          },
          [],
        ),
    },
    {
      name: 'negative changes',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, changes: -1 }],
          },
          [],
        ),
    },
    {
      name: 'fractional changes',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, changes: 1.5 }],
          },
          [],
        ),
    },
    {
      name: 'changes inconsistent with additions and deletions',
      parse: () =>
        parseCompare(
          {
            ...compareFixture,
            files: [{ ...compareFixture.files[0]!, changes: 99 }],
          },
          [],
        ),
    },
    {
      name: 'negative total commits',
      parse: () => parseCompare({ ...compareFixture, total_commits: -1 }, []),
    },
    {
      name: 'fractional total commits',
      parse: () => parseCompare({ ...compareFixture, total_commits: 1.5 }, []),
    },
    {
      name: 'total commits below the returned commit count',
      parse: () => parseCompare({ ...compareFixture, total_commits: 1 }, []),
    },
  ])('rejects $name', ({ parse }) => {
    expect(parse).toThrow();
  });
});

describe('GitHub repo snapshot requests', () => {
  it('accepts GitHub owner and repository punctuation permitted in canonical keys', async () => {
    const punctuatedTarget: RepoTarget = {
      ...target,
      repoKey: 'github.com/acme-labs/protocol_v2.core-test',
      lastAuditAt: null,
      coveredCommit: null,
    };
    const { observation, requests } = await collectSnapshot(punctuatedTarget, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return treeFixture;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/acme-labs/protocol_v2.core-test/commits/HEAD',
      'https://api.github.com/repos/acme-labs/protocol_v2.core-test/git/trees/tree456?recursive=1',
    ]);
    expect(observation.health).toEqual({ ok: true });
  });

  it.each([
    ['query injection', 'github.com/acme/protocol?per_page=1'],
    ['fragment injection', 'github.com/acme/protocol#fragment'],
    ['percent-encoded path injection', 'github.com/acme/protocol%2Fcommits'],
    ['control character', 'github.com/acme/proto\ncontrol'],
    ['extra path segment', 'github.com/acme/protocol/extra'],
    ['malformed owner', 'github.com/-acme/protocol'],
    ['owner underscore', 'github.com/acme_labs/protocol'],
    ['dot-only repository', 'github.com/acme/..'],
  ])('rejects %s in repo keys before issuing a request', async (_name, repoKey) => {
    let requestCount = 0;
    const collector = makeGithubRepoSnapshots(
      async () => [{ ...target, repoKey, lastAuditAt: null, coveredCommit: null }],
      async (url) => {
        requestCount++;
        if (url.includes('/commits/HEAD')) return headFixture;
        if (url.includes('/git/trees/')) return treeFixture;
        throw new Error(`unexpected request: ${url}`);
      },
    );
    const observations = [];
    for await (const observation of collector.fetch({
      env: { GITHUB_TOKEN: 'github-secret' },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    })) {
      observations.push(observation);
    }

    expect(requestCount).toBe(0);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      health: { ok: false },
      payload: {
        repoKey,
        complete: false,
        error: expect.stringContaining('invalid GitHub repo key'),
      },
    });
  });

  it('fetches HEAD, scoped tree, and covered-commit compare with official headers', async () => {
    const { observation, requests } = await collectSnapshot(target, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return treeFixture;
      if (url.includes('/compare/')) return compareFixture;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/acme/protocol/commits/HEAD',
      'https://api.github.com/repos/acme/protocol/git/trees/tree456?recursive=1',
      'https://api.github.com/repos/acme/protocol/compare/base000...abc123?per_page=100&page=1',
    ]);
    expect(requests.map((request) => request.headers)).toEqual([
      {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        authorization: 'Bearer github-secret',
      },
      {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        authorization: 'Bearer github-secret',
      },
      {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        authorization: 'Bearer github-secret',
      },
    ]);
    expect(observation.payload).toEqual({
      repoKey: 'github.com/acme/protocol',
      cutoff: {
        lastAuditAt: '2026-07-01T00:00:00.000Z',
        baseCommit: 'base000',
      },
      headSha: 'abc123',
      headAuthoredAt: '2026-07-31T10:20:30Z',
      files: ['src/Pool.sol'],
      totalLoc: 100,
      locMethod: 'estimated_from_bytes',
      changedFiles: [{ path: 'src/Pool.sol', changedLoc: 42 }],
      commits: ['commit-one', 'abc123'],
      complete: true,
      truncated: false,
      error: null,
    });
  });

  it('finds the latest commit at the audit date before comparing when no commit is covered', async () => {
    const datedTarget = { ...target, coveredCommit: null };
    const baseFixture = { ...headFixture, sha: 'dated-base' };
    const { observation, requests } = await collectSnapshot(datedTarget, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return treeFixture;
      if (url.includes('/commits?until=')) return [baseFixture];
      if (url.includes('/compare/')) return compareFixture;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/acme/protocol/commits/HEAD',
      'https://api.github.com/repos/acme/protocol/git/trees/tree456?recursive=1',
      'https://api.github.com/repos/acme/protocol/commits?until=2026-07-01T00%3A00%3A00.000Z&per_page=1',
      'https://api.github.com/repos/acme/protocol/compare/dated-base...abc123?per_page=100&page=1',
    ]);
    expect(observation.payload.cutoff).toEqual({
      lastAuditAt: '2026-07-01T00:00:00.000Z',
      baseCommit: 'dated-base',
    });
  });

  it('does not compare a repo with no public audit and rounds estimated LOC up', async () => {
    const unauditedTarget = { ...target, lastAuditAt: null, coveredCommit: null };
    const unevenTree = {
      ...treeFixture,
      tree: treeFixture.tree.map((node) =>
        node.path === 'src/Pool.sol' ? { ...node, size: 4001 } : node,
      ),
    };
    const { observation, requests } = await collectSnapshot(
      unauditedTarget,
      (url) => {
        if (url.includes('/commits/HEAD')) return headFixture;
        if (url.includes('/git/trees/')) return unevenTree;
        throw new Error(`unexpected request: ${url}`);
      },
    );

    expect(requests).toHaveLength(2);
    expect(observation.payload).toMatchObject({
      totalLoc: 101,
      changedFiles: [],
      commits: [],
      complete: true,
      truncated: false,
    });
  });

  it('marks a truncated recursive tree incomplete', async () => {
    const unauditedTarget = { ...target, lastAuditAt: null, coveredCommit: null };
    const { observation } = await collectSnapshot(unauditedTarget, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return { ...treeFixture, truncated: true };
      throw new Error(`unexpected request: ${url}`);
    });

    expect(observation.payload).toMatchObject({
      complete: false,
      truncated: true,
    });
  });

  it('marks a compare at the 300-file boundary incomplete even after path scoping', async () => {
    const firstFile = compareFixture.files[0]!;
    const boundaryCompare = {
      ...compareFixture,
      files: Array.from({ length: 300 }, (_, index) => ({
        ...firstFile,
        filename: index === 0 ? 'src/Pool.sol' : `docs/File${index}.md`,
      })),
    };
    const { observation } = await collectSnapshot(target, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return treeFixture;
      if (url.includes('/compare/')) return boundaryCompare;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(observation.payload.changedFiles).toEqual([
      { path: 'src/Pool.sol', changedLoc: 42 },
    ]);
    expect(observation.payload).toMatchObject({
      complete: false,
      truncated: true,
    });
  });

  it('marks 101 total commits incomplete while preserving first-page files', async () => {
    const commit = compareFixture.commits[0]!;
    const pagedCompare = {
      ...compareFixture,
      total_commits: 101,
      commits: Array.from({ length: 100 }, (_, index) => ({
        ...commit,
        sha: `commit-${index}`,
      })),
    };
    const { observation } = await collectSnapshot(target, (url) => {
      if (url.includes('/commits/HEAD')) return headFixture;
      if (url.includes('/git/trees/')) return treeFixture;
      if (url.includes('/compare/')) return pagedCompare;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(observation.payload.changedFiles).toEqual([
      { path: 'src/Pool.sol', changedLoc: 42 },
    ]);
    expect(observation.payload).toMatchObject({
      complete: false,
      truncated: true,
    });
  });

  it('yields a failed observation and continues with the next repository', async () => {
    const brokenTarget = {
      ...target,
      repoKey: 'github.com/acme/broken',
      lastAuditAt: null,
      coveredCommit: null,
    };
    const collector = makeGithubRepoSnapshots(
      async () => [brokenTarget, target],
      async (url) => {
        if (url.includes('/acme/broken/')) throw new Error('first repo unavailable');
        if (url.includes('/commits/HEAD')) return headFixture;
        if (url.includes('/git/trees/')) return treeFixture;
        if (url.includes('/compare/')) return compareFixture;
        throw new Error(`unexpected request: ${url}`);
      },
    );
    const observations = [];
    for await (const observation of collector.fetch({
      env: { GITHUB_TOKEN: 'github-secret' },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    })) {
      observations.push(observation);
    }

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      health: { ok: false, error: 'first repo unavailable' },
      payload: {
        repoKey: 'github.com/acme/broken',
        cutoff: { lastAuditAt: null, baseCommit: null },
        headSha: null,
        headAuthoredAt: null,
        files: [],
        totalLoc: 0,
        locMethod: 'estimated_from_bytes',
        changedFiles: [],
        commits: [],
        complete: false,
        truncated: false,
        error: 'first repo unavailable',
      },
    });
    expect(observations[1]).toMatchObject({
      health: { ok: true },
      payload: {
        repoKey: 'github.com/acme/protocol',
        complete: true,
        error: null,
      },
    });
  });

  it.each([
    {
      name: 'malformed authored timestamp',
      stage: 'head',
      raw: {
        ...headFixture,
        commit: {
          ...headFixture.commit,
          author: { ...headFixture.commit.author, date: 'not-an-iso-timestamp' },
        },
      },
    },
    {
      name: 'unknown tree node type',
      stage: 'tree',
      raw: {
        ...treeFixture,
        tree: [{ ...treeFixture.tree[0]!, type: 'symlink' }],
      },
    },
    {
      name: 'fractional blob size',
      stage: 'tree',
      raw: {
        ...treeFixture,
        tree: [{ ...treeFixture.tree[0]!, size: 1.5 }],
      },
    },
    {
      name: 'fractional changed-line count',
      stage: 'compare',
      raw: {
        ...compareFixture,
        files: [{ ...compareFixture.files[0]!, additions: 1.5 }],
      },
    },
    {
      name: 'negative total commit count',
      stage: 'compare',
      raw: { ...compareFixture, total_commits: -1 },
    },
    {
      name: 'inconsistent compare file counts',
      stage: 'compare',
      raw: {
        ...compareFixture,
        files: [{ ...compareFixture.files[0]!, changes: 99 }],
      },
    },
  ])('turns $name into a failed observation', async ({ stage, raw }) => {
    const { observation } = await collectSnapshot(target, (url) => {
      if (url.includes('/commits/HEAD')) return stage === 'head' ? raw : headFixture;
      if (url.includes('/git/trees/')) return stage === 'tree' ? raw : treeFixture;
      if (url.includes('/compare/')) return stage === 'compare' ? raw : compareFixture;
      throw new Error(`unexpected request: ${url}`);
    });

    expect(observation.health?.ok).toBe(false);
    expect(observation.payload.complete).toBe(false);
    expect(observation.payload.error).toEqual(expect.any(String));
  });
});
