# DealDecisionAI — Engineering Overview

> Authoritative reference: `docs/Foundation/SYSTEM_OVERVIEW.md` and `docs/Foundation/*.md`.
> This file is a navigation aid, not a source of truth. When in conflict, Foundation docs win.

---

## What This System Does

DealDecisionAI analyzes startup investment deals. Users upload documents (pitch decks, XLSX financials, executive summaries) for a deal. The system extracts structured data, runs deterministic and LLM-assisted analysis, and produces a structured report with a fundability score, evidence-backed insights, and investor-facing narration sections.

---

## Architecture at a Glance

```
ingestion → extraction → DPU → DIO → financial_facts → report compiler → cache → API → UI
```

Four deployed services + one shared vision service:

| Service | Location | Role |
|---------|----------|------|
| `apps/api` | Fastify (port 9001 dev / 9000 prod) | REST API — all client-facing routes |
| `apps/worker` | BullMQ/Node | Background pipeline jobs |
| `apps/web` | Vite/React | Frontend |
| `services/vision_worker` | FastAPI/Python | OCR + visual region detection |

Shared packages:

| Package | Import | Role |
|---------|--------|------|
| `packages/core` | `@dealdecision/core` | Canonical orchestrator, scoring, types |
| `packages/contracts` | `@dealdecision/contracts` | API/report type contracts |

---

## Pipeline Flow

```
1. Upload          POST /deals/:id/documents → R2 + ingest_documents queue
2. Ingestion       worker: parse doc, render pages to PNG
3. Visual Extract  worker: vision-v2 OCR → visual_assets, visual_extractions
4. DPU             worker: Document Page Understanding — provenance + freshness tokens
5. Deep Scan       worker: LLM evidence extraction per visual segment → evidence, evidence_items
6. DIO             worker: synthesize evidence → ingestion_reports.summary, financial_facts_v1
7. Report          API: GET /deals/:id/report — compile from ingestion_reports + facts + evidence
8. Cache           ingestion_reports (compiler version stamped); deal_report_llm_cache (LLM output)
9. Insights        worker: investor_insights queue → LLM narration sections
10. UI             React workspace renders compiled DioReport payload
```

---

## Canonical Orchestrator

The authoritative orchestrator lives in **`packages/core/src/orchestrator/`**:

| File | Role |
|------|------|
| `build-orchestrator-report-v1.ts` | Deterministic report builder — assembles warnings, ORS, FHC |
| `compute-ors.ts` | Overall Recommendation Score (deterministic, truth-gate aware) |
| `compute-fhc.ts` | Financial Health Composite score |
| `render-package-helpers.ts` | Canonical parsing of coverage snapshots and canonical fields |

All of these are exported from `packages/core/src/index.ts` (`@dealdecision/core`).

> There is no shadow/duplicate orchestrator. The `apps/worker/src/orchestrator/` directory was deleted in the `chore/repo-hardening-pass-1` cleanup. Always import from `@dealdecision/core`.

---

## Financial Data Hierarchy

| Source | Priority | Role |
|--------|----------|------|
| XLSX / WebMax structured extraction | **Highest** | Structured financial truth |
| Cap table | High | Ownership reality |
| Verified structured extraction | Medium | Confirmed facts from DPU/DIO |
| Deck language (pitch deck text) | **Lowest** | Narrative / marketing |

Never overwrite structured financial data with deck-sourced assumptions.

---

## Scoring Contracts

- **Fundability Score**: deterministic, defined in `packages/core/src/orchestrator/`. No scoring logic may live in API route handlers or UI components.
- **ORS (Overall Recommendation Score)**: computed by `computeOverallRecommendationScore` in `compute-ors.ts`. Truth-gate-blocked fields are excluded from scoring.
- **FHC (Financial Health Composite)**: computed by `computeFinancialHealthComposite` in `compute-fhc.ts`.

Source of truth contract: `docs/Foundation/SCORING_SOURCE_OF_TRUTH_CONTRACT.md`.

---

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `deals` | Top-level deal entity |
| `documents`, `document_files` | Uploaded files per deal |
| `visual_assets` | Rendered page PNGs + detected regions |
| `visual_extractions` | OCR/structured content per visual asset |
| `evidence`, `evidence_items` | Extracted claims / data points |
| `ingestion_reports` | Per-analysis-version report blob (JSONB `summary`) |
| `financial_facts_v1` | Structured financial facts extracted per deal |
| `deal_report_llm_cache` | Cached LLM narration (investor insights) |
| `jobs`, `pipeline_runs` | BullMQ observability records |

---

## Auth

- **Prod**: Clerk JWT. Resolved via `CLERK_JWKS_URL` → `CLERK_JWT_ISSUER` → `CLERK_JWT_VERIFICATION_KEY`.
- **Local dev**: `DISABLE_CLERK_AUTH=1` → synthetic dev user (`dev_user`, `dev_org`).

---

## Local Dev

```bash
docker compose -f docker-compose.dev.yml up   # starts api, worker, web, postgres, redis, vision
```

Default ports: API `:9001`, Web `:4174`.

Package manager: **pnpm** workspaces. Turborepo orchestrates cross-package tasks.

---

## Where NOT to Start Edits

These files have high blast radius and complex invariants. Do not casually refactor them:

| File | Reason |
|------|--------|
| `apps/api/src/routes/deals/reports.ts` | Report compiler route — cache, versioning, enrichment layer |
| `apps/worker/src/jobs/analyze-deal/coordinator.ts` | Pipeline coordinator — job sequencing |
| `apps/worker/src/jobs/analyze-deal/phase1-dio-v1.ts` | Phase 1 DIO extraction — core pipeline |
| `apps/worker/src/jobs/analyze-deal/processor.ts` | Main deal analysis processor |
| `apps/api/src/routes/deals/_shared.ts` | Shared report fetch + enrichment utilities |
| `apps/web/src/components/workspace/DealWorkspace.tsx` | Root workspace component |

See `REPO_STATUS.md` for full stability map.
