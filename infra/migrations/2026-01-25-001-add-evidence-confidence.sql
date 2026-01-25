-- Add confidence column to evidence rows for scoring and UI rendering
--
-- Some production databases may be missing this column while application code writes it.
BEGIN;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;

COMMIT;
