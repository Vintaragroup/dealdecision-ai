-- Migration: 2026-03-02-003-add-deal-facts-v1.sql
--
-- Creates the deal_facts_v1 table for the Deal Fact Registry v1.
-- Stores canonical non-financial deal facts extracted and validated
-- from Page Registry v1, OrchestratorReportV1, and EvidenceRegistry.
--
-- Primary key: fact_id (deterministic text)
-- Idempotent: primary key + upsert strategy prevents duplicates.
--
-- Intentionally excluded: no writes to canonical deal fields or DIO objects.

CREATE TABLE IF NOT EXISTS public.deal_facts_v1 (
  -- ── Identity ────────────────────────────────────────────────────────────
  fact_id             text          NOT NULL,
  deal_id             uuid          NOT NULL,

  -- ── Classification ──────────────────────────────────────────────────────
  type                text          NOT NULL,
  label               text          NOT NULL,

  -- ── Value ───────────────────────────────────────────────────────────────
  value               jsonb         NOT NULL,

  -- ── Context ─────────────────────────────────────────────────────────────
  timeframe           text          NULL,
  confidence          text          NOT NULL,

  -- ── Evidence & Navigation ────────────────────────────────────────────────
  sources             jsonb         NOT NULL DEFAULT '[]'::jsonb,
  page_refs           jsonb         NOT NULL DEFAULT '[]'::jsonb,

  -- ── Conflict tracking ───────────────────────────────────────────────────
  conflicts_with_fact_ids jsonb     NOT NULL DEFAULT '[]'::jsonb,

  -- ── Timestamps ──────────────────────────────────────────────────────────
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT deal_facts_v1_pkey PRIMARY KEY (fact_id),

  CONSTRAINT deal_facts_v1_type_check CHECK (type IN (
    'raise_amount',
    'valuation',
    'round_stage',
    'use_of_funds',
    'target_customer',
    'business_model',
    'pricing_model',
    'go_to_market',
    'traction_metric',
    'key_customer',
    'key_partner',
    'competitor',
    'team_key_role',
    'product_capability',
    'ai_usage_claim',
    'other',
    'unknown'
  )),

  CONSTRAINT deal_facts_v1_confidence_check CHECK (confidence IN (
    'high',
    'medium',
    'low'
  ))
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Primary lookup: all facts for a deal
CREATE INDEX IF NOT EXISTS deal_facts_v1_deal_idx
  ON public.deal_facts_v1 (deal_id);

-- Filtered lookup: facts by type for a deal (chat / API filters)
CREATE INDEX IF NOT EXISTS deal_facts_v1_deal_type_idx
  ON public.deal_facts_v1 (deal_id, type);

-- Conflict query: find facts in conflict for a deal
CREATE INDEX IF NOT EXISTS deal_facts_v1_deal_confidence_idx
  ON public.deal_facts_v1 (deal_id, confidence);

-- GIN index on value for JSON queries (type/kind filtering)
CREATE INDEX IF NOT EXISTS deal_facts_v1_value_gin
  ON public.deal_facts_v1 USING gin (value);

-- GIN index on conflicts_with_fact_ids for conflict resolution queries
CREATE INDEX IF NOT EXISTS deal_facts_v1_conflicts_gin
  ON public.deal_facts_v1 USING gin (conflicts_with_fact_ids);
