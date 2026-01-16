# Fundability Decision System Architecture

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

## Design Principles
- Phase-first evaluation
- Evidence over claims
- Gates before scores
- Explainability by default

---

## End-to-End Flow

1. Document ingestion
2. Evidence extraction (nodes)
3. Phase inference engine
4. Phase expectation mapping
5. Fundability gate evaluation
6. Phase-calibrated scoring
7. Explainability synthesis

---

## Core Components

### PhaseInferenceEngine
- Deterministic rules
- Confidence scoring
- Evidence mapping

### FundabilityGateEvaluator
- Phase-specific hard and soft gates
- PASS / CONDITIONAL / FAIL outputs

### PhasePolicyRegistry
- Defines expectations and analyzer applicability per phase

---

## Architectural Shift

**Old**
Score → Explain

**New**
Infer Phase → Gate → Score → Explain

---
