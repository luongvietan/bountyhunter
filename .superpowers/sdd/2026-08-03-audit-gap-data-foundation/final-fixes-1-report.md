# Final fixes 1 report

Date: 2026-08-03

Branch: `codex/audit-gap-data-foundation`

Reviewed base: `46f244832c9acac69b4b74ea342afc45153ff508`

## Outcome

- Audit materialization now resolves in strict order: explicit `audit_hint` alias, one unique non-empty normalized canonical-name/slug match among program-backed entities, then pending fuzzy candidates. Ambiguous exact matches stay provisional. Existing non-provisional/manual report links are preserved on normalized/fuzzy replay; explicit aliases retain precedence.
- Audit report creation still initializes unknown coverage as `coveredCommit=null` and `coveredPaths=[]`, while replay updates omit those fields so later manual enrichment survives.
- GitHub snapshot observations now use one exported deterministic logical source-key helper for collector writes and pipeline lookup. The key includes `repoKey`, sorted/deduplicated `pathGlobs`, `lastAuditAt`, and `coveredCommit`; actual GitHub HEAD/tree/compare request URLs are unchanged.
- The Docker migration compatibility test is now an opt-in `*.integration.test.ts`. Default unit discovery excludes it, while root and worker integration discovery run it alongside the foundation integration suite.

## TDD evidence

1. Normalized exact identity and coverage replay RED:
   - Command: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts -t "returns per-invocation|preserves manually enriched"`
   - Expected failures observed: Aave remained provisional (`entities=3`, `candidates=1`) and replay reset coverage from the manual commit/path values to `null`/`[]`.
   - GREEN: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts -t "materializeCatalogFoundation"` passed 8 tests in the first cycle.
2. Empty exact identity precision RED:
   - Command: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts -t "empty normalized identity"`
   - Expected failure observed: two noise-only values normalized to the empty string and auto-linked.
   - GREEN: the focused empty-identity and fuzzy replay run passed 2 tests; empty identities are now excluded from exact matching.
3. Collector source collision RED:
   - Command: `pnpm vitest run packages/collectors/tests/github-repo-snapshot.test.ts -t "stable logical source"`
   - Expected failure observed: different target scopes produced the same repository-base `sourceUrl`.
   - GREEN: the full collector snapshot file passed 51 tests after introducing the shared logical key.
4. Pipeline source lookup RED:
   - Command: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts -t "isolates snapshots"`
   - Expected failure observed: the materializer returned `noData=3` instead of `1` because it still queried repository-base keys.
   - GREEN: the focused integration test passed after lookup adopted the same helper; both same-repository scopes consumed only their own HEAD, files, cutoff, commits, and observation IDs.
5. Integration discovery RED:
   - Command: `pnpm test:integration -- packages/db/tests/migration-compatibility.integration.test.ts`
   - Expected failure observed: `No test files found` because integration config only included app tests.
   - GREEN: the migration compatibility test passed 1/1 after adding package integration discovery.

## Verification

- `pnpm test`: 24 files, 191 tests passed. The Docker migration test was absent from this default unit run.
- Dedicated DB: `postgresql://kritt:***@localhost:5433/kritt_radar_integration`, guarded by `KRITT_RADAR_INTEGRATION_DATABASE=kritt_radar_integration`.
- Root `pnpm test:integration`: 2 files, 16 tests passed (foundation 15 + migration compatibility 1).
- Worker `pnpm --filter @kritt-radar/worker test:integration`: 2 files, 16 tests passed with the same root-resolved suite.
- `pnpm build`: all 5 workspace projects built.
- `pnpm typecheck`: passed after fresh workspace build artifacts were generated.
- `prisma validate --schema prisma/schema.prisma`: schema valid.
- `prisma migrate status --schema prisma/schema.prisma`: 2 migrations found; dedicated integration database up to date.
- `git diff --check`: passed.

## Self-review

- Exact/fuzzy invariant: only one non-empty exact normalized identity can auto-link. Two exact entities remain provisional with two pending candidates. Explicit aliases are checked first. Fuzzy examples scoring `0.84` and `0.6785714285714286` remain pending and do not change report ownership. Manual approval state and its non-provisional report link survive replay.
- Source identity: glob order and duplicates are normalized because matching is an order-independent OR over globs; glob text itself is not trimmed or rewritten. Null cutoffs remain explicit hash inputs. Query parameters are SHA-256 hex and therefore URL-safe.
- Backward implication: repository-base observations written before this change are intentionally not used as fallback. The next GitHub collection writes target-keyed observations before signal materialization in the normal `sync` order. This fail-closed transition avoids reusing a stale or wrong-scope legacy snapshot; running materialization alone before a fresh collection can temporarily yield `no_snapshot`.

## Concerns

No unresolved correctness blockers. Deployment should preserve the two-phase `sync` order so target-keyed observations exist before signal materialization.
