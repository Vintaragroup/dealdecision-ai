-- Add optional visual_asset_id to evidence rows for traceability into the analyst lineage graph
BEGIN;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS visual_asset_id TEXT;

CREATE INDEX IF NOT EXISTS idx_evidence_visual_asset_id ON evidence(visual_asset_id);

COMMIT;
