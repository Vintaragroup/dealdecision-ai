# Scoring Engine v1.1 — Stabilization Pass Report

Generated: 2026-03-13  
Scored deals: 16 / 16 (was 8 / 16)

---

## A. Files Changed

| File | Change Summary |
|------|----------------|
| `apps/worker/src/jobs/investor-insights/limited-scoring-v1.ts` | Range parsing fix, deal_facts traction path, confidence fix |
| `apps/worker/src/jobs/investor-insights/stages/stage-2-deterministic.ts` | `DealTractionFact` type, `InsightSlotInputs.dealTractionFacts`, DB loader query |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Added `dealTractionFacts: []` to repair-path stub |
| `apps/worker/src/jobs/investor-insights/__tests__/limited-scoring-v1.test.ts` | 5 range-parsing test cases added |

---

## B. Part 1 — Missing-Score Backfill

All 8 previously unscored deals now have `limited_scoring_v1`:

| Deal | Score | Confidence |
|------|-------|------------|
| Bear | 18 | low |
| Carmoola | 48 | **medium** |
| Cinco | 22 | low |
| Delphi | 14 | low |
| Dephil Trade | 26 | low |
| Palm3 | 45 | low |
| StackOP | 70 | **medium** |
| health | 0 | low |

Coverage: **16 / 16 deals scored** (was 8 / 16)

---

## C. Part 2 — SAM/SOM Range Parsing Fix

`parseMoneyString` now detects range strings before single-value parsing.
Regex: `/(?:[€£$]|USD)?(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(?:[€£$]|USD)?\d+\s*(MM|BB|[KkMmBbTt])\b/i`
Strategy: extract lower bound, inherit suffix from upper bound (conservative).

**Confirmed fix — deal decision:**
```
Before: SOM: "$600-900M" (rejected — outside $100K–$500M plausibility range)
After:  SOM: "$600-900M" (plausible)
```
market_presence_score: 45 → 70  
overall_limited_score: 75 → 79  
scoring_confidence: low → **medium**

**Unit tests added:**
- `$600-900M` → 600_000_000 ✓
- `$600 – $900M` → 600_000_000 ✓  
- `$600 to $900M` → 600_000_000 ✓
- `$1-2B` → 1_000_000_000 ✓
- `$600M` (non-range, unaffected) → 600_000_000 ✓

---

## D. Part 3 — deal_facts_v1.traction_metric Wired In

`scoreTractionSignal` now has a new intermediate tier:
**workbook facts → deal_facts_v1.traction_metric → text signals**

Scoring rules (deal_facts path, only when workbook has no strong facts):
- First `kind=money` revenue fact (ARR/MRR/Revenue, confidence≠low): **+40 pts**
- Each additional revenue fact (up to 1 bonus): **+15 pts**
- Any growth fact (Growth label, confidence≠low): **+15 pts**
- Max via deal_facts path: **70 pts**

**Deals improved by deal_facts path:**

| Deal | Was | Now | Source |
|------|-----|-----|--------|
| Carmoola | 0 | 40 | ARR [confidence=medium] |
| Probability AI | 0 | 55 | ARR + 3x revenue signals |
| Qredible | 40* | 70 | ARR [confidence=high] + 12 signals + Growth |
| StackFactor | 0* | 70 | ARR + 4 signals + Growth |
| StackOP | 0* | 70 | ARR + 4 signals + Growth |

*Previously used workbook path (Qredible) or had no traction (StackFactor, StackOP)

---

## E. Part 4 — Confidence No Longer Structurally Locked to "low"

`computeOverall` now derives `scoring_confidence` from only the 3 signal categories
(`deal_terms`, `traction`, `market`) — **excluding `completeness`**.

Rationale: `completeness_confidence` is always "low" because coverage_ratio < 0.5,
locking all deals to low regardless of actual signal quality.

**Deals upgraded from low → medium:**

| Deal | Why |
|------|-----|
| Carmoola | traction=medium (deal_facts ARR) |
| deal decision | traction=medium (workbook revenue) |
| Probability AI | traction=medium, market=medium |
| Qredible | traction=medium, market=medium |
| StackFactor | traction=medium, market=high |
| StackOP | traction=medium, market=high |

---

## F. Part 5 — Garbage Key Filtering (Verified Sufficient)

Existing `TRACTION_METRIC_KEYS = new Set(["revenue","arr","mrr"])` whitelist already
filters `financial_facts_v1` workbook keys. No change needed.  
Added `isDealMoneyFact()` type guard used in new deal_facts scoring path.

---

## G. Full Benchmark — All 16 Deals (Post v1.1)

| Deal | Overall | Confidence | Traction | Market | Deal Terms |
|------|---------|------------|---------|--------|------------|
| StackFactor | **80** | **medium** | 70 | 75 | 90 |
| deal decision | **79** | **medium** | 60 | 70 | 80 |
| Qredible | **74** | **medium** | 70 | 45 | 70 |
| StackOP | **70** | **medium** | 70 | 100 | 50 |
| Palm | 51 | low | 40 | n/s | 60 |
| Carmoola | 48 | **medium** | 40 | n/s | 60 |
| Palm3 | 45 | low | 20 | n/s | 60 |
| 3ICE | 43 | low | 0 | n/s | 90 |
| Probability AI | 38 | low | 55 | 45 | 20 |
| WebMax | 37 | low | 20 | n/s | 40 |
| Complaint | 30 | low | 20 | n/s | 30 |
| Dephil Trade | 26 | low | 0 | n/s | 50 |
| Cinco | 22 | low | 0 | n/s | 40 |
| Delphi | 14 | low | 0 | n/s | 20 |
| Bear | 18 | low | 0 | n/s | 30 |
| health | 0 | low | 0 | n/s | n/s |

n/s = not_scoreable

**Quality distribution:** High signal (≥70): 4 deals · Mid signal (40–69): 6 deals · Weak (1–39): 5 deals · No signal: 1 deal

---

## H. Remaining Deferred Categories

All 16 deals still show in `deferred_categories`:
- `team` — requires LLM phase or structured founder data
- `product_quality` — requires LLM phase
- `business_model_quality` — requires LLM phase
- `go_to_market_quality` — requires LLM phase
- `full_financial_health` — requires complete financials pipeline
- `comparative_ranking` — requires multi-deal batch context

---

## I. Testing

```
pnpm -C apps/worker test -- --testPathPattern=limited-scoring-v1 --no-coverage
  Test Files  174 passed (174)
       Tests  3288 passed (3288)
```
TypeScript: 0 errors (`pnpm -C apps/worker exec tsc --noEmit`)

---

---

# Adapter Priority Fix Pass — v1 Correctness

Generated: 2026-03-14

---

## A. Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/types/investor-insights.ts` | Fix 1: `financial_outlook` canonical-first in LLM branch · Fix 2: `market_opportunity.summary` canonical-first · Fix 3: `confidence_level` uses `scoring.scoring_confidence` when LLM absent |

Single file, three targeted edits. No new architecture, no UI changes, no scoring changes.

---

## B. Financial Outlook Fix

**Problem**: In the LLM-present branch, both `financial_outlook.summary` and `financial_outlook.key_insight` were set directly from `llm.financial_outlook`. `buildFinancialNarrativeFromCanonical()` exists and was already called in the no-LLM branch but was never invoked in the LLM branch.

**Fix** (LLM-present branch):

```typescript
// Before
summary: llm.financial_outlook,
key_insight: llm.financial_outlook,

// After
const canonicalFinancialLlm = buildFinancialNarrativeFromCanonical(canonicalRows);
summary: canonicalFinancialLlm ?? llm.financial_outlook,
key_insight: canonicalFinancialLlm ?? llm.financial_outlook,
// deeper_analysis retains llm.capital_and_raise_interpretation (interpretation, not raw data)
```

**Source priority**: `canonical ARR/MRR/Revenue/growth/runway/burn/cash → llm.financial_outlook`

`deeper_analysis` is unchanged — `llm.capital_and_raise_interpretation` is appropriate there (it's interpretive, not a fact claim).

---

## C. Market Summary Fix

**Problem**: `market_opportunity.summary` used `llm.market_position` while `market_opportunity.key_insight` already correctly prioritized `canonicalMarket ?? (llm.external_market_context || llm.market_position)`. The two fields disagreed on source quality for the same module.

**Fix** (LLM-present branch):

```typescript
// Before
summary: llm.market_position,
key_insight: canonicalMarket ?? (llm.external_market_context || llm.market_position),

// After
summary: canonicalMarket ?? llm.market_position,
key_insight: canonicalMarket ?? (llm.external_market_context || llm.market_position),
```

`canonicalMarket` was already computed earlier in the same branch — this is a one-line change to apply the same priority to `summary`.

---

## D. Confidence Level Fix

**Problem**: When LLM is absent, `deal_signals.confidence_level` hardcoded `'low'` regardless of the deterministic/governed scoring confidence. `scoring.scoring_confidence` (`'high' | 'medium' | 'low' | 'not_scoreable'`) was fully available but ignored.

**Fix**:

```typescript
// Before
confidence_level: llm ? confidenceToLevel(llm.confidence) : 'low',

// After
confidence_level: llm
  ? confidenceToLevel(llm.confidence)
  : (scoring?.scoring_confidence && scoring.scoring_confidence !== 'not_scoreable'
      ? scoring.scoring_confidence
      : 'low'),
```

When `scoring_confidence === 'not_scoreable'` or scoring is absent, the fallback remains `'low'` (conservative). When scoring says `'medium'` or `'high'`, that value is now surfaced.

---

## E. Verification Results

**All 16 deals queried. Section presence and scoring confidence confirmed from live DB.**

### Section presence + scoring confidence (full dataset)

| Deal | LLM Present | Governed | scoring_confidence |
|------|------------|----------|--------------------|
| StackFactor | ✓ | ✓ | medium |
| deal decision | — | ✓ | **medium** |
| Qredible | ✓ | ✓ | medium |
| StackOP | ✓ | ✓ | medium |
| Carmoola | ✓ | ✓ | medium |
| 3ICE | ✓ | ✓ | low |
| Bear | — | ✓ | low |
| Cinco | ✓ | ✓ | low |
| Complaint | ✓ | ✓ | low |
| Delphi | ✓ | ✓ | low |
| Dephil Trade | ✓ | ✓ | low |
| health | ✓ | ✓ | low |
| Palm | — | ✓ | low |
| Palm3 | ✓ | ✓ | low |
| Probability AI | ✓ | ✓ | low |
| WebMax | ✓ | ✓ | low |

### Fix 1 — Financial Outlook, deal-level impact

| Deal | Has computable financial canonical? | Before | After |
|------|--------------------------------------|--------|-------|
| Qredible | ✓ ARR: $340K, MRR: $381K | LLM narrative | `"ARR: $340K"` (deterministic) |
| Carmoola | Needs re-extraction (no ARR/MRR in canonical) | LLM narrative | LLM narrative (no change — correct fallback) |
| StackFactor | No computable revenue/ARR/financial health fields | LLM narrative | LLM narrative (no change — correct fallback) |
| Bear | All financial fields NotComputable | LLM absent → governed | governed (no change — !llm branch unchanged) |
| Palm | Revenue $4.5M, growth 50% YOY | LLM absent → already canonical-first in !llm branch | no change (correct) |
| deal decision | Governed-only; no LLM | LLM absent → governed | governed (no change — !llm branch unchanged) |

**Result**: Qredible financial_outlook now shows verified ARR/MRR rather than LLM interpretation. Deals with no computable financial signals fall back gracefully to LLM or governed — no regression.

### Fix 2 — Market Opportunity, deal-level impact

| Deal | Canonical market signals | summary Before | summary After |
|------|--------------------------|---------------|---------------|
| Qredible | TAM: $200B (Computable) | llm.market_position | `"TAM: $200B"` — now matches key_insight ✓ |
| StackFactor | TAM: $45B, SAM: $850M, SOM: $20 (all Computable) | llm.market_position | `"TAM: $45B · SAM: $850M · SOM: $20"` — now matches key_insight ✓ |
| 3ICE | No market canonical computable | llm.market_position | llm.market_position (no change — correct fallback) |
| Bear | No market canonical | governed only | governed only (no change — !llm branch unchanged) |

**Result**: summary and key_insight now use the same source for all deals where canonical market data is available. Disagreement eliminated.

### Fix 3 — Confidence Level, deal-level impact

| Deal | LLM | scoring_confidence | confidence_level Before | confidence_level After |
|------|-----|--------------------|------------------------|------------------------|
| deal decision | — | medium | `'low'` | **`'medium'`** ✅ |
| Bear | — | low | `'low'` | `'low'` (no change — correct) |
| Palm | — | low | `'low'` | `'low'` (no change — correct) |
| All LLM-present deals | ✓ | any | `confidenceToLevel(llm.confidence)` | unchanged (LLM branch not affected) |

**Result**: `deal decision` (the only no-LLM deal with `scoring_confidence: medium`) now surfaces `'medium'` confidence instead of being degraded to `'low'`. All other no-LLM deals were already `low` — unchanged. All LLM-present deals are unchanged.

### No-regression check

- All 16 deals have 0 TypeScript errors post-fix
- LLM-present deals: fixes only activate when `buildFinancialNarrativeFromCanonical` / `buildMarketNarrativeFromCanonical` return a non-null result; otherwise identical to pre-fix behavior
- Governed/deterministic-only path (`!llm && governed` branch): untouched by all three fixes
- `deeper_analysis` on financial_outlook retains `llm.capital_and_raise_interpretation` — LLM interpretation layer preserved where appropriate

---

## F. Remaining Investor Insights v1 Gaps

The following issues were identified during earlier adapter audit but are explicitly out of scope for this pass:

| # | Area | Description | Priority |
|---|------|-------------|----------|
| 1 | `financial_outlook` (no-LLM) | When no canonical financial signals and no LLM, financial_outlook module is silently absent. No "insufficient data" placeholder shown. | Low — known gap, requires UI design decision |
| 2 | `deal_signals.recommendation` | When LLM absent, `recommendation` is `null`. No deterministic fallback from governed posture (if any). | Low — governed_summary_v1 doesn't carry a structured posture field |
| 3 | `evidence_base` | Always `null` — no evidence items wired to modules. Evidence-item display is UI-dead. | Medium — requires adapter wiring from `canonical_fields` evidence column |
| 4 | `completeness_class` field | Added in previous session — wired to `InvestorInsightsData` but no UI component reads it yet. Badge/banner display pending. | Low — field is computed and available |
| 5 | `market_opportunity.summary` (no-LLM branch) | `!llm && governed` branch uses `canonicalMarketFb ?? null` — if null, module is suppressed entirely. No governed market narrative fallback. | Low — governed_summary_v1 doesn't emit structured market narrative |
| 6 | `critical_metrics.financial.yoy_growth` | Uses `canonicalValue('traction_signal','growth_rate')` — correctly sourced, but suppressed for deals like Carmoola that have growth in text but not extracted to canonical. | Backlog — extraction quality improvement |

---

## Part 9 — 5 Key Investment Questions QA Pass

Generated: 2026-03-14

### A. Deals Tested

| Deal | Score | Has LLM | Completeness class | Key signals available |
|------|-------|---------|--------------------|-----------------------|
| StackFactor | 80 | ✓ | full_analysis | TAM $45B · SAM $850M · ARR $200M, market_presence=75, traction=70 |
| Qredible | 74 | ✓ | full_analysis | TAM $200B · ARR $340K · MRR $381K, market_presence=45, traction=70 |
| deal decision | 79 | ✗ | partial_analysis | TAM $10.5B · Revenue $3.3M · Growth 364.5%, market_presence=70, traction=60 |
| Palm | 51 | ✗ | partial_analysis | Revenue $4.5M · Growth 50% YOY, traction=40, market not_scoreable |
| Bear | 18 | ✗ | evidence_limited | raise_amount=$20 only; no market/traction canonical signals |

### B. Issues Found

| # | Issue | Severity |
|---|-------|----------|
| 1 | **Traction strong answer: ARR appears twice** — `key_insight` is the canonical traction narrative already embedding ARR, but the answer also prepended `ARR: ${arr}` separately | High |
| 2 | **Score text in answer redundant with chip** — "Market presence score: 45/100" and "Traction score: X/100" appeared in the answer body; the right-side chip already carries the score | Medium |
| 3 | **Partial traction branch ignores `keyInsight`** — when canonical Revenue/Growth narrative was present (e.g. Palm: Revenue $4.5M · Growth 50%), the partial branch only used `arr` (which was null for revenue-only deals), silently falling back to "Early-stage traction validated." | Medium |
| 4 | **Market strong overstatement** — "Large and credible market opportunity" overstates confidence for an unverified market claim in submitted materials | Low |
| 5 | **Dead ternary in product question** — `productStrengths.length > 0 ? 'partial' : 'partial'` (always 'partial'); unreachable branch | Low |
| 6 | **Divide colour hardcoded to `divide-white/5`** — in light mode this produces invisible white dividers on white background; should be `divide-gray-100` in light mode | Medium |
| 7 | **Misplaced `divide-gray-100` in QuestionRow** — applied to flex row wrapper instead of the container; had no effect | Low |
| 8 | **Subheader copy: jargon** — "deterministic and governed signals" is internal terminology, not investor-facing language | Low |

### C. Fixes Made

All fixes applied to `apps/web/src/types/investor-insights.ts` and `apps/web/src/components/workspace/InvestmentQuestionsPanel.tsx`. 0 TypeScript errors after all changes.

**Deriver fixes (`investor-insights.ts`):**

1. **Market Q1 — score removed from answer text; key_insight used as qualifier**: Strong branch changed from "Large and credible market opportunity — TAM: X. Market presence score: Y/100." to "Well-evidenced market opportunity. TAM: X · SAM: Y · SOM: Z" (uses full canonical narrative). Partial branch qualifier now uses full canonical market string, not just TAM.

2. **Traction Q3 — ARR deduplication**: Strong branch now uses `keyInsight` directly ("Strong traction signals. ARR: $X · Growth: Y%") instead of building metric separately then appending keyInsight. Prevents duplication when canonical traction narrative already contains ARR.

3. **Traction Q3 — Partial branch includes keyInsight**: Partial branch now shows canonical Revenue/Growth narrative when available. Fixes Palm-style deals where ARR is null but revenue_value/growth_rate are canonical-extracted.

4. **Product Q2 — dead ternary removed**: `productStrengths.length > 0 ? 'partial' : 'partial'` → `'partial'`.

**Component fixes (`InvestmentQuestionsPanel.tsx`):**

5. **Divide colour made conditional**: `divide-white/5` in dark mode, `divide-gray-100` in light mode.

6. **Misplaced `divide-gray-100` removed** from QuestionRow outer div (it belongs on the container).

7. **Subheader copy updated**: "Structured analysis from deterministic and governed signals" → "Based on extracted evidence from submitted materials".

### D. Example Answers After Fixes

**StackFactor** (score 80, LLM, market_presence=75, traction=70):
- Market (strong, chip 75): "Well-evidenced market opportunity. TAM: $45B · SAM: $850M · SOM: $20"
- Traction (strong, chip 70): "Strong traction signals. ARR: $200M"

**Qredible** (score 74, LLM, market_presence=45, traction=70):
- Market (partial, chip 45): "Market opportunity is present but only partially evidenced. TAM: $200B"
- Traction (strong, chip 70): "Strong traction signals. ARR: $340K · MRR: $381K"

**deal decision** (score 79, no-LLM, market_presence=70, traction=60):
- Market (partial→strong edge, chip 70): "Well-evidenced market opportunity. TAM: $10.5B · SAM: $3.5 · SOM: $600-900M"
- Traction (partial, chip 60): "Early-stage traction present. Revenue: $3,337,000 (2026 revenue from XLSX) · Growth: 364.5% revenue growth (2026 → 2027, XLSX)"

**Palm** (score 51, no-LLM, traction=40, no market score):
- Market (missing, no chip): "Insufficient market evidence available in submitted materials."
- Traction (partial, chip 40): "Early-stage traction present. Revenue: $4,500,000.00 · Growth: 50% YOY"

**Bear** (score 18, no-LLM, evidence-limited):
- Market (missing, no chip): "Insufficient market evidence available in submitted materials."
- Traction (missing, no chip): "Traction signals are insufficient to evaluate validation from available materials."
- Readiness (limited, chip 18): "Score: 18/100. Additional evidence required before making a venture decision."

### E. Remaining Low-Priority Improvements (deferred to v2)

| # | Item | Priority |
|---|------|----------|
| 1 | **SAM/SOM unit truncation** — deal decision SAM=$3.5 (should be $3.5B), StackFactor SOM=$20 (should be $20M). Root cause: canonical extraction drops units. Fix is upstream in worker extraction, not deriver. | Backlog |
| 2 | **snapshot_summary not available** — `scoreExplanationV1.snapshot_summary` comes from `score_band_v2.understanding_v1.summary.text` in report metadata. Not present in current DB samples. Readiness answers fall back to constructed strings, which are accurate but formulaic. | Low |
| 3 | **Product question always "partial"** — no team/product score exists in `limited_scoring_v1`. Product can never reach "strong" status. Intentional conservative design, but limits usefulness for strong-product deals. | Medium — deferred until product scoring is added |
| 4 | **Team question always "partial" or "limited"** — team scoring is a deferred category. Team answers rely entirely on governed strengths/risks text matching TEAM_RE. If governed summary has no structured team mention, falls back to "only partially supported." | Medium — deferred until team scoring is added |
| 5 | **Raw revenue formatting** — "$4,500,000.00" from canonical looks unpolished. A `formatCurrency()` helper would improve readability. | Low |


