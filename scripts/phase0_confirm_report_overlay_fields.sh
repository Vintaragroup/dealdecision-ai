#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:9001}"

PALM_ID="${PALM_ID:-c4f10092-1c94-4116-b4f0-78874868f92b}"
CINCO_ID="${CINCO_ID:-0fcec035-9aa3-4f6e-88fa-818c323add09}"

DEALS=("$PALM_ID" "$CINCO_ID")

for id in "${DEALS[@]}"; do
  echo
  echo "=== REPORT $id ==="
  curl -sS "$API_BASE_URL/api/v1/deals/$id/report" \
    | jq '{ready,version,generatedAt:(.generatedAt//.report.generatedAt//null), deal_summary: (.report.deal_summary | {product:.product.text, market_target:.market_target.text, market:.market.text, market_context:.market_context.text, business_model:.business_model.text}), has_raise:(.report.structured_summary.raise!=null)}'

  echo
  echo "=== OVERLAY $id ==="
  curl -sS "$API_BASE_URL/api/v1/deals/$id/governed-llm-overview" \
    | jq '.overview | {created_at,input_hash,llm_phase_mode, has_governed:(.overview_json.phase1.governed_ui_copy_v1!=null), governed_ui_copy_keys:(.overview_json.phase1.governed_ui_copy_v1|keys), market_icp:(.overview_json.phase1.governed_ui_copy_v1.market_icp//null), product_solution:(.overview_json.phase1.governed_ui_copy_v1.product_solution//null), strengths_len:(.overview_json.phase1.governed_ui_copy_v1.strengths|length? // null), concerns_len:(.overview_json.phase1.governed_ui_copy_v1.concerns|length? // null), open_questions_len:(.overview_json.phase1.governed_ui_copy_v1.open_questions|length? // null), traction_len:(.overview_json.phase1.governed_ui_copy_v1.traction|length? // null), has_evidence_map:(.overview_json.phase1.governed_ui_copy_v1.evidence_map!=null)}'

done
