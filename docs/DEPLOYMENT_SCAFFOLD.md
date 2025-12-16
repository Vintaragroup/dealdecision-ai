# Deployment Scaffold (API + Worker)

This is a minimal on-prem/VM/docker host scaffold (no cloud IaC) for running API and worker with Postgres + Redis. It uses production Dockerfiles and a one-shot migrate service.

## Prereqs
- Docker / Docker Compose v2
- Env vars (or .env file in repo root):
  - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
  - `DATABASE_URL` (e.g., `postgresql://postgres:postgres@postgres:5432/dealdecision`)
  - `REDIS_URL` (e.g., `redis://redis:6379`)

## Compose file
`infra/docker-compose.deploy.yml` includes:
- `postgres` (5432) with volume `postgres_data`
- `redis` (6379) with volume `redis_data`
- `migrate` one-shot (runs `pnpm --filter api db:migrate`), blocks api/worker until done
- `api` on `9000:9000`
- `worker` (no exposed port)

## Run
```bash
docker compose -f infra/docker-compose.deploy.yml build
# run migrations once (optional: --exit-code-from migrate to fail fast)
docker compose -f infra/docker-compose.deploy.yml up migrate
# start app stack
docker compose -f infra/docker-compose.deploy.yml up -d api worker redis postgres
```

## Notes
- Ensure `DATABASE_URL` matches your DB credentials. Defaults point at the compose postgres service.
- To reset data locally: `docker compose -f infra/docker-compose.deploy.yml down -v` (destructive).
- Web is expected to be deployed separately (static host or its own container) pointing `VITE_API_BASE_URL` to the API.
