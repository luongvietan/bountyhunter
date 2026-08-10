export interface RetryModelConfig {
  model: string;
  harness: string;
  modelProvider: string;
  thinkingEffort: string;
  fallbackModel?: string;
  fallbackHarness?: string;
  fallbackModelProvider?: string;
  fallbackThinkingEffort?: string;
}

export function modelConfigForRetry(
  config: RetryModelConfig,
  retryCount: number,
): {
  model: string;
  harness: string;
  modelProvider: string;
  thinkingEffort: string;
  fallback: boolean;
} {
  const useFallback = retryCount >= 1;
  if (useFallback && config.fallbackModelProvider) {
    return {
      model: config.fallbackModel ?? config.model,
      harness: config.fallbackHarness ?? config.harness,
      modelProvider: config.fallbackModelProvider,
      thinkingEffort: config.fallbackThinkingEffort ?? config.thinkingEffort,
      fallback: true,
    };
  }
  return {
    model: config.model,
    harness: config.harness,
    modelProvider: config.modelProvider,
    thinkingEffort: config.thinkingEffort,
    fallback: false,
  };
}
