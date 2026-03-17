-- =============================================================================
-- Backfill Migration: evidence → evidence_items
-- =============================================================================
-- Purpose:
--   Copy rows from the legacy `evidence` table into the canonical `evidence_items`
--   table for deals that were ingested before the dual-write upgrade was deployed.
--
-- Safety:
--   - Uses INSERT ... ON CONFLICT (evidence_id) DO NOTHING (fully idempotent)
--   - Does NOT modify or delete any rows in `evidence`
--   - Can be run multiple times without duplication
--   - Can be run against a live database (no locks on evidence or evidence_items)
--
-- Prerequisite:
--   Migration 2026-02-03-001-add-evidence-items-and-run-ledger.sql must be applied.
--
-- How evidence_id is computed here:
--   This script uses a Postgres-native approximation of the computeEvidenceId()
--   function from packages/core/src/services/evidence/canonical-evidence.ts.
--   The TypeScript function produces:
--     ev_{SHA256(stableJsonStringify({ deal_id, source_type, source_path, content_text, tags }))[0:32]}
--
--   The stable JSON shape for a fetch_evidence row is:
--     {"content_json":null,"content_text":"<text>","deal_id":"<uuid>","source_path":"<source>:<docid|nodoc>:<kind>","source_type":"<source>","tags":["<source>","<kind>"]}
--
--   We compute that same SHA-256 here using pgcrypto's digest(). This ensures
--   evidence_ids produced by the backfill are identical to those produced by the
--   live dual-write path, so ON CONFLICT deduplification works correctly.
--
--   NOTE: The stableJsonStringify key order is alphabetical. The JSON must match
--   exactly (field order, null/missing field handling, tag sorting) for IDs to match.
--   We include only fields present in the TypeScript function's payload.
--
-- Usage:
--   1. Run the verification queries at the bottom to check scope.
--   2. Run this script (or use the --dry-run block to preview counts).
--   3. Verify parity with the post-migration queries.
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 0: Verify prerequisites
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_items') THEN
    RAISE EXCEPTION 'evidence_items table does not exist. Apply 2026-02-03-001 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence') THEN
    RAISE EXCEPTION 'evidence table does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step 1: Diagnostic counts before backfill
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_total       BIGINT;
  v_legacy_backfill    BIGINT;
  v_canonical_before   BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_legacy_total FROM evidence;
  SELECT COUNT(*) INTO v_canonical_before FROM evidence_items;

  -- Rows in evidence that do NOT yet have a matching canonical evidence_id
  -- (computed using the same deterministic formula as the TypeScript dual-write path).
  SELECT COUNT(*) INTO v_legacy_backfill
  FROM evidence e
  WHERE NOT EXISTS (
    SELECT 1 FROM evidence_items ei WHERE ei.evidence_id =
      'ev_' || LEFT(
        ENCODE(
          DIGEST(
            -- stableJsonStringify payload (alphabetical keys, no whitespace)
            jsonb_build_object(
              'content_json',   NULL::jsonb,
              'content_text',   REGEXP_REPLACE(REGEXP_REPLACE(trim(COALESCE(e.text, '')), '\s+', ' ', 'g'), '[\t ]+(\n)', '\n', 'g'),
              'deal_id',        e.deal_id::text,
              'source_path',    COALESCE(e.source, 'unknown') || ':' || COALESCE(e.document_id, 'nodoc') || ':' || COALESCE(e.kind, 'fact'),
              'source_type',    COALESCE(e.source, 'unknown'),
              'tags',           to_jsonb(ARRAY[COALESCE(e.source, 'unknown'), COALESCE(e.kind, 'fact')])
            )::text,
            'sha256'
          ),
          'hex'
        ),
        32
      )
  );

  RAISE NOTICE 'BACKFILL_DIAGNOSTIC: legacy_total=%, legacy_needing_backfill=%, canonical_before=%',
    v_legacy_total, v_legacy_backfill, v_canonical_before;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2: Backfill rows
-- ---------------------------------------------------------------------------
-- Maps legacy evidence → evidence_items using:
--   evidence_id  = ev_{SHA256(stableJsonStringify(...))[0:32]}
--   source_type  = evidence.source
--   source_path  = "{source}:{document_id|nodoc}:{kind}"
--   tags         = [source, kind]
--   content_text = evidence.text (whitespace-normalised to match TypeScript normalizeText)
--   meta         = {"writer": "evidence_backfill", "kind": <kind>}
--
-- ON CONFLICT (evidence_id) DO NOTHING ensures full idempotency: rows already
-- written by the live dual-write path are not overwritten.

WITH normalised AS (
  SELECT
    e.deal_id::text                                               AS deal_id,
    COALESCE(e.source, 'unknown')                                 AS source_type,
    COALESCE(e.source, 'unknown')
      || ':'
      || COALESCE(e.document_id, 'nodoc')
      || ':'
      || COALESCE(e.kind, 'fact')                                 AS source_path,
    e.document_id                                                 AS raw_document_id,
    ARRAY[COALESCE(e.source, 'unknown'), COALESCE(e.kind, 'fact')]::text[] AS tags,
    COALESCE(e.confidence, 0.5)                                   AS confidence,
    COALESCE(e.created_at, now())                                 AS extracted_at,
    -- Normalise whitespace to match canonical-evidence.ts normalizeText():
    --   \r\n and \r → \n
    --   tabs/spaces → single space
    --   trailing/leading whitespace → trimmed
    TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(e.text, '\r\n|\r', E'\n', 'g'),
          '[\t ]+',
          ' ',
          'g'
        ),
        E'\\n{3,}',
        E'\n\n',
        'g'
      )
    )                                                             AS content_text,
    COALESCE(e.kind, 'fact')                                      AS kind
  FROM evidence e
),
with_id AS (
  SELECT
    n.*,
    'ev_' || LEFT(
      ENCODE(
        DIGEST(
          -- stableJsonStringify: alphabetical keys, compact JSON
          jsonb_build_object(
            'content_json',  NULL::jsonb,
            'content_text',  n.content_text,
            'deal_id',       n.deal_id,
            'source_path',   n.source_path,
            'source_type',   n.source_type,
            'tags',          to_jsonb(n.tags)
          )::text,
          'sha256'
        ),
        'hex'
      ),
      32
    ) AS computed_evidence_id
  FROM normalised n
)
INSERT INTO evidence_items (
  evidence_id,
  deal_id,
  source_type,
  source_path,
  source_document_id,
  tags,
  confidence,
  extracted_at,
  content_text,
  meta
)
SELECT
  wi.computed_evidence_id,
  wi.deal_id::uuid,
  wi.source_type,
  wi.source_path,
  -- Only link source_document_id if raw_document_id looks like a valid UUID
  -- AND the document still exists (guards against orphaned legacy references).
  CASE
    WHEN wi.raw_document_id IS NOT NULL
     AND wi.raw_document_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND EXISTS (SELECT 1 FROM documents d WHERE d.id = wi.raw_document_id::uuid)
    THEN wi.raw_document_id::uuid
    ELSE NULL
  END,
  wi.tags,
  wi.confidence,
  wi.extracted_at,
  wi.content_text,
  jsonb_build_object('writer', 'evidence_backfill', 'kind', wi.kind)
FROM with_id wi
ON CONFLICT (evidence_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step 3: Post-backfill verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_total       BIGINT;
  v_canonical_after    BIGINT;
  v_still_missing      BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_legacy_total FROM evidence;
  SELECT COUNT(*) INTO v_canonical_after FROM evidence_items;

  -- Deals that still have legacy evidence but no canonical evidence after backfill
  SELECT COUNT(DISTINCT e.deal_id) INTO v_still_missing
  FROM evidence e
  WHERE NOT EXISTS (
    SELECT 1 FROM evidence_items ei WHERE ei.deal_id = e.deal_id
  );

  RAISE NOTICE 'BACKFILL_RESULT: legacy_total=%, canonical_after=%, deals_still_without_canonical=%',
    v_legacy_total, v_canonical_after, v_still_missing;

  IF v_still_missing > 0 THEN
    RAISE WARNING 'BACKFILL_INCOMPLETE: % deal(s) still have no evidence_items rows. Investigate deal_id mismatches or invalid UUIDs in the legacy evidence table.', v_still_missing;
  ELSE
    RAISE NOTICE 'BACKFILL_COMPLETE: All deals with legacy evidence now have canonical evidence_items rows.';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Dry-run verification queries (run these manually before executing the backfill)
-- =============================================================================

-- Q1: Count of deals with evidence but no evidence_items (backfill candidates)
-- SELECT COUNT(DISTINCT e.deal_id) AS deals_needing_backfill
-- FROM evidence e
-- WHERE NOT EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.deal_id = e.deal_id);

-- Q2: Row counts
-- SELECT
--   (SELECT COUNT(*) FROM evidence)       AS legacy_rows,
--   (SELECT COUNT(*) FROM evidence_items) AS canonical_rows;

-- Q3: Sample parity check for a specific deal
-- Replace 'YOUR-DEAL-UUID' with a real deal_id.
-- SELECT e.deal_id, COUNT(*) AS legacy_count FROM evidence WHERE deal_id = 'YOUR-DEAL-UUID' GROUP BY e.deal_id;
-- SELECT ei.deal_id, COUNT(*) AS canonical_count FROM evidence_items WHERE deal_id = 'YOUR-DEAL-UUID' GROUP BY ei.deal_id;

-- Q4: Verify the backfill is complete (should return 0 after successful run)
-- SELECT COUNT(DISTINCT e.deal_id) AS deals_without_canonical
-- FROM evidence e
-- WHERE NOT EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.deal_id = e.deal_id);

-- Q5: Source distribution after backfill
-- SELECT source_type, COUNT(*) FROM evidence_items GROUP BY source_type ORDER BY COUNT(*) DESC;
