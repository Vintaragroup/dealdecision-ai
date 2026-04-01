-- Migration: deal_outcomes + deal_outcome_events tables
-- Intelligence Layer — Outcome Tracking subsystem
-- Binding spec: docs/intelligence-layer/04-challenge-pass-and-learning-foundations.md

-- ── deal_outcomes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deal_outcomes (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id             uuid        NOT NULL,
  org_id              uuid        NOT NULL,

  outcome_type        text        NOT NULL
                        CONSTRAINT deal_outcomes_type_check
                          CHECK (outcome_type IN (
                            'invested',
                            'passed',
                            'declined_at_screening',
                            'declined_at_diligence',
                            'follow_on',
                            'deal_died',
                            'pending'
                          )),
  outcome_date        date,
  investment_amount   float8,
  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_outcomes_pkey
    PRIMARY KEY (id),

  -- One outcome row per deal (upsertable)
  CONSTRAINT deal_outcomes_deal_id_key
    UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_outcomes_deal_id
  ON public.deal_outcomes (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_outcomes_org_id
  ON public.deal_outcomes (org_id);

CREATE INDEX IF NOT EXISTS idx_deal_outcomes_outcome_type
  ON public.deal_outcomes (outcome_type);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.fn_deal_outcomes_set_updated_at()
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
    WHERE tgname = 'trg_deal_outcomes_updated_at'
      AND tgrelid = 'public.deal_outcomes'::regclass
  ) THEN
    CREATE TRIGGER trg_deal_outcomes_updated_at
      BEFORE UPDATE ON public.deal_outcomes
      FOR EACH ROW EXECUTE FUNCTION public.fn_deal_outcomes_set_updated_at();
  END IF;
END $$;

-- ── deal_outcome_events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deal_outcome_events (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  outcome_id    uuid        NOT NULL
                  REFERENCES public.deal_outcomes(id) ON DELETE CASCADE,
  deal_id       uuid        NOT NULL,
  event_type    text        NOT NULL,
  event_date    date        NOT NULL DEFAULT CURRENT_DATE,
  notes         text,
  metadata      jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_outcome_events_pkey
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_deal_outcome_events_outcome_id
  ON public.deal_outcome_events (outcome_id);

CREATE INDEX IF NOT EXISTS idx_deal_outcome_events_deal_id
  ON public.deal_outcome_events (deal_id);

COMMENT ON TABLE public.deal_outcomes IS
  'Intelligence Layer outcome tracking. One row per deal — records the final outcome (invested, passed, etc.) for future learning loop calibration.';

COMMENT ON TABLE public.deal_outcome_events IS
  'Append-only event log linked to deal_outcomes. Stores discrete diligence or follow-on events over the lifecycle of a deal outcome.';
