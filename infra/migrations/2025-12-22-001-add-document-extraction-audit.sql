-- Store historical snapshots of document extraction/verification so remediation never destroys prior raw/canonical data.

BEGIN;

CREATE TABLE IF NOT EXISTS document_extraction_audit (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Snapshot of what existed before remediation overwrote canonical fields
  structured_data JSONB,
  extraction_metadata JSONB,
  full_content JSONB,
  full_text TEXT,

  verification_status TEXT,
  verification_result JSONB,

  reason TEXT,
  triggered_by_job_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_extraction_audit_document_id ON document_extraction_audit(document_id);
CREATE INDEX IF NOT EXISTS idx_document_extraction_audit_deal_id ON document_extraction_audit(deal_id);
CREATE INDEX IF NOT EXISTS idx_document_extraction_audit_created_at ON document_extraction_audit(created_at);

COMMIT;
