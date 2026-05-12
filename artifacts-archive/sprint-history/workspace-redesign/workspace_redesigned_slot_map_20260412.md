# Redesigned Workspace Slot Map

| Section | Field label | Component (new) | Source JSON path | Trust badge | Empty/fallback behavior | Click-through |
|---|---|---|---|---|---|---|
| Identity Strip | Company Name | `IdentityStrip.CompanyName` | `report.structured_summary.company_name` | Badge “Structured” when `report.ready` true; “Not extracted” otherwise | Show placeholder text + tooltip describing missing extraction | Click opens Evidence panel filtered to company-name evidence (if available). |
| Identity Strip | Deal Type | `IdentityStrip.DealType` | `report.metadata.deal_type` | “Structured” | Display “Unknown” + badge when absent | Tooltip linking to metadata row in report payload. |
| Identity Strip | Stage | `IdentityStrip.StageBadge` | `report.funding_stage_v1.funding_stage` | “Structured” | Show grey badge “Stage unavailable” | Click opens Funding details card. |
| Identity Strip | Raise | `IdentityStrip.Raise` | `report.structured_summary.raise` | “Structured” or “Not disclosed” | Show “Not disclosed” + info icon when null_rule triggered | Evidence link to raise sources. |
| Identity Strip | Last Analyzed | `IdentityStrip.AnalysisTimestamp` | `dealInfo.lastAnalyzedAt` | “Job state” | Show “Analysis not run” CTA | Button triggers analyze job. |
| Conviction Column | Investment Snapshot | `Conviction.InvestmentSnapshotCard` | `report.investment_analysis_overview_v2.summary_medium` | “Deterministic” / toggle to “Governed” | Show multi-paragraph placeholder inviting analysis | Toggle reveals overlay vs structured text. |
| Conviction Column | Product card | `Conviction.KeyFactCard(Product)` | `report.structured_summary.product_summary_v1` | “Structured” | Display “Not extracted” banner | Expand button opens Evidence carousel filtered to product slots. |
| Conviction Column | Market / ICP card | `Conviction.KeyFactCard(Market)` | `report.structured_summary.market_summary_v1` | “Structured” | Same as above | Evidence link to market nodes. |
| Conviction Column | Business Model card | `Conviction.KeyFactCard(BusinessModel)` | `selectAuthoritativeBusinessModelV1` | “Arbitrated” or “Structured” | Show arbitration badge; if absent, display warning | Click shows arbitration rationale. |
| Conviction Column | Raise terms card | `Conviction.KeyFactCard(RaiseTerms)` | `report.structured_summary.raise` + `deal_summary_v1` fallback | “Structured” | “Not disclosed” fallback | Evidence link to raise terms. |
| Conviction Column | Team Highlights | `Conviction.TeamHighlightsList` | `report.structured_summary.team_highlights[]` | “Structured” | Show “Team highlights not extracted” with re-run CTA | Click opens doc pages for each highlight. |
| Conviction Column | Use of Funds | `Conviction.UseOfFundsBreakdown` | `report.structured_summary.use_of_funds_breakdown[]` | “Structured” | Display empty state + note to re-run extraction | Link to evidence snippet. |
| Conviction Column | Pipeline & Deployment | `Conviction.ProjectPipelineTable` | `report.structured_summary.project_pipeline[]` | “Structured” | Show message “Pipeline table unavailable” | Filter documents to pipeline section. |
| Conviction Column | Revenue Model | `Conviction.RevenueModelCard` | `report.structured_summary.revenue_model` | “Structured” | Show “Not extracted” text | Evidence link. |
| Conviction Column | Evidence Carousel | `Conviction.EvidenceCarousel` | `selectDeterministicOverviewSlotsV1` | “Deterministic” | When slots empty, show CTA “Open Evidence Explorer” | Clicking card opens Evidence Explorer at node. |
| Financial Column | Revenue / ARR / Burn / Runway tiles | `Financial.VitalSignsTiles` | `selectAuthoritativeFinancialBreakdownV1`, `selectAuthoritativeBurnV1`, `selectAuthoritativeRunwayV1` | “Structured” or “Coverage limited” | Show tooltip “Not extracted” | Tap opens Financial audit panel anchored to metric. |
| Financial Column | Integrity badge | `Financial.IntegrityBadge` | `financial_integrity_v1` | “Validated” / “Unvalidated” | When incomplete, show warning + “Run analysis” button | Click opens integrity flag list. |
| Financial Column | Coverage badge | `Financial.CoverageBadge` | `financial_coverage_v1` | “Coverage score X/100” | Show dashed badge; link to docs | Opens coverage breakdown. |
| Financial Column | Underwriting readiness | `Financial.ReadinessGauge` | `underwriting_readiness_v1` | “Structured” | Show “Not evaluated” message | Button to run readiness job. |
| Financial Column | Use of Funds vs Capital | `Financial.CapitalUseChart` | `use_of_funds_breakdown` + `funding_stage_v1` | “Structured” | Show textual fallback | Chart segments clickable to evidence. |
| Risk & Actions | Red Flags | `Risk.RedFlagList` | `report.redFlags[]` | “Structured” | “No red flags” text | Button to mark resolved (writes via API). |
| Risk & Actions | Blockers | `Risk.BlockerCards` | `DealWorkspace` blockers state | “Live state” | Show “No blockers tracked” | Click to open Jobs panel. |
| Risk & Actions | Open Questions | `Risk.OpenQuestionList` | `deep_dive.open_questions.prioritized` | “Deep Dive” | “Deep dive not available” | Link to Deep Dive section. |
| Risk & Actions | Implementation Actions | `Risk.ImplementationActions` | `deep_dive.implementation.actions` | “Deep Dive” | Show placeholder text | Buttons to mark complete. |
| Risk & Actions | Contradiction Callouts | `Risk.ContradictionCallout` | `investor_insights.narrative_contradiction_bundle` | “Insights” | “Insights not run” message | CTA to run Investor Insights job. |
| Analyst Workbench | Deep Dive sections | `Workbench.DeepDivePanel` | `/api/v1/deals/:id/deep-dive` sections | “Deep Dive ready” | Show CTA “Run analysis” | Each section includes “Jump to Evidence” button. |
| Analyst Workbench | Insights Diagnostics | `Workbench.InsightsDiagnostics` | `investor_insights.render_package.sections` | “Insights” / gating statuses | Empty state instructs to run insights | Buttons to trigger regen. |
| Analyst Workbench | Evidence Explorer | `Workbench.EvidenceExplorer` | `apiFetchEvidence`, `Documents API` | “Docs ready” | Show “Upload docs to begin” | Filters open Document viewer and highlight evidence. |
