/**
 * LLM Integration Module for API
 * 
 * Provides high-level LLM operations for deal analysis:
 * - Fact extraction from documents
 * - Hypothesis generation and synthesis
 * - Confidence scoring and validation
 * 
 * Uses the worker's LLM abstraction layer via HTTP or direct import
 */

import { getPool } from './db';

/**
 * Task type for intelligent model routing
 * Matches worker/src/lib/llm/types.ts
 */
export type TaskType = 
  | 'fact-extraction'
  | 'classification'
  | 'hypothesis-generation'
  | 'query-generation'
  | 'synthesis'
  | 'validation'
  | 'chat-response'
  | 'cycle-analysis'
  | 'general';

/**
 * LLM Completion options
 */
export interface LLMCompletionOptions {
  task: TaskType;
  dealId: string;
  cycleId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
}

/**
 * LLM Response with metadata
 */
export interface LLMCompletionResult {
  content: string;
  model: string;
  tokens: {
    input: number;
    output: number;
  };
  cost: number;
  latencyMs: number;
  cached: boolean;
  finishReason: 'stop' | 'length' | 'error';
  error?: string;
}

/**
 * Queue job for LLM processing
 */
export interface LLMJobPayload {
  type: 'llm-completion';
  dealId: string;
  cycleId?: string;
  task: TaskType;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  callbackUrl?: string;
}

/**
 * Global flag for enabling/disabling LLM processing
 */
let llmEnabled = true;

/**
 * Initialize LLM module - check if OpenAI API key is available
 */
export function initializeLLM(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  const enabled = process.env.LLM_ENABLED !== 'false';
  
  if (!apiKey || !enabled) {
    llmEnabled = false;
    console.warn('LLM module disabled: missing OPENAI_API_KEY or LLM_ENABLED=false');
    return false;
  }
  
  llmEnabled = true;
  console.log('LLM module initialized with OpenAI provider');
  return true;
}

/**
 * Check if LLM is enabled globally
 */
export function isLLMEnabled(): boolean {
  return llmEnabled;
}

/**
 * Set LLM enabled state (for feature flag support)
 */
export function setLLMEnabled(enabled: boolean): void {
  llmEnabled = enabled;
  console.log(`LLM processing ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Enqueue LLM completion job to worker
 */
export async function enqueueLLMCompletion(payload: LLMJobPayload): Promise<string> {
  if (!llmEnabled) {
    throw new Error('LLM processing is disabled');
  }

  // Import queue dynamically to avoid circular dependencies
  const { enqueueJob } = require('./queue');
  
  const jobId = await enqueueJob('llm-completion', payload, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    timeout: 300000, // 5 minutes
  });

  // Log to database
  const pool = getPool();
  await pool.query(
    `INSERT INTO llm_job_log (deal_id, task_type, job_id, status, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [payload.dealId, payload.task, jobId, 'queued']
  );

  return jobId;
}

/**
 * Record LLM API call metrics to database
 */
export async function recordLLMMetrics(metrics: {
  dealId: string;
  cycleNumber?: number;
  taskType: TaskType;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  errorMessage?: string;
}): Promise<void> {
  const pool = getPool();
  
  try {
    await pool.query(
      `INSERT INTO llm_performance_metrics 
       (deal_id, cycle_number, task_type, selected_model, provider_type, 
        input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, cached, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        metrics.dealId,
        metrics.cycleNumber,
        metrics.taskType,
        metrics.model,
        metrics.provider,
        metrics.inputTokens,
        metrics.outputTokens,
        metrics.inputTokens + metrics.outputTokens,
        metrics.costUsd,
        metrics.latencyMs,
        metrics.cached,
        metrics.errorMessage || null,
      ]
    );
  } catch (err) {
    console.error('Failed to record LLM metrics:', err);
    // Don't throw - metrics are secondary to operation success
  }
}

/**
 * Record cache metrics
 */
export async function recordCacheMetrics(metrics: {
  dealId: string;
  taskType: TaskType;
  contentHash: string;
  eventType: 'hit' | 'miss' | 'eviction';
  tokensSaved?: number;
  costSavedUsd?: number;
}): Promise<void> {
  const pool = getPool();

  try {
    await pool.query(
      `INSERT INTO llm_cache_metrics 
       (deal_id, task_type, content_hash, event_type, tokens_saved, cost_saved_usd)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        metrics.dealId,
        metrics.taskType,
        metrics.contentHash,
        metrics.eventType,
        metrics.tokensSaved || 0,
        metrics.costSavedUsd || 0,
      ]
    );
  } catch (err) {
    console.error('Failed to record cache metrics:', err);
  }
}

/**
 * Get analytics summary for a deal
 */
export async function getLLMAnalyticsSummary(dealId: string): Promise<{
  totalCost: number;
  apiCalls: number;
  cacheHits: number;
  tokensSaved: number;
  costSaved: number;
  averageLatencyMs: number;
  errorCount: number;
}> {
  const pool = getPool();

  const result = await pool.query(
    `
    WITH metrics AS (
      SELECT
        COUNT(*) as api_calls,
        SUM(cost_usd) as total_cost,
        AVG(latency_ms) as avg_latency,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count
      FROM llm_performance_metrics
      WHERE deal_id = $1
    ),
    cache_data AS (
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'hit') as cache_hits,
        COALESCE(SUM(tokens_saved), 0) as tokens_saved,
        COALESCE(SUM(cost_saved_usd), 0) as cost_saved
      FROM llm_cache_metrics
      WHERE deal_id = $1
    )
    SELECT 
      COALESCE(m.total_cost, 0) as total_cost,
      COALESCE(m.api_calls, 0) as api_calls,
      COALESCE(c.cache_hits, 0) as cache_hits,
      COALESCE(c.tokens_saved, 0) as tokens_saved,
      COALESCE(c.cost_saved, 0) as cost_saved,
      COALESCE(m.avg_latency, 0) as avg_latency,
      COALESCE(m.error_count, 0) as error_count
    FROM metrics m, cache_data c
    `,
    [dealId]
  );

  const row = result.rows[0];
  return {
    totalCost: parseFloat(row.total_cost),
    apiCalls: parseInt(row.api_calls),
    cacheHits: parseInt(row.cache_hits),
    tokensSaved: parseInt(row.tokens_saved),
    costSaved: parseFloat(row.cost_saved),
    averageLatencyMs: parseInt(row.avg_latency),
    errorCount: parseInt(row.error_count),
  };
}

/**
 * Health check for LLM system
 */
export async function checkLLMHealth(): Promise<{
  enabled: boolean;
  apiKeyConfigured: boolean;
  recentErrors: number;
  recentCalls: number;
}> {
  const pool = getPool();

  const metricsResult = await pool.query(
    `SELECT 
      COUNT(*) as recent_calls,
      SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as error_count
     FROM llm_performance_metrics
     WHERE created_at > now() - interval '1 hour'`
  );

  const metrics = metricsResult.rows[0];

  return {
    enabled: llmEnabled,
    apiKeyConfigured: !!process.env.OPENAI_API_KEY,
    recentErrors: parseInt(metrics.error_count || 0),
    recentCalls: parseInt(metrics.recent_calls || 0),
  };
}
