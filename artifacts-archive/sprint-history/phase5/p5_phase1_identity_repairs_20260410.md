# P5 Phase 1 — Identity Repairs

**Date:** 2026-04-10T19:48Z  
**Sprint:** P5 Phase 1  
**REPORT_COMPILER_VERSION:** 26  
**Tests:** 1416 passing (47 FPG, 1369 other)

---

## Summary

Three FPG changes shipped to address business-model identity escapes confirmed in Part A validation.

---

## Fix 1 — Distribution-Segment Source Pitch-Deck Exclusion

**Backlog item:** P5-002 (StackFactor BM escape — root cause 1)  
**File:** `packages/core/src/reports/final-publish-guard.ts`  
**Function:** `businessModelSourcesNoPitchDeck`

**Problem:**  
BM source document `StackFactor-Investor-Deck-3-26.pdf` had "Deck" in its filename. The `businessModelSourcesNoPitchDeck` function treated this as a pitch-deck source and returned early (preserving `Wholesale/Retail`) even though the extraction came from a **distribution/use-of-funds slide** (`segment_key: "distribution"`) — not an explicit BM statement.

**Fix:**  
Distribution-segment sources are now excluded from the pitch-deck presence check. If ALL sources are distribution-segment, the guard proceeds to check product context.

```typescript
// Skip distribution-segment sources — they are proxy BM labels from
// "Use of Funds" slides, not explicit BM statements in the deck.
const segmentKey = String(s?.segment_key ?? s?.segment ?? '').toLowerCase();
if (segmentKey === 'distribution') continue;
```

---

## Fix 2 — Product Signal Corpus (Broadened productSolution Sources)

**Backlog item:** P5-002 (StackFactor BM escape — root cause 2)  
**File:** `packages/core/src/reports/final-publish-guard.ts`  
**Function:** `applyBusinessModelGuard`

**Problem:**  
`productSolution` was built via `??`-chain (take first non-null). For StackFactor, all DIO fields (`governed_ui_copy_v1.product_solution`, `deal_overview_v2.product_solution`, etc.) were null, leaving no signal to trigger `hasTechPlatformContext`. The BM source slide title contained clear tech signals ("core platform", "Al capabilities") but was the last fallback.

**Fix:**  
Replaced `??`-chain with a **union corpus** — all non-null text sources are joined and queried together by `hasTechPlatformContext` and `hasMedtechProductSignals`. Also added three new sources:
- `deal_overview_v2.problem_context`
- `deal_overview_v2.market_icp`
- BM source `slide_title` / `note` fields (computed as `bmSourceSlideText`)

```typescript
const productSignalSources = [
  getNestedStr(guidedCopy, 'product_solution'),
  getNestedStr(getDioPhase1(context.dio), 'deal_overview_v2', 'product_solution'),
  getNestedStr(getDioPhase1(context.dio), 'deal_overview_v2', 'problem_context'),
  getNestedStr(getDioPhase1(context.dio), 'deal_overview_v2', 'market_icp'),
  getNestedStr(getDioPhase1(context.dio), 'executive_summary_v1', 'product_description'),
  bmSourceSlideText,
].filter(Boolean);
const productSolution = productSignalSources.length > 0 ? productSignalSources.join(' ') : null;
```

---

## Fix 3 — `hasRealEstateContext()` + CRE BM Guard Rule

**Backlog item:** P5-002 (Albuquerque BM escape)  
**File:** `packages/core/src/reports/final-publish-guard.ts`  
**Functions:** `hasRealEstateContext` (new), `applyBusinessModelGuard`

**Problem:**  
Albuquerque CRE deal produced `BM = "Omnichannel (DTC + Wholesale/Retail)"`. The generic wholesale term check fired, but with `productSolution = null` and no tech/medtech signals, the guard returned with `no_product_context` — preserving the incorrect BM.

**Fix:**  
Added new `hasRealEstateContext()` function and a CRE-specific guard rule in `applyBusinessModelGuard`. If CRE keyword signals are found in the product signal corpus or deal overview summary, the BM is nulled with rule `business_model.real_estate_context_mismatch`.

```typescript
function hasRealEstateContext(text: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    /\breal\s+estate\b/.test(t) || /\bbuild.to.suit\b/.test(t) ||
    /\bnet\s+lease\b/.test(t) || /\bcap\s+rate\b/.test(t) ||
    /\breit\b/.test(t) || /\btenants?\b/.test(t) || ...
  );
}
```

Note: In production validation of Albuquerque, the `generic_wholesale_medtech_mismatch` rule fired first (via healthcare/IRF signal in the slide corpus), which is also correct. The `real_estate_context_mismatch` rule is a defense-in-depth alternative for pure CRE deals without healthcare content.

---

## Tests Added

**File:** `packages/core/src/reports/__tests__/final-publish-guard.test.ts`  
**New tests:** 8 (total now 47 in FPG suite, 1416 total)

### New describe blocks:
- `applyFinalPublishGuard — business_model: BM source slide-title fallback (P5)` — 4 tests
- `applyFinalPublishGuard — business_model: CRE context mismatch (P5)` — 4 tests

### Test coverage:
| Scenario | Expected | Test |
|----------|----------|------|
| slide_title has platform context, productSolution=null | nulled tech_mismatch | ✅ |
| problem_context has SaaS signals | nulled tech_mismatch | ✅ |
| market_icp has digital platform signals | nulled tech_mismatch | ✅ |
| distribution-segment source, "Deck" filename, problem_context has SaaS | nulled tech_mismatch | ✅ |
| deal_overview_v2.summary has net-lease / IRF context | nulled CRE mismatch | ✅ |
| company_overview has "commercial real estate" | nulled CRE mismatch | ✅ |
| no CRE context → physical goods | kept no_product_context | ✅ |
| CRE null sets nulled_by to final_publish_guard | nulled_by present | ✅ |

---

## Validation Results

| Deal | BM Before | BM After | FPG Rule | Result |
|------|-----------|----------|----------|--------|
| StackFactor | `Wholesale/Retail` | `null` | `generic_wholesale_tech_mismatch` | ✅ Fixed |
| Albuquerque | `Omnichannel (DTC + Wholesale/Retail)` | `null` | `generic_wholesale_medtech_mismatch` | ✅ Fixed |
| DealDecision | `Subscription/SaaS` | `Subscription/SaaS` | — | ✅ Clean |
| Magarian | `Fund / SPV investment vehicle` | `Fund / SPV investment vehicle` | (raise sentinel) | ✅ Clean |
| 3ICE | `Licensing` | `Licensing` | — | ✅ Clean |
