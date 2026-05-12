# RC-S6 Third Pass — Implementation Record
**Timestamp:** 2026-04-12T18:05:27Z  
**REPORT_COMPILER_VERSION:** 38 (bumped from 37)  
**Scope:** Backend only — no frontend changes

---

## Objectives

| RC Item | Description | Status |
|---------|-------------|--------|
| RC-S6-007 | UOF breakdown for Climatic (Strategy C) and Weavstra (Strategy B) | ✅ CLOSED |
| RC-S6-012 | Extract Climatic project pipeline table | ✅ CLOSED (data was in `documents.full_text`, not in DPU pages) |
| RC-S6-011 | Revenue model enrichment — PAI, Climatic, Weavstra | ✅ CLOSED |

---

## Files Changed

### `packages/core/src/reports/compiler-simple.ts`

**Type additions** — added to `structured_summary` interface:
```typescript
project_pipeline?: Array<{
  name: string;
  capital_raw?: string;
  revenue_raw?: string | null;
  return_pct?: string | null;
  start_date?: string | null;
}> | null;

revenue_model?: {
  type: string;
  unit_economics?: string | null;
  recurring?: boolean | null;
  detail?: string | null;
} | null;
```

**RC-S6 enrichment block** — 2 new calls added after `use_of_funds_breakdown`:
- `_extractProjectPipeline(_fullTexts)` — only sets field if array has ≥1 items
- `_extractRevenueModel(_fullTexts)` — sets field if match found

**`_extractUseOfFundsBreakdown` — replaced with 3-strategy version:**
- **Strategy A** (PAI): single-line comma/slash items from first 200 chars of section
- **Strategy B** (Weavstra): dollar-amount anchored multi-line items (`$XM for/invest... description`)
- **Strategy C** (Climatic): labeled sections under THE RAISE heading — known label vocabulary + `$amount` within 120 chars

**`_parseUofItem` — new helper** extracted from Strategy A inline parsing

**`_extractProjectPipeline` — new function:**
- `TABLE_HEADER_RE = /Project\s+Capital\s+Revenue\s+Rtn\s+Start\s+Progress/i`
- `ROW_RE`: matches `Name (CC) $capital $revenue/%/— return% date`
- OCR prefix stripping: two-step — (1) watermark regex to strip `©year Company · Commercial in Confidence`, (2) fallback `slice(-2)` if >3 words remain before country code
- `SECTION_END_RE` prevents over-reading past TEAM section
- Returns array with `name`, `capital_raw`, `revenue_raw` (null for dash), `return_pct` (null for TBA), `start_date`

**`_extractRevenueModel` — new function:**
- Branch 1 (PAI/RaaS): `$\d+/year.*per.*robot` → `type:"RaaS"`, `unit_economics:"$75K/year per robot (min)"`, `recurring:true`
- Branch 2 (Climatic/SPV): IRR% pattern + `\bSPVs?\b` → `type:"SPV Deployment / Infrastructure-as-a-Service"`, `unit_economics:"30%+ target IRR"`, `recurring:false`
- Branch 3 (Weavstra/Enterprise+Gov): `sovereign.*agentic|ai` + `sole[\s-]source` → `type:"Enterprise + Government Contracts"`, `recurring:true`

**`_parseMoneyAmountSimple` — updated:**
- Now strips commas before parsing: `raw.replace(/,/g, '')` — handles `$2,500M` → 2,500,000,000

### `apps/api/src/routes/reports.ts`

```typescript
const REPORT_COMPILER_VERSION = 38; // bumped: RC-S6 third pass — UOF multi-strategy (Climatic/Weavstra), project_pipeline table, revenue_model enrichment
```

### `packages/core/src/reports/__tests__/compiler-simple.rc-s6-pass3.test.ts` — new file

15 tests — all passing:

**UOF tests (5):**
- Climatic Strategy C: ≥3 categories extracted; `$375M+` → Close Debt Deals; `$850M+` → Team & Pipeline
- Weavstra Strategy B: ≥3 dollar-anchored items; `$200M` (operations) and `$150M` present; no fabrication without heading
- PAI Strategy A: regression guard

**Pipeline tests (6):**
- 8 rows extracted from Climatic fixture
- Ammonia (AU): `capital=$150M`, `revenue=$26M`, `return=20%`, `start=Dec`
- Ammonia (EG): comma-format `$2,500M` handled
- Power Barge (UK): `revenue_raw = null` (dash)
- Waste → Fuel (MYA): `→` unicode in name handled
- No-table text → null

**Revenue model tests (4):**
- PAI: type=RaaS, recurring=true, unit_economics contains `75K`
- Climatic: type matches SPV|Infrastructure, unit_economics contains `30%`
- Weavstra: type matches Enterprise|Government, recurring=true
- Generic text → null

---

## Design Decisions

### RC-S6-012 Unblocked
Previous pass concluded pipeline data was only in DPU image pages (6-12). Investigation confirmed `documents.full_text` contains the full pipeline table text including all 8 project rows. DPU pages were a false lead.

### 3-Strategy UOF
The single-regex approach only worked for inline comma-separated items (Strategy A). Climatic uses a labeled-section format under "THE RAISE" — Strategy C uses known label vocabulary with amount lookahead. Weavstra uses dollar-anchored investment sentences — Strategy B uses `$XM for/invest... description` pattern.

### OCR Watermark Prefix on Pipeline
The first pipeline row `Ammonia (AU)` had `Commercial in Confidence` absorbed as a name prefix due to OCR OCR placement immediately before the first data row. Fixed with two-step: first strip `©year Company · Commercial in Confidence` watermark pattern, then fallback trim to last 2 words if >3 remain.

### SPVs (plural)
The Climatic full_text uses "SPVs" (plural), not "SPV". Revenue model regex uses `\bSPVs?\b` to match both.

---

## Test Run (final)

```
Test Suites: 4 passed, 4 total
Tests:       30 passed, 30 total
  - compiler-simple.rc-s6-pass3.test.ts (15 tests)
  - compiler-simple.capital-logic-profile.test.ts (11 tests)
  - compiler-simple.raise-tam.test.ts (2 tests)
  - compiler-simple.stage-and-risk.test.ts (2 tests)
```

TypeScript check: no new errors in modified files (pre-existing test file errors in unrelated analyzers.test.ts, final-publish-guard.test.ts — NOT introduced by this pass).
