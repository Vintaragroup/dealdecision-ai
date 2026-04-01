-- Migration: deal_confidence_assessments table
-- Intelligence Layer — Confidence Engine subsystem
-- Binding spec: docs/intelligence-layer/03-evaluator-and-calibration.md

CREATE TABLE IF NOT EXISTS public.deal_confidence_assessments (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id                   uuid        NOT NULL,
  intelligence_run_id       uuid        NOT NULL,

  -- Earned confidence (0–100, floor 10)
  overall_confidence_score  int         NOT NULL,
  overall_confidence_band   text        NOT NULL
                              CONSTRAINT deal_confidence_assessments_band_check
                                CHECK (overall_confidence_band IN ('High', 'Medium', 'Low')),

  -- Serialized penalty breakdown and sub-conclusions
  penalties_applied         jsonb       NOT NULL DEFAULT '[]',
  conclusions               jsonb       NOT NULL DEFAULT '[]',
  rationale                 text        NOT NULL DEFAULT '',

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_confidence_assessments_pkey
    PRIMARY KEY (id),

  -- One assessment per (deal_id, intelligence_run_id)
  CONSTRAINT deal_confidence_assessments_dedup_key
    UNIQUE (deal_id, intelligence_run_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_confidence_assessments_deal_id
  ON public.deal_confidence_assessments (deal_id);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_deal_confidence_assessments_set_updated_at()
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
    WHERE tgname = 'trg_deal_confidence_assessments_updated_at'
      AND tgrelid = 'public.deal_confidence_assessments'::regclass
  ) THEN
    CREATE TRIGGER trg_deal_confidence_assessments_updated_at
      BEFORE UPDATE ON public.deal_confidence_assessments
      FOR EACH ROW EXECUTE FUNCTION public.fn_deal_confidence_assessments_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.deal_confidence_assessments IS
  'Intelligence Layer confidence engine output. Stores earned confidence scores with penalty breakdown and sub-conclusions for each Stage 5 run.';
