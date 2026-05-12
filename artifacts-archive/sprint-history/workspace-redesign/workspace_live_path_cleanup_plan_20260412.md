# Deal Workspace Live-Path Cleanup Plan — April 12, 2026

## 1. Field Classification Summary
_Status codes: LC = live & correct, LW = live but wrong source, LL = live but legacy (ignores canonical), DC = dead code, MO = mock-only._

| Field | Status | Evidence |
|---|---|---|
| Company name (hero header) | LL | Still bound to `dealInfo?.name || dealData?.name` (`apps/web/src/components/pages/DealWorkspace.tsx:2203`), ignoring RC-S6 `structured_summary.company_name` (absent yet but will arrive). |
| Company description | LW | `buildWorkspaceViewModel` prioritizes governed overlay (`governedDealOneLiner`) before deterministic tiers (`apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts:560-585`). |
| Product summary | LW | `overviewProductCanonical` falls through DIO text before deterministic slots (`apps/web/src/components/pages/DealWorkspace.tsx:3761-3775`); `product_summary_v1` never rendered. |
| Market summary | LC for Climatic only (since `market_summary_v1` present) but LW elsewhere | Same fallback chain as product. |
| Business model | LC when arbitration present; LW otherwise | `selectAuthoritativeBusinessModelV1` falls back to Phase1 legacy if structured summary flagged “ready but missing” (`apps/web/src/lib/selectors/selectAuthoritativeBusinessModelV1.ts`). |
| Raise | LW | Missing `structured_summary.raise` (PAI/WeWork) causes fallback to `reportView.raise`/DIO text (`apps/web/src/components/pages/DealWorkspace.tsx:3771-3785`). |
| Funding stage | LC | `selectDealWorkspaceHeader` pulls `funding_stage_v1` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx:103-206`). |
| Team highlights / UOF / pipeline / revenue model | LL | Extracted in compiler-simple (`packages/core/src/reports/compiler-simple.ts:2811-2845`) but never read by UI. |
| Red flags | LC | Sourced from `reportFromApi.redFlags` (`apps/web/src/components/pages/DealWorkspace.tsx:8455-8486`). |
| Investment snapshot | LC | Bound to `investment_analysis_overview_v2.summary_medium` (`apps/web/src/components/pages/DealWorkspace.tsx:5405-5419`). |
| Financial audit metrics | LC | `useFinancialAuditData` consumes authoritative selectors (`apps/web/src/hooks/useFinancialAuditData.ts`). |
| Investor Insights modules | LL | Tab still renders `investor-insights/legacy/*` skeletons rather than the render-package-native components (`apps/web/src/components/workspace/InvestorInsightsTab.tsx:25-34`). |
| Deal Deep Dive | LC | Direct GET `/deep-dive`. |

## 2. Phase1/DIO/Legacy Touch Points
1. `overviewDealOneLiner`, `overviewProduct`, `overviewMarketIcp` (`apps/web/src/components/pages/DealWorkspace.tsx:2315-2351`): direct reads from `overviewV2`/`executive_summary_v*` even when structured summary ready.
2. Canonical fact builder (`apps/web/src/components/pages/DealWorkspace.tsx:3761-3785`): deterministic slot fallback inserted before overlay, but still ends in Phase1 text.
3. Raise canonicalization uses `reportView.raise` (Deal summary) and `overviewRaiseTerms` when structured null (`apps/web/src/components/pages/DealWorkspace.tsx:3771-3785`).
4. Company description pipeline uses overlay/gov copy before deterministic summary (`apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts:560-585`).
5. Investor Insights tab still instantiates `legacy/ExecutivePulse`, etc., meaning render-package schema is mapped through old mock adapters (`apps/web/src/components/workspace/InvestorInsightsTab.tsx:25-34`).
6. Company name never flows through `structured_summary.company_name`, so even when compiler writes it nothing changes (`apps/web/src/components/pages/DealWorkspace.tsx:2203`).

## 3. Minimum Cleanup Patch
1. **Company identity binding**
   - Update `buildWorkspaceViewModel` to read `reportFromApi.structured_summary.company_name` before deal metadata (`apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts:569-575`).
   - Ensure `/report` delivers the field by rerunning compiler-simple (already RC-S6). No UI fallback to metadata once structured ready.
2. **Deterministic-first key facts**
   - In `apps/web/src/components/pages/DealWorkspace.tsx`, reorder `_productBase`, `_marketBase`, `_businessModelBase`, and `overviewDealOneLiner` to consume `report.structured_summary.*`/`deal_summary_v1` before any Phase1/overlay inputs.
   - Remove direct reads of `overviewV2.*` from `overviewProduct`/`overviewMarketIcp`; use selectors that respect evidence.
3. **Raise enforcement**
   - Block fallback to `reportView.raise` unless `structured_summary.raise` is null *and* compiler flagged `null_rule`. Display “Not disclosed” rather than DIO string; optionally surface `null_reason` from compiler (`apps/web/src/components/pages/DealWorkspace.tsx:3771-3785`).
4. **Render RC-S6 enrichments**
   - Add components under Overview or Deal Deep Dive to display `structured_summary.team_highlights`, `use_of_funds_breakdown`, `project_pipeline`, and `revenue_model`.
   - Hooks live in `selectDealWorkspaceOverviewModel` or new selectors; this will eliminate analysts digging through full-text JSON.
5. **Investor Insights tab modernization**
   - Replace imports from `investor-insights/legacy/*` with native render-package visualizations (existing `investorInsightsUtils` already parse the schema).
6. **Document trust-state guardrails**
   - Annotate each `workspaceOverviewModel` field with the trust state needed (`structured_summary.ready`, `investor_insights.status_summary`), ensuring UI doesn’t silently drift back to Phase1 when new compiler versions ship.

## 4. Deliverables for Cleanup
- Patch 1 (company identity) touches `apps/web/src/components/pages/DealWorkspace.tsx` and `buildWorkspaceViewModel.ts`.
- Patch 2 (deterministic-first facts + raise) confined to `DealWorkspace.tsx` plus `selectDealWorkspaceOverviewModel.ts` if new field metadata required.
- Patch 3 (RC-S6 surfacing) adds view components in `apps/web/src/components/workspace/DealWorkspace_overviewTab_v3.tsx` or a new sub-panel.
- Patch 4 (Insights tab) rewires `InvestorInsightsTab.tsx` to non-legacy modules.

Applying these steps keeps the live workspace deterministic without waiting for a full redesign.
