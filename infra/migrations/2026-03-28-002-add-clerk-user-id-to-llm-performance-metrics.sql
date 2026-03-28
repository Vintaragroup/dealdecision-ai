BEGIN;

ALTER TABLE llm_performance_metrics
  ADD COLUMN IF NOT EXISTS clerk_user_id text;

CREATE INDEX IF NOT EXISTS idx_llm_metrics_clerk_user_id_created
  ON llm_performance_metrics (clerk_user_id, created_at DESC)
  WHERE clerk_user_id IS NOT NULL;

COMMIT;
