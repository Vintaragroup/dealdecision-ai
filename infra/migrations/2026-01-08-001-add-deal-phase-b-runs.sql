-- Add Phase B run persistence without touching Phase 1 schema
BEGIN;

CREATE TABLE IF NOT EXISTS deal_phase_b_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  version INT NOT NULL,
  phase_b_result JSONB NOT NULL,
  phase_b_features JSONB NOT NULL,
  source_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_phase_b_runs_deal_version
  ON deal_phase_b_runs(deal_id, version);

CREATE INDEX IF NOT EXISTS idx_deal_phase_b_runs_deal_created
  ON deal_phase_b_runs(deal_id, created_at DESC);

COMMIT;
