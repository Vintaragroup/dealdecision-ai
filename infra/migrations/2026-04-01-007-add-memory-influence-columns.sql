-- Migration: 2026-04-01-007-add-memory-influence-columns.sql
--
-- Adds memory influence columns to:
--   deal_confidence_assessments:   memory_adjustment, memory_adjustment_reason
--   deal_challenge_pass_results:   memory_challenge_used, memory_challenge_summary
--
-- These fields store the bounded secondary signal from decision memory.
-- They are nullable so existing rows remain valid without backfill.

-- ── deal_confidence_assessments ───────────────────────────────────────────────

ALTER TABLE deal_confidence_assessments
  ADD COLUMN IF NOT EXISTS memory_adjustment        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory_adjustment_reason TEXT        NOT NULL DEFAULT 'No memory adjustment applied: no memory influence data.';

-- ── deal_challenge_pass_results ───────────────────────────────────────────────

ALTER TABLE deal_challenge_pass_results
  ADD COLUMN IF NOT EXISTS memory_challenge_used    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS memory_challenge_summary TEXT        NULL;

COMMENT ON COLUMN deal_confidence_assessments.memory_adjustment IS
  'Bounded confidence adjustment from decision memory (-10 to +5). 0 = no adjustment.';
COMMENT ON COLUMN deal_confidence_assessments.memory_adjustment_reason IS
  'Human-readable explanation of why the memory adjustment was or was not applied.';
COMMENT ON COLUMN deal_challenge_pass_results.memory_challenge_used IS
  'Whether decision memory contributed to the challenge pass opposing case.';
COMMENT ON COLUMN deal_challenge_pass_results.memory_challenge_summary IS
  'Memory-derived challenge context appended to the opposing case. NULL when not used.';
