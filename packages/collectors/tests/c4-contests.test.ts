import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/c4-contests.json' with { type: 'json' };
import { parseC4Contests, lastPageOf } from '../src/sources/c4-contests.js';

// Monetrix kết thúc 2026-05-04, audit 459 kết thúc 2024-10-31.
const DURING_MONETRIX = new Date('2026-04-30T00:00:00Z');
const AFTER_EVERYTHING = new Date('2026-08-03T00:00:00Z');

describe('parseC4Contests', () => {
  it('chuẩn hoá contest còn hạn thành observation', () => {
    const out = parseC4Contests(fixture, DURING_MONETRIX);
    expect(out).toHaveLength(1);
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

  it('loại contest đã hết hạn vì không nộp được gì nữa', () => {
    expect(parseC4Contests(fixture, AFTER_EVERYTHING)).toEqual([]);
  });

  it('lọc theo endTime chứ không theo status', () => {
    // Dữ liệu thật của C4 có mục gắn Pre-Contest nhưng đã kết thúc từ 2023,
    // nên status không dùng để quyết định được.
    const raw = {
      data: {
        audits: [
          {
            contestId: 1,
            title: 'Stale Pre-Contest',
            slug: 'stale',
            startTime: '2023-06-20T20:00:00.000Z',
            endTime: '2023-06-23T20:00:00.000Z',
            status: 'Pre-Contest',
            repo: 'https://github.com/code-423n4/stale',
          },
          {
            contestId: 2,
            title: 'Open But Completed Label',
            slug: 'open',
            startTime: '2026-08-01T20:00:00.000Z',
            endTime: '2026-09-01T20:00:00.000Z',
            status: 'Completed',
            repo: 'https://github.com/code-423n4/open',
          },
        ],
      },
    };
    const out = parseC4Contests(raw, AFTER_EVERYTHING);
    expect(out.map((o) => o.payload.externalId)).toEqual(['2']);
  });

  it('loại bản ghi có endTime không đọc được', () => {
    const raw = {
      data: {
        audits: [
          {
            contestId: 3,
            title: 'Bad Date',
            slug: 'bad',
            startTime: '2026-08-01T20:00:00.000Z',
            endTime: 'not-a-date',
            repo: 'https://github.com/code-423n4/bad',
          },
        ],
      },
    };
    expect(parseC4Contests(raw, AFTER_EVERYTHING)).toEqual([]);
  });

  it('bỏ qua bản ghi rác thay vì ném lỗi', () => {
    const raw = {
      ...fixture,
      data: { audits: [{ nonsense: true }, ...fixture.data.audits] },
    };
    expect(parseC4Contests(raw, DURING_MONETRIX)).toHaveLength(1);
  });

  it('trả mảng rỗng khi response không có data.audits', () => {
    expect(parseC4Contests([{ nonsense: true }], DURING_MONETRIX)).toEqual([]);
  });

  it('hash ổn định giữa hai lần parse cùng dữ liệu', () => {
    expect(parseC4Contests(fixture, DURING_MONETRIX)[0]!.contentHash).toBe(
      parseC4Contests(fixture, DURING_MONETRIX)[0]!.contentHash,
    );
  });
});

describe('lastPageOf', () => {
  it('đọc lastPage từ pagination', () => {
    expect(lastPageOf(fixture)).toBe(5);
  });

  it('mặc định 1 trang khi API không kèm pagination', () => {
    expect(lastPageOf({ data: { audits: [] } })).toBe(1);
  });

  it('mặc định 1 trang khi payload sai hình dạng', () => {
    expect(lastPageOf({ nope: 1 })).toBe(1);
  });
});
