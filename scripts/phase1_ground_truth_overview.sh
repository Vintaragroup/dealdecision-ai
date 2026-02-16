#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:9001}"
CINCO="0fcec035-9aa3-4f6e-88fa-818c323add09"

OUT="artifacts/debug_phase1_overview_staleness_$(date -u +%Y%m%dT%H%M%SZ).md"

{
  echo "# Phase 1 ground truth ($(date -u))"
  echo
  echo "API_BASE_URL=$API_BASE_URL"
  echo

  echo "## Deals search (Palm/Delphi)"
  curl -sS "$API_BASE_URL/api/v1/deals" \
    | jq -r '.[]? | [.id, (.name//""), (.company_name//""), (.company//"")] | @tsv' \
    | rg -i 'palm|delphi' || true
  echo

  echo "## Analyze Cinco"
  curl -sS -X POST "$API_BASE_URL/api/v1/deals/$CINCO/analyze" \
    -H 'content-type: application/json' \
    -d '{"require_page_understanding":true}' \
    | jq '{job_id,status}'
  echo

  echo "## Cinco jobs (latest 30)"
  curl -sS "$API_BASE_URL/api/v1/deals/$CINCO/jobs?limit=200" \
    | jq -r '.[0:30][]? | [.job_id, .job_type, .status, (.created_at//""), (.updated_at//""), (.error_code//""), (.error_message//"")] | @tsv'
  echo

  echo "## Cinco governed overlay envelope"
  curl -sS "$API_BASE_URL/api/v1/deals/$CINCO/governed-llm-overview" \
    | jq '.overview | {created_at,input_hash,llm_phase_mode, has_overview_json:(.overview_json!=null), has_phase1:(.overview_json.phase1!=null), has_governed_ui_copy_v1:(.overview_json.phase1.governed_ui_copy_v1!=null), has_deal_overview_v2:(.overview_json.phase1.deal_overview_v2!=null), has_deal_summary_v2:(.overview_json.phase1.deal_summary_v2!=null)}'
  echo

  echo "## Cinco report key fields"
  curl -sS "$API_BASE_URL/api/v1/deals/$CINCO/report" \
    | jq '{ready, version, generatedAt:(.report.generatedAt//null), deal_summary:{tiers:(.report.deal_summary.tiers//null), product:(.report.deal_summary.product.text//null), market_target:(.report.deal_summary.market_target.text//null), market_context:(.report.deal_summary.market_context.text//null), market:(.report.deal_summary.market.text//null), meta:(.report.deal_summary.meta//null)}}'
} > "$OUT"

echo "WROTE $OUT"