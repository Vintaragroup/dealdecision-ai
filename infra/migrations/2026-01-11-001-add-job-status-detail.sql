-- Add structured status detail and start timestamps for jobs
BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS status_detail JSONB,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMIT;
