# Workspace Mirror vs Deal Workspace — Parity Discovery (read-only)

## Scope
This document maps the **Dev Dashboard “Workspace Mirror”** implementation to the **Web App Deal Workspace** implementation, with a parity matrix for:
- Deterministic overview blocks
- “Governed overlay” / narrated report behavior
- PR2 overlay-related fields (persisted governed overlay endpoint + phase mode)

No code changes were made for this discovery.

---

## Workspace Mirror (Dev Dashboard) — wiring overview

### Where it lives
- Workspace Mirror is **not** a React tab; it is server-rendered Dev Dashboard UI + embedded client-side JS in:
  - [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L880-L1010)

### UX / user contract
- The tab explicitly states it:
  - “mirrors the Web App Overview blocks 1:1”
  - compares deterministic (authoritative) vs governed overlay (interpretation)
  - fetches narrated overlay only on click
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L900-L970)

### Endpoints it calls
- Deterministic load fetches 3 payloads in parallel:
  - `/api/dashboard/deals/:id/deterministic`
  - `/api/v1/deals/:id/report`
  - `/api/v1/deals/:id`
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L4902-L5006)

- Narrated overlay fetch is a separate call to `/api/v1/deals/:id/report?narrate=1` with a 180s timeout:
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L5235-L5295)

### Mapping model (“compare blocks”)
- The block-by-block mapping is built by `buildWorkspaceMirrorModel(deterministicReport, narratedReport, deterministicDeal)`:
  - Evidence (function + canonical deal summary extraction): [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L1927-L2068)
  - Evidence (overlay extraction + block list): [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2480-L2663)

- Critical rule: **governed overlay values come ONLY from `llm_overview_v1`** in the narrated report:
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2520-L2558)

- Workspace Mirror block keys (deterministic vs overlay):
  - `hero` (hero strip)
  - `deal_summary` (3 depths)
  - `investment_overview` (Investment Analysis Overview)
  - `strengths`
  - `concerns`
  - `coverage_gaps`
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2559-L2663)

### Rendering behavior
- If narrated report is missing, the panel instructs you to click **Load governed overlay** to fetch `/report?narrate=1`:
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2945-L2987)

- Once both base + narrated are available, it renders a **side-by-side compare** with a diff badge:
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2850-L2936)

---

## Deal Workspace (Web App) — wiring overview

### Where it lives
- Page container / data loading:
  - [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L640-L805)
- Overview card & “Show interpretation” UI:
  - [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L230-L316)

### Endpoints it calls
- Deterministic report:
  - Web calls `apiGetDealReport(dealId)`
  - Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L667-L707)

- Narrated (interpretation) report:
  - Web calls `apiGetDealReportNarrated(dealId)` which resolves to `/api/v1/deals/:dealId/report?narrate=1`
  - Evidence (call site + gating): [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L738-L804)
  - Evidence (API client path composition): [apps/web/src/lib/apiClient.ts](apps/web/src/lib/apiClient.ts#L1474-L1496)

### Fetch gating / lazy-load behavior
- Deal Workspace only fetches narrated overlay **after user action** and only if the deterministic report is ready:
  - `loadGovernedOverlay` early-returns unless `reportReady` is true
  - Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L738-L753)

- The UI button toggles “Show interpretation” and triggers `onRequestInterpretation()` only when opened:
  - Evidence: [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L260-L309)

- This behavior is explicitly tested:
  - “does not fetch narrated report on mount; fetches only after user opens interpretation panel”
  - Evidence: [apps/web/src/__tests__/DealWorkspace.governedOverlayFetch.test.tsx](apps/web/src/__tests__/DealWorkspace.governedOverlayFetch.test.tsx#L51-L114)

### What the overlay is used for in Web
- Deal Workspace extracts `llm_overview_v1.investment_analysis_overview` as the **only displayed** overlay content (“Interpretation”):
  - Evidence (extract + nullability): [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L714-L736)
  - Evidence (display-only interpretation panel): [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L250-L307)

- Web does **not** use `llm_overview_v1.strengths_overlay`, `concerns_overlay`, or `coverage_gaps_overlay` anywhere in `apps/web/src` (no references found by search); the Strengths/Concerns/Coverage sections in the Overview card render from deterministic props.

---

## Parity Matrix

Legend:
- **Present** = implemented and wired
- **Partial** = present but different shape/UX
- **Absent** = not wired

| Concern / Field | Workspace Mirror (Dev Dashboard) | Deal Workspace (Web App) | Notes |
|---|---|---|---|
| Deterministic report endpoint | **Present** (`/api/v1/deals/:id/report`) | **Present** (`/api/v1/deals/:id/report`) | Mirror fetches report directly in dashboard JS; Web does via api client. Evidence: Mirror [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L4902-L5006); Web [apps/web/src/lib/apiClient.ts](apps/web/src/lib/apiClient.ts#L1486-L1496). |
| Narrated/overlay report endpoint | **Present** (`/api/v1/deals/:id/report?narrate=1`) | **Present** (`/api/v1/deals/:id/report?narrate=1`) | Both use the narrated report for overlay content. Evidence: Mirror [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L5235-L5295); Web [apps/web/src/lib/apiClient.ts](apps/web/src/lib/apiClient.ts#L1486-L1496). |
| Lazy fetch (user action) | **Present** (“Load governed overlay” button) | **Present** (“Show interpretation” button) | Mirror explicitly says “only on click”. Evidence: Mirror UI text [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L920-L936); Web toggle [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L260-L309). |
| Gating on deterministic readiness | **Partial** | **Present** | Web refuses narrated fetch unless `reportReady`. Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L738-L753). Mirror requires base report loaded to populate, but it does not enforce “report.ready=true” before allowing the click; it just requires a base payload to be present. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2945-L2987). |
| Overlay source of truth | **Present**: `llm_overview_v1` | **Present**: `llm_overview_v1` | Mirror states “overlay values come ONLY from llm_overview_v1”. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2520-L2558). Web extracts `investment_analysis_overview` from the same object. Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L714-L736). |
| Overlay field: `investment_analysis_overview` | **Present** (compare view) | **Present** (display-only interpretation) | Mirror includes it as block `investment_overview`. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2596-L2622). Web displays it in Interpretation panel. Evidence: [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L250-L307). |
| Overlay fields: `hero_header`, `deal_summary.{hero,mid,long}` | **Present** | **Absent** | Mirror compares these overlay fields. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2559-L2595). Web does not render overlay hero/deal-summary tiers (only deterministic deal summary). |
| Overlay fields: `strengths_overlay`, `concerns_overlay`, `coverage_gaps_overlay` | **Present** | **Absent** | Mirror compares these overlays for 3 additional blocks. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2623-L2663). Web has no references to these fields and renders Strengths/Concerns from deterministic props. |
| LLM narration extra (`llm_narration_v1`) | **Present** (extra panel) | **Absent** | Mirror includes an extra panel fed from `response.report.llm_narration_v1`. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L980-L1006) and narrated fetch extraction [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L5248-L5263). |
| Deterministic drift check (`/report` vs `/report?narrate=1`) | **Present** | **Absent** | Mirror has a “Deterministic Drift Check” panel. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L900-L915) and it re-renders overlay panel after narrated fetch. Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L5098-L5126). |
| Persisted governed overlay endpoint (`/governed-llm-overview`) | **Absent** | **Absent** | Endpoint exists in API but neither UI flow uses it; both use narrated `/report?narrate=1`. Endpoint definition: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L8567-L8690). |
| PR2 persisted fields: `summary_text`, `claims`, `disclosures`, `input_hash`, `llm_phase_mode` | **Absent** | **Absent** | These exist on `/governed-llm-overview` response, but are not surfaced in Workspace Mirror nor Deal Workspace as currently wired. Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L8567-L8690). |
| Deal `llm_phase_mode` surfaced in UI | **Absent** | **Absent** (only exported in DealsList mapping) | Web references it in exports only. Evidence: [apps/web/src/components/pages/DealsList.tsx](apps/web/src/components/pages/DealsList.tsx#L1044). No evidence of it being displayed in Deal Workspace or Mirror. |

---

## Explicit “missing items” list (if Workspace Mirror must match Deal Workspace UX)

These are items the Web App has (or behaviors it enforces) that Workspace Mirror does not currently replicate inside the Mirror panel.

1) **Top KPI tiles / structured summary highlights**
- Deal Workspace renders fields like `structured_summary.raise` and `structured_summary.business_model` (example verified by test assertions that the values appear in the DOM).
  - Evidence: [apps/web/src/__tests__/DealWorkspace.governedOverlayFetch.test.tsx](apps/web/src/__tests__/DealWorkspace.governedOverlayFetch.test.tsx#L55-L105)
- Workspace Mirror’s compare model is limited to 6 overview blocks (`hero`, `deal_summary`, `investment_overview`, `strengths`, `concerns`, `coverage_gaps`).
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2559-L2663)

2) **Interpretation is scoped to “Investment Analysis Overview” only**
- Web: overlay is presented only as the “Interpretation” panel under Investment Analysis Overview.
  - Evidence: [apps/web/src/components/workspace/dealworkspace_overview_comp.tsx](apps/web/src/components/workspace/dealworkspace_overview_comp.tsx#L250-L307)
- Mirror: shows overlay comparisons for additional blocks (hero strip, deal summary tiers, strengths, concerns, coverage gaps).
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L2559-L2663)

If the goal is strict Web UX parity, Mirror would need to either:
- hide overlay comparisons for those other blocks, or
- clearly call out that Mirror is a superset/debug compare view (not the same UX contract).

---

## Explicit “extra items” Workspace Mirror has (beyond Deal Workspace)

- `llm_narration_v1` extra panel
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L980-L1006)
- Deterministic drift check between `/report` and `/report?narrate=1`
  - Evidence: [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts#L900-L915)

---

## Key takeaway
Both **Workspace Mirror** and **Deal Workspace** currently treat “governed overlay” as **the narrated report** (`/api/v1/deals/:id/report?narrate=1`) and specifically **`llm_overview_v1`**. The newer PR2 persisted governed overlay endpoint (`/api/v1/deals/:id/governed-llm-overview`) exists but is not wired into either UI flow.
