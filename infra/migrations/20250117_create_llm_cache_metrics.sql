-- Create LLM Cache Metrics Table
-- Tracks cache hit/miss rates, token savings, and cost reduction
-- Used for cache effectiveness analysis and optimization

CREATE TABLE IF NOT EXISTS llm_cache_metrics (
  -- Primary key
  id BIGSERIAL PRIMARY KEY,
  
  -- Temporal
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  task_type VARCHAR(50),  -- Tracks which task types benefit from cache
  
  -- Cache Identification
  content_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash of request content
  cache_key VARCHAR(256),             -- Full cache key for debugging
  
  -- Cache Events
  event_type VARCHAR(20) NOT NULL,    -- hit, miss, eviction
  
  -- Token & Cost Savings
  tokens_saved INT NOT NULL DEFAULT 0,   -- Tokens not sent to API due to cache hit
  cost_saved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- $ saved by avoiding API call
  
  -- Cache Statistics
  hit_count INT NOT NULL DEFAULT 0,   -- Cumulative hits for this key
  miss_count INT NOT NULL DEFAULT 0,  -- Cumulative misses for this key
  
  -- Metadata
  request_params JSONB,
  response_tokens_if_hit INT,         -- Tokens that would have been used
  
  -- Indexes for analysis
  CONSTRAINT cache_tokens_positive CHECK (tokens_saved >= 0),
  CONSTRAINT cache_cost_positive CHECK (cost_saved_usd >= 0)
);

-- Create indexes for fast queries
CREATE INDEX idx_cache_metrics_deal_id ON llm_cache_metrics(deal_id);
CREATE INDEX idx_cache_metrics_created_at ON llm_cache_metrics(created_at DESC);
CREATE INDEX idx_cache_metrics_task_type ON llm_cache_metrics(task_type);
CREATE INDEX idx_cache_metrics_hash ON llm_cache_metrics(content_hash);
CREATE INDEX idx_cache_metrics_event ON llm_cache_metrics(event_type);

-- Composite indexes for common queries
CREATE INDEX idx_cache_metrics_task_event ON llm_cache_metrics(task_type, event_type);
CREATE INDEX idx_cache_metrics_deal_created ON llm_cache_metrics(deal_id, created_at DESC);

COMMENT ON TABLE llm_cache_metrics IS 'LLM cache effectiveness tracking: hit rates, token savings, cost reduction';
COMMENT ON COLUMN llm_cache_metrics.event_type IS 'hit = cache matched, miss = no cache found, eviction = old entry removed';
COMMENT ON COLUMN llm_cache_metrics.tokens_saved IS 'Tokens NOT sent to API because cache had the response';
COMMENT ON COLUMN llm_cache_metrics.cost_saved_usd IS 'Money saved by avoiding API call: cost_per_mtoken * tokens_saved / 1M';
