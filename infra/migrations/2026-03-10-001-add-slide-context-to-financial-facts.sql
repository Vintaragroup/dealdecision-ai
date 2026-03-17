-- Migration: add slide context columns to financial_facts_v1
-- Phase 10 — Slide-Aware Financial Extraction Integration
--
-- Adds two optional provenance columns that capture the slide classification
-- signals produced by the DPU pipeline:
--   slide_type  — resolved_slide_type from document_page_understanding payload
--                 (e.g. "financials", "traction", "raise_terms", "use_of_funds")
--   slide_title — slide_title from document_page_understanding payload
--
-- Both columns are nullable; existing rows are unaffected.

ALTER TABLE public.financial_facts_v1
  ADD COLUMN IF NOT EXISTS slide_type  text NULL,
  ADD COLUMN IF NOT EXISTS slide_title text NULL;

-- Index for coverage/signal queries by slide_type (used by benchmark runner)
CREATE INDEX IF NOT EXISTS financial_facts_v1_slide_type_idx
  ON public.financial_facts_v1 (deal_id, slide_type)
  WHERE slide_type IS NOT NULL;

COMMENT ON COLUMN public.financial_facts_v1.slide_type IS
  'Resolved slide type from DPU payload (e.g. financials, traction). NULL when slide context was unavailable.';
COMMENT ON COLUMN public.financial_facts_v1.slide_title IS
  'Extracted slide title from DPU payload. NULL when slide context was unavailable.';
