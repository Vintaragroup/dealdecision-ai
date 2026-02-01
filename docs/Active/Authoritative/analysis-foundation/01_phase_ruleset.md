# Phase Inference & Fundability Ruleset

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
Defines the authoritative, evidence-based rules for inferring company phase and determining fundability readiness.

---

## Canonical Phases
- IDEA
- PRE_SEED
- SEED
- SEED_PLUS
- SERIES_A
- SERIES_B

---

## Phase Definitions & Requirements

### IDEA
**Required Evidence**
- Problem definition
- Customer persona
- Solution concept

**Ignored**
- Revenue, metrics, financials

---

### PRE_SEED
**Required Evidence**
- Prototype or roadmap
- Customer discovery evidence
- ICP definition

---

### SEED
**Required Evidence**
- Live product
- Customers or users
- Revenue or strong usage
- GTM hypothesis

**Fail If**
- Live product but no traction

---

### SEED_PLUS
**Required Evidence**
- Revenue growth
- Retention metrics
- Early unit economics
- Burn/runway clarity

---

### SERIES_A
**Required Evidence**
- Predictable growth
- Retention
- CAC/LTV or efficiency metrics
- Operational discipline

---

## Phase Inference Logic
Phase is inferred as the **highest phase fully supported by evidence**, regardless of claimed stage.

---

## Fundability Gates
- Gates precede scoring
- Missing required evidence → FAIL or CONDITIONAL
- Gate outcome caps or overrides score

---
