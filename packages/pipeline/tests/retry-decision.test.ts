import { describe, expect, it } from 'vitest';
import { modelConfigForRetry } from '../src/retry-decision.js';

describe('modelConfigForRetry', () => {
  const base = {
    model: 'primary-model',
    harness: 'codex',
    modelProvider: 'codex',
    thinkingEffort: 'medium',
    fallbackModel: 'fallback-model',
    fallbackHarness: 'claude-code',
    fallbackModelProvider: 'openrouter',
    fallbackThinkingEffort: 'high',
  };

  it('keeps the primary provider on the first retry', () => {
    expect(modelConfigForRetry(base, 0)).toEqual({
      model: 'primary-model',
      harness: 'codex',
      modelProvider: 'codex',
      thinkingEffort: 'medium',
      fallback: false,
    });
  });

  it('switches to fallback env on the second retry', () => {
    expect(modelConfigForRetry(base, 1)).toEqual({
      model: 'fallback-model',
      harness: 'claude-code',
      modelProvider: 'openrouter',
      thinkingEffort: 'high',
      fallback: true,
    });
  });
});
