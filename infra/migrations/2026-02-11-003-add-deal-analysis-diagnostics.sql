-- PR3: Read-only analytics snapshot table for Dev Dashboard diagnostics.
-- Non-authoritative; does not modify canonical report objects.

BEGIN;

CREATE TABLE IF NOT EXISTS deal_analysis_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  llm_phase_mode TEXT NOT NULL,

  citation_integrity_percent NUMERIC(5,2) NULL,
  numeric_claims_without_evidence INT NULL,
  semantic_drift_score NUMERIC(8,6) NULL,
  hallucination_count INT NULL,
  deterministic_coverage_ratio NUMERIC(8,6) NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT deal_analysis_diagnostics_llm_phase_mode_check
    CHECK (llm_phase_mode IN ('exploratory','stabilizing','governed')),
  CONSTRAINT deal_analysis_diagnostics_unique_snapshot
    UNIQUE (deal_id, report_id, llm_phase_mode)
);

CREATE INDEX IF NOT EXISTS idx_deal_analysis_diagnostics_deal_latest
  ON deal_analysis_diagnostics(deal_id, created_at DESC);

COMMIT;
