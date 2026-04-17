# Regression Suite Report — 20260408
**Generated:** 2026-04-08T23:57:20.090952+00:00  
**Overall status:** ✅ PASS

---

## Summary

| Metric | Value |
|--------|-------|
| Benchmark cases | 1 |
| Mapped cases | 1 |
| Unmapped cases | 0 |
| Total checks | 11 |
| PASS | 9 |
| FAIL | 0 |
| KNOWN_ISSUE | 0 |
| SKIP | 2 |

---

## Case Overview

| # | Case | Deal ID | Checks | Pass | Fail | Known | Skip | Status |
|---|------|---------|--------|------|------|-------|------|--------|
| 1 | Allurion | `a85b0ac0` | 11 | 9 | 0 | 0 | 2 | ✅ PASS |

---

## Per-Case Detail

### Allurion

- **Deal ID:** `a85b0ac0-19a1-4992-9a21-2d47484b0f8f`
- **GT file:** `Allurion.json`
- **Mapping:** mapped — deal_id=a85b0ac0-19a1-4992-9a21-2d47484b0f8f
- **Status:** ✅ PASS
- **Checks:** 11 total — 9 PASS, 0 FAIL, 0 KNOWN_ISSUE, 2 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:customer_count | `customer_count ≈ 13000 (±20.0%)` | Decimal('13000') |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | SPAC proxy must yield zero revenue facts | `count == 0` | 0 |
| ✅ PASS | `noise` | SPAC proxy must yield zero raise_terms facts | `count == 0` | 0 |
| ✅ PASS | `noise` | No raise amount >= 10M from any document | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | deal_type must be de_spac | `metadata.score_explanation.context.deal_type == 'de_spac'` | 'de_spac' |
| ✅ PASS | `report` | financial_breakdown_v1 current_state data quality should be missing | `financial_breakdown_v1.current_state.data_quality == 'missing'` | 'missing' |
| ✅ PASS | `report` | business_model must be Wholesale/Retail or B2B2C | `deal_summary_v1.tiers.deep contains 'Wholesale'` | 'Business model: Wholesale/Retail Revenue: $1.5M Customers: 1584' |

**Dio checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `dio` | business_archetype_v1 must be de_spac | `phase1.business_archetype_v1.value == 'de_spac'` | 'de_spac' |
| ✅ PASS | `dio` | business_archetype_v1 confidence must be >= 0.5 | `phase1.business_archetype_v1.confidence >= 0.5` | 0.759493670886076 |

**Evidence checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ⚠️ SKIP | `evidence` | SPAC archetype evidence must include trust_account rule | `error` | None |
| ⚠️ SKIP | `evidence` | SPAC archetype evidence must include business_combination rule | `error` | None |

---

## Cross-Case Regression Insights

_No cross-case failure patterns detected._

---

## Release-Gate Assessment

- ✅ **Allurion** — PASS (9/11 checks) — strong release-gate candidate
