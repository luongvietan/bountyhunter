# kritt-radar — Pha 2: DefiLlama, Etherscan, value_at_risk, /outcomes

Ngày: 2026-08-04
Trạng thái: chờ duyệt

## 1. Mục tiêu & phạm vi

Bổ sung tín hiệu tiền (`value_at_risk`) từ dữ liệu on-chain/bounty pool và vòng
phản hồi Outcome để operator thấy tín hiệu nào gắn với payout. Không tự sửa
`weights.yml`.

### Trong phạm vi

- Collector `defillama-tvl`: kéo TVL protocols công khai, Observation theo slug.
- Collector `etherscan-verified`: mọi Scope có `chain+address`; ghi trạng thái
  verified source; materialize/xác nhận hard key. Không sinh signal riêng.
- Extractor `value_at_risk` với chuẩn hoá p95 trên batch đang rank.
- Prisma model `Outcome` + `ProtocolTvl`.
- Alias kind mới `defillama` trong `EntityAlias` / `aliases.yml`.
- Dashboard `/outcomes`: form nhập, lịch sử, Pearson + Spearman + bảng tertile.
- UI bám `DESIGN.md` và console hiện có (`ConsoleNavbar`, targets, merge-queue).

### Ngoài phạm vi

- Tự động cập nhật trọng số từ Outcome.
- Signal mới ngoài bốn loại đã có.
- Fuzzy khớp tên DefiLlama → entity (không tự merge).
- Auth, alert, Playwright scrape, `/health` đầy đủ (Pha 3).
- Mockup UI riêng — tái sử dụng style đã ship.

### Quyết định đã chốt

| Chủ đề | Chốt |
|---|---|
| Vai trò Etherscan | Chỉ entity/scope + evidence; không điều chỉnh `value_at_risk` |
| `/outcomes` | Ghi Outcome + tương quan đọc; không đụng `weights.yml` |
| DefiLlama coverage | Kéo toàn bộ TVL; chỉ entity có alias `defillama` mới nhận `tvlUsd` (pool vẫn đủ để ra VaR) |
| Chuẩn hoá VaR | Trần p95 (nearest-rank) trên các scope có dữ liệu trong batch rank |
| Chuỗi Etherscan | Mọi chain có address trong Scope; thiếu explorer → skip + log |
| Tương quan | Pearson + Spearman + trung bình payout theo tertile |

## 2. Nguyên tắc

- Collector chỉ fetch + chuẩn hoá. Extractor/scorer thuần, không gọi mạng.
- Thiếu dữ liệu ≠ 0: không có `poolUsd`/`tvlUsd` thì `confidence: 0`.
- Observation append-only + `contentHash` idempotent.
- Fuzzy không bao giờ tự merge protocol DefiLlama vào entity.
- Etherscan fail-soft theo chain: một chain hỏng không chết cả collector run.
- Secrets chỉ trong `.env` (`ETHERSCAN_API_KEY`).

## 3. Kiến trúc & luồng dữ liệu

```text
defillama-tvl ──────┐
                    ├─→ Observation
etherscan-verified ─┘        ↓
              materialize ProtocolTvl / contract Scope
                             ↓
              EntityAlias(kind=defillama) từ aliases.yml
                             ↓
              extract value_at_risk → Signal → Scorer → Score
                             ↓
              /targets (đã có) + /outcomes (Outcome nhập tay)
```

Đồng bộ pha 2 mở rộng pipeline hiện có (không thêm service):

```text
collect-catalog (+ defillama-tvl)
        ↓
materialize-catalog (+ ProtocolTvl)
        ↓
collect-github / contract verify (etherscan-verified đọc Scope từ DB)
        ↓
materialize-signals (+ value_at_risk)
        ↓
rank
```

`etherscan-verified` chạy sau khi catalog đã materialize vì input là
`(chain, address)` distinct từ Scope. DefiLlama không phụ thuộc Scope nên chạy
cùng nhóm catalog.

## 4. Data model

### ProtocolTvl

Materialize từ Observation `defillama-tvl` — một dòng mới nhất theo slug:

```text
slug          String   @id
name          String
tvlUsd        Decimal  @db.Decimal(20, 2)
chains        String[]
observationId String
fetchedAt     DateTime
```

### EntityAlias

Mở rộng `AliasKind` thêm `defillama`. Key là slug DefiLlama (lowercase).

`config/aliases.yml`:

```yaml
uniswap-v4:
  canonicalName: Uniswap v4
  match:
    - repo: github.com/uniswap/v4-core
    - defillama: uniswap-v4
```

Bootstrap từ YAML vào Postgres giống các kind hiện có; alias `source=manual` từ
dashboard không bị sync config xoá.

### Outcome

```text
id              String
scopeId         String   → Scope
action          String   # scan | submit | note
submittedAt     DateTime
result          String   # accepted | duplicate | invalid | pending
payoutUsd       Decimal? @db.Decimal(20, 2)
notes           String?
signalSnapshot  Json     # { type: { value, confidence } } tại thời điểm ghi
createdAt       DateTime @default(now())

@@index([scopeId, submittedAt])
@@index([result, submittedAt])
```

`signalSnapshot` đóng băng giá trị signal lúc operator ghi Outcome để tương quan
không bị drift khi extractor chạy lại.

### Scope / Signal

Không đổi schema Signal. `value_at_risk` upsert theo `@@unique([scopeId, type])`
như các signal khác. Scope contract dùng `hardKey` từ
`normalizeChainAddress(chain, address)`.

## 5. Collectors

### `defillama-tvl`

- Nguồn: `GET https://api.llama.fi/protocols` (công khai, không credential).
- Cadence: `0 */6 * * *`.
- Rate limit: ~1 rps, burst 2.
- Mỗi protocol một Observation: `sourceUrl` ổn định theo slug,
  payload `{ slug, name, tvlUsd, chains[] }`.
- Bỏ protocol `tvl` null/âm hoặc thiếu slug.
- Fixture: response thật đã cắt nhỏ trong `__fixtures__/`.
- Parse ra 0 protocol từ body 200 hợp lệ là lỗi (giống quy tắc HTML collectors).

### `etherscan-verified`

- Credential: `ETHERSCAN_API_KEY` (`requiresCredential`).
- Cadence: `0 */12 * * *`.
- Input: distinct `(chain, address)` từ Scope có đủ hai field.
- API: Etherscan API V2 (hoặc tương đương theo chain id) — một key, map
  `chain` → `chainid`. Bảng map nằm trong collector config; chain không có trong
  map → skip + ghi log, không lỗi run.
- Solana / non-EVM: skip (Etherscan family không cover); không fail.
- Payload: `{ chain, address, verified, contractName, compiler?, sourceUrl }`.
- Rate limit token-bucket theo host; tôn trọng rate limit response.
- Materialize: đảm bảo Scope `kind=contract` có `hardKey`; không tạo Signal.
  Trạng thái verified chỉ nằm trong Observation/evidence để operator đọc sau.

## 6. Extractor `value_at_risk`

Hàm thuần trong `packages/pipeline` (và helper chuẩn hoá có thể đặt
`packages/core` nếu replay/test dùng chung).

### Input theo scope

- `poolUsd`: `Program.poolUsd` của scope (null nếu thiếu).
- `tvlUsd`: nếu entity của program có `EntityAlias(kind=defillama)` khớp
  `ProtocolTvl.slug` thì lấy `tvlUsd`, ngược lại null.
- `dollars = max(poolUsd ?? -∞, tvlUsd ?? -∞)` chỉ khi ít nhất một bên có số.

### Công thức

```text
nếu không có dollars:
  value = 0, confidence = 0, evidence.reason = "no_pool_or_tvl"

raw_i = log1p(dollars_i)          # chỉ các scope có dữ liệu
ceiling = nearest_rank_percentile(raws, 0.95)
nếu ceiling <= 0:
  value = 0, confidence = 0       # edge case batch trống/đều 0

value_i = clamp01(raw_i / ceiling)
confidence = 1
evidence = {
  poolUsd, tvlUsd, dollars, raw, ceiling, p95BatchSize,
  defillamaSlug?, basis: "pool" | "tvl" | "both"
}
```

p95 chỉ tính trên scope **có dữ liệu** trong cùng lần `rank`/`materialize-signals`.
Nearest-rank: sắp `raws` tăng dần, lấy phần tử tại
`ceil(0.95 * n) - 1` (clamp trong [0, n-1]). Scope trên p95 bị clamp về 1.0.
Replay trên cùng batch cho cùng kết quả; thêm target mới có thể đổi ceiling —
chấp nhận vì đã chọn chuẩn hoá phân vị.

Khi chỉ có `poolUsd` (chưa alias DefiLlama): vẫn ra signal với `basis: "pool"`,
`confidence: 1`. Alias chỉ bổ sung TVL, không phải điều kiện bắt buộc nếu đã có
pool.

## 7. Dashboard `/outcomes`

### Lớp code (bám merge-queue)

- `apps/web/src/lib/outcomes.ts` — đọc danh sách Outcome + aggregate tương quan.
- `apps/web/src/lib/outcome-mutations.ts` — tạo Outcome + chụp `signalSnapshot`.
- `apps/web/src/lib/outcome-correlation.ts` — thuần: Pearson, Spearman, tertile.
- Route `app/outcomes/page.tsx` + server action tạo bản ghi.
- Thêm mục **Outcomes** vào `ConsoleNavbar`.

### Form tạo Outcome

Fields: scope (chọn từ target/scope có score), `action`, `submittedAt`,
`result`, `payoutUsd` (optional), `notes` (optional). Khi submit, server đọc
signal hiện tại của scope và lưu vào `signalSnapshot`.

### Lịch sử

Bảng dense: thời gian, target/scope, action, result, payout, ghi chú ngắn.
Filter URL: `result=`, sort `submittedAt` desc. Empty state giải thích chưa có
bản ghi.

### Tương quan (đọc)

Với mỗi `SIGNAL_TYPES`, trên các Outcome có `payoutUsd != null` và
`signalSnapshot[type].confidence >= weights.minConfidence` (cùng ngưỡng scorer):

1. **Pearson** và **Spearman** giữa `signal.value` và `payoutUsd`.
2. **Tertile**: chia signal value thành thấp/giữa/cao (càng đều càng tốt; n < 3
   thì không chia), báo `avg(payoutUsd)` và count mỗi nhóm.

`n < 5`: hiện cảnh báo “chưa đủ mẫu”, vẫn render số nhưng đánh dấu unstable.
Không có nút “áp dụng trọng số”.

### UI

Tái sử dụng token/`DESIGN.md`, masthead, form native, bảng dense như
`/targets` và `/merge-queue`. Không card trang trí, không chart library nặng —
bảng số + nhãn là đủ.

## 8. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| DefiLlama HTTP/parse lỗi | `CollectorRun status=error`, collectors khác chạy tiếp |
| DefiLlama 200 nhưng 0 protocol | error (coi như parser/fixture vỡ) |
| Thiếu `ETHERSCAN_API_KEY` | harness bỏ qua collector (requiresCredential) |
| Chain không map được explorer | skip address đó, run vẫn ok/partial |
| Etherscan rate limit | backoff + Retry-After; quá ngưỡng → partial/error có log |
| Scope không có pool lẫn tvl | Signal `value_at_risk` confidence 0 |
| Outcome form thiếu scope/result | validation lỗi, không ghi DB |
| Tương quan n nhỏ | cảnh báo UI, không ẩn toàn bộ |

## 9. Chiến lược test

- **Unit (`core`/`pipeline`)**: `value_at_risk` — thiếu dữ liệu → confidence 0;
  p95 clamp; chỉ pool; chỉ tvl; both lấy max; monotonic theo dollars trong một
  batch cố định.
- **Unit correlation**: Pearson/Spearman trên fixture số; tertile boundaries;
  n < 5 flag; bỏ signal confidence thấp / payout null.
- **Collector fixtures**: DefiLlama + Etherscan parse offline; chain unmapped
  không throw; verified/unverified payload.
- **Integration DB**: materialize `ProtocolTvl`; alias `defillama` join đúng
  entity; tạo Outcome + snapshot; không đụng weights file.
- **Web**: integration/e2e form tạo Outcome hiện trong lịch sử; navbar link
  Outcomes; tương quan render với seed ≥ 5 bản ghi.

## 10. Rủi ro đã biết

- **Coverage alias thấp** — hầu hết target chỉ có `poolUsd` cho đến khi thêm
  dòng `defillama:` thủ công. Chấp nhận; đúng với nguyên tắc không fuzzy merge.
- **p95 nhảy khi tập rank đổi** — điểm tuyệt đối không ổn định跨 ngày; thứ hạng
  tương đối vẫn hữu ích. Ghi `ceiling` trong evidence để giải thích.
- **Etherscan đa chain rate-limit** — mitigate bằng cadence 12h, token bucket,
  partial success.
- **Tương quan sớm nhiễu** — cảnh báo n < 5; cần ~20–30 Outcome mới đáng tin
  (đúng mục tiêu bảng Outcome trong spec gốc).
- **API DefiLlama đổi shape** — fixture + “0 rows = error” bắt sớm.
