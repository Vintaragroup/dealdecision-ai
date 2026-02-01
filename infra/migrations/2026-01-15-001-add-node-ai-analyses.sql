-- Adds generalized AI analysis caching for any selected node in the analyst UI.

CREATE TABLE IF NOT EXISTS node_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key TEXT NOT NULL,
  deal_id UUID NULL REFERENCES deals(id) ON DELETE SET NULL,
  audience TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  question TEXT NOT NULL,
  response_json JSONB NOT NULL,
  model TEXT NULL,
  usage JSONB NULL,
  llm_called BOOLEAN NOT NULL DEFAULT true,
  duration_ms INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_node_ai_analyses_node_audience_qhash
  ON node_ai_analyses(node_key, audience, question_hash);

CREATE INDEX IF NOT EXISTS idx_node_ai_analyses_deal_created
  ON node_ai_analyses(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_node_ai_analyses_node_created
  ON node_ai_analyses(node_key, created_at DESC);

COMMENT ON TABLE node_ai_analyses IS 'Cached on-demand LLM analyses for any node selection (deal/document/group/evidence/visual asset).';
COMMENT ON COLUMN node_ai_analyses.node_key IS 'Stable key like deal:<id>, document:<id>, visual_asset:<id>, evidence_group:<id>, etc.';
