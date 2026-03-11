-- Migration: extend financial_facts_v1.source_kind allowed values
--
-- Original constraint only listed: xlsx, pdf_table, deck, unknown
-- pdf_kpi_line was already used in code but missing from constraint.
-- chart_pixel is added as part of Phase 10.4 (chart-to-financial-facts bridge).

ALTER TABLE public.financial_facts_v1
  DROP CONSTRAINT IF EXISTS financial_facts_v1_source_kind_check;

ALTER TABLE public.financial_facts_v1
  ADD CONSTRAINT financial_facts_v1_source_kind_check
    CHECK (source_kind IN (
      'xlsx',
      'pdf_table',
      'pdf_kpi_line',
      'chart_pixel',
      'deck',
      'unknown'
    ));
