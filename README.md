# DealDecision AI Monorepo

Foundation for the DealDecision AI stack (apps, workers, shared packages, infra, docs) using pnpm workspaces and TypeScript.

## Stack & Ports
- API (Fastify): http://localhost:9000
- Web (Vite React): http://localhost:4301
- Postgres: localhost:5444 (container 5432)
- Redis: localhost:6379

## Repo Structure
- apps/api — Fastify API scaffold with health check
- apps/worker — BullMQ worker scaffold (placeholder)
- apps/web — Vite React dashboard
- packages/contracts — shared TS contracts (placeholder)
- packages/core — core logic container (placeholder)
- infra — docker-compose for Postgres/Redis/Web
- docs — architecture and Copilot prompts

## Prereqs
- Node 20+, Corepack enabled (`corepack enable pnpm`)
- pnpm (installed via corepack)
- Docker Desktop for infra

## Setup
1) `pnpm install`
2) Copy `.env.example` to `.env` and adjust as needed.
3) Start infra: `pnpm infra:up` (Postgres, Redis, Web container)
4) Run API locally: `pnpm --filter api dev`
5) Run Web locally: `pnpm --filter web dev` (uses VITE_API_BASE_URL)

## Scripts (root)
- `pnpm dev` — api dev server
- `pnpm --filter web dev` — web dev server
- `pnpm -r typecheck` — typecheck all packages
- `pnpm infra:up` / `pnpm infra:down` — bring up/down Postgres, Redis, Web

## Notes / Next additions
- Add API service to docker-compose when ready to run API in Docker (keep port 9000).
- Keep `apps/web` targeting API via `VITE_API_BASE_URL`.
- Add migrations/jobs/endpoints per Copilot prompt sequence.
