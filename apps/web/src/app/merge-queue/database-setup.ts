const setupErrorCodes = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1012',
  'P1013',
  'P2021',
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const coded = error as { code?: unknown; errorCode?: unknown };
  const value = coded.code ?? coded.errorCode;
  return typeof value === 'string' ? value : undefined;
}

export function isDatabaseSetupError(error: unknown, databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return true;
  const code = errorCode(error);
  return code !== undefined && setupErrorCodes.has(code);
}
