/**
 * LLM Performance & Cost Analytics Dashboard
 * 
 * SQL queries and TypeScript utilities for analyzing LLM usage,
 * cost tracking, and performance metrics.
 * 
 * Use these queries to understand:
 * - Cost per deal across analysis cycles
 * - Model selection patterns
 * - Token efficiency improvements
 * - Cache hit rates
 * - Performance trends over time
 */

import type { Pool } from 'pg';

/**
 * Performance metrics table schema
 */
export const PERFORMANCE_METRICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_performance_metrics (
  id SERIAL PRIMARY KEY,
  
  -- Context
  deal_id UUID NOT NULL,
  cycle_number INT NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  
  -- Model & Provider selection
  selected_model VARCHAR(50) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  
  -- Tokens & Cost
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd DECIMAL(10, 6),
  
  -- Performance
  latency_ms INT NOT NULL,
  cached BOOLEAN DEFAULT FALSE,
  
  -- Quality
  finish_reason VARCHAR(50),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_deal_id (deal_id),
  INDEX idx_created_at (created_at),
  INDEX idx_model (selected_model),
  INDEX idx_provider (provider_type),
  INDEX idx_task (task_type),
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE TABLE IF NOT EXISTS llm_cache_metrics (
  id SERIAL PRIMARY KEY,
  
  -- Context
  deal_id UUID,
  content_hash VARCHAR(64) NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  
  -- Cache behavior
  hit_count INT DEFAULT 0,
  miss_count INT DEFAULT 0,
  total_tokens_saved INT DEFAULT 0,
  total_cost_saved DECIMAL(10, 6) DEFAULT 0,
  
  -- Metadata
  first_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_hash (content_hash),
  INDEX idx_task (task_type),
  INDEX idx_deal (deal_id)
);
`;

/**
 * Cost per deal query
 */
export function costPerDealQuery(): string {
  return `
    SELECT
      deal_id,
      MAX(cycle_number) as max_cycles,
      COUNT(*) as api_calls,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(cost_usd) as total_cost,
      AVG(latency_ms) as avg_latency_ms,
      SUM(CASE WHEN cached = true THEN 1 ELSE 0 END) as cached_calls,
      COUNT(*) FILTER (WHERE cached = true)::float / NULLIF(COUNT(*), 0)::float as cache_hit_rate,
      ROUND(SUM(cost_usd)::numeric, 4) as cost_display
    FROM llm_performance_metrics
    GROUP BY deal_id
    ORDER BY total_cost DESC;
  `;
}

/**
 * Model selection frequency
 */
export function modelSelectionQuery(): string {
  return `
    SELECT
      selected_model,
      provider_type,
      COUNT(*) as selection_count,
      SUM(total_tokens) as total_tokens_used,
      SUM(cost_usd) as total_cost,
      AVG(latency_ms) as avg_latency_ms,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM llm_performance_metrics), 2) as selection_percent
    FROM llm_performance_metrics
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY selected_model, provider_type
    ORDER BY selection_count DESC;
  `;
}

/**
 * Task type performance
 */
export function taskPerformanceQuery(): string {
  return `
    SELECT
      task_type,
      COUNT(*) as executions,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      AVG(latency_ms) as avg_latency_ms,
      MIN(latency_ms) as min_latency_ms,
      MAX(latency_ms) as max_latency_ms,
      SUM(cost_usd) as total_cost,
      ROUND(SUM(cost_usd) / COUNT(*)::numeric, 6) as cost_per_execution,
      ROUND(SUM(total_tokens) / COUNT(*)::numeric, 0)::INT as avg_tokens_per_execution
    FROM llm_performance_metrics
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY task_type
    ORDER BY total_cost DESC;
  `;
}

/**
 * Cache effectiveness
 */
export function cacheEffectivenessQuery(): string {
  return `
    SELECT
      task_type,
      COUNT(*) as entries_cached,
      SUM(hit_count) as total_hits,
      SUM(miss_count) as total_misses,
      ROUND(100.0 * SUM(hit_count) / (SUM(hit_count) + SUM(miss_count))::numeric, 2) as hit_rate_percent,
      SUM(total_tokens_saved) as tokens_saved,
      ROUND(SUM(total_cost_saved)::numeric, 2) as cost_saved
    FROM llm_cache_metrics
    GROUP BY task_type
    ORDER BY cost_saved DESC;
  `;
}

/**
 * Cost trends over time
 */
export function costTrendQuery(intervalDays: number = 30): string {
  return `
    SELECT
      DATE(created_at) as date,
      COUNT(*) as api_calls,
      SUM(total_tokens) as tokens_used,
      SUM(cost_usd) as daily_cost,
      ROUND(AVG(cost_usd)::numeric, 6) as avg_cost_per_call,
      ROUND(SUM(cost_usd) / (SUM(total_tokens)::numeric / 1000000), 2) as cost_per_mtok
    FROM llm_performance_metrics
    WHERE created_at >= NOW() - INTERVAL '${intervalDays} days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC;
  `;
}

/**
 * Provider comparison
 */
export function providerComparisonQuery(): string {
  return `
    SELECT
      provider_type,
      COUNT(*) as usage_count,
      SUM(total_tokens) as tokens_used,
      SUM(cost_usd) as total_cost,
      ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms,
      ROUND(SUM(cost_usd) / SUM(total_tokens)::numeric * 1000000, 2) as cost_per_mtok,
      SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count,
      ROUND(100.0 * SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) / COUNT(*)::numeric, 2) as success_rate
    FROM llm_performance_metrics
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY provider_type
    ORDER BY total_cost DESC;
  `;
}

/**
 * Token efficiency report
 */
export function tokenEfficiencyQuery(): string {
  return `
    WITH daily_metrics AS (
      SELECT
        DATE(created_at) as date,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as call_count,
        SUM(cost_usd) as cost
      FROM llm_performance_metrics
      GROUP BY DATE(created_at)
    )
    SELECT
      date,
      call_count,
      ROUND(total_tokens::numeric / NULLIF(call_count, 0), 1)::INT as avg_tokens_per_call,
      ROUND(input_tokens::numeric / NULLIF(output_tokens, 1), 2) as input_output_ratio,
      ROUND(cost::numeric / NULLIF(total_tokens, 0) * 1000000, 2) as cost_per_mtok,
      ROUND(cost, 2) as daily_cost
    FROM daily_metrics
    ORDER BY date DESC;
  `;
}

/**
 * Compression effectiveness
 */
export function compressionEffectivenessQuery(): string {
  return `
    SELECT
      DATE(created_at) as date,
      SUM(CASE WHEN input_tokens < 2000 THEN 1 ELSE 0 END) as compressed_calls,
      COUNT(*) as total_calls,
      ROUND(100.0 * SUM(CASE WHEN input_tokens < 2000 THEN 1 ELSE 0 END) / COUNT(*)::numeric, 2) as compression_rate,
      ROUND(AVG(input_tokens)::numeric, 0)::INT as avg_input_tokens,
      ROUND(SUM(cost_usd) / COUNT(*)::numeric, 6) as avg_cost_per_call
    FROM llm_performance_metrics
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC;
  `;
}

/**
 * Error analysis
 */
export function errorAnalysisQuery(): string {
  return `
    SELECT
      error_message,
      provider_type,
      COUNT(*) as error_count,
      ARRAY_AGG(DISTINCT deal_id)::TEXT[] as affected_deals,
      MAX(created_at) as last_error_at
    FROM llm_performance_metrics
    WHERE error_message IS NOT NULL
    AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY error_message, provider_type
    ORDER BY error_count DESC;
  `;
}

/**
 * Cycle-by-cycle cost breakdown
 */
export function cycleBreakdownQuery(dealId: string): string {
  return `
    SELECT
      cycle_number,
      task_type,
      COUNT(*) as calls,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost,
      AVG(latency_ms) as avg_latency_ms,
      selected_model as preferred_model
    FROM llm_performance_metrics
    WHERE deal_id = '${dealId}'
    GROUP BY cycle_number, task_type, selected_model
    ORDER BY cycle_number, cost DESC;
  `;
}

/**
 * Dashboard implementation
 */
export class LLMAnalyticsDashboard {
  constructor(private pool: Pool) {}

  /**
   * Get cost per deal with recent only
   */
  async getCostPerDeal(limit: number = 20, days: number = 30) {
    const result = await this.pool.query(`
      SELECT
        deal_id,
        MAX(cycle_number) as max_cycles,
        COUNT(*) as api_calls,
        SUM(total_tokens) as total_tokens,
        SUM(cost_usd) as total_cost,
        AVG(latency_ms)::INT as avg_latency_ms
      FROM llm_performance_metrics
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY deal_id
      ORDER BY total_cost DESC
      LIMIT ${limit};
    `);
    return result.rows;
  }

  /**
   * Get model selection preferences
   */
  async getModelPreferences(days: number = 30) {
    const result = await this.pool.query(`
      SELECT
        selected_model,
        provider_type,
        COUNT(*) as selection_count,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM llm_performance_metrics WHERE created_at >= NOW() - INTERVAL '${days} days')::numeric, 2) as percent
      FROM llm_performance_metrics
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY selected_model, provider_type
      ORDER BY selection_count DESC;
    `);
    return result.rows;
  }

  /**
   * Get cache hit rates
   */
  async getCacheMetrics() {
    const result = await this.pool.query(`
      SELECT
        SUM(hit_count) as total_hits,
        SUM(miss_count) as total_misses,
        ROUND(100.0 * SUM(hit_count) / (SUM(hit_count) + SUM(miss_count))::numeric, 2) as hit_rate_percent,
        ROUND(SUM(total_cost_saved)::numeric, 2) as cost_saved
      FROM llm_cache_metrics;
    `);
    return result.rows[0];
  }

  /**
   * Get daily cost trend
   */
  async getCostTrend(days: number = 30) {
    const result = await this.pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as api_calls,
        SUM(cost_usd) as daily_cost,
        ROUND(SUM(cost_usd) / COUNT(*)::numeric, 6) as avg_cost_per_call
      FROM llm_performance_metrics
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC;
    `);
    return result.rows;
  }

  /**
   * Get provider reliability
   */
  async getProviderReliability() {
    const result = await this.pool.query(`
      SELECT
        provider_type,
        COUNT(*) as total_calls,
        SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) as successful_calls,
        ROUND(100.0 * SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) / COUNT(*)::numeric, 2) as success_rate_percent,
        ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms
      FROM llm_performance_metrics
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY provider_type;
    `);
    return result.rows;
  }

  /**
   * Get cost per task type
   */
  async getCostByTask(days: number = 30) {
    const result = await this.pool.query(`
      SELECT
        task_type,
        COUNT(*) as executions,
        SUM(cost_usd) as total_cost,
        ROUND(SUM(cost_usd) / COUNT(*)::numeric, 6) as cost_per_execution,
        ROUND(SUM(total_tokens) / COUNT(*)::numeric, 0)::INT as avg_tokens_per_execution
      FROM llm_performance_metrics
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY task_type
      ORDER BY total_cost DESC;
    `);
    return result.rows;
  }

  /**
   * Export summary report
   */
  async generateSummaryReport(days: number = 30) {
    const [costPerDeal, modelPrefs, cacheMetrics, costTrend, providerReliability, costByTask] =
      await Promise.all([
        this.getCostPerDeal(10, days),
        this.getModelPreferences(days),
        this.getCacheMetrics(),
        this.getCostTrend(days),
        this.getProviderReliability(),
        this.getCostByTask(days),
      ]);

    return {
      period_days: days,
      generated_at: new Date().toISOString(),
      top_deals_by_cost: costPerDeal,
      model_preferences: modelPrefs,
      cache_metrics: cacheMetrics,
      daily_cost_trend: costTrend,
      provider_reliability: providerReliability,
      cost_by_task: costByTask,
    };
  }
}

/**
 * Export everything
 */
export { LLMAnalyticsDashboard as default };
