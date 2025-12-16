# System Foundations

## Purpose
DealDecision AI is a PNPM monorepo (API + worker + web + shared contracts) focused on diligence automation with strict evidence traceability.

## Core Principles
- DIO is the source of truth for decisions and reporting; UI renders DIO versions, not ad-hoc state.
- Evidence is first-class; no hallucinated citations—only stored `evidence_id` items may be referenced.
- Async by default for heavy work (ingest, fetch_evidence, analyze); jobs emit status updates.
- Live/Mock split: `VITE_BACKEND_MODE=live` hits the API; mock mode is for demos only.
- Minimal magic: explicit SQL migrations, Fastify routes, BullMQ workers, shared TypeScript contracts.

## Environments & Ports
- API: `localhost:9000`
- Postgres: `localhost:5432` (DATABASE_URL required)
- Redis: `localhost:6379` (REDIS_URL required for queues)
- Web dev: Vite dev server (varies), proxies to `VITE_API_BASE_URL`

## Packages (at a glance)
- `apps/api`: Fastify API (routes, migrations runner, queues enqueue)
- `apps/worker`: BullMQ workers (ingest, fetch_evidence, analysis)
- `apps/web`: Vite/React UI (live vs mock)
- `packages/contracts`: shared types (Deal, Document, Evidence, Job, DIO, ChatAction)
- `packages/core`: core/HRM logic placeholder
- `infra`: migrations, docker-compose

## Data/Tracing
- Evidence table is the anchor for citations; jobs may append evidence with `evidence_id`.
- Jobs table records status/progress/messages; SSE (`/api/v1/events`) streams job updates.

## Safety Constraints
- No state changes via chat responses; chat suggests actions only.
- Avoid ORMs; migrations are SQL.
- Keep tests runnable via `pnpm --filter api test` and worker tests via `pnpm --filter worker test`.
