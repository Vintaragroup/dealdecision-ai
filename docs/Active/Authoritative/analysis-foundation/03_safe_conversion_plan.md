# Safe Conversion Plan for Existing Analyzer

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

## Objective
Migrate to a phase-aware, fundability-first system without breaking existing functionality.

---

## Core Rules
- Do not remove or rewrite existing analyzers
- Introduce new layers in parallel
- Preserve legacy scores

---

## Migration Steps

### Step 1: Parallel Phase Inference
- Run phase inference without affecting scores
- Log inferred phase and confidence

### Step 2: Soft Gates
- Introduce score caps based on missing required evidence

### Step 3: Hard Gates
- Replace caps with PASS / FAIL where appropriate

### Step 4: Output Separation
- legacy_overall_score
- fundability_assessment

---

## Backward Compatibility
- Existing APIs remain valid
- New outputs are additive
- Historical scores preserved

---

## Risk Controls
- Feature flags for gating logic
- Audit logs for phase decisions
- Deterministic, testable rules only

---
