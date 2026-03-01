#!/usr/bin/env python3
import json, os
PROOF = "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/Active/orchestractor/proofs/2026-02-28"

for prefix in ["23b2fa42", "61ef36dd", "5c8c7d6e"]:
    print(f"\n{'='*60}\n=== {prefix} ===")
    for suffix, parser in [
        ("orchestrator_report", "orch"),
        ("deal_terms", "dt"),
        ("market", "mkt"),
        ("risk_verification", "rv"),
        ("financial", "fin"),
    ]:
        path = f"{PROOF}/{prefix}__{suffix}.json"
        if not os.path.exists(path):
            continue
        d = json.load(open(path))
        print(f"\n--- {suffix} ---")
        if parser == "orch":
            r = d.get("report", d)
            sc = r.get("scores", {})
            dc = r.get("document_confidence", {})
            dec = r.get("decision", {})
            sc_ctx = r.get("stage_context", {})
            diag = r.get("diagnostics", {})
            segs = r.get("segments") or {}
            fhc = sc.get("financial_health_score", {})
            rv_s = segs.get("risk_verification") or {}
            print(f"  ORS={sc.get('overall_recommendation_score')} URSS={sc.get('risk_severity_score')}")
            print(f"  fhc={json.dumps(fhc)[:250]}")
            print(f"  dci_score={dc.get('score')} dci_band={dc.get('band')}")
            print(f"  dci_notes={dc.get('notes')}")
            print(f"  dci_coverage={json.dumps(dc)[:400]}")
            print(f"  decision_label={dec.get('label')} confidence_band={dec.get('confidence_band')}")
            print(f"  thresholds={dec.get('thresholds_used')}")
            print(f"  rationale={dec.get('rationale_bullets')}")
            print(f"  stage_context={json.dumps(sc_ctx)[:400]}")
            print(f"  missing_critical_terms={sc_ctx.get('missing_critical_terms')}")
            print(f"  diagnostics={json.dumps(diag)[:300]}")
            print(f"  vreqs={json.dumps(rv_s.get('verification_requests', []))[:600]}")
        elif parser == "dt":
            print(f"  schema={d.get('schema_version')}")
            print(f"  structure_summary={d.get('structure_summary','')[:300]}")
            sa = d.get("structure_assessment", {})
            print(f"  structure_assessment={json.dumps(sa)[:400]}")
            print(f"  missing_terms={d.get('missing_terms')}")
            cf = d.get("canonical_fields", {})
            print(f"  canonical_fields_sample={json.dumps(dict(list(cf.items())[:8]))}")
        elif parser == "mkt":
            print(f"  schema={d.get('schema_version')}")
            print(f"  missing_inputs={d.get('missing_inputs')}")
            paras = d.get("summary_paragraphs") or []
            print(f"  summary_paragraphs[{len(paras)}]={json.dumps(paras)[:500]}")
            bullets = d.get("top_bullets") or d.get("bullets") or []
            print(f"  top_bullets={json.dumps(bullets)[:400]}")
            print(f"  market_size={d.get('market_size')}")
            print(f"  growth_rate={d.get('market_growth_rate') or d.get('growth_rate')}")
        elif parser == "rv":
            print(f"  schema={d.get('schema_version')}")
            paras = d.get("summary_paragraphs") or []
            print(f"  summary_paragraphs[{len(paras)}]={json.dumps(paras)[:500]}")
            print(f"  top_risks={json.dumps(d.get('top_risks',[]))[:500]}")
            print(f"  gates={json.dumps(d.get('gates',[]))[:400]}")
            print(f"  coverage={d.get('coverage')}")
            print(f"  missing_critical_terms={d.get('missing_critical_terms')}")
            print(f"  conflicts={d.get('conflicts')}")
            print(f"  reconciliation={json.dumps(d.get('reconciliation'))[:200]}")
        elif parser == "fin":
            print(f"  full={json.dumps(d)[:300]}")
