# Live Mode Smoke Checklist

Use this quick check after pulling or migrating.

## Preconditions
- Postgres and Redis running (e.g., `docker-compose -f infra/docker-compose.yml up -d`).
- Env set: `DATABASE_URL`, `REDIS_URL`, `VITE_API_BASE_URL`, `VITE_BACKEND_MODE=live`.

## Steps
1) Migrate DB: `pnpm --filter api db:migrate`
2) Start API: `pnpm --filter api dev`
3) Smoke API:
   ```bash
   curl http://localhost:9000/api/v1/health
   curl http://localhost:9000/api/v1/deals
   ```
4) Start web (new terminal): `pnpm --filter web dev`
5) In the UI (live mode):
   - Confirm deals list loads from API.
   - Trigger analyze → verify job status updates (SSE/polling).
   - Trigger fetch evidence → evidence tab refreshes after job completes.

## Troubleshooting
- If health fails: check API env vars and Postgres/Redis availability.
- If jobs don’t update: confirm REDIS_URL and that worker is running.
- If evidence is empty: ensure documents exist for the deal; fetch_evidence dedupes by document_id.
