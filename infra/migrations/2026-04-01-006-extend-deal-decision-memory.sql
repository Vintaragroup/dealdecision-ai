-- Migration: extend deal_decision_memory with repository-required columns
-- Adds analysis_version, engine_version, scoreband_key, sector, mrr_value,
-- contradiction_count, key_risk_count, key_strength_count,
-- document_quality_score, has_xlsx.
-- Renames arr→arr_value and burn_rate→burn_rate_monthly to match MemorySnapshot type.

-- Add new columns (all nullable for backward-compat with existing rows)
ALTER TABLE public.deal_decision_memory
  ADD COLUMN IF NOT EXISTS analysis_version        int,
  ADD COLUMN IF NOT EXISTS engine_version          text,
  ADD COLUMN IF NOT EXISTS scoreband_key           text,
  ADD COLUMN IF NOT EXISTS sector                  text,
  ADD COLUMN IF NOT EXISTS mrr_value               float8,
  ADD COLUMN IF NOT EXISTS contradiction_count     int,
  ADD COLUMN IF NOT EXISTS key_risk_count          int,
  ADD COLUMN IF NOT EXISTS key_strength_count      int,
  ADD COLUMN IF NOT EXISTS document_quality_score  float8,
  ADD COLUMN IF NOT EXISTS has_xlsx               bool;

-- Rename arr → arr_value (only if old column exists and new one doesn't)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'deal_decision_memory'
       AND column_name  = 'arr'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'deal_decision_memory'
       AND column_name  = 'arr_value'
  ) THEN
    ALTER TABLE public.deal_decision_memory RENAME COLUMN arr TO arr_value;
  END IF;
END $$;

-- Rename burn_rate → burn_rate_monthly (only if old name exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'deal_decision_memory'
       AND column_name  = 'burn_rate'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'deal_decision_memory'
       AND column_name  = 'burn_rate_monthly'
  ) THEN
    ALTER TABLE public.deal_decision_memory RENAME COLUMN burn_rate TO burn_rate_monthly;
  END IF;
END $$;
