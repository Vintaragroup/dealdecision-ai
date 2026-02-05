# Render parity local stack

This repo includes **one canonical** local Docker Compose stack that mirrors the Render production blueprint shape (same Dockerfiles, same service split: API + worker + vision).

Parity goals:
- Node/Python base images
- pnpm version
- worker system dependencies (LibreOffice, Poppler, Tesseract, fonts)
- env var names and service boundaries

## Files

- Render blueprint: `render.yaml`
- Canonical local compose: `docker-compose.local.yml`
- Env key reference: `.env.example`
- Gitignored envs:
	- `.env.local` (host tooling only)
	- `.env.docker.local` (docker compose containers only)

## Quick start

1) Ensure `.env.local` and `.env.docker.local` exist (see `.env.example` for all keys).

2) Boot the production-shaped stack:

- `pnpm local:up`

3) Verify services:

- API: `http://localhost:9001/health`
- Vision: `http://localhost:8001/health`

4) Tail logs:

- `pnpm local:logs`

## Notes / expected differences

- Postgres/Redis are local containers, not Render managed services.
- Auth: compose defaults to `DISABLE_CLERK_AUTH=1` for local convenience.
- R2: leave R2 vars blank unless testing R2-backed behavior.

## Rebuilding to ensure parity

- `docker compose -f docker-compose.local.yml --profile prod build --no-cache`
- `docker compose -f docker-compose.local.yml --profile prod up -d`
