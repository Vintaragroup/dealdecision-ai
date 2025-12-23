-- Migration: Add Deal Intelligence Object (DIO) tables
-- Version: 2025-12-18-003-add-dio-tables
-- Description: Creates tables for storing analysis results, execution history, and LLM usage tracking
-- Based on: DIO Schema v1.0.0

-- ============================================================================
-- Deal Intelligence Objects (DIO) Storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS deal_intelligence_objects (
  -- Primary key
  dio_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- Versioning
  schema_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  analysis_version INT NOT NULL,
  input_hash VARCHAR(64) NOT NULL,  -- SHA-256 of canonical inputs
  
  -- Full DIO (JSONB for flexibility)
  dio_data JSONB NOT NULL,
  
  -- Indexed fields for fast queries
  recommendation VARCHAR(20),       -- "GO", "NO-GO", "CONDITIONAL"
  overall_score NUMERIC(5,2),       -- Overall analysis score (0-100)
  total_risks INT,                  -- Count of identified risks
  critical_risks INT,               -- Count of critical risks
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_recommendation CHECK (recommendation IN ('GO', 'NO-GO', 'CONDITIONAL')),
  CONSTRAINT valid_score CHECK (overall_score >= 0 AND overall_score <= 100),
  CONSTRAINT unique_deal_version UNIQUE(deal_id, analysis_version),
  CONSTRAINT unique_deal_input_hash UNIQUE(deal_id, input_hash)  -- Idempotency guarantee
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dio_deal_id ON deal_intelligence_objects(deal_id);
CREATE INDEX IF NOT EXISTS idx_dio_input_hash ON deal_intelligence_objects(input_hash);
CREATE INDEX IF NOT EXISTS idx_dio_created_at ON deal_intelligence_objects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dio_recommendation ON deal_intelligence_objects(recommendation);
CREATE INDEX IF NOT EXISTS idx_dio_schema_version ON deal_intelligence_objects(schema_version);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_dio_data ON deal_intelligence_objects USING GIN(dio_data);

-- Comment
COMMENT ON TABLE deal_intelligence_objects IS 'Stores complete Deal Intelligence Objects (DIOs) with versioning and idempotency';
COMMENT ON COLUMN deal_intelligence_objects.input_hash IS 'SHA-256 hash of inputs for idempotency - same inputs produce same DIO';
COMMENT ON COLUMN deal_intelligence_objects.analysis_version IS 'Incremental version number (1, 2, 3...) for this deal';

-- ============================================================================
-- Analyzer Execution History (for debugging and auditing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS analyzer_executions (
  -- Primary key
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  dio_id UUID NOT NULL REFERENCES deal_intelligence_objects(dio_id) ON DELETE CASCADE,
  
  -- Analyzer info
  analyzer_name VARCHAR(100) NOT NULL,
  analyzer_version VARCHAR(20) NOT NULL,
  
  -- Execution timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  
  -- Status
  success BOOLEAN NOT NULL,
  error TEXT,
  
  -- Result (JSONB for analyzer-specific output)
  result JSONB,
  
  -- Input hash for caching
  input_hash VARCHAR(64),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analyzer_exec_dio ON analyzer_executions(dio_id);
CREATE INDEX IF NOT EXISTS idx_analyzer_exec_name ON analyzer_executions(analyzer_name);
CREATE INDEX IF NOT EXISTS idx_analyzer_exec_version ON analyzer_executions(analyzer_name, analyzer_version);
CREATE INDEX IF NOT EXISTS idx_analyzer_exec_started ON analyzer_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyzer_exec_success ON analyzer_executions(success) WHERE success = false;

-- Comment
COMMENT ON TABLE analyzer_executions IS 'Tracks individual analyzer executions for debugging and performance monitoring';
COMMENT ON COLUMN analyzer_executions.input_hash IS 'Hash of analyzer input for result caching';

-- ============================================================================
-- LLM Usage Tracking (for cost monitoring and token budget enforcement)
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_usage (
  -- Primary key
  usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys (nullable - can track usage outside of DIO context)
  dio_id UUID REFERENCES deal_intelligence_objects(dio_id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  
  -- LLM details
  purpose VARCHAR(50) NOT NULL,    -- "query_generation", "narrative_synthesis", "edge_case"
  provider VARCHAR(50) NOT NULL,   -- "openai", "bedrock", "sagemaker"
  model VARCHAR(100) NOT NULL,     -- "gpt-4o", "qwen-14b", "llama-70b"
  
  -- Token usage
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd NUMERIC(10,6),          -- Estimated cost in USD
  
  -- Performance
  duration_ms INT,
  
  -- Status
  success BOOLEAN NOT NULL,
  error TEXT,
  
  -- Timestamps
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_purpose CHECK (purpose IN ('query_generation', 'narrative_synthesis', 'edge_case')),
  CONSTRAINT valid_tokens CHECK (
    input_tokens >= 0 AND 
    output_tokens >= 0 AND 
    total_tokens = input_tokens + output_tokens
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_llm_usage_dio ON llm_usage(dio_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_deal ON llm_usage(deal_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_date ON llm_usage(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON llm_usage(provider);
CREATE INDEX IF NOT EXISTS idx_llm_usage_purpose ON llm_usage(purpose);
CREATE INDEX IF NOT EXISTS idx_llm_usage_cost ON llm_usage(cost_usd DESC NULLS LAST);

-- Comment
COMMENT ON TABLE llm_usage IS 'Tracks all LLM API calls for cost monitoring and token budget enforcement';
COMMENT ON COLUMN llm_usage.purpose IS 'Why LLM was called - must justify token usage';

-- ============================================================================
-- Analysis History View (convenience view for querying)
-- ============================================================================

CREATE OR REPLACE VIEW analysis_history AS
SELECT 
  d.id AS deal_id,
  d.name AS company_name,
  dio.dio_id,
  dio.analysis_version,
  dio.schema_version,
  dio.recommendation,
  dio.overall_score,
  dio.total_risks,
  dio.critical_risks,
  dio.created_at,
  dio.input_hash,
  
  -- Extract key metrics from JSONB
  (dio.dio_data->'ledger_manifest'->>'cycles')::int AS cycles_executed,
  (dio.dio_data->'ledger_manifest'->>'total_facts_added')::int AS facts_added,
  (dio.dio_data->'narrative'->'token_usage'->>'total_tokens')::int AS llm_tokens_used,
  (dio.dio_data->'narrative'->'token_usage'->>'estimated_cost')::numeric AS llm_cost_usd,
  (dio.dio_data->'execution_metadata'->>'duration_ms')::int AS total_duration_ms,
  
  -- Latest version flag
  dio.analysis_version = MAX(dio.analysis_version) OVER (PARTITION BY dio.deal_id) AS is_latest
  
FROM deal_intelligence_objects dio
JOIN deals d ON dio.deal_id = d.id
ORDER BY dio.created_at DESC;

-- Comment
COMMENT ON VIEW analysis_history IS 'Convenient view of all analysis runs with key metrics extracted from JSONB';

-- ============================================================================
-- Cost Analytics View (for monitoring LLM spend)
-- ============================================================================

CREATE OR REPLACE VIEW llm_cost_analytics AS
SELECT 
  DATE_TRUNC('day', called_at) AS date,
  provider,
  purpose,
  COUNT(*) AS call_count,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(total_tokens) AS total_tokens,
  SUM(cost_usd) AS total_cost_usd,
  AVG(cost_usd) AS avg_cost_per_call,
  AVG(duration_ms) AS avg_duration_ms,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_calls,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed_calls
FROM llm_usage
GROUP BY DATE_TRUNC('day', called_at), provider, purpose
ORDER BY date DESC, total_cost_usd DESC;

-- Comment
COMMENT ON VIEW llm_cost_analytics IS 'Daily LLM cost breakdown by provider and purpose for budget tracking';

-- ============================================================================
-- Analyzer Performance View (for optimization)
-- ============================================================================

CREATE OR REPLACE VIEW analyzer_performance AS
SELECT 
  analyzer_name,
  analyzer_version,
  COUNT(*) AS execution_count,
  AVG(duration_ms) AS avg_duration_ms,
  MIN(duration_ms) AS min_duration_ms,
  MAX(duration_ms) AS max_duration_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_runs,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed_runs,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate_pct
FROM analyzer_executions
WHERE completed_at IS NOT NULL
GROUP BY analyzer_name, analyzer_version
ORDER BY analyzer_name, analyzer_version DESC;

-- Comment
COMMENT ON VIEW analyzer_performance IS 'Performance metrics for each analyzer version';

-- ============================================================================
-- Token Budget Compliance View
-- ============================================================================

CREATE OR REPLACE VIEW token_budget_compliance AS
SELECT 
  dio.dio_id,
  dio.deal_id,
  dio.analysis_version,
  dio.created_at,
  
  -- Extract token usage from DIO
  (dio.dio_data->'narrative'->'token_usage'->>'total_tokens')::int AS total_tokens,
  
  -- Budget (500 tokens)
  500 AS budget_tokens,
  
  -- Compliance
  (dio.dio_data->'narrative'->'token_usage'->>'total_tokens')::int <= 500 AS within_budget,
  
  -- Breakdown by purpose (from llm_usage table)
  COALESCE(SUM(CASE WHEN lu.purpose = 'query_generation' THEN lu.total_tokens ELSE 0 END), 0) AS query_gen_tokens,
  COALESCE(SUM(CASE WHEN lu.purpose = 'narrative_synthesis' THEN lu.total_tokens ELSE 0 END), 0) AS synthesis_tokens,
  COALESCE(SUM(CASE WHEN lu.purpose = 'edge_case' THEN lu.total_tokens ELSE 0 END), 0) AS edge_case_tokens,
  
  -- Cost
  COALESCE(SUM(lu.cost_usd), 0) AS total_cost_usd
  
FROM deal_intelligence_objects dio
LEFT JOIN llm_usage lu ON dio.dio_id = lu.dio_id
GROUP BY dio.dio_id, dio.deal_id, dio.analysis_version, dio.created_at, dio.dio_data
ORDER BY dio.created_at DESC;

-- Comment
COMMENT ON VIEW token_budget_compliance IS 'Tracks token usage against 500 token budget per deal';

-- ============================================================================
-- Functions
-- ============================================================================

-- Function to get latest DIO for a deal
CREATE OR REPLACE FUNCTION get_latest_dio(p_deal_id UUID)
RETURNS TABLE(
  dio_id UUID,
  analysis_version INT,
  recommendation VARCHAR(20),
  overall_score NUMERIC(5,2),
  created_at TIMESTAMPTZ,
  dio_data JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.dio_id,
    d.analysis_version,
    d.recommendation,
    d.overall_score,
    d.created_at,
    d.dio_data
  FROM deal_intelligence_objects d
  WHERE d.deal_id = p_deal_id
  ORDER BY d.analysis_version DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Comment
COMMENT ON FUNCTION get_latest_dio IS 'Returns the most recent DIO for a given deal';

-- Function to check if analysis needs rerun (input hash changed)
CREATE OR REPLACE FUNCTION needs_rerun(p_deal_id UUID, p_input_hash VARCHAR(64))
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 
    FROM deal_intelligence_objects 
    WHERE deal_id = p_deal_id 
    AND input_hash = p_input_hash
  );
END;
$$ LANGUAGE plpgsql;

-- Comment
COMMENT ON FUNCTION needs_rerun IS 'Check if analysis needs to run based on input hash (idempotency check)';

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dio_updated_at
BEFORE UPDATE ON deal_intelligence_objects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grants (adjust based on your user roles)
-- ============================================================================

-- Grant read/write to application user (adjust role name as needed)
-- GRANT SELECT, INSERT, UPDATE ON deal_intelligence_objects TO app_user;
-- GRANT SELECT, INSERT, UPDATE ON analyzer_executions TO app_user;
-- GRANT SELECT, INSERT ON llm_usage TO app_user;
-- GRANT SELECT ON analysis_history TO app_user;
-- GRANT SELECT ON llm_cost_analytics TO app_user;
-- GRANT SELECT ON analyzer_performance TO app_user;
-- GRANT SELECT ON token_budget_compliance TO app_user;

-- ============================================================================
-- Sample Queries (for documentation)
-- ============================================================================

-- Get all analysis versions for a deal
-- SELECT * FROM analysis_history WHERE deal_id = 'some-uuid' ORDER BY analysis_version DESC;

-- Get latest DIO
-- SELECT * FROM get_latest_dio('some-deal-uuid');

-- Check if need to rerun
-- SELECT needs_rerun('some-deal-uuid', 'some-sha256-hash');

-- Monitor LLM costs today
-- SELECT * FROM llm_cost_analytics WHERE date >= CURRENT_DATE;

-- Find slow analyzers
-- SELECT * FROM analyzer_performance WHERE avg_duration_ms > 1000 ORDER BY avg_duration_ms DESC;

-- Check token budget compliance
-- SELECT * FROM token_budget_compliance WHERE NOT within_budget ORDER BY created_at DESC;
