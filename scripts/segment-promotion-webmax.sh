#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:9000}"
DEAL_ID="${DEAL_ID:-cfe708f6-7195-4c3b-a66f-9cdb7892b970}"
DOC_ID="${DOC_ID:-75f77340-84d3-4163-a66f-9e9fde358bfc}"

# Thresholds (can be overridden via env)
AUTO_ACCEPT_THRESHOLD="${AUTO_ACCEPT_THRESHOLD:-0.6}"
REVIEW_THRESHOLD="${REVIEW_THRESHOLD:-0.45}"
REJECT_THRESHOLD="${REJECT_THRESHOLD:-0.25}"

TS="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="docs/Reports/${TS}_segment_promotion_webmax"
mkdir -p "$OUT_DIR"

jq_doc_pages='(
  .segment_audit_report.documents[]
  | select(.document_id==$doc)
  | {title, document_id,
     pages: (.items|map({page:.page_label, persisted:.segment, source:.segment_source}))}
)'

jq_doc_items='(
  .segment_audit_report.documents[]
  | select(.document_id == $doc)
  | .items
  | map({
      page: .page_label,
      persisted: .persisted_segment_key,
      computed: .computed_segment,
      best_score: (.computed_reason.best_score // null),
      threshold: (.computed_reason.threshold // null),
      snippet: (.captured_text // .snippet // "")[0:160]
    })
)'

jq_dist='(
  .segment_audit_report.documents[]
  | select(.document_id==$doc)
  | .items
  | map(.persisted_segment_key // .segment // "unknown")
  | group_by(.)
  | map({segment: .[0], count: length})
  | sort_by(-.count)
)'

echo "Writing outputs to $OUT_DIR" >&2

echo "[1/5] Baseline persisted segments (segment_audit only)" >&2
curl -sS "$API_BASE_URL/api/v1/deals/$DEAL_ID/lineage?debug_segments=1&segment_audit=1" \
| jq --arg doc "$DOC_ID" "$jq_doc_pages" \
> "$OUT_DIR/01_baseline_persisted_pages.json"

curl -sS "$API_BASE_URL/api/v1/deals/$DEAL_ID/lineage?debug_segments=1&segment_audit=1" \
| jq --arg doc "$DOC_ID" "$jq_dist" \
> "$OUT_DIR/01_baseline_persisted_distribution.json"

echo "[2/5] Audit persisted vs computed (segment_rescore=1)" >&2
curl -sS "$API_BASE_URL/api/v1/deals/$DEAL_ID/lineage?debug_segments=1&segment_audit=1&segment_rescore=1" \
| jq --arg doc "$DOC_ID" "$jq_doc_items" \
> "$OUT_DIR/02_audit_persisted_vs_computed.json"

echo "[3/5] DRY RUN promotion (no DB writes)" >&2
curl -sS -X POST "$API_BASE_URL/api/v1/deals/$DEAL_ID/segments/promote" \
  -H 'content-type: application/json' \
  -d "{\"document_ids\":[\"$DOC_ID\"],\"dry_run\":true,\"persist_artifact\":true,\"auto_accept_threshold\":$AUTO_ACCEPT_THRESHOLD,\"review_threshold\":$REVIEW_THRESHOLD,\"reject_threshold\":$REJECT_THRESHOLD}" \
| jq '.' \
> "$OUT_DIR/03_dry_run_promotion.json"

IDEMPOTENCY_KEY="webmax_${TS}"

echo "[4/5] APPLY promotion (idempotent; writes quality_flags.segment_key)" >&2
curl -sS -X POST "$API_BASE_URL/api/v1/deals/$DEAL_ID/segments/promote" \
  -H 'content-type: application/json' \
  -d "{\"document_ids\":[\"$DOC_ID\"],\"dry_run\":false,\"persist_artifact\":true,\"idempotency_key\":\"$IDEMPOTENCY_KEY\",\"auto_accept_threshold\":$AUTO_ACCEPT_THRESHOLD,\"review_threshold\":$REVIEW_THRESHOLD,\"reject_threshold\":$REJECT_THRESHOLD}" \
| jq '.' \
> "$OUT_DIR/04_apply_promotion.json"

echo "[5/5] Post-check (no rescore): persisted should now reflect promotions" >&2
curl -sS "$API_BASE_URL/api/v1/deals/$DEAL_ID/lineage?segment_audit=1" \
| jq --arg doc "$DOC_ID" "$jq_doc_pages" \
> "$OUT_DIR/05_postcheck_persisted_pages.json"

curl -sS "$API_BASE_URL/api/v1/deals/$DEAL_ID/lineage?segment_audit=1" \
| jq --arg doc "$DOC_ID" "$jq_dist" \
> "$OUT_DIR/05_postcheck_persisted_distribution.json"

echo "Done. See $OUT_DIR" >&2
