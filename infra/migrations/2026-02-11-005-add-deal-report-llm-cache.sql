-- PR4: Persisted cache for additive /report LLM outputs (narration/overview).
-- Does not affect deterministic report subtrees.

BEGIN;

CREATE TABLE IF NOT EXISTS deal_report_llm_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  llm_phase_mode TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  call TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  output_json JSONB NOT NULL,
  meta_json JSONB NULL,
  error_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT deal_report_llm_cache_llm_phase_mode_check
    CHECK (llm_phase_mode IN ('exploratory','stabilizing','governed')),
  CONSTRAINT deal_report_llm_cache_unique
    UNIQUE (deal_id, llm_phase_mode, inputs_hash, excerpt_hash, call, model, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_deal_report_llm_cache_deal_latest
  ON deal_report_llm_cache(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_report_llm_cache_lookup
  ON deal_report_llm_cache(deal_id, llm_phase_mode, inputs_hash, excerpt_hash, call, model, prompt_version);

COMMIT;
