-- Migration: investor_insight_reports table
-- Investor Insight Engine – Stage 0 persistence (PR1)
-- Binding spec: docs/Active/Authoritative/investor-analysis-engine/

CREATE TABLE IF NOT EXISTS public.investor_insight_reports (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id              uuid        NOT NULL,
  engine_version       text        NOT NULL DEFAULT 'v1',
  upstream_fingerprint text        NOT NULL DEFAULT '',
  status               text        NOT NULL DEFAULT 'not_started'
                         CONSTRAINT investor_insight_reports_status_check
                           CHECK (status IN (
                             'not_started',
                             'queued',
                             'running',
                             'deterministic_only',
                             'complete',
                             'failed',
                             'quarantined'
                           )),
  -- GateStateSchema: { all_passed, results[] }
  gate_state           jsonb       NOT NULL DEFAULT '{"all_passed":false,"results":[]}',
  -- ComplianceStateSchema: { status, events[] }
  compliance_state     jsonb       NOT NULL DEFAULT '{"status":"not_run","events":[]}',
  -- RenderPackageSchema (ui_contract_v1)
  render_package       jsonb       NOT NULL DEFAULT '{}',
  -- Reserved for Stage 1+ deterministic engine outputs
  report_payload       jsonb       NOT NULL DEFAULT '{}',
  -- Audit log: ordered array of audit events (AuditLogRecord)
  audit_log            jsonb       NOT NULL DEFAULT '[]',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT investor_insight_reports_pkey
    PRIMARY KEY (id),

  -- Dedup index keyed on (deal_id, engine_version, upstream_fingerprint)
  -- per Fingerprint Contract §4.4: idempotency key prevents re-run for same upstream state
  CONSTRAINT investor_insight_reports_dedup_key
    UNIQUE (deal_id, engine_version, upstream_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_investor_insight_reports_deal_id
  ON public.investor_insight_reports (deal_id);

CREATE INDEX IF NOT EXISTS idx_investor_insight_reports_deal_status
  ON public.investor_insight_reports (deal_id, status);

CREATE INDEX IF NOT EXISTS idx_investor_insight_reports_updated_at
  ON public.investor_insight_reports (updated_at DESC);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.fn_investor_insight_reports_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_investor_insight_reports_updated_at'
      AND tgrelid = 'public.investor_insight_reports'::regclass
  ) THEN
    CREATE TRIGGER trg_investor_insight_reports_updated_at
      BEFORE UPDATE ON public.investor_insight_reports
      FOR EACH ROW EXECUTE FUNCTION public.fn_investor_insight_reports_set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.investor_insight_reports IS
  'Investor Insight Engine output store. Each row represents one engine run identified by (deal_id, engine_version, upstream_fingerprint). Render packages consumed by the UI Investor Insights tab.';
