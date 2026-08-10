import { describe, expect, it } from 'vitest';
import {
  classifyKrittScanStatus,
  isTerminalKrittScanStatus,
  STILL_RUNNING_STATUSES,
} from '../src/scan-status.js';

describe('classifyKrittScanStatus', () => {
  it('treats success statuses as terminal success', () => {
    for (const status of ['completed', 'complete', 'finished', 'done']) {
      expect(classifyKrittScanStatus(status)).toBe('success');
    }
  });

  it('treats failed and stopped as terminal failure', () => {
    for (const status of ['failed', 'error', 'stopped', 'cancelled', 'canceled']) {
      expect(classifyKrittScanStatus(status)).toBe('failed');
    }
  });

  it('keeps rate_limited and in-flight statuses as running', () => {
    for (const status of STILL_RUNNING_STATUSES) {
      expect(classifyKrittScanStatus(status)).toBe('running');
    }
  });

  it('does not mark rate_limited as terminal', () => {
    expect(isTerminalKrittScanStatus('rate_limited')).toBe(false);
  });
});
