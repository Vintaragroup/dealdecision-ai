# P5 Phase 1 — Validation Summary

**Date:** 2026-04-10T19:48Z  
**Sprint:** P5 Phase 1  
**REPORT_COMPILER_VERSION:** 26  
**Test Suite:** 1416 passing (30 skipped, 98/99 suites)

---

## Objectives

| Objective | Result |
|-----------|--------|
| Fix cv=null on fresh compile | ✅ Done |
| Fix P5-002: StackFactor BM escape (Wholesale/Retail) | ✅ Done |
| Fix P5-002: Albuquerque BM escape (Omnichannel/Wholesale) | ✅ Done |
| All 5 foundational deals return cv=26 on fresh compile | ✅ Done |
| No regressions (FPG or other) | ✅ Done |

---

## Deal-Level Validation Matrix

| Deal | cv | BM Value | BM FPG Rule | Raise | Status |
|------|----|----------|-------------|-------|--------|
| StackFactor | 26 | `null` (was `Wholesale/Retail`) | `generic_wholesale_tech_mismatch` | `$2.5M Pre-Seed SAFE` | ✅ |
| DealDecision | 26 | `Subscription/SaaS` | — | `$2M Pre-Seed` | ✅ |
| Albuquerque | 26 | `null` (was `Omnichannel…`) | `generic_wholesale_medtech_mismatch` | `$35.6M Equity` | ✅ |
| Magarian | 26 | `Fund / SPV investment vehicle` | (raise.unknown_sentinel) | `null` | ✅ |
| 3ICE | 26 | `Licensing` | — | `$10M Equity` | ✅ |

---

## Files Modified

| File | Change |
|------|--------|
| `packages/core/src/reports/final-publish-guard.ts` | Distribution segment exclusion; product corpus broadening; `hasRealEstateContext`; CRE guard rule |
| `packages/core/src/reports/__tests__/final-publish-guard.test.ts` | 8 new P5 tests (total 47 in FPG suite) |
| `apps/api/src/routes/reports.ts` | `__compiler_version` stamped on fresh-compile payload (both route paths) |

---

## Remaining P5 Backlog (Phase 2)

| ID | Description | Priority |
|----|-------------|----------|
| P5-003 | DealDecision hero tier: OCR shard contamination | High |
| P5-004 | Carmoola BM wrong-industry extraction (DPU-level) | High |
| P5-005..P5-013 | Remaining upstream extraction items | Medium |

---

## Notes

- Albuquerque BM was nulled by `generic_wholesale_medtech_mismatch` (healthcare/IRF signals from slide corpus) rather than the new `real_estate_context_mismatch` rule (which would also fire on CRE keyword signals). Both outcomes are correct — medtech rule fired first because the slide corpus contained IRF/hospital content.
- DealDecision hero OCR shard is deferred to Phase 2 (requires UI-layer sanitization or DPU re-extraction).
- Carmoola BM wrong-industry is deferred to Phase 2 (requires DPU-level fix).
