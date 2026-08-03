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
