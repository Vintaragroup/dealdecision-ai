-- Persist canonical per-page PDF understanding artifacts (shadow-first)
BEGIN;

CREATE TABLE IF NOT EXISTS document_page_understanding (
  document_id UUID NOT NULL,
  deal_id UUID NULL,
  page_index INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT 'page_understanding_v1',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_page_understanding_unique
  ON document_page_understanding(document_id, page_index, version);

CREATE INDEX IF NOT EXISTS idx_document_page_understanding_deal_id
  ON document_page_understanding(deal_id);

COMMIT;
