# Third-Audit Benchmark Report — 3ICE & WebMax
**Run date:** 2026-04-06  
**Auditor:** GitHub Copilot (Claude Sonnet 4.6)  
**Validator:** `evaluation/deal_understanding/scripts/validate_deal_understanding.py`  
**Source decks:** `docs/reference-deal-docs/PDF-pptx-deals/third3-audit/`

---

## Phase 1 — Wiring Audit

### Issues Found and Fixed

| Item | Status | Fix Applied |
|------|--------|-------------|
| `3ICE` not in `REFERENCE_DEALS` | ❌ Missing | Added entry with correct DB deal_id |
| `WebMax` commented out in `REFERENCE_DEALS` | ❌ Commented | Uncommented and moved to third3-audit section |
| `3ICE.json` had `deal_id: null` | ❌ Null | Updated to `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e` |
| `WebMax.json` had `deal_id: null` | ❌ Null | Updated to `23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4` |
| All check_types are validator-supported | ✅ OK | `contains_any`, `must_not_contain`, `not_empty`, `term_alignment` — all valid |
| Source decks present in `third3-audit/` | ✅ OK | Both PDFs confirmed present |

**Note on deal IDs:** The fixture meta JSON IDs (`pd-3ice.meta.json`, `pd-webmax-investor-deck-2026-v2-edits.meta.json`) do NOT match the live DB IDs. The DB IDs are authoritative and were used:
- 3ICE DB: `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e`  
- WebMax DB: `23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4` (stored as "Webmaxco" in deals table)

---

## Phase 2 — Validator Results

### Summary Table

| Deal | Pass | Fail | Skip | Score | Status |
|------|------|------|------|-------|--------|
| 3ICE | 17 | 14 | 0 | **46%** | 🔴 14 failing |
| WebMax | 23 | 8 | 0 | **70%** (74% by validator) | 🔴 8 failing |
| **Combined** | **40** | **22** | **0** | — | |

---

## Phase 3 — Failure Analysis by Deal

---

### 3ICE — 17/31 (46%)

**Scores by dimension:**
- Fidelity: 8% (1/12)
- Completeness: 100% (fields non-empty but contain OCR noise)
- Investor Usefulness: 80% (4/5 investor notes surfaced)

#### Failing Checks

| Check ID | Label | Field | Expected | Actual (summarized) | Root Cause Class |
|----------|-------|-------|----------|---------------------|-----------------|
| L1-3ICE-001 | correctly identifies 3ICE as hockey league and media business | `what_company_does` | "three-on-three" / "hockey league" / "sports media" | Raw OCR garbage from visual slide (logos, layout text) | **#3 OCR/image-text** |
| L1-3ICE-002 | captures the product as overtime-style hockey entertainment | `solution` | "overtime" / "faster" / "three-on-three" | Same OCR garbage (same source field: `product_solution`) | **#3 OCR/image-text** |
| L1-3ICE-003 | frames business model as media rights and event monetization | `business_model` | "media rights" / "sponsorships" | "Unknown" — archetype = unknown, DIO business_model = null | **#4 Archetype + #2 Extraction** |
| L1-3ICE-004 | revenue model is not SaaS revenue | `revenue_model` | "media rights" / "sponsorship" / "ticket" | "Unknown" — same as above | **#4 Archetype + #2 Extraction** |
| L1-3ICE-005 | go to market includes broadcasts, events, and content distribution | `go_to_market` | "broadcast" / "markets" / "content" | Raw OCR hockey bio text (Hall of Famers DPU traction segment) | **#3 OCR/image-text** |
| L1-3ICE-007 | traction references real commercial signals | `traction_summary` | "two seasons" / "cbs" / "tsn" / "20m" | "Pilots / partnerships mentioned" — generic template output | **#2 Extraction issue** |
| L1-3ICE-008 | why now reflects expansion and media-rights timing | `why_now` | "phase 2" / "phase 3" / "media rights" | OCR noise (Hall of Fame bios from DPU traction segment) | **#3 OCR/image-text** |
| L1-3ICE-009 | market positioning reflects differentiated hockey entertainment | `market_positioning` | "differentiated" / "faster" / "three-on-three" | LLM generic template ("$10M equity raise, partnerships and pilots") | **#5 Wrong narrative source** |
| L1-3ICE-010 | competitive differentiation includes format and media packaging | `competitive_differentiation` | "unique format" / "hall of fame" / "broadcast" | Same OCR garbage (product_solution fallback) | **#3 OCR/image-text** |
| L1-3ICE-011 | risks mention media-rights and expansion execution | `risks` | "media rights" / "expansion" / "profitability" | Generic template ("Competition...missing evidence for key metrics") | **#2 Extraction issue** |
| L1-3ICE-012 | problem recognizes need for exciting hockey format | `problem` | "slower" / "fan entertainment" / "traditional hockey" | Generic summary ("$10M equity raise with notable traction signals") | **#6 Field contract mismatch** |
| L2-3ICE-013 | business model and revenue model share sports media terms | consistency | "media"/"rights"/"sponsorship" in both | Both "Unknown" — no shared terms | **#4 Archetype + #2 Extraction** |
| L2-3ICE-014 | what_company_does and solution aligned on hockey | consistency | "hockey"/"three-on-three" in both | Both OCR garbage — no shared hockey terms | **#3 OCR/image-text** |
| L3-3ICE-INVESTOR-002 | investor note #2 surfaced (separate extensions from core ops) | investor_relevance_notes | 3+ of 5 terms in output | 0/5 terms found — note text itself doesn't appear in output | **#1 Benchmark wiring** (note is advisory meta-text, not placed in any output field) |

**Note on L3-3ICE-INVESTOR-002:** The investor note says "A strong understanding should separate current league operations from future brand extensions..." The validator looks for those words in the understanding output, not in the notes. This is a false-negative — the note text is written as an instruction to the reader, not as an assertion about the output. This is a **benchmark authoring issue** (the note doesn't contain terms that would appear in the understanding fields).

#### Root Cause Summary — 3ICE

| # | Class | Checks Affected | Priority |
|---|-------|----------------|----------|
| #3 | OCR/image-text issue | 5 checks (what_company_does, solution, go_to_market, competitive_differentiation, L2-014) | P1 — Blocking |
| #2 | Extraction issue | 3 checks (traction_summary, risks, and archetype upstream) | P1 — Blocking |
| #4 | Archetype misclassification | 3 checks (business_model=Unknown, revenue_model=Unknown, L2-013) | P1 — Blocking |
| #5 | Wrong narrative source | 1 check (market_positioning serving generic LLM text) | P2 |
| #6 | Field contract mismatch | 1 check (problem serving deal_summary not 3ICE problem framing) | P2 |
| #1 | Benchmark authoring | 1 check (L3-investor-note-002 written as instruction, not assertion) | P3 |

---

### WebMax — 23/31 (70-74%)

**Scores by dimension:**
- Fidelity: 42% (5/12)
- Completeness: 100% (fields non-empty but with wrong content)
- Investor Usefulness: 100% (5/5 investor notes surfaced via keyword matching)

#### Failing Checks

| Check ID | Label | Field | Expected | Actual (summarized) | Root Cause Class |
|----------|-------|-------|----------|---------------------|-----------------|
| L1-WEBMAX-002 | core solution is predictive scoring and automation | `solution` | "predictive" / "automation" / "workflow" | OCR noise from icon-heavy slide ("platform. efficiency. for optimal steps...") | **#3 OCR/image-text** |
| L1-WEBMAX-004 | revenue model reflects software monetization | `revenue_model` | "saas" / "licensing" / "subscriptions" | "Wholesale/Retail" — from `reportSS.business_model.value` which is wrong from report layer | **#2 Extraction + #5 Wrong source** |
| L1-WEBMAX-007 | traction references conversion and prediction metrics | `traction_summary` | "50%" / "demo-to-close" / "20-300%" | "Growth mentioned; Customers mentioned" — generic template from DIO traction_signals | **#2 Extraction issue** |
| L1-WEBMAX-008 was PASS | (why_now passes because DPU traction OCR noise contains "predictive", "conversion", "crm") | — | — | — | — |
| L1-WEBMAX-009 | market positioning includes CRM-agnostic predictive angle | `market_positioning` | "crm-agnostic" / "predictive scoring" / "mortgage" | Generic report template text ("$2M raise, wholesale/retail, critical ICP info missing") | **#5 Wrong narrative source** |
| L1-WEBMAX-010 | competitive differentiation includes data and outcome learning | `competitive_differentiation` | "crm-agnostic" / "funded-loan outcomes" / "predictive scoring" | OCR noise ("platform. efficiency. for optimal steps...") — same as product_solution | **#3 OCR/image-text** |
| L1-WEBMAX-011 | risks mention partner dependence or proof of uplift | `risks` | "reseller" / "partner" / "integration" / "performance" | "Missing evidence for key metrics such as ICP, CAC, LTV..." — generic template from LLM report | **#2 Extraction issue** |
| L1-WEBMAX-012 | problem identifies fragmented mortgage workflows | `problem` | "fragmented" / "missed opportunities" / "engagement" | Generic deal_summary one_liner ("The deal involves a $2M raise for a wholesale/retail business model") | **#6 Field contract mismatch** |
| L2-WEBMAX-013 | business model and revenue model share SaaS terms | consistency | "saas"/"platform" in both | business_model="saas", revenue_model="Wholesale/Retail" — no shared terms | **#2 Extraction + #5 Wrong source** |

#### Root Cause Summary — WebMax

| # | Class | Checks Affected | Failing Field | Priority |
|---|-------|----------------|---------------|----------|
| #3 | OCR/image-text | 2 checks (solution, competitive_differentiation) | `product_solution` in DIO contains OCR noise | P1 — Blocking |
| #2/#5 | Extraction + wrong source | 3 checks (revenue_model, traction_summary, L2-013) | `reportSS.business_model.value="Wholesale/Retail"` leaks into revenue_model; traction_signals too generic | P1 — Blocking |
| #5 | Wrong narrative source | 1 check (market_positioning serving LLM report template) | `market_positioning` falls back to `dealSummarySummary.paragraphs[0]` which is generic | P2 |
| #6 | Field contract mismatch | 1 check (problem field) | `problem` sources from `dealSummarySummary.one_liner` — no problem framing in DIO | P2 |

---

## Phase 4 — Deal-Specific Analysis

---

### 3ICE — Sports Media / Live Events

**Does the system correctly identify 3ICE as a sports media / live-events / league business?**  
❌ No. The system surfaces raw OCR garbage for `what_company_does` and `solution`. The archetype is "unknown". The deal_type is "startup_raise" (wrong — should be sports/media). None of the hockey-specific terms (three-on-three, media rights, CBS, TSN) reach the output fields.

**Does it confuse projections with current revenue?**  
⚠️ Partial risk. The `target_customer` field contains the full OCR dump of the financial projection tables (3ICE Kids, World Series, brand extension tables with 2025-2031 projected figures). The completeness check passes because the field is non-empty, but the content is completely wrong. The hallucination checks pass (no invented "2029 revenue" statements) because the output doesn't contain those synthetic claims — but the projected tables ARE surfaced in raw form.

**Does it incorrectly treat future extensions as current business?**  
⚠️ The `target_customer` field contains verbatim OCR of the brand-extension financial tables (Kids World Series, 3ICE Canada, Women's bracket), which creates projection leakage risk. However, it won't be interpreted as current business if downstream consumers read the raw OCR for what it is.

**Does it misclassify as SaaS or generic software?**  
✅ No. business_model = "Unknown" and the hallucination check L4-3ICE-015 passes because "saas" is not present.

---

### WebMax — Mortgage SaaS / Workflow Automation

**Is OCR strong enough to capture the deck correctly?**  
❌ Partially. The deck uses heavy visual slides with icons, infographics, and layered text. The DPU `product` segment OCR produces noise. The DPU `traction` segment OCR contains readable terms ("CRM-agnostic", "20-300% lift", "funded-loan outcomes") but mixed with layout noise — enough for `why_now` to pass but not enough for `solution`, `traction_summary`, or `competitive_differentiation`.

**Does the system correctly identify WebMax as mortgage software/SaaS/workflow?**  
✅ Mostly yes for identification (`what_company_does` passes, `business_model`="saas" passes). The archetype extraction is correct (saas). The core identity is preserved.

**Does it confuse AI/predictive scoring features with broader fintech/payments positioning?**  
✅ No hallucination here. The hallucination check L4-WEBMAX-018 passes — no "consumer fintech", "payments network", or "card interchange" terms surfaced.

**Does it invent revenue not shown in the deck?**  
✅ No. L4-WEBMAX-016 passes. But `revenue_model` = "Wholesale/Retail" is wrong (surfaced from `reportSS.business_model.value`). This is a wrong-label issue from the report layer, not hallucination.

**Is GTM / reseller distribution captured correctly?**  
⚠️ Partially. `go_to_market` passes (returns OCR text that mentions "CRM" which satisfies the term check). But the content is OCR noise, not a coherent GTM description. The check passes on a false positive — "crm" appears in the OCR noise of the traction slide.

---

## Phase 5 — Prioritized Fix Lists

---

### Fix List — 3ICE

| Priority | Fix | Root Cause | Layer to Fix |
|----------|-----|------------|--------------|
| P1 | Re-extract or re-process the 3ICE PDF so DPU segments produce clean text | OCR/visual extraction | Worker → DPU extraction |
| P1 | Fix `product_solution` extraction — currently serving raw OCR from a visual-heavy title/overview slide | OCR leak into DIO | Worker → `deal_overview_v2.product_solution` |
| P1 | Fix archetype classification — currently "unknown"; should be "sports media" or "live events" or similar | Archetype extraction | Worker → `business_archetype_v1` |
| P1 | Fix `deal_type` — currently "startup_raise"; should reflect sports/media or events | Extraction | Worker → `deal_overview_v2.deal_type` |
| P1 | Fix `traction_signals` — "Pilots / partnerships mentioned" is a generic template; CBS, TSN, 2 seasons, 20M impressions are all in the deck | Extraction | Worker → `deal_overview_v2.traction_signals` |
| P2 | Fix `market_icp` extraction — currently null; deck clearly identifies hockey fans, sponsors, broadcasters, bettors as audience | Extraction | Worker → `deal_overview_v2.market_icp` |
| P2 | Fix `go_to_market` extraction — currently null | Extraction | Worker → `deal_overview_v2.go_to_market` |
| P2 | Fix `business_model` in DIO — currently null/Unknown; should be media rights / sponsorships / events | Extraction | Worker → `deal_overview_v2.business_model` |
| P2 | Fix `deal_summary_v2.one_liner` — generic template; should reflect 3ICE hockey-league identity | Summary quality | Worker → `deal_summary_v2` |
| P3 | Rewrite L3-investor-note-002 in ground truth so it uses terms that appear in output fields | Benchmark authoring | `evaluation/deal_understanding/ground_truth/3ICE.json` |

---

### Fix List — WebMax

| Priority | Fix | Root Cause | Layer to Fix |
|----------|-----|------------|--------------|
| P1 | Fix `revenue_model` — currently "Wholesale/Retail" from `reportSS.business_model.value`; change fallback priority so archetype ("saas") or DIO `business_model` takes precedence over report layer business_model for revenue_model field | Wrong source selection | `apps/api/src/routes/understanding.ts` → `revenue_model` field fallbacks |
| P1 | Re-extract or re-segment the WebMax PDF DPU so visual/icon-heavy slides produce cleaner text in `product_solution` | OCR/visual extraction | Worker → DPU extraction |
| P1 | Fix `traction_signals` — "Growth mentioned; Customers mentioned" is generic; "50% demo-to-close", "20-300% lift", "partner-driven pipeline" are extractable from the deck | Extraction | Worker → `deal_overview_v2.traction_signals` |
| P2 | Fix `target_customer` — currently surfaces XLSX financial table dump (dpuFinancialsText); need `market_icp` or DIO `market_icp` to be populated or guard against XLSX table contamination | Wrong DPU fallback | Worker → `market_icp`; or `understanding.ts` guard on tabular XLSX content |
| P2 | Populate `market_icp` in DIO — currently null; deck clearly identifies mortgage lenders, loan officers, realtors as the buyer | Extraction | Worker → `deal_overview_v2.market_icp` |
| P2 | Fix `go_to_market` in DIO — currently null; deck has reseller partnership model with Shape, Relcu | Extraction | Worker → `deal_overview_v2.go_to_market` |
| P2 | Fix `risks` — generic template text; deck has identifiable risks (partner dependency, CRM integration, proving uplift at scale) | Extraction | Worker → `deal_overview_v2.key_risks_detected` / `deal_summary_v2.risks` |
| P2 | Fix `problem` field — currently generic deal_summary one_liner; needs a problem framing about fragmented mortgage workflows | Field sourcing | Worker → `deal_summary_v2` or `deal_overview_v2` problem-specific field |
| P3 | Investigate `competitive_differentiation` field — falls back to `product_solution` OCR garbage when market_icp is null | Understanding route fallback | `understanding.ts` → defensive guard on product_solution OCR noise |

---

## Regression Gate Recommendation

| Deal | Current Score | Ready for Regression Gate? |
|------|--------------|---------------------------|
| **3ICE** | 46% (17/31) | ❌ **NOT READY** — 13 substantive failures driven by complete OCR extraction failure and archetype misclassification. This is a data quality problem upstream of the understanding route. Keep in isolated audit mode until DPU re-extraction and archetype fix are applied. |
| **WebMax** | 70-74% (23/31) | ⚠️ **CONDITIONAL** — 8 failures, but 5 are data quality / extraction issues. 1 failure is a `revenue_model` field sourcing bug that can be fixed in `understanding.ts` immediately without re-extraction. The archetype (saas) is correct, the core identity is preserved. Can be added to the gate once the `revenue_model` bug is fixed AND either (a) DPU is re-extracted, or (b) ground truth expectations are documented as "known-extraction-limit" with a blocking/non-blocking flag. |

---

## Files Changed (Wiring Fixes Only)

- `evaluation/deal_understanding/scripts/validate_deal_understanding.py` — Added `3ICE` entry, uncommented `WebMax`, moved to third3-audit section
- `evaluation/deal_understanding/ground_truth/3ICE.json` — Updated `deal_id` from null → `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e`
- `evaluation/deal_understanding/ground_truth/WebMax.json` — Updated `deal_id` from null → `23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4`
