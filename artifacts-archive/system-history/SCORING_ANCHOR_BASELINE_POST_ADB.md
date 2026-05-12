# Scoring Anchor Baseline — Post-ADB (2026-03-31)

**Status:** Active post-fix baseline  
**Captured:** 2026-03-31  
**Capture method:** Live local API (`http://localhost:9001`) — `tmp/fetch_anchor_post_adb.py`  
**API schema:** `ddai_orchestrator_report_v1`  
**Contract reference:** `docs/Foundation/SCORING_SOURCE_OF_TRUTH_CONTRACT.md`  
**Prior baseline:** `artifacts/SCORING_ANCHOR_BASELINE_2026-03-30.md`

---

## Applied Changes (ADB = After Dead-Band fixes)

Three code changes were applied prior to this capture:

| Fix | Location | Change |
|-----|----------|--------|
| **Fix A** | `apps/worker/src/orchestrator/compute-fhc.ts` | FSI insufficient_data threshold: 15 → 10 |
| **Fix D** | `apps/worker/src/orchestrator/compute-ors.ts` | Added early-return `if (raw === 0) return 0` in `computeMarketScorePersisted()` |
| **Fix B** | `apps/web/src/lib/resolveScoreDivergence.ts` + `ScoreDivergenceBanner.tsx` + `AnalysisTab.tsx` | Divergence banner added to AI Analysis tab |

All three fixes passed their unit tests (worker: 3897 passing, web resolveScoreDivergence: 21 passing).

---

## Capture State Notes

### Fix A and Fix D — API container running pre-ADB code

The `/orchestrator-report` route calls `buildOrchestratorReportV1()` on-the-fly from the stored `render_package` in `investor_insight_reports` (no DB cache). This means orchestrator scores (ORS, FHC, market) are recomputed at every request from the live source code.

**However:** The local API Docker container was not rebuilt after Fix A and Fix D were applied. Therefore all orchestrator scoring fields (ORS, URSS, DCI, FHC, market_score_raw, market_score_persisted) in this capture reflect **pre-ADB formula behavior** — the same values as the 2026-03-30 baseline.

To produce API responses reflecting Fix A and Fix D, the container must be rebuilt and restarted. Unit tests confirm the formula changes are correct at the source level.

**Expected post-rebuild changes** are documented in `artifacts/SCORING_ANCHOR_DELTA_POST_ADB.md`.

### Fix B — Divergence computation confirmed live

The `resolveScoreDivergence()` logic is a client-side utility (web app layer) that reads workspace scores and ORS values already in the API response. Fix B divergence results in this baseline are computed fresh from live API values using the same rules as `resolveScoreDivergence.ts`. These values are accurate.

### FHC is_deck_only_fsi

Returns `null` for all deals where `FHC_status === "insufficient_data"` — expected behavior per contract Rule 7.

---

## Anchor Deal Scoring Snapshot

### Vermont

| Field | Value |
|-------|-------|
| Deal ID | `f2b08028-8dee-44e5-8eec-ba41a7b91f0e` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **49** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `overrides:low`, `coverage_ratio:0.40` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 49 |
| `coverage_ratio` | 0.40 |
| `confidence_score` | 0.112 |
| **ORS** | **51** ⚠ pre-ADB (Fix D pending rebuild) |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **35** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null ⚠ pre-ADB (Fix A pending rebuild) |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 0 |
| Market score (persisted) | 12 ⚠ pre-ADB (Fix D pending rebuild; expected → 0) |
| **Fix B divergence** | not diverging (workspace CONSIDER vs ORS NO_GO, gap=2) |

> ⚠ Vermont has `market_score_raw=0` and is a Fix D target. After rebuild, `market_score_persisted` → 0 and ORS → ~46.

---

### Albuquerque

| Field | Value |
|-------|-------|
| Deal ID | `267c4979-5779-4a43-8920-a92034732edc` |
| **Canonical workspace verdict** | **FUND** |
| Canonical score (`overall_score`) | **73** |
| Score band key | `fund_caution` |
| Score band label | Fund (Caution) |
| `decision_v1.recommendation_key` | `fund_caution` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:fund_caution`, `drift:misaligned`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 75 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.719 |
| **ORS** | **60** |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **35** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 30 |
| Market score (persisted) | 38 |
| **Fix B divergence** | **DIVERGING — `opposite_signals`** (FUND + NO_GO, delta=+13) |

> Fix B confirmed: Albuquerque (FUND/73 vs NO_GO/60) triggers `opposite_signals` banner in AI Analysis tab.

---

### StackFactor

| Field | Value |
|-------|-------|
| Deal ID | `adb2a1cf-bbb1-4f3b-8735-e2249415124f` |
| **Canonical workspace verdict** | **HARD_PASS** |
| Canonical score (`overall_score`) | **44** |
| Score band key | `hard_pass` |
| Score band label | Hard Pass |
| `decision_v1.recommendation_key` | `hard_pass` |
| `decision_v1.severity` | `danger` |
| `decision_v1.reasons` | `band:hard_pass`, `drift:misaligned`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 43 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.507 |
| **ORS** | **50** |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **23** |
| **DCI score** | **60** |
| DCI band | Partial |
| **FHC score** | **16** |
| FHC status | `ok` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 55 |
| Market score (persisted) | 56 |
| **Fix B divergence** | not diverging (HARD_PASS + NO_GO aligned, delta=-6) |

> StackFactor had a real FHC score pre-ADB and retains it. Fix A does not affect it (it already uses XLSX signals).  
> Fix B Rule 2 does NOT apply to HARD_PASS + NO_GO (only HARD_PASS + CONSIDER/GO triggers it). Correctly not diverging.

---

### Probility

| Field | Value |
|-------|-------|
| Deal ID | `42be8b30-2b7d-45e0-ade0-99427a505c59` |
| **Canonical workspace verdict** | **HARD_PASS** |
| Canonical score (`overall_score`) | **42** |
| Score band key | `hard_pass` |
| Score band label | Hard Pass |
| `decision_v1.recommendation_key` | `hard_pass` |
| `decision_v1.severity` | `danger` |
| `decision_v1.reasons` | `band:hard_pass`, `baseline:pinned`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 40 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.225 |
| **ORS** | **60** |
| ORS decision | `CONSIDER` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **71** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 35 |
| Market score (persisted) | 40 |
| **Fix B divergence** | **DIVERGING — `opposite_signals`** (HARD_PASS + CONSIDER, delta=-18) |

> Fix B confirmed: Probility (HARD_PASS/42 vs CONSIDER/60) triggers `opposite_signals` banner — the most dangerous signal polarity inversion in the anchor set.

---

### Palm

| Field | Value |
|-------|-------|
| Deal ID | `c4f10092-1c94-4116-b4f0-78874868f92b` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **50** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 50 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.688 |
| **ORS** | **37** |
| ORS decision | `NO_GO` |
| ORS confidence band | High |
| **URSS** | **35** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | **12** |
| FHC status | `ok` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 15 |
| Market score (persisted) | 25 |
| **Fix B divergence** | not diverging (CONSIDER + NO_GO, gap=13, no rule triggered) |

> Palm deliberately does NOT trigger Fix B divergence: CONSIDER + NO_GO is not opposite-polarity, and gap=13 < 20 threshold. Rule 1 and Rule 2/3 both fail. Anchors B14 in unit tests.

---

### 3ICE

| Field | Value |
|-------|-------|
| Deal ID | `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **49** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `baseline:pinned`, `overrides:low`, `coverage_ratio:0.40` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 48 |
| `coverage_ratio` | 0.40 |
| `confidence_score` | 0.352 |
| **ORS** | **53** ⚠ pre-ADB (Fix D pending rebuild) |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null ⚠ pre-ADB (Fix A pending rebuild) |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 0 |
| Market score (persisted) | 12 ⚠ pre-ADB (Fix D pending rebuild; expected → 0) |
| **Fix B divergence** | not diverging (CONSIDER + NO_GO, gap=4) |

> ⚠ 3ICE has `market_score_raw=0` and is a Fix D target. After rebuild, `market_score_persisted` → 0 and ORS → ~49.

---

### Verse

| Field | Value |
|-------|-------|
| Deal ID | `bcd59d33-7887-41cd-80b9-742bc5ba945a` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **49** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `baseline:pinned`, `overrides:low`, `coverage_ratio:0.40` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 48 |
| `coverage_ratio` | 0.40 |
| `confidence_score` | 0.112 |
| **ORS** | **59** |
| ORS decision | `CONSIDER` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 20 |
| Market score (persisted) | 29 |
| **Fix B divergence** | not diverging (CONSIDER + CONSIDER, delta=-10) |

---

### Carmoola

| Field | Value |
|-------|-------|
| Deal ID | `da96b5a9-e5b2-46c1-a6ef-da037f876426` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **50** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `baseline:pinned`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 50 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.225 |
| **ORS** | **62** |
| ORS decision | `CONSIDER` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 30 |
| Market score (persisted) | 38 |
| **Fix B divergence** | not diverging (CONSIDER + CONSIDER, delta=-12) |

---

### Complyant

| Field | Value |
|-------|-------|
| Deal ID | `cc1ddde7-2553-42ed-bc98-09e52c4137cd` |
| **Canonical workspace verdict** | **CONSIDER** |
| Canonical score (`overall_score`) | **50** |
| Score band key | `consider_caution` |
| Score band label | Consider (Caution) |
| `decision_v1.recommendation_key` | `consider` |
| `decision_v1.severity` | `warn` |
| `decision_v1.reasons` | `band:consider_caution`, `baseline:pinned`, `overrides:low`, `coverage_ratio:0.80` |
| `hard_pass_guardrail_v2.triggered` | `false` |
| `unadjusted_overall_score` | 50 |
| `coverage_ratio` | 0.80 |
| `confidence_score` | 0.225 |
| **ORS** | **57** |
| ORS decision | `CONSIDER` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 15 |
| Market score (persisted) | 25 |
| **Fix B divergence** | not diverging (CONSIDER + CONSIDER, delta=-7) |

---

## Cross-Deal Summary Table

| Deal | Verdict | Score | Band | ORS | ORS Decision | URSS | DCI | FHC | Fix B Diverging |
|------|---------|-------|------|-----|-------------|------|-----|-----|----------------|
| Vermont | CONSIDER | 49 | consider_caution | 51 ⚠ | NO_GO | 35 | 80 (Good) | null (insufficient) ⚠ | No |
| Albuquerque | FUND | 73 | fund_caution | 60 | NO_GO | 35 | 80 (Good) | null (insufficient) | **YES — opposite_signals** |
| StackFactor | HARD_PASS | 44 | hard_pass | 50 | NO_GO | 23 | 60 (Partial) | **16 (ok)** | No |
| Probility | HARD_PASS | 42 | hard_pass | 60 | CONSIDER | 29 | 71 (Good) | null (insufficient) | **YES — opposite_signals** |
| Palm | CONSIDER | 50 | consider_caution | 37 | NO_GO | 35 | 80 (Good) | **12 (ok)** | No |
| 3ICE | CONSIDER | 49 | consider_caution | 53 ⚠ | NO_GO | 29 | 80 (Good) | null (insufficient) ⚠ | No |
| Verse | CONSIDER | 49 | consider_caution | 59 | CONSIDER | 29 | 80 (Good) | null (insufficient) | No |
| Carmoola | CONSIDER | 50 | consider_caution | 62 | CONSIDER | 29 | 80 (Good) | null (insufficient) | No |
| Complyant | CONSIDER | 50 | consider_caution | 57 | CONSIDER | 29 | 80 (Good) | null (insufficient) | No |

⚠ = pre-ADB value, will change after API container rebuild

---

## Deployment State at Capture Time

| Fix | Unit tests | API container | Status |
|-----|-----------|---------------|--------|
| Fix A (FSI threshold 15→10) | **3897 passing** | Pre-ADB code | Pending rebuild to appear in API |
| Fix D (market raw=0 early-exit) | **3897 passing** | Pre-ADB code | Pending rebuild to appear in API |
| Fix B (divergence banner) | **21 passing** | N/A (client-side logic) | **Active — confirmed in this capture** |

---

## Baseline Maintenance Protocol

1. After API container is rebuilt with ADB code, re-run `tmp/fetch_anchor_post_adb.py`
2. Verify Vermont: ORS=46, market_persisted=0; 3ICE: ORS~49, market_persisted=0
3. Verify Vermont (if deck_has_revenue=true): FHC_status='ok', FHC_score=26
4. If observed values match: update this baseline or create `SCORING_ANCHOR_BASELINE_POST_ADB_LIVE.md`
5. If unexpected values appear: investigate before accepting
