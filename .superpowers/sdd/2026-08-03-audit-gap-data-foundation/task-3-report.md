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

## Fix round 1 — strict audit timestamp validation

Reviewer finding: `Date.parse` normalizes impossible ISO calendar dates, which
could turn an invalid `publishedAt` into a later audit timestamp.

### TDD evidence

1. RED — added `drops ISO timestamps with impossible calendar dates` using
   `2026-02-30T00:00:00.000Z`.
   - `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts`
     exited 1 as expected.
   - The received record had `publishedAt: 2026-03-02T00:00:00.000Z`, proving
     the previous parser normalized the invalid date.
2. GREEN — audit timestamps now must match the collector's canonical
   `YYYY-MM-DDTHH:mm:ss.sssZ` format and round-trip through `toISOString()`
   before the parsed `Date` is accepted.
   - Focused test exited 0; 4 tests passed.

### Final verification

- `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts packages/pipeline/tests/materialize.test.ts`
  - Exit 0; 2 files and 14 tests passed.
- `pnpm typecheck`
  - Exit 0.
- `pnpm test`
  - Exit 0; 22 files and 116 tests passed.

### Self-review / concerns

- The strict format preserves every timestamp emitted by `parseAuditTree`,
  which always uses `Date#toISOString()`; no broader input format is part of
  the audit collector contract or its tests.
- No open concerns within the Task 3 fix scope.
