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

  it('keeps only scoped blobs and sums their bytes', () => {
    expect(parseTree(treeFixture, ['src/**/*.sol'])).toEqual({
      files: ['src/Pool.sol'],
      totalBytes: 4000,
      truncated: false,
    });
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
});

describe('GitHub repo snapshot requests', () => {
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
});
