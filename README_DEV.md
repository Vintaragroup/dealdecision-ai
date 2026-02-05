# DealDecisionAI – local development

This repo supports **one canonical local Docker stack**:
- Compose file: `docker-compose.local.yml`
- Fixed host ports:
  - Postgres: `55433` (container `5432`)
  - Redis: `6380` (container `6379`)
  - API: `9001` (container `9000`)
  - Web: `4174`
  - Vision worker: `8001` (container `8000`)

Render deployments are controlled by `render.yaml` and Dockerfiles. Render does **not** use docker-compose.

## Env files (important)

Do not rely on one `.env` for both host tooling and containers.

- `.env.local` (host tooling only, gitignored)
  - Used when running commands on your machine (migrations, scripts, `pnpm --filter ...`)
  - Uses `localhost:55433` and `localhost:6380`

- `.env.docker.local` (docker compose only, gitignored)
  - Loaded via `env_file:` in `docker-compose.local.yml`
  - Uses compose service names (`postgres`, `redis`)

Start from `.env.example` to see all supported keys.

### Web build-time API URL

The production-shaped `web` image bakes the API base URL into the Vite bundle at build time.

- Default: `http://localhost:9001`
- Override for compose builds: set `WEB_VITE_API_BASE_URL` in your shell (or via `docker compose --env-file ...`).

This intentionally does **not** read `VITE_API_BASE_URL` from the repo-root `.env`, which may contain legacy values.

## Start the canonical stack

Production-shaped (built from the same Dockerfiles as Render):

- `pnpm local:up`
- `pnpm local:logs`
- `pnpm local:down`

Dev hot-reload profile (same Postgres/Redis/volumes):

- `pnpm local:up:dev`

## Database migrations (host-run)

With the stack running, migrations should target the canonical local Postgres on `55433`:

- `pnpm db:migrate`

This reads `DATABASE_URL` from `.env.local`.

## Legacy stacks

`infra/docker-compose.yml` is legacy and intentionally deprecated.
If you run `pnpm infra:up` it will error and direct you to the canonical commands.
