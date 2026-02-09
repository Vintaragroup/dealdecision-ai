-- Enforce non-empty document_id where present.
-- Use NOT VALID so historical rows do not block migration; new writes are enforced.

BEGIN;

-- jobs: require non-empty document_id when provided
ALTER TABLE jobs
	ADD CONSTRAINT IF NOT EXISTS jobs_document_id_non_empty
	CHECK (document_id IS NULL OR length(trim(document_id)) > 0)
	NOT VALID;

-- Strengthen existing extract_visuals constraint to also forbid empty strings
ALTER TABLE jobs
	DROP CONSTRAINT IF EXISTS jobs_extract_visuals_requires_document_id;

ALTER TABLE jobs
	ADD CONSTRAINT jobs_extract_visuals_requires_document_id
	CHECK (type <> 'extract_visuals' OR (document_id IS NOT NULL AND length(trim(document_id)) > 0))
	NOT VALID;

-- evidence: if document_id is set, it must be non-empty
ALTER TABLE evidence
	ADD CONSTRAINT IF NOT EXISTS evidence_document_id_non_empty
	CHECK (document_id IS NULL OR length(trim(document_id)) > 0)
	NOT VALID;

COMMIT;
