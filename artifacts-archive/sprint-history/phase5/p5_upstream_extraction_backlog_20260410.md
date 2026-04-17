# P5 Upstream Extraction Backlog
**Generated:** 2026-04-10  
**Based on:** 10-deal foundational validation suite (Allurion, Carmoola, Cino, Probility, Qredible + StackFactor, DealDecision, Albuquerque, Magarian, 3ICE)  
**Guard version at time of audit:** v26  
**Status:** Backlog only — NO code changes in this document  

---

## Backlog Summary

| ID | Title | Priority | Scope | Root Cause Layer | Confirmed On |
|----|-------|----------|-------|-----------------|-------------|
| P5-001 | `__compiler_version` null — cache not invalidating for stale deals | CRITICAL | Route / Cache | Cache invalidation gap | StackFactor, DealDecision, Albuquerque, 3ICE, Magarian |
| P5-002 | BM: CRE / real estate context guard | HIGH | FPG `packages/core` | DPU BM misclassification | Albuquerque |
| P5-003 | Hero/overview tier containing raw OCR text shards | HIGH | Report compiler / governed_ui_copy_v1 | DPU segment classification | DealDecision |
| P5-004 | Carmoola BM: "Real estate structured investment" for car finance app | HIGH | Worker DPU extraction | Wrong-industry DPU extraction | Carmoola |
| P5-005 | Revenue: 2026/future projection surfaced as current revenue | MEDIUM | Structured summary / FAG | Revenue period validation | DealDecision, 3ICE |
| P5-006 | Revenue confidence minimum floor (conf < 0.5 should be blocked) | MEDIUM | Structured summary | Revenue selector threshold | 3ICE |
| P5-007 | Growth: forward projection surfaced as growth signal | MEDIUM | Structured summary | Growth selector validation | StackFactor |
| P5-008 | `product=null`, `market=null` across 8/10 deals | MEDIUM | Worker DPU extraction | DPU coverage gap | All 5 new deals + Carmoola, Cino, Qredible |
| P5-009 | `funding_stage=pre_seed/IDEA` for operational companies | MEDIUM | DIO classification | Funding stage classifier | Allurion, Carmoola, Cino, Qredible, Probility |
| P5-010 | `deck_archetype=consumer_product` for B2B SaaS deals | LOW | DIO classification | Archetype classifier | Qredible, Probility |
| P5-011 | `team_signal.roles_present` all-false despite named team on deck | LOW | Worker DPU extraction | Team signal extraction | Carmoola, Cino, Qredible, Probility |
| P5-012 | IAO summary template claims "revenue signals" when revenue=null | LOW | IAO V2 | Template accuracy guard | Magarian |
| P5-013 | BM "Licensing" insufficient precision for multi-stream sports league | LOW | Structured summary | BM extraction precision | 3ICE |

---

## P5-001 — CRITICAL: `__compiler_version` null — cache not invalidating for stale deals

**Priority:** CRITICAL  
**Scope:** `apps/api/src/routes/reports.ts` — cache invalidation check  

**Finding:** 5 of the 10 foundational deals return `__compiler_version = null` from the report API. This means these deals' cached reports were compiled before the `__compiler_version` field existed, OR the cache invalidation check is not triggering a recompile.

**Impact:**  
- Any deal with cv=null is NOT protected by any guard from v22–v26  
- StackFactor (BM=Wholesale/Retail) would be fixed by FPG on recompile at v26 but the old cached report is being returned  
- This is a systemic gap: as REPORT_COMPILER_VERSION bumps, deals that haven't recompiled don't get the new protection

**Expected behavior:** The cache check `if (cached.__compiler_version !== REPORT_COMPILER_VERSION)` should invalidate these deals and trigger fresh compilation. If cv=null, `null !== 26` is true and recompilation should occur.

**Possible causes:**
1. The cache check is `cached.__compiler_version === REPORT_COMPILER_VERSION` → returns if true, but also returns from cache on other code paths that don't check the version
2. These deals' DIO analysis has insufficient data and falls into a "short-circuit" path that bypasses version checking
3. The compiled report is stored without `__compiler_version` and is returned through a non-updating path

**Fix direction:**
- Audit the cache retrieval path in `reports.ts` to confirm ALL exit paths through the route check `__compiler_version`
- Add a force-recompile flag or route parameter for debugging  
- For affected deals: trigger a fresh DIO analysis run to generate a properly versioned report

---

## P5-002 — HIGH: BM guard for CRE / real estate context

**Priority:** HIGH  
**Scope:** `packages/core/src/reports/final-publish-guard.ts`  

**Finding:** Albuquerque is a commercial real estate (CRE) build-to-suit project. DPU extracted `Omnichannel (DTC + Wholesale/Retail)` as the business model, derived from the healthcare tenant's operational language. The FPG BM guards (`hasTechPlatformContext`, `hasMedtech`) do NOT cover real estate context. BM escape persists post-v26 recompile.

**IAO internal contradiction:** IAO summary correctly says "real estate structured investment"; IAO.business_model says "Omnichannel". Same report, contradictory outputs.

**Fix direction (FPG layer):**
```typescript
function hasRealEstateContext(text: string | null): boolean {
  if (!text) return false;
  return /\b(real estate|build.to.suit|commercial property|reit|net lease|nnn lease|cap rate|tenant|landlord|ground lease|cre |zoning|development project)\b/i.test(text);
}
```
Apply: if `bm_source_text` contains real estate signals AND BM contains retail/consumer/omnichannel → trigger `business_model.real_estate_context_mismatch`.

**Fix direction (DPU layer):** Cross-check BM extraction against deal type. If `deal_type = "real_estate_project"` or `raise_context = "cre"`, reject retail BM candidates.

**Deals affected:** Albuquerque  

---

## P5-003 — HIGH: Hero/overview tier raw OCR text shard escape

**Priority:** HIGH  
**Scope:** `apps/api/src/routes/reports.ts` — tier construction; `packages/core/src/reports/` — governed_ui_copy_v1  

**Finding:** DealDecision shows `tiers.hero` and `tiers.overview` containing raw OCR text from a fund allocation percentage slide: `"Market context: The Ask $2M Pre-Seed Scale product, build team, accelerate go-to-market 40% 30% 20% 10% People / Hiring..."`. This is structurally incompatible with the purpose of the hero tier, which should show company identity or raise context.

**Root cause:** When `product=null` and no clean identity text is available, the compiler falls back to a DPU shard labeled with an identity-adjacent segment_key. The shard contains OCR noise from a budget allocation chart.

**Fix direction:**
1. Add a hero-tier text sanitization rule: if hero text contains `%` + numeric budget split patterns, reject it
2. Add minimum token length sanity check: if hero text > 180 chars AND contains 2+ percentage figures, fall back to `bm` value or empty
3. Fix upstream: improve DPU segment classification for fund-use slides (should be `segment_key: "distribution"` or `"raise_terms"`, not fed to identity tier)

**Deals affected:** DealDecision  

---

## P5-004 — HIGH: Carmoola BM "Real estate structured investment" for car finance app

**Priority:** HIGH (from prior session)  
**Scope:** Worker DPU extraction  

**Finding (pre-existing, documented in prior audit):** Carmoola is a B2C car finance app (UK car loan origination + virtual debit card). The BM extraction returned `"Real estate structured investment"` — a complete category failure. The financial document language (structured investment, loan book, securitization) triggered wrong-industry DPU classification.

**Root cause:** Financial/lending terminology in car finance documents maps to real estate structured investment language in the DPU classifier. The BM classifier lacks a "consumer lending/car finance" category that would match the product context.

**Fix direction:**
- Add product-category cross-check: if `product` references "car", "vehicle", "automotive", "loan", "fintech" — reject real estate BM classifications
- Expand BM vocabulary: add `"Consumer Lending"`, `"Car Finance"`, `"B2C Fintech"` categories
- Add structured lending detection: documents with securitization/loan book language should default to `"Financial Services / Lending"` not `"Real estate structured investment"`

**Deals affected:** Carmoola  

---

## P5-005 — MEDIUM: Future projection surfaced as current revenue

**Priority:** MEDIUM  
**Scope:** Structured summary revenue selector; FAG accepted/rejected logic  

**Finding:** DealDecision shows `revenue = {amount: 3337000, period: "2026", raw: "$3.3MM"}`. The `period: "2026"` field explicitly marks this as a future projection. Confidence=0.65 passes the filter.

**Impact:** `$3.3MM` appears in `tiers.deep` as a revenue figure. Users reading this as current revenue are misled.

**Fix direction (FAG layer):**
```typescript
// In FAG accepted/rejected logic:
if (candidate.period && /^\d{4}$/.test(candidate.period) && Number(candidate.period) > new Date().getFullYear()) {
  reject(candidate, 'revenue.future_projection_period');
}
```
**Fix direction (structured summary):**
- Add `is_projection: boolean` flag to revenue output when period > current year
- Expose in UI as "Projected: $3.3MM (2026)" vs "Revenue: $3.3MM"

**Deals affected:** DealDecision (2026 projection), also 3ICE, Probility (partial)  

---

## P5-006 — MEDIUM: Revenue confidence minimum floor

**Priority:** MEDIUM  
**Scope:** Structured summary revenue selector  

**Finding:** 3ICE shows `revenue = {raw: "$40K", confidence: 0.45}`. The value likely comes from a deck narrative mention unrelated to the structured financial table. 0.45 confidence is near the confidence=0 cutoff but comfortably above it.

**Current threshold:** confidence = 0 → blocked. Any value > 0 → allowed through.

**Fix direction:** Raise revenue and growth confidence minimum to 0.5 (or 0.4 with a review). Any extraction below this threshold should behave as if confidence=0 (blocked).

**Expected impact:** 3ICE revenue ($40K at 0.45) would be nulled. Several partial revenue signals across other deals (~0.45–0.50 range) may also be cleaned.

**Risk:** May block legitimate low-confidence signals. Recommend 0.5 floor for revenue only; preserve 0.0 threshold for customers (rarer and often correctly at 0).

**Deals affected:** 3ICE (directly); possibly Qredible, Carmoola  

---

## P5-007 — MEDIUM: Growth showing forward projection value

**Priority:** MEDIUM  
**Scope:** Structured summary growth selector  

**Finding:** StackFactor shows `growth = {percent: null, year: 2027, raw: "Forecast: $9.8M (2027)"}` conf=0.58. This is a 2027 revenue forecast presented as a growth signal. The `year: 2027` flags it as future-dated but this doesn't trigger exclusion.

**Fix direction:** Same as P5-005 pattern — if `growth.year > current_year`, treat as projection and suppress or label explicitly.

**Deals affected:** StackFactor  

---

## P5-008 — MEDIUM: `product` and `market` null across majority of foundational deals

**Priority:** MEDIUM  
**Scope:** Worker DPU extraction; `apps/worker/src/`  

**Finding:** 8 of 10 foundational deals show `product=null` and/or `market=null` in structured_summary. These fields are used for hero tier, IAO, product summaries, and market summaries.

| Deal | product | market |
|------|---------|--------|
| Allurion | null | null |
| Carmoola | null | null |
| Cino | null | null |
| Qredible | null | null |
| Probility | partial | null |
| StackFactor | null | null |
| DealDecision | null | null |
| Albuquerque | null | null |
| Magarian | null | null (fund) |
| 3ICE | null | null |

**Impact:** Without product/market, the report relies on BM for identity (hero tier), which is fragile. When BM is nulled by guards, the deal has no identity text.

**Fix direction:** Improve DPU product and market extraction coverage. Ensure `product_summary_v1` extraction fires on standard product/solution slide types. Priority: fix segment assignment for product and market slide detection.

---

## P5-009 — MEDIUM: `funding_stage = pre_seed/IDEA` for operational companies

**Priority:** MEDIUM  
**Scope:** DIO classification; Worker DPU  

**Finding (from prior 5-deal audit):** Allurion (de-SPAC, $64M revenue FY22), Carmoola (Series B, 18K+ customers), Cino (Series A), Qredible ($40K+ MRR, 7 clients) all show `funding_stage = pre_seed/IDEA`. These are clearly wrong.

**Root cause:** The funding stage classifier defaults to pre_seed when insufficient funding stage evidence is extracted. Real-world stage signals (investor names, round labels on pitch deck, company revenue size) are not cross-referenced.

**Fix direction:**
- Cross-check funded_stage with revenue size: if revenue > $1M → stage ≥ seed
- Use raise label when available: explicit `"Series A"`, `"Series B"` in deck → override pre_seed
- Fix archetype classification chain: `deck_archetype` drives `funding_stage` in some paths; fix archetype first

---

## P5-010 — LOW: `deck_archetype = consumer_product` for B2B SaaS deals

**Priority:** LOW  
**Scope:** DIO classification  

**Finding:** Qredible (B2B enterprise compliance SaaS) and Probility (B2B/B2C sports analytics AI) show `deck_archetype = "consumer_product"`. This flows downstream to affect `funding_stage` and narrative generation.

**Fix direction:** Add B2B SaaS archetype signals — if deck mentions `enterprise`, `API`, `compliance`, `platform`, `workflow` and non-consumer audience → `deck_archetype = "b2b_saas"` or `"enterprise_platform"`.

---

## P5-011 — LOW: `team_signal.roles_present` all-false despite named team visible on deck

**Priority:** LOW  
**Scope:** Worker DPU extraction  

**Finding (from prior audit):** Carmoola, Cino, Qredible, Probility all have named CEO/co-founder with full history on team slides, yet `team_signal.roles_present` = all false, `founder_count = 0`.

**Impact:** Affects team quality scoring — deals look founder-less when they have strong founding teams.

**Fix direction:** Improve team slide OCR + structured extraction. Add role-detection patterns for CEO, Co-founder, CTO tier roles. The DPU team extraction must be firing on the wrong segment or not reaching these pages.

---

## P5-012 — LOW: IAO summary template accuracy

**Priority:** LOW  
**Scope:** `packages/core/src/reports/investment-analysis-overview-v2.ts`  

**Finding:** Magarian Fund IAO summary says "identified revenue and growth signals" when `revenue=null` and `growth=null`. Template output is inaccurate for fund/SPV deals with no revenue metrics.

**Fix direction:** Add a post-summary accuracy check: if `revenue=null AND growth=null`, remove "revenue and growth signals" from template output or replace with "limited performance data available."

---

## P5-013 — LOW: BM "Licensing" insufficient precision for multi-stream model

**Priority:** LOW  
**Scope:** Worker DPU extraction / BM classifier  

**Finding:** 3ICE has revenue from tickets, merchandise, sponsorships, food & beverage, parking, media rights, PPV, and sports data. BM=`Licensing` covers only media rights. The classifier picked the largest projected revenue line (media rights = $1.9M/yr by 2029) and labeled the entire business model from it.

**Fix direction:** For multi-stream event/media businesses, use `"Media / Events"` or `"Direct-to-Consumer Live Events"` category rather than reducing to the largest future revenue line.

---

## Cross-Cutting Systemic Issues

### 1. Guard Coverage Gap: Non-startup deal types
The current guard system is designed for startup pitch decks with `raise` + `business_model` fields. Deal archetypes like:
- CRE projects (Albuquerque)
- Hedge funds (Magarian)
- Sports/media leagues (3ICE)
...have different information structures. Guards calibrated for Wholesale/Retail → tech mismatch don't apply. A deal-type-aware guard routing layer would improve coverage.

### 2. Cache Staleness — Systemic Risk
Any deal compiled before `REPORT_COMPILER_VERSION` was introduced returns cv=None. These deals are missing ALL guard protections from v22–v26. This is a runtime state problem independent of the code being correct. Operational fix: force-recompile trigger for cv=null deals.

### 3. Extraction Coverage: product/market fields
The near-universal absence of `product` and `market` from structured_summary means the report schema's "identity" fields are consistently missing. Hero tier construction relies on BM as the primary fallback — when BM is guarded/nulled, deals have no identity in the UI. Upstream investment in product+market extraction would make the guard system more robust (guards could null BM with confidence because product provides the fallback).

---

## Priority Order for Implementation

```
CRITICAL  P5-001  Cache invalidation fix — all cv=null deals unprotected
HIGH      P5-002  CRE/real estate BM guard           (new FPG rule)
HIGH      P5-003  Hero tier raw OCR shard sanitization (report compiler)
HIGH      P5-004  Carmoola BM wrong-industry (DPU)
MEDIUM    P5-005  Future projection revenue guard     (FAG / selector)
MEDIUM    P5-006  Revenue confidence floor            (selector threshold)
MEDIUM    P5-007  Growth projection label/block       (selector)
MEDIUM    P5-008  product/market DPU extraction       (worker)
MEDIUM    P5-009  funding_stage classifier            (DIO)
LOW       P5-010  deck_archetype B2B SaaS             (DIO)
LOW       P5-011  team_signal extraction              (DPU)
LOW       P5-012  IAO template accuracy               (core)
LOW       P5-013  BM precision (multi-stream)         (DPU)
```
