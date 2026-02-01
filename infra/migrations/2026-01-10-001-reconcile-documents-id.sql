-- Migration: Reconcile documents primary key to UUID `id` and preserve legacy identifiers
-- Context: Ticket 0 — Schema Ambiguity Resolution
-- Safe/idempotent: uses IF NOT EXISTS and guards PK recreation

-- Ensure gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

DO $$
DECLARE
  pk_name text;
  pk_on_id boolean;
BEGIN
  -- Ensure `id` column exists and is populated
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'id'
  ) THEN
    ALTER TABLE documents ADD COLUMN id UUID;
  END IF;

  ALTER TABLE documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
  UPDATE documents SET id = gen_random_uuid() WHERE id IS NULL;
  ALTER TABLE documents ALTER COLUMN id SET NOT NULL;

  -- Preserve legacy document identifiers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'legacy_document_id'
  ) THEN
    ALTER TABLE documents ADD COLUMN legacy_document_id TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'document_id'
  ) THEN
    UPDATE documents
      SET legacy_document_id = document_id
    WHERE legacy_document_id IS NULL;
  END IF;

  -- Drop existing PK if it is not on `id`
  SELECT tc.constraint_name INTO pk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'documents'
    AND tc.constraint_type = 'PRIMARY KEY'
  LIMIT 1;

  pk_on_id := EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'documents'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND kcu.column_name = 'id'
  );

  IF pk_name IS NOT NULL AND NOT pk_on_id THEN
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', pk_name);
  END IF;

  -- Add PK on `id` if missing
  IF NOT pk_on_id THEN
    BEGIN
      ALTER TABLE documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  -- Preserve uniqueness of legacy document_id values (if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'document_id'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_document_id ON documents(document_id)';
  END IF;
END $$;

COMMIT;
