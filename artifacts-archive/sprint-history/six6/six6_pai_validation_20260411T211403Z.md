# Six6 Audit — PAI (Persona AI) — Field-by-Field Validation
**Generated:** 2026-04-11T21:14:03Z  
**Compiler version:** 35  
**Deal ID:** 22404e4a-7747-48ad-a52b-2bc71033c530  
**Source deck:** `docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/PAI/PAI - Investor Deck _Investment Banker_March 2026.pdf`  
**Auditor note:** No assumptions made about backend correctness. All fields compared against native PDF text extracted independently via pdftotext.

---

## Source Truth (Deck)
| Field | Deck Value |
|-------|-----------|
| Company name | Persona AI Inc |
| Product | Humanoid labor platform (RaaS) for heavy industries (Shipbuilding, Energy, Automotive) using NASA Robonaut 2 hand patent |
| Business model | **Robot-as-a-Service (RaaS)** — Persona AI owns the asset; customers lease humanoid robots. Target $75K–$100K+/year/robot |
| Stage | Current raise is a **Seed Round (priced)**; prior round was Pre-Seed (SAFEs) |
| Raise | **$200M (3-year Use of Proceeds)**; deck does not state a single ask figure — no "Seeking $X" line found. Deck uses "Seed Round" without a dollar size on cover. Use-of-proceeds breakdown totals $200M (AI/SW:$60M, R&D HW:$50M, Production:$35M, Ops:$30M, Deployment:$15M, Reserve:$10M) |
| Use of funds | Product launch, customer delivery, deployment, commercialization; 3-yr breakdown totals to $200M. Intended to provide 18 months runway at expected burn |
| Revenue model | RaaS recurring, target first revenue within 18 months; additional streams from inspection services (ABS partnership); projected >$100K/yr/robot with add-ons |
| Market size | Heavy industries — shipbuilding, energy, automotive. Deck cites ~2.1M manufacturing jobs unfilled by 2030 (NAM). No explicit TAM/SAM/SOM numeric figure stated as a single number |
| Team | Nicolaus Radford (CEO, ex-NASA, Figure AI), Jerry Pratt (CTO, IHMC Robotics, Boardwalk Robotics, former Figure AI CTO), Jide Akinyode (COO, ex-Nauticus). Combined prior $500M raised |
| Traction | Signed agreements with HD Hyundai, ABS, Denso, LA.IO, POSCO. Gen 1 walking and in testing; Gen 2 being assembled. NASA Robonaut 2 hand patent secured |
| Prior funding | Yes — Pre-Seed SAFEs raised (amount not stated on face of deck) |
| Financial projections | Bear/Base/Bull revenue charts from 2027–2033 shown in millions USD. No current-period revenue, no burn rate stated |
| Cap table | Not provided in deck |

---

## Report Output vs. Source Truth

| Field | Report Output | Source Truth | Status | Root Cause |
|-------|--------------|-------------|--------|-----------|
| Company name | `null` | Persona AI Inc | **FAIL** | pipeline_extraction — company name not extracted into top-level field |
| Business model | `Licensing` | RaaS (Robot-as-a-Service) | **FAIL** | llm_classification_error — system mapped "licensing" (of NASA IP) rather than the primary RaaS leasing model |
| Revenue model | `null` | RaaS subscription ($75K–$100K+/yr/robot) | **FAIL** | pipeline_extraction — DPU did not surface revenue model details |
| Stage | `pre_seed` (confidence 0.6) | Seed Round (priced) | **FAIL** | llm_classification_error — labeled IDEA/pre-seed; deck explicitly states current raise is a "Seed Round (Priced)" |
| Raise amount | `null` (capital_logic_v1: raise.present = false) | $200M 3-yr use of proceeds; no single-line ask found | **PARTIAL/KNOWN GAP** — deck has no single explicit "We are seeking $X" line; raise classified as absent which is correct for a single-number ask, but the $200M proceeds breakdown was not captured | pipeline_extraction — use of proceeds table was not resolved into a raise figure |
| Use of funds | `present: true` (source: dpu:page_text:0) | Product launch, customer delivery, deployment, commercialization (page 38) | **PARTIAL** — detected as present but no structured detail surfaced in report | pipeline_extraction — evidence exists but not structured |
| Team highlights | Not surfaced in report fields checked | Radford, Pratt, Akinyode with $500M+ prior raises | **FAIL** — team signal not surfaced in overview fields | pipeline_extraction |
| Traction signals | Overview reports: "Customers mentioned, Pilots/partnerships mentioned, Users mentioned" | HD Hyundai, ABS, Denso, LA.IO, POSCO signed agreements | **PASS** — qualitative traction signals detected, specifics not named but presence confirmed | — |
| Market size | Not surfaced in capital_logic / overview quantitative fields | No single TAM/SAM/SOM number in deck | **PASS** — no fabrication | — |
| Funding stage label | `pre_seed` | Seed Round (priced) | **FAIL** | llm_classification_error |
| Financial data completeness | `missing_critical: [revenue, arr, mrr, burn_rate, cash, runway_months, pre_money_valuation]` | Correct — no XLSX, no current-period financials | **PASS** — system correctly reports insufficient financial package | — |
| Deal summary hero | `"Licensing"` | Should reflect humanoid RaaS for industrial sectors | **FAIL** — only surfaced business model label, not product or market | pipeline_extraction + llm_classification_error |
| Summary narrative | "humanoid labor platform…licensing business model…lacking critical market and financial details" | Partially accurate; "licensing" is wrong label for RaaS primary model | **PARTIAL** — content fragment accurate but business model label incorrect | llm_classification_error |
| Overall score | 39 / Fair / consider | — | Not directly falsifiable from deck alone; low score reasonable given missing docs | — |
| Raise coherence | `appears_coherent: false` | No explicit single ask amount; $200M use-of-proceeds not parsed | **PASS** — coherence correctly flagged low | — |

---

## Special Checks — PAI

### Check 1: RaaS vs Licensing Disambiguation
- **Deck (page 27–28):** "Our Robot As A Service (RaaS) Model" — Persona AI owns and manages the asset; customer leases the humanoid for a set term. This is the PRIMARY business model.
- **Report output:** `business_model = "Licensing"` — derived from NASA patent licensing signal (page 29 of deck: "licensed NASA's Robonaut 2 Hand Patent Portfolio").
- **Verdict:** FAIL. The classifier conflated IP licensing with the core commercial model. The primary revenue driver is RaaS (recurring leasing), not IP licensing.

### Check 2: Prior Raise Handling
- **Deck (page 4):** States "Past: Pre-Seed Round (SAFEs)" — prior funding is confirmed.
- **Report output:** `capital_logic_v1.prior_funding.present = false`
- **Verdict:** FAIL. Prior funding was not detected despite deck stating "Raised Pre-seed Round" (page 5) and "RAISED: Past: Pre-Seed Round (SAFEs)" (page 4).

### Check 3: Raise Amount — $200M Proceeds vs. No Single-Line Ask
- **Deck (page 38):** Use of Proceeds 3-year total = $200M broken down across 6 categories. No single "We are raising $X" line found anywhere in the deck.
- **Report output:** `raise.present = false` — this is correct: no single ask line was found.
- **Note:** However, the $200M use-of-proceeds breakdown is a materially relevant signal and was not surfaced in any structured field. Improvement opportunity.

### Check 4: Revenue Projection Semantics
- **Deck (page 28):** "We Project Revenue Within 18 Months." Bear/Base/Bull charts run 2027–2033. These are projections, not current revenue.
- **Report output:** `revenue.value = null, is_projected = false` — correct that current revenue is absent; system correctly flags no current revenue.
- **Verdict:** PASS for non-hallucination. Projections not fabricated as current-state.

### Check 5: Use of Funds Detail
- **Deck (page 38):** AI and SW=$60M, R&D HW Dev=$50M, Production Expansion=$35M, Operations=$30M, Deployment=$15M, Reserve=$10M. Total $200M.
- **Report output:** `use_of_funds.present = true` with source `dpu:page_text:0` — presence detected but no breakdown surfaced in structured output.
- **Verdict:** PARTIAL. Presence detected; detail lost.

---

## Summary

| Metric | Value |
|--------|-------|
| Total fields audited | 14 |
| PASS | 4 |
| PARTIAL | 3 |
| FAIL | 7 |
| Pass rate | 28.6% |

### Top failures:
1. **Business model mislabeled** as "Licensing" instead of RaaS
2. **Stage mislabeled** as pre_seed instead of Seed Round
3. **Company name not extracted** (null)
4. **Prior funding not detected** despite explicit deck statement
5. **Revenue model not structured** in output
6. **Team highlights not surfaced** in report fields
7. **Deal summary hero** reflects only the wrong business model label
