-- Ensure evidence.document_id exists; skip FK if unavailable
BEGIN;

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS document_id TEXT;

DO $$
DECLARE col_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'evidence' AND column_name = 'document_id'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RAISE NOTICE 'document_id column missing on evidence; skipping constraint';
    RETURN;
  END IF;

  RAISE NOTICE 'document_id column present; FK constraint intentionally skipped in this migration';
END $$;

COMMIT;
