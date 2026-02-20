# PPTX Rerun Verification Guide

Use this checklist after shipping the DPU freshness fix to confirm that re-running analysis on a PPTX deal produces correct workspace updates without a page reload.

## Root Cause Summary (Background)

`forceRefresh=true` sends `min_dpu_created_at=now()` to the API.  
The readiness gate checks `MAX(dpu.created_at)` — but the DPU UPSERT previously only advanced `updated_at`, leaving `created_at` stuck at the original insertion time.  
Result: every rerun landed in `blocked_reason=DPU_STALE` permanently.

**Fix applied:**
- All three DPU UPSERT conflict handlers now set `created_at = now()`
- Freshness query uses `GREATEST(created_at, COALESCE(updated_at, created_at))`
- SSE `analyze_deal` succeeded handler now calls `startOverlayPostAnalyzePolling()` and clears `pageUnderstandingGate`

---

## Pre-Flight: Capture Baseline

```bash
DEAL_ID="<your-pptx-deal-uuid>"

# Snapshot DPU state before rerun
pnpm --filter worker exec tsx src/scripts/inspect-pptx-dpu.ts --deal-id "$DEAL_ID"

# Note analysis_version from the deals table or UI header (e.g. v8)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/v1/deals/$DEAL_ID/readiness" | jq '{ready, blocked_reason, dpu_rows_total, expected_pages_total}'
```

---

## Rerun Trigger

1. Open the deal workspace in the browser — **stay on the page**.
2. Click **Run Analysis** (or re-run from More → Run Full Process if PPTX needs re-extraction).
3. Watch the toast notification — it should show `upserted=N` (N = total expected pages).

---

## Checklist (Run After Rerun Completes)

Run the inspection script immediately after the job toast shows "succeeded":

```bash
pnpm --filter worker exec tsx src/scripts/inspect-pptx-dpu.ts --deal-id "$DEAL_ID"
```

| # | Criterion | Expected |
|---|-----------|---------|
| 1 | `rendered_pages populated` | ✅ — `page_count > 0` for every PPTX document |
| 2 | `DPU rows = expected (all docs)` | ✅ — `dpu_rows_total == expected_pages_total` |
| 3 | `missing_pages = 0` | ✅ — checklist item 3 prints ✅ |
| 4 | `latest_dpu_freshness_ts present` | ✅ — timestamp is from the rerun, not the original ingest |
| 5 | `readiness ready=true, blocked_reason=null` | ✅ — confirmed by checklist item 5 |
| 6 | `analyze_deal succeeded` | ✅ — checklist item 6 prints ✅ with a job ID |
| 7 | Report version increments | ✅ — `analysis_version` in UI header is `old+1` |

---

## Readiness Endpoint Verification

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/v1/deals/$DEAL_ID/readiness" \
  | jq '{ready, blocked_reason, dpu_rows_total, expected_pages_total, latest_dpu_created_at}'
```

Expected output:

```json
{
  "ready": true,
  "blocked_reason": null,
  "dpu_rows_total": 31,
  "expected_pages_total": 31,
  "latest_dpu_created_at": "2025-02-20T..."
}
```

If `blocked_reason` is `DPU_STALE`, the DPU UPSERT `created_at` fix was not applied or the worker is running old code. Restart the worker container: `docker restart <worker>`.

---

## UI Verification (No Page Reload)

After analysis succeeds:

1. The **Page Understanding Status** widget should disappear or show ✅ (gate cleared).
2. The **governed overlay panel** (workspace fields) should refresh automatically within 45 s — no manual reload needed.
3. The **header score + KPI tiles** should reflect the new analysis.

If the overlay does not refresh:
- Check that `startOverlayPostAnalyzePolling()` was invoked (browser console in debug mode shows `OVERLAY_POST_ANALYZE_POLLING_STARTED`).
- Ensure no duplicate `analyze_deal` succeeded SSE events are triggering a polling reset — the job_id guard prevents this.

---

## Overlay Refresh Manual Check

```bash
# Govened overlay persisted endpoint
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/v1/deals/$DEAL_ID/governed-overlay-persisted" \
  | jq '{created_at: .overview.created_at, input_hash: .overview.input_hash}'
```

The `created_at` should be later than the pre-flight baseline.

---

## Regression Guard

The following tests lock these behaviors:

- **`apps/worker/src/lib/__tests__/document-page-understanding.test.ts`** — `"UPSERT conflict handler advances created_at for freshness anchor (rerun regression)"`
- **`apps/api/src/__tests__/deal-page-understanding-readiness.test.ts`** — `"freshness query uses GREATEST to respect rerun upserts"`
- **`apps/web/src/__tests__/DealWorkspace.test.tsx`** — `"analyze_deal SSE succeeded: overlay polling fires once per unique job_id"`
