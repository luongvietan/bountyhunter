import type { ImmunefiProgramPayload, ProgramPayload } from '@kritt-radar/collectors';

export interface ObservationRow {
  sourceUrl: string;
  fetchedAt: Date;
  payload: unknown;
}

export interface LatestObservation {
  sourceUrl: string;
  /** Lần gần nhất NỘI DUNG đổi; null nếu mới chỉ thấy source đúng một lần. */
  changedAt: Date | null;
  payload: unknown;
}

/**
 * Observation là append-only và chỉ ghi thêm khi contentHash đổi, nên bản mới
 * nhất của một sourceUrl vừa là trạng thái hiện tại, vừa cho biết nội dung đổi
 * lần cuối khi nào — đó chính là tín hiệu "scope vừa mở rộng".
 */
export function latestBySourceUrl(rows: readonly ObservationRow[]): LatestObservation[] {
  const grouped = new Map<string, { latest: ObservationRow; count: number }>();
  for (const r of rows) {
    const cur = grouped.get(r.sourceUrl);
    if (!cur) {
      grouped.set(r.sourceUrl, { latest: r, count: 1 });
      continue;
    }
    cur.count += 1;
    if (r.fetchedAt.getTime() > cur.latest.fetchedAt.getTime()) cur.latest = r;
  }
  return [...grouped.values()].map(({ latest, count }) => ({
    sourceUrl: latest.sourceUrl,
    // Lần crawl đầu chỉ cho biết "ta vừa nhìn thấy", không chứng minh scope vừa đổi.
    changedAt: count > 1 ? latest.fetchedAt : null,
    payload: latest.payload,
  }));
}

export interface ProgramFields {
  platform: string;
  externalId: string;
  title: string;
  url: string;
  poolUsd: number | null;
  kind: string;
  publishedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface ProgramRecord {
  program: ProgramFields;
  scope: {
    kind: 'repo';
    hardKey: string;
    repoUrl: string;
    pathGlobs: string[];
  };
  changedAt: Date | null;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function isProgramPayload(v: unknown): v is ProgramPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ProgramPayload).platform === 'string' &&
    typeof (v as ProgramPayload).externalId === 'string'
  );
}

/** Bỏ program không có repo: không có code thì không tính được audit_gap. */
export function toProgramRecords(rows: readonly LatestObservation[]): ProgramRecord[] {
  const out: ProgramRecord[] = [];
  for (const row of rows) {
    if (!isProgramPayload(row.payload)) continue;
    const p = row.payload;
    if (!p.repoUrl) continue;

    out.push({
      program: {
        platform: p.platform,
        externalId: p.externalId,
        title: p.title,
        url: p.url,
        poolUsd: p.poolUsd,
        kind: p.kind,
        publishedAt: toDate(p.publishedAt),
        startsAt: toDate(p.startsAt),
        endsAt: toDate(p.endsAt),
      },
      scope: { kind: 'repo', hardKey: p.repoUrl, repoUrl: p.repoUrl, pathGlobs: [] },
      changedAt: row.changedAt,
    });
  }
  return out;
}

export interface ScopeRecord {
  kind: 'repo';
  hardKey: string;
  repoUrl: string;
  pathGlobs: string[];
  /** Ngày asset được thêm vào scope. null = mirror không cho biết. */
  addedAt: Date | null;
}

export interface ProgramAuditRecord {
  /** Khoá duy nhất toàn cục do Immunefi cấp. */
  auditId: string;
  firm: string;
  publishedAt: Date;
  /**
   * URL neo về chính program.
   *
   * KHÔNG dùng url gốc của Immunefi làm khoá: 237 audit chỉ có 222 url khác
   * nhau, nên nó trùng và sẽ va vào ràng buộc unique của AuditReport.
   */
  reportUrl: string;
}

export interface MultiScopeRecord {
  program: ProgramFields;
  scopes: ScopeRecord[];
  audits: ProgramAuditRecord[];
  changedAt: Date | null;
}

/**
 * Audit mà Immunefi khai ngay trên program.
 *
 * Đây là cầu nối duy nhất hiện có giữa bằng chứng audit và repo: nó gắn sẵn vào
 * program nên không phải khớp tên dự án, cách vốn chỉ trúng dưới 1%.
 */
function toProgramAudits(payload: ImmunefiProgramPayload): ProgramAuditRecord[] {
  const byId = new Map<string, ProgramAuditRecord>();
  for (const audit of payload.audits ?? []) {
    const publishedAt = toDate(audit.date);
    // Ngày hỏng thì bỏ: một mốc audit sai còn tệ hơn không có mốc nào, vì
    // audit_gap sẽ tính diff từ một điểm không tồn tại.
    if (!publishedAt) continue;
    byId.set(audit.auditId, {
      auditId: audit.auditId,
      firm: audit.auditor?.trim() || 'unknown',
      publishedAt,
      reportUrl: `https://immunefi.com/bounty/${payload.externalId}/#audit-${audit.auditId}`,
    });
  }
  return [...byId.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function isImmunefiPayload(v: unknown): v is ImmunefiProgramPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as ImmunefiProgramPayload).platform === 'immunefi' &&
    Array.isArray((v as ImmunefiProgramPayload).assets)
  );
}

/**
 * Một program Immunefi có nhiều repo trong scope, mỗi repo chấm điểm riêng.
 *
 * Immunefi thường liệt kê cùng một repo nhiều lần dưới các asset khác nhau
 * (khác path, khác mô tả). Gộp theo repoKey và giữ addedAt MỚI NHẤT: không gộp
 * thì một repo chiếm nhiều dòng xếp hạng, còn giữ bản cũ nhất thì freshness bị
 * đánh giá thấp hơn thực tế.
 */
export function toImmunefiRecords(rows: readonly LatestObservation[]): MultiScopeRecord[] {
  const out: MultiScopeRecord[] = [];

  for (const row of rows) {
    if (!isImmunefiPayload(row.payload)) continue;
    const p = row.payload;

    const byRepo = new Map<string, ScopeRecord>();
    for (const a of p.assets) {
      const addedAt = toDate(a.addedAt);
      const existing = byRepo.get(a.repoKey);
      if (existing) {
        const currentMs = existing.addedAt?.getTime() ?? -Infinity;
        const nextMs = addedAt?.getTime() ?? -Infinity;
        if (nextMs > currentMs) existing.addedAt = addedAt;
        continue;
      }
      byRepo.set(a.repoKey, {
        kind: 'repo',
        hardKey: a.repoKey,
        repoUrl: a.repoKey,
        pathGlobs: [],
        addedAt,
      });
    }

    out.push({
      program: {
        platform: p.platform,
        externalId: p.externalId,
        title: p.title,
        url: p.url,
        poolUsd: p.poolUsd,
        kind: p.kind,
        publishedAt: toDate(p.publishedAt),
        startsAt: toDate(p.publishedAt),
        endsAt: null,
      },
      scopes: [...byRepo.values()],
      audits: toProgramAudits(p),
      changedAt: row.changedAt,
    });
  }
  return out;
}
