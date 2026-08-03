import { describe, expect, it } from 'vitest';
import { toProgramRecords, latestBySourceUrl, toImmunefiRecords } from '../src/materialize.js';

const obs = [
  {
    collectorId: 'c4-contests',
    sourceUrl: 'https://code4rena.com/contests/412',
    fetchedAt: new Date('2026-08-01T00:00:00Z'),
    payload: {
      platform: 'code4rena',
      externalId: '412',
      title: 'Acme Vault',
      url: 'https://code4rena.com/contests/412',
      poolUsd: 100000,
      kind: 'contest',
      publishedAt: '2026-07-28T14:00:00Z',
      startsAt: '2026-07-28T14:00:00Z',
      endsAt: '2026-08-04T14:00:00Z',
      repoUrl: 'github.com/code-423n4/2026-07-acme',
      sponsor: 'Acme',
    },
  },
  {
    collectorId: 'c4-contests',
    sourceUrl: 'https://code4rena.com/contests/412',
    fetchedAt: new Date('2026-08-03T00:00:00Z'),
    payload: {
      platform: 'code4rena',
      externalId: '412',
      title: 'Acme Vault v2',
      url: 'https://code4rena.com/contests/412',
      poolUsd: 150000,
      kind: 'contest',
      publishedAt: '2026-07-28T14:00:00Z',
      startsAt: '2026-07-28T14:00:00Z',
      endsAt: '2026-08-04T14:00:00Z',
      repoUrl: 'github.com/code-423n4/2026-07-acme',
      sponsor: 'Acme',
    },
  },
];

describe('latestBySourceUrl', () => {
  it('giữ bản fetch mới nhất cho mỗi sourceUrl', () => {
    const out = latestBySourceUrl(obs);
    expect(out).toHaveLength(1);
    expect((out[0]!.payload as { title: string }).title).toBe('Acme Vault v2');
  });

  it('ghi lại thời điểm nội dung đổi lần gần nhất', () => {
    expect(latestBySourceUrl(obs)[0]!.changedAt).toEqual(new Date('2026-08-03T00:00:00Z'));
  });

  it('không coi lần crawl đầu tiên là lúc scope thay đổi', () => {
    const firstSeen = latestBySourceUrl([obs[0]!]);
    expect(firstSeen[0]!.changedAt).toBeNull();
  });
});

describe('toProgramRecords', () => {
  it('sinh program kèm một scope repo có hardKey', () => {
    const rs = toProgramRecords(latestBySourceUrl(obs));
    expect(rs).toHaveLength(1);
    expect(rs[0]!.program.platform).toBe('code4rena');
    expect(rs[0]!.program.externalId).toBe('412');
    expect(rs[0]!.scope.hardKey).toBe('github.com/code-423n4/2026-07-acme');
    expect(rs[0]!.scope.kind).toBe('repo');
  });

  it('bỏ payload không có repoUrl vì không chấm audit_gap được', () => {
    expect(
      toProgramRecords([
        {
          sourceUrl: 'u',
          changedAt: new Date(),
          payload: {
            platform: 'p',
            externalId: '1',
            title: 't',
            url: 'u',
            poolUsd: null,
            kind: 'contest',
            publishedAt: null,
            startsAt: null,
            endsAt: null,
            repoUrl: null,
            sponsor: null,
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('toImmunefiRecords', () => {
  const row = {
    sourceUrl: 'https://immunefi.com/bounty/hedera/',
    changedAt: new Date('2026-08-03T00:00:00Z'),
    payload: {
      platform: 'immunefi',
      externalId: 'hedera',
      title: 'Hedera',
      url: 'https://immunefi.com/bounty/hedera/',
      poolUsd: 1000000,
      maxBountyUsd: 30000,
      kind: 'bounty',
      publishedAt: '2025-02-05T04:21:00.000Z',
      updatedAt: '2026-08-03T04:00:00.000Z',
      assets: [
        {
          assetId: 'a1',
          repoKey: 'github.com/hiero-ledger/hiero-consensus-node',
          type: 'blockchain_dlt',
          addedAt: '2025-01-31T10:53:46.365Z',
        },
        {
          assetId: 'a2',
          repoKey: 'github.com/hiero-ledger/hiero-sdk-java',
          type: 'blockchain_dlt',
          addedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    },
  };

  it('sinh một scope cho mỗi asset', () => {
    const rs = toImmunefiRecords([row]);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.scopes).toHaveLength(2);
    expect(rs[0]!.scopes.map((s) => s.hardKey)).toEqual([
      'github.com/hiero-ledger/hiero-consensus-node',
      'github.com/hiero-ledger/hiero-sdk-java',
    ]);
  });

  it('mỗi scope mang addedAt riêng làm mốc freshness', () => {
    const rs = toImmunefiRecords([row]);
    expect(rs[0]!.scopes[1]!.addedAt).toEqual(new Date('2026-07-30T00:00:00.000Z'));
  });

  it('gộp asset trùng repo và giữ addedAt MỚI NHẤT', () => {
    // Immunefi hay liệt kê cùng một repo nhiều lần với path/mô tả khác nhau.
    // Nếu không gộp, một repo chiếm nhiều dòng xếp hạng; nếu gộp mà lấy bản
    // đầu tiên thì freshness bị đánh giá thấp hơn thực tế.
    const rs = toImmunefiRecords([
      {
        ...row,
        payload: {
          ...row.payload,
          assets: [
            { assetId: 'x1', repoKey: 'github.com/a/b', type: null, addedAt: '2025-01-01T00:00:00.000Z' },
            { assetId: 'x2', repoKey: 'github.com/a/b', type: null, addedAt: '2026-07-01T00:00:00.000Z' },
            { assetId: 'x3', repoKey: 'github.com/a/b', type: null, addedAt: '2025-06-01T00:00:00.000Z' },
          ],
        },
      },
    ]);
    expect(rs[0]!.scopes).toHaveLength(1);
    expect(rs[0]!.scopes[0]!.addedAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });

  it('asset thiếu addedAt thì scope có addedAt null, không lấy ngày hôm nay', () => {
    const rs = toImmunefiRecords([
      {
        ...row,
        payload: {
          ...row.payload,
          assets: [{ assetId: 'a', repoKey: 'github.com/a/b', type: null, addedAt: null }],
        },
      },
    ]);
    expect(rs[0]!.scopes[0]!.addedAt).toBeNull();
  });

  it('bỏ payload sai hình dạng', () => {
    expect(
      toImmunefiRecords([{ sourceUrl: 'u', changedAt: new Date(), payload: { nope: 1 } }]),
    ).toEqual([]);
  });

  it('không có trường audits thì trả mảng rỗng, không phải undefined', () => {
    expect(toImmunefiRecords([row])[0]!.audits).toEqual([]);
  });
});

describe('toImmunefiRecords — cầu nối audit', () => {
  const withAudits = {
    sourceUrl: 'https://immunefi.com/bounty/hedera/',
    changedAt: new Date('2026-08-03T00:00:00Z'),
    payload: {
      platform: 'immunefi',
      externalId: 'hedera',
      title: 'Hedera',
      url: 'https://immunefi.com/bounty/hedera/',
      poolUsd: 1000000,
      maxBountyUsd: 30000,
      kind: 'bounty',
      publishedAt: '2025-02-05T04:21:00.000Z',
      updatedAt: null,
      assets: [
        { assetId: 'a1', repoKey: 'github.com/hiero-ledger/x', type: null, addedAt: null },
      ],
      audits: [
        { auditId: '1405', auditor: 'ChainSecurity', date: '2026-06-30T00:00:00.000Z', sourceUrl: 'https://hedera.com/kc' },
        { auditId: '900', auditor: 'Halborn', date: '2024-01-15T00:00:00.000Z', sourceUrl: 'https://hedera.com/kc' },
      ],
    },
  };

  it('chuyển audits thành bản ghi có ngày, mới nhất đứng trước', () => {
    const audits = toImmunefiRecords([withAudits])[0]!.audits;
    expect(audits).toHaveLength(2);
    expect(audits[0]!.publishedAt).toEqual(new Date('2026-06-30T00:00:00.000Z'));
    expect(audits[0]!.firm).toBe('ChainSecurity');
  });

  it('khoá theo auditId chứ không theo url — url của Immunefi bị trùng', () => {
    // 237 audit thật chỉ có 222 url khác nhau; khoá theo url sẽ đánh mất bản ghi
    // và va vào ràng buộc unique của AuditReport.
    const urls = toImmunefiRecords([withAudits])[0]!.audits.map((a) => a.reportUrl);
    expect(new Set(urls).size).toBe(2);
    expect(urls).toContain('https://immunefi.com/bounty/hedera/#audit-1405');
  });

  it('loại audit có ngày hỏng thay vì tạo mốc giả', () => {
    const audits = toImmunefiRecords([
      {
        ...withAudits,
        payload: {
          ...withAudits.payload,
          audits: [{ auditId: 'z', auditor: 'X', date: 'not-a-date', sourceUrl: null }],
        },
      },
    ])[0]!.audits;
    expect(audits).toEqual([]);
  });

  it('auditor thiếu thì ghi "unknown" chứ không bỏ mốc audit', () => {
    const audits = toImmunefiRecords([
      {
        ...withAudits,
        payload: {
          ...withAudits.payload,
          audits: [{ auditId: 'z', auditor: null, date: '2026-01-01T00:00:00.000Z', sourceUrl: null }],
        },
      },
    ])[0]!.audits;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.firm).toBe('unknown');
  });
});
