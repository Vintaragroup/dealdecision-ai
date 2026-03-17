#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# evaluation/scripts/db_snapshot.sh
#
# Snapshot the local dealdecision-dev Postgres database via docker exec pg_dump.
# Writes a timestamped SQL dump to evaluation/db_snapshots/.
#
# Safety: only targets the local dev docker container.
# Requires: docker, running dealdecision-dev-postgres-1 container.
#
# Usage:
#   bash evaluation/scripts/db_snapshot.sh
#   SNAPSHOT_LABEL=before-benchmark bash evaluation/scripts/db_snapshot.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Config ───────────────────────────────────────────────────────────────────
CONTAINER_NAME="${POSTGRES_CONTAINER:-dealdecision-dev-postgres-1}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-dealdecision}"
SNAPSHOT_DIR="$REPO_ROOT/evaluation/db_snapshots"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LABEL="${SNAPSHOT_LABEL:-snapshot}"
SNAPSHOT_FILE="$SNAPSHOT_DIR/${TIMESTAMP}_${LABEL}.sql"

# ── Safety guard: refuse non-dev containers ──────────────────────────────────
if [[ "$CONTAINER_NAME" != *"dev"* ]]; then
  echo "ERROR: Container name '$CONTAINER_NAME' does not contain 'dev'."
  echo "       This script is local-dev only. Refusing to proceed."
  exit 1
fi

# ── Ensure output directory ───────────────────────────────────────────────────
mkdir -p "$SNAPSHOT_DIR"

echo "=== DealDecisionAI — DB Snapshot ==="
echo "  Container : $CONTAINER_NAME"
echo "  Database  : $DB_NAME"
echo "  Output    : $SNAPSHOT_FILE"
echo ""

# ── Verify container is running ───────────────────────────────────────────────
if ! docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
  echo "ERROR: Container '$CONTAINER_NAME' is not running."
  echo "       Start it with: docker compose -f docker-compose.dev.yml up -d postgres"
  exit 1
fi

# ── Run pg_dump inside container ─────────────────────────────────────────────
echo "Taking snapshot..."
docker exec "$CONTAINER_NAME" \
  pg_dump \
    --username "$DB_USER" \
    --no-password \
    --format plain \
    --no-owner \
    --no-acl \
    "$DB_NAME" \
  > "$SNAPSHOT_FILE"

BYTES="$(wc -c < "$SNAPSHOT_FILE" | tr -d ' ')"
echo "Snapshot complete."
echo "  File  : $SNAPSHOT_FILE"
echo "  Size  : ${BYTES} bytes"
echo ""
echo "To restore later:"
echo "  docker exec -i $CONTAINER_NAME psql -U $DB_USER $DB_NAME < $SNAPSHOT_FILE"
