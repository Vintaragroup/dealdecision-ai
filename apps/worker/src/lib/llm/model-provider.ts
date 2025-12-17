/**
 * Base LLM Provider Implementation
 * 
 * Abstract base class providing common functionality for all LLM providers.
 * Extends with specific provider implementations (OpenAI, vLLM, Bedrock, etc.)
 */

import { EventEmitter } from 'events';
import {
  ILLMProvider,
  CompletionRequest,
  CompletionResponse,
  CompletionStreamToken,
  HealthCheckResponse,
  ModelName,
  ProviderType,
  TaskType,
  LLMAnalyticsEvent,
  ProviderConfig,
} from './types';

/**
 * Base provider class with common functionality
 */
export abstract class BaseLLMProvider extends EventEmitter implements ILLMProvider {
  protected config: ProviderConfig;
  protected type: ProviderType;
  protected enabled: boolean = false;
  
  // Analytics
  private analytics: LLMAnalyticsEvent[] = [];
  private analyticsBuffer: LLMAnalyticsEvent[] = [];
  private analyticsFlushed: number = 0;

  constructor(config: ProviderConfig, type: ProviderType) {
    super();
    this.config = config;
    this.type = type;
    this.enabled = config.enabled !== false;
    this.startAnalyticsBuffer();
  }

  /**
   * Health check - implemented by subclasses
   */
  abstract healthCheck(): Promise<HealthCheckResponse>;

  /**
   * Complete request - implemented by subclasses
   */
  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream tokens - implemented by subclasses
   */
  abstract stream(request: CompletionRequest): AsyncGenerator<CompletionStreamToken>;

  /**
   * Get supported models - implemented by subclasses
   */
  abstract getSupportedModels(): ModelName[];

  /**
   * Estimate tokens - implemented by subclasses
   */
  abstract estimateTokens(text: string): Promise<number>;

  /**
   * Get pricing - implemented by subclasses
   */
  abstract getPricing(model: ModelName): { input_per_mtok: number; output_per_mtok: number } | null;

  /**
   * Calculate cost of a completion
   */
  protected calculateCost(
    model: ModelName,
    promptTokens: number,
    completionTokens: number
  ): number | undefined {
    const pricing = this.getPricing(model);
    if (!pricing) return undefined;

    const inputCost = (promptTokens / 1_000_000) * pricing.input_per_mtok;
    const outputCost = (completionTokens / 1_000_000) * pricing.output_per_mtok;
    return inputCost + outputCost;
  }

  /**
   * Track analytics event
   */
  protected trackEvent(event: Omit<LLMAnalyticsEvent, 'timestamp'>): void {
    if (!this.config.enabled) return;

    const fullEvent: LLMAnalyticsEvent = {
      timestamp: Date.now(),
      ...event,
    };

    this.analyticsBuffer.push(fullEvent);
    this.emit('analytics', fullEvent);

    // Flush if buffer exceeds 100 events
    if (this.analyticsBuffer.length >= 100) {
      this.flushAnalytics();
    }
  }

  /**
   * Start analytics buffer flushing (every 30 seconds)
   */
  private startAnalyticsBuffer(): void {
    setInterval(() => {
      if (this.analyticsBuffer.length > 0) {
        this.flushAnalytics();
      }
    }, 30_000);
  }

  /**
   * Flush analytics to persistent storage
   */
  private async flushAnalytics(): Promise<void> {
    if (this.analyticsBuffer.length === 0) return;

    const events = [...this.analyticsBuffer];
    this.analyticsBuffer = [];

    try {
      // This will be implemented to send to analytics service
      // For now, just emit event
      this.emit('analytics-flush', {
        count: events.length,
        total_flushed: this.analyticsFlushed + events.length,
      });
      this.analyticsFlushed += events.length;
    } catch (error) {
      console.error('Failed to flush analytics:', error);
      // Re-add events to buffer
      this.analyticsBuffer.unshift(...events);
    }
  }

  /**
   * Get analytics events
   */
  getAnalytics(limit?: number): LLMAnalyticsEvent[] {
    if (limit) {
      return this.analytics.slice(-limit);
    }
    return [...this.analytics];
  }

  /**
   * Helper: Retry with exponential backoff
   */
  protected async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = this.config.retries || 3,
    initialDelayMs: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delayMs = initialDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Helper: Log error with context
   */
  protected logError(message: string, error: any, context?: Record<string, any>): void {
    console.error(`[${this.type}] ${message}`, {
      error: error instanceof Error ? error.message : String(error),
      ...context,
    });
  }

  /**
   * Helper: Log info
   */
  protected logInfo(message: string, context?: Record<string, any>): void {
    console.log(`[${this.type}] ${message}`, context || '');
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get provider type
   */
  getType(): ProviderType {
    return this.type;
  }

  /**
   * Get provider config
   */
  getConfig(): ProviderConfig {
    return this.config;
  }
}

/**
 * Export base class for extending
 */
export { BaseLLMProvider as LLMProvider };
