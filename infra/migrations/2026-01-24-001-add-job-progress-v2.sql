-- Extend jobs table to support structured, persistent progress reporting.
-- Safe for existing rows (ADD COLUMN IF NOT EXISTS + backfills).

BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS queue TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS progress_current INTEGER,
  ADD COLUMN IF NOT EXISTS progress_total INTEGER,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS parent_job_id TEXT,
  ADD COLUMN IF NOT EXISTS page_start INTEGER,
  ADD COLUMN IF NOT EXISTS page_end INTEGER;

-- Backfill queue to match type for existing rows.
UPDATE jobs
   SET queue = COALESCE(queue, type)
 WHERE queue IS NULL;

-- Best-effort: if payload exists, hydrate page range + parent references.
UPDATE jobs
   SET page_start = COALESCE(
         page_start,
         CASE WHEN (payload->>'page_start') ~ '^[0-9]+$' THEN (payload->>'page_start')::int END
       ),
       page_end = COALESCE(
         page_end,
         CASE WHEN (payload->>'page_end') ~ '^[0-9]+$' THEN (payload->>'page_end')::int END
       ),
       parent_job_id = COALESCE(parent_job_id, NULLIF(payload->>'parent_job_id', ''))
 WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_deal_updated_at ON jobs(deal_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id ON jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue);

COMMIT;
