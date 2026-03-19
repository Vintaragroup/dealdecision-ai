---
applyTo: "apps/api/src/routes/reports.ts,packages/core/src/reports/**,packages/core/src/models/**"
---

# Report Payload Instructions

Use these docs first:
- docs/DOCS_GOVERNANCE_INDEX.md
- docs/Foundation/REPORT_COMPILER_AND_PAYLOAD.md
- docs/Foundation/ARCHITECTURE_BASELINE.md
- docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md

## Core rule

Treat /report as a governed contract.

Do not make report changes without tracing:
- where the field is built
- whether it is compiler-built or route-enriched
- whether it is persisted in ingestion_reports
- whether it is present in dio_data.report
- whether it is affected by cache/compiler-version behavior

## Required system flow

DIO / facts / registries → compiler → route enrichments → cache persistence → API response → UI

If a proposed change does not map cleanly to this flow, stop and verify.

## Non-negotiable guardrails

- Do not introduce duplicate report computation paths
- Do not add route-only enrichments that disappear on persisted-report bypasses
- Do not patch stale cache behavior with business logic hacks
- Do not assume cache miss behavior equals steady-state production behavior
- Do not create a new payload source of truth when an existing governed field already exists
- Do not silently change payload semantics without intentional compiler-version handling

## Cache and persistence rules

Before changing report behavior, always check:
- REPORT_COMPILER_VERSION
- ingestion_reports
- dio_data.report
- any in-memory or LLM cache used by the route
- whether persisted reports will bypass your new logic

If a field only appears on cache miss and disappears on cache hit, the implementation is incomplete.

If you materially change compiled report semantics, update compiler-version handling intentionally.

## Field construction rules

For every report field you touch, explicitly determine:
- source data
- transform logic
- confidence/fallback behavior
- persistence path
- frontend consumer(s)

Avoid fields that are:
- recomputed multiple times without need
- built once in compiler and again differently in routes
- inconsistent between standard and versioned report endpoints

## Existing governed areas

Pay special attention to:
- structured_summary
- deal_summary_v1
- topsection_v1
- financial_coverage_v1
- financial_breakdown_v1
- underwriting_readiness_v1
- score_explanation
- decision metadata
- investment_analysis_overview_v2

Prefer extending existing governed objects over inventing parallel ones.

## Known risk areas

Always verify for:
- duplicate summary logic
- stale worker-persisted report payloads
- route-enriched metadata not present on persisted bypasses
- standard /report vs versioned /report/:version mismatches
- fields present in ingestion_reports but not dio_data.report
- fields present in compiler output but not surfaced consistently in API responses

## Required behavior when uncertain

If uncertain:
1. check Foundation docs
2. trace the actual route/compiler/cache path
3. inspect persistence behavior
4. do not guess

## Style

- deterministic first
- contract-aware
- minimal production-safe changes
- preserve backward compatibility unless contract change is explicit
- prefer one clear computation path over overlapping ones
