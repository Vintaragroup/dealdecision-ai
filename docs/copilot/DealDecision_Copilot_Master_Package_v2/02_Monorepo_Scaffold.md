# Copilot Prompt 02 — Create Monorepo Scaffold (pnpm)

Goal: Initialize a pnpm monorepo with:
- apps/web (existing Vite React TS app; keep code)
- apps/api (Fastify TS)
- apps/worker (BullMQ TS)
- packages/contracts (shared TS types)
- packages/core (shared logic placeholders)
- infra/ (docker compose + migrations)
- root config files

Tasks:
1) Create:
- `pnpm-workspace.yaml`
- root `package.json` with scripts: dev/build/typecheck/infra:up/infra:down
- `tsconfig.base.json`
- `.env.example` (API on port 9000)
2) Add minimal `apps/api`, `apps/worker`, `packages/contracts`, `packages/core` each with:
- `package.json`
- `tsconfig.json`
- `src/index.ts` (stub)
3) Add `infra/docker-compose.yml` with Postgres + Redis (ports 5432 and 6379).

Constraints:
- Do not redesign the frontend; only move/adjust paths into `apps/web`.
- Keep it minimal (no ORM yet).
- Provide commands to run locally: `pnpm install`, `pnpm infra:up`, `pnpm dev`.
