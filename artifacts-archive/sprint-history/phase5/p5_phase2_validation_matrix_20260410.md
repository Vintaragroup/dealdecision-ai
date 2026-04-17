# P5 Phase 2 — Validation Matrix
**Date:** 2026-04-10  
**API:** `http://localhost:9001`  
**REPORT_COMPILER_VERSION:** 26  
**Test count:** 1427 passing (0 failures)  

---

## 10-Deal Live Validation

All 10 deals fetched fresh after cache bust. HTTP 200 for all.

| Deal | ID | IAO Revenue | Revenue Guarded | Is Projected | BM | BM Guarded | Unknown in Summary |
|------|----|-------------|-----------------|-------------|-----|------------|-------------------|
| StackFactor | adb2a1cf | `$23K` | false | false | `null` | **true** | 0 |
| DealDecision | 517be946 | `$3.3MM` | false | false | `null` | false | 0 |
| Albuquerque | 267c4979 | `null` | false | false | `null` | **true** | 0 |
| Magarian | 0e8fa8ae | `null` | false | false | `Fund / SPV investment vehicle` | false | 0 |
| 3ICE | 61ef36dd | `$40K` | false | false | `Licensing` | false | 0 |
| Carmoola | da96b5a9 | `$28MM` | false | false | `Real estate structured investment` | false | 0 |
| Allurion | a85b0ac0 | `$27M` | false | false | `B2B2C` | false | 0 |
| Cino | 0fcec035 | `null` | false | false | `DTC Ecommerce` | false | 0 |
| Probility | 42be8b30 | `$1MM` | false | false | `null` | false | 0 |
| Qredible | b21b894e | `$132K` | false | false | `null` | false | 0 |

---

## Deep Tier Output (All 10 Deals)

| Deal | `tiers.deep` |
|------|-------------|
| StackFactor | `Revenue: $23K Growth: Forecast: $9.8M (2027)` |
| DealDecision | `Business model: Subscription/SaaS Revenue: $3.3MM` |
| Albuquerque | *(empty — no KPI data)* |
| Magarian | `Business model: Fund / SPV investment vehicle` |
| 3ICE | `Business model: Licensing Revenue: $40K` |
| Carmoola | `Business model: Real estate structured investment Revenue: $28MM Growth: 35%` |
| Allurion | `Business model: B2B2C Revenue: $27M Customers: 1584` |
| Cino | `Business model: DTC Ecommerce` |
| Probility | `Revenue: $1MM` |
| Qredible | `Revenue: $132K` |

**Observations:**
- No "Unknown" appears in any deep tier ✅
- No OCR percentage shards detected in any hero/overview/deep tier ✅
- No "Revenue (projected):" label fires — none of the 10 deals have `is_projected=true` on `structured_summary.revenue`. When the flag is set by the XLSX backfill pipeline, the label will fire correctly (covered by unit tests).
- StackFactor and Albuquerque BM: null + guarded=true — wholesale/retail correctly suppressed from IAO summaries ✅

---

## Summary Check (IAO summary text)

| Deal | Summary (first 120 chars) |
|------|--------------------------|
| StackFactor | `The deal involves a $2.5M Pre-Seed SAFE for a compliance training platform targeting the DevSecOps and GRC markets.` |
| Albuquerque | `This deal involves a $35.6 million equity raise for a real estate structured investment focused on a build-to-suit...` |

- No wholesale/retail language in any of the 10 summaries ✅
- No `$1 [instrument]` artifacts in any summary ✅
- No `raise: Unknown` or `revenue: Unknown` sentinel patterns in any summary ✅

---

## Guard Regression Check

| Guard | StackFactor | Albuquerque |
|-------|------------|-------------|
| BM nulled | ✅ `value: null` | ✅ `value: null` |
| BM guarded | ✅ `guarded: true` | ✅ `guarded: true` |
| wholesale/retail in summary | ✅ absent | ✅ absent |
| $1 in summary | ✅ absent | ✅ absent |

---

## Notes

1. `is_projected` on `structured_summary.revenue` is only set by the `financial_fact_backfill` path in `compiler-simple.ts` when the `financial-breakdown-v1` fact itself is projected. The 10 audited deals all use XLSX actuals or unclassified baseline — none trigger projection labeling in production yet.

2. The projected revenue label path is exercised by 3 unit tests in `deal-summary-v1-deterministic.phase2.test.ts` and will fire correctly in production when deals with proforma-only revenue models come through.
