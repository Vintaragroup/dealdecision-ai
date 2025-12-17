/**
 * Analytics Routes
 * /api/v1/analytics - LLM cost and performance analytics
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";
import { getLLMAnalyticsSummary, checkLLMHealth } from "../lib/llm";

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/analytics/llm/health
   * Check LLM system health status
   */
  app.get("/api/v1/analytics/llm/health", async (request, reply) => {
    const health = await checkLLMHealth();
    return reply.send(health);
  });

  /**
   * GET /api/v1/analytics/llm/deals/:dealId
   * Get LLM analytics for a specific deal
   */
  app.get<{ Params: { dealId: string } }>(
    "/api/v1/analytics/llm/deals/:dealId",
    async (request, reply) => {
      const { dealId } = request.params;
      const summary = await getLLMAnalyticsSummary(dealId);
      return reply.send(summary);
    }
  );

  /**
   * GET /api/v1/analytics/llm/cost-per-deal
   * Get average cost per deal and top expensive deals
   */
  app.get("/api/v1/analytics/llm/cost-per-deal", async (request, reply) => {
    const pool = getPool();
    const limit = parseInt((request.query as { limit?: string }).limit || "10");

    const result = await pool.query(
      `
      SELECT
        deal_id,
        COUNT(*) as api_calls,
        SUM(cost_usd) as total_cost,
        AVG(cost_usd) as avg_cost,
        SUM(input_tokens + output_tokens) as total_tokens
      FROM llm_performance_metrics
      WHERE created_at > now() - interval '30 days'
      GROUP BY deal_id
      ORDER BY total_cost DESC
      LIMIT $1
      `,
      [limit]
    );

    return reply.send(
      result.rows.map((row) => ({
        dealId: row.deal_id,
        apiCalls: parseInt(row.api_calls),
        totalCost: parseFloat(row.total_cost),
        averageCost: parseFloat(row.avg_cost),
        totalTokens: parseInt(row.total_tokens),
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/model-selection
   * See which models are being used and when
   */
  app.get("/api/v1/analytics/llm/model-selection", async (request, reply) => {
    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        selected_model,
        provider_type,
        COUNT(*) as usage_count,
        SUM(cost_usd) as total_cost,
        AVG(latency_ms) as avg_latency_ms,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count
      FROM llm_performance_metrics
      WHERE created_at > now() - interval '7 days'
      GROUP BY selected_model, provider_type
      ORDER BY usage_count DESC
      `
    );

    return reply.send(
      result.rows.map((row) => ({
        model: row.selected_model,
        provider: row.provider_type,
        usageCount: parseInt(row.usage_count),
        totalCost: parseFloat(row.total_cost),
        avgLatencyMs: parseInt(row.avg_latency_ms),
        errorCount: parseInt(row.error_count),
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/task-performance
   * Cost and performance breakdown by task type
   */
  app.get("/api/v1/analytics/llm/task-performance", async (request, reply) => {
    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        task_type,
        COUNT(*) as task_count,
        SUM(cost_usd) as total_cost,
        AVG(cost_usd) as avg_cost,
        AVG(latency_ms) as avg_latency_ms,
        AVG(input_tokens + output_tokens) as avg_tokens,
        SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cached_count
      FROM llm_performance_metrics
      WHERE task_type IS NOT NULL
      AND created_at > now() - interval '7 days'
      GROUP BY task_type
      ORDER BY total_cost DESC
      `
    );

    return reply.send(
      result.rows.map((row) => ({
        taskType: row.task_type,
        count: parseInt(row.task_count),
        totalCost: parseFloat(row.total_cost),
        avgCost: parseFloat(row.avg_cost),
        avgLatencyMs: parseInt(row.avg_latency_ms),
        avgTokens: parseInt(row.avg_tokens),
        cachedCount: parseInt(row.cached_count),
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/cache-effectiveness
   * Cache hit rates and savings
   */
  app.get("/api/v1/analytics/llm/cache-effectiveness", async (request, reply) => {
    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        task_type,
        SUM(CASE WHEN event_type = 'hit' THEN 1 ELSE 0 END) as cache_hits,
        SUM(CASE WHEN event_type = 'miss' THEN 1 ELSE 0 END) as cache_misses,
        ROUND(
          100.0 * SUM(CASE WHEN event_type = 'hit' THEN 1 ELSE 0 END) / 
          NULLIF(SUM(CASE WHEN event_type IN ('hit', 'miss') THEN 1 ELSE 0 END), 0),
          2
        ) as hit_rate_percent,
        SUM(tokens_saved) as total_tokens_saved,
        SUM(cost_saved_usd) as total_cost_saved
      FROM llm_cache_metrics
      WHERE created_at > now() - interval '7 days'
      GROUP BY task_type
      ORDER BY total_tokens_saved DESC NULLS LAST
      `
    );

    return reply.send(
      result.rows.map((row) => ({
        taskType: row.task_type,
        cacheHits: parseInt(row.cache_hits),
        cacheMisses: parseInt(row.cache_misses),
        hitRatePercent: parseFloat(row.hit_rate_percent || 0),
        totalTokensSaved: parseInt(row.total_tokens_saved || 0),
        totalCostSaved: parseFloat(row.total_cost_saved || 0),
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/cost-trend
   * Daily cost trend over time
   */
  app.get("/api/v1/analytics/llm/cost-trend", async (request, reply) => {
    const pool = getPool();
    const { days = "30" } = request.query as { days?: string };

    const result = await pool.query(
      `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as api_calls,
        SUM(cost_usd) as daily_cost,
        AVG(cost_usd) as avg_cost,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cached_calls
      FROM llm_performance_metrics
      WHERE created_at > now() - interval '1 day' * $1
      GROUP BY DATE(created_at)
      ORDER BY date ASC
      `,
      [parseInt(days)]
    );

    return reply.send(
      result.rows.map((row) => ({
        date: row.date,
        apiCalls: parseInt(row.api_calls),
        dailyCost: parseFloat(row.daily_cost),
        avgCost: parseFloat(row.avg_cost),
        totalTokens: parseInt(row.total_tokens),
        cachedCalls: parseInt(row.cached_calls),
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/error-analysis
   * Error rate and types
   */
  app.get("/api/v1/analytics/llm/error-analysis", async (request, reply) => {
    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        task_type,
        COUNT(*) as total_calls,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count,
        ROUND(
          100.0 * SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) /
          NULLIF(COUNT(*), 0),
          2
        ) as error_rate_percent,
        MAX(error_message) as sample_error
      FROM llm_performance_metrics
      WHERE created_at > now() - interval '7 days'
      GROUP BY task_type
      HAVING SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) > 0
      ORDER BY error_count DESC
      `
    );

    return reply.send(
      result.rows.map((row) => ({
        taskType: row.task_type,
        totalCalls: parseInt(row.total_calls),
        errorCount: parseInt(row.error_count),
        errorRatePercent: parseFloat(row.error_rate_percent),
        sampleError: row.sample_error,
      }))
    );
  });

  /**
   * GET /api/v1/analytics/llm/summary
   * High-level summary across all metrics
   */
  app.get("/api/v1/analytics/llm/summary", async (request, reply) => {
    const pool = getPool();

    const metricsResult = await pool.query(
      `
      SELECT
        COUNT(*) as total_api_calls,
        SUM(cost_usd) as total_cost,
        AVG(cost_usd) as avg_cost,
        AVG(latency_ms) as avg_latency_ms,
        MIN(created_at) as oldest_call,
        SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cached_calls,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count
      FROM llm_performance_metrics
      WHERE created_at > now() - interval '30 days'
      `
    );

    const cacheResult = await pool.query(
      `
      SELECT
        SUM(CASE WHEN event_type = 'hit' THEN 1 ELSE 0 END) as cache_hits,
        SUM(tokens_saved) as total_tokens_saved,
        SUM(cost_saved_usd) as total_cost_saved
      FROM llm_cache_metrics
      WHERE created_at > now() - interval '30 days'
      `
    );

    const metrics = metricsResult.rows[0];
    const cache = cacheResult.rows[0];

    return reply.send({
      period: "30 days",
      totalApiCalls: parseInt(metrics.total_api_calls || 0),
      totalCost: parseFloat(metrics.total_cost || 0),
      avgCostPerCall: parseFloat(metrics.avg_cost || 0),
      avgLatencyMs: parseInt(metrics.avg_latency_ms || 0),
      cachedCalls: parseInt(metrics.cached_calls || 0),
      errorCount: parseInt(metrics.error_count || 0),
      cacheHits: parseInt(cache.cache_hits || 0),
      totalTokensSaved: parseInt(cache.total_tokens_saved || 0),
      totalCostSaved: parseFloat(cache.total_cost_saved || 0),
    });
  });
}
