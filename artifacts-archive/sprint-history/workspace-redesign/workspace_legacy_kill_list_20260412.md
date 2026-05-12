# Workspace Legacy Kill List — April 12, 2026

## 1. Live Legacy Paths to Remove First
1. **Company identity fallback** — `displayName = dealInfo?.name || dealData?.name` (`apps/web/src/components/pages/DealWorkspace.tsx:2203`). Once `structured_summary.company_name` is available, remove direct metadata reads except when structured value is null.
2. **Phase1 overview fields** — `overviewDealOneLiner`, `overviewProduct`, `overviewMarketIcp` pull from `overviewV2` / `executive_summary_v*` before canonical summaries (`DealWorkspace.tsx:2315-2351`). Reorder to deterministic-first and guard Phase1 path behind “interim extraction” badge.
3. **Raise fallback to deal summary** — `overviewRaiseTermsCanonical` drops to `reportView.raise`/Phase1 text when `structured_summary.raise` nulls (`DealWorkspace.tsx:3771-3785`). Replace with “Not disclosed” messaging.
4. **Overlay-first company description** — `buildWorkspaceViewModel` uses `governedDealOneLiner` first (`apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts:560-585`). Rewire to deterministic tier > overlay.
5. **Investor Insights legacy widgets** — `ExecutivePulse`, `IntelligenceGrid`, `SwotPanel`, `SynthesizedNarrative`, `SentimentFilterToggle`, `ExternalDiligenceSkeleton` imported from `apps/web/src/components/workspace/investor-insights/legacy/*`. Replace with render-package-native components.
6. **Phase1 evidence chips** — `selectDealWorkspaceOverviewModel` currently accepts overlay evidence IDs without origin labeling. Update to reject IDs unless they originate from structured summary or governed overlay with evidence metadata.

## 2. Mock-Only Components to Quarantine
- `apps/web/src/components/workspace/Dealworkspace-Legacy/*` (legacy overview/top section); keep only for regression tests, remove from production bundle.
- `AI-analysis-legacy` tab (`apps/web/src/components/workspace/AI-analysis-legacy/AnalysisTab.tsx`) — confirm no routing path exposes it; if unused, quarantine.
- Template generators referencing `dealData.companyName` placeholders (`apps/web/src/components/TemplateEditor.tsx`, `TemplateCustomizer.tsx`) — ensure they consume canonical selectors or move under legacy namespace.

## 3. Selectors / Builders to Deprecate
- `selectDeterministicOverviewSlotsV1`: keep for fallback but document as last resort; plan to remove once canonical summaries 100% coverage.
- Legacy `selectDealWorkspaceHeader` paths reading `reportView` rather than canonical selectors — update to rely on authoritative selectors only.
- `selectAuthoritativeBusinessModelV1` fallback to `phase1.*` should be guarded; plan deprecation once business_model KPIs always evidence-backed.

## 4. Phase1/DIO Access to Block from Live Workspace
1. Direct references to `overviewV2` / `executive_summary_v1` outside of an explicit “interim extraction” badge path.
2. Use of `reportView` (Deal Summary) to supply raise, revenue, or customers when structured KPIs exist.
3. Overlay/gov copy replacing deterministic text without user acknowledgement.
4. Any UI element pulling from `phase1.business_model` or `deal_overview_v2.business_model` when arbitration/structured KPIs disagree.
5. Evidence chips generated from Phase1 segments lacking document/page metadata (fails trust state requirement).

## 5. Removal Priorities
1. **Company identity and key facts** — ensures analysts trust top-line fields.
2. **Investor Insights legacy panel** — unblocks redesign and simplifies data binding.
3. **Phase1 fallback audit** — centralizes logic in selectors, reducing duplication.
4. **Mock component quarantine** — avoid accidental reintroduction of fake data when toggling feature flags.
