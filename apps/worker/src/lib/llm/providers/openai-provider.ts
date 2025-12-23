/**
 * OpenAI GPT-4o Provider Implementation
 * 
 * Handles all interactions with OpenAI API for GPT-4o model.
 * Implements streaming, error handling, rate limiting, and token counting.
 */

import {
  CompletionRequest,
  CompletionResponse,
  CompletionStreamToken,
  HealthCheckResponse,
  ModelName,
  ProviderConfig,
  ProviderType,
} from '../types';
import { BaseLLMProvider } from '../model-provider';

/**
 * OpenAI API response types
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAICompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAICompletionChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAICompletionChoice[];
  usage: OpenAICompletionUsage;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * OpenAI GPT-4o Provider
 */
export class OpenAIGPT4oProvider extends BaseLLMProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.openai.com/v1';
  private model: ModelName = 'gpt-4o';

  // Pricing (as of training data cutoff, verify current prices)
  private pricing = {
    'gpt-4o': {
      input_per_mtok: 5.0, // $5 per 1M input tokens
      output_per_mtok: 15.0, // $15 per 1M output tokens
    },
  };

  constructor(config: ProviderConfig) {
    super(config, 'openai');

    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not provided. Set config.apiKey or OPENAI_API_KEY env var');
    }

    this.apiKey = apiKey;
    if (config.apiUrl) {
      this.baseUrl = config.apiUrl;
    }
  }

  /**
   * Health check - verify API connectivity
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    const startTime = Date.now();

    try {
      // Make a minimal request to verify connectivity
      const response = await this.makeRequest({
        model: this.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 2,
      });

      const latency = Date.now() - startTime;

      this.logInfo('Health check passed', {
        latency_ms: latency,
      });

      return {
        healthy: true,
        provider: 'openai',
        model: this.model,
        latency_ms: latency,
      };
    } catch (error) {
      this.logError('Health check failed', error, {
        provider: 'openai',
      });

      return {
        healthy: false,
        provider: 'openai',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send completion request
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const model = request.model || this.model;

    try {
      const messages = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await this.retryWithBackoff(
        () =>
          this.makeRequest({
            model: model as string,
            messages,
            temperature: request.temperature || this.config.timeout || 0.7,
            max_tokens: request.max_tokens || 2000,
            top_p: request.top_p || 1,
            stop: request.stop,
          }),
        this.config.retries || 3
      );

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';

      const usage = response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      const cost = this.calculateCost(model as ModelName, usage.prompt_tokens, usage.completion_tokens);

      const result: CompletionResponse = {
        id: response.id,
        model: model as ModelName,
        provider: 'openai',
        content,
        finish_reason: (response.choices[0]?.finish_reason as any) || 'stop',
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
        latency_ms: latency,
        cost,
      };

      // Track analytics
      this.trackEvent({
        model: model as ModelName,
        provider: 'openai',
        task_type: request.task || 'general',
        tokens_prompt: usage.prompt_tokens,
        tokens_completion: usage.completion_tokens,
        tokens_total: usage.total_tokens,
        latency_ms: latency,
        cost_usd: cost,
        status: 'success',
        metadata: request.metadata,
      });

      return result;
    } catch (error) {
      this.logError('Completion request failed', error, {
        model,
        task: request.task,
      });

      // Track error
      this.trackEvent({
        model: model as ModelName,
        provider: 'openai',
        task_type: request.task || 'general',
        tokens_prompt: 0,
        tokens_completion: 0,
        tokens_total: 0,
        latency_ms: Date.now() - startTime,
        status: 'error',
        error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        metadata: request.metadata,
      });

      throw error;
    }
  }

  /**
   * Stream completion tokens
   */
  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamToken> {
    const model = request.model || this.model;
    let usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
    };

    try {
      const messages = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const stream = await this.makeStreamRequest({
        model: model as string,
        messages,
        temperature: request.temperature || 0.7,
        max_tokens: request.max_tokens || 2000,
        top_p: request.top_p || 1,
        stop: request.stop,
        stream: true,
      });

      let content = '';
      let finishReason = 'stop';

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        const finish = choice?.finish_reason;

        if (delta?.content) {
          content += delta.content;
          yield {
            type: 'content',
            content: delta.content,
          };
        }

        if (finish) {
          finishReason = finish;
        }
      }

      yield {
        type: 'finish',
        finish_reason: finishReason as any,
      };

      // Track usage after stream completes
      usage = await this.estimateUsage(request.messages, content);

      this.trackEvent({
        model: model as ModelName,
        provider: 'openai',
        task_type: request.task || 'general',
        tokens_prompt: usage.prompt_tokens,
        tokens_completion: usage.completion_tokens,
        tokens_total: usage.prompt_tokens + usage.completion_tokens,
        latency_ms: 0, // Would need to track separately for streams
        status: 'success',
        metadata: request.metadata,
      });
    } catch (error) {
      this.logError('Stream request failed', error, {
        model,
        task: request.task,
      });

      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };

      this.trackEvent({
        model: model as ModelName,
        provider: 'openai',
        task_type: request.task || 'general',
        tokens_prompt: 0,
        tokens_completion: 0,
        tokens_total: 0,
        latency_ms: 0,
        status: 'error',
        error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        metadata: request.metadata,
      });
    }
  }

  /**
   * Get supported models
   */
  getSupportedModels(): ModelName[] {
    return ['gpt-4o'];
  }

  /**
   * Estimate token count
   * Uses approximation: ~4 chars per token on average
   */
  async estimateTokens(text: string): Promise<number> {
    // Simple heuristic: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get pricing for model
   */
  getPricing(model: ModelName): { input_per_mtok: number; output_per_mtok: number } | null {
    return this.pricing[model as keyof typeof this.pricing] || null;
  }

  /**
   * Make HTTP request to OpenAI API
   */
  private async makeRequest(body: any): Promise<OpenAICompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = errorData.error?.message || `OpenAI API error: ${response.status}`;
      throw new Error(message);
    }

    return (await response.json()) as OpenAICompletionResponse;
  }

  /**
   * Make streaming HTTP request to OpenAI API
   */
  private async *makeStreamRequest(body: any): AsyncGenerator<OpenAIStreamChunk> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = errorData.error?.message || `OpenAI API error: ${response.status}`;
      throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            if (data) {
              try {
                const chunk = JSON.parse(data);
                yield chunk;
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Estimate tokens for messages and response
   */
  private async estimateUsage(
    messages: CompletionRequest['messages'],
    responseContent: string
  ): Promise<{ prompt_tokens: number; completion_tokens: number }> {
    const promptText = messages.map((m) => m.content).join(' ');
    const promptTokens = await this.estimateTokens(promptText);
    const completionTokens = await this.estimateTokens(responseContent);

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    };
  }
}

/**
 * Factory function to create OpenAI provider
 */
export function createOpenAIProvider(config: ProviderConfig): OpenAIGPT4oProvider {
  return new OpenAIGPT4oProvider(config);
}
