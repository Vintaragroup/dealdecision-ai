-- Migration: add immutable platform_audit_log ledger
-- Purpose: canonical append-only audit trail for privileged/admin actions

CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id text NOT NULL CHECK (length(trim(actor_user_id)) > 0),
  actor_role text NOT NULL CHECK (length(trim(actor_role)) > 0),
  action_type text NOT NULL CHECK (length(trim(action_type)) > 0),
  entity_type text NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id text NOT NULL CHECK (length(trim(entity_id)) > 0),
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  source text NOT NULL CHECK (source IN ('ui', 'api', 'job', 'system', 'script')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_audit_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_created_at
  ON public.platform_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_actor_user_id
  ON public.platform_audit_log (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_action_type
  ON public.platform_audit_log (action_type);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_entity
  ON public.platform_audit_log (entity_type, entity_id);

-- Baseline guardrail: no general update/delete access.
REVOKE UPDATE, DELETE, TRUNCATE ON public.platform_audit_log FROM PUBLIC;

-- Best-effort tighten common app roles when present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.platform_audit_log FROM app_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ddai_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.platform_audit_log FROM ddai_app;
  END IF;
END $$;

-- Mutation blocker:
-- - UPDATE is always blocked (ledger rows are immutable).
-- - DELETE is blocked unless maintenance mode is explicitly enabled for the session:
--     SET app.platform_audit_maintenance = 'on';
CREATE OR REPLACE FUNCTION public.fn_platform_audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  maintenance_mode text := coalesce(current_setting('app.platform_audit_maintenance', true), 'off');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'platform_audit_log is append-only; updates are not allowed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF maintenance_mode = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'platform_audit_log is append-only; deletes require maintenance mode';
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_platform_audit_log_block_update'
      AND tgrelid = 'public.platform_audit_log'::regclass
  ) THEN
    CREATE TRIGGER trg_platform_audit_log_block_update
      BEFORE UPDATE ON public.platform_audit_log
      FOR EACH ROW EXECUTE FUNCTION public.fn_platform_audit_log_block_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_platform_audit_log_block_delete'
      AND tgrelid = 'public.platform_audit_log'::regclass
  ) THEN
    CREATE TRIGGER trg_platform_audit_log_block_delete
      BEFORE DELETE ON public.platform_audit_log
      FOR EACH ROW EXECUTE FUNCTION public.fn_platform_audit_log_block_mutation();
  END IF;
END $$;

COMMENT ON TABLE public.platform_audit_log IS
  'Canonical append-only platform audit ledger for privileged/admin actions. INSERT-only for application paths.';

COMMENT ON FUNCTION public.fn_platform_audit_log_block_mutation() IS
  'Blocks UPDATE and DELETE on platform_audit_log by default. DELETE allowed only with app.platform_audit_maintenance=on session setting.';
