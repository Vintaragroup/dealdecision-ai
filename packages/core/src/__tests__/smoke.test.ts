/**
 * Phase 2 & 3 Smoke Tests
 * Quick validation that all analyzers and services can be instantiated and run
 */

// Phase 2: Analyzers
import { slideSequenceAnalyzer } from "../analyzers/slide-sequence";
import { metricBenchmarkValidator } from "../analyzers/metric-benchmark";
import { visualDesignScorer } from "../analyzers/visual-design";
import { narrativeArcDetector } from "../analyzers/narrative-arc";
import { financialHealthCalculator } from "../analyzers/financial-health";
import { riskAssessmentEngine } from "../analyzers/risk-assessment";

// Phase 3: Services
import { MockMCPClient, createDefaultMCPConfig } from "../services/mcp/client";
import { MockEvidenceService, createEvidence } from "../services/evidence/service";
import { MockLLMService } from "../services/llm/service";

describe("Phase 2 & 3 Smoke Tests", () => {
  
  // ============================================================================
  // Phase 2: Analyzer Smoke Tests
  // ============================================================================
  
  describe("SlideSequenceAnalyzer", () => {
    test("should run without errors", async () => {
      const input = {
        headings: ["Problem", "Solution", "Market", "Product", "Team", "Ask"],
        evidence_ids: []
      };
      
      const result = await slideSequenceAnalyzer.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.status === "ok") {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      } else {
        expect(result.score).toBeNull();
      }
    });
  });

  describe("MetricBenchmarkValidator", () => {
    test("should run without errors", async () => {
      const input = {
        text: "Our ARR is $5M with 100% YoY growth",
        industry: "SaaS",
        evidence_ids: []
      };
      
      const result = await metricBenchmarkValidator.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.status === 'ok') {
        expect(result.overall_score).toBeGreaterThanOrEqual(0);
        expect(result.overall_score).toBeLessThanOrEqual(100);
      } else {
        expect(result.overall_score).toBeNull();
      }
    });
  });

  describe("VisualDesignScorer", () => {
    test("should run without errors", async () => {
      const input = {
        page_count: 12,
        file_size_bytes: 4200000,  // 4.2 MB
        total_text_chars: 5000,
        headings: ["Title", "Problem", "Solution"],
        evidence_ids: []
      };
      
      const result = await visualDesignScorer.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.design_score).toBeGreaterThanOrEqual(0);
      expect(result.design_score).toBeLessThanOrEqual(100);
    });
  });

  describe("NarrativeArcDetector", () => {
    test("should run without errors", async () => {
      const input = {
        slides: [
          { heading: "The Problem", text: "Customers struggle with X" },
          { heading: "Our Solution", text: "We solve X with Y" },
          { heading: "The Market", text: "Large and growing" }
        ],
        evidence_ids: []
      };
      
      const result = await narrativeArcDetector.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.pacing_score).toBeGreaterThanOrEqual(0);
      expect(result.pacing_score).toBeLessThanOrEqual(100);
    });
  });

  describe("FinancialHealthCalculator", () => {
    test("should run without errors", async () => {
      const input = {
        revenue: 5000000,
        expenses: 300000,
        cash_balance: 2000000,
        burn_rate: 300000,
        growth_rate: 1.0,
        evidence_ids: []
      };
      
      const result = await financialHealthCalculator.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.health_score).toBeGreaterThanOrEqual(0);
      expect(result.health_score).toBeLessThanOrEqual(100);
    });
  });

  describe("RiskAssessmentEngine", () => {
    test("should run without errors", async () => {
      const input = {
        pitch_text: "We are building AI for healthcare",
        documents: [{ full_text: "We are building AI for healthcare" }],
        evidence: [],
        headings: ["Problem", "Solution"],
        metrics: { revenue: 100000 },
        team_size: 5,
        evidence_ids: []
      };
      
      const result = await riskAssessmentEngine.analyze(input);
      
      expect(result).toBeDefined();
      expect(result.analyzer_version).toBe("1.0.0");
      expect(result.overall_risk_score).toBeGreaterThanOrEqual(0);
      expect(result.overall_risk_score).toBeLessThanOrEqual(100);
    });
  });

  // ============================================================================
  // Phase 3: Service Smoke Tests
  // ============================================================================

  describe("MockMCPClient", () => {
    test("should handle registered responses", async () => {
      const config = createDefaultMCPConfig();
      config.providers.gartner.enabled = true;
      
      const client = new MockMCPClient(config);
      client.registerResponse("gartner", "test_tool", { result: "success" }, 0.9);
      
      const response = await client.call("gartner", "test_tool", {});
      
      expect(response.success).toBe(true);
      expect(response.data.result).toBe("success");
      expect(response.confidence).toBe(0.9);
    });

    test("should handle missing tools", async () => {
      const config = createDefaultMCPConfig();
      const client = new MockMCPClient(config);
      
      const response = await client.call("gartner", "missing_tool", {});
      
      expect(response.success).toBe(false);
      expect(response.error).toContain("No mock response registered");
    });
  });

  describe("MockEvidenceService", () => {
    test("should store and retrieve evidence", async () => {
      const service = new MockEvidenceService();
      const deal_id = "550e8400-e29b-41d4-a716-446655440000";
      
      const evidence = createEvidence(
        "ev1",
        deal_id,
        "document",
        "test.pdf",
        "Test content",
        0.9
      );
      
      service.registerEvidence(evidence);
      
      const retrieved = await service.getEvidence("ev1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe("Test content");
    });

    test("should list evidence by deal", async () => {
      const service = new MockEvidenceService();
      const deal_id = "550e8400-e29b-41d4-a716-446655440000";
      
      service.registerEvidence(createEvidence("ev1", deal_id, "document", "file.pdf", "Content 1", 0.9));
      service.registerEvidence(createEvidence("ev2", deal_id, "document", "file.pdf", "Content 2", 0.8));
      
      const all = await service.listEvidence(deal_id);
      expect(all.length).toBe(2);
    });
  });

  describe("MockLLMService", () => {
    test("should generate research queries", async () => {
      const service = new MockLLMService(500);
      
      const response = await service.generateResearchQueries({
        company_name: "Test Co",
        industry: "AI/ML"
      });
      
      expect(response.queries.length).toBeGreaterThan(0);
      expect(response.usage.total_tokens).toBeLessThanOrEqual(100);
    });

    test("should track token budget", async () => {
      const service = new MockLLMService(500);
      
      const budget_before = service.getBudget();
      expect(budget_before.remaining).toBe(500);
      
      await service.generateResearchQueries({ company_name: "Test" });
      
      const budget_after = service.getBudget();
      expect(budget_after.remaining).toBeLessThan(500);
      expect(budget_after.used).toBeGreaterThan(0);
    });

    test("should synthesize narrative", async () => {
      const service = new MockLLMService(500);
      
      const response = await service.synthesizeNarrative({
        company_name: "Test Co",
        recommendation: "GO",
        overall_score: 85,
        key_strengths: ["Strong team"],
        key_risks: ["Early stage"],
        facts_count: 10,
        cycles_executed: 1,
        confidence: 0.8
      });
      
      expect(response.executive_summary).toContain("Test Co");
      expect(response.usage.total_tokens).toBeLessThanOrEqual(300);
    });
  });

  // ============================================================================
  // Integration: Verify all pieces work together
  // ============================================================================

  describe("Integration", () => {
    test("all analyzers can be imported and have metadata", () => {
      const analyzers = [
        slideSequenceAnalyzer,
        metricBenchmarkValidator,
        visualDesignScorer,
        narrativeArcDetector,
        financialHealthCalculator,
        riskAssessmentEngine
      ];

      analyzers.forEach(analyzer => {
        expect(analyzer.metadata).toBeDefined();
        expect(analyzer.metadata.version).toBe("1.0.0");
        expect(analyzer.metadata.name).toBeDefined();
      });
    });

    test("all services can be instantiated", () => {
      const mcp = new MockMCPClient(createDefaultMCPConfig());
      const evidence = new MockEvidenceService();
      const llm = new MockLLMService(500);

      expect(mcp).toBeDefined();
      expect(evidence).toBeDefined();
      expect(llm).toBeDefined();
    });
  });
});
