import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sherlock-contests.json' with { type: 'json' };
import { parseSherlockContests, nextPage } from '../src/sources/sherlock-contests.js';

describe('parseSherlockContests', () => {
  it('đọc items lồng trong envelope phân trang', () => {
    const out = parseSherlockContests(fixture);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload;
    expect(p.externalId).toBe('1279');
    expect(p.poolUsd).toBe(150000);
    expect(p.platform).toBe('sherlock');
  });

  it('đổi timestamp giây sang ISO', () => {
    const p = parseSherlockContests(fixture)[0]!.payload;
    expect(p.startsAt).toBe(new Date(1785312000 * 1000).toISOString());
  });

  it('bỏ contest ở trạng thái DRAFT', () => {
    expect(parseSherlockContests(fixture).some((o) => o.payload.title === 'Draft Contest')).toBe(
      false,
    );
  });

  it('bỏ contest private vì không nộp được nếu chưa được mời', () => {
    expect(parseSherlockContests(fixture).some((o) => o.payload.title === 'Private Contest')).toBe(
      false,
    );
  });

  it('endpoint danh sách không kèm repo nên repoUrl là null', () => {
    expect(parseSherlockContests(fixture)[0]!.payload.repoUrl).toBeNull();
  });

  it('dùng rewards khi thiếu prize_pool', () => {
    const out = parseSherlockContests({
      items: [{ id: 7, title: 'R', rewards: 9000, starts_at: 1785312000, ends_at: 1785916800 }],
    });
    expect(out[0]!.payload.poolUsd).toBe(9000);
  });

  it('pool bằng 0 thành null chứ không phải 0', () => {
    const out = parseSherlockContests({
      items: [
        { id: 9, title: 'X', prize_pool: 0, rewards: 0, starts_at: 1785312000, ends_at: 1785916800 },
      ],
    });
    expect(out[0]!.payload.poolUsd).toBeNull();
  });
});

describe('nextPage', () => {
  it('trả số trang kế khi còn trang', () => {
    expect(nextPage(fixture)).toBe(2);
  });

  it('dừng khi has_next là false', () => {
    expect(nextPage({ items: [], has_next: false, next_page: 3 })).toBeNull();
  });

  it('dừng khi payload sai hình dạng', () => {
    expect(nextPage({ nope: 1 })).toBeNull();
  });
});
