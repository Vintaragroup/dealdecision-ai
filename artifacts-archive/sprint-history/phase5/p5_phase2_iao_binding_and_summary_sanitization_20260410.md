# P5 Phase 2 — IAO Binding & Summary Sanitization
**Date:** 2026-04-10  
**Status:** COMPLETE  
**Tests:** 1427 passing (0 failures) — +11 new tests from Phase 2  

---

## Objective

Bind `investment_analysis_overview_v2` generation to post-guard structured_summary values and add deterministic summary sanitization for hero/overview/deep tiers to block OCR fragments, percentage shards, Unknown sentinels, and enable projected revenue labeling.

---

## Changes Shipped

### 1. `packages/core/src/reports/investment-analysis-overview-v2.ts`

#### New type field: `revenue`
```typescript
// Added to InvestmentAnalysisOverviewV2:
revenue: { value: string | null; guarded: boolean; is_projected: boolean } | null;
```

#### Revenue binding (post-guard structured_summary)
- Reads `structured_summary.revenue.value.raw` → `value_raw` → `value` (string fallback chain)
- Sets `guarded: true` when `nulled_by === 'final_publish_guard'` or `null_rule` is present
- Sets `is_projected: true` when `is_projected` or `is_provisional` flag is present on revenue node
- Suppresses the `"Unknown"` sentinel: returns `value: null` instead of surfacing sentinel string

#### New sanitization rule in `sanitizeIaoText` (Rule 3: "Unknown" sentinel)
Targets sentinel-like uses of "Unknown" as a bare value placeholder in DIO phase1 summary text:
- `"raise: Unknown"` → removed
- `"raising an Unknown amount"` → `"raising an undisclosed amount"`
- `"an Unknown raise"` → `"an undisclosed amount"`
- `"of Unknown"` (trailing value placeholder) → removed
- `"revenue: Unknown"` → removed
- Natural-language "unknown" (e.g. "largely unknown") → **left intact**

### 2. `packages/core/src/reports/deal-summary-v1-deterministic.ts`

#### New helpers
- **`sanitizeKpiText(text)`** — Returns `null` when text is the sentinel `"Unknown"` (case-insensitive). Applied to `revenue`, `customers`, and `growth` KPI display texts, preventing "Revenue: Unknown.", "Customers: Unknown." etc. from appearing in the deep tier.

- **`isOcrPercentageShard(text)`** — Detects OCR allocation/pie-chart text fragments:
  - Pattern A: 3+ bare percentage tokens in sequence (`"20% 35% 45%"`)
  - Pattern B: `"XX% [word]"` repeated 2+ times (`"50% Engineering 25% Sales 25% Ops"`)
  - Applied to `productText`, `marketText`, `businessModelText` — suppresses entire field if shard detected.

#### Projected revenue labeling
- Reads `structured_summary.revenue.is_projected` flag
- When `true`, emits `"Revenue (projected): <value>."` instead of `"Revenue: <value>."`
- When absent or false, emits standard `"Revenue:"` label (no change to existing behavior)

---

## Tests Added

### `investment-analysis-overview-v2.phase2.test.ts` (40 tests)
- Revenue binding: value.raw / value_raw / value fallback chain
- Revenue guard detection: nulled_by + null_rule
- Revenue projection flag: is_projected + is_provisional
- Revenue Unknown sentinel suppression
- Revenue=null when structured_summary absent / no revenue field / non-object
- sanitizeIaoText Rule 3: 6 "Unknown" sentinel patterns
- sanitizeIaoText Rule 3: natural-language "unknown" preserved
- sanitizeIaoText Rule 3: applies to summary_medium and summary_long
- Regression: StackFactor BM stays nulled, wholesale/retail suppressed
- Regression: Albuquerque BM stays nulled, wholesale and retail suppressed
- Regression: $1 artifact replacement still works alongside revenue binding

### `deal-summary-v1-deterministic.phase2.test.ts` (17 tests)
- Unknown sentinel: revenue, customers, growth suppressed from deep tier
- Unknown sentinel: valid values preserved
- Unknown sentinel: raise "Unknown" suppressed from overview tier
- OCR shard: bare percentage allocation shard suppresses product/hero
- OCR shard: budget allocation shard suppresses product/hero
- OCR shard: market OCR shard suppresses from overview
- OCR shard: BM OCR shard suppresses from deep
- OCR shard: single percentage reference left intact
- OCR shard: two percentage references left intact
- Projected label: "Revenue (projected):" when is_projected=true
- Projected label: standard "Revenue:" when is_projected=false
- Projected label: standard "Revenue:" when flag absent
- Regression: valid product+market+raise produce correct tiers
- Regression: revenue without projection flag surfaces plain "Revenue:" label

---

## Financial Data Priority Compliance

These changes respect the established financial data hierarchy:
- `XLSX > Cap Table > Verified structured extraction > Deck language`
- Guards are not weakened — null/suppressed is preferred over misleading
- No new sources of truth introduced — all bindings trace to guarded `structured_summary`
- Revenue binding uses the same `final_publish_guard` + `null_rule` conventions as raise and business_model

---

## Invariants Confirmed

| Invariant | Status |
|-----------|--------|
| `sanitizeIaoText` rules are additive (Rules 1+2 from P3 still apply) | ✅ |
| Guards are never bypassed | ✅ |
| "Unknown" sentinel → null, not empty string | ✅ |
| OCR shards suppressed at source, not via post-hoc removal | ✅ |
| Projected revenue labeled, not silently changed | ✅ |
| Clean deal text unchanged | ✅ |

---

## Architecture Notes

- `deal_summary_v1` is rebuilt **POST all guards** in `compiler-simple.ts` at line ~2219, so `deal-summary-v1-deterministic.ts` always receives the guarded `structuredSummary`. The new helpers add a second layer of defense against residual junk in narrative text fields.
- `is_projected` on `structured_summary.revenue` is set by `compiler-simple.ts` line ~2199 only in the `financial_fact_backfill` path (when the financial breakdown fact has `is_projected=true`). XLSX-sourced facts that happen to be for a future year do not automatically get this flag unless `financial-breakdown-v1.ts` has already classified the fact as projected.
