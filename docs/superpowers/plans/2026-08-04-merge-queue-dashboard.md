# Merge Queue Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an internal Next.js `/merge-queue` where one trusted operator can inspect, approve, reject, and reopen fuzzy entity candidates without permitting fuzzy auto-merge.

**Architecture:** Add `apps/web` as a Next.js App Router package. Server Components use a focused Prisma query layer; Server Actions call a framework-independent transactional decision service. PostgreSQL integration tests prove mutation invariants, while Playwright verifies the operator workflow against a guarded disposable database.

**Tech Stack:** Node 24, TypeScript 5.7 strict/NodeNext, pnpm 10, Next.js 16.2.12, React 19.2.8, Prisma 6.19, PostgreSQL 16, Zod 3.24, Vitest 3.2, Playwright 1.62.1, plain CSS.

## Global Constraints

- The app is internal and single-operator; do not add authentication or a public mutation API.
- Fuzzy scores never mutate data without an explicit operator approval.
- Do not add bulk approval. Approved decisions cannot reopen in v1; rejected decisions can.
- Every mutation is server-only, transactional, compare-and-set, and fail-closed on ambiguity or alias conflicts.
- Use system fonts and local CSS only; do not add remote font or image dependencies.
- Keep `apps/web` files focused; database decision logic must not live inside React components.
- No production code is written before its failing test.
- Default unit tests must not require Docker; PostgreSQL tests use `*.integration.test.ts` and a guarded dedicated database.
- Completion requires unit, integration, Next build/typecheck, Playwright, browser visual QA, independent review, local merge to `main`, and push only when a real remote/upstream exists.

---

## File Structure

### Create

- `apps/web/package.json` — Next scripts and workspace dependencies.
- `apps/web/next.config.ts` — standalone-compatible workspace package transpilation.
- `apps/web/tsconfig.json`, `apps/web/next-env.d.ts` — Next TypeScript configuration.
- `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css` — global shell and visual system.
- `apps/web/src/app/page.tsx` — redirect `/` to `/merge-queue`.
- `apps/web/src/app/merge-queue/page.tsx` — server-rendered queue route.
- `apps/web/src/app/merge-queue/actions.ts` — validated Server Actions.
- `apps/web/src/app/merge-queue/candidate-card.tsx` — queue row and evidence disclosure.
- `apps/web/src/app/merge-queue/decision-form.tsx` — client action state and confirmations.
- `apps/web/src/lib/merge-queue.ts` — serializable read model and status parsing.
- `apps/web/src/lib/merge-decisions.ts` — transactional approve/reject/reopen service.
- `apps/web/tests/merge-queue.test.ts` — pure projection and status tests.
- `apps/web/tests/merge-queue.integration.test.ts` — PostgreSQL read-model tests.
- `apps/web/tests/merge-decisions.integration.test.ts` — PostgreSQL mutation tests.
- `apps/web/playwright.config.ts` — browser runner and guarded web server.
- `apps/web/tests/e2e/database.ts` — exact disposable DB create/migrate/seed/drop helpers.
- `apps/web/tests/e2e/global-setup.ts`, `global-teardown.ts` — E2E lifecycle.
- `apps/web/tests/e2e/merge-queue.e2e.spec.ts` — pending/reject/reopen/approve browser flow.

### Modify

- `package.json` — root `dev:web`, `test:e2e`, and workspace build scripts.
- `vitest.config.ts` — exclude Playwright specs from unit discovery.
- `vitest.integration.config.ts` — include web integration tests.
- `pnpm-lock.yaml` — resolved frontend and Playwright dependencies.

---

### Task 1: Scaffold the web package and queue read model

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next-env.d.ts`
- Create: `apps/web/src/lib/merge-queue.ts`
- Create: `apps/web/tests/merge-queue.test.ts`
- Create: `apps/web/tests/merge-queue.integration.test.ts`
- Modify: `package.json`
- Modify: `vitest.integration.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `PrismaClient`, `MergeCandidate`, `Entity`, `AuditReport`, `Program`, and `Scope` from `@kritt-radar/db`.
- Produces:

```ts
export type QueueStatus = 'pending' | 'approved' | 'rejected';

export interface QueueEntity {
  id: string;
  slug: string;
  canonicalName: string;
  provisional: boolean;
  auditReportCount: number;
  projectHints: string[];
  auditFirms: string[];
  programCount: number;
  platforms: string[];
  programTitles: string[];
  repoScopes: string[];
}

export interface QueueCandidate {
  id: string;
  status: QueueStatus;
  similarity: number;
  tokenJaccard: number | null;
  editSimilarity: number | null;
  createdAt: string;
  decidedAt: string | null;
  source: QueueEntity | null;
  target: QueueEntity | null;
  approvable: boolean;
  blockedReason: string | null;
}

export interface MergeQueuePage {
  status: QueueStatus;
  counts: Record<QueueStatus, number>;
  candidates: QueueCandidate[];
}

export function parseQueueStatus(value: string | string[] | undefined): QueueStatus;
export function inferCandidateRoles(left: QueueEntity, right: QueueEntity): {
  source: QueueEntity | null;
  target: QueueEntity | null;
  blockedReason: string | null;
};
export function listMergeQueue(prisma: PrismaClient, status: QueueStatus): Promise<MergeQueuePage>;
```

- [ ] **Step 1: Install exact web dependencies**

Run:

```powershell
pnpm --filter @kritt-radar/web add next@16.2.12 react@19.2.8 react-dom@19.2.8 zod@^3.24.1 @kritt-radar/db@workspace:* @kritt-radar/pipeline@workspace:*
pnpm --filter @kritt-radar/web add -D typescript@^5.7.2 @types/node@^24 @types/react@^19 @types/react-dom@^19
```

Before running, create `apps/web/package.json` with package name
`@kritt-radar/web` and scripts `dev`, `build`, `start`, and `typecheck` so pnpm
can select it.

- [ ] **Step 2: Write failing pure tests**

Cover these exact behaviors:

```ts
expect(parseQueueStatus(undefined)).toBe('pending');
expect(parseQueueStatus('approved')).toBe('approved');
expect(parseQueueStatus('garbage')).toBe('pending');

const roles = inferCandidateRoles(provisional, canonical);
expect(roles.source?.id).toBe(provisional.id);
expect(roles.target?.id).toBe(canonical.id);
expect(inferCandidateRoles(provisional, anotherProvisional).blockedReason)
  .toContain('exactly one provisional');
```

Also assert reason JSON with missing or malformed score components yields
`null`, not `NaN`, and queue timestamps serialize to ISO strings.

- [ ] **Step 3: Run unit RED**

Run: `pnpm vitest run apps/web/tests/merge-queue.test.ts`

Expected: FAIL because `src/lib/merge-queue.ts` does not exist.

- [ ] **Step 4: Implement pure projection and package config**

Implement status parsing, role inference, finite score extraction, stable unique
string lists, and ISO serialization. Configure Next to transpile
`@kritt-radar/db` and `@kritt-radar/pipeline`. Extend `tsconfig.base.json` with
Next's DOM libs only inside `apps/web/tsconfig.json`, not globally.

- [ ] **Step 5: Write PostgreSQL read-model RED tests**

Seed one candidate in each status plus two candidates with equal similarity.
Assert:

```ts
expect(page.counts).toEqual({ pending: 3, approved: 1, rejected: 1 });
expect(page.candidates.map((row) => row.id)).toEqual([
  'highest-score',
  'older-tie',
  'newer-tie',
]);
expect(page.candidates[0]!.source?.projectHints).toEqual(['aave-v3-review']);
expect(page.candidates[0]!.target?.repoScopes).toContain('github.com/aave/aave-v3-origin');
```

Use a dedicated database name ending `_integration`; validate the connected
database before cleanup using the same fail-closed pattern as worker integration
tests.

- [ ] **Step 6: Implement `listMergeQueue`**

Use one candidate query with both entity relations, their reports, and programs
with repo scopes; query grouped status counts separately. Sort in Prisma by
`similarity desc`, `createdAt asc`, `id asc`. Do not expose Prisma Decimal, Date,
or raw JSON objects to React.

- [ ] **Step 7: Verify Task 1**

Run:

```powershell
pnpm vitest run apps/web/tests/merge-queue.test.ts
$env:DATABASE_URL='postgresql://kritt:kritt@localhost:5433/kritt_radar_integration?schema=public'; pnpm test:integration -- apps/web/tests/merge-queue.integration.test.ts
pnpm --filter @kritt-radar/web typecheck
```

Expected: pure and integration tests pass; web typecheck exits 0.

- [ ] **Step 8: Commit**

```powershell
git add apps/web package.json pnpm-lock.yaml vitest.integration.config.ts
git commit -m "feat(web): add merge queue read model"
```

---

### Task 2: Implement transactional merge decisions

**Files:**
- Create: `apps/web/src/lib/merge-decisions.ts`
- Create: `apps/web/tests/merge-decisions.integration.test.ts`

**Interfaces:**
- Consumes: injected `PrismaClient`, candidate ID, and explicit action.
- Produces:

```ts
export type MergeDecisionAction = 'approve' | 'reject' | 'reopen';

export type MergeDecisionResult =
  | { ok: true; action: MergeDecisionAction; candidateId: string; reportsMoved: number; siblingsRejected: number }
  | { ok: false; code: 'not_found' | 'conflict' | 'not_approvable'; message: string };

export function normalizeAuditHintKey(projectHint: string): string;
export function decideMergeCandidate(
  prisma: PrismaClient,
  input: { candidateId: string; action: MergeDecisionAction; now?: Date },
): Promise<MergeDecisionResult>;
```

- [ ] **Step 1: Write approve RED integration tests**

Seed a pending candidate whose provisional entity owns two reports with the same
normalized hint and one sibling candidate. Assert one approval:

```ts
expect(result).toMatchObject({ ok: true, reportsMoved: 2, siblingsRejected: 1 });
expect(await prisma.entityAlias.findUnique({
  where: { kind_key: { kind: 'audit_hint', key: 'aave-v3-review' } },
})).toMatchObject({ entityId: canonical.id, source: 'manual' });
expect(await prisma.auditReport.count({ where: { entityId: canonical.id } })).toBe(2);
expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: sibling.id } }))
  .toMatchObject({ status: 'rejected', decidedAt: now });
```

Assert the provisional entity still exists.

- [ ] **Step 2: Run approve RED**

Run with the guarded integration database:

`pnpm test:integration -- apps/web/tests/merge-decisions.integration.test.ts`

Expected: FAIL because `merge-decisions.ts` does not exist.

- [ ] **Step 3: Implement approval transaction**

Use `prisma.$transaction(async (tx) => { ... }, { isolationLevel: 'Serializable' })`.
Infer roles from current entity rows. Compare-and-set the selected candidate with
`updateMany({ where: { id, status: 'pending' }, ... })`; require count 1 before
writing aliases/reports. Normalize hints using `trim().toLowerCase()` to match
the foundation materializer. Preflight all existing alias rows before any alias
create. Upsert only aliases that are absent or already target the same entity;
never change a conflicting alias. Relink reports, reject pending siblings, and
return exact affected counts. Retry Prisma `P2034` at most twice with no sleep.

- [ ] **Step 4: Write fail-closed RED cases**

Cover:

- two provisional or two canonical entities;
- no audit report on the provisional entity;
- empty normalized project hint;
- existing manual/config alias targeting another entity;
- candidate decided by another transaction/tab;
- approved candidate submitted again;
- database error after candidate CAS rolls back status, aliases, and report links.

- [ ] **Step 5: Implement expected conflict mapping**

Return `not_found`, `not_approvable`, or `conflict` without exposing Prisma error
text. Unexpected errors must rethrow so Server Actions can log them. Prove a
conflicting alias leaves every row unchanged.

- [ ] **Step 6: Write reject/reopen RED cases**

Assert `pending → rejected → pending`, including exact `decidedAt` set/cleared.
Assert reject changes no alias/report/entity rows. Assert `approved → reopen`
returns conflict and remains approved.

- [ ] **Step 7: Implement reject/reopen compare-and-set transitions**

Reject uses `where: { id, status: 'pending' }`; reopen uses
`where: { id, status: 'rejected' }`. Reopen first confirms both entity relations
still exist. Return zero report/sibling counts for both actions.

- [ ] **Step 8: Verify Task 2**

Run:

```powershell
$env:DATABASE_URL='postgresql://kritt:kritt@localhost:5433/kritt_radar_integration?schema=public'; pnpm test:integration -- apps/web/tests/merge-decisions.integration.test.ts
pnpm test
pnpm typecheck
```

Expected: all decision integration tests, unit tests, and typecheck pass.

- [ ] **Step 9: Commit**

```powershell
git add apps/web/src/lib apps/web/tests
git commit -m "feat(web): apply merge decisions transactionally"
```

---

### Task 3: Build the merge queue route and operator interface

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/merge-queue/page.tsx`
- Create: `apps/web/src/app/merge-queue/actions.ts`
- Create: `apps/web/src/app/merge-queue/candidate-card.tsx`
- Create: `apps/web/src/app/merge-queue/decision-form.tsx`
- Test: `apps/web/tests/merge-queue.test.ts`

**Interfaces:**
- Consumes: `listMergeQueue`, `parseQueueStatus`, `decideMergeCandidate`, and shared `prisma`.
- Produces:

```ts
export interface DecisionActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

export async function submitMergeDecision(
  previous: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState>;
```

- [ ] **Step 1: Write failing action validation tests**

Extract and test a pure parser used by the Server Action:

```ts
expect(parseDecisionForm(new FormData())).toEqual({ ok: false, message: 'Missing candidate decision.' });
expect(parseDecisionForm(form('candidate-1', 'approve'))).toEqual({
  ok: true,
  value: { candidateId: 'candidate-1', action: 'approve' },
});
expect(parseDecisionForm(form('candidate-1', 'delete')).ok).toBe(false);
```

Run `pnpm vitest run apps/web/tests/merge-queue.test.ts` and verify RED because
the action parser is absent.

- [ ] **Step 2: Implement route and Server Action**

`page.tsx` awaits `searchParams`, parses `status`, and calls `listMergeQueue`.
`submitMergeDecision` validates candidate ID/action with Zod, calls the decision
service, logs only unexpected errors, calls `revalidatePath('/merge-queue')` on
success, and returns operator-safe text. Do not redirect on mutation errors.

- [ ] **Step 3: Implement the visual system**

Build these concrete regions:

- masthead with product name, “internal operator console”, DB-backed status
  counts, and a sync timestamp label;
- status tabs with URL links and count badges;
- score rail showing percentage plus token/edit component bars;
- candidate cards with source → canonical target identity, project/audit/program
  evidence, repository chips, timestamps, and expandable raw rationale;
- a confirmation panel naming report and alias counts before approval;
- reject and rejected-only reopen controls;
- conflict banner when `approvable=false`.

Use semantic `main`, `nav`, `article`, `dl`, `form`, and real buttons. Add a skip
link, `:focus-visible`, `prefers-reduced-motion`, tabular numerals, a 44px minimum
touch target, and a single-column breakpoint at 760px. No gradients, glass cards,
remote fonts, icon package, or decorative charts.

- [ ] **Step 4: Implement client decision state**

`decision-form.tsx` uses React 19 `useActionState`. Approval requires a native
checkbox confirmation whose label contains source and target names; the submit
button remains disabled until checked. Rejection and reopen do not require the
checkbox. Disable controls while pending and announce results through an
`aria-live='polite'` region.

- [ ] **Step 5: Add setup and empty states**

If Prisma reports a missing/unreachable database, render a setup panel with
`docker compose up -d postgres`, `pnpm migrate`, and `pnpm sync`; do not expose
the connection string. For zero rows, distinguish “no candidates yet” from an
empty selected history status.

- [ ] **Step 6: Verify Task 3**

Run:

```powershell
pnpm vitest run apps/web/tests/merge-queue.test.ts
pnpm --filter @kritt-radar/web typecheck
pnpm --filter @kritt-radar/web build
```

Expected: tests, Next typecheck, and production build pass without hydration or
dynamic-server errors.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/app apps/web/tests package.json pnpm-lock.yaml
git commit -m "feat(web): render merge review queue"
```

---

### Task 4: Add guarded Playwright workflow coverage

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/database.ts`
- Create: `apps/web/tests/e2e/global-setup.ts`
- Create: `apps/web/tests/e2e/global-teardown.ts`
- Create: `apps/web/tests/e2e/merge-queue.e2e.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: built `apps/web`, Docker Compose PostgreSQL, and exact database `kritt_radar_e2e`.
- Produces: root `pnpm test:e2e` command and retained Playwright failure artifacts only.

- [ ] **Step 1: Install and isolate Playwright**

Run:

```powershell
pnpm --filter @kritt-radar/web add -D @playwright/test@1.62.1
pnpm --filter @kritt-radar/web exec playwright install chromium
```

Add `**/*.e2e.spec.ts` to `vitest.config.ts` exclusions before creating the spec.

- [ ] **Step 2: Implement fail-closed E2E database lifecycle**

`database.ts` exports the exact URL
`postgresql://kritt:kritt@localhost:5433/kritt_radar_e2e?schema=public`. Global
setup must:

1. query PostgreSQL for the active database name;
2. refuse any name other than `kritt_radar_e2e`;
3. create the database only when absent;
4. run `pnpm --filter @kritt-radar/db migrate:deploy` with the process-only URL;
5. seed one approvable pending candidate, one blocked candidate, and deterministic entities/reports/program scopes.

Global teardown revalidates the exact name, terminates only connections to
`kritt_radar_e2e`, and drops only that database. It must never inspect or mutate
`kritt_radar`.

- [ ] **Step 3: Write browser RED test**

Configure a `webServer` command that builds and starts `@kritt-radar/web` on
`127.0.0.1:3100` with the E2E database URL. Test:

```ts
await page.goto('/merge-queue');
await expect(page.getByRole('heading', { name: 'Merge review queue' })).toBeVisible();
await expect(page.getByText('84%')).toBeVisible();
await expect(page.getByRole('button', { name: 'Approve match' })).toBeDisabled();
await page.getByRole('checkbox', { name: /confirm/i }).check();
await page.getByRole('button', { name: 'Approve match' }).click();
await expect(page.getByText(/approved/i)).toBeVisible();
```

Add a second isolated seed/test for reject → rejected tab → reopen, and assert
the blocked candidate has no approve button.

- [ ] **Step 4: Run RED and implement missing selectors/state**

Run: `pnpm test:e2e`

Expected first run: FAIL on missing route/selectors or behavior. Make only the
minimal route/component adjustments needed, then rerun until Chromium passes.

- [ ] **Step 5: Add accessibility and responsive browser assertions**

At 390×844, assert no horizontal page overflow and all decision buttons remain
visible. Keyboard-tab from the skip link through status navigation and the first
candidate controls; assert each focused control is visible. Capture screenshots
for pending desktop, pending mobile, and approved history into Playwright output
for visual review.

- [ ] **Step 6: Verify Task 4**

Run:

```powershell
pnpm test
$env:DATABASE_URL='postgresql://kritt:kritt@localhost:5433/kritt_radar_integration?schema=public'; pnpm test:integration
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: unit, PostgreSQL integration, typecheck, all workspace builds, and
Chromium E2E pass. Confirm teardown removed `kritt_radar_e2e`.

- [ ] **Step 7: Commit**

```powershell
git add apps/web package.json pnpm-lock.yaml vitest.config.ts
git commit -m "test(web): cover merge queue operator workflow"
```

---

### Task 5: Browser QA, final review, and delivery

**Files:**
- Modify only files required by a reproduced defect; every fix needs a failing regression test first.

**Interfaces:**
- Consumes: completed `/merge-queue`, dedicated integration/E2E databases.
- Produces: verified local dashboard merged into `main`.

- [ ] **Step 1: Run fresh verification**

Run unit, full guarded integration, typecheck, workspace build, and Playwright
from a clean feature-branch worktree. Record exact file/test counts and exit
codes.

- [ ] **Step 2: Perform visual QA in a real browser**

Seed pending, blocked, approved, and rejected rows. Inspect desktop at 1440×1000
and mobile at 390×844. Verify typography, hierarchy, score legibility, long repo
wrapping, focus rings, disabled approval, confirmation copy, and empty states.
Use browser screenshots as evidence. Do not replace browser QA with HTML review.

- [ ] **Step 3: Exercise live local actions**

Against the disposable E2E database, approve one candidate, reject and reopen
another, refresh after each action, and query PostgreSQL to prove aliases,
report links, candidate statuses, sibling rejection, and `decidedAt` match the UI.

- [ ] **Step 4: Fix only reproduced defects**

For each issue, add a failing Vitest/integration/Playwright regression first,
implement the minimum fix, and rerun the narrow test plus full relevant suite.
Commit fixes as `fix(web): harden merge review workflow`; skip this commit when
no files change.

- [ ] **Step 5: Independent whole-branch review**

Review the design, this plan, and the complete base-to-head diff. Require no
open P0–P2 findings. Explicitly audit fuzzy/no-auto-merge, transaction rollback,
alias conflicts, approved irreversibility, server-only Prisma, database cleanup,
accessibility, and mobile behavior.

- [ ] **Step 6: Auto-merge and push**

After all fresh gates pass:

```powershell
git checkout main
git pull --ff-only  # only when upstream exists
git merge codex/merge-queue-dashboard
pnpm test
pnpm typecheck
pnpm build
git branch -d codex/merge-queue-dashboard
git push            # only when remote/upstream exists
```

If no remote/upstream exists, complete the local merge and report that push was
not possible. Never add or invent a remote.
