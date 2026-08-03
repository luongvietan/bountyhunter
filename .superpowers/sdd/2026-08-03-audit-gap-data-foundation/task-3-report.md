# Task 3 Report — Convert audit observations into idempotent records

## Scope

- Added `toAuditReportRecords` as a pure converter for audit-report observations.
- Retained the newest observation for each `sourceUrl`, preserving its observation ID.
- Dropped malformed payloads and reports whose `publishedAt` cannot be parsed.
- Collapsed duplicate `reportUrl` values to the newest fetch, with observation-ID tie-breaking and sorted output for deterministic replay.
- Exported the converter from the pipeline barrel.

## TDD evidence

1. RED — `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts`
   - Exit 1 as expected: `Cannot find module '../src/audit-materialize.js'`.
2. RED — after adding the equal-fetch timestamp test, the focused test exited 1 as expected:
   - `expected 'observation-a' to be 'observation-z'`.
3. RED — after adding the stable output-order test, the focused test exited 1 as expected:
   - expected `a.pdf, z.pdf`; received `z.pdf, a.pdf`.
4. GREEN / regression — `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts packages/pipeline/tests/materialize.test.ts`
   - Exit 0; 2 files and 13 tests passed.

## Final verification

- `pnpm typecheck`
  - Exit 0 (`pnpm -r exec tsc --noEmit`).
- `pnpm test`
  - Exit 0; 22 files and 115 tests passed.
- `git diff --check`
  - Exit 0; no whitespace errors.

## Self-review / concerns

- The converter deliberately retains only the selected newest observation ID for a deduplicated report, matching the requirement to keep the newest fetched observation.
- No open concerns within Task 3 scope.
