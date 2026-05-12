-- Migration: deal_evaluation_flags table
-- Intelligence Layer — Evaluation Engine subsystem
-- Binding spec: docs/intelligence-layer/03-evaluator-and-calibration.md

CREATE TABLE IF NOT EXISTS public.deal_evaluation_flags (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  flag_id               text        NOT NULL,   -- deterministic sha256-prefix
  deal_id               uuid        NOT NULL,
  intelligence_run_id   uuid,

  flag_type             text        NOT NULL,
  severity              text        NOT NULL
                          CONSTRAINT deal_evaluation_flags_severity_check
                            CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  source_stage          text        NOT NULL,
  impacted_score        text,                   -- 'ors' | 'dci' | 'fhc' | 'urss' | null
  description           text        NOT NULL,
  detail                jsonb       NOT NULL DEFAULT '{}',
  resolution_status     text        NOT NULL DEFAULT 'open',

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_evaluation_flags_pkey
    PRIMARY KEY (id),

  -- Dedup: one flag_id row per deal (idempotent re-runs)
  CONSTRAINT deal_evaluation_flags_flag_id_key
    UNIQUE (flag_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_evaluation_flags_deal_id
  ON public.deal_evaluation_flags (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_evaluation_flags_deal_severity
  ON public.deal_evaluation_flags (deal_id, severity);

CREATE INDEX IF NOT EXISTS idx_deal_evaluation_flags_run_id
  ON public.deal_evaluation_flags (intelligence_run_id)
  WHERE intelligence_run_id IS NOT NULL;

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_deal_evaluation_flags_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_deal_evaluation_flags_updated_at'
      AND tgrelid = 'public.deal_evaluation_flags'::regclass
  ) THEN
    CREATE TRIGGER trg_deal_evaluation_flags_updated_at
      BEFORE UPDATE ON public.deal_evaluation_flags
      FOR EACH ROW EXECUTE FUNCTION public.fn_deal_evaluation_flags_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.deal_evaluation_flags IS
  'Intelligence Layer evaluation flags. Each row is a contradiction, evidence gap, or pipeline health issue detected during Stage 5. flag_id is deterministic — safe to re-run idempotently.';
