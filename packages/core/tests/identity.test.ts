import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl, normalizeChainAddress } from '../src/identity.js';

describe('normalizeRepoUrl', () => {
  it('quy mọi biến thể của cùng một repo về một khoá', () => {
    const variants = [
      'https://github.com/Uniswap/v4-core',
      'https://github.com/Uniswap/v4-core.git',
      'https://github.com/uniswap/v4-core/',
      'http://www.github.com/Uniswap/v4-core',
      'git@github.com:Uniswap/v4-core.git',
      'git+https://github.com/Uniswap/v4-core.git',
      'https://github.com/Uniswap/v4-core/tree/main/src',
    ];
    for (const v of variants) {
      expect(normalizeRepoUrl(v)).toBe('github.com/uniswap/v4-core');
    }
  });

  it('không gộp nhầm hai repo khác nhau', () => {
    expect(normalizeRepoUrl('https://github.com/uniswap/v4-core')).not.toBe(
      normalizeRepoUrl('https://github.com/uniswap/v4-periphery'),
    );
  });

  it('trả null cho host không nhận dạng được hoặc chuỗi rác', () => {
    expect(normalizeRepoUrl('https://example.com/foo/bar')).toBeNull();
    expect(normalizeRepoUrl('not a url')).toBeNull();
    expect(normalizeRepoUrl('')).toBeNull();
    expect(normalizeRepoUrl('https://github.com/uniswap')).toBeNull();
  });
});

describe('normalizeChainAddress', () => {
  it('hạ chữ thường địa chỉ EVM', () => {
    expect(normalizeChainAddress('ethereum', '0xAbC0000000000000000000000000000000000123')).toBe(
      'ethereum:0xabc0000000000000000000000000000000000123',
    );
  });

  it('GIỮ NGUYÊN hoa thường cho Solana vì base58 phân biệt hoa thường', () => {
    const addr = 'So11111111111111111111111111111111111111112';
    expect(normalizeChainAddress('solana', addr)).toBe(`solana:${addr}`);
  });

  it('từ chối địa chỉ EVM sai định dạng', () => {
    expect(normalizeChainAddress('ethereum', '0x123')).toBeNull();
    expect(normalizeChainAddress('ethereum', 'nothex')).toBeNull();
  });
});
