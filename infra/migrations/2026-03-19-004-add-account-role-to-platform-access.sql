-- Migration: Add account_role to platform_access
-- Roles from highest to lowest privilege:
--   super_admin   - full platform control (Ryan only)
--   admin         - platform-level admin (manage users, invites)
--   account_executive - deal management for an org
--   analyst       - read/analyse deals, no admin
--   client        - limited view access
ALTER TABLE platform_access
  ADD COLUMN IF NOT EXISTS account_role text NOT NULL DEFAULT 'client'
  CONSTRAINT platform_access_account_role_check
    CHECK (account_role IN ('super_admin', 'admin', 'account_executive', 'analyst', 'client'));

-- Backfill: any existing is_admin = true rows become 'admin'
UPDATE platform_access
SET account_role = 'admin'
WHERE is_admin = true AND account_role = 'client';
