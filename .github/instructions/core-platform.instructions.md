---
applyTo: "apps/api/**,apps/worker/**,packages/core/**,infra/**"
---

# Core Platform Instructions

Use these docs first:
- docs/DOCS_GOVERNANCE_INDEX.md
- docs/Foundation/ARCHITECTURE_BASELINE.md
- docs/Foundation/INGESTION_AND_EXTRACTION.md
- docs/Foundation/RUNTIME_AND_DEPLOYMENT.md
- docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md

## Core rule

Treat the platform as one connected system, not isolated files.

Always trace work across the real system flow:

ingestion → extraction → DPU/registries → facts/models → report compiler / investor insights → cache/persistence → API response → frontend consumer

If a proposed change does not map cleanly to this end-to-end flow, stop and verify.

## Non-negotiable guardrails

- Do not introduce new sources of truth when governed ones already exist
- Do not create duplicate paths for ingestion, fact generation, report compilation, or scoring
- Do not make route-level changes without checking persistence/caching behavior
- Do not assume local/dev behavior equals production/Render behavior
- Do not assume migrations are automatic
- Do not patch around runtime/caching problems with business-logic hacks

## Runtime and deployment rules

Before making changes that affect system behavior, verify:
- Render service boundaries
- API vs worker responsibilities
- queue/job ownership
- migration requirements
- environment/config assumptions
- cache/compiler-version behavior
- fail-open vs fail-closed behavior

Do not add code that depends on undeployed schema, implicit env vars, or unverified service ordering.

## Job / queue awareness

When changing worker or ingestion behavior, always identify:
- what job owns the change
- what queue it runs on
- upstream dependency
- downstream consumer
- whether sequencing/race risks exist
- whether partial-state writes are possible

Do not assume best-effort cascades are strongly ordered.

## Persistence rules

For any new or changed data, explicitly determine:
- storage location
- source of truth
- read path
- cache path
- whether the value persists across restarts and cache hits

Do not create values that exist only transiently unless that is intentional.

## Existing governed areas

Check existing governed objects and paths before adding anything new:
- document_page_understanding
- evidence_items
- page_registry_v1
- deal_facts_v1
- financial_facts_v1
- deal_intelligence_objects
- ingestion_reports

Prefer extending governed structures over parallel ones.

## Known risk areas

Always verify:
- race conditions between extraction/DPU/analyze steps
- stale caches masking new code
- worker/API compilation differences
- schema drift between code and deployed DB
- source attribution loss across pipeline stages
- duplicated logic across compiler, route, and UI layers

## Required behavior when uncertain

If uncertain:
1. check Foundation docs
2. trace the actual end-to-end code path
3. inspect persistence/runtime/cache behavior
4. do not guess

## Style

- deterministic first
- end-to-end aware
- minimal production-safe changes
- preserve governed flows and backward compatibility unless change is explicit
