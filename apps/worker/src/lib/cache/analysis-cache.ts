/**
 * Analysis Cache
 * 
 * Content-hash based caching of analysis results.
 * Caches by:
 * 1. Document content hash
 * 2. Analysis task type
 * 3. Key parameters (model, temperature, etc)
 * 
 * Target: 20% fewer API calls for repeated or similar analyses
 */

import { createHash } from 'crypto';

/**
 * Cache entry
 */
export interface CacheEntry {
  key: string;
  contentHash: string;
  taskType: string;
  result: {
    content: string;
    model: string;
    tokens: {
      input: number;
      output: number;
    };
  };
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  savedTokens: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  tokensSaved: number;
  costSaved: number;
  entriesStored: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled?: boolean;
  ttlMs?: number; // Time to live (default: 7 days)
  maxSize?: number; // Max entries (default: 10000)
  taskTypes?: string[]; // Only cache these task types
}

/**
 * Analysis Cache Implementation
 */
export class AnalysisCache {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    tokensSaved: 0,
    costSaved: 0,
  };

  // Cost per 1M tokens (for savings calculation)
  private modelCosts: Record<string, number> = {
    'gpt-4o': 5.0, // $5 per 1M input tokens
    'qwen-14b': 0.02,
    'llama-70b': 0.05,
  };

  constructor(config: CacheConfig = {}) {
    this.config = {
      enabled: config.enabled !== false,
      ttlMs: config.ttlMs || 7 * 24 * 60 * 60 * 1000, // 7 days default
      maxSize: config.maxSize || 10000,
      taskTypes: config.taskTypes || [
        'fact-extraction',
        'classification',
        'query-generation',
        'hypothesis-generation',
      ],
    };
  }

  /**
   * Generate cache key from request parameters
   */
  generateKey(
    contentHash: string,
    taskType: string,
    model?: string,
    temperature?: number
  ): string {
    const params = [contentHash, taskType, model || 'default', temperature || '0.7'].join(':');
    return createHash('sha256').update(params).digest('hex');
  }

  /**
   * Calculate content hash from text
   */
  calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Try to get cached result
   */
  get(
    content: string,
    taskType: string,
    model?: string,
    temperature?: number
  ): CacheEntry | null {
    if (!this.config.enabled) return null;
    if (this.config.taskTypes && !this.config.taskTypes.includes(taskType)) {
      return null;
    }

    const hash = this.calculateHash(content);
    const key = this.generateKey(hash, taskType, model, temperature);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update hit count
    entry.hitCount++;
    this.stats.hits++;

    return entry;
  }

  /**
   * Store result in cache
   */
  set(
    content: string,
    taskType: string,
    result: {
      content: string;
      model: string;
      tokens: {
        input: number;
        output: number;
      };
    },
    model?: string,
    temperature?: number
  ): void {
    if (!this.config.enabled) return;
    if (this.config.taskTypes && !this.config.taskTypes.includes(taskType)) {
      return;
    }

    // Check cache size
    if (this.cache.size >= this.config.maxSize!) {
      this.evictOldest();
    }

    const hash = this.calculateHash(content);
    const key = this.generateKey(hash, taskType, model, temperature);

    const now = Date.now();
    const entry: CacheEntry = {
      key,
      contentHash: hash,
      taskType,
      result,
      createdAt: now,
      expiresAt: now + this.config.ttlMs!,
      hitCount: 0,
      savedTokens: 0,
    };

    this.cache.set(key, entry);
  }

  /**
   * Mark tokens as saved (from cache hit)
   */
  recordHit(inputTokens: number, model: string): void {
    const cost = (inputTokens / 1_000_000) * (this.modelCosts[model] || 5.0);
    this.stats.tokensSaved += inputTokens;
    this.stats.costSaved += cost;
  }

  /**
   * Evict oldest entry (LRU)
   */
  private evictOldest(): void {
    let oldest: [string, CacheEntry] | null = null;

    for (const entry of Array.from(this.cache.entries())) {
      if (!oldest || entry[1].createdAt < oldest[1].createdAt) {
        oldest = entry;
      }
    }

    if (oldest) {
      this.cache.delete(oldest[0]);
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    let oldestEntry = Date.now();
    let newestEntry = 0;

    for (const entry of Array.from(this.cache.values())) {
      oldestEntry = Math.min(oldestEntry, entry.createdAt);
      newestEntry = Math.max(newestEntry, entry.createdAt);
    }

    return {
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      hitRate,
      tokensSaved: this.stats.tokensSaved,
      costSaved: this.stats.costSaved,
      entriesStored: this.cache.size,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Export cache for persistence
   */
  export(): Array<{
    key: string;
    entry: CacheEntry;
  }> {
    const exported = [];
    for (const [key, entry] of Array.from(this.cache)) {
      exported.push({ key, entry });
    }
    return exported;
  }

  /**
   * Import cached entries
   */
  import(entries: Array<{ key: string; entry: CacheEntry }>): void {
    for (const { key, entry } of entries) {
      // Skip expired entries
      if (Date.now() <= entry.expiresAt) {
        this.cache.set(key, entry);
      }
    }
  }

  /**
   * Get entries matching task type
   */
  getEntriesByTask(taskType: string): CacheEntry[] {
    const entries = [];
    for (const entry of Array.from(this.cache.values())) {
      if (entry.taskType === taskType) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /**
   * Get top hit entries (for analysis)
   */
  getTopHits(limit: number = 10): CacheEntry[] {
    const entries = Array.from(this.cache.values());
    entries.sort((a, b) => b.hitCount - a.hitCount);
    return entries.slice(0, limit);
  }
}

/**
 * Create cache instance
 */
export function createAnalysisCache(config?: CacheConfig): AnalysisCache {
  return new AnalysisCache(config);
}

/**
 * Global cache instance (for singleton pattern)
 */
let globalCache: AnalysisCache | null = null;

/**
 * Get or create global cache
 */
export function getGlobalCache(config?: CacheConfig): AnalysisCache {
  if (!globalCache) {
    globalCache = new AnalysisCache(config);
  }
  return globalCache;
}
