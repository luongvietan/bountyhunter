import { clamp01, type SignalValue } from '@kritt-radar/core';
import { matchesGlobs, type CommitFile, type CommitRecord } from '@kritt-radar/collectors';

export interface AuditGapInput {
  commits: readonly CommitRecord[];
  /** null nghĩa là chưa tìm thấy audit công khai nào. */
  lastAuditAt: Date | null;
  pathGlobs: readonly string[];
  totalLoc: number;
  /** false nghĩa là chưa crawl được commit, khác hẳn "crawl rồi và không có commit nào". */
  hasCommitData?: boolean;
  /** Compare results already bounded by the audit cutoff at collection time. */
  changesSinceAudit?: {
    files: readonly CommitFile[];
    commits: readonly string[];
  };
}

/**
 * Bao nhiêu phần của scope đã đổi kể từ lần audit công khai gần nhất.
 *
 * Dùng tỉ lệ log để một repo khổng lồ đổi 200 dòng không bị chấm ngang một repo
 * nhỏ bị viết lại toàn bộ. `evidence.files` chính là danh sách dán thẳng vào
 * scope của một scan Open-Kritt.
 */
export function extractAuditGap(input: AuditGapInput): SignalValue {
  const hasCommitData =
    input.hasCommitData ?? (input.changesSinceAudit !== undefined || input.commits.length > 0);

  if (!hasCommitData) {
    return { type: 'audit_gap', value: 0, confidence: 0, evidence: { reason: 'no_commit_data' } };
  }

  if (input.lastAuditAt === null) {
    return {
      type: 'audit_gap',
      value: 1,
      confidence: 1,
      evidence: {
        reason: 'no_public_audit',
        files: collectFiles(input.commits, input.pathGlobs),
        commits: input.commits.map((c) => c.sha),
      },
    };
  }

  const cutoff = input.lastAuditAt.getTime();
  const changesSinceAudit = input.changesSinceAudit;
  const newer = changesSinceAudit
    ? []
    : input.commits.filter((c) => {
        const t = Date.parse(c.authoredAt);
        return Number.isFinite(t) && t > cutoff;
      });
  const changedFiles = changesSinceAudit?.files ?? newer.flatMap((commit) => commit.files);

  let changedLoc = 0;
  const files = new Set<string>();
  for (const f of changedFiles) {
    if (!matchesGlobs(f.path, input.pathGlobs)) continue;
    files.add(f.path);
    changedLoc += f.changedLoc;
  }

  const denom = Math.log1p(Math.max(input.totalLoc, 1));
  const value = denom > 0 ? clamp01(Math.log1p(changedLoc) / denom) : 0;

  return {
    type: 'audit_gap',
    value,
    confidence: 1,
    evidence: {
      sinceDate: input.lastAuditAt.toISOString(),
      changedLoc,
      totalLoc: input.totalLoc,
      files: [...files],
      commits: changesSinceAudit?.commits ?? newer.map((c) => c.sha),
    },
  };
}

function collectFiles(commits: readonly CommitRecord[], globs: readonly string[]): string[] {
  const s = new Set<string>();
  for (const c of commits) for (const f of c.files) if (matchesGlobs(f.path, globs)) s.add(f.path);
  return [...s];
}
