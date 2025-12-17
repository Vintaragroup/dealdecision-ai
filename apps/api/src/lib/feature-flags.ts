/**
 * Feature Flag System
 * 
 * Simple environment-based feature flags with optional percentage-based rollout
 * 
 * Usage:
 *   import { isFeatureEnabled, setFeaturePercentage } from './feature-flags'
 *   
 *   if (isFeatureEnabled('llm-analysis')) {
 *     // Use LLM
 *   }
 */

/**
 * Feature flag configuration
 */
interface FeatureFlagConfig {
  enabled: boolean;
  percentage?: number; // 0-100, for gradual rollout
  userId?: string; // For consistent user-based rollout
}

/**
 * Global feature flags - initialized from environment
 */
const featureFlags = new Map<string, FeatureFlagConfig>();

/**
 * Initialize feature flags from environment
 * 
 * Environment variables:
 *   LLM_ENABLED=true/false
 *   LLM_PERCENTAGE=0-100  (for gradual rollout)
 */
export function initializeFeatureFlags(): void {
  // LLM Analysis - main feature
  featureFlags.set("llm-analysis", {
    enabled: process.env.LLM_ENABLED !== "false",
    percentage: parseInt(process.env.LLM_PERCENTAGE || "100"),
  });

  // Compression
  featureFlags.set("llm-compression", {
    enabled: process.env.LLM_COMPRESSION_ENABLED !== "false",
  });

  // Caching
  featureFlags.set("llm-caching", {
    enabled: process.env.LLM_CACHE_ENABLED !== "false",
  });

  // Analytics
  featureFlags.set("llm-analytics", {
    enabled: process.env.LLM_ANALYTICS_ENABLED !== "false",
  });

  console.log(`Feature flags initialized: ${Array.from(featureFlags.keys()).join(", ")}`);
}

/**
 * Check if a feature is enabled
 * 
 * For percentage-based flags, uses user ID to provide consistent behavior
 */
export function isFeatureEnabled(
  featureName: string,
  userId?: string
): boolean {
  const flag = featureFlags.get(featureName);
  if (!flag || !flag.enabled) {
    return false;
  }

  // If percentage is not specified, it's either 100% or 0%
  if (flag.percentage === undefined || flag.percentage === 100) {
    return true;
  }

  if (flag.percentage === 0) {
    return false;
  }

  // Percentage-based rollout
  if (userId) {
    // Use hash of userId to get consistent bucket for this user
    const hash = getUserBucket(userId);
    return hash < flag.percentage;
  }

  // No userId provided, use random for now
  return Math.random() * 100 < flag.percentage;
}

/**
 * Get consistent percentage bucket for a user (0-100)
 */
function getUserBucket(userId: string): number {
  // Simple hash function for consistency
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 100;
}

/**
 * Update feature percentage for gradual rollout
 */
export function setFeaturePercentage(featureName: string, percentage: number): void {
  if (percentage < 0 || percentage > 100) {
    throw new Error("Percentage must be between 0 and 100");
  }

  const flag = featureFlags.get(featureName);
  if (flag) {
    flag.percentage = percentage;
    console.log(`Feature ${featureName} set to ${percentage}% rollout`);
  } else {
    throw new Error(`Feature flag ${featureName} not found`);
  }
}

/**
 * Get current percentage for a feature
 */
export function getFeaturePercentage(featureName: string): number {
  const flag = featureFlags.get(featureName);
  return flag?.percentage ?? 0;
}

/**
 * Enable/disable a feature flag
 */
export function setFeatureEnabled(featureName: string, enabled: boolean): void {
  const flag = featureFlags.get(featureName);
  if (flag) {
    flag.enabled = enabled;
    console.log(`Feature ${featureName} is now ${enabled ? "enabled" : "disabled"}`);
  } else {
    throw new Error(`Feature flag ${featureName} not found`);
  }
}

/**
 * Get all feature flags status (for debugging/admin)
 */
export function getFeatureFlagsStatus(): Record<string, { enabled: boolean; percentage: number }> {
  const status: Record<string, { enabled: boolean; percentage: number }> = {};
  for (const [name, flag] of Array.from(featureFlags)) {
    status[name] = {
      enabled: flag.enabled,
      percentage: flag.percentage ?? 100,
    };
  }
  return status;
}

// Initialize on module load
initializeFeatureFlags();
