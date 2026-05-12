-- Migration: deal_challenge_pass_results table
-- Intelligence Layer — Challenge Pass subsystem
-- Binding spec: docs/intelligence-layer/04-challenge-pass-and-learning-foundations.md

CREATE TABLE IF NOT EXISTS public.deal_challenge_pass_results (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id                   uuid        NOT NULL,
  intelligence_run_id       uuid        NOT NULL,

  -- Verdict resistance
  verdict_resistance_score  int         NOT NULL,
  verdict_resistance_label  text        NOT NULL
                              CONSTRAINT deal_challenge_pass_verdict_label_check
                                CHECK (verdict_resistance_label IN ('Robust', 'Moderate', 'Fragile', 'Very Fragile')),

  -- Narrative outputs
  opposing_case_summary     text        NOT NULL DEFAULT '',

  -- Structured outputs (JSONB arrays)
  overconfident_claims      jsonb       NOT NULL DEFAULT '[]',
  missing_evidence          jsonb       NOT NULL DEFAULT '[]',
  diligence_gaps            jsonb       NOT NULL DEFAULT '[]',

  -- Denormalised flag counts
  flag_count_critical       int         NOT NULL DEFAULT 0,
  flag_count_error          int         NOT NULL DEFAULT 0,
  flag_count_warn           int         NOT NULL DEFAULT 0,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_challenge_pass_results_pkey
    PRIMARY KEY (id),

  -- One result per (deal_id, intelligence_run_id)
  CONSTRAINT deal_challenge_pass_results_dedup_key
    UNIQUE (deal_id, intelligence_run_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_challenge_pass_deal_id
  ON public.deal_challenge_pass_results (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_challenge_pass_resistance
  ON public.deal_challenge_pass_results (verdict_resistance_score);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_deal_challenge_pass_set_updated_at()
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
    WHERE tgname = 'trg_deal_challenge_pass_updated_at'
      AND tgrelid = 'public.deal_challenge_pass_results'::regclass
  ) THEN
    CREATE TRIGGER trg_deal_challenge_pass_updated_at
      BEFORE UPDATE ON public.deal_challenge_pass_results
      FOR EACH ROW EXECUTE FUNCTION public.fn_deal_challenge_pass_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.deal_challenge_pass_results IS
  'Intelligence Layer challenge pass output. Stores opposing case summary, overconfident claims, missing evidence, diligence gaps, and verdict resistance score.';
