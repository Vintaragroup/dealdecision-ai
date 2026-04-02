# DealDecision AI — Policy-Aware Output Template v2

## Purpose
This template is used with Policy-Aware Prompt Pack v2.

It preserves a common audit structure across deals, while allowing policy-specific section naming and required fields so that real estate, credit, fund, and startup deals are not forced into the same output language.

---

# 1. GLOBAL HEADER

## Deal Name:
## Date:
## Analyst:
## Detected Policy:
## Secondary Policy:
## Primary Evaluation Framework:
## Classification Confidence:
## Notes on Policy Ambiguity:

---

# 2. MASTER AUDIT

### Assumptions (Explicit)
-

### Assumptions (Implicit)
-

### Strong Areas
-

### Weak Areas
-

### Missing Areas
-

### Overall Confidence Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 3. POLICY-AWARE SECTION MAP

Use the following section names depending on detected policy.

## If Policy = Startup / SaaS
- Financial Audit
- Financial Interpretation
- GTM Audit
- Product / Moat
- Execution & Risk

## If Policy = Real Estate
- Financial Audit
- Real Estate Financial Interpretation
- Demand Drivers / Referral Base Audit
- Structural Advantage Audit
- Execution & Risk

## If Policy = Structured Credit
- Financial Audit
- Credit Interpretation
- Repayment Visibility Audit
- Structural Protection Audit
- Execution & Risk

## If Policy = Fund
- Financial Audit
- Fund Interpretation
- Strategy / LP Fit Audit
- Manager Edge / Process Defensibility
- Execution & Risk

---

# 4. FINANCIAL AUDIT

### Provided Metrics
-

### Missing Metrics
-

### Implied Economics
-

### Unrealistic Assumptions
-

### Financial Risk Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 5. POLICY-SPECIFIC INTERPRETATION

## Active Section Name:
[Populate based on policy]

### Reconstructed Model Summary
-

### Key Drivers
-

### Breakpoints
-

### Fragility Analysis
-

### Interpretation Confidence Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 6. POLICY-SPECIFIC MARKET / DEMAND / GTM SECTION

## Active Section Name:
[Populate based on policy]

### Strategy / Demand Summary
-

### Key Dependencies
-

### Friction Points
-

### Bottlenecks
-

### Feasibility Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 7. POLICY-SPECIFIC MOAT / STRUCTURAL ADVANTAGE SECTION

## Active Section Name:
[Populate based on policy]

### Core Advantage
-

### Type of Advantage / Protection
-

### Replication or Structural Risk
-

### Durability Assessment
-

### Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 8. EXECUTION & RISK

### Success Dependencies
-

### Risk Categories
- Existential:
-
- Major:
-
- Minor:
-

### Top 3 Risks (Ranked)
1.
2.
3.

### Failure Scenario
-

### Execution Risk Score
- Score:
- Evidence:
- Justification:
- Why Not Higher:
- Missing Validation:
- Why This Score Fits This Policy Type:

---

# 9. POLICY-AWARE SUMMARY SCORECARD

| Category | Section Used | Score |
|----------|--------------|------|
| Financial Risk | Financial Audit | |
| Interpretation Confidence | Policy-Specific Interpretation | |
| Feasibility / Demand / GTM | Policy-Specific Market Section | |
| Moat / Structural Advantage | Policy-Specific Advantage Section | |
| Execution Risk | Execution & Risk | |

---

# 10. FINAL TAKE

### Investment View
-

### Key Reason
-

### Critical Unknown
-

### What Would Need To Be True To Upgrade This Deal
-

---

# 11. COMPARABILITY RULES

These rules must always be followed:

1. Keep common score names even when section labels change.
2. Preserve the five core comparable dimensions:
   - Financial Risk
   - Interpretation Confidence
   - Feasibility / Demand / GTM
   - Moat / Structural Advantage
   - Execution Risk
3. Do not force startup language onto non-startup deals.
4. Do not remove policy context from scoring explanations.
5. Every score must explicitly state why it fits this deal type.

---

# 12. IMPLEMENTATION NOTE

This template must be used with:
- DealDecision-System-Audit-Prompt-Pack-v1.md
- DealDecision-Scoring-Normalization-Rubric-v1.md
- DealDecision-Audit-Batch-Runner-v1.md
- DealDecision-Policy-Aware-Prompt-Pack-v2.md

It extends, but does not replace, the original audit template.

End of file.