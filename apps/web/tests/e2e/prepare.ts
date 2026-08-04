import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@kritt-radar/db';
import {
  ADMIN_DATABASE_URL,
  E2E_DATABASE_NAME,
  E2E_DATABASE_URL,
  assertDisposableDatabase,
} from './database';
import { seedMergeQueue } from './seed';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');

/**
 * Runs as the first half of the webServer command rather than from
 * globalSetup, because Playwright starts webServer before globalSetup: Next
 * would boot against a database that does not exist yet, and the Prisma client
 * it creates at module load never recovers.
 */
async function withAdmin<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient({ datasources: { db: { url: ADMIN_DATABASE_URL } } });
  try {
    return await run(client);
  } finally {
    await client.$disconnect();
  }
}

async function recreateDatabase(): Promise<void> {
  assertDisposableDatabase(E2E_DATABASE_URL);

  await withAdmin(async (admin) => {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${E2E_DATABASE_NAME}' AND pid <> pg_backend_pid()`,
    );
    // Recreate rather than reuse: a suite that inherits rows from the previous
    // run passes for reasons its assertions never state.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  });
}

function migrate(): void {
  execFileSync('pnpm', ['--filter', '@kritt-radar/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}

await recreateDatabase();
migrate();

const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
try {
  await seedMergeQueue(prisma);
} finally {
  await prisma.$disconnect();
}

console.log(`[e2e] ${E2E_DATABASE_NAME} recreated, migrated and seeded`);
