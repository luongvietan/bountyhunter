import { describe, expect, it } from 'vitest';
import { shouldContinueWatching } from '../src/watch.js';

describe('shouldContinueWatching', () => {
  it('keeps polling while scans are running', () => {
    expect(shouldContinueWatching(2, 0)).toBe(true);
  });

  it('keeps polling while failed dispatches remain eligible for retry', () => {
    expect(shouldContinueWatching(0, 1)).toBe(true);
  });

  it('exits when nothing is running or retry-eligible', () => {
    expect(shouldContinueWatching(0, 0)).toBe(false);
  });
});
