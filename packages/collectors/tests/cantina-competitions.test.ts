import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/cantina-competitions.json' with { type: 'json' };
import { parseCantinaCompetitions } from '../src/sources/cantina-competitions.js';

describe('parseCantinaCompetitions', () => {
  it('đọc mảng trần', () => {
    const out = parseCantinaCompetitions(fixture);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload.externalId).toBe('e7af4986-183d-4764-8bd2-1d6b47f87d99');
  });

  it('đọc totalRewardPot dạng chuỗi thành số', () => {
    expect(parseCantinaCompetitions(fixture)[0]!.payload.poolUsd).toBe(120000);
  });

  it('lấy ngày từ timeframe', () => {
    const p = parseCantinaCompetitions(fixture)[0]!.payload;
    expect(p.startsAt).toBe('2026-07-30T00:00:00Z');
    expect(p.endsAt).toBe('2026-08-20T00:00:00Z');
  });

  it('bỏ competition đã complete', () => {
    expect(parseCantinaCompetitions(fixture).some((o) => o.payload.title === 'archived-one')).toBe(
      false,
    );
  });

  it('company.github là URL tổ chức nên không thành repo key', () => {
    // github.com/orbit-fi thiếu phần tên repo -> normalizeRepoUrl trả null.
    expect(parseCantinaCompetitions(fixture)[0]!.payload.repoUrl).toBeNull();
    expect(parseCantinaCompetitions(fixture)[0]!.payload.sponsor).toBe('Orbit');
  });

  it('trả mảng rỗng khi payload sai hình dạng', () => {
    expect(parseCantinaCompetitions({ nope: 1 })).toEqual([]);
    expect(parseCantinaCompetitions(null)).toEqual([]);
  });
});
