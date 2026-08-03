const SAFE_DATABASE_NAME = /^kritt_radar_(?:integration|test)(?:_[a-z0-9_]+)?$/;

export async function withSafeIntegrationDatabase<T>(
  actualName: string,
  expectedName: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!SAFE_DATABASE_NAME.test(expectedName) || actualName !== expectedName) {
    throw new Error(
      `refusing integration cleanup: connected=${actualName || '<unknown>'} expected=${expectedName || '<unset>'}`,
    );
  }
  return operation();
}
