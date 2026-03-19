---
applyTo: "apps/worker/src/jobs/investor-insights/**,apps/api/src/routes/deals/investor-insights.routes.ts,apps/worker/src/orchestrator/**"
---

# Investor Insights Instructions

Use these docs first:
- docs/DOCS_GOVERNANCE_INDEX.md
- docs/Foundation/INVESTOR_INSIGHTS_AND_SCORING.md
- docs/Foundation/FINANCIAL_PIPELINE.md
- docs/Foundation/REPORT_COMPILER_AND_PAYLOAD.md
- docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md

## Core rule

Investor insights is not the same system as standard /report.

Do not assume:
- investor insights outputs automatically appear in /report
- investor-insights interpretation is canonical report truth
- deeper insight-stage understanding is already surfaced in standard API responses

Always determine explicitly whether a change belongs to:
- investor insights only
- standard /report only
- a shared canonical layer

## Required system flow

inputs → deterministic stages → optional LLM/governed stages → render package / persisted insight state → API route → frontend consumer

If a change does not map cleanly to this flow, stop and verify.

## Non-negotiable guardrails

- Do not leak investor-insights-only interpretation into /report without explicit integration
- Do not assume deterministic stage outputs are automatically persisted in a form consumed by standard report routes
- Do not create duplicate canonical objects when a shared one should exist
- Do not merge governed LLM interpretation with deterministic facts without preserving source clarity
- Do not change stage behavior without checking gates, persisted states, and downstream consumers
- Do not guess which layer owns a field

## Stage-awareness rules

Before changing investor insights behavior, identify:
- which stage owns the behavior
- whether the output is deterministic, governed-LLM, render-package, or persisted-report state
- whether the output is used only by investor insights UI or reused elsewhere
- whether the output is canonical, advisory, or presentational

Always preserve the distinction between:
- deterministic slot inputs
- governed summaries
- limited scoring / fusion outputs
- render-package outputs
- orchestrator report outputs

## Shared-layer rules

If a capability discovered in investor insights should become reusable elsewhere:
- explicitly define the shared canonical object
- explicitly define persistence path
- explicitly define /report integration path
- do not rely on implicit similarity between systems

Do not assume "exists in investor insights" means "safe to reuse in standard report."

## Known risk areas

Always verify:
- stage gating and early-exit paths
- "deterministic_only" vs complete-state persistence behavior
- financial_facts_v1 bridge assumptions
- render-package fields that are not surfaced elsewhere
- worker/API desync
- shadow-system capabilities that standard report does not yet expose

## Required behavior when uncertain

If uncertain:
1. check Foundation docs
2. trace the exact investor-insights stage path
3. determine whether the output is deterministic, governed, persisted, or presentational
4. do not guess

## Style

- deterministic first
- stage-aware
- source-aware
- minimal safe changes
- explicit boundary between investor insights and standard report
