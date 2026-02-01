# Render production mirror (local)

This repo includes a local Docker Compose setup that mirrors the **Render production blueprint** (same Dockerfiles, same service split: API + worker + vision).

The goal is parity for:
- Node/Python base images
- pnpm version
- worker system dependencies (LibreOffice, Poppler, Tesseract, fonts)
- env var **names** and service boundaries

## Files

- Render blueprint: `render.yaml`
- Local production-mirror compose: `docker-compose.prod-mirror.yml`
- Env template (copy to `.env`): `prod-mirror.env.example`

## Quick start

1) Create your local `.env` (gitignored):


2) Boot the full stack with production Dockerfiles:


3) Verify services:


4) Tail logs:


## Using host-run debug scripts against the mirror
 The web container is built with Vite and served via `vite preview`.
 Ensure the prod-mirror Vite build-time vars are set (see `prod-mirror.env.example`).
 These use `PROD_MIRROR_*` names to avoid accidentally picking up root `.env` values:
 - `PROD_MIRROR_VITE_API_BASE_URL` (should be `http://localhost:9001` for prod-mirror)
 - `PROD_MIRROR_VITE_BACKEND_MODE` (typically `live`)
 - `PROD_MIRROR_VITE_CLERK_PUBLISHABLE_KEY` (optional)
- `VISION_BASE_URL=http://localhost:8001`

Those are already present in `prod-mirror.env.example` under “Host-run helpers”.

## Notes / expected differences

- **Postgres/Redis are local containers**, not the Render managed services.
- **Auth**: the compose defaults to `DISABLE_CLERK_AUTH=1` for local convenience. Set it to `0` and provide Clerk keys if you want strict parity.
- **R2**: leave R2 vars blank if you’re not testing R2-backed rendered pages; populate them for full parity.
- **First boot schema**: the worker is configured to wait for the API healthcheck (which runs migrations) before starting, so a fresh local DB doesn’t race.

## Rebuilding to ensure parity

If your local Docker cache is stale:

- `docker compose -f docker-compose.prod-mirror.yml build --no-cache`
- `docker compose -f docker-compose.prod-mirror.yml up -d`
