# Merge Queue Dashboard Design

## 1. Goal and scope

Build the first internal Next.js dashboard surface for Kritt Radar at
`/merge-queue`. A single trusted operator reviews fuzzy `MergeCandidate` rows
without authentication. The queue must make the evidence behind a suggestion
legible and make an accidental merge harder than a rejection.

This slice includes:

- pending, approved, and rejected views;
- a detail panel with both entities, score components, programs, repository
  scopes, and audit reports;
- transactional approve/reject actions;
- reopening a rejected candidate;
- durable manual aliases and report relinking on approval;
- responsive operator UI plus integration and browser coverage.

It does not include user accounts, public APIs, bulk approval, undoing an
approved merge, editing aliases by hand, ranking/target pages, or deployment.

## 2. Product rules

1. **One decision at a time.** There is no bulk approve action. Each approval
   requires a confirmation that names the source and target entities.
2. **Fuzzy remains advisory.** Merely viewing or refreshing the queue never
   changes entity links. Only an explicit operator action can approve.
3. **Approval is irreversible in v1.** Reconstructing a prior provisional
   entity after reports and aliases move is ambiguous. Approved rows remain in
   history but expose no reopen control.
4. **Rejection is reversible.** A rejected row can return to pending because
   rejection changes no entity data.
5. **Fail closed.** Candidates with two provisional entities, two canonical
   entities, missing entities, conflicting manual aliases, or no audit reports
   cannot be approved. The UI explains the conflict and still allows rejection.
6. **Concurrent decisions are safe.** A stale browser action cannot overwrite a
   decision made by another tab or a materialization run.

## 3. Architecture

Create `apps/web` as a Next.js App Router workspace package. It imports the
shared Prisma client from `@kritt-radar/db` and pure identity normalization from
`@kritt-radar/pipeline`. There is no separate REST service in this internal
slice.

The app is split into three layers:

- `src/lib/merge-queue.ts`: query/presenter layer returning serializable queue
  rows and summary counts;
- `src/lib/merge-decisions.ts`: framework-independent transactional decision
  service operating on an injected Prisma client;
- route components and server actions: validate form input, call the service,
  revalidate `/merge-queue`, and render errors without leaking database detail.

Server Components read the queue directly. Server Actions are the only mutation
entry points. The decision service remains independently integration-testable.

## 4. Queue read model

The route accepts `status=pending|approved|rejected`; invalid or absent values
resolve to `pending`. Candidates sort by:

1. similarity descending;
2. creation time ascending;
3. candidate ID ascending.

Each row contains:

- candidate ID, status, similarity, reason components, created/decided time;
- source and target entity identity, with provisional/canonical roles inferred
  from `Entity.provisional` rather than relation position;
- audit report count, distinct audit firms, project hints, and newest report;
- program count, platforms, program titles, and repository scopes;
- an `approvable` flag and a concrete blocking reason.

The page header shows status counts. Tabs preserve the current status in the
URL, so browser refresh/back navigation is deterministic. Empty states explain
whether sync has produced no candidates or the selected history bucket is empty.

## 5. Approval transaction

Approval runs in a serializable Prisma transaction with bounded retry for write
conflicts.

1. Load the candidate and both entities with audit reports and aliases.
2. Require `status='pending'` and exactly one provisional entity plus exactly
   one non-provisional target entity.
3. Require at least one audit report on the provisional entity.
4. For every distinct normalized audit `projectHint`, verify that an existing
   `(kind='audit_hint', key)` alias is absent or already targets the same
   canonical entity.
5. Insert/upsert each alias with `source='manual'`, without overwriting a
   conflicting alias or any unrelated manual metadata.
6. Relink all reports from the provisional entity to the target entity.
7. Mark this candidate `approved` with `decidedAt=now` using a compare-and-set
   update that still requires `pending`.
8. Mark sibling pending candidates involving the same provisional entity as
   `rejected` with the same decision timestamp. This prevents a second target
   from being approved for reports that have already moved.

The provisional entity is retained for history and foreign-key stability. No
program entity is merged or deleted.

## 6. Reject and reopen transactions

Reject performs a compare-and-set transition `pending → rejected` and records
`decidedAt`. It changes no aliases, reports, or entities.

Reopen performs `rejected → pending` and clears `decidedAt`. Approved candidates
are never eligible. Reopen also checks that the candidate still has both entity
rows; otherwise it returns an actionable conflict.

All three operations are idempotent from the user's perspective: repeating the
same stale submission returns a conflict message and does not corrupt state.

## 7. Interface design

The visual direction is a compact forensic workbench rather than a generic SaaS
dashboard:

- warm off-white canvas, ink typography, muted slate rules;
- amber for pending evidence, green for approved, red only for destructive or
  conflicting states;
- a fixed-width score column and horizontal component meter for fast scanning;
- dense desktop two-column layout (queue + evidence inspector), collapsing to a
  single reading column on narrow screens;
- system font stack with tabular numerals, no remote font dependency;
- native links/buttons/forms with visible focus states and reduced-motion
  support.

The confirmation block repeats the exact alias/report consequence. Approval is
the least visually prominent primary action until the candidate is approvable;
reject remains available but visually secondary. Approved history shows the
decision result and affected report count, not mutation controls.

## 8. Error handling and security boundary

- No authentication is added because the app is explicitly local/internal.
- Mutations remain server-only; client components never receive database
  credentials or instantiate Prisma.
- IDs and action names are schema-validated before database access.
- Expected conflicts render as operator messages. Unexpected errors are logged
  server-side and return a generic failure message.
- A missing `DATABASE_URL` produces a focused setup screen rather than a blank
  route.
- The app does not expose a general-purpose mutation API.

## 9. Testing

### Unit

- status parsing, sorting, role inference, score formatting, and approvability;
- normalized alias-key derivation and conflict messages.

### PostgreSQL integration

- approve creates manual aliases, relinks all reports, approves one candidate,
  and rejects siblings atomically;
- conflicting alias rolls back every write;
- stale/concurrent decisions fail closed;
- reject and reopen transitions preserve entity/report data;
- approved cannot reopen;
- repeated reads and materialization do not erase the decision.

### Browser

Playwright runs against a dedicated guarded database and verifies:

- pending queue and detail evidence render;
- reject moves a row to rejected history and reopen returns it;
- approve confirmation moves reports/aliases and updates the history view;
- blocked candidates explain why approval is unavailable;
- keyboard focus and mobile layout remain usable.

## 10. Delivery

Implementation uses a feature branch and TDD. Completion requires unit,
PostgreSQL integration, Next.js build/typecheck, Playwright, and a local browser
smoke test. After independent review, merge into `main`, delete the feature
branch, and push only if a real remote/upstream exists.
