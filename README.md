# DealDecisionAI

DealDecisionAI is an internal investment analysis system designed to ingest company materials, extract structured and unstructured signals, and produce evidence-backed deal evaluations.  
The system prioritizes traceability, determinism, and auditability over black-box scoring.

This repository contains the core analysis engine, worker pipelines, and supporting UI used to evaluate investment opportunities.

---

## System Intent

DealDecisionAI is built around a few non-negotiable principles:

- **Evidence-first analysis**  
  All scores, recommendations, and claims must be traceable to underlying evidence or explicitly marked as missing or inferred.

- **Fail-open by design**  
  Partial data, missing documents, or incomplete extraction should never block analysis. The system returns the best possible result with diagnostics instead of failing hard.

- **Backend-authoritative decisions**  
  Scores, coverage, mismatch flags, and trace audits are computed server-side. The UI renders results but does not infer or recompute them.

- **Deterministic before generative**  
  Heuristics and rules drive analysis. Language models are used for synthesis and summarization, not primary decision-making.

---

## High-Level Architecture

At a conceptual level, the system consists of four major components:

- **API**  
  Serves deal data, analysis outputs, evidence resolution, and diagnostics. Acts as the source of truth for scoring and trace audits.

- **Worker**  
  Executes ingestion, extraction, and analysis jobs asynchronously. This includes Phase 1 (textual analysis) and Phase B (visual analysis).

- **Web UI**  
  Renders deal workspaces, evidence panels, score breakdowns, and trace diagnostics. The UI reflects backend state without re-deriving logic.

- **Data Stores**  
  Persist documents, extracted text, visual assets, evidence records, and analysis runs. Visuals and evidence are typically joined through documents.

This repository intentionally omits deployment, infrastructure, and environment-specific details.

## Production (set-and-forget)

> **Managed by `render.yaml` (Render) and `vercel.json` (Vercel).**
> Secrets are set in the Render/Vercel dashboards — not in committed files.
> Do not add local-dev settings here.

If you deploy with Docker Compose, see `infra/docker-compose.deploy.yml`.

Key knobs:

- `PIPELINE_AUTOMATION_MODE=off|shadow|primary` (worker)
  - Production defaults to `off`.
  - Set to `shadow` to run the newer pipelines additively without changing legacy results.
- `VISION_BASE_URL` (worker)
  - Required for visual extraction; `infra/docker-compose.deploy.yml` includes an optional `vision_worker` service.
- `UPLOAD_DIR` (api + worker)
  - Used for temporary local artifacts.
  - Production does **not** require a shared filesystem between API and worker; rendered pages and visual assets should resolve via R2-backed HTTP(S) URLs.

### Render (worker memory/concurrency)

If running the worker on low-memory instances (e.g. 512MB), keep BullMQ worker concurrency capped to avoid OOM from overlapping extraction jobs:

- `WORKER_CONCURRENCY=1`
- `NODE_OPTIONS=--max-old-space-size=384`

### Render (Web / Vite env vars)

The web app is a Vite build, so any runtime configuration must be provided at **build time** via `VITE_*` env vars.

- `VITE_API_BASE_URL` (required)
  - Example: `https://dealdecision-api.onrender.com`
- `VITE_BACKEND_MODE` (required)
  - Set to `live` in production to avoid UI gates (Analyst lineage, Data tab).
  - Example: `live`
- `VITE_CLERK_PUBLISHABLE_KEY` (required)
- `VITE_CLERK_JWT_TEMPLATE` (optional)
  - If set, the web app requests Clerk tokens using this template.

### Prod parity checklist (Render + Docker)

- Confirm worker system tools exist (run inside the worker container):
  - `soffice --version`
  - `pdfinfo -v` and `pdftoppm -h`
  - `gs --version`
  - `convert -version`
  - `tesseract --version`
- Confirm worker startup logs include:
  - `db_fingerprint` and `schema_check_ok` (API + worker)
  - `soffice_available` (worker)
- Confirm extraction produces R2-backed page images (no API filesystem paths):
  - `documents.extraction_metadata.rendered_pages_r2` populated
  - `documents.extraction_metadata.rendered_pages_count` populated
  - page keys under `deals/<dealId>/documents/<docId>/rendered_pages/page_%04d.png`
- Smoke-test end-to-end document types (upload → ingest → extract visuals → Analyst nodes render):
  - PDF (scanned + editable), PNG/JPG, XLSX/XLS, DOCX/DOC, PPTX/PPT
  - verify `visual_assets.image_uri` is non-null for persisted assets

### E2E doc pipeline smoke script

Run a generated-fixtures smoke test (creates a temporary deal, uploads PDF/PPTX/DOCX/XLSX/PNG/CSV, waits for rendered pages, runs visual extraction + analysis):

- `API_BASE_URL=http://localhost:9000 pnpm verify:doc-pipeline:e2e`

Auth notes:

- If your API requires auth, provide `AUTH_TOKEN` (Bearer token).
- For local/dev docker, you can set `DISABLE_CLERK_AUTH=1` (non-production only).

---

## Configuration File Map

Quick-reference for which file controls which context:

| File | Context | Tracked in git |
|------|---------|---------------|
| `docker-compose.dev.yml` | **Local dev** docker stack (`dealdecision-dev`) | ✅ yes |
| `docker-compose.prod.yml` | Prod-parity local stack (`dealdecision-prod`) | ✅ yes |
| `docker-compose.yml` | CI / legacy infra dispatcher (not for local dev) | ✅ yes |
| `infra/docker-compose.yml` | Service definitions for CI dispatcher (legacy ports) | ✅ yes |
| `render.yaml` | **Production only** — Render.com service blueprint | ✅ yes |
| `vercel.json` | **Production only** — Vercel frontend routing/headers | ✅ yes |
| `.env.docker.local` | Dev docker runtime secrets (DB, Redis, OpenAI…) | ❌ gitignored |
| `.env.docker.local.example` | Template for the above — copy and fill in | ✅ yes |
| `.env.local` | Host-side tooling outside docker (migrations, scripts) | ❌ gitignored |
| `.env.example` | Full reference of every known env var | ✅ yes |
| `apps/web/.env.example` | Web-specific env var reference | ✅ yes |

**Isolation rules:**
- `develop → production` merges only application code. Dev docker config is isolated in `docker-compose.dev.yml`.
- Production secrets live in Render/Vercel dashboards — never in committed files.
- Dev docker secrets live in `.env.docker.local` (gitignored).
- `docker-compose.yml` and `infra/docker-compose.yml` use **different ports** than `docker-compose.dev.yml` — do not use them for local dev.

---

## Local Docker (use docker-compose.dev.yml day-to-day)

This repo uses ONE canonical local dev stack:

- **Project name**: `dealdecision-dev`
- **Services**: `api_dev` → `http://localhost:9001`, `web_dev` → `http://localhost:4174`, `postgres` → `localhost:55433`, `redis` → `localhost:6380`, `vision_worker` → `localhost:8001`

Do not create ad-hoc infra with commands like `docker run postgres ...`.
Stray Postgres/Redis containers are the #1 cause of “missing data” symptoms (UI shows empty deals, readiness shows 0 pages, worker appears idle) because you’re accidentally connected to a different database/volume.

### Doctor (safe, non-destructive)

- `./dev doctor`

It will:

- List running containers
- Warn on any Postgres not in `dealdecision-dev`
- Warn if any Postgres exposes host port `55434`
- Show which container is bound to `55433`, `6380`, `8001`, `9001`
- Print `DATABASE_URL`/`REDIS_URL` for `api_dev` and `worker_dev`

### Inspect and verify DB contents

Find the dev Postgres container:

- `docker ps --filter name=dealdecision-dev-postgres --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'`

Connect with psql (inside the container):

- `docker exec -it dealdecision-dev-postgres-1 psql -U postgres -d dealdecision`

Useful queries:

- `\dt public.*`
- `SELECT count(*) FROM public.deals;`
- `SELECT id, created_at, title FROM public.deals ORDER BY created_at DESC LIMIT 20;`

If something looks empty, assume you are pointed at the wrong DB until proven otherwise:

- Run `./dev doctor` and confirm `55433` is owned by `dealdecision-dev-postgres-1`.

To keep Docker Desktop unambiguous, local dev and prod-parity are split into two compose files:

- `docker-compose.dev.yml` (day-to-day): `api_dev`, `worker_dev`, `web_dev`
- `docker-compose.prod.yml` (prod parity): `api`, `worker`, `web`

Use distinct project names so stacks never appear together:

- dev: `COMPOSE_PROJECT_NAME=dealdecision-dev`
- prod: `COMPOSE_PROJECT_NAME=dealdecision-prod`

Note: dev and prod-parity use the same host ports, so you should run only one at a time.

### Start local dev stack

- `./scripts/docker/local-dev.sh up`

Equivalent raw command:

- `COMPOSE_PROJECT_NAME=dealdecision-dev docker compose -f docker-compose.dev.yml up -d --build`

Ports:

- Web: `http://localhost:4174`
- API: `http://localhost:9001` (health: `/health`)
- Postgres: `localhost:55433`
- Redis: `localhost:6380`
- Vision worker: `localhost:8001`

### Start prod-parity stack

- `COMPOSE_PROJECT_NAME=dealdecision-prod docker compose -f docker-compose.prod.yml up -d --build`

### Clean up accidental prod stack

- `./scripts/docker/local-dev.sh clean-prod`

### Quick verification checklist

- `COMPOSE_PROJECT_NAME=dealdecision-dev docker compose -f docker-compose.dev.yml ps` shows `api_dev`, `worker_dev`, `web_dev` running
- Readiness route works: `http://localhost:9001/api/v1/deals/:deal_id/readiness`
- Trigger extract-visuals and confirm worker logs include `POPULATE_DOCUMENT_PAGE_UNDERSTANDING`

---

## Analysis Phases (Conceptual)

### Phase 1 — Core Analysis

Phase 1 performs the initial deal evaluation using extracted text and structured artifacts.

Typical outputs include:

- Executive summaries (structured + narrative)
- Coverage and completeness signals
- Claims with linked evidence (when available)
- Business archetype classification
- Deterministic score and recommendation

Phase 1 results are always available and form the baseline for the deal workspace.

### Phase B — Visual Analysis (Additive)

Phase B processes visual artifacts derived from documents (e.g., page images, charts, tables).

Key characteristics:

- Visuals are discovered via the document → visual_asset join path
- Extracted outputs are stored as flexible JSON
- Phase B is **diagnostic and additive**, not required for a valid deal evaluation
- Missing visuals or partial extraction must not invalidate Phase 1 results

---

## Scoring & Evidence Contract

The system enforces a strict separation between **scoring**, **evidence**, and **presentation**:

- Scores and recommendations originate from backend analyzers
- Each score section may be supported, weak, or missing
- Evidence IDs reference persisted evidence rows linked to documents
- Synthetic or placeholder IDs are never counted as real evidence
- Trace audits summarize coverage, mismatches, and gaps using backend metadata only

The UI must not infer:

- score changes
- mismatch status
- evidence sufficiency

For details, see:

- `docs/Active/scoring-and-evidence.md`

---

## Documentation Governance

Documentation in this repository is intentionally curated.

### Tiers

- **docs/Active/**  
  Canonical, human-readable documents that reflect the current system behavior and invariants.

- **docs/Archive/**  
  Historical or superseded documents retained for reference. Archived files are explicitly renamed with `.ARCHIVED.md` to prevent accidental reuse.

- **docs/Quarantine/**  
  Unclassified, legacy, or incoming documents pending review. Files in this tier are not considered authoritative.

Most documentation is intentionally ignored by Git to prevent drift and sprawl. Only curated text documents are tracked.

---

## What This Repository Does *Not* Contain

This repository intentionally excludes:

- Installation instructions
- Environment configuration
- Deployment or infrastructure guides
- Secrets or credentials
- Production operational playbooks

Those details are handled separately and are not part of the codebase contract.

---

## Curated References

- **Scoring & Evidence Model**  
  `docs/Active/scoring-and-evidence.md`

- **Debugging Runbook**  
  `docs/Active/runbook-debugging.md`

---

## Design Direction (Non-Binding)

DealDecisionAI is evolving toward a fully traceable, evidence-anchored investment analysis system where every surfaced conclusion can be explained, audited, and challenged.

The intended end state emphasizes:

- **End-to-end traceability**  
  All scores, claims, and recommendations should be explainable through persisted inputs, evidence records, and deterministic rules.

- **Section-level accountability**  
  Investment decisions are decomposed into discrete sections (e.g., market, product, traction, team, terms, risks), each with an explicit support status rather than a single opaque score.

- **Multi-modal analysis as additive signal**  
  Textual, structured, and visual artifacts are treated as complementary inputs. Visual analysis is intended to enrich — not replace — textual analysis.

- **Evidence as a shared primitive**  
  Evidence is modeled independently of analyzers so it can be reused across scoring, reporting, and review workflows.

- **Fail-open analysis with explicit diagnostics**  
  Incomplete or missing data should result in transparent gaps and warnings rather than silent degradation or blocked execution.

This section describes architectural intent, not delivery guarantees.  
Specific implementations may evolve, but these principles are expected to remain stable.

---

## Status

This repository is under active development.  
Interfaces and internal structures may evolve, but the principles documented here are considered stable.