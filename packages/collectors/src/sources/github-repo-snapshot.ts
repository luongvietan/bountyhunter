import { z } from 'zod';
import { fetchJson } from '../http.js';
import {
  contentHash,
  makeObservation,
  type Collector,
  type FetchCtx,
  type RawObservation,
} from '../types.js';
import { matchesGlobs } from './github-repo-activity.js';

const NonNegativeInteger = z.number().finite().int().nonnegative();

const HeadResponse = z.object({
  sha: z.string().min(1),
  commit: z.object({
    author: z.object({ date: z.string().datetime({ offset: true }) }),
    tree: z.object({ sha: z.string().min(1) }),
  }),
});

const TreeResponse = z.object({
  tree: z.array(
    z.discriminatedUnion('type', [
      z.object({
        path: z.string().min(1),
        type: z.literal('blob'),
        size: NonNegativeInteger,
      }),
      z.object({
        path: z.string().min(1),
        type: z.literal('tree'),
        size: NonNegativeInteger.optional(),
      }),
      z.object({
        path: z.string().min(1),
        type: z.literal('commit'),
        size: NonNegativeInteger.optional(),
      }),
    ]),
  ),
  truncated: z.boolean(),
});

const CompareResponse = z
  .object({
    total_commits: NonNegativeInteger,
    commits: z.array(z.object({ sha: z.string().min(1) })),
    files: z
      .array(
        z.object({
          filename: z.string().min(1),
          additions: NonNegativeInteger,
          deletions: NonNegativeInteger,
          changes: NonNegativeInteger,
        }),
      )
      .optional(),
  })
  .superRefine((response, ctx) => {
    if (response.total_commits < response.commits.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_commits'],
        message: 'total_commits cannot be lower than the returned commit count',
      });
    }

    response.files?.forEach((file, index) => {
      if (file.changes !== file.additions + file.deletions) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files', index, 'changes'],
          message: 'changes must equal additions plus deletions',
        });
      }
    });
  });

/**
 * May legitimately be empty: asking for the newest commit at or before the
 * audit date returns nothing when the repository was created after the audit.
 */
const BaseCommitResponse = z.array(z.object({ sha: z.string().min(1) }));

export interface RepoTarget {
  repoKey: string;
  pathGlobs: string[];
  lastAuditAt: string | null;
  coveredCommit: string | null;
}

export interface RepoSnapshotPayload {
  repoKey: string;
  cutoff: { lastAuditAt: string | null; baseCommit: string | null };
  headSha: string | null;
  headAuthoredAt: string | null;
  files: string[];
  totalLoc: number;
  locMethod: 'estimated_from_bytes';
  changedFiles: Array<{ path: string; changedLoc: number }>;
  commits: string[];
  /**
   * The audit predates the repository's first commit, so every file in it is
   * unreviewed relative to that audit. Distinct from "no audit known".
   */
  auditPredatesRepo: boolean;
  complete: boolean;
  truncated: boolean;
  error: string | null;
}

export interface ParsedHead {
  sha: string;
  authoredAt: string;
  treeSha: string;
}

export interface ParsedTree {
  files: string[];
  totalBytes: number;
  truncated: boolean;
}

export interface ParsedCompare {
  changedFiles: Array<{ path: string; changedLoc: number }>;
  commits: string[];
  truncated: boolean;
}

export function parseHead(raw: unknown): ParsedHead {
  const head = HeadResponse.parse(raw);
  return {
    sha: head.sha,
    authoredAt: head.commit.author.date,
    treeSha: head.commit.tree.sha,
  };
}

export function parseTree(raw: unknown, pathGlobs: readonly string[]): ParsedTree {
  const response = TreeResponse.parse(raw);
  const files: string[] = [];
  let totalBytes = 0;

  for (const node of response.tree) {
    if (node.type !== 'blob' || !matchesGlobs(node.path, pathGlobs)) continue;
    files.push(node.path);
    totalBytes += node.size;
  }

  return { files, totalBytes, truncated: response.truncated };
}

export function parseCompare(raw: unknown, pathGlobs: readonly string[]): ParsedCompare {
  const response = CompareResponse.parse(raw);
  const files = response.files;
  return {
    changedFiles: (files ?? [])
      .filter((file) => matchesGlobs(file.filename, pathGlobs))
      .map((file) => ({
        path: file.filename,
        changedLoc: file.additions + file.deletions,
      })),
    commits: response.commits.map((commit) => commit.sha),
    truncated:
      files === undefined ||
      files.length >= 300 ||
      response.commits.length < response.total_commits,
  };
}

type GithubRequestOptions = Parameters<typeof fetchJson>[1];
export type GithubJsonFetcher = (
  url: string,
  options: GithubRequestOptions,
) => Promise<unknown>;

const unauthenticatedRateLimit = { rps: 2, burst: 5 };
const authenticatedRateLimit = { rps: 5, burst: 10 };

function githubRateLimit(token?: string) {
  return token ? authenticatedRateLimit : unauthenticatedRateLimit;
}

const defaultGithubJsonFetcher: GithubJsonFetcher = (url, options) =>
  fetchJson<unknown>(url, options);

const GithubOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GithubRepo = /^[A-Za-z0-9._-]{1,100}$/;

function repoApiBase(repoKey: string): string {
  const [host, owner, repo, ...extra] = repoKey.split('/');
  if (
    host !== 'github.com' ||
    !owner ||
    !repo ||
    extra.length > 0 ||
    !GithubOwner.test(owner) ||
    !GithubRepo.test(repo) ||
    repo === '.' ||
    repo === '..'
  ) {
    throw new Error(`invalid GitHub repo key: ${repoKey}`);
  }
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function githubRepoSnapshotSourceKey(target: RepoTarget): string {
  const targetHash = contentHash({
    repoKey: target.repoKey,
    pathGlobs: [...new Set(target.pathGlobs)].sort(),
    lastAuditAt: target.lastAuditAt,
    coveredCommit: target.coveredCommit,
  });
  let sourceBase = 'https://api.github.com/';
  try {
    sourceBase = repoApiBase(target.repoKey);
  } catch {
    // Invalid targets are still isolated observations; request validation happens below.
  }
  return `${sourceBase}?kritt_target=${targetHash}`;
}

export function makeGithubRepoSnapshots(
  listTargets: () => Promise<RepoTarget[]>,
  requestJson: GithubJsonFetcher = defaultGithubJsonFetcher,
): Collector<RepoSnapshotPayload> {
  return {
    id: 'github-repo-snapshot',
    cadence: '0 */6 * * *',
    rateLimit: authenticatedRateLimit,
    requiresCredential: 'GITHUB_TOKEN',
    async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<RepoSnapshotPayload>> {
      const targets = await listTargets();
      const headers = {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(ctx.env.GITHUB_TOKEN
          ? { authorization: `Bearer ${ctx.env.GITHUB_TOKEN}` }
          : {}),
      };

      for (const target of targets) {
        let baseCommit = target.coveredCommit;
        const sourceUrl = githubRepoSnapshotSourceKey(target);
        let auditPredatesRepo = false;
        let head: ParsedHead | null = null;
        let tree: ParsedTree | null = null;
        let compare: ParsedCompare = { changedFiles: [], commits: [], truncated: false };

        try {
          const apiBase = repoApiBase(target.repoKey);
          const options = { limit: githubRateLimit(ctx.env.GITHUB_TOKEN), headers };
          head = parseHead(
            await requestJson(`${apiBase}/commits/HEAD`, options),
          );
          tree = parseTree(
            await requestJson(
              `${apiBase}/git/trees/${encodeURIComponent(head.treeSha)}?recursive=1`,
              options,
            ),
            target.pathGlobs,
          );

          if (!baseCommit && target.lastAuditAt) {
            const baseResponse = BaseCommitResponse.parse(
              await requestJson(
                `${apiBase}/commits?until=${encodeURIComponent(target.lastAuditAt)}&per_page=1`,
                options,
              ),
            );
            baseCommit = baseResponse[0]?.sha ?? null;
            auditPredatesRepo = baseCommit === null;
          }

          if (baseCommit) {
            compare = parseCompare(
              await requestJson(
                `${apiBase}/compare/${encodeURIComponent(baseCommit)}...${encodeURIComponent(head.sha)}?per_page=100&page=1`,
                options,
              ),
              target.pathGlobs,
            );
          }

          const truncated = tree.truncated || compare.truncated;
          const payload: RepoSnapshotPayload = {
            repoKey: target.repoKey,
            cutoff: { lastAuditAt: target.lastAuditAt, baseCommit },
            headSha: head.sha,
            headAuthoredAt: head.authoredAt,
            files: tree.files,
            totalLoc: Math.ceil(tree.totalBytes / 40),
            locMethod: 'estimated_from_bytes',
            changedFiles: compare.changedFiles,
            commits: compare.commits,
            auditPredatesRepo,
            complete: !truncated,
            truncated,
            error: null,
          };

          yield makeObservation('github-repo-snapshot', sourceUrl, payload, {
            ok: true,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const truncated = Boolean(tree?.truncated || compare.truncated);
          const payload: RepoSnapshotPayload = {
            repoKey: target.repoKey,
            cutoff: { lastAuditAt: target.lastAuditAt, baseCommit },
            headSha: head?.sha ?? null,
            headAuthoredAt: head?.authoredAt ?? null,
            files: tree?.files ?? [],
            totalLoc: tree ? Math.ceil(tree.totalBytes / 40) : 0,
            locMethod: 'estimated_from_bytes',
            changedFiles: compare.changedFiles,
            commits: compare.commits,
            auditPredatesRepo,
            complete: false,
            truncated,
            error,
          };

          yield makeObservation('github-repo-snapshot', sourceUrl, payload, {
            ok: false,
            error,
          });
        }
      }
    },
  };
}
