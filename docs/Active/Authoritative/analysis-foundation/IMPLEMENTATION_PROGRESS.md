# Implementation Progress — Analysis Foundation (Fundability System)

This document tracks **implementation progress** of the Analysis Foundation (Fundability System) specification.

- It is **non-normative**: it does not define the spec.
- The normative specification remains the Markdown set referenced in [CHANGELOG.md](CHANGELOG.md).

## Current Status (feature-flagged)

### Phase 1 — Shadow mode (parallel inference)
- Status: Implemented (flagged)
- Flag: `FUNDABILITY_SHADOW_MODE=1`
- Output: `dio.phase_inference_v1`, `dio.fundability_assessment_v1`
- Contract: additive only; does not change legacy `overall_score` or `decision`

### Phase 2 — Soft caps (score capping)
- Status: Implemented (flagged)
- Flags: `FUNDABILITY_SHADOW_MODE=1` and `FUNDABILITY_SOFT_CAPS=1`
- Output additions: `dio.fundability_assessment_v1.legacy_overall_score_0_100`, `dio.fundability_assessment_v1.fundability_score_0_100`
- Contract: legacy `overall_score` remains unchanged; fundability score may be capped

### Phase 3 — Hard gates (decision-aware output)
- Status: Implemented (flagged)
- Flags: `FUNDABILITY_SHADOW_MODE=1` and `FUNDABILITY_HARD_GATES=1`
- Output addition: `dio.fundability_decision_v1`
- Contract: additive only; does not change legacy `overall_score` or `decision`

## Consumer Rollout (stability-first)

Goal: allow the frontend UI to review fundability outputs via a **stable DTO** (without exposing raw DIO internals, and without changing legacy score usage).

- Contracts: Implemented — added `FundabilityV1DTO` and `deal.fundability_v1` (optional/additive)
- API (deal detail): Implemented — `GET /api/v1/deals/:deal_id` now includes `fundability_v1` when present in latest DIO
- API (deal list): Implemented — `GET /api/v1/deals` includes a compact `fundability_v1` payload (same field, sliced from latest DIO)
- API tests: Implemented — contract-mapping test ensures presence and preserves legacy `score`
- Web UI: Implemented — read-only “Fundability (Analysis Foundation)” panel on Deal Workspace overview when `fundability_v1` is present
	- Web UI (dashboard list): Implemented — Active Deals cards show a one-line fundability summary when available

Notes:
- `fundability_v1` is currently emitted on deal detail responses only (not required on the deals list).
- No score-source switching has been introduced yet; legacy score remains the default display.

## Notes

- All flags are read as truthy when set to `1`, `true`, or `yes`.
- Implementation lives in `packages/core` and is designed to remain backwards compatible.
