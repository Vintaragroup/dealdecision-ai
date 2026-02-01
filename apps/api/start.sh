#!/bin/sh
set -e

echo "[api] startup: running migrations"

if [ -n "${DATABASE_URL:-}" ]; then
  echo "[api] DATABASE_URL is set"
else
  echo "[api] WARNING: DATABASE_URL is not set"
fi

cd /app

echo "[api] pnpm --filter api db:migrate"
pnpm --filter api db:migrate

echo "[api] starting api"
exec pnpm --filter api start
