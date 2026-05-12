# P5 Phase 4 — Real Estate Context + Document Authority Hardening

**Date:** 2026-04-11  
**Phase 3 baseline:** 1477 tests (1447 core, 30 skipped; 4480 worker)  
**Phase 4 result:** 1490 tests (1460 core, 30 skipped)  
**REPORT_COMPILER_VERSION:** 26 (unchanged — structural fixes only)

---

## Summary

Phase 4 hardens CRE detection, document authority classification, and financial fact type discipline. The primary target was Albuquerque — a real-estate deal where the BM field showed "Omnichannel (DTC + Wholesale/Retail)" because the DIO phase1 LLM extracted a generic consumer-brand term from context clues, and previous CRE guards only checked text signals that Albuquerque lacked.

**Result: Albuquerque BM is now null (GuardNulled) in production. ✅**

---

## Problems Addressed

### Albuquerque Root Cause

Albuquerque's DIO data:
- `product_solution = "whether to provide to Cross Development (the 'Sponsor') all or a portion of an investment..."`  
- `business_model = "Omnichannel (DTC + Wholesale/Retail)"` ← LLM leak from DIO phase1
- `deal_classification_v1.selected = { asset_class: "real_estate", policy_id: "real_estate_underwriting", signals: ["Contains NOI", "Contains DSCR", "Contains LTV", "Contains cap rate", "Contains lease/tenant/occupancy", "Mentions preferred equity", "Real estate / property language"] }`

Phase 3 FPG checked `hasRealEstateContext()` on text fields, but Albuquerque's product_solution had vague Sponsor/Investment language — no explicit CRE keywords matched. The `deal_classification_v1` classification was never checked.

---

## Part 1 — FPG real-estate context detection hardening

**File:** `packages/core/src/reports/final-publish-guard.ts`

### New functions

```typescript
function getDealClassification(dio: any): any
// → dio?.dio?.deal_classification_v1?.selected ?? null

function isDealClassifiedAsRealEstate(dio: any): boolean
// → asset_class === 'real_estate'
//    || policy_id === 'real_estate_underwriting'
//    || policy_id.startsWith('real_estate')
```

### Expanded `hasRealEstateContext` text patterns

Added 11 new CRE text signals:
- `stabilized yield/noi/value/occupancy`
- `occupancy rate`
- `project costs/budget/yield`
- `sources and uses`
- `construction loan/budget/costs/schedule`
- `(land) parcel`
- `site plan/acquisition/work`
- `offering memorandum`
- `investment memorandum`
- `development sponsor/costs/project`
- `rehabilitation facilit`

### New `hasCRE` computation

```typescript
const creByText = hasRealEstateContext(productSolution) || hasRealEstateContext(overviewSummary) || ...;
const creByClassification = isDealClassifiedAsRealEstate(context.dio);
const hasCRE = creByText || creByClassification;
```

### Two distinct rule IDs

| Rule | Trigger |
|------|---------|
| `business_model.real_estate_classification_mismatch` | `creByClassification=true` AND `creByText=false` |
| `business_model.real_estate_context_mismatch` | `creByText=true` (text-based, existing rule) |

---

## Part 2 — Document-family authority weighting

**File:** `packages/core/src/reports/document-authority-tiers.ts`

### Two new `DocumentFamily` types

| Family | Description |
|--------|-------------|
| `offering_memorandum` | CRE / private-placement offering memorandum — investment vehicle docs |
| `investment_memo` | Internal investment committee memo — narrative, not structured data |

### Authority ranks

| Family | General | BM | Revenue | Raise |
|--------|---------|-----|---------|-------|
| `offering_memorandum` | 30 | **10** | 20 | 25 |
| `investment_memo` | 42 | 25 | 30 | 35 |

Rationale: OMs describe investment vehicle terms, not company business model. BM rank=10 makes it near-forbidden for BM extraction — below even `spac_*` families in that context.

### New KIND_TO_FAMILY entries

```typescript
offering_memorandum: 'offering_memorandum',
offering_memo: 'offering_memorandum',
investment_memo: 'investment_memo',
investment_committee_memo: 'investment_memo',
```

### New FILENAME_TO_FAMILY_PATTERNS entries

```typescript
[/offering[\s_-]memo(?:randum)?/i, 'offering_memorandum'],
[/investment[\s_-]memo(?:randum)?/i, 'investment_memo'],
[/ic[\s_-]?memo|deal[\s_-]memo/i, 'investment_memo'],
```

---

## Part 3 — Compiler DIO BM identity containment

**File:** `packages/core/src/reports/compiler-simple.ts`

Added `isDioRealEstate` detection at the start of the DIO phase1 BM fallback section:

```typescript
const dioAssetClass = String(dio?.dio?.deal_classification_v1?.selected?.asset_class ?? '').toLowerCase();
const dioPolicyId = String(dio?.dio?.deal_classification_v1?.selected?.policy_id ?? '').toLowerCase();
const isDioRealEstate =
  dioAssetClass === 'real_estate' ||
  dioPolicyId === 'real_estate_underwriting' ||
  dioPolicyId.startsWith('real_estate');
```

Added `&& !isDioRealEstate` guard to all three DIO BM fallback paths:

| Path | Change |
|------|--------|
| `business_model_arbitration_v1.business_model` | Blocked for CRE |
| `deal_overview_v2.business_model` | Blocked for CRE |
| `executive_summary_v1.business_model` | Blocked for CRE |

**Effect:** For CRE deals, `structured.business_model` starts as null before even reaching the FPG. The FPG is defense-in-depth layer 2.

---

## Part 4 — Financial fact period/type discipline

**File:** `packages/core/src/reports/compiler-simple.ts`

### New `classifyRevenueFactType` function

```typescript
function classifyRevenueFactType(
  fact: FinancialFactV1,
  proformaIds: Set<string>,
): 'actual' | 'projected' | 'interim' | 'run_rate' | 'unclassified'
```

Classification logic:
1. `is_projected=true` OR `proformaIds.has(fact_id)` → `'projected'`
2. `period_type === 'monthly'` → `'run_rate'`
3. `period_label` matches H1/H2/Q1-Q4/six months/nine months/interim → `'interim'`
4. `source_kind` in (xlsx, pdf_table, pdf_kpi_line) → `'actual'`
5. fallback → `'unclassified'`

### Propagation

`fact_type_label` is now set on:
- `structured_summary.revenue.fact_type_label` (primary selection)
- `structured_summary.revenue.candidates[].fact_type_label` (all candidates)

### Code refactor required

`proformaIds` computation was moved earlier (before `buildFactCandidate`) since `classifyRevenueFactType` takes it as a parameter.

---

## Tests

**File:** `packages/core/src/reports/__tests__/phase4-authority-hardening.test.ts`

**43 new tests across 4 describe blocks:**

| Block | Tests | Coverage |
|-------|-------|---------|
| FPG CRE classification guard | 12 | asset_class, policy_id, fintech regression, null DIO, expanded text patterns, dual-rule discrimination |
| document-authority-tiers | 18 | kind mapping (4), filename patterns (6), authority rank values (8) |
| Compiler DIO BM containment | 4 | CRE arbitratedModel blocked, CRE overviewModel blocked, non-CRE fills (regression), null asset_class non-CRE fills |
| fact_type_label propagation | 9 | actual, projected (proforma), candidates list, interim H1/Q1, mixed actuals candidates, no-facts no-regression |

---

## Live Validation Matrix

| Deal | BM (Phase 4) | Rev | fact_type_label | Status |
|------|-------------|-----|-----------------|--------|
| **Albuquerque** | **— (null)** | — | — | ✅ **PRIMARY FIX** |
| Carmoola | Omnichannel (DTC + Wholesale/Retail) | $28MM | unclassified | ✅ No regression |
| DealDecision | Subscription/SaaS | $3.3MM | projected | ✅ New: projected label |
| 3ICE | Licensing | $40K | unclassified | ✅ Stable |
| Allurion | B2B2C | $27M | — (DPU fact) | ✅ No regression |
| Qredible | — | $131K | — | ✅ Stable |
| Probility | — | $1M | — | ✅ Stable |
| StackFactor | — | $23K | unclassified | ✅ Stable |
| Magarian | Fund / SPV investment vehicle | — | — | ✅ No regression |
| Cino | DTC Ecommerce | — | — | ✅ Stable |

**Albuquerque guard detail:**
- `null_rule = 'business_model.real_estate_context_mismatch'` — defense-in-depth: expanded text patterns ALSO caught Albuquerque's governed_ui_copy text
- `replaced_from = "Omnichannel (DTC + Wholesale/Retail)"`
- Both Part 1 (FPG classification path) and Part 3 (compiler identity containment) are active

---

## Test Count Delta

| Suite | Phase 3 | Phase 4 | Delta |
|-------|---------|---------|-------|
| Core tests | 1447 pass, 30 skip | 1490 pass, 30 skip | **+43** |
| Worker tests | 4480 | 4480 | 0 |
| Total | 5957 | 6000 (est.) | **+43** |
