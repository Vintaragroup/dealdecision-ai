-- Migration: Canonical evidence_items + pipeline run ledger
-- Version: 2026-02-03-001-add-evidence-items-and-run-ledger
-- Description:
--   - evidence_items: canonical, deduped evidence contract used by orchestration
--   - pipeline_runs: high-level run grouping (per job or trigger)
--   - pipeline_step_runs: step-level audit log (input_hash/output_hash, status, summaries)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------------------------------------------------------------------------
-- evidence_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id TEXT PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  source_type TEXT NOT NULL,
  source_path TEXT NOT NULL,

  source_document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
  source_visual_asset_id UUID NULL REFERENCES visual_assets(id) ON DELETE SET NULL,
  source_understanding_patch_id UUID NULL REFERENCES understanding_patches(id) ON DELETE SET NULL,

  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,

  extracted_at TIMESTAMPTZ NOT NULL,

  content_text TEXT NULL,
  content_json JSONB NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_items_deal_confidence_time
  ON evidence_items(deal_id, confidence DESC, extracted_at DESC, evidence_id ASC);

CREATE INDEX IF NOT EXISTS idx_evidence_items_deal_source_type
  ON evidence_items(deal_id, source_type);

CREATE INDEX IF NOT EXISTS idx_evidence_items_deal_extracted_at
  ON evidence_items(deal_id, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_items_tags_gin
  ON evidence_items USING GIN (tags);

COMMENT ON TABLE evidence_items IS 'Canonical, deduped evidence contract. All downstream analysis should consume EvidencePackets derived from these rows.';
COMMENT ON COLUMN evidence_items.source_path IS 'Stable citation path (deterministic) used in omissions and evidence links.';

-- ---------------------------------------------------------------------------
-- pipeline_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  trigger_type TEXT NOT NULL DEFAULT 'bullmq',
  trigger_job_id TEXT NULL,
  parent_run_id UUID NULL REFERENCES pipeline_runs(run_id) ON DELETE SET NULL,

  input_hash TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,

  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_deal_started
  ON pipeline_runs(deal_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_trigger_job
  ON pipeline_runs(trigger_job_id);

COMMENT ON TABLE pipeline_runs IS 'High-level run ledger for deterministic replay and auditability.';

-- ---------------------------------------------------------------------------
-- pipeline_step_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pipeline_step_runs (
  step_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,

  step_name TEXT NOT NULL,
  job_id TEXT NULL,

  input_hash TEXT NOT NULL,
  output_hash TEXT NULL,

  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,

  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_step_runs_run_step
  ON pipeline_step_runs(run_id, step_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_step_runs_job
  ON pipeline_step_runs(job_id);

COMMENT ON TABLE pipeline_step_runs IS 'Step-level ledger entries for each worker step. Records input/output hashes and summaries for deterministic replay.';

COMMIT;
