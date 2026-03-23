-- Migration: add provenance_metadata JSONB column to financial_facts_v1
-- Phase 2A–2E — Financial Fact Provenance Metadata Persistence
--
-- Stores all formula traceability, dependency graph, and extraction
-- assumption metadata produced by the XLSX extraction pipeline that
-- previously existed only in TypeScript types (not persisted to DB).
--
-- Fields packed into provenance_metadata JSONB:
--   value_kind                  — "literal" | "formula" | "unknown"
--   formula                     — raw Excel formula string (nullable)
--   cross_sheet_refs            — worksheet names referenced by formula
--   named_range_refs            — workbook-level named ranges in formula
--   resolved_cross_sheet_values — resolved direct cross-tab cell values
--   formula_dependencies        — direct single-cell deps (same+cross sheet)
--   dependency_depth            — formula hop depth from literal leaf inputs
--   circular_reference_detected — true when a dep is in a circular chain
--   temporal_scope              — "historical"|"current"|"projected"|"scenario"|"unknown"
--   scenario                    — scenario label (Base/Upside/Bear etc.)
--   cross_source_status         — deck vs workbook reconciliation status
--   unit_scale_factor_applied   — numeric scale factor (1000, 1000000, etc.)
--   unit_scale_source_text      — scale indicator text ("in thousands" etc.)
--   normalized_period_label     — canonical period after parsePeriodLabel()
--   original_period_label       — raw period header before normalization
--   typing_reason               — why this metric_key was assigned
--
-- Design:
--   - Additive only: NULL for all pre-migration rows (backward-compatible reads)
--   - Single JSONB column: avoids 16+ new CHECK constraints; naturally works
--     for nested types (resolved_cross_sheet_values, formula_dependencies)
--   - Safe deploy ordering: column add is instant (no table rewrite)

ALTER TABLE public.financial_facts_v1
  ADD COLUMN IF NOT EXISTS provenance_metadata JSONB NULL;

COMMENT ON COLUMN public.financial_facts_v1.provenance_metadata IS
  'Packed formula traceability, dependency graph, and extraction assumption metadata '
  'produced by the XLSX pipeline (Phases 2A–2E). NULL for non-XLSX sources and for '
  'facts ingested before this migration. See FinancialFactV1 TypeScript type for '
  'field-level documentation.';
