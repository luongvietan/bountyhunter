import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const RawCommit = z.object({
  sha: z.string(),
  commit: z.object({ author: z.object({ date: z.string() }).partial() }).partial(),
  files: z
    .array(z.object({ filename: z.string(), additions: z.number(), deletions: z.number() }))
    .optional(),
});

export interface CommitFile {
  path: string;
  changedLoc: number;
}

export interface CommitRecord {
  sha: string;
  authoredAt: string;
  files: CommitFile[];
}

export interface RepoActivityPayload {
  repoKey: string;
  commits: CommitRecord[];
}

/** Glob tối giản: `**` vượt gạch chéo, `*` thì không. Đủ cho path scope. */
export function matchesGlobs(path: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return true;
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

export function parseCommits(raw: unknown): CommitRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CommitRecord[] = [];
  for (const item of raw) {
    const parsed = RawCommit.safeParse(item);
    if (!parsed.success) continue;
    const date = parsed.data.commit?.author?.date;
    if (!date) continue;
    out.push({
      sha: parsed.data.sha,
      authoredAt: date,
      files: (parsed.data.files ?? []).map((f) => ({
        path: f.filename,
        changedLoc: f.additions + f.deletions,
      })),
    });
  }
  return out;
}

const rateLimit = { rps: 2, burst: 5 };

/**
 * Lấy commit của các repo đã biết.
 * `listRepoKeys` được tiêm vào để test không phải chạm DB.
 */
export function makeGithubRepoActivity(
  listRepoKeys: () => Promise<string[]>,
): Collector<RepoActivityPayload> {
  return {
    id: 'github-repo-activity',
    cadence: '0 */6 * * *',
    rateLimit,
    requiresCredential: 'GITHUB_TOKEN',
    async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<RepoActivityPayload>> {
      const token = ctx.env.GITHUB_TOKEN;
      const repoKeys = await listRepoKeys();

      for (const key of repoKeys) {
        const [, owner, name] = key.split('/');
        if (!owner || !name) continue;
        const url = `https://api.github.com/repos/${owner}/${name}/commits?per_page=100`;
        const raw = await fetchJson<unknown>(url, {
          limit: rateLimit,
          headers: {
            accept: 'application/vnd.github+json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload: RepoActivityPayload = { repoKey: key, commits: parseCommits(raw) };
        yield makeObservation('github-repo-activity', url, payload);
      }
    },
  };
}
