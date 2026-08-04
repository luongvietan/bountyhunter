/**
 * The E2E database is disposable and gets dropped on teardown, so every code
 * path that could reach a DROP validates the name first. `kritt_radar` holds
 * real collected evidence and must never be a candidate.
 */
export const E2E_DATABASE_NAME = 'kritt_radar_e2e';

export const E2E_DATABASE_URL =
  `postgresql://kritt:kritt@localhost:5433/${E2E_DATABASE_NAME}?schema=public`;

export const ADMIN_DATABASE_URL = 'postgresql://kritt:kritt@localhost:5433/postgres';

export const E2E_PORT = 3101;

export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * Fail closed: anything that is not exactly the disposable name aborts rather
 * than falling through to a destructive statement.
 */
export function assertDisposableDatabase(url: string): string {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`refusing to operate on an unparseable database url`);
  }

  if (name !== E2E_DATABASE_NAME) {
    throw new Error(
      `refusing to operate on database "${name}"; only "${E2E_DATABASE_NAME}" is disposable`,
    );
  }
  return name;
}
