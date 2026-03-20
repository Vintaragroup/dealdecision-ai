-- Invite codes for gated access provisioning (Phase 2).
--
-- Invite lifecycle:
--   active   → code is valid and can be redeemed
--   redeemed → code has been used; single-use by default
--   expired  → expires_at has passed before redemption
--   revoked  → manually cancelled by an admin
--
-- Redemption flow:
--   1. AE generates an invite via POST /api/v1/admin/invite-codes
--   2. AE sends the invite URL (/<path>?code=<code>) to the recipient
--   3. Recipient signs in via Clerk, then visits the invite URL
--   4. POST /api/v1/invites/redeem validates the code and provisions platform_access
--   5. platform_access.access_expires_at = now() + access_duration_days
--
-- Authorization remains enforced via platform_access only.
-- Invite codes are a provisioning mechanism, not an access layer.

BEGIN;

CREATE TABLE IF NOT EXISTS invite_codes (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        TEXT        NOT NULL,
  -- Optional: restrict redemption to a specific email address.
  email                       TEXT        NULL,
  org_id                      TEXT        NULL,
  created_by_user_id          TEXT        NULL,
  status                      TEXT        NOT NULL DEFAULT 'active'
                                          CHECK (status IN ('active', 'redeemed', 'expired', 'revoked')),
  -- Duration granted on redemption. Enforced values: 3, 5, 7, 14 days.
  access_duration_days        INTEGER     NOT NULL
                                          CHECK (access_duration_days IN (3, 5, 7, 14)),
  -- Optional: code itself expires at this time regardless of status.
  expires_at                  TIMESTAMPTZ NULL,
  -- Populated on successful redemption.
  redeemed_at                 TIMESTAMPTZ NULL,
  redeemed_by_clerk_user_id   TEXT        NULL,
  redeemed_email              TEXT        NULL,
  grant_source                TEXT        NULL,
  notes                       TEXT        NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup during redemption/validation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_code
  ON invite_codes (code);

-- Support listing active invites by status.
CREATE INDEX IF NOT EXISTS idx_invite_codes_status
  ON invite_codes (status);

-- Support optional org-level invite scoping.
CREATE INDEX IF NOT EXISTS idx_invite_codes_org_id
  ON invite_codes (org_id)
  WHERE org_id IS NOT NULL;

-- Support looking up invites by target email.
CREATE INDEX IF NOT EXISTS idx_invite_codes_email
  ON invite_codes (email)
  WHERE email IS NOT NULL;

COMMIT;
