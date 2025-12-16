# DealDecision AI Monorepo

Foundation for the DealDecision AI stack (apps, workers, shared packages, infra, docs) using pnpm workspaces and TypeScript.

## Stack & Ports
- API (Fastify): http://localhost:9000
- Web (Vite React): http://localhost:5173
- Postgres: localhost:5432
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
3) Dockerized dev stack (hot reload + bind mounts)
	- `docker compose -f infra/docker-compose.yml up --build`
	- API: http://localhost:9000
	- Web: http://localhost:5173
	- Postgres: localhost:5432, user/pass `postgres`
4) Local (no Docker):
	- `pnpm --filter api dev`
	- `pnpm --filter web dev` (uses VITE_API_BASE_URL)

## Scripts (root)
- `pnpm dev` — api dev server
- `pnpm --filter web dev` — web dev server
- `pnpm -r typecheck` — typecheck all packages
- `docker compose -f infra/docker-compose.yml up --build` — full dev stack (postgres, redis, migrate, api, worker, web)
- `docker compose -f infra/docker-compose.yml down` — stop dev stack

## Notes / Next additions
- Add API service to docker-compose when ready to run API in Docker (keep port 9000).
- Keep `apps/web` targeting API via `VITE_API_BASE_URL`.
- Add migrations/jobs/endpoints per Copilot prompt sequence.
