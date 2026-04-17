# P5 Phase 1 — Cache / Compiler-Version Fix

**Date:** 2026-04-10T19:48Z  
**Sprint:** P5 Phase 1  
**REPORT_COMPILER_VERSION:** 26

---

## Root Cause

`__compiler_version` was stamped on the DB-persisted copy of the report (`ingestion_reports.summary`) inside `upsertIngestionReportSummaryByDealAndVersion`, but the **live `payload` object sent to the client** on a fresh compile was never modified to include it.

Result: the very first request after a cache miss (or after REPORT_COMPILER_VERSION bumped to 26) returned `__compiler_version: null`. All subsequent requests hit the cache and correctly returned `cv: 26` (via `{ ...cached.value }` spread). This was a transient self-healing bug.

---

## Files Changed

### `apps/api/src/routes/reports.ts`

Added `(payload as any).__compiler_version = REPORT_COMPILER_VERSION;` immediately before each `return reply.status(200).send(payload)` in the two fresh-compile code paths:

| Path | Line ~before | Change |
|------|-------------|--------|
| Non-versioned `/report` route | ~3296 | `(payload as any).__compiler_version = REPORT_COMPILER_VERSION;` |
| Versioned `/report/:version` route | ~3783 | `(payload as any).__compiler_version = REPORT_COMPILER_VERSION;` |

---

## Verification

All 5 foundational deals returned `cv: 26` on fresh compile (cache busted, forced recompile):

| Deal | Before | After |
|------|--------|-------|
| StackFactor | cv=null (first compile) | cv=26 ✅ |
| DealDecision | cv=null (first compile) | cv=26 ✅ |
| Albuquerque | cv=null (first compile) | cv=26 ✅ |
| Magarian | cv=null (first compile) | cv=26 ✅ |
| 3ICE | cv=null (first compile) | cv=26 ✅ |

---

## Impact

- Zero behavioral change on content; purely a response metadata fix
- Cache-hit path already returned cv=26 — no regression
- Future compiler version bumps will immediately return correct cv on first compile
