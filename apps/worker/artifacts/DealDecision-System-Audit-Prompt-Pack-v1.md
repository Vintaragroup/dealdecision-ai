# DealDecision AI - System Audit Prompt Pack v1

## 1. Master Audit Prompt (Run First)

You are auditing an AI-driven investment analysis system.

Your job is to evaluate the consistency, rigor, and completeness of this deal analysis.

### Instructions
Analyze the provided report and answer:

1. What assumptions are explicitly stated?
2. What assumptions are implied but not stated?
3. Where does the analysis rely on narrative vs validated data?
4. What parts of the analysis are:
   - Strongly supported
   - Weakly supported
   - Unsupported
5. Identify any inconsistencies in:
   - risk evaluation
   - financial reasoning
   - go-to-market logic
6. What key areas are missing entirely?

### Output Format
- Assumptions (Explicit)
- Assumptions (Implicit)
- Strong Areas
- Weak Areas
- Missing Areas
- Overall Confidence Score (1-10)

---

## 2. Financial Audit Prompt

You are acting as a skeptical investor auditing the financial claims.

### Instructions
Evaluate the financial logic in this report.

1. What financial metrics are provided?
2. Are they:
   - normalized (annual vs monthly vs run-rate)?
   - comparable?
3. What key financial metrics are missing?
4. Reverse-engineer the business:
   - What CAC is implied?
   - What conversion rates are required?
   - What marketing spend is required?
5. Are projections realistic given:
   - industry benchmarks
   - scaling constraints
6. Identify:
   - unrealistic assumptions
   - hidden costs
   - dependency on perfect execution

### Output Format
- Provided Metrics
- Missing Metrics
- Implied Economics
- Unrealistic Assumptions
- Financial Risk Score (1-10)

---

## 3. Financial Interpretation Prompt (Critical)

You are reconstructing the financial model behind this deal.

### Instructions
Do not trust the provided numbers. Rebuild the logic.

1. What must be true for projections to work?
2. What are the key drivers?
   - user growth
   - pricing
   - retention
   - CAC
3. Build a simple implied model:
   - Users required
   - Revenue per user
   - Spend required
4. Stress test:
   - What happens if CAC doubles?
   - What happens if growth is 50% slower?
   - What breaks first?
5. Identify:
   - most fragile assumption
   - biggest scaling constraint

### Output Format
- Implied Model Summary
- Key Drivers
- Breakpoints
- Fragility Analysis
- Interpretation Confidence (1-10)

---

## 4. Go-To-Market (GTM) Audit Prompt

You are evaluating whether this company can realistically acquire customers.

### Instructions
Analyze the GTM strategy.

1. What is the primary acquisition channel?
2. What dependencies exist?
   - partners
   - platforms
   - regulation
   - behavior change
3. What is the sales motion?
   - self-serve
   - enterprise
   - hybrid
4. Evaluate:
   - sales cycle complexity
   - adoption friction
   - scalability of channels
5. Identify:
   - bottlenecks
   - single points of failure

### Output Format
- GTM Strategy Summary
- Key Dependencies
- Friction Points
- Bottlenecks
- GTM Feasibility Score (1-10)

---

## 5. Product/Moat Audit Prompt

You are evaluating defensibility and long-term durability.

### Instructions
Assess the product and moat.

1. What is the core advantage?
2. Is it based on:
   - data
   - network effects
   - brand
   - technology
3. How easily can this be replicated?
4. What happens if a well-funded competitor enters?
5. Does the product improve with scale?

### Output Format
- Core Advantage
- Type of Moat
- Replication Risk
- Durability Assessment
- Moat Score (1-10)

---

## 6. Execution and Risk Audit Prompt (Most Important)

You are identifying what could cause this company to fail.

### Instructions
Break down execution risk.

1. What must go right for success?
2. What sequence of events is required?
3. Identify:
   - hiring dependencies
   - operational complexity
   - technical complexity
4. Categorize risks:
   - existential (kills company)
   - major (delays or weakens)
   - minor
5. Rank risks by:
   - probability
   - impact
6. Identify:
   - single biggest failure point

### Output Format
- Success Dependencies
- Risk Categories
- Top 3 Risks (Ranked)
- Failure Scenario
- Execution Risk Score (1-10)

---

## 7. Cross-Deal Consistency Prompt (Run After Multiple Deals)

You are comparing multiple deal analyses.

### Instructions
Compare the reports and identify inconsistencies.

1. Are risks categorized consistently across deals?
2. Are financial assumptions challenged equally?
3. Are similar business models evaluated the same way?
4. Where does the system apply different standards?
5. Identify:
   - bias
   - inconsistency
   - gaps in evaluation logic

### Output Format
- Consistent Areas
- Inconsistencies
- Bias Patterns
- System Weaknesses
- Confidence in System (1-10)

---

## How to Use

1. Run prompts 1-6 on each deal.
2. Collect outputs.
3. Run prompt 7 across deals.
4. Build your real gap map from results.

## Goal

This is not analysis.

This is:
- system interrogation
- gap discovery
- foundation for v2 engine build
