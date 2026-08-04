import { PrismaClient } from '@kritt-radar/db';
import {
  ADMIN_DATABASE_URL,
  E2E_DATABASE_NAME,
  E2E_DATABASE_URL,
  assertDisposableDatabase,
} from './database';

/**
 * Revalidates the name even though setup already did. Teardown is the only step
 * that issues a DROP, so it does not inherit trust from an earlier check.
 */
export default async function globalTeardown(): Promise<void> {
  assertDisposableDatabase(E2E_DATABASE_URL);

  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_DATABASE_URL } } });
  try {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${E2E_DATABASE_NAME}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}"`);
  } finally {
    await admin.$disconnect();
  }
}
