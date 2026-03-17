import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
const updateJob = vi.fn(async () => undefined);
const updateDocumentStatus = vi.fn(async () => undefined);
const updateDocumentAnalysis = vi.fn(async () => undefined);
const updateDocumentVerification = vi.fn(async () => undefined);
const getDocumentsForDealWithVerification = vi.fn(async (): Promise<any[]> => []);
const insertDocumentExtractionAudit = vi.fn(async () => undefined);
const verifyDocumentExtraction = vi.fn(() => ({
  overall_score: 0.9,
  checks: [],
  warnings: [],
}));
const remediateStructuredData = vi.fn((input: any) => ({
  structuredData: input.structuredData,
  changes: [],
}));

vi.mock("../../../lib/worker-utils", () => ({ updateJob, makeDevLogger: vi.fn(() => ({ log: vi.fn() })) }));
vi.mock("../../../lib/db", () => ({
  updateDocumentStatus,
  updateDocumentAnalysis,
  updateDocumentVerification,
  getDocumentsForDealWithVerification,
  insertDocumentExtractionAudit,
}));
vi.mock("../../../lib/verification", () => ({ verifyDocumentExtraction }));
vi.mock("../../../lib/remediation", () => ({ remediateStructuredData }));
vi.mock("../../../lib/processors", () => ({}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeJob(data: Record<string, unknown> = {}, id = "job-re-1") {
  return {
    id,
    name: "remediate_extraction",
    data,
    updateProgress: vi.fn(async () => undefined),
  } as any;
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    deal_id: "deal-abc",
    title: "Test Doc",
    status: "completed",
    verification_status: "failed",
    verification_result: null,
    structured_data: { keyMetrics: [], mainHeadings: [], textSummary: "", entities: [] },
    extraction_metadata: null,
    full_content: null,
    full_text: "Some text content.",
    page_count: 5,
    uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("remediateExtractionProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentsForDealWithVerification.mockResolvedValue([]);
    verifyDocumentExtraction.mockReturnValue({ overall_score: 0.9, checks: [], warnings: [] });
    remediateStructuredData.mockImplementation((input: any) => ({
      structuredData: input.structuredData,
      changes: [],
    }));
  });

  it("is a function that can be imported", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    expect(typeof remediateExtractionProcessor).toBe("function");
  });

  it("early-exits with ok: false when deal_id is missing", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    const job = makeJob({});  // no deal_id

    const result = await remediateExtractionProcessor(job);

    expect(result).toMatchObject({ ok: false });
    expect(updateJob).toHaveBeenCalledWith(job, "failed", expect.stringContaining("deal_id"));
    expect(getDocumentsForDealWithVerification).not.toHaveBeenCalled();
  });

  it("early-exits when no documents are found for the deal", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    getDocumentsForDealWithVerification.mockResolvedValue([]);

    const job = makeJob({ deal_id: "deal-abc" });
    const result = await remediateExtractionProcessor(job);

    expect(result).toMatchObject({ ok: true, remediated: 0 });
    expect(updateJob).toHaveBeenCalledWith(job, "succeeded", expect.stringContaining("No documents"), 100);
    expect(insertDocumentExtractionAudit).not.toHaveBeenCalled();
  });

  it("early-exits when no documents match remediation criteria", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    // completed doc with verification_status = "verified" — not a candidate
    getDocumentsForDealWithVerification.mockResolvedValue([
      makeDoc({ verification_status: "verified" }),
    ]);

    const job = makeJob({ deal_id: "deal-abc" });
    const result = await remediateExtractionProcessor(job);

    expect(result).toMatchObject({ ok: true, remediated: 0 });
    expect(updateJob).toHaveBeenCalledWith(job, "succeeded", expect.stringContaining("No documents matched"), 100);
    expect(insertDocumentExtractionAudit).not.toHaveBeenCalled();
  });

  it("remediates failed documents and updates verification status", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    getDocumentsForDealWithVerification.mockResolvedValue([
      makeDoc({ verification_status: "failed" }),
    ]);
    verifyDocumentExtraction.mockReturnValue({ overall_score: 0.85, checks: [], warnings: [] });

    const job = makeJob({ deal_id: "deal-abc" });
    const result = await remediateExtractionProcessor(job);

    expect(result).toMatchObject({ ok: true, remediated: 1, verifiedAfter: 1 });
    expect(insertDocumentExtractionAudit).toHaveBeenCalledOnce();
    expect(updateDocumentAnalysis).toHaveBeenCalledOnce();
    expect(updateDocumentVerification).toHaveBeenCalledWith(
      expect.objectContaining({ verificationStatus: "verified" })
    );
    expect(updateDocumentStatus).toHaveBeenCalledWith("doc-1", "ready_for_analysis");
    expect(updateJob).toHaveBeenCalledWith(job, "succeeded", expect.stringContaining("Remediation complete"), 100);
  });

  it("includes warning-status docs when include_warnings flag is set", async () => {
    const { remediateExtractionProcessor } = await import("../processor.js");
    getDocumentsForDealWithVerification.mockResolvedValue([
      makeDoc({ verification_status: "warnings" }),
    ]);
    // Score below 0.8 but above 0.5 → warnings
    verifyDocumentExtraction.mockReturnValue({ overall_score: 0.65, checks: [], warnings: [] });

    const job = makeJob({ deal_id: "deal-abc", include_warnings: true });
    const result = await remediateExtractionProcessor(job);

    expect(result).toMatchObject({ ok: true, remediated: 1, warningsAfter: 1 });
  });
});
