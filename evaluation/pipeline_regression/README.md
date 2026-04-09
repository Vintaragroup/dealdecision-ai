# Pipeline Regression Suite

Ground-truth-driven regression runner for the DealDecisionAI pipeline.
Validates live system output against per-deal benchmark specifications after any pipeline, scoring, or report-compiler change.

---

## Quick start

```bash
# Full suite (all mapped benchmark cases)
pnpm eval:regression

# Single case
pnpm eval:regression:case Allurion

# Hard-fail exit code (for CI — writes JSON only)
pnpm eval:regression:ci

# Report-only mode (no process failure on FAILs)
pnpm eval:regression:no-fail
```

All reports are written to `artifacts/`.

---

## Directory layout

```
evaluation/
  ground_truth/          ← Benchmark GT files (ground_truth_v1 schema)
    Allurion.json
    Albuquerque.json
    Probility.json
    MagarianFund.json
    Qredible.json
    StackFactor.json
    Deal Decision.json
    Synthetic*.json        ← Test fixtures only (no DB deals, will be UNMAPPED)

  pipeline_regression/   ← Runner code (this directory)
    run.py               ← CLI entry point
    loader.py            ← GT discovery, deal mapping, system output fetching
    checker.py           ← Check executors and outcome classification
    reporter.py          ← Markdown + JSON report builders
    README.md            ← This file
```

---

## Ground-truth schema (`ground_truth_v1`)

Each GT file is a JSON object with `_schema: "ground_truth_v1"`.

```json
{
  "_schema": "ground_truth_v1",
  "deal_name": "Allurion",
  "deal_id": "<uuid>",
  "_failure_modes_targeted": [
    "BUG-XY-1: description of a known open regression"
  ],
  "slots": {
    "deal_type": "medtech",
    "stage": "series_b"
  },
  "financials": {
    "known_issues": {
      "short_key_BUG_XY_1": {
        "description": "...",
        "impact": "...",
        "status": "open"
      }
    },
    "validation": {
      "extraction_checks": [...],
      "noise_checks": [...],
      "report_checks": [...],
      "dio_checks": [...],
      "evidence_checks": [...]
    }
  }
}
```

### Check categories

| Category | What it tests |
|----------|---------------|
| `extraction_checks` | `financial_facts_v1` rows: expected value ± tolerance, optional `allowed_source_kinds` |
| `noise_checks` | Either a SQL COUNT guard (`sql_filter + expected_count`) or a report-path value guard (`expected_max`, `expected_string`, etc.) |
| `report_checks` | API `/report` JSON path assertions (string, value, absent, min/max, tolerance) |
| `dio_checks` | `deal_intelligence_objects.dio_data` path assertions |
| `evidence_checks` | `promoted_facts` in the report, filtered by `fact_type`, then a path assertion within `value_json` |

---

## How deal mapping works

The runner queries the database for each GT file's `deal_id` field.
If a `deal_id` is present and resolves to a deal in the DB, the case is **mapped**.
If the deal is not found, the case is **UNMAPPED** and all its checks are skipped.

Synthetic test fixtures (`Synthetic*.json`) intentionally have no DB deal and will always be UNMAPPED.

---

## Outcome classification

| Outcome | Meaning |
|---------|---------|
| `PASS` | Check passed |
| `FAIL` | Check failed — **counts as a regression** |
| `KNOWN_ISSUE` | Check failed but the failure matches a documented known bug |
| `SKIP` | Check could not execute (missing data, SQL error, etc.) |

**Exit codes:**
- `0` — all checks are `PASS`, `KNOWN_ISSUE`, or `SKIP`
- `1` — at least one `FAIL`, or fatal runner error

### How `KNOWN_ISSUE` classification works

A failing check is classified `KNOWN_ISSUE` when **any** of the following match:

1. The check's `note` field contains a BUG ref (e.g. `"BUG-RE-3"`) that appears in `_failure_modes_targeted`
2. Word overlap between the check label and a `_failure_modes_targeted` entry (≥ 2 shared words)
3. Word overlap between the check label and a `financials.known_issues` key (≥ 2 shared words)

**Important:** `KNOWN_ISSUE` is not automatic — it requires explicit documentation in the GT file.
Do not add BUG refs or `known_issues` entries to suppress real regressions.

---

## Report outputs

Each run writes to `artifacts/`:

| File | Description |
|------|-------------|
| `regression_suite_report_<YYYYMMDD>.md` | Full-suite human-readable report |
| `regression_suite_report_<YYYYMMDD>.json` | Full-suite machine-readable report |
| `regression_suite_latest.md` | Stable copy of the most recent full-suite run |
| `regression_suite_latest.json` | Stable copy of the most recent full-suite run |
| `regression_<Case>_<YYYYMMDD>.md` | Single-case run report |
| `regression_latest_<Case>.md` | Stable copy of the most recent single-case run |

---

## CLI reference

```
python3 evaluation/pipeline_regression/run.py [options]

Options:
  --case CASE_NAME     Evaluate only this GT case (file stem, e.g. Allurion)
  --db-url URL         Postgres connection string
                       (default: postgresql://postgres:postgres@localhost:55433/dealdecision)
  --gt-dir DIR         Override ground_truth directory path
  --run-id ID          Run identifier used in output filenames (default: YYYYMMDD)
  --no-fail            Exit 0 even when FAIL checks exist (report only)
  --json-only          Write only the JSON report (skip Markdown)
  --md-only            Write only the Markdown report (skip JSON)
```

---

## Release-gate benchmark set

### Blocking (must be PASS or KNOWN_ISSUE — no FAIL)

| Case | Why it's blocking |
|------|------------------|
| **Allurion** | Medtech Series B — structured XLSX model, burn + runway, cap table |
| **Qredible** | B2B SaaS seed — KPI tile extraction, deck language noise discipline |
| **Albuquerque** | Real-asset / fund SPV — SPAC contamination, revenue scale noise (BUG-RE-3 tracked) |
| **MagarianFund** | Fund of funds — AUM vs raise separation, fund vs startup classification |

### Extended (run after structural changes — FAIL warrants investigation)

| Case | What it covers |
|------|---------------|
| Probility | Healthcare services — multi-doc pipeline, evidence traceability |
| StackFactor | Seed SaaS — KPI tile vs XLSX confidence ranking (BUG-SF-1 tracked) |
| Deal Decision | Projection-only financials — XLSX year-label noise (BUG-DD-1 tracked) |

---

## Adding a new benchmark case

1. Create `evaluation/ground_truth/<DealName>.json` with `"_schema": "ground_truth_v1"`
2. Set `"deal_id"` to the deal's UUID from the DB
3. Add `financials.validation` with at least:
   - 1–2 `extraction_checks` for key financial metrics
   - 1–2 `noise_checks` for the most common noise patterns for this deal type
   - 2–3 `report_checks` for critical structured output fields
4. Run the suite: `pnpm eval:regression:case <DealName>`
5. If the case FAILs on a known open bug, add it to `_failure_modes_targeted` and `financials.known_issues` with a BUG ref
6. Re-run until PASS/KNOWN_ISSUE only, then commit the GT file

---

## Extending the runner

The runner is split into four files with clear responsibilities:

- **`loader.py`** — change deal mapping logic, add new fetch methods (e.g. new DB tables)
- **`checker.py`** — add new check categories or comparison operators
- **`reporter.py`** — change report layout or add new cross-case patterns
- **`run.py`** — add new CLI flags or phases

The `_match_known_issue()` function in `checker.py` is the single place that implements known-issue classification logic. Do not add bypass logic elsewhere.
