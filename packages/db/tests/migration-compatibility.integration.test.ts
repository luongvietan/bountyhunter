import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceRoot = new URL('../../../', import.meta.url);
const initialMigration = new URL('../prisma/migrations/20260803101503_init/migration.sql', import.meta.url);
const auditGapMigration = new URL('../prisma/migrations/20260803180000_audit_gap_foundation/migration.sql', import.meta.url);
let databaseName: string | undefined;

let containerPromise: Promise<string> | undefined;

/**
 * `docker compose exec` resolves the service through the compose project of the
 * current directory, so it finds nothing when the suite runs from a git
 * worktree: the container belongs to the project started in the main checkout.
 * Resolve the container by image instead, which is directory independent.
 */
async function postgresContainer(): Promise<string> {
  containerPromise ??= (async () => {
    const { stdout } = await execFileAsync('docker', [
      'ps',
      '--filter',
      'ancestor=postgres:16-alpine',
      '--format',
      '{{.Names}}',
    ]);
    const name = stdout.split('\n').map((line) => line.trim()).find(Boolean);
    if (!name) throw new Error('no running postgres:16-alpine container found');
    return name;
  })();

  return containerPromise;
}

async function psql(database: string, sql: string): Promise<string> {
  const container = await postgresContainer();
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', '-i', container, 'psql', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'kritt', '-d', database, '-c', sql],
    { cwd: workspaceRoot },
  );

  return stdout;
}

/**
 * afterEach cannot run when a run is interrupted, so scratch databases from
 * killed runs accumulate silently. Sweeping the prefix first keeps the suite
 * self-healing; the prefix is scoped tightly enough that no real database can
 * match it.
 */
beforeAll(async () => {
  try {
    const stale = await psql(
      'postgres',
      `SELECT datname FROM pg_database WHERE datname LIKE 'kritt_radar_migration_test_%';`,
    );

    for (const name of stale.split('\n').map((line) => line.trim()).filter(Boolean)) {
      if (!/^kritt_radar_migration_test_\d+_\d+$/.test(name)) continue;
      await psql('postgres', `DROP DATABASE IF EXISTS ${name};`);
    }
  } catch {
    // Housekeeping, not an assertion. When Postgres is unreachable the test
    // itself skips, and the sweep must not turn that skip into a suite failure.
  }
});

afterEach(async () => {
  if (databaseName) {
    await psql('postgres', `DROP DATABASE IF EXISTS ${databaseName};`);
    databaseName = undefined;
  }
});

describe('audit gap foundation migration', () => {
  it('consolidates duplicate legacy audit report URLs before creating the unique index', async () => {
    databaseName = `kritt_radar_migration_test_${process.pid}_${Date.now()}`;
    const [initialSql, auditGapSql] = await Promise.all([
      readFile(initialMigration, 'utf8'),
      readFile(auditGapMigration, 'utf8'),
    ]);

    await psql('postgres', `CREATE DATABASE ${databaseName};`);
    await psql(databaseName, initialSql);
    await psql(
      databaseName,
      `INSERT INTO "Entity" ("id", "canonicalName", "slug") VALUES ('entity-duplicate', 'Duplicate Entity', 'duplicate-entity');
       INSERT INTO "AuditReport" ("id", "entityId", "firm", "publishedAt", "reportUrl", "coveredPaths") VALUES
         ('report-old', 'entity-duplicate', 'Legacy Firm', '2026-01-01T00:00:00.000Z', 'https://example.test/duplicate', ARRAY[]::TEXT[]),
         ('report-new', 'entity-duplicate', 'Legacy Firm', '2026-02-01T00:00:00.000Z', 'https://example.test/duplicate', ARRAY[]::TEXT[]);`,
    );

    await psql(databaseName, auditGapSql);

    const retained = await psql(
      databaseName,
      `SELECT COUNT(*) || '|' || MIN("id")
       FROM "AuditReport"
       WHERE "reportUrl" = 'https://example.test/duplicate';`,
    );

    expect(retained.trim()).toBe('1|report-new');
  });
});
