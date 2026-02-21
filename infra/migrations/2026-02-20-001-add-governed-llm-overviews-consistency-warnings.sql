-- Add consistency_warnings column to governed_llm_overviews.
-- Stores an array of warning codes emitted by validateGovernedOutputConsistency()
-- after each governed LLM generation run. Non-nullable; defaults to empty array
-- so existing rows are valid without backfill.

BEGIN;

ALTER TABLE governed_llm_overviews
  ADD COLUMN IF NOT EXISTS consistency_warnings JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMIT;
