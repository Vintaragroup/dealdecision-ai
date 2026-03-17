import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (must precede imports of the processor) ─────────────────────────────
const updateJob = vi.fn(async () => undefined);
const updateJobProgress = vi.fn(async () => undefined);
const emitJobProgress = vi.fn(async () => undefined);
const getDocumentsForDealWithAnalysis = vi.fn(async (): Promise<any[]> => []);
const insertPhaseBRun = vi.fn(async () => undefined);
const getLatestPhaseBRun = vi.fn(async () => null);
const mockPoolQuery = vi.fn(async () => ({ rows: [] }));
const getPool = vi.fn(() => ({ query: mockPoolQuery }));
const extractPhaseBFeaturesV1 = vi.fn(async () => ({ features: [] }));
const fetchPhaseBVisualsFromDb = vi.fn(async () => []);
const materializePhaseBVisualEvidenceForDeal = vi.fn(async () => ({ inserted: 0, skipped: 0 }));
const generateAndPersistGovernedLlmOverviewBestEffort = vi.fn(async () => undefined);
const promoteSlideFactsFromDocumentPageUnderstanding = vi.fn(async () => undefined);
const populateDocumentPageUnderstandingFromVisualExtractions = vi.fn(async () => undefined);
const buildPhase1DealOverviewV2 = vi.fn(async () => null);
const buildPhase1DealUnderstandingV1 = vi.fn(async () => null);
const buildPhase1UpdateReportV1 = vi.fn(async () => null);
const buildPhase1BusinessArchetypeV1 = vi.fn(async () => null);
const getQueue = vi.fn(() => ({ add: vi.fn(async () => undefined) }));

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
  hasTable: vi.fn(() => false),
}));
vi.mock("@dealdecision/core", () => ({
  generatePhase1DIOV1: vi.fn(async () => ({})),
  DealOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn(async () => ({ phases: [], metadata: {} })),
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
  sanitizeText: vi.fn((s: string) => s ?? ""),
}));
vi.mock("../../../lib/llm/providers/openai-provider", () => ({
  OpenAIGPT4oProvider: vi.fn(),
}));
vi.mock("../../../lib/pdf_v2/slide-understanding-v1", () => ({
  applySlideUnderstandingV1Shadow: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeJob(data: Record<string, unknown> = {}, id = "job-ad-1") {
  return {
    id,
    name: "analyze_deal",
    data,
    updateProgress: vi.fn(async () => undefined),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("analyzeDealProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    getDocumentsForDealWithAnalysis.mockResolvedValue([]);
  });

  it("is a function that can be imported", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    expect(typeof analyzeDealProcessor).toBe("function");
  });

  it("early-exits with ok: false when deal_id is absent and DB lookup returns null", async () => {
    const { analyzeDealProcessor } = await import("../processor.js");
    // no deal_id in data; pool query returns no rows → getDealIdForJob returns null
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
