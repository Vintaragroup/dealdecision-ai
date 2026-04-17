# Six6 Remediation Pass 2 — Implementation Record
**Date**: 2026-04-12T163420Z  
**REPORT_COMPILER_VERSION**: bumped 36 → 37  
**Target RCs**: RC-S6-005, RC-S6-006, RC-S6-007, RC-S6-008, RC-S6-009, RC-S6-010, RC-S6-011, RC-S6-012  
**Target Deals**: Six6 Audit - PAI, Climatic, Weavstra

---

## Files Changed

### 1. `packages/core/src/models/capital-logic-profile.ts`
**RC-S6-005 + RC-S6-006**

- Extended `USE_OF_FUNDS_TEXT_RE` to match Climatic-style fund deployment language:
  - Added: `close\s+debt\s+deals?`, `deploy(?:ing)?\s+(?:the\s+)?capital`, `activate\s+.*pipeline`, `legal\s+[&+]\s+custody`, `\bthe\s+raise\b`
- Added `presence_only?: boolean` to `CapitalLogicProfileV1.prior_funding` type — signals when prior funding is inferred from text label without a dollar amount
- Added `detectPriorFundingPresenceOnly(text)` — matches patterns:
  - `raised (?:a )?(?:pre-seed|seed|series|safe|bridge) (?:round|funding)?`
  - `past: (?:pre-seed|seed|series|safe|bridge)`
  - `completed/closed (?:a )?(?:pre-seed|seed) (?:round|funding)`
  - Guarded against: `currently raising`, `we are raising`, `seeking $`, `actively raising`
- Added `document_full_texts?: string[] | null` to `inferCapitalLogicProfileV1` input
- In UOF detection: also scans `document_full_texts` using `USE_OF_FUNDS_TEXT_RE` → `source_path: 'document:full_text:uof_signal'`
- In prior funding: scans all texts (page + document) with `detectPriorFundingPresenceOnly` when no amount found

### 2. `apps/api/src/routes/financial-facts.ts`
**RC-S6-009 extraction infrastructure**

Added two new exported functions:
- `getDocumentFullTextForDeal(pool, dealId)` — returns `string[]` (up to 50K chars each, max 3 docs). Used by the compiler for team/fund/UOF extraction.
- `getCompanyNameFromDocuments(pool, dealId)` — returns `string | null`. Applies `extractCompanyNameFromFullText()` (private) to fetch and extract the best company name candidate.

Private helper `extractCompanyNameFromFullText(text)` tries 3 strategies in order:
1. **Copyright/watermark**: `©YYYY Company Name ·` pattern → catches "Climatic Capital" from `©2026 Climatic Capital Global ·`
2. **Legal entity**: `Name (Inc|LLC|Ltd|Corp|Holdings|Capital Management)` → catches "Persona AI" from "Persona AI Inc" in disclaimer
3. **Short early lines**: first 15 non-empty lines <70 chars, no colon, title-case/ALLCAPS

### 3. `apps/api/src/routes/reports.ts`
**RC-S6-009/010/008/007 — pass new data to compiler**

- Added `getDocumentFullTextForDeal`, `getCompanyNameFromDocuments` to import from `./financial-facts`
- **Bumped** `REPORT_COMPILER_VERSION = 37` with comment: "RC-S6 second pass — company_name, prior funding presence-only, UOF + team + fund deployment signals from document full_text"
- Updated **both call sites** (line ~2718 and ~3562) to:
  - Fetch `documentFullTexts` and `companyName` in parallel with `pageTexts` via `Promise.all`
  - Pass `documentFullTexts` and `companyName` to `compileDIOToReportWithPromotedFacts`

### 4. `packages/core/src/reports/compiler-simple.ts`
**RC-S6-007/008/009/010/011 — new structured_summary fields + extraction**

New optional fields added to `structured_summary` type (in `ReportDTO`):
```typescript
company_name?: string | null;
team_highlights?: Array<{ name: string; role: string; credential?: string | null }> | null;
fund_deployment_signals?: {
  debt_in_process?: { amount: number; raw: string } | null;
  deployment_pipeline?: { amount: number; raw: string } | null;
  target_irr?: string | null;
} | null;
use_of_funds_breakdown?: Array<{ category: string; amount_raw?: string; amount?: number }> | null;
```

New opts fields added to `compileDIOToReportWithPromotedFacts`:
```typescript
documentFullTexts?: string[] | null;
companyName?: string | null;
```

`inferCapitalLogicProfileV1` now receives `document_full_texts` from `opts.documentFullTexts`.

**Post-build enrichment block** (after `buildDeterministicDealSummaryV1FromStructuredSummary`):
- RC-S6-009: `company_name` from `opts.companyName` ?? `_extractCompanyNameFromTexts()`
- RC-S6-010: `team_highlights` from `_extractTeamHighlightsFromTexts()`
- RC-S6-008: `fund_deployment_signals` from `_extractFundDeploymentSignals()`
- RC-S6-007: `use_of_funds_breakdown` from `_extractUseOfFundsBreakdown()`

**New private helper functions** added at module level:
- `_extractCompanyNameFromTexts(texts)` — copyright + legal entity + short line strategies
- `_extractTeamHighlightsFromTexts(texts)` — 2-pass: ALL-CAPS (PAI-style) + Title Case (Climatic-style) within TEAM section. 2-word name constraint prevents geographic label contamination.
- `_extractFundDeploymentSignals(texts)` — `$Xm+ DEBT IN PROCESS`, `$Xm+ PIPELINE`, `X%+ Target IRR`
- `_extractUseOfFundsBreakdown(texts)` — parses `use of funds:`, `use of proceeds:`, `the raise:` sections; splits on `/` or `,`; stops at slide boundary markers
- `_parseMoneyAmountSimple(raw)` — parses `$XM`/`$XB`/`$XK` shorthand to numeric

### 5. `packages/core/src/models/__tests__/capital-logic-profile.test.ts`
4 new tests added:
- `RC-S6-005: prior_funding detected presence-only from "Raised Pre-seed Round" without dollar amount`
- `RC-S6-005: prior_funding detected presence-only from "Past: Pre-Seed Round" label pattern`
- `RC-S6-006: use_of_funds detected from Climatic "Close Debt Deals" fund deployment language`
- `RC-S6-006: use_of_funds detected from "The Raise" heading in document full_text`

All 11 tests pass.

---

## Blocked RCs

### RC-S6-012: Climatic project pipeline table
**Status: BLOCKED — upstream extraction gap**  
Root cause: DPU pages 6-12 for Climatic have no OCR text (`payload = {"labels": {}, "source": {...}}` only). The project pipeline table is on page ~10-11 of the Climatic deck. The `documents.full_text` also does not contain structured project table data. Requires re-running OCR/page analysis on those pages.

---

## Architecture Notes

### Data flow for new fields
```
documents.full_text
  ↓ getDocumentFullTextForDeal (financial-facts.ts)
  ↓ reports.ts Promise.all (parallel with pageTexts, companyName)
  ↓ compileDIOToReportWithPromotedFacts(opts.documentFullTexts, opts.companyName)
  ↓ inferCapitalLogicProfileV1(document_full_texts)  [prior funding + UOF]
  ↓ _extractTeamHighlightsFromTexts()                [team]
  ↓ _extractFundDeploymentSignals()                  [Climatic IaaS signals]
  ↓ _extractUseOfFundsBreakdown()                    [UOF items]
  ↓ structured_summary.{company_name, team_highlights, fund_deployment_signals, use_of_funds_breakdown}
```

### Why document full_text vs DPU page text?
DPU pages for Climatic (pages 6-12) are image-only with no extracted text. The `documents.full_text` field aggregates text from all pages via a separate extraction path and HAS the content (THE RAISE, team, etc.). This makes `full_text` the reliable source for all 3 deals' secondary extraction.

### Compiler VERSION guard
`REPORT_COMPILER_VERSION = 37` invalidates all cached v36 reports, forcing fresh recompilation with the new extraction logic.
