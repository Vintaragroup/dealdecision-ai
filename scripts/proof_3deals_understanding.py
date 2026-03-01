#!/usr/bin/env python3
"""
proof_3deals_understanding.py

Proof script: AI Analysis + Orchestrator improves deal understanding.
Fetches orchestrator reports and calls all 4 AI analysis endpoints for 3 deals.

Deals:
  1  WebMax (PDF + XLSX)   23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4
  2  3ICE  (PDF only)      61ef36dd-391a-4a4e-b30b-1f5d1f19f91e
  3  Palm3 (PPTX only)     5c8c7d6e-c992-4be7-8b10-268eac36f663
"""
import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

API = "http://localhost:9001"
PROOF_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "docs", "Active", "orchestractor", "proofs", "2026-02-28"
)

DEALS = [
    {"id": "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4", "name": "WebMax",  "profile": "PDF+XLSX"},
    {"id": "61ef36dd-391a-4a4e-b30b-1f5d1f19f91e", "name": "3ICE",   "profile": "PDF only"},
    {"id": "5c8c7d6e-c992-4be7-8b10-268eac36f663", "name": "Palm3",  "profile": "PPTX only"},
]

os.makedirs(PROOF_DIR, exist_ok=True)


def fetch(url, body=None):
    """GET or POST to the API. Returns (status_code, dict)."""
    req = urllib.request.Request(url)
    req.add_header("Content-Type", "application/json")
    data = None
    if body is not None:
        req.method = "POST"
        data = json.dumps(body).encode("utf-8")
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8")) if e.read else {}


def save(deal_id, suffix, data):
    path = os.path.join(PROOF_DIR, f"{deal_id[:8]}__{suffix}")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return path


# ─── Parsers (replicate what the web hooks do) ───────────────────────────────

def parse_kv(body):
    """Parse `key=value` or `key: value` lines separated by ' | ' or newline."""
    kv = {}
    for line in body.strip().splitlines():
        # Handle colon-separated key: value format
        if " | " not in line and ": " in line and "=" not in line:
            k, _, v = line.partition(": ")
            kv[k.strip().lstrip('-').lstrip('✓').strip()] = v.strip()
        else:
            for token in line.split(" | "):
                token = token.strip()
                if "=" in token:
                    k, _, v = token.partition("=")
                    kv[k.strip()] = v.strip()
                elif ": " in token:
                    k, _, v = token.partition(": ")
                    kv[k.strip().lstrip('-').lstrip('✓').strip()] = v.strip()
    return kv


def parse_bool(v):
    if v is None:
        return False
    return str(v).lower() in ("true", "1", "yes")


def parse_nullable(v):
    if v is None or v in ("none", ""):
        return None
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1].rstrip()
    return v.rstrip()


def parse_canonical_fields(body):
    """Returns Record[field_name, value | null] from the canonical_fields body."""
    result = {}
    for line in body.strip().splitlines():
        tokens = line.split(" | ")
        pick = lambda key: next((t[len(key)+1:] for t in tokens if t.startswith(f"{key}=")), "none")
        field = pick("field")
        if not field or field == "none":
            continue
        raw = pick("value")
        result[field] = parse_nullable(raw)
    return result


def find_section(sections, key):
    """Find section with given key."""
    for s in sections:
        if s.get("key") == key:
            return s.get("body", "")
    return ""


def build_financial_body(sections, orch_report):
    """Build the POST body for /analysis/financial-analysis."""
    layout_body  = find_section(sections, "financial_layout_classifier_v1")
    recon_body   = find_section(sections, "financial_reconciliation_v1")
    implied_body = find_section(sections, "implied_capital_allocation_v1")
    deck_body    = find_section(sections, "deck_financial_signals_v1")

    # Parse layout flags — colon-separated format with optional % suffix
    lkv = parse_kv(layout_body)
    has_statement   = parse_bool(lkv.get("has_income_statement"))
    has_allocation  = bool(implied_body and ("total_implied" in implied_body.lower() or "use_of_funds" in implied_body.lower()))
    cov_raw = lkv.get("layout_coverage_pct", "0").rstrip("%")
    try:
        coverage_pct = float(cov_raw) if cov_raw else 0.0
    except (ValueError, TypeError):
        coverage_pct = 0.0

    # Parse reconciliation
    rkv = parse_kv(recon_body)
    recon_conf  = float(rkv.get("confidence_score", 0) or 0) if recon_body else 0
    warn_flags  = [k for k, v in rkv.items() if str(v).upper() in ("WARN", "FAIL")] if recon_body else []

    # Revenue / GM from orchestrator financial context
    sc = orch_report.get("stage_context", {})
    ors_sections = orch_report.get("sections", orch_report.get("segments", {}))
    fhc_data = orch_report.get("scores", {})
    revenue = None
    gross_margin = None

    # Parse deck signals for PPTX-only deals
    dkv = parse_kv(deck_body) if deck_body else {}
    has_deck = bool(deck_body)
    deck_has_revenue   = parse_bool(dkv.get("has_revenue_signals"))
    deck_has_arr_mrr   = parse_bool(dkv.get("has_arr_mrr"))
    deck_has_burn      = parse_bool(dkv.get("has_burn_signals"))
    deck_has_runway    = parse_bool(dkv.get("has_runway_signals"))
    deck_has_unit_ec   = parse_bool(dkv.get("has_unit_economics"))

    # Always attempt to send something useful
    body = {
        "has_statement":          has_statement,
        "has_implied_allocation":  has_allocation,
        "has_health_metrics":      False,
    }
    if coverage_pct:  # only send if non-zero
        body["layout_coverage_pct"] = coverage_pct
    if recon_conf:   # only send if non-zero
        body["reconciliation_confidence"] = recon_conf
    if warn_flags:
        body["warn_fail_flags"] = warn_flags[:5]
    if recon_body:
        missing_secs = [k for k, v in rkv.items() if str(v).lower() == "missing"]
        if missing_secs:
            body["missing_sections"] = missing_secs[:5]

    # For PPTX-only deals or when no XLSX financial data, always try deck signals
    if has_deck or (not has_statement and not has_allocation):
        body["has_deck_signals"]      = True
        body["deck_has_revenue"]      = deck_has_revenue
        body["deck_has_arr_mrr"]      = deck_has_arr_mrr
        body["deck_has_burn"]         = deck_has_burn
        body["deck_has_runway"]       = deck_has_runway
        body["deck_has_unit_economics"] = deck_has_unit_ec

    return body


def build_risk_body(sections, orch_report):
    """Build the POST body for /analysis/risk-verification.
    
    API schema:
      gates: [{id, status: 'pass'|'fail'|'not_run', reason?}]
      conflicts: [{field, value_a, value_b}]
      coverage: {docs_count?, dpu_pages?, nonempty_pages?, evidence_count?, text_coverage_pct?}
      reconciliation: {confidence_score?, flags?}
      missing_critical_terms: string[]
    """
    gate_body   = find_section(sections, "gate_state")
    cov_body    = find_section(sections, "coverage_snapshot")
    recon_body  = find_section(sections, "financial_reconciliation_v1")

    # Parse gate items — API expects {id, status: 'pass'|'fail'|'not_run'}
    gates = []
    for line in gate_body.strip().splitlines():
        kv = {}
        for token in line.split(" | "):
            token = token.strip()
            if "=" in token:
                k, _, v = token.partition("=")
                kv[k.strip()] = v.strip()
        gate_id = kv.get("gate") or kv.get("name") or kv.get("id")
        raw_status = (kv.get("status") or "not_run").lower()
        # Map: PASS -> pass, FAIL/WARN -> fail, everything else -> not_run
        if raw_status in ("pass",): api_status = "pass"
        elif raw_status in ("fail", "warn"): api_status = "fail"
        else: api_status = "not_run"
        if gate_id:
            g = {"id": gate_id, "status": api_status}
            if kv.get("reason") and kv["reason"] != "none":
                g["reason"] = kv["reason"]
            gates.append(g)

    # Parse coverage — handle both `key: value` and `key=value` formats
    ckv = parse_kv(cov_body)
    coverage = {}
    if cov_body:
        # Map coverage_snapshot field names to API schema names
        field_map = {
            "docs_count":         "docs_count",
            "dpu_page_count":     "dpu_pages",
            "dpu_nonempty_pages": "nonempty_pages",
            "evidence_count":     "evidence_count",
            "text_coverage_pct":  "text_coverage_pct",
        }
        for src_fld, api_fld in field_map.items():
            raw = ckv.get(src_fld)
            if raw and raw != "none":
                try:
                    coverage[api_fld] = float(str(raw).rstrip("%"))
                except (ValueError, TypeError):
                    pass
        # Compute text_coverage_pct if not present but we have nonempty + dpu_pages
        if "text_coverage_pct" not in coverage:
            ne = coverage.get("nonempty_pages")
            dp = coverage.get("dpu_pages")
            if ne is not None and dp and dp > 0:
                coverage["text_coverage_pct"] = round(ne / dp * 100, 1)

    # Missing critical terms from orchestrator report
    orch_r = orch_report.get("report", orch_report)  # unwrap envelope
    sc_ctx = orch_r.get("stage_context", {})
    missing = sc_ctx.get("missing_critical_terms", []) or []

    # Conflicts: API expects {field, value_a, value_b}
    # Extract from conflicts section if it has structured data
    conflicts_body = find_section(sections, "conflicts")
    conflicts = []
    if conflicts_body:
        for line in conflicts_body.strip().splitlines():
            parts = line.split(" | ")
            kv = {}
            for token in parts:
                if "=" in token:
                    k, _, v = token.partition("=")
                    kv[k.strip()] = v.strip()
            field  = kv.get("field", kv.get("term", ""))
            val_a  = kv.get("value_a", kv.get("source_a", ""))
            val_b  = kv.get("value_b", kv.get("source_b", ""))
            if field and val_a:
                conflicts.append({"field": field, "value_a": val_a, "value_b": val_b or "N/A"})

    # Reconciliation
    rkv = parse_kv(recon_body) if recon_body else {}
    recon_conf = None
    if recon_body:
        raw_conf = rkv.get("confidence_score")
        if raw_conf and raw_conf != "none":
            try: recon_conf = float(raw_conf)
            except (ValueError, TypeError): pass

    body = {}
    if gates:
        body["gates"] = gates[:10]
    if missing:
        body["missing_critical_terms"] = missing[:10]
    if conflicts:
        body["conflicts"] = conflicts[:5]
    if coverage:
        body["coverage"] = coverage
    if recon_conf is not None:
        body["reconciliation"] = {"confidence_score": recon_conf}

    return body


# ─── Main proof loop ─────────────────────────────────────────────────────────

results = {}
DIVIDER = "═" * 62

print(DIVIDER)
print("  Proof: AI Analysis + Orchestrator Understanding — 3 Deals")
print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
print(DIVIDER)
print()

for deal in DEALS:
    did  = deal["id"]
    name = deal["name"]
    prof = deal["profile"]
    r = {"deal": deal}

    print(f"{'─'*62}")
    print(f"  Deal: {name}  ({prof})")
    print(f"  ID  : {did}")
    print(f"{'─'*62}")

    # ── 1. Orchestrator report ────────────────────────────────────────────────
    print(f"\n  [1/5] GET /orchestrator-report")
    status, orch = fetch(f"{API}/api/v1/deals/{did}/orchestrator-report")
    r["orchestrator"] = {"status": status, "data": orch}
    save(did, "orchestrator_report.json", orch)

    if status == 200:
        orch_r = orch.get("report", orch)  # unwrap {schema_version, report: {...}} envelope
        dec = orch_r.get("decision", {})
        sc  = orch_r.get("scores", {})
        dc  = orch_r.get("document_confidence", {})
        sc_ctx = orch_r.get("stage_context", {})
        segs = orch_r.get("segments") or {}
        rv   = segs.get("risk_verification") or {}
        vreqs = rv.get("verification_requests", []) or []
        missing = sc_ctx.get("missing_critical_terms", []) or []

        # Scores: unified accessor (flat or sub-object)
        ors_score = sc.get("overall_recommendation_score", sc.get("ors", "N/A"))
        fhc_score = sc.get("financial_health_score", sc.get("fhc", {}))
        if isinstance(fhc_score, dict): fhc_score = fhc_score.get("score", "insufficient")
        urss_score = sc.get("risk_severity_score", sc.get("urss", "N/A"))
        dci_score  = dc.get("score", sc.get("dci", "N/A"))
        dci_band   = dc.get("band", "N/A")

        print(f"    decision : {dec.get('label', dec.get('outcome','N/A'))}")
        print(f"    ORS      : {ors_score}")
        print(f"    DCI      : {dci_score} ({dci_band})")
        print(f"    FHC      : {fhc_score}")
        print(f"    URSS     : {urss_score}")
        bullets = dec.get("rationale_bullets", [])
        print(f"    drivers  ({len(bullets)}): {bullets[:2]}")
        print(f"    vreqs    ({len(vreqs)}): {[v.get('request','')[:60] for v in vreqs[:2]]}")
        print(f"    missing  ({len(missing)}): {missing[:5]}")
    else:
        print(f"    ERROR {status}: {orch.get('error','?')}")

    # ── 2. Investor insights (for analysis endpoint bodies) ───────────────────
    print(f"\n  [2/5] GET /investor-insights (for analysis bodies)")
    st2, ii = fetch(f"{API}/api/v1/deals/{did}/investor-insights")
    sections = (ii.get("render_package") or {}).get("sections", [])

    # ── 3. Deal Terms ─────────────────────────────────────────────────────────
    print(f"\n  [3/5] POST /analysis/deal-terms")
    cf_body = find_section(sections, "canonical_fields")
    canonical_fields = parse_canonical_fields(cf_body)
    dt_body = {"canonical_fields": canonical_fields}
    st3, deal_terms = fetch(f"{API}/api/v1/deals/{did}/analysis/deal-terms", dt_body)
    r["deal_terms"] = {"status": st3, "data": deal_terms}
    save(did, "deal_terms.json", deal_terms)
    if st3 == 200:
        missing_dt = deal_terms.get("missing_inputs", []) or []
        print(f"    OK — missing_inputs: {missing_dt[:4]}")
        narrative = deal_terms.get("narrative", deal_terms.get("body", ""))
        print(f"    narrative[:120]: {str(narrative)[:120]}")
    else:
        print(f"    {st3}: {deal_terms.get('error','?')} — {deal_terms.get('message','')}")
        missing_dt = deal_terms.get("missing_terms", []) or []
        if missing_dt:
            print(f"    missing_terms: {missing_dt[:5]}")

    # ── 4. Market ─────────────────────────────────────────────────────────────
    print(f"\n  [4/5] POST /analysis/market")
    mkt_body = {"canonical_fields": canonical_fields}
    st4, market = fetch(f"{API}/api/v1/deals/{did}/analysis/market", mkt_body)
    r["market"] = {"status": st4, "data": market}
    save(did, "market.json", market)
    if st4 == 200:
        missing_mkt = market.get("missing_inputs", []) or []
        print(f"    OK — missing_inputs: {missing_mkt[:4]}")
        narrative = market.get("narrative", market.get("body", ""))
        print(f"    narrative[:120]: {str(narrative)[:120]}")
    else:
        print(f"    {st4}: {market.get('error','?')} — {market.get('message','')}")

    # ── 5. Financial ──────────────────────────────────────────────────────────
    print(f"\n  [5a/5] POST /analysis/financial-analysis")
    orch_r_for_fin = orch.get("report", orch)  # unwrapped
    fin_body = build_financial_body(sections, orch_r_for_fin)
    print(f"    body keys: {list(fin_body.keys())}")
    st5, financial = fetch(f"{API}/api/v1/deals/{did}/analysis/financial-analysis", fin_body)
    r["financial"] = {"status": st5, "data": financial}
    save(did, "financial.json", financial)
    if st5 == 200:
        narrative = financial.get("narrative", financial.get("body", ""))
        print(f"    OK — narrative[:120]: {str(narrative)[:120]}")
    else:
        print(f"    {st5}: {financial.get('error','?')} — {financial.get('message','')}")

    # ── 5b. Risk & Verification ───────────────────────────────────────────────
    print(f"\n  [5b/5] POST /analysis/risk-verification")
    rv_body = build_risk_body(sections, orch)
    print(f"    body keys: {list(rv_body.keys())}")
    st6, risk_verif = fetch(f"{API}/api/v1/deals/{did}/analysis/risk-verification", rv_body)
    r["risk_verification"] = {"status": st6, "data": risk_verif}
    save(did, "risk_verification.json", risk_verif)
    if st6 == 200:
        narrative = risk_verif.get("narrative", risk_verif.get("body", ""))
        print(f"    OK — narrative[:120]: {str(narrative)[:120]}")
    else:
        print(f"    {st6}: {risk_verif.get('error','?')} — {risk_verif.get('message','')}")

    results[did] = r
    print()

# ── Summary ───────────────────────────────────────────────────────────────────
print(DIVIDER)
print("  SUMMARY")
print(DIVIDER)
for deal in DEALS:
    did = deal["id"][:8]
    r = results.get(deal["id"], {})
    o = r.get("orchestrator", {})
    dt = r.get("deal_terms", {})
    mkt = r.get("market", {})
    fin = r.get("financial", {})
    rv  = r.get("risk_verification", {})
    print(f"  {deal['name']:<10} ({deal['profile']:<10}) "
          f"orch={o.get('status','?')} dt={dt.get('status','?')} "
          f"mkt={mkt.get('status','?')} fin={fin.get('status','?')} rv={rv.get('status','?')}")

print()
print(f"  Artifacts saved to: {PROOF_DIR}")
ls = os.listdir(PROOF_DIR)
json_files = sorted([f for f in ls if f.endswith(".json")])
for f in json_files:
    sz = os.path.getsize(os.path.join(PROOF_DIR, f))
    print(f"    {f}  ({sz:,} bytes)")
print(DIVIDER)

# Save summary metadata
meta = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "proof": "AI Analysis + Orchestrator Understanding — 3 Deals",
    "deals": [
        {
            "id": deal["id"],
            "name": deal["name"],
            "profile": deal["profile"],
            "endpoint_statuses": {
                "orchestrator": results.get(deal["id"], {}).get("orchestrator", {}).get("status"),
                "deal_terms":   results.get(deal["id"], {}).get("deal_terms", {}).get("status"),
                "market":       results.get(deal["id"], {}).get("market", {}).get("status"),
                "financial":    results.get(deal["id"], {}).get("financial", {}).get("status"),
                "risk_verification": results.get(deal["id"], {}).get("risk_verification", {}).get("status"),
            }
        }
        for deal in DEALS
    ]
}
with open(os.path.join(PROOF_DIR, "proof_run_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)
