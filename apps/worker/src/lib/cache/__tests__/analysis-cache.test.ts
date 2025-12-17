/**
 * Analysis Cache Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnalysisCache, createAnalysisCache } from '../analysis-cache';

describe('AnalysisCache', () => {
  let cache: AnalysisCache;

  beforeEach(() => {
    cache = new AnalysisCache({
      enabled: true,
      ttlMs: 3600000, // 1 hour
      maxSize: 100,
    });
  });

  describe('Initialization', () => {
    it('should create cache instance', () => {
      expect(cache).toBeDefined();
    });

    it('should respect enabled flag', () => {
      const disabled = new AnalysisCache({ enabled: false });
      const result = disabled.get('test', 'fact-extraction');
      expect(result).toBeNull();
    });

    it('should set default TTL', () => {
      const c = new AnalysisCache({});
      expect(c).toBeDefined();
    });
  });

  describe('Content hashing', () => {
    it('should calculate hash from content', () => {
      const hash1 = cache.calculateHash('test content');
      expect(hash1).toBeDefined();
      expect(hash1.length).toBeGreaterThan(0);
    });

    it('should produce same hash for same content', () => {
      const content = 'test content';
      const hash1 = cache.calculateHash(content);
      const hash2 = cache.calculateHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
      const hash1 = cache.calculateHash('content1');
      const hash2 = cache.calculateHash('content2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Key generation', () => {
    it('should generate consistent keys', () => {
      const key1 = cache.generateKey('hash', 'fact-extraction', 'gpt-4o', 0.2);
      const key2 = cache.generateKey('hash', 'fact-extraction', 'gpt-4o', 0.2);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different tasks', () => {
      const key1 = cache.generateKey('hash', 'fact-extraction', 'gpt-4o');
      const key2 = cache.generateKey('hash', 'synthesis', 'gpt-4o');

      expect(key1).not.toBe(key2);
    });

    it('should use defaults for missing parameters', () => {
      const key1 = cache.generateKey('hash', 'fact-extraction');
      const key2 = cache.generateKey('hash', 'fact-extraction', undefined, undefined);

      expect(key1).toBe(key2);
    });
  });

  describe('Cache get/set', () => {
    it('should store and retrieve cached result', () => {
      const content = 'test document';
      const taskType = 'fact-extraction';
      const result = {
        content: 'extracted facts',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
      };

      cache.set(content, taskType, result);
      const cached = cache.get(content, taskType);

      expect(cached).toBeDefined();
      expect(cached?.result.content).toBe('extracted facts');
    });

    it('should return null for cache miss', () => {
      const cached = cache.get('unknown content', 'fact-extraction');
      expect(cached).toBeNull();
    });

    it('should respect task type filtering', () => {
      const filterCache = new AnalysisCache({
        taskTypes: ['fact-extraction', 'classification'],
      });

      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      // Should cache
      filterCache.set(content, 'fact-extraction', result);
      expect(filterCache.get(content, 'fact-extraction')).toBeDefined();

      // Should not cache
      filterCache.set(content, 'synthesis', result);
      expect(filterCache.get(content, 'synthesis')).toBeNull();
    });

    it('should handle model-specific caching', () => {
      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set(content, 'fact-extraction', result, 'gpt-4o', 0.2);

      // Same task, model, temperature should hit
      expect(cache.get(content, 'fact-extraction', 'gpt-4o', 0.2)).toBeDefined();

      // Different temperature should miss
      expect(cache.get(content, 'fact-extraction', 'gpt-4o', 0.5)).toBeNull();
    });
  });

  describe('Expiration', () => {
    it('should expire old entries', async () => {
      const cache = new AnalysisCache({ ttlMs: 100 }); // 100ms TTL

      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set(content, 'fact-extraction', result);
      expect(cache.get(content, 'fact-extraction')).toBeDefined();

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 150));

      expect(cache.get(content, 'fact-extraction')).toBeNull();
    });
  });

  describe('Hit counting', () => {
    it('should increment hit count on access', () => {
      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set(content, 'fact-extraction', result);

      const entry1 = cache.get(content, 'fact-extraction');
      expect(entry1?.hitCount).toBe(1);

      const entry2 = cache.get(content, 'fact-extraction');
      expect(entry2?.hitCount).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should track hit/miss statistics', () => {
      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 100, output: 50 } };

      cache.set(content, 'fact-extraction', result);

      // Hit
      cache.get(content, 'fact-extraction');
      // Miss
      cache.get('unknown', 'fact-extraction');

      const stats = cache.getStats();

      expect(stats.totalHits).toBe(1);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(50, 1);
    });

    it('should calculate savings correctly', () => {
      const content = 'test';
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 1000, output: 500 } };

      cache.set(content, 'fact-extraction', result);
      cache.get(content, 'fact-extraction');

      cache.recordHit(1000, 'gpt-4o'); // $5 per 1M input tokens
      // Expected: (1000 / 1M) * 5 = $0.000005

      const stats = cache.getStats();

      expect(stats.tokensSaved).toBe(1000);
      expect(stats.costSaved).toBeGreaterThan(0);
    });

    it('should report cache size', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set('content1', 'fact-extraction', result);
      cache.set('content2', 'classification', result);

      const stats = cache.getStats();

      expect(stats.entriesStored).toBe(2);
    });
  });

  describe('Size limits', () => {
    it('should enforce max size by evicting oldest', () => {
      const smallCache = new AnalysisCache({ maxSize: 3 });

      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      smallCache.set('content1', 'fact-extraction', result);
      smallCache.set('content2', 'fact-extraction', result);
      smallCache.set('content3', 'fact-extraction', result);

      // Adding 4th should evict 1st
      smallCache.set('content4', 'fact-extraction', result);

      const stats = smallCache.getStats();
      expect(stats.entriesStored).toBeLessThanOrEqual(3);
    });
  });

  describe('Clear', () => {
    it('should clear all cache', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set('content1', 'fact-extraction', result);
      cache.set('content2', 'classification', result);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entriesStored).toBe(0);
    });
  });

  describe('Export/Import', () => {
    it('should export cache entries', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set('content1', 'fact-extraction', result);
      cache.set('content2', 'classification', result);

      const exported = cache.export();

      expect(exported.length).toBe(2);
      expect(exported[0]).toHaveProperty('key');
      expect(exported[0]).toHaveProperty('entry');
    });

    it('should import cache entries', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      const cache1 = new AnalysisCache();
      cache1.set('content1', 'fact-extraction', result);

      const exported = cache1.export();

      const cache2 = new AnalysisCache();
      cache2.import(exported);

      expect(cache2.get('content1', 'fact-extraction')).toBeDefined();
    });
  });

  describe('Task-specific queries', () => {
    it('should get entries by task type', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set('content1', 'fact-extraction', result);
      cache.set('content2', 'fact-extraction', result);
      cache.set('content3', 'classification', result);

      const extraction = cache.getEntriesByTask('fact-extraction');
      const classification = cache.getEntriesByTask('classification');

      expect(extraction.length).toBe(2);
      expect(classification.length).toBe(1);
    });

    it('should get top hit entries', () => {
      const result = { content: 'result', model: 'gpt-4o', tokens: { input: 10, output: 5 } };

      cache.set('content1', 'fact-extraction', result);
      cache.set('content2', 'classification', result);

      // Create hit patterns
      for (let i = 0; i < 5; i++) {
        cache.get('content1', 'fact-extraction');
      }
      for (let i = 0; i < 2; i++) {
        cache.get('content2', 'classification');
      }

      const topHits = cache.getTopHits(5);

      expect(topHits.length).toBeGreaterThan(0);
      expect(topHits[0].hitCount).toBeGreaterThanOrEqual(topHits[topHits.length - 1].hitCount);
    });
  });

  describe('Factory function', () => {
    it('should create cache with factory', () => {
      const c = createAnalysisCache({ maxSize: 50 });
      expect(c).toBeInstanceOf(AnalysisCache);
    });
  });
});
