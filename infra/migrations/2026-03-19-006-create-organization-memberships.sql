-- Migration: Create organization_memberships table
-- Tracks which platform users (clerk_user_id) belong to which Clerk org,
-- their in-org role, and whether they consume a seat.
CREATE TABLE IF NOT EXISTS organization_memberships (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id             text        NOT NULL,
  clerk_user_id            text        NOT NULL,
  org_role                 text        NOT NULL DEFAULT 'org_member'
                           CONSTRAINT org_memberships_role_check
                             CHECK (org_role IN ('org_owner', 'org_manager', 'org_member')),
  membership_status        text        NOT NULL DEFAULT 'active'
                           CONSTRAINT org_memberships_status_check
                             CHECK (membership_status IN ('active', 'pending', 'revoked')),
  seat_consuming           boolean     NOT NULL DEFAULT true,
  invited_by_clerk_user_id text,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (clerk_org_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org  ON organization_memberships(clerk_org_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(clerk_user_id);
