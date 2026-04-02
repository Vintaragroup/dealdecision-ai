# DealDecision AI — Policy-Aware Prompt Pack v2

## Purpose
This prompt pack is an enforcement layer for Audit Prompt Pack v1.

It does NOT replace the existing system.
It adds policy-aware reasoning rules so the audit framework uses the correct evaluation model for each deal type.

---

# 1. GLOBAL POLICY ENFORCEMENT PROMPT

Use this prompt before running any audit.

## Prompt

You are running a DealDecision audit.

Before scoring, determine the active deal policy/classification and enforce the correct evaluation framework.

### Instructions

1. First identify the deal policy/type from the system or document context.
   Examples:
   - startup
   - SaaS
   - real_estate
   - structured_credit
   - fund
   - healthcare_operator
   - consumer_brand
   - other

2. Once policy is identified, apply the corresponding reasoning rules below.

3. Do NOT apply irrelevant startup metrics universally.

4. If a metric is irrelevant for the policy, mark it:
   - Not Applicable
   - Not Required For This Deal Type

5. If the deal appears hybrid, state:
   - Primary policy
   - Secondary policy
   - Which framework controls scoring

### Required Output
- Detected Policy
- Secondary Policy (if any)
- Required Evaluation Framework
- Metrics That Apply
- Metrics That Do Not Apply
- Any Ambiguity In Classification

---

# 2. POLICY RULES

## A. STARTUP / SAAS POLICY

### Primary Evaluation Model
- growth
- CAC
- LTV
- retention
- GTM
- moat
- burn/runway
- team execution

### Required Metrics
- revenue / ARR / MRR
- CAC
- retention / churn
- growth rate
- burn
- runway
- pricing / ARPU
- GTM channel
- ICP
- conversion funnel

### Do Not Overweight
- hard asset value
- collateral
- cap-rate logic
- lease structure

### Financial Interpretation Mode
Reconstruct:
- acquisition economics
- payback
- growth assumptions
- burn efficiency

---

## B. REAL ESTATE POLICY

### Primary Evaluation Model
- capital stack
- LTC / LTV
- NOI
- lease structure
- tenant credit
- sponsor quality
- construction risk
- exit cap sensitivity

### Required Metrics
- total project cost
- sources and uses
- loan amount
- equity amount
- NOI
- lease term
- rent escalations
- occupancy / pre-lease status
- yield on cost
- exit cap
- hold period
- DSCR
- guaranty / sponsor support

### Metrics Not Required
- CAC
- ICP
- product moat in software terms
- funnel conversion
- LTV/CAC
- product usage retention

### Replace GTM Audit With
- Demand Drivers Audit
- Referral Base Audit
- Location / market support
- Lease-backed revenue visibility

### Replace Moat Audit With
- Structural Advantage Audit
- Location advantage
- tenant/operator quality
- contractual protections
- market undersupply
- referral density

### Financial Interpretation Mode
Reconstruct:
- yield on cost
- stabilized value
- exit value
- spread / profit margin
- sensitivity to exit cap and construction cost

---

## C. STRUCTURED CREDIT POLICY

### Primary Evaluation Model
- downside protection
- collateral
- coverage
- repayment visibility
- covenants
- duration risk
- sponsor / borrower quality

### Required Metrics
- loan amount
- collateral value
- DSCR / coverage
- repayment source
- covenants
- maturity
- interest rate
- leverage
- guarantees
- downside case

### Metrics Not Required
- CAC
- ICP
- product moat
- software retention metrics

### Replace GTM Audit With
- Repayment Visibility Audit

### Replace Moat Audit With
- Collateral / Structural Protection Audit

### Financial Interpretation Mode
Reconstruct:
- downside recovery
- coverage cushion
- refinance / takeout risk
- covenant strength

---

## D. FUND POLICY

### Primary Evaluation Model
- strategy clarity
- portfolio construction
- manager quality
- liquidity
- fee structure
- risk controls
- track record quality
- concentration

### Required Metrics
- AUM
- strategy
- historical performance
- volatility / drawdown
- fees
- lockup / liquidity
- concentration
- benchmark comparison
- team / manager background

### Metrics Not Required
- CAC
- ICP
- sales funnel
- software moat framing

### Replace GTM Audit With
- Fund Strategy / Capital Formation Audit

### Replace Moat Audit With
- Manager Edge / Process Defensibility Audit

### Financial Interpretation Mode
Reconstruct:
- return quality
- risk-adjusted return
- fee drag
- concentration risk
- liquidity mismatch

---

# 3. POLICY-AWARE AUDIT SECTION MAPPING

## If policy = startup / SaaS
Use the original Audit Prompt Pack v1 sections as written.

## If policy = real_estate
Map sections as follows:

- Master Audit → same
- Financial Audit → same, using real estate metrics
- Financial Interpretation → real estate underwriting mode
- GTM Audit → Demand Drivers / Referral Base Audit
- Product / Moat → Structural Advantage Audit
- Execution & Risk → same, but focused on construction, lease-up, tenant, exit

## If policy = structured_credit
Map sections as follows:

- Master Audit → same
- Financial Audit → same, using credit metrics
- Financial Interpretation → downside / repayment reconstruction
- GTM Audit → Repayment Visibility Audit
- Product / Moat → Structural Protection Audit
- Execution & Risk → same, but focused on repayment, collateral, covenant, timing

## If policy = fund
Map sections as follows:

- Master Audit → same
- Financial Audit → fund economics and fee/readiness review
- Financial Interpretation → return-quality mode
- GTM Audit → Strategy / Fundraising / LP-fit Audit
- Product / Moat → Manager Edge / Process Defensibility
- Execution & Risk → same, but focused on team, concentration, liquidity, process risk

---

# 4. HARD EXCLUSION RULES

These rules MUST be enforced.

## Rule 1
Do NOT penalize a deal for missing metrics that are not relevant to its policy.

## Rule 2
If a section is not applicable in its default form, rename it and evaluate the policy-relevant equivalent.

## Rule 3
Do NOT use startup vocabulary for real estate, credit, or fund deals unless clearly relevant.

## Rule 4
Financial Interpretation must always attempt reconstruction using the correct policy model.
Never default to:
- “non-reconstructible”
unless the required policy-specific inputs are genuinely absent.

## Rule 5
If policy classification and document evidence conflict, explicitly state the conflict before scoring.

---

# 5. POLICY-AWARE FINANCIAL INTERPRETATION PROMPT

Use this prompt in place of generic interpretation when needed.

## Prompt

You are reconstructing the financial logic of this deal using the correct policy-specific model.

### Instructions

1. First identify the active deal policy.
2. Then use the correct interpretation framework:

#### Startup / SaaS
- reconstruct CAC
- payback
- retention dependence
- burn/runway
- growth assumptions

#### Real Estate
- reconstruct NOI
- yield on cost
- stabilized value
- exit value
- sensitivity to cap rate, rent, cost overruns, and timing

#### Structured Credit
- reconstruct repayment path
- collateral coverage
- downside recovery
- refinance risk
- covenant cushion

#### Fund
- reconstruct return quality
- benchmark-relative performance
- fee drag
- drawdown risk
- liquidity risk

3. Explicitly state which interpretation mode is being used.
4. Identify the most fragile assumption.
5. Identify what breaks first in a downside case.

### Required Output
- Active Policy
- Interpretation Mode Used
- Reconstructed Model Summary
- Key Drivers
- Breakpoints
- Most Fragile Assumption
- Downside Failure Point
- Confidence Score

---

# 6. POLICY-AWARE SCORING DISCIPLINE

## Instructions

When scoring:
- score relative to policy-relevant criteria only
- do not compress all deals into the same logic
- distinguish:
  - missing relevant data
  - missing irrelevant data

### Required scoring note
For every score include:
- Why this score is correct for THIS policy type
- Why this deal should not be judged under another policy model

---

# 7. IMPLEMENTATION NOTE

This prompt pack should be used together with:
- DealDecision-System-Audit-Prompt-Pack-v1.md
- DealDecision-Scoring-Normalization-Rubric-v1.md
- DealDecision-Audit-Output-Template-v1.md
- DealDecision-Audit-Batch-Runner-v1.md

It is an overlay, not a replacement.

---

# 8. FINAL GOAL

The purpose of this pack is to ensure:
- real estate is not audited like SaaS
- credit is not audited like consumer tech
- funds are not audited like startups
- scoring reflects the actual structure of the deal

End of file.