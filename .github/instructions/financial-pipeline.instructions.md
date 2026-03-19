---
applyTo: "apps/api/src/routes/financial-facts.ts,apps/api/src/routes/reports.ts,apps/worker/src/extraction/xlsx/**,apps/worker/src/lib/financial-*.ts,apps/worker/src/lib/cap-table-*.ts,apps/worker/src/lib/financial-facts/**,packages/core/src/models/financial-*.ts,packages/core/src/reports/**"
---

# Financial Pipeline Instructions

Use these docs first:
- `docs/DOCS_GOVERNANCE_INDEX.md`
- `docs/Foundation/FINANCIAL_PIPELINE.md`
- `docs/Foundation/REPORT_COMPILER_AND_PAYLOAD.md`
- `docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md`
- `docs/Foundation/INVESTOR_INSIGHTS_AND_SCORING.md` when the task touches investor insights behavior

## Source-of-truth hierarchy

Always distinguish between:
1. XLSX financial model facts
2. Cap table facts
3. Verified structured extraction from other sources
4. Deck language / narrative claims
5. Investor-insights-only interpretation

Default truth priority:
- `xlsx` structured facts > cap table structured facts > verified structured extraction > deck language

Do not overwrite structured financial facts with deck assumptions or marketing language.

## Required system flow

Trace changes through the full financial path:

`ingestion -> extraction -> DPU/registries -> financial_facts_v1 -> report compiler -> cache/persistence -> API response -> UI`

If a proposed change does not map cleanly to this path, stop and verify the architecture before implementing.

## Non-negotiable guardrails

- Do not introduce a new source of truth when one already exists
- Do not create duplicate financial pipelines
- Do not treat forward-looking deck language as structured projected financial data
- Do not assume missing data means negative evidence
- Do not merge deck, xlsx, cap table, and investor-insights outputs blindly
- Do not patch over stale cache issues with business logic hacks

## Financial interpretation rules

Always separate:
- current-state financials
- projected financials
- assumptions
- cap table / dilution
- underwriting interpretation

Do not collapse these into a single vague "financials present" concept.

Examples of invalid behavior:
- raise amount interpreted as revenue
- TAM/SAM/SOM interpreted as operating metrics
- deck "ARR potential" interpreted as actual ARR
- investor-insights narrative treated as canonical `/report` fact without explicit integration

## Report integration rules

Before changing report-facing financial behavior, check:
- `REPORT_COMPILER_VERSION`
- `ingestion_reports`
- `dio_data.report`
- route-layer enrichments
- `compileDIOToReportWithPromotedFacts`
- `financial_facts_v1` load path
- whether the same change affects both standard `/report` and versioned `/report/:version`

Never add a field that appears only on cache miss and disappears on cache hit.

Never add route-only financial enrichments without verifying persisted-report behavior.

## Existing financial objects

Check whether the concept already exists in one of these before adding anything new:
- `financial_facts_v1`
- `financial_coverage_v1`
- `financial_breakdown_v1`
- `underwriting_readiness_v1`

Prefer extending existing governed objects over inventing parallel ones.

## Investor insights boundary

Investor insights may contain deeper or broader financial interpretation than standard `/report`.

When changing financial logic, explicitly decide whether the change is:
- standard report only
- investor insights only
- a shared canonical layer

Do not assume investor insights automatically flows into `/report`.

## Known risk areas to verify

Pay special attention to:
- xlsx row truncation or preview-only behavior
- source-rank issues (`pdf_table` vs `xlsx`)
- cap table parsing and surfacing gaps
- stale cached reports hiding new compiler behavior
- worker/API compilation differences
- route-level metadata that may not persist
- duplicated summary logic across compiler and routes

## Required behavior when uncertain

If uncertain:
1. check the Foundation docs
2. trace the actual code path
3. inspect current persistence/caching behavior
4. do not guess

## Preferred implementation style

- deterministic first
- source-aware
- minimal production-safe changes
- preserve backward-compatible payload behavior unless contract changes are intentional
- prefer explicit comments when a distinction matters, especially current vs projected and xlsx vs deck
