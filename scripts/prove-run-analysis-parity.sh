#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_BASE_URL_DEV="${API_BASE_URL_DEV:-http://localhost:9001}"
API_BASE_URL_PRODLIKE="${API_BASE_URL_PRODLIKE:-http://localhost:9001}"
DATABASE_URL_LOCAL="${DATABASE_URL_LOCAL:-postgres://postgres:postgres@localhost:55433/dealdecision}"

echo "[prove] repo=$ROOT_DIR"
echo "[prove] db=$DATABASE_URL_LOCAL"

echo "[prove] starting DEV-shaped stack (dealdecision-dev)"
# Use the known-good dev compose stack the workspace already runs (dealdecision-dev-* containers).
docker compose -p dealdecision-dev -f docker-compose.dev.yml down || true
docker compose -p dealdecision-dev -f docker-compose.dev.yml up -d --build

echo "[prove] running verifier in dev mode"
API_BASE_URL="$API_BASE_URL_DEV" DATABASE_URL="$DATABASE_URL_LOCAL" pnpm -s prove:run-analysis:dev

echo "[prove] starting PROD-like stack (NODE_ENV=production profile)"
docker compose -p dealdecision-dev -f docker-compose.dev.yml down || true
pnpm -s local:down || true
pnpm -s local:up

echo "[prove] running verifier in prodlike mode"
API_BASE_URL="$API_BASE_URL_PRODLIKE" DATABASE_URL="$DATABASE_URL_LOCAL" pnpm -s prove:run-analysis:prodlike

echo "[prove] done"
