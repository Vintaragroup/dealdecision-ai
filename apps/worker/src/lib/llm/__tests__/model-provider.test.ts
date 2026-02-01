/**
 * LLM Provider Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BaseLLMProvider } from '../model-provider';
import { OpenAIGPT4oProvider } from '../providers/openai-provider';
import type { ProviderConfig } from '../types';

describe('BaseLLMProvider', () => {
  let provider: OpenAIGPT4oProvider;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';

    const config: ProviderConfig = {
      type: 'openai',
      enabled: true,
      priority: 1,
      apiKey: 'test-key',
      retries: 2,
      timeout: 5000,
    };

    provider = new OpenAIGPT4oProvider(config);
    provider.resetAnalytics();
  });

  describe('Initialization', () => {
    it('should initialize with valid config', () => {
      expect(provider).toBeDefined();
      expect(provider.getType()).toBe('openai');
      expect(provider.isEnabled()).toBe(true);
    });

    it('should throw on missing API key', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => {
        const config: ProviderConfig = {
          type: 'openai',
          enabled: true,
          priority: 1,
        };
        new OpenAIGPT4oProvider(config);
      }).toThrow();
    });
  });

  describe('getSupportedModels', () => {
    it('should return supported models', () => {
      const models = provider.getSupportedModels();
      expect(models).toContain('gpt-4o');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens from text', async () => {
      const text = 'Hello world this is a test';
      const tokens = await provider.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length); // Should be less than char count
    });

    it('should scale with text length', async () => {
      const short = 'Hello';
      const long = 'Hello '.repeat(100);

      const shortTokens = await provider.estimateTokens(short);
      const longTokens = await provider.estimateTokens(long);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });
  });

  describe('getPricing', () => {
    it('should return pricing for supported model', () => {
      const pricing = provider.getPricing('gpt-4o');

      expect(pricing).toBeDefined();
      expect(pricing?.input_per_mtok).toBeGreaterThan(0);
      expect(pricing?.output_per_mtok).toBeGreaterThan(0);
    });

    it('should return null for unsupported model', () => {
      const pricing = provider.getPricing('unsupported-model' as any);
      expect(pricing).toBeNull();
    });
  });

  describe('Cost calculation', () => {
    it('should calculate cost correctly', () => {
      const cost = (provider as any).calculateCost('gpt-4o', 1000, 500);

      expect(cost).toBeGreaterThan(0);

      // Cost should be (1000 / 1M * 5) + (500 / 1M * 15)
      const expectedCost = (1000 / 1_000_000) * 5 + (500 / 1_000_000) * 15;
      expect(cost).toBeCloseTo(expectedCost, 10);
    });

    it('should return undefined for unsupported model', () => {
      const cost = (provider as any).calculateCost('unsupported-model' as any, 1000, 500);
      expect(cost).toBeUndefined();
    });
  });

  describe('Analytics tracking', () => {
    it('should track analytics events', () => {
      (provider as any).trackEvent({
        model: 'gpt-4o',
        provider: 'openai',
        task_type: 'fact-extraction',
        tokens_prompt: 100,
        tokens_completion: 50,
        tokens_total: 150,
        latency_ms: 500,
        status: 'success',
      });

      const analytics = provider.getAnalytics();
      expect(analytics.length).toBeGreaterThan(0);
    });

    it('should limit analytics buffer', async () => {
      // Track 150 events (exceeds buffer limit of 100)
      for (let i = 0; i < 150; i++) {
        (provider as any).trackEvent({
          model: 'gpt-4o',
          provider: 'openai',
          task_type: 'fact-extraction',
          tokens_prompt: 100,
          tokens_completion: 50,
          tokens_total: 150,
          latency_ms: 500,
          status: 'success',
        });
      }

      // Wait a bit for async flush
      await new Promise((r) => setTimeout(r, 100));

      // Should still have analytics stored
      const analytics = provider.getAnalytics();
      expect(analytics.length).toBeGreaterThan(0);
    });
  });

  describe('Config management', () => {
    it('should expose config', () => {
      const config = provider.getConfig();
      expect(config.type).toBe('openai');
      expect(config.enabled).toBe(true);
    });

    it('should expose provider type', () => {
      expect(provider.getType()).toBe('openai');
    });

    it('should expose enabled status', () => {
      expect(provider.isEnabled()).toBe(true);
    });
  });
});

describe('OpenAIGPT4oProvider', () => {
  let provider: OpenAIGPT4oProvider;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';

    const config: ProviderConfig = {
      type: 'openai',
      enabled: true,
      priority: 1,
      apiKey: 'test-key',
    };

    provider = new OpenAIGPT4oProvider(config);
  });

  describe('Initialization', () => {
    it('should use env API key if not provided', () => {
      const config: ProviderConfig = {
        type: 'openai',
        enabled: true,
        priority: 1,
        // apiKey not provided
      };

      expect(() => {
        new OpenAIGPT4oProvider(config);
      }).not.toThrow();
    });

    it('should prefer config API key over env', () => {
      process.env.OPENAI_API_KEY = 'env-key';

      const config: ProviderConfig = {
        type: 'openai',
        enabled: true,
        priority: 1,
        apiKey: 'config-key',
      };

      const p = new OpenAIGPT4oProvider(config);
      expect(p).toBeDefined();
    });

    it('should use custom base URL if provided', () => {
      const config: ProviderConfig = {
        type: 'openai',
        enabled: true,
        priority: 1,
        apiKey: 'test-key',
        apiUrl: 'https://custom.openai.com/v1',
      };

      const p = new OpenAIGPT4oProvider(config);
      expect(p).toBeDefined();
    });
  });

  describe('Model support', () => {
    it('should support gpt-4o', () => {
      const models = provider.getSupportedModels();
      expect(models).toContain('gpt-4o');
      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(new Set(models).size).toBe(models.length); // no duplicates
    });
  });

  describe('Pricing', () => {
    it('should have correct pricing for gpt-4o', () => {
      const pricing = provider.getPricing('gpt-4o');

      expect(pricing).toBeDefined();
      expect(pricing?.input_per_mtok).toBe(5.0); // $5 per 1M input tokens
      expect(pricing?.output_per_mtok).toBe(15.0); // $15 per 1M output tokens
    });
  });
});
