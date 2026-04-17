# P5 Phase 4 — Validation Report

**Date:** 2026-04-11  
**API:** http://localhost:9001 (dealdecision-dev-api_dev-1)  
**Test suite:** 43/43 new tests pass, 1490/1490 total core tests pass

---

## Pre-Validation Setup

1. Built `@dealdecision/core` with Phase 4 changes (`pnpm --filter @dealdecision/core build`)
2. Restarted `dealdecision-dev-api_dev-1`
3. Cleared `ingestion_reports` for all 10 pilot deals (`DELETE FROM ingestion_reports WHERE deal_id IN (...)` — 10 rows deleted)
4. Fetched fresh reports for all 10 deals — all returned HTTP 200

---

## Test Results

### Core Package

```
Test Suites: 102 passed, 1 skipped (102 of 103)
Tests:       1490 passed, 30 skipped (1520 total)
Phase 3 baseline: 1477 tests
Phase 4 additions: 43 new tests
```

All 43 Phase 4 tests pass immediately without adjustments (except one TypeScript type fix: `pdf_text` → `pdf_kpi_line` in `classifyRevenueFactType`).

### Phase 4 test breakdown

```
✓ FPG CRE classification guard (12 tests)
  - asset_class="real_estate" → nulled with real_estate_classification_mismatch
  - policy_id="real_estate_underwriting" alone → nulled
  - asset_class="fintech" → NOT nulled (Carmoola regression guard)
  - null/missing dio → NOT nulled spuriously
  - 4 expanded text patterns (stabilized yield, sources and uses, construction loan, offering memorandum)
  - dual-rule discrimination (classification vs text)

✓ document-authority-tiers (18 tests)
  - 4 kind mappings
  - 6 filename patterns
  - 8 authority rank value assertions

✓ Compiler DIO BM containment (4 tests)
  - CRE + arbitratedModel → null
  - CRE + overviewModel → null
  - non-CRE regression (Subscription/SaaS preserved)
  - null asset_class regression

✓ fact_type_label propagation (9 tests)
  - historical XLSX → actual
  - proforma XLSX (current+future) → projected
  - candidates include fact_type_label
  - H1 period → interim
  - Q1 period → interim
  - mixed actuals candidates
  - no financial facts → no spurious label
```

---

## Live Validation — 10 Pilot Deals

### Primary Fix: Albuquerque

**Before Phase 4:**
- `structured_summary.business_model.value = "Omnichannel (DTC + Wholesale/Retail)"`
- Source: DIO `business_model_arbitration_v1` (LLM from phase1, wrong context)

**After Phase 4:**
- `structured_summary.business_model.value = null`
- `structured_summary.business_model.label = "GuardNulled"`
- `null_rule = "business_model.real_estate_context_mismatch"` (expanded text patterns ALSO matched, defense-in-depth)
- `replaced_from = "Omnichannel (DTC + Wholesale/Retail)"`

**Both fix layers active:**
1. Compiler Part 3 guard: `isDioRealEstate=true` → `arbitratedModel` never fills `structured.business_model`
2. FPG Part 1 guard: either `creByClassification=true` OR expanded `creByText=true` → BM nulled

### Regression Checks

| Deal | BM | Status | Notes |
|------|-----|--------|-------|
| Carmoola | Omnichannel (DTC + Wholesale/Retail) | ✅ Preserved | Consumer fintech, not real_estate classification |
| Magarian | Fund / SPV investment vehicle | ✅ Preserved | Fund classification, not real_estate asset_class |
| DealDecision | Subscription/SaaS | ✅ Preserved | No CRE signals, not real_estate |
| Allurion | B2B2C | ✅ Preserved | Medical device / B2B2C, not real_estate |
| Cino | DTC Ecommerce | ✅ Preserved | Consumer DTC ecommerce, not real_estate |

### fact_type_label in Production

| Deal | fact_type_label | Source | Expected |
|------|-----------------|--------|----------|
| DealDecision | `projected` | XLSX proforma model (2026+2028) | ✅ |
| Carmoola | `unclassified` | `source_kind: 'deck'` | ✅ (deck revenue has low provenance certainty) |
| 3ICE | `unclassified` | `source_kind: 'deck'` or non-structured | ✅ |
| Allurion | not set | DPU promoted fact (not financial injector) | ✅ (expected — no DB financial facts for this deal) |

---

## Fix Verification Details

### Part 1 — FPG classification guard

```
Trigger: hasCRE = creByText || creByClassification
Albuquerque: creByText=true (governed_ui_copy_v1 company_overview likely contains CRE language)
             creByClassification=true (asset_class='real_estate')
Rule: real_estate_context_mismatch (text-based fires, classification is defense-in-depth)
```

### Part 2 — Document family authority

All new kind mappings and filename patterns verified in unittest. No live deals with `offering_memorandum`/`investment_memo` documents in the 10-deal pilot set — regression validated by test coverage.

### Part 3 — Compiler DIO identity containment

Verified via:
1. Albuquerque report: BM never populates from DIO (compiler block fires first)
2. Non-CRE deals (Carmoola, DealDecision, Allurion): BM still populates from DIO phase1 when present

### Part 4 — fact_type_label

Verified via:
1. DealDecision: `fact_type_label=projected` on `$3.3MM` revenue ✅
2. candidates[0] for DealDecision: `fact_type_label=projected` ✅
3. Carmoola: `fact_type_label=unclassified` on deck-sourced $28MM ✅

---

## TypeScript Build

One type error fixed during implementation:
```
compiler-simple.ts:1857: error TS2367: ...types '"xlsx" | "pdf_table" | "pdf_kpi_line" | ...' and '"pdf_text"' have no overlap.
```

Fix: `pdf_text` → `pdf_kpi_line` (correct `FinancialFactSourceKind` enum value for PDF text extraction).

---

## Outstanding Notes

- `fact_type_label` is NOT set when revenue comes from DPU promoted facts (Allurion pattern). This is by design — the label describes financial fact pipeline provenance only.
- For `deck`-sourced facts, `fact_type_label='unclassified'` correctly signals low provenance certainty.
- The `'run_rate'` type is never surfaced on `revenue.fact_type_label` in current deals because monthly-only facts don't reach the primary selection path in `selectCanonicalRevenueFact`. The label would appear in `candidates[]` when monthly facts are included.
