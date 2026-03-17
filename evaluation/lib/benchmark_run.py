"""
evaluation/lib/benchmark_run.py
=================================

Benchmark run metadata — stable identity for a benchmark execution so scores
can be compared across runs over time.

Run identity model
-------------------
Each benchmark execution has:
  - run_id        : stable slug, defaults to UTC timestamp
  - generated_at  : ISO-8601 timestamp
  - git_sha       : optional, captured automatically if git is available
  - reviewer      : optional reviewer name / identifier
  - label         : optional free-form description of this run
  - report_dir    : absolute path to the report output directory

Manifest file
-------------
The latest run is recorded at:
  <report_dir>/run_manifest.json

Historical runs are NOT overwritten; the manifest only reflects the most
recently generated run.  Callers wanting longitudinal tracking should commit
the manifest to git or copy it to a dated archive directory.

Comparison
----------
load_prior_run_manifest() attempts to read the manifest written by the
*previous* run (passed as `prior_report_dir`).  If none exists, it returns
None so callers can gracefully emit "No prior run available".
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Run ID generation
# ---------------------------------------------------------------------------

def generate_run_id(label: Optional[str] = None) -> str:
    """
    Generate a stable run identifier.

    Format:  YYYY-MM-DDTHHMMSSZ[--<label>]
    Example: 2026-03-09T140000Z
             2026-03-09T140000Z--cleanroom-01
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    if label:
        import re as _re
        safe = label.lower().strip()
        safe = _re.sub(r"[^a-z0-9-]+", "-", safe).strip("-")[:40]
        if safe:
            return f"{ts}--{safe}"

    return ts


def _capture_git_sha() -> Optional[str]:
    """Try to capture the current git HEAD SHA. Returns None on failure."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Run manifest
# ---------------------------------------------------------------------------

MANIFEST_FILENAME = "run_manifest.json"


def build_run_manifest(
    run_id: str,
    report_dir: Path,
    reviewer: Optional[str] = None,
    label: Optional[str] = None,
    deal_count: int = 0,
) -> dict:
    """Build a run manifest dict."""
    return {
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _capture_git_sha(),
        "reviewer": reviewer,
        "label": label,
        "report_dir": str(report_dir),
        "deal_count": deal_count,
    }


def write_run_manifest(manifest: dict, report_dir: Path) -> Path:
    """Write run manifest to <report_dir>/run_manifest.json."""
    path = report_dir / MANIFEST_FILENAME
    path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    return path


def load_run_manifest(report_dir: Path) -> Optional[dict]:
    """
    Load the run manifest from <report_dir>/run_manifest.json.
    Returns None if the file does not exist.
    """
    path = report_dir / MANIFEST_FILENAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_prior_run_manifest(prior_report_dir: Optional[Path]) -> Optional[dict]:
    """
    Load the manifest from a prior report directory.
    Returns None if no prior directory or no manifest file exists.
    """
    if prior_report_dir is None:
        return None
    return load_run_manifest(prior_report_dir)
