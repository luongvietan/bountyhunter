import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/github-commits.json' with { type: 'json' };
import { parseCommits, matchesGlobs } from '../src/sources/github-repo-activity.js';

describe('matchesGlobs', () => {
  it('mảng glob rỗng nghĩa là khớp tất cả', () => {
    expect(matchesGlobs('src/A.sol', [])).toBe(true);
  });

  it('khớp glob có wildcard sâu', () => {
    expect(matchesGlobs('src/deep/A.sol', ['src/**/*.sol'])).toBe(true);
    expect(matchesGlobs('test/A.sol', ['src/**/*.sol'])).toBe(false);
  });

  it('* không vượt qua dấu gạch chéo', () => {
    expect(matchesGlobs('src/deep/A.sol', ['src/*.sol'])).toBe(false);
    expect(matchesGlobs('src/A.sol', ['src/*.sol'])).toBe(true);
  });
});

describe('parseCommits', () => {
  it('trích sha, ngày và file kèm số dòng thay đổi', () => {
    const cs = parseCommits(fixture);
    expect(cs).toHaveLength(2);
    expect(cs[0]!.sha).toBe('aaa111');
    expect(cs[0]!.authoredAt).toBe('2026-07-20T10:00:00Z');
    expect(cs[0]!.files[0]).toEqual({ path: 'src/Hooks.sol', changedLoc: 124 });
  });

  it('bỏ qua commit thiếu sha hoặc ngày', () => {
    expect(parseCommits([{ sha: 'x' }, ...fixture])).toHaveLength(2);
  });
});
