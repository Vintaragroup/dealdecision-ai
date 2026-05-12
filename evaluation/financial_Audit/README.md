# Financial Extraction Evaluation Suite

A 10-file regression-grade golden suite for the XLSX/XLS financial extraction pipeline.

## What this suite is for

This suite validates that the financial data extraction pipeline correctly:

- Identifies the right metric families (revenue, burn, cash, EBITDA, gross margin, headcount, real-estate) across diverse workbook types
- Distinguishes current-state facts from projected/forecasted values
- Detects real-estate schema workbooks and does not misclassify their burn/revenue signals as startup financials
- Succeeds on legacy `.xls` files via the xlrd fallback path
- Produces at least a minimum number of metric tokens per file category

It is **not** an end-to-end integration test. It runs against static fixture files without a live database, API, or worker. The only live dependency is Python + the libraries in `.venv`.

## Files in this suite

| File | Category | Notes |
|------|----------|-------|
| `capex.xls` | `adversarial_edge` | Single-purpose CAPEX tracker — no revenue expected |
| `financial-model-template-cmu-compton-10-12-23-1.xlsx` | `startup_baseline` | Large multi-sheet startup model |
| `Financial-Projections-Template.xlsx` | `startup_baseline` | Standard projections template |
| `IC-Startup-Financial-Projections-9026 (1).xlsx` | `startup_baseline` | IC-format projections |
| `margin.xls` | `adversarial_edge` | Legacy `.xls` margin/P&L tracker |
| `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx` | `real_estate_schema_divergent` | RE model — NOI/IRR/waterfall |
| `sf_blog_model.xlsx` | `real_estate_schema_divergent` | SF area RE acquisition model |
| `Tech-Startup-Financial-statement-template.xlsx` | `startup_baseline` | Richest startup baseline — burn+revenue+EBITDA |
| `tpe-financial-model-template.xlsm` | `startup_baseline` | Large macro-enabled startup model (27 sheets) |
| `Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm` | `real_estate_schema_divergent` | Value-add RE acquisition |

## How to re-run

### Standard (development)

```bash
pnpm eval:financial:regression
# or directly:
python3 evaluation/financial_Audit/evaluate_regression.py
```

### Strict mode (CI — fails on warnings too)

```bash
pnpm eval:financial:regression:ci
# or directly:
python3 evaluation/financial_Audit/evaluate_regression.py --strict
```

### Re-run the full extraction first, then evaluate

```bash
python3 evaluation/financial_Audit/run_audit.py
python3 evaluation/financial_Audit/evaluate_regression.py
```

`run_audit.py` uses direct openpyxl/xlrd scanning (no live services required). It overwrites `results/overall_summary.json`, which the evaluator reads.

## Results files

All outputs live in `evaluation/financial_Audit/results/`:

| File | Description |
|------|-------------|
| `golden_manifest.json` | Expected outcomes — the source of truth for assertions |
| `overall_summary.json` | Actual extraction results from the last `run_audit.py` run |
| `regression_check.md` | Human-readable assertion report with category scoring |
| `regression_check.json` | Machine-readable CI output |
| `01_..._report.md` – `10_..._report.md` | Per-file detailed extraction reports |

## How to update the manifest safely

See [MANIFEST_UPDATE_POLICY.md](MANIFEST_UPDATE_POLICY.md) for the full policy.

**Short version:**

1. Run the extraction: `python3 evaluation/financial_Audit/run_audit.py`
2. Check what changed: `python3 evaluation/financial_Audit/evaluate_regression.py`
3. If a change is **intentional and correct**, edit `golden_manifest.json` with a comment explaining the root cause
4. If a change is **a regression**, fix the code — do not edit the manifest to hide it

Legitimate manifest updates:
- A new metric family now correctly detected after a real code improvement
- A file's `min_metric_tokens` threshold adjusted after a schema change
- A file reclassified after verifying model type (e.g., a startup-only model now correctly identified as RE)

Not legitimate:
- Lowering `min_metric_tokens` because a recent change broke extraction
- Removing a required family because detection regressed
- Changing `expected_verdict` from `PASS` to `PASS_WITH_WARNINGS` without code evidence

## What counts as a regression vs a legitimate change

| Scenario | Classification |
|----------|---------------|
| Previously detected metric family disappears after a code change | **Regression — fix code** |
| Token count drops below `min_metric_tokens` | **Regression — fix code** |
| `extraction_succeeded` becomes `false` | **Regression — fix code** |
| `is_real_estate` flips | **Regression — fix code** |
| New metric family now correctly detected | **Improvement — update manifest** |
| Period classification improves (projected → current) | **Improvement — update manifest** |
| New file added to evaluation set | **Expansion — add manifest entry** |
