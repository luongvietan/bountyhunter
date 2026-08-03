import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceRoot = new URL('../../../', import.meta.url);
const initialMigration = new URL('../prisma/migrations/20260803101503_init/migration.sql', import.meta.url);
const auditGapMigration = new URL('../prisma/migrations/20260803180000_audit_gap_foundation/migration.sql', import.meta.url);
let databaseName: string | undefined;

async function psql(database: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'kritt', '-d', database, '-c', sql],
    { cwd: workspaceRoot },
  );

  return stdout;
}

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
