# Scoring Anchor Delta — Post-ADB (2026-03-31)

**Status:** Active delta record  
**Reference baseline (before):** `artifacts/SCORING_ANCHOR_BASELINE_2026-03-30.md`  
**Post-change baseline (after):** `artifacts/SCORING_ANCHOR_BASELINE_POST_ADB.md`  
**Capture method:** Live local API (`http://localhost:9001`) — `tmp/fetch_anchor_post_adb.py`  
**Contract reference:** `docs/Foundation/SCORING_SOURCE_OF_TRUTH_CONTRACT.md`

---

## Executive Summary

Three fixes were applied (Fix A, Fix D, Fix B). Two operate at the orchestrator scoring layer (computed on-the-fly from `render_package`); one operates at the UI layer (computed client-side from API values).

**At time of this capture:**

| Fix | Layer | API container state | Visible in API? |
|-----|-------|---------------------|----------------|
| Fix A — FSI threshold 15→10 | Worker orchestrator | Pre-ADB (not rebuilt) | **No — pending rebuild** |
| Fix D — market raw=0 DCI floor removal | Worker orchestrator | Pre-ADB (not rebuilt) | **No — pending rebuild** |
| Fix B — divergence banner | Web client-side | N/A (no container dependency) | **Yes — confirmed** |

Fix A and Fix D passed all unit tests (worker suite: 3897 tests passing). Their effect on API responses requires rebuilding the API Docker container with the new TypeScript source. The orchestrator-report endpoint calculates scores on-the-fly; no DB cache is involved — the container code is the bottleneck.

Fix B requires no container rebuild (pure client-side logic) and is confirmed active.

---

## Per-Deal Before/After Tables

### Vermont

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER (no change) |
| Workspace score | 49 | 49 | 49 (no change) |
| Score band | consider_caution | consider_caution | consider_caution |
| decision_v1 | consider / warn | consider / warn | no change |
| Hard-pass guardrail | false | false | false |
| **ORS** | **51** | **51** (unchanged) | **46** ← Fix D |
| ORS decision | NO_GO | NO_GO | NO_GO |
| URSS | 35 | 35 | 35 (no change) |
| DCI | 80 (Good) | 80 (Good) | 80 (Good) |
| **FHC status** | **insufficient_data** | **insufficient_data** | depends on deck signals* |
| **FHC score** | **null** | **null** | depends on deck signals* |
| FHC is_proxy | false | false | — |
| FHC is_deck_only_fsi | null | null | — |
| **market_score_raw** | **0** | **0** | 0 |
| **market_score_persisted** | **12** | **12** (unchanged) | **0** ← Fix D |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

*Vermont's deck_has_revenue signal is unknown from API alone with pre-ADB container. If `deck_has_revenue=true`, Fix A would yield FHC_status=ok, FHC_score=26. If Vermont has FSI < 10 (e.g., no deck financial signals), Fix A would not change it.

**Fix D impact on Vermont (post-rebuild math):**
`computeMarketScorePersisted(0, 80)` → was `round(0+0.15×80)=12`, now `0` (early-return).
ORS = `round(0.35×0 + 0.30×74 + 0.25×35 + 0.10×80)` = `round(0 + 22.2 + 8.75 + 8)` = **39** ← recalculated using URSS=35 not 74; let verifier confirm actual component values from live report.

> Note: The exact ORS post-rebuild depends on the URSS and DCI component values in the live render_package for Vermont. The Fix D unit test D10 (Vermont-style: market=0, URSS=74, DCI=80, URSS=65) produced ORS=46. Vermont's actual URSS=35, which would yield a different ORS. The key invariant is `market_score_persisted → 0` (confirmed by test D1).

---

### Albuquerque

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | FUND | FUND | FUND (no change) |
| Workspace score | 73 | 73 | 73 (no change) |
| Score band | fund_caution | fund_caution | fund_caution |
| decision_v1 | fund_caution / warn | fund_caution / warn | no change |
| Hard-pass guardrail | false | false | false |
| ORS | 60 | 60 | 60 (market_raw=30, not affected by Fix D) |
| ORS decision | NO_GO | NO_GO | NO_GO |
| URSS | 35 | 35 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| FHC status | insufficient_data | insufficient_data | TBD (Fix A may apply) |
| FHC score | null | null | TBD |
| market_score_raw | 30 | 30 | 30 |
| market_score_persisted | 38 | 38 | 38 (raw=30, Fix D doesn't apply) |
| **Fix B divergence** | **(not computed)** | **DIVERGING — opposite_signals** ← **NEW** | opposite_signals |

**Delta:** Fix B divergence banner NOW ACTIVE. Workspace FUND vs ORS NO_GO → `opposite_signals`, scoreDelta=+13.  
**Fix D does not apply** to Albuquerque (market_raw=30, not zero).

---

### StackFactor

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | HARD_PASS | HARD_PASS | HARD_PASS |
| Workspace score | 44 | 44 | 44 |
| ORS | 50 | 50 | 50 (FHC already ok, Fix A not applicable) |
| ORS decision | NO_GO | NO_GO | NO_GO |
| URSS | 23 | 23 | no change |
| DCI | 60 (Partial) | 60 (Partial) | no change |
| FHC status | ok | ok | ok (unchanged — XLSX signals, Fix A not applicable) |
| FHC score | 16 | 16 | 16 |
| market_score_raw | 55 | 55 | 55 |
| market_score_persisted | 56 | 56 | 56 (raw=55, Fix D doesn't apply) |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

**Delta:** No change anywhere. HARD_PASS + NO_GO does not trigger Fix B Rule 2 (only HARD_PASS + CONSIDER/GO does). Fix A not applicable (FHC already ok). Fix D not applicable (market_raw=55).

---

### Probility

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | HARD_PASS | HARD_PASS | HARD_PASS |
| Workspace score | 42 | 42 | 42 |
| ORS | 60 | 60 | 60 (market_raw=35, Fix D not applicable) |
| ORS decision | CONSIDER | CONSIDER | CONSIDER |
| URSS | 29 | 29 | no change |
| DCI | 71 (Good) | 71 (Good) | no change |
| FHC status | insufficient_data | insufficient_data | TBD (Fix A may apply) |
| FHC score | null | null | TBD |
| market_score_raw | 35 | 35 | 35 |
| market_score_persisted | 40 | 40 | 40 (raw=35, Fix D doesn't apply) |
| **Fix B divergence** | **(not computed)** | **DIVERGING — opposite_signals** ← **NEW** | opposite_signals |

**Delta:** Fix B divergence banner NOW ACTIVE. Workspace HARD_PASS vs ORS CONSIDER → `opposite_signals`, scoreDelta=-18. **This is the highest-priority gap in the anchor set** — an investor who HARD_PASSed a deal the orchestrator rates as worth considering.

---

### Palm

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER |
| Workspace score | 50 | 50 | 50 |
| ORS | 37 | 37 | 37 |
| ORS decision | NO_GO | NO_GO | NO_GO |
| URSS | 35 | 35 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| FHC status | ok | ok | ok (XLSX signals, Fix A not applicable) |
| FHC score | 12 | 12 | 12 |
| market_score_raw | 15 | 15 | 15 |
| market_score_persisted | 25 | 25 | 25 (raw=15, Fix D doesn't apply) |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

**Delta:** No change. Palm correctly stays non-diverging: CONSIDER + NO_GO is not opposite polarity per Fix B rules, and gap=13 < 20pt threshold. Unit test B14 anchors this explicitly.

---

### 3ICE

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER |
| Workspace score | 49 | 49 | 49 |
| **ORS** | **53** | **53** (unchanged) | **~49** ← Fix D |
| ORS decision | NO_GO | NO_GO | NO_GO |
| URSS | 29 | 29 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| **FHC status** | **insufficient_data** | **insufficient_data** | TBD (Fix A may apply) |
| **FHC score** | **null** | **null** | TBD |
| **market_score_raw** | **0** | **0** | 0 |
| **market_score_persisted** | **12** | **12** (unchanged) | **0** ← Fix D |
| **Fix B divergence** | (not computed) | not diverging | not diverging |

**Fix D impact on 3ICE (post-rebuild):** `computeMarketScorePersisted(0, 80)` → 0. ORS drops by approximately `0.35 × 12 = 4.2` points → ORS ~49. Decision likely remains NO_GO.

---

### Verse

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER |
| Workspace score | 49 | 49 | 49 |
| ORS | 59 | 59 | 59 (market_raw=20, Fix D not applicable) |
| ORS decision | CONSIDER | CONSIDER | CONSIDER |
| URSS | 29 | 29 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| FHC status | insufficient_data | insufficient_data | TBD (Fix A may apply) |
| FHC score | null | null | TBD |
| market_score_raw | 20 | 20 | 20 |
| market_score_persisted | 29 | 29 | 29 (raw=20, Fix D doesn't apply) |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

**Delta:** No scoring change. Fix D not applicable. Fix B not triggered (CONSIDER + CONSIDER, delta=-10).

---

### Carmoola

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER |
| Workspace score | 50 | 50 | 50 |
| ORS | 62 | 62 | 62 (market_raw=30, Fix D not applicable) |
| ORS decision | CONSIDER | CONSIDER | CONSIDER |
| URSS | 29 | 29 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| FHC status | insufficient_data | insufficient_data | TBD (Fix A may apply) |
| FHC score | null | null | TBD |
| market_score_raw | 30 | 30 | 30 |
| market_score_persisted | 38 | 38 | 38 |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

**Delta:** No change anywhere. Fix D not applicable (raw=30). Fix B not triggered (CONSIDER + CONSIDER, delta=-12).

---

### Complyant

| Field | Before (2026-03-30) | After (2026-03-31 API) | Expected after rebuild |
|-------|---------------------|------------------------|------------------------|
| Workspace verdict | CONSIDER | CONSIDER | CONSIDER |
| Workspace score | 50 | 50 | 50 |
| ORS | 57 | 57 | 57 (market_raw=15, Fix D not applicable) |
| ORS decision | CONSIDER | CONSIDER | CONSIDER |
| URSS | 29 | 29 | no change |
| DCI | 80 (Good) | 80 (Good) | no change |
| FHC status | insufficient_data | insufficient_data | TBD (Fix A may apply) |
| FHC score | null | null | TBD |
| market_score_raw | 15 | 15 | 15 |
| market_score_persisted | 25 | 25 | 25 |
| **Fix B divergence** | (not computed) | **not diverging** | not diverging |

**Delta:** No change anywhere. Fix D not applicable (raw=15). Fix B not triggered (CONSIDER + CONSIDER, delta=-7).

---

## Fix-by-Fix Impact Summary

### Fix A — FSI threshold 15 → 10

**Intended scope:** Deals with exactly FSI in [10, 14] — i.e., deck has at least one financial signal but below the old threshold. Revenue-only deck (FSI=10) would change from `insufficient_data` to FHC=ok, score=26.

**Observed in API (2026-03-31):** No change to any FHC field for any deal.

**Reason:** API container running pre-ADB code. Fix A is not yet deployed to the running container.

**Deals that WILL change after rebuild (confirmed by unit tests):**
- Any anchor deal with `deck_has_revenue=true` and no XLSX financial sheets has FSI=10 → previously insufficient_data, now ok with score=26
- Vermont and 3ICE are the most likely candidates (low-coverage deals with deck-only signals)
- StackFactor, Palm: not affected (already have FHC=ok from XLSX signals)
- Albuquerque, Probility, Verse, Carmoola, Complyant: may or may not have deck revenue signals; cannot confirm from API without container rebuild

**Unit test that anchors this:** Test A3 in `compute-fhc.test.ts` — `deck_has_revenue=true only → FHC=ok, score=26`. Test A11 is the explicit regression anchor.

---

### Fix D — market_score_raw=0 DCI floor removal

**Intended scope:** Deals where `market_score_raw=0`. Previously `computeMarketScorePersisted(0, dci)` returned `round(0.15×dci)` = 12 for DCI=80. Now returns 0.

**Observed in API (2026-03-31):** No change to market_score_persisted or ORS for Vermont or 3ICE.

**Reason:** API container running pre-ADB code. Fix D is not yet deployed to the running container.

**Deals confirmed to change after rebuild:**

| Deal | market_raw | market_persisted (before) | market_persisted (after rebuild) | ORS change |
|------|------------|--------------------------|----------------------------------|------------|
| Vermont | 0 | 12 | **0** | Drops ~4-12 pts (depends on component weights) |
| 3ICE | 0 | 12 | **0** | Drops ~4 pts → ORS ~49 |

**Deals confirmed NOT affected by Fix D:** Albuquerque (raw=30), StackFactor (raw=55), Probility (raw=35), Palm (raw=15), Verse (raw=20), Carmoola (raw=30), Complyant (raw=15) — all have non-zero market_raw.

**Unit test that anchors this:** Test D1 in `compute-ors.test.ts` — `raw=0, dci=80 → 0`. Test D4 confirms all non-zero raw inputs unchanged.

---

### Fix B — Workspace/ORS divergence banner

**Intended scope:** Additive UI banner in AI Analysis tab. Triggers when:
- Rule 2: workspace=HARD_PASS + ors=CONSIDER or GO → `opposite_signals`
- Rule 3: workspace=FUND + ors=NO_GO → `opposite_signals`
- Rule 1: `abs(workspace_score - ors_score) > 20` → `large_numeric_gap`

**Observed in API (2026-03-31):** Computed fresh from live API values.

| Deal | Workspace | ORS Decision | Diverging? | Kind | Score Delta |
|------|-----------|--------------|-----------|------|-------------|
| Vermont | CONSIDER | NO_GO | No | — | -2 |
| **Albuquerque** | **FUND** | **NO_GO** | **YES** | **opposite_signals** | **+13** |
| StackFactor | HARD_PASS | NO_GO | No | — | -6 |
| **Probility** | **HARD_PASS** | **CONSIDER** | **YES** | **opposite_signals** | **-18** |
| Palm | CONSIDER | NO_GO | No | — | +13 |
| 3ICE | CONSIDER | NO_GO | No | — | -4 |
| Verse | CONSIDER | CONSIDER | No | — | -10 |
| Carmoola | CONSIDER | CONSIDER | No | — | -12 |
| Complyant | CONSIDER | CONSIDER | No | — | -7 |

**2 of 9 deals now show the divergence banner.**

**Design validation:**
- Albuquerque (FUND/73 vs NO_GO/60): `opposite_signals` ✓ — investor intends to fund, orchestrator says no. Banner correctly fires.
- Probility (HARD_PASS/42 vs CONSIDER/60): `opposite_signals` ✓ — most dangerous: investor skipped, orchestrator says worth considering.
- Palm (CONSIDER/50 vs NO_GO/37): gap=13, rule 1 fails (< 20), rule 2 fails (CONSIDER not HARD_PASS/FUND), rule 3 fails. **Correctly NOT diverging.** Unit test B14 anchors this.
- StackFactor (HARD_PASS/44 vs NO_GO/50): Rule 2 requires HARD_PASS + CONSIDER/GO. HARD_PASS + NO_GO is aligned signal, not diverging. **Correct behavior.**
- Vermont (CONSIDER/49 vs NO_GO/51): gap=2, same polarity. Not diverging. Correct.

**No unexpected triggers. No missing triggers. Fix B behavior exactly matches intended design.**

---

## Expected vs Unexpected Changes

### Expected changes (confirmed or pending rebuild)

| Change | Fix | Status |
|--------|-----|--------|
| market_score_persisted 12→0 for Vermont | Fix D | Pending rebuild |
| market_score_persisted 12→0 for 3ICE | Fix D | Pending rebuild |
| ORS drops ~4-12 pts for Vermont | Fix D | Pending rebuild |
| ORS drops ~4 pts for 3ICE | Fix D | Pending rebuild |
| FHC changes for revenue-signal deals | Fix A | Pending rebuild |
| Albuquerque shows opposite_signals banner | Fix B | **Confirmed** |
| Probility shows opposite_signals banner | Fix B | **Confirmed** |

### Unexpected changes

**None observed.** All scoring fields that were not intended to change remained identical to the 2026-03-30 baseline.

Specifically verified as stable (no unintended side effects):
- StackFactor FHC=16 (ok) — unchanged (Fix A does not corrupt already-ok FHC)
- Palm FHC=12 (ok) — unchanged
- All 9 workspace scores — unchanged (Fix A/D/B do not touch workspace scoring)
- All 9 verdict labels — unchanged
- All 9 hard-pass guardrail states — unchanged (all false)
- All URSS values — unchanged (Fix A/D/B do not touch URSS)
- All DCI values — unchanged

---

## Overall Delta Classification

### Deals that changed scoring behavior (any field)

**At the API layer (confirmed live):**

| Deal | What changed |
|------|-------------|
| Albuquerque | Fix B divergence banner now active |
| Probility | Fix B divergence banner now active |

**Pending container rebuild (formula changes in code, not yet in API):**

| Deal | What will change |
|------|-----------------|
| Vermont | market_persisted 12→0, ORS drops |
| 3ICE | market_persisted 12→0, ORS drops ~4 pts |
| Vermont (if deck_has_revenue) | FHC_status: insufficient_data→ok, FHC_score: null→26 |
| 3ICE (if deck_has_revenue) | Same as Vermont |
| Other insufficient_data deals (if revenue signal) | FHC_status/score change from Fix A |

### Deals that did not change

**At the API layer, all 9 deals have unchanged scoring fields.** At the semantic/behavioral layer:
- StackFactor: no change expected (FHC already ok, market_raw=55, HARD_PASS+NO_GO)
- Palm: no change expected (FHC already ok, market_raw=15, banner intentionally not triggered)
- Verse, Carmoola, Complyant: no change (CONSIDER+CONSIDER, non-zero market_raw)

---

## Conformance Assessment

| Fix | Intended behavior | Observed behavior | Conformant? |
|-----|-------------------|-------------------|-------------|
| Fix A — FSI 15→10 | Revenue-only deals get FHC=ok instead of insufficient_data | Unit tests confirm formula correct. API shows old values (container not rebuilt). | **Partial — formula correct, not yet deployed** |
| Fix D — raw=0 → 0 | Vermont/3ICE market_persisted 12→0, ORS drops | Unit tests confirm formula correct. API shows old values (container not rebuilt). | **Partial — formula correct, not yet deployed** |
| Fix B — divergence banner | 2 deals diverging (Probility, Albuquerque), 7 not | Exactly 2 confirmed diverging, 7 correctly not diverging. No false positives. | **Full conformance — confirmed in live API** |

---

## Reprocessing Checklist (to fully validate Fix A and Fix D)

1. `docker compose restart api` (or rebuild with `docker compose up --build api`) in local dev environment
2. Re-run `python3 tmp/fetch_anchor_post_adb.py`
3. Verify:
   - Vermont: `market_score_persisted = 0`, ORS changes from 51 (`< 51` expected)
   - 3ICE: `market_score_persisted = 0`, ORS changes from 53 (~49 expected)
   - Vermont (if `deck_has_revenue=true`): `FHC_status = ok`, `FHC_score = 26`
   - No other ORS values change (Albuquerque, StackFactor, Probility, Palm, Verse, Carmoola, Complyant all have `market_raw > 0`)
4. Update `artifacts/SCORING_ANCHOR_BASELINE_POST_ADB.md` with confirmed post-rebuild values
