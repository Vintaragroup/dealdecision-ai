-- Evidence table to support citations and fetch_evidence jobs
BEGIN;

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'ingest',
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_deal_id ON evidence(deal_id);
CREATE INDEX IF NOT EXISTS idx_evidence_created_at ON evidence(created_at DESC);

COMMIT;
