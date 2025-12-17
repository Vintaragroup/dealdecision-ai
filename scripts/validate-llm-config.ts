#!/usr/bin/env tsx

/**
 * LLM Configuration Validator
 * 
 * Validates that all required LLM environment variables are set
 * and that the OpenAI API key is functional
 * 
 * Usage: pnpm validate:llm
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables
const rootEnvPath = path.resolve(__dirname, "../../.env");
const localEnvPath = path.resolve(__dirname, "../../.env.local");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: {
    llmEnabled: boolean;
    apiKeyConfigured: boolean;
    cacheEnabled: boolean;
    compressionEnabled: boolean;
    analyticsEnabled: boolean;
  };
}

/**
 * Validate LLM configuration
 */
async function validateLLMConfig(): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required variables
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const llmEnabled = process.env.LLM_ENABLED !== "false";

  if (!llmEnabled) {
    warnings.push("LLM processing is disabled (LLM_ENABLED=false)");
  }

  if (!openaiApiKey) {
    errors.push("Missing OPENAI_API_KEY environment variable");
  } else if (openaiApiKey.length < 10) {
    errors.push("OPENAI_API_KEY is too short (expected format: sk-...)");
  } else if (!openaiApiKey.startsWith("sk-")) {
    warnings.push("OPENAI_API_KEY does not start with 'sk-' (may be invalid)");
  }

  // Optional but important variables
  const cacheEnabled = process.env.LLM_CACHE_ENABLED !== "false";
  const compressionEnabled = process.env.LLM_COMPRESSION_ENABLED !== "false";
  const analyticsEnabled = process.env.LLM_ANALYTICS_ENABLED !== "false";

  if (!cacheEnabled) {
    warnings.push("LLM caching is disabled (LLM_CACHE_ENABLED=false)");
  }

  if (!compressionEnabled) {
    warnings.push("LLM compression is disabled (LLM_COMPRESSION_ENABLED=false)");
  }

  if (!analyticsEnabled) {
    warnings.push("LLM analytics is disabled (LLM_ANALYTICS_ENABLED=false)");
  }

  // Check cache configuration
  const cacheTtlDays = parseInt(process.env.LLM_CACHE_TTL_DAYS || "7");
  if (cacheTtlDays < 1 || cacheTtlDays > 90) {
    warnings.push(
      `Cache TTL is ${cacheTtlDays} days (recommended: 1-30 days)`
    );
  }

  const cacheMaxSize = parseInt(process.env.LLM_CACHE_MAX_SIZE || "10000");
  if (cacheMaxSize < 100) {
    warnings.push(
      `Cache max size is ${cacheMaxSize} entries (recommended: 1000+)`
    );
  }

  // Check routing configuration
  const routingStrategy = process.env.LLM_ROUTING_STRATEGY || "cost-aware";
  const validStrategies = ["cost-aware", "performance", "balanced"];
  if (!validStrategies.includes(routingStrategy)) {
    warnings.push(
      `Unknown routing strategy: ${routingStrategy} (valid: ${validStrategies.join(", ")})`
    );
  }

  // Test API key if provided
  if (openaiApiKey && openaiApiKey.startsWith("sk-")) {
    try {
      const testResult = await testOpenAIConnection(openaiApiKey);
      if (!testResult.success) {
        errors.push(`OpenAI API test failed: ${testResult.error}`);
      } else {
        console.log("✓ OpenAI API connection successful");
      }
    } catch (err) {
      errors.push(
        `Failed to test OpenAI API: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config: {
      llmEnabled,
      apiKeyConfigured: !!openaiApiKey,
      cacheEnabled,
      compressionEnabled,
      analyticsEnabled,
    },
  };
}

/**
 * Test OpenAI API connection
 */
async function testOpenAIConnection(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: `API returned ${response.status}: ${errorData.error?.message || "Unknown error"}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Print validation results
 */
function printResults(result: ValidationResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("LLM Configuration Validation Report");
  console.log("=".repeat(60) + "\n");

  // Configuration status
  console.log("Configuration Status:");
  console.log(`  LLM Enabled:        ${result.config.llmEnabled ? "✓" : "✗"}`);
  console.log(
    `  API Key Configured: ${result.config.apiKeyConfigured ? "✓" : "✗"}`
  );
  console.log(`  Cache Enabled:      ${result.config.cacheEnabled ? "✓" : "✗"}`);
  console.log(
    `  Compression Enabled: ${result.config.compressionEnabled ? "✓" : "✗"}`
  );
  console.log(
    `  Analytics Enabled:  ${result.config.analyticsEnabled ? "✓" : "✗"}`
  );

  console.log("\n");

  // Errors
  if (result.errors.length > 0) {
    console.log("❌ ERRORS:");
    result.errors.forEach((err) => {
      console.log(`  - ${err}`);
    });
    console.log("");
  }

  // Warnings
  if (result.warnings.length > 0) {
    console.log("⚠️  WARNINGS:");
    result.warnings.forEach((warn) => {
      console.log(`  - ${warn}`);
    });
    console.log("");
  }

  // Overall result
  console.log(
    result.valid
      ? "✅ Validation PASSED - Ready for deployment"
      : "❌ Validation FAILED - Fix errors before deployment"
  );

  console.log("=".repeat(60) + "\n");
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const result = await validateLLMConfig();
    printResults(result);
    process.exit(result.valid ? 0 : 1);
  } catch (err) {
    console.error("Validation script error:", err);
    process.exit(1);
  }
}

main();
