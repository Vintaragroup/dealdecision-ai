-- Migration: financial_facts_v1 table
-- Financial Fact Registry v1 — persisted granular financial datapoints.
-- Binding spec: docs/Active/chat-assistants/XLSX_CHAT_PIPELINE_AUDIT.md
--
-- One row = one metric × one period × one source provenance.
-- Primary key is fact_id (deterministic string: factv1:{deal_id}:{metric_key}:{period_type}:{period_label}:{source_hash}).
-- Upsert keyed on fact_id: reruns overwrite the same row idempotently.

CREATE TABLE IF NOT EXISTS public.financial_facts_v1 (
  -- Deterministic primary key: factv1:{deal_id}:{metric_key}:{period_type}:{period_label}:{source_hash}
  fact_id                  text        NOT NULL,
  deal_id                  uuid        NOT NULL,

  -- Source provenance
  document_id              uuid        NULL,
  source_kind              text        NOT NULL DEFAULT 'unknown'
                             CONSTRAINT financial_facts_v1_source_kind_check
                               CHECK (source_kind IN ('xlsx', 'pdf_table', 'deck', 'unknown')),

  -- Metric identity
  metric_key               text        NOT NULL,
  metric_label             text        NULL,

  -- Period
  period_type              text        NOT NULL DEFAULT 'unknown'
                             CONSTRAINT financial_facts_v1_period_type_check
                               CHECK (period_type IN ('annual', 'quarterly', 'monthly', 'ttm', 'unknown')),
  period_label             text        NOT NULL,

  -- Value
  value                    numeric     NOT NULL,
  unit                     text        NOT NULL DEFAULT 'unknown'
                             CONSTRAINT financial_facts_v1_unit_check
                               CHECK (unit IN ('currency', 'percent', 'number', 'unknown')),
  currency                 text        NULL,

  -- Quality
  confidence               text        NOT NULL DEFAULT 'low'
                             CONSTRAINT financial_facts_v1_confidence_check
                               CHECK (confidence IN ('high', 'medium', 'low')),
  reconciliation_status    text        NULL
                             CONSTRAINT financial_facts_v1_recon_check
                               CHECK (reconciliation_status IS NULL OR reconciliation_status IN ('ok', 'conflict', 'unknown')),

  -- Provenance
  sheet_name               text        NULL,
  page_number              int         NULL,
  row_index                int         NULL,
  col_index                int         NULL,
  source_pointer           text        NULL,

  -- Evidence linkage
  evidence_id              text        NULL,
  excerpt                  text        NULL,

  -- Timestamps
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT financial_facts_v1_pkey PRIMARY KEY (fact_id)
);

-- Retrieval indexes
CREATE INDEX IF NOT EXISTS idx_financial_facts_v1_deal_id
  ON public.financial_facts_v1 (deal_id);

CREATE INDEX IF NOT EXISTS idx_financial_facts_v1_deal_metric
  ON public.financial_facts_v1 (deal_id, metric_key);

CREATE INDEX IF NOT EXISTS idx_financial_facts_v1_deal_period
  ON public.financial_facts_v1 (deal_id, period_label);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_financial_facts_v1_set_updated_at()
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
    WHERE tgname = 'trg_financial_facts_v1_updated_at'
      AND tgrelid = 'public.financial_facts_v1'::regclass
  ) THEN
    CREATE TRIGGER trg_financial_facts_v1_updated_at
      BEFORE UPDATE ON public.financial_facts_v1
      FOR EACH ROW EXECUTE FUNCTION public.fn_financial_facts_v1_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.financial_facts_v1 IS
  'Financial Fact Registry v1. Each row is one metric × period × source provenance for a deal. '
  'Upserted deterministically keyed on fact_id. Consumed by deal chat and orchestrator (read-only).';
