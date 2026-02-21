-- Make ingestion_reports deterministic/idempotent per (deal_id, analysis_version)
BEGIN;

-- 1) Add required columns (defaults keep existing rows valid).
ALTER TABLE ingestion_reports
  ADD COLUMN IF NOT EXISTS analysis_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ingestion_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) Backfill updated_at for any legacy rows (defensive).
UPDATE ingestion_reports
   SET updated_at = COALESCE(updated_at, created_at, now());

-- 3) Dedupe legacy rows so UNIQUE(deal_id, analysis_version) can be added safely.
-- Keep the most recent row per (deal_id, analysis_version), tie-break by report_id.
WITH keep AS (
  SELECT DISTINCT ON (deal_id, analysis_version)
         report_id
    FROM ingestion_reports
   ORDER BY deal_id, analysis_version, created_at DESC, report_id DESC
)
DELETE FROM ingestion_reports ir
 WHERE NOT EXISTS (
   SELECT 1 FROM keep k WHERE k.report_id = ir.report_id
 );

-- 4) Enforce at most one row per (deal_id, analysis_version).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ingestion_reports_deal_analysis_version
  ON ingestion_reports (deal_id, analysis_version);

COMMIT;
