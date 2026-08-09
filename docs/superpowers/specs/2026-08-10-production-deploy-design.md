# kritt-radar — Triển khai production (Vercel + Railway)

Ngày: 2026-08-10
Trạng thái: đã duyệt

## 1. Mục tiêu

Operator giám sát được dữ liệu Radar từ bất kỳ máy nào, không phải bật máy
local mới xem được dashboard. Việc thu thập bằng chứng và auto-merge chạy trên
cloud theo lịch. Việc quét thật (Open-Kritt) vẫn ở local.

## 2. Quyết định đã chốt

| Chủ đề | Chốt |
|---|---|
| Dashboard | Vercel, apps/web |
| Database | Railway Postgres — nguồn dữ liệu duy nhất |
| Job định kỳ | Railway cron service (one-shot, restart policy `never`) |
| Open-Kritt | Ở lại local, không expose ra internet |
| dispatch / watch / ingest | Ở lại local (Windows Scheduled Task) |
| Auth dashboard | Vercel Authentication (Deployment Protection) |
| Dữ liệu hiện có | pg_dump + restore lên Railway |
| Postgres local | Ngừng sau khi đối chiếu số liệu khớp |

## 3. Ràng buộc đã xác minh

Những điểm này được xác minh bằng cách đọc code, không phải phỏng đoán. Chúng
là lý do tồn tại của mọi thay đổi ở mục 5.

### 3.1 Engine của Open-Kritt không chạy được trên Railway

`docker-compose.yml` của Open-Kritt, service `engine`:

- mount `/var/run/docker.sock` — engine spawn container lồng nhau cho mỗi scan
  (`ENGINE_SCAN_RUNNER_IMAGE`, `ENGINE_CLAUDE_DOCKER_RUNNER=1`)
- `ENGINE_DOCKER_DATA_DIR_HOST` phải là host path thật để container con thấy được
- `ENGINE_MIN_FREE_STORAGE_GB=20`
- bind-mount credentials và codex-home từ host

Railway không cấp Docker socket, không cho privileged, không cho bind-mount host
path. Đây là bất tương thích về mô hình chạy, không phải vấn đề cấu hình.

**Hệ quả:** `dispatch`, `watch`, `ingest` ở lại local.

### 3.2 Package workspace resolve qua `dist/`

`core`, `db`, `collectors`, `pipeline` đều khai báo `main: ./dist/index.js`.
Build mặc định của Vercel chỉ chạy `next build`, không sinh `dist/` nào.

### 3.3 Prisma client không được generate tự động

Không package nào có `postinstall`. `packages/db/package.json` chỉ có script
`generate` thủ công. Local hoạt động nhờ tác dụng phụ của `prisma migrate dev`.

### 3.4 Web đọc file config lúc runtime

`apps/web/src/app/targets/page.tsx:43`, `targets/[id]/page.tsx:102`, và
`outcomes/page.tsx:30` đọc `config/weights.yml` / `config/exclusions.yml` bằng
`resolve(process.cwd(), '../..')`. Trong serverless function của Vercel, cwd
không phải `apps/web` và các file YAML không nằm trong bundle. Ba trang này sẽ
lỗi ở production nếu không sửa.

### 3.5 Worker nạp `.env` bằng cờ bắt buộc

`apps/worker/package.json` chạy `tsx --env-file=../../.env`. Node báo lỗi cứng
khi file không tồn tại. Trên Railway không có `.env`.

### 3.6 Web KHÔNG vướng vấn đề `.env`

`apps/web/src/lib/workspace-env.ts` đã bắt lỗi thiếu file và trả mảng rỗng, và
biến môi trường sẵn có luôn thắng nội dung file. Web không cần sửa gì về env.

## 4. Kiến trúc

```
Vercel (apps/web)  ──────┐
                          ├──►  Railway Postgres  ◄── nguồn dữ liệu duy nhất
Railway cron (worker) ────┤
                          │
Máy local ────────────────┘
  ├─ Open-Kritt (docker compose, 127.0.0.1:3002)
  └─ Scheduled Task: dispatch → watch/ingest
```

Ranh giới: cái gì chỉ cần internet thì lên cloud; cái gì cần Docker socket thì
ở lại local.

| Chạy ở đâu | Lệnh | Lịch |
|---|---|---|
| Railway cron `radar-sync` | `automate` với `RADAR_AUTOMATE_DISPATCH=false` | 1 lần/ngày |
| Local Scheduled Task | `dispatch --apply`, `watch` | giữ nguyên lịch hiện tại |

Chỉ một cron service. Không tách job `rank` riêng: `sync` đã gọi `rank` ở bước
cuối, và điểm số chỉ đổi khi có observation mới, nên chạy `rank` giữa hai lần
sync không tạo ra dữ liệu khác.

`RADAR_AUTOMATE_DISPATCH=false` khiến `apps/worker/src/automate.ts:96` bỏ qua
nhánh dispatch/watch. Còn lại đúng sync + auto-merge — phần chạy được trên
cloud. Không cần code mới cho job này, và nó vẫn ghi ops event nên `/health`
phản ánh đúng trạng thái.

## 5. Thay đổi code

Năm thay đổi. Không đụng logic nghiệp vụ nào.

### 5.1 `packages/db/package.json`

```
"build": "prisma generate && tsc -p tsconfig.json"
```

Giải quyết 3.3. `pnpm -r build` sinh Prisma client trên cả Vercel lẫn Railway.
Chọn cách này thay vì `postinstall` để không phụ thuộc ngữ nghĩa lifecycle
script của pnpm với workspace package.

### 5.2 `apps/web/next.config.ts`

Thêm vào `nextConfig`:

```ts
outputFileTracingRoot: workspaceRoot,
outputFileTracingIncludes: { '/**': ['../../config/*.yml'] },
```

`outputFileTracingRoot` để Next trace đúng dependency workspace ngoài `apps/web`.
`outputFileTracingIncludes` để file YAML ở mục 3.4 có mặt trong bundle.

### 5.3 `apps/web/src/lib/workspace-root.ts` (file mới)

Hàm `workspaceRoot(): string` trả về gốc workspace: thử `resolve(process.cwd(),
'../..')` nếu ở đó có thư mục `config`, ngược lại trả `process.cwd()`.

Ba page ở mục 3.4 dùng hàm này thay cho `resolve(process.cwd(), '../..')` viết
tay. Đây là logic thuần, có test riêng.

Sửa ở một chỗ dùng chung thay vì vá từng page, vì cả ba page đang lặp lại cùng
một giả định sai về cwd.

### 5.4 `apps/worker/package.json`

Thêm script:

```
"cli:prod": "node dist/cli.js"
```

Railway chạy binary đã build, không qua `tsx --env-file`. Script `cli` của local
giữ nguyên để không ảnh hưởng workflow hiện tại và các file `scripts/*.ps1`.

### 5.5 `vercel.json` (file mới, gốc repo)

```json
{
  "framework": "nextjs",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm -r build",
  "outputDirectory": "apps/web/.next"
}
```

Giải quyết 3.2. `pnpm -r build` chạy theo thứ tự topo: core → db → collectors →
pipeline → web.

## 6. Biến môi trường

| Biến | Vercel | Railway cron | Local |
|---|---|---|---|
| `DATABASE_URL` | `DATABASE_PUBLIC_URL` + `?sslmode=require&connection_limit=5` | `${{Postgres.DATABASE_URL}}` (nội bộ) | `DATABASE_PUBLIC_URL` + `?sslmode=require` |
| `GITHUB_TOKEN` | — | có | có |
| `ETHERSCAN_API_KEY` | — | có | có |
| `RADAR_AUTOMATE_DISPATCH` | — | `false` | `true` |
| `RADAR_AUTO_MERGE*` | — | có | có |
| `RADAR_LLM_*` | — | có | có |
| `KRITT_*` | — | — | chỉ local |

`connection_limit=5` trên Vercel là bắt buộc: serverless mở nhiều instance
Prisma song song, Railway Postgres mặc định khoảng 100 connection.

Railway cron dùng URL nội bộ (`postgres.railway.internal`) — không qua internet,
không cần SSL, không tính băng thông egress.

## 7. Bảo mật

Bật Vercel Authentication ở Settings → Deployment Protection, phạm vi *All
Deployments*.

Ràng buộc gói dịch vụ: áp cho **production domain** cần **Vercel Pro**
($20/tháng). Gói Hobby chỉ bảo vệ preview deployment. Nếu ở lại Hobby thì phải
đổi sang middleware tự viết — đó là một quyết định khác, cần chốt lại trước khi
triển khai.

Lý do phải có auth: `apps/web` hiện không có bất kỳ lớp xác thực nào, và
dashboard chứa cả nút mutation (approve merge, dismiss finding, settle outcome).

Open-Kritt không ra internet. `KRITT_API_URL` vẫn là loopback trên máy local,
đúng cảnh báo đã ghi trong `.env.example`.

## 8. Di chuyển dữ liệu

Thứ tự bắt buộc:

1. `prisma migrate deploy` lên Railway — tạo schema đúng version migration.
2. `pg_dump --data-only --disable-triggers` từ `localhost:5433`.
3. `psql` restore vào Railway public URL.
4. Đối chiếu số dòng các bảng chính giữa hai DB: `Entity`, `Program`,
   `Finding`, `Outcome`, `MergeDecision`.
5. Chỉ khi số liệu khớp mới đổi `DATABASE_URL` local sang Railway và tắt
   postgres trong `docker-compose.yml`.

Bước 4 là điều kiện chặn. Không cắt sang DB mới trước khi số liệu khớp.

Lý do dump `--data-only` thay vì dump toàn bộ: schema phải do
`prisma migrate deploy` tạo, để bảng `_prisma_migrations` trên Railway đúng
trạng thái và migration sau này chạy được.

## 9. Xác minh

Trước khi push: `pnpm test` và `pnpm typecheck` phải xanh.

Sau khi deploy:

- `/health` — ops event `sync` / `automate` xuất hiện sau lần cron đầu tiên.
  `krittUp: false` trên Vercel là **đúng như thiết kế**, không phải lỗi: Kritt ở
  local.
- `/targets`, `/targets/[id]`, `/outcomes` — ba trang đọc YAML. Load được nghĩa
  là 5.2 và 5.3 thật sự có tác dụng.
- `/merge-queue`, `/findings` — đọc được dữ liệu đã restore.
- Chạy tay Railway cron `radar-sync` một lần, xem log và xác nhận nó ghi
  `CollectorRun` mới.

## 10. Ngoài phạm vi

- Deploy Open-Kritt lên VPS. Thiết kế này giữ `KRITT_API_URL` là biến cấu hình,
  nên sau này chỉ cần đổi giá trị, không phải làm lại kiến trúc.
- Auth nhiều người dùng, phân quyền. Radar phục vụ một operator.
- Đồng bộ hai chiều giữa Postgres local và cloud. Đã chốt một DB duy nhất.
- Connection pooler (PgBouncer). `connection_limit=5` là đủ cho một operator;
  chỉ cân nhắc lại nếu gặp lỗi hết connection thật.
