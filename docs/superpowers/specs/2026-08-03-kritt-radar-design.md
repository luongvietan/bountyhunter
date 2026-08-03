# kritt-radar — Thiết kế

Ngày: 2026-08-03
Trạng thái: đã duyệt

## 1. Mục tiêu

Tìm ra các mục tiêu bug bounty **ít bị soi** và xuất chúng thành scope sẵn sàng
đưa vào Open-Kritt.

Đầu ra cuối cùng mà người dùng tiêu thụ là một **dashboard Next.js** xếp hạng
target kèm giải thích vì sao điểm cao, và với mỗi target là danh sách file +
commit sha để dán vào scope của một scan Open-Kritt.

### Phi mục tiêu

- Không tự động tạo scan trên Open-Kritt. Mỗi scan tốn token thật; việc kích
  hoạt do người quyết định.
- Không gửi alert (Telegram/Discord) trong v1.
- Không tự tìm lỗ hổng. Việc đó là của Open-Kritt; kritt-radar chỉ chọn mục tiêu.
- Không vượt qua CAPTCHA hay cơ chế chống bot. Nguồn nào chặn thì bỏ nguồn đó.

## 2. Ràng buộc

- **Toolchain**: Node 24.14, pnpm 10.33, Docker 29 + Compose v5, Postgres 16.
- **ToS**: chỉ dùng endpoint công khai, tôn trọng `robots.txt`, giới hạn tốc độ,
  khai báo User-Agent kèm thông tin liên hệ. Không bypass anti-bot.
- **Chi phí nguồn**: X/Twitter API cần gói trả phí; Discord cần bot được mời vào
  server. Hai collector này phải hỏng-mềm khi thiếu credential, không được làm
  chết cả pipeline.
- **AGPL**: kritt-radar là chương trình độc lập, không link code Open-Kritt, nên
  không phải tác phẩm phái sinh. Nếu sau này nhúng code Kritt vào thì AGPL sẽ áp
  dụng cho toàn bộ — giữ hai codebase tách biệt.
- **Dữ liệu**: chỉ lưu metadata công khai.

## 3. Kiến trúc

Monorepo pnpm workspace:

```
packages/core          types + hàm chấm điểm thuần, không I/O
packages/collectors    mỗi nguồn một module, chỉ fetch + chuẩn hoá
packages/db            Prisma schema + client
apps/worker            cron scheduler + Playwright runtime
apps/web               Next.js dashboard
docker-compose.yml     postgres + worker + web
```

Luồng dữ liệu một chiều:

```
Collector → Observation (thô, append-only)
              ↓
         Resolver → Entity / Program / Scope
              ↓
      SignalExtractor → Signal (có evidence + confidence)
              ↓
           Scorer → Score (có breakdown + weightsVersion)
              ↓
         Dashboard
              ↓
        Outcome (người nhập tay) ──┐
              └──────── hiệu chuẩn trọng số ┘
```

Mỗi tầng chỉ đọc tầng trên và ghi tầng của mình. Collector không bao giờ chấm
điểm; scorer không bao giờ gọi mạng.

## 4. Mô hình dữ liệu

```
Entity        id, canonicalName, slug, createdAt
Program       id, entityId, platform, externalId, title, url, poolUsd,
              kind(bounty|contest), publishedAt, startsAt, endsAt, status
              UNIQUE(platform, externalId)
Scope         id, programId, kind(repo|contract), repoUrl, commitish,
              pathGlobs[], chainId, address
AuditReport   id, entityId, firm, publishedAt, reportUrl, coveredCommit,
              coveredPaths[]
Observation   id, collectorId, sourceUrl, fetchedAt, payload jsonb, contentHash
              UNIQUE(collectorId, sourceUrl, contentHash)
Signal        id, scopeId, type, value, confidence, evidence jsonb,
              observationIds[], computedAt
Score         id, scopeId, total, breakdown jsonb, weightsVersion, computedAt
Outcome       id, scopeId, action, submittedAt, result(accepted|duplicate|
              invalid|pending), payoutUsd, notes
MergeCandidate id, leftEntityId, rightEntityId, similarity, status, decidedAt
CollectorRun  id, collectorId, startedAt, finishedAt, status, itemCount, error
```

### Hai quyết định then chốt

**Observation append-only + contentHash.** Không xoá bản ghi cũ. Ràng buộc
UNIQUE trên `(collectorId, sourceUrl, contentHash)` khiến việc chạy lại collector
là idempotent — nội dung không đổi thì không sinh dòng mới. Đổi lại hai thứ:
phát hiện "scope vừa mở rộng" bằng cách so hash giữa hai lần fetch mà không cần
platform thông báo; và khi sửa công thức tín hiệu thì replay trên Observation cũ
trong vài giây thay vì crawl lại.

**Outcome.** Ghi lại người dùng đã scan target nào, submit gì, kết quả ra sao.
Sau 20–30 bản ghi, dữ liệu này cho biết tín hiệu nào thật sự tương quan với tiền.
Không có bảng này thì bộ trọng số mãi mãi chỉ là phỏng đoán.

## 5. Entity resolution

Ba tầng, dừng ngay khi khớp.

**Tầng 1 — khoá cứng.** Repo URL chuẩn hoá (lowercase, bỏ `.git`, bỏ slash cuối,
bỏ tiền tố `www.`) và cặp `chainId + address` (lowercase). Trùng là chắc chắn
cùng entity.

**Tầng 2 — alias thủ công.** File `config/aliases.yml` khai báo tay:

```yaml
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - platformName: { platform: immunefi, name: "Uniswap v4" }
    - defillama: uniswap-v4
```

Số protocol đáng quan tâm chỉ vài trăm; một dòng YAML đúng thì chính xác hơn mọi
thuật toán fuzzy.

**Tầng 3 — gợi ý fuzzy, không tự merge.** Token overlap + Levenshtein trên tên đã
chuẩn hoá; kết quả ghi vào `MergeCandidate` với `status=pending` và hiện lên
dashboard để duyệt tay.

**Nguyên tắc cứng: fuzzy không bao giờ tự động merge.** Merge sai không ném
exception — nó chỉ làm điểm số sai âm thầm, và người dùng sẽ tin vào một bảng xếp
hạng rác trong nhiều tuần. Test phải khẳng định precision tuyệt đối ở tầng 1 và 2.

## 6. Collectors

```ts
interface Collector<T> {
  readonly id: string;
  readonly cadence: string;                    // cron expression
  readonly rateLimit: { rps: number; burst: number };
  readonly requiresCredential?: string;        // tên biến env
  fetch(ctx: FetchCtx): AsyncIterable<Observation<T>>;
}
```

Collector chỉ fetch và chuẩn hoá. Không chấm điểm, không ghi Signal, không resolve
entity. Mỗi collector có `__fixtures__/` chứa response thật đã lưu để test offline.

| Pha | Collector | Lớp nguồn |
|---|---|---|
| 1 | `c4-contests`, `sherlock-contests`, `cantina-competitions` | API/RSS công khai |
| 1 | `github-repo-activity`, `audit-report-repos` | GitHub API |
| 2 | `defillama-tvl`, `etherscan-verified` | On-chain |
| 3 | `hackerone-hacktivity`, `platform-leaderboards` | Playwright |
| 4 | `x-announcements`, `discord-announcements`, `blog-rss` | Cộng đồng |

Pha 1 xong là đã dùng được thật: `audit_gap` nhả ra danh sách file + commit sha
để dán vào scope Kritt. Các pha sau làm điểm số tinh hơn, không đổi luồng làm việc.

## 7. Signal extractors

Mỗi Signal mang `value` (0–1) **và** `confidence` (0–1).

**Nguyên tắc: thiếu dữ liệu không phải là 0.** Nếu không lấy được số researcher,
signal đó ghi `confidence: 0` chứ không ghi `value: 0`. Scorer bỏ qua signal có
confidence thấp và chuẩn hoá lại trọng số trên các signal còn lại. Nếu không làm
vậy, một target thiếu dữ liệu sẽ bị tụt hạng như thể nó thật sự kém.

**`audit_gap`** — tín hiệu quan trọng nhất, cũng là thứ sinh ra scope cho Kritt.
Lấy commit chạm vào `pathGlobs` có ngày sau `AuditReport.publishedAt` gần nhất.
`value = log1p(changedLoc) / log1p(totalLoc)`, chặn trên ở 1.0.
`evidence = { files[], commits[], sinceCommit, sinceDate }`.
Nếu entity chưa từng có audit công khai: `value = 1.0`,
`evidence.reason = "no_public_audit"`.

**`freshness`** — `value = exp(-ageHours / 72)`, tính từ `min(publishedAt,
thời điểm contentHash của scope đổi)`.

**`competition`** — `value = 1 - normalize(log1p(researcherCount))`, nhân thêm hệ
số ngách theo ngôn ngữ chính của repo (Rust/Move/Cairo/Go cao hơn Solidity vì ít
researcher hơn). Không lấy được số researcher thì `confidence = 0`.

**`value_at_risk`** — `value = normalize(log1p(max(poolUsd, tvlUsd)))`.

## 8. Chấm điểm

Tổng có trọng số, trọng số nằm trong `config/weights.yml` có version. `Score` lưu
`weightsVersion` nên so sánh được hai bộ trọng số trên cùng tập dữ liệu.

V1 để **trọng số bằng nhau**, vì hiện chưa có cơ sở nào nói tín hiệu nào quan
trọng hơn. Bảng `Outcome` sẽ trả lời câu đó sau.

`breakdown` lưu phần đóng góp của từng signal để dashboard giải thích được điểm số.

## 9. Dashboard

| Route | Nội dung |
|---|---|
| `/` | Bảng xếp hạng: target, điểm, thanh breakdown, platform, pool, deadline. Filter theo platform/ngôn ngữ/độ tin cậy |
| `/target/[id]` | Chi tiết từng signal kèm evidence; danh sách file có nút copy để dán vào scope Kritt; lịch sử audit |
| `/merge-queue` | Duyệt `MergeCandidate` |
| `/health` | Trạng thái `CollectorRun`, collector nào đang hỏng |
| `/outcomes` | Nhập kết quả submit và xem tương quan tín hiệu ↔ tiền |

## 10. Xử lý lỗi

- **Cô lập lỗi**: một collector hỏng không chặn các collector khác. Mọi lần chạy
  ghi vào `CollectorRun` kèm status và error.
- **Rate limit**: token bucket theo từng host, tôn trọng `Retry-After`, backoff
  luỹ thừa có jitter.
- **Circuit breaker**: 5 lần hỏng liên tiếp thì tắt collector đó và báo lên
  `/health`.
- **robots.txt**: collector Playwright kiểm tra trước mỗi host, cache 24h.
- **Thiếu credential**: collector khai `requiresCredential` mà thiếu env thì bị bỏ
  qua có ghi log, không phải lỗi.
- **Idempotency**: ràng buộc UNIQUE trên contentHash khiến chạy lại không sinh
  bản ghi trùng.
- **Secrets**: chỉ trong `.env`, không commit.

## 11. Chiến lược test

- **Scoring** (`packages/core`): unit + property test. Bất biến cần khẳng định —
  điểm đơn điệu theo từng signal, luôn nằm trong [0,100], signal có confidence 0
  không làm đổi thứ hạng tương đối của các target khác.
- **Collectors**: test bằng fixture, không chạm mạng. Fixture ghi từ response thật.
- **Entity resolution**: bộ test vàng gồm các alias đã biết. Khẳng định **không có
  false merge** ở tầng 1 và 2 — đây là test quan trọng nhất trong repo.
- **Integration**: `docker compose up postgres`, chạy migration, seed, kiểm tra
  pipeline đầu-cuối.
- **Dashboard**: Playwright e2e cho luồng xếp hạng và luồng duyệt merge.

## 12. Chia pha

1. **Pha 1** — monorepo, Prisma schema, resolver tầng 1+2, collector nhóm contest
   + GitHub, `audit_gap` + `freshness`, dashboard `/` và `/target/[id]`.
   *Kết thúc pha 1 là đã dùng được để kiếm tiền thật.*
2. **Pha 2** — DefiLlama + Etherscan, `value_at_risk`, `/outcomes`.
3. **Pha 3** — collector Playwright, `competition`, `/health`.
4. **Pha 4** — nguồn cộng đồng, resolver tầng 3, `/merge-queue`.

## 13. Rủi ro đã biết

- **Entity resolution sai âm thầm** — giảm thiểu bằng nguyên tắc không tự merge và
  bộ test vàng. Đây là rủi ro số một.
- **Map audit report → commit date** thường không có sẵn; nhiều report không ghi
  commit. Fallback dùng `publishedAt`, và đánh dấu `confidence` thấp hơn.
- **Selector Playwright dễ vỡ** — cô lập ở pha 3 để không kéo đổ pha 1.
- **Trọng số ban đầu là phỏng đoán** — chấp nhận, và đó chính là lý do có `Outcome`.
- **Nguồn có thể đổi ToS hoặc chặn** — thiết kế cho phép tắt từng collector qua
  config mà không phải sửa code.
