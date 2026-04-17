# Regression Suite Report — 20260409
**Generated:** 2026-04-09T01:07:33.415956+00:00  
**Overall status:** ✅ PASS

---

## Summary

| Metric | Value |
|--------|-------|
| Benchmark cases | 14 |
| Mapped cases | 11 |
| Unmapped cases | 3 |
| Total checks | 75 |
| PASS | 75 |
| FAIL | 0 |
| KNOWN_ISSUE | 0 |
| SKIP | 0 |

---

## Case Overview

| # | Case | Deal ID | Checks | Pass | Fail | Known | Skip | Status |
|---|------|---------|--------|------|------|-------|------|--------|
| 1 | 3ICE | `61ef36dd` | 0 | 0 | 0 | 0 | 0 | ✅ PASS |
| 2 | Albuquerque | `267c4979` | 12 | 12 | 0 | 0 | 0 | ✅ PASS |
| 3 | Allurion | `a85b0ac0` | 11 | 11 | 0 | 0 | 0 | ✅ PASS |
| 4 | Cinco | `0fcec035` | 0 | 0 | 0 | 0 | 0 | ✅ PASS |
| 5 | Deal Decision | `517be946` | 5 | 5 | 0 | 0 | 0 | ✅ PASS |
| 6 | MagarianFund | `0e8fa8ae` | 17 | 17 | 0 | 0 | 0 | ✅ PASS |
| 7 | Palm | `c4f10092` | 0 | 0 | 0 | 0 | 0 | ✅ PASS |
| 8 | Probility | `42be8b30` | 11 | 11 | 0 | 0 | 0 | ✅ PASS |
| 9 | Qredible | `b21b894e` | 6 | 6 | 0 | 0 | 0 | ✅ PASS |
| 10 | StackFactor | `adb2a1cf` | 8 | 8 | 0 | 0 | 0 | ✅ PASS |
| 11 | SyntheticActuals | `—` | 0 | 0 | 0 | 0 | 0 | ? UNMAPPED |
| 12 | SyntheticKPI | `—` | 0 | 0 | 0 | 0 | 0 | ? UNMAPPED |
| 13 | SyntheticQuarterly | `—` | 0 | 0 | 0 | 0 | 0 | ? UNMAPPED |
| 14 | WebMax | `23b2fa42` | 5 | 5 | 0 | 0 | 0 | ✅ PASS |

---

## Per-Case Detail

### 3ICE

- **Deal ID:** `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e`
- **GT file:** `3ICE.json`
- **Mapping:** mapped — deal_id=61ef36dd-391a-4a4e-b30b-1f5d1f19f91e
- **Status:** ✅ PASS
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### Albuquerque

- **Deal ID:** `267c4979-5779-4a43-8920-a92034732edc`
- **GT file:** `Albuquerque.json`
- **Mapping:** mapped — deal_id=267c4979-5779-4a43-8920-a92034732edc
- **Status:** ✅ PASS
- **Checks:** 12 total — 12 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:raise_amount | `raise_amount ≈ 11868000 (±5.0%)` | 11900000.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | Revenue must not be >= $1T (construction budget sales tax noise) | `count == 0` | 0 |
| ✅ PASS | `noise` | financial_breakdown revenue must not be >= $1B | `financial_breakdown_v1.current_state.revenue.value <= 999999999 (absent — satisfies guard)` | None |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | deal_type context must be fund_spv (known limitation BUG-RE-1) | `metadata.score_explanation.context.deal_type == 'fund_spv'` | 'fund_spv' |
| ✅ PASS | `report` | primary_doc_type must be business_plan_im (real-asset routing applied) | `metadata.score_explanation.context.primary_doc_type == 'business_plan_im'` | 'business_plan_im' |
| ✅ PASS | `report` | stage must be fund_ops (real-asset routing applied) | `metadata.score_explanation.context.stage == 'fund_ops'` | 'fund_ops' |

**Dio checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `dio` | business_archetype_v1 must be real_estate | `phase1.business_archetype_v1.value == 'real_estate'` | 'real_estate' |
| ✅ PASS | `dio` | business_archetype_v1 confidence must be >= 0.5 | `phase1.business_archetype_v1.confidence >= 0.5` | 0.6 |
| ✅ PASS | `dio` | deal_overview_v2 deal_type must be real_estate_preferred_equity | `phase1.deal_overview_v2.deal_type == 'real_estate_preferred_equity'` | 'real_estate_preferred_equity' |
| ✅ PASS | `dio` | deal_overview_v2 business_model must be Real estate structured investment | `phase1.deal_overview_v2.business_model contains 'real estate'` | 'Real estate structured investment' |

**Evidence checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `evidence` | real_estate archetype evidence must include re:real_estate rule | `evidence contains rule 're:real_estate'` | ['re:real_estate', 're:noicap'] |
| ✅ PASS | `evidence` | real_estate archetype evidence must include re:noicap rule | `evidence contains rule 're:noicap'` | ['re:real_estate', 're:noicap'] |

### Allurion

- **Deal ID:** `a85b0ac0-19a1-4992-9a21-2d47484b0f8f`
- **GT file:** `Allurion.json`
- **Mapping:** mapped — deal_id=a85b0ac0-19a1-4992-9a21-2d47484b0f8f
- **Status:** ✅ PASS
- **Checks:** 11 total — 11 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:customer_count | `customer_count ≈ 13000 (±20.0%)` | 13000.0 |

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
| ✅ PASS | `evidence` | SPAC archetype evidence must include trust_account rule | `evidence contains rule 'spac:trust_account'` | ['spac:trust_account', 'spac:business_combination', 'spac:public_shares'] |
| ✅ PASS | `evidence` | SPAC archetype evidence must include business_combination rule | `evidence contains rule 'spac:business_combination'` | ['spac:trust_account', 'spac:business_combination', 'spac:public_shares'] |

### Cinco

- **Deal ID:** `0fcec035-9aa3-4f6e-88fa-818c323add09`
- **GT file:** `Cinco.json`
- **Mapping:** mapped — deal_id=0fcec035-9aa3-4f6e-88fa-818c323add09
- **Status:** ✅ PASS
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### Deal Decision

- **Deal ID:** `517be946-cab9-4bc1-8982-9522ff9dab32`
- **GT file:** `Deal Decision.json`
- **Mapping:** mapped — deal_id=517be946-cab9-4bc1-8982-9522ff9dab32
- **Status:** ✅ PASS
- **Checks:** 5 total — 5 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:revenue | `revenue ≈ 3337000 (±10.0%)` | 3337000.0 |
| ✅ PASS | `extraction` | extraction:burn_rate | `burn_rate ≈ 251536 (±15.0%)` | 251536.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | $250 deck burn stored | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | current_state.burn_rate should NOT be deck $250 | `financial_breakdown_v1.current_state.burn_rate.source_kind must NOT be 'deck'` | 'structured_derived' |
| ✅ PASS | `report` | current_state.revenue should reflect XLSX (proforma flagged) | `financial_breakdown_v1.current_state.revenue.value ≈ 3337000 (±10%)` | 3337000.0 |

### MagarianFund

- **Deal ID:** `0e8fa8ae-94fa-4ab7-ab66-39c07651d089`
- **GT file:** `MagarianFund.json`
- **Mapping:** mapped — deal_id=0e8fa8ae-94fa-4ab7-ab66-39c07651d089
- **Status:** ✅ PASS
- **Checks:** 17 total — 17 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | AUM must not appear as raise_amount | `structured_summary.kpis.raise.value == 'Unknown'` | 'Unknown' |
| ✅ PASS | `noise` | capital_logic raise must be absent (fund, not startup raise) | `capital_logic_v1.raise.present == False` | False |
| ✅ PASS | `noise` | Revenue value must not exist (no fund operating revenue) | `financial_breakdown_v1.current_state.revenue == None` | <object object at 0x1044f4e90> |
| ✅ PASS | `noise` | Promoted facts count must be <= 2 (fund produces minimal promotable facts) | `len(promoted_facts) <= 2` | 2 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | deal_type must be fund_spv | `metadata.score_explanation.context.deal_type == 'fund_spv'` | 'fund_spv' |
| ✅ PASS | `report` | stage must be fund_ops | `metadata.score_explanation.context.stage == 'fund_ops'` | 'fund_ops' |
| ✅ PASS | `report` | business_model must be Fund / SPV investment vehicle | `structured_summary.kpis.business_model.value == 'Fund / SPV investment vehicle'` | 'Fund / SPV investment vehicle' |
| ✅ PASS | `report` | deal_summary_v1 hero must be Fund / SPV investment vehicle | `deal_summary_v1.tiers.hero == 'Fund / SPV investment vehicle'` | 'Fund / SPV investment vehicle' |
| ✅ PASS | `report` | context confidence must be >= 0.70 | `metadata.score_explanation.context.confidence >= 0.7` | 0.7124999999999999 |
| ✅ PASS | `report` | financial_breakdown data_quality must be missing | `financial_breakdown_v1.current_state.data_quality == 'missing'` | 'missing' |
| ✅ PASS | `report` | financial_breakdown has_xlsx must be false | `financial_breakdown_v1.has_xlsx == False` | False |
| ✅ PASS | `report` | investment_analysis_overview_v2 archetype value must be fund_spv | `investment_analysis_overview_v2.archetype.value == 'fund_spv'` | 'fund_spv' |

**Dio checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `dio` | dio_context.deal_type must be fund_spv | `dio_context.deal_type == 'fund_spv'` | 'fund_spv' |
| ✅ PASS | `dio` | dio_context.stage must be fund_ops | `dio_context.stage == 'fund_ops'` | 'fund_ops' |
| ✅ PASS | `dio` | business_archetype_v1 from DIO must be fund_spv | `phase1.business_archetype_v1.value == 'fund_spv'` | 'fund_spv' |

**Evidence checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `evidence` | business_model_v1 has_fund_signals must be true | `value_json.diagnostics.has_fund_signals == True` | True |
| ✅ PASS | `evidence` | business_model_v1 startup guard must be applied | `value_json.diagnostics.applied_guards contains 'startup_operating_label_suppressed_for_fund'` | ['startup_operating_label_suppressed_for_fund'] |

### Palm

- **Deal ID:** `c4f10092-1c94-4116-b4f0-78874868f92b`
- **GT file:** `Palm.json`
- **Mapping:** mapped — deal_id=c4f10092-1c94-4116-b4f0-78874868f92b
- **Status:** ✅ PASS
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### Probility

- **Deal ID:** `42be8b30-2b7d-45e0-ade0-99427a505c59`
- **GT file:** `Probility.json`
- **Mapping:** mapped — deal_id=42be8b30-2b7d-45e0-ade0-99427a505c59
- **Status:** ✅ PASS
- **Checks:** 11 total — 11 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:arr | `arr ≈ 1000000 (±20.0%)` | 1000000.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | Revenue projection must not be selected as current revenue | `<= 2000000` | 1000000.0 |
| ✅ PASS | `noise` | No revenue fact >= $50M from this deal | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | deal_type must be startup_raise | `metadata.score_explanation.context.deal_type == 'startup_raise'` | 'startup_raise' |
| ✅ PASS | `report` | funding_stage_v1 must be pre_seed | `funding_stage_v1.funding_stage == 'pre_seed'` | 'pre_seed' |
| ✅ PASS | `report` | financial_breakdown has_xlsx must be false | `financial_breakdown_v1.has_xlsx == False` | False |
| ✅ PASS | `report` | capital_logic_v1 raise amount must be $4M | `capital_logic_v1.raise.amount ≈ 4000000 (±10%)` | 4000000.0 |
| ✅ PASS | `report` | capital_logic_v1 raise present must be true | `capital_logic_v1.raise.present == True` | True |

**Dio checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `dio` | deal_overview_v2 deal_type must be startup_raise | `phase1.deal_overview_v2.deal_type == 'startup_raise'` | 'startup_raise' |
| ✅ PASS | `dio` | business_archetype_v1 value fires as consumer_product (known bug BUG-PROB-1) | `phase1.business_archetype_v1.value == 'consumer_product'` | 'consumer_product' |
| ✅ PASS | `dio` | business_archetype_v1 confidence must be <= 0.55 (weak signal) | `phase1.business_archetype_v1.confidence <= 0.55` | 0.48484848484848486 |

### Qredible

- **Deal ID:** `b21b894e-4020-46bd-b753-93b2d2d5fa8f`
- **GT file:** `Qredible.json`
- **Mapping:** mapped — deal_id=b21b894e-4020-46bd-b753-93b2d2d5fa8f
- **Status:** ✅ PASS
- **Checks:** 6 total — 6 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:arr | `arr ≈ 1582164 (±20.0%)` | 1582164.0 |
| ✅ PASS | `extraction` | extraction:mrr | `mrr ≈ 131847 (±20.0%)` | 131847.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | $349 stored as burn_rate | `count == 0` | 0 |
| ✅ PASS | `noise` | $381K stored as current revenue | `count == 0` | 0 |
| ✅ PASS | `noise` | Garbled ARR $5120 | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | current_state.burn_rate should be null | `financial_breakdown_v1.current_state.burn_rate == None` | <object object at 0x1044f4e90> |

### StackFactor

- **Deal ID:** `adb2a1cf-bbb1-4f3b-8735-e2249415124f`
- **GT file:** `StackFactor.json`
- **Mapping:** mapped — deal_id=adb2a1cf-bbb1-4f3b-8735-e2249415124f
- **Status:** ✅ PASS
- **Checks:** 8 total — 8 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:revenue | `revenue ≈ 23000 (±15.0%)` | 23000.0 |
| ✅ PASS | `extraction` | extraction:cash | `cash ≈ 44000 (±15.0%)` | 44000.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | col_X revenue noise | `count == 0` | 0 |
| ✅ PASS | `noise` | $000 denomination noise | `count == 0` | 0 |
| ✅ PASS | `noise` | cap_table revenue facts | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | current_state.revenue | `financial_breakdown_v1.current_state.revenue ≈ 23000 (±15%)` | 23000.0 |
| ✅ PASS | `report` | current_state.burn_rate should be null | `financial_breakdown_v1.current_state.burn_rate == None` | <object object at 0x1044f4e90> |
| ✅ PASS | `report` | current_state.cash | `financial_breakdown_v1.current_state.cash ≈ 44000 (±15%)` | 44000.0 |

### SyntheticActuals

- **Deal ID:** `UNMAPPED`
- **GT file:** `SyntheticActuals.json`
- **Mapping:** unmapped — No deal found in DB for 'SyntheticActuals'
- **Status:** ? UNMAPPED
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### SyntheticKPI

- **Deal ID:** `UNMAPPED`
- **GT file:** `SyntheticKPI.json`
- **Mapping:** unmapped — No deal found in DB for 'SyntheticKPI'
- **Status:** ? UNMAPPED
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### SyntheticQuarterly

- **Deal ID:** `UNMAPPED`
- **GT file:** `SyntheticQuarterly.json`
- **Mapping:** unmapped — No deal found in DB for 'SyntheticQuarterly'
- **Status:** ? UNMAPPED
- **Checks:** 0 total — 0 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

_No checks defined or executed._

### WebMax

- **Deal ID:** `23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4`
- **GT file:** `WebMax.json`
- **Mapping:** mapped — deal_id=23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4
- **Status:** ✅ PASS
- **Checks:** 5 total — 5 PASS, 0 FAIL, 0 KNOWN_ISSUE, 0 SKIP

**Extraction checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `extraction` | extraction:revenue | `revenue ≈ 8000 (±15.0%)` | 8000.0 |
| ✅ PASS | `extraction` | extraction:burn_rate | `burn_rate ≈ 32000 (±15.0%)` | 32000.0 |

**Noise checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `noise` | duplicate zero revenue for same period | `count == 0` | 0 |

**Report checks**

| Outcome | Category | Label | Expected | Actual |
|---------|----------|-------|----------|--------|
| ✅ PASS | `report` | current_state.revenue should be $8K not $0 | `financial_breakdown_v1.current_state.revenue ≈ 8000 (±15%)` | 8000.0 |
| ✅ PASS | `report` | structured_summary.revenue | `structured_summary.revenue.value.amount ≈ 8000 (±15%)` | 8000.0 |

---

## Cross-Case Regression Insights

_No cross-case failure patterns detected._

---

## Release-Gate Assessment

- ⚪ **3ICE** — no checks defined — needs GT structure before release-gating
- ✅ **Albuquerque** — PASS (12/12 checks) — strong release-gate candidate
- ✅ **Allurion** — PASS (11/11 checks) — strong release-gate candidate
- ⚪ **Cinco** — no checks defined — needs GT structure before release-gating
- ✅ **Deal Decision** — PASS (5/5 checks) — strong release-gate candidate
- ✅ **MagarianFund** — PASS (17/17 checks) — strong release-gate candidate
- ⚪ **Palm** — no checks defined — needs GT structure before release-gating
- ✅ **Probility** — PASS (11/11 checks) — strong release-gate candidate
- ✅ **Qredible** — PASS (6/6 checks) — strong release-gate candidate
- ✅ **StackFactor** — PASS (8/8 checks) — strong release-gate candidate
- ✅ **WebMax** — PASS (5/5 checks) — strong release-gate candidate
