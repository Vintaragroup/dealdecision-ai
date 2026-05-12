# Phase 6 — Evidence Enrichment + Scope Attribution Plumbing

**Date:** 2026-04-11  
**Baseline:** 1516 tests (Phase 5)  
**Final:** 1535 tests (+19 Phase 6 tests)  
**Status:** ✅ Complete

---

## Summary of Changes

### Part 1+2: Upstream entity-scope attribution in promoted-facts-from-dpu.ts

**File:** `apps/api/src/lib/promoted-facts-from-dpu.ts`

Added `detectEntityScopeFromSlideContext(slideContextLower)` function that detects:
- `case_study`: "use case solution", "case study", "case solution", "client hq", etc.
- `illustrative`: "illustrative", "hypothetical", "sample deployment", "per location"
- `customer`: "pilot client", "per customer", "per merchant", "per user"
- `unknown`: default

Wired into `parseRevenueFromSlides`:
- Computes `slideEntityScope` from `slideContextLower` (which includes `page_text`)
- **Skips (continue)** any slide where `entity_scope === 'case_study' || 'illustrative'`
- Adds `entity_scope` to candidates array and return type

Wired into `parseRevenueFromFinancialTableSlides`:
- Same gate logic for financial table slides
- Adds `entity_scope` to output

Propagated in `derivePromotedFactsFromDpuForDeal`:
- Added `entity_scope` to `value_json` for both `tableRevenueFacts` and `revenueFacts` loops

### Part 3: Revenue candidate authority scoring update in compiler-simple.ts

**File:** `packages/core/src/reports/compiler-simple.ts`

Added helper functions:
- `getAuthorityRank(sourceKind, confidence)` → 5=xlsx, 4=pdf_table/pdf_kpi_line, 3=kpi_tile, 2=deck medium+, 1=deck low
- `getSourceSupportLevel(sourceKind, crossSourceStatus)` → 'xlsx_structured', 'pdf_structured', 'cross_validated', 'deck_only', 'dpu_text'
- `buildDocumentFamily(sourceKind)` → 'financial_model', 'pitch_deck', 'financial_statements'

Updated `score()` to use pre-computed `entity_scope` from `value_json` before falling through to `detectEntityScope`.

### Part 4: Support metadata in candidates

**`buildFactCandidate`** now emits:
- `entity_scope`: from `detectEntityScope(excerpt, slide_title)`
- `authority_rank`: via `getAuthorityRank`
- `source_support_level`: via `getSourceSupportLevel`
- `document_family`: via `buildDocumentFamily`
- `has_primary_citation`: `!!(document_id && page_number != null)`
- `selection_explainer`: `"source_kind/metric_key period conf=confidence"`

**`buildCandidate`** (promoted/DPU path) now emits:
- `entity_scope`: pre-computed from value_json OR falls through to `detectEntityScope`
- `authority_rank`: 3 for all DPU/promoted facts
- `source_support_level`: 'dpu_text' or 'promoted_slide_fact'
- `document_family`: 'pitch_deck'
- `has_primary_citation`: `!!(page_index != null && source_document_id)`
- `selection_explainer`: `"source_type page=X conf=Y"`

### Part 5: Tests

**File:** `packages/core/src/reports/__tests__/phase6-evidence-enrichment.test.ts`

19 new tests covering:
- Pre-computed entity_scope gate (case_study, illustrative, unknown, fallback to note_snippet)
- Promoted fact authority metadata (authority_rank, source_support_level, document_family, has_primary_citation, selection_explainer)
- Financial fact authority metadata (xlsx rank=5, deck-low rank=1, deck-medium rank=2, pdf_table rank=4)
- BM recovery regression (Phase 5 policy path still fires)

---

## Live Validation — 10 Pilot Deals

| Deal | Revenue | entity_scope | auth_rank | src_support | BM | Recovered |
|------|---------|-------------|-----------|-------------|-----|----------|
| StackFactor | $23K | company | 3 | dpu_text | Subscription/SaaS (B2B) | ✅ True |
| Qredible | $132K | null | 3 | dpu_text | None | — |
| Probility | $1MM | null | 3 | dpu_text | None | — |
| Albuquerque | null | null | null | null | None | — |
| DealDecision | $3.3MM | company | 5 | xlsx_structured | Subscription/SaaS | — |
| Carmoola | $28MM | company | 1 | deck_only | Omnichannel (DTC + Wholesale/Retail) | — |
| Allurion | $27M | null | 3 | dpu_text | B2B2C | — |
| 3ICE | $40K | company | 1 | deck_only | Licensing | — |
| Magarian | null | null | null | null | Fund / SPV investment vehicle | — |
| Cino | null | null | null | null | DTC Ecommerce | — |

### Key observations

- **DealDecision** correctly shows `auth_rank=5, xlsx_structured` — highest authority xlsx path.
- **StackFactor** BM recovery preserved ✅ (Phase 5 regression).
- **Carmoola** correctly shows `deck_only` with `auth_rank=1` (deck low confidence).
- **Qredible case-study gate**: Pages 21-22 ("Use Case Solution") are now excluded from DPU-derived revenue. The $132K is now sourced from a non-case-study DPU page (different page with the same MRR figure), not the case-study slide. This is the correct behavior — the case-study context no longer contaminates the DPU revenue pool.
- **3ICE** shows `deck_only, auth_rank=1, entity_scope=company` — financial fact from deck, correctly ranked.

---

## Test Counts

| Phase | New Tests | Total |
|-------|-----------|-------|
| Baseline (P1-P4) | 1490 | 1490 |
| Phase 5 | +26 | 1516 |
| Phase 6 | +19 | **1535** |
