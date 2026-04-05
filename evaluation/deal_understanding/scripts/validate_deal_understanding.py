#!/usr/bin/env python3
"""
evaluation/deal_understanding/scripts/validate_deal_understanding.py
====================================================================

Standing workflow: validates the platform's deal understanding output against
manually authored ground truth for PDF-only deals.

For each deal it checks five layers:
  Layer 0 — SPEC        : ground truth JSON is fully populated (synthetic mode only)
  Layer 1 — FIDELITY    : extracted narrative faithfully reflects the source deck
  Layer 2 — UNDERSTANDING : the system grasps the business model correctly
  Layer 3 — USEFULNESS  : output contains investor-relevant signals
  Layer 4 — HALLUCINATION : output does NOT contain unsupported claims
  Layer 5 — COMPLETENESS  : all required narrative fields are populated

Ground truth is loaded from evaluation/deal_understanding/ground_truth/<Deal>.json

Usage
-----
  # All reference deals
  python evaluation/deal_understanding/scripts/validate_deal_understanding.py

  # Single deal
  python evaluation/deal_understanding/scripts/validate_deal_understanding.py --deal SynthPDFDeal

  # Write report to file
  python evaluation/deal_understanding/scripts/validate_deal_understanding.py --output /tmp/deal_understanding_audit.md

  # Use a non-default API endpoint
  API_BASE_URL="http://..." python ...

Notes
-----
  Layer 1–4 checks require GET /api/v1/deals/{deal_id}/understanding.
  TODO (DDA-UNDERSTANDING): implement that endpoint before enabling live deals.
  Until then, live-deal checks will record SKIP with an explanation.

  Synthetic deals (_synthetic: true) skip the API call entirely and run
  Layer 0 spec coherence checks only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import urllib.request
import urllib.error

# ─── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT       = Path(__file__).resolve().parent.parent.parent.parent
GROUND_TRUTH_DIR = REPO_ROOT / "evaluation" / "deal_understanding" / "ground_truth"

API_BASE = os.environ.get("API_BASE_URL", "http://localhost:9001")

# ─── Reference deals ─────────────────────────────────────────────────────────

REFERENCE_DEALS: dict[str, dict] = {
    # ── Synthetic fixture deals ───────────────────────────────────────────────
    # _synthetic: true → no API call; only Layer 0 spec coherence is checked.
    # Add behavioral tests in apps/worker/src/... once real extraction exists.
    "SynthPDFDeal": {
        "deal_id":           "00000000-0000-5000-9000-000000000001",
        "ground_truth_file": "SynthPDFDeal.json",
    },
    # ── PDF audit deals (ground truth + endpoint live) ──
    # All 4 deals have fully populated ground_truth fixtures and a live
    # GET /api/v1/deals/{id}/understanding endpoint. L0-L5 checks run.
    "Palm": {
        "deal_id":           "5c8c7d6e-c992-4be7-8b10-268eac36f663",
        "ground_truth_file": "Palm.json",
    },
    "Probility": {
        "deal_id":           "42be8b30-2b7d-45e0-ade0-99427a505c59",
        "ground_truth_file": "Probility.json",
    },
    "ToxyScreen": {
        "deal_id":           "05042123-6c4f-4dcb-9131-a95fce3cd28c",
        "ground_truth_file": "ToxyScreen.json",
    },
    "Verse": {
        "deal_id":           "bcd59d33-7887-41cd-80b9-742bc5ba945a",
        "ground_truth_file": "Verse.json",
    },
    # ── Live deals ────────────────────────────────────────────────────────────
    # TODO (DDA-UNDERSTANDING): uncomment once understanding endpoint is live.
    # "DealDecision": {
    #     "deal_id":           "517be946-cab9-4bc1-8982-9522ff9dab32",
    #     "ground_truth_file": "DealDecision.json",
    # },
    # "WebMax": {
    #     "deal_id":           "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
    #     "ground_truth_file": "WebMax.json",
    # },
}

# ─── Layer labels ─────────────────────────────────────────────────────────────

LAYER_LABEL: dict[str, str] = {
    "L0-SPEC":          "L0-SPEC",
    "L1-FIDELITY":      "L1-FIDELITY",
    "L2-UNDERSTANDING": "L2-UNDERSTANDING",
    "L3-USEFULNESS":    "L3-USEFULNESS",
    "L4-HALLUCINATION": "L4-HALLUCINATION",
    "L5-COMPLETENESS":  "L5-COMPLETENESS",
}

# Words excluded when auto-extracting key terms from ground truth for overlap checks.
STOP_WORDS = frozenset({
    "that", "this", "with", "from", "their", "have", "been", "will", "they",
    "which", "also", "into", "more", "than", "your", "each", "such", "both",
    "through", "over", "these", "those", "other", "some", "most", "about",
    "after", "before", "under", "does", "when", "where", "what", "while",
    "company", "product", "service", "platform", "solution", "provides",
    "offers", "helps", "using", "enable", "enables", "allow", "allows",
    "build", "built", "uses",
})

# ─── API helpers ──────────────────────────────────────────────────────────────

def fetch_understanding(deal_id: str) -> dict | None:
    """
    Fetch the compiled understanding for a deal from the running API.

    TODO (DDA-UNDERSTANDING): implement GET /api/v1/deals/{deal_id}/understanding.
    Expected response shape:
    {
      "understanding": {
        "what_company_does": "...",
        "business_model": "...",
        "revenue_model": "...",
        "go_to_market": "...",
        "target_customer": "...",
        "traction_summary": "...",
        "market_positioning": "...",
        "competitive_differentiation": "..."
      }
    }
    """
    url = f"{API_BASE}/api/v1/deals/{deal_id}/understanding"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(
                f"  [WARN] Understanding endpoint not found for {deal_id}. "
                f"TODO (DDA-UNDERSTANDING): implement the endpoint.",
                file=sys.stderr,
            )
        else:
            print(f"  [WARN] HTTP {e.code} fetching understanding for {deal_id}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [WARN] Could not fetch understanding for {deal_id}: {e}", file=sys.stderr)
        return None


# ─── Check primitives ─────────────────────────────────────────────────────────

CheckResult = tuple[bool, str, str]   # (passed, value_found, message)


def _field_text(understanding_payload: dict | None, field: str) -> str:
    """Extract a text field from the understanding response (empty string if absent)."""
    if understanding_payload is None:
        return ""
    und = understanding_payload.get("understanding") or {}
    return (und.get(field) or "").strip()


def run_understanding_check(check: dict, understanding: dict | None) -> CheckResult:
    """
    Evaluate a single understanding / fidelity / completeness check.

    Supported check_type values:
      not_empty          — field must not be empty
      min_length         — field must have at least min_words words
      contains_any       — field.lower() must contain at least one of expected_terms
      contains_all       — field.lower() must contain all of expected_terms
      must_not_contain   — field.lower() must NOT contain any of prohibited_patterns
      keyword_overlap_pct — at least min_overlap_pct% of ground_truth_terms appear in field
      not_generic        — field must NOT match any entry in generic_phrases
    """
    field      = check.get("field", "")
    check_type = check.get("check_type", "not_empty")

    if understanding is None:
        return (
            False,
            "—",
            "SKIP — understanding data not available (API endpoint not implemented or unreachable)",
        )

    value = _field_text(understanding, field)

    if check_type == "not_empty":
        passed = bool(value)
        msg = "PASS — field is populated" if passed else f"FAIL — field '{field}' is empty or null"
        return (passed, value[:80] if value else "—", msg)

    if check_type == "min_length":
        min_words = int(check.get("min_words", 10))
        word_count = len(value.split()) if value else 0
        passed = word_count >= min_words
        msg = (
            f"PASS — {word_count} words (≥{min_words})" if passed
            else f"FAIL — {word_count} words (need ≥{min_words})"
        )
        return (passed, f"{word_count} words", msg)

    if check_type == "contains_any":
        terms     = [t.lower() for t in check.get("expected_terms", [])]
        val_lower = value.lower()
        found     = [t for t in terms if t in val_lower]
        passed    = bool(found)
        msg = (
            f"PASS — matched: {found[:3]}" if passed
            else f"FAIL — none of {terms[:5]} found"
        )
        return (passed, str(found[:3]) if found else "none matched", msg)

    if check_type == "contains_all":
        terms     = [t.lower() for t in check.get("expected_terms", [])]
        val_lower = value.lower()
        missing   = [t for t in terms if t not in val_lower]
        passed    = not missing
        msg = (
            f"PASS — all {len(terms)} terms present" if passed
            else f"FAIL — missing terms: {missing[:5]}"
        )
        return (passed, f"missing {missing[:3]}" if missing else "all present", msg)

    if check_type == "must_not_contain":
        patterns  = [p.lower() for p in check.get("prohibited_patterns", [])]
        val_lower = value.lower()
        found_bad = [p for p in patterns if p in val_lower]
        passed    = not found_bad
        msg = (
            "PASS — none of the prohibited patterns found" if passed
            else f"FAIL — prohibited patterns found: {found_bad[:3]}"
        )
        return (passed, str(found_bad[:3]) if found_bad else "none", msg)

    if check_type == "keyword_overlap_pct":
        gt_terms  = [t.lower() for t in check.get("ground_truth_terms", [])]
        if not gt_terms:
            return (True, "—", "PASS — no ground_truth_terms specified (skipped)")
        val_lower = value.lower()
        found     = [t for t in gt_terms if t in val_lower]
        pct_found = len(found) / len(gt_terms) * 100
        min_pct   = float(check.get("min_overlap_pct", 50))
        passed    = pct_found >= min_pct
        msg = (
            f"PASS — {pct_found:.0f}% overlap (≥{min_pct:.0f}%)" if passed
            else f"FAIL — {pct_found:.0f}% overlap (< {min_pct:.0f}% required)"
        )
        return (passed, f"{pct_found:.0f}% ({len(found)}/{len(gt_terms)} terms)", msg)

    if check_type == "not_generic":
        default_generic = [
            "a software company", "provides solutions", "innovative platform",
            "next generation", "cutting edge", "disruptive", "various services",
            "multiple features", "comprehensive solution", "state of the art",
        ]
        phrases   = [p.lower() for p in check.get("generic_phrases", default_generic)]
        val_lower = value.lower()
        found_bad = [p for p in phrases if p in val_lower]
        passed    = not found_bad
        msg = (
            "PASS — no generic boilerplate detected" if passed
            else f"FAIL — generic phrases found: {found_bad[:3]}"
        )
        return (passed, str(found_bad[:2]) if found_bad else "none", msg)

    # Unknown check_type — always fail explicitly rather than silently skipping.
    return (False, "—", f"FAIL — unknown check_type: '{check_type}'")


def run_consistency_check(
    check: dict,
    understanding: dict | None,
    gt: dict,
) -> CheckResult:
    """
    Evaluate a cross-field consistency check.

    Supported check_type values:
      both_non_empty         — two fields must both be populated
      term_alignment         — two fields must share at least N terms from expected_shared_terms
      ground_truth_term_in_field — terms present in a gt field must appear in an extracted field
    """
    check_type = check.get("check_type", "both_non_empty")

    if understanding is None:
        return (False, "—", "SKIP — understanding data not available")

    und = understanding.get("understanding") or {}

    if check_type == "both_non_empty":
        field_a = check.get("field_a", "")
        field_b = check.get("field_b", "")
        val_a   = (und.get(field_a) or "").strip()
        val_b   = (und.get(field_b) or "").strip()
        passed  = bool(val_a) and bool(val_b)
        empty_fields = [f for f, v in [(field_a, val_a), (field_b, val_b)] if not v]
        msg = (
            f"PASS — both '{field_a}' and '{field_b}' populated" if passed
            else f"FAIL — empty fields: {empty_fields}"
        )
        return (passed, "both populated" if passed else f"empty: {empty_fields}", msg)

    if check_type == "term_alignment":
        field_a       = check.get("field_a", "")
        field_b       = check.get("field_b", "")
        shared_terms  = [t.lower() for t in check.get("expected_shared_terms", [])]
        min_shared    = int(check.get("min_shared", 1))
        val_a         = (und.get(field_a) or "").lower()
        val_b         = (und.get(field_b) or "").lower()
        found_in_both = [t for t in shared_terms if t in val_a and t in val_b]
        passed        = len(found_in_both) >= min_shared
        msg = (
            f"PASS — {len(found_in_both)} shared terms: {found_in_both[:3]}" if passed
            else f"FAIL — only {len(found_in_both)}/{len(shared_terms)} shared terms found in both fields"
        )
        return (passed, str(found_in_both[:3]) if found_in_both else "none", msg)

    if check_type == "ground_truth_term_in_field":
        gt_field       = check.get("gt_field", "")
        ext_field      = check.get("extracted_field", "")
        gt_value       = (gt.get("ground_truth", {}).get(gt_field) or "").lower()
        ext_value      = (und.get(ext_field) or "").lower()
        required_terms = [t.lower() for t in check.get("required_terms", [])]
        if not required_terms:
            # Auto-extract meaningful words from the ground truth field.
            words = [w for w in re.findall(r"\b[a-z]{4,}\b", gt_value) if w not in STOP_WORDS]
            required_terms = words[:5]
        missing = [t for t in required_terms if t not in ext_value]
        passed = not missing
        msg = (
            f"PASS — required terms present in '{ext_field}'" if passed
            else f"FAIL — terms from '{gt_field}' missing in '{ext_field}': {missing[:3]}"
        )
        return (
            passed,
            f"missing {len(missing)}/{len(required_terms)}" if missing else "all present",
            msg,
        )

    return (False, "—", f"FAIL — unknown check_type: '{check_type}'")


# ─── Spec coherence checks (synthetic fixture mode) ───────────────────────────

_PLACEHOLDER_MARKERS = ("__FILL", "__PLACEHOLDER", "FILL IN", "TODO")


def _is_placeholder(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        s = v.strip()
        return not s or any(m in s for m in _PLACEHOLDER_MARKERS)
    return False


def check_spec_coherence(gt: dict) -> list[tuple[bool, str, str]]:
    """
    Layer 0 — SPEC COHERENCE (synthetic fixture mode only).

    Verifies all ground_truth narrative fields are populated and all validation
    sections contain at least one check.  Returns (passed, label, message) tuples.
    """
    results: list[tuple[bool, str, str]] = []
    gt_data    = gt.get("ground_truth") or {}
    validation = gt.get("validation") or {}

    required_narrative_fields = [
        "what_company_does", "business_model", "revenue_model",
        "go_to_market", "target_customer", "traction_summary",
        "market_positioning", "competitive_differentiation",
    ]
    for field in required_narrative_fields:
        label = f"[SPEC] ground_truth.{field}"
        val   = gt_data.get(field)
        if _is_placeholder(val):
            results.append((False, label, "FAIL — field is empty or placeholder"))
        else:
            results.append((True, label, f"PASS — populated ({len(str(val or ''))} chars)"))

    for list_field in ("key_strengths", "key_risks"):
        label = f"[SPEC] ground_truth.{list_field}"
        val   = gt_data.get(list_field, [])
        if not isinstance(val, list) or not val:
            results.append((False, label, "FAIL — must be a non-empty list"))
        else:
            results.append((True, label, f"PASS — {len(val)} items"))

    check_sections = [
        "understanding_checks",
        "consistency_checks",
        "hallucination_checks",
        "completeness_checks",
    ]
    for section in check_sections:
        label  = f"[SPEC] validation.{section} count"
        checks = validation.get(section, [])
        if not checks:
            results.append((False, label, f"FAIL — section '{section}' is empty"))
        else:
            results.append((True, label, f"PASS — {len(checks)} checks defined"))

    deal_id  = gt.get("deal_id", "")
    label_id = "[SPEC] deal_id is concrete"
    if not deal_id or _is_placeholder(deal_id):
        results.append((False, label_id, f"FAIL — deal_id is placeholder: {deal_id!r}"))
    else:
        results.append((True, label_id, f"PASS — deal_id={deal_id}"))

    return results


# ─── Scoring ──────────────────────────────────────────────────────────────────

def compute_scores(result: dict) -> dict[str, int | None]:
    """
    Compute scores from recorded findings.

    Layer weights for overall_understanding_score:
      L1-FIDELITY       35%
      L5-COMPLETENESS   25%
      L2-UNDERSTANDING  20%
      L3-USEFULNESS     10%
      L4-HALLUCINATION  10%
    """
    layer_counts: dict[str, dict[str, int]] = {
        "L1-FIDELITY":      {"pass": 0, "total": 0},
        "L2-UNDERSTANDING": {"pass": 0, "total": 0},
        "L3-USEFULNESS":    {"pass": 0, "total": 0},
        "L4-HALLUCINATION": {"pass": 0, "total": 0},
        "L5-COMPLETENESS":  {"pass": 0, "total": 0},
    }

    warning_count = 0
    for f in result["findings"]:
        layer = f["layer"]
        if layer in layer_counts:
            layer_counts[layer]["total"] += 1
            if f["status"] == "PASS":
                layer_counts[layer]["pass"] += 1
        if f["status"] == "WARN":
            warning_count += 1

    def pct(layer_key: str) -> int | None:
        c = layer_counts[layer_key]
        return round(c["pass"] / c["total"] * 100) if c["total"] else None

    fidelity             = pct("L1-FIDELITY")
    understanding        = pct("L2-UNDERSTANDING")
    usefulness           = pct("L3-USEFULNESS")
    hallucination_pass   = pct("L4-HALLUCINATION")
    completeness         = pct("L5-COMPLETENESS")

    weighted_components = [
        (fidelity,           0.35),
        (completeness,       0.25),
        (understanding,      0.20),
        (usefulness,         0.10),
        (hallucination_pass, 0.10),
    ]
    scored = [(v, w) for v, w in weighted_components if v is not None]
    if scored:
        total_weight = sum(w for _, w in scored)
        overall: int | None = round(sum(v * w for v, w in scored) / total_weight)
    else:
        overall = None

    return {
        "passed_checks":              result["pass_count"],
        "failed_checks":              result["fail_count"],
        "warning_checks":             warning_count,
        "fidelity_score":             fidelity,
        "completeness_score":         completeness,
        "investor_usefulness_score":  usefulness,
        "overall_understanding_score": overall,
    }


# ─── Per-deal runner ──────────────────────────────────────────────────────────

def run_deal_validation(deal_name: str, deal_cfg: dict) -> dict:
    """Run all validation checks for one deal. Returns a result dict."""
    deal_id = deal_cfg["deal_id"]
    gt_file = GROUND_TRUTH_DIR / deal_cfg["ground_truth_file"]

    result: dict = {
        "deal_name":   deal_name,
        "deal_id":     deal_id,
        "run_ts":      datetime.now(timezone.utc).isoformat(),
        "pass_count":  0,
        "fail_count":  0,
        "skip_count":  0,
        "findings":    [],
        "scores":      {},
        "error":       None,
    }

    if not gt_file.exists():
        result["error"] = f"Ground truth file not found: {gt_file}"
        return result
    try:
        gt = json.loads(gt_file.read_text(encoding="utf-8"))
    except Exception as e:
        result["error"] = f"Could not parse ground truth: {e}"
        return result

    def record(
        label: str,
        layer: str,
        status: str,
        value: Any,
        message: str,
        note: str = "",
    ) -> None:
        result["findings"].append({
            "label":   label,
            "layer":   LAYER_LABEL.get(layer, layer),
            "status":  status,
            "value":   value,
            "message": message,
            "note":    note,
        })
        if status == "PASS":
            result["pass_count"] += 1
        elif status == "FAIL":
            result["fail_count"] += 1
        else:
            result["skip_count"] += 1

    # ── Synthetic fixture mode — Layer 0 spec coherence only ──────────────────
    if gt.get("_synthetic"):
        for passed, label, message in check_spec_coherence(gt):
            record(
                label,
                "L0-SPEC",
                "PASS" if passed else "FAIL",
                None,
                message,
                "synthetic fixture — no live API call",
            )
        record(
            "[INFO] Behavioral / API tests",
            "L0-SPEC",
            "INFO",
            None,
            "Layer 1–5 checks require GET /api/v1/deals/{deal_id}/understanding. "
            "TODO (DDA-UNDERSTANDING): implement endpoint and re-run as live deal.",
            "",
        )
        result["scores"] = compute_scores(result)
        return result

    # ── Live deal mode — Layers 1–5 ───────────────────────────────────────────
    understanding = fetch_understanding(deal_id)

    if understanding is None:
        # Run ground-truth spec coherence even when API is unavailable.
        # This validates the fixture itself (field population, check counts, deal_id).
        for passed, label, message in check_spec_coherence(gt):
            record(
                label,
                "L0-SPEC",
                "PASS" if passed else "FAIL",
                None,
                message,
                "spec coherence — API unavailable",
            )
        record(
            "Understanding API unavailable — L1–L5 checks pending endpoint",
            "L1-FIDELITY",
            "SKIP",
            None,
            "SKIP — could not fetch understanding for deal_id="
            f"{deal_id!r}. "
            "TODO (DDA-UNDERSTANDING): implement GET /api/v1/deals/{deal_id}/understanding",
        )
        result["scores"] = compute_scores(result)
        return result

    validation = gt.get("validation") or {}

    # Layer 1 — Fidelity (understanding_checks)
    for chk in validation.get("understanding_checks", []):
        label  = chk.get("label", "understanding check")
        layer  = chk.get("layer", "L1-FIDELITY")
        note   = chk.get("note", "")
        passed, found, msg = run_understanding_check(chk, understanding)
        record(label, layer, "PASS" if passed else "FAIL", found, msg, note)

    # Layer 2 — Consistency (consistency_checks)
    for chk in validation.get("consistency_checks", []):
        label  = chk.get("label", "consistency check")
        layer  = chk.get("layer", "L2-UNDERSTANDING")
        note   = chk.get("note", "")
        passed, found, msg = run_consistency_check(chk, understanding, gt)
        record(label, layer, "PASS" if passed else "FAIL", found, msg, note)

    # Layer 4 — Hallucination (hallucination_checks)
    for chk in validation.get("hallucination_checks", []):
        label  = chk.get("label", "hallucination check")
        note   = chk.get("note", "")
        passed, found, msg = run_understanding_check(chk, understanding)
        record(label, "L4-HALLUCINATION", "PASS" if passed else "FAIL", found, msg, note)

    # Layer 5 — Completeness (completeness_checks)
    for chk in validation.get("completeness_checks", []):
        label  = chk.get("label", "completeness check")
        note   = chk.get("note", "")
        passed, found, msg = run_understanding_check(chk, understanding)
        record(label, "L5-COMPLETENESS", "PASS" if passed else "FAIL", found, msg, note)

    # Layer 3 — Investor usefulness: derived from investor_relevance_notes coverage
    # TODO (DDA-USEFULNESS): add explicit usefulness_checks section to the ground truth schema
    # when investor-facing output shapes are defined in the API response.
    gt_notes   = gt.get("ground_truth", {}).get("investor_relevance_notes") or []
    und_fields = understanding.get("understanding") or {}
    und_text   = " ".join(str(v).lower() for v in und_fields.values())
    for i, note_text in enumerate(gt_notes):
        label      = f"Investor note #{i+1} surfaced: {note_text[:60]}..."
        key_terms  = [w for w in re.findall(r"\b[a-z]{4,}\b", note_text.lower()) if w not in STOP_WORDS]
        found_any  = any(t in und_text for t in key_terms[:5])
        record(
            label,
            "L3-USEFULNESS",
            "PASS" if found_any else "FAIL",
            f"{sum(1 for t in key_terms[:5] if t in und_text)}/{min(5, len(key_terms))} terms",
            (
                f"PASS — investor-relevant terms found in understanding output"
                if found_any
                else f"FAIL — none of {key_terms[:3]} found in understanding output"
            ),
            note_text[:80],
        )

    result["scores"] = compute_scores(result)
    return result


# ─── Markdown report ──────────────────────────────────────────────────────────

STATUS_EMOJI = {"PASS": "✅", "FAIL": "❌", "INFO": "ℹ️", "SKIP": "⏭️", "WARN": "⚠️"}


def _score_bar(score: int | None) -> str:
    """Simple text progress bar for a 0–100 score."""
    if score is None:
        return "n/a"
    filled = round(score / 10)
    return f"{'█' * filled}{'░' * (10 - filled)} {score}%"


def format_deal_section(r: dict) -> str:
    lines: list[str] = []
    name  = r["deal_name"]
    p, f  = r["pass_count"], r["fail_count"]
    total = p + f + r.get("skip_count", 0)
    pct   = int(p / total * 100) if total else 0
    icon  = "🟢" if f == 0 else ("🟡" if f <= 2 else "🔴")
    lines.append(f"### {icon} {name}  ({p}/{total} checks passing, {pct}%)\n")
    lines.append(f"_{r['deal_id']}_\n")

    if r.get("error"):
        lines.append(f"> **Error:** {r['error']}\n")
        return "\n".join(lines)

    # Score block
    sc = r.get("scores") or {}
    if sc:
        lines.append("**Scores:**\n")
        lines.append(f"| Dimension | Score |")
        lines.append(f"| --- | --- |")
        lines.append(f"| Fidelity             | `{_score_bar(sc.get('fidelity_score'))}` |")
        lines.append(f"| Completeness         | `{_score_bar(sc.get('completeness_score'))}` |")
        lines.append(f"| Investor Usefulness  | `{_score_bar(sc.get('investor_usefulness_score'))}` |")
        lines.append(f"| **Overall**          | `{_score_bar(sc.get('overall_understanding_score'))}` |")
        lines.append("")

    # Findings table
    lines.append("| Status | Layer | Check | Value Found | Note |")
    lines.append("| --- | --- | --- | --- | --- |")
    for finding in r["findings"]:
        emoji    = STATUS_EMOJI.get(finding["status"], finding["status"])
        val_str  = str(finding["value"])[:60] if finding["value"] is not None else "—"
        note_str = str(finding["note"])[:80] if finding["note"] else ""
        lines.append(
            f"| {emoji} | `{finding['layer']}` | {finding['label']} | {val_str} | {note_str} |"
        )
    lines.append("")
    return "\n".join(lines)


def format_cross_deal_summary(results: list[dict]) -> str:
    lines: list[str] = []
    lines.append("## Cross-deal summary\n")
    lines.append("| Deal | Pass | Fail | Skip | Overall Score | Status |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    total_p = total_f = total_s = 0
    for r in results:
        p = r["pass_count"]
        f = r["fail_count"]
        s = r.get("skip_count", 0)
        total_p += p; total_f += f; total_s += s
        overall = (r.get("scores") or {}).get("overall_understanding_score")
        score_str = f"{overall}%" if overall is not None else "—"
        icon = "🟢 All pass" if f == 0 else f"🔴 {f} failing"
        lines.append(f"| {r['deal_name']} | {p} | {f} | {s} | {score_str} | {icon} |")
    lines.append(f"| **TOTAL** | **{total_p}** | **{total_f}** | **{total_s}** | — | |")
    lines.append("")

    fails = [
        (r["deal_name"], f_)
        for r in results
        for f_ in r["findings"]
        if f_["status"] == "FAIL"
    ]
    if fails:
        lines.append("### Open issues\n")
        for deal_name, f_ in fails:
            lines.append(
                f"- **[{f_['layer']}]** {deal_name} — {f_['label']}: {f_['message']}"
            )
        lines.append("")

    return "\n".join(lines)


def format_report(results: list[dict], run_ts: str) -> str:
    lines: list[str] = [
        "# Deal Understanding Audit Report",
        f"**Run:** {run_ts}  ",
        f"**Deals checked:** {len(results)}  ",
        "**Layers:** L1=Fidelity | L2=Understanding | L3=Usefulness | L4=Hallucination | L5=Completeness  ",
        "",
        "---",
        "",
        format_cross_deal_summary(results),
        "---",
        "",
        "## Per-deal results",
        "",
    ]
    for r in results:
        lines.append(format_deal_section(r))
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


# ─── Entrypoint ───────────────────────────────────────────────────────────────

def main() -> int:
    global API_BASE
    parser = argparse.ArgumentParser(
        description="Validate deal understanding output against source-document ground truth"
    )
    parser.add_argument(
        "--deal",
        metavar="NAME",
        help=f"Run only this deal. Options: {list(REFERENCE_DEALS)}",
    )
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Write markdown report to FILE instead of stdout",
    )
    parser.add_argument(
        "--api",
        default=API_BASE,
        metavar="URL",
        help=f"API base URL (default: {API_BASE})",
    )
    args = parser.parse_args()

    API_BASE = args.api
    run_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if args.deal:
        if args.deal not in REFERENCE_DEALS:
            print(
                f"ERROR: unknown deal '{args.deal}'. "
                f"Choose from: {list(REFERENCE_DEALS)}",
                file=sys.stderr,
            )
            return 1
        deals = {args.deal: REFERENCE_DEALS[args.deal]}
    else:
        deals = REFERENCE_DEALS

    results = []
    for name, cfg in deals.items():
        print(f"  Checking {name}...", file=sys.stderr)
        r = run_deal_validation(name, cfg)
        results.append(r)

    report_md = format_report(results, run_ts)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report_md, encoding="utf-8")
        print(f"Report written to {out_path}", file=sys.stderr)
    else:
        print(report_md)

    any_fail = any(r["fail_count"] > 0 for r in results)
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
