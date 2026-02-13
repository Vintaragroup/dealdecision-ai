-- PR4: Extend governed_llm_overviews with structured payload JSON (overlay-first UI)

BEGIN;

ALTER TABLE governed_llm_overviews
  ADD COLUMN IF NOT EXISTS overview_json JSONB NULL;

COMMIT;
