/**
 * Service Configuration
 * 
 * Centralized configuration for all DealDecision AI services
 * - MCP Client (external research tools)
 * - Evidence Service (document processing + Tavily)
 * - LLM Service (OpenAI/Bedrock/SageMaker)
 * 
 * Supports:
 * - Environment variable loading
 * - Configuration validation
 * - Secure credential handling
 * - Feature flags
 */

import { z } from "zod";
import {
  MCPClientConfig,
  MCPClientConfigSchema,
  createDefaultMCPConfig,
} from "../services/mcp/client";
import {
  EvidenceOptions,
  EvidenceOptionsSchema,
  createDefaultEvidenceOptions,
} from "../services/evidence/service";
import {
  LLMProvider,
  LLMProviderSchema,
  createDefaultTokenBudget,
} from "../services/llm/service";

// ============================================================================
// Schemas
// ============================================================================

/**
 * LLM Service Configuration
 */
export const LLMServiceConfigSchema = z.object({
  provider: LLMProviderSchema,
  token_budget: z.number().positive().default(500),
  
  // OpenAI
  openai_api_key: z.string().optional(),
  openai_model: z.string().default("gpt-4o-mini"),
  
  // AWS Bedrock (Qwen 14B)
  bedrock_region: z.string().optional(),
  bedrock_access_key: z.string().optional(),
  bedrock_secret_key: z.string().optional(),
  bedrock_model: z.string().default("qwen.qwen-14b-chat-v1"),
  
  // AWS SageMaker (Llama 70B)
  sagemaker_endpoint: z.string().optional(),
  sagemaker_region: z.string().optional(),
  sagemaker_access_key: z.string().optional(),
  sagemaker_secret_key: z.string().optional(),
  
  // General
  timeout_ms: z.number().positive().default(30000),
  max_retries: z.number().min(0).max(5).default(3),
});

export type LLMServiceConfig = z.infer<typeof LLMServiceConfigSchema>;

/**
 * Evidence Service Configuration
 */
export const EvidenceServiceConfigSchema = z.object({
  database_url: z.string().url(),
  
  // Tavily
  tavily_enabled: z.boolean().default(false),
  tavily_api_key: z.string().optional(),
  
  // Document processing
  max_chunks_per_doc: z.number().positive().default(50),
  min_chunk_length: z.number().positive().default(100),
  max_tavily_results: z.number().positive().default(10),
  
  // Embeddings
  include_embeddings: z.boolean().default(true),
  embedding_model: z.string().default("text-embedding-3-small"),
  embedding_dimension: z.number().default(384),
  
  // Quality
  confidence_threshold: z.number().min(0).max(1).default(0.5),
});

export type EvidenceServiceConfig = z.infer<typeof EvidenceServiceConfigSchema>;

/**
 * Complete DealDecision AI Configuration
 */
export const ServiceConfigSchema = z.object({
  mcp: MCPClientConfigSchema,
  evidence: EvidenceServiceConfigSchema,
  llm: LLMServiceConfigSchema,
  
  // Global settings
  environment: z.enum(["development", "staging", "production"]).default("development"),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  enable_caching: z.boolean().default(true),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Load configuration from environment variables
 * 
 * Environment variables:
 * 
 * MCP:
 * - MCP_ENABLED: Enable MCP integration (default: false)
 * - MCP_TIMEOUT_MS: MCP call timeout (default: 30000)
 * - MCP_MAX_RETRIES: Max retry attempts (default: 3)
 * - GARTNER_ENDPOINT: Gartner API endpoint
 * - GARTNER_API_KEY: Gartner API key
 * - PITCHBOOK_ENDPOINT: PitchBook API endpoint
 * - PITCHBOOK_API_KEY: PitchBook API key
 * - CRUNCHBASE_ENDPOINT: Crunchbase API endpoint
 * - CRUNCHBASE_API_KEY: Crunchbase API key
 * 
 * Evidence:
 * - DATABASE_URL: PostgreSQL connection string (required)
 * - TAVILY_ENABLED: Enable Tavily integration (default: false)
 * - TAVILY_API_KEY: Tavily API key
 * - MAX_CHUNKS_PER_DOC: Max chunks per document (default: 50)
 * - INCLUDE_EMBEDDINGS: Generate embeddings (default: true)
 * 
 * LLM:
 * - LLM_PROVIDER: Provider (openai/bedrock/sagemaker) (default: openai)
 * - LLM_TOKEN_BUDGET: Token budget per deal (default: 500)
 * - OPENAI_API_KEY: OpenAI API key
 * - AWS_REGION: AWS region for Bedrock/SageMaker
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * - SAGEMAKER_ENDPOINT: SageMaker endpoint URL
 * 
 * Global:
 * - NODE_ENV: Environment (development/staging/production)
 * - LOG_LEVEL: Logging level (debug/info/warn/error)
 * - ENABLE_CACHING: Enable response caching (default: true)
 */
export function loadConfigFromEnv(): ServiceConfig {
  const env = process.env;

  return ServiceConfigSchema.parse({
    // MCP Configuration
    mcp: {
      enabled: env.MCP_ENABLED === "true",
      timeout_ms: parseInt(env.MCP_TIMEOUT_MS || "30000"),
      max_retries: parseInt(env.MCP_MAX_RETRIES || "3"),
      providers: {
        gartner: {
          enabled: !!env.GARTNER_ENDPOINT,
          endpoint: env.GARTNER_ENDPOINT,
          api_key: env.GARTNER_API_KEY,
          rate_limit_per_min: parseInt(env.GARTNER_RATE_LIMIT || "60"),
        },
        pitchbook: {
          enabled: !!env.PITCHBOOK_ENDPOINT,
          endpoint: env.PITCHBOOK_ENDPOINT,
          api_key: env.PITCHBOOK_API_KEY,
          rate_limit_per_min: parseInt(env.PITCHBOOK_RATE_LIMIT || "100"),
        },
        crunchbase: {
          enabled: !!env.CRUNCHBASE_ENDPOINT,
          endpoint: env.CRUNCHBASE_ENDPOINT,
          api_key: env.CRUNCHBASE_API_KEY,
          rate_limit_per_min: parseInt(env.CRUNCHBASE_RATE_LIMIT || "200"),
        },
      },
    },

    // Evidence Configuration
    evidence: {
      database_url: env.DATABASE_URL || "postgresql://localhost:5432/dealdecision",
      tavily_enabled: env.TAVILY_ENABLED === "true",
      tavily_api_key: env.TAVILY_API_KEY,
      max_chunks_per_doc: parseInt(env.MAX_CHUNKS_PER_DOC || "50"),
      min_chunk_length: parseInt(env.MIN_CHUNK_LENGTH || "100"),
      max_tavily_results: parseInt(env.MAX_TAVILY_RESULTS || "10"),
      include_embeddings: env.INCLUDE_EMBEDDINGS !== "false",
      embedding_model: env.EMBEDDING_MODEL || "text-embedding-3-small",
      embedding_dimension: parseInt(env.EMBEDDING_DIMENSION || "384"),
      confidence_threshold: parseFloat(env.CONFIDENCE_THRESHOLD || "0.5"),
    },

    // LLM Configuration
    llm: {
      provider: (env.LLM_PROVIDER as LLMProvider) || "openai",
      token_budget: parseInt(env.LLM_TOKEN_BUDGET || "500"),
      openai_api_key: env.OPENAI_API_KEY,
      openai_model: env.OPENAI_MODEL || "gpt-4o-mini",
      bedrock_region: env.AWS_REGION,
      bedrock_access_key: env.AWS_ACCESS_KEY_ID,
      bedrock_secret_key: env.AWS_SECRET_ACCESS_KEY,
      bedrock_model: env.BEDROCK_MODEL || "qwen.qwen-14b-chat-v1",
      sagemaker_endpoint: env.SAGEMAKER_ENDPOINT,
      sagemaker_region: env.AWS_REGION,
      sagemaker_access_key: env.AWS_ACCESS_KEY_ID,
      sagemaker_secret_key: env.AWS_SECRET_ACCESS_KEY,
      timeout_ms: parseInt(env.LLM_TIMEOUT_MS || "30000"),
      max_retries: parseInt(env.LLM_MAX_RETRIES || "3"),
    },

    // Global Configuration
    environment: (env.NODE_ENV as "development" | "staging" | "production") || "development",
    log_level: (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
    enable_caching: env.ENABLE_CACHING !== "false",
  });
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Create default development configuration
 */
export function createDefaultDevConfig(): ServiceConfig {
  return {
    mcp: createDefaultMCPConfig(),
    evidence: {
      database_url: "postgresql://localhost:5432/dealdecision",
      tavily_enabled: false,
      max_chunks_per_doc: 50,
      min_chunk_length: 100,
      max_tavily_results: 10,
      include_embeddings: true,
      embedding_model: "text-embedding-3-small",
      embedding_dimension: 384,
      confidence_threshold: 0.5,
    },
    llm: {
      provider: "openai",
      token_budget: 500,
      openai_model: "gpt-4o-mini",
      bedrock_model: "qwen.qwen-14b-chat-v1",
      timeout_ms: 30000,
      max_retries: 3,
    },
    environment: "development",
    log_level: "debug",
    enable_caching: true,
  };
}

/**
 * Create default production configuration
 */
export function createDefaultProdConfig(): ServiceConfig {
  return {
    ...createDefaultDevConfig(),
    environment: "production",
    log_level: "info",
    llm: {
      ...createDefaultDevConfig().llm,
      provider: "bedrock",  // Use cheaper Bedrock in production
    },
  };
}

/**
 * Create test configuration (mocks enabled, no external calls)
 */
export function createTestConfig(): ServiceConfig {
  return {
    ...createDefaultDevConfig(),
    environment: "development",
    log_level: "error",  // Quiet during tests
    enable_caching: false,  // Disable caching for deterministic tests
    llm: {
      ...createDefaultDevConfig().llm,
      // Provide a dummy key so validation passes without requiring env vars.
      openai_api_key: "test",
    },
    mcp: {
      ...createDefaultMCPConfig(),
      enabled: false,  // Use mocks
    },
    evidence: {
      ...createDefaultDevConfig().evidence,
      tavily_enabled: false,  // Use mocks
    },
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate service configuration
 * 
 * Checks:
 * - Required credentials are present
 * - Provider-specific config is complete
 * - Feature flags are consistent
 * 
 * @throws Error if configuration is invalid
 */
export function validateServiceConfig(config: ServiceConfig): void {
  // Validate LLM provider config
  if (config.llm.provider === "openai" && !config.llm.openai_api_key) {
    throw new Error("LLM provider is 'openai' but OPENAI_API_KEY is not set");
  }

  if (config.llm.provider === "bedrock") {
    if (!config.llm.bedrock_region || !config.llm.bedrock_access_key || !config.llm.bedrock_secret_key) {
      throw new Error("LLM provider is 'bedrock' but AWS credentials are incomplete");
    }
  }

  if (config.llm.provider === "sagemaker") {
    if (!config.llm.sagemaker_endpoint || !config.llm.sagemaker_region) {
      throw new Error("LLM provider is 'sagemaker' but endpoint/region not set");
    }
  }

  // Validate Evidence Tavily config
  if (config.evidence.tavily_enabled && !config.evidence.tavily_api_key) {
    throw new Error("Tavily is enabled but TAVILY_API_KEY is not set");
  }

  // Validate MCP provider configs
  if (config.mcp.enabled) {
    for (const [provider, provider_config] of Object.entries(config.mcp.providers)) {
      if (provider_config.enabled) {
        if (!provider_config.endpoint) {
          throw new Error(`MCP provider '${provider}' is enabled but endpoint is not set`);
        }
      }
    }
  }

  // Validate database URL
  if (!config.evidence.database_url) {
    throw new Error("DATABASE_URL is required");
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get service configuration with validation
 * 
 * Loads from environment and validates
 */
export function getServiceConfig(): ServiceConfig {
  const config = loadConfigFromEnv();
  validateServiceConfig(config);
  return config;
}

/**
 * Check if running in production
 */
export function isProduction(config: ServiceConfig): boolean {
  return config.environment === "production";
}

/**
 * Check if running in development
 */
export function isDevelopment(config: ServiceConfig): boolean {
  return config.environment === "development";
}

/**
 * Mask sensitive configuration values for logging
 */
export function maskSensitiveConfig(config: ServiceConfig): Partial<ServiceConfig> {
  return {
    ...config,
    mcp: {
      ...config.mcp,
      providers: Object.fromEntries(
        Object.entries(config.mcp.providers).map(([name, cfg]) => [
          name,
          {
            ...cfg,
            api_key: cfg.api_key ? "***MASKED***" : undefined,
          },
        ])
      ),
    },
    evidence: {
      ...config.evidence,
      database_url: config.evidence.database_url.replace(/:[^@]+@/, ":***@"),
      tavily_api_key: config.evidence.tavily_api_key ? "***MASKED***" : undefined,
    },
    llm: {
      ...config.llm,
      openai_api_key: config.llm.openai_api_key ? "***MASKED***" : undefined,
      bedrock_access_key: config.llm.bedrock_access_key ? "***MASKED***" : undefined,
      bedrock_secret_key: config.llm.bedrock_secret_key ? "***MASKED***" : undefined,
      sagemaker_access_key: config.llm.sagemaker_access_key ? "***MASKED***" : undefined,
      sagemaker_secret_key: config.llm.sagemaker_secret_key ? "***MASKED***" : undefined,
    },
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isServiceConfig(value: unknown): value is ServiceConfig {
  return ServiceConfigSchema.safeParse(value).success;
}

export function isLLMServiceConfig(value: unknown): value is LLMServiceConfig {
  return LLMServiceConfigSchema.safeParse(value).success;
}

export function isEvidenceServiceConfig(value: unknown): value is EvidenceServiceConfig {
  return EvidenceServiceConfigSchema.safeParse(value).success;
}
