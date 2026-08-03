import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sherlock-contests.json' with { type: 'json' };
import { parseSherlockContests } from '../src/sources/sherlock-contests.js';

describe('parseSherlockContests', () => {
  it('chuẩn hoá contest đang chạy', () => {
    const out = parseSherlockContests(fixture);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload;
    expect(p.externalId).toBe('771');
    expect(p.poolUsd).toBe(75000);
    expect(p.repoUrl).toBe('github.com/zephyr-fi/perps-core');
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

  it('pool bằng 0 thành null chứ không phải 0', () => {
    const out = parseSherlockContests([
      {
        id: 9,
        title: 'X',
        prize_pool: 0,
        starts_at: 1785312000,
        ends_at: 1785916800,
        repo_urls: [],
        status: 'RUNNING',
      },
    ]);
    expect(out[0]!.payload.poolUsd).toBeNull();
  });
});
