-- Migration: Add deterministic understanding patch persistence
-- Version: 2026-01-31-001-add-understanding-patches
-- Description: Stores versioned deterministic UnderstandingPatch artifacts keyed by deal_id + analysis_version + input_hash.
-- Notes:
--   - Uses JSONB for efficient storage and future querying.
--   - Determinism must NOT rely on JSON key order; tests should compare canonicalized objects (e.g., stable stringify / deep-equal on parsed structures).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

CREATE TABLE IF NOT EXISTS understanding_patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  patch_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_understanding_patches_deal_version_hash
  ON understanding_patches(deal_id, analysis_version, input_hash);

CREATE INDEX IF NOT EXISTS idx_understanding_patches_deal_version_created
  ON understanding_patches(deal_id, analysis_version, created_at DESC);

COMMIT;
