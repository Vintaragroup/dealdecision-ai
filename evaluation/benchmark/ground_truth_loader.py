"""
evaluation/benchmark/ground_truth_loader.py
=============================================

Loads ground-truth dataset files for the regression benchmark.

Ground-truth files live in:
  evaluation/ground_truth/<DealName>.json

File schema (ground_truth_v1):
{
  "_schema": "ground_truth_v1",
  "_notes": "optional human note",
  "deal_name": "<display name>",
  "deal_id": "<uuid>",           // optional; used for cross-reference only
  "slots": {
    "<slot_field>": <ground_truth_value>,
    ...
  },
  "financials": {
    "<metric_key>": <numeric_value>,
    ...
  }
}

All field keys under "slots" correspond to UnderstandingSlot.slot_field names.
All keys under "financials" correspond to financial_facts_v1.metric_key values.

Usage:
  gt = load_ground_truth("WebMax")         # single deal
  all_gt = load_all_ground_truth()         # dict keyed by deal_name (lowercased)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

# Ground truth directory is always relative to the evaluation/ root
_EVAL_ROOT = Path(__file__).resolve().parent.parent
GROUND_TRUTH_DIR = _EVAL_ROOT / "ground_truth"


class GroundTruthNotFoundError(FileNotFoundError):
    """Raised when a ground-truth file is missing."""


def _gt_path(deal_name: str) -> Path:
    """Return the expected path for a ground-truth file."""
    return GROUND_TRUTH_DIR / f"{deal_name}.json"


def load_ground_truth(deal_name: str) -> dict:
    """
    Load the ground-truth dataset for a single deal.

    Parameters
    ----------
    deal_name : str
        Exact filename stem (e.g. "WebMax", "Qredible").  Case-sensitive on
        file systems that distinguish case; match the filename exactly.

    Returns
    -------
    dict with at minimum 'deal_name', 'slots', and 'financials' keys.
    The '_schema' and '_notes' keys may also be present but are metadata only.

    Raises
    ------
    GroundTruthNotFoundError  if the file does not exist.
    ValueError                if the file is malformed (missing required keys).
    """
    path = _gt_path(deal_name)
    if not path.exists():
        raise GroundTruthNotFoundError(
            f"Ground-truth file not found: {path}\n"
            f"Create evaluation/ground_truth/{deal_name}.json to add ground truth."
        )

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in ground-truth file {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"Ground-truth file must be a JSON object: {path}")

    # Ensure required keys exist (with safe defaults)
    data.setdefault("slots", {})
    data.setdefault("financials", {})
    if "deal_name" not in data:
        data["deal_name"] = deal_name

    return data


def load_all_ground_truth(ground_truth_dir: Optional[Path] = None) -> dict[str, dict]:
    """
    Load all ground-truth files found in the ground_truth directory.

    Parameters
    ----------
    ground_truth_dir : Path, optional
        Override the default ground truth directory (useful in tests).

    Returns
    -------
    dict keyed by deal_name (as stored in the file, or the filename stem as
    fallback).  Each value is the parsed ground-truth dict.

    Files that fail to parse are skipped with a warning printed to stderr.
    """
    import sys

    gt_dir = ground_truth_dir or GROUND_TRUTH_DIR
    if not gt_dir.exists():
        return {}

    result: dict[str, dict] = {}
    for path in sorted(gt_dir.glob("*.json")):
        deal_name = path.stem
        try:
            gt = load_ground_truth(deal_name) if gt_dir is GROUND_TRUTH_DIR else _load_from_path(path, deal_name)
            key = gt.get("deal_name") or deal_name
            result[key] = gt
        except (ValueError, GroundTruthNotFoundError) as exc:
            print(f"[ground_truth_loader] WARNING: skipping {path.name}: {exc}", file=sys.stderr)

    return result


def _load_from_path(path: Path, deal_name: str) -> dict:
    """Load a ground-truth file from an explicit path (for custom directories)."""
    if not path.exists():
        raise GroundTruthNotFoundError(f"Not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    data.setdefault("slots", {})
    data.setdefault("financials", {})
    if "deal_name" not in data:
        data["deal_name"] = deal_name
    return data


def list_ground_truth_deals(ground_truth_dir: Optional[Path] = None) -> list[str]:
    """Return the list of deal names that have ground-truth files."""
    gt_dir = ground_truth_dir or GROUND_TRUTH_DIR
    if not gt_dir.exists():
        return []
    return sorted(p.stem for p in gt_dir.glob("*.json"))
