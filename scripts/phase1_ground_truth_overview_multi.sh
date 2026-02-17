#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:9001}"

DEAL_NAME_MAP_JSON="$(curl -sS "$API_BASE_URL/api/v1/deals" | jq 'map({key:.id, value:(.name // "")}) | from_entries')"

DEALS=(
  "0fcec035-9aa3-4f6e-88fa-818c323add09"  # Cinco
  "c4f10092-1c94-4116-b4f0-78874868f92b"  # Palm
  "5c85f4f1-e38d-426f-b2ad-40db97f97b27"  # Delphi
)

OUT="artifacts/debug_phase1_overview_staleness_multi_$(date -u +%Y%m%dT%H%M%SZ).md"

poll_job() {
  local job_id="$1"
  local max_seconds="${2:-120}"
  local started
  started="$(date +%s)"

  while true; do
    local payload status
    payload="$(curl -sS "$API_BASE_URL/api/v1/jobs/$job_id")"
    status="$(echo "$payload" | jq -r '.status // ""')"

    if [[ "$status" == "succeeded" || "$status" == "failed" || "$status" == "cancelled" || "$status" == "blocked" || "$status" == "succeeded_with_warnings" ]]; then
      echo "$payload" | jq '{job_id,type,status,progress_pct,message,created_at,started_at,updated_at,finished_at}'
      return 0
    fi

    local now elapsed
    now="$(date +%s)"
    elapsed=$((now - started))
    if (( elapsed > max_seconds )); then
      echo "$payload" | jq '{job_id,type,status,progress_pct,message,created_at,started_at,updated_at,finished_at}'
      echo "(timeout waiting for terminal status after ${max_seconds}s)"
      return 1
    fi

    sleep 2
  done
}

{
  echo "# Phase 1 staleness ground truth (multi) ($(date -u))"
  echo
  echo "API_BASE_URL=$API_BASE_URL"
  echo

  for deal_id in "${DEALS[@]}"; do
    deal_name="$(echo "$DEAL_NAME_MAP_JSON" | jq -r --arg id "$deal_id" '.[$id] // ""')"
    deal_label="$deal_id"
    if [[ -n "$deal_name" ]]; then
      deal_label="$deal_name ($deal_id)"
    fi

    echo "---"
    echo
    echo "## Deal $deal_label"

    echo "### Pre-analyze governed overlay signature"
    curl -sS "$API_BASE_URL/api/v1/deals/$deal_id/governed-llm-overview" \
      | jq '.overview | {created_at,input_hash,llm_phase_mode, has_governed_ui_copy_v1:(.overview_json.phase1.governed_ui_copy_v1!=null)}'

    echo
    echo "### Trigger analyze"
    job_id="$(curl -sS -X POST "$API_BASE_URL/api/v1/deals/$deal_id/analyze" -H 'content-type: application/json' -d '{"require_page_understanding":true}' | jq -r '.job_id')"
    echo "queued job_id=$job_id"

    echo
    echo "### Poll job until terminal"
    poll_job "$job_id" 180 || true

    echo
    echo "### Post-analyze governed overlay signature"
    curl -sS "$API_BASE_URL/api/v1/deals/$deal_id/governed-llm-overview" \
      | jq '.overview | {created_at,input_hash,llm_phase_mode, has_governed_ui_copy_v1:(.overview_json.phase1.governed_ui_copy_v1!=null)}'

    echo
    echo "### Report envelope signature"
    curl -sS "$API_BASE_URL/api/v1/deals/$deal_id/report" \
      | jq '{ready, version, generatedAt:(.generatedAt // .report.generatedAt // null)}'

    echo
  done
} > "$OUT"

echo "WROTE $OUT"