/**
 * LLM Provider Types
 * 
 * Core type definitions for the multi-provider LLM abstraction layer.
 * Supports OpenAI API, self-hosted (vLLM), and other providers.
 */

export type ModelName = 'gpt-4o' | 'qwen-14b' | 'llama-70b' | 'qwen-7b-quantized';
export type ProviderType = 'openai' | 'self-hosted' | 'bedrock';

/**
 * Task type for intelligent model routing
 * Different tasks are routed to different models based on complexity and cost
 */
export type TaskType = 
  | 'fact-extraction'        // Low-complexity: document → facts
  | 'classification'          // Low-complexity: doc type detection
  | 'hypothesis-generation'   // Medium-complexity: planning hypotheses
  | 'query-generation'        // Low-complexity: search queries
  | 'synthesis'               // High-complexity: multi-source synthesis
  | 'validation'              // Medium-complexity: contradiction detection
  | 'chat-response'           // Medium-complexity: user-facing responses
  | 'cycle-analysis'          // Varies by cycle
  | 'general';                // Fallback

/**
 * LLM completion request
 */
export interface CompletionRequest {
  task?: TaskType;
  model?: ModelName;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  metadata?: {
    dealId?: string;
    cycleId?: string;
    userId?: string;
    [key: string]: any;
  };
}

/**
 * LLM completion response
 */
export interface CompletionResponse {
  id: string;
  model: ModelName;
  provider: ProviderType;
  content: string;
  finish_reason: 'stop' | 'length' | 'error';
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latency_ms: number;
  cost?: number;
  error?: string;
  cached?: boolean;
}

/**
 * Streaming completion token
 */
export interface CompletionStreamToken {
  type: 'content' | 'finish' | 'error';
  content?: string;
  finish_reason?: 'stop' | 'length' | 'error';
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  healthy: boolean;
  provider: ProviderType;
  model?: ModelName;
  latency_ms?: number;
  error?: string;
}

/**
 * LLM provider configuration
 */
export interface ProviderConfig {
  type: ProviderType;
  enabled: boolean;
  priority: number; // 1 = highest priority (primary)
  
  // OpenAI config
  apiKey?: string;
  apiUrl?: string;
  
  // Self-hosted config
  baseUrl?: string;
  port?: number;
  model?: string;
  
  // Bedrock config
  region?: string;
  modelArn?: string;
  
  // Common config
  timeout?: number;
  retries?: number;
  maxConcurrent?: number;
}

/**
 * Model routing configuration
 */
export interface RoutingConfig {
  providers: ProviderConfig[];
  routing: {
    [taskType in TaskType]?: {
      preferred_model?: ModelName;
      provider?: ProviderType;
      fallback_provider?: ProviderType;
      max_tokens?: number;
      temperature?: number;
    };
  };
  defaults: {
    temperature: number;
    top_p: number;
    max_tokens: number;
    retry_policy: 'exponential' | 'linear';
    max_retries: number;
    fallback_to_paid: boolean;
  };
  analytics?: {
    track_costs: boolean;
    track_latency: boolean;
    sample_rate: number;
  };
}

/**
 * Analytics event for tracking LLM usage
 */
export interface LLMAnalyticsEvent {
  timestamp: number;
  model: ModelName;
  provider: ProviderType;
  task_type: TaskType;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_total: number;
  latency_ms: number;
  cost_usd?: number;
  status: 'success' | 'error' | 'cached';
  error_type?: string;
  metadata?: {
    dealId?: string;
    cycleId?: string;
    [key: string]: any;
  };
}

/**
 * Cost tracking data
 */
export interface CostData {
  model: ModelName;
  provider: ProviderType;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  date: Date;
}

/**
 * Provider interface - implemented by all providers
 */
export interface ILLMProvider {
  /**
   * Check if provider is available
   */
  healthCheck(): Promise<HealthCheckResponse>;
  
  /**
   * Send completion request
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  
  /**
   * Stream completion tokens
   */
  stream(request: CompletionRequest): AsyncGenerator<CompletionStreamToken>;
  
  /**
   * Get supported models
   */
  getSupportedModels(): ModelName[];
  
  /**
   * Estimate token count before sending
   */
  estimateTokens(text: string): Promise<number>;
  
  /**
   * Get pricing for a model
   */
  getPricing(model: ModelName): {
    input_per_mtok: number;
    output_per_mtok: number;
  } | null;
}

/**
 * Combined interface for all provider implementations
 */
export type ModelProvider = ILLMProvider;
