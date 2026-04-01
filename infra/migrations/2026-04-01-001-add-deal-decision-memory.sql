-- Migration: deal_decision_memory table
-- Intelligence Layer — Decision Memory subsystem
-- Binding spec: docs/intelligence-layer/02-decision-memory.md

CREATE TABLE IF NOT EXISTS public.deal_decision_memory (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id                   uuid        NOT NULL,
  org_id                    uuid,
  upstream_fingerprint      text        NOT NULL DEFAULT '',

  -- 18-dim normalized feature vector (float8[])
  feature_vector            float8[]    NOT NULL DEFAULT '{}',
  -- Null mask: true where the source value was null (padded with NULL_FILL=0.5)
  vector_null_mask          bool[]      NOT NULL DEFAULT '{}',

  -- Scores at time of memory creation
  ors_score                 int,
  dci_score                 int,
  fhc_score                 int,
  urss_score                int,
  verdict                   text,

  -- Financial signals
  arr                       float8,
  burn_rate                 float8,
  runway_months             float8,
  raise_amount              float8,

  -- Deal metadata
  stage                     text,
  evidence_count            int,
  financial_completeness_pct float8,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_decision_memory_pkey
    PRIMARY KEY (id),

  -- Idempotency: one memory record per (deal_id, upstream_fingerprint)
  CONSTRAINT deal_decision_memory_dedup_key
    UNIQUE (deal_id, upstream_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_deal_decision_memory_deal_id
  ON public.deal_decision_memory (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_decision_memory_org_updated
  ON public.deal_decision_memory (org_id, updated_at DESC)
  WHERE org_id IS NOT NULL;

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_deal_decision_memory_set_updated_at()
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
    WHERE tgname = 'trg_deal_decision_memory_updated_at'
      AND tgrelid = 'public.deal_decision_memory'::regclass
  ) THEN
    CREATE TRIGGER trg_deal_decision_memory_updated_at
      BEFORE UPDATE ON public.deal_decision_memory
      FOR EACH ROW EXECUTE FUNCTION public.fn_deal_decision_memory_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.deal_decision_memory IS
  'Intelligence Layer decision memory. Each row stores the normalised feature vector for one deal run, used for similarity-based recall of past decisions.';
