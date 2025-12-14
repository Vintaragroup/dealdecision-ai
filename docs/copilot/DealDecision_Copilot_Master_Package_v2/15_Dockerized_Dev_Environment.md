# Copilot Prompt 15 — Dockerized Dev Environment (API on localhost:9000)

Goal: Dockerize the development environment so a developer can run the whole system with one command.

Non-negotiable:
- API must be reachable at **http://localhost:9000**.

Tasks:

## A) Dockerfiles (dev)
Create:
- `apps/api/Dockerfile.dev`
- `apps/worker/Dockerfile.dev`
- `apps/web/Dockerfile.dev`

Requirements:
- Use Node 20
- Use corepack + pnpm
- Install workspace dependencies
- Use bind mounts for source code
- Run dev servers with hot reload

## B) docker-compose
Update/Create `infra/docker-compose.yml` with services:
- `postgres` (5432)
- `redis` (6379)
- `api` (expose **9000:9000**)
- `worker` (no public ports)
- `web` (expose 5173:5173 OR 3000:5173 depending on preference)

### Environment wiring
- `api` should use `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/dealdecision`
- `worker` uses same `DATABASE_URL` + `REDIS_URL=redis://redis:6379`
- `web` must use `VITE_API_BASE_URL=http://localhost:9000` for browser requests

## C) File watching reliability
If using bind mounts, set for web:
- `CHOKIDAR_USEPOLLING=true`
- `WATCHPACK_POLLING=true` (if needed)

## D) Migrations
Implement a safe migration strategy:
Option 1: a `migrate` one-shot service that runs before api starts
Option 2: api entrypoint runs migrations on startup (idempotent)

## E) Docs
Update root README with:
- `docker compose -f infra/docker-compose.yml up --build`
- Access:
  - Web: http://localhost:5173
  - API: http://localhost:9000/api/v1/health
- Troubleshooting watch mode.

Constraints:
- Keep it minimal.
- Do not add cloud IaC.
- Do not change UI visuals.
