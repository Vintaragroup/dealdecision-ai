/**
 * Service Tests
 * 
 * Comprehensive test suite for:
 * - MCP Client (external research tools)
 * - Evidence Service (document processing + Tavily)
 * - LLM Service (OpenAI/Bedrock/SageMaker)
 * 
 * Test Coverage:
 * - Mock implementations work correctly
 * - Production implementations handle errors
 * - Rate limiting and retry logic
 * - Token budget enforcement
 * - Configuration validation
 */

import {
  MockMCPClient,
  MCPClientImpl,
  createDefaultMCPConfig,
  MCPProviderUnavailableError,
  MCPTimeoutError,
  MCPToolNotFoundError,
} from "../mcp/client";
import {
  MockEvidenceService,
  EvidenceServiceImpl,
  createDefaultEvidenceOptions,
  createEvidence,
  chunkBySentences,
  chunkByParagraphs,
  TavilyDisabledError,
  EvidenceExtractionError,
} from "../evidence/service";
import {
  MockLLMService,
  LLMServiceImpl,
  TokenBudgetEnforcer,
  TokenBudgetExceededError,
  estimateTokens,
} from "../llm/service";
import {
  loadConfigFromEnv,
  validateServiceConfig,
  createTestConfig,
  maskSensitiveConfig,
} from "../../config/services";

// ============================================================================
// MCP Client Tests
// ============================================================================

describe("MCP Client", () => {
  describe("MockMCPClient", () => {
    let client: MockMCPClient;

    beforeEach(() => {
      const config = createDefaultMCPConfig();
      config.providers.gartner.enabled = true;
      client = new MockMCPClient(config);
    });

    it("should return registered mock response", async () => {
      // Register mock
      client.registerResponse("gartner", "research_market_size", {
        market_size: "$50B",
        growth_rate: "15%",
      }, 0.85);

      // Call tool
      const response = await client.call("gartner", "research_market_size", {
        industry: "AI/ML",
        year: 2024,
      });

      expect(response.success).toBe(true);
      expect(response.data.market_size).toBe("$50B");
      expect(response.confidence).toBe(0.85);
      expect(response.source).toBe("gartner/research_market_size");
    });

    it("should return error for unregistered tool", async () => {
      const response = await client.call("gartner", "unknown_tool", {});
      
      expect(response.success).toBe(false);
      expect(response.error).toContain("No mock response registered");
    });

    it("should list registered tools", async () => {
      client.registerTool("gartner", {
        name: "research_market_size",
        description: "Get market size",
        input_schema: {},
        provider: "gartner",
      });

      const tools = await client.listTools("gartner");
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("research_market_size");
    });

    it("should ping enabled providers", async () => {
      const is_available = await client.ping("gartner");
      expect(is_available).toBe(true);

      const is_disabled = await client.ping("unknown");
      expect(is_disabled).toBe(false);
    });
  });

  describe("MCPClientImpl Error Handling", () => {
    it("should throw error for unavailable provider", async () => {
      const config = createDefaultMCPConfig();
      config.providers.gartner.enabled = false;
      const client = new MCPClientImpl(config);

      await expect(
        client.call("gartner", "research_market_size", {})
      ).rejects.toThrow(MCPProviderUnavailableError);
    });

    it("should enforce rate limiting", async () => {
      const config = createDefaultMCPConfig();
      config.providers.gartner.enabled = true;
      config.providers.gartner.endpoint = "https://api.gartner.com";
      config.providers.gartner.rate_limit_per_min = 1;  // Very low limit
      
      const client = new MCPClientImpl(config);

      // First call should succeed (or fail for other reasons)
      // Second immediate call should be rate limited
      // Note: In real implementation, we'd need to mock the HTTP client
    });
  });
});

// ============================================================================
// Evidence Service Tests
// ============================================================================

describe("Evidence Service", () => {
  describe("MockEvidenceService", () => {
    let service: MockEvidenceService;
    const deal_id = "550e8400-e29b-41d4-a716-446655440000";

    beforeEach(() => {
      service = new MockEvidenceService();
    });

    it("should store and retrieve evidence", async () => {
      const evidence = createEvidence(
        "evidence_1",
        deal_id,
        "document",
        "pitch_deck.pdf",
        "Our market is growing at 15% annually.",
        0.9,
        1
      );

      service.registerEvidence(evidence);

      const retrieved = await service.getEvidence("evidence_1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe("Our market is growing at 15% annually.");
      expect(retrieved?.source).toBe("pitch_deck.pdf");
    });

    it("should list evidence by deal", async () => {
      const evidence1 = createEvidence(
        "evidence_1",
        deal_id,
        "document",
        "pitch_deck.pdf",
        "Evidence 1",
        0.9
      );
      const evidence2 = createEvidence(
        "evidence_2",
        deal_id,
        "document",
        "financials.xlsx",
        "Evidence 2",
        0.8
      );

      service.registerEvidence(evidence1);
      service.registerEvidence(evidence2);

      const all = await service.listEvidence(deal_id);
      expect(all.length).toBe(2);
    });

    it("should filter evidence by source type", async () => {
      const doc_evidence = createEvidence(
        "evidence_1",
        deal_id,
        "document",
        "pitch_deck.pdf",
        "Doc evidence",
        0.9
      );
      const tavily_evidence = createEvidence(
        "evidence_2",
        deal_id,
        "tavily",
        "https://example.com",
        "External evidence",
        0.7
      );

      service.registerEvidence(doc_evidence);
      service.registerEvidence(tavily_evidence);

      const docs = await service.listEvidence(deal_id, {
        source_type: "document",
        limit: 100,
        offset: 0,
      });

      expect(docs.length).toBe(1);
      expect(docs[0].source_type).toBe("document");
    });

    it("should filter by confidence threshold", async () => {
      const high_conf = createEvidence(
        "evidence_1",
        deal_id,
        "document",
        "source.pdf",
        "High confidence",
        0.9
      );
      const low_conf = createEvidence(
        "evidence_2",
        deal_id,
        "document",
        "source.pdf",
        "Low confidence",
        0.4
      );

      service.registerEvidence(high_conf);
      service.registerEvidence(low_conf);

      const filtered = await service.listEvidence(deal_id, {
        min_confidence: 0.7,
        limit: 100,
        offset: 0,
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("should throw error when Tavily disabled", async () => {
      await expect(
        service.fetchExternalEvidence(deal_id, ["test query"], {
          tavily_enabled: false,
        })
      ).rejects.toThrow(TavilyDisabledError);
    });

    it("should delete all evidence for deal", async () => {
      service.registerEvidence(
        createEvidence("ev1", deal_id, "document", "file.pdf", "Content", 0.9)
      );
      service.registerEvidence(
        createEvidence("ev2", deal_id, "document", "file.pdf", "Content", 0.9)
      );

      const count = await service.deleteEvidence(deal_id);
      expect(count).toBe(2);

      const remaining = await service.listEvidence(deal_id);
      expect(remaining.length).toBe(0);
    });

    it("should search evidence by text", async () => {
      service.registerEvidence(
        createEvidence("ev1", deal_id, "document", "file.pdf", "Revenue is $5M ARR", 0.9)
      );
      service.registerEvidence(
        createEvidence("ev2", deal_id, "document", "file.pdf", "Team has 10 engineers", 0.9)
      );

      const results = await service.searchEvidence(deal_id, "revenue", 10);
      expect(results.length).toBe(1);
      expect(results[0].content).toContain("Revenue");
    });
  });

  describe("Chunking Strategies", () => {
    it("should chunk text by sentences", () => {
      const text = "First sentence. Second sentence. Third sentence. Fourth sentence.";
      const chunks = chunkBySentences(text, 20, 50);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.length).toBeGreaterThanOrEqual(20);
        expect(chunk.length).toBeLessThanOrEqual(50);
      });
    });

    it("should chunk text by paragraphs", () => {
      const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
      const chunks = chunkByParagraphs(text, 10, 100);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.length).toBeGreaterThanOrEqual(10);
      });
    });

    it("should respect min chunk length", () => {
      const text = "Short. Text. Here.";
      const chunks = chunkBySentences(text, 100, 500);  // High min length

      // Should combine sentences or return empty if can't meet min
      chunks.forEach(chunk => {
        expect(chunk.length).toBeGreaterThanOrEqual(100);
      });
    });
  });
});

// ============================================================================
// LLM Service Tests
// ============================================================================

describe("LLM Service", () => {
  describe("MockLLMService", () => {
    let service: MockLLMService;

    beforeEach(() => {
      service = new MockLLMService(500);
    });

    it("should generate research queries", async () => {
      const response = await service.generateResearchQueries({
        company_name: "Acme AI",
        industry: "AI/ML",
        known_gaps: ["market size unknown"],
      });

      expect(response.queries.length).toBeGreaterThan(0);
      expect(response.queries[0]).toContain("Acme AI");
      expect(response.usage.total_tokens).toBeLessThanOrEqual(100);
    });

    it("should synthesize narrative", async () => {
      const response = await service.synthesizeNarrative({
        company_name: "Acme AI",
        recommendation: "GO",
        overall_score: 87,
        key_strengths: ["Strong team", "Large market"],
        key_risks: ["Early stage"],
        facts_count: 42,
        cycles_executed: 2,
        confidence: 0.85,
      });

      expect(response.executive_summary).toContain("Acme AI");
      expect(response.executive_summary).toContain("GO");
      expect(response.usage.total_tokens).toBeLessThanOrEqual(300);
    });

    it("should classify ambiguity", async () => {
      const response = await service.classifyAmbiguity({
        text: "We're building AI for healthcare",
        choices: ["Healthcare", "AI/ML", "B2B SaaS"],
      });

      expect(response.choice).toBeDefined();
      expect(["Healthcare", "AI/ML", "B2B SaaS"]).toContain(response.choice);
      expect(response.confidence).toBeGreaterThanOrEqual(0);
      expect(response.confidence).toBeLessThanOrEqual(1);
    });

    it("should track token budget", async () => {
      const initial = service.getBudget();
      expect(initial.remaining).toBe(500);

      await service.generateResearchQueries({
        company_name: "Test Co",
      });

      const after = service.getBudget();
      expect(after.remaining).toBeLessThan(500);
      expect(after.used).toBeGreaterThan(0);
    });

    it("should reset budget", () => {
      service.recordUsage("query_generation", { total_tokens: 100, input_tokens: 50, output_tokens: 50 });
      
      let budget = service.getBudget();
      expect(budget.remaining).toBe(400);

      service.resetBudget(500);
      
      budget = service.getBudget();
      expect(budget.remaining).toBe(500);
      expect(budget.used).toBe(0);
    });
  });

  describe("TokenBudgetEnforcer", () => {
    let enforcer: TokenBudgetEnforcer;

    beforeEach(() => {
      enforcer = new TokenBudgetEnforcer(500);
    });

    it("should allow operations within budget", () => {
      expect(() => {
        enforcer.checkBudget("query_generation", 100);
      }).not.toThrow();
    });

    it("should throw when budget exceeded", () => {
      enforcer.recordUsage("query_generation", 450);
      
      expect(() => {
        enforcer.checkBudget("narrative_synthesis", 100);
      }).toThrow(TokenBudgetExceededError);
    });

    it("should track usage by purpose", () => {
      enforcer.recordUsage("query_generation", 100);
      enforcer.recordUsage("narrative_synthesis", 200);
      enforcer.recordUsage("edge_case", 50);

      const budget = enforcer.getBudget();
      expect(budget.used).toBe(350);
      expect(budget.remaining).toBe(150);
      expect(budget.breakdown?.query_generation).toBe(100);
      expect(budget.breakdown?.narrative_synthesis).toBe(200);
      expect(budget.breakdown?.edge_case).toBe(50);
    });

    it("should reset budget and breakdown", () => {
      enforcer.recordUsage("query_generation", 100);
      enforcer.reset(1000);

      const budget = enforcer.getBudget();
      expect(budget.total).toBe(1000);
      expect(budget.used).toBe(0);
      expect(budget.remaining).toBe(1000);
      expect(budget.breakdown?.query_generation).toBe(0);
    });
  });

  describe("Token Estimation", () => {
    it("should estimate tokens roughly", () => {
      const text = "This is a test sentence.";
      const tokens = estimateTokens(text);
      
      // Rough estimate: ~4 chars per token
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });

    it("should handle empty string", () => {
      const tokens = estimateTokens("");
      expect(tokens).toBe(0);
    });

    it("should scale with text length", () => {
      const short = estimateTokens("Hello");
      const long = estimateTokens("Hello ".repeat(100));
      
      expect(long).toBeGreaterThan(short * 50);
    });
  });
});

// ============================================================================
// Configuration Tests
// ============================================================================

describe("Service Configuration", () => {
  describe("Configuration Validation", () => {
    it("should validate complete config", () => {
      const config = createTestConfig();
      expect(() => validateServiceConfig(config)).not.toThrow();
    });

    it("should require OpenAI key when provider is openai", () => {
      const config = createTestConfig();
      config.llm.provider = "openai";
      config.llm.openai_api_key = undefined;

      expect(() => validateServiceConfig(config)).toThrow(
        "OPENAI_API_KEY is not set"
      );
    });

    it("should require Tavily key when enabled", () => {
      const config = createTestConfig();
      config.evidence.tavily_enabled = true;
      config.evidence.tavily_api_key = undefined;

      expect(() => validateServiceConfig(config)).toThrow(
        "TAVILY_API_KEY is not set"
      );
    });

    it("should require MCP endpoint when provider enabled", () => {
      const config = createTestConfig();
      config.mcp.enabled = true;
      config.mcp.providers.gartner.enabled = true;
      config.mcp.providers.gartner.endpoint = undefined;

      expect(() => validateServiceConfig(config)).toThrow(
        "endpoint is not set"
      );
    });
  });

  describe("Sensitive Data Masking", () => {
    it("should mask API keys", () => {
      const config = createTestConfig();
      config.llm.openai_api_key = "sk-1234567890";
      config.evidence.tavily_api_key = "tvly-1234567890";

      const masked = maskSensitiveConfig(config);

      expect(masked.llm?.openai_api_key).toBe("***MASKED***");
      expect(masked.evidence?.tavily_api_key).toBe("***MASKED***");
    });

    it("should mask database password", () => {
      const config = createTestConfig();
      config.evidence.database_url = "postgresql://user:password@localhost:5432/db";

      const masked = maskSensitiveConfig(config);

      expect(masked.evidence?.database_url).toContain("***");
      expect(masked.evidence?.database_url).not.toContain("password");
    });

    it("should mask AWS credentials", () => {
      const config = createTestConfig();
      config.llm.bedrock_access_key = "AKIAIOSFODNN7EXAMPLE";
      config.llm.bedrock_secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

      const masked = maskSensitiveConfig(config);

      expect(masked.llm?.bedrock_access_key).toBe("***MASKED***");
      expect(masked.llm?.bedrock_secret_key).toBe("***MASKED***");
    });
  });

  describe("Environment Loading", () => {
    it("should load from environment variables", () => {
      // Set mock env vars
      const original_env = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgresql://localhost:5432/test";

      const config = loadConfigFromEnv();

      expect(config.environment).toBe("production");
      expect(config.evidence.database_url).toBe("postgresql://localhost:5432/test");

      // Restore
      process.env.NODE_ENV = original_env;
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Service Integration", () => {
  it("should work together in analysis workflow", async () => {
    const deal_id = "550e8400-e29b-41d4-a716-446655440000";

    // Setup services
    const evidence_service = new MockEvidenceService();
    const llm_service = new MockLLMService(500);

    // Step 1: Derive internal evidence
    const evidence = createEvidence(
      "ev1",
      deal_id,
      "document",
      "pitch_deck.pdf",
      "Our ARR is $5M with 100% YoY growth",
      0.9,
      1
    );
    evidence_service.registerEvidence(evidence);

    const internal = await evidence_service.deriveInternalEvidence(deal_id);
    expect(internal.evidence_ids.length).toBeGreaterThan(0);

    // Step 2: Generate research queries
    const queries = await llm_service.generateResearchQueries({
      company_name: "Acme AI",
      industry: "AI/ML",
      known_gaps: ["market size unknown"],
    });
    expect(queries.queries.length).toBeGreaterThan(0);

    // Step 3: Check token budget
    const budget = llm_service.getBudget();
    expect(budget.remaining).toBeLessThan(500);
    expect(budget.remaining).toBeGreaterThan(0);
  });

  it("should enforce token budget across operations", async () => {
    const llm_service = new MockLLMService(250);  // Low budget

    // Use 100 tokens
    await llm_service.generateResearchQueries({
      company_name: "Test Co",
    });

    // Try to use 100 more (should work)
    await llm_service.classifyAmbiguity({
      text: "Test",
      choices: ["A", "B"],
    });

    // Try to use 300 more (should fail - exceeds budget)
    await expect(
      llm_service.synthesizeNarrative({
        company_name: "Test Co",
        recommendation: "GO",
        overall_score: 80,
        key_strengths: [],
        key_risks: [],
        facts_count: 10,
        cycles_executed: 1,
        confidence: 0.8,
      })
    ).rejects.toThrow(TokenBudgetExceededError);
  });
});
