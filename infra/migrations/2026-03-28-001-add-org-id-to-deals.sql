BEGIN;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS org_id text;

CREATE INDEX IF NOT EXISTS idx_deals_org_id_active
  ON deals (org_id)
  WHERE deleted_at IS NULL;

-- Backfill from platform_access when we can infer the creator's org.
UPDATE deals d
SET org_id = pa.org_id,
    updated_at = now()
FROM platform_access pa
WHERE d.org_id IS NULL
  AND d.created_by_user_id IS NOT NULL
  AND pa.clerk_user_id = d.created_by_user_id
  AND pa.org_id IS NOT NULL;

COMMIT;
