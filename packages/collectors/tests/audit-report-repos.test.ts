import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/audit-tree.json' with { type: 'json' };
import { parseAuditTree } from '../src/sources/audit-report-repos.js';

describe('parseAuditTree', () => {
  it('trích tên dự án và ngày từ tên file report', () => {
    const rs = parseAuditTree(fixture, 'trailofbits', 'github.com/trailofbits/publications');
    expect(rs).toHaveLength(2);
    const u = rs.find((r) => r.projectHint === 'uniswap-v4')!;
    expect(u.firm).toBe('trailofbits');
    expect(u.publishedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('bỏ file không phải report', () => {
    const rs = parseAuditTree(fixture, 'trailofbits', 'github.com/trailofbits/publications');
    expect(rs.some((r) => r.reportUrl.endsWith('README.md'))).toBe(false);
  });

  it('bỏ mục type=tree', () => {
    const rs = parseAuditTree(
      { tree: [{ path: 'reports/2026-04-x.pdf', type: 'tree' }] },
      'f',
      'github.com/a/b',
    );
    expect(rs).toEqual([]);
  });

  it('bỏ file không có tiền tố ngày', () => {
    const rs = parseAuditTree({ tree: [{ path: 'reports/uniswap.pdf', type: 'blob' }] }, 'f', 'github.com/a/b');
    expect(rs).toEqual([]);
  });
});
