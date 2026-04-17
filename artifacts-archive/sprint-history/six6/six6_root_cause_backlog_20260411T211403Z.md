# Six6 Audit — Root-Cause Backlog
**Generated:** 2026-04-11T21:14:03Z  
**Source batch:** Six6 (PAI · Climatic · Weavstra)  
**Compiler version:** 35  
**Taxonomy:** pipeline_extraction | llm_classification_error | llm_context_bleed | coverage_gap_policy | ocr_induced

Items ordered by severity (P0 = blocking/critical, P1 = high, P2 = medium).

---

## P0 — Critical / Blocking

### RC-S6-001 — Business model misclassified for OCR-only PDF (Weavstra)
- **Root cause:** `ocr_induced` → `llm_classification_error`
- **Evidence:** Weavstra = image-only PDF. OCR recovered garbled text with words like "orders," "customers," "delivery" triggering DTC Ecommerce classifier signals. Business model output: `DTC Ecommerce`. True model: Enterprise sovereign AI.
- **Impact:** Deal summary wrong; overall score inflated 47/100; wrong archetype drives wrong conviction scoring
- **Fix:** Add OCR noise guard in business model classifier. Require minimum text quality threshold before applying DTC pattern match. Flag `ocr_primary_source = true` and reduce classifier confidence weight for DTC e-commerce when OCR is the sole text source.
- **Deals affected:** Weavstra

### RC-S6-002 — Context bleed from adjacent batch deal (Climatic SPV → Weavstra)
- **Root cause:** `llm_context_bleed`
- **Evidence:** Weavstra deal summary states "DTC Ecommerce startup leveraging SPVs for non-dilutive funding." SPV concept belongs exclusively to Climatic. Weavstra deck contains no mention of SPVs.
- **Impact:** Fabricated concept in deal summary — misrepresents the Weavstra investment thesis to downstream users
- **Fix:** Enforce deal-scoped LLM context isolation. Each analyze_deal job must not carry context from prior deals in the same run/batch. Verify that prompt construction does not include cross-deal evidence. Also: SPV must not be inferred from debt terms alone.
- **Deals affected:** Weavstra (with root in Climatic → Weavstra context bleed)

### RC-S6-003 — Business model mislabeled for RaaS hardware company (PAI)
- **Root cause:** `llm_classification_error`
- **Evidence:** Deck (page 27–28) defines primary model as "Robot as a Service (RaaS)." Report output: `Licensing`. Root cause: classifier picked up "licensed NASA's Robonaut 2 Hand Patent Portfolio" (page 5, 29) and applied IP Licensing label instead of physical asset leasing (RaaS).
- **Impact:** Wrong business model propagates through deal summary, hero, scoring archetype, and market analysis
- **Fix:** Add RaaS as a first-class business model label distinct from IP Licensing. Differentiate: "licensed technology" (asset input/IP) vs. "Robot-as-a-Service" (primary revenue model). Priority order: primary revenue model > IP source.
- **Deals affected:** PAI

---

## P1 — High Priority

### RC-S6-004 — Stage classifier defaults to pre_seed/IDEA for all non-standard archetypes
- **Root cause:** `coverage_gap_policy`
- **Evidence:** All three deals labeled `pre_seed/IDEA` with confidence 0.6. PAI has a priced Seed Round with signed customer agreements; Climatic has $375M board-approved debt and $850M pipeline; Weavstra has signed LOIs and active enterprise enrollments.
- **Impact:** Misleads investor on deal maturity. Feeds incorrect stage into scoring subsystem.
- **Fix:** Policy expansion required for:
  1. Fund / IaaS / capital deployment vehicles — stage classification is not meaningful; output should be "N/A - fund model" or a fund-specific tier
  2. Revenue-imminent hardware/AI companies (signed agreements, no product revenue yet) — "pre-revenue" not "IDEA"
  3. OCR-only PDFs — require minimum signal confidence before committing to stage label
- **Deals affected:** PAI, Climatic, Weavstra

### RC-S6-005 — Prior funding not detected for PAI
- **Root cause:** `pipeline_extraction`
- **Evidence:** Deck (page 4): "Past: Pre-Seed Round (SAFEs)"; page 5: "Raised Pre-seed Round." Report: `capital_logic_v1.prior_funding.present = false`.
- **Impact:** Capital logic coherence misrepresented; investors informed of no prior raise history when prior round exists
- **Fix:** DPU extractor must recognize "Past: [Round Name]" + "Raised [Round]" as prior_funding signals. Add prior-funding fact type to extraction policy for Investment Snapshot slide patterns.
- **Deals affected:** PAI

### RC-S6-006 — Use of funds false negative for Climatic
- **Root cause:** `pipeline_extraction`
- **Evidence:** Deck (page 11, "THE RAISE" slide): "Close Debt Deals / Team & Pipeline / Legal & Custody / SPV Creation." Report: `use_of_funds.present = false`.
- **Impact:** Capital logic coherence `has_raise_and_use_of_funds = false` when both are clearly present
- **Fix:** Extend use-of-funds extraction to recognize fund-deployment-specific patterns ("Close Debt Deals / Activate Pipeline / Legal Structure") in addition to standard "Product Development / Marketing / Ops" patterns
- **Deals affected:** Climatic (partial impact on PAI and Weavstra where use_of_funds detected but not structured)

### RC-S6-007 — Use of funds structuring absent across all three deals
- **Root cause:** `pipeline_extraction`
- **Evidence:** All three deals show use-of-funds as either false (Climatic) or present but unstructured (PAI: $200M breakdown; Weavstra: $25M/$50M investments). No deal produces a structured use-of-funds breakdown field.
- **Impact:** Underwriting readiness signal is weakened; investors cannot see capital allocation
- **Fix:** Add structured use-of-funds extraction to the financial facts pipeline. Parse category-value pairs from use-of-proceeds tables. Store as fact_type: use_of_funds_breakdown with line items.
- **Deals affected:** PAI, Climatic, Weavstra

### RC-S6-008 — Debt/pipeline signals not surfaced for fund/IaaS model (Climatic)
- **Root cause:** `coverage_gap_policy` + `pipeline_extraction`
- **Evidence:** Deck: $375M board-approved debt; $850M+ pipeline. These are the primary investment thesis signals. Not captured in capital_logic, financial_coverage, or promoted_facts.
- **Impact:** Climatic's investment attractiveness is understated — its key differentiator (approved debt + ready pipeline) is invisible to the report
- **Fix:** Add IaaS/fund deployment pipeline as a recognized financial signal class. Extract: debt_approved, deployment_pipeline, leverage_ratio fields. Create fund-archetype policy.
- **Deals affected:** Climatic

---

## P2 — Medium Priority

### RC-S6-009 — Company name not extracted across all three deals
- **Root cause:** `pipeline_extraction`
- **Evidence:** `company_name: null` on all three reports. Deck cover pages clearly state: "Persona AI Inc," "Climatic Capital Global / CCM," and "Weavstra."
- **Impact:** Report output missing basic identity; affects downstream filtering and display
- **Fix:** Add company name extraction as a promoted fact from deck cover / title page text. Fallback: use deal creation name.
- **Deals affected:** PAI, Climatic, Weavstra

### RC-S6-010 — Team highlights not surfaced in any report field
- **Root cause:** `pipeline_extraction`
- **Evidence:** All three decks have prominent team slides with named executives, credentials, and prior capital raised. None surface in report fields.
- **Impact:** Signal quality for team assessment is entirely absent from structured output
- **Fix:** Extract team member names + titles + key credentials as promoted_facts or team_signal_v1 structured fields
- **Deals affected:** PAI, Climatic, Weavstra

### RC-S6-011 — Revenue model field absent for deck-only packages
- **Root cause:** `pipeline_extraction`
- **Evidence:** PAI has RaaS ($75K/yr/robot), Climatic has IRR returns from SPV deployments, Weavstra has enterprise SaaS / government contracts. None produce a structured revenue_model field.
- **Impact:** Underwriting readiness assessment is incomplete without revenue model understanding
- **Fix:** Add revenue_model extraction policy to DPU evidence set. Recognize: subscription/RaaS, IRR-based, project-revenue, government-contract, SaaS patterns.
- **Deals affected:** PAI, Climatic, Weavstra

### RC-S6-012 — Project/milestone tables not extracted as structured facts (Climatic)
- **Root cause:** `pipeline_extraction`
- **Evidence:** Climatic deployment pipeline table (8 projects with Capital/Revenue/IRR/Start/Progress) is a structured financial dataset. Not captured in financial_coverage or promoted_facts.
- **Impact:** Key forward-looking financial signals invisible in structured output
- **Fix:** Extend table extraction policy to recognize deployment-pipeline table format. Map to: project_pipeline[] with { name, capital, revenue, irr, start_date, progress_pct }.
- **Deals affected:** Climatic

### RC-S6-013 — Funding stage classifier fires with default confidence on all archetypes
- **Root cause:** `coverage_gap_policy`
- **Evidence:** All three deals return `confidence: 0.6` with the single signal `company_phase_label:pre_seed`. This is the minimum/default output, not a calibrated assessment.
- **Impact:** False precision — `confidence: 0.6` suggests meaningful signal but it is the classifier floor
- **Fix:** Return `confidence: null` or `"insufficient_signals"` when classification is based solely on the fallback IDEA signal and the archetype is non-standard. Add guard: if archetype = fund/IaaS → stage_classification = N/A.
- **Deals affected:** PAI, Climatic, Weavstra

---

## Summary Table

| ID | Title | Priority | Root Cause | Deals |
|----|-------|----------|-----------|-------|
| RC-S6-001 | DTC Ecommerce misclassification from OCR noise | P0 | ocr_induced → llm_classification_error | Weavstra |
| RC-S6-002 | SPV concept bleed from adjacent deal | P0 | llm_context_bleed | Weavstra |
| RC-S6-003 | RaaS mislabeled as Licensing | P0 | llm_classification_error | PAI |
| RC-S6-004 | Stage classifier defaulting to IDEA for all archetypes | P1 | coverage_gap_policy | PAI, Climatic, Weavstra |
| RC-S6-005 | Prior funding not detected (PAI pre-seed SAFEs) | P1 | pipeline_extraction | PAI |
| RC-S6-006 | Use of funds false negative (Climatic) | P1 | pipeline_extraction | Climatic |
| RC-S6-007 | Use of funds not structured in any deal | P1 | pipeline_extraction | PAI, Climatic, Weavstra |
| RC-S6-008 | Debt/pipeline signals invisible for fund model | P1 | coverage_gap_policy + pipeline_extraction | Climatic |
| RC-S6-009 | Company name null across all deals | P2 | pipeline_extraction | PAI, Climatic, Weavstra |
| RC-S6-010 | Team highlights absent from report fields | P2 | pipeline_extraction | PAI, Climatic, Weavstra |
| RC-S6-011 | Revenue model field absent for deck-only packages | P2 | pipeline_extraction | PAI, Climatic, Weavstra |
| RC-S6-012 | Project/milestone table not extracted (Climatic) | P2 | pipeline_extraction | Climatic |
| RC-S6-013 | Stage confidence = 0.6 floor on all non-standard archetypes | P2 | coverage_gap_policy | PAI, Climatic, Weavstra |

**Totals:** 3 P0 · 5 P1 · 5 P2
