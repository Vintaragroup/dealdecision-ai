"""
evaluation/lib/review_persistence.py
======================================

Persistent reviewer verdict storage for the Deal Understanding Benchmark.

Architecture
------------
Each deal evaluation produces two co-located files:

  evaluation/reports/<slug>/deal_audit.md   ← human-readable audit (existing)
  evaluation/reports/<slug>/review.json     ← machine-readable reviewer verdicts (NEW)

The sidecar review.json is generated as a **template** the first time a deal
audit is produced.  All verdict fields are null; a reviewer fills them in.
On subsequent runs, the file is NOT overwritten — existing verdicts are
preserved.  The benchmark scoring pipeline reads the file and applies any
verdicts that have been filled in.

Review file schema
------------------
{
  "benchmark_run_id": "<run_id>",
  "deal_id": "<uuid>",
  "deal_slug": "<slug>",
  "reviewed_at": null,          // ISO-8601; reviewer fills this in
  "reviewer": null,             // reviewer name / identifier
  "doc_type": "<string>",
  "semantic_slots": {
    "<slot_field>": {
      "verdict": null,          // "correct" | "partial" | "incorrect" | "unsupported"
      "notes": null,
      "page_reference": null
    },
    ...
  },
  "facts": {
    "<fact_id>": {
      "verdict": null,
      "notes": null
    },
    ...
  },
  "financial_facts": {
    "<fact_id>": {
      "verdict": null,
      "notes": null
    },
    ...
  },
  "narrative": {
    "executive_summary": {
      "verdict": null,
      "notes": null
    }
  }
}

Design notes
------------
- read tolerates unknown fields (forward-compat)
- read tolerates missing fields (backward-compat with partial files)
- sidecar is never overwritten once it exists (verdicts are precious data)
- apply_verdicts_to_understanding() only touches known slot_fields
- accuracy functions follow the same None-as-no-data contract as reviewer_verdict.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Internal serialisation helpers
# ---------------------------------------------------------------------------

REVIEW_FILENAME = "review.json"


def _safe_str(v: Any) -> Optional[str]:
    """Return string or None; coerce non-string scalars."""
    if v is None:
        return None
    if isinstance(v, str):
        return v.strip() or None
    return str(v)


# ---------------------------------------------------------------------------
# Record types
# ---------------------------------------------------------------------------

@dataclass
class SlotVerdictRecord:
    """Reviewer verdict for a single semantic slot."""
    verdict: Optional[str] = None         # ReviewerVerdict value string or None
    notes: Optional[str] = None
    page_reference: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "notes": self.notes,
            "page_reference": self.page_reference,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SlotVerdictRecord":
        return cls(
            verdict=_safe_str(d.get("verdict")),
            notes=_safe_str(d.get("notes")),
            page_reference=_safe_str(d.get("page_reference")),
        )

    @property
    def has_verdict(self) -> bool:
        return self.verdict is not None and self.verdict.strip() != ""


@dataclass
class FactVerdictRecord:
    """Reviewer verdict for a single deal_fact or financial_fact."""
    verdict: Optional[str] = None         # ReviewerVerdict value string or None
    notes: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FactVerdictRecord":
        return cls(
            verdict=_safe_str(d.get("verdict")),
            notes=_safe_str(d.get("notes")),
        )

    @property
    def has_verdict(self) -> bool:
        return self.verdict is not None and self.verdict.strip() != ""


@dataclass
class DealReview:
    """
    Fully parsed review sidecar for one deal.

    Attributes are the deserialized form of review.json.  All verdict dicts
    use string keys (slot_field / fact_id / "executive_summary") and record
    instances as values.
    """
    benchmark_run_id: str
    deal_id: str
    deal_slug: str
    reviewed_at: Optional[str]
    reviewer: Optional[str]
    doc_type: str
    semantic_slots: dict[str, SlotVerdictRecord] = field(default_factory=dict)
    facts: dict[str, FactVerdictRecord] = field(default_factory=dict)
    financial_facts: dict[str, FactVerdictRecord] = field(default_factory=dict)
    narrative: dict[str, SlotVerdictRecord] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Template generation
# ---------------------------------------------------------------------------

def generate_review_template(
    deal_id: str,
    slug: str,
    understanding: Any,             # DealUnderstandingV1 — typed loosely to avoid circular import
    deal_facts: list[dict],
    financial_facts: list[dict],
    doc_type: str,
    run_id: str,
) -> dict:
    """
    Build an empty review dict pre-populated with all expected keys.

    Verdict fields are all null — ready for a reviewer to fill in.
    Only populates slots where `slot.populated` is True so reviewers aren't
    asked to grade extractions that were never attempted.

    Parameters
    ----------
    deal_id         : UUID string of the deal
    slug            : deal slug (used as directory name)
    understanding   : DealUnderstandingV1 instance
    deal_facts      : rows from fetch_deal_facts() (must contain 'fact_id')
    financial_facts : rows from fetch_financial_facts() (must contain 'fact_id')
    doc_type        : classified document type string
    run_id          : benchmark run identifier

    Returns
    -------
    dict matching the review.json schema — all verdict / notes fields are null.
    """
    # Semantic slots — only populated slots get an entry
    slots_dict: dict = {}
    for slot in getattr(understanding, "slots", []):
        slot_field = getattr(slot, "slot_field", None)
        if slot_field and getattr(slot, "populated", False):
            slots_dict[slot_field] = SlotVerdictRecord().to_dict()

    # Deal facts
    facts_dict: dict = {}
    for row in deal_facts:
        fid = str(row.get("fact_id", "")).strip()
        if fid:
            facts_dict[fid] = FactVerdictRecord().to_dict()

    # Financial facts
    fin_dict: dict = {}
    for row in financial_facts:
        fid = str(row.get("fact_id", "")).strip()
        if fid:
            fin_dict[fid] = FactVerdictRecord().to_dict()

    return {
        "benchmark_run_id": run_id,
        "deal_id": deal_id,
        "deal_slug": slug,
        "reviewed_at": None,
        "reviewer": None,
        "doc_type": doc_type,
        "semantic_slots": slots_dict,
        "facts": facts_dict,
        "financial_facts": fin_dict,
        "narrative": {
            "executive_summary": SlotVerdictRecord().to_dict(),
        },
    }


# ---------------------------------------------------------------------------
# Sidecar write (never overwrites)
# ---------------------------------------------------------------------------

def write_review_sidecar(
    review_dict: dict,
    deal_dir: Path,
    *,
    overwrite: bool = False,
) -> Path:
    """
    Write review_dict to <deal_dir>/review.json.

    By default will NOT overwrite an existing file — existing reviewer verdicts
    are precious data.  Pass overwrite=True to force replacement (e.g. from
    tests or a deliberate re-template operation).

    Parameters
    ----------
    review_dict : result of generate_review_template() or a complete review dict
    deal_dir    : path to the deal report directory (e.g. evaluation/reports/webmax/)
    overwrite   : if False (default), skip write when file already exists

    Returns
    -------
    Path to the written (or already existing) review.json file.
    """
    deal_dir.mkdir(parents=True, exist_ok=True)
    out_path = deal_dir / REVIEW_FILENAME
    if out_path.exists() and not overwrite:
        return out_path
    out_path.write_text(json.dumps(review_dict, indent=2, default=str), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Verdict loading
# ---------------------------------------------------------------------------

def load_reviewer_verdicts(deal_dir: Path) -> Optional[DealReview]:
    """
    Load and parse review.json from <deal_dir>/review.json.

    Returns None when:
    - The file does not exist
    - The file is empty or malformed JSON
    - The root object is not a dict

    Unknown fields are silently ignored (forward-compatibility).
    Partially filled verdict dicts are loaded as-is.
    """
    path = deal_dir / REVIEW_FILENAME
    if not path.exists():
        return None

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(raw, dict):
        return None

    # Parse semantic_slots
    slots: dict[str, SlotVerdictRecord] = {}
    for k, v in (raw.get("semantic_slots") or {}).items():
        if isinstance(v, dict):
            slots[k] = SlotVerdictRecord.from_dict(v)

    # Parse facts
    facts: dict[str, FactVerdictRecord] = {}
    for k, v in (raw.get("facts") or {}).items():
        if isinstance(v, dict):
            facts[k] = FactVerdictRecord.from_dict(v)

    # Parse financial_facts
    fin_facts: dict[str, FactVerdictRecord] = {}
    for k, v in (raw.get("financial_facts") or {}).items():
        if isinstance(v, dict):
            fin_facts[k] = FactVerdictRecord.from_dict(v)

    # Parse narrative
    narrative: dict[str, SlotVerdictRecord] = {}
    for k, v in (raw.get("narrative") or {}).items():
        if isinstance(v, dict):
            narrative[k] = SlotVerdictRecord.from_dict(v)

    return DealReview(
        benchmark_run_id=raw.get("benchmark_run_id", ""),
        deal_id=raw.get("deal_id", ""),
        deal_slug=raw.get("deal_slug", ""),
        reviewed_at=raw.get("reviewed_at"),
        reviewer=raw.get("reviewer"),
        doc_type=raw.get("doc_type", "unknown"),
        semantic_slots=slots,
        facts=facts,
        financial_facts=fin_facts,
        narrative=narrative,
    )


# ---------------------------------------------------------------------------
# Apply verdicts to understanding
# ---------------------------------------------------------------------------

def apply_verdicts_to_understanding(
    understanding: Any,     # DealUnderstandingV1
    review: DealReview,
) -> None:
    """
    Copy verdict / notes / page_reference from a DealReview onto UnderstandingSlot objects.

    Mutates understanding in-place.
    Silently ignores slot_fields that exist in the review but not in understanding,
    and slots that have no corresponding entry in the review.
    """
    if review is None:
        return
    for slot in getattr(understanding, "slots", []):
        slot_field = getattr(slot, "slot_field", None)
        if slot_field and slot_field in review.semantic_slots:
            rec = review.semantic_slots[slot_field]
            slot.reviewer_verdict = rec.verdict if rec.has_verdict else None
            slot.reviewer_notes = rec.notes
            slot.reviewer_page_reference = rec.page_reference


# ---------------------------------------------------------------------------
# Per-deal rollup scoring
# ---------------------------------------------------------------------------

def compute_deal_rollup(
    review: DealReview,
    understanding: Any,     # DealUnderstandingV1 with reviewer_verdict fields set
) -> dict:
    """
    Compute accuracy percentages for a single deal from its persisted review.

    Applies the review verdicts into the understanding slots before computing
    accuracy so this function is self-contained (callers do not need to call
    apply_verdicts_to_understanding separately).

    Returns
    -------
    {
      "semantic_accuracy_pct": float | None,
      "fact_accuracy_pct": float | None,
      "financial_accuracy_pct": float | None,
      "narrative_accuracy_pct": float | None,
      "overall_score": float | None,
    }
    """
    from .reviewer_verdict import (
        semantic_accuracy_pct,
        fact_accuracy_pct,
        financial_accuracy_pct,
        narrative_accuracy_pct,
        overall_score,
    )

    # Apply slot verdicts first
    apply_verdicts_to_understanding(understanding, review)

    # Semantic (slot) accuracy
    sem_acc = semantic_accuracy_pct(getattr(understanding, "slots", []))

    # Fact accuracy — collect verdict strings from review.facts
    fact_verdicts = [r.verdict for r in review.facts.values()]
    fact_acc = fact_accuracy_pct(fact_verdicts)

    # Financial accuracy
    fin_verdicts = [r.verdict for r in review.financial_facts.values()]
    fin_acc = financial_accuracy_pct(fin_verdicts)

    # Narrative accuracy — keyed "executive_summary"
    nar_rec = review.narrative.get("executive_summary")
    nar_acc = narrative_accuracy_pct(nar_rec.verdict if nar_rec else None)

    return {
        "semantic_accuracy_pct": sem_acc,
        "fact_accuracy_pct": fact_acc,
        "financial_accuracy_pct": fin_acc,
        "narrative_accuracy_pct": nar_acc,
        "overall_score": overall_score(sem_acc, fact_acc, fin_acc, nar_acc),
    }


# ---------------------------------------------------------------------------
# Cross-deal rollup
# ---------------------------------------------------------------------------

def compute_cross_deal_rollup(rollups: list[dict]) -> dict:
    """
    Average per-deal rollup dicts across all deals.

    None values (no verdicts recorded) are excluded from each component's
    average — they are treated as "not yet scored", not as zeros.

    Parameters
    ----------
    rollups : list of dicts from compute_deal_rollup()

    Returns
    -------
    {
      "avg_semantic_accuracy_pct": float | None,
      "avg_fact_accuracy_pct": float | None,
      "avg_financial_accuracy_pct": float | None,
      "avg_narrative_accuracy_pct": float | None,
      "avg_overall_score": float | None,
      "deals_scored": int,   // number of deals with at least one component scored
    }
    """
    def _avg(key: str) -> Optional[float]:
        values = [r[key] for r in rollups if r.get(key) is not None]
        if not values:
            return None
        return round(sum(values) / len(values), 1)

    scored_count = sum(
        1 for r in rollups if any(v is not None for v in r.values())
    )

    return {
        "avg_semantic_accuracy_pct": _avg("semantic_accuracy_pct"),
        "avg_fact_accuracy_pct": _avg("fact_accuracy_pct"),
        "avg_financial_accuracy_pct": _avg("financial_accuracy_pct"),
        "avg_narrative_accuracy_pct": _avg("narrative_accuracy_pct"),
        "avg_overall_score": _avg("overall_score"),
        "deals_scored": scored_count,
    }


# ---------------------------------------------------------------------------
# Review completion metrics
# ---------------------------------------------------------------------------

def review_completion_metrics(
    review: DealReview,
    understanding: Any,
    deal_facts: list[dict],
    financial_facts: list[dict],
) -> dict:
    """
    Count how many verdict fields have been filled vs total expected for this deal.

    Parameters
    ----------
    review          : loaded DealReview
    understanding   : DealUnderstandingV1
    deal_facts      : rows from fetch_deal_facts()
    financial_facts : rows from fetch_financial_facts()

    Returns
    -------
    {
      "slots_reviewed": int,
      "slots_total": int,
      "facts_reviewed": int,
      "facts_total": int,
      "financial_reviewed": int,
      "financial_total": int,
      "narrative_reviewed": int,    // 0 or 1
      "narrative_total": 1,
      "completion_pct": float,
    }
    """
    # Slots — only populated slots count as reviewable
    populated_slots = [
        s for s in getattr(understanding, "slots", [])
        if getattr(s, "populated", False)
    ]
    slots_total = len(populated_slots)
    slots_reviewed = sum(
        1 for s in populated_slots
        if review.semantic_slots.get(getattr(s, "slot_field", ""), FactVerdictRecord()).has_verdict
    )

    # Facts
    facts_total = len(deal_facts)
    facts_reviewed = sum(
        1 for r in review.facts.values() if r.has_verdict
    )

    # Financial facts
    fin_total = len(financial_facts)
    fin_reviewed = sum(
        1 for r in review.financial_facts.values() if r.has_verdict
    )

    # Narrative
    nar_rec = review.narrative.get("executive_summary")
    nar_reviewed = 1 if (nar_rec and nar_rec.has_verdict) else 0
    nar_total = 1

    total = slots_total + facts_total + fin_total + nar_total
    reviewed = slots_reviewed + facts_reviewed + fin_reviewed + nar_reviewed
    completion_pct = round(100.0 * reviewed / total, 1) if total > 0 else 0.0

    return {
        "slots_reviewed": slots_reviewed,
        "slots_total": slots_total,
        "facts_reviewed": facts_reviewed,
        "facts_total": facts_total,
        "financial_reviewed": fin_reviewed,
        "financial_total": fin_total,
        "narrative_reviewed": nar_reviewed,
        "narrative_total": nar_total,
        "completion_pct": completion_pct,
    }
