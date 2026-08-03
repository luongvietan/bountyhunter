import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/c4-contests.json' with { type: 'json' };
import { parseC4Contests } from '../src/sources/c4-contests.js';

describe('parseC4Contests', () => {
  it('chuẩn hoá contest hợp lệ thành observation', () => {
    const out = parseC4Contests(fixture);
    expect(out).toHaveLength(2);
    const o = out[0]!;
    expect(o.collectorId).toBe('c4-contests');
    expect(o.payload.externalId).toBe('554');
    expect(o.payload.title).toBe('Monetrix');
    expect(o.payload.url).toBe('https://code4rena.com/audits/2026-04-monetrix');
    expect(o.payload.poolUsd).toBe(22000);
    expect(o.payload.kind).toBe('contest');
    expect(o.payload.repoUrl).toBe('github.com/code-423n4/2026-04-monetrix');
    expect(o.payload.sponsor).toBe('Monetrix');
  });

  it('bỏ qua bản ghi rác thay vì ném lỗi', () => {
    const raw = {
      ...fixture,
      data: { audits: [{ nonsense: true }, ...fixture.data.audits] },
    };
    expect(parseC4Contests(raw)).toHaveLength(2);
  });

  it('trả mảng rỗng khi response không có data.audits', () => {
    expect(parseC4Contests([{ nonsense: true }])).toEqual([]);
  });

  it('hash ổn định giữa hai lần parse cùng dữ liệu', () => {
    expect(parseC4Contests(fixture)[0]!.contentHash).toBe(parseC4Contests(fixture)[0]!.contentHash);
  });
});
