# DealDecisionAI Fundability Decision System – Foundation

---
Status: Authoritative
Spec Version: 1.0.0
Last Updated: 2026-01-16
Change Policy:
   - MAJOR: Any change that could materially change fundability outcomes, phase taxonomy/semantics, gate semantics, or the phase-first flow order.
   - MINOR: Additive changes (new gates, new evidence signals, new outputs) that preserve core semantics.
   - PATCH: Non-behavioral edits (clarifications, examples, formatting, typo fixes).

Implementation Contract:
   - Code/config MUST record the Spec Version used for any fundability decision output.
   - Outputs MUST remain explainable per the Explainability Contract.
---

## Purpose
This document defines the canonical ruleset, system architecture, and safe migration path for evolving DealDecisionAI from a document-quality scoring engine into a phase-aware, fundability-first investment decision system.

These specifications are intentionally rigorous and conservative. They are designed to support decisions involving real capital deployment, where false confidence is materially worse than false negatives.

---

## 1. Core Design Principles

1. **Fundability is phase-relative**  
   A deal cannot be evaluated without first inferring its stage of maturity.

2. **Evidence > Claims**  
   Phase, readiness, and score are inferred from extracted evidence, never from stated labels.

3. **Missing fundamentals are risk, not neutrality**  
   Absence of required evidence is penalized asymmetrically.

4. **Gates precede scores**  
   Some deficiencies disqualify a deal from scoring altogether.

5. **Explainability is mandatory**  
   Every decision must be traceable to specific evidence or absence thereof.

---

## 2. Canonical Company Phases

- IDEA
- PRE_SEED
- SEED
- SEED_PLUS
- SERIES_A
- SERIES_B

These are investor-grade definitions, not marketing labels.

---

## 3. Phase Inference (High-Level)

Phase inference occurs **before any scoring** and is determined by:

- Product existence
- Customer presence
- Revenue presence
- Growth tracking
- Unit economics
- Burn / runway clarity
- GTM definition

Phase is assigned as the **highest phase supported by evidence**.

---

## 4. Fundability Gates

Before scoring, the system evaluates fundability gates:

- **PASS** → proceed to scoring
- **CONDITIONAL** → score capped
- **FAIL** → not fundable at this phase

Gate outcomes override weighted averages.

---

## 5. Phase-Calibrated Scoring

Scoring is applied only after:
1. Phase inference
2. Gate evaluation

Presentation quality is separated from business fundability.

---

## 6. Architecture Overview

**New Flow**
1. Ingest
2. Extract evidence
3. Infer phase
4. Apply phase expectations
5. Evaluate gates
6. Score
7. Explain

This replaces the legacy:
Score → Explain

---

## 7. Safe Conversion Strategy

- Existing analyzers remain intact
- New layers run in parallel
- Legacy scores preserved
- Gradual introduction of caps and gates

---

## 8. Explainability Contract

The system must always answer:
- What phase is this company in?
- Why was that phase inferred?
- Is it fundable at that phase?
- What evidence is missing?
- What would change the decision?

Failure to explain = system failure.

---

## Final Note

This system embraces complexity because investment decisions are complex. The goal is correctness, defensibility, and trust — not optimism or speed.
