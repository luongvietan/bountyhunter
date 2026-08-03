# kritt-radar Pha 1A — Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng pipeline thu thập → chuẩn hoá → chấm điểm để `pnpm rank` in ra bảng xếp hạng bug bounty target kèm danh sách file sẵn sàng dán vào scope Open-Kritt.

**Architecture:** Monorepo pnpm. Dữ liệu chảy một chiều: Collector ghi `Observation` thô (append-only, khử trùng bằng contentHash) → Resolver gộp về `Entity` → SignalExtractor sinh `Signal` có `confidence` → Scorer chuẩn hoá lại trọng số theo confidence rồi ra `Score`. Mọi hàm chấm điểm đều thuần và không chạm mạng, nên chỉnh trọng số là replay được trên dữ liệu cũ.

**Tech Stack:** Node 24.14, pnpm 10.33 workspace, TypeScript 5.7 (ESM, NodeNext), Vitest 3, Prisma 6 + Postgres 16 (Docker Compose v5), Zod 3, undici, yaml.

**Không thuộc plan này:** dashboard Next.js, collector Playwright, nguồn on-chain, nguồn cộng đồng. Xem spec `docs/superpowers/specs/2026-08-03-kritt-radar-design.md` pha 2–4.

---

## File Structure

```
pnpm-workspace.yaml
package.json                                  scripts điều phối
tsconfig.base.json
docker-compose.yml                            postgres 16
.env.example

packages/core/                                THUẦN — không I/O, không mạng
  src/identity.ts                             chuẩn hoá repo URL, chain address
  src/signals.ts                              kiểu Signal + hằng số
  src/scoring.ts                              hàm score() renormalise theo confidence
  src/weights.ts                              parse + validate weights.yml
  src/index.ts
  tests/identity.test.ts
  tests/scoring.test.ts
  tests/weights.test.ts

packages/db/
  prisma/schema.prisma
  src/client.ts
  src/observations.ts                         ghi Observation idempotent

packages/collectors/
  src/types.ts                                interface Collector
  src/http.ts                                 token bucket + retry + Retry-After
  src/harness.ts                              chạy collector, ghi CollectorRun
  src/sources/c4-contests.ts
  src/sources/sherlock-contests.ts
  src/sources/cantina-competitions.ts
  src/sources/github-repo-activity.ts
  src/sources/audit-report-repos.ts
  src/sources/index.ts                        registry
  tests/__fixtures__/*.json
  tests/*.test.ts

packages/pipeline/
  src/resolver.ts                             tầng 1 khoá cứng + tầng 2 alias
  src/extractors/freshness.ts
  src/extractors/audit-gap.ts
  src/run.ts                                  điều phối toàn pipeline
  tests/*.test.ts

apps/worker/
  src/cli.ts                                  lệnh collect | resolve | score | rank

config/
  weights.yml
  aliases.yml
```

Ranh giới: `core` không import `db` hay `collectors`. `collectors` không biết gì về `Signal` hay `Score`. `pipeline` là chỗ duy nhất nối cả ba.

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/tests/smoke.test.ts`

- [ ] **Step 1: Tạo workspace manifest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`package.json`:
```json
{
  "name": "kritt-radar",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "collect": "pnpm --filter @kritt-radar/worker exec tsx src/cli.ts collect",
    "rank": "pnpm --filter @kritt-radar/worker exec tsx src/cli.ts rank"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.env.example`:
```
DATABASE_URL=postgresql://kritt:kritt@localhost:5433/kritt_radar
GITHUB_TOKEN=
```

- [ ] **Step 2: Tạo package core**

`packages/core/package.json`:
```json
{
  "name": "@kritt-radar/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "yaml": "^2.6.1", "zod": "^3.24.1" }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 3: Viết smoke test**

`packages/core/tests/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('core', () => {
  it('exports a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 4: Cài và chạy test**

Run: `pnpm install`
Run: `pnpm test`
Expected: PASS — 1 passed (1)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with core package"
```

---

## Task 2: Chuẩn hoá định danh (khoá cứng tầng 1)

Đây là nền của entity resolution. Nếu hàm này sai, mọi thứ phía sau sai âm thầm.

**Files:**
- Create: `packages/core/src/identity.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/identity.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/core/tests/identity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl, normalizeChainAddress } from '../src/identity.js';

describe('normalizeRepoUrl', () => {
  it('quy mọi biến thể của cùng một repo về một khoá', () => {
    const variants = [
      'https://github.com/Uniswap/v4-core',
      'https://github.com/Uniswap/v4-core.git',
      'https://github.com/uniswap/v4-core/',
      'http://www.github.com/Uniswap/v4-core',
      'git@github.com:Uniswap/v4-core.git',
      'git+https://github.com/Uniswap/v4-core.git',
      'https://github.com/Uniswap/v4-core/tree/main/src',
    ];
    for (const v of variants) {
      expect(normalizeRepoUrl(v)).toBe('github.com/uniswap/v4-core');
    }
  });

  it('không gộp nhầm hai repo khác nhau', () => {
    expect(normalizeRepoUrl('https://github.com/uniswap/v4-core'))
      .not.toBe(normalizeRepoUrl('https://github.com/uniswap/v4-periphery'));
  });

  it('trả null cho host không nhận dạng được hoặc chuỗi rác', () => {
    expect(normalizeRepoUrl('https://example.com/foo/bar')).toBeNull();
    expect(normalizeRepoUrl('not a url')).toBeNull();
    expect(normalizeRepoUrl('')).toBeNull();
    expect(normalizeRepoUrl('https://github.com/uniswap')).toBeNull();
  });
});

describe('normalizeChainAddress', () => {
  it('hạ chữ thường địa chỉ EVM', () => {
    expect(normalizeChainAddress('ethereum', '0xAbC0000000000000000000000000000000000123'))
      .toBe('ethereum:0xabc0000000000000000000000000000000000123');
  });

  it('GIỮ NGUYÊN hoa thường cho Solana vì base58 phân biệt hoa thường', () => {
    const addr = 'So11111111111111111111111111111111111111112';
    expect(normalizeChainAddress('solana', addr)).toBe(`solana:${addr}`);
  });

  it('từ chối địa chỉ EVM sai định dạng', () => {
    expect(normalizeChainAddress('ethereum', '0x123')).toBeNull();
    expect(normalizeChainAddress('ethereum', 'nothex')).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/core/tests/identity.test.ts`
Expected: FAIL — "Failed to resolve import ... src/identity.js"

- [ ] **Step 3: Cài đặt tối thiểu**

`packages/core/src/identity.ts`:
```ts
const REPO_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

/**
 * Quy mọi biến thể URL repo về khoá chuẩn `host/owner/name`.
 * Trả null khi không nhận dạng được — người gọi PHẢI coi null là "không có khoá
 * cứng", không được coi là chuỗi rỗng rồi gộp nhầm mọi thứ vào một entity.
 */
export function normalizeRepoUrl(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  s = s.replace(/^git\+/, '');
  s = s.replace(/^git@([^:]+):/, '$1/');
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.replace(/^www\./, '');

  const parts = s.split('/').filter(Boolean);
  const [host, owner, nameRaw] = parts;
  if (!host || !owner || !nameRaw) return null;
  if (!REPO_HOSTS.includes(host as (typeof REPO_HOSTS)[number])) return null;

  const name = nameRaw.replace(/\.git$/, '');
  if (!name) return null;

  return `${host}/${owner}/${name}`;
}

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Khoá chuẩn `chain:address`.
 * Chỉ hạ chữ thường cho chain dùng hex. Base58 (Solana) phân biệt hoa thường —
 * hạ chữ thường ở đó sẽ tạo ra địa chỉ khác và gộp nhầm entity.
 */
export function normalizeChainAddress(chain: string, address: string): string | null {
  const c = chain.trim().toLowerCase();
  const a = address.trim();
  if (!c || !a) return null;

  if (c === 'solana') {
    return BASE58.test(a) ? `${c}:${a}` : null;
  }

  const lowered = a.toLowerCase();
  return EVM_ADDRESS.test(lowered) ? `${c}:${lowered}` : null;
}
```

Sửa `packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';
export * from './identity.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/core/tests/identity.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): normalize repo urls and chain addresses"
```

---

## Task 3: Kiểu Signal

**Files:**
- Create: `packages/core/src/signals.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/signals.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/core/tests/signals.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SIGNAL_TYPES, isSignalType, clamp01 } from '../src/signals.js';

describe('signals', () => {
  it('liệt kê đúng các loại tín hiệu', () => {
    expect([...SIGNAL_TYPES]).toEqual(['audit_gap', 'freshness', 'competition', 'value_at_risk']);
  });

  it('nhận diện loại hợp lệ', () => {
    expect(isSignalType('audit_gap')).toBe(true);
    expect(isSignalType('nonsense')).toBe(false);
  });

  it('clamp01 kẹp về [0,1] và biến NaN thành 0', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/core/tests/signals.test.ts`
Expected: FAIL — không resolve được `src/signals.js`

- [ ] **Step 3: Cài đặt**

`packages/core/src/signals.ts`:
```ts
export const SIGNAL_TYPES = ['audit_gap', 'freshness', 'competition', 'value_at_risk'] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export function isSignalType(v: string): v is SignalType {
  return (SIGNAL_TYPES as readonly string[]).includes(v);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export interface SignalValue {
  type: SignalType;
  /** Sức mạnh tín hiệu, 0..1. Cao = mục tiêu hấp dẫn hơn. */
  value: number;
  /** Mức tin cậy vào `value`, 0..1. 0 nghĩa là KHÔNG CÓ dữ liệu, khác hẳn value=0. */
  confidence: number;
  evidence: Record<string, unknown>;
}
```

Sửa `packages/core/src/index.ts`, thêm dòng:
```ts
export * from './signals.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/core/tests/signals.test.ts`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add signal types and clamp helper"
```

---

## Task 4: Scorer chuẩn hoá lại theo confidence

Bất biến quan trọng nhất trong repo: **thiếu dữ liệu không được hành xử như điểm 0**.

**Files:**
- Create: `packages/core/src/scoring.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/scoring.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/core/tests/scoring.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { score } from '../src/scoring.js';
import type { SignalValue } from '../src/signals.js';
import type { Weights } from '../src/scoring.js';

const W: Weights = {
  version: 'test-1',
  minConfidence: 0.3,
  weights: { audit_gap: 1, freshness: 1, competition: 1, value_at_risk: 1 },
};

const sig = (type: SignalValue['type'], value: number, confidence = 1): SignalValue =>
  ({ type, value, confidence, evidence: {} });

describe('score', () => {
  it('luôn nằm trong [0,100]', () => {
    expect(score([sig('audit_gap', 1)], W).total).toBe(100);
    expect(score([sig('audit_gap', 0)], W).total).toBe(0);
    expect(score([sig('audit_gap', 5)], W).total).toBe(100);
    expect(score([sig('audit_gap', -5)], W).total).toBe(0);
  });

  it('BẤT BIẾN: tín hiệu confidence=0 không làm đổi tổng điểm', () => {
    const a = score([sig('audit_gap', 1)], W);
    const b = score([sig('audit_gap', 1), sig('competition', 0, 0)], W);
    expect(b.total).toBe(a.total);
    expect(b.skipped).toEqual(['competition']);
  });

  it('đơn điệu tăng theo từng giá trị tín hiệu', () => {
    const lo = score([sig('audit_gap', 0.2), sig('freshness', 0.5)], W).total;
    const hi = score([sig('audit_gap', 0.9), sig('freshness', 0.5)], W).total;
    expect(hi).toBeGreaterThan(lo);
  });

  it('chuẩn hoá lại trọng số trên các tín hiệu còn dùng được', () => {
    const r = score([sig('audit_gap', 1), sig('freshness', 0)], W);
    expect(r.total).toBeCloseTo(50, 6);
    expect(r.usedSignals).toBe(2);
  });

  it('bỏ tín hiệu dưới ngưỡng minConfidence', () => {
    const r = score([sig('audit_gap', 1), sig('freshness', 1, 0.1)], W);
    expect(r.skipped).toEqual(['freshness']);
    expect(r.total).toBe(100);
  });

  it('không có tín hiệu dùng được thì điểm 0 và usedSignals 0', () => {
    const r = score([sig('audit_gap', 1, 0)], W);
    expect(r.total).toBe(0);
    expect(r.usedSignals).toBe(0);
  });

  it('breakdown cộng lại đúng bằng tổng', () => {
    const r = score([sig('audit_gap', 0.8), sig('freshness', 0.3), sig('value_at_risk', 0.6)], W);
    const sum = r.breakdown.reduce((a, b) => a + b.contribution, 0);
    expect(sum).toBeCloseTo(r.total, 6);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/core/tests/scoring.test.ts`
Expected: FAIL — không resolve được `src/scoring.js`

- [ ] **Step 3: Cài đặt**

`packages/core/src/scoring.ts`:
```ts
import { clamp01, type SignalType, type SignalValue } from './signals.js';

export interface Weights {
  version: string;
  /** Tín hiệu có confidence dưới ngưỡng này bị loại khỏi phép tính. */
  minConfidence: number;
  weights: Record<SignalType, number>;
}

export interface ScoreContribution {
  type: SignalType;
  value: number;
  confidence: number;
  /** Trọng số đã chuẩn hoá lại, cộng tất cả bằng 1. */
  normalizedWeight: number;
  /** Số điểm tín hiệu này đóng góp vào tổng. */
  contribution: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreContribution[];
  usedSignals: number;
  skipped: SignalType[];
  weightsVersion: string;
}

/**
 * Tổng có trọng số, thang 0..100.
 *
 * Tín hiệu thiếu dữ liệu (confidence thấp) bị LOẠI và trọng số được chuẩn hoá
 * lại trên phần còn lại — chứ không bị tính như value=0. Nếu tính như 0, một
 * target chỉ vì thiếu dữ liệu sẽ tụt hạng y như một target thật sự kém, và
 * bảng xếp hạng sẽ ưu ái những target dễ crawl thay vì những target đáng làm.
 */
export function score(signals: readonly SignalValue[], weights: Weights): ScoreResult {
  const used: SignalValue[] = [];
  const skipped: SignalType[] = [];

  for (const s of signals) {
    const w = weights.weights[s.type] ?? 0;
    if (w > 0 && s.confidence >= weights.minConfidence) used.push(s);
    else skipped.push(s.type);
  }

  const totalWeight = used.reduce((acc, s) => acc + (weights.weights[s.type] ?? 0), 0);

  if (totalWeight <= 0) {
    return { total: 0, breakdown: [], usedSignals: 0, skipped, weightsVersion: weights.version };
  }

  const breakdown: ScoreContribution[] = used.map((s) => {
    const normalizedWeight = (weights.weights[s.type] ?? 0) / totalWeight;
    return {
      type: s.type,
      value: s.value,
      confidence: s.confidence,
      normalizedWeight,
      contribution: clamp01(s.value) * normalizedWeight * 100,
    };
  });

  const total = breakdown.reduce((acc, b) => acc + b.contribution, 0);

  return { total, breakdown, usedSignals: used.length, skipped, weightsVersion: weights.version };
}
```

Sửa `packages/core/src/index.ts`, thêm dòng:
```ts
export * from './scoring.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/core/tests/scoring.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): confidence-aware weighted scorer"
```

---

## Task 5: Nạp và kiểm tra weights.yml

**Files:**
- Create: `packages/core/src/weights.ts`, `config/weights.yml`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/weights.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/core/tests/weights.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseWeights } from '../src/weights.js';

describe('parseWeights', () => {
  it('parse file hợp lệ', () => {
    const w = parseWeights(`
version: v1-equal
minConfidence: 0.3
weights:
  audit_gap: 1
  freshness: 1
  competition: 1
  value_at_risk: 1
`);
    expect(w.version).toBe('v1-equal');
    expect(w.minConfidence).toBe(0.3);
    expect(w.weights.audit_gap).toBe(1);
  });

  it('báo lỗi khi thiếu một loại tín hiệu', () => {
    expect(() => parseWeights(`
version: bad
minConfidence: 0.3
weights:
  audit_gap: 1
`)).toThrow(/freshness/);
  });

  it('từ chối trọng số âm', () => {
    expect(() => parseWeights(`
version: bad
minConfidence: 0.3
weights:
  audit_gap: -1
  freshness: 1
  competition: 1
  value_at_risk: 1
`)).toThrow();
  });

  it('từ chối minConfidence ngoài [0,1]', () => {
    expect(() => parseWeights(`
version: bad
minConfidence: 1.5
weights:
  audit_gap: 1
  freshness: 1
  competition: 1
  value_at_risk: 1
`)).toThrow();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/core/tests/weights.test.ts`
Expected: FAIL — không resolve được `src/weights.js`

- [ ] **Step 3: Cài đặt**

`packages/core/src/weights.ts`:
```ts
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { SIGNAL_TYPES } from './signals.js';
import type { Weights } from './scoring.js';

const weightsShape = Object.fromEntries(
  SIGNAL_TYPES.map((t) => [t, z.number().min(0)]),
) as Record<(typeof SIGNAL_TYPES)[number], z.ZodNumber>;

const WeightsSchema = z.object({
  version: z.string().min(1),
  minConfidence: z.number().min(0).max(1),
  weights: z.object(weightsShape).strict(),
});

export function parseWeights(yamlText: string): Weights {
  return WeightsSchema.parse(parseYaml(yamlText)) as Weights;
}
```

`config/weights.yml`:
```yaml
# V1 để trọng số bằng nhau: hiện chưa có dữ liệu nào nói tín hiệu nào quan trọng
# hơn. Bảng Outcome (pha 2) sẽ trả lời câu đó. Đổi trọng số thì tăng version để
# so sánh được hai bộ trên cùng tập dữ liệu.
version: v1-equal
minConfidence: 0.3
weights:
  audit_gap: 1
  freshness: 1
  competition: 1
  value_at_risk: 1
```

Sửa `packages/core/src/index.ts`, thêm dòng:
```ts
export * from './weights.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/core/tests/weights.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): load and validate weights.yml"
```

---

## Task 6: Postgres + Prisma schema

**Files:**
- Create: `docker-compose.yml`, `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`

- [ ] **Step 1: Tạo Compose**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    # Cổng 5433 để không đụng Postgres 5432 của Open-Kritt chạy song song.
    ports: ['127.0.0.1:5433:5432']
    environment:
      POSTGRES_USER: kritt
      POSTGRES_PASSWORD: kritt
      POSTGRES_DB: kritt_radar
    volumes: ['./pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U kritt -d kritt_radar']
      interval: 5s
      timeout: 3s
      retries: 10
```

- [ ] **Step 2: Tạo package db**

`packages/db/package.json`:
```json
{
  "name": "@kritt-radar/db",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "migrate": "prisma migrate dev",
    "generate": "prisma generate"
  },
  "dependencies": { "@prisma/client": "^6.2.0" },
  "devDependencies": { "prisma": "^6.2.0" }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/db/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Entity {
  id            String        @id @default(cuid())
  canonicalName String
  slug          String        @unique
  createdAt     DateTime      @default(now())
  programs      Program[]
  auditReports  AuditReport[]
}

model Program {
  id          String    @id @default(cuid())
  entity      Entity?   @relation(fields: [entityId], references: [id])
  entityId    String?
  platform    String
  externalId  String
  title       String
  url         String
  poolUsd     Decimal?  @db.Decimal(20, 2)
  kind        String
  publishedAt DateTime?
  startsAt    DateTime?
  endsAt      DateTime?
  status      String    @default("open")
  scopes      Scope[]

  @@unique([platform, externalId])
  @@index([entityId])
}

model Scope {
  id        String   @id @default(cuid())
  program   Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  programId String
  kind      String
  /// Khoá chuẩn từ normalizeRepoUrl / normalizeChainAddress. Null = không có khoá cứng.
  hardKey   String?
  repoUrl   String?
  commitish String?
  pathGlobs String[]
  chain     String?
  address   String?
  signals   Signal[]
  scores    Score[]

  @@index([programId])
  @@index([hardKey])
}

model AuditReport {
  id            String   @id @default(cuid())
  entity        Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)
  entityId      String
  firm          String
  publishedAt   DateTime
  reportUrl     String
  coveredCommit String?
  coveredPaths  String[]

  @@index([entityId, publishedAt])
}

model Observation {
  id          String   @id @default(cuid())
  collectorId String
  sourceUrl   String
  fetchedAt   DateTime @default(now())
  payload     Json
  contentHash String

  /// Khiến việc chạy lại collector là idempotent: nội dung không đổi thì không
  /// sinh dòng mới, nên so hash giữa hai lần fetch phát hiện được scope mở rộng.
  @@unique([collectorId, sourceUrl, contentHash])
  @@index([collectorId, fetchedAt])
}

model Signal {
  id             String   @id @default(cuid())
  scope          Scope    @relation(fields: [scopeId], references: [id], onDelete: Cascade)
  scopeId        String
  type           String
  value          Float
  confidence     Float
  evidence       Json
  observationIds String[]
  computedAt     DateTime @default(now())

  @@unique([scopeId, type])
  @@index([scopeId])
}

model Score {
  id             String   @id @default(cuid())
  scope          Scope    @relation(fields: [scopeId], references: [id], onDelete: Cascade)
  scopeId        String
  total          Float
  breakdown      Json
  weightsVersion String
  computedAt     DateTime @default(now())

  @@unique([scopeId, weightsVersion])
  @@index([total])
}

model CollectorRun {
  id          String    @id @default(cuid())
  collectorId String
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  status      String
  itemCount   Int       @default(0)
  error       String?

  @@index([collectorId, startedAt])
}
```

`packages/db/src/client.ts`:
```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export * from '@prisma/client';
```

Tạo `packages/db/src/index.ts`:
```ts
export * from './client.js';
```

- [ ] **Step 3: Khởi động DB và chạy migration**

Run: `docker compose up -d postgres`
Run: `cp .env.example .env`
Run: `pnpm --filter @kritt-radar/db exec prisma migrate dev --name init`
Expected: "Your database is now in sync with your schema." và thư mục `packages/db/prisma/migrations/` xuất hiện

- [ ] **Step 4: Kiểm tra client sinh ra dùng được**

Run: `pnpm --filter @kritt-radar/db exec tsx -e "import {prisma} from './src/client.js'; console.log(await prisma.observation.count()); await prisma.$disconnect()"`
Expected: in ra `0`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): prisma schema and postgres compose service"
```

---

## Task 7: HTTP client có token bucket và backoff

**Files:**
- Create: `packages/collectors/package.json`, `packages/collectors/tsconfig.json`, `packages/collectors/src/http.ts`
- Test: `packages/collectors/tests/http.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/collectors/tests/http.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { TokenBucket, retryDelayMs } from '../src/http.js';

describe('TokenBucket', () => {
  it('cho qua tới hạn burst rồi mới chặn', async () => {
    const b = new TokenBucket({ rps: 1000, burst: 3 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it('nạp lại token theo thời gian', () => {
    vi.useFakeTimers();
    const b = new TokenBucket({ rps: 10, burst: 1 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(b.tryTake()).toBe(true);
    vi.useRealTimers();
  });
});

describe('retryDelayMs', () => {
  it('ưu tiên Retry-After tính bằng giây', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
  });

  it('backoff luỹ thừa khi không có Retry-After', () => {
    const d0 = retryDelayMs(0, null);
    const d2 = retryDelayMs(2, null);
    expect(d2).toBeGreaterThan(d0);
  });

  it('có jitter nên hai lần gọi không bằng nhau', () => {
    const xs = new Set(Array.from({ length: 20 }, () => retryDelayMs(3, null)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('chặn trên ở 60 giây', () => {
    expect(retryDelayMs(50, null)).toBeLessThanOrEqual(60_000);
  });
});
```

- [ ] **Step 2: Tạo package rồi chạy test để xác nhận fail**

`packages/collectors/package.json`:
```json
{
  "name": "@kritt-radar/collectors",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@kritt-radar/core": "workspace:*",
    "@kritt-radar/db": "workspace:*",
    "undici": "^7.2.0",
    "zod": "^3.24.1"
  }
}
```

`packages/collectors/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Run: `pnpm install`
Run: `pnpm vitest run packages/collectors/tests/http.test.ts`
Expected: FAIL — không resolve được `src/http.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/http.ts`:
```ts
export interface RateLimit {
  rps: number;
  burst: number;
}

/** Token bucket theo từng host, để một collector chậm không kéo cả pipeline. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly limit: RateLimit) {
    this.tokens = limit.burst;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.limit.burst, this.tokens + elapsedSec * this.limit.rps);
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async take(): Promise<void> {
    while (!this.tryTake()) {
      await new Promise((r) => setTimeout(r, Math.ceil(1000 / this.limit.rps)));
    }
  }
}

const MAX_DELAY_MS = 60_000;

/**
 * Header Retry-After của máy chủ luôn thắng phép tính của ta — bỏ qua nó là
 * cách nhanh nhất để bị chặn IP. Không có thì backoff luỹ thừa có jitter.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS);
    }
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) {
      return Math.min(Math.max(at - Date.now(), 0), MAX_DELAY_MS);
    }
  }
  const base = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

export const USER_AGENT =
  'kritt-radar/0.1 (bug bounty target discovery; contact: luongvietan.231123@gmail.com)';

const buckets = new Map<string, TokenBucket>();

export async function fetchJson<T>(
  url: string,
  opts: { limit: RateLimit; headers?: Record<string, string>; maxAttempts?: number } ,
): Promise<T> {
  const host = new URL(url).host;
  let bucket = buckets.get(host);
  if (!bucket) {
    bucket = new TokenBucket(opts.limit);
    buckets.set(host, bucket);
  }

  const maxAttempts = opts.maxAttempts ?? 4;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await bucket.take();
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...opts.headers },
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt, res.headers.get('retry-after'))));
        lastError = new Error(`${res.status} ${res.statusText} for ${url}`);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt, null)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`fetch failed: ${url}`);
}
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/http.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): rate-limited http client with backoff"
```

---

## Task 8: Interface Collector và ghi Observation idempotent

**Files:**
- Create: `packages/collectors/src/types.ts`, `packages/db/src/observations.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/collectors/tests/types.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/collectors/tests/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { contentHash, makeObservation } from '../src/types.js';

describe('contentHash', () => {
  it('ổn định bất kể thứ tự khoá', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it('đổi khi nội dung đổi', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('xử lý được mảng lồng nhau', () => {
    expect(contentHash({ xs: [1, { y: 2 }] })).toBe(contentHash({ xs: [1, { y: 2 }] }));
  });
});

describe('makeObservation', () => {
  it('gắn collectorId, sourceUrl và hash', () => {
    const o = makeObservation('c4-contests', 'https://example.com/a', { id: 1 });
    expect(o.collectorId).toBe('c4-contests');
    expect(o.sourceUrl).toBe('https://example.com/a');
    expect(o.contentHash).toBe(contentHash({ id: 1 }));
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/types.test.ts`
Expected: FAIL — không resolve được `src/types.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/types.ts`:
```ts
import { createHash } from 'node:crypto';
import type { RateLimit } from './http.js';

export interface RawObservation<T = unknown> {
  collectorId: string;
  sourceUrl: string;
  payload: T;
  contentHash: string;
}

export interface FetchCtx {
  /** Chỉ nạp secret từ env. Thiếu thì collector tự bỏ qua, không phải lỗi. */
  env: Record<string, string | undefined>;
  now: () => Date;
}

export interface Collector<T = unknown> {
  readonly id: string;
  readonly cadence: string;
  readonly rateLimit: RateLimit;
  /** Tên biến env bắt buộc. Thiếu thì harness bỏ qua collector này. */
  readonly requiresCredential?: string;
  fetch(ctx: FetchCtx): AsyncIterable<RawObservation<T>>;
}

/** Serialise ổn định để cùng nội dung luôn ra cùng hash bất kể thứ tự khoá. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}

export function contentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function makeObservation<T>(
  collectorId: string,
  sourceUrl: string,
  payload: T,
): RawObservation<T> {
  return { collectorId, sourceUrl, payload, contentHash: contentHash(payload) };
}
```

`packages/db/src/observations.ts`:
```ts
import { prisma } from './client.js';

export interface ObservationInput {
  collectorId: string;
  sourceUrl: string;
  payload: unknown;
  contentHash: string;
}

/**
 * Ghi Observation, bỏ qua bản trùng.
 * Dựa vào UNIQUE(collectorId, sourceUrl, contentHash): chạy lại collector khi
 * nguồn chưa đổi thì không sinh dòng mới, nên số dòng của một sourceUrl chính
 * là số lần nội dung của nó thay đổi.
 */
export async function saveObservations(items: readonly ObservationInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await prisma.observation.createMany({
    data: items.map((i) => ({
      collectorId: i.collectorId,
      sourceUrl: i.sourceUrl,
      payload: i.payload as never,
      contentHash: i.contentHash,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
```

Sửa `packages/db/src/index.ts`:
```ts
export * from './client.js';
export * from './observations.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/types.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): collector interface and idempotent observation writes"
```

---

## Task 9: Collector c4-contests

Collector chỉ fetch và chuẩn hoá. Không chấm điểm, không resolve entity.

**Files:**
- Create: `packages/collectors/src/sources/c4-contests.ts`, `packages/collectors/tests/__fixtures__/c4-contests.json`
- Test: `packages/collectors/tests/c4-contests.test.ts`

- [ ] **Step 1: Tạo fixture và test thất bại**

`packages/collectors/tests/__fixtures__/c4-contests.json`:
```json
[
  {
    "contestid": 412,
    "title": "Acme Vault",
    "sponsor": "Acme",
    "start_time": "2026-07-28T14:00:00Z",
    "end_time": "2026-08-04T14:00:00Z",
    "amount": "$100,000 USDC",
    "repo": "https://github.com/code-423n4/2026-07-acme",
    "findingsRepo": "https://github.com/code-423n4/2026-07-acme-findings",
    "hide": false
  },
  {
    "contestid": 400,
    "title": "Hidden Contest",
    "sponsor": "Nope",
    "start_time": "2026-06-01T14:00:00Z",
    "end_time": "2026-06-08T14:00:00Z",
    "amount": "$50,000 USDC",
    "repo": "",
    "hide": true
  }
]
```

`packages/collectors/tests/c4-contests.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/c4-contests.json' with { type: 'json' };
import { parseC4Contests } from '../src/sources/c4-contests.js';

describe('parseC4Contests', () => {
  it('chuẩn hoá contest hợp lệ thành observation', () => {
    const out = parseC4Contests(fixture);
    expect(out).toHaveLength(1);
    const o = out[0]!;
    expect(o.collectorId).toBe('c4-contests');
    expect(o.payload.externalId).toBe('412');
    expect(o.payload.title).toBe('Acme Vault');
    expect(o.payload.poolUsd).toBe(100000);
    expect(o.payload.kind).toBe('contest');
    expect(o.payload.repoUrl).toBe('github.com/code-423n4/2026-07-acme');
  });

  it('bỏ contest bị ẩn', () => {
    expect(parseC4Contests(fixture).some((o) => o.payload.title === 'Hidden Contest')).toBe(false);
  });

  it('bỏ qua bản ghi rác thay vì ném lỗi', () => {
    expect(parseC4Contests([{ nonsense: true }, ...fixture])).toHaveLength(1);
  });

  it('hash ổn định giữa hai lần parse cùng dữ liệu', () => {
    expect(parseC4Contests(fixture)[0]!.contentHash).toBe(parseC4Contests(fixture)[0]!.contentHash);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/c4-contests.test.ts`
Expected: FAIL — không resolve được `src/sources/c4-contests.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/c4-contests.ts`:
```ts
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const C4_URL = 'https://code4rena.com/api/contests';

const RawContest = z.object({
  contestid: z.union([z.number(), z.string()]),
  title: z.string(),
  sponsor: z.string().optional(),
  start_time: z.string(),
  end_time: z.string(),
  amount: z.string().optional(),
  repo: z.string().optional(),
  hide: z.boolean().optional(),
});

export interface ProgramPayload {
  platform: string;
  externalId: string;
  title: string;
  url: string;
  poolUsd: number | null;
  kind: 'contest' | 'bounty';
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  repoUrl: string | null;
  sponsor: string | null;
}

/** "$100,000 USDC" -> 100000. Trả null khi không đọc được, KHÔNG trả 0. */
export function parsePoolUsd(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseC4Contests(raw: unknown): RawObservation<ProgramPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of raw) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.hide) continue;

    const externalId = String(c.contestid);
    const payload: ProgramPayload = {
      platform: 'code4rena',
      externalId,
      title: c.title,
      url: `https://code4rena.com/contests/${externalId}`,
      poolUsd: parsePoolUsd(c.amount),
      kind: 'contest',
      publishedAt: c.start_time,
      startsAt: c.start_time,
      endsAt: c.end_time,
      repoUrl: c.repo ? normalizeRepoUrl(c.repo) : null,
      sponsor: c.sponsor ?? null,
    };
    out.push(makeObservation('c4-contests', payload.url, payload));
  }
  return out;
}

export const c4Contests: Collector<ProgramPayload> = {
  id: 'c4-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(C4_URL, { limit: this.rateLimit });
    yield* parseC4Contests(raw);
  },
};
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/c4-contests.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Ghi lại fixture thật rồi commit**

Run: `pnpm --filter @kritt-radar/collectors exec tsx -e "const r = await fetch('https://code4rena.com/api/contests'); console.log((await r.text()).slice(0,400))"`

Nếu response khác hình dạng trong fixture, cập nhật `RawContest` và fixture cho khớp rồi chạy lại test. Nếu endpoint trả 404 hoặc HTML, ghi lại URL đúng vào phần **Rủi ro đã biết** của spec và tạm giữ nguyên fixture — collector vẫn phải test được offline.

```bash
git add -A && git commit -m "feat(collectors): code4rena contests collector"
```

---

## Task 10: Collector sherlock-contests

**Files:**
- Create: `packages/collectors/src/sources/sherlock-contests.ts`, `packages/collectors/tests/__fixtures__/sherlock-contests.json`
- Test: `packages/collectors/tests/sherlock-contests.test.ts`

- [ ] **Step 1: Tạo fixture và test thất bại**

`packages/collectors/tests/__fixtures__/sherlock-contests.json`:
```json
[
  {
    "id": 771,
    "title": "Zephyr Perps",
    "short_description": "Perpetuals exchange",
    "prize_pool": 75000,
    "starts_at": 1785312000,
    "ends_at": 1785916800,
    "repo_urls": ["https://github.com/zephyr-fi/perps-core"],
    "status": "RUNNING"
  },
  {
    "id": 500,
    "title": "Draft Contest",
    "prize_pool": 0,
    "starts_at": 1780000000,
    "ends_at": 1780600000,
    "repo_urls": [],
    "status": "DRAFT"
  }
]
```

`packages/collectors/tests/sherlock-contests.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sherlock-contests.json' with { type: 'json' };
import { parseSherlockContests } from '../src/sources/sherlock-contests.js';

describe('parseSherlockContests', () => {
  it('chuẩn hoá contest đang chạy', () => {
    const out = parseSherlockContests(fixture);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload;
    expect(p.externalId).toBe('771');
    expect(p.poolUsd).toBe(75000);
    expect(p.repoUrl).toBe('github.com/zephyr-fi/perps-core');
    expect(p.platform).toBe('sherlock');
  });

  it('đổi timestamp giây sang ISO', () => {
    const p = parseSherlockContests(fixture)[0]!.payload;
    expect(p.startsAt).toBe(new Date(1785312000 * 1000).toISOString());
  });

  it('bỏ contest ở trạng thái DRAFT', () => {
    expect(parseSherlockContests(fixture).some((o) => o.payload.title === 'Draft Contest')).toBe(false);
  });

  it('pool bằng 0 thành null chứ không phải 0', () => {
    const out = parseSherlockContests([
      { id: 9, title: 'X', prize_pool: 0, starts_at: 1785312000, ends_at: 1785916800, repo_urls: [], status: 'RUNNING' },
    ]);
    expect(out[0]!.payload.poolUsd).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/sherlock-contests.test.ts`
Expected: FAIL — không resolve được `src/sources/sherlock-contests.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/sherlock-contests.ts`:
```ts
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const SHERLOCK_URL = 'https://mainnet-contest.sherlock.xyz/contests';

const RawContest = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  prize_pool: z.number().optional(),
  starts_at: z.number(),
  ends_at: z.number(),
  repo_urls: z.array(z.string()).optional(),
  status: z.string().optional(),
});

const SKIP_STATUSES = new Set(['DRAFT', 'CANCELLED']);

function toIso(epochSeconds: number): string | null {
  const d = new Date(epochSeconds * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function parseSherlockContests(raw: unknown): RawObservation<ProgramPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of raw) {
    const parsed = RawContest.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.status && SKIP_STATUSES.has(c.status.toUpperCase())) continue;

    const externalId = String(c.id);
    const firstRepo = c.repo_urls?.[0];
    const payload: ProgramPayload = {
      platform: 'sherlock',
      externalId,
      title: c.title,
      url: `https://audits.sherlock.xyz/contests/${externalId}`,
      poolUsd: c.prize_pool && c.prize_pool > 0 ? c.prize_pool : null,
      kind: 'contest',
      publishedAt: toIso(c.starts_at),
      startsAt: toIso(c.starts_at),
      endsAt: toIso(c.ends_at),
      repoUrl: firstRepo ? normalizeRepoUrl(firstRepo) : null,
      sponsor: null,
    };
    out.push(makeObservation('sherlock-contests', payload.url, payload));
  }
  return out;
}

export const sherlockContests: Collector<ProgramPayload> = {
  id: 'sherlock-contests',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(SHERLOCK_URL, { limit: this.rateLimit });
    yield* parseSherlockContests(raw);
  },
};
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/sherlock-contests.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): sherlock contests collector"
```

---

## Task 11: Collector cantina-competitions

**Files:**
- Create: `packages/collectors/src/sources/cantina-competitions.ts`, `packages/collectors/tests/__fixtures__/cantina-competitions.json`
- Test: `packages/collectors/tests/cantina-competitions.test.ts`

- [ ] **Step 1: Tạo fixture và test thất bại**

`packages/collectors/tests/__fixtures__/cantina-competitions.json`:
```json
{
  "competitions": [
    {
      "id": "orbit-lending",
      "name": "Orbit Lending",
      "totalPrize": 120000,
      "startDate": "2026-07-30T00:00:00.000Z",
      "endDate": "2026-08-20T00:00:00.000Z",
      "repositoryUrl": "https://github.com/orbit-fi/lending.git",
      "state": "active"
    },
    {
      "id": "archived-one",
      "name": "Archived One",
      "totalPrize": 30000,
      "startDate": "2026-01-01T00:00:00.000Z",
      "endDate": "2026-01-20T00:00:00.000Z",
      "repositoryUrl": "https://github.com/foo/bar",
      "state": "archived"
    }
  ]
}
```

`packages/collectors/tests/cantina-competitions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/cantina-competitions.json' with { type: 'json' };
import { parseCantinaCompetitions } from '../src/sources/cantina-competitions.js';

describe('parseCantinaCompetitions', () => {
  it('đọc mảng lồng trong khoá competitions', () => {
    const out = parseCantinaCompetitions(fixture);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload.externalId).toBe('orbit-lending');
  });

  it('gỡ đuôi .git khỏi repo url', () => {
    expect(parseCantinaCompetitions(fixture)[0]!.payload.repoUrl).toBe('github.com/orbit-fi/lending');
  });

  it('bỏ competition đã archived', () => {
    expect(parseCantinaCompetitions(fixture).some((o) => o.payload.externalId === 'archived-one')).toBe(false);
  });

  it('trả mảng rỗng khi payload sai hình dạng', () => {
    expect(parseCantinaCompetitions({ nope: 1 })).toEqual([]);
    expect(parseCantinaCompetitions(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/cantina-competitions.test.ts`
Expected: FAIL — không resolve được `src/sources/cantina-competitions.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/cantina-competitions.ts`:
```ts
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';
import type { ProgramPayload } from './c4-contests.js';

const CANTINA_URL = 'https://cantina.xyz/api/v0/competitions';

const RawCompetition = z.object({
  id: z.string(),
  name: z.string(),
  totalPrize: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  repositoryUrl: z.string().optional(),
  state: z.string().optional(),
});

const Envelope = z.object({ competitions: z.array(z.unknown()) });

const SKIP_STATES = new Set(['archived', 'draft']);

export function parseCantinaCompetitions(raw: unknown): RawObservation<ProgramPayload>[] {
  const env = Envelope.safeParse(raw);
  if (!env.success) return [];
  const out: RawObservation<ProgramPayload>[] = [];

  for (const item of env.data.competitions) {
    const parsed = RawCompetition.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    if (c.state && SKIP_STATES.has(c.state.toLowerCase())) continue;

    const payload: ProgramPayload = {
      platform: 'cantina',
      externalId: c.id,
      title: c.name,
      url: `https://cantina.xyz/competitions/${c.id}`,
      poolUsd: c.totalPrize && c.totalPrize > 0 ? c.totalPrize : null,
      kind: 'contest',
      publishedAt: c.startDate ?? null,
      startsAt: c.startDate ?? null,
      endsAt: c.endDate ?? null,
      repoUrl: c.repositoryUrl ? normalizeRepoUrl(c.repositoryUrl) : null,
      sponsor: null,
    };
    out.push(makeObservation('cantina-competitions', payload.url, payload));
  }
  return out;
}

export const cantinaCompetitions: Collector<ProgramPayload> = {
  id: 'cantina-competitions',
  cadence: '*/30 * * * *',
  rateLimit: { rps: 1, burst: 2 },
  async *fetch(_ctx: FetchCtx) {
    const raw = await fetchJson<unknown>(CANTINA_URL, { limit: this.rateLimit });
    yield* parseCantinaCompetitions(raw);
  },
};
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/cantina-competitions.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): cantina competitions collector"
```

---

## Task 12: Collector github-repo-activity

Sinh dữ liệu commit để `audit_gap` tính churn.

**Files:**
- Create: `packages/collectors/src/sources/github-repo-activity.ts`, `packages/collectors/tests/__fixtures__/github-commits.json`
- Test: `packages/collectors/tests/github-repo-activity.test.ts`

- [ ] **Step 1: Tạo fixture và test thất bại**

`packages/collectors/tests/__fixtures__/github-commits.json`:
```json
[
  {
    "sha": "aaa111",
    "commit": { "author": { "date": "2026-07-20T10:00:00Z" }, "message": "feat: add hook" },
    "files": [
      { "filename": "src/Hooks.sol", "additions": 120, "deletions": 4 },
      { "filename": "README.md", "additions": 2, "deletions": 0 }
    ]
  },
  {
    "sha": "bbb222",
    "commit": { "author": { "date": "2026-05-01T10:00:00Z" }, "message": "chore: bump" },
    "files": [{ "filename": "package.json", "additions": 1, "deletions": 1 }]
  }
]
```

`packages/collectors/tests/github-repo-activity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/github-commits.json' with { type: 'json' };
import { parseCommits, matchesGlobs } from '../src/sources/github-repo-activity.js';

describe('matchesGlobs', () => {
  it('mảng glob rỗng nghĩa là khớp tất cả', () => {
    expect(matchesGlobs('src/A.sol', [])).toBe(true);
  });

  it('khớp glob có wildcard sâu', () => {
    expect(matchesGlobs('src/deep/A.sol', ['src/**/*.sol'])).toBe(true);
    expect(matchesGlobs('test/A.sol', ['src/**/*.sol'])).toBe(false);
  });

  it('* không vượt qua dấu gạch chéo', () => {
    expect(matchesGlobs('src/deep/A.sol', ['src/*.sol'])).toBe(false);
    expect(matchesGlobs('src/A.sol', ['src/*.sol'])).toBe(true);
  });
});

describe('parseCommits', () => {
  it('trích sha, ngày và file kèm số dòng thay đổi', () => {
    const cs = parseCommits(fixture);
    expect(cs).toHaveLength(2);
    expect(cs[0]!.sha).toBe('aaa111');
    expect(cs[0]!.authoredAt).toBe('2026-07-20T10:00:00Z');
    expect(cs[0]!.files[0]).toEqual({ path: 'src/Hooks.sol', changedLoc: 124 });
  });

  it('bỏ qua commit thiếu sha hoặc ngày', () => {
    expect(parseCommits([{ sha: 'x' }, ...fixture])).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/github-repo-activity.test.ts`
Expected: FAIL — không resolve được `src/sources/github-repo-activity.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/github-repo-activity.ts`:
```ts
import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const RawCommit = z.object({
  sha: z.string(),
  commit: z.object({ author: z.object({ date: z.string() }).partial() }).partial(),
  files: z
    .array(z.object({ filename: z.string(), additions: z.number(), deletions: z.number() }))
    .optional(),
});

export interface CommitFile {
  path: string;
  changedLoc: number;
}

export interface CommitRecord {
  sha: string;
  authoredAt: string;
  files: CommitFile[];
}

export interface RepoActivityPayload {
  repoKey: string;
  commits: CommitRecord[];
}

/** Glob tối giản: `**` vượt gạch chéo, `*` thì không. Đủ cho path scope. */
export function matchesGlobs(path: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return true;
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

export function parseCommits(raw: unknown): CommitRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CommitRecord[] = [];
  for (const item of raw) {
    const parsed = RawCommit.safeParse(item);
    if (!parsed.success) continue;
    const date = parsed.data.commit?.author?.date;
    if (!date) continue;
    out.push({
      sha: parsed.data.sha,
      authoredAt: date,
      files: (parsed.data.files ?? []).map((f) => ({
        path: f.filename,
        changedLoc: f.additions + f.deletions,
      })),
    });
  }
  return out;
}

const rateLimit = { rps: 2, burst: 5 };

/**
 * Lấy commit của các repo đã biết.
 * `listRepoKeys` được tiêm vào để test không phải chạm DB.
 */
export function makeGithubRepoActivity(
  listRepoKeys: () => Promise<string[]>,
): Collector<RepoActivityPayload> {
  return {
    id: 'github-repo-activity',
    cadence: '0 */6 * * *',
    rateLimit,
    requiresCredential: 'GITHUB_TOKEN',
    async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<RepoActivityPayload>> {
      const token = ctx.env.GITHUB_TOKEN;
      const repoKeys = await listRepoKeys();

      for (const key of repoKeys) {
        const [, owner, name] = key.split('/');
        if (!owner || !name) continue;
        const url = `https://api.github.com/repos/${owner}/${name}/commits?per_page=100`;
        const raw = await fetchJson<unknown>(url, {
          limit: rateLimit,
          headers: {
            accept: 'application/vnd.github+json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload: RepoActivityPayload = { repoKey: key, commits: parseCommits(raw) };
        yield makeObservation('github-repo-activity', url, payload);
      }
    },
  };
}
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/github-repo-activity.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): github repo activity collector"
```

---

## Task 13: Collector audit-report-repos

**Files:**
- Create: `packages/collectors/src/sources/audit-report-repos.ts`, `packages/collectors/src/sources/index.ts`, `packages/collectors/tests/__fixtures__/audit-tree.json`
- Test: `packages/collectors/tests/audit-report-repos.test.ts`

- [ ] **Step 1: Tạo fixture và test thất bại**

`packages/collectors/tests/__fixtures__/audit-tree.json`:
```json
{
  "tree": [
    { "path": "reports/2026-04-uniswap-v4.pdf", "type": "blob" },
    { "path": "reports/2026-01-orbit-lending.pdf", "type": "blob" },
    { "path": "reports/README.md", "type": "blob" },
    { "path": "reports", "type": "tree" }
  ]
}
```

`packages/collectors/tests/audit-report-repos.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/audit-tree.json' with { type: 'json' };
import { parseAuditTree } from '../src/sources/audit-report-repos.js';

describe('parseAuditTree', () => {
  it('trích tên dự án và ngày từ tên file report', () => {
    const rs = parseAuditTree(fixture, 'trailofbits', 'github.com/trailofbits/publications');
    expect(rs).toHaveLength(2);
    const u = rs.find((r) => r.projectHint === 'uniswap-v4')!;
    expect(u.firm).toBe('trailofbits');
    expect(u.publishedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('bỏ file không phải report', () => {
    const rs = parseAuditTree(fixture, 'trailofbits', 'github.com/trailofbits/publications');
    expect(rs.some((r) => r.reportUrl.endsWith('README.md'))).toBe(false);
  });

  it('bỏ mục type=tree', () => {
    const rs = parseAuditTree({ tree: [{ path: 'reports/2026-04-x.pdf', type: 'tree' }] }, 'f', 'github.com/a/b');
    expect(rs).toEqual([]);
  });

  it('bỏ file không có tiền tố ngày', () => {
    const rs = parseAuditTree({ tree: [{ path: 'reports/uniswap.pdf', type: 'blob' }] }, 'f', 'github.com/a/b');
    expect(rs).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/audit-report-repos.test.ts`
Expected: FAIL — không resolve được `src/sources/audit-report-repos.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/audit-report-repos.ts`:
```ts
import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

/** Các hãng audit công bố report dạng file trong repo GitHub công khai. */
export const AUDIT_REPO_SOURCES = [
  { firm: 'trailofbits', repoKey: 'github.com/trailofbits/publications' },
  { firm: 'openzeppelin', repoKey: 'github.com/OpenZeppelin/openzeppelin-contracts' },
  { firm: 'spearbit', repoKey: 'github.com/spearbit/portfolio' },
  { firm: 'zellic', repoKey: 'github.com/Zellic/publications' },
] as const;

const Tree = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});

export interface AuditReportPayload {
  firm: string;
  projectHint: string;
  publishedAt: string;
  reportUrl: string;
}

/** `reports/2026-04-uniswap-v4.pdf` -> ngày 2026-04-01, hint "uniswap-v4". */
const REPORT_NAME = /(\d{4})-(\d{2})(?:-(\d{2}))?-(.+)\.(pdf|md)$/i;

export function parseAuditTree(raw: unknown, firm: string, repoKey: string): AuditReportPayload[] {
  const parsed = Tree.safeParse(raw);
  if (!parsed.success) return [];
  const out: AuditReportPayload[] = [];

  for (const node of parsed.data.tree) {
    if (node.type !== 'blob') continue;
    const base = node.path.split('/').pop() ?? '';
    const m = REPORT_NAME.exec(base);
    if (!m) continue;

    const [, year, month, day, hint] = m;
    const iso = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day ?? '1'))).toISOString();
    if (!Number.isFinite(Date.parse(iso))) continue;

    out.push({
      firm,
      projectHint: hint!.toLowerCase(),
      publishedAt: iso,
      reportUrl: `https://${repoKey}/blob/HEAD/${node.path}`,
    });
  }
  return out;
}

const rateLimit = { rps: 2, burst: 5 };

export const auditReportRepos: Collector<AuditReportPayload[]> = {
  id: 'audit-report-repos',
  cadence: '0 3 * * *',
  rateLimit,
  requiresCredential: 'GITHUB_TOKEN',
  async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<AuditReportPayload[]>> {
    const token = ctx.env.GITHUB_TOKEN;
    for (const src of AUDIT_REPO_SOURCES) {
      const [, owner, name] = src.repoKey.split('/');
      const url = `https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`;
      const raw = await fetchJson<unknown>(url, {
        limit: rateLimit,
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      yield makeObservation('audit-report-repos', url, parseAuditTree(raw, src.firm, src.repoKey));
    }
  },
};
```

`packages/collectors/src/sources/index.ts`:
```ts
export { c4Contests, parseC4Contests, parsePoolUsd, type ProgramPayload } from './c4-contests.js';
export { sherlockContests, parseSherlockContests } from './sherlock-contests.js';
export { cantinaCompetitions, parseCantinaCompetitions } from './cantina-competitions.js';
export {
  makeGithubRepoActivity,
  parseCommits,
  matchesGlobs,
  type CommitRecord,
  type CommitFile,
  type RepoActivityPayload,
} from './github-repo-activity.js';
export {
  auditReportRepos,
  parseAuditTree,
  AUDIT_REPO_SOURCES,
  type AuditReportPayload,
} from './audit-report-repos.js';
```

`packages/collectors/src/index.ts`:
```ts
export * from './types.js';
export * from './http.js';
export * from './sources/index.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/audit-report-repos.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): audit report repo collector and source registry"
```

---

## Task 14: Resolver tầng 1 và tầng 2

Test quan trọng nhất trong repo: **không bao giờ có false merge**.

**Files:**
- Create: `packages/pipeline/package.json`, `packages/pipeline/tsconfig.json`, `packages/pipeline/src/resolver.ts`, `config/aliases.yml`
- Test: `packages/pipeline/tests/resolver.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/pipeline/tests/resolver.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseAliases, resolveEntityKey } from '../src/resolver.js';

const aliases = parseAliases(`
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - platformName: { platform: immunefi, name: "Uniswap v4" }
orbit-lending:
  canonicalName: Orbit Lending
  match:
    - repo: github.com/orbit-fi/lending
`);

describe('resolveEntityKey — tầng 1 khoá cứng', () => {
  it('khớp bằng repo key chuẩn hoá', () => {
    const r = resolveEntityKey({ repoUrl: 'https://github.com/Uniswap/v4-core.git' }, aliases);
    expect(r).toEqual({ slug: 'uniswap-v4', canonicalName: 'Uniswap v4', tier: 1 });
  });

  it('khớp bằng cặp platform + tên chính xác', () => {
    const r = resolveEntityKey({ platform: 'immunefi', title: 'Uniswap v4' }, aliases);
    expect(r?.slug).toBe('uniswap-v4');
    expect(r?.tier).toBe(2);
  });
});

describe('resolveEntityKey — không bao giờ merge nhầm', () => {
  it('repo khác nhau không gộp', () => {
    expect(resolveEntityKey({ repoUrl: 'https://github.com/uniswap/v4-periphery' }, aliases)).toBeNull();
  });

  it('tên gần giống KHÔNG được tự khớp', () => {
    expect(resolveEntityKey({ platform: 'immunefi', title: 'Uniswap v3' }, aliases)).toBeNull();
    expect(resolveEntityKey({ platform: 'immunefi', title: 'Uniswap  v4' }, aliases)).toBeNull();
  });

  it('cùng tên nhưng khác platform không khớp', () => {
    expect(resolveEntityKey({ platform: 'code4rena', title: 'Uniswap v4' }, aliases)).toBeNull();
  });

  it('không có tín hiệu nào thì trả null chứ không đoán', () => {
    expect(resolveEntityKey({}, aliases)).toBeNull();
    expect(resolveEntityKey({ repoUrl: 'not a url' }, aliases)).toBeNull();
  });
});
```

- [ ] **Step 2: Tạo package rồi chạy test để xác nhận fail**

`packages/pipeline/package.json`:
```json
{
  "name": "@kritt-radar/pipeline",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@kritt-radar/collectors": "workspace:*",
    "@kritt-radar/core": "workspace:*",
    "@kritt-radar/db": "workspace:*",
    "yaml": "^2.6.1",
    "zod": "^3.24.1"
  }
}
```

`packages/pipeline/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Run: `pnpm install`
Run: `pnpm vitest run packages/pipeline/tests/resolver.test.ts`
Expected: FAIL — không resolve được `src/resolver.js`

- [ ] **Step 3: Cài đặt**

`packages/pipeline/src/resolver.ts`:
```ts
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';

const MatchRule = z.union([
  z.object({ repo: z.string() }),
  z.object({ platformName: z.object({ platform: z.string(), name: z.string() }) }),
]);

const AliasEntry = z.object({
  canonicalName: z.string().min(1),
  match: z.array(MatchRule).min(1),
});

const AliasFile = z.record(z.string(), AliasEntry);

export type AliasTable = {
  byRepoKey: Map<string, { slug: string; canonicalName: string }>;
  byPlatformName: Map<string, { slug: string; canonicalName: string }>;
};

function platformNameKey(platform: string, name: string): string {
  return `${platform.trim().toLowerCase()} ${name.trim()}`;
}

export function parseAliases(yamlText: string): AliasTable {
  const parsed = AliasFile.parse(parseYaml(yamlText) ?? {});
  const byRepoKey = new Map<string, { slug: string; canonicalName: string }>();
  const byPlatformName = new Map<string, { slug: string; canonicalName: string }>();

  for (const [slug, entry] of Object.entries(parsed)) {
    const target = { slug, canonicalName: entry.canonicalName };
    for (const rule of entry.match) {
      if ('repo' in rule) {
        const key = normalizeRepoUrl(rule.repo);
        if (key) byRepoKey.set(key, target);
      } else {
        byPlatformName.set(platformNameKey(rule.platformName.platform, rule.platformName.name), target);
      }
    }
  }
  return { byRepoKey, byPlatformName };
}

export interface ResolveInput {
  repoUrl?: string | undefined;
  platform?: string | undefined;
  title?: string | undefined;
}

export interface ResolvedEntity {
  slug: string;
  canonicalName: string;
  /** 1 = khoá cứng (repo/address), 2 = alias khai tay. Không có tầng 3 ở pha này. */
  tier: 1 | 2;
}

/**
 * Chỉ khớp CHÍNH XÁC. Không fuzzy, không so gần đúng.
 *
 * Merge sai không ném exception — nó chỉ trộn tín hiệu của hai dự án khác nhau
 * và làm bảng xếp hạng sai âm thầm suốt nhiều tuần. Thà trả null rồi để một
 * dòng trong aliases.yml sửa, còn hơn đoán.
 */
export function resolveEntityKey(input: ResolveInput, aliases: AliasTable): ResolvedEntity | null {
  if (input.repoUrl) {
    const key = normalizeRepoUrl(input.repoUrl);
    if (key) {
      const hit = aliases.byRepoKey.get(key);
      if (hit) return { ...hit, tier: 1 };
    }
  }

  if (input.platform && input.title) {
    const hit = aliases.byPlatformName.get(platformNameKey(input.platform, input.title));
    if (hit) return { ...hit, tier: 2 };
  }

  return null;
}
```

`config/aliases.yml`:
```yaml
# Tầng 2 của entity resolution — khai tay.
# Số protocol đáng quan tâm chỉ vài trăm, và một dòng ở đây chính xác hơn mọi
# thuật toán fuzzy. Thêm entry mỗi khi thấy hai nguồn nói về cùng một dự án mà
# không chung repo key.
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/pipeline/tests/resolver.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): exact-match entity resolver with alias table"
```

---

## Task 15: Signal extractor freshness

**Files:**
- Create: `packages/pipeline/src/extractors/freshness.ts`
- Test: `packages/pipeline/tests/freshness.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/pipeline/tests/freshness.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { extractFreshness } from '../src/extractors/freshness.js';

const NOW = new Date('2026-08-03T00:00:00Z');

describe('extractFreshness', () => {
  it('mới publish thì gần 1', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-08-03T00:00:00Z') }, NOW);
    expect(s.value).toBeCloseTo(1, 3);
    expect(s.confidence).toBe(1);
  });

  it('sau đúng một chu kỳ bán rã 72h thì bằng exp(-1)', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-07-31T00:00:00Z') }, NOW);
    expect(s.value).toBeCloseTo(Math.exp(-1), 3);
  });

  it('giảm đơn điệu theo tuổi', () => {
    const a = extractFreshness({ publishedAt: new Date('2026-08-02T00:00:00Z') }, NOW).value;
    const b = extractFreshness({ publishedAt: new Date('2026-07-25T00:00:00Z') }, NOW).value;
    expect(a).toBeGreaterThan(b);
  });

  it('BẤT BIẾN: không có ngày thì confidence 0, KHÔNG phải value 0', () => {
    const s = extractFreshness({}, NOW);
    expect(s.confidence).toBe(0);
    expect(s.evidence.reason).toBe('no_date');
  });

  it('lấy mốc mới hơn giữa publishedAt và scopeChangedAt', () => {
    const s = extractFreshness(
      { publishedAt: new Date('2026-06-01T00:00:00Z'), scopeChangedAt: new Date('2026-08-02T00:00:00Z') },
      NOW,
    );
    expect(s.value).toBeGreaterThan(0.6);
    expect(s.evidence.basis).toBe('scope_changed');
  });

  it('ngày trong tương lai vẫn kẹp ở 1', () => {
    const s = extractFreshness({ publishedAt: new Date('2026-09-01T00:00:00Z') }, NOW);
    expect(s.value).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/pipeline/tests/freshness.test.ts`
Expected: FAIL — không resolve được `src/extractors/freshness.js`

- [ ] **Step 3: Cài đặt**

`packages/pipeline/src/extractors/freshness.ts`:
```ts
import { clamp01, type SignalValue } from '@kritt-radar/core';

const HALF_LIFE_HOURS = 72;

export interface FreshnessInput {
  publishedAt?: Date | undefined;
  /** Thời điểm contentHash của scope đổi — dấu hiệu scope vừa được mở rộng. */
  scopeChangedAt?: Date | undefined;
}

/**
 * Phân rã mũ theo tuổi, chu kỳ 72h.
 * Lợi thế thời gian tan rất nhanh, nên hàm tuyến tính sẽ đánh giá quá cao một
 * program đã mở được hai tuần.
 */
export function extractFreshness(input: FreshnessInput, now: Date): SignalValue {
  const candidates: Array<{ at: Date; basis: string }> = [];
  if (input.publishedAt) candidates.push({ at: input.publishedAt, basis: 'published' });
  if (input.scopeChangedAt) candidates.push({ at: input.scopeChangedAt, basis: 'scope_changed' });

  if (candidates.length === 0) {
    return { type: 'freshness', value: 0, confidence: 0, evidence: { reason: 'no_date' } };
  }

  const newest = candidates.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
  const ageHours = (now.getTime() - newest.at.getTime()) / 3_600_000;
  const value = ageHours <= 0 ? 1 : clamp01(Math.exp(-ageHours / HALF_LIFE_HOURS));

  return {
    type: 'freshness',
    value,
    confidence: 1,
    evidence: { basis: newest.basis, at: newest.at.toISOString(), ageHours: Math.round(ageHours) },
  };
}
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/pipeline/tests/freshness.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): freshness signal extractor"
```

---

## Task 16: Signal extractor audit_gap

Tín hiệu quan trọng nhất — cũng là thứ sinh ra danh sách file để dán vào scope Open-Kritt.

**Files:**
- Create: `packages/pipeline/src/extractors/audit-gap.ts`
- Test: `packages/pipeline/tests/audit-gap.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/pipeline/tests/audit-gap.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { extractAuditGap } from '../src/extractors/audit-gap.js';
import type { CommitRecord } from '@kritt-radar/collectors';

const commits: CommitRecord[] = [
  {
    sha: 'new1',
    authoredAt: '2026-07-20T00:00:00Z',
    files: [{ path: 'src/Hooks.sol', changedLoc: 120 }, { path: 'docs/x.md', changedLoc: 10 }],
  },
  { sha: 'new2', authoredAt: '2026-07-01T00:00:00Z', files: [{ path: 'src/Pool.sol', changedLoc: 40 }] },
  { sha: 'old1', authoredAt: '2026-01-10T00:00:00Z', files: [{ path: 'src/Old.sol', changedLoc: 900 }] },
];

const lastAudit = new Date('2026-06-01T00:00:00Z');

describe('extractAuditGap', () => {
  it('chỉ tính commit sau ngày audit gần nhất', () => {
    const s = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: ['src/**/*.sol'], totalLoc: 5000 });
    const shas = (s.evidence.commits as string[]);
    expect(shas).toEqual(['new1', 'new2']);
    expect(shas).not.toContain('old1');
  });

  it('lọc file theo pathGlobs', () => {
    const s = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: ['src/**/*.sol'], totalLoc: 5000 });
    expect(s.evidence.files).toEqual(['src/Hooks.sol', 'src/Pool.sol']);
  });

  it('churn lớn cho value cao hơn', () => {
    const small = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: [], totalLoc: 100000 }).value;
    const big = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: [], totalLoc: 500 }).value;
    expect(big).toBeGreaterThan(small);
  });

  it('chưa từng có audit công khai thì value = 1', () => {
    const s = extractAuditGap({ commits, lastAuditAt: null, pathGlobs: [], totalLoc: 5000 });
    expect(s.value).toBe(1);
    expect(s.evidence.reason).toBe('no_public_audit');
    expect(s.confidence).toBe(1);
  });

  it('không có commit nào sau audit thì value = 0 với confidence đầy đủ', () => {
    const s = extractAuditGap({
      commits: [commits[2]!],
      lastAuditAt: lastAudit,
      pathGlobs: [],
      totalLoc: 5000,
    });
    expect(s.value).toBe(0);
    expect(s.confidence).toBe(1);
  });

  it('BẤT BIẾN: không có dữ liệu commit thì confidence 0', () => {
    const s = extractAuditGap({ commits: [], lastAuditAt: lastAudit, pathGlobs: [], totalLoc: 5000, hasCommitData: false });
    expect(s.confidence).toBe(0);
    expect(s.evidence.reason).toBe('no_commit_data');
  });

  it('value luôn nằm trong [0,1] kể cả khi churn vượt totalLoc', () => {
    const s = extractAuditGap({ commits, lastAuditAt: lastAudit, pathGlobs: [], totalLoc: 1 });
    expect(s.value).toBeLessThanOrEqual(1);
    expect(s.value).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/pipeline/tests/audit-gap.test.ts`
Expected: FAIL — không resolve được `src/extractors/audit-gap.js`

- [ ] **Step 3: Cài đặt**

`packages/pipeline/src/extractors/audit-gap.ts`:
```ts
import { clamp01, type SignalValue } from '@kritt-radar/core';
import { matchesGlobs, type CommitRecord } from '@kritt-radar/collectors';

export interface AuditGapInput {
  commits: readonly CommitRecord[];
  /** null nghĩa là chưa tìm thấy audit công khai nào. */
  lastAuditAt: Date | null;
  pathGlobs: readonly string[];
  totalLoc: number;
  /** false nghĩa là chưa crawl được commit, khác hẳn "crawl rồi và không có commit nào". */
  hasCommitData?: boolean;
}

/**
 * Bao nhiêu phần của scope đã đổi kể từ lần audit công khai gần nhất.
 *
 * Dùng tỉ lệ log để một repo khổng lồ đổi 200 dòng không bị chấm ngang một repo
 * nhỏ bị viết lại toàn bộ. `evidence.files` chính là danh sách dán thẳng vào
 * scope của một scan Open-Kritt.
 */
export function extractAuditGap(input: AuditGapInput): SignalValue {
  const hasCommitData = input.hasCommitData ?? input.commits.length > 0;

  if (!hasCommitData) {
    return { type: 'audit_gap', value: 0, confidence: 0, evidence: { reason: 'no_commit_data' } };
  }

  if (input.lastAuditAt === null) {
    return {
      type: 'audit_gap',
      value: 1,
      confidence: 1,
      evidence: {
        reason: 'no_public_audit',
        files: collectFiles(input.commits, input.pathGlobs),
        commits: input.commits.map((c) => c.sha),
      },
    };
  }

  const cutoff = input.lastAuditAt.getTime();
  const newer = input.commits.filter((c) => {
    const t = Date.parse(c.authoredAt);
    return Number.isFinite(t) && t > cutoff;
  });

  let changedLoc = 0;
  const files = new Set<string>();
  for (const c of newer) {
    for (const f of c.files) {
      if (!matchesGlobs(f.path, input.pathGlobs)) continue;
      files.add(f.path);
      changedLoc += f.changedLoc;
    }
  }

  const denom = Math.log1p(Math.max(input.totalLoc, 1));
  const value = denom > 0 ? clamp01(Math.log1p(changedLoc) / denom) : 0;

  return {
    type: 'audit_gap',
    value,
    confidence: 1,
    evidence: {
      sinceDate: input.lastAuditAt.toISOString(),
      changedLoc,
      totalLoc: input.totalLoc,
      files: [...files],
      commits: newer.map((c) => c.sha),
    },
  };
}

function collectFiles(commits: readonly CommitRecord[], globs: readonly string[]): string[] {
  const s = new Set<string>();
  for (const c of commits) for (const f of c.files) if (matchesGlobs(f.path, globs)) s.add(f.path);
  return [...s];
}
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/pipeline/tests/audit-gap.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): audit gap signal extractor"
```

---

## Task 17: Harness chạy collector với circuit breaker

**Files:**
- Create: `packages/collectors/src/harness.ts`
- Test: `packages/collectors/tests/harness.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/collectors/tests/harness.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runCollector } from '../src/harness.js';
import { makeObservation, type Collector } from '../src/types.js';

const ok: Collector<{ n: number }> = {
  id: 'ok',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    yield makeObservation('ok', 'https://x/1', { n: 1 });
    yield makeObservation('ok', 'https://x/2', { n: 2 });
  },
};

const boom: Collector = {
  id: 'boom',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    throw new Error('upstream down');
  },
};

const needsKey: Collector = {
  id: 'needs-key',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  requiresCredential: 'SOME_TOKEN',
  async *fetch() {
    yield makeObservation('needs-key', 'https://x/1', {});
  },
};

describe('runCollector', () => {
  it('gom observation và báo ok', async () => {
    const saved: unknown[] = [];
    const r = await runCollector(ok, { env: {}, save: async (o) => { saved.push(...o); return o.length; } });
    expect(r.status).toBe('ok');
    expect(r.itemCount).toBe(2);
    expect(saved).toHaveLength(2);
  });

  it('bắt lỗi thay vì ném ra ngoài, để collector khác vẫn chạy', async () => {
    const r = await runCollector(boom, { env: {}, save: async () => 0 });
    expect(r.status).toBe('error');
    expect(r.error).toContain('upstream down');
    expect(r.itemCount).toBe(0);
  });

  it('bỏ qua collector thiếu credential và coi là skipped, không phải error', async () => {
    const r = await runCollector(needsKey, { env: {}, save: async () => 0 });
    expect(r.status).toBe('skipped');
    expect(r.error).toContain('SOME_TOKEN');
  });

  it('chạy khi credential có mặt', async () => {
    const r = await runCollector(needsKey, { env: { SOME_TOKEN: 'x' }, save: async (o) => o.length });
    expect(r.status).toBe('ok');
    expect(r.itemCount).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/harness.test.ts`
Expected: FAIL — không resolve được `src/harness.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/harness.ts`:
```ts
import type { Collector, RawObservation } from './types.js';

export interface HarnessDeps {
  env: Record<string, string | undefined>;
  save: (items: RawObservation[]) => Promise<number>;
  now?: () => Date;
}

export interface CollectorRunResult {
  collectorId: string;
  status: 'ok' | 'error' | 'skipped';
  itemCount: number;
  error?: string;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Chạy một collector và luôn TRẢ VỀ kết quả, không bao giờ ném.
 * Một nguồn hỏng không được phép làm chết cả lượt thu thập — nếu ném, collector
 * đứng sau nó trong danh sách sẽ không bao giờ chạy.
 */
export async function runCollector(
  collector: Collector,
  deps: HarnessDeps,
): Promise<CollectorRunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const base = { collectorId: collector.id, startedAt };

  if (collector.requiresCredential && !deps.env[collector.requiresCredential]) {
    return {
      ...base,
      status: 'skipped',
      itemCount: 0,
      error: `missing credential ${collector.requiresCredential}`,
      finishedAt: now(),
    };
  }

  const buffer: RawObservation[] = [];
  try {
    for await (const obs of collector.fetch({ env: deps.env, now })) {
      buffer.push(obs);
    }
    const saved = await deps.save(buffer);
    return { ...base, status: 'ok', itemCount: saved, finishedAt: now() };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      itemCount: 0,
      error: err instanceof Error ? err.message : String(err),
      finishedAt: now(),
    };
  }
}
```

Sửa `packages/collectors/src/index.ts`, thêm dòng:
```ts
export * from './harness.js';
```

- [ ] **Step 4: Chạy lại test**

Run: `pnpm vitest run packages/collectors/tests/harness.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): fault-isolating collector harness"
```

---

## Task 18: CLI `collect` và `rank`

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/cli.ts`, `packages/pipeline/src/run.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/tests/run.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/pipeline/tests/run.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rankScopes } from '../src/run.js';
import type { Weights } from '@kritt-radar/core';

const W: Weights = {
  version: 'v1-equal',
  minConfidence: 0.3,
  weights: { audit_gap: 1, freshness: 1, competition: 1, value_at_risk: 1 },
};

describe('rankScopes', () => {
  it('xếp giảm dần theo điểm', () => {
    const out = rankScopes(
      [
        { scopeId: 'a', title: 'A', signals: [{ type: 'audit_gap', value: 0.2, confidence: 1, evidence: {} }] },
        { scopeId: 'b', title: 'B', signals: [{ type: 'audit_gap', value: 0.9, confidence: 1, evidence: {} }] },
      ],
      W,
    );
    expect(out.map((r) => r.scopeId)).toEqual(['b', 'a']);
  });

  it('giữ breakdown để giải thích được điểm', () => {
    const out = rankScopes(
      [{ scopeId: 'a', title: 'A', signals: [{ type: 'freshness', value: 0.5, confidence: 1, evidence: {} }] }],
      W,
    );
    expect(out[0]!.score.breakdown[0]!.type).toBe('freshness');
    expect(out[0]!.score.weightsVersion).toBe('v1-equal');
  });

  it('scope không có tín hiệu dùng được vẫn xuất hiện với điểm 0', () => {
    const out = rankScopes([{ scopeId: 'a', title: 'A', signals: [] }], W);
    expect(out).toHaveLength(1);
    expect(out[0]!.score.total).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/pipeline/tests/run.test.ts`
Expected: FAIL — không resolve được `src/run.js`

- [ ] **Step 3: Cài đặt**

`packages/pipeline/src/run.ts`:
```ts
import { score, type ScoreResult, type SignalValue, type Weights } from '@kritt-radar/core';

export interface ScopeSignals {
  scopeId: string;
  title: string;
  signals: readonly SignalValue[];
}

export interface RankedScope {
  scopeId: string;
  title: string;
  score: ScoreResult;
}

/** Chấm điểm và xếp hạng. Thuần — không I/O, nên replay được trên dữ liệu cũ. */
export function rankScopes(scopes: readonly ScopeSignals[], weights: Weights): RankedScope[] {
  return scopes
    .map((s) => ({ scopeId: s.scopeId, title: s.title, score: score(s.signals, weights) }))
    .sort((a, b) => b.score.total - a.score.total);
}
```

`packages/pipeline/src/index.ts`:
```ts
export * from './resolver.js';
export * from './run.js';
export * from './extractors/freshness.js';
export * from './extractors/audit-gap.js';
```

`apps/worker/package.json`:
```json
{
  "name": "@kritt-radar/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@kritt-radar/collectors": "workspace:*",
    "@kritt-radar/core": "workspace:*",
    "@kritt-radar/db": "workspace:*",
    "@kritt-radar/pipeline": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.19.2" }
}
```

`apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`apps/worker/src/cli.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWeights, type SignalValue } from '@kritt-radar/core';
import { runCollector } from '@kritt-radar/collectors';
import { c4Contests, cantinaCompetitions, sherlockContests } from '@kritt-radar/collectors';
import { prisma, saveObservations } from '@kritt-radar/db';
import { rankScopes, type ScopeSignals } from '@kritt-radar/pipeline';

const ROOT = resolve(import.meta.dirname, '../../..');

async function collect(): Promise<void> {
  const collectors = [c4Contests, sherlockContests, cantinaCompetitions];

  for (const c of collectors) {
    const run = await runCollector(c, {
      env: process.env,
      save: (items) => saveObservations(items),
    });
    await prisma.collectorRun.create({
      data: {
        collectorId: run.collectorId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        itemCount: run.itemCount,
        error: run.error ?? null,
      },
    });
    const detail = run.error ? ` (${run.error})` : '';
    console.log(`${run.collectorId.padEnd(24)} ${run.status.padEnd(8)} ${run.itemCount} new${detail}`);
  }
}

async function rank(): Promise<void> {
  const weights = parseWeights(await readFile(resolve(ROOT, 'config/weights.yml'), 'utf8'));

  const scopes = await prisma.scope.findMany({
    include: { program: true, signals: true },
  });

  const input: ScopeSignals[] = scopes.map((s) => ({
    scopeId: s.id,
    title: s.program.title,
    signals: s.signals.map(
      (sig): SignalValue => ({
        type: sig.type as SignalValue['type'],
        value: sig.value,
        confidence: sig.confidence,
        evidence: sig.evidence as Record<string, unknown>,
      }),
    ),
  }));

  const ranked = rankScopes(input, weights);

  console.log(`\n${'#'.padEnd(4)}${'SCORE'.padEnd(8)}${'TARGET'.padEnd(44)}SIGNALS`);
  for (const [i, r] of ranked.slice(0, 25).entries()) {
    const parts = r.score.breakdown
      .map((b) => `${b.type}=${b.value.toFixed(2)}`)
      .join(' ');
    const skipped = r.score.skipped.length ? ` [no data: ${r.score.skipped.join(',')}]` : '';
    console.log(
      `${String(i + 1).padEnd(4)}${r.score.total.toFixed(1).padEnd(8)}${r.title.slice(0, 42).padEnd(44)}${parts}${skipped}`,
    );
  }
  console.log(`\nweights: ${weights.version}   scopes: ${ranked.length}\n`);
}

const command = process.argv[2];

try {
  if (command === 'collect') await collect();
  else if (command === 'rank') await rank();
  else {
    console.error('usage: cli.ts <collect|rank>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
```

- [ ] **Step 4: Chạy test và kiểm tra CLI đầu-cuối**

Run: `pnpm vitest run packages/pipeline/tests/run.test.ts`
Expected: PASS — 3 passed

Run: `pnpm install`
Run: `docker compose up -d postgres`
Run: `pnpm collect`
Expected: ba dòng dạng `c4-contests              ok       N new`. Nếu một nguồn đổi API thì dòng đó là `error` kèm lý do — đúng thiết kế, các dòng còn lại vẫn chạy.

Run: `pnpm rank`
Expected: in bảng có header `#  SCORE  TARGET  SIGNALS`. Lúc này chưa có Scope nào nên bảng rỗng và dòng cuối ghi `scopes: 0` — đúng, vì việc chuyển Observation thành Program/Scope là Task 19.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(worker): collect and rank cli commands"
```

---

## Task 19: Chuyển Observation thành Program và Scope

Bước cuối nối dữ liệu thô vào bảng xếp hạng.

**Files:**
- Create: `packages/pipeline/src/materialize.ts`
- Modify: `packages/pipeline/src/index.ts`, `apps/worker/src/cli.ts`
- Test: `packages/pipeline/tests/materialize.test.ts`

- [ ] **Step 1: Viết test thất bại**

`packages/pipeline/tests/materialize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toProgramRecords, latestBySourceUrl } from '../src/materialize.js';

const obs = [
  {
    collectorId: 'c4-contests',
    sourceUrl: 'https://code4rena.com/contests/412',
    fetchedAt: new Date('2026-08-01T00:00:00Z'),
    payload: {
      platform: 'code4rena', externalId: '412', title: 'Acme Vault',
      url: 'https://code4rena.com/contests/412', poolUsd: 100000, kind: 'contest',
      publishedAt: '2026-07-28T14:00:00Z', startsAt: '2026-07-28T14:00:00Z',
      endsAt: '2026-08-04T14:00:00Z', repoUrl: 'github.com/code-423n4/2026-07-acme', sponsor: 'Acme',
    },
  },
  {
    collectorId: 'c4-contests',
    sourceUrl: 'https://code4rena.com/contests/412',
    fetchedAt: new Date('2026-08-03T00:00:00Z'),
    payload: {
      platform: 'code4rena', externalId: '412', title: 'Acme Vault v2',
      url: 'https://code4rena.com/contests/412', poolUsd: 150000, kind: 'contest',
      publishedAt: '2026-07-28T14:00:00Z', startsAt: '2026-07-28T14:00:00Z',
      endsAt: '2026-08-04T14:00:00Z', repoUrl: 'github.com/code-423n4/2026-07-acme', sponsor: 'Acme',
    },
  },
];

describe('latestBySourceUrl', () => {
  it('giữ bản fetch mới nhất cho mỗi sourceUrl', () => {
    const out = latestBySourceUrl(obs);
    expect(out).toHaveLength(1);
    expect((out[0]!.payload as { title: string }).title).toBe('Acme Vault v2');
  });

  it('ghi lại thời điểm nội dung đổi lần gần nhất', () => {
    expect(latestBySourceUrl(obs)[0]!.changedAt).toEqual(new Date('2026-08-03T00:00:00Z'));
  });
});

describe('toProgramRecords', () => {
  it('sinh program kèm một scope repo có hardKey', () => {
    const rs = toProgramRecords(latestBySourceUrl(obs));
    expect(rs).toHaveLength(1);
    expect(rs[0]!.program.platform).toBe('code4rena');
    expect(rs[0]!.program.externalId).toBe('412');
    expect(rs[0]!.scope.hardKey).toBe('github.com/code-423n4/2026-07-acme');
    expect(rs[0]!.scope.kind).toBe('repo');
  });

  it('bỏ payload không có repoUrl vì không chấm audit_gap được', () => {
    const rs = toProgramRecords([
      { sourceUrl: 'u', changedAt: new Date(), payload: { platform: 'p', externalId: '1', title: 't', url: 'u', poolUsd: null, kind: 'contest', publishedAt: null, startsAt: null, endsAt: null, repoUrl: null, sponsor: null } },
    ]);
    expect(rs).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/pipeline/tests/materialize.test.ts`
Expected: FAIL — không resolve được `src/materialize.js`

- [ ] **Step 3: Cài đặt**

`packages/pipeline/src/materialize.ts`:
```ts
import type { ProgramPayload } from '@kritt-radar/collectors';

export interface ObservationRow {
  sourceUrl: string;
  fetchedAt: Date;
  payload: unknown;
}

export interface LatestObservation {
  sourceUrl: string;
  /** Lần gần nhất NỘI DUNG đổi, không phải lần fetch gần nhất. */
  changedAt: Date;
  payload: unknown;
}

/**
 * Observation là append-only và chỉ ghi thêm khi contentHash đổi, nên bản mới
 * nhất của một sourceUrl vừa là trạng thái hiện tại, vừa cho biết nội dung đổi
 * lần cuối khi nào — đó chính là tín hiệu "scope vừa mở rộng".
 */
export function latestBySourceUrl(rows: readonly ObservationRow[]): LatestObservation[] {
  const best = new Map<string, ObservationRow>();
  for (const r of rows) {
    const cur = best.get(r.sourceUrl);
    if (!cur || r.fetchedAt.getTime() > cur.fetchedAt.getTime()) best.set(r.sourceUrl, r);
  }
  return [...best.values()].map((r) => ({
    sourceUrl: r.sourceUrl,
    changedAt: r.fetchedAt,
    payload: r.payload,
  }));
}

export interface ProgramRecord {
  program: {
    platform: string;
    externalId: string;
    title: string;
    url: string;
    poolUsd: number | null;
    kind: string;
    publishedAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  scope: {
    kind: 'repo';
    hardKey: string;
    repoUrl: string;
    pathGlobs: string[];
  };
  changedAt: Date;
}

function toDate(v: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function isProgramPayload(v: unknown): v is ProgramPayload {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as ProgramPayload).platform === 'string' &&
    typeof (v as ProgramPayload).externalId === 'string'
  );
}

/** Bỏ program không có repo: không có code thì không tính được audit_gap. */
export function toProgramRecords(rows: readonly LatestObservation[]): ProgramRecord[] {
  const out: ProgramRecord[] = [];
  for (const row of rows) {
    if (!isProgramPayload(row.payload)) continue;
    const p = row.payload;
    if (!p.repoUrl) continue;

    out.push({
      program: {
        platform: p.platform,
        externalId: p.externalId,
        title: p.title,
        url: p.url,
        poolUsd: p.poolUsd,
        kind: p.kind,
        publishedAt: toDate(p.publishedAt),
        startsAt: toDate(p.startsAt),
        endsAt: toDate(p.endsAt),
      },
      scope: { kind: 'repo', hardKey: p.repoUrl, repoUrl: p.repoUrl, pathGlobs: [] },
      changedAt: row.changedAt,
    });
  }
  return out;
}
```

Sửa `packages/pipeline/src/index.ts`, thêm dòng:
```ts
export * from './materialize.js';
```

Thêm vào `apps/worker/src/cli.ts` — chèn hàm này trước dòng `const command = process.argv[2];`:
```ts
async function materialize(): Promise<void> {
  const { latestBySourceUrl, toProgramRecords, extractFreshness } = await import('@kritt-radar/pipeline');

  const rows = await prisma.observation.findMany({
    where: { collectorId: { in: ['c4-contests', 'sherlock-contests', 'cantina-competitions'] } },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });

  const records = toProgramRecords(latestBySourceUrl(rows));
  const now = new Date();

  for (const r of records) {
    const program = await prisma.program.upsert({
      where: { platform_externalId: { platform: r.program.platform, externalId: r.program.externalId } },
      create: r.program,
      update: r.program,
    });

    const existing = await prisma.scope.findFirst({
      where: { programId: program.id, hardKey: r.scope.hardKey },
    });
    const scope = existing ?? (await prisma.scope.create({ data: { ...r.scope, programId: program.id } }));

    const freshness = extractFreshness(
      { publishedAt: r.program.publishedAt ?? undefined, scopeChangedAt: r.changedAt },
      now,
    );

    await prisma.signal.upsert({
      where: { scopeId_type: { scopeId: scope.id, type: freshness.type } },
      create: {
        scopeId: scope.id,
        type: freshness.type,
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as never,
        observationIds: [],
      },
      update: {
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as never,
        computedAt: now,
      },
    });
  }

  console.log(`materialized ${records.length} programs`);
}
```

Sửa khối dispatch ở cuối `apps/worker/src/cli.ts` thành:
```ts
try {
  if (command === 'collect') await collect();
  else if (command === 'materialize') await materialize();
  else if (command === 'rank') await rank();
  else {
    console.error('usage: cli.ts <collect|materialize|rank>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
```

Thêm script vào `package.json` gốc:
```json
"materialize": "pnpm --filter @kritt-radar/worker exec tsx src/cli.ts materialize"
```

- [ ] **Step 4: Chạy toàn bộ pipeline đầu-cuối**

Run: `pnpm vitest run packages/pipeline/tests/materialize.test.ts`
Expected: PASS — 4 passed

Run: `pnpm test`
Expected: PASS — toàn bộ suite xanh

Run: `pnpm collect`
Run: `pnpm materialize`
Expected: `materialized N programs` với N > 0

Run: `pnpm rank`
Expected: bảng xếp hạng có ít nhất một dòng, cột SIGNALS hiện `freshness=0.xx`, và các target chưa có dữ liệu commit hiện `[no data: ...]` thay vì bị tính điểm 0

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): materialize observations into programs, scopes and signals"
```

---

## Task 20: Collector immunefi-programs và scope nhiều asset

Immunefi không có API công khai và trang explore có Cloudflare. Dùng mirror cộng đồng cập nhật bằng bot — nó giàu hơn trang live vì có `addedAt` theo từng asset.

Task này cũng sửa `toProgramRecords` trả **nhiều** scope cho một program, vì một program Immunefi có tới hàng chục repo trong scope.

**Files:**
- Create: `packages/collectors/src/sources/immunefi-programs.ts`, `packages/collectors/tests/__fixtures__/immunefi-projects.json`
- Modify: `packages/collectors/src/sources/index.ts`, `packages/pipeline/src/materialize.ts`, `packages/pipeline/tests/materialize.test.ts`, `apps/worker/src/cli.ts`
- Test: `packages/collectors/tests/immunefi-programs.test.ts`

- [ ] **Step 1: Tạo fixture theo đúng hình dạng thật**

`packages/collectors/tests/__fixtures__/immunefi-projects.json` (rút gọn từ dữ liệu thật, giữ nguyên tên trường):
```json
[
  {
    "slug": "hedera",
    "project": "Hedera",
    "maxBounty": 30000,
    "rewardsPool": 1000000,
    "launchDate": "2025-02-05T04:21:00.000Z",
    "updatedDate": "2026-08-03T04:00:00.000Z",
    "inviteOnly": false,
    "assets": [
      {
        "id": "1FSwpz3sYWqsBHdQogooWw",
        "url": "https://github.com/hiero-ledger/hiero-consensus-node",
        "type": "blockchain_dlt",
        "addedAt": "2025-01-31T10:53:46.365Z"
      },
      {
        "id": "9xYzAbCdEfGhIjKlMnOpQr",
        "url": "https://hedera.com/dashboard",
        "type": "websites_and_applications",
        "addedAt": "2026-07-30T00:00:00.000Z"
      }
    ]
  },
  {
    "slug": "private-one",
    "project": "Private One",
    "maxBounty": 50000,
    "launchDate": "2026-01-01T00:00:00.000Z",
    "inviteOnly": true,
    "assets": [
      { "id": "z1", "url": "https://github.com/private/repo", "type": "blockchain_dlt", "addedAt": "2026-01-01T00:00:00.000Z" }
    ]
  }
]
```

`packages/collectors/tests/immunefi-programs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/immunefi-projects.json' with { type: 'json' };
import { parseImmunefiProjects } from '../src/sources/immunefi-programs.js';

describe('parseImmunefiProjects', () => {
  it('chuẩn hoá program công khai', () => {
    const out = parseImmunefiProjects(fixture);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload;
    expect(p.platform).toBe('immunefi');
    expect(p.externalId).toBe('hedera');
    expect(p.title).toBe('Hedera');
    expect(p.url).toBe('https://immunefi.com/bounty/hedera/');
  });

  it('dùng rewardsPool làm poolUsd, không dùng maxBounty', () => {
    expect(parseImmunefiProjects(fixture)[0]!.payload.poolUsd).toBe(1000000);
  });

  it('chỉ giữ asset là repo git, bỏ website', () => {
    const assets = parseImmunefiProjects(fixture)[0]!.payload.assets;
    expect(assets).toHaveLength(1);
    expect(assets[0]!.repoKey).toBe('github.com/hiero-ledger/hiero-consensus-node');
  });

  it('giữ addedAt theo từng asset — đây là thứ trang HTML không có', () => {
    expect(parseImmunefiProjects(fixture)[0]!.payload.assets[0]!.addedAt)
      .toBe('2025-01-31T10:53:46.365Z');
  });

  it('bỏ program inviteOnly vì không nộp được', () => {
    expect(parseImmunefiProjects(fixture).some((o) => o.payload.externalId === 'private-one')).toBe(false);
  });

  it('bỏ program không còn asset repo nào sau khi lọc', () => {
    const out = parseImmunefiProjects([
      { slug: 'weburl-only', project: 'W', launchDate: '2026-01-01T00:00:00.000Z', inviteOnly: false,
        assets: [{ id: 'a', url: 'https://x.com', type: 'websites_and_applications', addedAt: '2026-01-01T00:00:00.000Z' }] },
    ]);
    expect(out).toEqual([]);
  });

  it('trả mảng rỗng khi payload không phải mảng', () => {
    expect(parseImmunefiProjects({ nope: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/collectors/tests/immunefi-programs.test.ts`
Expected: FAIL — không resolve được `src/sources/immunefi-programs.js`

- [ ] **Step 3: Cài đặt**

`packages/collectors/src/sources/immunefi-programs.ts`:
```ts
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

const MIRROR_REPO = 'infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial';
const PROJECTS_URL = `https://raw.githubusercontent.com/${MIRROR_REPO}/main/projects.json`;
const COMMITS_URL = `https://api.github.com/repos/${MIRROR_REPO}/commits?per_page=1`;

const MAX_MIRROR_AGE_MS = 7 * 24 * 3_600_000;

const RawAsset = z.object({
  id: z.string(),
  url: z.string(),
  type: z.string().optional(),
  addedAt: z.string().optional(),
});

const RawProject = z.object({
  slug: z.string(),
  project: z.string(),
  maxBounty: z.number().nullish(),
  rewardsPool: z.number().nullish(),
  launchDate: z.string().nullish(),
  updatedDate: z.string().nullish(),
  inviteOnly: z.boolean().nullish(),
  assets: z.array(z.unknown()).optional(),
});

export interface ImmunefiAsset {
  assetId: string;
  repoKey: string;
  type: string | null;
  addedAt: string | null;
}

export interface ImmunefiProgramPayload {
  platform: 'immunefi';
  externalId: string;
  title: string;
  url: string;
  poolUsd: number | null;
  maxBountyUsd: number | null;
  kind: 'bounty';
  publishedAt: string | null;
  updatedAt: string | null;
  assets: ImmunefiAsset[];
}

export function parseImmunefiProjects(raw: unknown): RawObservation<ImmunefiProgramPayload>[] {
  if (!Array.isArray(raw)) return [];
  const out: RawObservation<ImmunefiProgramPayload>[] = [];

  for (const item of raw) {
    const parsed = RawProject.safeParse(item);
    if (!parsed.success) continue;
    const p = parsed.data;

    // Program inviteOnly không nộp report được nếu chưa được mời — xếp hạng nó
    // chỉ tạo ra mục tiêu không hành động được.
    if (p.inviteOnly) continue;

    const assets: ImmunefiAsset[] = [];
    for (const a of p.assets ?? []) {
      const asset = RawAsset.safeParse(a);
      if (!asset.success) continue;
      const repoKey = normalizeRepoUrl(asset.data.url);
      if (!repoKey) continue; // bỏ website, endpoint API, địa chỉ contract
      assets.push({
        assetId: asset.data.id,
        repoKey,
        type: asset.data.type ?? null,
        addedAt: asset.data.addedAt ?? null,
      });
    }

    if (assets.length === 0) continue; // không có code thì không tính audit_gap được

    const payload: ImmunefiProgramPayload = {
      platform: 'immunefi',
      externalId: p.slug,
      title: p.project,
      url: `https://immunefi.com/bounty/${p.slug}/`,
      poolUsd: p.rewardsPool && p.rewardsPool > 0 ? p.rewardsPool : null,
      maxBountyUsd: p.maxBounty && p.maxBounty > 0 ? p.maxBounty : null,
      kind: 'bounty',
      publishedAt: p.launchDate ?? null,
      updatedAt: p.updatedDate ?? null,
      assets,
    };
    out.push(makeObservation('immunefi-programs', payload.url, payload));
  }
  return out;
}

const rateLimit = { rps: 2, burst: 4 };

/**
 * Mirror do cộng đồng duy trì, không phải nguồn chính thức.
 * Dữ liệu cũ trông y hệt dữ liệu mới, nên nếu bot ngừng chạy ta phải biết ngay —
 * ném lỗi để harness ghi status=error thay vì âm thầm phục vụ dữ liệu ôi.
 */
async function assertMirrorFresh(token: string | undefined, now: Date): Promise<void> {
  const commits = await fetchJson<Array<{ commit?: { committer?: { date?: string } } }>>(COMMITS_URL, {
    limit: rateLimit,
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const date = commits[0]?.commit?.committer?.date;
  if (!date) throw new Error('immunefi mirror: could not read last commit date');
  const age = now.getTime() - Date.parse(date);
  if (age > MAX_MIRROR_AGE_MS) {
    throw new Error(
      `immunefi mirror stale: last commit ${date} (${Math.round(age / 86_400_000)}d old)`,
    );
  }
}

export const immunefiPrograms: Collector<ImmunefiProgramPayload> = {
  id: 'immunefi-programs',
  cadence: '0 */6 * * *',
  rateLimit,
  async *fetch(ctx: FetchCtx) {
    await assertMirrorFresh(ctx.env.GITHUB_TOKEN, ctx.now());
    const raw = await fetchJson<unknown>(PROJECTS_URL, { limit: rateLimit });
    yield* parseImmunefiProjects(raw);
  },
};
```

Thêm vào `packages/collectors/src/sources/index.ts`:
```ts
export {
  immunefiPrograms,
  parseImmunefiProjects,
  type ImmunefiProgramPayload,
  type ImmunefiAsset,
} from './immunefi-programs.js';
```

- [ ] **Step 4: Chạy test rồi kiểm tra với dữ liệu thật**

Run: `pnpm vitest run packages/collectors/tests/immunefi-programs.test.ts`
Expected: PASS — 7 passed

Run: `pnpm --filter @kritt-radar/collectors exec tsx -e "import {parseImmunefiProjects} from './src/sources/immunefi-programs.js'; const r = await fetch('https://raw.githubusercontent.com/infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial/main/projects.json'); const out = parseImmunefiProjects(await r.json()); console.log('programs:', out.length, 'scopes:', out.reduce((a,o)=>a+o.payload.assets.length,0));"`
Expected: `programs:` một số trong khoảng 100–200 và `scopes:` lớn hơn hẳn. Nếu `programs: 0` thì mirror đã đổi hình dạng — sửa `RawProject` cho khớp trước khi đi tiếp.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(collectors): immunefi programs via community json mirror"
```

---

## Task 21: Materialize nhiều scope cho một program

`toProgramRecords` ở Task 19 chỉ trả một scope. Immunefi cần nhiều.

**Files:**
- Modify: `packages/pipeline/src/materialize.ts`, `packages/pipeline/tests/materialize.test.ts`, `apps/worker/src/cli.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `packages/pipeline/tests/materialize.test.ts`:
```ts
import { toImmunefiRecords } from '../src/materialize.js';

describe('toImmunefiRecords', () => {
  const row = {
    sourceUrl: 'https://immunefi.com/bounty/hedera/',
    changedAt: new Date('2026-08-03T00:00:00Z'),
    payload: {
      platform: 'immunefi', externalId: 'hedera', title: 'Hedera',
      url: 'https://immunefi.com/bounty/hedera/', poolUsd: 1000000, maxBountyUsd: 30000,
      kind: 'bounty', publishedAt: '2025-02-05T04:21:00.000Z', updatedAt: '2026-08-03T04:00:00.000Z',
      assets: [
        { assetId: 'a1', repoKey: 'github.com/hiero-ledger/hiero-consensus-node', type: 'blockchain_dlt', addedAt: '2025-01-31T10:53:46.365Z' },
        { assetId: 'a2', repoKey: 'github.com/hiero-ledger/hiero-sdk-java', type: 'blockchain_dlt', addedAt: '2026-07-30T00:00:00.000Z' },
      ],
    },
  };

  it('sinh một scope cho mỗi asset', () => {
    const rs = toImmunefiRecords([row]);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.scopes).toHaveLength(2);
    expect(rs[0]!.scopes.map((s) => s.hardKey)).toEqual([
      'github.com/hiero-ledger/hiero-consensus-node',
      'github.com/hiero-ledger/hiero-sdk-java',
    ]);
  });

  it('mỗi scope mang addedAt riêng làm mốc freshness', () => {
    const rs = toImmunefiRecords([row]);
    expect(rs[0]!.scopes[1]!.addedAt).toEqual(new Date('2026-07-30T00:00:00.000Z'));
  });

  it('asset thiếu addedAt thì scope có addedAt null, không lấy ngày hôm nay', () => {
    const rs = toImmunefiRecords([
      { ...row, payload: { ...row.payload, assets: [{ assetId: 'a', repoKey: 'github.com/a/b', type: null, addedAt: null }] } },
    ]);
    expect(rs[0]!.scopes[0]!.addedAt).toBeNull();
  });

  it('bỏ payload sai hình dạng', () => {
    expect(toImmunefiRecords([{ sourceUrl: 'u', changedAt: new Date(), payload: { nope: 1 } }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `pnpm vitest run packages/pipeline/tests/materialize.test.ts`
Expected: FAIL — `toImmunefiRecords` không được export

- [ ] **Step 3: Cài đặt**

Thêm vào cuối `packages/pipeline/src/materialize.ts`:
```ts
import type { ImmunefiProgramPayload } from '@kritt-radar/collectors';

export interface ScopeRecord {
  kind: 'repo';
  hardKey: string;
  repoUrl: string;
  pathGlobs: string[];
  /** Ngày asset được thêm vào scope. null = mirror không cho biết. */
  addedAt: Date | null;
}

export interface MultiScopeRecord {
  program: ProgramRecord['program'];
  scopes: ScopeRecord[];
  changedAt: Date;
}

function isImmunefiPayload(v: unknown): v is ImmunefiProgramPayload {
  return (
    typeof v === 'object' && v !== null &&
    (v as ImmunefiProgramPayload).platform === 'immunefi' &&
    Array.isArray((v as ImmunefiProgramPayload).assets)
  );
}

/** Một program Immunefi có nhiều repo trong scope, mỗi repo chấm điểm riêng. */
export function toImmunefiRecords(rows: readonly LatestObservation[]): MultiScopeRecord[] {
  const out: MultiScopeRecord[] = [];
  for (const row of rows) {
    if (!isImmunefiPayload(row.payload)) continue;
    const p = row.payload;

    out.push({
      program: {
        platform: p.platform,
        externalId: p.externalId,
        title: p.title,
        url: p.url,
        poolUsd: p.poolUsd,
        kind: p.kind,
        publishedAt: toDate(p.publishedAt),
        startsAt: toDate(p.publishedAt),
        endsAt: null,
      },
      scopes: p.assets.map((a) => ({
        kind: 'repo' as const,
        hardKey: a.repoKey,
        repoUrl: a.repoKey,
        pathGlobs: [],
        addedAt: toDate(a.addedAt),
      })),
      changedAt: row.changedAt,
    });
  }
  return out;
}
```

Trong `apps/worker/src/cli.ts`, thêm `immunefiPrograms` vào mảng collectors của hàm `collect`:
```ts
const collectors = [c4Contests, sherlockContests, cantinaCompetitions, immunefiPrograms];
```

Sửa dòng import collectors ở đầu file thành:
```ts
import {
  c4Contests,
  cantinaCompetitions,
  immunefiPrograms,
  sherlockContests,
} from '@kritt-radar/collectors';
```

Trong hàm `materialize`, sau vòng lặp `for (const r of records)` hiện có, thêm khối xử lý Immunefi:
```ts
  const immunefiRows = await prisma.observation.findMany({
    where: { collectorId: 'immunefi-programs' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });

  const immunefi = toImmunefiRecords(latestBySourceUrl(immunefiRows));

  for (const r of immunefi) {
    const program = await prisma.program.upsert({
      where: { platform_externalId: { platform: r.program.platform, externalId: r.program.externalId } },
      create: r.program,
      update: r.program,
    });

    for (const sc of r.scopes) {
      const existing = await prisma.scope.findFirst({
        where: { programId: program.id, hardKey: sc.hardKey },
      });
      const scope =
        existing ??
        (await prisma.scope.create({
          data: {
            programId: program.id,
            kind: sc.kind,
            hardKey: sc.hardKey,
            repoUrl: sc.repoUrl,
            pathGlobs: sc.pathGlobs,
          },
        }));

      // addedAt của asset chính xác hơn launchDate của program: một repo thêm
      // hôm qua vào một program mở từ 2025 vẫn là scope mới tinh.
      const freshness = extractFreshness(
        { publishedAt: r.program.publishedAt ?? undefined, scopeChangedAt: sc.addedAt ?? undefined },
        now,
      );

      await prisma.signal.upsert({
        where: { scopeId_type: { scopeId: scope.id, type: freshness.type } },
        create: {
          scopeId: scope.id,
          type: freshness.type,
          value: freshness.value,
          confidence: freshness.confidence,
          evidence: freshness.evidence as never,
          observationIds: [],
        },
        update: {
          value: freshness.value,
          confidence: freshness.confidence,
          evidence: freshness.evidence as never,
          computedAt: now,
        },
      });
    }
  }

  console.log(`materialized ${immunefi.length} immunefi programs, ${immunefi.reduce((a, r) => a + r.scopes.length, 0)} scopes`);
```

Sửa dòng import động ở đầu hàm `materialize` thành:
```ts
  const { latestBySourceUrl, toProgramRecords, toImmunefiRecords, extractFreshness } =
    await import('@kritt-radar/pipeline');
```

- [ ] **Step 4: Chạy toàn bộ pipeline**

Run: `pnpm vitest run packages/pipeline/tests/materialize.test.ts`
Expected: PASS — 8 passed

Run: `pnpm test`
Expected: PASS — toàn bộ suite xanh

Run: `pnpm collect`
Expected: bốn dòng, trong đó `immunefi-programs        ok       N new`

Run: `pnpm materialize`
Run: `pnpm rank`
Expected: bảng xếp hạng có cả contest lẫn bounty Immunefi. Các scope mới thêm gần đây phải đứng trên cùng vì `freshness` lấy `addedAt` của asset.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): materialize multi-scope immunefi programs"
```

---

## Đã hoàn thành và chưa hoàn thành

Kết thúc plan này bạn có: pipeline thu thập từ ba nền tảng contest cộng Immunefi, entity resolver chính xác tuyệt đối, hai signal extractor, scorer nhận biết confidence, và CLI in bảng xếp hạng.

`audit_gap` đã cài và test đầy đủ nhưng **chưa được nối vào lệnh `materialize`** — nó cần dữ liệu commit từ `github-repo-activity` và `AuditReport` đã resolve về entity. Đó là task đầu tiên của plan kế tiếp, cùng với dashboard Next.js.

Hai việc cần kiểm tra ở plan sau:
- Trường `audits` trong mirror Immunefi có thể chứa sẵn thông tin audit report. Nếu có, nó nuôi thẳng `AuditReport` mà không cần crawl repo của các hãng audit.
- `platform-leaderboards` ở pha 3 là nguồn HTML duy nhất còn lại. Kiểm tra API chính thức của HackerOne trước khi dựng sidecar Scrapling — có thể sidecar không cần tồn tại.
