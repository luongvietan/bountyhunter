import { clamp01, type SignalValue } from '@kritt-radar/core';
import { matchesGlobs, type CommitFile, type CommitRecord } from '@kritt-radar/collectors';

/**
 * Ta đã thật sự đi tìm audit của repo này chưa.
 *
 * `unsearched` nghĩa là chưa nguồn audit nào chạy thành công, nên `lastAuditAt`
 * bằng null KHÔNG nói lên điều gì về repo. `searched` nghĩa là đã quét và không
 * thấy report nào.
 */
export type AuditCoverage = 'unsearched' | 'searched';

/**
 * Mức tin cậy khi đã quét mà không thấy audit nào.
 *
 * Không phải 1.0: các nguồn audit ta quét chỉ phủ được vài hãng, trong khi thị
 * trường có hàng trăm. Không tìm thấy report là bằng chứng yếu cho việc repo
 * chưa từng được audit — đủ để xếp hạng cao, không đủ để chắc chắn.
 */
export const UNAUDITED_CONFIDENCE = 0.35;

export interface AuditGapInput {
  commits: readonly CommitRecord[];
  /** null nghĩa là không có ngày audit nào; đọc kèm `auditCoverage` mới đủ nghĩa. */
  lastAuditAt: Date | null;
  pathGlobs: readonly string[];
  totalLoc: number;
  /** false nghĩa là chưa crawl được commit, khác hẳn "crawl rồi và không có commit nào". */
  hasCommitData?: boolean;
  /** Mặc định `unsearched`: chưa chứng minh được là đã quét thì không được tự tin. */
  auditCoverage?: AuditCoverage;
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
    const coverage = input.auditCoverage ?? 'unsearched';
    // Chưa quét nguồn audit nào thì null không phải là "chưa từng audit" — nó là
    // "ta không biết". Chấm 1.0 ở đây sẽ cho MỌI repo điểm tối đa và tín hiệu
    // mất sạch khả năng phân biệt trong khi vẫn ăn đủ trọng số.
    if (coverage === 'unsearched') {
      return {
        type: 'audit_gap',
        value: 0,
        confidence: 0,
        evidence: { reason: 'audit_coverage_unknown' },
      };
    }
    return {
      type: 'audit_gap',
      value: 1,
      confidence: UNAUDITED_CONFIDENCE,
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
