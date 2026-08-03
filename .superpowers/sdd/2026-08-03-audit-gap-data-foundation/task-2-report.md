# Task 2 report: pure entity identities and fuzzy candidates

Base commit: `51241ee0cf66412b60e6752d7b916dbf82ba5f4c`

## Scope delivered

- Added `packages/pipeline/src/entity-foundation.ts` with pure identity normalization, deterministic repo/audit seeds, and candidate scoring.
- Exported the entity-foundation API from `packages/pipeline/src/index.ts`.
- Added behavior tests in `packages/pipeline/tests/entity-foundation.test.ts`.

No entity storage, updates, or merges were introduced.

## TDD evidence

1. Wrote the initial behavior tests, then ran:

   ```text
   pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts
   ```

   Result: exit 1, expected RED. Vitest could not resolve
   `../src/entity-foundation.js` because the module did not yet exist.

2. Implemented the minimal module and export. Ran the focused test:

   ```text
   pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts
   ```

   Result: exit 0, 5 tests passed.

3. Added a regression test for a Unicode combining mark outside U+0300–U+036F.
   Before changing the implementation, the focused test failed as expected:

   ```text
   expected 'un iswap' to be 'uniswap'
   ```

4. Replaced the limited mark range with Unicode `\p{M}` removal and reran the
   focused test. Result: exit 0, 6 tests passed.

## Verification

```text
pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts
```

Result: exit 0; 1 file and 6 tests passed.

```text
pnpm vitest run packages/pipeline/tests
```

Result: exit 0; 6 files and 38 tests passed.

```text
pnpm typecheck
```

Result: exit 0. An earlier run caught strict indexed-array access errors in the
two-row Levenshtein implementation; those accesses were made explicit and the
fresh final typecheck passed.

```text
git diff --check
```

Result: exit 0; no whitespace errors.

## Self-review

- Normalization applies NFKD, lowercases, removes all Unicode combining marks,
  removes the specified noise tokens, and emits only alphanumeric tokens.
- Seed slugs are produced only from lowercase ASCII letters, digits, and hyphens.
- Candidate scoring is pure: it uses set Jaccard plus local two-row Levenshtein,
  clamps each component and the weighted result, and returns evidence in
  `reason` without mutable state or mutation APIs.
- The module does not need an `AliasTable` parameter yet: the task's listed
  production APIs consume normalized repository keys and produce independent
  seeds/scores; alias lookup remains in `resolver.ts`.

## Concerns

None. This task intentionally does not decide match thresholds or merge
entities; it only supplies deterministic candidates for later orchestration.
