-- Enforce non-empty document_id where present.
-- Use NOT VALID so historical rows do not block migration; new writes are enforced.

BEGIN;

-- jobs: require non-empty document_id when provided
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conname = 'jobs_document_id_non_empty'
	) THEN
		ALTER TABLE jobs
			ADD CONSTRAINT jobs_document_id_non_empty
			CHECK (document_id IS NULL OR length(trim(document_id::text)) > 0)
			NOT VALID;
	END IF;
END $$;

-- Strengthen existing extract_visuals constraint to also forbid empty strings
ALTER TABLE jobs
	DROP CONSTRAINT IF EXISTS jobs_extract_visuals_requires_document_id;

ALTER TABLE jobs
	ADD CONSTRAINT jobs_extract_visuals_requires_document_id
	CHECK (type <> 'extract_visuals' OR (document_id IS NOT NULL AND length(trim(document_id::text)) > 0))
	NOT VALID;

-- evidence: if document_id is set, it must be non-empty
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conname = 'evidence_document_id_non_empty'
	) THEN
		ALTER TABLE evidence
			ADD CONSTRAINT evidence_document_id_non_empty
			CHECK (document_id IS NULL OR length(trim(document_id::text)) > 0)
			NOT VALID;
	END IF;
END $$;

COMMIT;
