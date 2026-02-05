-- Enforce extract_visuals job rows are always document-scoped with an explicit page range.
-- Use NOT VALID so existing historical rows do not block migration.
-- New inserts/updates will be enforced immediately.

BEGIN;

ALTER TABLE jobs
	ADD CONSTRAINT jobs_extract_visuals_requires_document_id
	CHECK (type <> 'extract_visuals' OR document_id IS NOT NULL)
	NOT VALID;

ALTER TABLE jobs
	ADD CONSTRAINT jobs_extract_visuals_requires_page_range
	CHECK (type <> 'extract_visuals' OR (page_start IS NOT NULL AND page_end IS NOT NULL))
	NOT VALID;

COMMIT;
