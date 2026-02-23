-- Migration: add / harden status CHECK constraint on investor_insight_reports
-- 
-- Required for environments where 2026-02-23-001 was already applied without
-- the CHECK constraint on the status column.
--
-- Safe to run multiple times (idempotent via DROP IF EXISTS + re-add).
-- Does NOT remove existing allowed values; only adds the full canonical set.
--
-- Required statuses (binding – RenderPackageSchema.status):
--   not_started | queued | running | deterministic_only | complete | failed | quarantined

DO $$
BEGIN
  -- Drop existing constraint if present (handles partial/stale definitions)
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'investor_insight_reports_status_check'
       AND conrelid = 'public.investor_insight_reports'::regclass
  ) THEN
    ALTER TABLE public.investor_insight_reports
      DROP CONSTRAINT investor_insight_reports_status_check;
  END IF;

  -- Add with full canonical set
  ALTER TABLE public.investor_insight_reports
    ADD CONSTRAINT investor_insight_reports_status_check
      CHECK (status IN (
        'not_started',
        'queued',
        'running',
        'deterministic_only',
        'complete',
        'failed',
        'quarantined'
      ));
END $$;
