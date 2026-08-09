# Production Deploy (Vercel + Railway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa dashboard Kritt Radar lên Vercel và Postgres + job thu thập bằng chứng lên Railway, giữ Open-Kritt ở lại local.

**Architecture:** Vercel chạy `apps/web`. Railway chạy Postgres (nguồn dữ liệu duy nhất) và một cron service gọi worker CLI với `RADAR_AUTOMATE_DISPATCH=false` để làm sync + auto-merge. Máy local giữ Open-Kritt và các lệnh `dispatch`/`watch`/`ingest`, trỏ vào Postgres của Railway.

**Tech Stack:** pnpm workspace, Next 16, Prisma 6 + PostgreSQL, vitest, Vercel, Railway.

**Spec:** `docs/superpowers/specs/2026-08-10-production-deploy-design.md`

---

## Bối cảnh cho người thực hiện

Bốn package trong `packages/` đều khai `main: ./dist/index.js`, nên **phải build trước khi `next build`**. Test thì không cần build: `vitest.config.ts` alias thẳng vào `packages/*/src/index.ts`.

Toàn bộ test chạy từ gốc repo bằng `pnpm test`. Test của web nằm ở `apps/web/tests/`. Tên test viết tiếng Việt theo đúng quy ước hiện có — xem `apps/web/tests/workspace-env.test.ts` làm mẫu.

Nhánh làm việc hiện tại là `feat/automation-stage1`. Working tree đang có nhiều file dở dang không liên quan tới plan này; **chỉ `git add` đúng các file mà mỗi task liệt kê**, không dùng `git add -A`.

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `apps/web/src/lib/workspace-root.ts` | Tạo mới | Xác định gốc workspace ở cả local lẫn serverless. Tách phần thuần (`pickWorkspaceRoot`) khỏi phần chạm filesystem (`workspaceRoot`) để test được. |
| `apps/web/tests/workspace-root.test.ts` | Tạo mới | Test cho `pickWorkspaceRoot`. |
| `apps/web/src/app/targets/page.tsx` | Sửa | Dùng `workspaceRoot()` thay cho `resolve(process.cwd(), '../..')`. |
| `apps/web/src/app/targets/[id]/page.tsx` | Sửa | Như trên. |
| `apps/web/src/app/outcomes/page.tsx` | Sửa | Như trên. |
| `apps/web/next.config.ts` | Sửa | Trace dependency workspace + nhét `config/*.yml` vào bundle. |
| `packages/db/package.json` | Sửa | Sinh Prisma client trong bước build. |
| `apps/worker/package.json` | Sửa | Thêm entry point production không phụ thuộc `.env`. |
| `vercel.json` | Tạo mới | Ép Vercel build cả workspace. |

Task 1–5 là thay đổi code. Task 6–10 là thao tác hạ tầng và migrate dữ liệu.

---

### Task 1: Xác định gốc workspace ở môi trường serverless

Ba page đang giả định cwd là `apps/web` và lấy gốc repo bằng `resolve(process.cwd(), '../..')`. Trong serverless function của Vercel giả định đó sai, và ba trang này sẽ ném lỗi khi đọc `config/weights.yml`.

**Files:**
- Create: `apps/web/src/lib/workspace-root.ts`
- Test: `apps/web/tests/workspace-root.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/tests/workspace-root.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickWorkspaceRoot } from '../src/lib/workspace-root';

describe('pickWorkspaceRoot', () => {
  it('chọn thư mục ông nội khi ở đó có config/ (chạy dev từ apps/web)', () => {
    const root = pickWorkspaceRoot('/repo/apps/web', (dir) => dir === '/repo');
    expect(root).toBe('/repo');
  });

  it('chọn chính cwd khi config/ nằm ngay tại đó (bundle serverless)', () => {
    // Trên Vercel cwd là gốc output, không phải apps/web, nên phép lùi hai cấp
    // trỏ ra ngoài bundle và không tìm thấy gì.
    const root = pickWorkspaceRoot('/var/task', (dir) => dir === '/var/task');
    expect(root).toBe('/var/task');
  });

  it('không tìm thấy config/ ở đâu thì trả về cwd', () => {
    // Đọc file sau đó sẽ hỏng, nhưng hỏng ở chỗ đọc file với đường dẫn nói ra
    // được vấn đề, chứ không phải trả về một đường dẫn bịa.
    const root = pickWorkspaceRoot('/var/task', () => false);
    expect(root).toBe('/var/task');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

```bash
pnpm vitest run apps/web/tests/workspace-root.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/lib/workspace-root"`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/web/src/lib/workspace-root.ts`:

```ts
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Phần thuần, không chạm filesystem, nên test được: `hasConfigDir` là chỗ tiêm
 * kết quả kiểm tra thư mục vào.
 */
export function pickWorkspaceRoot(cwd: string, hasConfigDir: (dir: string) => boolean): string {
  const grandparent = resolve(cwd, '../..');
  return hasConfigDir(grandparent) ? grandparent : resolve(cwd);
}

/**
 * `next dev` chạy với cwd là apps/web nên gốc workspace là hai cấp trên. Trong
 * serverless function của Vercel cwd là gốc output đã trace, và config/ nằm
 * ngay tại đó. Đoán sai chỗ này làm các trang đọc weights.yml hỏng ở production
 * mà local vẫn xanh.
 */
export function workspaceRoot(): string {
  return pickWorkspaceRoot(process.cwd(), (dir) => existsSync(join(dir, 'config')));
}
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

```bash
pnpm vitest run apps/web/tests/workspace-root.test.ts
```

Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workspace-root.ts apps/web/tests/workspace-root.test.ts
git commit -m "feat(web): resolve the workspace root without assuming the dev cwd"
```

---

### Task 2: Ba page dùng gốc workspace đã xác định

**Files:**
- Modify: `apps/web/src/app/targets/page.tsx:42-53`
- Modify: `apps/web/src/app/targets/[id]/page.tsx:101-103`
- Modify: `apps/web/src/app/outcomes/page.tsx:29-32`

Không thêm test mới ở task này: hành vi được Task 1 phủ, và ba trang này đã có test e2e trong `apps/web/tests/e2e`.

- [ ] **Step 1: Sửa `apps/web/src/app/targets/page.tsx`**

Bỏ `import { resolve } from 'node:path';` khỏi đầu file, thêm import mới sau dòng `import { prisma } from '@kritt-radar/db';`:

```ts
import { workspaceRoot } from '../../lib/workspace-root';
```

Vẫn giữ `import { resolve } from 'node:path';` vì hai hàm dưới còn dùng `resolve` để ghép đường dẫn. Thay hai hàm:

```ts
async function loadWeights() {
  return parseWeights(await readFile(resolve(workspaceRoot(), 'config/weights.yml'), 'utf8'));
}

async function loadExclusions() {
  // Missing file means nothing is excluded, which is a safe default: the list
  // gets noisier, never quietly shorter.
  const text = await readFile(resolve(workspaceRoot(), 'config/exclusions.yml'), 'utf8').catch(
    () => 'owners: []',
  );
  return parseExclusions(text);
}
```

- [ ] **Step 2: Sửa `apps/web/src/app/targets/[id]/page.tsx`**

Thêm import sau `import { prisma } from '@kritt-radar/db';`:

```ts
import { workspaceRoot } from '../../../lib/workspace-root';
```

Trong `TargetRoute`, thay hai dòng:

```ts
  const workspaceRoot = resolve(process.cwd(), '../..');
  const weights = parseWeights(await readFile(resolve(workspaceRoot, 'config/weights.yml'), 'utf8'));
```

bằng một dòng:

```ts
  const weights = parseWeights(
    await readFile(resolve(workspaceRoot(), 'config/weights.yml'), 'utf8'),
  );
```

- [ ] **Step 3: Sửa `apps/web/src/app/outcomes/page.tsx`**

Thêm import sau `import { prisma } from '@kritt-radar/db';`:

```ts
import { workspaceRoot } from '../../lib/workspace-root';
```

Thay hàm `loadWeights`:

```ts
async function loadWeights() {
  return parseWeights(await readFile(resolve(workspaceRoot(), 'config/weights.yml'), 'utf8'));
}
```

- [ ] **Step 4: Chạy typecheck và test**

```bash
pnpm typecheck
```

Expected: exit 0, không lỗi nào.

```bash
pnpm test
```

Expected: toàn bộ suite PASS.

- [ ] **Step 5: Xác nhận dev server vẫn chạy đúng**

```bash
pnpm --filter @kritt-radar/web run dev
```

Mở `http://localhost:3100/targets`, `http://localhost:3100/outcomes`, và một trang chi tiết target. Cả ba phải render bình thường như trước. Dừng server sau khi xong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/targets/page.tsx "apps/web/src/app/targets/[id]/page.tsx" apps/web/src/app/outcomes/page.tsx
git commit -m "fix(web): read workspace config through the resolved root"
```

---

### Task 3: Prisma client sinh ra trong bước build

Không package nào có `postinstall`. Local chạy được là nhờ tác dụng phụ của `prisma migrate dev`. Trên Vercel và Railway không có gì gọi `prisma generate`, nên `@prisma/client` sẽ thiếu client đã sinh và build hỏng.

**Files:**
- Modify: `packages/db/package.json:10`

- [ ] **Step 1: Sửa script build**

Trong `packages/db/package.json`, đổi:

```json
"build": "tsc -p tsconfig.json",
```

thành:

```json
"build": "prisma generate && tsc -p tsconfig.json",
```

- [ ] **Step 2: Xác nhận build sạch từ đầu**

```bash
rm -rf packages/db/dist && pnpm --filter @kritt-radar/db run build
```

Expected: log của Prisma `Generated Prisma Client`, rồi `packages/db/dist/index.js` xuất hiện.

- [ ] **Step 3: Xác nhận build toàn workspace**

```bash
pnpm -r build
```

Expected: exit 0. `next build` ở cuối phải thành công.

- [ ] **Step 4: Commit**

```bash
git add packages/db/package.json
git commit -m "build(db): generate the Prisma client as part of the build"
```

---

### Task 4: Next trace được dependency workspace và file config

**Files:**
- Modify: `apps/web/next.config.ts:15-19`

- [ ] **Step 1: Sửa `nextConfig`**

Thay object `nextConfig` bằng:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@kritt-radar/core', '@kritt-radar/db', '@kritt-radar/pipeline'],
  turbopack: {
    root: workspaceRoot,
  },
  // Mặc định Next chỉ trace trong apps/web, mà bốn package của workspace nằm
  // ngoài đó — thiếu dòng này thì function trên Vercel chết vì module not found.
  outputFileTracingRoot: workspaceRoot,
  // Các trang targets/outcomes đọc hai file YAML này lúc chạy, nên chúng phải
  // nằm trong bundle chứ không chỉ trong repo.
  outputFileTracingIncludes: {
    '/**': ['../../config/*.yml'],
  },
};
```

- [ ] **Step 2: Build lại và kiểm tra file YAML có trong output**

```bash
pnpm -r build
```

Expected: exit 0.

```bash
find apps/web/.next -name "weights.yml"
```

Expected: ít nhất một kết quả dưới `apps/web/.next/server/`. Nếu rỗng thì `outputFileTracingIncludes` chưa ăn — kiểm tra lại đường dẫn tương đối so với `apps/web`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "build(web): trace workspace packages and config files into the bundle"
```

---

### Task 5: Entry point production cho worker và cấu hình build Vercel

`apps/worker/package.json` chạy `tsx --env-file=../../.env`. Node báo lỗi cứng khi file đó không tồn tại, và trên Railway thì nó không tồn tại. Script `cli` của local giữ nguyên để `scripts/*.ps1` không bị ảnh hưởng.

**Files:**
- Modify: `apps/worker/package.json:9`
- Create: `vercel.json`

- [ ] **Step 1: Thêm script production cho worker**

Trong `apps/worker/package.json`, thêm ngay sau dòng `"cli": ...`:

```json
    "cli:prod": "node dist/cli.js",
```

- [ ] **Step 2: Xác nhận nó chạy được từ dist**

```bash
pnpm --filter @kritt-radar/worker run build && pnpm --filter @kritt-radar/worker run cli:prod
```

Expected: CLI in ra thông báo thiếu lệnh hoặc danh sách lệnh rồi thoát — **không** được ném lỗi module not found hay lỗi đọc `.env`.

- [ ] **Step 3: Tạo `vercel.json` ở gốc repo**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm -r build",
  "outputDirectory": "apps/web/.next"
}
```

`pnpm -r build` chạy theo thứ tự topo: core → db → collectors → pipeline → web. Build mặc định của Vercel chỉ gọi `next build` nên sẽ thiếu `dist/` của cả bốn package.

- [ ] **Step 4: Chạy lại toàn bộ kiểm tra**

```bash
pnpm typecheck && pnpm test && pnpm -r build
```

Expected: cả ba exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json vercel.json
git commit -m "build: add a production worker entry point and Vercel build config"
```

---

### Task 6: Dựng Postgres trên Railway và tạo schema

Từ đây là thao tác hạ tầng. Không có test tự động; mỗi bước có lệnh xác minh riêng.

**Files:** không sửa file nào.

- [ ] **Step 1: Tạo project và Postgres**

Trong Railway: New Project → Deploy PostgreSQL. Đợi service healthy.

- [ ] **Step 2: Lấy hai connection string**

Ở tab Variables của service Postgres, chép lại:
- `DATABASE_URL` — dạng `postgres.railway.internal`, chỉ service Railway khác dùng được.
- `DATABASE_PUBLIC_URL` — dạng `*.proxy.rlwy.net`, dùng cho Vercel và máy local.

Lưu vào chỗ an toàn. **Không** commit hai chuỗi này.

- [ ] **Step 3: Chạy migration lên Railway**

Từ gốc repo, thay `<PUBLIC_URL>` bằng giá trị thật:

```bash
DATABASE_URL="<PUBLIC_URL>?sslmode=require" pnpm --filter @kritt-radar/db exec prisma migrate deploy
```

Expected: Prisma liệt kê các migration đã áp và kết thúc bằng `All migrations have been successfully applied`.

- [ ] **Step 4: Xác minh schema**

```bash
psql "<PUBLIC_URL>?sslmode=require" -c "\dt"
```

Expected: thấy các bảng `Entity`, `Program`, `Finding`, `Outcome`, `MergeDecision`, `_prisma_migrations`.

---

### Task 7: Chuyển dữ liệu từ Postgres local lên Railway

Dump `--data-only` chứ không dump cả schema: schema phải do `prisma migrate deploy` ở Task 6 tạo ra, để bảng `_prisma_migrations` trên Railway đúng trạng thái và migration sau này còn chạy được.

**Files:** không sửa file nào.

- [ ] **Step 1: Đảm bảo Postgres local đang chạy**

```bash
docker compose up -d postgres
```

- [ ] **Step 2: Đếm số dòng ở DB local**

```bash
psql "postgresql://kritt:kritt@localhost:5433/kritt_radar" -c "SELECT 'Entity' t, count(*) FROM \"Entity\" UNION ALL SELECT 'Program', count(*) FROM \"Program\" UNION ALL SELECT 'Finding', count(*) FROM \"Finding\" UNION ALL SELECT 'Outcome', count(*) FROM \"Outcome\" UNION ALL SELECT 'MergeDecision', count(*) FROM \"MergeDecision\" ORDER BY 1;"
```

Ghi lại kết quả. Đây là con số đối chiếu ở Step 5.

- [ ] **Step 3: Dump dữ liệu**

```bash
pg_dump --data-only --disable-triggers --exclude-table=_prisma_migrations \
  "postgresql://kritt:kritt@localhost:5433/kritt_radar" > /tmp/radar-data.sql
```

Expected: file `/tmp/radar-data.sql` khác rỗng.

- [ ] **Step 4: Restore lên Railway**

```bash
psql "<PUBLIC_URL>?sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/radar-data.sql
```

Expected: không có dòng `ERROR`. Nếu `ON_ERROR_STOP` làm dừng giữa chừng thì **dừng lại và đọc lỗi**, đừng restore đè lần nữa.

- [ ] **Step 5: Đối chiếu số dòng — đây là điều kiện chặn**

```bash
psql "<PUBLIC_URL>?sslmode=require" -c "SELECT 'Entity' t, count(*) FROM \"Entity\" UNION ALL SELECT 'Program', count(*) FROM \"Program\" UNION ALL SELECT 'Finding', count(*) FROM \"Finding\" UNION ALL SELECT 'Outcome', count(*) FROM \"Outcome\" UNION ALL SELECT 'MergeDecision', count(*) FROM \"MergeDecision\" ORDER BY 1;"
```

Expected: **khớp từng dòng** với Step 2. Không khớp thì không đi tiếp — Task 8 trở đi giả định dữ liệu đã sang đủ.

---

### Task 8: Deploy web lên Vercel

**Files:** không sửa file nào.

- [ ] **Step 1: Push nhánh lên GitHub**

```bash
git push -u origin feat/automation-stage1
```

- [ ] **Step 2: Import repo vào Vercel**

New Project → import `luongvietan/bountyhunter`. Đặt **Root Directory = `.`** (gốc repo, không phải `apps/web`) — `vercel.json` đã lo phần build.

- [ ] **Step 3: Đặt biến môi trường**

Chỉ một biến, cho cả ba environment:

| Key | Value |
|---|---|
| `DATABASE_URL` | `<PUBLIC_URL>?sslmode=require&connection_limit=5` |

`connection_limit=5` là bắt buộc: serverless mở nhiều instance Prisma song song còn Railway Postgres mặc định khoảng 100 connection.

Web **không** cần `KRITT_*`, `GITHUB_TOKEN`, hay `ETHERSCAN_API_KEY`.

- [ ] **Step 4: Deploy và đọc build log**

Expected trong log, theo thứ tự: `Generated Prisma Client` → các package build xong → `next build` thành công.

Build hỏng vì thiếu module workspace nghĩa là `buildCommand` chưa được áp — kiểm tra Root Directory ở Step 2.

- [ ] **Step 5: Bật Vercel Authentication**

Settings → Deployment Protection → Vercel Authentication → **All Deployments**.

Áp cho production domain cần gói **Vercel Pro**. Nếu project đang ở Hobby thì tuỳ chọn này chỉ phủ preview — **dừng lại và báo lại cho chủ dự án** thay vì để production public, vì dashboard có cả nút approve merge, dismiss finding, và settle outcome.

- [ ] **Step 6: Xác minh các trang**

Mở lần lượt và xác nhận không có trang nào lỗi 500:

- `/targets` và một trang chi tiết target — chứng minh Task 1, 2, 4 có tác dụng thật.
- `/outcomes`
- `/merge-queue` và `/findings` — chứng minh dữ liệu ở Task 7 đọc được.
- `/health` — `krittUp: false` là **đúng như thiết kế**, Kritt ở local.

---

### Task 9: Dựng cron service trên Railway

**Files:** không sửa file nào.

- [ ] **Step 1: Tạo service từ repo**

Trong cùng project Railway: New → GitHub Repo → chọn repo, nhánh `feat/automation-stage1`. Đặt tên service là `radar-sync`.

- [ ] **Step 2: Đặt build và start command**

Settings → Build:

```
pnpm install --frozen-lockfile && pnpm -r build
```

Settings → Deploy → Start Command:

```
pnpm --filter @kritt-radar/worker run cli:prod automate
```

- [ ] **Step 3: Đặt lịch cron và restart policy**

Settings → Deploy:
- Cron Schedule: `0 2 * * *`
- Restart Policy: **Never**

`automate` là lệnh one-shot; restart policy `Never` giữ nó đúng nghĩa one-shot thay vì bị khởi động lại vòng lặp sau khi thoát.

- [ ] **Step 4: Đặt biến môi trường**

| Key | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `RADAR_AUTOMATE_DISPATCH` | `false` |
| `GITHUB_TOKEN` | token đọc public repo, chép từ `.env` local |
| `ETHERSCAN_API_KEY` | chép từ `.env` local |
| `RADAR_AUTO_MERGE` | `true` |
| `RADAR_AUTO_MERGE_MIN` | `0.92` |
| `RADAR_AUTO_MERGE_AI_MIN` | `0.85` |
| `RADAR_AUTO_MERGE_AI_CONFIDENCE` | `0.85` |
| `RADAR_LLM_API_URL` | chép từ `.env` local |
| `RADAR_LLM_API_KEY` | chép từ `.env` local |
| `RADAR_LLM_MODEL` | chép từ `.env` local |

`DATABASE_URL` dùng URL nội bộ: không qua internet, không cần SSL, không tính egress.

`RADAR_AUTOMATE_DISPATCH=false` là biến quan trọng nhất ở đây. Nó khiến `apps/worker/src/automate.ts:96` bỏ qua nhánh dispatch/watch, để lại đúng sync + auto-merge. Không có nó, job sẽ cố gọi Open-Kritt ở `127.0.0.1:3002` bên trong container Railway và luôn báo lỗi dispatch.

Không đặt biến `KRITT_*` nào.

- [ ] **Step 5: Chạy tay một lần và đọc log**

Deployments → Trigger deploy.

Expected trong log: các collector chạy, rồi `[automate] complete manual=... sync=ok dispatch=skipped watch=skipped`.

`dispatch=skipped` là kết quả đúng. `dispatch=error` nghĩa là `RADAR_AUTOMATE_DISPATCH` chưa được đọc — kiểm tra lại chính tả tên biến.

- [ ] **Step 6: Xác minh nó thật sự ghi dữ liệu**

```bash
psql "<PUBLIC_URL>?sslmode=require" -c "SELECT kind, status, \"createdAt\" FROM \"OpsEvent\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Expected: có dòng `automate` với thời điểm vừa chạy.

Mở `/health` trên Vercel — lần chạy này phải hiện ra ở đó.

---

### Task 10: Chuyển máy local sang dùng DB trên Railway

Bước này chỉ làm sau khi Task 7 Step 5 đã khớp số liệu.

**Files:** `.env` (không được commit — đã nằm trong `.gitignore`).

- [ ] **Step 1: Đổi `DATABASE_URL` trong `.env`**

```
DATABASE_URL=<PUBLIC_URL>?sslmode=require
```

Giữ nguyên toàn bộ biến `KRITT_*` — Open-Kritt vẫn ở loopback.

- [ ] **Step 2: Xác minh worker local đọc được DB cloud**

```bash
pnpm --filter @kritt-radar/worker run cli rank
```

Expected: chạy xong không lỗi kết nối.

- [ ] **Step 3: Xác minh dispatch vẫn thấy Open-Kritt**

Bật Open-Kritt trước (`cd /d/open-kritt && docker compose up -d`), rồi chạy dry run:

```bash
pnpm --filter @kritt-radar/worker run cli dispatch
```

Expected: in ra kế hoạch dispatch, không có `--apply` nên không ghi gì.

- [ ] **Step 4: Tắt Postgres local**

```bash
docker compose stop postgres
```

Chạy lại Step 2. Nếu vẫn xanh thì máy local đã thật sự dùng DB trên Railway.

Giữ nguyên thư mục `pgdata/` ít nhất một tuần làm bản lùi.

- [ ] **Step 5: Cập nhật `.env.example`**

Sửa dòng comment của `DATABASE_URL` trong `.env.example` để mô tả đúng thực tế mới:

```
# Collected evidence. Production dùng Postgres trên Railway; đây là URL công
# khai (?sslmode=require). Worker local, cron trên Railway, và dashboard trên
# Vercel đều trỏ vào cùng một database.
DATABASE_URL=postgresql://kritt:kritt@localhost:5433/kritt_radar
```

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "docs: describe the Railway database in the env example"
```

---

## Kiểm tra cuối

- [ ] `pnpm typecheck` xanh
- [ ] `pnpm test` xanh
- [ ] `pnpm -r build` xanh
- [ ] `/targets`, `/targets/[id]`, `/outcomes`, `/merge-queue`, `/findings`, `/health` trên Vercel đều mở được
- [ ] `/health` hiện lần chạy `automate` gần nhất từ cron Railway
- [ ] Truy cập Vercel URL ở chế độ ẩn danh bị chặn bởi Vercel Authentication
- [ ] Số dòng năm bảng chính trên Railway khớp với DB local trước khi chuyển
