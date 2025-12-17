/**
 * LLM Integration Module
 * 
 * Provides a unified interface for using LLMs throughout the analysis pipeline.
 * Integrates:
 * - Model Router (intelligent provider selection)
 * - OpenAI GPT-4o provider
 * - Context compression
 * - Caching
 * - Analytics
 * 
 * Usage:
 * ```
 * const llm = getLLMIntegration();
 * const response = await llm.complete({
 *   task: 'fact-extraction',
 *   messages: [...],
 * });
 * ```
 */

import { ModelRouter } from './model-router';
import { OpenAIGPT4oProvider } from './providers/openai-provider';
import { ContextCompressor } from './context-compressor';
import { AnalysisCache, getGlobalCache } from '../cache/analysis-cache';
import type {
  CompletionRequest,
  CompletionResponse,
  CompletionStreamToken,
  RoutingConfig,
  ProviderType,
  TaskType,
} from './types';

/**
 * LLM Integration Configuration
 */
export interface LLMIntegrationConfig {
  router: RoutingConfig;
  cache?: {
    enabled: boolean;
    ttlMs?: number;
    maxSize?: number;
  };
  compression?: {
    enabled: boolean;
    aggressive?: boolean;
  };
  analytics?: {
    enabled: boolean;
    flushIntervalMs?: number;
  };
}

/**
 * LLM Integration
 */
export class LLMIntegration {
  private router: ModelRouter;
  private cache: AnalysisCache;
  private config: LLMIntegrationConfig;
  private started: boolean = false;

  constructor(config: LLMIntegrationConfig) {
    this.config = config;

    // Initialize router
    this.router = new ModelRouter(config.router);

    // Initialize cache
    this.cache = getGlobalCache(config.cache || {});

    // Register providers
    this.initializeProviders();
  }

  /**
   * Initialize available providers
   */
  private initializeProviders(): void {
    // Register OpenAI provider
    const openaiConfig = this.config.router.providers.find((p) => p.type === 'openai');
    if (openaiConfig?.enabled) {
      const provider = new OpenAIGPT4oProvider(openaiConfig);
      this.router.registerProvider(provider);
    }

    // TODO: Register self-hosted provider when available
    // const selfHostedConfig = this.config.router.providers.find((p) => p.type === 'self-hosted');
    // if (selfHostedConfig?.enabled) {
    //   const provider = new SelfHostedProvider(selfHostedConfig);
    //   this.router.registerProvider(provider);
    // }
  }

  /**
   * Start health checks and monitoring
   */
  async start(): Promise<void> {
    if (this.started) return;

    this.router.startHealthChecks(60_000); // Check every 60 seconds
    await this.router.getHealthStatus(); // Run initial check

    this.started = true;
    console.log('[LLM] Integration started');
  }

  /**
   * Stop health checks
   */
  stop(): void {
    this.router.stopHealthChecks();
    this.started = false;
    console.log('[LLM] Integration stopped');
  }

  /**
   * Complete a request with automatic compression, caching, and routing
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // 1. Check cache first
    const firstMessage = request.messages[0]?.content || '';
    const cacheKey = this.cache.calculateHash(firstMessage);
    const cached = this.cache.get(
      firstMessage,
      request.task || 'general',
      request.model,
      request.temperature
    );

    if (cached) {
      // Record cache hit for analytics
      this.cache.recordHit(cached.result.tokens.input, cached.result.model);

      return {
        id: cached.key,
        model: cached.result.model as any,
        provider: 'openai' as ProviderType,
        content: cached.result.content,
        finish_reason: 'stop',
        usage: {
          prompt_tokens: cached.result.tokens.input,
          completion_tokens: cached.result.tokens.output,
          total_tokens: cached.result.tokens.input + cached.result.tokens.output,
        },
        latency_ms: 0,
        cached: true,
      };
    }

    // 2. Apply compression if enabled
    let processedRequest = request;
    if (this.config.compression?.enabled) {
      const compressedMessages = request.messages.map((msg) => {
        const compressed = ContextCompressor.compress(msg.content, {
          aggressive: this.config.compression?.aggressive,
          maxLengthChars: 5000,
        });

        return {
          role: msg.role,
          content: compressed.compressed,
        };
      });

      processedRequest = {
        ...request,
        messages: compressedMessages,
      };
    }

    // 3. Route to provider
    const response = await this.router.complete(processedRequest);

    // 4. Cache result
    if (this.config.cache?.enabled && request.task) {
      this.cache.set(
        firstMessage,
        request.task,
        {
          content: response.content,
          model: response.model,
          tokens: {
            input: response.usage.prompt_tokens,
            output: response.usage.completion_tokens,
          },
        },
        request.model,
        request.temperature
      );
    }

    return response;
  }

  /**
   * Stream completion tokens
   */
  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamToken> {
    // Apply compression if enabled
    let processedRequest = request;
    if (this.config.compression?.enabled) {
      const compressedMessages = request.messages.map((msg) => {
        const compressed = ContextCompressor.compress(msg.content, {
          aggressive: this.config.compression?.aggressive,
          maxLengthChars: 5000,
        });

        return {
          role: msg.role,
          content: compressed.compressed,
        };
      });

      processedRequest = {
        ...request,
        messages: compressedMessages,
      };
    }

    // Stream from router
    yield* this.router.stream(processedRequest);
  }

  /**
   * Get extraction helper (specialized for fact extraction)
   */
  async extract(document: string, schema: string): Promise<any> {
    const { document: compDoc, instructions: compSchema } =
      ContextCompressor.compressDocumentContext(document, schema);

    const response = await this.complete({
      task: 'fact-extraction',
      messages: [
        {
          role: 'system',
          content: 'You are a document analysis expert. Extract structured facts.',
        },
        {
          role: 'user',
          content: `${compSchema}\n\nDocument:\n${compDoc}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    return {
      content: response.content,
      tokens: response.usage.total_tokens,
      cost: response.cost,
    };
  }

  /**
   * Get synthesis helper (specialized for complex reasoning)
   */
  async synthesize(
    facts: string,
    hypotheses: string,
    synthesis_prompt: string
  ): Promise<any> {
    const { factTable, hypotheses: compHyp, queries } = ContextCompressor.compressAnalysisContext(
      facts,
      hypotheses,
      synthesis_prompt
    );

    const response = await this.complete({
      task: 'synthesis',
      messages: [
        {
          role: 'system',
          content:
            'You are an investment analyst synthesizing evidence. Be precise and cite sources.',
        },
        {
          role: 'user',
          content: `Facts:\n${factTable}\n\nHypotheses:\n${compHyp}\n\nAnalyze:\n${queries}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 3000,
    });

    return {
      content: response.content,
      tokens: response.usage.total_tokens,
      cost: response.cost,
    };
  }

  /**
   * Get stats
   */
  async getStats() {
    const routerStats = await this.router.getStats();
    const cacheStats = this.cache.getStats();

    return {
      router: routerStats,
      cache: cacheStats,
      started: this.started,
    };
  }

  /**
   * Get health status
   */
  async getHealth() {
    return this.router.getHealthStatus();
  }
}

/**
 * Global LLM integration instance
 */
let globalIntegration: LLMIntegration | null = null;

/**
 * Initialize global LLM integration from env
 */
export function initializeLLM(config?: LLMIntegrationConfig): LLMIntegration {
  if (globalIntegration) {
    return globalIntegration;
  }

  // Use provided config or create from env
  const finalConfig: LLMIntegrationConfig = config || {
    router: {
      providers: [
        {
          type: 'openai',
          enabled: !!process.env.OPENAI_API_KEY,
          priority: 1,
          apiKey: process.env.OPENAI_API_KEY,
          retries: 3,
        },
        // Self-hosted will be added in Phase 2
        // {
        //   type: 'self-hosted',
        //   enabled: !!process.env.VLLM_BASE_URL,
        //   priority: 2,
        //   baseUrl: process.env.VLLM_BASE_URL,
        //   port: parseInt(process.env.VLLM_PORT || '8000', 10),
        //   retries: 2,
        // },
      ],
      routing: {
        'fact-extraction': {
          preferred_model: 'qwen-14b',
          max_tokens: 1500,
          temperature: 0.2,
        },
        'classification': {
          preferred_model: 'qwen-7b-quantized',
          max_tokens: 500,
          temperature: 0.1,
        },
        'hypothesis-generation': {
          preferred_model: 'qwen-14b',
          max_tokens: 2000,
          temperature: 0.7,
        },
        'synthesis': {
          preferred_model: 'gpt-4o',
          max_tokens: 3000,
          temperature: 0.5,
        },
        'validation': {
          preferred_model: 'gpt-4o',
          max_tokens: 2000,
          temperature: 0.3,
        },
        'chat-response': {
          preferred_model: 'gpt-4o',
          max_tokens: 1500,
          temperature: 0.6,
        },
      },
      defaults: {
        temperature: 0.7,
        top_p: 1,
        max_tokens: 2000,
        retry_policy: 'exponential',
        max_retries: 3,
        fallback_to_paid: true,
      },
      analytics: {
        track_costs: true,
        track_latency: true,
        sample_rate: 1.0,
      },
    },
    cache: {
      enabled: true,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxSize: 10000,
    },
    compression: {
      enabled: true,
      aggressive: false,
    },
    analytics: {
      enabled: true,
      flushIntervalMs: 30_000,
    },
  };

  globalIntegration = new LLMIntegration(finalConfig);
  return globalIntegration;
}

/**
 * Get global LLM integration
 */
export function getLLM(): LLMIntegration {
  if (!globalIntegration) {
    globalIntegration = initializeLLM();
  }
  return globalIntegration;
}

/**
 * Export convenience function
 */
export async function completeLLM(request: CompletionRequest): Promise<CompletionResponse> {
  const llm = getLLM();
  return llm.complete(request);
}
