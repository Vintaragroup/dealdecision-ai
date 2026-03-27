-- Add persisted views counter for deal list/workspace usage tracking.
BEGIN;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS views integer NOT NULL DEFAULT 0;

COMMIT;
