# Phase 1 Analyzer Accuracy Fixes (Traction Gating + Truth Arbitration + Confidence Clamp + Score Penalty + Evidence Gates)

**Date:** 2026-01-02  
**Scope:** `packages/core/src/phase1/phase1-dio-v1.ts` (+ minimal test updates)

## Summary

This change set hardens Phase 1 outputs against five recurring failure modes:

1. **False traction** from macro/industry statements (e.g., “global music revenue grew…”).
2. **OCR/logo junk** contaminating Product/ICP (e.g., `D R O P A B L E S`) and tagline fragments.
3. **Cross-domain contamination** (e.g., sports/media deals drifting into real-asset or SaaS classifications).
4. **Inflated scores** that don’t reflect missing fundamentals (product/ICP/raise/gtm).
5. **Weak business_model/archetype evidence** (labels assigned without a verb-bearing, non-legal supporting sentence).

It also enforces a strict invariant:

> If **product_solution** or **market_icp** is empty after arbitration + validation, confidence must be **low** and recommendation must **not** be **GO**.

---

## 1) Traction Tightening (Gated Signals)

### What changed
Updated `isCompanyTractionSnippet(...)` to prevent macro/industry context from being counted as company traction.

**Key updates:**
- Added `macroHardBlock` (industry/market/global/platforms/streaming platforms/etc.) → immediately rejects the sentence.
- Changed acceptance logic from permissive matching to:

**New requirement:**
- `ownership && (hasConcreteMetric || operationalVerb)`

Where:
- **ownership** = we/our/us OR explicit company token match
- **hasConcreteMetric** = currency/%, KPI counts, ARR/MRR/GMV with number, run-rate w/ number, retention/churn with number, etc.
- **operationalVerb** includes: generated, reached, hit, achieved, signed, closed, onboarded, acquired, retained, expanded, grew, scaled, etc.

### Why this matters
Stops **Dropables-style** false traction where “revenue” appears in an industry statement rather than the company’s actual performance.

---

## 2) Product / ICP Hard Validation

### What changed
Added strict validators to prevent junk/boilerplate from entering `product_solution` / `market_icp`.

**New predicates:**
- `hasSpacedLogoOcrArtifact(...)`
  - Rejects spaced-letter logo OCR artifacts like: `D R O P A B L E S`
- `capsTokenRatio(...)`
  - Rejects if ALL-CAPS token ratio > 0.4
- `hasBusinessVerb(...)`
  - Requires a verb-like signal (build/operate/enable/monetize/provide/run/help/automate/deliver etc.)
- `hardValidateProductOrMarket(...)`
  - Returns `""` if any validation fails

### Wiring
Applied immediately after `arbitrateDealTruth(...)` in `generatePhase1DIOV1(...)`:

- If the value was non-empty but fails validation:
  - mark as **hard-rejected**
  - set to `""`
- **Real-estate sparse fallbacks are blocked** when hard-rejected
- Re-validates again after any fallback so no “bypass” occurs

### Why this matters
Prevents:
- OCR/logo contamination
- tagline-only fragments
- industry boilerplate being treated as Product/ICP
- fallbacks “repairing” invalid data into something misleading

---

## 3) Sports/Media Arbitration Enforcement

### What changed
Strengthened `arbitrateDealTruth(...)` so sports/media deals cannot be misclassified as real-asset or SaaS.

When `sports_media` is **strong**:
- Force `deal_type = "startup_raise"`
- Expand real-asset blocker list; if detected:
  - blank `product_solution` / `market_icp`
- If `business_model` looks SaaS/subscription but **no explicit software signals** exist:
  - set `business_model = "Unknown"`

### Why this matters
Prevents **3ICE-style** contamination where real-asset phrasing leaks into sports/media summaries and business model.

---

## 4) Confidence + Recommendation Hard Clamp

### What changed
After arbitration + validation:

If `product_solution` **OR** `market_icp` is empty:
- Force:
  - `overall = "low"`
  - `decision_summary_v1.confidence = "low"`
- Clamp recommendation:
  - if it was `"GO"` → downgrade to `"CONSIDER"`

### Why this matters
Guarantees we never show “high confidence GO” when core deal understanding is missing/contaminated.

---

## 5) Post-score Penalty Step

### What changed
After arbitration + validation, the numeric `decision_summary_v1.score` receives a deterministic penalty so the number matches the missing fundamentals.

**Penalties:**
- `product_solution` empty ⇒ **−10**
- `market_icp` empty ⇒ **−10**
- `raise` unknown OR `raise_terms` missing ⇒ **−5**
- `gtm` missing ⇒ **−5**

The final score is clamped to **[0, 100]** via the existing clamp.

### Why this matters
Prevents misleading outcomes like **77/100** when the deal is missing core understanding fields.

---

## 6) Business Model / Archetype Evidence Quality Gate

### What changed
`business_model` is forced to **"Unknown"** unless there is at least one **high-quality** supporting sentence that:
- is **not** legal boilerplate / disclaimers
- is **not** OCR junk / slogans
- contains a **business verb** (e.g., build/building/built, operate, sell/selling, monetize, enable, provide, license)

If the gate forces `business_model = "Unknown"`, and `business_archetype_v1.confidence` exists, it is downgraded to **≤ 0.3**.

### Why this matters
Stops mislabeling like **SaaS / subscription** when the documents don’t actually support a software subscription model.

---

## 7) Sports/Media Domain Detector Hardening

### What changed
Strengthened the sports/media detector to better dominate arbitration by expanding anchor keywords (e.g., seasons, arenas/stadiums/venues, teams, athletes, broadcasts, media rights, pluralized variants).

### Why this matters
Prevents sports/media deals (e.g., 3ICE) from drifting into real-asset or SaaS classifications due to stray boilerplate.

---

## Tests (Minimal Updates, No New Files)

Updated: `packages/core/src/phase1/phase1-dio-v1.test.ts`

- **Dropables macro traction regression**
  - Includes numeric macro sentence (e.g., `$10B global market`) and asserts:
    - **no** company traction signals emitted
- **3ICE arbitration regression**
  - Feeds contaminated inputs:
    - `deal_type: real_estate_preferred_equity`
    - `business_model: SaaS / subscription`
  - Asserts:
    - `deal_type` becomes `startup_raise`
    - business_model is **not** SaaS/subscription
    - real-asset phrases do not appear in summaries
- **Confidence clamp regression**
  - Missing product (or ICP) now expects:
    - confidence = **low**
    - recommendation != **GO**
- **Score penalty regression**
  - Missing Product/ICP must reduce score (and can’t remain inflated)
- **Business model evidence gate regression**
  - SaaS/subscription cannot be set without verb-bearing, non-legal evidence

---

## Validation

✅ pnpm --filter core test (passes)

Notes:
- These changes do **not** alter scoring weights.
- They tighten predicates + arbitration and enforce output invariants.

---

## Next recommended follow-ups

1. Add an “evidence-backed extraction” check for Product/ICP:
   - require the selected sentence to appear verbatim (or near-verbatim) in `domainText`
2. Expand domain arbitration to include:
   - crypto/web3 / nft signals vs generic “platform” signals
3. Add a small debug trace payload when values are hard-rejected:
   - `rejected_reason: spaced_logo | caps_ratio | no_business_verb | domain_blocked`