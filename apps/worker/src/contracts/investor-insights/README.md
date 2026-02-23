# Investor Insights – Black Box Contracts (Worker)

These files form the **machine-checkable boundary** for Investor Insights implementation.

## What these contracts do
- Provide Zod schemas that constrain worker outputs
- Provide validators enforcing "no empty blocks" behavior
- Anchor the job payload schema

## Stage order (binding)
- Stage 0: Gates + fingerprint + persistence (deterministic)
- Stage 1–5: Deterministic engines (claims/stress/risks/milestones)
- Stage 6: Governed LLM (strict schema validation; quarantine on failure)
- Stage 7: Assembly + persist + audit

## PR1 scope
- Implement Stage 0 only (no LLM calls)
- Persist deterministic-only render package
- Expose GET endpoint for UI tab to render gate/fallback states

## Fail-closed doctrine
If gates fail or compliance validation fails, render_package MUST still be persisted with:
- gate_state
- compliance_state
- deterministic fallback sections
