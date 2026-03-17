#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# evaluation/scripts/db_verify.sh
#
# Verify the local dealdecision-dev Postgres database is in a clean state.
# Reports counts of deals, documents, facts, and analysis artifacts.
#
# Usage:
#   bash evaluation/scripts/db_verify.sh           # expect zero deals after reset
#   bash evaluation/scripts/db_verify.sh --after   # report counts after upload
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER_NAME="${POSTGRES_CONTAINER:-dealdecision-dev-postgres-1}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-dealdecision}"

MODE="${1:-}"

# ── Safety guard ──────────────────────────────────────────────────────────────
if [[ "$CONTAINER_NAME" != *"dev"* ]]; then
  echo "ERROR: Not a dev container. Refusing."
  exit 1
fi

# ── Verify container is running ───────────────────────────────────────────────
if ! docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
  echo "ERROR: Container '$CONTAINER_NAME' is not running."
  exit 1
fi

echo "=== DealDecisionAI — DB State Verification ==="
echo "  Container : $CONTAINER_NAME"
echo "  Database  : $DB_NAME"
echo "  Timestamp : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PSQL_CMD="docker exec $CONTAINER_NAME psql --username $DB_USER --no-password --dbname $DB_NAME"

echo "--- Tables in public schema ---"
$PSQL_CMD -c "SELECT count(*) AS table_count FROM pg_tables WHERE schemaname = 'public';"

echo ""
echo "--- Core entity counts ---"
$PSQL_CMD -c "
SELECT
  'deals'      AS table_name,
  count(*)     AS row_count,
  CASE WHEN count(*) = 0 THEN 'clean' ELSE 'HAS DATA' END AS state
FROM deals WHERE deleted_at IS NULL
UNION ALL SELECT
  'documents', count(*),
  CASE WHEN count(*) = 0 THEN 'clean' ELSE 'HAS DATA' END
FROM documents WHERE deleted_at IS NULL
UNION ALL SELECT
  'jobs', count(*),
  CASE WHEN count(*) = 0 THEN 'clean' ELSE 'HAS DATA' END
FROM jobs
ORDER BY table_name;
"

echo ""
echo "--- Analysis artifact counts ---"
$PSQL_CMD -c "
SELECT 'deal_facts_v1'             AS table_name, count(*) AS row_count FROM deal_facts_v1
UNION ALL SELECT 'financial_facts_v1',              count(*) FROM financial_facts_v1
UNION ALL SELECT 'governed_llm_overviews',          count(*) FROM governed_llm_overviews
UNION ALL SELECT 'ingestion_reports',               count(*) FROM ingestion_reports
UNION ALL SELECT 'investor_insight_reports',        count(*) FROM investor_insight_reports
ORDER BY table_name;
"

echo ""
echo "--- Deal list ---"
$PSQL_CMD -c "
SELECT
  id::text        AS deal_id,
  name            AS deal_name,
  stage,
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
FROM deals
WHERE deleted_at IS NULL
ORDER BY created_at;
"

echo ""
echo "=== Verification complete."
