-- Add minimal storage for upload-first auto-profile proposals (Slice 2)
-- Keep additive: existing code can ignore these columns.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS investment_type text,
  ADD COLUMN IF NOT EXISTS round text;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS proposed_profile jsonb,
  ADD COLUMN IF NOT EXISTS proposed_profile_confidence jsonb,
  ADD COLUMN IF NOT EXISTS proposed_profile_sources jsonb,
  ADD COLUMN IF NOT EXISTS proposed_profile_warnings jsonb;
