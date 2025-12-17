-- Create LLM Performance Metrics Table
-- Tracks all LLM API calls, costs, latency, and model selection
-- Used for cost analysis, provider comparison, and performance tuning

CREATE TABLE IF NOT EXISTS llm_performance_metrics (
  -- Primary key
  id BIGSERIAL PRIMARY KEY,
  
  -- Temporal
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  cycle_id UUID,
  cycle_number INT,
  task_type VARCHAR(50),  -- fact-extraction, synthesis, validation, etc
  user_id UUID,
  
  -- Model & Provider Selection
  selected_model VARCHAR(50) NOT NULL,  -- gpt-4o, qwen-14b, etc
  provider_type VARCHAR(50) NOT NULL,    -- openai, self-hosted, bedrock
  
  -- Tokens & Cost
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  estimated_cost_usd NUMERIC(10, 6),    -- Cost before actual response
  
  -- Performance
  latency_ms INT,                         -- Response time
  cached BOOLEAN NOT NULL DEFAULT false, -- Was this from cache?
  compression_tokens_saved INT,          -- Tokens removed by compression
  
  -- Quality & Status
  finish_reason VARCHAR(20),             -- stop, length, error
  error_message TEXT,                    -- Error details if failed
  
  -- Metadata
  request_parameters JSONB,              -- temperature, max_tokens, etc
  response_metadata JSONB,               -- finish_reason, etc
  
  -- Indexes for common queries
  CONSTRAINT llm_cost_positive CHECK (cost_usd >= 0),
  CONSTRAINT llm_tokens_positive CHECK (total_tokens > 0)
);

-- Create indexes for fast queries
CREATE INDEX idx_llm_metrics_deal_id ON llm_performance_metrics(deal_id);
CREATE INDEX idx_llm_metrics_created_at ON llm_performance_metrics(created_at DESC);
CREATE INDEX idx_llm_metrics_task_type ON llm_performance_metrics(task_type);
CREATE INDEX idx_llm_metrics_model ON llm_performance_metrics(selected_model);
CREATE INDEX idx_llm_metrics_provider ON llm_performance_metrics(provider_type);
CREATE INDEX idx_llm_metrics_cached ON llm_performance_metrics(cached);
CREATE INDEX idx_llm_metrics_deal_created ON llm_performance_metrics(deal_id, created_at DESC);

-- Partitioning for large datasets (optional, future improvement)
-- PARTITION BY RANGE (created_at)

COMMENT ON TABLE llm_performance_metrics IS 'LLM API call tracking: cost, performance, model selection, and error analysis';
COMMENT ON COLUMN llm_performance_metrics.cost_usd IS 'Actual cost in USD: (input_tokens / 1000000 * input_rate) + (output_tokens / 1000000 * output_rate)';
COMMENT ON COLUMN llm_performance_metrics.cached IS 'True if response came from analysis cache (no API call made)';
COMMENT ON COLUMN llm_performance_metrics.compression_tokens_saved IS 'Number of tokens removed by context compression before sending to API';
