import type { KrittScanRequest } from '@kritt-radar/pipeline';

export function buildScanRequest(
  base: Omit<KrittScanRequest, 'repoScope' | 'configuration'>,
  repoScope?: string,
  configuration?: NonNullable<KrittScanRequest['configuration']>,
): KrittScanRequest {
  const request: KrittScanRequest = { ...base };
  if (repoScope) request.repoScope = repoScope;
  if (configuration) request.configuration = configuration;
  return request;
}
