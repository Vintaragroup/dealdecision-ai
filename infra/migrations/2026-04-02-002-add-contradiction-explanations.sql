-- Migration: add contradiction_explanations column to deal_challenge_pass_results
-- Intelligence Layer — Challenge Pass human narrative layer
-- Stores structured, human-readable explanations of detected contradictions.
-- Each item has: type, title, explanation, sources[].
-- Empty array when no contradictions detected.

ALTER TABLE deal_challenge_pass_results
  ADD COLUMN IF NOT EXISTS contradiction_explanations jsonb NOT NULL DEFAULT '[]'::jsonb;
