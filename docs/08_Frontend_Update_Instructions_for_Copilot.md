# Frontend Update Instructions for Copilot

## Live vs Mock
- Live mode: set `VITE_BACKEND_MODE=live` and `VITE_API_BASE_URL=http://localhost:9000`.
- Mock mode: omit/override `VITE_BACKEND_MODE`; UI uses bundled mock data.

## Env Vars (web)
```
VITE_API_BASE_URL=http://localhost:9000
VITE_BACKEND_MODE=live
```

## Run Steps (live)
1) Start infra: Postgres + Redis (e.g., `docker-compose -f infra/docker-compose.yml up -d`).
2) Run migrations: `pnpm --filter api db:migrate`.
3) Start API: `pnpm --filter api dev` (or `start`).
4) Start web: `pnpm --filter web dev` (ensuring env vars above). Navigate to the dev URL.

## What should work in live mode
- Deals list/detail via `/api/v1/deals` and `/api/v1/deals/:deal_id`.
- Trigger analyze: `POST /api/v1/deals/:deal_id/analyze` (returns job id).
- Job status polling or SSE via `/api/v1/events`.
- Evidence fetch trigger and listing.

## Quick Smoke (manual)
```bash
curl http://localhost:9000/api/v1/health
curl http://localhost:9000/api/v1/deals
```

## UI Notes
- Chat suggestions should not mutate state; actions are queued via API endpoints.
- Evidence chips show stored `evidence_id` with excerpts; live mode should display fetched evidence after jobs complete.
