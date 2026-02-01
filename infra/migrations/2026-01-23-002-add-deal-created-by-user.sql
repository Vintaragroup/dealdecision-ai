-- Add per-user deal ownership (Clerk user id)
-- This supports isolating deal lists per user and auditing who created a deal.

BEGIN;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS created_by_user_id text;

CREATE INDEX IF NOT EXISTS idx_deals_created_by_user_id_active
  ON deals (created_by_user_id)
  WHERE deleted_at IS NULL;

COMMIT;
