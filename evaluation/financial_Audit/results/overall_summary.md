# Financial Audit — Overall Summary

**Generated**: 2026-04-15 19:23 UTC

## Results summary

| Verdict | Count |
|---------|-------|
| ✅ PASS | 9 |
| ⚠️ PASS WITH WARNINGS | 1 |
| ❌ FAIL | 0 |
| **Total** | **10** |

## Per-file verdicts

| # | File | Verdict | Families | Metric tokens | Current? | Projected? |
|---|------|---------|----------|---------------|----------|-----------|
| 1 | `capex.xls` | ⚠️ PASS WITH WARNINGS | cash | 1 | ✓ | — |
| 2 | `financial-model-template-cmu-compton-10-12-23-1.xlsx` | ✅ PASS | cash, gross_margin, headcount, revenue | 180 | ✓ | ✓ |
| 3 | `Financial-Projections-Template.xlsx` | ✅ PASS | cash, headcount, revenue | 24 | ✓ | — |
| 4 | `IC-Startup-Financial-Projections-9026 (1).xlsx` | ✅ PASS | cash, ebitda, gross_margin, revenue | 27 | ✓ | — |
| 5 | `margin.xls` | ✅ PASS | cash, ebitda, gross_margin, revenue | 12 | ✓ | — |
| 6 | `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx` | ✅ PASS | burn, cash, ebitda, real_estate, revenue | 19 | ✓ | — |
| 7 | `sf_blog_model.xlsx` | ✅ PASS | burn, cash, ebitda, gross_margin, headcount | 16 | ✓ | — |
| 8 | `Tech-Startup-Financial-statement-template.xlsx` | ✅ PASS | burn, cash, ebitda, gross_margin, headcount | 35 | ✓ | — |
| 9 | `tpe-financial-model-template.xlsm` | ✅ PASS | cash, ebitda, headcount, revenue | 113 | ✓ | — |
| 10 | `Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm` | ✅ PASS | burn, cash, real_estate, revenue | 9 | ✓ | — |

## Recurring patterns

| Pattern | Count |
|---------|-------|
| no-revenue | 10 |
| burn-gap | 4 |
| real-estate | 3 |

## Extraction strengths

- Vision worker `/extract-xlsx` successfully handled all `.xlsx` and `.xlsm` files
- Sheet-level segmentation (UoF, KPI, P&L, etc.) is working
- Metric family detection covers revenue, burn, runway, cash, EBITDA, gross margin, headcount, raise, real-estate
- Current vs. projected classification catches ordinal year labels (`Year N`) and future calendar years

## Best baseline tests (richest correct extractions)

- `sf_blog_model.xlsx` — 7 families, 16 tokens, verdict: PASS
- `Tech-Startup-Financial-statement-template.xlsx` — 6 families, 35 tokens, verdict: PASS
- `Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx` — 5 families, 19 tokens, verdict: PASS

## Strongest adversarial tests (expose extraction/classification gaps)

- `capex.xls` — PASS WITH WARNINGS: WARNING: No revenue metrics detected

## Top 5 code issues identified by this suite

1. Real-estate workbooks (NOI/IRR/waterfall) do not map to standard burn/revenue keys — schema differentiation needed

## Recommended fix priority order

1. **Period parser — column reference resolution**: `col_A`, `col_B`... labels need to be decoded from workbook column headers before promotion
2. **Temporal scope propagation on derived facts**: Facts derived from projected source facts should inherit `temporal_scope: 'projected'`
3. **Real-estate schema differentiation**: NOI/IRR/waterfall files should be routed to an RE-specific extraction path rather than the startup financial pipeline
4. **Burn tile selector fallback**: Already implemented — `alternative_burn_fact` now used as third fallback
5. **Legacy .xls support**: If `.xls` files are expected in production, the vision worker needs a dedicated xlrd-based extraction path
