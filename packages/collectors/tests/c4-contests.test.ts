import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/c4-contests.json' with { type: 'json' };
import { parseC4Contests } from '../src/sources/c4-contests.js';

describe('parseC4Contests', () => {
  it('chuẩn hoá contest hợp lệ thành observation', () => {
    const out = parseC4Contests(fixture);
    expect(out).toHaveLength(1);
    const o = out[0]!;
    expect(o.collectorId).toBe('c4-contests');
    expect(o.payload.externalId).toBe('412');
    expect(o.payload.title).toBe('Acme Vault');
    expect(o.payload.poolUsd).toBe(100000);
    expect(o.payload.kind).toBe('contest');
    expect(o.payload.repoUrl).toBe('github.com/code-423n4/2026-07-acme');
  });

  it('bỏ contest bị ẩn', () => {
    expect(parseC4Contests(fixture).some((o) => o.payload.title === 'Hidden Contest')).toBe(false);
  });

  it('bỏ qua bản ghi rác thay vì ném lỗi', () => {
    expect(parseC4Contests([{ nonsense: true }, ...fixture])).toHaveLength(1);
  });

  it('hash ổn định giữa hai lần parse cùng dữ liệu', () => {
    expect(parseC4Contests(fixture)[0]!.contentHash).toBe(parseC4Contests(fixture)[0]!.contentHash);
  });
});
