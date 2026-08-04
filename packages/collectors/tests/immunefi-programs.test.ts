import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/immunefi-projects.json' with { type: 'json' };
import { parseContractAssetUrl, parseImmunefiProjects } from '../src/sources/immunefi-programs.js';

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

  it('tách asset địa chỉ hợp đồng (etherscan) vào contracts, không lẫn vào assets', () => {
    const payload = parseImmunefiProjects(fixture)[0]!.payload;
    expect(payload.assets).toHaveLength(1);
    expect(payload.contracts).toEqual([
      {
        assetId: '5ContractAssetIdHedera',
        chain: 'ethereum',
        address: '0x0123456789abcdef0123456789abcdef01234567',
        addedAt: '2025-03-01T00:00:00.000Z',
      },
    ]);
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

  it('giữ program chỉ có contract, không có repo github nào', () => {
    const out = parseImmunefiProjects([
      {
        slug: 'contract-only',
        project: 'Contract Only',
        launchDate: '2026-01-01T00:00:00.000Z',
        inviteOnly: false,
        assets: [
          {
            id: 'c1',
            url: 'https://arbiscan.io/address/0x1234567890123456789012345678901234567890',
            type: 'smart_contract',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload.assets).toEqual([]);
    expect(out[0]!.payload.contracts).toEqual([
      {
        assetId: 'c1',
        chain: 'arbitrum',
        address: '0x1234567890123456789012345678901234567890',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('bỏ program không có cả repo lẫn contract sau khi lọc', () => {
    const out = parseImmunefiProjects([
      {
        slug: 'nothing-usable',
        project: 'N',
        launchDate: '2026-01-01T00:00:00.000Z',
        inviteOnly: false,
        assets: [
          {
            id: 'w1',
            url: 'https://x.com',
            type: 'websites_and_applications',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    expect(out).toEqual([]);
  });
});

describe('parseContractAssetUrl', () => {
  const address = '0x1234567890123456789012345678901234567890';
  const hostChainCases: Array<[string, string]> = [
    ['etherscan.io', 'ethereum'],
    ['arbiscan.io', 'arbitrum'],
    ['optimistic.etherscan.io', 'optimism'],
    ['basescan.org', 'base'],
    ['polygonscan.com', 'polygon'],
    ['bscscan.com', 'bsc'],
    ['snowtrace.io', 'avalanche'],
    ['lineascan.build', 'linea'],
    ['scrollscan.com', 'scroll'],
    ['ftmscan.com', 'fantom'],
    ['gnosisscan.io', 'gnosis'],
  ];

  it.each(hostChainCases)('nhận diện %s → chain %s', (host, chain) => {
    expect(parseContractAssetUrl(`https://${host}/address/${address}`)).toEqual({
      chain,
      address,
    });
  });

  it('hạ chữ thường địa chỉ và bỏ query/hash phía sau', () => {
    expect(
      parseContractAssetUrl(`https://etherscan.io/address/${address.toUpperCase()}#code`),
    ).toEqual({ chain: 'ethereum', address });
  });

  it('bỏ host không nằm trong danh sách explorer', () => {
    expect(parseContractAssetUrl(`https://example.com/address/${address}`)).toBeNull();
  });

  it('bỏ URL thiếu path /address/', () => {
    expect(parseContractAssetUrl(`https://etherscan.io/tx/${address}`)).toBeNull();
  });

  it('bỏ địa chỉ hex sai độ dài', () => {
    expect(parseContractAssetUrl('https://etherscan.io/address/0x1234')).toBeNull();
  });

  it('bỏ chuỗi rỗng', () => {
    expect(parseContractAssetUrl('')).toBeNull();
  });
});
