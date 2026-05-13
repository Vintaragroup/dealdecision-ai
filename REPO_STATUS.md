# DealDecisionAI — Repository Status

> Last updated: 2026-05-12 — cleanup/canonicalization pass
> For full known-gap inventory see: `docs/Foundation/KNOWN_GAPS_AND_NEXT_PHASES.md`

---

## Overall Status

The system is production-deployed on Render. Core pipeline (ingestion → DIO → report) is stable. Scoring is deterministic and audited. Several features are shadow-mode (computed but suppressed from UI). Infrastructure and test coverage is good in worker; web/API coverage is partial.

---

## Subsystem Stability Map

### Stable (do not casually modify)

| Subsystem | Key files | Notes |
|-----------|-----------|-------|
| **Report compiler** | `apps/api/src/routes/deals/reports.ts`, `apps/api/src/routes/deals/_shared.ts` | Cache-versioned; enrichment pipeline is layered. Any change risks silent cache staleness. |
| **Deal analysis pipeline** | `apps/worker/src/jobs/analyze-deal/coordinator.ts`, `phase1-dio-v1.ts`, `processor.ts` | Core pipeline sequencing. Regression risk is high. |
| **Scoring engine** | `packages/core/src/orchestrator/compute-ors.ts`, `compute-fhc.ts`, `build-orchestrator-report-v1.ts` | Deterministic. Do not change formulas without updating `SCORING_SOURCE_OF_TRUTH_CONTRACT.md` and running regression suite. |
| **Financial facts pipeline** | `packages/core/src/orchestrator/` (full), `apps/worker/src/jobs/` | Truth-gate and evidence-confidence are active. |
| **Root workspace component** | `apps/web/src/components/workspace/DealWorkspace.tsx` | Top-level data-fetch and prop routing. High fan-out. |

### Active — lower risk to change

| Subsystem | Key files |
|-----------|-----------|
| **Investor insights generation** | `apps/worker/src/jobs/investor-insights/` |
| **Visual extraction** | `apps/worker/src/jobs/extract-visuals/`, `services/vision_worker/` |
| **API auth middleware** | `apps/api/src/middleware/` |
| **UI workspace tabs** | `apps/web/src/components/workspace/IntelligenceTab.tsx`, `InvestorInsightsTab.tsx`, `FinancialsTab.tsx` |

### Shadow / Not Yet Promoted

| Feature | Flag | Location |
|---------|------|----------|
| Fundability scoring | `FUNDABILITY_SHADOW_MODE` | Computed in worker, suppressed in web |
| PDF v2 extraction | `PDF_EXTRACTION_V2_SHADOW` | Runs in parallel, not primary |
| Phase B visual evidence | `DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE` | Included in LLM inputs only |

---

## Legacy UI Directories

These are `legacy`-labeled directories in `apps/web/src/`. Each has a `README.md` with full detail.

| Directory | Status | Action required before removal |
|-----------|--------|--------------------------------|
| `components/workspace/investor-insights/legacy/` | **PRODUCTION LIVE** — imported by `InvestorInsightsTab.tsx` | Do not remove |
| `components/workspace/legacy/` | **PRODUCTION LIVE** — `WorkspaceRedesignedShell.tsx` exports type used by `IntelligenceTab.tsx` | Do not remove |
| `components/Modal_Legacy/` | **PRODUCTION LIVE** — `DealFormData` type imported in 5 production files | Do not remove |
| `components/workspace/Dealworkspace-Legacy/` | **Unused** — no production imports | Safe to delete after confirming zero imports |
| `components/workspace/AI-analysis-legacy/` | **Unused in prod** — imported only in tests | Coordinate test update before deleting |

---

## Canonical Orchestrator

- `packages/core/src/orchestrator/` — **the only orchestrator**
- `apps/worker/src/orchestrator/` was deleted in `chore/canonicalize-worker-orchestrator` (shadow copy removed)
- All orchestrator imports must use `@dealdecision/core`

---

## Known Infrastructure Debt

| Issue | Severity | File |
|-------|----------|------|
| Health check always returns HTTP 200 (even on DB failure) | Medium | `apps/api/src/routes/health.ts` |
| No deploy ordering between Render services | Low-Medium | `render.yaml` |
| Worker concurrency is `1` in prod | Intentional | `render.yaml` |

---

## Do Not Refactor Casually

These files have high blast radius, complex invariants, or are under active observation:

| File | Why |
|------|-----|
| `apps/api/src/routes/deals/reports.ts` | Report compiler route with cache versioning and layered enrichment |
| `apps/worker/src/jobs/analyze-deal/coordinator.ts` | Pipeline coordinator — job sequencing with retry semantics |
| `apps/worker/src/jobs/analyze-deal/phase1-dio-v1.ts` | Phase 1 DIO — core extraction pipeline with evidence provenance |
| `apps/worker/src/jobs/analyze-deal/processor.ts` | Main deal analysis entry point |
| `apps/api/src/routes/deals/_shared.ts` | Shared report fetch/enrichment — consumed by multiple routes |
| `apps/web/src/components/workspace/DealWorkspace.tsx` | Root workspace shell — high prop fan-out to all tabs |

---

## Test Coverage Status

| App | Runner | Status |
|-----|--------|--------|
| `apps/worker` | vitest | 214 test files / 4479 tests — all pass |
| `apps/web` | vitest | Partial coverage; critical tabs covered |
| `apps/api` | vitest | Route-level smoke tests |
| Playwright (E2E) | Playwright | Playwright artifacts in `playwright-artifacts/` |

---

## Recommended Next Hardening Phases

1. **Promote fundability scoring** — remove `FUNDABILITY_SHADOW_MODE`, validate gate thresholds
2. **Health check fix** — return 503 on DB disconnection in `health.ts`
3. **Legacy UI consolidation** — migrate live imports out of `investor-insights/legacy/` and `workspace/legacy/`, then delete those dirs
4. **PDF v2 promotion** — run quality comparison, cut over primary extraction
5. **Revenue normalization** — implement period-normalization for multi-period financial comparisons

---

## Repository Hygiene Rules

The following rules govern what may and may not be committed. These are enforced by `.gitignore` where applicable.

| Category | Rule |
|----------|------|
| **Deal source documents** | Raw pitch decks, XLSX financials, cap tables, and private placement memos must **never** be committed. Keep in `docs/reference-deal-docs/` (gitignored) or outside the repo entirely. |
| **Raw governed LLM outputs** | Files like `*governLLM*.txt` or `*governedLLM*.txt` containing real deal IDs and raw LLM output must not be committed. Gitignored by pattern. |
| **Generated forensic artifacts** | `artifacts/forensics/`, `artifacts/training/`, and `artifacts/unknown-knowledgebase/` are generated runtime outputs — gitignored, not source of truth. |
| **Scratch scripts** | `scripts/tmp_*.py` and `scripts/tmp_*.js` are local debug scripts — gitignored. Use `scripts/experimental/` for durable non-production scripts. |
| **Root placeholders** | Files like `financial_intelligence_v1`, `meta`, `report`, `typescript` at the repo root are gitignored. Never commit empty or accidental root files. |
| **Evaluation ground truth** | `evaluation/ground_truth/*.json` is **intentionally committed** — it is the benchmark contract for the regression gate. Do not delete or gitignore it. |
| **tsconfig scratch artifacts** | `packages/**/tsconfig*.bak` and `packages/**/tsconfig*.test` are investigation artifacts — gitignored. Never commit them. |
