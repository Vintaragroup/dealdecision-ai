# Redesigned Workspace Information Architecture (Investor-Job First)

## Goals
1. **Identity & Authority** — confirm the deal you are reviewing is grounded in extracted facts (company name, type, stage, raise) before reading summaries.
2. **Conviction Builder** — evaluate product, market, business model, and team evidence in one contiguous flow aligned with structured summaries.
3. **Financial Truth** — surface deterministic financial metrics, coverage, and integrity without digging into tabs.
4. **Risk & Actions** — show blockers, red flags, open questions, and remediation steps in a single decision lane.
5. **Evidence & Provenance** — let analysts jump directly into source documents, deep dive reasoning, and insights diagnostics without changing modes.

## Proposed Layout

### 1. Identity Strip (top of workspace)
- **Components:** Company name, deal type (`deal_type`), stage (`funding_stage_v1`), raise (`structured_summary.raise`), last analysis timestamp.
- **Data source:** `/api/v1/deals/:id/report` (structured summary), supplemented by job metadata.
- **Trust gate:** hide values until `report.ready === true`; show “Not extracted” badges otherwise.

### 2. Conviction Column (left)
1. **Investment Snapshot** — canonical paragraphs from `investment_analysis_overview_v2.summary_medium`, toggling deterministic vs overlay view.
2. **Key Facts Grid** — product, market ICP, business model, raise terms, team highlights, and use-of-funds breakdown; each card shows provenance chips.
3. **Pipeline & Deployment** — project pipeline table (Climatic-style) + revenue model block.
4. **Evidence carousel** — `selectDeterministicOverviewSlotsV1` cards listing source IDs; clicking opens Evidence panel.

### 3. Financial Column (right)
1. **Financial Vital Signs** — tiles for revenue, ARR, burn, runway, cash, projections (from `financial_breakdown_v1`).
2. **Integrity & Coverage** — badges derived from `financial_integrity_v1` and `financial_coverage_v1` with inline tooltips.
3. **Underwriting Readiness** — single gauge from `underwriting_readiness_v1` + recommended actions.
4. **Use of Funds vs Capital Sources** — structured UOF breakdown aligned with `funding_stage_v1` + compiler UOF extraction.

### 4. Risk & Action Strip (full width beneath columns)
- **Sections:** Red flags (`report.redFlags`), blockers (`DealWorkspace` blockers state), open questions (from Deep Dive), implementation actions (from Deep Dive), contradiction callouts (Investor Insights `narrative_contradiction_bundle`).
- **Interaction:** Accept/resolve buttons write back to jobs queue.

### 5. Analyst Workbench (bottom accordions)
1. **Deep Dive Reasoning** — embed existing `DealDeepDiveTab` UI but scoped to sections (Product, Market, Business, Financials, Team) with sticky nav.
2. **Investor Insights Diagnostics** — show gate state, slot coverage, canonical fields, conflicts, coverage snapshots (current Data tab content) in a single diagnostics accordion.
3. **Evidence Explorer** — merge Documents, Evidence, and Jobs into one panel with filters (doc type, confidence, segment). Use `apiFetchEvidence` and document viewers inline.

### Navigation Paradigm
- Replace multi-tab bar with anchored sections + mini-map, enabling investors to scroll top-to-bottom following the jobs-to-be-done order.
- Offer quick links (“Jump to Financials,” “Jump to Red Flags,” “Open Evidence Explorer”) pinned in a sticky sidebar.

### Data Flow Considerations
- Every section declares its trust state (structured summary ready, investor insights ready, deep dive available). When unmet, show precise call-to-action (e.g., “Run Investor Insights job”).
- Phase1/DIO values are hidden unless “Structured summary unavailable — showing interim extraction” badge is explicitly acknowledged.
- Overlay (governed) copy is always displayed alongside deterministic evidence, not as a silent replacement.

### Implementation Steps (post-cleanup)
1. Build new layout shell (Identity + Conviction + Financial columns) while reusing existing selectors (`selectDealWorkspaceOverviewModel`, `useFinancialAuditData`).
2. Create dedicated cards for RC-S6 enrichments (team highlights, UOF, project pipeline, revenue model).
3. Integrate Deep Dive + Insights diagnostics as expandable workbench sections, eliminating redundant tabs.
4. Simplify navigation to a single scrollable “workspace overview,” reducing state duplication and making trust states obvious.

This IA aligns every surface with a single authoritative data flow and mirrors how investors actually evaluate deals: confirm identity, build conviction, validate numbers, assess risk, and trace evidence.
