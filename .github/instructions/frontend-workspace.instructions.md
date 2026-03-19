---
applyTo: "apps/web/**"
---

# Frontend Workspace Instructions

Use these docs first:
- docs/DOCS_GOVERNANCE_INDEX.md
- docs/Foundation/REPORT_COMPILER_AND_PAYLOAD.md
- docs/Foundation/INVESTOR_INSIGHTS_AND_SCORING.md
- docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md

## Core rule

Do not assume the frontend is consuming one clean authoritative output.

Always determine whether a UI surface is using:
- standard /report payload
- investor insights payload
- orchestrator report output
- locally adapted/derived view-model data

Do not present these as equivalent unless the implementation explicitly unifies them.

## Required system flow

API payload → selectors/adapters/view-model builders → workspace section component → rendered UI

If a proposed UI change does not trace through this flow cleanly, stop and verify.

## Non-negotiable guardrails

- Do not assume a single canonical score exists
- Do not merge report and investor-insights fields blindly
- Do not hide missing-data states behind polished UI language
- Do not present projected financials as current-state financials
- Do not present investor-insights-only interpretations as standard report facts unless explicitly intended
- Do not embed payload interpretation logic directly in deeply nested components when a selector/adapter should own it

## Data clarity rules

Always preserve distinctions between:
- current vs projected financials
- deck-derived vs xlsx-derived signals
- standard report vs investor insights
- deterministic vs interpreted content
- canonical field vs UI convenience fallback

If the backend is ambiguous, surface that ambiguity honestly rather than collapsing it.

## Score/display rules

Before touching any score UI, verify:
- where the score comes from
- whether multiple scores exist for the same deal
- whether the UI is using canonical selection logic or local fallback logic
- whether the score is standard report, investor insights, or orchestrator derived

Do not create new score display paths without checking existing selector logic.

## Payload usage rules

When wiring new backend fields into the UI:
- prefer selectors/adapters over inline interpretation
- preserve source clarity
- preserve confidence/missingness states
- do not duplicate transform logic across tabs/components
- verify whether the field exists on cache hits and persisted payloads, not only live compile responses

## Known risk areas

Always verify:
- deal workspace top section score/source behavior
- financial coverage panel vs deeper financial analysis sections
- investor insights tab vs overview/analysis tabs
- hidden payload sections not surfaced in UI
- dead or hardcoded tabs/components
- route payload differences masked by adapters

## Required behavior when uncertain

If uncertain:
1. check Foundation docs
2. trace the actual API field and selector path
3. verify which payload the component is really using
4. do not guess

## Style

- explicit over implicit
- selector-driven
- source-aware
- preserve UI honesty around missing or conflicting data
- minimal safe changes
