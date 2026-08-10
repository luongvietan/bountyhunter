# kritt-radar — A–Z Automation (Aggressive / Hybrid)

Ngày: 2026-08-04
Trạng thái: đã duyệt

## 1. Mục tiêu

Operator không còn phải bấm từng bước hàng ngày. Pipeline tự chạy sync →
auto-merge → dispatch → ingest → auto-triage. Người chỉ xử lý case mơ hồ,
submit bounty platform, và settle outcome thật.

## 2. Quyết định đã chốt

| Chủ đề | Chốt |
|---|---|
| Mức độ automation | B — aggressive: AI auto-dismiss noise + auto-approve merge confidence cao |
| AI placement | Hybrid — merge ở Radar LLM; finding triage qua Open-Kritt post-script |
| Auto-submit bounty | Không bao giờ |
| Auto-update weights | Không |
| Dispatch | Tự động trong `pnpm automate` nếu Kritt healthy |
| Merge ngưỡng cứng | ≥0.92 auto; 0.85–0.91 LLM; <0.85 pending |

## 3. Ranh giới

### Tự động

- Sync catalog + GitHub + signals + rank
- Regenerate `manual-programs.yml` (best-effort)
- Auto-approve merge (high confidence + AI borderline)
- `dispatch --apply` theo lịch (`KRITT_MAX_SCANS` vẫn áp dụng)
- Watch/ingest + retry scan
- Auto-dismiss finding: `inScope=false`, `postScriptValid=false`, triage verdict noise/invalid

### Bắt buộc thủ công

- Submit lên bounty platform
- Settle outcome (accepted/duplicate/invalid + payout)
- Merge pending sau conflict / AI không chắc
- Finding không bị auto-dismiss
- Chỉnh `aliases.yml`, `exclusions.yml`, approve weights
- `pnpm provision` một lần khi setup Kritt

## 4. Orchestrator

```
pnpm automate
  → regenerate manual-programs (best-effort)
  → sync
  → auto-merge
  → dispatch --apply (nếu RADAR_AUTOMATE_DISPATCH=true và Kritt up)
  → watch (timeout 25 phút)
```

Ghi `OpsEvent(kind='automate')` mỗi lần chạy.

## 5. Auto-merge (Radar)

Ngưỡng fail-closed:

| Similarity | Hành vi |
|---|---|
| ≥ 0.92 | Auto-approve nếu không conflict |
| 0.85–0.91 | LLM Radar; approve nếu confidence ≥ 0.85 |
| < 0.85 | Pending |

Conflict checks: hard-key khác nhau không có alias chung; excluded owner; đã rejected.

Schema: `MergeCandidate.decidedBy`, `MergeCandidate.decisionNote`.

## 6. Finding triage (Open-Kritt + Radar)

Post-script chain mở rộng:

```
PoC Creator,Report Creator,Is Malicious Actor in scope,Finding Triage
```

Ingest auto-dismiss:

1. `inScope === false` hoặc `postScriptValid === false` → `decidedBy=auto`
2. `triageVerdict` = noise/invalid từ Finding Triage → `decidedBy=ai`
3. Còn lại → `status=new`

Schema: `Finding.decidedBy`, `Finding.triageReason`.

## 7. Env

- `RADAR_AUTO_MERGE=true`
- `RADAR_AUTO_MERGE_MIN=0.92`
- `RADAR_AUTO_MERGE_AI_MIN=0.85`
- `RADAR_AUTO_TRIAGE=true`
- `RADAR_AUTOMATE_DISPATCH=true`
- `RADAR_AUTOMATE_DRY_RUN=false`
- `RADAR_LLM_API_URL`, `RADAR_LLM_API_KEY`, `RADAR_LLM_MODEL`

## 8. Ngoài phạm vi

- Auto-submit bounty
- Auto-write `weights.yml`
- Telegram/Discord alerts
- `competition` signal extractor
