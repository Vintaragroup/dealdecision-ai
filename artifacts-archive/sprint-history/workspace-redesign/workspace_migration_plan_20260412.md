# Workspace Migration Plan — Deterministic → Hybrid → Redesign

## Phase A — Deterministic Cleanup on Current UI
**Objective:** Make every currently rendered field deterministic and evidence-backed without altering layout.

- **Key work items**
  1. Wire `structured_summary.company_name` and RC-S6 enrichments into `buildWorkspaceViewModel` (`apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts`).
  2. Reorder fallback logic in `DealWorkspace.tsx` to consume structured summary & selectors first, removing silent Phase1/DIO overrides (`lines 2315-3785`).
  3. Update `selectDealWorkspaceOverviewModel` to enforce deterministic-first ordering and emit trust-state badges.
  4. Render RC-S6 fields (team highlights, use-of-funds, project pipeline, revenue model) as cards in the Overview tab.
  5. Add unit tests per the field contract plan (authority registry) and block direct Phase1 usage except behind “interim extraction” banners.

- **Files to modify**: `apps/web/src/components/pages/DealWorkspace.tsx`, `apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts`, `apps/web/src/lib/selectors/selectDealWorkspaceOverviewModel.ts`, `apps/web/src/components/workspace/DealWorkspace_overviewTab_v3.tsx`, selector test files.

- **Acceptance criteria**
  - Every overview field traces to structured data in logs/tests.
  - Phase1/DIO fallback executes only when `structured_summary.ready === false` and UI displays warning badge.
  - Automated contract tests pass for all fields listed.

- **Rollback risk**: Low — affects data binding only. Keep previous fallback logic behind feature flag to revert if regressions discovered.

## Phase B — Hybrid Shell with Current Components
**Objective:** Introduce the new layout scaffolding (Identity strip + two columns + risk strip) while reusing existing components.

- **Key work items**
  1. Build layout shell (Identity strip, Conviction column, Financial column, Risk strip, Workbench) using current components as inserts (`apps/web/src/components/pages/DealWorkspace.tsx` restructure or new layout component).
  2. Implement sticky nav / quick links to jump between sections.
  3. Ensure contract-tested components integrate with new layout and trust-state badges are visible per section.
  4. Deprecate tab bar navigation but maintain deep links via anchors.

- **Files to modify**: Layout component (new), `DealWorkspace.tsx` orchestrator, CSS/utility files, navigation helpers.

- **Acceptance criteria**
  - Layout renders single scrollable page with anchors.
  - All fields continue to read from deterministic sources (Phase A complete).
  - QA confirms no content regressions vs old layout; only layout change.

- **Rollback risk**: Medium — larger DOM restructure. Mitigate by shipping under feature flag `workspace.hybridLayout`. Rollback toggles flag to restore tabbed layout.

## Phase C — Full Investor-Job-First Redesign
**Objective:** Replace legacy components with purpose-built modules aligned to the redesigned slot map.

- **Key work items**
  1. Implement new Conviction column cards (Investment Snapshot, Key Facts grid, Pipeline, Evidence carousel) with dedicated components.
  2. Build Financial column modules (Vital Signs, Integrity & Coverage, Underwriting gauge, UOF vs Capital chart).
  3. Create Risk & Actions strip modules (Red flags, blockers, open questions, implementation actions, contradiction callouts) with action buttons wired to jobs/evidence APIs.
  4. Build Workbench sections (Deep Dive panel, Insights diagnostics, Evidence explorer) with API integrations and filters.
  5. Remove legacy/placeholder components (Investor Insights legacy widgets, old tabs, Dealworkspace-Legacy artifacts).

- **Files to modify**: New component directories per section, supporting hooks/selectors, CSS modules, API client adjustments for new calls (Evidence explorer).

- **Acceptance criteria**
  - All redesigned slots implemented per `workspace_redesigned_slot_map_20260412.md` spec.
  - No legacy components loaded in production bundle.
  - Feature flag `workspace.redesign` toggles new UI; once stable, remove old layout code.

- **Rollback risk**: High — entire UX replaced. Keep hybrid layout (Phase B) behind separate flag for staged rollout. Use E2E snapshots comparing old vs new to validate.
