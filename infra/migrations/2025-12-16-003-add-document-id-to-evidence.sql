-- Add optional document_id to evidence for better traceability
BEGIN;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS document_id TEXT;

CREATE INDEX IF NOT EXISTS idx_evidence_document_id ON evidence(document_id);

COMMIT;
