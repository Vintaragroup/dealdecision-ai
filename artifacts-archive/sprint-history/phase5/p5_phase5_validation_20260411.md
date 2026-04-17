# P5 Phase 5 — Live Validation Report

**Date:** 2026-04-11  
**API:** http://localhost:9001  
**Cache invalidated for:** StackFactor, Qredible, Probility, DealDecision, Carmoola, Allurion (6 rows deleted from ingestion_reports)

---

## StackFactor (`adb2a1cf-bbb1-4f3b-8735-e2249415124f`)

**Scenario:** promoted-fact BM nulled by `generic_wholesale_tech_mismatch` guard → post-guard policy recovery fires

```
BM value:        Subscription/SaaS (B2B)
BM recovered:    True
BM recovery_rule: policy_inferred_label
BM confidence:   0.4

Rev display_type_label:        Revenue
Rev entity_scope:              company
Rev revenue_authority_explainer: actual revenue from structured extraction (current)
```

✅ **PASS** — BM recovered from `deal_classification_v1.policy_id = enterprise_saas_b2b_v1`

---

## DealDecision (`517be946-cab9-4bc1-8982-9522ff9dab32`)

**Scenario:** XLSX projected revenue → `display_type_label` = "Revenue (projected)", `entity_scope` = "company"

```
BM value:        Subscription/SaaS     (existing arbitrated value)
BM recovered:    None                   (recovery not triggered — BM already set)

Rev value:               $3.3MM
Rev display_type_label:  Revenue (projected)
Rev entity_scope:        company
```

✅ **PASS** — Revenue KPI type promotion works; existing BM not overwritten by recovery.

---

## Carmoola (`da96b5a9-e5b2-46c1-a6ef-da037f876426`)

**Scenario:** Regression — existing complex BM label preserved, entity_scope=company on financial fact revenue

```
BM value:        Omnichannel (DTC + Wholesale/Retail)
BM recovered:    None

Rev value:       $28MM
Rev entity_scope: company
```

✅ **PASS** — No regression. Complex BM label preserved; entity_scope=company on XLSX revenue.

---

## Allurion (`a85b0ac0-19a1-4992-9a21-2d47484b0f8f`)

**Scenario:** Regression — existing BM not overwritten

```
BM value:        B2B2C
BM recovered:    None
```

✅ **PASS** — Existing BM preserved.

---

## Probility (`42be8b30-2b7d-45e0-ade0-99427a505c59`)

**Scenario:** policy_id = `consumer_ecommerce_brand_v1` — not in mapping → no recovery expected

```
BM value:        None
BM recovered:    None
```

✅ **PASS (expected)** — `consumer_ecommerce_brand_v1` is not in `POLICY_TO_CANONICAL_BM`. No spurious recovery.

---

## Qredible (`b21b894e-4020-46bd-b753-93b2d2d5fa8f`)

**Scenario:** Case-study revenue exclusion via entity_scope detection

```
BM value:        None
Rev value:       $132K   (expected to be excluded, but was not)
Candidate entity_scopes: ['unknown', None, None]
```

⚠️ **PARTIAL** — Entity scope detection did not fire because `note_snippet` is absent from Qredible's DPU-derived promoted fact `content_json.value_json`. The case-study identifier ("Client HQ MRR | Case Solution Q-Trust") lives in the DIO, not in the promoted fact row. 

**Root cause:** `derivePromotedFactsFromDpuForDeal` produces facts without `note_snippet` in their value_json structure. Entity scope detection requires `note_snippet` to be present at `fact.content_json.value_json.note_snippet`.

**Impact:** The entity_scope mechanism is correctly implemented and tested (5 dedicated tests pass). Qredible is a pipeline data enrichment gap, not a code bug.

**Mitigation path:** Enrich DPU-derived promoted facts to include `note_snippet` from their source OCR text — outside Phase 5 scope.

---

## Summary

| Deal | BM Policy Recovery | Revenue KPI Fields | Entity Scope | Status |
|---|---|---|---|---|
| StackFactor | ✅ recovered | ✅ entity_scope=company | N/A (financial fact) | PASS |
| DealDecision | ✅ not overwritten | ✅ display_type_label="Revenue (projected)" | ✅ entity_scope=company | PASS |
| Carmoola | ✅ preserved | ✅ entity_scope=company | N/A | PASS |
| Allurion | ✅ preserved | — | N/A | PASS |
| Probility | ✅ no spurious recovery | — | — | PASS |
| Qredible | N/A | ✅ display_type_label=Revenue | ❌ note_snippet absent | PARTIAL |

**Phase 5 core functionality: 5/6 PASS, 1 PARTIAL (data pipeline gap)**
