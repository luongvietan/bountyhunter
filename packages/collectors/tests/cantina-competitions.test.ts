import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/cantina-competitions.json' with { type: 'json' };
import { parseCantinaCompetitions } from '../src/sources/cantina-competitions.js';

describe('parseCantinaCompetitions', () => {
  it('đọc mảng lồng trong khoá competitions', () => {
    const out = parseCantinaCompetitions(fixture);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload.externalId).toBe('orbit-lending');
  });

  it('gỡ đuôi .git khỏi repo url', () => {
    expect(parseCantinaCompetitions(fixture)[0]!.payload.repoUrl).toBe('github.com/orbit-fi/lending');
  });

  it('bỏ competition đã archived', () => {
    expect(
      parseCantinaCompetitions(fixture).some((o) => o.payload.externalId === 'archived-one'),
    ).toBe(false);
  });

  it('trả mảng rỗng khi payload sai hình dạng', () => {
    expect(parseCantinaCompetitions({ nope: 1 })).toEqual([]);
    expect(parseCantinaCompetitions(null)).toEqual([]);
  });
});
