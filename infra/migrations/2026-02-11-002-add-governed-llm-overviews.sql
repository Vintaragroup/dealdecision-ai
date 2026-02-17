-- PR2B: Governed LLM overlay artifact table (non-authoritative, evidence-bound)

BEGIN;

CREATE TABLE IF NOT EXISTS governed_llm_overviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  schema_version TEXT NOT NULL,
  llm_phase_mode TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  run_id TEXT NULL,
  step_run_id TEXT NULL,
  summary_text TEXT NOT NULL,
  claims JSONB NOT NULL,
  disclosures JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT governed_llm_overviews_schema_version_check
    CHECK (schema_version = 'governed_llm_overview_v1'),
  CONSTRAINT governed_llm_overviews_llm_phase_mode_check
    CHECK (llm_phase_mode IN ('exploratory','stabilizing','governed')),
  CONSTRAINT governed_llm_overviews_deal_input_unique
    UNIQUE (deal_id, input_hash, schema_version)
);

CREATE INDEX IF NOT EXISTS idx_governed_llm_overviews_deal_latest
  ON governed_llm_overviews(deal_id, created_at DESC);

COMMIT;
