#!/bin/bash
# proof-3deals-understanding.sh
# Fetch orchestrator reports + AI analysis endpoints for 3 proof deals.
# Usage: bash scripts/proof-3deals-understanding.sh

set -e

PROOF_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/Active/orchestractor/proofs/2026-02-28"
API="http://localhost:9001"

DEAL_WEBMAX="23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4"
DEAL_3ICE="61ef36dd-391a-4a4e-b30b-1f5d1f19f91e"
DEAL_PALM3="5c8c7d6e-c992-4be7-8b10-268eac36f663"

mkdir -p "$PROOF_DIR"

echo "============================================================"
echo "  Proof: AI Analysis + Orchestrator Understanding — 3 deals"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"
echo ""

# ── Orchestrator reports ──────────────────────────────────────────────────────
fetch_orchestrator() {
  local id="$1" name="$2"
  echo "── [${name}] GET orchestrator-report ──"
  curl -sf "${API}/api/v1/deals/${id}/orchestrator-report" \
    -o "${PROOF_DIR}/${id}__orchestrator_report.json"
  python3 - <<PYEOF
import json, sys
with open("${PROOF_DIR}/${id}__orchestrator_report.json") as f:
    d = json.load(f)
dec = d.get("decision", {})
sc  = d.get("scores", {})
dc  = d.get("document_confidence", {})
sc_ctx = d.get("stage_context", {})
rv  = (d.get("segments") or {}).get("risk_verification") or {}

print(f"  Decision : {dec.get('outcome', 'N/A')}")
print(f"  ORS      : {sc.get('ors', 'N/A')}")
print(f"  DCI      : {dc.get('score', 'N/A')} ({dc.get('band', 'N/A')})")
print(f"  FHC      : {sc.get('fhc', 'N/A')}")
print(f"  URSS     : {sc.get('urss', 'N/A')}")
bullets = dec.get("rationale_bullets", [])
print(f"  Drivers  ({len(bullets)} total): {bullets[:3]}")
vreqs = rv.get("verification_requests", [])
print(f"  Verif req ({len(vreqs)} total): {[v.get('request','') for v in vreqs[:2]]}")
missing = sc_ctx.get("missing_critical_terms", [])
print(f"  Missing critical terms: {missing}")
PYEOF
  echo ""
}

fetch_orchestrator "$DEAL_WEBMAX" "WebMax (PDF+XLSX)"
fetch_orchestrator "$DEAL_3ICE" "3ICE (PDF only)"
fetch_orchestrator "$DEAL_PALM3" "Palm3 (PPTX only)"

# ── AI Analysis endpoints ─────────────────────────────────────────────────────
post_analysis() {
  local id="$1" name="$2" endpoint="$3" label="$4" outfile="$5" body="$6"
  echo "── [${name}] POST ${endpoint} ──"
  http_code=$(curl -sf "${API}/api/v1/deals/${id}/${endpoint}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "${body}" \
    -w "%{http_code}" \
    -o "${PROOF_DIR}/${id}__${outfile}" 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    # Retry with -S for error output
    err=$(curl -s "${API}/api/v1/deals/${id}/${endpoint}" \
      -X POST -H "Content-Type: application/json" -d "${body}" 2>&1 | head -c 300)
    echo "  ERROR (rc=$rc): $err"
    echo "{\"error\": \"curl_failed\", \"rc\": $rc}" > "${PROOF_DIR}/${id}__${outfile}"
  else
    python3 - <<PYEOF
import json
try:
    with open("${PROOF_DIR}/${id}__${outfile}") as f:
        d = json.load(f)
    status = d.get("status", d.get("error", list(d.keys())[:3]))
    print(f"  status: {status}")
    missing = d.get("missing_inputs", d.get("missing_terms", []))
    if missing:
        print(f"  missing_inputs: {missing[:5]}")
    sources = d.get("sources", [])
    if sources:
        print(f"  sources ({len(sources)}): {[s.get('label','') for s in sources[:3]]}")
except Exception as e:
    print(f"  parse error: {e}")
PYEOF
  fi
  echo ""
}

EMPTY_BODY="{}"

for id_name in "${DEAL_WEBMAX}:WebMax" "${DEAL_3ICE}:3ICE" "${DEAL_PALM3}:Palm3"; do
  id="${id_name%%:*}"
  nm="${id_name##*:}"

  echo ""
  echo "════════ ${nm} (${id}) — Analysis Endpoints ════════"
  echo ""

  post_analysis "$id" "$nm" "analysis/deal-terms"        "deal-terms"        "${id}__deal_terms.json"       "$EMPTY_BODY"
  post_analysis "$id" "$nm" "analysis/market"            "market"            "${id}__market.json"           "$EMPTY_BODY"
  post_analysis "$id" "$nm" "analysis/financial-analysis" "financial"        "${id}__financial.json"        "$EMPTY_BODY"
  post_analysis "$id" "$nm" "analysis/risk-verification"  "risk_verification" "${id}__risk_verification.json" "$EMPTY_BODY"
done

echo "============================================================"
echo "  All artifacts saved to: $PROOF_DIR"
ls -la "$PROOF_DIR"/*.json 2>/dev/null | awk '{print "  "$NF, $5}'
echo "============================================================"
