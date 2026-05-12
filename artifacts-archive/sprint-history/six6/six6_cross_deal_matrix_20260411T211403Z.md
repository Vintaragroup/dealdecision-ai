# Six6 Audit — Cross-Deal Validation Matrix
**Generated:** 2026-04-11T21:14:03Z  
**Compiler version:** 35  
**Audit batch:** Six6 (PAI · Climatic · Weavstra)  
**Method:** End-to-end ingest → analysis → report at compiler v35; source truth extracted independently via pdftotext (Weavstra: image-only PDF, truth derived from OCR payload)

---

## Field-by-Field Matrix

| Field | PAI (Persona AI) | Climatic | Weavstra | Notes |
|-------|-----------------|----------|----------|-------|
| **Company name** | ❌ null | ❌ null | ❌ null | All three fail; company name not extracted to any top-level report field across all deals |
| **Business model label** | ❌ FAIL — "Licensing" (should be RaaS) | ✅ PASS — "Fund/SPV investment vehicle" | ❌ FAIL — "DTC Ecommerce" (should be Enterprise AI) | 1/3 correct; Weavstra is OCR-noise-induced; PAI is IP-licensing vs. RaaS confusion |
| **Raise amount detected** | ⚠️ PARTIAL — no single ask line in deck; raise.present=false correct but $200M proceeds not surfaced | ✅ PASS — $25M correctly extracted | ✅ PASS — $90M correctly extracted | PAI's deck has no single "Seeking $X" line; other two passed cleanly |
| **Use of funds** | ⚠️ PARTIAL — present=true but no structured detail | ❌ FAIL — present=false despite explicit slide | ⚠️ PARTIAL — present=true but no structured detail | Use-of-funds extraction consistently weak; Climatic worst (false negative) |
| **Prior funding** | ❌ FAIL — not detected (deck states Pre-Seed SAFEs raised) | N/A | N/A | PAI-specific failure |
| **Stage classification** | ❌ FAIL — pre_seed, labeled IDEA; deck says Seed Round (priced) | ❌ FAIL — pre_seed/IDEA for a fund vehicle with $375M debt and $850M pipeline | ❌ FAIL — pre_seed/IDEA for active enterprise tech company with LOIs | 0/3 correct; classifier does not handle non-standard archetypes (fund, RaaS, sovereign tech) |
| **Revenue model structure** | ❌ FAIL — not structured | ⚠️ PARTIAL — IRR returns captured in business model label; not a structured revenue model field | ❌ FAIL — not structured | Revenue model field consistently missing across all deals (deck-only packages) |
| **Market size (structured)** | ⚠️ PARTIAL — no TAM/SAM/SOM numeric in deck; no fabrication | ⚠️ PARTIAL — $9T deck headline not in structured numeric field | ⚠️ PARTIAL — enterprise customer segment captured qualitatively | No deal has a structured market_size numeric output; consistent gap |
| **Current revenue flagging** | ✅ PASS — correctly flagged absent | ✅ PASS — correctly flagged absent | ✅ PASS — correctly flagged absent | 3/3 correct — system correctly reports no current revenue across all |
| **Financial completeness flag** | ✅ PASS — correctly reports deck-only, missing XLSX, burn, cap table | ✅ PASS — correctly reports deck-only, missing XLSX, burn, cap table | ✅ PASS — correctly reports deck-only, missing XLSX, burn, cap table | 3/3 correct |
| **Traction signal detection** | ✅ PASS — "Customers, Pilots, Users mentioned" | ✅ PASS — traction/deployment activity detected | ✅ PASS — "Customers, Pilots, Partnerships mentioned" | 3/3 qualitative traction signal detection works |
| **Team highlights** | ❌ FAIL — Radford/Pratt/Akinyode not surfaced | ❌ FAIL — Plener/Vezina/Humphreys not surfaced | ❌ FAIL — not surfaced | 0/3 — team highlights consistently absent from report fields |
| **Deal summary hero accuracy** | ❌ FAIL — only shows wrong BM label "Licensing" | ✅ PASS — "IaaS for Climate…Raise: $25M" reasonable | ❌ FAIL — "DTC Ecommerce startup leveraging SPVs" (Climatic SPV bled into Weavstra) | 1/3 |
| **Fabricated financial numbers** | ✅ PASS — no fabrication | ✅ PASS — no fabrication | ✅ PASS — no fabrication (critical for OCR test) | 3/3 — system does not hallucinate financial figures |
| **Coherence rating accuracy** | ✅ PASS — correctly low for deck-only | ⚠️ PARTIAL — has_raise_and_use_of_funds=false (but deck has both) | ✅ PASS — has_raise_and_use_of_funds=true correctly | 2/3 |
| **Overall score reasonableness** | ⚠️ PARTIAL — 39/Fair/consider; reasonable for missing docs | ⚠️ PARTIAL — 35/Fair/consider; reasonable but stage label distorts | ⚠️ PARTIAL — 47/Fair/consider; INFLATED given critical misclassification | All three PARTIAL — scores not directly falsifiable from deck alone but Weavstra score is meaningless given wrong model |
| **OCR fidelity (Weavstra only)** | N/A | N/A | ✅ PASS — raise amount, company proposition, key claims recovered from image-only PDF; garbling present but non-critical | OCR pipeline succeeded under stress-test conditions |
| **Context bleed / hallucination** | ✅ PASS — no cross-deal bleed | ✅ PASS — no bleed | ❌ FAIL — SPV concept from Climatic appeared in Weavstra summary | 1/3 critical — batch processing or LLM context contamination introduced wrong concept into Weavstra |

---

## Aggregate Pass Rates

| Deal | PASS | PARTIAL | FAIL | Total | Pass Rate |
|------|------|---------|------|-------|-----------|
| PAI | 4 | 3 | 7 | 14 | 28.6% |
| Climatic | 6 | 2 | 7 | 15 | 40.0% |
| Weavstra | 5 | 2 | 7 | 14 | 35.7% |
| **Combined** | **15** | **7** | **21** | **43** | **34.9%** |

---

## Pattern Analysis

### Universal Failures (0/3 deals pass)
1. **Company name not extracted** — no top-level `company_name` field in report output for any deal
2. **Stage classification wrong** — always `pre_seed/IDEA` regardless of actual company maturity, model, or round type
3. **Team highlights not surfaced** — team section exists in all three decks; none surface into report fields
4. **Revenue model not structured** — all three lack a structured revenue model field in output

### Universal Passes (3/3 deals pass)
1. **Current revenue correctly absent** — no false revenue reporting for any deck-only deal
2. **Financial completeness flags correct** — deck_only, no XLSX, no burn, no cap table — all three flag correctly
3. **Traction signal detection** — qualitative presence of customers, pilots, partnerships detected for all three
4. **No fabricated financial numbers** — critical pass, including under OCR stress test condition

### OCR Stress Test (Weavstra) — Key Findings
- Raise amount correctly recovered: $90M ✅
- Business model misclassified due to OCR noise: DTC Ecommerce ❌
- Context bleed from adjacent deal (Climatic SPV) in summary ❌
- Core traction signals recovered ✅
- No financial fabrication from OCR noise ✅

### Archetype Coverage Gap
All three deals represent **non-standard archetypes** that the current classifier policy does not handle well:
- PAI = RaaS hardware company (classified as IP licensing)
- Climatic = Fund / IaaS capital deployment vehicle (classified as pre_seed startup)
- Weavstra = Enterprise sovereign AI / quantum tech (classified as DTC Ecommerce due to OCR noise)

The stage classifier (`company_phase_label:pre_seed / IDEA`) fires by default even for companies with signed customer agreements and multi-hundred-million dollar debt facilities.
