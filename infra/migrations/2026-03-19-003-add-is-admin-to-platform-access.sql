-- Phase 3: Add app-level admin status to platform_access.
--
-- is_admin: marks a user as a platform admin who can manage access/invites.
-- This is the DB-backed source of truth for admin authority.
-- It is distinct from Clerk orgRole — Clerk orgRole continues to control
-- org-level multi-tenancy; is_admin controls platform administration.
--
-- Bootstrap: set ryan@vintaragroup.com's row to is_admin = true via the
-- bootstrap endpoint POST /api/v1/admin/bootstrap-first-admin or manually via:
--   UPDATE platform_access SET is_admin = true WHERE clerk_user_id = '<ryan_clerk_id>';

BEGIN;

ALTER TABLE platform_access
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast admin-only listing.
CREATE INDEX IF NOT EXISTS idx_platform_access_is_admin
  ON platform_access (is_admin)
  WHERE is_admin = TRUE;

COMMENT ON COLUMN platform_access.is_admin IS
  'Platform-level admin flag. Grants access to /api/v1/admin/* routes and the system admin UI. Distinct from Clerk org role.';

COMMIT;
