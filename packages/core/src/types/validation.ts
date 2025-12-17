/**
 * Validation and API Response Types for HRM-DD
 */

/**
 * API Response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: string;
}

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Individual validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Fact validation rules
 */
export const FACT_VALIDATION = {
  CLAIM_MAX_LENGTH: 200,
  CLAIM_MIN_LENGTH: 10,
  ALLOWED_SOURCES: ["deck.pdf", "uncertain"],
  CONFIDENCE_MIN: 0.0,
  CONFIDENCE_MAX: 1.0,
};

/**
 * Citation requirements
 */
export const CITATION_RULES = {
  REQUIRE_CITATION: true,
  REQUIRE_PAGE_REFERENCE: false,
  ALLOWED_SOURCE_TYPES: ["deck.pdf", "document", "url"],
  QUOTE_MAX_LENGTH: 500,
};

/**
 * Depth delta thresholds
 */
export const DEPTH_THRESHOLDS = {
  CYCLE_1_CONTINUE: 2.0, // If depth_delta >= 2.0, continue to Cycle 2
  CYCLE_2_CONTINUE: 2.0, // If depth_delta >= 2.0, continue to Cycle 3
  CYCLE_3_FINAL: 1.0, // Cycle 3 final synthesis
};

/**
 * Confidence thresholds for progression
 */
export const CONFIDENCE_THRESHOLDS = {
  READY_FOR_DECISION: 0.70,
  HIGH_CONFIDENCE: 0.80,
  MEDIUM_CONFIDENCE: 0.60,
  LOW_CONFIDENCE: 0.40,
};

/**
 * Calibration score ranges
 */
export const CALIBRATION_RANGES = {
  BRIER_EXCELLENT: 0.10, // Score < 0.10
  BRIER_GOOD: 0.20, // Score < 0.20
  BRIER_ACCEPTABLE: 0.30, // Score < 0.30
  PARAPHRASE_INVARIANCE_EXCELLENT: 0.90,
  PARAPHRASE_INVARIANCE_GOOD: 0.80,
  PARAPHRASE_INVARIANCE_ACCEPTABLE: 0.70,
};

/**
 * Risk severity mapping
 */
export const RISK_SEVERITY_SCORES = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10,
};

/**
 * Deal stage to analysis stage mapping
 */
export const STAGE_ANALYSIS_MAPPING: Record<string, string> = {
  intake: "not_started",
  under_review: "cycle_1_complete",
  in_diligence: "cycle_2_complete",
  ready_decision: "cycle_3_complete",
  pitched: "synthesis_complete",
};

/**
 * Analysis job result codes
 */
export enum AnalysisResultCode {
  SUCCESS = "ANALYSIS_SUCCESS",
  PARTIAL = "ANALYSIS_PARTIAL",
  TIMEOUT = "ANALYSIS_TIMEOUT",
  ERROR = "ANALYSIS_ERROR",
  INSUFFICIENT_DATA = "INSUFFICIENT_DATA",
  CITATION_VIOLATION = "CITATION_VIOLATION",
}

/**
 * LLM model configuration
 */
export interface LLMConfig {
  model: string; // "gpt-4", "claude-3-opus", etc.
  temperature: number; // 0.0-1.0, typically 0.3-0.7 for analysis
  max_tokens: number; // Per-request token limit
  timeout_seconds: number;
  retry_attempts: number;
}

/**
 * Default LLM configs per cycle
 */
export const DEFAULT_LLM_CONFIGS: Record<number, LLMConfig> = {
  1: {
    model: "gpt-4",
    temperature: 0.5,
    max_tokens: 4000,
    timeout_seconds: 60,
    retry_attempts: 2,
  },
  2: {
    model: "gpt-4",
    temperature: 0.4,
    max_tokens: 4500,
    timeout_seconds: 75,
    retry_attempts: 2,
  },
  3: {
    model: "gpt-4",
    temperature: 0.3,
    max_tokens: 5000,
    timeout_seconds: 90,
    retry_attempts: 2,
  },
};

/**
 * Prompt template variables
 */
export interface PromptVariables {
  deal_name: string;
  deck_excerpt: string;
  prior_hypotheses: string[];
  prior_uncertainties: string[];
  prior_facts: string[];
  cycle_number: number;
  cycle_focus: string;
}

/**
 * Stop reason codes
 */
export enum StopReason {
  DEPTH_SUFFICIENT = "depth_sufficient",
  MAX_CYCLES_REACHED = "max_cycles_reached",
  TIMEOUT = "timeout",
  USER_STOPPED = "user_stopped",
  ERROR_OCCURRED = "error_occurred",
  INCONSISTENCY_DETECTED = "inconsistency_detected",
}
