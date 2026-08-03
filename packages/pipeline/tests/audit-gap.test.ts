import { describe, expect, it } from 'vitest';
import { extractAuditGap, UNAUDITED_CONFIDENCE } from '../src/extractors/audit-gap.js';
import type { CommitRecord } from '@kritt-radar/collectors';

const commits: CommitRecord[] = [
  {
    sha: 'new1',
    authoredAt: '2026-07-20T00:00:00Z',
    files: [
      { path: 'src/Hooks.sol', changedLoc: 120 },
      { path: 'docs/x.md', changedLoc: 10 },
    ],
  },
  {
    sha: 'new2',
    authoredAt: '2026-07-01T00:00:00Z',
    files: [{ path: 'src/Pool.sol', changedLoc: 40 }],
  },
  {
    sha: 'old1',
    authoredAt: '2026-01-10T00:00:00Z',
    files: [{ path: 'src/Old.sol', changedLoc: 900 }],
  },
];

const lastAudit = new Date('2026-06-01T00:00:00Z');

describe('extractAuditGap', () => {
  it('chỉ tính commit sau ngày audit gần nhất', () => {
    const s = extractAuditGap({
      commits,
      lastAuditAt: lastAudit,
      pathGlobs: ['src/**/*.sol'],
      totalLoc: 5000,
    });
    const shas = s.evidence.commits as string[];
    expect(shas).toEqual(['new1', 'new2']);
    expect(shas).not.toContain('old1');
  });

  it('lọc file theo pathGlobs', () => {
    const s = extractAuditGap({
      commits,
      lastAuditAt: lastAudit,
      pathGlobs: ['src/**/*.sol'],
      totalLoc: 5000,
    });
    expect(s.evidence.files).toEqual(['src/Hooks.sol', 'src/Pool.sol']);
  });

  it('churn lớn cho value cao hơn', () => {
    const small = extractAuditGap({
      commits,
      lastAuditAt: lastAudit,
      pathGlobs: [],
      totalLoc: 100000,
    }).value;
    const big = extractAuditGap({
      commits,
      lastAuditAt: lastAudit,
      pathGlobs: [],
      totalLoc: 500,
    }).value;
    expect(big).toBeGreaterThan(small);
  });

  it('đã quét mà không thấy audit thì value = 1 nhưng confidence dưới 1', () => {
    const s = extractAuditGap({
      commits,
      lastAuditAt: null,
      pathGlobs: [],
      totalLoc: 5000,
      auditCoverage: 'searched',
    });
    expect(s.value).toBe(1);
    expect(s.evidence.reason).toBe('no_public_audit');
    // Không phải 1.0: nguồn audit ta quét chỉ phủ vài hãng trong hàng trăm hãng,
    // nên "không tìm thấy" là bằng chứng yếu chứ không phải kết luận.
    expect(s.confidence).toBe(UNAUDITED_CONFIDENCE);
    expect(s.confidence).toBeLessThan(1);
  });

  it('BẤT BIẾN: chưa quét nguồn audit nào thì confidence 0, không phải value 1', () => {
    // Nếu nhánh này trả 1.0 thì MỌI repo được điểm tối đa và audit_gap mất sạch
    // khả năng phân biệt trong khi vẫn ăn đủ trọng số.
    const s = extractAuditGap({ commits, lastAuditAt: null, pathGlobs: [], totalLoc: 5000 });
    expect(s.confidence).toBe(0);
    expect(s.value).toBe(0);
    expect(s.evidence.reason).toBe('audit_coverage_unknown');
  });

  it('mặc định là chưa quét khi người gọi không khai báo', () => {
    const explicit = extractAuditGap({
      commits,
      lastAuditAt: null,
      pathGlobs: [],
      totalLoc: 5000,
      auditCoverage: 'unsearched',
    });
    const implicit = extractAuditGap({ commits, lastAuditAt: null, pathGlobs: [], totalLoc: 5000 });
    expect(implicit).toEqual(explicit);
  });

  it('không có commit nào sau audit thì value = 0 với confidence đầy đủ', () => {
    const s = extractAuditGap({
      commits: [commits[2]!],
      lastAuditAt: lastAudit,
      pathGlobs: [],
      totalLoc: 5000,
    });
    expect(s.value).toBe(0);
    expect(s.confidence).toBe(1);
  });

  it('BẤT BIẾN: không có dữ liệu commit thì confidence 0', () => {
    const s = extractAuditGap({
      commits: [],
      lastAuditAt: lastAudit,
      pathGlobs: [],
      totalLoc: 5000,
      hasCommitData: false,
    });
    expect(s.confidence).toBe(0);
    expect(s.evidence.reason).toBe('no_commit_data');
  });

  it('value luôn nằm trong [0,1] kể cả khi churn vượt totalLoc', () => {
    const s = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: [], totalLoc: 1 });
    expect(s.value).toBeLessThanOrEqual(1);
    expect(s.value).toBeGreaterThanOrEqual(0);
  });

  it('accepts collector changes already bounded by the current audit cutoff', () => {
    const s = extractAuditGap({
      commits: [],
      lastAuditAt: lastAudit,
      pathGlobs: ['src/**/*.sol'],
      totalLoc: 5000,
      changesSinceAudit: {
        files: [
          { path: 'src/Hooks.sol', changedLoc: 120 },
          { path: 'docs/x.md', changedLoc: 10 },
        ],
        commits: ['new1'],
      },
    });

    expect(s.evidence).toMatchObject({
      changedLoc: 120,
      files: ['src/Hooks.sol'],
      commits: ['new1'],
    });
    expect(s.value).toBeGreaterThan(0);
  });
});
