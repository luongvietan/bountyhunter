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

## Fix round 1: audit seed consistency and public barrel export

Reviewer findings addressed:

- **P1:** `auditEntitySeed` now forms its slug from `canonicalName`, which is
  the normalized, noise-free identity text. Equivalent hints such as
  `Üniswap V4 Audit Report` and `uniswap-v4` therefore return the same slug
  and seed.
- **P2:** Added a behavior test that calls `auditEntitySeed` through
  `packages/pipeline/src/index.ts`, proving the public pipeline barrel exports
  the entity-foundation API.

### TDD evidence

Added the noisy/accented equivalence regression test before the implementation
change, then ran:

```text
pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts
```

Result: exit 1, expected RED. The received seed had
`slug: 'audit-uniswap-v4-audit-report'` while the equivalent normalized hint
had `slug: 'audit-uniswap-v4'`.

Changed only `auditEntitySeed` to call `slugify(canonicalName)` rather than
`slugify(projectHint)`.

### Verification

```text
pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts
```

Result: exit 0; 1 file and 8 tests passed.

```text
pnpm vitest run packages/pipeline/tests
```

Result: exit 0; 6 files and 40 tests passed.

```text
pnpm typecheck
```

Result: exit 0.

### Self-review and concerns

- The slug and canonical name now share precisely the same semantic token
  source, so punctuation, case, diacritics, and required noise tokens cannot
  cause equivalent audit hints to diverge.
- The public-barrel assertion invokes the exported function and asserts its
  consumer-visible seed, rather than merely checking a symbol exists.
- No concerns; the change remains pure and does not introduce entity updates
  or merges.
