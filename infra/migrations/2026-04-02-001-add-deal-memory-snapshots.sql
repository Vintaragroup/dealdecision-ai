-- Migration: 2026-04-02-001-add-deal-memory-snapshots.sql
--
-- Creates deal_memory_snapshots to persist the memory influence summary computed
-- during Stage 5 Intelligence Pass. This enables retrospective inspection of
-- WHY memory did or did not influence the confidence score for a given run.
--
-- Stores the bounded secondary signal only — never overwrites ORS or facts.
-- One row per (deal_id, intelligence_run_id). ON CONFLICT upserts on re-run.

CREATE TABLE IF NOT EXISTS public.deal_memory_snapshots (
  id                          uuid          NOT NULL DEFAULT gen_random_uuid(),
  deal_id                     uuid          NOT NULL,
  intelligence_run_id         uuid          NOT NULL,

  -- Pool metrics
  similar_deal_count          int           NOT NULL DEFAULT 0,
  avg_similarity_pct          numeric(5,2)  NOT NULL DEFAULT 0,
  verdict_agreement_fraction  numeric(5,4)  NOT NULL DEFAULT 0,

  -- Derived signals
  memory_support_signal       boolean       NOT NULL DEFAULT false,
  memory_fragility_signal     boolean       NOT NULL DEFAULT false,

  -- Confidence adjustment applied (bounded: -10 to +5, 0 = no effect)
  confidence_adjustment       int           NOT NULL DEFAULT 0,

  -- Ordered neighbor snapshots (deal_id, verdict, similarity_pct, ors)
  neighbor_snapshots          jsonb         NOT NULL DEFAULT '[]',

  created_at                  timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT deal_memory_snapshots_pkey
    PRIMARY KEY (id),

  CONSTRAINT deal_memory_snapshots_dedup_key
    UNIQUE (deal_id, intelligence_run_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_memory_snapshots_deal_id
  ON public.deal_memory_snapshots (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_memory_snapshots_run_id
  ON public.deal_memory_snapshots (intelligence_run_id);

COMMENT ON TABLE public.deal_memory_snapshots IS
  'Persists memory influence summaries from Stage 5 Intelligence Pass. '
  'Secondary signal only — never overwrites ORS or facts.';

COMMENT ON COLUMN public.deal_memory_snapshots.confidence_adjustment IS
  'Bounded confidence adjustment applied in this run (-10 to +5). 0 = no adjustment.';

COMMENT ON COLUMN public.deal_memory_snapshots.memory_support_signal IS
  'True when ≥60% of qualifying neighbors agreed with the current verdict.';

COMMENT ON COLUMN public.deal_memory_snapshots.memory_fragility_signal IS
  'True when a clear majority of qualifying neighbors contradicted the current verdict.';

COMMENT ON COLUMN public.deal_memory_snapshots.verdict_agreement_fraction IS
  'Fraction of neighbors whose verdict matched the current deal (0.0–1.0). '
  '0 when pool too small or similarity too weak.';
