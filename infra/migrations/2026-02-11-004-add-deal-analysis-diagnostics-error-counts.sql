-- PR3.1: Persist overlay-attempt error counters even when overlay generation fails.
-- Adds read-only error counters to deal_analysis_diagnostics.

BEGIN;

ALTER TABLE deal_analysis_diagnostics
  ADD COLUMN IF NOT EXISTS provider_error_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_output_truncated_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_output_not_json_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guard_degraded_count INT NOT NULL DEFAULT 0;

COMMIT;
