-- Migration: evidence_items + pipeline run ledger hardening
-- Version: 2026-02-03-002-evidence-run-ledger-hardening
-- Description:
--   - Add updated_at triggers for evidence_items / pipeline_runs / pipeline_step_runs
--   - Add CHECK constraints for allowed statuses (NOT VALID + best-effort validate)
--   - Add evidence_items linkage columns run_id + step_run_id for run provenance
--   - (Optional, low-risk) Add default for evidence_items.extracted_at

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evidence_items_set_updated_at') THEN
    CREATE TRIGGER trg_evidence_items_set_updated_at
    BEFORE UPDATE ON evidence_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pipeline_runs_set_updated_at') THEN
    CREATE TRIGGER trg_pipeline_runs_set_updated_at
    BEFORE UPDATE ON pipeline_runs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pipeline_step_runs_set_updated_at') THEN
    CREATE TRIGGER trg_pipeline_step_runs_set_updated_at
    BEFORE UPDATE ON pipeline_step_runs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_column();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- status CHECK constraints (enforced for new rows; validate best-effort)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pipeline_runs_status') THEN
    ALTER TABLE pipeline_runs
      ADD CONSTRAINT chk_pipeline_runs_status
      CHECK (status IN ('running','succeeded','failed','canceled','blocked'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pipeline_step_runs_status') THEN
    ALTER TABLE pipeline_step_runs
      ADD CONSTRAINT chk_pipeline_step_runs_status
      CHECK (status IN ('running','succeeded','failed','skipped','blocked'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE pipeline_runs VALIDATE CONSTRAINT chk_pipeline_runs_status;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping validation for chk_pipeline_runs_status (existing rows may be nonconforming)';
  END;

  BEGIN
    ALTER TABLE pipeline_step_runs VALIDATE CONSTRAINT chk_pipeline_step_runs_status;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping validation for chk_pipeline_step_runs_status (existing rows may be nonconforming)';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- evidence_items linkage columns
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_items
  ADD COLUMN IF NOT EXISTS run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS step_run_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evidence_items_run_id') THEN
    ALTER TABLE evidence_items
      ADD CONSTRAINT fk_evidence_items_run_id
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evidence_items_step_run_id') THEN
    ALTER TABLE evidence_items
      ADD CONSTRAINT fk_evidence_items_step_run_id
      FOREIGN KEY (step_run_id) REFERENCES pipeline_step_runs(step_run_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evidence_items_run_id ON evidence_items(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_items_step_run_id ON evidence_items(step_run_id);

-- ---------------------------------------------------------------------------
-- Optional low-risk defaults
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_items
  ALTER COLUMN extracted_at SET DEFAULT now();

COMMIT;
