# Score Source Map — Deal Workspace UI

> **Updated: v1 cleanup pass (March 2026). Covers both scoring pipelines.**
> No business logic was changed to produce this file. All data traced from live code.
>
> Last updated: v1 score cleanup pass — added Pipeline B (`limited_scoring_v1`) documentation,
> renamed `investorScore` → `reportBandScore`, updated `canonicalScoreLabel` text.

---

## 1. Score Variables at a Glance

| Variable | File : Line | Type | Description |
|---|---|---|---|
| `reportBandScore` | `DealWorkspace.tsx:146` | `number` (state, init=0) | React state; set in `loadReport` callback via `resolveCanonicalScore(report)` (Pipeline A only). Serves as pre-report fallback for `fundamentalsScore0_100`. **Previously named `investorScore`** — renamed in v1 cleanup pass to reflect actual source. **Not related to `limited_scoring_v1`.** |
| `fundamentalsScore0_100` | `DealWorkspace.tsx:1480–1482` | `number \| null` | `Math.round(dealFromApi.score)` (DB field) → fallback `investorScore`. Primary "DB calibration" score. |
| `fundabilityScore0_100` | `DealWorkspace.tsx:1487` | `number \| null` | `extractFundabilityScore0_100(dealFromApi)` — active only when `scoreSource === 'fundability_v1'`. |
| `displayScoreSourceV1` | `DealWorkspace.tsx:1488–1489` | `'fundamentals' \| 'fundability_v1'` | Context selector. `'fundability_v1'` only when explicit and non-null; otherwise `'fundamentals'`. |
| `displayScore` | `DealWorkspace.tsx:2081–2083` | `number \| null` | `fundabilityScore0_100 \| fundamentalsScore0_100` per `displayScoreSourceV1`. Used in data-panel header label. |
| `decisionTileScore0_100` | `DealWorkspace.tsx:1653` | `number \| null` | Intentionally = `fundamentalsScore0_100`. Scoped to DB/fundamentals only to avoid confusing investors. |
| `reportView.score` (gaugeScore) | `DealWorkspace.tsx:3043–3049` | `number` | Two-pass canonical resolver (see §3). Drives the TopSection SVG ring gauge. |
| `reportView.scoreSource` | `DealWorkspace.tsx:3050` | `'score_band_v2.overall_score' \| 'report.overallScore' \| 'none'` | Resolver provenance. Passed to TopSection as `canonicalScoreSource`. |

---

## 2. UI Surface → Score Binding Table

| UI Surface | Component : Element | Variable Bound | Runtime Value (typical) | Source Object | Exact Field Path | API Endpoint |
|---|---|---|---|---|---|---|
| **TopSection radial gauge** | `DealWorkspaceTopSection` : SVG ring (`data-testid="radial-score-chart"`) | `score={reportView.score}` | **82** (from `score_band_v2`) | `reportEnvelope.metadata` OR `reportFromApi.metadata` | `.score_band_v2.overall_score` | `GET /api/v1/deals/:id/report` |
| **TopSection score label** | `DealWorkspaceTopSection` : score label text | `scoreLabel={canonicalScoreLabel}` | `"Deal Score"` (when report applied); `"Fundamentals score"` (pre-report) | derived from `reportView.scoreSource` | n/a — display string | — |
| **TopSection band label** | `DealWorkspaceTopSection` : band badge | `scoreBandLabel={safeText(reportMeta.score_band_v2.label)}` | `"Strong"` / `"Moderate"` etc. | `reportMeta` (inner or envelope) | `.score_band_v2.label` | `GET /api/v1/deals/:id/report` |
| **Overview tab "XX / 100"** | `DealWorkspaceOverviewComp` : scoreText span (L715) | `score0_100={decisionTileScore0_100 ?? displayScore ?? reportBandScore}` | 82 (from `dealFromApi.score`) | `dealFromApi` | `.score` (DB field) | `GET /api/v1/deals/:id` |
| **Overview tab decision label** | `DealWorkspaceOverviewComp` : decision badge | `decisionLabel={decisionTileLabel}` | `"CONSIDER"` / `"FUND"` / `"PASS"` | `decisionTileScore0_100` → `scoreToWorkspaceDecision()` | n/a — threshold function | — |
| **Data-panel display score** | `DealWorkspace.tsx` inline (header area) | `displayScore` | 82 (from `fundamentalsScore0_100`) | `dealFromApi` | `.score` (DB field) | `GET /api/v1/deals/:id` |
| **reportBandScore state** (pre-report fallback) | `DealWorkspace.tsx` React state | `reportBandScore` | 82 once report loads | `report.metadata` or `report.overallScore` | `resolveCanonicalScore(report)` cascade | `GET /api/v1/deals/:id/report` |

---

## 3. TopSection Gauge: Where "82" Comes From

The gauge score goes through a **two-pass canonical resolver** inside the `reportView` useMemo
([DealWorkspace.tsx:2925–3055](../src/components/pages/DealWorkspace.tsx)).

```
reportEnvelope ← GET /api/v1/deals/:id/report
  └── .metadata.score_band_v2.overall_score  = 82   ← Pass 2 (envelope fallback)

reportFromApi  ← same response, .report or .artifact sub-object
  └── .metadata.score_band_v2.overall_score  = 82   ← Pass 1 (inner report)
  └── .overallScore                           = 73   ← Pass 1 fallback if band absent

resolveCanonicalScore(reportFromApi)
  → { score: 82, source: 'score_band_v2.overall_score' }     ← when inner report has band
  → { score: 73, source: 'report.overallScore' }              ← when band missing from inner

_envelopeBandScore = reportEnvelope.metadata.score_band_v2.overall_score
  → 82 (used only when Pass 1 MISSED the band score)

reportScore = _envelopeBandScore ?? _innerReportScore
  → 82

gaugeScore:
  if reportApplied (report ready + object exists):
    = reportScore ?? 0
    = 82
  else (pre-report):
    = reportScore ?? fallbackScore
    = 82  (or displayScore / investorScore if no report yet)

reportView.score = gaugeScore = 82
→ passed as score={reportView.score} to <DealWorkspaceTopSection>
```

### API write paths for `score_band_v2`

`attachScoreBandAndGuardrailV2` ([reports.ts:1842](../../api/src/routes/reports.ts)) is called in two
places inside the `/report` route handler:

| Call site | When it runs | What it writes |
|---|---|---|
| Inside `deck_archetype` block (L2753, L2766) | When deck archetype inference succeeds | `payload.metadata.score_band_v2` AND `report.metadata.score_band_v2` |
| Best-effort fallback block (L3219, L3230) | Always, independently of deck archetype | `payload.metadata.score_band_v2` AND `report.metadata.score_band_v2` |

`overall_score` is sourced from (in priority order):
1. `report.metadata.score_explanation.totals.overall_score`
2. `report.overallScore`

The response envelope shape is:

```
DealReportEnvelope {
  ready: boolean
  metadata: { score_band_v2: { overall_score, label, key, thresholds_version } }  ← payload.metadata
  report: {
    overallScore: number
    metadata: { score_band_v2: { ... } }  ← report.metadata
    sections: [...]
    ...
  }
}
```

---

## 4. Overview Tab "XX / 100": Where "82" Comes From

The Overview score takes a **completely different path** — it never touches `resolveCanonicalScore`.

```
GET /api/v1/deals/:id
  └── dealFromApi.score = 82   ← pre-calibrated DB field (integer, set during analysis pipeline)

DealWorkspace.tsx:1480:
  fundamentalsScore0_100 = Math.round(dealFromApi.score)   = 82
                        ?? Math.round(investorScore)       (fallback)

DealWorkspace.tsx:1653:
  decisionTileScore0_100 = fundamentalsScore0_100          = 82

DealWorkspace.tsx:7704:
  <DealWorkspaceOverviewComp
    score0_100={decisionTileScore0_100 ?? displayScore ?? investorScore}
  />
  → score0_100 = 82

dealworkspace_overview_comp.tsx:142:
  scoreText = `${Math.round(82)} / 100`  →  "82 / 100"
```

---

## 5. Divergence Risk

Even though both surfaces currently show 82, they get it from **different objects**:

| Surface | Score source object | Field |
|---|---|---|
| TopSection gauge (82) | `reportEnvelope.metadata` (or `reportFromApi.metadata`) | `.score_band_v2.overall_score` |
| Overview "82 / 100" | `dealFromApi` (deals API) | `.score` (DB integer) |

These agree today because `score_band_v2.overall_score` is derived from the same underlying analytical
output as `dealFromApi.score`. However the data paths diverge before reaching the client:
- `dealFromApi.score` is written by the analysis pipeline directly to the DB `deals` table.
- `score_band_v2.overall_score` is computed at report-serve time from `score_explanation.totals.overall_score` → `report.overallScore`.

If calibration ever updates the band score without updating the DB field (or vice versa), the two
surfaces will silently show different values. See §6 for the proposed canonical contract that would
eliminate the split.

---

## 6. Dev-Only Console Logs (Added)

### `[DDAI][overview_score_binding]` — NEW (phase 6)
- **File**: `dealworkspace_overview_comp.tsx`
- **Fires**: on every `score0_100` or `decisionLabel` change (deduped by value key)
- **Logs**: `score0_100`, `scoreText`, `decisionLabel`, `confidenceLabel`, `source_chain`
- Confirms what value the Overview card ultimately rendered.

### `[DDAI][score_sources]` — pre-existing (phase 3/5)
- **File**: `DealWorkspace.tsx`
- **Fires**: on report version, score, or deal change
- **Logs**: both inner report band score AND envelope band score, plus all derived variables

### `[DDAI][topsection_score_binding]` — pre-existing (phase 4)
- **File**: `DealWorkspace.tsx`
- **Fires**: on `reportView` or `dealFromApi` change
- **Logs**: `gaugeScore`, `gaugeScoreSource`, `reportApplied`, `dealFromApiScore`, `LEAK_DETECTED`

---

## 7. Proposed Single Canonical Score Contract

> **Not yet implemented — proposal only.**

The divergence between the gauge and the Overview "/ 100" display could be eliminated by adopting a
single contract:

```
canonical_score = score_band_v2.overall_score
               ?? report.overallScore
               ?? dealFromApi.score   ← DB fallback until report is ready
```

This would mean:
1. `resolveCanonicalScore` becomes the **only** score resolver for all UI surfaces (gauge, Overview,
   data panel, decision label).
2. The `fundamentalsScore0_100 → decisionTileScore0_100` chain is replaced or aligned:
   - When report is applied: use `resolveCanonicalScore(reportFromApi).score`
   - When report is not yet ready: use `dealFromApi.score` (DB pre-calibration) as before
3. `DealWorkspaceOverviewComp.score0_100` receives `reportApplied ? canonicalScore : dealFromApi.score`
   instead of the current `decisionTileScore0_100 ?? displayScore ?? investorScore` chain.

**Trade-off**: The Overview tile currently intentionally uses only the DB/fundamentals score to avoid
confusion (comment in DealWorkspace.tsx:L1652–1653). Any change here must be discussed with product
before implementation.

---

## 8. Files Referenced

| File | Role |
|---|---|
| [apps/web/src/components/pages/DealWorkspace.tsx](../src/components/pages/DealWorkspace.tsx) | Main orchestrator — all score variable derivations |
| [apps/web/src/components/workspace/DealWorkspaceTopSection.tsx](../src/components/workspace/DealWorkspaceTopSection.tsx) | TopSection gauge render |
| [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](../src/components/workspace/dealworkspace_overview_comp.tsx) | Overview tab "XX / 100" render |
| [apps/web/src/lib/resolveCanonicalScore.ts](../src/lib/resolveCanonicalScore.ts) | Pure canonical score resolver |
| [apps/web/src/lib/dealScore.ts](../src/lib/dealScore.ts) | `extractFundabilityScore0_100` |
| [apps/api/src/routes/reports.ts](../../api/src/routes/reports.ts) | `attachScoreBandAndGuardrailV2` — API write path |

---

## 9. Pipeline B — `limited_scoring_v1` (Investor Insights Tab)

> This section documents the **second, completely separate** scoring system. It has no
> connection to Pipeline A (`score_band_v2`) at any layer. The two systems coexist and are
> **isolated by design** for v1.

### 9.1 Overview

| Dimension | Value |
|---|---|
| **Computed by** | `computeLimitedScoringV1()` in `apps/worker/src/jobs/investor-insights/limited-scoring-v1.ts` |
| **Data loader** | `apps/worker/src/jobs/investor-insights/stages/stage-2-deterministic.ts` |
| **Stored in** | `investor_insight_reports.render_package.sections` — section with `key = 'limited_scoring_v1'`, serialized as YAML-like text body |
| **API route** | `GET /api/v1/deals/:id/investor-insights` → verbatim passthrough of `render_package` |
| **Frontend hook** | `useInvestorInsights(dealId)` in `apps/web/src/hooks/useInvestorInsights.ts` |
| **Frontend parse** | `parseLimitedScoringBody(section.body)` → `LimitedScoringV1` struct |
| **Frontend adapter** | `adaptReportToInsightsData()` → `InvestorInsightsData` |
| **UI label** | "Insights Score" (CircularScore in Executive view); score chip next to recommendation pill (Quick/Detailed views) |

### 9.2 Score Fields

| Field in `LimitedScoringV1` | Description | Maps to in `InvestorInsightsData` |
|---|---|---|
| `overall_limited_score` | Overall investor insights score (0–100) | `deal_signals.overall_score` AND `analysis_modules.investment_thesis.score` |
| `market_presence_score` | Market sizing / presence sub-score | `analysis_modules.market_opportunity.score` |
| `traction_signal_score` | Traction momentum sub-score | `analysis_modules.traction_growth.score` |
| `deal_terms_score` | Deal terms / structure sub-score | `analysis_modules.financial_outlook.score` |
| `completeness_score` | Data completeness (not surfaced in UI modules) | not mapped to a UI module |
| `scoring_confidence` | `'high' \| 'medium' \| 'low' \| 'not_scoreable'` | `deal_signals.confidence_level` |

### 9.3 Source Chain

```
computeLimitedScoringV1() [worker]
  → YAML text body
  → investor_insight_reports.render_package.sections[key='limited_scoring_v1'].body

GET /api/v1/deals/:id/investor-insights
  → render_package (verbatim passthrough, no score transform)

useInvestorInsights(dealId) [InvestorInsightsTab.tsx]
  → parseLimitedScoringBody(section.body) → LimitedScoringV1
  → adaptReportToInsightsData()
      deal_signals.overall_score        = overall_limited_score
      analysis_modules.investment_thesis.score = overall_limited_score
      analysis_modules.market_opportunity.score = market_presence_score
      analysis_modules.traction_growth.score    = traction_signal_score
      analysis_modules.financial_outlook.score  = deal_terms_score
  → InvestorInsightsData

Executive view  → InvestorInsightsExecutiveStatic → ExecutiveBrief
  → <CircularScore score={deal_signals.overall_score} label="Insights Score" />
  → <ScoreCard score={mod.score} /> × 4 modules

Quick view      → InvestorInsightsQuickStatic → ExecutiveInsightSection
  → score chip (overall_score, colored) + recommendation pill
  → QuickInsightCards → InsightModuleCard (compact) × N

Detailed view   → InvestorInsightsDetailedStatic → ExecutiveInsightSection
  → score chip (overall_score, colored) + recommendation pill
  → InsightModuleCard (expanded) × N with ScoreBar
```

### 9.4 UI Surfaces (Pipeline B only)

| Surface | Component | Score shown | View mode |
|---|---|---|---|
| Investor Insights circular gauge | `ExecutiveBrief` → `CircularScore` | `deal_signals.overall_score` | Executive only |
| Score chip next to recommendation pill | `ExecutiveInsightSection` | `signals.overall_score` | Quick + Detailed |
| Module score bars + numbers (compact) | `QuickInsightCards` → `InsightModuleCard` | `analysis_modules[id].score` | Quick |
| Module score bars + numbers (expanded) | `InvestorInsightsDetailedStatic` → `InsightModuleCard` | `analysis_modules[id].score` | Detailed |
| Executive module score cards | `ExecutiveBrief` → `ScoreCard` | `analysis_modules[id].score` | Executive |

### 9.5 Key Files

| File | Role |
|---|---|
| [apps/worker/src/jobs/investor-insights/limited-scoring-v1.ts](../../worker/src/jobs/investor-insights/limited-scoring-v1.ts) | Scoring engine — computes all sub-scores and `overall_limited_score` |
| [apps/web/src/types/investor-insights.ts](../src/types/investor-insights.ts) | `LimitedScoringV1` interface, `parseLimitedScoringBody()`, `adaptReportToInsightsData()` |
| [apps/web/src/hooks/useInvestorInsights.ts](../src/hooks/useInvestorInsights.ts) | Fetches `GET /api/v1/deals/:id/investor-insights` |
| [apps/web/src/components/workspace/investor-insights/InvestorInsightsTab.tsx](../src/components/workspace/investor-insights/InvestorInsightsTab.tsx) | Main tab component — sole call site for `adaptReportToInsightsData()` |
| [apps/web/src/components/workspace/investor-insights/ExecutiveBrief.tsx](../src/components/workspace/investor-insights/ExecutiveBrief.tsx) | Renders `CircularScore` (overall) + `ScoreCard` × 4 modules |
| [apps/web/src/components/workspace/investor-insights/ExecutiveInsightSection.tsx](../src/components/workspace/investor-insights/ExecutiveInsightSection.tsx) | Score chip + recommendation pill (Quick/Detailed views) |
| [apps/web/src/components/workspace/investor-insights/InsightModuleCard.tsx](../src/components/workspace/investor-insights/InsightModuleCard.tsx) | Module-level score bar + number (compact and expanded variants) |
| [apps/api/src/routes/deals/investor-insights.routes.ts](../../api/src/routes/deals/investor-insights.routes.ts) | API passthrough — serves `render_package` verbatim, no score transform |

### 9.6 Intentional Isolation

Pipeline A and Pipeline B are **architecturally isolated**. This is intentional for v1:

- `resolveCanonicalScore.ts` is unaware of `limited_scoring_v1`.
- `dealScore.ts` is unaware of `limited_scoring_v1`.
- `DealWorkspace.tsx` calls `useInvestorInsights()` for deterministic text slots and status only — never for score derivation.
- `InvestorInsightsTab.tsx` calls `useInvestorInsights()` independently, separate from the DealWorkspace hook instance.
- The TopSection gauge (`score_band_v2` / Pipeline A) and the Investor Insights `CircularScore` (`overall_limited_score` / Pipeline B) are two distinct scores with distinct labels. Users see "Deal Score" on the gauge and "Insights Score" in the Executive view.

Any future decision to merge or align the two systems is a product-level choice and should not be made implicitly.

