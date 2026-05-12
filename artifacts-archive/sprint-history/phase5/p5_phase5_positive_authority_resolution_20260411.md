# P5 Phase 5 — Positive Authority Resolution + KPI Type Promotion

**Date:** 2026-04-11  
**State:** Complete (live validated)  
**Tests:** 1516 passing (26 new Phase 5 tests + 1490 Phase 4 baseline)

---

## Objective

Phase 5 adds four layers of output quality to `compiler-simple.ts`:

1. **BM policy recovery** — recover a canonical business model label from `deal_classification_v1.policy_id` when all other BM paths return null (including post-guard recovery after `final_publish_guard` nulling).
2. **Revenue KPI type promotion** — `display_type_label`, `entity_scope`, `revenue_authority_explainer` fields on `structured_summary.revenue`.
3. **Case-study entity scope detection** — exclude per-customer / case-study / illustrative revenue facts from being selected as company-level revenue.
4. **Support metadata** — `entity_scope: 'company'` on XLSX/PDF financial fact revenue; `recovered`/`recovery_rule` on BM policy-recovered values.

---

## Implementation Summary

### File Modified
`packages/core/src/reports/compiler-simple.ts`

### New Module-Level Constants / Helpers

```typescript
// Policy ID → canonical BM label mapping
const POLICY_TO_CANONICAL_BM: Record<string, string> = {
  enterprise_saas_b2b_v1: 'Subscription/SaaS (B2B)',
  consumer_saas_b2c_v1: 'Subscription/SaaS (B2C)',
  marketplace_platform_v1: 'Marketplace / Platform',
  consumer_fintech_platform_v1: 'B2C Fintech Platform',
};

// Revenue display labels by fact_type_label
const REVENUE_DISPLAY_TYPE_LABEL: Record<string, string> = {
  actual: 'Revenue', interim: 'Revenue (interim)',
  projected: 'Revenue (projected)', run_rate: 'Revenue (run-rate)',
  unclassified: 'Revenue',
};

type EntityScope = 'company' | 'customer' | 'case_study' | 'illustrative' | 'unknown';
function detectEntityScope(noteSnippet: string | null, slideTitle: string | null): EntityScope
function buildRevenueAuthorityExplainer(best: FinancialFactV1, bestIsProjected: boolean, ftLabel: string): string
```

### BM Policy Recovery — Two Passes

**Pass 1 (inside `buildStructuredSummary`):** fires when BM is null after all normal paths (arbitration, score_explanation, promoted_fact all fail to set a value).

**Pass 2 (post-guard, in `compileDIOToReportWithPromotedFacts`):** fires when `applyFinalPublishGuard` nulled a low-quality promoted-fact BM (e.g., `generic_wholesale_tech_mismatch`). This was required because the guard runs after `buildStructuredSummary`.

Recovery fires when:
- `!structuredSummary.business_model?.value`
- `deal_type !== 'cre'` (never recover for real estate)
- `classification_confidence >= 0.7`
- `policy_id` is in `POLICY_TO_CANONICAL_BM`

Recovered BM has `confidence: 0.4`, `recovered: true`, `recovery_rule: 'policy_inferred_label'`.

### Revenue KPI Type Fields

Added to `injectCanonicalRevenueIntoStructuredSummary` (XLSX/PDF financial facts path):
- `display_type_label` — human-readable label from `REVENUE_DISPLAY_TYPE_LABEL`
- `entity_scope: 'company'` — always company-level for financial facts
- `revenue_authority_explainer` — one-line provenance string ("actual revenue from XLSX model (current)")

Added to promoted-fact revenue path:
- `display_type_label` — derived from `subtype` (annual/monthly/run_rate/forecast)
- `entity_scope` — from `detectEntityScope(note_snippet, slide_title)`

### Case-Study Entity Scope

`detectEntityScope()` patterns:
- `case_study`: "case study", "case solution", "client hq", "retail locations mrr", "reseller.*mrr"
- `illustrative`: "illustrative", "hypothetical", "sample deployment", "per-location"
- `customer`: "pilot client", "per customer", "per merchant"
- `company`: "financial performance/results/statements", "annual revenue", "total revenue/arr/mrr"
- `unknown`: no matching pattern

Scoring impact in `score()` function:
- `case_study` → -800 (excluded)
- `illustrative` → -600 (excluded)
- `customer` → -30 (penalty)

---

## New Tests (`phase5-positive-authority.test.ts`)

26 tests, all passing:

| Section | Tests | Status |
|---|---|---|
| BM policy recovery (8 tests) | enterprise_saas → recovers; startup_raise → no recovery; consumer_ecommerce → no recovery; confidence < 0.7 → no recovery; real_estate → no recovery; arbitrated BM → not overwritten | ✅ 8/8 |
| Revenue display_type_label financial facts (4 tests) | actual, projected, interim, monthly | ✅ 4/4 |
| Revenue display_type_label promoted facts (2 tests) | annual, forecast | ✅ 2/2 |
| Revenue authority explainer (2 tests) | XLSX actual, PDF-table actual | ✅ 2/2 |
| Entity scope case-study detection (5 tests) | company fact wins; slide_title=case study excluded; illustrative excluded; clean financial=company; only case-study→null | ✅ 5/5 |
| entity_scope='company' on XLSX/PDF (2 tests) | XLSX fact, PDF-table fact | ✅ 2/2 |
| Regression (3 tests) | arbitrated BM preserved; Phase 4 fact_type_label preserved; no spurious recovery | ✅ 3/3 |

---

## ReportDTO Type Changes

```typescript
// structured_summary.revenue additions
display_type_label?: string | null;
revenue_authority_explainer?: string | null;
entity_scope?: 'company' | 'customer' | 'case_study' | 'illustrative' | 'unknown' | null;

// structured_summary.business_model additions  
recovered?: boolean;
recovery_rule?: string | null;
```

---

## Known Limitation

**Qredible entity_scope contamination not detected:** The $132K case-study revenue comes from `phaseb_visual` evidence_items rows. The `note_snippet` containing "Client HQ MRR | Retail Locations MRR | Case Solution Q-Trust + Q-Commerce" is in the DIO data, NOT in the promoted facts' `content_json.value_json.note_snippet` field. Until the DPU-derived promoted facts carry `note_snippet`, entity_scope detection cannot fire for Qredible's $132K.

This is a pipeline enrichment gap, not a code bug. The detection mechanism works correctly when `note_snippet` is present (confirmed by all 5 entity-scope tests).
