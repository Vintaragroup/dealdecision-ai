/**
 * LLM Service Interface
 * 
 * Provider-agnostic LLM interface with token budget enforcement
 * Supports: OpenAI, AWS Bedrock (Qwen 14B), AWS SageMaker (Llama 70B)
 * 
 * CRITICAL: 500 token budget per deal - 99% cost reduction target
 * "Heuristics own decisions, LLM narrates results" - HRM-DD SOP
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 * Reference: docs/19_DIO_Schema_and_Interface_Contracts.md
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * LLM provider configuration
 */
export const LLMProviderSchema = z.enum([
  "openai",      // GPT-4o - $0.03/analysis
  "bedrock",     // Qwen 14B - $0.001/analysis
  "sagemaker",   // Llama 70B - $0.0005/analysis
]);

export type LLMProvider = z.infer<typeof LLMProviderSchema>;

/**
 * Token usage tracking
 */
export const TokenUsageSchema = z.object({
  input_tokens: z.number().min(0),
  output_tokens: z.number().min(0),
  total_tokens: z.number().min(0),
  estimated_cost: z.number().min(0).optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Token budget
 * DEFAULT: 500 tokens total per deal
 */
export const TokenBudgetSchema = z.object({
  total: z.number().positive().default(500),
  used: z.number().min(0).default(0),
  remaining: z.number().min(0).default(500),
  breakdown: z.object({
    query_generation: z.number().min(0).default(0),
    narrative_synthesis: z.number().min(0).default(0),
    edge_case: z.number().min(0).default(0),
  }).optional(),
});

export type TokenBudget = z.infer<typeof TokenBudgetSchema>;

/**
 * LLM request metadata
 */
export const LLMRequestMetadataSchema = z.object({
  purpose: z.enum(["query_generation", "narrative_synthesis", "edge_case"]),
  estimated_tokens: z.number().positive(),
  max_tokens: z.number().positive(),
  temperature: z.number().min(0).max(2).default(0.7),
  top_p: z.number().min(0).max(1).default(1),
});

export type LLMRequestMetadata = z.infer<typeof LLMRequestMetadataSchema>;

/**
 * LLM response wrapper
 */
export const LLMResponseSchema = z.object({
  success: z.boolean(),
  content: z.string(),
  usage: TokenUsageSchema,
  provider: LLMProviderSchema,
  model: z.string(),
  duration_ms: z.number(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ============================================================================
// Research Query Generation
// ============================================================================

/**
 * Analysis context for query generation
 */
export const AnalysisContextSchema = z.object({
  company_name: z.string(),
  industry: z.string().optional(),
  stage: z.string().optional(),
  headings: z.array(z.string()).optional(),  // From slide sequence
  known_gaps: z.array(z.string()).optional(), // Missing info from heuristics
});

export type AnalysisContext = z.infer<typeof AnalysisContextSchema>;

/**
 * Generated research queries
 */
export const LLMQueryResponseSchema = z.object({
  queries: z.array(z.string()),    // 3-5 focused research queries
  rationale: z.string(),           // Why these queries
  usage: TokenUsageSchema,
  warnings: z.array(z.string()).optional(),
});

export type LLMQueryResponse = z.infer<typeof LLMQueryResponseSchema>;

// ============================================================================
// Narrative Synthesis
// ============================================================================

/**
 * DIO summary for narrative generation
 * (Minimal input - narrative is just storytelling, not analysis)
 */
export const DIOSummarySchema = z.object({
  company_name: z.string(),
  recommendation: z.enum(["GO", "NO-GO", "CONDITIONAL"]),
  overall_score: z.number(),
  key_strengths: z.array(z.string()),
  key_risks: z.array(z.string()),
  facts_count: z.number(),
  cycles_executed: z.number(),
  confidence: z.number().min(0).max(1),
});

export type DIOSummary = z.infer<typeof DIOSummarySchema>;

/**
 * Generated narrative
 */
export const LLMNarrativeResponseSchema = z.object({
  executive_summary: z.string(),   // 2-3 sentences
  investment_thesis: z.string(),   // 3-4 sentences
  key_considerations: z.string(),  // Bullet points
  confidence_note: z.string(),     // Why this confidence level
  usage: TokenUsageSchema,
  warnings: z.array(z.string()).optional(),
});

export type LLMNarrativeResponse = z.infer<typeof LLMNarrativeResponseSchema>;

// ============================================================================
// Edge Case Classification
// ============================================================================

/**
 * Classification request
 */
export const LLMClassificationRequestSchema = z.object({
  text: z.string(),                 // Text to classify
  choices: z.array(z.string()),     // Possible categories
  context: z.string().optional(),   // Additional context
});

export type LLMClassificationRequest = z.infer<typeof LLMClassificationRequestSchema>;

/**
 * Classification result
 */
export const LLMClassificationResponseSchema = z.object({
  choice: z.string(),               // Selected category
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),            // Why this choice
  usage: TokenUsageSchema,
  warnings: z.array(z.string()).optional(),
});

export type LLMClassificationResponse = z.infer<typeof LLMClassificationResponseSchema>;

// ============================================================================
// Errors
// ============================================================================

export class LLMServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "LLMServiceError";
  }
}

export class TokenBudgetExceededError extends LLMServiceError {
  constructor(
    public readonly requested: number,
    public readonly remaining: number,
    public readonly budget: number
  ) {
    super(
      `Token budget exceeded: requested ${requested}, remaining ${remaining}/${budget}`,
      "BUDGET_EXCEEDED"
    );
    this.name = "TokenBudgetExceededError";
  }
}

export class LLMProviderError extends LLMServiceError {
  constructor(provider: string, message: string) {
    super(`LLM provider '${provider}' error: ${message}`, "PROVIDER_ERROR");
    this.name = "LLMProviderError";
  }
}

export class LLMTimeoutError extends LLMServiceError {
  constructor(timeout_ms: number) {
    super(`LLM request timed out after ${timeout_ms}ms`, "TIMEOUT");
    this.name = "LLMTimeoutError";
  }
}

// ============================================================================
// Core Interface
// ============================================================================

/**
 * LLM Service Interface
 * 
 * CRITICAL CONSTRAINTS:
 * 1. 500 token budget per deal (enforced by TokenBudgetEnforcer)
 * 2. Only 3 allowed use cases:
 *    - query_generation: Generate Tavily search queries (100 tokens max)
 *    - narrative_synthesis: Generate executive summary (300 tokens max)
 *    - edge_case: Classify ambiguous data (100 tokens max)
 * 3. LLM does NOT make decisions - only narrates heuristic results
 * 
 * Example usage:
 * ```typescript
 * const llm = new LLMServiceImpl({ provider: "bedrock", model: "qwen-14b" });
 * 
 * // Generate research queries
 * const queries = await llm.generateResearchQueries({
 *   company_name: "Acme AI",
 *   industry: "AI/ML",
 *   known_gaps: ["market size unknown", "competitor analysis missing"]
 * });
 * console.log(queries.queries); // ["AI market size 2024", "Acme AI competitors"]
 * 
 * // Synthesize narrative (after heuristic analysis complete)
 * const narrative = await llm.synthesizeNarrative({
 *   company_name: "Acme AI",
 *   recommendation: "GO",
 *   overall_score: 87,
 *   key_strengths: ["Strong team", "Large market"],
 *   key_risks: ["Early stage", "Competitive market"],
 *   facts_count: 42,
 *   cycles_executed: 2,
 *   confidence: 0.85
 * });
 * console.log(narrative.executive_summary);
 * 
 * // Check token budget
 * const budget = llm.getBudget();
 * console.log(`Remaining: ${budget.remaining}/${budget.total}`);
 * ```
 */
export interface LLMService {
  /**
   * Generate research queries for external evidence
   * 
   * Use Case: When heuristics identify knowledge gaps that need external research
   * Budget: ~100 tokens (50 input + 50 output)
   * 
   * @param context - Analysis context (company, industry, gaps)
   * @returns Promise resolving to 3-5 focused research queries
   * @throws TokenBudgetExceededError if budget insufficient
   */
  generateResearchQueries(context: AnalysisContext): Promise<LLMQueryResponse>;

  /**
   * Synthesize narrative from heuristic analysis
   * 
   * Use Case: After all heuristic analysis complete, generate executive summary
   * Budget: ~300 tokens (100 input + 200 output)
   * 
   * IMPORTANT: LLM does NOT analyze - just narrates heuristic results
   * 
   * @param dio_summary - Summary of heuristic analysis results
   * @returns Promise resolving to narrative (summary, thesis, considerations)
   * @throws TokenBudgetExceededError if budget insufficient
   */
  synthesizeNarrative(dio_summary: DIOSummary): Promise<LLMNarrativeResponse>;

  /**
   * Classify ambiguous text (edge cases only)
   * 
   * Use Case: When heuristics can't confidently classify (e.g., unclear industry)
   * Budget: ~100 tokens (50 input + 50 output)
   * 
   * @param request - Text and choices for classification
   * @returns Promise resolving to selected choice with confidence
   * @throws TokenBudgetExceededError if budget insufficient
   */
  classifyAmbiguity(request: LLMClassificationRequest): Promise<LLMClassificationResponse>;

  /**
   * Get current token budget
   * 
   * @returns Current budget state
   */
  getBudget(): TokenBudget;

  /**
   * Reset token budget (for new deal)
   * 
   * @param total - New budget total (default: 500)
   */
  resetBudget(total?: number): void;

  /**
   * Record external token usage (from direct API calls)
   * 
   * Use when bypassing LLMService but still need to track budget
   * 
   * @param purpose - Why tokens were used
   * @param usage - Token usage details
   */
  recordUsage(purpose: string, usage: TokenUsage): void;
}

// ============================================================================
// Production Implementation
// ============================================================================

/**
 * OpenAI client wrapper
 */
class OpenAIClient {
  constructor(private api_key: string) {}

  async complete(
    prompt: string,
    max_tokens: number,
    temperature = 0.7
  ): Promise<{ content: string; usage: TokenUsage }> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.api_key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // Cost-effective model
        messages: [{ role: "user", content: prompt }],
        max_tokens,
        temperature,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      content: data.choices[0]?.message?.content || "",
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
        estimated_cost: (data.usage?.total_tokens || 0) * 0.00001,  // Rough estimate
      },
    };
  }
}

/**
 * AWS Bedrock client wrapper (for Qwen 14B)
 */
class BedrockClient {
  constructor(
    private region: string,
    private access_key: string,
    private secret_key: string
  ) {}

  async complete(
    prompt: string,
    max_tokens: number,
    temperature = 0.7
  ): Promise<{ content: string; usage: TokenUsage }> {
    // In production, use AWS SDK
    // For now, this is a stub
    /*
    const client = new BedrockRuntimeClient({
      region: this.region,
      credentials: {
        accessKeyId: this.access_key,
        secretAccessKey: this.secret_key,
      },
    });

    const command = new InvokeModelCommand({
      modelId: "qwen.qwen-14b-chat-v1",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        prompt,
        max_tokens_to_sample: max_tokens,
        temperature,
      }),
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    return {
      content: result.completion,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: estimateTokens(result.completion),
        total_tokens: estimateTokens(prompt) + estimateTokens(result.completion),
        estimated_cost: 0.0001,  // Much cheaper than OpenAI
      },
    };
    */

    throw new Error("Bedrock client not implemented - add AWS SDK dependency");
  }
}

/**
 * AWS SageMaker client wrapper (for Llama 70B)
 */
class SageMakerClient {
  constructor(
    private endpoint: string,
    private region: string,
    private access_key: string,
    private secret_key: string
  ) {}

  async complete(
    prompt: string,
    max_tokens: number,
    temperature = 0.7
  ): Promise<{ content: string; usage: TokenUsage }> {
    // In production, use AWS SDK
    // For now, this is a stub
    throw new Error("SageMaker client not implemented - add AWS SDK dependency");
  }
}

/**
 * Production LLM Service Implementation
 * 
 * Features:
 * - Multi-provider support (OpenAI, Bedrock, SageMaker)
 * - 500 token budget enforcement
 * - Automatic provider selection
 * - Usage tracking and cost estimation
 */
export class LLMServiceImpl implements LLMService {
  private budgetEnforcer: TokenBudgetEnforcer;
  private openaiClient: OpenAIClient | null = null;
  private bedrockClient: BedrockClient | null = null;
  private sagemakerClient: SageMakerClient | null = null;

  constructor(
    private provider: LLMProvider,
    config: {
      openai_api_key?: string;
      bedrock_region?: string;
      bedrock_access_key?: string;
      bedrock_secret_key?: string;
      sagemaker_endpoint?: string;
      sagemaker_region?: string;
      sagemaker_access_key?: string;
      sagemaker_secret_key?: string;
    },
    budget_total = 500
  ) {
    this.budgetEnforcer = new TokenBudgetEnforcer(budget_total);

    // Initialize provider client
    if (provider === "openai" && config.openai_api_key) {
      this.openaiClient = new OpenAIClient(config.openai_api_key);
    } else if (
      provider === "bedrock" &&
      config.bedrock_region &&
      config.bedrock_access_key &&
      config.bedrock_secret_key
    ) {
      this.bedrockClient = new BedrockClient(
        config.bedrock_region,
        config.bedrock_access_key,
        config.bedrock_secret_key
      );
    } else if (
      provider === "sagemaker" &&
      config.sagemaker_endpoint &&
      config.sagemaker_region &&
      config.sagemaker_access_key &&
      config.sagemaker_secret_key
    ) {
      this.sagemakerClient = new SageMakerClient(
        config.sagemaker_endpoint,
        config.sagemaker_region,
        config.sagemaker_access_key,
        config.sagemaker_secret_key
      );
    } else {
      throw new LLMServiceError(
        `Missing configuration for provider '${provider}'`,
        "INVALID_CONFIG"
      );
    }
  }

  async generateResearchQueries(context: AnalysisContext): Promise<LLMQueryResponse> {
    const start_time = Date.now();

    // Build prompt
    const prompt = this.buildQueryGenerationPrompt(context);
    const estimated_tokens = estimateTokens(prompt) + 50;  // +50 for output

    // Check budget
    this.budgetEnforcer.checkBudget("query_generation", estimated_tokens);

    try {
      // Call LLM
      const response = await this.complete(prompt, 50, 0.7);

      // Parse queries from response
      const queries = this.parseQueries(response.content);

      // Record usage
      this.budgetEnforcer.recordUsage("query_generation", response.usage.total_tokens);

      return {
        queries,
        rationale: `Generated ${queries.length} research queries based on ${context.known_gaps?.length || 0} identified gaps`,
        usage: response.usage,
      };
    } catch (error) {
      throw new LLMProviderError(
        this.provider,
        (error as Error).message
      );
    }
  }

  async synthesizeNarrative(dio_summary: DIOSummary): Promise<LLMNarrativeResponse> {
    const start_time = Date.now();

    // Build prompt
    const prompt = this.buildNarrativeSynthesisPrompt(dio_summary);
    const estimated_tokens = estimateTokens(prompt) + 200;  // +200 for output

    // Check budget
    this.budgetEnforcer.checkBudget("narrative_synthesis", estimated_tokens);

    try {
      // Call LLM
      const response = await this.complete(prompt, 200, 0.7);

      // Parse narrative sections
      const narrative = this.parseNarrative(response.content);

      // Record usage
      this.budgetEnforcer.recordUsage("narrative_synthesis", response.usage.total_tokens);

      return {
        ...narrative,
        usage: response.usage,
      };
    } catch (error) {
      throw new LLMProviderError(
        this.provider,
        (error as Error).message
      );
    }
  }

  async classifyAmbiguity(request: LLMClassificationRequest): Promise<LLMClassificationResponse> {
    const start_time = Date.now();

    // Build prompt
    const prompt = this.buildClassificationPrompt(request);
    const estimated_tokens = estimateTokens(prompt) + 50;  // +50 for output

    // Check budget
    this.budgetEnforcer.checkBudget("edge_case", estimated_tokens);

    try {
      // Call LLM
      const response = await this.complete(prompt, 50, 0.3);  // Lower temperature for classification

      // Parse classification
      const classification = this.parseClassification(response.content, request.choices);

      // Record usage
      this.budgetEnforcer.recordUsage("edge_case", response.usage.total_tokens);

      return {
        ...classification,
        usage: response.usage,
      };
    } catch (error) {
      throw new LLMProviderError(
        this.provider,
        (error as Error).message
      );
    }
  }

  getBudget(): TokenBudget {
    return this.budgetEnforcer.getBudget();
  }

  resetBudget(total = 500): void {
    this.budgetEnforcer.reset(total);
  }

  recordUsage(purpose: string, usage: TokenUsage): void {
    this.budgetEnforcer.recordUsage(
      purpose as "query_generation" | "narrative_synthesis" | "edge_case",
      usage.total_tokens
    );
  }

  /**
   * Complete text with active provider (internal)
   */
  private async complete(
    prompt: string,
    max_tokens: number,
    temperature: number
  ): Promise<{ content: string; usage: TokenUsage }> {
    if (this.provider === "openai" && this.openaiClient) {
      return this.openaiClient.complete(prompt, max_tokens, temperature);
    } else if (this.provider === "bedrock" && this.bedrockClient) {
      return this.bedrockClient.complete(prompt, max_tokens, temperature);
    } else if (this.provider === "sagemaker" && this.sagemakerClient) {
      return this.sagemakerClient.complete(prompt, max_tokens, temperature);
    } else {
      throw new LLMServiceError(
        `Provider '${this.provider}' not initialized`,
        "PROVIDER_NOT_INITIALIZED"
      );
    }
  }

  /**
   * Build query generation prompt
   */
  private buildQueryGenerationPrompt(context: AnalysisContext): string {
    return `You are an investment analyst. Generate 3-5 focused research queries for Tavily search.

Company: ${context.company_name}
Industry: ${context.industry || "Unknown"}
Stage: ${context.stage || "Unknown"}
Known Gaps: ${context.known_gaps?.join(", ") || "None"}

Generate search queries that would help fill these gaps. Return only the queries, one per line.`;
  }

  /**
   * Build narrative synthesis prompt
   */
  private buildNarrativeSynthesisPrompt(dio_summary: DIOSummary): string {
    return `You are an investment analyst. Write a concise investment narrative based on the following analysis:

Company: ${dio_summary.company_name}
Recommendation: ${dio_summary.recommendation}
Score: ${dio_summary.overall_score}/100
Confidence: ${Math.round(dio_summary.confidence * 100)}%
Facts Analyzed: ${dio_summary.facts_count}
Key Strengths: ${dio_summary.key_strengths.join(", ")}
Key Risks: ${dio_summary.key_risks.join(", ")}

Generate:
1. EXECUTIVE_SUMMARY: 2-3 sentences
2. INVESTMENT_THESIS: 3-4 sentences
3. KEY_CONSIDERATIONS: Bullet points
4. CONFIDENCE_NOTE: Why this confidence level

Format each section with the label in UPPERCASE.`;
  }

  /**
   * Build classification prompt
   */
  private buildClassificationPrompt(request: LLMClassificationRequest): string {
    return `Classify the following text into one of the provided categories.

Text: ${request.text}
${request.context ? `Context: ${request.context}` : ""}

Categories: ${request.choices.join(", ")}

Respond with:
1. CHOICE: <selected category>
2. CONFIDENCE: <0.0 to 1.0>
3. REASONING: <brief explanation>

Format each with the label in UPPERCASE.`;
  }

  /**
   * Parse queries from LLM response
   */
  private parseQueries(response: string): string[] {
    return response
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"))
      .slice(0, 5);  // Max 5 queries
  }

  /**
   * Parse narrative from LLM response
   */
  private parseNarrative(response: string): {
    executive_summary: string;
    investment_thesis: string;
    key_considerations: string;
    confidence_note: string;
  } {
    const sections = {
      executive_summary: "",
      investment_thesis: "",
      key_considerations: "",
      confidence_note: "",
    };

    const lines = response.split("\n");
    let current_section = "";

    for (const line of lines) {
      const upper = line.toUpperCase();
      
      if (upper.includes("EXECUTIVE_SUMMARY") || upper.includes("EXECUTIVE SUMMARY")) {
        current_section = "executive_summary";
      } else if (upper.includes("INVESTMENT_THESIS") || upper.includes("INVESTMENT THESIS")) {
        current_section = "investment_thesis";
      } else if (upper.includes("KEY_CONSIDERATIONS") || upper.includes("KEY CONSIDERATIONS")) {
        current_section = "key_considerations";
      } else if (upper.includes("CONFIDENCE_NOTE") || upper.includes("CONFIDENCE NOTE")) {
        current_section = "confidence_note";
      } else if (current_section && line.trim()) {
        sections[current_section as keyof typeof sections] += (sections[current_section as keyof typeof sections] ? "\n" : "") + line.trim();
      }
    }

    return sections;
  }

  /**
   * Parse classification from LLM response
   */
  private parseClassification(
    response: string,
    choices: string[]
  ): { choice: string; confidence: number; reasoning: string } {
    const result = {
      choice: choices[0],  // Default to first choice
      confidence: 0.5,
      reasoning: "",
    };

    const lines = response.split("\n");
    
    for (const line of lines) {
      const upper = line.toUpperCase();
      
      if (upper.includes("CHOICE:")) {
        const choice_text = line.split(":")[1]?.trim() || "";
        const matched = choices.find(c => 
          choice_text.toLowerCase().includes(c.toLowerCase())
        );
        if (matched) {
          result.choice = matched;
        }
      } else if (upper.includes("CONFIDENCE:")) {
        const conf_text = line.split(":")[1]?.trim() || "";
        const conf_num = parseFloat(conf_text);
        if (!isNaN(conf_num)) {
          result.confidence = Math.max(0, Math.min(1, conf_num));
        }
      } else if (upper.includes("REASONING:")) {
        result.reasoning = line.split(":")[1]?.trim() || "";
      } else if (result.reasoning && line.trim()) {
        result.reasoning += " " + line.trim();
      }
    }

    return result;
  }
}

// ============================================================================
// Token Budget Enforcer
// ============================================================================

/**
 * Token budget enforcement (shared across all LLM implementations)
 */
export class TokenBudgetEnforcer {
  private budget: TokenBudget;

  constructor(total = 500) {
    this.budget = {
      total,
      used: 0,
      remaining: total,
      breakdown: {
        query_generation: 0,
        narrative_synthesis: 0,
        edge_case: 0,
      },
    };
  }

  /**
   * Check if budget allows operation
   * @throws TokenBudgetExceededError if insufficient
   */
  checkBudget(operation: string, estimated: number): void {
    if (this.budget.remaining < estimated) {
      throw new TokenBudgetExceededError(
        estimated,
        this.budget.remaining,
        this.budget.total
      );
    }
  }

  /**
   * Record actual token usage
   */
  recordUsage(purpose: "query_generation" | "narrative_synthesis" | "edge_case", actual: number): void {
    this.budget.used += actual;
    this.budget.remaining = this.budget.total - this.budget.used;
    
    if (this.budget.breakdown) {
      this.budget.breakdown[purpose] += actual;
    }
  }

  /**
   * Get current budget
   */
  getBudget(): TokenBudget {
    return { ...this.budget };
  }

  /**
   * Reset budget
   */
  reset(total = 500): void {
    this.budget = {
      total,
      used: 0,
      remaining: total,
      breakdown: {
        query_generation: 0,
        narrative_synthesis: 0,
        edge_case: 0,
      },
    };
  }
}

// ============================================================================
// Mock Implementation (for testing)
// ============================================================================

/**
 * Mock LLM service for deterministic testing
 * Returns predefined responses without real LLM calls
 */
export class MockLLMService implements LLMService {
  private budgetEnforcer: TokenBudgetEnforcer;

  constructor(total_budget = 500) {
    this.budgetEnforcer = new TokenBudgetEnforcer(total_budget);
  }

  async generateResearchQueries(context: AnalysisContext): Promise<LLMQueryResponse> {
    this.budgetEnforcer.checkBudget("query_generation", 100);

    const queries = [
      `${context.company_name} market size`,
      `${context.industry || "industry"} growth trends`,
      `${context.company_name} competitors`,
    ];

    const usage: TokenUsage = {
      input_tokens: 50,
      output_tokens: 50,
      total_tokens: 100,
      estimated_cost: 0.001,
    };

    this.budgetEnforcer.recordUsage("query_generation", usage.total_tokens);

    return {
      queries,
      rationale: "Generated queries based on company name and industry",
      usage,
      warnings: ["Mock implementation - no real LLM call"],
    };
  }

  async synthesizeNarrative(dio_summary: DIOSummary): Promise<LLMNarrativeResponse> {
    this.budgetEnforcer.checkBudget("narrative_synthesis", 300);

    const usage: TokenUsage = {
      input_tokens: 100,
      output_tokens: 200,
      total_tokens: 300,
      estimated_cost: 0.003,
    };

    this.budgetEnforcer.recordUsage("narrative_synthesis", usage.total_tokens);

    return {
      executive_summary: `${dio_summary.company_name} analysis complete. Recommendation: ${dio_summary.recommendation}.`,
      investment_thesis: `Based on ${dio_summary.facts_count} verified facts across ${dio_summary.cycles_executed} analysis cycles, confidence is ${dio_summary.confidence}.`,
      key_considerations: `• Strengths: ${dio_summary.key_strengths.join(", ")}\n• Risks: ${dio_summary.key_risks.join(", ")}`,
      confidence_note: `Confidence of ${dio_summary.confidence} based on evidence quality and completeness.`,
      usage,
      warnings: ["Mock implementation - no real LLM call"],
    };
  }

  async classifyAmbiguity(request: LLMClassificationRequest): Promise<LLMClassificationResponse> {
    this.budgetEnforcer.checkBudget("edge_case", 100);

    const usage: TokenUsage = {
      input_tokens: 50,
      output_tokens: 50,
      total_tokens: 100,
      estimated_cost: 0.001,
    };

    this.budgetEnforcer.recordUsage("edge_case", usage.total_tokens);

    return {
      choice: request.choices[0],  // Mock: just pick first choice
      confidence: 0.7,
      reasoning: "Mock classification - selected first choice",
      usage,
      warnings: ["Mock implementation - no real LLM call"],
    };
  }

  getBudget(): TokenBudget {
    return this.budgetEnforcer.getBudget();
  }

  resetBudget(total = 500): void {
    this.budgetEnforcer.reset(total);
  }

  recordUsage(purpose: string, usage: TokenUsage): void {
    this.budgetEnforcer.recordUsage(
      purpose as "query_generation" | "narrative_synthesis" | "edge_case",
      usage.total_tokens
    );
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create default token budget
 */
export function createDefaultTokenBudget(): TokenBudget {
  return {
    total: 500,
    used: 0,
    remaining: 500,
    breakdown: {
      query_generation: 0,
      narrative_synthesis: 0,
      edge_case: 0,
    },
  };
}

/**
 * Estimate token count (rough approximation)
 * Real implementation should use tiktoken or similar
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Validate token usage
 */
export function validateTokenUsage(data: unknown): TokenUsage {
  return TokenUsageSchema.parse(data);
}

// ============================================================================
// Type Guards
// ============================================================================

export function isLLMResponse(value: unknown): value is LLMResponse {
  return LLMResponseSchema.safeParse(value).success;
}

export function isTokenUsage(value: unknown): value is TokenUsage {
  return TokenUsageSchema.safeParse(value).success;
}
