# Changelog — Analysis Foundation (Fundability System)

All notable changes to the authoritative analysis-foundation specification set will be documented in this file.

This changelog tracks the **spec** version (SemVer). Implementation code may ship behind feature flags before becoming the default, but the spec version should reflect the authoritative intended behavior.

Implementation status (non-normative) is tracked in `IMPLEMENTATION_PROGRESS.md`.

## [1.0.0] — 2026-01-16

### Added
- Baseline authoritative specification set:
  - `00_fundability_foundation.md`: Core principles, canonical phases, phase-first flow, fundability gates, explainability contract.
  - `01_phase_ruleset.md`: Evidence-based phase definitions and gate precedence rules.
  - `02_system_architecture.md`: Component model (PhaseInferenceEngine, FundabilityGateEvaluator, PhasePolicyRegistry) and the architectural shift to “Infer → Gate → Score → Explain”.
  - `03_safe_conversion_plan.md`: Safe migration sequence (parallel inference → soft caps → hard gates → output separation) with backward compatibility and risk controls.

### Changed
- N/A (initial baseline)

### Deprecated
- N/A

### Removed
- N/A

### Fixed
- N/A

### Security
- N/A

---

## Template (copy for new releases)

## [X.Y.Z] — YYYY-MM-DD

### Added
-

### Changed
-

### Deprecated
-

### Removed
-

### Fixed
-

### Security
-
