# DealDecisionAI — Partner Repository Guide

> For external reviewers under NDA.
> This is an engineering orientation document, not a marketing summary.

---

## What This Repository Contains

A production-deployed document intelligence and deal analysis system. The system ingests startup investment documents (pitch decks, XLSX financials, cap tables, executive summaries), runs structured extraction and LLM-assisted analysis, and produces a scored, evidence-backed report for investment decision support.

This repo is the full monorepo — all services, pipeline code, shared packages, tests, evaluation infrastructure, and documentation.

---

## Repository Structure

```
apps/
  api/        — Fastify REST API (all client-facing routes)
  worker/     — BullMQ background pipeline (all async jobs)
  web/        — Vite/React frontend
  tmp/        — transient scratch; safe to ignore
services/
  vision_worker/  — FastAPI/Python OCR + visual region service
packages/
  core/       — canonical orchestrator, scoring, shared types
  contracts/  — API/report type contracts
docs/
  Foundation/ — authoritative current-state documentation (12 files)
  Supporting/ — supplementary runbooks and discovery docs
  Archive/    — historical context only; do not use for current-state inference
  Quarantine/ — stale/conflicting; not safe to use
evaluation/
  ground_truth/   — regression benchmark contracts (intentionally committed)
  regression_reports/, pipeline_regression/  — test output artifacts
```

---

## Canonical Runtime Path

```
Upload → ingest_documents job
       → extract_visuals job  (OCR, visual assets, DPU)
       → document_intelligence_extract job  (LLM evidence extraction per segment)
       → analyze_deal job  (DIO synthesis → ingestion_reports, financial_facts_v1)
       → GET /deals/:id/report  (compiler: assembles report, checks cache, scores)
       → investor_insights job  (async LLM narration — separate queue)
```

All jobs are BullMQ queues. Queue names are canonical constants in `packages/core/src/` — do not change them without tracing all enqueue call sites.

The report compiler at `apps/api/src/routes/deals/reports.ts` is cache-versioned. Changes to report shape must increment `REPORT_COMPILER_VERSION` or consumers will silently receive stale output.

---

## Canonical Orchestrator

`packages/core/src/orchestrator/` is the **only** orchestrator. Key files:

| File | Role |
|------|------|
| `build-orchestrator-report-v1.ts` | Deterministic report builder |
| `compute-ors.ts` | Overall Recommendation Score |
| `compute-fhc.ts` | Financial Health Composite |
| `compute-dci.ts` | Document Completeness Index |
| `render-package-helpers.ts` | Coverage snapshot parsing |

A shadow copy at `apps/worker/src/orchestrator/` was deleted in PR #13 (`chore/canonicalize-worker-orchestrator`). All orchestrator imports use `@dealdecision/core`.

---

## Stability Map

### Stable — treat as production, high regression risk

| Component | Location |
|-----------|----------|
| Report compiler + cache layer | `apps/api/src/routes/deals/reports.ts`, `_shared.ts` |
| Deal analysis pipeline | `apps/worker/src/jobs/analyze-deal/` |
| Scoring engine | `packages/core/src/orchestrator/compute-ors.ts`, `compute-fhc.ts` |
| Financial facts pipeline | `packages/core/src/orchestrator/`, `apps/worker/src/jobs/` |
| Root workspace component | `apps/web/src/components/workspace/DealWorkspace.tsx` |

### Active development — lower blast radius

| Component | Location |
|-----------|----------|
| Visual extraction | `apps/worker/src/jobs/extract-visuals/` |
| Investor insights | `apps/worker/src/jobs/investor-insights/` |
| Deep scan | `apps/worker/src/jobs/deep-scan-visuals/` |

### Shadow features — computed but not surfaced in UI

| Feature | Flag |
|---------|------|
| Fundability scoring | `FUNDABILITY_SHADOW_MODE` |
| PDF v2 extraction | `PDF_EXTRACTION_V2_SHADOW` |
| Phase B visual evidence | `DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE` |

---

## What Is Not In This Repository

**Real deal documents are not committed.** No pitch decks, financial models, cap tables, or private placement memos are in the repo. They are stored in R2 at runtime and in a gitignored local directory (`docs/reference-deal-docs/`) during development. This is enforced by `.gitignore` patterns and the hygiene rules documented in `REPO_STATUS.md`.

Raw governed LLM output files containing real deal IDs are also gitignored by pattern.

---

## What Is Intentionally In This Repository

**Evaluation and regression infrastructure is committed on purpose.** The `evaluation/` directory contains:

- `evaluation/ground_truth/` — benchmark contracts used by the regression gate
- `evaluation/pipeline_regression/` — pipeline regression harness
- `evaluation/regression_reports/` — historical run outputs
- `artifacts/` — regression snapshots and per-deal audit artifacts (no PII, deal content-free)

This infrastructure is an engineering asset, not cleanup debt. It gates scoring changes and documents system behavior over time.

---

## Recent Cleanup and Canonicalization

The following work was completed immediately before external sharing (PRs #12–#16 on `main`):

| PR | Change |
|----|--------|
| #12 `chore/share-readiness-cleanup-p0` | Removed debug/garbage artifacts, added `.gitignore` rules for sensitive path patterns |
| #13 `chore/canonicalize-worker-orchestrator` | Deleted shadow orchestrator copy at `apps/worker/src/orchestrator/`; promoted FSI=10 |
| #14 `docs/fix-canonical-orchestrator-status` | Fixed stale references in `REPO_STATUS.md` pointing to the deleted shadow copy |
| #15 `test/extract-visuals-coordinator-behavior` | Added 19-test behavioral harness for `runExtractVisualsCoordinator` |
| #16 `refactor/extract-visuals-ingest-wait-helper` | Extracted ingest-wait polling loop from coordinator into `ingest-wait.ts` (213 lines → 16-line call site); added 6 focused unit tests |

These changes are hygiene and decomposition — no pipeline logic was altered.

---

## Test Coverage

| App | Runner | Current count |
|-----|--------|---------------|
| `apps/worker` | vitest | 216 files / 4504 tests — all pass |
| `apps/web` | vitest | Partial — critical tabs covered |
| `apps/api` | vitest | Route-level smoke tests |
| E2E | Playwright | Artifacts in `playwright-artifacts/` |

---

## Recommended Review Order

Read in this sequence to orient efficiently:

1. **`ENGINEERING_OVERVIEW.md`** — architecture diagram, pipeline stages, financial data hierarchy
2. **`REPO_STATUS.md`** — subsystem stability map, legacy directory inventory, known debt, hygiene rules
3. **`docs/Foundation/`** — 12 authoritative docs covering each pipeline stage end-to-end; start with `SYSTEM_OVERVIEW.md`, then follow by stage
4. **`packages/core/src/orchestrator/`** — canonical scoring and report assembly; this is where deterministic pipeline logic lives
5. **`apps/worker/src/jobs/`** — all async pipeline jobs; `analyze-deal/` is the core path, `extract-visuals/` is the most active refactor area

`docs/Archive/` and `docs/Quarantine/` exist for historical context. Do not use them as references for current system behavior — `docs/Foundation/` wins on any conflict.

---

## Documentation Authority

`docs/Foundation/` is the single source of truth for all current-state architecture and behavior claims. `docs/DOCS_GOVERNANCE_INDEX.md` maps every doc file to its authority level. When code inspection conflicts with a non-Foundation doc, trust the code and `docs/Foundation/`.
