# kritt-radar — Audit Gap Data Foundation

Ngày: 2026-08-03
Trạng thái: đã duyệt

## 1. Mục tiêu

Nối `audit-report-repos` và `github-repo-activity` vào pipeline để mỗi repo scope
có tín hiệu `audit_gap` kèm evidence hành động được: HEAD SHA, commit SHA, ngày
audit gần nhất và danh sách file thay đổi để đưa vào Open-Kritt.

Task này đồng thời tạo data foundation cho dashboard `/merge-queue`: alias bền
vững trong Postgres và fuzzy merge candidate có thể approve/reject. Dashboard là
spec riêng tiếp theo; task hiện tại không dựng UI tạm.

## 2. Nguyên tắc

- Exact match được tự động áp dụng; fuzzy match không bao giờ tự động merge.
- Thiếu dữ liệu khác với giá trị 0. Snapshot GitHub không đầy đủ phải làm giảm
  confidence hoặc trả `confidence=0`.
- Collector chỉ fetch và chuẩn hoá; resolver quyết định identity; materializer
  ghi database và tính signal; scorer không gọi mạng.
- Observation tiếp tục append-only. Signal phải lưu observation IDs đã dùng để
  có thể truy nguồn và replay.
- Không clone hàng trăm repo. Dùng GitHub REST HEAD/tree/compare để giới hạn chi
  phí mạng và disk.
- Một repo lỗi không được làm hỏng toàn bộ lần sync.

## 3. Phạm vi

### Trong phạm vi

- Materialize Entity và exact aliases cho Program/Scope.
- Materialize AuditReport idempotently.
- Sinh MergeCandidate từ audit hint bằng token overlap và normalized edit
  similarity.
- Lưu alias đã duyệt trong Postgres để dashboard sau này sử dụng.
- Thu GitHub HEAD, recursive tree và compare result theo audit cutoff.
- Cập nhật `Scope.commitish` và upsert `audit_gap` Signal.
- Thêm lệnh `pnpm sync` chạy pipeline hai pha trong đúng thứ tự.
- Ghi trạng thái collector `partial` khi chỉ một phần repo thất bại.

### Ngoài phạm vi

- UI `/merge-queue` và endpoint approve/reject.
- Fuzzy auto-merge.
- Clone repo hoặc đếm LOC chính xác bằng checkout local.
- Tự chạy Open-Kritt scan.
- Các signal pha sau như competition và value-at-risk.

## 4. Kiến trúc

Materializer được chia thành các stage có interface riêng:

1. `materializeCatalog`: Observation program → Program, Scope và Entity.
2. `materializeAuditReports`: audit observations → provisional audit Entity và
   AuditReport.
3. `materializeMergeCandidates`: provisional audit Entity → exact alias hoặc
   pending fuzzy MergeCandidate.
4. `materializeRepoSignals`: GitHub snapshot observations → Scope.commitish và
   Signal audit_gap.

`collect` bổ sung `audit-report-repos`. `github-repo-activity` vẫn được tạo bằng
factory nhưng callback được mở rộng từ `listRepoKeys()` thành
`listRepoTargets()`. Callback đọc scope, entity và audit đã materialize, nên một
lệnh `sync` phải chạy theo hai pha:

```text
program/audit collectors
        ↓
catalog + audit + candidate materialization
        ↓
derive repo targets from DB
        ↓
GitHub snapshot collector
        ↓
repo signal materialization
        ↓
rank
```

Các lệnh `collect`, `materialize`, `rank` riêng vẫn tồn tại để debug và replay.

## 5. Data model

### EntityAlias

```text
id, entityId, kind(repo|platform_name|audit_hint), key, source,
createdAt, UNIQUE(kind, key)
```

`config/aliases.yml` là bootstrap source. Materializer đồng bộ các rule trong
file vào EntityAlias. Alias được dashboard approve sau này có `source=manual` và
không bị lần sync config kế tiếp xoá.

### MergeCandidate

```text
id, leftEntityId, rightEntityId, similarity, status(pending|approved|rejected),
reason jsonb, decidedAt, createdAt, UNIQUE(leftEntityId, rightEntityId)
```

`leftEntityId` là provisional entity sinh từ audit `projectHint`;
`rightEntityId` là entity của program được đề xuất. Candidate rejected không
được tạo lại ở lần materialize sau.

### AuditReport

Bổ sung `projectHint` và `observationIds`. `reportUrl` trở thành unique để replay
observation không tạo bản ghi trùng. AuditReport luôn thuộc một Entity; trước khi
được exact-match hoặc approve, nó thuộc provisional audit Entity.

### Existing models

- `Program.entityId` được điền sau exact resolution.
- `Scope.commitish` lưu HEAD commit SHA của snapshot mới nhất đã materialize.
- GitHub snapshot không có bảng riêng; nó nằm trong Observation.
- Signal lưu IDs của GitHub và audit observations đã dùng.

## 6. Entity resolution

Mỗi repo scope có một entity xác định:

- Alias `repo` hoặc `platform_name` exact → entity canonical trong alias.
- Không có alias → entity deterministic từ normalized repo key. Đây không phải
  fuzzy merge; repo key vẫn là hard identity.

Audit report được đưa vào provisional entity deterministic từ normalized
`projectHint`.

Resolver thử theo thứ tự:

1. Exact `audit_hint` alias trong EntityAlias.
2. Exact normalized audit hint với entity slug/canonical tokens.
3. Fuzzy scoring để tạo candidate, không thay đổi entityId.

Fuzzy score kết hợp token Jaccard và normalized Levenshtein. Chỉ candidate vượt
ngưỡng cấu hình mới được lưu. Tất cả candidate vẫn ở `pending` cho tới khi người
dùng duyệt.

Khi approve ở dashboard trong task sau, hệ thống sẽ:

1. Tạo `audit_hint` EntityAlias trỏ tới entity đích.
2. Chuyển AuditReport từ provisional entity sang entity đích.
3. Đánh dấu candidate approved.
4. Đánh dấu các repo liên quan cần GitHub refetch trước khi recompute audit_gap.

## 7. GitHub snapshot

Callback collector trả mỗi target:

```ts
interface RepoTarget {
  repoKey: string;
  pathGlobs: string[];
  lastAuditAt: string | null;
  coveredCommit: string | null;
}
```

Với mỗi target, collector thực hiện:

1. Đọc HEAD commit để lấy SHA và authored date.
2. Đọc recursive tree tại HEAD để lấy file paths và blob byte sizes.
3. Lọc tree theo `pathGlobs`.
4. Ước lượng `totalLoc = ceil(totalBlobBytes / 40)`. Evidence phải ghi
   `locMethod=estimated_from_bytes` và confidence không được bằng 1.
5. Nếu có `coveredCommit`, compare trực tiếp `coveredCommit...HEAD`.
6. Nếu chỉ có `lastAuditAt`, tìm commit gần nhất không muộn hơn ngày audit rồi
   compare commit đó tới HEAD.
7. Nếu không có audit, giữ tree files và HEAD SHA làm evidence
   `no_public_audit`.

Normalized payload chứa repo key, cutoff đã dùng, HEAD SHA/date, scoped tree
files, estimated LOC, changed files, compare commit SHAs, completeness và error
metadata. Snapshot được tính cho đúng cutoff tại thời điểm fetch; nếu mapping
audit thay đổi thì phải refetch, không tái diễn giải snapshot cũ.

GitHub tree/compare có thể trả kết quả truncated. Payload phải giữ cờ này và
materializer giảm confidence. Snapshot thất bại hoàn toàn có `complete=false`
và tạo `audit_gap confidence=0` với reason cụ thể.

## 8. Materialize audit_gap

Materializer tìm snapshot mới nhất khớp `repoKey` và audit cutoff hiện tại.

- `Scope.commitish = headSha` khi snapshot có HEAD hợp lệ.
- Có audit + complete compare: tính value từ changed LOC / estimated total LOC.
- Không có public audit + complete tree: `value=1`, evidence gồm HEAD và scoped
  file list.
- Snapshot missing, stale cutoff hoặc failed: `confidence=0`, không giả thành
  `value=0`.
- Tree/compare truncated hoặc LOC ước lượng: confidence giảm có giải thích trong
  evidence.

Evidence tối thiểu:

```text
headSha, sinceCommit, sinceDate, files[], commits[], changedLoc, totalLoc,
locMethod, complete, truncated
```

## 9. Error handling và health

- Thiếu `GITHUB_TOKEN`: GitHub collectors bị skip có log, các stage còn lại vẫn
  chạy.
- 404, rate-limit, malformed payload hoặc truncated result được cô lập theo repo.
- Collector tiếp tục các repo khác và ghi failure observation cho repo lỗi.
- CollectorRun dùng `partial` nếu có cả thành công và thất bại, `error` nếu không
  repo nào thành công.
- Materializer không xoá signal tốt cũ khi snapshot mới thất bại; nó cập nhật
  confidence/evidence để dashboard thấy dữ liệu hiện không đáng tin.

## 10. Testing

### Unit

- Parse HEAD/tree/compare fixture có hình dạng thật.
- `pathGlobs`, LOC estimate và truncated behavior.
- Exact aliases tự resolve; fuzzy chỉ tạo pending candidate.
- Candidate idempotent và rejected candidate không tái xuất hiện.
- Snapshot lỗi cho audit_gap confidence 0.
- Scope.commitish lấy đúng HEAD SHA.

### Integration với Postgres

- Replay observations không tạo trùng Entity, Alias, AuditReport, Candidate hoặc
  Signal.
- Alias approved chuyển report đúng entity khi materialize lại.
- Program mới trong cùng `sync` xuất hiện trong repo target phase.
- Một repo lỗi không ngăn repo khác cập nhật.

### End-to-end

- `pnpm sync` hoàn tất với token hợp lệ.
- `pnpm rank` hiển thị freshness và audit_gap.
- Target audited có sinceDate, HEAD SHA, commit SHA và changed files.
- Target thiếu GitHub data hiển thị `[no data: audit_gap]`.
- Full test, typecheck và build xanh.

## 11. Delivery

Thực hiện trên feature branch theo TDD và commit theo từng task. Sau verification
cuối, tự merge vào `main`. Push được thực hiện tự động nếu repo có remote/upstream;
nếu chưa cấu hình remote, merge local vẫn hoàn tất và trạng thái push được báo rõ.
