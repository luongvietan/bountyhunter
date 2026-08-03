import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/immunefi-projects.json' with { type: 'json' };
import { parseImmunefiProjects } from '../src/sources/immunefi-programs.js';

describe('parseImmunefiProjects', () => {
  it('chuẩn hoá program công khai', () => {
    const out = parseImmunefiProjects(fixture);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload;
    expect(p.platform).toBe('immunefi');
    expect(p.externalId).toBe('hedera');
    expect(p.title).toBe('Hedera');
    expect(p.url).toBe('https://immunefi.com/bounty/hedera/');
  });

  it('dùng rewardsPool làm poolUsd, không dùng maxBounty', () => {
    expect(parseImmunefiProjects(fixture)[0]!.payload.poolUsd).toBe(1000000);
  });

  it('chỉ giữ asset là repo git, bỏ website', () => {
    const assets = parseImmunefiProjects(fixture)[0]!.payload.assets;
    expect(assets).toHaveLength(1);
    expect(assets[0]!.repoKey).toBe('github.com/hiero-ledger/hiero-consensus-node');
  });

  it('giữ addedAt theo từng asset — đây là thứ trang HTML không có', () => {
    expect(parseImmunefiProjects(fixture)[0]!.payload.assets[0]!.addedAt).toBe(
      '2025-01-31T10:53:46.365Z',
    );
  });

  it('bỏ program inviteOnly vì không nộp được', () => {
    expect(parseImmunefiProjects(fixture).some((o) => o.payload.externalId === 'private-one')).toBe(
      false,
    );
  });

  it('bỏ program không còn asset repo nào sau khi lọc', () => {
    const out = parseImmunefiProjects([
      {
        slug: 'weburl-only',
        project: 'W',
        launchDate: '2026-01-01T00:00:00.000Z',
        inviteOnly: false,
        assets: [
          {
            id: 'a',
            url: 'https://x.com',
            type: 'websites_and_applications',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    expect(out).toEqual([]);
  });

  it('trả mảng rỗng khi payload không phải mảng', () => {
    expect(parseImmunefiProjects({ nope: 1 })).toEqual([]);
  });
});
