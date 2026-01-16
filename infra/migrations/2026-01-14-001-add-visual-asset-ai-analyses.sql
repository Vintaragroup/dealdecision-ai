-- Migration: Add visual asset AI analyses cache
-- Version: 2026-01-14-001-add-visual-asset-ai-analyses
-- Description: Persists grounded AI analysis results for visual assets (e.g. excel_sheet) to enable reuse across sessions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

CREATE TABLE IF NOT EXISTS visual_asset_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_asset_id UUID NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  question TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NULL,
  usage JSONB NULL,
  llm_called BOOLEAN NOT NULL DEFAULT false,
  duration_ms INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT visual_asset_ai_analyses_audience_check CHECK (audience IN ('investor','analyst')),
  CONSTRAINT visual_asset_ai_analyses_question_hash_len CHECK (length(question_hash) >= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_asset_ai_analyses_key
  ON visual_asset_ai_analyses(visual_asset_id, audience, question_hash);

CREATE INDEX IF NOT EXISTS idx_visual_asset_ai_analyses_asset_created
  ON visual_asset_ai_analyses(visual_asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_asset_ai_analyses_created
  ON visual_asset_ai_analyses(created_at DESC);

COMMIT;
