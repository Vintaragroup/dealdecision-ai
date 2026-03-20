-- Migration: Create organization_settings table
-- Stores per-org seat entitlement and billing metadata.
-- clerk_org_id mirrors the Clerk Organization ID (e.g. "org_xxxx").
-- For single-user accounts (no Clerk org), this may reference the user's
-- personal identifier or remain empty until an org is provisioned.
CREATE TABLE IF NOT EXISTS organization_settings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id      text        NOT NULL UNIQUE,
  organization_name text,
  included_seats    integer     NOT NULL DEFAULT 1,
  seat_limit        integer     NOT NULL DEFAULT 1,
  billing_status    text        NOT NULL DEFAULT 'trial'
                    CONSTRAINT org_settings_billing_status_check
                      CHECK (billing_status IN ('trial', 'active', 'past_due', 'cancelled')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_settings_clerk_org_id ON organization_settings(clerk_org_id);
