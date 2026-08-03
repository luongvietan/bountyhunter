# Task 4 Report — Materialize catalog, aliases, reports and candidates

## Scope delivered

- Added transactional catalog materialization for contest and Immunefi observations.
- Added deterministic program entities with exact repo alias precedence, then exact
  platform/title alias precedence, then normalized repo identity fallback.
- Extended alias parsing and persistence with exact `auditHint` rules.
- Added transactional audit report materialization by unique `reportUrl`.
- Exact `audit_hint` aliases attach reports to the target program entity; unmatched
  reports remain on deterministic provisional entities.
- Fuzzy scores at or above `0.65` only upsert review candidates. They never change
  entity links, and candidate updates do not overwrite `status` or `decidedAt`.
- Config alias replay does not overwrite a colliding manual alias and does not delete
  manual aliases. Scope replay upserts scope fields and preserves existing signals.
- CLI materialization now delegates to the foundation module and collection includes
  the existing audit-report collector.
- Added opt-in Vitest integration configuration and kept integration tests out of the
  default unit suite.

## TDD evidence

1. RED — PostgreSQL 16 integration database created through local Docker Compose;
   both existing migrations were deployed.
2. RED — `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`
   - Exit 1 as expected: `Cannot find module '../src/foundation.js'`.
3. First GREEN attempt caught an alias-key mismatch.
   - Received two pending candidates instead of one because config stored exact key
     `uniswap-v4` while audit lookup used token-normalized `uniswap v4`.
   - Lookup now uses the same exact trim/lowercase convention as config parsing.
4. GREEN — focused integration test passed against PostgreSQL.
   - It covers two program observations (Uniswap and Aave), one exact Uniswap audit
     alias, two reports, replay-stable counts, fuzzy non-mutation, rejected-status
     preservation, manual-alias preservation, and Scope signal preservation.

## Verification commands and results

- `$env:DATABASE_URL='<local integration database>'; pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`
  - Exit 0; 1 file and 1 integration test passed.
- `pnpm test`
  - Exit 0; 22 files and 116 unit tests passed.
- `pnpm build`
  - Exit 0; core, db, collectors, pipeline, and worker builds passed.
- `pnpm typecheck`
  - Exit 0; all workspace TypeScript checks passed.
- `$env:DATABASE_URL='<local integration database>'; pnpm --filter @kritt-radar/db exec prisma validate`
  - Exit 0; Prisma schema is valid.
- `$env:DATABASE_URL='<local integration database>'; pnpm --filter @kritt-radar/db exec prisma migrate status`
  - Exit 0; 2 migrations found and the database schema is up to date.
- `git diff --check`
  - Exit 0; no whitespace errors.

## Debugging notes

- The first full-unit run incorrectly traversed dependency tests because adding an
  integration exclude replaced Vitest's default excludes. The config now extends
  `configDefaults.exclude`, so `node_modules` remains excluded and integration tests
  remain opt-in.
- Worker typechecking resolves workspace package declarations from built `dist`.
  Running the pipeline build refreshed declarations added by Tasks 2/3; the full
  workspace build and the subsequent fresh typecheck both passed.

## Self-review / concerns

- Fuzzy paths mutate only `MergeCandidate.similarity` and `reason`; report and program
  entity links are changed only by hard identities or exact aliases.
- Config synchronization deliberately leaves manual aliases untouched, including
  exact `(kind, key)` collisions.
- Integration cleanup is guarded by requiring a database name containing `test` or
  `integration`, and cleanup completed successfully after the test.
- No secrets were added to tracked files. The report redacts the local connection URL.
- No open concerns within Task 4 scope.

## Fix round 1 — review findings

### Findings addressed

- Made integration cleanup fail closed. The test validates an explicit dedicated
  database name before setting its cleanup gate; every cleanup re-queries and guards
  the connected database again. `afterAll` cannot delete when `beforeAll` validation
  failed.
- Added a pure test helper and sentinel-style unit coverage proving unsafe actual or
  expected database names never invoke the cleanup operation.
- Fuzzy audit replay now updates report metadata without updating `entityId`. Existing
  approved/manual report links remain intact; an exact `audit_hint` remains the only
  authoritative replay path that may relink a report.
- Config alias writes now use one PostgreSQL `INSERT ... ON CONFLICT ... DO UPDATE`
  whose update has `WHERE EntityAlias.source = 'config'`. A concurrent transition to
  `manual` therefore cannot be overwritten.
- Config sync deletes aliases removed from YAML only when their current source remains
  `config`; manual aliases survive both conflicts and stale cleanup.
- Foundation return counts now describe records/entities touched by the invocation,
  independent of unrelated rows already in the database.
- Restored the CLI's dropped-no-repository visibility and added coverage for exact
  dropped counts, deterministic fallback identity, repo-before-platform precedence,
  exact report linking, stale aliases, decisions, and Scope signal preservation.
- Fixed worker-package integration invocation by anchoring the shared integration
  config root to the repository directory.

### TDD evidence

1. Package-script RED:
   - `pnpm --filter @kritt-radar/worker test:integration -- tests/foundation.integration.test.ts`
   - Exit 1 with `No test files found`; config root was the worker directory while the
     include pattern was repository-relative.
2. Cleanup-guard RED:
   - `pnpm vitest run apps/worker/tests/integration-database.test.ts`
   - Exit 1 because `integration-database.js` did not exist.
3. Cleanup-guard GREEN:
   - Same command exited 0; 3/3 tests passed, including two unsafe sentinel cases.
4. Foundation integration RED:
   - `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`
   - 4/5 tests failed for the intended reasons: global entity count `4` instead of
     invocation count `3`; approved report relinked to provisional; stale repo alias
     remained; deterministic row-lock race changed a manual alias back to config.
5. Foundation/package GREEN:
   - Root and worker-package focused commands each exited 0 with 5/5 tests passed.

### Final verification

- `$env:DATABASE_URL='<local integration database>'; pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`
  - Exit 0; 1 file and 5 integration tests passed.
- `$env:DATABASE_URL='<local integration database>'; pnpm --filter @kritt-radar/worker test:integration -- tests/foundation.integration.test.ts`
  - Exit 0; package invocation found the suite and 5/5 tests passed.
- `pnpm test`
  - Exit 0; 23 files and 119 tests passed.
- `pnpm build`
  - Exit 0; all 5 buildable workspace projects passed.
- `pnpm typecheck`
  - Exit 0; all workspace TypeScript checks passed.
- `$env:DATABASE_URL='<local integration database>'; pnpm --filter @kritt-radar/db exec prisma validate`
  - Exit 0; Prisma schema is valid.
- `$env:DATABASE_URL='<local integration database>'; pnpm --filter @kritt-radar/db exec prisma migrate status`
  - Exit 0; 2 migrations found and the database schema is up to date.
- `git diff --check`
  - Exit 0; no whitespace errors.

### Self-review / concerns

- The manual-alias race test locks the real PostgreSQL alias row, starts replay, then
  commits a concurrent manual decision before replay's conflict update resumes. This
  failed reliably before the conditional SQL and passes with it.
- Stale deletion includes a second `source='config'` predicate, so a concurrent manual
  transition after stale discovery is still protected.
- Fuzzy replay continues to refresh report metadata and candidate score/reason while
  preserving report links, candidate status, and `decidedAt`.
- Returned `entities` counts distinct entity IDs touched by config, catalog, or audit
  stages during that invocation; pre-existing unrelated entities do not inflate it.
- No secrets were added, and no open concerns remain in Task 4 scope.
