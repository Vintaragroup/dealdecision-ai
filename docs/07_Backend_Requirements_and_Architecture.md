# Backend Requirements and Architecture

## Runtime Stack
- Fastify + TypeScript API (`apps/api`)
- BullMQ workers (`apps/worker`) with Redis
- Postgres for persistence (SQL migrations in `infra/migrations`)

## Services & Ports
- API: `localhost:9000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

## Queues / Jobs
- Queues: `ingest_document`, `fetch_evidence`, `analyze_deal`
- Jobs recorded in `jobs` table; SSE endpoint `/api/v1/events` streams updates

## Key Routes
- Health: `GET /api/v1/health`
- Deals CRUD: `POST/GET/PUT/DELETE /api/v1/deals` plus `GET /api/v1/deals/:deal_id`
- Analyze trigger: `POST /api/v1/deals/:deal_id/analyze`
- Job status: `GET /api/v1/jobs/:job_id`
- Documents: upload/list/retry under `/api/v1/deals/:deal_id/documents`
- Evidence: fetch queue `/api/v1/evidence/fetch`, list `/api/v1/deals/:deal_id/evidence`
- Chat: workspace and deal chat under `/api/v1/chat/*` (suggests actions only)

## Data Model (current)
- `deals` (id, name, stage, priority, trend, score, owner, deleted_at)
- `documents` (document_id, deal_id, title, type, status, uploaded_at, updated_at)
- `evidence` (evidence_id, deal_id, document_id?, source, kind, text, excerpt, created_at)
- `jobs` (job_id, deal_id?, document_id?, type, status, progress_pct, message, timestamps)

## Migrations
- Stored in `infra/migrations` and applied via `pnpm --filter api db:migrate`.
- Latest migration (2025-12-16-004) ensures `evidence.document_id` exists; FK creation is intentionally skipped in this environment to avoid unknown prior state. Plan: add a follow-up migration to enforce FK once the target DB is confirmed to have the column.

## Constraints / Non-Negotiables
- Evidence traceability: only stored evidence IDs may be cited.
- Async heavy work; do not block API handlers for long tasks.
- No ORM; keep SQL explicit.

## Observability (lightweight)
- Job status and messages in `jobs`.
- Console logging in worker for job inserts; extend as needed.
