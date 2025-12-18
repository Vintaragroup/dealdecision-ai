-- Ensure jobs table has all required columns
BEGIN;

-- Add columns if they don't exist (PostgreSQL doesn't have IF NOT EXISTS for columns)
ALTER TABLE IF EXISTS jobs
ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON jobs(document_id);

COMMIT;
