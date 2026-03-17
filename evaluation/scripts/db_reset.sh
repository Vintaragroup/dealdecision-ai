#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# evaluation/scripts/db_reset.sh
#
# Clean-room reset for the local dealdecision-dev Postgres database.
#
# Workflow:
#   1. [Optional] Auto-snapshot before reset (set SKIP_SNAPSHOT=1 to skip)
#   2. Drop all application tables (preserve pg_catalog / pg_toast)
#   3. Run fresh migrations via: pnpm db:migrate
#   4. Verify clean state (zero deals)
#
# Safety guards:
#   - Requires explicit --confirm flag or CONFIRM_RESET=yes env var
#   - Validates container name contains "dev"
#   - Uses DROP TABLE cascade — does NOT drop/recreate the database itself
#     (avoids needing superuser permissions to recreate DB)
#
# Usage:
#   bash evaluation/scripts/db_reset.sh --confirm
#   CONFIRM_RESET=yes bash evaluation/scripts/db_reset.sh
#   SKIP_SNAPSHOT=1 CONFIRM_RESET=yes bash evaluation/scripts/db_reset.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Config ───────────────────────────────────────────────────────────────────
CONTAINER_NAME="${POSTGRES_CONTAINER:-dealdecision-dev-postgres-1}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-dealdecision}"
SKIP_SNAPSHOT="${SKIP_SNAPSHOT:-0}"
CONFIRM_RESET="${CONFIRM_RESET:-}"

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM_RESET=yes ;;
    --skip-snapshot) SKIP_SNAPSHOT=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Safety guard: dev containers only ────────────────────────────────────────
if [[ "$CONTAINER_NAME" != *"dev"* ]]; then
  echo "ERROR: Container '$CONTAINER_NAME' is not a dev container. Refusing."
  exit 1
fi

# ── Safety guard: explicit confirmation required ──────────────────────────────
if [[ "$CONFIRM_RESET" != "yes" ]]; then
  echo "ERROR: This script will wipe all local dev data."
  echo ""
  echo "  Re-run with --confirm flag or set CONFIRM_RESET=yes"
  echo ""
  echo "  Example:"
  echo "    bash evaluation/scripts/db_reset.sh --confirm"
  echo ""
  exit 1
fi

# ── Verify container is running ───────────────────────────────────────────────
if ! docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
  echo "ERROR: Container '$CONTAINER_NAME' is not running."
  exit 1
fi

echo "=== DealDecisionAI — Clean-Room DB Reset ==="
echo "  Container : $CONTAINER_NAME"
echo "  Database  : $DB_NAME"
echo ""

# ── Step 1: Auto-snapshot before reset ───────────────────────────────────────
if [[ "$SKIP_SNAPSHOT" != "1" ]]; then
  echo "Step 1/3: Taking pre-reset snapshot..."
  SNAPSHOT_LABEL=pre-reset bash "$SCRIPT_DIR/db_snapshot.sh"
  echo ""
else
  echo "Step 1/3: Snapshot skipped (SKIP_SNAPSHOT=1)."
  echo ""
fi

# ── Step 2: Drop all application tables ──────────────────────────────────────
echo "Step 2/3: Dropping all application tables..."

# Build dynamic DROP TABLE list — drop all tables in public schema (app data)
# Preserves the database itself; only removes application tables.
docker exec "$CONTAINER_NAME" psql \
  --username "$DB_USER" \
  --no-password \
  --dbname "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  <<'PSQL'
-- Disable triggers temporarily to avoid FK constraint ordering issues
SET session_replication_role = 'replica';

-- Drop all tables in public schema using dynamic SQL
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    RAISE NOTICE 'Dropped table: %', r.tablename;
  END LOOP;
END $$;

-- Also drop the migrations tracking table if present
DROP TABLE IF EXISTS public._migrations CASCADE;
DROP TABLE IF EXISTS public.schema_migrations CASCADE;
DROP TABLE IF EXISTS public.knex_migrations CASCADE;
DROP TABLE IF EXISTS public.knex_migrations_lock CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

SELECT 'All tables dropped' AS status;
PSQL

echo "Tables dropped."
echo ""

# ── Step 3: Run fresh migrations ─────────────────────────────────────────────
echo "Step 3/3: Running migrations..."
cd "$REPO_ROOT"
pnpm db:migrate
echo ""

# ── Verify clean state ────────────────────────────────────────────────────────
echo "=== Verifying clean state... ==="
bash "$SCRIPT_DIR/db_verify.sh"
