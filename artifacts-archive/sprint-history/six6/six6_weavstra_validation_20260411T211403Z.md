# Six6 Audit — Weavstra — Field-by-Field Validation (OCR Stress Test)
**Generated:** 2026-04-11T21:14:03Z  
**Compiler version:** 35  
**Deal ID:** fba0138d-2a24-4b99-b50c-ee45dc73caa0  
**Source deck:** `docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/Weavstra/Weavstra.pdf`  
**Auditor note:** Weavstra is a **fully image-based PDF** (Adobe Acrobat Image Conversion Plug-in, 14 pages, 0 native text). This is a pure OCR stress test. All source truth must be derived from what the OCR pipeline was able to recover from the rendered page images.

---

## OCR Performance Diagnostic

| Metric | Value |
|--------|-------|
| Native text characters in PDF | 0 |
| PDF producer | Adobe Acrobat 26.1 Image Conversion Plug-in |
| Pages | 14 |
| File size | 1.86 MB |
| Native text available to pdftotext | None (0-line output) |
| OCR required | Yes — all content must come from vision/OCR pipeline |

### OCR Evidence in Report Output
The Weavstra report contains content sourced entirely from vision OCR extraction. The `slide_title` fields in `deal_summary_v1.paragraphs[].sources` show long OCR-recovered strings — some with character-level garbling but general semantic content intact. This confirms the OCR pipeline processed the image slides and returned usable (if imperfect) text.

**Sample OCR snippet recovered (slide_title from page 2):**
> "108.16.137.49 Fundamental data and farecast projectians may not he reatized. IMMEDIATE CAPITAL ... Deployment of Sovereign Solutions ... Sovereign Agentic Application thats projected to save initial pilot fy ... client ~S100M, protect data and reduce cyber risks ... Sovereing Al middleware, 30x reduction in energy & 15x faster ... $90M AT PREFERRED TERMS processing for Al workloads..."

OCR errors observed: "farecast" (forecast), "projectians" (projections), "Sovereing" (Sovereign), "~S100M" (~$100M), "canfidential" (confidential). Core numeric values and key claims appear intact.

---

## Source Truth (From OCR — Weavstra Deck)
The following was assembled from OCR-recovered content in the report payload, since no native text is available.

| Field | OCR-Recovered Deck Value |
|-------|--------------------------|
| Company name | Weavstra |
| Product / solution | Sovereign AI + quantum technology ecosystem: (1) Sovereign Agentic AI Application (saves pilot client ~$100M, reduces cyber risk), (2) Sovereign AI middleware (30x energy reduction, 15x faster AI processing), (3) Quantum mini data centers — Secure Trust Units (STUs), (4) Deterministic AI middleware with mathematical proof, 27 provisional patents |
| Business model | Enterprise AI / sovereign technology solutions — not DTC Ecommerce |
| Raise | **$90M at preferred terms** (initial closing, first-come first-served with 10% discount to OPP for early investors) |
| Use of funds | $25M into deterministic-AI company with co-development/acquisition rights; $50M into stable room-temperature quantum company with co-development rights; remaining for ecosystem setup |
| Revenue timing | "Enables delivery of enterprise revenue in 90–120 days (from April 1, 2026)" |
| Market / customers | Enterprise Fortune 500 CIO/CTO working group (from "$1B+ revenue" companies); government contracts (US & Allied military); NIST grant pathway (multiple-billion dollar); active conversations in South Korea, Singapore, Vietnam |
| Traction | Signed LOIs; active customer enrollments; government sole-source contracts pathway secured |

---

## Report Output vs. Source Truth

| Field | Report Output | Source Truth (OCR) | Status | Root Cause |
|-------|--------------|---------------------|--------|-----------|
| Company name | Not in top-level fields | Weavstra | **FAIL** | pipeline_extraction |
| Business model | `DTC Ecommerce` | Enterprise AI / sovereign technology solutions | **FAIL — HALLUCINATION RISK** | llm_classification_error — DTC Ecommerce is completely wrong for an enterprise AI / quantum sovereign tech company |
| Raise amount | `$90M` (capital_logic_v1.raise.amount = 90000000) | $90M at preferred terms | **PASS** | — |
| Raise detected | `present: true` sourced to page 3 | Correct | **PASS** | — |
| Use of funds | `present: true` (source: dpu:page_text:0) | $25M + $50M investments outlined | **PARTIAL** — detected as present but not structured | pipeline_extraction |
| Revenue timing | Not surfaced | "90–120 days" enterprise revenue delivery claim | **FAIL** | pipeline_extraction |
| Business model summary | "DTC Ecommerce startup leveraging SPVs for non-dilutive funding" | Enterprise AI / quantum sovereign tech company — no DTC, no SPV leverage | **FAIL — HALLUCINATION** | Two compounding errors: wrong business model label + SPV concept from Climatic (adjacent deal?) appears to have bled in |
| Funding stage | `pre_seed` / IDEA | Unclear from deck but not IDEA-stage — active customers, LOIs, government contract conversations | **FAIL** | llm_classification_error |
| Market size | Not surfaced as structured numeric | NIST grant "multiple-billion dollars", $1B+ revenue enterprise customers | **PARTIAL** | pipeline_extraction |
| Traction signals | Overview reports traction present with "Customers mentioned, Pilots / partnerships mentioned" | Consistent — LOIs, customer enrollments, government contracts | **PASS** | — |
| Financial data completeness | `deck_only, no_current_revenue, no_burn_rate, no_runway, no_income_statement, no_cap_table` | Correct | **PASS** | — |
| OCR hallucination: fabricated figures | No fabricated revenue/financial numbers found in report | No XLSX or numerical financial model in deck | **PASS** — system did not fabricate financial figures from image text | — |
| Deal summary overview | "DTC Ecommerce startup leveraging SPVs for non-dilutive funding" | Completely wrong | **FAIL — CRITICAL** | llm_classification_error + possible context bleed |
| Overall score | 47 / Fair / consider | — | Score is inflated given the critical misclassification | Incorrect baseline |

---

## Special Checks — Weavstra

### Check 1: OCR Hallucination Risk Assessment
- **Finding:** OCR text shows garbling (character substitutions, spacing errors) but core semantic content — company proposition, $90M raise, product names, customer segment — appears to have been recovered.
- **Risk observed:** The `slide_title` fields in the paragraph sources contain OCR-recovered strings that show raw extracted text from image slides. These are long and noisy but not fabricated.
- **Verdict:** OCR extraction achieved functional fidelity for numeric values and key claims. No evidence of hallucinated financial numbers. OCR garbling present but tolerable for downstream classification purposes.

### Check 2: Business Model Misclassification (Critical)
- **Deck:** Sovereign AI middleware, quantum data centers, enterprise agentic applications. B2B enterprise technology company.
- **Report output:** `business_model = "DTC Ecommerce"` and summary says "DTC Ecommerce startup leveraging SPVs."
- **Verdict:** FAIL — CRITICAL. "DTC Ecommerce" is completely wrong for this company. This is likely caused by OCR noise patterns (e.g., words like "orders", "customers", "delivery") triggering e-commerce signals in the classifier. This is a direct OCR-induced misclassification.

### Check 3: SPV Concept Bleed
- **Report summary:** "DTC Ecommerce startup leveraging SPVs for non-dilutive funding"
- **Deck (Weavstra):** No mention of SPVs; SPV is a Climatic concept. Weavstra uses preferred equity terms.
- **Verdict:** FAIL — possible context bleed from batch processing or LLM context contamination. Weavstra does not use SPVs; this is a fabricated/bled concept.

### Check 4: Use-of-Funds from Image Slides
- **Deck (page 3, OCR recovered):** "$25M investment into a deterministic-AI company…$50M investment into a stable room temperature quantum company…"
- **Report output:** `use_of_funds.present = true` with source `dpu:page_text:0`
- **Verdict:** PARTIAL — presence detected. The specific $25M/$50M investment breakdowns are present in the OCR snippet that appears in `slide_title` source fields, indicating OCR recovered this content. However, it is not structured into a capital allocation field.

### Check 5: Revenue vs. TAM/SAM/SOM Confusion
- **Deck:** No revenue vs. market size confusion apparent. The $9T+ figure is Climatic's; Weavstra's deck references enterprise customer size ($1B+ revenue companies) and government contracts.
- **Report output:** `revenue.value = null` — correct; no current revenue claimed.
- **Verdict:** PASS — no revenue/market confusion introduced by OCR or LLM.

### Check 6: $90M Raise Accuracy
- **Deck (page 3):** "$90M AT PREFERRED TERMS" — very clear in OCR output.
- **Report output:** `raise.amount = 90000000` — CORRECT.
- **Verdict:** PASS — OCR correctly recovered the raise amount despite being image-only.

---

## Summary

| Metric | Value |
|--------|-------|
| Total fields audited | 14 |
| PASS | 5 |
| PARTIAL | 2 |
| FAIL | 7 |
| Pass rate | 35.7% |

### OCR-specific findings:
- Raise amount: **CORRECTLY recovered** ($90M) despite image-only PDF
- Core traction signals: **CORRECTLY detected**
- Business model: **CRITICALLY misclassified** (DTC Ecommerce) due to OCR noise triggering wrong classifier signals
- SPV concept: **BLEED from adjacent deal** (Climatic)
- No fabricated financial numbers observed

### Top failures:
1. **Business model hallucinated as DTC Ecommerce** — critical misclassification from OCR noise
2. **SPV concept bled in** from adjacent deal context
3. **Deal summary completely wrong** ("DTC Ecommerce startup leveraging SPVs")
4. **Revenue timing (90–120 days) not captured**
5. **Company name not extracted**
6. **Funding stage misleadingly labeled IDEA/pre-seed**
7. **Use of funds not structured** despite OCR recovery
