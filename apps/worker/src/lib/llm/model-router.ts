/**
 * Model Router
 * 
 * Intelligent routing of completion requests to the best available model.
 * Makes decisions based on:
 * - Task type (extraction vs synthesis)
 * - Cost considerations
 * - Quality requirements
 * - Provider availability
 * - User tier/usage limits
 */

import {
  CompletionRequest,
  CompletionResponse,
  CompletionStreamToken,
  HealthCheckResponse,
  ModelName,
  ProviderType,
  TaskType,
  RoutingConfig,
  LLMAnalyticsEvent,
} from './types';
import { BaseLLMProvider } from './model-provider';

interface ProviderStatus {
  provider: BaseLLMProvider;
  healthy: boolean;
  lastCheck: number;
  latency: number;
}

/**
 * ModelRouter - Routes requests to best available provider/model
 */
export class ModelRouter {
  private providers: Map<ProviderType, ProviderStatus> = new Map();
  private config: RoutingConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck: number = 0;

  /**
   * Cost per model (for decision making when multiple models available)
   * Format: cost per 1M tokens (input)
   */
  private modelCosts: Record<ModelName, number> = {
    'gpt-4o': 5.0, // $5 per 1M input tokens
    'gpt-4o-mini': 5.0, // Treat as same class for routing heuristics
    'qwen-14b': 0.02, // Self-hosted, very cheap
    'qwen-7b-quantized': 0.01, // Self-hosted quantized, cheaper
    'llama-70b': 0.05, // Self-hosted heavy, slightly more
  };

  /**
   * Model capabilities - what each model is best at
   */
  private modelCapabilities: Record<ModelName, Set<TaskType>> = {
    'gpt-4o': new Set([
      'synthesis' as TaskType, // Great for complex reasoning
      'validation' as TaskType, // Good at contradiction detection
      'chat-response' as TaskType, // Excellent user-facing
    ] as TaskType[]),
    'gpt-4o-mini': new Set([
      'synthesis' as TaskType,
      'validation' as TaskType,
      'chat-response' as TaskType,
    ] as TaskType[]),
    'qwen-14b': new Set([
      'fact-extraction' as TaskType, // Very good
      'hypothesis-generation' as TaskType, // Good reasoning
      'query-generation' as TaskType, // Effective
      'cycle-analysis' as TaskType, // Balanced
    ] as TaskType[]),
    'qwen-7b-quantized': new Set([
      'fact-extraction' as TaskType, // Still excellent
      'classification' as TaskType, // Very fast
      'query-generation' as TaskType, // Good enough
    ] as TaskType[]),
    'llama-70b': new Set([
      'synthesis' as TaskType, // Powerful synthesis
      'validation' as TaskType, // Strong reasoning
      'chat-response' as TaskType, // Great responses
    ] as TaskType[]),
  };

  constructor(config: RoutingConfig) {
    this.config = config;
    this.initializeProviders();
  }

  /**
   * Initialize providers from config
   */
  private initializeProviders(): void {
    // Providers will be registered via registerProvider()
    // This allows flexibility in how providers are created
  }

  /**
   * Register a provider
   */
  registerProvider(provider: BaseLLMProvider): void {
    const type = provider.getType();
    this.providers.set(type, {
      provider,
      healthy: false,
      lastCheck: 0,
      latency: 0,
    });
  }

  /**
   * Get all registered providers
   */
  getProviders(): BaseLLMProvider[] {
    return Array.from(this.providers.values()).map((p) => p.provider);
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 60_000): void {
    // Run first check immediately
    this.runHealthChecks();

    // Then run periodically
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, intervalMs);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Run health checks on all providers
   */
  private async runHealthChecks(): Promise<void> {
    const checks = Array.from(this.providers.values()).map(async (status) => {
      try {
        const result = await status.provider.healthCheck();
        status.healthy = result.healthy;
        status.latency = result.latency_ms || 0;
        status.lastCheck = Date.now();
      } catch (error) {
        status.healthy = false;
        status.latency = 999;
      }
    });

    await Promise.all(checks);
    this.lastHealthCheck = Date.now();
  }

  /**
   * Get health status of all providers
   */
  async getHealthStatus(): Promise<Map<ProviderType, HealthCheckResponse>> {
    const status = new Map<ProviderType, HealthCheckResponse>();

    for (const [type, providerStatus] of Array.from(this.providers)) {
      status.set(type, {
        healthy: providerStatus.healthy,
        provider: type,
        latency_ms: providerStatus.latency,
      });
    }

    return status;
  }

  /**
   * Route a completion request to best provider
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = await this.selectProvider(request);

    if (!provider) {
      throw new Error('No available providers for completion request');
    }

    try {
      const response = await provider.complete(request);
      this.trackRouting(request, response);
      return response;
    } catch (error) {
      // Try fallback provider if configured
      const fallback = await this.selectFallbackProvider(request);
      if (fallback && fallback !== provider) {
        return fallback.complete(request);
      }
      throw error;
    }
  }

  /**
   * Stream a completion request
   */
  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamToken> {
    const provider = await this.selectProvider(request);

    if (!provider) {
      throw new Error('No available providers for streaming');
    }

    try {
      yield* provider.stream(request);
    } catch (error) {
      // Try fallback
      const fallback = await this.selectFallbackProvider(request);
      if (fallback && fallback !== provider) {
        yield* fallback.stream(request);
      } else {
        throw error;
      }
    }
  }

  /**
   * Select best provider for request
   * 
   * Selection criteria (in order):
   * 1. Check if request explicitly specifies model
   * 2. Determine best model based on task type
   * 3. Check provider health and availability
   * 4. Consider cost vs quality tradeoff
   */
  private async selectProvider(request: CompletionRequest): Promise<BaseLLMProvider | null> {
    let targetModel: ModelName | undefined;
    let targetProvider: ProviderType | undefined;

    // 1. Explicit model request
    if (request.model) {
      targetModel = request.model;
    } else if (request.task) {
      // 2. Use task-specific routing config
      const taskConfig = this.config.routing[request.task];
      targetModel = taskConfig?.preferred_model;
      targetProvider = taskConfig?.provider;
    }

    // 3. Fallback to default for task type
    if (!targetModel && request.task) {
      targetModel = this.selectModelForTask(request.task);
    }

    // 4. Default to primary available provider
    if (!targetModel) {
      targetModel = 'gpt-4o'; // Conservative default
    }

    // 5. Find provider that has this model
    const selectedProvider = this.findProviderForModel(targetModel, targetProvider);

    return selectedProvider;
  }

  /**
   * Select best model for a task type
   */
  private selectModelForTask(task: TaskType): ModelName {
    // Task-specific selections optimized for cost + quality
    switch (task) {
      case 'fact-extraction':
      case 'classification':
      case 'query-generation':
        // Fast, cheap models for simple tasks
        return this.isProviderHealthy('self-hosted') ? 'qwen-14b' : 'gpt-4o';

      case 'hypothesis-generation':
      case 'cycle-analysis':
        // Medium complexity - Qwen 14B is good choice
        return this.isProviderHealthy('self-hosted') ? 'qwen-14b' : 'gpt-4o';

      case 'synthesis':
      case 'validation':
        // Complex reasoning - prefer GPT-4o, fallback to Llama 70B or Qwen
        if (this.isProviderHealthy('openai')) return 'gpt-4o';
        return 'llama-70b';

      case 'chat-response':
        // User-facing - quality matters most
        if (this.isProviderHealthy('openai')) return 'gpt-4o';
        return 'llama-70b';

      default:
        return 'gpt-4o'; // Safe default
    }
  }

  /**
   * Find provider that offers a specific model
   */
  private findProviderForModel(
    model: ModelName,
    preferredProvider?: ProviderType
  ): BaseLLMProvider | null {
    // Check preferred provider first
    if (preferredProvider) {
      const status = this.providers.get(preferredProvider);
      if (status?.healthy && status.provider.getSupportedModels().includes(model)) {
        return status.provider;
      }
    }

    // Map models to likely providers
    const modelToProviders: Record<ModelName, ProviderType[]> = {
      'gpt-4o': ['openai'],
      'gpt-4o-mini': ['openai'],
      'qwen-14b': ['self-hosted'],
      'qwen-7b-quantized': ['self-hosted'],
      'llama-70b': ['self-hosted'],
    };

    const providers = modelToProviders[model] || ['openai', 'self-hosted'];

    for (const providerType of providers) {
      const status = this.providers.get(providerType);
      if (status?.healthy && status.provider.getSupportedModels().includes(model)) {
        return status.provider;
      }
    }

    // Last resort: return any healthy provider
    for (const status of Array.from(this.providers.values())) {
      if (status.healthy) {
        return status.provider;
      }
    }

    return null;
  }

  /**
   * Select a fallback provider
   */
  private async selectFallbackProvider(request: CompletionRequest): Promise<BaseLLMProvider | null> {
    const taskConfig = request.task && this.config.routing[request.task];
    if (taskConfig?.fallback_provider) {
      const status = this.providers.get(taskConfig.fallback_provider);
      if (status?.healthy) {
        return status.provider;
      }
    }

    // Fallback to any healthy provider with highest priority
    let best: [ProviderType, ProviderStatus] | null = null;
    for (const [type, status] of Array.from(this.providers)) {
      if (status.healthy) {
        if (!best || status.provider.getConfig().priority < best[1].provider.getConfig().priority) {
          best = [type, status];
        }
      }
    }

    return best ? best[1].provider : null;
  }

  /**
   * Check if provider is healthy
   */
  private isProviderHealthy(type: ProviderType): boolean {
    const status = this.providers.get(type);
    return status?.healthy || false;
  }

  /**
   * Track routing decision and response
   */
  private trackRouting(request: CompletionRequest, response: CompletionResponse): void {
    // Emit event for analytics - implementation depends on analytics backend
    const event = {
      task_type: request.task || 'general' as TaskType,
      model: response.model,
      provider: response.provider,
      tokens_prompt: response.usage.prompt_tokens,
      tokens_completion: response.usage.completion_tokens,
      tokens_total: response.usage.total_tokens,
      latency_ms: response.latency_ms,
      cost_usd: response.cost,
      status: response.error ? ('error' as const) : ('success' as const),
      error_type: response.error?.split(':')[0],
      metadata: request.metadata,
    };

    // Emit to any listeners
    // This will be connected to analytics service
  }

  /**
   * Get routing stats
   */
  async getStats(): Promise<{
    providers: Array<{
      type: ProviderType;
      healthy: boolean;
      latency_ms: number;
      models: ModelName[];
    }>;
    lastHealthCheck: number;
  }> {
    return {
      providers: Array.from(this.providers.entries()).map(([type, status]) => ({
        type,
        healthy: status.healthy,
        latency_ms: status.latency,
        models: status.provider.getSupportedModels(),
      })),
      lastHealthCheck: this.lastHealthCheck,
    };
  }
}

/**
 * Create router from config
 */
export function createRouter(config: RoutingConfig): ModelRouter {
  return new ModelRouter(config);
}
