import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock references (must be declared before vi.mock calls) ───────────────────
const updateJob = vi.fn(async () => undefined);
const updateJobProgress = vi.fn(async () => undefined);
const emitJobProgress = vi.fn(async () => undefined);
const getDocumentsForDealWithAnalysis = vi.fn(async (): Promise<any[]> => []);
const insertPhaseBRun = vi.fn(async () => undefined);
const getLatestPhaseBRun = vi.fn(async () => null);
const mockPoolQuery = vi.fn(async (_query: string, _params?: unknown[]) => ({ rows: [] as any[] }));
const getPool = vi.fn(() => ({ query: mockPoolQuery }));
const extractPhaseBFeaturesV1 = vi.fn(() => ({ features: [] }));
const fetchPhaseBVisualsFromDb = vi.fn(async () => []);
const materializePhaseBVisualEvidenceForDeal = vi.fn(async () => ({ inserted: 0, skipped: 0 }));
const generateAndPersistGovernedLlmOverviewBestEffort = vi.fn(async () => ({
  ok: true,
  input_hash: "abc123",
  inserted: true,
  validation_failed: false,
}));
const promoteSlideFactsFromDocumentPageUnderstanding = vi.fn(async () => undefined);
const populateDocumentPageUnderstandingFromVisualExtractions = vi.fn(async () => undefined);
const buildPhase1DealOverviewV2 = vi.fn(() => ({}));
const buildPhase1DealUnderstandingV1 = vi.fn(() => null);
const buildPhase1UpdateReportV1 = vi.fn(() => null);
const buildPhase1BusinessArchetypeV1 = vi.fn(() => null);
const mockAddToQueue = vi.fn(async () => undefined);
const getQueue = vi.fn(() => ({ add: mockAddToQueue }));
const mockAnalyze = vi.fn(async () => makeAnalyzeResult());
const hasTableMock = vi.fn((_pool: unknown, _table: string) => Promise.resolve(false));

// Intelligence / shadow-audit mocks
const runLLMFieldAuditShadow = vi.fn(async () => null as any);
const runLLMFinancialVerificationShadow = vi.fn(async () => null as any);
const runDeterministicValidatorShadow = vi.fn(async () => null as any);
const runLLMDecisionRationaleShadow = vi.fn(async () => null as any);
const runLLMRationaleValidationShadow = vi.fn(async () => null as any);
const synthesizeInvestmentInterpretationV1 = vi.fn(() => null);
const validateNarrativeQualityV1 = vi.fn(() => null);

// Policy-aware prompt runtime mocks
const composePolicyAwareSystemPrompt = vi.fn(() => ({
  systemPrompt: "test system prompt",
  runtimeMetadata: {
    selected_policy_id: null,
    template_version: "v1",
    prompt_artifacts: [],
  },
}));
const getSelectedPolicyIdFromAnyLike = vi.fn(() => null as string | null);
const validatePolicyAwareOutputTemplateV2 = vi.fn(() => ({
  ok: true,
  degraded: false,
  missing_sections: [],
  policy_mapping_valid: true,
  warnings: [],
}));

// Financial facts mocks
const getFinancialFactsForDeal = vi.fn(async () => [] as any[]);
const getDocumentsForReport = vi.fn(async () => [] as any[]);

// Registry population mocks
const populatePageRegistryV1 = vi.fn(async () => undefined);
const populateDealFactRegistryV1 = vi.fn(async () => undefined);
const populateFinancialFactRegistryV1 = vi.fn(async () => undefined);
const makeJobId = vi.fn((_type: string, parts: string[]) => `derived-${parts.join("-")}`);

// ── vi.mock registrations (hoisted) ──────────────────────────────────────────
vi.mock("../../../lib/worker-utils", () => ({
  updateJob,
  makeDevLogger: vi.fn(() => ({ log: vi.fn() })),
}));
vi.mock("../../../lib/job-progress", () => ({ updateJobProgress, emitJobProgress }));
vi.mock("../../../lib/db", () => ({
  getPool,
  getDocumentsForDealWithAnalysis,
  insertPhaseBRun,
  getLatestPhaseBRun,
}));
vi.mock("../../../lib/phaseb/extract", () => ({
  extractPhaseBFeaturesV1,
  fetchPhaseBVisualsFromDb,
}));
vi.mock("../../../lib/phaseb/materialize-evidence", () => ({
  materializePhaseBVisualEvidenceForDeal,
}));
vi.mock("../../../lib/governed-llm-overlay", () => ({
  generateAndPersistGovernedLlmOverviewBestEffort,
}));
vi.mock("../../../lib/promote-slide-facts", () => ({
  promoteSlideFactsFromDocumentPageUnderstanding,
}));
vi.mock("../../../lib/document-page-understanding", () => ({
  populateDocumentPageUnderstandingFromVisualExtractions,
}));
vi.mock("../../../lib/phase1/dealOverviewV2", () => ({
  buildPhase1DealOverviewV2,
  buildPhase1DealUnderstandingV1,
  buildPhase1UpdateReportV1,
}));
vi.mock("../../../lib/phase1/businessArchetypeV1", () => ({
  buildPhase1BusinessArchetypeV1,
}));
vi.mock("../../../lib/queue", () => ({ getQueue }));
vi.mock("../../../lib/heartbeat", () => ({
  startHeartbeat: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock("../../../lib/visual-extraction", () => ({
  hasTable: hasTableMock,
}));
vi.mock("../../../lib/intelligence/llm-auditor-hooks", () => ({
  runLLMFieldAuditShadow,
  runLLMFinancialVerificationShadow,
  runDeterministicValidatorShadow,
  runLLMDecisionRationaleShadow,
  runLLMRationaleValidationShadow,
}));
vi.mock("../../../lib/intelligence/investment-interpretation-synthesizer-v1", () => ({
  synthesizeInvestmentInterpretationV1,
}));
vi.mock("../../../lib/intelligence/narrative-quality-validator-v1", () => ({
  validateNarrativeQualityV1,
}));
vi.mock("../../../lib/policy-aware-prompt-runtime", () => ({
  composePolicyAwareSystemPrompt,
  getSelectedPolicyIdFromAnyLike,
  validatePolicyAwareOutputTemplateV2,
}));
vi.mock("../../../lib/db/financial-facts-db", () => ({
  getFinancialFactsForDeal,
  getDocumentsForReport,
  FINANCIAL_FACTS_ANALYSIS_LIMIT: 500,
}));
vi.mock("../../../lib/page-registry/populate-page-registry-v1", () => ({
  populatePageRegistryV1,
}));
vi.mock("../../../lib/deal-facts/populate-deal-fact-registry-v1", () => ({
  populateDealFactRegistryV1,
}));
vi.mock("../../../lib/financial-facts/populate-financial-fact-registry-v1", () => ({
  populateFinancialFactRegistryV1,
}));
vi.mock("../../../lib/job-id", () => ({ makeJobId }));
vi.mock("@dealdecision/core", () => ({
  generatePhase1DIOV1: vi.fn(() => ({})),
  DealOrchestrator: vi.fn().mockImplementation(() => ({
    analyze: mockAnalyze,
  })),
  DIOStorageImpl: vi.fn().mockImplementation(() => ({})),
  compileDIOToReport: vi.fn(() => ({})),
  compileDIOToReportWithPromotedFacts: vi.fn(() => ({})),
  SlideSequenceAnalyzer: vi.fn(),
  MetricBenchmarkValidator: vi.fn(),
  VisualDesignScorer: vi.fn(),
  NarrativeArcDetector: vi.fn(),
  FinancialHealthCalculator: vi.fn(),
  RiskAssessmentEngine: vi.fn(),
  FinancialIntegrityAnalyzerV1: vi.fn(),
  sanitizeText: vi.fn((s: string) => s ?? ""),
}));
vi.mock("../../../lib/llm/providers/openai-provider", () => ({
  OpenAIGPT4oProvider: vi.fn(),
}));
vi.mock("../../../lib/pdf_v2/slide-understanding-v1", () => ({
  applySlideUnderstandingV1Shadow: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeAnalyzeResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    dio: { phase1: {}, overall_score: 85 },
    storage_result: {
      dio_id: "dio-test-123",
      version: 1,
      is_duplicate: false,
    },
    error: null,
    ...overrides,
  };
}

function makeEligibleDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-test-1",
    status: "completed",
    type: "pitch_deck",
    title: "Test Pitch Deck",
    extraction_metadata: { pages: 10, doc_kind: "pdf" },
    structured_data: null,
    full_text: "This is test content for a startup pitch deck.",
    full_content: null,
    full_text_absent_reason: null,
    page_count: 10,
    verification_status: null,
    verification_result: null,
    ...overrides,
  };
}

function makeJob(data: Record<string, unknown> = {}, id = "job-ad-1") {
  return {
    id,
    name: "analyze_deal",
    data,
    updateProgress: vi.fn(async () => undefined),
    log: vi.fn(),
  } as any;
}

/**
 * Default smart pool query dispatcher.
 * Returns sensible rows for each known query category.
 */
function makeDefaultPoolQuery() {
  return async (query: string, params?: unknown[]) => {
    const q = String(query).replace(/\s+/g, " ").trim();

    // Promoted facts evidence_items lookup (raise_terms_v1 / business_model_v1)
    if (q.includes("FROM evidence_items") && q.includes("evidence_id = $1") && Array.isArray(params)) {
      return { rows: [] };
    }

    // Company name lookup
    if (q.includes("SELECT name") && q.includes("FROM deals")) {
      return { rows: [{ name: "Test Deal" }] };
    }

    // Evidence item count
    if (q.includes("COUNT(*)") && q.includes("AS count") && q.includes("FROM evidence_items")) {
      return { rows: [{ count: "3" }] };
    }

    // Financial facts self-heal count — return non-zero to skip self-heal
    if (q.includes("COUNT(*)") && q.includes("AS c") && q.includes("FROM financial_facts_v1")) {
      return { rows: [{ c: "5" }] };
    }

    // DIO report UPDATE
    if (q.includes("'{report}'")) {
      return { rows: [{ persisted: true }], rowCount: 1 };
    }

    // Ingestion reports cache invalidation DELETE
    if (q.includes("DELETE FROM ingestion_reports")) {
      return { rows: [], rowCount: 1 };
    }

    // Evidence items DELETE (suppress path)
    if (q.includes("DELETE FROM evidence_items")) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  };
}

// ── Global test setup ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://localhost/test";
  delete process.env.INVESTOR_INSIGHTS_ENABLED;
  delete process.env.INVESTMENT_INTERPRETATION_SHADOW_MODE;
  mockPoolQuery.mockImplementation(makeDefaultPoolQuery());
  mockAnalyze.mockResolvedValue(makeAnalyzeResult());
  generateAndPersistGovernedLlmOverviewBestEffort.mockResolvedValue({
    ok: true,
    input_hash: "abc123",
    inserted: true,
    validation_failed: false,
  });
  hasTableMock.mockResolvedValue(false);
  getDocumentsForDealWithAnalysis.mockResolvedValue([]);
  buildPhase1DealOverviewV2.mockReturnValue({});
});

// ── Baseline tests (preserved) ────────────────────────────────────────────────
describe("analyzeDealProcessor — baseline", () => {
  it("is a function that can be imported", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    expect(typeof analyzeDealProcessor).toBe("function");
  });

  it("replaces startup-style promoted business model under real-estate policy", async () => {
    const { resolvePromotedBusinessModelForPolicy } = await import("../processor.js");

    const out = resolvePromotedBusinessModelForPolicy({
      selectedPolicyId: "real_estate_underwriting",
      promotedDisplay: "Omnichannel (DTC + Wholesale/Retail)",
      promotedRawText: "Preferred equity strategy with asset-backed downside protection.",
      currentDisplay: null,
    });

    expect(out.action).toBe("replace");
    expect(out.reason).toMatch(/real_estate/i);
    expect(out.display).toBe("Real estate investment (preferred equity)");
  });

  it("early-exits with ok: false when deal_id is absent and DB lookup returns null", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const job = makeJob({});
    const result = await analyzeDealProcessor(job);

    expect(result).toMatchObject({ ok: false });
    expect(updateJob).toHaveBeenCalledWith(job, "failed", expect.stringContaining("deal_id"), 100);
    expect(getDocumentsForDealWithAnalysis).not.toHaveBeenCalled();
  });

  it("early-exits with ok: false when deal_id is present but no eligible documents", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([]);

    const job = makeJob({ deal_id: "deal-test-123" });
    const result = await analyzeDealProcessor(job);

    expect(result).toMatchObject({ ok: false });
    expect(updateJob).toHaveBeenCalledWith(job, "failed", expect.stringContaining("document"), 100);
  });

  it("early-exits with ok: false when all documents lack extraction_metadata", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([
      { id: "doc-1", status: "completed", extraction_metadata: null },
      { id: "doc-2", status: "pending", extraction_metadata: { pages: 10 } },
    ]);

    const job = makeJob({ deal_id: "deal-test-456" });
    const result = await analyzeDealProcessor(job);

    expect(result).toMatchObject({ ok: false });
    expect(updateJob).toHaveBeenCalledWith(job, "failed", expect.stringContaining("document"), 100);
  });
});

// ── Priority 1: Happy path ────────────────────────────────────────────────────
describe("analyzeDealProcessor — happy path", () => {
  it("succeeds end-to-end: eligible doc → orchestrator.analyze succeeds → updateJob('succeeded')", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    const job = makeJob({ deal_id: "deal-happy-1" });
    const result = await analyzeDealProcessor(job);

    expect(result).toMatchObject({
      ok: true,
      dio_id: "dio-test-123",
      version: 1,
      is_duplicate: false,
    });
    expect(mockAnalyze).toHaveBeenCalledOnce();
    expect(updateJob).toHaveBeenLastCalledWith(
      job,
      "succeeded",
      expect.stringContaining("version=1"),
      100
    );
  });

  it("returns ok: false and calls updateJob('failed') when orchestrator.analyze reports failure", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    mockAnalyze.mockResolvedValue({
      success: false,
      dio: null,
      storage_result: null,
      error: "orchestrator failed",
    });

    const job = makeJob({ deal_id: "deal-fail-1" });
    const result = await analyzeDealProcessor(job);

    expect(result).toMatchObject({ ok: false, error: "orchestrator failed" });
    expect(updateJob).toHaveBeenLastCalledWith(job, "failed", "orchestrator failed", 100);
  });

  it("persists compiled report to DIO — UPDATE fires with correct dio_id and includes updated_at", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    const job = makeJob({ deal_id: "deal-happy-persist" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    // Second parameter (params array): [JSON.stringify(compiledReport), dioIdToUpdate]
    expect(updateCall![1][1]).toBe("dio-test-123");
    // The UPDATE query itself must stamp updated_at
    expect(String(updateCall![0])).toContain("updated_at = now()");
  });

  it("invalidates ingestion_reports cache after persisting compiled report", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    const job = makeJob({ deal_id: "deal-cache-inv" });
    await analyzeDealProcessor(job);

    const deleteCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("DELETE FROM ingestion_reports")
    );
    expect(deleteCall).toBeDefined();
  });
});

// ── Priority 2: Promoted facts mutation ──────────────────────────────────────
describe("analyzeDealProcessor — promoted facts mutation", () => {
  it("raise_terms_v1 promoted fact is injected into phase1_deal_overview_v2 passed to orchestrator", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    // Return a raise_terms_v1 row from evidence_items
    mockPoolQuery.mockImplementation(async (query: string, params?: unknown[]) => {
      const q = String(query).replace(/\s+/g, " ").trim();

      if (q.includes("FROM evidence_items") && q.includes("evidence_id = $1") && Array.isArray(params)) {
        const evidenceId = String(params[0] ?? "");
        if (evidenceId.includes("raise_terms_v1")) {
          return {
            rows: [
              {
                source_document_id: "doc-test-1",
                source_path: null,
                extracted_at: "2024-01-01T00:00:00.000Z",
                confidence: 0.92,
                content_json: {
                  value_json: { display: "Pre-Seed $2M", raw_text: "raising $2M pre-seed round" },
                  provenance: { page_index: 4 },
                },
                meta: {},
              },
            ],
          };
        }
        return { rows: [] };
      }

      return makeDefaultPoolQuery()(query, params);
    });

    const job = makeJob({ deal_id: "deal-pf-raise" });
    await analyzeDealProcessor(job);

    // orchestrator.analyze must have been called with the promoted raise in phase1_deal_overview_v2
    const analyzeArgs = mockAnalyze.mock.calls[0]?.[0];
    expect(analyzeArgs?.input_data?.phase1_deal_overview_v2).toMatchObject({
      raise: "Pre-Seed $2M",
    });
    // sources should include a promoted note
    expect(analyzeArgs?.input_data?.phase1_deal_overview_v2?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ note: expect.stringContaining("raise_terms_v1") }),
      ])
    );
  });

  it("business_model_v1 suppress path fires DELETE FROM evidence_items", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    // Return a business_model_v1 row whose rawText is empty → null → stale DTC suppress path
    mockPoolQuery.mockImplementation(async (query: string, params?: unknown[]) => {
      const q = String(query).replace(/\s+/g, " ").trim();

      if (q.includes("FROM evidence_items") && q.includes("evidence_id = $1") && Array.isArray(params)) {
        const evidenceId = String(params[0] ?? "");
        if (evidenceId.includes("business_model_v1")) {
          return {
            rows: [
              {
                source_document_id: "doc-test-1",
                source_path: null,
                extracted_at: "2024-01-01T00:00:00.000Z",
                confidence: 0.7,
                // display="DTC eCommerce" (isDtcLabel); raw_text="" → rawText null; currentDisplay null → suppress
                content_json: {
                  value_json: { display: "DTC eCommerce", raw_text: "" },
                  provenance: { page_index: 2 },
                },
                meta: {},
              },
            ],
          };
        }
        return { rows: [] };
      }

      return makeDefaultPoolQuery()(query, params);
    });

    const job = makeJob({ deal_id: "deal-pf-suppress" });
    await analyzeDealProcessor(job);

    const suppressDeleteCall = mockPoolQuery.mock.calls.find(
      ([q, p]) =>
        typeof q === "string" &&
        q.includes("DELETE FROM evidence_items") &&
        Array.isArray(p) &&
        String(p[0]).includes("business_model_v1")
    );
    expect(suppressDeleteCall).toBeDefined();
  });

  it("both promoted facts are reflected in phase1_deal_overview_v2 when both are present", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    mockPoolQuery.mockImplementation(async (query: string, params?: unknown[]) => {
      const q = String(query).replace(/\s+/g, " ").trim();

      if (q.includes("FROM evidence_items") && q.includes("evidence_id = $1") && Array.isArray(params)) {
        const evidenceId = String(params[0] ?? "");
        if (evidenceId.includes("raise_terms_v1")) {
          return {
            rows: [
              {
                source_document_id: "doc-test-1",
                source_path: null,
                extracted_at: "2024-01-01T00:00:00.000Z",
                confidence: 0.9,
                content_json: {
                  value_json: { display: "Series A $5M", raw_text: "Series A round of $5M" },
                  provenance: { page_index: 1 },
                },
                meta: {},
              },
            ],
          };
        }
        if (evidenceId.includes("business_model_v1")) {
          return {
            rows: [
              {
                source_document_id: "doc-test-1",
                source_path: null,
                extracted_at: "2024-01-01T00:00:00.000Z",
                confidence: 0.88,
                content_json: {
                  // non-DTC label with explicit raw text → accept path
                  value_json: { display: "SaaS subscription", raw_text: "monthly recurring subscription model" },
                  provenance: { page_index: 3 },
                },
                meta: {},
              },
            ],
          };
        }
        return { rows: [] };
      }

      return makeDefaultPoolQuery()(query, params);
    });

    const job = makeJob({ deal_id: "deal-pf-both" });
    await analyzeDealProcessor(job);

    const analyzeArgs = mockAnalyze.mock.calls[0]?.[0];
    expect(analyzeArgs?.input_data?.phase1_deal_overview_v2).toMatchObject({
      raise: "Series A $5M",
      business_model: "SaaS subscription",
    });
  });
});

// ── Priority 3: Governed overview / investor insights coupling ────────────────
describe("analyzeDealProcessor — governed overview / investor insights coupling", () => {
  it("enqueues investor_insights when overviewOk=true, INVESTOR_INSIGHTS_ENABLED=true, and !isFirstPass", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    process.env.INVESTOR_INSIGHTS_ENABLED = "true";

    const job = makeJob({ deal_id: "deal-inv-enqueue" });
    await analyzeDealProcessor(job);

    expect(mockAddToQueue).toHaveBeenCalledOnce();
    expect(mockAddToQueue).toHaveBeenCalledWith(
      "generate_investor_insights",
      expect.objectContaining({ deal_id: "deal-inv-enqueue", engine_version: "v1" }),
      expect.objectContaining({ attempts: 3 })
    );
    expect(updateJob).toHaveBeenLastCalledWith(job, "succeeded", expect.any(String), 100);
  });

  it("does NOT enqueue investor_insights when isFirstPass=true even if overviewOk=true", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    process.env.INVESTOR_INSIGHTS_ENABLED = "true";

    const job = makeJob({ deal_id: "deal-inv-firstpass", reason: "first_pass_pages_ready" });
    await analyzeDealProcessor(job);

    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenLastCalledWith(job, "succeeded", expect.any(String), 100);
  });

  it("produces 'succeeded_with_warnings' and does NOT enqueue when overviewOk=false", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    process.env.INVESTOR_INSIGHTS_ENABLED = "true";
    generateAndPersistGovernedLlmOverviewBestEffort.mockResolvedValue({
      ok: false,
      input_hash: null,
      inserted: false,
      validation_failed: true,
    });

    const job = makeJob({ deal_id: "deal-inv-nowarn" });
    await analyzeDealProcessor(job);

    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenLastCalledWith(
      job,
      "succeeded_with_warnings",
      expect.stringContaining("governed overview"),
      100
    );
  });

  it("does NOT enqueue when INVESTOR_INSIGHTS_ENABLED is not set, even if overviewOk=true", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    // INVESTOR_INSIGHTS_ENABLED not set (deleted in global beforeEach)

    const job = makeJob({ deal_id: "deal-inv-disabled" });
    await analyzeDealProcessor(job);

    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenLastCalledWith(job, "succeeded", expect.any(String), 100);
  });
});

// ── Priority 4: DIO persistence ordering ─────────────────────────────────────
describe("analyzeDealProcessor — DIO persistence", () => {
  it("UPDATE targets the correct DIO ID from storage_result", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    mockAnalyze.mockResolvedValue(
      makeAnalyzeResult({
        storage_result: { dio_id: "dio-specific-456", version: 2, is_duplicate: false },
      })
    );

    const job = makeJob({ deal_id: "deal-persist-order" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1][1]).toBe("dio-specific-456");
  });

  it("ingestion_reports DELETE occurs AFTER DIO report UPDATE", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    const job = makeJob({ deal_id: "deal-order-check" });
    await analyzeDealProcessor(job);

    const queryStrings = mockPoolQuery.mock.calls.map(([q]) => String(q));
    const updateIdx = queryStrings.findIndex((q) => q.includes("'{report}'"));
    const deleteIdx = queryStrings.findIndex((q) => q.includes("DELETE FROM ingestion_reports"));

    expect(updateIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(deleteIdx);
  });

  it("does not issue a fallback DIO lookup when storage_result.dio_id is directly present", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    mockAnalyze.mockResolvedValue(makeAnalyzeResult());

    const job = makeJob({ deal_id: "deal-no-fallback" });
    await analyzeDealProcessor(job);

    // A fallback lookup would SELECT dio_id from deal_intelligence_objects without '{report}'
    const fallbackLookup = mockPoolQuery.mock.calls.find(([q]) => {
      const query = String(q ?? "");
      return (
        query.includes("SELECT dio_id") &&
        query.includes("FROM deal_intelligence_objects") &&
        !query.includes("'{report}'")
      );
    });
    expect(fallbackLookup).toBeUndefined();
  });
});

// ── Priority 5: compiledReport shadow mutation ────────────────────────────────
describe("analyzeDealProcessor — compiledReport shadow mutation", () => {
  it("llm_field_audit_v1 and llm_financial_verification_v1 are attached and persisted in the UPDATE", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    const fieldAuditPayload = { fields: [{ field: "revenue", status: "verified" }], audit_id: "fa-1" };
    const financialVerifPayload = { verified: true, verification_id: "fv-1", confidence: 0.9 };
    runLLMFieldAuditShadow.mockResolvedValue(fieldAuditPayload);
    runLLMFinancialVerificationShadow.mockResolvedValue(financialVerifPayload);

    const job = makeJob({ deal_id: "deal-shadow-1" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    const persistedReport = JSON.parse(String(updateCall![1][0]));
    expect(persistedReport.llm_field_audit_v1).toEqual(fieldAuditPayload);
    expect(persistedReport.llm_financial_verification_v1).toEqual(financialVerifPayload);
  });

  it("correction_lineage_v1 and llm_validation_summary_v1 are attached when Phase 3 validator runs", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    // Phase 3 runs when at least one of fieldAudit / financialVerif is non-null
    const fieldAuditPayload = { fields: [], audit_id: "fa-2" };
    const validatorPayload = {
      correction_lineage: { corrections: [{ original_field: "revenue", correction_type: "range_trim" }] },
      validation_summary: { overall_status: "passed", corrections_applied: 1 },
    };
    runLLMFieldAuditShadow.mockResolvedValue(fieldAuditPayload);
    runLLMFinancialVerificationShadow.mockResolvedValue(null);
    runDeterministicValidatorShadow.mockResolvedValue(validatorPayload);

    const job = makeJob({ deal_id: "deal-shadow-2" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    const persistedReport = JSON.parse(String(updateCall![1][0]));
    expect(persistedReport.correction_lineage_v1).toEqual([validatorPayload.correction_lineage]);
    expect(persistedReport.llm_validation_summary_v1).toEqual(validatorPayload.validation_summary);
  });

  it("Phase 4 decision rationale is attached and promoted to 'validated' when validator passes", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);

    // Make compileDIOToReportWithPromotedFacts return a report with a canonical verdict
    const { compileDIOToReportWithPromotedFacts } = await import("@dealdecision/core");
    (compileDIOToReportWithPromotedFacts as ReturnType<typeof vi.fn>).mockReturnValue({
      recommendation: "strong_proceed",
      archetype: "SaaS",
    });

    const rationalePayload = {
      rationale_text: "Strong unit economics and clear ICP drive conviction.",
      status: "shadow_only",
      run_id: "rat-1",
    };
    const validationPayload = { overall_status: "passed", run_id: "rat-val-1" };
    runLLMDecisionRationaleShadow.mockResolvedValue(rationalePayload);
    runLLMRationaleValidationShadow.mockResolvedValue(validationPayload);

    const job = makeJob({ deal_id: "deal-shadow-3" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    const persistedReport = JSON.parse(String(updateCall![1][0]));
    expect(persistedReport.llm_decision_rationale_v1).toMatchObject({
      rationale_text: "Strong unit economics and clear ICP drive conviction.",
      status: "validated",
      validation_run_id: "rat-val-1",
    });
    expect(persistedReport.llm_rationale_validation_v1).toEqual(validationPayload);
  });

  it("Phase 4 rationale is NOT attached when compiledReport has no canonical verdict", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([makeEligibleDoc()]);
    // Explicitly reset to {} (mockReturnValue survives vi.clearAllMocks, must be re-set manually)
    const { compileDIOToReportWithPromotedFacts } = await import("@dealdecision/core");
    (compileDIOToReportWithPromotedFacts as ReturnType<typeof vi.fn>).mockReturnValue({});
    // compiledReport = {} → canonicalVerdict = null → Phase 4 skipped

    runLLMDecisionRationaleShadow.mockResolvedValue({
      rationale_text: "Should not appear",
      status: "shadow_only",
    });

    const job = makeJob({ deal_id: "deal-shadow-4" });
    await analyzeDealProcessor(job);

    const updateCall = mockPoolQuery.mock.calls.find(([q]) =>
      typeof q === "string" && q.includes("'{report}'")
    );
    expect(updateCall).toBeDefined();
    const persistedReport = JSON.parse(String(updateCall![1][0]));
    expect(persistedReport.llm_decision_rationale_v1).toBeUndefined();
    expect(runLLMDecisionRationaleShadow).not.toHaveBeenCalled();
  });
});
