/**
 * Model Context Protocol (MCP) Client Interface
 * 
 * Provider-agnostic interface for calling external tools (Gartner, PitchBook, etc.)
 * Designed to be pluggable - no vendor lock-in
 * 
 * Based on: DIO Schema v1.0.0, Interface Contracts
 * Reference: docs/19_DIO_Schema_and_Interface_Contracts.md
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * MCP tool metadata
 */
export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.any()),  // JSON schema for tool inputs
  provider: z.string(),              // "gartner", "pitchbook", "crunchbase", etc.
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

/**
 * MCP response wrapper
 * Always includes source attribution and confidence
 */
export const MCPResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().nullable(),          // Tool-specific response data
  source: z.string(),                // Provider name + tool name
  confidence: z.number().min(0).max(1), // How reliable is this data (0.0 - 1.0)
  evidence_metadata: z.object({
    tool_name: z.string(),
    called_at: z.string(),           // ISO timestamp
    duration_ms: z.number(),
    version: z.string().optional(),  // Tool version if available
  }),
  error: z.string().optional(),      // Error message if success=false
  warnings: z.array(z.string()).optional(), // Non-fatal warnings
});

export type MCPResponse<T = any> = {
  success: boolean;
  data: T | null;
  source: string;
  confidence: number;
  evidence_metadata: {
    tool_name: string;
    called_at: string;
    duration_ms: number;
    version?: string;
  };
  error?: string;
  warnings?: string[];
};

/**
 * MCP client configuration
 */
export const MCPClientConfigSchema = z.object({
  enabled: z.boolean(),
  timeout_ms: z.number().positive().default(30000), // 30 sec default
  max_retries: z.number().min(0).max(5).default(3),
  providers: z.record(z.object({
    enabled: z.boolean(),
    endpoint: z.string().url().optional(),
    api_key: z.string().optional(),
    rate_limit_per_min: z.number().optional(),
  })),
});

export type MCPClientConfig = z.infer<typeof MCPClientConfigSchema>;

// ============================================================================
// Errors
// ============================================================================

export class MCPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly tool?: string
  ) {
    super(message);
    this.name = "MCPError";
  }
}

export class MCPTimeoutError extends MCPError {
  constructor(provider: string, tool: string, timeout_ms: number) {
    super(
      `MCP call to ${provider}/${tool} timed out after ${timeout_ms}ms`,
      "TIMEOUT",
      provider,
      tool
    );
    this.name = "MCPTimeoutError";
  }
}

export class MCPProviderUnavailableError extends MCPError {
  constructor(provider: string) {
    super(
      `MCP provider '${provider}' is not available or disabled`,
      "PROVIDER_UNAVAILABLE",
      provider
    );
    this.name = "MCPProviderUnavailableError";
  }
}

export class MCPToolNotFoundError extends MCPError {
  constructor(provider: string, tool: string) {
    super(
      `MCP tool '${tool}' not found in provider '${provider}'`,
      "TOOL_NOT_FOUND",
      provider,
      tool
    );
    this.name = "MCPToolNotFoundError";
  }
}

// ============================================================================
// Core Interface
// ============================================================================

/**
 * MCP Client Interface
 * 
 * IMPORTANT: Implementations MUST be provider-agnostic
 * - Do NOT hardcode Gartner/PitchBook assumptions
 * - Always include source attribution in responses
 * - Return confidence scores for all data
 * - Handle rate limits gracefully
 * 
 * Example usage:
 * ```typescript
 * const client = new MCPClientImpl(config);
 * 
 * // Call market research tool
 * const market_data = await client.call<MarketData>("gartner", "research_market_size", {
 *   industry: "AI/ML",
 *   year: 2024
 * });
 * 
 * if (market_data.success) {
 *   console.log(market_data.data.market_size); // e.g., "$50B"
 *   console.log(market_data.confidence);       // e.g., 0.85
 *   console.log(market_data.source);           // "gartner/research_market_size"
 * }
 * ```
 */
export interface MCPClient {
  /**
   * Call an MCP tool
   * 
   * @param provider - Provider name (e.g., "gartner", "pitchbook")
   * @param tool - Tool name (e.g., "research_market_size")
   * @param params - Tool-specific parameters
   * @returns Promise resolving to typed response
   * @throws MCPError if provider/tool unavailable or call fails
   */
  call<T = any>(
    provider: string,
    tool: string,
    params: Record<string, any>
  ): Promise<MCPResponse<T>>;

  /**
   * List all available tools
   * 
   * @param provider - Optional provider filter
   * @returns Promise resolving to list of available tools
   */
  listTools(provider?: string): Promise<MCPTool[]>;

  /**
   * Check if provider is available
   * 
   * @param provider - Provider name
   * @returns Promise resolving to true if provider responds to ping
   */
  ping(provider: string): Promise<boolean>;

  /**
   * Get configuration
   */
  getConfig(): MCPClientConfig;
}

// ============================================================================
// Production Implementation
// ============================================================================

/**
 * Rate limiter for MCP calls
 */
class RateLimiter {
  private calls: Map<string, number[]> = new Map();

  /**
   * Check if call is allowed under rate limit
   * @param provider Provider name
   * @param limit_per_min Calls allowed per minute
   * @returns true if allowed, false if rate limited
   */
  isAllowed(provider: string, limit_per_min: number): boolean {
    const now = Date.now();
    const one_minute_ago = now - 60000;
    
    const provider_calls = this.calls.get(provider) || [];
    const recent_calls = provider_calls.filter(t => t > one_minute_ago);
    
    this.calls.set(provider, recent_calls);
    
    return recent_calls.length < limit_per_min;
  }

  /**
   * Record a successful call
   */
  recordCall(provider: string): void {
    const calls = this.calls.get(provider) || [];
    calls.push(Date.now());
    this.calls.set(provider, calls);
  }
}

/**
 * Production MCP client implementation
 * 
 * Features:
 * - HTTP client for external MCP providers
 * - Rate limiting per provider
 * - Automatic retry with exponential backoff
 * - Timeout enforcement
 * - Source attribution
 */
export class MCPClientImpl implements MCPClient {
  private rateLimiter: RateLimiter;
  private cache: Map<string, MCPResponse> = new Map();

  constructor(private config: MCPClientConfig) {
    this.rateLimiter = new RateLimiter();
  }

  async call<T = any>(
    provider: string,
    tool: string,
    params: Record<string, any>
  ): Promise<MCPResponse<T>> {
    const start_time = Date.now();

    // Validate provider
    const provider_config = this.config.providers[provider];
    if (!provider_config || !provider_config.enabled) {
      throw new MCPProviderUnavailableError(provider);
    }

    // Check rate limit
    const rate_limit = provider_config.rate_limit_per_min || 60;
    if (!this.rateLimiter.isAllowed(provider, rate_limit)) {
      return createMCPResponse<T>(
        false,
        null,
        `${provider}/${tool}`,
        0,
        tool,
        Date.now() - start_time,
        `Rate limit exceeded: ${rate_limit} calls/min`,
        ["Consider increasing rate_limit_per_min or implementing request queuing"]
      );
    }

    // Build cache key (for idempotency)
    const cache_key = `${provider}/${tool}/${JSON.stringify(params)}`;
    const cached = this.cache.get(cache_key);
    if (cached) {
      return {
        ...cached,
        evidence_metadata: {
          ...cached.evidence_metadata,
          duration_ms: Date.now() - start_time,
        },
        warnings: [...(cached.warnings || []), "Returned from cache"],
      } as MCPResponse<T>;
    }

    // Execute with retry logic
    let last_error: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.max_retries; attempt++) {
      try {
        const response = await this.executeCall<T>(
          provider,
          tool,
          params,
          provider_config,
          start_time
        );

        // Record successful call
        this.rateLimiter.recordCall(provider);
        
        // Cache successful response
        if (response.success) {
          this.cache.set(cache_key, response);
        }

        return response;
      } catch (error) {
        last_error = error as Error;
        
        // Don't retry on specific errors
        if (error instanceof MCPProviderUnavailableError ||
            error instanceof MCPToolNotFoundError) {
          throw error;
        }

        // Exponential backoff before retry
        if (attempt < this.config.max_retries) {
          const backoff_ms = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, backoff_ms));
        }
      }
    }

    // All retries failed
    throw new MCPError(
      `Failed after ${this.config.max_retries} retries: ${last_error?.message}`,
      "MAX_RETRIES_EXCEEDED",
      provider,
      tool
    );
  }

  /**
   * Execute single MCP call (internal)
   */
  private async executeCall<T>(
    provider: string,
    tool: string,
    params: Record<string, any>,
    provider_config: { endpoint?: string; api_key?: string },
    start_time: number
  ): Promise<MCPResponse<T>> {
    const endpoint = provider_config.endpoint;
    
    if (!endpoint) {
      throw new MCPError(
        `No endpoint configured for provider '${provider}'`,
        "NO_ENDPOINT",
        provider
      );
    }

    // Build request
    const url = `${endpoint}/tools/${tool}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (provider_config.api_key) {
      headers["Authorization"] = `Bearer ${provider_config.api_key}`;
    }

    // Make HTTP request with timeout
    const controller = new AbortController();
    const timeout_id = setTimeout(
      () => controller.abort(),
      this.config.timeout_ms
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        if (response.status === 404) {
          throw new MCPToolNotFoundError(provider, tool);
        }
        throw new MCPError(
          `HTTP ${response.status}: ${response.statusText}`,
          "HTTP_ERROR",
          provider,
          tool
        );
      }

      const data = await response.json() as any;
      const duration_ms = Date.now() - start_time;

      // Map provider response to MCPResponse format
      return createMCPResponse<T>(
        true,
        data.data || data,
        `${provider}/${tool}`,
        data.confidence || 0.8,  // Default confidence if not provided
        tool,
        duration_ms,
        undefined,
        data.warnings
      );
    } catch (error) {
      clearTimeout(timeout_id);

      if ((error as Error).name === "AbortError") {
        throw new MCPTimeoutError(provider, tool, this.config.timeout_ms);
      }

      throw error;
    }
  }

  async listTools(provider?: string): Promise<MCPTool[]> {
    if (provider) {
      const provider_config = this.config.providers[provider];
      if (!provider_config || !provider_config.enabled) {
        return [];
      }

      // Fetch tools from provider's /tools endpoint
      const endpoint = provider_config.endpoint;
      if (!endpoint) {
        return [];
      }

      try {
        const response = await fetch(`${endpoint}/tools`, {
          headers: provider_config.api_key
            ? { Authorization: `Bearer ${provider_config.api_key}` }
            : {},
        });

        if (!response.ok) {
          return [];
        }

        const data = await response.json() as any;
        return (data.tools || []).map((t: any) => ({
          ...t,
          provider,
        }));
      } catch {
        return [];
      }
    }

    // List tools from all enabled providers
    const all_tools: MCPTool[] = [];
    
    for (const provider_name of Object.keys(this.config.providers)) {
      const tools = await this.listTools(provider_name);
      all_tools.push(...tools);
    }

    return all_tools;
  }

  async ping(provider: string): Promise<boolean> {
    const provider_config = this.config.providers[provider];
    
    if (!provider_config || !provider_config.enabled) {
      return false;
    }

    const endpoint = provider_config.endpoint;
    if (!endpoint) {
      return false;
    }

    const controller = new AbortController();
    const timeout_id = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${endpoint}/health`, {
        signal: controller.signal,
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout_id);
    }
  }

  getConfig(): MCPClientConfig {
    return this.config;
  }

  /**
   * Clear response cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Mock Implementation (for testing without real MCP)
// ============================================================================

/**
 * Mock MCP client that returns predefined responses
 * Use this for deterministic testing
 */
export class MockMCPClient implements MCPClient {
  private tools: Map<string, MCPTool> = new Map();
  private responses: Map<string, any> = new Map();

  constructor(private config: MCPClientConfig) {}

  /**
   * Register a mock tool
   */
  registerTool(provider: string, tool: MCPTool): void {
    this.tools.set(`${provider}/${tool.name}`, tool);
  }

  /**
   * Register a mock response
   */
  registerResponse<T>(provider: string, tool: string, data: T, confidence = 1.0): void {
    this.responses.set(`${provider}/${tool}`, { data, confidence });
  }

  async call<T = any>(
    provider: string,
    tool: string,
    params: Record<string, any>
  ): Promise<MCPResponse<T>> {
    const key = `${provider}/${tool}`;
    const mock = this.responses.get(key);

    if (!mock) {
      return {
        success: false,
        data: null,
        source: key,
        confidence: 0,
        evidence_metadata: {
          tool_name: tool,
          called_at: new Date().toISOString(),
          duration_ms: 0,
        },
        error: `No mock response registered for ${key}`,
      };
    }

    return {
      success: true,
      data: mock.data as T,
      source: key,
      confidence: mock.confidence,
      evidence_metadata: {
        tool_name: tool,
        called_at: new Date().toISOString(),
        duration_ms: 10,
        version: "mock",
      },
    };
  }

  async listTools(provider?: string): Promise<MCPTool[]> {
    if (provider) {
      return Array.from(this.tools.entries())
        .filter(([key]) => key.startsWith(`${provider}/`))
        .map(([, tool]) => tool);
    }
    return Array.from(this.tools.values());
  }

  async ping(provider: string): Promise<boolean> {
    return this.config.providers[provider]?.enabled ?? false;
  }

  getConfig(): MCPClientConfig {
    return this.config;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create default MCP client config
 */
export function createDefaultMCPConfig(): MCPClientConfig {
  return {
    enabled: false,  // Disabled by default (feature flag)
    timeout_ms: 30000,
    max_retries: 3,
    providers: {
      gartner: {
        enabled: false,
        rate_limit_per_min: 60,
      },
      pitchbook: {
        enabled: false,
        rate_limit_per_min: 100,
      },
      crunchbase: {
        enabled: false,
        rate_limit_per_min: 200,
      },
    },
  };
}

/**
 * Validate MCP response structure
 */
export function validateMCPResponse<T>(response: unknown): MCPResponse<T> {
  return MCPResponseSchema.parse(response) as MCPResponse<T>;
}

/**
 * Create MCP response object
 */
export function createMCPResponse<T>(
  success: boolean,
  data: T | null,
  source: string,
  confidence: number,
  tool_name: string,
  duration_ms: number,
  error?: string,
  warnings?: string[]
): MCPResponse<T> {
  return {
    success,
    data,
    source,
    confidence,
    evidence_metadata: {
      tool_name,
      called_at: new Date().toISOString(),
      duration_ms,
    },
    error,
    warnings,
  };
}

// ============================================================================
// Example Tool Definitions (for reference)
// ============================================================================

/**
 * Example MCP tools (what you might find from providers)
 * 
 * NOTE: These are EXAMPLES - actual tools depend on provider integrations
 */

export const EXAMPLE_MCP_TOOLS: MCPTool[] = [
  {
    name: "research_market_size",
    description: "Get market size estimates for an industry",
    input_schema: {
      type: "object",
      properties: {
        industry: { type: "string" },
        year: { type: "number" },
        geography: { type: "string", default: "global" },
      },
      required: ["industry", "year"],
    },
    provider: "gartner",
  },
  {
    name: "get_company_financials",
    description: "Get financial metrics for a company",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        metrics: { type: "array", items: { type: "string" } },
      },
      required: ["company_name"],
    },
    provider: "pitchbook",
  },
  {
    name: "find_competitors",
    description: "Find similar companies in same industry",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        industry: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["company_name"],
    },
    provider: "crunchbase",
  },
];

// ============================================================================
// Type Guards
// ============================================================================

export function isMCPResponse(value: unknown): value is MCPResponse {
  return MCPResponseSchema.safeParse(value).success;
}

export function isMCPTool(value: unknown): value is MCPTool {
  return MCPToolSchema.safeParse(value).success;
}
