# Deal Workspace UI Slot Map (Canonical)

This document maps stable UI placement anchors (`data-slot="…"`) to their owning components and the canonical data wiring. The intent is to make UI → selector → report paths reviewable and regression-testable.

## Deterministic Report Selection (Version Binding)

Rule: the deterministic report consumed by `DealWorkspace` MUST match the “latest vN” shown in the header.

- Source of truth for “latest vN”: `apiGetDeal(dealId)` → `dioAnalysisVersion`.
- Report fetch must be version-pinned: `apiGetDealReport(dealId, { version: dioAnalysisVersion })` → `/api/v1/deals/:dealId/report/:version`.
- Only fall back to `/api/v1/deals/:dealId/report` when `dioAnalysisVersion` is missing.

Root cause (fixed): `DealWorkspace` previously could fetch the unversioned `/report` while the header/diagnostics referenced a specific latest run version (“latest vN”), which allowed report-version drift (e.g. header says v3 but overview bound to a v1 payload) and produced “Deterministic deal summary unavailable” even when the latest deterministic report had those fields.

## Mount Network Wiring (Endpoint → State → Consumers)

On initial mount (and when `dealId` changes), the page triggers these calls:

- `apiGetDeal(dealId)` → populates `dealFromApi` + `dioMeta` (`dioRunCount`, `dioAnalysisVersion`, etc). Consumers:
	- Header “Runs: N (latest vX)” display
	- Determines the version used for deterministic report selection (version binding)
- `apiGetDealReport(dealId, { version: dioAnalysisVersion })` → populates `reportEnvelope` + `reportFromApi`. Consumers:
	- `DealWorkspaceTopSection`: `data-slot="header.score.subsummary"` and `data-slot="topSummary.dealSummary.long"`
	- Header KPI tiles (raise/revenue/growth/customers/burn/runway) via `selectDealWorkspaceHeader` and coverage selectors
	- Overview key facts + evidence via deterministic-first selectors
- `apiGetDealAnalysisDiagnostics(dealId)` → populates `analysisDiagnostics`. Consumers:
	- Diagnostics panel only (observability; not a data source for deterministic slots)
- `apiGetDealGovernedOverlayPersisted(dealId)` (via `useGovernedLlmOverview`) → populates `governedOverview.overview` and derived `overlayVM`. Consumers:
	- Overlay panel only
	- Field-level fallback for overview key facts/summaries only when deterministic values are missing

| Slot ID | Component (file) | Selector / Prop | Canonical report path | Fallback rule | Evidence source path |
|---|---|---|---|---|---|
| `header.score.subsummary` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | Prop `dealSummaryShort` (selected in `DealWorkspace`) | `report.structured_summary.deal_summary_v1.one_liner` | Deterministic only. If missing, render nothing. | `report.structured_summary.deal_summary_v1.one_liner.sources[*]` (if present)
| `topSummary.dealSummary.long` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | Prop `dealSummary` (selected in `DealWorkspace`) | `report.structured_summary.deal_summary_v1.long_summary` | Deterministic only. If missing, render a degraded placeholder (no tier concatenation). | `report.structured_summary.deal_summary_v1.long_summary.sources[*]` (if present)
| `header.tiles.raise` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectDealWorkspaceHeader(report, phase1).raise` | `report.structured_summary.raise` OR `report.structured_summary.kpis.raise` | Deterministic-first; Phase 1 only when report isn’t ready. | `report.structured_summary.raise.sources[*]` / `report.structured_summary.kpis.raise.sources[*]`
| `header.tiles.revenue` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectDealWorkspaceHeader(report, phase1).revenue` + coverage policy | `report.structured_summary.kpis.revenue` | Deterministic-only when `report.financial_coverage_v1.coverage.revenue_present` allows; otherwise hide value. | `report.structured_summary.kpis.revenue.sources[*]` + `report.financial_coverage_v1.evidence.revenue_present`
| `header.tiles.burn` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectAuthoritativeBurnV1(report).value` + coverage policy | `report.financial_coverage_v1.coverage.burn_rate_present` + derived value | Deterministic-only when coverage says present; never overlay fallback. | `report.financial_coverage_v1.evidence.burn_rate_present`
| `header.tiles.runway` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectAuthoritativeRunwayV1(report).value` + coverage policy | `report.financial_coverage_v1.coverage.runway_present` + derived value | Deterministic-only when coverage says present; never overlay fallback. | `report.financial_coverage_v1.evidence.runway_present`
| `header.tiles.growth` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectDealWorkspaceHeader(report, phase1).growth` | `report.structured_summary.kpis.growth` | Deterministic-first; Phase 1 only when report isn’t ready. | `report.structured_summary.kpis.growth.sources[*]`
| `header.tiles.customers` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | `selectDealWorkspaceHeader(report, phase1).customers` | `report.structured_summary.kpis.customers` | Deterministic-first; Phase 1 only when report isn’t ready. | `report.structured_summary.kpis.customers.sources[*]`
| `header.tiles.dealType` | `DealWorkspaceTopSection` (`apps/web/src/components/workspace/DealWorkspaceTopSection.tsx`) | Prop `dealType` (`reportView.dealType`) | `report.metadata.score_explanation.context.deal_type` | Deterministic when present; otherwise fallback to deal metadata / UI default. | N/A (not evidence-backed today)
| `keyFacts.product` | `DealWorkspaceOverviewComp` (`apps/web/src/components/workspace/dealworkspace_overview_comp.tsx`) | `selectDealWorkspaceOverviewModel().keyFacts.product` → prop `product` | Primary: `report.deal_summary_v1.product.text` (when ready) | Deterministic-first (authoritative panel); overlay fallback only if deterministic missing. | `report.deal_summary_v1.product.sources[*]` OR overlay `overview.claims[*].evidence_refs[*]`
| `keyFacts.market` | `DealWorkspaceOverviewComp` (`apps/web/src/components/workspace/dealworkspace_overview_comp.tsx`) | `selectDealWorkspaceOverviewModel().keyFacts.market` → prop `marketIcp` | Primary: `report.deal_summary_v1.market_target.text` / `market.text` | Deterministic-first (authoritative panel); overlay fallback only if deterministic missing. | `report.deal_summary_v1.market_target.sources[*]` OR overlay `overview.claims[*].evidence_refs[*]`
| `keyFacts.business_model` | `DealWorkspaceOverviewComp` (`apps/web/src/components/workspace/dealworkspace_overview_comp.tsx`) | `selectDealWorkspaceOverviewModel().keyFacts.business_model` → prop `businessModel` | `report.structured_summary.kpis.business_model` (when ready) | Deterministic-first; overlay fallback only if deterministic missing. | `report.structured_summary.kpis.business_model.sources[*]` OR overlay `overview.claims[*].evidence_refs[*]`
| `keyFacts.raise_terms` | `DealWorkspaceOverviewComp` (`apps/web/src/components/workspace/dealworkspace_overview_comp.tsx`) | `selectDealWorkspaceOverviewModel().keyFacts.raise_terms` → prop `raiseTerms` | `report.structured_summary.raise` (when ready) | Deterministic-first; overlay fallback only if deterministic missing. | `report.structured_summary.raise.sources[*]` OR overlay `overview.claims[*].evidence_refs[*]`
| `investmentAnalysis.overview.summary` | `DealWorkspaceOverviewComp` (`apps/web/src/components/workspace/dealworkspace_overview_comp.tsx`) | Prop `rationale` | `report.metadata.decision_v1.reasons[*]` (derived) | Deterministic-only; show what the deterministic score/decision explains. | N/A (derived label today)
