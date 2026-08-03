# Audit Gap Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize exact entities, audit reports and reviewable fuzzy candidates, then collect GitHub HEAD/tree/compare snapshots and compute actionable `audit_gap` signals.

**Architecture:** Keep parsing, identity scoring and signal extraction pure in `packages/pipeline`/`packages/collectors`; keep Prisma orchestration in focused worker modules. `sync` runs catalog/audit materialization before deriving repo targets, then collects GitHub snapshots and materializes signals, so new scopes are handled in the same run.

**Tech Stack:** Node 24.14, TypeScript 5.7 strict/NodeNext, pnpm 10.33, Vitest 3, Prisma 6, PostgreSQL 16, Zod 3, GitHub REST API.

## Global Constraints

- Exact repo/platform/audit-hint matches may auto-resolve; fuzzy matches only create `pending` candidates.
- Missing or incomplete GitHub data must reduce confidence; it must never be represented as a real value of zero.
- Observations remain append-only and idempotent by `(collectorId, sourceUrl, contentHash)`.
- Collector failures are isolated per repo; one failed repo must not abort the sync.
- Use public APIs only, respect rate limits, and require `GITHUB_TOKEN` for the GitHub snapshot phase.
- GitHub recursive tree responses are incomplete when `truncated=true`; Compare changed-file lists are capped at 300 files and must be marked incomplete at that boundary.
- No production code is written before its failing test.
- After the final verification, commit, merge to `main`, and push automatically when a remote/upstream exists.

---

## File Structure

### Create

- `packages/db/prisma/migrations/20260803180000_audit_gap_foundation/migration.sql` — persistent aliases, merge candidates and idempotent audit reports.
- `packages/pipeline/src/entity-foundation.ts` — deterministic entity seeds, alias keys and fuzzy candidate scoring; no I/O.
- `packages/pipeline/tests/entity-foundation.test.ts` — exact/fuzzy invariants.
- `packages/pipeline/src/audit-materialize.ts` — pure conversion of audit observations to report/entity records.
- `packages/pipeline/tests/audit-materialize.test.ts` — malformed/idempotent record behavior.
- `packages/collectors/tests/__fixtures__/github-head.json` — real-shape HEAD commit response.
- `packages/collectors/tests/__fixtures__/github-tree.json` — real-shape recursive tree response.
- `packages/collectors/tests/__fixtures__/github-compare.json` — real-shape compare response.
- `packages/collectors/src/sources/github-repo-snapshot.ts` — HEAD/tree/base/compare collector.
- `packages/collectors/tests/github-repo-snapshot.test.ts` — parser, LOC estimate, cutoff and partial-error tests.
- `packages/pipeline/src/repo-signals.ts` — repo target derivation records and pure snapshot-to-signal conversion.
- `packages/pipeline/tests/repo-signals.test.ts` — cutoff matching, confidence and evidence tests.
- `apps/worker/src/foundation.ts` — Prisma orchestration for catalog/entities/reports/candidates/snapshots/signals.
- `apps/worker/tests/foundation.integration.test.ts` — PostgreSQL idempotency and cross-stage integration.
- `vitest.integration.config.ts` — opt-in DB test config.

### Modify

- `packages/db/prisma/schema.prisma` — add `EntityAlias`, `MergeCandidate`, audit provenance fields, relations and unique report URL.
- `packages/pipeline/src/index.ts` — export foundation modules.
- `packages/collectors/src/types.ts` — optional per-observation health metadata.
- `packages/collectors/src/harness.ts` — `partial` run status and saving successful/failure observations.
- `packages/collectors/tests/harness.test.ts` — partial-run behavior.
- `packages/collectors/src/sources/index.ts` — export snapshot collector/types.
- `packages/collectors/src/index.ts` — export new source through existing barrel.
- `packages/pipeline/src/extractors/audit-gap.ts` — accept normalized snapshot evidence and confidence.
- `packages/pipeline/tests/audit-gap.test.ts` — estimated/truncated/mismatched-cutoff cases.
- `apps/worker/src/cli.ts` — focused stage dispatch, `sync`, audit/GitHub collectors.
- `apps/worker/package.json`, root `package.json` — `sync` and integration-test scripts.
- `config/aliases.yml` — no format change; it remains bootstrap input.

---

### Task 1: Persist aliases, candidates and audit identity

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260803180000_audit_gap_foundation/migration.sql`

**Interfaces:**
- Produces: Prisma models `EntityAlias`, `MergeCandidate`; fields `AuditReport.projectHint`, `AuditReport.observationIds`; unique `AuditReport.reportUrl`.

- [ ] **Step 1: Add schema models and relations**

Add to `Entity`:

```prisma
aliases         EntityAlias[]
leftCandidates  MergeCandidate[] @relation("CandidateLeft")
rightCandidates MergeCandidate[] @relation("CandidateRight")
```

Add/modify models:

```prisma
model EntityAlias {
  id        String   @id @default(cuid())
  entity    Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)
  entityId  String
  kind      String
  key       String
  source    String
  createdAt DateTime @default(now())

  @@unique([kind, key])
  @@index([entityId])
}

model MergeCandidate {
  id            String   @id @default(cuid())
  leftEntity    Entity   @relation("CandidateLeft", fields: [leftEntityId], references: [id], onDelete: Cascade)
  leftEntityId  String
  rightEntity   Entity   @relation("CandidateRight", fields: [rightEntityId], references: [id], onDelete: Cascade)
  rightEntityId String
  similarity    Float
  status        String   @default("pending")
  reason        Json
  decidedAt     DateTime?
  createdAt     DateTime @default(now())

  @@unique([leftEntityId, rightEntityId])
  @@index([status, similarity])
}
```

Add to `AuditReport`:

```prisma
projectHint    String
observationIds String[]
reportUrl      String @unique
```

- [ ] **Step 2: Validate that migration is currently missing**

Run: `pnpm --filter @kritt-radar/db exec prisma migrate status`

Expected: schema changes are not represented by a migration.

- [ ] **Step 3: Generate migration without applying it**

Run: `pnpm --filter @kritt-radar/db exec prisma migrate dev --create-only --name audit_gap_foundation`

Inspect the SQL. It must create both tables, relations and indexes; add
`projectHint`/`observationIds` with safe backfills before making them NOT NULL;
and add the unique index on `AuditReport.reportUrl`.

- [ ] **Step 4: Apply migration, regenerate and validate client**

Run: `pnpm --filter @kritt-radar/db exec prisma migrate deploy`

Run: `pnpm --filter @kritt-radar/db run generate`

Run: `pnpm --filter @kritt-radar/db exec prisma validate`

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): persist entity aliases and merge candidates"
```

---

### Task 2: Pure entity identities and fuzzy candidates

**Files:**
- Create: `packages/pipeline/src/entity-foundation.ts`
- Create: `packages/pipeline/tests/entity-foundation.test.ts`
- Modify: `packages/pipeline/src/index.ts`

**Interfaces:**
- Consumes: normalized repo keys and `AliasTable` from `resolver.ts`.
- Produces:

```ts
type AliasKind = 'repo' | 'platform_name' | 'audit_hint';
interface EntitySeed { slug: string; canonicalName: string }
interface CandidateScore { similarity: number; reason: { tokenJaccard: number; editSimilarity: number } }
normalizeIdentityText(value: string): string
repoEntitySeed(repoKey: string): EntitySeed
auditEntitySeed(projectHint: string): EntitySeed
scoreCandidate(left: string, right: string): CandidateScore
```

- [ ] **Step 1: Write failing identity tests**

Create tests covering these literals:

```ts
expect(normalizeIdentityText('Uniswap V4 — Audit Report')).toBe('uniswap v4');
expect(repoEntitySeed('github.com/Uniswap/v4-core')).toEqual({
  slug: 'repo-github-com-uniswap-v4-core',
  canonicalName: 'uniswap/v4-core',
});
expect(auditEntitySeed('uniswap-v4')).toEqual({ slug: 'audit-uniswap-v4', canonicalName: 'uniswap v4' });

const near = scoreCandidate('Uniswap v4', 'uniswap-v4 audit');
const far = scoreCandidate('Uniswap v4', 'Aave v3');
expect(near.similarity).toBeGreaterThan(0.8);
expect(far.similarity).toBeLessThan(0.5);
```

Also assert that this module returns scores only; it exposes no function that
updates or merges entities.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts`

Expected: FAIL because `entity-foundation.js` does not exist.

- [ ] **Step 3: Implement minimal normalization and scoring**

Use Unicode NFKD, lowercase, remove combining marks, remove noise tokens
`audit|report|security|assessment|review`, then split alphanumeric tokens.
Calculate:

```ts
const similarity = 0.6 * tokenJaccard + 0.4 * editSimilarity;
```

Implement Levenshtein locally with two rows of memory. Clamp every component to
`[0,1]`. Deterministic slugs must use only lowercase ASCII and hyphens.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run packages/pipeline/tests/entity-foundation.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src packages/pipeline/tests
git commit -m "feat(pipeline): derive entity identities and fuzzy candidates"
```

---

### Task 3: Convert audit observations into idempotent records

**Files:**
- Create: `packages/pipeline/src/audit-materialize.ts`
- Create: `packages/pipeline/tests/audit-materialize.test.ts`
- Modify: `packages/pipeline/src/index.ts`

**Interfaces:**
- Consumes: latest `audit-report-repos` observations containing `AuditReportPayload[]`.
- Produces:

```ts
interface AuditObservationRow {
  id: string;
  sourceUrl: string;
  fetchedAt: Date;
  payload: unknown;
}
interface AuditReportRecord {
  entity: EntitySeed;
  report: {
    firm: string; projectHint: string; publishedAt: Date; reportUrl: string;
    coveredCommit: null; coveredPaths: string[]; observationIds: string[];
  };
  observationId: string;
}
toAuditReportRecords(rows: readonly AuditObservationRow[]): AuditReportRecord[]
```

- [ ] **Step 1: Write failing tests**

Fixture rows must include two observations for the same source and one malformed
payload. Assert the latest source wins, duplicate `reportUrl` collapses, invalid
dates are dropped, and `observationId` is preserved.

```ts
expect(records[0]!.entity.slug).toBe('audit-uniswap-v4');
expect(records[0]!.report.projectHint).toBe('uniswap-v4');
expect(records[0]!.report.publishedAt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure conversion**

Reuse `latestBySourceUrl` semantics but retain observation IDs. Deduplicate by
`reportUrl`, keeping the newest fetched observation.

- [ ] **Step 4: Verify GREEN and regressions**

Run: `pnpm vitest run packages/pipeline/tests/audit-materialize.test.ts packages/pipeline/tests/materialize.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): normalize audit report observations"
```

---

### Task 4: Materialize catalog, aliases, reports and candidates

**Files:**
- Create: `apps/worker/src/foundation.ts`
- Create: `apps/worker/tests/foundation.integration.test.ts`
- Create: `vitest.integration.config.ts`
- Modify: `apps/worker/package.json`, root `package.json`, `apps/worker/src/cli.ts`

**Interfaces:**
- Consumes: `PrismaClient`, parsed `config/aliases.yml`, program/audit observations.
- Produces:

```ts
materializeCatalogFoundation(prisma: PrismaClient, aliasesYaml: string, now: Date): Promise<{
  programs: number; scopes: number; entities: number; reports: number; candidates: number;
}>
```

- [ ] **Step 1: Write failing PostgreSQL integration test**

The test seeds Uniswap and Aave program repos, one exact Uniswap alias and audit
observations for `uniswap-v4` plus `aave-v3-review`. After materialization assert:

```ts
expect(await prisma.entityAlias.count()).toBe(1);
expect((await prisma.program.findFirstOrThrow()).entityId).not.toBeNull();
expect(await prisma.auditReport.count()).toBe(2);
expect(await prisma.mergeCandidate.count({ where: { status: 'pending' } })).toBe(1);
```

Run materialization twice and assert counts do not change. Seed a rejected
candidate, run again, and assert it remains rejected.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`

Expected: FAIL because `foundation.ts` and scripts do not exist.

- [ ] **Step 3: Implement catalog/entity transactions**

Extract existing program/scope DB writes from `cli.ts`. For each program:

1. Match DB alias by exact repo key, then exact platform/title key.
2. Otherwise upsert `repoEntitySeed(scope.hardKey)`.
3. Upsert Program with `entityId`.
4. Upsert Scope without deleting existing signals.

Synchronize YAML aliases with `source='config'` using upsert; never delete
`source='manual'` aliases.

- [ ] **Step 4: Implement audit/candidate transaction**

Upsert provisional audit entities and reports by `reportUrl`. Apply exact
`audit_hint` alias when present. Otherwise score against non-provisional program
entities and upsert only scores `>= 0.65`. Never mutate entity links from a fuzzy
score. Preserve existing candidate status on update.

- [ ] **Step 5: Verify integration GREEN**

Run: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`

Expected: all tests pass with no leaked rows after cleanup.

- [ ] **Step 6: Run unit regressions and commit**

Run: `pnpm test`

```bash
git add apps/worker packages/pipeline vitest.integration.config.ts package.json
git commit -m "feat(worker): materialize entities audits and merge candidates"
```

---

### Task 5: GitHub snapshot parser and per-repo isolation

**Files:**
- Create: `packages/collectors/src/sources/github-repo-snapshot.ts`
- Create: `packages/collectors/tests/github-repo-snapshot.test.ts`
- Create: three GitHub fixtures listed in File Structure
- Modify: `packages/collectors/src/types.ts`, `packages/collectors/src/harness.ts`, `packages/collectors/tests/harness.test.ts`, barrel exports

**Interfaces:**
- Consumes:

```ts
interface RepoTarget {
  repoKey: string; pathGlobs: string[]; lastAuditAt: string | null; coveredCommit: string | null;
}
```

- Produces:

```ts
interface RepoSnapshotPayload {
  repoKey: string;
  cutoff: { lastAuditAt: string | null; baseCommit: string | null };
  headSha: string | null;
  headAuthoredAt: string | null;
  files: string[];
  totalLoc: number;
  locMethod: 'estimated_from_bytes';
  changedFiles: Array<{ path: string; changedLoc: number }>;
  commits: string[];
  complete: boolean;
  truncated: boolean;
  error: string | null;
}
interface ParsedHead { sha: string; authoredAt: string; treeSha: string }
interface ParsedTree { files: string[]; totalBytes: number; truncated: boolean }
interface ParsedCompare {
  changedFiles: Array<{ path: string; changedLoc: number }>;
  commits: string[];
  truncated: boolean;
}
parseHead(raw: unknown): ParsedHead
parseTree(raw: unknown, pathGlobs: readonly string[]): ParsedTree
parseCompare(raw: unknown, pathGlobs: readonly string[]): ParsedCompare
makeGithubRepoSnapshots(listTargets: () => Promise<RepoTarget[]>): Collector<RepoSnapshotPayload>
```

- [ ] **Step 1: Add failing fixture parser tests**

Assert:

```ts
expect(parseHead(headFixture).sha).toBe('abc123');
expect(parseTree(treeFixture, ['src/**/*.sol'])).toEqual({
  files: ['src/Pool.sol'], totalBytes: 4000, truncated: false,
});
expect(parseCompare(compareFixture, ['src/**/*.sol']).changedFiles[0]).toEqual({
  path: 'src/Pool.sol', changedLoc: 42,
});
```

Add boundary fixtures/tests where tree `truncated=true` and compare contains 300
files; both must produce `complete=false`/`truncated=true`.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run packages/collectors/tests/github-repo-snapshot.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement parsers and request sequence**

Use these official endpoints:

```text
GET /repos/{owner}/{repo}/commits/HEAD
GET /repos/{owner}/{repo}/git/trees/{headTreeSha}?recursive=1
GET /repos/{owner}/{repo}/commits?until={ISO}&per_page=1
GET /repos/{owner}/{repo}/compare/{base}...{head}?per_page=100&page=1
```

Set GitHub headers `accept: application/vnd.github+json` and
`X-GitHub-Api-Version: 2026-03-10`. Estimate LOC with
`Math.ceil(scopedBlobBytes / 40)`.

- [ ] **Step 4: Add RED test for repo failure isolation and partial status**

Inject two targets and a fetch dependency that throws for the first repo but
returns fixtures for the second. Assert two observations are yielded: one
`complete=false`, one `complete=true`. Update harness test to expect:

```ts
expect(run.status).toBe('partial');
expect(run.itemCount).toBe(2);
```

- [ ] **Step 5: Implement observation health and partial harness**

Add optional metadata without changing payload hashing:

```ts
interface ObservationHealth { ok: boolean; error?: string }
interface RawObservation<T> { /* existing fields */ health?: ObservationHealth }
type CollectorRunStatus = 'ok' | 'partial' | 'error' | 'skipped';
makeObservation<T>(collectorId: string, sourceUrl: string, payload: T, health?: ObservationHealth): RawObservation<T>
```

The collector catches per-target errors and yields a failure snapshot. Harness
saves all observations and returns `partial` when health contains both success
and failure; all failures return `error` but remain saved for diagnosis.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run packages/collectors/tests/github-repo-snapshot.test.ts packages/collectors/tests/harness.test.ts`

Run: `pnpm test`

```bash
git add packages/collectors
git commit -m "feat(collectors): collect isolated GitHub repo snapshots"
```

---

### Task 6: Derive repo targets and materialize audit_gap

**Files:**
- Create: `packages/pipeline/src/repo-signals.ts`
- Create: `packages/pipeline/tests/repo-signals.test.ts`
- Modify: `packages/pipeline/src/extractors/audit-gap.ts`, its tests, pipeline barrel, `apps/worker/src/foundation.ts`

**Interfaces:**
- Produces:

```ts
interface RepoTargetRecord extends RepoTarget { scopeId: string; auditObservationIds: string[] }
snapshotToAuditGap(snapshot: RepoSnapshotPayload, expected: RepoTarget): SignalValue
listRepoTargets(prisma: PrismaClient): Promise<RepoTargetRecord[]>
materializeRepoSignals(prisma: PrismaClient, now: Date): Promise<{ scopes: number; noData: number }>
```

- [ ] **Step 1: Write failing pure signal tests**

Cover:

```ts
expect(snapshotToAuditGap(completeAudited, target).evidence.headSha).toBe('abc123');
expect(snapshotToAuditGap(noAudit, noAuditTarget).value).toBe(1);
expect(snapshotToAuditGap(failed, target).confidence).toBe(0);
expect(snapshotToAuditGap(truncated, target).confidence).toBeLessThan(1);
expect(snapshotToAuditGap(staleCutoff, target).evidence.reason).toBe('stale_cutoff');
```

For LOC estimated from bytes, assert confidence is `0.7`; for truncated data,
cap it at `0.35`; failed/stale data is `0`.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run packages/pipeline/tests/repo-signals.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure conversion and evidence**

Reuse `extractAuditGap` for value math. Evidence must include:

```ts
{
  headSha, sinceCommit, sinceDate, files, commits, changedLoc, totalLoc,
  locMethod: 'estimated_from_bytes', complete, truncated
}
```

Validate snapshot cutoff against the current target before using changed files.

- [ ] **Step 4: Add failing integration assertions**

Extend worker integration test: seed an approved entity/report, a scope and a
matching snapshot observation. Assert `Scope.commitish='abc123'`, one audit_gap
signal, correct observation IDs and idempotent second materialization. Add a
failed snapshot for another scope and assert confidence 0 without blocking the
first.

- [ ] **Step 5: Implement DB target query and signal upserts**

For each repo scope, select the newest AuditReport by `publishedAt DESC` through
`Program.entityId`. Target uses `coveredCommit` when present. Snapshot lookup is
latest observation by repo source URL. Upsert signal by `(scopeId,type)` and
update `Scope.commitish` only when `headSha` is non-null.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run packages/pipeline/tests/repo-signals.test.ts packages/pipeline/tests/audit-gap.test.ts`

Run: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`

```bash
git add packages/pipeline apps/worker/src/foundation.ts apps/worker/tests
git commit -m "feat(pipeline): materialize GitHub snapshots into audit-gap signals"
```

---

### Task 7: Two-phase sync CLI

**Files:**
- Modify: `apps/worker/src/cli.ts`, `apps/worker/package.json`, root `package.json`
- Test: `apps/worker/tests/foundation.integration.test.ts`

**Interfaces:**
- Produces CLI commands `collect-catalog`, `collect-github`, `materialize-catalog`, `materialize-signals`, `sync`; preserves `collect`, `materialize`, `rank` compatibility.

- [ ] **Step 1: Write failing orchestration test**

Extract a dependency-injected `sync(deps)` and record stage calls. Assert exact
order:

```ts
expect(calls).toEqual([
  'collect-catalog',
  'materialize-catalog',
  'collect-github',
  'materialize-signals',
  'rank',
]);
```

Assert a partial GitHub run does not skip `materialize-signals` or `rank`.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`

Expected: FAIL because `sync` is not exported.

- [ ] **Step 3: Implement commands and scripts**

Catalog collectors are C4, Sherlock, Cantina, Immunefi and audit-report repos.
GitHub collector is created after catalog materialization with
`listRepoTargets(prisma)`. Root script:

```json
"sync": "pnpm build && pnpm --filter @kritt-radar/worker run cli sync"
```

Keep `collect` as catalog collection for backward compatibility; document its
output label clearly.

- [ ] **Step 4: Verify integration and unit suites**

Run: `pnpm test:integration -- apps/worker/tests/foundation.integration.test.ts`

Run: `pnpm test`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker package.json
git commit -m "feat(worker): orchestrate two-phase audit-gap sync"
```

---

### Task 8: Full verification, live smoke test and delivery

**Files:**
- Modify only files required by defects reproduced during this task; every fix needs a failing regression test first.

- [ ] **Step 1: Fresh database verification**

Run:

```bash
docker compose up -d postgres
pnpm migrate
pnpm test:integration
```

Expected: migrations apply and integration suite passes.

- [ ] **Step 2: Full static/unit verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: zero failures and zero TypeScript errors.

- [ ] **Step 3: Live sync smoke test**

Run: `pnpm sync`

Expected:

- catalog and audit collectors finish independently;
- GitHub collector reports `ok` or `partial`, not a global crash;
- materializer reports non-zero scopes and audit-gap signals;
- rank contains both `freshness=` and `audit_gap=` or explicitly
  `[no data: audit_gap]`.

- [ ] **Step 4: Inspect actionable evidence**

Query the top non-zero audit-gap signal and verify evidence contains HEAD SHA,
cutoff, commit SHA and non-empty file paths. Query one missing-data scope and
verify confidence 0 with a reason.

- [ ] **Step 5: Commit verification fixes, if any**

```bash
git add -A
git commit -m "fix(pipeline): harden audit-gap end-to-end sync"
```

Skip this commit when no files changed.

- [ ] **Step 6: Auto-merge and push**

After fresh verification on the feature branch:

```bash
git checkout main
git pull --ff-only   # only when an upstream exists
git merge codex/audit-gap-data-foundation
pnpm test
git branch -d codex/audit-gap-data-foundation
git push             # only when a remote/upstream exists
```

If no remote/upstream exists, complete the local merge and report that push was
not possible. Never invent or add a remote URL.
