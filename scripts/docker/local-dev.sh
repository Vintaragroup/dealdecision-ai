#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DEV_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dealdecision-dev}"
PROD_PROJECT_NAME="${PROD_COMPOSE_PROJECT_NAME:-dealdecision-prod}"
DEV_COMPOSE_FILE="${DEV_COMPOSE_FILE:-docker-compose.dev.yml}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.prod.yml}"

case "${1:-up}" in
  up)
    COMPOSE_PROJECT_NAME="$DEV_PROJECT_NAME" docker compose -f "$DEV_COMPOSE_FILE" up -d --build
    echo "Dev stack up:" 
    echo "- Web: http://localhost:4174"
    echo "- API: http://localhost:9001 (health: /health)"
    ;;
  rebuild)
    COMPOSE_PROJECT_NAME="$DEV_PROJECT_NAME" docker compose -f "$DEV_COMPOSE_FILE" up -d --build --force-recreate
    ;;
  down)
    COMPOSE_PROJECT_NAME="$DEV_PROJECT_NAME" docker compose -f "$DEV_COMPOSE_FILE" down
    ;;
  ps)
    COMPOSE_PROJECT_NAME="$DEV_PROJECT_NAME" docker compose -f "$DEV_COMPOSE_FILE" ps
    ;;
  logs)
    COMPOSE_PROJECT_NAME="$DEV_PROJECT_NAME" docker compose -f "$DEV_COMPOSE_FILE" logs -f --tail=200 api_dev worker_dev web_dev
    ;;
  clean-prod)
    # Remove prod stack containers by project name (reduces Docker Desktop confusion)
    COMPOSE_PROJECT_NAME="$PROD_PROJECT_NAME" docker compose -f "$PROD_COMPOSE_FILE" down --remove-orphans || true
    ;;
  *)
    echo "Usage: $0 {up|rebuild|down|ps|logs|clean-prod}" >&2
    exit 1
    ;;
esac
