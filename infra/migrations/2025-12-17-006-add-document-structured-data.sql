-- Add structured_data and extraction_metadata to documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS structured_data JSONB,
  ADD COLUMN IF NOT EXISTS extraction_metadata JSONB;
