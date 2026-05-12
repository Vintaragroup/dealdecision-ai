# Scoring Anchor Baseline — 2026-03-30

**Status:** Active baseline  
**Captured:** 2026-03-30  
**Capture method:** Live local API (`http://localhost:3000`) — `tmp/fetch_anchor_deals_v2.py`  
**API schema:** `ddai_orchestrator_report_v1`  
**Contract reference:** `docs/Foundation/SCORING_SOURCE_OF_TRUTH_CONTRACT.md`

---

## Purpose

This snapshot records the canonical scoring output for all 9 anchor deals at the time of the scoring source-of-truth contract creation. It serves as a regression baseline: if any score, verdict, or band changes after a code modification, this document should be consulted to determine whether the change was intentional.

**Before changing any score formula, weight, or threshold:** re-run `tmp/fetch_anchor_deals_v2.py` against a local environment and compare output to this baseline. If values differ, document the delta and create a new versioned baseline.

---

## Capture Notes

- All 9 deals were fetched from the live local API in a single run
- `canonical_workspace_verdict` was derived at capture time using `resolveWorkspaceVerdict()` logic applied to the API response (guardrail → decision_v1.label → phase1 signals → score threshold → default)
- `FHC_is_deck_only_fsi` returned `null` for all deals where `FHC_status === "insufficient_data"` — this is expected per the contract (see Section 8, Rule 7)
- `market_score_raw` is the pre-persisted market signal; `market_score_persisted` is what was stored in the DB at the time of capture. Differences reflect scoring pipeline behavior.
- Orchestrator scores (ORS, DCI, FHC, URSS) are computed-at-read-time from `render_package` — they were fresh at capture time

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
| **ORS** | **51** |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **35** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 0 |
| Market score (persisted) | 12 |

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

> Note: `unadjusted_overall_score` (75) differs from `overall_score` (73) — drift:misaligned pin reason active. ORS decision (`NO_GO`) diverges from workspace verdict (`FUND`) because orchestrator uses Growth stage threshold (`go_min_ors=80`); ORS=60 is below that threshold. These two scores are architecturally separate.

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

> Note: StackFactor has a real FHC score (16, `ok` status) — one of only two anchor deals where FHC was computable.

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

> Note: Probility workspace verdict is `HARD_PASS` (score=42, band=hard_pass) while orchestrator ORS decision is `CONSIDER` (ORS=60). These are architecturally separate signals — the workspace verdict reflects DIO scoring; the orchestrator CONSIDER reflects a moderate ORS against the stage threshold.

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

> Note: Palm has the second real FHC score (12, `ok`). ORS is notably low (37) with High confidence, indicating strong analyst-level signal for NO_GO that is separate from the workspace CONSIDER verdict.

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
| **ORS** | **53** |
| ORS decision | `NO_GO` |
| ORS confidence band | Medium |
| **URSS** | **29** |
| **DCI score** | **80** |
| DCI band | Good |
| **FHC score** | null |
| FHC status | `insufficient_data` |
| FHC is_proxy | false |
| FHC is_deck_only_fsi | null |
| Market score (raw) | 0 |
| Market score (persisted) | 12 |

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

---

## Cross-Deal Summary Table

| Deal | Verdict | Score | Band | ORS | ORS Decision | URSS | DCI | FHC |
|------|---------|-------|------|-----|-------------|------|-----|-----|
| Vermont | CONSIDER | 49 | consider_caution | 51 | NO_GO | 35 | 80 (Good) | null (insufficient) |
| Albuquerque | FUND | 73 | fund_caution | 60 | NO_GO | 35 | 80 (Good) | null (insufficient) |
| StackFactor | HARD_PASS | 44 | hard_pass | 50 | NO_GO | 23 | 60 (Partial) | **16 (ok)** |
| Probility | HARD_PASS | 42 | hard_pass | 60 | CONSIDER | 29 | 71 (Good) | null (insufficient) |
| Palm | CONSIDER | 50 | consider_caution | 37 | NO_GO | 35 | 80 (Good) | **12 (ok)** |
| 3ICE | CONSIDER | 49 | consider_caution | 53 | NO_GO | 29 | 80 (Good) | null (insufficient) |
| Verse | CONSIDER | 49 | consider_caution | 59 | CONSIDER | 29 | 80 (Good) | null (insufficient) |
| Carmoola | CONSIDER | 50 | consider_caution | 62 | CONSIDER | 29 | 80 (Good) | null (insufficient) |
| Complyant | CONSIDER | 50 | consider_caution | 57 | CONSIDER | 29 | 80 (Good) | null (insufficient) |

### Observed patterns

- **7 of 9 deals** have `FHC_status = insufficient_data` — FHC requires FSI ≥ 15 from structured XLSX sources; most anchor deals lack sufficient XLSX signals
- **All 9 deals** have `hard_pass_guardrail_v2.triggered = false` — guardrail was not triggered at capture time
- **5 of 9 deals** have `ORS_decision = CONSIDER` or `NO_GO` while workspace verdict ≠ `FUND`/`HARD_PASS` — expected; ORS and workspace verdict are architecturally separate
- **Albuquerque gap:** Workspace verdict = `FUND` (score=73), ORS decision = `NO_GO` — expected; Growth stage (`go_min_ors=80`) sets a high bar that ORS(60) doesn't meet
- **Probility gap:** Workspace verdict = `HARD_PASS` (score=42, band=hard_pass), ORS decision = `CONSIDER` (ORS=60) — expected; illustrates the two-track design
- **`is_deck_only_fsi = null`** for all insufficient_data cases — see Rule 7 in contract

---

## Baseline Maintenance Protocol

1. Re-run `tmp/fetch_anchor_deals_v2.py` against a local environment after any change to: score formulas, band thresholds, ORS/DCI/FHC/URSS weights, or `enrichReportMetadata()`
2. Compare JSON output to snapshot values in this document
3. For intentional changes: create a new versioned file (`SCORING_ANCHOR_BASELINE_YYYY-MM-DD.md`), update `DOCS_GOVERNANCE_INDEX.md`, and note the delta in the new file
4. For unexpected changes: treat as a regression and investigate before merging
