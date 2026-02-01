-- Persist original uploaded document bytes for true re-extraction.
-- Stored in a deduped blob table keyed by sha256.

CREATE TABLE IF NOT EXISTS document_file_blobs (
  sha256 TEXT PRIMARY KEY,
  bytes BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_files (
  document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL REFERENCES document_file_blobs(sha256),
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_files_sha256 ON document_files(sha256);
