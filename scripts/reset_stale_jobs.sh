#!/usr/bin/env bash
set -euo pipefail

# Reset stale jobs in Postgres so dedupe doesn't block new work.
#
# Usage:
#   bash scripts/reset_stale_jobs.sh --deal-id <uuid>
#   bash scripts/reset_stale_jobs.sh --deal-id <uuid> --type analyze_deal
#   bash scripts/reset_stale_jobs.sh --deal-id <uuid> --max-age-minutes 30
#   bash scripts/reset_stale_jobs.sh --deal-id <uuid> --dry-run
#
# Notes:
# - Requires docker compose + the postgres service from this repo.
# - By default targets statuses that commonly block dedupe: queued,running,retrying.

DEAL_ID=""
JOB_TYPE="analyze_deal"
MAX_AGE_MINUTES="30"
STATUSES_CSV="queued,running,retrying"
DRY_RUN="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deal-id)
      DEAL_ID="$2"
      shift 2
      ;;
    --type)
      JOB_TYPE="$2"
      shift 2
      ;;
    --max-age-minutes)
      MAX_AGE_MINUTES="$2"
      shift 2
      ;;
    --statuses)
      STATUSES_CSV="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift 1
      ;;
    -h|--help)
      sed -n '1,120p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

if [[ -z "$DEAL_ID" ]]; then
  echo "Missing required --deal-id" >&2
  exit 2
fi

# Convert CSV -> SQL array literal: {a,b,c}
STATUSES_SQL_ARRAY="{${STATUSES_CSV}}"

SQL_SELECT="SELECT job_id, status, created_at, updated_at, message
  FROM jobs
 WHERE deal_id = '${DEAL_ID}'
   AND type = '${JOB_TYPE}'
   AND status = ANY('${STATUSES_SQL_ARRAY}'::text[])
   AND created_at < (now() - (${MAX_AGE_MINUTES}::int * interval '1 minute'))
 ORDER BY created_at DESC;"

SQL_UPDATE="UPDATE jobs
   SET status='failed',
       updated_at=now(),
       message=concat('[reset_stale_jobs] stale ', status, ' reset after ${MAX_AGE_MINUTES}m')
 WHERE deal_id = '${DEAL_ID}'
   AND type = '${JOB_TYPE}'
   AND status = ANY('${STATUSES_SQL_ARRAY}'::text[])
   AND created_at < (now() - (${MAX_AGE_MINUTES}::int * interval '1 minute'));"

echo "[reset_stale_jobs] deal_id=${DEAL_ID} type=${JOB_TYPE} statuses=${STATUSES_CSV} max_age_minutes=${MAX_AGE_MINUTES} dry_run=${DRY_RUN}"
echo

echo "[reset_stale_jobs] Candidates:"
docker compose exec -T postgres psql -U postgres -d dealdecision -c "$SQL_SELECT"

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "[reset_stale_jobs] Dry-run: no updates applied."
  exit 0
fi

echo
echo "[reset_stale_jobs] Applying update..."
docker compose exec -T postgres psql -U postgres -d dealdecision -c "$SQL_UPDATE"

echo
echo "[reset_stale_jobs] Remaining candidates (should be empty):"
docker compose exec -T postgres psql -U postgres -d dealdecision -c "$SQL_SELECT"
