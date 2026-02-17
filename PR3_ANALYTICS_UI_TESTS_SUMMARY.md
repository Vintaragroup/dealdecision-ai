# PR3 Dev Dashboard Analytics Tab + Minimal Tests — Summary

## Goal
Ship the Dev Dashboard “Analytics” main tab as a **read-only** view over the persisted diagnostics snapshot, plus minimal tests for the new API endpoint and worker-side pure analytics builders.

## What shipped
### Dev Dashboard
- Adds a new deterministic main tab: **Analytics**.
- Fetches `GET /api/v1/deals/:deal_id/analysis-diagnostics` (best-effort) and renders 4 panels:
  - Overlay Governance
  - Hallucination / Guard Health
  - Drift
  - Deterministic Diagnostics Snapshot
- Null-safe behavior: if no diagnostics exist, shows **“No diagnostics yet — run analysis.”** and does not block other dashboard panels.
- Metadata shown:
  - `report_id` (from diagnostics snapshot)
  - `created_at` (from diagnostics snapshot)
  - `input_hash` (from `report.metadata.deterministic_score_inputs_v1.inputs_hash` in the deterministic report payload)

### Tests
- API tests (node:test + Fastify inject)
  - Returns `{ diagnostics: null }` when no snapshot exists.
  - Returns a populated diagnostics object when a snapshot exists (including numeric coercion from string DB values).
- Worker tests (Vitest)
  - `computeOverlayGovernanceMetrics()`
  - `computeDeterministicDiagnostics()`
  - `computeDriftMetrics()`

## Important notes / constraints honored
- No deterministic scoring logic was changed.
- No overlay generation/enforcement behavior was changed.
- Diagnostics are displayed as **non-authoritative** and must not affect deterministic report output.
- Current diagnostics persistence schema does **not** include every field requested in the dashboard panel spec (e.g., `numeric_claims_total`, `claims_removed_by_phase_enforcement`, `overlay_suppression_count`, `guard_degraded_count`, `missing_kpi_count`, `extraction_confidence`).
  - The Analytics UI renders those as **“(not available)”** placeholders to avoid accidental inference.

## Files changed / added
- apps/api/src/routes/dashboard.ts
- apps/api/src/__tests__/deals-analysis-diagnostics-get.test.ts (new)
- apps/worker/src/lib/__tests__/analysis-diagnostics.test.ts (new)

## Validation
- `pnpm -r typecheck`
- `pnpm -r test`

Both completed successfully.
