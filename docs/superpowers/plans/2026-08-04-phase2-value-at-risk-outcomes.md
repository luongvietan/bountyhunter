# Phase 2 — DefiLlama, Etherscan, value_at_risk, /outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship on-chain TVL + contract verification collectors, a `value_at_risk` signal (p95-normalized), and an `/outcomes` console to log submits and read signal↔payout correlation — without auto-updating `weights.yml`.

**Architecture:** Keep the one-way pipeline. `defillama-tvl` joins catalog collect; materialize writes `ProtocolTvl` and syncs `defillama` aliases. `etherscan-verified` is a DB-driven factory (like GitHub snapshots) that confirms contract scopes. A pure batch extractor upserts `value_at_risk` Signals. The web app adds Outcome CRUD + pure correlation helpers, styled like merge-queue / targets.

**Tech Stack:** Node 24, TypeScript 5.7 ESM/NodeNext, pnpm 10, Prisma 6 + Postgres 16, Zod 3, undici/`fetchJson`, Vitest 3, Next.js App Router, Playwright. Spec: `docs/superpowers/specs/2026-08-04-phase2-value-at-risk-outcomes-design.md`.

## Global Constraints

- No production code before its failing test (TDD).
- Missing dollars → `confidence: 0`, never fake `value: 0` as “no money”.
- Etherscan never creates a Signal; DefiLlama never fuzzy-merges entities.
- `/outcomes` never writes `weights.yml`.
- Unit tests stay offline (fixtures); integration/e2e use guarded disposable DBs.
- UI reuses `DESIGN.md` / `globals.css` / `ConsoleNavbar` — no new visual system.
- Frequent commits after each green task.

---

## File Structure

### Create

- `packages/db/prisma/migrations/<timestamp>_phase2_tvl_outcomes/migration.sql`
- `packages/collectors/src/sources/defillama-tvl.ts`
- `packages/collectors/src/sources/etherscan-verified.ts`
- `packages/collectors/tests/defillama-tvl.test.ts`
- `packages/collectors/tests/etherscan-verified.test.ts`
- `packages/collectors/tests/__fixtures__/defillama-protocols.json`
- `packages/collectors/tests/__fixtures__/etherscan-source-verified.json`
- `packages/collectors/tests/__fixtures__/etherscan-source-unverified.json`
- `packages/pipeline/src/extractors/value-at-risk.ts`
- `packages/pipeline/src/protocol-tvl.ts`
- `packages/pipeline/src/value-at-risk-materialize.ts`
- `packages/pipeline/tests/value-at-risk.test.ts`
- `packages/pipeline/tests/protocol-tvl.test.ts`
- `packages/pipeline/tests/value-at-risk-materialize.test.ts`
- `apps/web/src/lib/outcome-correlation.ts`
- `apps/web/src/lib/outcomes.ts`
- `apps/web/src/lib/outcome-mutations.ts`
- `apps/web/src/app/outcomes/page.tsx`
- `apps/web/src/app/outcomes/actions.ts`
- `apps/web/src/app/outcomes/outcome-form.tsx`
- `apps/web/src/app/outcomes/outcome-parser.ts`
- `apps/web/tests/outcome-correlation.test.ts`
- `apps/web/tests/outcomes.test.ts`
- `apps/web/tests/outcomes.integration.test.ts`
- `apps/web/tests/e2e/outcomes.e2e.spec.ts`

### Modify

- `packages/db/prisma/schema.prisma` — `ProtocolTvl`, `Outcome`, `Scope.outcomes`
- `packages/pipeline/src/entity-foundation.ts` — `AliasKind` += `defillama`
- `packages/pipeline/src/resolver.ts` — parse `defillama:` match rules
- `packages/pipeline/src/index.ts` — export new modules
- `packages/pipeline/tests/resolver.test.ts` — defillama alias cases
- `apps/worker/src/foundation.ts` — sync `byDefillama`; materialize ProtocolTvl; call VaR materialize
- `apps/worker/src/cli.ts` — register collectors; sync stage for etherscan
- `packages/collectors/src/sources/index.ts` — export new collectors
- `config/aliases.yml` — sample `defillama:` on uniswap-v4
- `.env.example` — `ETHERSCAN_API_KEY`
- `apps/web/src/components/console-navbar.tsx` — Outcomes link
- `apps/web/tests/e2e/seed.ts` — Outcome seed rows for correlation UI

---

### Task 1: Prisma models ProtocolTvl + Outcome

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration via Prisma
- Test: `packages/db/tests/migration-compatibility.integration.test.ts` (extend if needed)

- [ ] **Step 1: Add models to schema**

Append to `schema.prisma` (and add `outcomes Outcome[]` on `Scope`):

```prisma
model ProtocolTvl {
  slug          String   @id
  name          String
  tvlUsd        Decimal  @db.Decimal(20, 2)
  chains        String[]
  observationId String
  fetchedAt     DateTime

  @@index([fetchedAt])
}

model Outcome {
  id             String   @id @default(cuid())
  scope          Scope    @relation(fields: [scopeId], references: [id], onDelete: Cascade)
  scopeId        String
  action         String
  submittedAt    DateTime
  result         String
  payoutUsd      Decimal? @db.Decimal(20, 2)
  notes          String?
  signalSnapshot Json
  createdAt      DateTime @default(now())

  @@index([scopeId, submittedAt])
  @@index([result, submittedAt])
}
```

On `Scope`, add: `outcomes Outcome[]`.

- [ ] **Step 2: Create migration**

Run:

```powershell
pnpm --filter @kritt-radar/db exec prisma migrate dev --create-only --name phase2_tvl_outcomes
pnpm --filter @kritt-radar/db run generate
```

Expected: new folder under `packages/db/prisma/migrations/` with SQL creating both tables and indexes.

- [ ] **Step 3: Apply locally and verify generate**

Run:

```powershell
pnpm --filter @kritt-radar/db run migrate
pnpm --filter @kritt-radar/db run generate
pnpm --filter @kritt-radar/db run build
```

Expected: migrate applies; client includes `protocolTvl` and `outcome`.

- [ ] **Step 4: Commit**

```powershell
git add packages/db/prisma
git commit -m "feat(db): add ProtocolTvl and Outcome models for phase 2"
```

---

### Task 2: Alias kind `defillama`

**Files:**
- Modify: `packages/pipeline/src/entity-foundation.ts`
- Modify: `packages/pipeline/src/resolver.ts`
- Modify: `packages/pipeline/tests/resolver.test.ts` (or create if patterns live elsewhere)
- Modify: `apps/worker/src/foundation.ts` (`syncConfigAliases`)
- Modify: `config/aliases.yml`

- [ ] **Step 1: Write failing tests for parseAliases**

In `packages/pipeline/tests/resolver.test.ts` add:

```ts
it('parses defillama slug aliases', () => {
  const table = parseAliases(`
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - defillama: Uniswap-V4
`);
  expect(table.byDefillama.get('uniswap-v4')).toEqual({
    slug: 'uniswap-v4',
    canonicalName: 'Uniswap v4',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pipeline/tests/resolver.test.ts`

Expected: FAIL — `byDefillama` missing / Zod reject `defillama`.

- [ ] **Step 3: Implement parse + kind**

`entity-foundation.ts`:

```ts
export type AliasKind = 'repo' | 'platform_name' | 'audit_hint' | 'defillama';
```

`resolver.ts` — extend MatchRule and AliasTable:

```ts
const MatchRule = z.union([
  z.object({ repo: z.string() }),
  z.object({ platformName: z.object({ platform: z.string(), name: z.string() }) }),
  z.object({ auditHint: z.string() }),
  z.object({ defillama: z.string() }),
]);

export type AliasTable = {
  byRepoKey: Map<string, { slug: string; canonicalName: string }>;
  byPlatformName: Map<string, { slug: string; canonicalName: string }>;
  byAuditHint: Map<string, { slug: string; canonicalName: string }>;
  byDefillama: Map<string, { slug: string; canonicalName: string }>;
};
```

In `parseAliases`, create `byDefillama`, and on `'defillama' in rule`:

```ts
const key = rule.defillama.trim().toLowerCase();
if (key) byDefillama.set(key, target);
```

Return includes `byDefillama`.

- [ ] **Step 4: Sync config aliases in worker**

In `apps/worker/src/foundation.ts` `syncConfigAliases` entries array, append:

```ts
...[...aliases.byDefillama].map(([key, target]) => ({
  kind: 'defillama',
  key,
  target,
})),
```

- [ ] **Step 5: Update sample alias**

`config/aliases.yml`:

```yaml
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - defillama: uniswap-v4
```

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run packages/pipeline/tests/resolver.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/pipeline apps/worker/src/foundation.ts config/aliases.yml
git commit -m "feat(pipeline): support defillama alias kind in config sync"
```

---

### Task 3: Collector `defillama-tvl`

**Files:**
- Create: `packages/collectors/src/sources/defillama-tvl.ts`
- Create: `packages/collectors/tests/__fixtures__/defillama-protocols.json`
- Create: `packages/collectors/tests/defillama-tvl.test.ts`
- Modify: `packages/collectors/src/sources/index.ts`

- [ ] **Step 1: Write fixture (trimmed real shape)**

`defillama-protocols.json`:

```json
[
  {
    "slug": "uniswap",
    "name": "Uniswap",
    "tvl": 4123456789.12,
    "chains": ["Ethereum", "Arbitrum"]
  },
  {
    "slug": "broken-no-tvl",
    "name": "Broken",
    "tvl": null,
    "chains": []
  },
  {
    "name": "NoSlug",
    "tvl": 100,
    "chains": ["Ethereum"]
  }
]
```

- [ ] **Step 2: Write failing parse tests**

```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/defillama-protocols.json' with { type: 'json' };
import { parseDefillamaProtocols } from '../src/sources/defillama-tvl.js';

describe('parseDefillamaProtocols', () => {
  it('keeps protocols with slug and positive tvl', () => {
    const out = parseDefillamaProtocols(fixture);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      slug: 'uniswap',
      name: 'Uniswap',
      tvlUsd: 4123456789.12,
      chains: ['Ethereum', 'Arbitrum'],
    });
    expect(out[0]!.collectorId).toBe('defillama-tvl');
    expect(out[0]!.sourceUrl).toBe('https://api.llama.fi/protocol/uniswap');
  });

  it('returns empty array for non-array body', () => {
    expect(parseDefillamaProtocols({ not: 'array' })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/collectors/tests/defillama-tvl.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 4: Implement collector**

```ts
import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type RawObservation } from '../types.js';

const PROTOCOLS_URL = 'https://api.llama.fi/protocols';

const RawProtocol = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tvl: z.number().finite().positive(),
  chains: z.array(z.string()).default([]),
});

export interface DefillamaTvlPayload {
  slug: string;
  name: string;
  tvlUsd: number;
  chains: string[];
}

export function parseDefillamaProtocols(raw: unknown): RawObservation<DefillamaTvlPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<DefillamaTvlPayload>[] = [];
  for (const item of raw) {
    const parsed = RawProtocol.safeParse(item);
    if (!parsed.success) continue;
    const slug = parsed.data.slug.trim().toLowerCase();
    const payload: DefillamaTvlPayload = {
      slug,
      name: parsed.data.name,
      tvlUsd: parsed.data.tvl,
      chains: parsed.data.chains,
    };
    out.push(
      makeObservation('defillama-tvl', `https://api.llama.fi/protocol/${slug}`, payload),
    );
  }
  return out;
}

export const defillamaTvl: Collector<DefillamaTvlPayload> = {
  id: 'defillama-tvl',
  cadence: '0 */6 * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(ctx) {
    const raw = await fetchJson<unknown>(PROTOCOLS_URL, { limit: this.rateLimit });
    const items = parseDefillamaProtocols(raw);
    if (items.length === 0) {
      throw new Error('defillama-tvl: parsed 0 protocols from HTTP 200 body');
    }
    yield* items;
  },
};
```

Export from `sources/index.ts`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/collectors/tests/defillama-tvl.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/collectors
git commit -m "feat(collectors): add defillama-tvl protocol TVL collector"
```

---

### Task 4: Materialize ProtocolTvl

**Files:**
- Create: `packages/pipeline/src/protocol-tvl.ts`
- Create: `packages/pipeline/tests/protocol-tvl.test.ts`
- Modify: `packages/pipeline/src/index.ts`
- Modify: `apps/worker/src/foundation.ts` / `cli.ts` to call after catalog observations exist

- [ ] **Step 1: Write failing unit test for pure upsert planner**

```ts
import { describe, expect, it } from 'vitest';
import { planProtocolTvlUpserts } from '../src/protocol-tvl.js';

describe('planProtocolTvlUpserts', () => {
  it('keeps latest observation per slug', () => {
    const rows = planProtocolTvlUpserts([
      {
        id: 'old',
        fetchedAt: new Date('2026-08-01T00:00:00Z'),
        payload: { slug: 'uniswap', name: 'Uniswap', tvlUsd: 1, chains: ['Ethereum'] },
      },
      {
        id: 'new',
        fetchedAt: new Date('2026-08-02T00:00:00Z'),
        payload: { slug: 'uniswap', name: 'Uniswap', tvlUsd: 2, chains: ['Ethereum', 'Base'] },
      },
    ]);
    expect(rows).toEqual([
      {
        slug: 'uniswap',
        name: 'Uniswap',
        tvlUsd: 2,
        chains: ['Ethereum', 'Base'],
        observationId: 'new',
        fetchedAt: new Date('2026-08-02T00:00:00Z'),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

`pnpm exec vitest run packages/pipeline/tests/protocol-tvl.test.ts`

- [ ] **Step 3: Implement planner + DB writer**

```ts
import type { PrismaClient } from '@kritt-radar/db';

export interface DefillamaObservationRow {
  id: string;
  fetchedAt: Date;
  payload: { slug: string; name: string; tvlUsd: number; chains: string[] };
}

export interface ProtocolTvlRow {
  slug: string;
  name: string;
  tvlUsd: number;
  chains: string[];
  observationId: string;
  fetchedAt: Date;
}

export function planProtocolTvlUpserts(
  rows: readonly DefillamaObservationRow[],
): ProtocolTvlRow[] {
  const best = new Map<string, ProtocolTvlRow>();
  for (const row of rows) {
    const slug = row.payload.slug.trim().toLowerCase();
    if (!slug || !(row.payload.tvlUsd > 0)) continue;
    const next: ProtocolTvlRow = {
      slug,
      name: row.payload.name,
      tvlUsd: row.payload.tvlUsd,
      chains: row.payload.chains,
      observationId: row.id,
      fetchedAt: row.fetchedAt,
    };
    const prev = best.get(slug);
    if (!prev || prev.fetchedAt.getTime() <= next.fetchedAt.getTime()) best.set(slug, next);
  }
  return [...best.values()];
}

export async function materializeProtocolTvl(prisma: PrismaClient): Promise<number> {
  const observations = await prisma.observation.findMany({
    where: { collectorId: 'defillama-tvl' },
    orderBy: { fetchedAt: 'asc' },
    select: { id: true, fetchedAt: true, payload: true },
  });
  const planned = planProtocolTvlUpserts(
    observations.map((o) => ({
      id: o.id,
      fetchedAt: o.fetchedAt,
      payload: o.payload as DefillamaObservationRow['payload'],
    })),
  );
  for (const row of planned) {
    await prisma.protocolTvl.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        name: row.name,
        tvlUsd: row.tvlUsd,
        chains: row.chains,
        observationId: row.observationId,
        fetchedAt: row.fetchedAt,
      },
      update: {
        name: row.name,
        tvlUsd: row.tvlUsd,
        chains: row.chains,
        observationId: row.observationId,
        fetchedAt: row.fetchedAt,
      },
    });
  }
  return planned.length;
}
```

Export from `packages/pipeline/src/index.ts`.

- [ ] **Step 4: Wire into materialize-catalog path**

In `apps/worker/src/cli.ts` `materializeCatalog`, after `materializeCatalogFoundation`, call:

```ts
import { materializeProtocolTvl } from '@kritt-radar/pipeline';
const tvlCount = await materializeProtocolTvl(prisma);
console.log(`[catalog] protocolTvl: ${tvlCount} slugs`);
```

Also add `defillamaTvl` to `CATALOG_COLLECTORS`.

- [ ] **Step 5: Run unit tests**

`pnpm exec vitest run packages/pipeline/tests/protocol-tvl.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/pipeline apps/worker/src/cli.ts packages/collectors/src/sources/index.ts
git commit -m "feat(pipeline): materialize ProtocolTvl from DefiLlama observations"
```

---

### Task 5: Pure `value_at_risk` extractor (p95)

**Files:**
- Create: `packages/pipeline/src/extractors/value-at-risk.ts`
- Create: `packages/pipeline/tests/value-at-risk.test.ts`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  extractValueAtRiskBatch,
  nearestRankPercentile,
} from '../src/extractors/value-at-risk.js';

describe('nearestRankPercentile', () => {
  it('uses ceil(p*n)-1 nearest-rank', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRankPercentile(xs, 0.95)).toBe(10);
  });
});

describe('extractValueAtRiskBatch', () => {
  const inputs = [
    { scopeId: 'a', poolUsd: 1000, tvlUsd: null as number | null, defillamaSlug: null as string | null },
    { scopeId: 'b', poolUsd: null, tvlUsd: 1_000_000, defillamaSlug: 'uni' },
    { scopeId: 'c', poolUsd: null, tvlUsd: null, defillamaSlug: null },
    { scopeId: 'd', poolUsd: 50_000_000, tvlUsd: 10, defillamaSlug: 'big' },
  ];

  it('marks missing dollars as confidence 0', () => {
    const map = extractValueAtRiskBatch(inputs);
    expect(map.get('c')).toMatchObject({
      type: 'value_at_risk',
      confidence: 0,
      evidence: { reason: 'no_pool_or_tvl' },
    });
  });

  it('uses max(pool, tvl) and clamps at p95', () => {
    const map = extractValueAtRiskBatch(inputs);
    expect(map.get('d')!.value).toBe(1);
    expect(map.get('d')!.confidence).toBe(1);
    expect(map.get('d')!.evidence.basis).toBe('both');
    expect(map.get('a')!.value).toBeGreaterThan(0);
    expect(map.get('a')!.value).toBeLessThan(1);
    expect(map.get('b')!.evidence.basis).toBe('tvl');
  });

  it('is deterministic on the same batch', () => {
    const a = extractValueAtRiskBatch(inputs).get('a')!.value;
    const b = extractValueAtRiskBatch(inputs).get('a')!.value;
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

`pnpm exec vitest run packages/pipeline/tests/value-at-risk.test.ts`

- [ ] **Step 3: Implement**

```ts
import { clamp01, type SignalValue } from '@kritt-radar/core';

export interface ValueAtRiskInput {
  scopeId: string;
  poolUsd: number | null;
  tvlUsd: number | null;
  defillamaSlug: string | null;
}

export function nearestRankPercentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length) - 1;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank));
  return sortedAsc[idx]!;
}

export function extractValueAtRiskBatch(
  inputs: readonly ValueAtRiskInput[],
): Map<string, SignalValue> {
  const dollars = new Map<string, number>();
  for (const row of inputs) {
    const candidates = [row.poolUsd, row.tvlUsd].filter(
      (n): n is number => n != null && Number.isFinite(n) && n > 0,
    );
    if (candidates.length > 0) dollars.set(row.scopeId, Math.max(...candidates));
  }

  const raws = [...dollars.values()].map((d) => Math.log1p(d)).sort((a, b) => a - b);
  const ceiling = nearestRankPercentile(raws, 0.95);
  const out = new Map<string, SignalValue>();

  for (const row of inputs) {
    const d = dollars.get(row.scopeId);
    if (d == null || !(ceiling > 0)) {
      out.set(row.scopeId, {
        type: 'value_at_risk',
        value: 0,
        confidence: 0,
        evidence: { reason: d == null ? 'no_pool_or_tvl' : 'empty_p95_batch' },
      });
      continue;
    }
    const raw = Math.log1p(d);
    const hasPool = row.poolUsd != null && row.poolUsd > 0;
    const hasTvl = row.tvlUsd != null && row.tvlUsd > 0;
    const basis = hasPool && hasTvl ? 'both' : hasPool ? 'pool' : 'tvl';
    out.set(row.scopeId, {
      type: 'value_at_risk',
      value: clamp01(raw / ceiling),
      confidence: 1,
      evidence: {
        poolUsd: row.poolUsd,
        tvlUsd: row.tvlUsd,
        dollars: d,
        raw,
        ceiling,
        p95BatchSize: raws.length,
        defillamaSlug: row.defillamaSlug,
        basis,
      },
    });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

`pnpm exec vitest run packages/pipeline/tests/value-at-risk.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add packages/pipeline/src/extractors/value-at-risk.ts packages/pipeline/tests/value-at-risk.test.ts packages/pipeline/src/index.ts
git commit -m "feat(pipeline): add p95 value_at_risk batch extractor"
```

---

### Task 6: Persist `value_at_risk` signals

**Files:**
- Create: `packages/pipeline/src/value-at-risk-materialize.ts`
- Create: `packages/pipeline/tests/value-at-risk-materialize.test.ts` (unit with fake inputs) + optional integration
- Modify: `apps/worker/src/cli.ts` `materializeSignals`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Implement loader + upsert**

```ts
import type { PrismaClient } from '@kritt-radar/db';
import { extractValueAtRiskBatch, type ValueAtRiskInput } from './extractors/value-at-risk.js';

export async function loadValueAtRiskInputs(prisma: PrismaClient): Promise<ValueAtRiskInput[]> {
  const scopes = await prisma.scope.findMany({
    include: {
      program: {
        include: {
          entity: { include: { aliases: { where: { kind: 'defillama' } } } },
        },
      },
    },
  });
  const tvlRows = await prisma.protocolTvl.findMany();
  const tvlBySlug = new Map(tvlRows.map((r) => [r.slug, Number(r.tvlUsd)]));

  return scopes.map((scope) => {
    const slug = scope.program.entity?.aliases[0]?.key ?? null;
    const tvlUsd = slug ? (tvlBySlug.get(slug) ?? null) : null;
    const pool = scope.program.poolUsd;
    return {
      scopeId: scope.id,
      poolUsd: pool == null ? null : Number(pool),
      tvlUsd,
      defillamaSlug: slug,
    };
  });
}

export async function materializeValueAtRisk(prisma: PrismaClient): Promise<number> {
  const inputs = await loadValueAtRiskInputs(prisma);
  const signals = extractValueAtRiskBatch(inputs);
  let written = 0;
  for (const [scopeId, signal] of signals) {
    await prisma.signal.upsert({
      where: { scopeId_type: { scopeId, type: signal.type } },
      create: {
        scopeId,
        type: signal.type,
        value: signal.value,
        confidence: signal.confidence,
        evidence: signal.evidence,
        observationIds: [],
      },
      update: {
        value: signal.value,
        confidence: signal.confidence,
        evidence: signal.evidence,
        computedAt: new Date(),
      },
    });
    written += 1;
  }
  return written;
}
```

- [ ] **Step 2: Wire CLI**

In `materializeSignals`:

```ts
const varCount = await materializeValueAtRisk(prisma);
console.log(`[signals] value_at_risk: ${varCount} scopes`);
```

Keep existing `materializeRepoSignals` call.

- [ ] **Step 3: Extract pure mapper and unit-test it**

Export `buildValueAtRiskInputs` from `value-at-risk-materialize.ts` and call it from `loadValueAtRiskInputs`. Test file asserts:

```ts
expect(
  buildValueAtRiskInputs(
    [
      {
        scopeId: 's1',
        poolUsd: 100,
        defillamaSlug: 'uniswap',
      },
      {
        scopeId: 's2',
        poolUsd: null,
        defillamaSlug: null,
      },
    ],
    new Map([['uniswap', 999]]),
  ),
).toEqual([
  { scopeId: 's1', poolUsd: 100, tvlUsd: 999, defillamaSlug: 'uniswap' },
  { scopeId: 's2', poolUsd: null, tvlUsd: null, defillamaSlug: null },
]);
```

- [ ] **Step 4: Run tests + typecheck**

```powershell
pnpm exec vitest run packages/pipeline/tests/value-at-risk
pnpm --filter @kritt-radar/pipeline exec tsc --noEmit
pnpm --filter @kritt-radar/worker exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/pipeline apps/worker/src/cli.ts
git commit -m "feat(pipeline): persist value_at_risk signals during materialize"
```

---

### Task 7: Collector `etherscan-verified`

**Files:**
- Create: `packages/collectors/src/sources/etherscan-verified.ts`
- Create: fixtures + `packages/collectors/tests/etherscan-verified.test.ts`
- Modify: `packages/collectors/src/sources/index.ts`
- Modify: `.env.example`
- Modify: `apps/worker/src/cli.ts` — new sync stage after catalog materialize

- [ ] **Step 1: Write failing tests for parse + chain map**

```ts
import { describe, expect, it } from 'vitest';
import verified from './__fixtures__/etherscan-source-verified.json' with { type: 'json' };
import unverified from './__fixtures__/etherscan-source-unverified.json' with { type: 'json' };
import {
  chainIdFor,
  parseEtherscanSource,
} from '../src/sources/etherscan-verified.js';

describe('chainIdFor', () => {
  it('maps ethereum and common L2s', () => {
    expect(chainIdFor('ethereum')).toBe(1);
    expect(chainIdFor('arbitrum')).toBe(42161);
  });
  it('returns null for unknown / solana', () => {
    expect(chainIdFor('solana')).toBeNull();
    expect(chainIdFor('something-new')).toBeNull();
  });
});

describe('parseEtherscanSource', () => {
  it('marks ABI present as verified', () => {
    const p = parseEtherscanSource('ethereum', '0xAbc', verified);
    expect(p).toMatchObject({
      chain: 'ethereum',
      address: '0xabc',
      verified: true,
    });
  });
  it('marks empty SourceCode as unverified', () => {
    const p = parseEtherscanSource('ethereum', '0xAbc', unverified);
    expect(p?.verified).toBe(false);
  });
});
```

Fixture verified (minimal):

```json
{
  "status": "1",
  "message": "OK",
  "result": [
    {
      "SourceCode": "pragma solidity ^0.8.0;",
      "ContractName": "Demo",
      "CompilerVersion": "v0.8.20",
      "ABI": "[]"
    }
  ]
}
```

Unverified: `"SourceCode": ""`, `"ABI": "Contract source code not verified"`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement factory collector**

```ts
import { normalizeChainAddress } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  mainnet: 1,
  optimism: 10,
  bsc: 56,
  gnosis: 100,
  polygon: 137,
  fantom: 250,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  linea: 59144,
  scroll: 534352,
};

export interface ContractTarget {
  chain: string;
  address: string;
}

export interface EtherscanVerifiedPayload {
  chain: string;
  address: string;
  verified: boolean;
  contractName: string | null;
  compiler: string | null;
  sourceUrl: string;
}

export function chainIdFor(chain: string): number | null {
  return CHAIN_IDS[chain.trim().toLowerCase()] ?? null;
}

export function parseEtherscanSource(
  chain: string,
  address: string,
  raw: unknown,
): EtherscanVerifiedPayload | null {
  const hard = normalizeChainAddress(chain, address);
  if (!hard) return null;
  const [, normalizedAddress] = hard.split(':');
  const result = (raw as { result?: unknown })?.result;
  const row = Array.isArray(result) ? result[0] : null;
  if (!row || typeof row !== 'object') return null;
  const sourceCode = String((row as { SourceCode?: string }).SourceCode ?? '');
  const verified = sourceCode.trim().length > 0;
  const chainId = chainIdFor(chain);
  return {
    chain: chain.trim().toLowerCase(),
    address: normalizedAddress!,
    verified,
    contractName: verified ? String((row as { ContractName?: string }).ContractName ?? '') || null : null,
    compiler: verified ? String((row as { CompilerVersion?: string }).CompilerVersion ?? '') || null : null,
    sourceUrl:
      chainId != null
        ? `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${normalizedAddress}`
        : `etherscan:unmapped:${hard}`,
  };
}

export function makeEtherscanVerified(
  listTargets: () => Promise<ContractTarget[]>,
  requestJson: typeof fetchJson = fetchJson,
): Collector<EtherscanVerifiedPayload> {
  return {
    id: 'etherscan-verified',
    cadence: '0 */12 * * *',
    rateLimit: { rps: 0.2, burst: 1 },
    requiresCredential: 'ETHERSCAN_API_KEY',
    async *fetch(ctx: FetchCtx) {
      const key = ctx.env.ETHERSCAN_API_KEY!;
      const targets = await listTargets();
      for (const target of targets) {
        const chainId = chainIdFor(target.chain);
        if (chainId == null) continue;
        const hard = normalizeChainAddress(target.chain, target.address);
        if (!hard) continue;
        const address = hard.split(':')[1]!;
        const url =
          `https://api.etherscan.io/v2/api?chainid=${chainId}` +
          `&module=contract&action=getsourcecode&address=${address}&apikey=${key}`;
        const raw = await requestJson<unknown>(url, { limit: this.rateLimit });
        const payload = parseEtherscanSource(target.chain, address, raw);
        if (!payload) continue;
        yield makeObservation('etherscan-verified', payload.sourceUrl.split('&apikey=')[0]!, payload);
      }
    },
  };
}
```

Note: never put API key into `sourceUrl` stored in Observation (strip query `apikey`).

- [ ] **Step 4: Wire worker**

Add helper in pipeline or worker:

```ts
export async function listContractTargets(prisma: PrismaClient): Promise<ContractTarget[]> {
  const scopes = await prisma.scope.findMany({
    where: { AND: [{ chain: { not: null } }, { address: { not: null } }] },
    select: { chain: true, address: true },
  });
  const seen = new Set<string>();
  const out: ContractTarget[] = [];
  for (const s of scopes) {
    if (!s.chain || !s.address) continue;
    const key = `${s.chain.toLowerCase()}:${s.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chain: s.chain, address: s.address });
  }
  return out;
}
```

Extend `SyncDependencies` + `sync()`:

```ts
// after materializeCatalog, before collectGithub:
await deps.collectContracts();
```

Implement `collectContracts` with `makeEtherscanVerified(() => listContractTargets(prisma))`, phase label `'github'` or rename phase union to `'catalog' | 'github' | 'onchain'` — prefer extending to `'onchain'`.

`.env.example`:

```
ETHERSCAN_API_KEY=
```

- [ ] **Step 5: Run collector tests**

`pnpm exec vitest run packages/collectors/tests/etherscan-verified.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/collectors apps/worker packages/pipeline .env.example
git commit -m "feat(collectors): add etherscan-verified multi-chain contract collector"
```

---

### Task 8: Outcome correlation (pure)

**Files:**
- Create: `apps/web/src/lib/outcome-correlation.ts`
- Create: `apps/web/tests/outcome-correlation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { correlateOutcomes } from '../src/lib/outcome-correlation';

const rows = [
  { payoutUsd: 0, signals: { audit_gap: { value: 0.1, confidence: 1 } } },
  { payoutUsd: 100, signals: { audit_gap: { value: 0.5, confidence: 1 } } },
  { payoutUsd: 500, signals: { audit_gap: { value: 0.9, confidence: 1 } } },
  { payoutUsd: 50, signals: { audit_gap: { value: 0.4, confidence: 1 } } },
  { payoutUsd: 300, signals: { audit_gap: { value: 0.8, confidence: 1 } } },
];

describe('correlateOutcomes', () => {
  it('flags unstable when n < 5 after filters', () => {
    const r = correlateOutcomes(rows.slice(0, 3), ['audit_gap'], 0.05);
    expect(r.bySignal.audit_gap.sampleSize).toBe(3);
    expect(r.bySignal.audit_gap.unstable).toBe(true);
  });

  it('computes pearson/spearman and tertiles when n >= 5', () => {
    const r = correlateOutcomes(rows, ['audit_gap'], 0.05);
    expect(r.bySignal.audit_gap.unstable).toBe(false);
    expect(r.bySignal.audit_gap.pearson).toBeGreaterThan(0.5);
    expect(r.bySignal.audit_gap.tertiles).toHaveLength(3);
  });

  it('drops low-confidence and null payout', () => {
    const r = correlateOutcomes(
      [
        ...rows,
        { payoutUsd: null, signals: { audit_gap: { value: 1, confidence: 1 } } },
        { payoutUsd: 999, signals: { audit_gap: { value: 1, confidence: 0 } } },
      ],
      ['audit_gap'],
      0.05,
    );
    expect(r.bySignal.audit_gap.sampleSize).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement Pearson, Spearman (rank), tertiles**

```ts
export interface SnapshotSignal {
  value: number;
  confidence: number;
}

export interface OutcomeCorrRow {
  payoutUsd: number | null;
  signals: Record<string, SnapshotSignal | undefined>;
}

export interface TertileBucket {
  label: 'low' | 'mid' | 'high';
  count: number;
  avgPayoutUsd: number | null;
}

export interface SignalCorrelation {
  sampleSize: number;
  unstable: boolean;
  pearson: number | null;
  spearman: number | null;
  tertiles: TertileBucket[];
}

export interface CorrelationReport {
  bySignal: Record<string, SignalCorrelation>;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j < indexed.length && indexed[j]!.v === indexed[i]!.v) j += 1;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k += 1) ranks[indexed[k]!.i] = avg;
    i = j;
  }
  return ranks;
}

function tertiles(xs: number[], ys: number[]): TertileBucket[] {
  if (xs.length < 3) {
    return [
      { label: 'low', count: 0, avgPayoutUsd: null },
      { label: 'mid', count: 0, avgPayoutUsd: null },
      { label: 'high', count: 0, avgPayoutUsd: null },
    ];
  }
  const order = xs.map((v, i) => ({ v, y: ys[i]! })).sort((a, b) => a.v - b.v);
  const n = order.length;
  const cuts = [Math.floor(n / 3), Math.floor((2 * n) / 3)];
  const groups: number[][] = [[], [], []];
  order.forEach((row, idx) => {
    const bucket = idx < cuts[0]! ? 0 : idx < cuts[1]! ? 1 : 2;
    groups[bucket]!.push(row.y);
  });
  const labels: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];
  return labels.map((label, i) => {
    const g = groups[i]!;
    return {
      label,
      count: g.length,
      avgPayoutUsd: g.length ? mean(g) : null,
    };
  });
}

export function correlateOutcomes(
  rows: readonly OutcomeCorrRow[],
  signalTypes: readonly string[],
  minConfidence: number,
): CorrelationReport {
  const bySignal: Record<string, SignalCorrelation> = {};
  for (const type of signalTypes) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const row of rows) {
      if (row.payoutUsd == null || !Number.isFinite(row.payoutUsd)) continue;
      const sig = row.signals[type];
      if (!sig || sig.confidence < minConfidence) continue;
      xs.push(sig.value);
      ys.push(row.payoutUsd);
    }
    bySignal[type] = {
      sampleSize: xs.length,
      unstable: xs.length < 5,
      pearson: pearson(xs, ys),
      spearman: xs.length ? pearson(rank(xs), rank(ys)) : null,
      tertiles: tertiles(xs, ys),
    };
  }
  return { bySignal };
}
```

- [ ] **Step 4: Run — expect PASS**

`pnpm exec vitest run apps/web/tests/outcome-correlation.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/outcome-correlation.ts apps/web/tests/outcome-correlation.test.ts
git commit -m "feat(web): add pure outcome signal-payout correlation helpers"
```

---

### Task 9: Outcome read/write services

**Files:**
- Create: `apps/web/src/lib/outcomes.ts`
- Create: `apps/web/src/lib/outcome-mutations.ts`
- Create: `apps/web/src/app/outcomes/outcome-parser.ts`
- Create: `apps/web/tests/outcomes.test.ts`
- Create: `apps/web/tests/outcomes.integration.test.ts`

- [ ] **Step 1: Parser + pure list shaping tests**

`outcome-parser.ts`:

```ts
import { z } from 'zod';

const FormSchema = z.object({
  scopeId: z.string().min(1),
  action: z.enum(['scan', 'submit', 'note']),
  result: z.enum(['accepted', 'duplicate', 'invalid', 'pending']),
  submittedAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  payoutUsd: z.string().optional(),
  notes: z.string().optional(),
});

export type OutcomeFormValue = {
  scopeId: string;
  action: 'scan' | 'submit' | 'note';
  result: 'accepted' | 'duplicate' | 'invalid' | 'pending';
  submittedAt: Date;
  payoutUsd: number | null;
  notes: string | null;
};

export function parseOutcomeForm(
  formData: FormData,
): { ok: true; value: OutcomeFormValue } | { ok: false; message: string } {
  const parsed = FormSchema.safeParse({
    scopeId: formData.get('scopeId'),
    action: formData.get('action'),
    result: formData.get('result'),
    submittedAt: formData.get('submittedAt'),
    payoutUsd: formData.get('payoutUsd') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return { ok: false, message: 'Check the outcome fields and try again.' };
  const submittedAt = new Date(parsed.data.submittedAt);
  if (!Number.isFinite(submittedAt.getTime())) {
    return { ok: false, message: 'submittedAt must be a valid date.' };
  }
  let payoutUsd: number | null = null;
  if (parsed.data.payoutUsd != null && parsed.data.payoutUsd !== '') {
    const n = Number(parsed.data.payoutUsd);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'payoutUsd must be a non-negative number.' };
    payoutUsd = n;
  }
  return {
    ok: true,
    value: {
      scopeId: parsed.data.scopeId,
      action: parsed.data.action,
      result: parsed.data.result,
      submittedAt,
      payoutUsd,
      notes: parsed.data.notes?.trim() || null,
    },
  };
}
```

- [ ] **Step 2: Mutation service**

```ts
import type { PrismaClient } from '@kritt-radar/db';
import type { OutcomeFormValue } from '../app/outcomes/outcome-parser';

export async function createOutcome(prisma: PrismaClient, input: OutcomeFormValue) {
  const scope = await prisma.scope.findUnique({
    where: { id: input.scopeId },
    include: { signals: true },
  });
  if (!scope) return { ok: false as const, message: 'Scope not found.' };

  const signalSnapshot: Record<string, { value: number; confidence: number }> = {};
  for (const s of scope.signals) {
    signalSnapshot[s.type] = { value: s.value, confidence: s.confidence };
  }

  const row = await prisma.outcome.create({
    data: {
      scopeId: input.scopeId,
      action: input.action,
      submittedAt: input.submittedAt,
      result: input.result,
      payoutUsd: input.payoutUsd,
      notes: input.notes,
      signalSnapshot,
    },
  });
  return { ok: true as const, id: row.id };
}
```

- [ ] **Step 3: Read model `listOutcomesPage`**

Load outcomes (filter `result` from URL, default all), join scope/program titles, load weights `minConfidence`, build correlation via `correlateOutcomes` + `SIGNAL_TYPES`. Also load scope options for the form (`id`, title, platform).

- [ ] **Step 4: Integration test**

Using `withSafeIntegrationDatabase`: create entity/program/scope/signals → `createOutcome` → assert `signalSnapshot` frozen → `listOutcomesPage` returns row + correlation sampleSize.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/outcomes.ts apps/web/src/lib/outcome-mutations.ts apps/web/src/app/outcomes/outcome-parser.ts apps/web/tests
git commit -m "feat(web): add outcome create and list services"
```

---

### Task 10: `/outcomes` UI + navbar

**Files:**
- Create: `apps/web/src/app/outcomes/page.tsx`
- Create: `apps/web/src/app/outcomes/actions.ts`
- Create: `apps/web/src/app/outcomes/outcome-form.tsx`
- Modify: `apps/web/src/components/console-navbar.tsx`
- Modify: `apps/web/src/app/globals.css` only if a missing class is required (prefer reuse)

- [ ] **Step 1: Extend navbar**

```ts
export type ConsoleSection = 'targets' | 'merge-queue' | 'outcomes';
// Link href="/outcomes" with aria-current when active
```

- [ ] **Step 2: Server action**

Mirror merge-queue `submitMergeDecision`: parse → `createOutcome` → `revalidatePath('/outcomes')`.

- [ ] **Step 3: Page RSC**

- `dynamic = 'force-dynamic'`
- SetupState when DB missing (copy merge-queue pattern)
- `ConsoleNavbar activeSection="outcomes"`
- Heading: Outcomes
- Form (scope select, action, result, datetime-local/submittedAt, payout, notes)
- History table (dense, like targets)
- Correlation section: per signal — n, pearson, spearman, tertile table; unstable banner when `unstable`

Reuse classes: `page-shell`, `route-heading`, `button-primary`, `filter-bar` / tabs for result filter, `empty-state`, `target-table` or equivalent.

- [ ] **Step 4: SSR smoke test**

In `apps/web/tests/outcomes.test.ts`, `renderToStaticMarkup` a small presentational fragment (history row + unstable correlation banner) and assert text for payout and “chưa đủ mẫu” / “insufficient samples” (match the copy you ship).

- [ ] **Step 5: typecheck + unit**

```powershell
pnpm --filter @kritt-radar/web run typecheck
pnpm exec vitest run apps/web/tests/outcome
```

- [ ] **Step 6: Commit**

```powershell
git add apps/web
git commit -m "feat(web): ship /outcomes console with correlation panel"
```

---

### Task 11: E2E coverage

**Files:**
- Modify: `apps/web/tests/e2e/seed.ts`
- Create: `apps/web/tests/e2e/outcomes.e2e.spec.ts`

- [ ] **Step 1: Seed ≥ 5 outcomes with payouts + varied signal snapshots** on an existing seeded scope.

- [ ] **Step 2: Playwright spec**

```ts
test.describe.configure({ mode: 'serial' });

test('outcomes nav, create form, history, correlation', async ({ page }) => {
  await page.goto('/outcomes');
  await expect(page.getByRole('navigation', { name: 'Console sections' })).toContainText('Outcomes');
  await expect(page.getByRole('heading', { name: /outcomes/i })).toBeVisible();
  // fill form → submit → row appears
  // correlation region shows audit_gap sample size
});
```

- [ ] **Step 3: Run e2e**

```powershell
pnpm test:e2e -- outcomes.e2e.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/tests/e2e
git commit -m "test(web): cover /outcomes operator flow in Playwright"
```

---

### Task 12: End-to-end verification

- [ ] **Step 1: Full unit + integration + typecheck**

```powershell
pnpm test
pnpm test:integration
pnpm typecheck
pnpm --filter @kritt-radar/web run build
```

Expected: all green.

- [ ] **Step 2: Manual smoke (optional if Docker up)**

```powershell
pnpm sync
# open http://localhost:3100/outcomes and /targets — value_at_risk pills populate when pool/tvl exist
```

- [ ] **Step 3: Final commit only if verification left dirty docs/comments — otherwise done**

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `defillama-tvl` collector + 0-row error | Task 3 |
| `ProtocolTvl` materialize | Tasks 1, 4 |
| `defillama` alias kind + YAML | Task 2 |
| `etherscan-verified` multi-chain fail-soft | Task 7 |
| Etherscan not a Signal | Task 7 (no extractor) |
| `value_at_risk` p95 nearest-rank | Tasks 5–6 |
| pool-only VaR without alias | Task 5 |
| `Outcome` + `signalSnapshot` | Tasks 1, 9 |
| `/outcomes` form + history | Task 10 |
| Pearson + Spearman + tertile + n<5 | Tasks 8, 10 |
| No weights.yml writes | Tasks 9–10 |
| DESIGN.md / existing console style | Task 10 |
| Fixture tests offline | Tasks 3, 7 |
| E2E | Task 11 |

## Type consistency notes

- Collector id strings: `'defillama-tvl'`, `'etherscan-verified'`.
- Alias kind string: `'defillama'` (DB + YAML key `defillama:`).
- Signal type: `'value_at_risk'` (already in `SIGNAL_TYPES`).
- Outcome `action`: `'scan' | 'submit' | 'note'`; `result`: `'accepted' | 'duplicate' | 'invalid' | 'pending'`.
- Sync order: `collectCatalog` (incl. DefiLlama) → `materializeCatalog` (+ ProtocolTvl) → `collectContracts` (Etherscan) → `collectGithub` → `materializeSignals` (+ VaR) → `rank`.
