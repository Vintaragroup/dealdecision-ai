# Regression Suite Audit Report
**Date:** 2026-04-08  
**Scope:** Reference deal discovery, ground truth validation, and 7-archetype regression suite recommendation  
**Related fix report:** `artifacts/allurion_pipeline_fix_report_20260408.md`

---

## Executive Summary

- **4 deals** have full ground truth validation specs (`Deal Decision.json`, `Qredible.json`, `StackFactor.json`, `WebMax.json`)
- **All 20 validation checks** across those 4 deals pass (Layer 1 + Layer 2 + Layer 3)
- **2 active misclassification bugs** discovered in deals with reference docs but no GT
- **7-archetype regression suite** mapped — 3 slots ready now, 3 need GT creation, 1 needs investigation

---

## Part 1 — Directory Inventory

### `docs/reference-deal-docs`

| Folder | Deals Covered | Doc Count | Types |
|--------|--------------|-----------|-------|
| `DealdecisionAI/` | DealDecision AI | 3 | 2×XLSX, 1×PDF |
| `PDF-pptx-deals/Alluron-audit/` | Allurion | 7 | 8-K, deck, 5×EX PDFs |
| `PDF-pptx-deals/first4-audit/` | TOXYScreen, Palm Capital Raise, Probility, Verse | 4 | 3×PDF, 1×PPTX |
| `PDF-pptx-deals/four4-audit/` | Black-Horse CIM, Complyant, Carmoola | 3 | 3×PDF |
| `PDF-pptx-deals/second2-audit/` | Cino Series A, Magarian Fund | 2 | 2×PDF |
| `PDF-pptx-deals/third3-audit/` | 3ICE, WebMax | 2 | 2×PDF |
| `PDF-pptx-deals/vintara-audit/` | Vintara Group | 6 | PDF + DOCX |
| `PDF-pptx-deals/multi-doc-audit/` | DealDecision, StackFactor, WebMax | 9 | 3×XLSX, 2×PDF, 1×PPTX |
| `Qredible/` | Qredible | 1 | PDF |
| `Stackfactor/` | StackFactor | 4 | 2×XLSX, 1×PDF, 1×PPTX |
| `WebMax/` | WebMax | 2 | 1×XLSX, 1×PDF |
| Standalone | 3ICE, Albuquerque, Cleveland, unknown 2018 | 4 | 4×PDF |

### `evaluation/ground_truth`

| File | Deal ID | DB Name | GT Schema | Validation Checks | Synthetic |
|------|---------|---------|-----------|-------------------|-----------|
| `3ICE.json` | `61ef36dd` | 3ICE | v1 | 0 (slots only) | No |
| `Cinco.json` | `0fcec035` | Cino | v1 | 0 (slots only) | No |
| `Deal Decision.json` | `517be946` | DealDecision | v1 | 5 total (2+1+2) | No |
| `Palm.json` | `c4f10092` | Palm | v1 | 0 (slots only) | No |
| `Qredible.json` | `b21b894e` | Qredible | v1 | 6 total (2+3+1) | No |
| `StackFactor.json` | `adb2a1cf` | StackFactor | v1 | 8 total (2+3+3) | No |
| `WebMax.json` | `23b2fa42` | Webmaxco | v1 | 5 total (2+1+2) | No |
| `SyntheticActuals.json` | synthetic | — | v1 | PHASE-4-COMPLETE | Yes |
| `SyntheticKPI.json` | synthetic | — | v1 | PLACEHOLDER | Yes |
| `SyntheticQuarterly.json` | synthetic | — | v1 | PLACEHOLDER | Yes |

---

## Part 2 — System Deal Mapping

All active DB deals (22 total, `deleted_at IS NULL`):

| DB Name | DB ID | Stage | Doc Count | Classified As | Reference Docs | GT File |
|---------|-------|-------|-----------|---------------|----------------|---------|
| Allurion Multi-Doc Audit | `a85b0ac0` | intake | 8 | `de_spac` | `Alluron-audit/` | ❌ none |
| Vintara Group | `e7a37e23` | under_review | 7 | `startup_raise` | `vintara-audit/` | ❌ none |
| Magarian Fund | `0e8fa8ae` | intake | 0 | (not run) | `second2-audit/PD - Magarian Fund.pdf` | ❌ none |
| Stackon Factor | `2b9b0645` | in_diligence | 3 | `fund_spv` | none | ❌ none |
| Vermont | `f2b08028` | under_review | 2 | `startup_raise` | none | ❌ none |
| Albuquerque | `267c4979` | intake | 1 | `fund_spv` ⚠️ | `Albuquerque, NM - Nobis Pref. Equity Opportunity.pdf` | ❌ none |
| Complyant | `cc1ddde7` | intake | 1 | `startup_raise` | `four4-audit/ComplYant...pdf` | ❌ none |
| StackOP | `9796a792` | intake | 4 | `startup_raise` | none | ❌ none |
| StackFactor | `adb2a1cf` | in_diligence | 5 | `startup_raise` ✅ | `Stackfactor/`, `multi-doc-audit/Stackfactor-multiDoc/` | ✅ full |
| Probility | `42be8b30` | under_review | 3 | `startup_raise` | `first4-audit/PD - Probility AI.pdf` | ❌ none |
| Carmoola | `da96b5a9` | intake | 1 | `startup_raise` | `four4-audit/PD - Carmoola...pdf` | ❌ none |
| DealDecision | `517be946` | in_diligence | 3 | `startup_raise` ✅ | `DealdecisionAI/`, `multi-doc-audit/DealDecision-multiDoc/` | ✅ full |
| Palm3 | `5c8c7d6e` | intake | 1 | `fund_spv` | none | ❌ none |
| 3ICE | `61ef36dd` | intake | 1 | `fund_spv` ⚠️ | `PDF-pptx-deals/PD - 3ICE.pdf` | ⚠️ slots only |
| Palm | `c4f10092` | intake | 1 | `fund_spv` | `first4-audit/PD - Palm Capital Raise.pdf` | ⚠️ slots only |
| Verse | `bcd59d33` | intake | 1 | `startup_raise` | `first4-audit/PD - Verse.pdf` | ❌ none |
| Bear | `62c1eb0e` | intake | 1 | `fund_spv` | none | ❌ none |
| TOXYScreen | `05042123` | intake | 1 | `fund_spv` ⚠️ | `first4-audit/PD - OFT _ TOXYCREEN.pptx` | ❌ none |
| Cino | `0fcec035` | intake | 1 | `startup_raise` ✅ | `second2-audit/PD - Cino Deck 2025 Series A.pdf` | ⚠️ slots only |
| Webmaxco | `23b2fa42` | intake | 2 | `startup_raise` ✅ | `WebMax/`, `multi-doc-audit/WebMax-multiDoc/` | ✅ full |
| Qredible | `b21b894e` | under_review | 1 | `startup_raise` ✅ | `Qredible/` | ✅ full |
| test PDF Extraction | `82f63118` | intake | 1 | `fund_spv` | none | ❌ none |

---

## Part 3 — Phase 5 Evaluation Results (Full Validation Suite)

### Layer 1: Extraction Checks (`financial_facts_v1`)

| Deal | Metric | GT Expected | Tolerance | Extracted Value | Source | Result |
|------|--------|-------------|-----------|-----------------|--------|--------|
| DealDecision | revenue | 3,337,000 | ±10% | 3,337,000 | xlsx/2026 | ✅ PASS |
| DealDecision | burn_rate | 251,536 | ±15% | 251,536 | structured_derived/2026 | ✅ PASS |
| Qredible | arr | 1,582,164 | ±20% | 1,582,164 | deck/current | ✅ PASS |
| Qredible | mrr | 131,847 | ±20% | 131,847 | deck/current | ✅ PASS |
| StackFactor | revenue | 23,000 | ±15% | 23,000 | kpi_tile/current | ✅ PASS |
| StackFactor | cash | 44,000 | ±15% | 44,000 | kpi_tile/current | ✅ PASS |
| WebMax | revenue | 8,000 | ±15% | 8,000 | deck/current | ✅ PASS |
| WebMax | burn_rate | 32,000 | ±15% | 32,000 | structured_derived/September | ✅ PASS |

**8/8 PASS**

### Layer 2: Noise Checks (`financial_facts_v1` absence assertions)

| Deal | Check Label | SQL Filter | Expected Count | Actual Count | Result |
|------|-------------|------------|----------------|--------------|--------|
| DealDecision | deck burn_rate ~$250 | `burn_rate BETWEEN 200 AND 300 AND source_kind='deck'` | 0 | 0 | ✅ PASS |
| Qredible | $349 pricing as burn_rate | `burn_rate BETWEEN 340 AND 360` | 0 | 0 | ✅ PASS |
| Qredible | $381K projected MRR as revenue | `revenue BETWEEN 370000 AND 390000` | 0 | 0 | ✅ PASS |
| Qredible | garbled ARR ~$5120 | `arr BETWEEN 4000 AND 6000` | 0 | 0 | ✅ PASS |
| StackFactor | col_X period label noise | `revenue AND period_label ~ '^col_[A-Za-z]+$'` | 0 | 0 | ✅ PASS |
| StackFactor | $000 denomination noise | `revenue AND period_label LIKE '000%'` | 0 | 0 | ✅ PASS |
| StackFactor | cap table revenue facts | `revenue AND sheet_name ILIKE '%cap%table%'` | 0 | 0 | ✅ PASS |
| WebMax | $0 revenue for September | `revenue = 0 AND source_kind='xlsx' AND period_label ILIKE '%september%'` | 0 | 0 | ✅ PASS |

**8/8 PASS**

### Layer 3: Report Checks (`ingestion_reports.summary`)

| Deal | Path | GT Expected | Actual | Result |
|------|------|-------------|--------|--------|
| DealDecision | `financial_breakdown_v1.current_state.revenue.value` | 3,337,000 ±10% | 3,337,000 | ✅ PASS |
| DealDecision | `financial_breakdown_v1.current_state.burn_rate.source_kind` | not 'deck' | 'structured_derived' | ✅ PASS |
| Qredible | `financial_breakdown_v1.current_state.burn_rate` | null | null (absent) | ✅ PASS |
| StackFactor | `financial_breakdown_v1.current_state.revenue` | 23,000 ±15% | 23,000 | ✅ PASS |
| StackFactor | `financial_breakdown_v1.current_state.burn_rate` | null | null (absent) | ✅ PASS |
| StackFactor | `financial_breakdown_v1.current_state.cash` | 44,000 ±15% | 44,000 | ✅ PASS |
| WebMax | `financial_breakdown_v1.current_state.revenue` | 8,000 ±15% | 8,000 | ✅ PASS |
| WebMax | `structured_summary.revenue.value.amount` | 8,000 ±15% | 8,000 | ✅ PASS |

**8/8 PASS**

### Overall: **24/24 checks pass**

---

## Part 4 — Known Issues (Passing Checks, Documented Anomalies)

These are not check failures but are surfaced in the candidate metadata and flagged here for tracking.

### QR-1: Qredible — Raise amount scoring as top revenue candidate
- **Path:** `structured_summary.revenue.candidates`  
- **Observation:** The promoted_fact from slide 18 ("Seeking $3M Equity Investment") scores `10.66` as a company_total revenue candidate — highest in the candidate list. Final value correctly falls back to MRR ($132K via `financial_fact_backfill`), but the raise amount is the top-scoring candidate.  
- **Risk:** If the backfill logic changes or the confidence gap narrows, this could flip the displayed revenue to $3M.  
- **Recommendation:** Add a raise-intent signal detector in the promoted_fact scoring path to penalize "seeking $X" language.

### WM-1: WebMax — XLSX description page noise in revenue candidates
- **Path:** `structured_summary.revenue.candidates`  
- **Observation:** Candidate shows `amount: 25` from a promoted_fact on the XLSX description page ("Revenue Summary sheet has 57 rows, 40 columns..."), marked `selected: true` in candidates but overridden by the final value ($8K). The description page is being treated as a revenue data page.  
- **Risk:** Low, as the backfill correctly selects $8K. But the `$25` promoted_fact shouldn't exist.  
- **Recommendation:** Add a segmenter rule to exclude XLSX OCR summary/description pages (containing "classified as revenue" in the note_snippet) from financial evidence routing.

### DD-1: DealDecision — Revenue is proforma-only, no actuals
- **Path:** `financial_breakdown_v1.current_state.revenue`  
- **Observation:** Revenue is correctly extracted at $3.337M but flagged `is_projected: true, is_provisional: true, selection_reason: "proforma_projection_fallback"`. This deal has no historical actuals — the XLSX is forward projections only.  
- **Risk:** No bug. Expected behavior for a proforma-only deck. Documented for GT completeness.  
- **Note:** This is the exact failure mode `SyntheticActuals` is designed to guard against (selecting future-year row over actual).

---

## Part 5 — 7-Archetype Regression Suite

Target coverage required:
1. de-SPAC / public company transaction  
2. Normal startup raise (equity/SAFE)  
3. Real estate offering  
4. Fund / SPV  
5. Healthcare / medtech operating company  
6. Multi-doc private company with financials  
7. Previously classified correctly (regression anchor)  

### Recommended Suite

| Slot | Archetype | Deal | DB ID | Current Classification | GT Status | Readiness |
|------|-----------|------|-------|----------------------|-----------|-----------|
| 1 | de-SPAC | **Allurion** | `a85b0ac0` | `de_spac` ✅ | ❌ GT needed | Create GT from pipeline output |
| 2 | Startup raise | **Qredible** | `b21b894e` | `startup_raise` ✅ | ✅ full, 6 checks | **Ready now** |
| 3 | Real estate | **Albuquerque** (Nobis) | `267c4979` | `fund_spv` ⚠️ BUG | ❌ GT needed | Investigate + create GT |
| 4 | Fund / SPV | **Magarian Fund** | `0e8fa8ae` | (not run — 0 docs) | ❌ GT needed | Attach PDF + ingest first |
| 5 | Healthcare / medtech | **Probility** | `42be8b30` | `startup_raise` | ❌ GT needed | Create GT (3 docs already ingested) |
| 6 | Multi-doc w/ financials | **StackFactor** | `adb2a1cf` | `startup_raise` ✅ | ✅ full, 8 checks | **Ready now** |
| 7 | Regression anchor | **DealDecision** | `517be946` | `startup_raise` ✅ | ✅ full, 5 checks | **Ready now** |

---

## Part 6 — Active Bugs Discovered

### BUG-1: Albuquerque classified as `fund_spv`
- **Deal:** Albuquerque (`267c4979`)  
- **Document:** `Albuquerque, NM - Nobis Pref. Equity Opportunity.pdf`  
- **Observed classification:** `fund_spv`  
- **Expected classification:** `real_estate_pref_equity` (or similar — real estate preferred equity offering, not a fund/SPV wrapping a fund vehicle)  
- **Impact:** System has no `real_estate` deal_type at all — these deals always fall through to `fund_spv` because of equity offering language. This is a classification coverage gap.  
- **Note:** Cleveland, OH Nobis deal is the same offer structure and presumably has the same bug.

### BUG-2: TOXYScreen classified as `fund_spv`
- **Deal:** TOXYScreen (`05042123`)  
- **Document:** `first4-audit/PD - OFT _ TOXYCREEN.pptx`  
- **Observed classification:** `fund_spv`  
- **Expected classification:** `startup_raise` (toxicology screening product company raising equity)  
- **Impact:** A biotech/medtech startup pitch deck is being mis-routed to `fund_spv`. Likely cause: no strong `startup_raise` signals in the deck, and the classifier defaults to `fund_spv` rather than falling through.

### BUG-3: 3ICE classified as `fund_spv`
- **Deal:** 3ICE (`61ef36dd`)  
- **Document:** `PDF-pptx-deals/PD - 3ICE.pdf`  
- **Observed classification:** `fund_spv`  
- **Expected classification:** `startup_raise` (3ICE is a professional hockey league startup seeking investment)  
- **Impact:** Same pattern as TOXYScreen. Partial GT exists (slots only) and confirms it's a startup, not a fund.

---

## Part 7 — GT Creation Backlog

Deals that have reference docs, stable ingestion, and are candidates for new GT JSON files:

| Priority | Deal | ID | Why Needed | Estimated Effort |
|----------|------|----|------------|-----------------|
| 🔴 HIGH | Allurion | `a85b0ac0` | Fills de_spac regression slot — the primary fix from this sprint | Pipeline output already verified; mostly transcription from DB |
| 🔴 HIGH | Albuquerque | `267c4979` | Documents BUG-1 real_estate misclassification | Need doc review first |
| 🟡 MED | Probility | `42be8b30` | Fills healthcare/medtech slot | 3 docs ingested, clean pipeline run needed |
| 🟡 MED | 3ICE | `61ef36dd` | Promote from slots-only to full checks | Partial GT exists, extend validation section |
| 🟡 MED | Magarian Fund | `0e8fa8ae` | Fills fund/SPV slot | PDF needs attaching first |
| 🟢 LOW | Cino | `0fcec035` | Promote from slots-only | Series A deck, clean classification |
| 🟢 LOW | Palm | `c4f10092` | Promote from slots-only or verify is fund_spv | Doc name says "Palm Capital Raise" — ambiguous |

---

## Part 8 — 7-Archetype Classification Coverage Gap

The system currently recognizes 3 `deal_type` values: `startup_raise`, `fund_spv`, `de_spac`.

Missing archetype coverage:

| Missing Type | Evidence | Consequence |
|-------------|----------|-------------|
| `real_estate` | Albuquerque + Cleveland Nobis pref equity PDFs | Correctly structured real estate deals classified as fund_spv |
| `healthcare_raise` / `medtech_raise` | TOXYScreen, Probility | No HCP-specific fundraise type; falls to fund_spv or startup_raise depending on signal strength |
| `revenue_based_financing` | None identified yet | Theoretical gap |

**Recommendation:** Before adding `real_estate` as a 4th `deal_type`, confirm the Albuquerque doc is a pref equity offering (not a fund) and that "Nobis Pref. Equity Opportunity" refers to a real asset deal, not a typical fund vehicled investment.

---

## Part 9 — Regression Suite Action Plan

### Immediate (ready now)
1. Run CI validation against DealDecision, Qredible, StackFactor, WebMax on every PR touching `financial_facts`, `promote-slide-facts`, `governed-llm-overlay`, or `report compiler`
2. Add Allurion GT JSON (`evaluation/ground_truth/Allurion.json`) — classification + zero SPAC doc evidence check

### Short-term (1–2 sessions)
3. Ingest Magarian Fund PDF → confirm fund_spv → create GT
4. Review Probility docs → create healthcare/medtech GT
5. Investigate Albuquerque doc → create real_estate GT + file BUG-1 fix

### Medium-term  
6. Extend 3ICE, Cino, Palm GT files with validation checks (promote from slots-only)
7. Consider adding `real_estate` deal_type if Albuquerque confirms coverage gap
8. Onboard SyntheticActuals as a live fixture test (per `ONBOARDING_CHECKLIST.md`)

---

## Appendix — DB Queries Used

```sql
-- All deals with doc count and classification
SELECT d.id, d.name, d.stage, d.created_at::date, COUNT(doc.id) as doc_count
FROM deals d
LEFT JOIN documents doc ON doc.deal_id = d.id
WHERE d.deleted_at IS NULL
GROUP BY d.id, d.name, d.stage, d.created_at
ORDER BY d.created_at DESC;

-- Deal classification from ingestion_reports
SELECT d.name, ir.summary->'metadata'->'score_explanation'->'context'->>'deal_type' as deal_type
FROM ingestion_reports ir JOIN deals d ON d.id = ir.deal_id
WHERE d.deleted_at IS NULL ORDER BY ir.created_at DESC;

-- Extraction facts by deal/metric
SELECT metric_key, value, source_kind, period_label, confidence
FROM financial_facts_v1
WHERE deal_id = '<uuid>' AND metric_key IN ('revenue','burn_rate','cash','arr','mrr')
ORDER BY confidence DESC;

-- Report layer check
SELECT ir.summary->'financial_breakdown_v1'->'current_state'->'revenue' as fb_revenue,
       ir.summary->'financial_breakdown_v1'->'current_state'->'burn_rate' as fb_burn,
       ir.summary->'financial_breakdown_v1'->'current_state'->'cash' as fb_cash
FROM ingestion_reports ir WHERE ir.deal_id = '<uuid>';
```
