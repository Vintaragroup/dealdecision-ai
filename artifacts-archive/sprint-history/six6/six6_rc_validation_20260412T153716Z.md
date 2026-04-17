# Six6 Remediation Package — Live Validation Report

**Timestamp**: 2026-04-12T15:37:16Z  
**Deals validated**: PAI (22404e4a), Weavstra (fba0138d), Climatic (53a9dc16)  
**Cache cleared before validation**: ✅ (6 `ingestion_reports` rows deleted across 3 deals)  
**REPORT_COMPILER_VERSION**: 36  

---

## Deal Validation: PAI (22404e4a-7747-48ad-a52b-2bc71033c530)

| Field | Expected | Actual | Status |
|-------|----------|--------|--------|
| `business_model.label` | "Robot-as-a-Service (RaaS)" | "Robot-as-a-Service (RaaS)" | ✅ |
| `funding_stage.stage` | `pre_seed` | `pre_seed` | ✅ |
| `funding_stage.confidence` | 0.35 (IDEA-only) | 0.35 | ✅ |
| `funding_stage.signals` | `company_phase_label:pre_seed=0.35` | matches | ✅ |
| IAO: No SPV bleed | clean | clean | ✅ |

**Notes**: DIO raise = "Unknown" → `parseMoneyLike` returns null → no raise band signal → IDEA-only path → `pre_seed` at honest 0.35.

---

## Deal Validation: Weavstra (fba0138d-2a24-4b99-b50c-ee45dc73caa0)

| Field | Expected | Actual | Status |
|-------|----------|--------|--------|
| `business_model.label` | NOT "DTC Ecommerce" | "Unknown" | ✅ |
| `funding_stage.stage` | `unknown` | `unknown` | ✅ |
| `funding_stage.confidence` | 0.4 (conflict path) | 0.4 | ✅ |
| `funding_stage.signals` | IDEA=0.35 + raise:growth=0.4 | `company_phase_label:pre_seed=0.35, raise_amount_band:growth=0.4` | ✅ |
| IAO: No SPV bleed | clean | clean | ✅ |

**Notes**: 
- "Unknown" BM sourced from `executive_summary_v1.business_model = "Unknown"` in DIO — correct for AI/sovereign tech fund vehicle.
- Stale `evidence_items` record deleted (was `deal:fba0138d-...:fact:business_model_v1`).
- DIO raise = "$90M" → 90,000,000 → growth band → IDEA(0.35) + growth(0.4) conflict → `unknown`.

---

## Deal Validation: Climatic (53a9dc16-e08b-4848-8c75-944e15e320ca)

| Field | Expected | Actual | Status |
|-------|----------|--------|--------|
| `business_model.label` | "Fund / SPV investment vehicle" | "Fund / SPV investment vehicle" | ✅ |
| `funding_stage.stage` | `unknown` | `unknown` | ✅ |
| `funding_stage.confidence` | 0.4 (conflict path) | 0.4 | ✅ |
| `funding_stage.signals` | IDEA=0.35 + raise:growth=0.4 | `company_phase_label:pre_seed=0.35, raise_amount_band:growth=0.4` | ✅ |
| IAO: No SPV bleed | clean | clean | ✅ |

**Notes**: DIO raise = "$25M Equity" → `parseMoneyLike` strips "Equity" → 25,000,000 → growth band → conflict → `unknown`.

---

## Summary: All RCs Closed

| RC | Description | Status |
|----|-------------|--------|
| RC-S6-001 | Weavstra shows "DTC Ecommerce" (stale) | ✅ Closed — now "Unknown" |
| RC-S6-002 | SPV bleed in Investment Analysis Overview | ✅ Closed — IAO clean for all deals |
| RC-S6-003 | PAI "Robot-as-a-Service (RaaS)" misclassified as Licensing | ✅ Closed — "Robot-as-a-Service (RaaS)" confirmed |
| RC-S6-004 | Stage label "unknown" for IDEA + large raise deals | ✅ Closed — Weavstra and Climatic both show `unknown` |
| RC-S6-013 | Stage confidence 0.35 for IDEA-phase deals | ✅ Closed — PAI=0.35, Weavstra/Climatic=0.4 (conflict) |

---

## Test Gates Passed

| Suite | Count | Status |
|-------|-------|--------|
| Core (`@dealdecision/core`) | 1571 | ✅ All passing |
| Funding stage model | 20 | ✅ All passing |
| Worker TypeScript typecheck | — | ✅ No errors |
| API TypeScript typecheck | — | ✅ No errors |

---

## Infrastructure State

- `api_dev` container: rebuilt and running (REPORT_COMPILER_VERSION=36)
- `worker_dev` container: running (suppress→DELETE logic not yet rebuilt — pending)
- `DEBUG_PHASE1_OVERVIEW_V2` env var: removed from `docker-compose.dev.yml`
- `DDAI_DEBUG_POLICY_GUARD` env var: not set (debug log guarded, no output)
