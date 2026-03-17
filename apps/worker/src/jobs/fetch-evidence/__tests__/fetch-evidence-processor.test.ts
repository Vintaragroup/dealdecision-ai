import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
const updateJob = vi.fn(async () => undefined);
const getPool = vi.fn();
const getDocumentsForDealWithAnalysis = vi.fn(async (): Promise<any[]> => []);
const deleteExtractionEvidenceForDeal = vi.fn(async () => undefined);
const deleteExtractionEvidenceForDocument = vi.fn(async () => undefined);
const insertEvidence = vi.fn(async () => undefined);
const getEvidenceDocumentIds = vi.fn(async (): Promise<string[]> => []);
const deriveEvidenceDrafts = vi.fn((): any[] => []);
const materializePhaseBVisualEvidenceForDeal = vi.fn(async () => ({ inserted: 0, skipped: 0 }));

vi.mock("../../../lib/worker-utils", () => ({ updateJob, makeDevLogger: vi.fn(() => ({ log: vi.fn() })) }));
vi.mock("../../../lib/db", () => ({
  getPool,
  getDocumentsForDealWithAnalysis,
  deleteExtractionEvidenceForDeal,
  deleteExtractionEvidenceForDocument,
  insertEvidence,
  getEvidenceDocumentIds,
}));
vi.mock("../../../lib/evidence", () => ({ deriveEvidenceDrafts }));
vi.mock("../../../lib/phaseb/materialize-evidence", () => ({ materializePhaseBVisualEvidenceForDeal }));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeJob(data: Record<string, unknown> = {}, id = "job-fe-1") {
  return {
    id,
    name: "fetch_evidence",
    data,
    updateProgress: vi.fn(async () => undefined),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("fetchEvidenceProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentsForDealWithAnalysis.mockResolvedValue([]);
    getEvidenceDocumentIds.mockResolvedValue([]);
    deriveEvidenceDrafts.mockReturnValue([]);
    materializePhaseBVisualEvidenceForDeal.mockResolvedValue({ inserted: 0, skipped: 0 });
  });

  it("is a function that can be imported", async () => {
    const { fetchEvidenceProcessor } = await import("../processor.js");
    expect(typeof fetchEvidenceProcessor).toBe("function");
  });

  it("early-exits with ok: false when deal_id is missing", async () => {
    const { fetchEvidenceProcessor } = await import("../processor.js");
    const job = makeJob({});  // no deal_id
    const result = await fetchEvidenceProcessor(job);

    expect(result).toMatchObject({ ok: false });
    expect(updateJob).toHaveBeenCalledWith(job, "failed", expect.stringContaining("deal_id"));
    // Should not attempt any DB reads
    expect(getDocumentsForDealWithAnalysis).not.toHaveBeenCalled();
  });

  it("early-exits with inserted: 0 when no documents are available", async () => {
    const { fetchEvidenceProcessor } = await import("../processor.js");
    getDocumentsForDealWithAnalysis.mockResolvedValue([]);

    const job = makeJob({ deal_id: "deal-abc" });
    const result = await fetchEvidenceProcessor(job);

    expect(result).toMatchObject({ inserted: 0 });
    expect(updateJob).toHaveBeenCalledWith(job, "succeeded", expect.stringContaining("No documents"));
    // Should not have tried to delete or insert evidence
    expect(deleteExtractionEvidenceForDeal).not.toHaveBeenCalled();
  });

  it("rebuilds extraction evidence and returns inserted count", async () => {
    const { fetchEvidenceProcessor } = await import("../processor.js");

    const doc = {
      id: "doc-1",
      deal_id: "deal-abc",
      title: "Pitch Deck",
      type: "pdf",
      status: "completed",
      uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      structured_data: {
        keyMetrics: [{ key: "ARR", value: "1M", source: "slide 3" }],
        mainHeadings: ["Executive Summary"],
        textSummary: "A great company.",
      },
    };

    getDocumentsForDealWithAnalysis.mockResolvedValue([doc]);
    getEvidenceDocumentIds.mockResolvedValue([]);
    deriveEvidenceDrafts.mockReturnValue([
      { document_id: "doc-1", source: "document", kind: "title", text: "Pitch Deck" },
    ]);

    const job = makeJob({ deal_id: "deal-abc" });
    const result = await fetchEvidenceProcessor(job);

    expect(result).toMatchObject({ inserted: 1 });
    expect(deleteExtractionEvidenceForDeal).toHaveBeenCalledWith({ dealId: "deal-abc" });
    // Metric + heading + summary should each insert evidence
    expect(insertEvidence).toHaveBeenCalledWith(expect.objectContaining({ kind: "metric" }));
    expect(insertEvidence).toHaveBeenCalledWith(expect.objectContaining({ kind: "section" }));
    expect(insertEvidence).toHaveBeenCalledWith(expect.objectContaining({ kind: "summary" }));
    expect(updateJob).toHaveBeenCalledWith(job, "succeeded", expect.any(String), 100);
  });

  it("emits phaseb_visual_evidence_materialization_failed log on materialize error", async () => {
    const { fetchEvidenceProcessor } = await import("../processor.js");

    getDocumentsForDealWithAnalysis.mockResolvedValue([
      {
        id: "doc-1", deal_id: "deal-abc", title: "Deck", type: "pdf",
        status: "completed", uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        structured_data: null,
      },
    ]);
    materializePhaseBVisualEvidenceForDeal.mockRejectedValue(new Error("phase B failure"));
    getEvidenceDocumentIds.mockResolvedValue([]);
    deriveEvidenceDrafts.mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const job = makeJob({ deal_id: "deal-abc" });
    await fetchEvidenceProcessor(job);

    const warned = consoleSpy.mock.calls.some((args) => {
      try { return JSON.parse(args[0]).event === "phaseb_visual_evidence_materialization_failed"; }
      catch { return false; }
    });
    expect(warned).toBe(true);
    consoleSpy.mockRestore();
  });
});
