-- Create deals table (core entity)
-- This must run before any tables that reference deals(id).

-- Ensure gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'intake',
  priority TEXT NOT NULL DEFAULT 'medium',
  owner TEXT,
  score NUMERIC,
  trend TEXT,
  lifecycle_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_deals_stage_active ON deals(stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_priority_active ON deals(priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_updated_at ON deals(updated_at DESC);

COMMIT;
