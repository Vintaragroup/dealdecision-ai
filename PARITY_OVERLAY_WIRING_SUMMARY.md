# Parity Overlay Wiring Summary (Persisted Governed Overlay)

## Goal
Wire the **persisted governed overlay** into both:
- **Web Deal Workspace** (React)
- **Dev Dashboard → Workspace Mirror** (server-rendered HTML + embedded JS)

While preserving the hard contract:
- Deterministic report trees remain authoritative.
- Overlay content is interpretation-only.
- Overlay fetch/render must **fail open** (never blocks deterministic UI).
- Overlay must **never be merged** into deterministic structures.

## Endpoint precedence
1) Prefer persisted governed overlay:
- `GET /api/v1/deals/:deal_id/governed-llm-overview`
- Returns `{ overview: { summary_text, claims, disclosures, input_hash, llm_phase_mode, created_at, ... } | null }`

2) Fallback / legacy narrated overlay:
- `GET /api/v1/deals/:deal_id/report?narrate=1`
- Used for legacy `llm_overview_v1` / `llm_narration_v1` payloads

## Web: Deal Workspace
**Behavior**
- When the user opens the interpretation panel in “Investment Analysis Overview”, the page fetches the overlay lazily.
- Fetch order: **persisted first**, then **fallback to narrated**.
- Any overlay failure results in `overlay_source: none` and the deterministic page continues rendering.

**Where**
- Web API client for persisted overlay: apps/web/src/lib/apiClient.ts
- Overlay selection logic: apps/web/src/lib/preferredOverlay.ts
- Wiring into Deal Workspace orchestration: apps/web/src/components/pages/DealWorkspace.tsx
- Rendering (source labeling, claims/disclosures, phase badge): apps/web/src/components/workspace/dealworkspace_overview_comp.tsx

**Notes**
- Interpretation text uses persisted `summary_text` when available.
- A phase badge uses `overview.llm_phase_mode` when present (fallbacks to deal phase mode when not).

## Dashboard: Workspace Mirror
**Behavior**
- “Load governed overlay” now loads and displays:
  - A top **Persisted Governed Overlay (PR2) — Non-Authoritative** panel populated from `/governed-llm-overview`.
  - The legacy narrated “compare blocks” panel populated from `/report?narrate=1` (kept for parity / debugging).
- The persisted overlay panel fails open independently (provider error / none / present).

**Where**
- HTML section + JS wiring: apps/api/src/routes/dashboard.ts
  - DOM targets:
    - `deterministic-overlay-persisted-status`
    - `deterministic-overlay-persisted-content`
  - Functions:
    - `fetchPersistedGovernedOverview(dealId)`
    - `renderPersistedGovernedOverlayPanel({ baseOk, result })`
    - `loadDeterministicOverlay(dealId)` now calls persisted first, then narrated.

## Tests
- Web overlay precedence + fallback + fail-open:
  - apps/web/src/__tests__/DealWorkspace.governedOverlayFetch.test.tsx

- Dashboard HTML/JS contract smoke test updated to include persisted overlay shell + wiring:
  - apps/api/src/__tests__/dashboard-browser-contract.smoke.test.ts

## Acceptance checklist
- [x] Web Deal Workspace prefers persisted overlay; falls back to narrated overlay.
- [x] Web never blocks deterministic rendering if overlay fails.
- [x] Dashboard Workspace Mirror renders a persisted overlay panel and keeps legacy narrated compare blocks.
- [x] Persisted overlay is not merged into deterministic structures.
- [x] Minimal tests updated to lock in wiring + contract.
