import { describe, expect, it } from 'vitest';
import { parseAliases, resolveEntityKey } from '../src/resolver.js';

const aliases = parseAliases(`
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - platformName: { platform: immunefi, name: "Uniswap v4" }
orbit-lending:
  canonicalName: Orbit Lending
  match:
    - repo: github.com/orbit-fi/lending
`);

describe('resolveEntityKey — tầng 1 khoá cứng', () => {
  it('parses defillama slug aliases', () => {
    const table = parseAliases(`
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - defillama: Uniswap-V4
`);
    expect(table.byDefillama.get('uniswap-v4')).toEqual({
      slug: 'uniswap-v4',
      canonicalName: 'Uniswap v4',
    });
  });

  it('does not create empty defillama alias keys', () => {
    const table = parseAliases(`
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - defillama: "   "
`);
    expect(table.byDefillama.size).toBe(0);
  });

  it('khớp bằng repo key chuẩn hoá', () => {
    const r = resolveEntityKey({ repoUrl: 'https://github.com/Uniswap/v4-core.git' }, aliases);
    expect(r).toEqual({ slug: 'uniswap-v4', canonicalName: 'Uniswap v4', tier: 1 });
  });

  it('khớp bằng cặp platform + tên chính xác', () => {
    const r = resolveEntityKey({ platform: 'immunefi', title: 'Uniswap v4' }, aliases);
    expect(r?.slug).toBe('uniswap-v4');
    expect(r?.tier).toBe(2);
  });
});

describe('resolveEntityKey — không bao giờ merge nhầm', () => {
  it('repo khác nhau không gộp', () => {
    expect(
      resolveEntityKey({ repoUrl: 'https://github.com/uniswap/v4-periphery' }, aliases),
    ).toBeNull();
  });

  it('tên gần giống KHÔNG được tự khớp', () => {
    expect(resolveEntityKey({ platform: 'immunefi', title: 'Uniswap v3' }, aliases)).toBeNull();
    expect(resolveEntityKey({ platform: 'immunefi', title: 'Uniswap  v4' }, aliases)).toBeNull();
  });

  it('cùng tên nhưng khác platform không khớp', () => {
    expect(resolveEntityKey({ platform: 'code4rena', title: 'Uniswap v4' }, aliases)).toBeNull();
  });

  it('không có tín hiệu nào thì trả null chứ không đoán', () => {
    expect(resolveEntityKey({}, aliases)).toBeNull();
    expect(resolveEntityKey({ repoUrl: 'not a url' }, aliases)).toBeNull();
  });
});
