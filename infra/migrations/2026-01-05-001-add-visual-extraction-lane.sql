-- Migration: Add visual extraction lane tables
-- Version: 2026-01-05-001-add-visual-extraction-lane
-- Description: Adds tables for visual extraction results (charts/tables/maps/diagrams/image-text) and generic evidence linking.
-- Notes:
--   - Additive only: does not modify existing tables/columns.
--   - Uses gen_random_uuid(); ensures pgcrypto extension is installed.
--   - Includes a commented rollback section (DOWN) for manual reversal.

-- Ensure gen_random_uuid() is available.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ============================================================================
-- visual_assets
-- One row per detected visual region/crop on a document page.
-- bbox is normalized coordinates in [0,1]: {"x":0..1, "y":0..1, "w":0..1, "h":0..1}
--   - x,y are top-left of the region
--   - w,h are width/height relative to page dimensions
-- asset_type values: chart | table | map | diagram | image_text | unknown
-- ============================================================================

CREATE TABLE IF NOT EXISTS visual_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'unknown',
  bbox JSONB NOT NULL DEFAULT '{}'::jsonb,
  image_uri TEXT NULL,
  image_hash TEXT NULL,
  extractor_version TEXT NOT NULL DEFAULT 'vision_v1',
  confidence NUMERIC NOT NULL DEFAULT 0,
  quality_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_assets_doc_page ON visual_assets(document_id, page_index);
CREATE INDEX IF NOT EXISTS idx_visual_assets_doc ON visual_assets(document_id);

-- Idempotency / upsert uniqueness:
-- - image_hash may be NULL; Postgres UNIQUE allows multiple NULLs, so we add a partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_assets_doc_page_version_hash
  ON visual_assets(document_id, page_index, extractor_version, image_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_assets_doc_page_version_nullhash
  ON visual_assets(document_id, page_index, extractor_version)
  WHERE image_hash IS NULL;

COMMENT ON TABLE visual_assets IS 'Detected visual regions/assets per document page for vision extraction (charts/tables/maps/diagrams/image-text).';
COMMENT ON COLUMN visual_assets.bbox IS 'Normalized bbox JSON in [0,1]: {x,y,w,h} relative to page dimensions.';
COMMENT ON COLUMN visual_assets.asset_type IS 'chart|table|map|diagram|image_text|unknown';

-- ============================================================================
-- visual_extractions
-- Extraction outputs for a visual_asset (OCR + structured parsed content).
-- ocr_blocks is an array of {text, bbox, confidence} with bbox normalized in [0,1].
-- ============================================================================

CREATE TABLE IF NOT EXISTS visual_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_asset_id UUID NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
  ocr_text TEXT NULL,
  ocr_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  structured_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  units TEXT NULL,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  extractor_version TEXT NOT NULL DEFAULT 'vision_v1',
  model_version TEXT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_extractions_asset ON visual_extractions(visual_asset_id);
CREATE INDEX IF NOT EXISTS idx_visual_extractions_created ON visual_extractions(created_at);

-- Optional uniqueness for latest-per-version
CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_extractions_asset_version
  ON visual_extractions(visual_asset_id, extractor_version);

COMMENT ON TABLE visual_extractions IS 'OCR + structured extraction outputs for a visual asset region.';
COMMENT ON COLUMN visual_extractions.ocr_blocks IS 'JSON array of OCR blocks: [{text, bbox:{x,y,w,h}, confidence}] with bbox normalized in [0,1].';
COMMENT ON COLUMN visual_extractions.structured_json IS 'Structured extraction payload (chart series, table cells, map bins, diagram graph, etc.).';

-- ============================================================================
-- evidence_links
-- Generic evidence linking layer for analyst-mode traceability.
-- Supports either a text snippet or a link to a visual asset region with an optional ref payload.
-- evidence_type values:
--   text_snippet | visual_asset | chart_series | table_cell | map_region | diagram_edge
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index INTEGER NULL,
  evidence_type TEXT NOT NULL,
  visual_asset_id UUID NULL REFERENCES visual_assets(id) ON DELETE SET NULL,
  ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  snippet TEXT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_links_doc ON evidence_links(document_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_visual_asset ON evidence_links(visual_asset_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_doc_type ON evidence_links(document_id, evidence_type);

COMMENT ON TABLE evidence_links IS 'Generic evidence pointers (text snippet or visual region) for traceability and analyst mode.';
COMMENT ON COLUMN evidence_links.ref IS 'JSON reference payload (e.g. {bbox, series_name, cell, region, edge}).';

COMMIT;

-- ============================================================================
-- DOWN (manual rollback)
-- This repository currently applies migrations as full SQL files; the statements
-- below are provided for manual reversal.
-- Drop order: evidence_links -> visual_extractions -> visual_assets
-- ============================================================================

-- BEGIN;
-- DROP TABLE IF EXISTS evidence_links;
-- DROP TABLE IF EXISTS visual_extractions;
-- DROP TABLE IF EXISTS visual_assets;
-- COMMIT;
