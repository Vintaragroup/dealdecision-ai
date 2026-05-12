# Deal Understanding Audit Report
**Run:** 2026-04-06T13:32:59Z  
**Deals checked:** 5  
**Layers:** L1=Fidelity | L2=Understanding | L3=Usefulness | L4=Hallucination | L5=Completeness  

---

## Cross-deal summary

| Deal | Pass | Fail | Skip | Overall Score | Status |
| --- | --- | --- | --- | --- | --- |
| SynthPDFDeal | 15 | 0 | 1 | — | 🟢 All pass |
| Palm | 18 | 0 | 0 | 100% | 🟢 All pass |
| Probility | 18 | 0 | 0 | 100% | 🟢 All pass |
| ToxyScreen | 17 | 0 | 0 | 100% | 🟢 All pass |
| Verse | 18 | 0 | 0 | 100% | 🟢 All pass |
| **TOTAL** | **86** | **0** | **1** | — | |

---

## Per-deal results

### 🟢 SynthPDFDeal  (15/16 checks passing, 93%)

_00000000-0000-5000-9000-000000000001_

**Scores:**

| Dimension | Score |
| --- | --- |
| Fidelity             | `n/a` |
| Completeness         | `n/a` |
| Investor Usefulness  | `n/a` |
| **Overall**          | `n/a` |

| Status | Layer | Check | Value Found | Note |
| --- | --- | --- | --- | --- |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.what_company_does | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.business_model | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.revenue_model | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.go_to_market | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.target_customer | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.traction_summary | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.market_positioning | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.competitive_differentiation | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.key_strengths | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] ground_truth.key_risks | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] validation.understanding_checks count | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] validation.consistency_checks count | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] validation.hallucination_checks count | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] validation.completeness_checks count | — | synthetic fixture — no live API call |
| ✅ | `L0-SPEC` | [SPEC] deal_id is concrete | — | synthetic fixture — no live API call |
| ℹ️ | `L0-SPEC` | [INFO] Behavioral / API tests | — |  |

---

### 🟢 Palm  (18/18 checks passing, 100%)

_5c8c7d6e-c992-4be7-8b10-268eac36f663_

**Scores:**

| Dimension | Score |
| --- | --- |
| Fidelity             | `██████████ 100%` |
| Completeness         | `██████████ 100%` |
| Investor Usefulness  | `██████████ 100%` |
| **Overall**          | `██████████ 100%` |

| Status | Layer | Check | Value Found | Note |
| --- | --- | --- | --- | --- |
| ✅ | `L1-FIDELITY` | business_model identifies consumer brand / retail | ['consumer'] |  |
| ✅ | `L1-FIDELITY` | what_company_does mentions apparel, accessories, or golf | ['apparel', 'accessories'] |  |
| ✅ | `L2-UNDERSTANDING` | business_model and revenue_model are both populated | both populated |  |
| ✅ | `L4-HALLUCINATION` | business_model does not incorrectly claim SaaS | none |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not claim inflated revenue projections as current | none |  |
| ✅ | `L5-COMPLETENESS` | what_company_does is populated | We have grown our products to provide apparel and accessorie |  |
| ✅ | `L5-COMPLETENESS` | business_model is populated | consumer_product |  |
| ✅ | `L5-COMPLETENESS` | revenue_model is populated | Omnichannel (DTC + Wholesale/Retail) |  |
| ✅ | `L5-COMPLETENESS` | go_to_market is populated | Today, we sell nationwide and most of our business is direct |  |
| ✅ | `L5-COMPLETENESS` | target_customer is populated | rsity of Notre Fractional CMO for a few key clients Dame and |  |
| ✅ | `L5-COMPLETENESS` | traction_summary is populated | Revenue mentioned; Growth mentioned; Customers mentioned; Pi |  |
| ✅ | `L5-COMPLETENESS` | market_positioning is populated | This deal presents an opportunity for investment in a compan |  |
| ✅ | `L5-COMPLETENESS` | competitive_differentiation is populated | We have grown our products to provide apparel and accessorie |  |
| ✅ | `L3-USEFULNESS` | Investor note #1 surfaced: This is a consumer brand scaling from DTC into wholesale... | 3/4 terms | This is a consumer brand scaling from DTC into wholesale |
| ✅ | `L3-USEFULNESS` | Investor note #2 surfaced: Key driver of value is brand + distribution expansion... | 1/5 terms | Key driver of value is brand + distribution expansion |
| ✅ | `L3-USEFULNESS` | Investor note #3 surfaced: Marketing efficiency and CAC/LTV dynamics are critical... | 2/4 terms | Marketing efficiency and CAC/LTV dynamics are critical |
| ✅ | `L3-USEFULNESS` | Investor note #4 surfaced: Wholesale execution will determine next growth phase... | 3/5 terms | Wholesale execution will determine next growth phase |
| ✅ | `L3-USEFULNESS` | Investor note #5 surfaced: Capital is being used primarily for marketing and hiring... | 2/5 terms | Capital is being used primarily for marketing and hiring |

---

### 🟢 Probility  (18/18 checks passing, 100%)

_42be8b30-2b7d-45e0-ade0-99427a505c59_

**Scores:**

| Dimension | Score |
| --- | --- |
| Fidelity             | `██████████ 100%` |
| Completeness         | `██████████ 100%` |
| Investor Usefulness  | `██████████ 100%` |
| **Overall**          | `██████████ 100%` |

| Status | Layer | Check | Value Found | Note |
| --- | --- | --- | --- | --- |
| ✅ | `L1-FIDELITY` | what_company_does identifies AI / prediction / data platform | ['platform', 'sports'] |  |
| ✅ | `L1-FIDELITY` | business_model identifies consumer product or data/analytics model | ['consumer'] |  |
| ✅ | `L2-UNDERSTANDING` | business_model and revenue_model are both populated | both populated |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not claim ARR as current actuals | none |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not treat TAM as traction | none |  |
| ✅ | `L5-COMPLETENESS` | what_company_does is populated | Platform, By Gameplay, By Device, By Demographics, By Region |  |
| ✅ | `L5-COMPLETENESS` | business_model is populated | consumer_product |  |
| ✅ | `L5-COMPLETENESS` | revenue_model is populated | Wholesale/Retail |  |
| ✅ | `L5-COMPLETENESS` | go_to_market is populated | bal betting/fantasy users will pay for Probility's data, yie |  |
| ✅ | `L5-COMPLETENESS` | target_customer is populated | TAM Assumptions: Help me understand the TAM calculation. The |  |
| ✅ | `L5-COMPLETENESS` | traction_summary is populated | ARR mentioned; Revenue mentioned; Growth mentioned; Users me |  |
| ✅ | `L5-COMPLETENESS` | market_positioning is populated | This deal involves a consumer e-commerce brand operating wit |  |
| ✅ | `L5-COMPLETENESS` | competitive_differentiation is populated | Platform, By Gameplay, By Device, By Demographics, By Region |  |
| ✅ | `L3-USEFULNESS` | Investor note #1 surfaced: This is an early-stage AI/data company with limited proof of... | 4/5 terms | This is an early-stage AI/data company with limited proof of commercialization |
| ✅ | `L3-USEFULNESS` | Investor note #2 surfaced: Key risk is whether predictions are accurate and valuable in... | 1/5 terms | Key risk is whether predictions are accurate and valuable in real-world usage |
| ✅ | `L3-USEFULNESS` | Investor note #3 surfaced: Revenue projections are highly speculative... | 1/4 terms | Revenue projections are highly speculative |
| ✅ | `L3-USEFULNESS` | Investor note #4 surfaced: Success depends on securing sportsbook partnerships and scal... | 2/5 terms | Success depends on securing sportsbook partnerships and scaling distribution |
| ✅ | `L3-USEFULNESS` | Investor note #5 surfaced: Model accuracy claims need independent validation... | 1/5 terms | Model accuracy claims need independent validation |

---

### 🟢 ToxyScreen  (17/17 checks passing, 100%)

_05042123-6c4f-4dcb-9131-a95fce3cd28c_

**Scores:**

| Dimension | Score |
| --- | --- |
| Fidelity             | `██████████ 100%` |
| Completeness         | `██████████ 100%` |
| Investor Usefulness  | `██████████ 100%` |
| **Overall**          | `██████████ 100%` |

| Status | Layer | Check | Value Found | Note |
| --- | --- | --- | --- | --- |
| ✅ | `L1-FIDELITY` | business_model identifies medical, diagnostic, or testing product | ['medical', 'testing', 'diagnostic'] |  |
| ✅ | `L1-FIDELITY` | what_company_does identifies testing or screening product | ['screen'] |  |
| ✅ | `L2-UNDERSTANDING` | business_model and revenue_model are both populated | both populated |  |
| ✅ | `L4-HALLUCINATION` | business_model does not incorrectly claim SaaS | none |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not invent ARR or MRR metrics | none |  |
| ✅ | `L5-COMPLETENESS` | what_company_does is populated | HEAL [OCR page 12] WHY TOXYScreen IS THE SOLUTION ® NON-INVA |  |
| ✅ | `L5-COMPLETENESS` | business_model is populated | Medical / diagnostic testing |  |
| ✅ | `L5-COMPLETENESS` | revenue_model is populated | Medical / diagnostic testing |  |
| ✅ | `L5-COMPLETENESS` | go_to_market is populated | HEAL [OCR page 12] WHY TOXYScreen IS THE SOLUTION ® NON-INVA |  |
| ✅ | `L5-COMPLETENESS` | target_customer is populated | HEAL [OCR page 12] WHY TOXYScreen IS THE SOLUTION ® NON-INVA |  |
| ✅ | `L5-COMPLETENESS` | traction_summary is populated | Growth mentioned |  |
| ✅ | `L5-COMPLETENESS` | market_positioning is populated | The current deal overview indicates a product solution relat |  |
| ✅ | `L5-COMPLETENESS` | competitive_differentiation is populated | Raise: Unknown. |  |
| ✅ | `L3-USEFULNESS` | Investor note #1 surfaced: This is a regulated medical/diagnostic product, not a typica... | 3/5 terms | This is a regulated medical/diagnostic product, not a typical SaaS business |
| ✅ | `L3-USEFULNESS` | Investor note #2 surfaced: Primary risk is validation and adoption, not technology alon... | 4/5 terms | Primary risk is validation and adoption, not technology alone |
| ✅ | `L3-USEFULNESS` | Investor note #3 surfaced: Distribution likely requires partnerships with healthcare sy... | 5/5 terms | Distribution likely requires partnerships with healthcare systems or public agen |
| ✅ | `L3-USEFULNESS` | Investor note #4 surfaced: Market is large but access is policy-driven... | 1/5 terms | Market is large but access is policy-driven |

---

### 🟢 Verse  (18/18 checks passing, 100%)

_bcd59d33-7887-41cd-80b9-742bc5ba945a_

**Scores:**

| Dimension | Score |
| --- | --- |
| Fidelity             | `██████████ 100%` |
| Completeness         | `██████████ 100%` |
| Investor Usefulness  | `██████████ 100%` |
| **Overall**          | `██████████ 100%` |

| Status | Layer | Check | Value Found | Note |
| --- | --- | --- | --- | --- |
| ✅ | `L1-FIDELITY` | business_model identifies CPG / beverage / consumer product | ['consumer', 'product'] |  |
| ✅ | `L1-FIDELITY` | go_to_market identifies on-premise or hospitality channel | ['on - premise'] |  |
| ✅ | `L2-UNDERSTANDING` | business_model and revenue_model are both populated | both populated |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not treat LOIs as realized revenue | none |  |
| ✅ | `L4-HALLUCINATION` | traction_summary does not claim pipeline as achieved revenue | none |  |
| ✅ | `L5-COMPLETENESS` | what_company_does is populated | Functional Ingredients that elevate mood, detoxify the body, |  |
| ✅ | `L5-COMPLETENESS` | business_model is populated | consumer_product |  |
| ✅ | `L5-COMPLETENESS` | revenue_model is populated | Omnichannel (DTC + Wholesale/Retail) |  |
| ✅ | `L5-COMPLETENESS` | go_to_market is populated | Sales Strategy 11 $ 4M Pre - sales From 27 LOIs s On - Premi |  |
| ✅ | `L5-COMPLETENESS` | target_customer is populated | n - boarded $100k run - rate highest velocity non - carbonat |  |
| ✅ | `L5-COMPLETENESS` | traction_summary is populated | Revenue mentioned; Customers mentioned |  |
| ✅ | `L5-COMPLETENESS` | market_positioning is populated | The deal centers around a startup that provides functional i |  |
| ✅ | `L5-COMPLETENESS` | competitive_differentiation is populated | Functional Ingredients that elevate mood, detoxify the body, |  |
| ✅ | `L3-USEFULNESS` | Investor note #1 surfaced: This is an early-stage CPG company with initial traction but... | 5/5 terms | This is an early-stage CPG company with initial traction but limited revenue sca |
| ✅ | `L3-USEFULNESS` | Investor note #2 surfaced: Key question is whether venue-level demand translates into r... | 2/5 terms | Key question is whether venue-level demand translates into repeatable consumer d |
| ✅ | `L3-USEFULNESS` | Investor note #3 surfaced: Pipeline and LOIs should not be treated as realized revenue... | 3/5 terms | Pipeline and LOIs should not be treated as realized revenue |
| ✅ | `L3-USEFULNESS` | Investor note #4 surfaced: Success depends heavily on distribution and brand strength... | 1/5 terms | Success depends heavily on distribution and brand strength |
| ✅ | `L3-USEFULNESS` | Investor note #5 surfaced: Unit economics and margins are not clearly defined in the de... | 3/5 terms | Unit economics and margins are not clearly defined in the deck |

---
