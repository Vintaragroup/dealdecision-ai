-- Migration: document_page_understanding unique index
-- Version: 2026-02-03-003-document-page-understanding-unique-index
-- Description:
--   Enforce one row per (document_id, page_index, version) for deterministic upserts.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_page_understanding_doc_page_version
  ON public.document_page_understanding(document_id, page_index, version);

COMMIT;
