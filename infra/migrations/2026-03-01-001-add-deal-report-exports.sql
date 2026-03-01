-- deal_report_exports
-- Stores one row per server-side PDF export request.
-- A BullMQ job (export_report_pdf) processes each row asynchronously.

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_report_exports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  requested_by        text        NULL,           -- Clerk userId, nullable for system-initiated exports
  status              text        NOT NULL DEFAULT 'pending'
                        CONSTRAINT deal_report_exports_status_check
                          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  export_config       jsonb       NOT NULL DEFAULT '{}',   -- ReportExportConfig JSON
  r2_key              text        NULL,           -- R2 object key once uploaded
  download_url        text        NULL,           -- Signed or public URL after completion
  error_message       text        NULL,           -- Set on failure
  job_id              text        NULL,           -- BullMQ / persisted job_id for polling
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_report_exports_deal_id
  ON public.deal_report_exports (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_report_exports_deal_status
  ON public.deal_report_exports (deal_id, status);

CREATE INDEX IF NOT EXISTS idx_deal_report_exports_job_id
  ON public.deal_report_exports (job_id)
  WHERE job_id IS NOT NULL;

COMMENT ON TABLE  public.deal_report_exports IS
  'Tracks server-side PDF export requests for due-diligence reports. Each row represents one export job processed by the export_report_pdf BullMQ worker.';
COMMENT ON COLUMN public.deal_report_exports.export_config IS
  'ReportExportConfig JSON: { preset, format, sections[], includeCoverPage?, includePageNumbers? }';
COMMENT ON COLUMN public.deal_report_exports.r2_key IS
  'R2 object key for the generated PDF, e.g. deals/{dealId}/exports/{timestamp}-{hash}.pdf';

COMMIT;
