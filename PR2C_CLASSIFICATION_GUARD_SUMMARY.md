# PR2C Numeric Claim Classification Guard — Summary

## Goal
Add a small unit-test guard to ensure PR2C phase enforcement continues to correctly classify numeric/KPI-like claims as “numeric” for evidence enforcement.

## Files modified
- apps/worker/src/lib/governed-llm-overlay.ts
- apps/worker/src/lib/__tests__/overlay-phase-enforcement.test.ts

## What changed
- Extracted and exported a pure helper `isNumericClaim(claim)` from the existing inline numeric detection logic (finite `value_number`).
- Updated the internal `isNumericClaimWithoutEvidence()` to delegate to `isNumericClaim()`.
- Added a new unit test block `describe('numeric claim classification guard', ...)` covering:
  - Numeric examples (revenue, ARR, raise amount, growth %, multiple)
  - Non-numeric qualitative examples

## Behavior confirmation
- Phase enforcement logic remains unchanged (still keys numeric classification off finite `value_number`, and evidence enforcement behavior is unchanged by phase).
- No persistence logic, DB behavior, or worker orchestration was modified.
- Deterministic pipeline remains untouched; this only affects overlay classification + unit tests.
