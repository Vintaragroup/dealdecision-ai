# Deal Understanding Audit — Onboarding Checklist

Use this checklist when adding a new PDF-only deal to the deal understanding
audit system. Complete every step in order. Do not skip the manual reading step.

---

## Step 1 — Choose a suitable deal

- [ ] The deal has a PDF pitch deck as its primary or only document source
- [ ] No XLSX financial model or structured data file is the primary source
  (XLSX-only deals belong in the financial extraction evaluation, not here)
- [ ] The deal has been ingested by the platform and has a stable `deal_id`
- [ ] The deck is readable — not scanned images, not blank slides
- [ ] The deal is not under NDA obligations that prevent documentation
      (use synthetic placeholders if in doubt)

---

## Step 2 — Read the deck manually

Before writing any ground truth, read the full deck as an investor would.

- [ ] Read every slide at least once
- [ ] Note the exact language used for: company description, business model,
      revenue model, GTM, target customer, traction, market, competition
- [ ] Identify 2–4 **specific claims** that a hallucinating system might fabricate
      (e.g. "profitable", "no competitors", "Fortune 500 clients")
- [ ] Identify 2–4 **investor-critical signals** that must NOT be buried or missed
      (e.g. ARR, churn rate, founder background, concentration risk)
- [ ] Write rough notes before opening the ground truth JSON

---

## Step 3 — Create the ground truth file

- [ ] Copy the template from `SynthPDFDeal.json` to a new file:
      `evaluation/deal_understanding/ground_truth/<DealName>.json`
- [ ] Set `deal_name`, `deal_id` (exact UUID from the DB)
- [ ] Set `"_status": "IN PROGRESS"` while filling in
- [ ] Fill in all eight `ground_truth` narrative fields from your deck notes:
  - [ ] `what_company_does`  — one specific sentence; must name domain + function
  - [ ] `business_model`     — how money is made; include contract structure
  - [ ] `revenue_model`      — pricing structure, tiers, billing cadence
  - [ ] `go_to_market`       — channels used; note if PLG, sales-led, or partner
  - [ ] `target_customer`    — segment + buyer + pain point, not just "businesses"
  - [ ] `traction_summary`   — specific metrics; include ARR/MRR, customer count,
                               growth rate, NPS or retention if stated
  - [ ] `market_positioning` — who are the named competitors; what is the wedge
  - [ ] `competitive_differentiation` — specific technical or GTM differentiator;
                               must name at least one competitor
- [ ] Fill in `key_strengths` — at least 3 items, each a specific claim from the deck
- [ ] Fill in `key_risks`     — at least 3 items, each a real risk observable in the deck
- [ ] Fill in `investor_relevance_notes` — 2–4 cross-cutting investor diligence notes
- [ ] Set `"_status": "GROUND TRUTH READY"` when complete

---

## Step 4 — Define the audit checks

### 4a — Fidelity checks (`understanding_checks`)

Write at least 4 `understanding_checks` targeting L1-FIDELITY:
- [ ] One check per key specific claim that must survive extraction
      (company type, segment, metric, channel, competitor name)
- [ ] One `not_generic` check on `what_company_does`
- [ ] One `min_length` check — description must be ≥ 12 words
- [ ] At least one `contains_any` targeting traction metrics

### 4b — Understanding checks (`consistency_checks`)

Write at least 2 `consistency_checks` targeting L2-UNDERSTANDING:
- [ ] `both_non_empty` for `business_model` + `revenue_model`
- [ ] `term_alignment` cross-checking at least two related fields
      (e.g. revenue_model + go_to_market sharing subscription/PLG terms)

### 4c — Hallucination checks (`hallucination_checks`)

Write at least 3 `hallucination_checks` targeting L4-HALLUCINATION:
- [ ] One check for each unsupported claim you identified in Step 2
- [ ] At least one check for a common fabrication:
      "profitable", "no competition", "Fortune 500", "enterprise scale"
- [ ] Each check must use `must_not_contain` with specific `prohibited_patterns`
- [ ] Each `note` must explain WHERE in the source deck the claim is NOT supported

### 4d — Completeness checks (`completeness_checks`)

- [ ] One `not_empty` check for every required field (all 8 narrative fields)
- [ ] No skip — every field must be explicitly checked

---

## Step 5 — Run validation

```bash
# Spec coherence only (if _synthetic: true)
python evaluation/deal_understanding/scripts/validate_deal_understanding.py --deal <DealName>

# Full run against live API (once DDA-UNDERSTANDING endpoint is live)
python evaluation/deal_understanding/scripts/validate_deal_understanding.py --deal <DealName>

# Write report to file
python evaluation/deal_understanding/scripts/validate_deal_understanding.py \
  --deal <DealName> --output tmp/deal_understanding_<DealName>.md
```

- [ ] Run passes with exit code 0 (all checks passing)
- [ ] If any spec coherence check fails, fix the ground truth JSON before continuing
- [ ] Set `"_status": "FIXTURE-READY"` after all L0-SPEC checks pass

---

## Step 6 — Review failures

For each failing check:
- [ ] Re-read the relevant deck slide to confirm the ground truth is correct
- [ ] Check whether the failure is in:
  - The extraction (wrong text captured)
  - The understanding model (right text, wrong interpretation)
  - The output format (right understanding, fields not populated)
- [ ] Tag each failure with a bug class (see Step 7)
- [ ] Do not adjust ground truth to match wrong system output

---

## Step 7 — Convert failures to bug classes

Use these bug classes when filing issues:

| Class | Description | Example |
| --- | --- | --- |
| `EXTRACTION-MISS` | Key text from deck was not extracted | Traction metrics missing from traction_summary |
| `EXTRACTION-HALLUCINATION` | Extracted text not present in source | "profitable" in a pre-revenue company |
| `UNDERSTANDING-MISS` | Extracted text is right but interpretation is wrong | Revenue = subscription but output says usage-based |
| `UNDERSTANDING-GENERIC` | Output uses boilerplate instead of specific language | "innovative SaaS platform" instead of domain-specific description |
| `FIELD-MISSING` | A required field is entirely empty | competitive_differentiation = null |
| `SPECIFICITY-FAIL` | Output is vague where the deck is specific | "strong growth" instead of "18% MoM" |
| `COMPETITOR-ABSENT` | Named competitor in deck not surfaced | Northbeam / Triple Whale not mentioned |
| `INVESTOR-SIGNAL-BURIED` | Key investor risk or milestone not surfaced | ARR concentration risk not in output |

- [ ] File each failure as a GitHub issue with the bug class as a label
- [ ] Link the issue back to this checklist entry in the ground truth JSON
      under `"_known_failures"` (add the field if needed)

---

## Status tracking

After completing onboarding, update `ground_truth_file._status` to one of:
- `"IN PROGRESS"` — being filled in
- `"GROUND TRUTH READY"` — narrative written, checks not yet run
- `"FIXTURE-READY"` — all L0-SPEC checks pass
- `"LIVE-VALIDATED"` — L1–L5 checks pass against live API

---

## Reference

- Script: `evaluation/deal_understanding/scripts/validate_deal_understanding.py`
- Example ground truth: `evaluation/deal_understanding/ground_truth/SynthPDFDeal.json`
- Financial evaluation (parallel system): `evaluation/scripts/validate_financial_extraction.py`
- Understanding API endpoint (TODO): `GET /api/v1/deals/{deal_id}/understanding`
  See issue DDA-UNDERSTANDING for implementation spec.
