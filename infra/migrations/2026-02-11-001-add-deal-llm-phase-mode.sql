-- PR2A: Add deterministic governance switch for progressive LLM gating.

ALTER TABLE deals
  ADD COLUMN llm_phase_mode TEXT NOT NULL DEFAULT 'exploratory';

ALTER TABLE deals
  ADD CONSTRAINT deals_llm_phase_mode_check
  CHECK (llm_phase_mode IN ('exploratory', 'stabilizing', 'governed'));
