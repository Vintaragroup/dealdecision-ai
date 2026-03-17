-- Migration: add kpi_tile to financial_facts_v1.source_kind allowed values
--
-- Phase 10.6 introduces source_kind="kpi_tile" for KPI tile extraction from
-- investor deck slides (prominent numeric callouts like "$40K MRR", "330k users").

ALTER TABLE public.financial_facts_v1
  DROP CONSTRAINT IF EXISTS financial_facts_v1_source_kind_check;

ALTER TABLE public.financial_facts_v1
  ADD CONSTRAINT financial_facts_v1_source_kind_check
    CHECK (source_kind IN (
      'xlsx',
      'pdf_table',
      'pdf_kpi_line',
      'kpi_tile',
      'chart_pixel',
      'deck',
      'unknown'
    ));
