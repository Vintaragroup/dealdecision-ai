# Financial Extraction Regression Check

**Generated**: 2026-04-15 19:42 UTC
**Status**: 🟢 ALL ASSERTIONS PASS
**Regressions**: 0 | **Warnings**: 0

---

## Per-file assertion results

### ✅ `capex.xls` — adversarial_edge

**Passing assertions** (7):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:cash`
- ✓ `forbidden_family_absent:revenue`
- ✓ `forbidden_family_absent:burn`
- ✓ `forbidden_family_absent:runway`
- ✓ `expected_warning_present:No revenue metrics detected`

### ✅ `financial-model-template-cmu-compton-10-12-23-1.xlsx` — startup_baseline

**Passing assertions** (5):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:revenue`
- ✓ `presence:projected_values`

### ✅ `Financial-Projections-Template.xlsx` — startup_baseline

**Passing assertions** (4):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:revenue`

### ✅ `IC-Startup-Financial-Projections-9026 (1).xlsx` — startup_baseline

**Passing assertions** (5):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:revenue`
- ✓ `required_family_present:ebitda`

### ✅ `margin.xls` — adversarial_edge

**Passing assertions** (5):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:revenue`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:ebitda`

### ✅ `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx` — real_estate_schema_divergent

**Passing assertions** (4):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:real_estate`
- ✓ `required_family_present:cash`

### ✅ `sf_blog_model.xlsx` — real_estate_schema_divergent

**Passing assertions** (5):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:real_estate`
- ✓ `required_family_present:burn`
- ✓ `required_family_present:cash`

### ✅ `Tech-Startup-Financial-statement-template.xlsx` — startup_baseline

**Passing assertions** (6):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:revenue`
- ✓ `required_family_present:burn`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:ebitda`

### ✅ `tpe-financial-model-template.xlsm` — startup_baseline

**Passing assertions** (5):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:revenue`
- ✓ `required_family_present:cash`
- ✓ `required_family_present:ebitda`

### ✅ `Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm` — real_estate_schema_divergent

**Passing assertions** (4):
- ✓ `extraction_succeeded`
- ✓ `verdict_meets_floor`
- ✓ `required_family_present:real_estate`
- ✓ `required_family_present:cash`

---

## Category-level scoring

### adversarial_edge

| Metric | Value |
|--------|-------|
| Files | 2 |
| Pass | 2 |
| Warning | 0 |
| Regression | 0 |
| Pipeline confidence | **high** |

**Files in this category:**
- ✅ `capex.xls` (PASS)
- ✅ `margin.xls` (PASS)

### real_estate_schema_divergent

| Metric | Value |
|--------|-------|
| Files | 3 |
| Pass | 3 |
| Warning | 0 |
| Regression | 0 |
| Pipeline confidence | **high** |

**Files in this category:**
- ✅ `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx` (PASS)
- ✅ `sf_blog_model.xlsx` (PASS)
- ✅ `Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm` (PASS)

### startup_baseline

| Metric | Value |
|--------|-------|
| Files | 5 |
| Pass | 5 |
| Warning | 0 |
| Regression | 0 |
| Pipeline confidence | **high** |

**Files in this category:**
- ✅ `financial-model-template-cmu-compton-10-12-23-1.xlsx` (PASS)
- ✅ `Financial-Projections-Template.xlsx` (PASS)
- ✅ `IC-Startup-Financial-Projections-9026 (1).xlsx` (PASS)
- ✅ `Tech-Startup-Financial-statement-template.xlsx` (PASS)
- ✅ `tpe-financial-model-template.xlsm` (PASS)

---

## Engineering fix priority

Ranked by rubric: **5** = affects most files → **1** = schema-divergent only

| Rank | Fix | Weight | Files affected | Risk | Breadth |
|------|-----|--------|----------------|------|---------|
| 1 | `period-parser-column-label-resolution` | 5 | 10 | high | wide |
| 2 | `re-schema-guard-before-metric-promotion` | 3 | 3 | high | narrow |
| 3 | `vision-worker-xls-support` | 2 | 2 | medium | narrow |

### Top 3 engineering fixes this suite justifies

**1. period-parser-column-label-resolution** (priority weight: 5, risk: high)
  - col_A / col_B period labels are unresolved. The period parser cannot decode column headers from the structured workbook back to calendar dates. Affects all XLSX extractions where column headers are dates or months.
  - Affects: `all files`

**2. re-schema-guard-before-metric-promotion** (priority weight: 3, risk: high)
  - Real-estate burn/revenue signals must NOT be promoted to burn_rate or revenue_canonical without a schema guard. These files' burn/revenue are RE operating metrics, not startup financials.
  - Affects: `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx`, `sf_blog_model.xlsx`, `Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm`

**3. vision-worker-xls-support** (priority weight: 2, risk: medium)
  - Vision worker /extract-xlsx only handles .xlsx/.xlsm via openpyxl. .xls files fall back to xlrd direct scan — not production-parity. If .xls files can appear in deals, a dedicated extraction path is needed.
  - Affects: `capex.xls`, `margin.xls`

---

## Regression readiness assessment

**REGRESSION-READY** — Golden assertions cover all 10 files with zero regressions and minimal warnings. Safe to add this suite to CI.

- **Total files**: 10
- **Fully passing**: 10 (100%)
- **Warnings only**: 0
- **Regressions**: 0
- **Category coverage**: adversarial_edge, real_estate_schema_divergent, startup_baseline
