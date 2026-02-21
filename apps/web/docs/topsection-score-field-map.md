# TopSection Score + Copy Field Map

> Generated: 2026-02-20  
> Scope: TopSection gauge, Deal Snapshot, Score Understanding  
> Key contract: **TopSection = deterministic score-driver summary. Overview tab = governed LLM company summary.**  
> These two surfaces must never duplicate each other.

---

## 1. Separation Contract

| Surface | Content | Source | Authority |
|---|---|---|---|
| **TopSection — Deal Snapshot** | "Why is the score X?" (1–2 sentences) | `report.structured_summary.topsection_v1.score_driver_one_liner` | Authoritative / deterministic |
| **TopSection — Score Understanding** | Positive drivers, open diligence, exec dependencies | `report.structured_summary.topsection_v1.{strengths, weaknesses, actions_to_improve}` | Authoritative / deterministic |
| **Overview tab — hero summary** | Company narrative (what they do, market, team) | `report.metadata.governed_overlay.hero_summary` or equivalent | Non-authoritative / LLM governed |
| **TopSection gauge** | Canonical score (0–100) | `report.metadata.score_band_v2.overall_score` → `report.overallScore` → `dealFromApi.score` | Canonical (resolver chain) |

---

## 2. Full Data Pipeline

```
Worker pipeline
───────────────
DIO (analyzer results + persisted score_explanation)
  └── compileDIOToReport(dio)                          [packages/core/src/reports/compiler-simple.ts]
        ├── scoreExplanation = existingExplanation     [from dio.score_explanation]
        │                    ?? buildScoreExplanationFromDIO(dio)  [score-explanation.ts]
        │
        │   buildScoreExplanationFromDIO():
        │     ├── iterates dio.analyzer_results components
        │     ├── builds totals (overall_score, unadjusted_overall_score, coverage_ratio, ...)
        │     ├── builds components.{slide_sequence, metric_benchmark, visual_design,
        │     │                       narrative_arc, financial_health, risk_assessment}
        │     └── buildScoreUnderstandingV1({dio, explanation, rubricEval})
        │           ├── strengths: comp.status=ok && effective>=65 && !shouldTreatAsGenericReason
        │           ├── execution_dependencies: gaps + rubric signals
        │           └── diligence_open_items: missing inputs + rubric signals (min 3, with fallbacks)
        │
        └── buildStructuredSummary(dio, scoreExplanation, promotedFacts)
              ├── structured.{raise, revenue, customers, growth, ...}  (promoted facts, then heuristics)
              ├── structured.deal_summary_v1 = buildDeterministicDealSummaryV1(...)
              └── if (scoreExplanation):
                    structured.topsection_v1 = buildTopSectionV1FromScoreExplanation(scoreExplanation)
                      ├── score_driver_one_liner  ← buildScoreDriverOneLiner(components, weights, overall)
                      ├── strengths               ← scoreExplanation.understanding_v1.strengths (max 4, sanitized)
                      ├── weaknesses              ← scoreExplanation.understanding_v1.diligence_open_items (max 6)
                      └── actions_to_improve      ← scoreExplanation.understanding_v1.execution_dependencies (max 6)

API
───
GET /api/v1/deals/:id/report?version=N
  └── returns StoredReport as-is from DB (structured_summary embedded)
      → report.structured_summary.topsection_v1   (may be absent for pre-topsection_v1 DIOs)
      → report.metadata.score_explanation          (raw explanation with components + understanding_v1)

Frontend: DealWorkspace.tsx
───────────────────────────
reportFromApi / reportEnvelope
  ├── structuredSummaryRoot = report.structured_summary
  ├── topsectionV1          = structuredSummaryRoot?.topsection_v1            (may be null)
  ├── topSectionScoreDriverOneLiner = safeText(topsectionV1?.score_driver_one_liner)
  │     → OR client-side fallback from canonical score + score explanation components
  ├── topSectionStrengths   = topsectionV1.strengths
  │     → fallback: understandingV1.strengths (from decisionScoreExplanation)
  │     → fallback: dealSummaryV2.strengths + decisionTileStrengths  ← ⚠ LLM governed
  ├── topSectionWeaknesses  = topsectionV1.weaknesses
  │     → fallback: understandingV1.{diligence_open_items, execution_dependencies}
  │     → fallback: dealSummaryV2.risks + decisionMissing            ← ⚠ LLM governed
  └── topSectionActionsToImprove = topsectionV1.actions_to_improve  (no fallback currently)

canonicalScoreView (resolveCanonicalScore chain):
  score_band_v2.overall_score → report.overallScore → dealFromApi.score

TopSection props (→ DealWorkspaceTopSection.tsx):
  dealSummaryShort   ← topSectionScoreDriverOneLiner || null
  strengths          ← filterMismatchedScoreItems(topSectionStrengths, canonicalScore)
  weaknesses         ← filterMismatchedScoreItems(topSectionWeaknesses, canonicalScore)
  actionsToImprove   ← filterMismatchedScoreItems(topSectionActionsToImprove, canonicalScore)
```

---

## 3. Why `topsection_v1` Can Be Missing

| Cause | Details | Affected deals |
|---|---|---|
| **Old persisted DIO** | Report compiled before `topsection_v1` builder was added. `structured_summary` stored in DB lacks the field. | DIOs persisted before the feature shipped |
| **Report not yet generated** | `reportEnvelope.ready = false` or no report generated for deal | New deals awaiting first analysis |
| **`scoreExplanation` null** | Would skip the `if (scoreExplanation)` gate in `buildStructuredSummary`. In practice `buildScoreExplanationFromDIO` always returns a non-null value, so this is theoretical. | Should not occur in practice |

---

## 4. Why Score Understanding Can Show Noise / Garbage

| Issue | Root cause | Where to fix |
|---|---|---|
| **Score-mechanic phrases** ("pacing score", "score computed") | `score-explanation.ts` component `reason` strings can leak internal mechanics if the per-analyzer reason builder emits them | Filter in `topsection-v1-deterministic.ts` (existing `SCORE_MECHANIC_RE`) + `DealWorkspace.tsx` (`_SCORE_MECHANIC_RE`) |
| **Raw snake_case internal keys** ("business_model_v2", "key_risks_detected") | Some analyzer `reason` fields contain the key name literally | Filter in `topsection-v1-deterministic.ts` (`SNAKE_CASE_KEY_RE`) |
| **OCR noise strings** (very long, low letter ratio, non-English chars) | `understanding_v1` reasons may include OCR snippets if the analyzer reason-builder pulls raw text | **Not yet filtered** — needs min word quality heuristic |
| **Too-long bullets** | No max-length enforcement on individual bullets | **Not yet enforced** — needs max 250 chars |
| **LLM fallback pollution** | When `topsection_v1` is absent and `understandingV1` is also absent, code falls back to `dealSummaryV2.strengths` (LLM governed). These are not score-driver bullets. | Add separator so LLM fallback never reaches TopSection |

---

## 5. Score Canonical Contract

- **One canonical score displayed**: `canonicalScoreView.score0_100` (from `resolveCanonicalScore`).
- **No `NN/100` contradiction**: `filterMismatchedScoreItems` strips mismatched fractions from all copy.
- **Raw analytics scores hidden by default**: `hardPassGuardrailCriteriaSnapshot` gated by `workspaceDebugEnabled`.
- **Details panel**: shows "Canonical score: X (source)" + optional "Raw score (pre-band): Y / Band calibration applied".

---

## 6. Files

| File | Role |
|---|---|
| `packages/core/src/reports/topsection-v1-deterministic.ts` | Builder + guardrails for `topsection_v1` |
| `packages/core/src/reports/score-explanation.ts` | Builds `understanding_v1` (source for topsection) |
| `packages/core/src/reports/compiler-simple.ts` | Embeds `topsection_v1` in `structured_summary` during report compilation |
| `apps/web/src/components/pages/DealWorkspace.tsx` | Reads `topsection_v1`, assembles TopSection props, applies sanitizer |
| `apps/web/src/components/workspace/DealWorkspaceTopSection.tsx` | Renders gauge, Deal Snapshot, Score Understanding |
| `apps/web/src/lib/sanitizeScorePhrases.ts` | `filterMismatchedScoreItems` — strips mismatched `NN/100` |
| `packages/core/src/reports/__tests__/compiler-simple.topsection-v1.test.ts` | Unit tests for topsection builder |
| `apps/web/src/__tests__/DealWorkspace.topSection*.test.tsx` | Integration tests for TopSection data contract |
