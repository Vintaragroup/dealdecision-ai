#!/usr/bin/env python3
"""
evaluation/scripts/generate_deal_audit.py
==========================================

Clean-room deal evaluation audit script for DealDecisionAI.

Connects to the local dealdecision-dev Postgres database and generates one
markdown audit document per deal.

Data sources pulled (read-only — never mutates the DB):
  - deals                      → deal metadata
  - documents                  → uploaded source artifacts
  - ingestion_reports          → ingestion summary (documents.ingestion_summary)
  - deal_facts_v1              → non-financial extracted facts
  - financial_facts_v1         → granular financial facts (one row per metric×period×source)
  - governed_llm_overviews     → LLM-derived claims and narrative
  - investor_insight_reports   → analysis output containing:
      .report_payload.fused_facts               → fused canonical facts
      .report_payload.financial_facts_v1        → derived financial bridge object
      .report_payload.governed_summary_v1       → structured summary
      .report_payload.narrative_contradiction_bundle → contradiction bundle
      .render_package                            → UI contract / tabs

Usage:
  # Single deal (by id or name)
  python evaluation/scripts/generate_deal_audit.py --deal-id <uuid>
  python evaluation/scripts/generate_deal_audit.py --deal-name "WebMax"

  # All deals currently in DB
  python evaluation/scripts/generate_deal_audit.py --all

  # Specific deal IDs from a JSON list
  python evaluation/scripts/generate_deal_audit.py --deal-ids-file tmp/audit_deals.json

  # Also generate benchmark summary across all processed deals
  python evaluation/scripts/generate_deal_audit.py --all --benchmark-summary

  # Override output directory
  python evaluation/scripts/generate_deal_audit.py --all --output-dir /tmp/audit_out

Requirements:
  pip install psycopg2-binary
  (already available in .venv for this project)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── DB dependency ────────────────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print(
        "ERROR: psycopg2 not found.\n"
        "  Install it:  pip install psycopg2-binary\n"
        "  Or activate the project venv:  source .venv/bin/activate",
        file=sys.stderr,
    )
    sys.exit(1)


# ─── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# ─── Evaluation-internal lib on path ─────────────────────────────────────────
sys.path.insert(0, str(REPO_ROOT / "evaluation"))

from lib.deal_understanding_v1 import (  # noqa: E402
    build_deal_understanding_v1,
    fetch_product_profile_v1,
    fetch_understanding_fallback_inputs,
    DealUnderstandingV1,
    UnderstandingSourceKind,
)
from lib.doc_type_classifier import (  # noqa: E402
    classify_deal_documents,
    fetch_documents_for_classification,
    BenchmarkDocumentType,
)
from lib.expectation_profiles import (  # noqa: E402
    ExpectationLevel,
    ZeroClassification,
    get_expectation_profile,
)
from lib.reviewer_verdict import (  # noqa: E402
    ReviewerVerdict,
    format_accuracy,
    overall_score,
)
from lib.benchmark_run import (  # noqa: E402
    generate_run_id,
    build_run_manifest,
    write_run_manifest,
    load_run_manifest,
)
from lib.review_persistence import (  # noqa: E402
    generate_review_template,
    write_review_sidecar,
    load_reviewer_verdicts,
    apply_verdicts_to_understanding,
    compute_deal_rollup,
    compute_cross_deal_rollup,
    review_completion_metrics,
)

DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55433/dealdecision",
)

DEFAULT_OUTPUT_DIR = REPO_ROOT / "evaluation" / "reports"


# ─── DB helpers ───────────────────────────────────────────────────────────────

def connect(db_url: str) -> psycopg2.extensions.connection:
    """Open a read-only-intent connection to the local dev database."""
    conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def q(conn, sql: str, params: tuple = ()) -> list[dict]:
    """Execute a SQL query and return results as a list of dicts."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def q1(conn, sql: str, params: tuple = ()) -> dict | None:
    """Execute a SQL query and return the first row or None."""
    rows = q(conn, sql, params)
    return rows[0] if rows else None


# ─── Data fetchers ────────────────────────────────────────────────────────────

def fetch_deal(conn, deal_id: str) -> dict | None:
    """Fetch deal metadata row."""
    return q1(conn,
        """
        SELECT id, name, stage, priority, owner, score, trend,
               lifecycle_status, created_at, updated_at, created_by_user_id
        FROM deals
        WHERE id = %s AND deleted_at IS NULL
        """,
        (deal_id,),
    )


def fetch_all_deal_ids(conn) -> list[str]:
    """Return all active deal IDs."""
    rows = q(conn,
        "SELECT id::text FROM deals WHERE deleted_at IS NULL ORDER BY created_at",
    )
    return [r["id"] for r in rows]


def resolve_deal_id_by_name(conn, name: str) -> str | None:
    """Resolve a deal ID from its name (case-insensitive, partial match)."""
    row = q1(conn,
        """
        SELECT id::text FROM deals
        WHERE lower(name) LIKE lower(%s) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
        """,
        (f"%{name}%",),
    )
    return row["id"] if row else None


def fetch_documents(conn, deal_id: str) -> list[dict]:
    """Fetch all non-deleted documents for a deal."""
    return q(conn,
        """
        SELECT id, document_id, title, type, status,
               uploaded_at, updated_at,
               verification_status, verification_result, ingestion_summary
        FROM documents
        WHERE deal_id = %s AND deleted_at IS NULL
        ORDER BY uploaded_at
        """,
        (deal_id,),
    )


def fetch_ingestion_reports(conn, deal_id: str) -> list[dict]:
    """Fetch ingestion reports for a deal."""
    return q(conn,
        """
        SELECT report_id, created_at, summary, document_ids
        FROM ingestion_reports
        WHERE deal_id = %s
        ORDER BY created_at DESC
        """,
        (deal_id,),
    )


def fetch_deal_facts(conn, deal_id: str) -> list[dict]:
    """Fetch deal_facts_v1 rows for a deal."""
    return q(conn,
        """
        SELECT fact_id, type, label, value, timeframe, confidence,
               sources, page_refs, conflicts_with_fact_ids,
               created_at, updated_at
        FROM deal_facts_v1
        WHERE deal_id = %s
        ORDER BY type, label
        """,
        (deal_id,),
    )


def fetch_financial_facts(conn, deal_id: str) -> list[dict]:
    """Fetch financial_facts_v1 rows for a deal."""
    return q(conn,
        """
        SELECT fact_id, document_id::text, source_kind,
               metric_key, metric_label, period_type, period_label,
               value, unit, currency, confidence, reconciliation_status,
               sheet_name, page_number, row_index, col_index,
               source_pointer, evidence_id, excerpt,
               created_at, updated_at
        FROM financial_facts_v1
        WHERE deal_id = %s
        ORDER BY metric_key, period_label, source_kind
        """,
        (deal_id,),
    )


def fetch_governed_llm_overview(conn, deal_id: str) -> dict | None:
    """Fetch the most recent governed LLM overview for a deal."""
    return q1(conn,
        """
        SELECT id, schema_version, llm_phase_mode,
               summary_text, claims, disclosures, created_at
        FROM governed_llm_overviews
        WHERE deal_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (deal_id,),
    )


def fetch_investor_insight_report(conn, deal_id: str) -> dict | None:
    """Fetch the most recent complete (or best-available) investor insight report."""
    # Prefer 'complete' > 'deterministic_only' > any other non-failed
    row = q1(conn,
        """
        SELECT id, engine_version, upstream_fingerprint, status,
               gate_state, compliance_state,
               render_package, report_payload, audit_log,
               created_at, updated_at
        FROM investor_insight_reports
        WHERE deal_id = %s
          AND status NOT IN ('failed', 'quarantined')
        ORDER BY
          CASE status
            WHEN 'complete'             THEN 0
            WHEN 'deterministic_only'   THEN 1
            WHEN 'running'              THEN 2
            ELSE                             3
          END,
          updated_at DESC
        LIMIT 1
        """,
        (deal_id,),
    )
    return row


# ─── Markdown helpers ─────────────────────────────────────────────────────────

def _ts(val: Any) -> str:
    """Format a timestamp value for display."""
    if val is None:
        return "—"
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(val)


def _safe(val: Any, default: str = "—") -> str:
    """Return a display-safe string."""
    if val is None or (isinstance(val, str) and not val.strip()):
        return default
    return str(val)


def _jdump(obj: Any, indent: int = 2) -> str:
    """Pretty-print a JSON value, falling back to str()."""
    try:
        return json.dumps(obj, indent=indent, default=str, ensure_ascii=False)
    except Exception:
        return str(obj)


def _jval(obj: Any) -> Any:
    """Decode a JSONB column value (already deserialized by psycopg2 RealDictCursor)."""
    if isinstance(obj, (dict, list)):
        return obj
    if isinstance(obj, str):
        try:
            return json.loads(obj)
        except Exception:
            return obj
    return obj


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    """Build a simple markdown table."""
    if not rows:
        return "_No data._\n"
    lines = ["| " + " | ".join(headers) + " |"]
    sep = ["| " + " | ".join(["---"] * len(headers)) + " |"]
    lines += sep
    for row in rows:
        lines.append("| " + " | ".join(str(c).replace("|", "\\|") for c in row) + " |")
    return "\n".join(lines) + "\n"


def slugify(name: str) -> str:
    """Convert a deal name to a filesystem-safe slug."""
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:60]


def _source_label(sources_json: Any) -> str:
    """Return a compact source reference from the first entry in a sources JSONB column.

    deal_facts_v1.sources entries look like:
      {"excerpt": "...", "document_id": "...", "evidence_id": "...", "page_number": N}
    """
    sources = _jval(sources_json or []) or []
    if not isinstance(sources, list) or not sources:
        return "—"
    s0 = sources[0] if isinstance(sources[0], dict) else {}
    pg = s0.get("page_number")
    if pg is not None:
        return f"pg {pg}"
    eid = s0.get("evidence_id") or ""
    return eid[-24:] if eid else "—"


def _fin_source_label(f: dict) -> str:
    """Compact source label for a financial_facts_v1 row.

    Shows sheet + row/col when available, otherwise evidence_id suffix.
    """
    parts: list[str] = []
    sheet = f.get("sheet_name")
    if sheet:
        parts.append(sheet[:20])
    row = f.get("row_index")
    if row is not None:
        col = f.get("col_index")
        parts.append(f"r{row}" + (f"c{col}" if col is not None else ""))
    if parts:
        return "/".join(parts)
    eid = f.get("evidence_id") or ""
    return eid[-20:] if eid else "—"


# ─── Section generators ───────────────────────────────────────────────────────

def section_metadata(deal: dict, iir: dict | None) -> str:
    """Section 1 — Deal Metadata."""
    lines = ["## 1. Deal Metadata\n"]
    lines.append(f"| Field | Value |")
    lines.append(f"| --- | --- |")
    lines.append(f"| **Deal ID** | `{deal['id']}` |")
    lines.append(f"| **Name** | {_safe(deal['name'])} |")
    lines.append(f"| **Stage** | {_safe(deal['stage'])} |")
    lines.append(f"| **Priority** | {_safe(deal['priority'])} |")
    lines.append(f"| **Score** | {_safe(deal['score'])} |")
    lines.append(f"| **Lifecycle Status** | {_safe(deal['lifecycle_status'])} |")
    lines.append(f"| **Created At** | {_ts(deal['created_at'])} |")
    lines.append(f"| **Updated At** | {_ts(deal['updated_at'])} |")
    if iir:
        lines.append(f"| **Insight Engine Status** | `{iir['status']}` |")
        lines.append(f"| **Insight Report Updated** | {_ts(iir['updated_at'])} |")
        lines.append(f"| **Engine Version** | {_safe(iir['engine_version'])} |")
    else:
        lines.append(f"| **Insight Engine Status** | ⚠ No insight report found |")
    return "\n".join(lines) + "\n"


def section_source_artifacts(documents: list[dict]) -> str:
    """Section 2 — Source Artifacts Present."""
    lines = ["## 2. Source Artifacts Present\n"]
    if not documents:
        lines.append("_No documents uploaded._\n")
        return "\n".join(lines)

    headers = ["#", "Title", "Type", "Status", "Verification", "Uploaded"]
    rows = [
        [
            str(i + 1),
            _safe(d["title"]),
            _safe(d["type"]),
            _safe(d["status"]),
            _safe(d["verification_status"]),
            _ts(d["uploaded_at"]),
        ]
        for i, d in enumerate(documents)
    ]
    lines.append(md_table(headers, rows))

    # Presence checklist — uses type column AND title heuristics
    # (documents are sometimes stored with type="other" when type detection is pending)
    types_present = {d["type"] for d in documents}
    titles_lower = " ".join(d.get("title", "") or "" for d in documents).lower()

    def _has_doc_type(canonical_type: str, title_hints: list[str]) -> bool:
        if canonical_type in types_present:
            return True
        return any(hint in titles_lower for hint in title_hints)

    lines.append("\n**Document type checklist:**\n")
    lines.append("_(Detected from type column + title heuristics)_\n")

    has_deck = _has_doc_type("pitch_deck", [".pdf", "deck", "pitch", "investor", "presentation"])
    has_workbook = _has_doc_type("financial_model", [".xlsx", ".xls", "financial", "model", "valuation", "workbook"])
    has_cap_table = _has_doc_type("cap_table", ["cap table", "captable", "cap-table", "equity"])
    has_memo = _has_doc_type("memo", ["memo", "term sheet", "summary"])

    lines.append(f"- [{'✓' if has_deck else '✗'}] Pitch Deck / PDF")
    lines.append(f"- [{'✓' if has_workbook else '✗'}] Financial Workbook / XLSX")
    lines.append(f"- [{'✓' if has_cap_table else '✗'}] Cap Table")
    lines.append(f"- [{'✓' if has_memo else '✗'}] Deal Memo")

    return "\n".join(lines) + "\n"


def section_deal_facts(deal_facts: list[dict]) -> str:
    """Section 3 — Extracted Deal Facts."""
    lines = ["## 3. Extracted Deal Facts\n"]
    if not deal_facts:
        lines.append("_No deal_facts_v1 rows found for this deal._\n")
        return "\n".join(lines)

    lines.append(f"_Total: {len(deal_facts)} facts across {len({f['type'] for f in deal_facts})} types._\n")

    # Group by type
    by_type: dict[str, list[dict]] = {}
    for f in deal_facts:
        by_type.setdefault(f["type"], []).append(f)

    for fact_type in sorted(by_type.keys()):
        facts = by_type[fact_type]
        lines.append(f"\n### {fact_type} ({len(facts)})\n")
        headers = ["Label", "Value", "Confidence", "Timeframe", "Source/Page", "Conflicts"]
        rows = []
        for f in facts:
            val = _jval(f["value"])
            val_str = val if isinstance(val, str) else _jdump(val)
            conflicts = _jval(f["conflicts_with_fact_ids"])
            conflicts_str = str(len(conflicts)) + " conflict(s)" if isinstance(conflicts, list) and conflicts else "—"
            rows.append([
                _safe(f["label"]),
                textwrap.shorten(val_str, width=80),
                _safe(f["confidence"]),
                _safe(f["timeframe"]),
                _source_label(f.get("sources")),
                conflicts_str,
            ])
        lines.append(md_table(headers, rows))

    return "\n".join(lines)


def section_financial_facts(financial_facts: list[dict]) -> str:
    """Section 4 — Extracted Financial Facts."""
    lines = ["## 4. Extracted Financial Facts (financial_facts_v1)\n"]

    if not financial_facts:
        lines.append("_No financial_facts_v1 rows found for this deal._\n")
        return "\n".join(lines)

    lines.append(f"_Total: {len(financial_facts)} rows._\n")

    # Group by metric_key family for readability
    FINANCIAL_GROUPS = {
        "revenue":        ["revenue", "arr", "mrr", "arpu"],
        "ebitda_margin":  ["ebitda", "gross_profit", "gross_margin", "net_income"],
        "cost_burn":      ["cogs", "total_expenses", "operating_expense", "opex", "burn_rate"],
        "cash_runway":    ["cash", "runway_months"],
        "raise_val":      ["raise_amount", "valuation", "post_money_valuation", "pre_money_valuation"],
        "market":         ["tam", "sam", "som"],
        "other":          [],
    }

    def _group_for(metric_key: str) -> str:
        mk = metric_key.lower()
        for group, keys in FINANCIAL_GROUPS.items():
            if group == "other":
                continue
            if any(k in mk for k in keys):
                return group
        return "other"

    by_group: dict[str, list[dict]] = {}
    for f in financial_facts:
        g = _group_for(f["metric_key"])
        by_group.setdefault(g, []).append(f)

    display_order = list(FINANCIAL_GROUPS.keys())
    for group in display_order:
        facts = by_group.get(group, [])
        if not facts:
            continue

        group_label = group.replace("_", " / ").upper()
        lines.append(f"\n### {group_label} ({len(facts)} rows)\n")
        headers = ["metric_key", "period", "period_type", "value", "unit", "source_kind", "confidence", "recon_status", "sheet/row", "evidence_id"]
        rows = []
        for f in facts:
            raw_val = f["value"]
            if raw_val is not None:
                try:
                    if f["unit"] == "currency":
                        val_str = f"${float(raw_val):,.0f}"
                    elif f["unit"] == "percent":
                        val_str = f"{float(raw_val):.1f}%"
                    else:
                        val_str = str(raw_val)
                except Exception:
                    val_str = str(raw_val)
            else:
                val_str = "—"
            eid = f.get("evidence_id") or ""
            eid_short = eid[-20:] if eid else "—"
            rows.append([
                _safe(f["metric_key"]),
                _safe(f["period_label"]),
                _safe(f["period_type"]),
                val_str,
                _safe(f["unit"]),
                _safe(f["source_kind"]),
                _safe(f["confidence"]),
                _safe(f["reconciliation_status"]),
                _fin_source_label(f),
                eid_short,
            ])
        lines.append(md_table(headers, rows))

    return "\n".join(lines)


def section_fused_facts(report_payload: dict) -> str:
    """Section 5 — Fused Facts (from investor_insight_reports.report_payload)."""
    lines = ["## 5. Fused Facts\n"]

    fused = report_payload.get("fused_facts") if report_payload else None
    if not fused:
        lines.append("_No fused_facts found in investor_insight_reports.report_payload._\n")
        lines.append("> Note: Fused facts are only populated after a complete investor insights run.\n")
        return "\n".join(lines)

    lines.append(f"_Source: `investor_insight_reports.report_payload.fused_facts` ({len(fused)} facts)_\n")

    headers = ["field", "category", "value", "confidence", "temporal_scope", "semantic_role", "cross_source_status", "scenario"]
    rows = []
    for f in fused:
        rows.append([
            _safe(f.get("field")),
            _safe(f.get("category")),
            textwrap.shorten(_safe(f.get("value")), width=60),
            str(round(float(f["confidence"]), 2)) if f.get("confidence") is not None else "—",
            _safe(f.get("temporal_scope")),
            _safe(f.get("semantic_role")),
            _safe(f.get("cross_source_status")),
            _safe(f.get("scenario")),
        ])
    lines.append(md_table(headers, rows))
    return "\n".join(lines)


def section_cross_doc_reconciliation(financial_facts: list[dict], fused_facts: list | None) -> str:
    """Section 6 — Cross-Document Reconciliation."""
    lines = ["## 6. Cross-Document Reconciliation\n"]

    # Derive from financial_facts_v1.reconciliation_status
    status_counts: dict[str, int] = {}
    for f in financial_facts:
        s = f.get("reconciliation_status") or "unknown"
        status_counts[s] = status_counts.get(s, 0) + 1

    # Derive cross_source_status from fused facts if available
    fused_cs_counts: dict[str, int] = {}
    if fused_facts:
        for f in fused_facts:
            cs = f.get("cross_source_status")
            if cs:
                fused_cs_counts[cs] = fused_cs_counts.get(cs, 0) + 1

    lines.append("### From financial_facts_v1.reconciliation_status\n")
    if status_counts:
        lines.append(md_table(["Status", "Count"], [[k, str(v)] for k, v in sorted(status_counts.items())]))
    else:
        lines.append("_No financial facts found._\n")

    if fused_cs_counts:
        lines.append("\n### From fused_facts.cross_source_status\n")
        all_cs = ["supported", "conflicting", "deck_only", "workbook_only", "projected_only", "unresolved"]
        rows = [[cs, str(fused_cs_counts.get(cs, 0))] for cs in all_cs]
        lines.append(md_table(["Cross-Source Status", "Count"], rows))

        # Signal summary
        lines.append("\n**Signals:**\n")
        def _cs(key: str) -> int:
            return fused_cs_counts.get(key, 0)

        if _cs("supported") > 0:
            lines.append(f"- ✓ {_cs('supported')} fact(s) corroborated across deck + workbook")
        if _cs("conflicting") > 0:
            lines.append(f"- ⚠ {_cs('conflicting')} fact(s) in CONFLICT between deck and workbook")
        if _cs("deck_only") > 0:
            lines.append(f"- ► {_cs('deck_only')} fact(s) present only in deck (workbook absent)")
        if _cs("workbook_only") > 0:
            lines.append(f"- ► {_cs('workbook_only')} fact(s) present only in workbook (deck absent)")
        if _cs("projected_only") > 0:
            lines.append(f"- 🔮 {_cs('projected_only')} projected/forward-looking fact(s) only")
        if _cs("unresolved") > 0:
            lines.append(f"- ? {_cs('unresolved')} fact(s) unresolved (insufficient cross-source data)")

    return "\n".join(lines) + "\n"


def section_contradiction_bundle(report_payload: dict) -> str:
    """Section 7 — Contradiction Bundle."""
    lines = ["## 7. Contradiction Bundle\n"]

    bundle = report_payload.get("narrative_contradiction_bundle") if report_payload else None
    if not bundle:
        lines.append("_No narrative_contradiction_bundle found in report_payload._\n")
        lines.append("> Note: Contradiction bundle is only populated by the investor insights engine.\n")
        return "\n".join(lines)

    lines.append(f"_Source: `investor_insight_reports.report_payload.narrative_contradiction_bundle`_\n")

    # If bundle is a dict with topic keys
    if isinstance(bundle, dict):
        for topic, topic_data in bundle.items():
            lines.append(f"\n### Topic: {topic}\n")
            if isinstance(topic_data, list):
                for i, item in enumerate(topic_data, 1):
                    lines.append(f"**Contradiction {i}:**\n")
                    if isinstance(item, dict):
                        if "description" in item:
                            lines.append(f"> {item['description']}\n")
                        if "deck_claim" in item:
                            lines.append(f"- **Deck claim:** {item['deck_claim']}")
                        if "workbook_claim" in item:
                            lines.append(f"- **Workbook claim:** {item['workbook_claim']}")
                        if "severity" in item:
                            lines.append(f"- **Severity:** {item['severity']}")
                        if "resolution" in item:
                            lines.append(f"- **Resolution:** {item['resolution']}")
                    else:
                        lines.append(f"```\n{_jdump(item)}\n```")
            elif isinstance(topic_data, dict):
                for k, v in topic_data.items():
                    lines.append(f"- **{k}:** {v}")
            else:
                lines.append(f"```\n{_jdump(topic_data)}\n```")
    elif isinstance(bundle, list):
        for i, item in enumerate(bundle, 1):
            lines.append(f"\n**Contradiction {i}:**\n```json\n{_jdump(item)}\n```\n")
    else:
        lines.append(f"```json\n{_jdump(bundle)}\n```\n")

    return "\n".join(lines)


def section_structured_summary(
    governed_overview: dict | None,
    report_payload: dict,
    render_package: dict,
) -> str:
    """Section 8 — Structured Summary / Executive Summary."""
    lines = ["## 8. Structured Summary / Executive Summary\n"]

    # 8a: Governed LLM overview (summary_text + claims)
    if governed_overview:
        lines.append("### 8a. Governed LLM Overview\n")
        lines.append(f"_Phase mode: `{governed_overview.get('llm_phase_mode', '?')}` · Generated: {_ts(governed_overview.get('created_at'))}_\n")
        lines.append(f"> {governed_overview.get('summary_text', '—')}\n")

        claims = _jval(governed_overview.get("claims")) or []
        if claims:
            lines.append(f"\n**Claims ({len(claims)}):**\n")
            if isinstance(claims, list):
                for c in claims[:20]:  # cap display
                    if isinstance(c, dict):
                        claim_text = c.get("text") or c.get("claim") or _jdump(c)
                        evidence = c.get("evidence_ref") or c.get("evidence") or ""
                        lines.append(f"- {claim_text}" + (f" _{evidence}_" if evidence else ""))
                    else:
                        lines.append(f"- {c}")
                if len(claims) > 20:
                    lines.append(f"\n_… {len(claims) - 20} more claims not shown._")
    else:
        lines.append("_No governed_llm_overviews row found for this deal._\n")

    # 8b: Governed summary v1 (from report_payload)
    gov_summary = report_payload.get("governed_summary_v1") if report_payload else None
    if gov_summary:
        lines.append("\n### 8b. Governed Summary V1 (report_payload)\n")
        if isinstance(gov_summary, dict):
            for k, v in gov_summary.items():
                if k in ("fingerprint", "schema_version", "created_at"):
                    continue
                if isinstance(v, str) and len(v) > 20:
                    lines.append(f"**{k}:**\n> {textwrap.shorten(v, width=400)}\n")
                elif isinstance(v, (dict, list)):
                    lines.append(f"**{k}:**\n```json\n{_jdump(v)}\n```\n")
                else:
                    lines.append(f"**{k}:** {v}")
        else:
            lines.append(f"```json\n{_jdump(gov_summary)}\n```\n")
    else:
        lines.append("\n_No governed_summary_v1 in report_payload._\n")

    # 8c: Render package sections summary (investor insights UI output)
    if render_package:
        lines.append("\n### 8c. Investor Insights Render Package (UI Contract)\n")
        rp_status = render_package.get("status")
        rp_version = render_package.get("render_version") or render_package.get("ui_contract_version")
        lines.append(f"_Status: `{rp_status}` · Version: `{rp_version}`_\n")

        sections = render_package.get("sections") or {}
        if isinstance(sections, dict):
            for section_name, section_data in sections.items():
                lines.append(f"\n**Section: {section_name}**\n")
                if isinstance(section_data, dict):
                    slot_count = len(section_data.get("slots") or [])
                    lines.append(f"- Slots: {slot_count}")
                    if "insights" in section_data:
                        insights = section_data["insights"]
                        lines.append(f"- Insights: {len(insights) if isinstance(insights, list) else '?'}")
                    if "narrative" in section_data:
                        narr = section_data["narrative"]
                        if isinstance(narr, str) and narr.strip():
                            lines.append(f"- Narrative: _{textwrap.shorten(narr, width=200)}_")
                elif isinstance(section_data, list):
                    lines.append(f"- {len(section_data)} items")

    return "\n".join(lines) + "\n"


def section_evaluation_view(deal: dict, documents: list[dict], deal_facts: list[dict], financial_facts: list[dict], fused_facts: list | None) -> str:
    """Section 9 — Evaluation View."""
    lines = ["## 9. Evaluation View\n"]

    lines.append("_Instructions: Fill in **Source Document Truth** column manually by reviewing the uploaded source documents._\n")

    def _count_deal_facts_for_type(*types: str) -> str:
        n = sum(1 for f in deal_facts if f["type"] in types)
        return f"{n} extracted" if n else "⚠ 0 extracted"

    def _count_fin_facts_for(*keys: str) -> str:
        n = sum(1 for f in financial_facts if any(k in f["metric_key"].lower() for k in keys))
        return f"{n} extracted" if n else "⚠ 0 extracted"

    def _fused_for(*categories: str) -> str:
        if not fused_facts:
            return "—"
        n = sum(1 for f in fused_facts if f.get("category") in categories)
        return f"{n} fused" if n else "⚠ 0 fused"

    target_sections = [
        ("Financing",
         "raise_amount, round_stage, valuation, use_of_funds",
         _count_deal_facts_for_type("raise_amount", "valuation", "round_stage", "use_of_funds"),
         _fused_for("financing")),
        ("Financials",
         "revenue, ARR, burn, runway, EBITDA",
         _count_fin_facts_for("revenue", "arr", "mrr", "ebitda", "burn", "runway"),
         _fused_for("financials", "financial")),
        ("Market",
         "TAM, SAM, SOM, target customer",
         _count_deal_facts_for_type("target_customer") + " | " + _count_fin_facts_for("tam", "sam", "som"),
         _fused_for("market")),
        ("Product",
         "product capabilities, AI claims",
         _count_deal_facts_for_type("product_capability", "ai_usage_claim"),
         _fused_for("product")),
        ("GTM",
         "go-to-market, business model, pricing",
         _count_deal_facts_for_type("go_to_market", "business_model", "pricing_model"),
         _fused_for("gtm")),
        ("Competition",
         "competitors, positioning",
         _count_deal_facts_for_type("competitor"),
         _fused_for("competition")),
        ("Team",
         "key roles, founders",
         _count_deal_facts_for_type("team_key_role"),
         _fused_for("team")),
        ("Reconciliation",
         "deck vs workbook agreement",
         _cross_source_summary(financial_facts, fused_facts),
         "—"),
        ("Narrative Faithfulness",
         "investor insights narrative vs facts",
         "Manual review required",
         "—"),
    ]

    headers = ["Section", "Scope", "Source Document Truth", "System Extracted / Classified", "Narrative / UI Output", "Notes"]
    rows = [
        [section, scope, "_[ reviewer fill ]_", extracted, ui_output, ""]
        for section, scope, extracted, ui_output in target_sections
    ]
    lines.append(md_table(headers, rows))
    return "\n".join(lines) + "\n"


def _cross_source_summary(financial_facts: list[dict], fused_facts: list | None) -> str:
    """Derive a short cross-source reconciliation summary string."""
    if not financial_facts:
        return "⚠ No financial facts"
    ok = sum(1 for f in financial_facts if f.get("reconciliation_status") == "ok")
    conflict = sum(1 for f in financial_facts if f.get("reconciliation_status") == "conflict")
    parts = []
    if ok:
        parts.append(f"{ok} ok")
    if conflict:
        parts.append(f"⚠ {conflict} conflicts")
    return ", ".join(parts) if parts else "—"


def _cat_coverage_pct(understanding: DealUnderstandingV1, category: str) -> float:
    """Return coverage percentage for a single understanding category."""
    slots = [s for s in understanding.slots if s.category == category]
    if not slots:
        return 0.0
    populated = sum(1 for s in slots if s.populated)
    return round(100.0 * populated / len(slots), 1)


def section_key_risks(
    deal: dict,
    documents: list[dict],
    deal_facts: list[dict],
    financial_facts: list[dict],
    fused_facts: list | None,
    iir: dict | None,
) -> str:
    """Section 10 — Key Risks / Suspected Failures."""
    lines = ["## 10. Key Risks / Suspected Failures\n"]
    flags: list[str] = []

    doc_types = {d["type"] for d in documents}
    titles_lower = " ".join(d.get("title", "") or "" for d in documents).lower()

    def _has_type(canonical: str, hints: list[str]) -> bool:
        return canonical in doc_types or any(h in titles_lower for h in hints)

    has_deck = _has_type("pitch_deck", [".pdf", "deck", "pitch", "investor", "presentation"])
    has_workbook = _has_type("financial_model", [".xlsx", ".xls", "financial", "model", "valuation", "workbook"])

    # Financial fact checks
    revenue_facts = [f for f in financial_facts if "revenue" in f["metric_key"].lower()]
    projected_revenue = [f for f in revenue_facts if f.get("period_type") in ("annual", "quarterly") and str(f.get("period_label", "")).lower() not in ("current", "ttm")]
    current_revenue = [f for f in revenue_facts if f.get("period_label", "").lower() in ("current", "ttm", "monthly")]

    if not revenue_facts and (has_deck or has_workbook):
        flags.append("⚠ **No revenue facts extracted** despite source documents present.")

    if projected_revenue and not current_revenue:
        flags.append("⚠ **Projected revenue only** — no current/actual revenue facts found. Risk of forward-looking leakage.")

    conflict_facts = [f for f in financial_facts if f.get("reconciliation_status") == "conflict"]
    if conflict_facts:
        flags.append(f"⚠ **{len(conflict_facts)} financial fact conflict(s)** between deck and workbook detected.")

    if fused_facts:
        projected_fused = [f for f in fused_facts if f.get("temporal_scope") in ("projected", "scenario", "target")]
        if projected_fused:
            flags.append(f"⚠ **{len(projected_fused)} projected/scenario fused fact(s)** present — verify UI does not present as current data.")

        conflicting_fused = [f for f in fused_facts if f.get("cross_source_status") == "conflicting"]
        if conflicting_fused:
            flags.append(f"⚠ **{len(conflicting_fused)} fused fact(s) marked `conflicting`** — deck and workbook disagree on value.")

    # Document coverage checks
    if has_workbook and not any("xlsx" in f.get("source_kind", "") or "pdf_table" in f.get("source_kind", "") for f in financial_facts):
        flags.append("⚠ **Workbook uploaded but no xlsx-sourced financial facts** — workbook extraction may have failed.")

    # Deal fact coverage checks
    competitor_facts = [f for f in deal_facts if f["type"] == "competitor"]
    if not competitor_facts and has_deck:
        flags.append("⚠ **No competitor facts extracted** despite deck present.")

    team_facts = [f for f in deal_facts if f["type"] == "team_key_role"]
    if not team_facts and has_deck:
        flags.append("⚠ **No team facts extracted** despite deck present.")

    # Investor insight report checks
    if not iir:
        flags.append("⚠ **No investor insight report found** — investor insights engine has not completed a run.")
    elif iir["status"] not in ("complete", "deterministic_only"):
        flags.append(f"⚠ **Investor insight report status is `{iir['status']}`** — not fully complete.")

    if not deal_facts:
        flags.append("⚠ **No deal_facts_v1 rows** — deal classification pipeline may not have run.")

    if not financial_facts:
        flags.append("⚠ **No financial_facts_v1 rows** — financial extraction pipeline may not have run.")

    if not flags:
        lines.append("_No obvious failure signals detected._\n")
    else:
        for flag in flags:
            lines.append(f"- {flag}")
        lines.append("")

    return "\n".join(lines)


def section_doc_type_expectations(
    understanding: DealUnderstandingV1,
    doc_classification: dict,
) -> str:
    """Section 11 — Document Type & Benchmark Expectations.

    Shows the detected document type for this deal, the classification signals
    used, and the expectation profile applied to each semantic slot (expected /
    optional / unlikely).  Adjusted coverage is shown alongside raw coverage
    so sparse-source deals are not unfairly penalised.
    """
    deal_type = understanding.doc_type
    type_label = BenchmarkDocumentType.label(deal_type)
    lines = ["## 11. Document Type & Benchmark Expectations\n"]

    # ── Detected type ──────────────────────────────────────────────────────
    lines.append(f"**Detected document type:** {type_label} (`{deal_type}`)\n")
    signal = doc_classification.get("signal_summary", "")
    if signal:
        lines.append(f"_Classification signals: {signal}_\n")

    # ── Source artifacts table ─────────────────────────────────────────────
    doc_classifications = doc_classification.get("doc_classifications", [])
    if doc_classifications:
        lines.append("**Source artifacts classified:**\n")
        art_cols = ["Title", "MIME", "Pages", "Classified As"]
        art_rows = [
            [
                dc.get("title", "—"),
                dc.get("mime_type", "—") or "—",
                str(dc.get("page_count") or "—"),
                BenchmarkDocumentType.label(dc.get("doc_type", "unknown")),
            ]
            for dc in doc_classifications
        ]
        lines.append(md_table(art_cols, art_rows))
        lines.append("")

    # ── Coverage summary ───────────────────────────────────────────────────
    exp = understanding.expected_count
    opt = understanding.optional_count
    unl = understanding.unlikely_count
    pop_exp = understanding.populated_expected_count
    adj = understanding.adjusted_coverage_pct
    raw = understanding.coverage_pct
    zcls = understanding.zero_classification()
    lines.append(
        f"**Coverage:** raw {understanding.populated_count}/{understanding.total_count} ({raw}%) | "
        f"adjusted {pop_exp}/{exp} expected slots = **{adj}%** | "
        f"zero classification: `{zcls}`\n"
    )
    lines.append(
        f"_Expectation profile: {exp} expected · {opt} optional · {unl} unlikely_\n"
    )

    # ── Expectation profile table ──────────────────────────────────────────
    lines.append("**Slot expectation profile:**\n")
    exp_cols = ["Field", "Category", "Expectation", "Populated"]
    exp_rows = [
        [
            s.label,
            s.category,
            s.expectation,
            "✓" if s.populated else "—",
        ]
        for s in understanding.slots
    ]
    lines.append(md_table(exp_cols, exp_rows))

    return "\n".join(lines) + "\n"


def section_product_understanding(understanding: DealUnderstandingV1) -> str:
    """Section 12 — Product Profile / Semantic Understanding Validation.

    Renders the DealUnderstandingV1 as a reviewer table, broken out by category.
    Each slot shows: field label, expectation level, what the system extracted,
    source provenance, confidence, evidence ref count, and blank review columns.

    When no ProductProfileV1 is present, fallback slots from deal_facts /
    governed_summary are shown and flagged as recovered evidence.

    Coverage metrics (raw + expectation-adjusted) are shown per category
    and overall so the benchmark can track semantic completeness across deals.
    """
    lines = ["## 12. Product Profile / Semantic Understanding\n"]

    # ── Source note ────────────────────────────────────────────────────────
    if not understanding.has_profile():
        lines.append("_No `product_profile_v1` section in investor insights (primary source absent)._  ")
        if understanding.is_false_zero_recovered():
            lines.append("> **False-zero recovered** — fallback slots populated from deal_facts / governed_summary.")
        else:
            lines.append("> No fallback evidence available for this deal — all slots missing.")
        lines.append("")

    # ── Coverage banner ────────────────────────────────────────────────────
    by_cat = understanding.coverage_by_category()
    acc_str = format_accuracy(understanding.semantic_accuracy_pct())
    lines.append(f"**Overall coverage: {understanding.populated_count}/{understanding.total_count} slots "
                 f"({understanding.coverage_pct}%)** | "
                 f"**Adjusted (expected slots): {understanding.populated_expected_count}/{understanding.expected_count} "
                 f"= {understanding.adjusted_coverage_pct}%** | "
                 f"Doc type: `{understanding.doc_type}` | "
                 f"Understanding accuracy: **{acc_str}**\n")
    prov = understanding.provenance_counts()
    if prov:
        prov_parts = [f"{UnderstandingSourceKind.label(k)}: {v}" for k, v in sorted(prov.items())]
        lines.append(f"_Provenance: {' · '.join(prov_parts)}_\n")
    for cat, (pop, tot) in sorted(by_cat.items()):
        pct = round(100.0 * pop / tot, 1) if tot else 0.0
        lines.append(f"- {cat.capitalize()}: {pop}/{tot} ({pct}%)")
    lines.append("")

    columns = [
        "Field", "Expectation",
        "System Interpretation", "Source", "Confidence",
        "Evidence", "Reviewer Verdict", "Page Ref", "Notes",
    ]

    def _slot_rows(slots: list) -> list[list[str]]:
        return [
            [
                s.label,
                s.expectation,
                s.display_value(),
                UnderstandingSourceKind.label(s.source_kind),
                s.confidence_label(),
                s.evidence_summary(),
                ReviewerVerdict.label(getattr(s, 'reviewer_verdict', None)),
                getattr(s, 'reviewer_page_reference', None) or "_[ fill ]_",
                (getattr(s, 'reviewer_notes', None) or "") + ("⚠ Missing" if not s.populated else ""),
            ]
            for s in slots
        ]

    # ── Company Understanding ──────────────────────────────────────────────
    lines.append("### 12a. Company Understanding\n")
    lines.append(md_table(columns, _slot_rows(understanding.company_slots)))

    # ── Product Profile ────────────────────────────────────────────────────
    lines.append("\n### 12b. Product Profile\n")
    lines.append(md_table(columns, _slot_rows(understanding.product_slots)))

    # ── AI Assessment ──────────────────────────────────────────────────────
    lines.append("\n### 12c. AI Assessment\n")
    lines.append(md_table(columns, _slot_rows(understanding.ai_slots)))

    # ── Sources summary ────────────────────────────────────────────────────
    raw = understanding.product_profile_raw or {}
    top_sources = raw.get("sources") or []
    if top_sources:
        lines.append(f"\n**Top-level segment sources cited by product profile:** {len(top_sources)} source(s)\n")
        for sid in top_sources[:10]:
            lines.append(f"- `{sid}`")
        if len(top_sources) > 10:
            lines.append(f"- _… {len(top_sources) - 10} more_")
    else:
        lines.append("\n_No top-level segment sources present in product profile output._\n")

    return "\n".join(lines) + "\n"


def section_scoring_scaffold(
    deal: dict,
    deal_facts: list[dict],
    financial_facts: list[dict],
    fused_facts: list | None,
    understanding: DealUnderstandingV1,
    iir: dict | None,
) -> str:
    """Section 13 — Benchmark Scoring Scaffold.

    A 5-category scoring rubric for reviewer annotation.
    Each category includes a system-derived readiness indicator (pre-filled)
    and a blank Score / Notes column for the human reviewer.

    Scoring categories:
      A. Fact Accuracy            — deal_facts extracted correctly
      B. Financial Accuracy       — financial_facts extracted correctly
      C. Reconciliation Accuracy  — cross-source agreement is correct
      D. Deal Understanding       — product profile semantic coverage
      E. Narrative Faithfulness   — investor insights narrative matches facts

    Each category is scored on a 0–3 scale:
      0 = Completely wrong / absent
      1 = Partially correct (major gaps or errors)
      2 = Mostly correct (minor errors)
      3 = Correct and complete
    """
    lines = ["## 13. Benchmark Scoring Scaffold\n"]
    lines.append("_Instructions: Fill in the **Score (0-3)** and **Notes** columns after reviewing the deal._\n")
    lines.append(
        "_Scale: 0 = absent/wrong  |  1 = partial  |  2 = mostly correct  |  3 = correct & complete_\n"
    )

    def _readiness(ok: bool, warning: str = "", ok_label: str = "Ready") -> str:
        return f"✓ {ok_label}" if ok else f"⚠ {warning}"

    has_facts = len(deal_facts) > 0
    has_fin_facts = len(financial_facts) > 0
    has_recon = fused_facts is not None and any(
        f.get("cross_source_status") in ("supported", "conflicting") for f in fused_facts
    )
    has_understanding = understanding.has_profile() and understanding.populated_count > 5
    has_iir = iir is not None and iir["status"] in ("complete", "deterministic_only")

    # Auto-compute system-readiness notes
    def _fact_readiness() -> str:
        if not has_facts:
            return "⚠ 0 deal facts — not ready to score"
        types_seen = {f["type"] for f in deal_facts}
        expected = {"team_key_role", "competitor", "go_to_market", "raise_amount"}
        missing = expected - types_seen
        if missing:
            return f"⚠ Missing fact types: {', '.join(sorted(missing))}"
        return f"✓ {len(deal_facts)} facts across {len(types_seen)} types"

    def _fin_readiness() -> str:
        if not has_fin_facts:
            return "⚠ 0 financial facts — not ready to score"
        conflict_count = sum(1 for f in financial_facts if f.get("reconciliation_status") == "conflict")
        if conflict_count:
            return f"⚠ {len(financial_facts)} facts · {conflict_count} conflict(s)"
        return f"✓ {len(financial_facts)} financial facts extracted"

    def _recon_readiness() -> str:
        if not fused_facts:
            return "⚠ No fused facts — reconciliation not available"
        supported = sum(1 for f in fused_facts if f.get("cross_source_status") == "supported")
        conflicting = sum(1 for f in fused_facts if f.get("cross_source_status") == "conflicting")
        return f"✓ {supported} supported · {conflicting} conflicting"

    def _understanding_readiness() -> str:
        if not understanding.has_profile():
            return "⚠ No product profile — understanding not scored"
        return (
            f"✓ {understanding.populated_count}/{understanding.total_count} slots "
            f"({understanding.coverage_pct}%)"
        )

    def _narrative_readiness() -> str:
        if not has_iir:
            return "⚠ No IIR — narrative not available"
        return f"✓ IIR status: {iir['status']}"

    headers = ["Category", "Description", "System Readiness", "Score (0-3)", "Notes"]
    rows = [
        [
            "**A. Fact Accuracy**",
            "Deal facts (type/label/value) extracted correctly",
            _fact_readiness(),
            "_[ score ]_",
            "",
        ],
        [
            "**B. Financial Accuracy**",
            "Financial facts (metric/period/value) extracted correctly",
            _fin_readiness(),
            "_[ score ]_",
            "",
        ],
        [
            "**C. Reconciliation Accuracy**",
            "Cross-source agreement classification is correct",
            _recon_readiness(),
            "_[ score ]_",
            "",
        ],
        [
            "**D. Deal Understanding**",
            "Product profile captures company/product/AI correctly",
            _understanding_readiness(),
            "_[ score ]_",
            "",
        ],
        [
            "**E. Narrative Faithfulness**",
            "Investor insights narrative faithfully reflects extracted facts",
            _narrative_readiness(),
            "_[ score ]_",
            "",
        ],
    ]
    lines.append(md_table(headers, rows))

    lines.append("\n**Composite score (sum A+B+C+D+E) — reviewer fill:** `_____ / 15`\n")
    lines.append(
        "| Range | Interpretation |\n"
        "| --- | --- |\n"
        "| 13–15 | Excellent — system understands this deal correctly |\n"
        "| 9–12  | Good — minor gaps or errors |\n"
        "| 5–8   | Partial — significant gaps; usable with caveats |\n"
        "| 0–4   | Poor — major failures; not suitable for investor use |\n"
    )

    return "\n".join(lines) + "\n"


# ─── Main audit document builder ─────────────────────────────────────────────

def build_audit_doc(
    conn,
    deal_id: str,
    report_dir: Path,
    run_id: str | None = None,
) -> tuple[str, dict]:
    """
    Build the full markdown audit document for one deal.

    Parameters
    ----------
    conn        : DB connection
    deal_id     : UUID of the deal to audit
    report_dir  : root output directory (e.g. evaluation/reports/)
    run_id      : benchmark run identifier (defaults to a fresh timestamp ID)

    Returns
    -------
    (output_path, summary_dict) for benchmark summary use.
    """
    if run_id is None:
        run_id = generate_run_id()
    deal = fetch_deal(conn, deal_id)
    if not deal:
        raise ValueError(f"Deal {deal_id} not found in database.")

    documents = fetch_documents(conn, deal_id)
    ingestion_reports = fetch_ingestion_reports(conn, deal_id)
    deal_facts = fetch_deal_facts(conn, deal_id)
    financial_facts = fetch_financial_facts(conn, deal_id)
    governed_overview = fetch_governed_llm_overview(conn, deal_id)
    iir = fetch_investor_insight_report(conn, deal_id)

    # Unpack JSON payloads from investor_insight_reports
    report_payload: dict = {}
    render_package: dict = {}
    if iir:
        report_payload = _jval(iir.get("report_payload") or {}) or {}
        render_package = _jval(iir.get("render_package") or {}) or {}

    fused_facts: list | None = report_payload.get("fused_facts") if report_payload else None
    if fused_facts is not None and not isinstance(fused_facts, list):
        fused_facts = None

    # ── Document type classification ──────────────────────────────────────
    docs_for_classification = fetch_documents_for_classification(conn, deal_id)
    doc_classification = classify_deal_documents(docs_for_classification)
    deal_doc_type = doc_classification["deal_type"]

    # ── Build semantic understanding ──────────────────────────────────────
    product_profile = fetch_product_profile_v1(conn, deal_id)
    fallback_inputs = fetch_understanding_fallback_inputs(conn, deal_id)
    understanding = build_deal_understanding_v1(
        deal_id, product_profile,
        deal_facts=fallback_inputs["deal_facts"],
        governed_summary=fallback_inputs["governed_summary"],
        doc_type=deal_doc_type,
    )

    # ── Markdown assembly ─────────────────────────────────────────────────────
    deal_name = deal["name"]
    slug = slugify(deal_name)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    parts = [
        f"# Deal Audit — {deal_name}\n",
        f"_Generated: {ts} · Deal ID: `{deal_id}`_\n",
        "",
        section_metadata(deal, iir),
        "",
        section_source_artifacts(documents),
        "",
        section_deal_facts(deal_facts),
        "",
        section_financial_facts(financial_facts),
        "",
        section_fused_facts(report_payload),
        "",
        section_cross_doc_reconciliation(financial_facts, fused_facts),
        "",
        section_contradiction_bundle(report_payload),
        "",
        section_structured_summary(governed_overview, report_payload, render_package),
        "",
        section_evaluation_view(deal, documents, deal_facts, financial_facts, fused_facts),
        "",
        section_key_risks(deal, documents, deal_facts, financial_facts, fused_facts, iir),
        "",
        section_doc_type_expectations(understanding, doc_classification),
        "",
        section_product_understanding(understanding),
        "",
        section_scoring_scaffold(deal, deal_facts, financial_facts, fused_facts, understanding, iir),
    ]

    md = "\n".join(parts)

    # ── Write to file ─────────────────────────────────────────────────────────
    deal_dir = report_dir / slug
    deal_dir.mkdir(parents=True, exist_ok=True)
    out_path = deal_dir / "deal_audit.md"
    out_path.write_text(md, encoding="utf-8")

    # ── Write review sidecar (template — preserves existing verdicts) ─────────
    review_template = generate_review_template(
        deal_id, slug, understanding, deal_facts, financial_facts, deal_doc_type, run_id,
    )
    write_review_sidecar(review_template, deal_dir)

    # ── Load persisted reviewer verdicts (if any) and apply to slots ──────────
    review = load_reviewer_verdicts(deal_dir)
    persisted_rollup: dict = {}
    if review:
        apply_verdicts_to_understanding(understanding, review)
        persisted_rollup = compute_deal_rollup(review, understanding)

    # ── Summary dict (for benchmark report) ──────────────────────────────────
    fused_cs_counts: dict[str, int] = {}
    if fused_facts:
        for f in fused_facts:
            cs = f.get("cross_source_status")
            if cs:
                fused_cs_counts[cs] = fused_cs_counts.get(cs, 0) + 1

    summary = {
        "deal_id": deal_id,
        "deal_name": deal_name,
        "slug": slug,
        "run_id": run_id,
        "audit_path": str(out_path),
        "review_path": str(deal_dir / "review.json"),
        "deal_facts_count": len(deal_facts),
        "financial_facts_count": len(financial_facts),
        "fused_facts_count": len(fused_facts) if fused_facts else 0,
        "supported": fused_cs_counts.get("supported", 0),
        "conflicting": fused_cs_counts.get("conflicting", 0),
        "deck_only": fused_cs_counts.get("deck_only", 0),
        "workbook_only": fused_cs_counts.get("workbook_only", 0),
        "projected_only": fused_cs_counts.get("projected_only", 0),
        "unresolved": fused_cs_counts.get("unresolved", 0),
        "contradiction_bundle_present": bool(report_payload.get("narrative_contradiction_bundle")),
        "iir_status": iir["status"] if iir else None,
        "doc_types": sorted({d["type"] for d in documents}),
        # Fact counts by category
        "revenue_facts": sum(1 for f in financial_facts if "revenue" in f["metric_key"].lower()),
        "arr_facts": sum(1 for f in financial_facts if "arr" in f["metric_key"].lower() or "mrr" in f["metric_key"].lower()),
        "market_facts": sum(1 for f in deal_facts if f["type"] == "target_customer") + sum(1 for f in financial_facts if any(k in f["metric_key"].lower() for k in ["tam", "sam", "som"])),
        "raise_facts": sum(1 for f in deal_facts if f["type"] in ("raise_amount", "valuation", "round_stage")),
        "competitor_facts": sum(1 for f in deal_facts if f["type"] == "competitor"),
        "ai_facts": sum(1 for f in deal_facts if f["type"] in ("ai_usage_claim", "product_capability")),
        # Semantic understanding coverage
        "has_product_profile": understanding.has_profile(),
        "understanding_slots_populated": understanding.populated_count,
        "understanding_slots_total": understanding.total_count,
        "understanding_coverage_pct": understanding.coverage_pct,
        "understanding_company_pct": _cat_coverage_pct(understanding, "company"),
        "understanding_product_pct": _cat_coverage_pct(understanding, "product"),
        "understanding_ai_pct": _cat_coverage_pct(understanding, "ai"),
        "ai_claims_present": (understanding.product_profile_raw or {}).get("ai_claims_present"),
        "product_maturity": (understanding.product_profile_raw or {}).get("product_maturity"),
        # Provenance breakdown
        "primary_count": understanding.primary_count,
        "fallback_count": understanding.fallback_count,
        "missing_count": understanding.missing_count,
        "is_false_zero_recovered": understanding.is_false_zero_recovered(),
        # Document type + expectation-aware coverage
        "deal_doc_type": deal_doc_type,
        "doc_type_label": BenchmarkDocumentType.label(deal_doc_type),
        "adjusted_coverage_pct": understanding.adjusted_coverage_pct,
        "expected_slot_count": understanding.expected_count,
        "optional_slot_count": understanding.optional_count,
        "unlikely_slot_count": understanding.unlikely_count,
        "populated_expected_count": understanding.populated_expected_count,
        "zero_classification": understanding.zero_classification(),
        "doc_signal_summary": doc_classification.get("signal_summary", ""),
        # Reviewer accuracy scoring (populated after verdicts loaded from review.json)
        "semantic_accuracy_pct": understanding.semantic_accuracy_pct(),
        "verdict_summary": understanding.verdict_summary(),
        "understanding_failure_flags": understanding.failure_flags(),
        # Fact / financial / narrative accuracy — loaded from persisted review sidecar
        "fact_accuracy_pct": persisted_rollup.get("fact_accuracy_pct"),
        "financial_accuracy_pct": persisted_rollup.get("financial_accuracy_pct"),
        "narrative_accuracy_pct": persisted_rollup.get("narrative_accuracy_pct"),
        # Summary-level reviewer fields
        "summary_accuracy_verdict": review.reviewer if review else None,
        "summary_accuracy_notes": None,
        # Review completion
        "review_loaded": review is not None,
    }

    # Attach completion metrics when a review exists
    if review:
        completion = review_completion_metrics(review, understanding, deal_facts, financial_facts)
        summary["review_completion"] = completion

    return str(out_path), summary


# ─── Benchmark summary report ─────────────────────────────────────────────────

def build_benchmark_summary(
    summaries: list[dict],
    report_dir: Path,
    run_id: str | None = None,
    reviewer: str | None = None,
    label: str | None = None,
) -> str:
    """Generate benchmark_summary.md across all evaluated deals.

    Also writes a run manifest (run_manifest.json) and preserves a copy in
    run_history/<run_id>.json for longitudinal tracking.
    """
    if run_id is None:
        run_id = generate_run_id(label)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Load prior run manifest for comparison ────────────────────────────────
    prior_manifest = load_run_manifest(report_dir)

    # ── Cross-deal rollup ─────────────────────────────────────────────────────
    per_deal_rollups = [
        {
            "semantic_accuracy_pct": s.get("semantic_accuracy_pct"),
            "fact_accuracy_pct": s.get("fact_accuracy_pct"),
            "financial_accuracy_pct": s.get("financial_accuracy_pct"),
            "narrative_accuracy_pct": s.get("narrative_accuracy_pct"),
            "overall_score": overall_score(
                s.get("semantic_accuracy_pct"),
                s.get("fact_accuracy_pct"),
                s.get("financial_accuracy_pct"),
                s.get("narrative_accuracy_pct"),
            ),
        }
        for s in summaries
    ]
    cross_deal = compute_cross_deal_rollup(per_deal_rollups)

    lines = [
        "# Benchmark Evaluation Summary",
        "",
        f"_Generated: {ts}_",
        f"_Run ID: `{run_id}`_",
        "",
        f"**Deals evaluated:** {len(summaries)}",
        "",
        "---",
        "",
        "## Deal Set",
        "",
    ]

    for s in summaries:
        p = Path(s.get("audit_path", ""))
        rel = p.relative_to(report_dir) if p.exists() or True else p
        lines.append(f"- **{s['deal_name']}** · `{s['deal_id']}` · [{rel}]({rel})")

    lines += [
        "",
        "---",
        "",
        "## High-Level Metrics",
        "",
    ]

    headers = ["Deal", "Deal Facts", "Fin Facts", "Fused Facts", "Contradiction Bundle", "IIR Status"]
    rows = [
        [
            s["deal_name"],
            str(s["deal_facts_count"]),
            str(s["financial_facts_count"]),
            str(s["fused_facts_count"]),
            "✓" if s["contradiction_bundle_present"] else "—",
            _safe(s.get("iir_status")),
        ]
        for s in summaries
    ]
    lines.append(md_table(headers, rows))

    lines += [
        "",
        "---",
        "",
        "## Reconciliation Overview",
        "",
    ]

    rec_headers = ["Deal", "Supported", "Conflicting", "Deck Only", "Workbook Only", "Projected Only", "Unresolved"]
    rec_rows = [
        [
            s["deal_name"],
            str(s["supported"]),
            str(s["conflicting"]),
            str(s["deck_only"]),
            str(s["workbook_only"]),
            str(s["projected_only"]),
            str(s["unresolved"]),
        ]
        for s in summaries
    ]
    lines.append(md_table(rec_headers, rec_rows))

    lines += [
        "",
        "---",
        "",
        "## Extraction / Classification Signals",
        "",
    ]

    sig_headers = ["Deal", "Revenue Facts", "ARR/MRR Facts", "Market Facts", "Raise Facts", "Competitor Facts", "AI / Product Facts"]
    sig_rows = [
        [
            s["deal_name"],
            str(s["revenue_facts"]),
            str(s["arr_facts"]),
            str(s["market_facts"]),
            str(s["raise_facts"]),
            str(s["competitor_facts"]),
            str(s["ai_facts"]),
        ]
        for s in summaries
    ]
    lines.append(md_table(sig_headers, sig_rows))

    lines += [
        "",
        "---",
        "",
        "## Document Type Distribution",
        "",
        "_Document types detected from title / MIME / page-count classification signals._",
        "",
    ]

    dt_headers = ["Deal", "Doc Type", "Label", "Classification Signals"]
    dt_rows = [
        [
            s["deal_name"],
            f"`{s.get('deal_doc_type', 'unknown')}`",
            s.get("doc_type_label", "—"),
            s.get("doc_signal_summary", "—"),
        ]
        for s in summaries
    ]
    lines.append(md_table(dt_headers, dt_rows))

    lines += [
        "",
        "---",
        "",
        "## Semantic Understanding Coverage",
        "",
        "_Populated slot counts from the multi-source assembler._",
        "_Primary = ProductProfileV1 (investor insights engine). Fallback = deal_facts / governed_summary._",
        "_Deals without a product profile show primary=0 but may have fallback-recovered slots._",
        "_Adjusted % = populated expected slots / expected slots (sparse-source deals not penalised)._",
        "",
    ]

    und_headers = [
        "Deal", "Doc Type", "Profile Present", "Overall %", "Adj %",
        "Expected", "Optional", "Unlikely",
        "Primary", "Fallback", "Missing",
        "Company %", "Product %", "AI %",
        "Zero Classification",
    ]
    und_rows = [
        [
            s["deal_name"],
            s.get("doc_type_label", "—"),
            "✓" if s.get("has_product_profile") else ("⟳" if s.get("is_false_zero_recovered") else "—"),
            f"{s.get('understanding_coverage_pct', 0)}%",
            f"{s.get('adjusted_coverage_pct', 0)}%",
            str(s.get("expected_slot_count", 0)),
            str(s.get("optional_slot_count", 0)),
            str(s.get("unlikely_slot_count", 0)),
            str(s.get("primary_count", 0)),
            str(s.get("fallback_count", 0)),
            str(s.get("missing_count", 0)),
            f"{s.get('understanding_company_pct', 0)}%",
            f"{s.get('understanding_product_pct', 0)}%",
            f"{s.get('understanding_ai_pct', 0)}%",
            s.get("zero_classification", "—"),
        ]
        for s in summaries
    ]
    lines.append(md_table(und_headers, und_rows))

    # ── Benchmark Scorecard ────────────────────────────────────────────────
    lines += [
        "",
        "---",
        "",
        "## Benchmark Scorecard",
        "",
        "_Accuracy scores require manual reviewer verdicts. Cells show — until verdicts are recorded._",
        "_Overall score weights: 30% understanding · 25% facts · 25% financials · 20% narrative._",
        "",
    ]
    sc_headers = [
        "Deal", "Doc Type", "Coverage", "Adj Coverage",
        "Understanding Accuracy",
        "Fact Accuracy", "Financial Accuracy", "Narrative Accuracy",
        "Overall Score",
    ]
    sc_rows = []
    for s in summaries:
        und_acc = s.get("semantic_accuracy_pct")
        fact_acc = s.get("fact_accuracy_pct")
        fin_acc = s.get("financial_accuracy_pct")
        nar_acc = s.get("narrative_accuracy_pct")
        ovr = overall_score(und_acc, fact_acc, fin_acc, nar_acc)
        sc_rows.append([
            s["deal_name"],
            s.get("doc_type_label", "—"),
            f"{s.get('understanding_coverage_pct', 0)}%",
            f"{s.get('adjusted_coverage_pct', 0)}%",
            format_accuracy(und_acc),
            format_accuracy(fact_acc),
            format_accuracy(fin_acc),
            format_accuracy(nar_acc),
            format_accuracy(ovr),
        ])
    lines.append(md_table(sc_headers, sc_rows))

    # ── False-zero recovery section ────────────────────────────────────────
    recovered = [s for s in summaries if s.get("is_false_zero_recovered")]
    lines += [
        "",
        "---",
        "",
        "## False-Zero Recovery",
        "",
    ]
    if recovered:
        lines.append(
            "_Deals where no ProductProfileV1 was generated (primary source absent) but fallback sources_  "
        )
        lines.append("_populated ≥1 slot, indicating the system has partial understanding evidence:_\n")
        for s in recovered:
            lines.append(
                f"- **{s['deal_name']}** (`{s['deal_id'][:8]}…`) — "
                f"fallback: {s.get('fallback_count', 0)} slot(s) populated · "
                f"coverage: {s.get('understanding_coverage_pct', 0)}% · "
                f"adj: {s.get('adjusted_coverage_pct', 0)}% · "
                f"zero-class: `{s.get('zero_classification', '—')}`"
            )
    else:
        lines.append("_No false-zero recovery cases in this benchmark run._")
    lines.append("")

    # ── Document-type aware failures ───────────────────────────────────────
    true_zero_expected = [
        s for s in summaries
        if s.get("zero_classification") == "true_zero_expected"
    ]
    sparse_source = [
        s for s in summaries
        if s.get("zero_classification") == "true_zero_sparse_source"
    ]
    lines += [
        "",
        "---",
        "",
        "## Document-Type Aware Failures",
        "",
        "_Zero coverage re-classified by document type and expectation profile._",
        "",
    ]
    if true_zero_expected:
        lines.append("### True Zero — System Failure\n")
        lines.append(
            "_Deals with 0% adjusted coverage despite a source document that should yield populated expected slots._\n"
        )
        for s in true_zero_expected:
            lines.append(
                f"- **{s['deal_name']}** — doc type: {s.get('doc_type_label', '—')} · "
                f"expected slots: {s.get('expected_slot_count', 0)} · "
                f"populated expected: {s.get('populated_expected_count', 0)}"
            )
        lines.append("")
    if sparse_source:
        lines.append("### True Zero — Sparse Source (Appropriate)\n")
        lines.append(
            "_Deals with 0% coverage whose document type has 0 expected slots — not a system failure._\n"
        )
        for s in sparse_source:
            lines.append(
                f"- **{s['deal_name']}** — doc type: {s.get('doc_type_label', '—')} · "
                f"expected slots: {s.get('expected_slot_count', 0)}"
            )
        lines.append("")
    if not true_zero_expected and not sparse_source:
        lines.append("_No zero-coverage cases detected in this benchmark run._\n")
    lines.append("")

    lines += [
        "",
        "---",
        "",
        "## Notable Failure Flags",
        "",
    ]

    any_flags = False
    for s in summaries:
        deal_flags: list[str] = []

        if s["financial_facts_count"] == 0:
            deal_flags.append("no financial facts extracted")
        if s["deal_facts_count"] == 0:
            deal_flags.append("no deal facts extracted")
        if s["competitor_facts"] == 0:
            deal_flags.append("no competitor facts")
        if s["market_facts"] == 0:
            deal_flags.append("no market facts")
        if s["conflicting"] > 0:
            deal_flags.append(f"{s['conflicting']} conflicting cross-source facts")
        if s["projected_only"] > 0 and s["revenue_facts"] == 0:
            deal_flags.append(f"projected revenue only — possible projected leakage risk")
        if s["iir_status"] not in ("complete", "deterministic_only"):
            deal_flags.append(f"IIR status: {s['iir_status'] or 'not run'}")
        if not s.get("has_product_profile"):
            if s.get("is_false_zero_recovered"):
                deal_flags.append(
                    f"no product profile — understanding via fallback ({s.get('fallback_count', 0)} slot(s))"
                )
            else:
                deal_flags.append("no product profile — no understanding evidence available")
        elif s.get("understanding_coverage_pct", 100) < 50:
            deal_flags.append(
                f"low semantic coverage: {s['understanding_coverage_pct']}% "
                f"({s['understanding_slots_populated']}/{s['understanding_slots_total']} slots)"
            )
        # Reviewer-verdict failure flags
        for flag in s.get("understanding_failure_flags", []):
            from lib.reviewer_verdict import FAILURE_FLAGS as _FF
            detail = _FF.get(flag, flag)
            deal_flags.append(f"⚠ {detail}")

        if deal_flags:
            any_flags = True
            lines.append(f"**{s['deal_name']}:**")
            for flag in deal_flags:
                lines.append(f"  - ⚠ {flag}")
            lines.append("")

    if not any_flags:
        lines.append("_No notable failure flags detected across the benchmark set._\n")

    # ── Cross-Deal Accuracy Averages ───────────────────────────────────────
    lines += [
        "",
        "---",
        "",
        "## Cross-Deal Accuracy Averages",
        "",
        "_Averaged across deals that have at least one reviewer verdict recorded._",
        "_Deals with no verdicts are excluded from each metric's denominator._",
        "",
    ]
    cd_scored = cross_deal.get("deals_scored", 0)
    if cd_scored == 0:
        lines.append(
            "_No reviewer verdicts have been recorded yet. "
            "Fill in `review.json` sidecar files to populate this section._\n"
        )
    else:
        lines.append(f"_Deals with verdicts: **{cd_scored}** / {len(summaries)}_\n")
        avg_headers = [
            "Understanding Accuracy", "Fact Accuracy",
            "Financial Accuracy", "Narrative Accuracy", "Overall Score",
        ]
        avg_rows = [[
            format_accuracy(cross_deal.get("avg_semantic_accuracy_pct")),
            format_accuracy(cross_deal.get("avg_fact_accuracy_pct")),
            format_accuracy(cross_deal.get("avg_financial_accuracy_pct")),
            format_accuracy(cross_deal.get("avg_narrative_accuracy_pct")),
            format_accuracy(cross_deal.get("avg_overall_score")),
        ]]
        lines.append(md_table(avg_headers, avg_rows))

    # ── Review Completion ──────────────────────────────────────────────────
    deals_with_review = [s for s in summaries if s.get("review_loaded")]
    lines += [
        "",
        "---",
        "",
        "## Review Completion",
        "",
        "_Shows how much of each deal's review sidecar has been filled in._",
        "",
    ]
    if not deals_with_review:
        lines.append(
            "_No review sidecars loaded. "
            "Open a `review.json` file in `evaluation/reports/<slug>/` to begin reviewing._\n"
        )
    else:
        rc_headers = [
            "Deal", "Slots", "Facts", "Financials", "Narrative", "Completion %",
        ]
        rc_rows = []
        for s in summaries:
            comp = s.get("review_completion")
            if comp:
                rc_rows.append([
                    s["deal_name"],
                    f"{comp['slots_reviewed']}/{comp['slots_total']}",
                    f"{comp['facts_reviewed']}/{comp['facts_total']}",
                    f"{comp['financial_reviewed']}/{comp['financial_total']}",
                    f"{comp['narrative_reviewed']}/{comp['narrative_total']}",
                    f"{comp['completion_pct']}%",
                ])
            else:
                rc_rows.append([s["deal_name"], "—", "—", "—", "—", "—"])
        lines.append(md_table(rc_headers, rc_rows))

    # ── Historical Comparison ──────────────────────────────────────────────
    lines += [
        "",
        "---",
        "",
        "## Benchmark Run Comparison",
        "",
    ]
    if prior_manifest is None:
        lines.append(
            f"_No prior run manifest found. "
            f"This is the first recorded run (`{run_id}`)._\n"
        )
    else:
        prior_id = prior_manifest.get("run_id", "unknown")
        prior_ts = prior_manifest.get("generated_at", "unknown")
        prior_reviewer = prior_manifest.get("reviewer") or "—"
        prior_label = prior_manifest.get("label") or "—"
        lines += [
            f"_Prior run: `{prior_id}` — generated {prior_ts} — reviewer: {prior_reviewer} — label: {prior_label}_",
            f"_Current run: `{run_id}`_",
            "",
        ]
        # Score delta table using per-deal summaries from current run vs
        # nothing (we don't persist per-deal scores in the manifest yet — this
        # is the scaffold for future expansion)
        lines.append(
            "_Per-deal score delta tracking will appear here in future runs "
            "once run history archiving is implemented._\n"
        )

    md = "\n".join(lines)
    out_path = report_dir / "benchmark_summary.md"
    out_path.write_text(md, encoding="utf-8")

    # ── Write and archive run manifest ─────────────────────────────────────
    manifest = build_run_manifest(
        run_id=run_id,
        report_dir=report_dir,
        reviewer=reviewer,
        label=label,
        deal_count=len(summaries),
    )
    manifest["cross_deal_rollup"] = cross_deal
    write_run_manifest(manifest, report_dir)

    # Archive a copy for longitudinal tracking
    history_dir = report_dir / "run_history"
    history_dir.mkdir(parents=True, exist_ok=True)
    archive_path = history_dir / f"{run_id}.json"
    if not archive_path.exists():
        import json as _json
        archive_path.write_text(_json.dumps(manifest, indent=2, default=str), encoding="utf-8")

    return str(out_path)


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate per-deal markdown audit docs from local dealdecision-dev DB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Examples:
          # Single deal by ID
          python evaluation/scripts/generate_deal_audit.py --deal-id <uuid>

          # Single deal by name (partial match)
          python evaluation/scripts/generate_deal_audit.py --deal-name "WebMax"

          # All deals
          python evaluation/scripts/generate_deal_audit.py --all

          # All deals + generate benchmark summary
          python evaluation/scripts/generate_deal_audit.py --all --benchmark-summary

          # Specific deal IDs from a JSON file (array of strings or objects with .id)
          python evaluation/scripts/generate_deal_audit.py --deal-ids-file tmp/audit_deals.json
        """),
    )
    p.add_argument("--deal-id", help="Single deal UUID to audit.")
    p.add_argument("--deal-name", help="Deal name (partial, case-insensitive). Uses first match.")
    p.add_argument("--deal-ids-file", help="Path to JSON file with deal IDs (array of UUIDs or objects with .id).")
    p.add_argument("--all", action="store_true", help="Audit all active deals in the database.")
    p.add_argument("--benchmark-summary", action="store_true", help="Also generate benchmark_summary.md.")
    p.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help=f"Output directory (default: {DEFAULT_OUTPUT_DIR}).")
    p.add_argument("--db-url", default=DEFAULT_DB_URL, help="Postgres connection URL.")
    p.add_argument("--run-id", default=None, help="Benchmark run identifier (defaults to UTC timestamp).")
    p.add_argument("--reviewer", default=None, help="Reviewer name / identifier to record in the run manifest.")
    p.add_argument("--label", default=None, help="Free-form label for this benchmark run (e.g. 'post-v2-extraction').")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Shared run_id for all deals in this invocation
    shared_run_id = args.run_id or generate_run_id(args.label)

    print(f"\n=== DealDecisionAI — Audit Generator ===")
    print(f"  DB URL     : {args.db_url.split('@')[-1]}")  # hide credentials
    print(f"  Output dir : {output_dir}")
    print(f"  Run ID     : {shared_run_id}")
    if args.reviewer:
        print(f"  Reviewer   : {args.reviewer}")
    if args.label:
        print(f"  Label      : {args.label}")
    print()

    # ── Connect ───────────────────────────────────────────────────────────────
    try:
        conn = connect(args.db_url)
        print("  ✓ Connected to database.")
    except Exception as e:
        print(f"  ERROR: Could not connect to database: {e}", file=sys.stderr)
        print(f"  Ensure the local dev stack is running: docker compose -f docker-compose.dev.yml up -d", file=sys.stderr)
        sys.exit(1)

    # ── Resolve deal IDs ──────────────────────────────────────────────────────
    deal_ids: list[str] = []

    if args.all:
        deal_ids = fetch_all_deal_ids(conn)
        print(f"  Found {len(deal_ids)} active deal(s) in database.")

    elif args.deal_id:
        deal_ids = [args.deal_id]

    elif args.deal_name:
        resolved = resolve_deal_id_by_name(conn, args.deal_name)
        if not resolved:
            print(f"  ERROR: No deal found matching name '{args.deal_name}'.", file=sys.stderr)
            sys.exit(1)
        deal_ids = [resolved]
        print(f"  Resolved '{args.deal_name}' → {resolved}")

    elif args.deal_ids_file:
        ids_file = Path(args.deal_ids_file)
        if not ids_file.exists():
            print(f"  ERROR: File not found: {ids_file}", file=sys.stderr)
            sys.exit(1)
        data = json.loads(ids_file.read_text())
        if isinstance(data, list):
            deal_ids = [
                str(item["id"]) if isinstance(item, dict) else str(item)
                for item in data
            ]
        else:
            print(f"  ERROR: Expected a JSON array in {ids_file}.", file=sys.stderr)
            sys.exit(1)
        print(f"  Loaded {len(deal_ids)} deal ID(s) from {ids_file}.")

    else:
        print("  ERROR: Specify --all, --deal-id, --deal-name, or --deal-ids-file.", file=sys.stderr)
        sys.exit(1)

    if not deal_ids:
        print("  No deals to process. (Database may be empty — upload and analyze deals first.)")
        sys.exit(0)

    print()

    # ── Process each deal ─────────────────────────────────────────────────────
    summaries: list[dict] = []
    errors: list[str] = []

    for deal_id in deal_ids:
        try:
            print(f"  Processing: {deal_id} ...", end=" ")
            path, summary = build_audit_doc(conn, deal_id, output_dir, run_id=shared_run_id)
            summaries.append(summary)
            print(f"✓  → {path}")
        except Exception as e:
            msg = f"FAILED for {deal_id}: {e}"
            print(f"  ✗ {msg}", file=sys.stderr)
            errors.append(msg)

    # ── Benchmark summary ─────────────────────────────────────────────────────
    if (args.benchmark_summary or args.all) and summaries:
        print()
        print("  Generating benchmark summary...")
        bspath = build_benchmark_summary(
            summaries, output_dir,
            run_id=shared_run_id,
            reviewer=getattr(args, "reviewer", None),
            label=getattr(args, "label", None),
        )
        print(f"  ✓ Benchmark summary → {bspath}")

    # ── Final report ──────────────────────────────────────────────────────────
    print()
    print(f"=== Done. {len(summaries)} deal(s) processed. {len(errors)} error(s). ===")
    if errors:
        print("\nErrors:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
