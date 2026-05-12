-- Migration: add primary_challenge_reason and challenge_factors to deal_challenge_pass_results
-- These fields are produced by the rewritten Stage 5 challenge pass (weighted analytical
-- pressure model). Both are written on every Stage 5 run going forward; existing rows
-- receive the DEFAULT values.

ALTER TABLE public.deal_challenge_pass_results
  ADD COLUMN IF NOT EXISTS primary_challenge_reason TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS challenge_factors        JSONB   NOT NULL DEFAULT '[]'::jsonb;
