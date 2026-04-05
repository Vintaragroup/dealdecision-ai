# Ground Truth Onboarding Checklist
## New Reference Deal Validation Scaffold

**Template version:** v1 (2026-04-05)  
**Purpose:** Step-by-step procedure for activating a placeholder ground-truth JSON as a live validation reference deal.

---

## Overview — 3 Scaffold Deals

| File | Name | Profile | Priority | Status |
|---|---|---|---|---|
| [SyntheticActuals.json](SyntheticActuals.json) | REF-DEAL-5 | Actuals + forecast in same XLSX | **1st** | `PLACEHOLDER` |
| [SyntheticKPI.json](SyntheticKPI.json) | REF-DEAL-6 | Deck-only with pricing traps | **2nd** | `PLACEHOLDER` |
| [SyntheticQuarterly.json](SyntheticQuarterly.json) | REF-DEAL-7 | Quarterly actuals + mixed currency | **3rd** | `PLACEHOLDER` |

**Recommended onboarding order** is explained in [Why this order?](#recommended-onboarding-order) below.

---

## Phase 1 — Find or Designate the Deal

- [ ] Identify a real deal in the DB (or create a synthetic test fixture) whose document set matches the target profile described in `_coverage_rationale`.
- [ ] Confirm the deal has been ingested and has a stable `deal_id` (UUID). No pending re-ingest that would change `deal_id`.
- [ ] Confirm all expected source documents are attached and extracted (`document_page_understanding` rows exist for each doc).

**Target document shapes per profile:**

| Profile | Minimum required documents |
|---|---|
| SyntheticActuals | 1 XLSX with ≥2 historical actual years + ≥1 forecast year, labeled by period |
| SyntheticKPI | 1 PDF deck with: traction KPI slide, pricing slide, market size slide, competitive landscape slide |
| SyntheticQuarterly | 1 XLSX with quarterly columns (Q1–Q4) + annual total column + at least 1 sheet using different denomination than another sheet |

---

## Phase 2 — Source Document Audit

For PDFs:
- [ ] Run OCR quality check: `db:verify-ocr:<deal_id_prefix>` (or equivalent task).
- [ ] Visually review the traction and financials slides — confirm numbers are legible.
- [ ] Note any numbers that appear in the slide text that are market-size, competitor, or pricing values (these become `known_noise` entries).

For XLSX:
- [ ] Open the XLSX and verify the sheet names.
- [ ] Note EXACT column headers for period labels (e.g. `"FY2024 Actual"` not `"FY24 Act."`).
- [ ] Confirm denomination: are revenue rows in whole dollars or $000s? Record in `_currency_note`.
- [ ] If multi-currency: note which sheets use which currency and whether an FX rate is stated.

---

## Phase 3 — Fill In the Ground Truth JSON

For each `__FILL IN__` placeholder in the target JSON file:

- [ ] **deal_name**: Set to the deal's canonical display name (from DB `deals` table).
- [ ] **deal_id**: Set to the full UUID from the `deals` table.
- [ ] **slots**: Fill in from the deal's product profile or the pitch deck description.
- [ ] **financials.current_state**: Set from source document. **Rule: always cite the exact slide/sheet/row/column**, not inference.
- [ ] **financials.raise**: Set from the deck's ask slide or DB `deals.raise_amount`.
- [ ] **validation.extraction_checks[*].expected_value**: Set to integer dollars. Never use $000s multiplier — always expand to full integer (e.g. `3200000` not `3200`).
- [ ] **validation.noise_checks[*].sql_filter**: Replace every `__FILL_IN_*__` placeholder with the actual value. Test each filter by running it manually:
  ```sql
  SELECT COUNT(*) FROM financial_facts_v1 WHERE deal_id = '<uuid>' AND <your filter>;
  ```
- [ ] **validation.report_checks[*].expected_value**: Set to the same integer as the corresponding extraction check.

---

## Phase 4 — Verify source-truth accuracy before committed

Run validation script **before** adding this deal to `REFERENCE_DEALS` in the script:

```bash
source .venv/bin/activate
python evaluation/scripts/validate_financial_extraction.py --deal <DealName>
```

Expected result: **all checks fail** because the ground truth file is not yet in `REFERENCE_DEALS`.

Then temporarily add the deal to `REFERENCE_DEALS` in the script (do not commit yet):

```python
"SyntheticActuals": {
    "deal_id": "<uuid-from-json>",
    "ground_truth_file": "SyntheticActuals.json",
},
```

Run again. Review each FAIL:
- [ ] If extraction check fails: verify the fact exists in `financial_facts_v1`. If absent, investigate extraction layer (L1 issue).
- [ ] If noise check fails with count > 0: the noise guard is not working for this deal. Document in `known_noise` and escalate as an OB issue.
- [ ] If report check fails: the compiler is not selecting the correct value. Document and escalate as an OB issue.

A deal is **not ready to be committed** to `REFERENCE_DEALS` if it has open P0 or P1 failures. P2 or observational failures are acceptable with documentation.

---

## Phase 5 — Commit to REFERENCE_DEALS

Edit `evaluation/scripts/validate_financial_extraction.py`:

```python
REFERENCE_DEALS: dict[str, dict] = {
    # existing deals ...
    "SyntheticActuals": {                           # ← add when ready
        "deal_id":           "<uuid>",
        "ground_truth_file": "SyntheticActuals.json",
    },
}
```

Also update `_status` in the JSON from `"PLACEHOLDER — awaiting real deal ingestion"` to `"ACTIVE — <date>"`.

---

## Phase 6 — Run full suite and confirm no regression

```bash
source .venv/bin/activate
python evaluation/scripts/validate_financial_extraction.py
```

- [ ] All previously-passing checks still pass.
- [ ] New deal shows expected pass/fail distribution.
- [ ] Commit with message: `eval: add <DealName> as REF-DEAL-<N> to validation corpus`

---

## Recommended Onboarding Order

### 1st: SyntheticActuals

**Why first:** The XLSX actuals-vs-forecast failure mode is the most structurally important unverified gap. The existing DealDecision deal is proforma-only; WebMax is single-scenario. No deal in the current set tests that the compiler correctly picks the most-recent actual year when actuals and forecasts coexist in the same workbook. This is a fundamental correctness requirement that should be validated before adding more exotic profiles.

**Tooling already available:** The XLSX extraction pipeline already handles period-labeled columns. The only new behavior being tested is the _selection_ ordering — no new guards required to get the first checks passing.

**Risk if skipped:** Future changes to truth-selection ordering (e.g., to fix a new deal) could silently break the actuals-vs-forecast boundary. Without a reference deal, regression would go undetected.

---

### 2nd: SyntheticKPI

**Why second:** Deck-only pricing traps directly extend the existing Qredible failure mode ($349 pricing → burn_rate, $381K projection → revenue). The guards for those are active. The new profile tests whether those guards generalize to a richer deck with more pricing tiers, a competitor table, and a market size slide. Adding this second ensures the Qredible fixes don't regress under new deck shapes.

**Pre-condition:** OCR quality on the target deck must be sufficient to read the KPI tile values (same constraint as Qredible). If OCR is poor, this deal cannot be validated at L1.

---

### 3rd: SyntheticQuarterly

**Why third:** Quarterly temporal labeling and multi-currency are the most complex extraction scenarios and require verifying two concurrent failure modes at once. Adding this last means any failures are attributable to the quarterly/currency logic, not to pre-existing issues in simpler extraction paths.

**Pre-condition:** The XLSX must have clearly labeled quarterly columns and a stated FX rate. A workbook where quarterly vs annual labels are ambiguous would produce inconclusive test results — choose the deal carefully.

---

## Completion Criteria

A new reference deal is considered **fully onboarded** when:

1. `_status` in the JSON is `"ACTIVE — <date>"`
2. The deal is present in `REFERENCE_DEALS` in the validation script
3. The full suite passes with ≥0 regressions in the existing 4 deals
4. Any open failures are documented as OB issues (with IDs) in `docs/financial-truth-validation-audit.md`
5. The deal is listed in `docs/DOCS_GOVERNANCE_INDEX.md` under the Financial Validation section
