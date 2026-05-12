# Six6 Audit — Climatic — Field-by-Field Validation
**Generated:** 2026-04-11T21:14:03Z  
**Compiler version:** 35  
**Deal ID:** 53a9dc16-e08b-4848-8c75-944e15e320ca  
**Source deck:** `docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/Climatic/Climatic PitchDeck (5).pdf`  
**Auditor note:** No assumptions made about backend correctness. All fields compared against native PDF text extracted independently via pdftotext.

---

## Source Truth (Deck)
| Field | Deck Value |
|-------|-----------|
| Company name | Climatic Capital Global / Climatic Capital Management Inc (CCM) |
| Product / solution | Infrastructure-as-a-Service (IaaS) platform for climate tech deployment — Climatic funds, deploys, and operates certified climate-positive hardware (energy, water, waste, fuels, ag) through SPVs |
| Business model | **Fund / SPV investment vehicle** — raises equity to deploy as debt/equity into climate infrastructure projects. Leverage model: $2M equity → ~$100M asset-level SPV debt |
| Stage | Early-stage startup with active pipeline; no explicit round label (no Series A/Seed label stated) |
| Raise | **$25M equity** ("Seeking $25M Base Capital") |
| Use of funds | Close debt deals ($375M+ board-approved), ramp team, activate $850M+ pipeline, legal/custody structure, first SPVs |
| Revenue model | IRR-based returns from infrastructure SPVs; project-level revenue shown in deployment pipeline table (e.g., BESS AU: $10M revenue at 25% return; Islands Power UK: $3M–$60M at 50%; etc.) |
| Market size | $9T+ annual global energy transition capex (McKinsey); $1T committed by Germany alone; $2.5T waste processing annually |
| Debt in process | $375M preliminary board-level approval from two global family offices |
| Pipeline | $850M+ identified deployments; $150M additional SDG-linked funding expected; $500M+ via Euro green bonds |
| Team | Michael Plener (Founder, AU), Marc Vezina (CEO NA, 30+ yrs institutional finance), Simon Humphreys (CEO EU, 25+ yrs), Mark Dwyer (Global Partner, 20+ yrs scaling), Tod Gimbel (Global Head Public Affairs), Marita Genebashvili (Head IR) |
| Target IRR | 30%+ frontline IRR vs 8–9% traditional infrastructure |
| Traction/projects | 8 projects in deployment table with capital, revenue, IRR, and start dates; progress 30–90% |
| Cap table | Not provided |
| Financial model | No XLSX or income statement; deck-based only |

---

## Report Output vs. Source Truth

| Field | Report Output | Source Truth | Status | Root Cause |
|-------|--------------|-------------|--------|-----------|
| Company name | Not surfaced (deal_summary hero is market context) | Climatic Capital Global / CCM | **FAIL** | pipeline_extraction — company name not extracted to top-level field |
| Business model | `Fund / SPV investment vehicle` | Fund / SPV investment vehicle — IaaS for climate | **PASS** — correctly classified | — |
| Raise amount | `$25M` (capital_logic_v1: raise.amount = 25000000) | $25M equity | **PASS** | — |
| Raise detected | `present: true`, sourced from page 11 (slide: "THE RAISE Seeking $25M Base Capital") | Correct | **PASS** | — |
| Use of funds | `present: false` | Deck slide "THE RAISE" describes use: close debt deals, ramp team, pipeline activation, legal/custody, SPV creation | **FAIL** — use of funds NOT detected despite explicit deck content | pipeline_extraction — structured use-of-funds not recognized from "THE RAISE" slide context |
| Milestones | `present: false` | Deployment pipeline table has 8 projects with start dates (Oct 26, May 26, Dec 26, Jul 26, 2027); these are milestones | **FAIL** — project start dates/milestones not detected | pipeline_extraction |
| Revenue model | Not in structured report fields | SPV IRR returns with project-level revenue (not traditional operating revenue) | **PARTIAL** — business model label is correct but revenue model mechanics not structured | pipeline_extraction |
| Market size | Not in capital_logic/overview quantitative fields | $9T+ annual market headline on deck cover | **PARTIAL** — market context string captured in deal summary hero/overview but no structured numeric field | pipeline_extraction |
| Current revenue | flagged `no_current_revenue` | Correct — no operating revenue yet; projects in deployment phase | **PASS** — correctly absent | — |
| Debt pipeline signal | Not surfaced in capital_logic | $375M board-approved debt + $850M+ pipeline are key investment signals | **FAIL** — debt pipeline not recognized in capital logic or financial coverage | pipeline_extraction — IaaS fund model not distinguished from standard operating company |
| Funding stage | `pre_seed` (confidence 0.6) | No explicit round type; early stage but has significant pipeline — "pre_seed" mischaracterizes this as a pure idea-stage company | **FAIL** | llm_classification_error — stage label not appropriate for asset-deployment fund structure |
| Financial data completeness | Missing: XLSX, current revenue, burn, runway, income statement, cap table | Correct — deck-only | **PASS** | — |
| Team | Not surfaced in report fields | World-class global team with 3 CEOs | **FAIL** | pipeline_extraction |
| IRR / return metric | Not surfaced | 30%+ frontline IRR is the core return thesis | **FAIL** | pipeline_extraction — IRR not mapped to any structured field |
| Deal summary overview | "Market context: IaaS for Climate…Raise: $25M" | Reasonable | **PASS** | — |
| Overall score | 35 / Fair / consider | — | Low score reasonable given deck-only package | — |

---

## Special Checks — Climatic

### Check 1: Raise vs. Debt Pipeline Confusion
- **Deck (pages 4, 7):** $375M is board-approved DEBT from family offices — this is capital Climatic deploys, not equity it is raising from the investor.
- **Deck (page 11):** Equity ask is $25M.
- **Report output:** `raise.amount = 25000000` — correctly surfaces the $25M equity ask.
- **Risk check:** $375M is NOT labeled as the raise amount. PASS — system did not confuse debt pipeline with equity raise.
- **Gap:** $375M and $850M pipeline signals are valuable context for the investment thesis but not surfaced in any capital logic or financial coverage field.

### Check 2: IaaS vs Operating Company Revenue Confusion
- **Deck (traction slide):** Revenue figures shown (e.g., BESS project $10M revenue; Islands Power $3M–$60M revenue) are PROJECT-LEVEL returns from infrastructure SPVs, not Climatic's earned operating revenue.
- **Report output:** `no_current_revenue` flagged — system correctly treats Climatic as having no current operating revenue.
- **Verdict:** PASS — system did not miscategorize project IRR returns as Climatic's own operating revenue.

### Check 3: Project Table as Structured Financial Signal
- **Deck (traction page):** Table with 8 projects showing Capital, Revenue, Return (IRR), Start date, Progress % — this is structured financial forward-looking data.
- **Report output:** Not captured in financial_coverage_v1 or promoted_facts.
- **Verdict:** FAIL — structured project table not extracted as financial facts.

### Check 4: Stage Label Appropriateness
- **Deck:** No "Series A/Seed" round label. Company is Climatic Capital Management Inc — an investment vehicle, not a typical product startup. "Pre-seed/IDEA" stage label is misleading for a fund-like vehicle with $375M approved debt and $850M pipeline.
- **Report output:** `funding_stage: pre_seed, signal: IDEA, confidence 0.6`
- **Verdict:** FAIL — stage classification is meaningless/misleading for fund/IaaS model. A coverage gap in the classifier policy for non-standard company archetypes.

### Check 5: Use of Funds
- **Deck (page 11, "THE RAISE" slide):** Funds used for: Close debt deals, Team & Pipeline, Legal & Custody, SPV Creation. All clearly stated.
- **Report output:** `use_of_funds.present = false`
- **Verdict:** FAIL — use of funds explicitly stated in deck but not detected. Likely because the format ("Close Debt Deals / Team & Pipeline / Legal & Custody / SPV Creation") doesn't match standard use-of-funds patterns.

---

## Summary

| Metric | Value |
|--------|-------|
| Total fields audited | 15 |
| PASS | 6 |
| PARTIAL | 2 |
| FAIL | 7 |
| Pass rate | 40% |

### Top failures:
1. **Use of funds not detected** despite explicit "THE RAISE" slide with use categories
2. **Debt pipeline ($375M/$850M) not surfaced** in any structured field
3. **Project milestone table not extracted** as financial/milestone facts
4. **Stage label (pre_seed) misleading** for a fund/IaaS vehicle
5. **Team not surfaced** in report fields
6. **IRR not mapped** to any structured return metric field
7. **Company name not extracted** to top-level field
