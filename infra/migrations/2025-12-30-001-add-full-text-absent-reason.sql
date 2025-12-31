-- Add explicit full_text_absent_reason for DoD compliance
-- Phase 1 DoD: documents must have full_text OR an explicit absent reason.

BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS full_text_absent_reason TEXT;

COMMIT;
