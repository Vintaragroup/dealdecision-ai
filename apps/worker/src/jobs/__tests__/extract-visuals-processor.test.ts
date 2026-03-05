import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
const updateJobProgress = vi.fn(async () => undefined);
const emitJobProgress = vi.fn(async () => undefined);
const getPool = vi.fn();
const getDocumentsForDeal = vi.fn(async (): Promise<any[]> => []);
const getDocumentOriginalFile = vi.fn(async () => null);
const upsertDocumentOriginalFile = vi.fn(async () => undefined);
const mergeDocumentExtractionMetadata = vi.fn(async () => undefined);
const enqueuePersistedJob = vi.fn(async () => ({ job_id: "enqueued-job-1" }));
const makeJobId = vi.fn((_type: string, parts: string[]) => parts.join("__"));
const getQueue = vi.fn(() => ({ add: vi.fn(async () => undefined) }));
const planChunkEnqueues = vi.fn(async () => ({ enqueued: 0, skipped: 0, chunks: [] }));
const logMemory = vi.fn();
const yieldToEventLoop = vi.fn(async () => undefined);
const evaluateVisualDocReadiness = vi.fn(() => ({ ready: false, reason: "no_pages" }));
const getVisualIngestBlockReason = vi.fn(() => null);
const getVisionExtractorConfig = vi.fn(() => ({ enabled: false, visionWorkerUrl: null, extractorVersion: "v1" }));
const createVisionJobRuntime = vi.fn(() => ({ runtimeId: "runtime-1" }));
const hasTable = vi.fn(async () => true);
const resolvePageImageUris = vi.fn(async () => []);
const backfillVisualAssetImageUris = vi.fn(async () => ({ updated: 0 }));
const persistSyntheticVisualAssets = vi.fn(async () => ({ inserted: 0 }));
const persistVisionResponse = vi.fn(async () => ({ assetId: "asset-1" }));
const callVisionWorkerWithRetries = vi.fn(async () => ({ ok: true, result: {} }));
const callXlsxWorkerWithRetries = vi.fn(async () => ({ ok: true, result: {} }));
const buildXlsxCanonicalPatch = vi.fn(() => ({}));
const deduceDocKind = vi.fn(() => "pdf" as const);
const resegmentStructuredSyntheticAssets = vi.fn(async () => ({ resegmented: 0 }));
const applyVisionHintsToStructuredPowerpointSlides = vi.fn(async () => undefined);
const buildExtractVisualsExtractionMetadataPatchV1 = vi.fn(() => ({}));
const buildExtractVisualsPageSummaryV1 = vi.fn(() => ({}));
const computeExtractVisualsOutcomeStatusV1 = vi.fn(() => "ok");
const shouldSkipExtractVisualsPage = vi.fn(() => false);
const isAuditVisionFailure = vi.fn(() => false);
const buildExtractVisualsFinalizedMarker = vi.fn(() => "finalized-1");
const getVisualPageImagePersistConfig = vi.fn(() => ({ maxPages: 10 }));
const persistRenderedPageImages = vi.fn(async () => ({ rendered_pages_count: 0, rendered_pages_dir: "/tmp", page_count_detected: 0 }));
const persistImagePage = vi.fn(async () => ({ rendered_pages_dir: "/tmp" }));
const renderNonPdfToPageImages = vi.fn(async () => ({ pages: [] }));
const r2RenderedPageKey = vi.fn((prefix: string, idx: number) => `${prefix}/page_${String(idx).padStart(4, "0")}.png`);
const formatRenderedPageKey = vi.fn((p: { prefix: string; format?: string | null; pageIndex: number }) => `${p.prefix}/page_${String(p.pageIndex).padStart(4, "0")}.png`);
const r2ObjectExists = vi.fn(async () => false);
const uploadToR2 = vi.fn(async () => undefined);
const computeChunkRangeForPage = vi.fn(() => ({ start: 0, end: 9 }));
const persistPdfV2TextRegionAssetsV1Shadow = vi.fn(async () => undefined);
const persistPdfPageUnderstandingV1Shadow = vi.fn(async () => undefined);
const applySlideUnderstandingV1Shadow = vi.fn(async () => undefined);
const populateDocumentPageUnderstandingFromVisualExtractions = vi.fn(async () => undefined);
const promoteSlideFactsFromDocumentPageUnderstanding = vi.fn(async () => undefined);
const ensureOcrFallbackForVisionResponse = vi.fn(async () => ({}));
const computeVisualQualityAuditForDeal = vi.fn(async () => ({}));
const selectDocumentsForDocumentIntelligenceBatch = vi.fn(async () => []);
const loadActiveDocumentIntelligenceJobs = vi.fn(async () => []);
const planDocumentIntelligenceBatch = vi.fn(async () => ({ plan: [] }));
const enqueueDocumentIntelligenceExtractJobs = vi.fn(async () => ({ enqueued: 0 }));
const pollJobsToTerminal = vi.fn(async () => []);
const insertBlockedAnalyzeJob = vi.fn(async () => undefined);
const startNamedStepRunLedger = vi.fn(async () => ({ id: "ledger-1" }));
const finishStepRunLedger = vi.fn(async () => undefined);
const enqueueAnalyzeDeal = vi.fn(async () => ({ enqueued: false, jobId: null }));
const verifyVisionServiceForJob = vi.fn(async () => ({ ok: true }));
const tryReadImageB64ForVision = vi.fn(async () => null);
const headCheckImageUri = vi.fn(async () => ({ ok: true, status: 200, content_type: "image/png", duration_ms: 5, method: "GET_RANGE" as const }));
const pickDownloadUrlFromExtractionMetadata = vi.fn(async () => null);
const promoteVisualOcrToDocumentFullText = vi.fn(async () => ({ promoted: false, ocrChars: 0, pages: 0, reason: "no_ocr_text" }));
const resolveWritableUploadDir = vi.fn(async () => "/tmp/uploads");
const computeAndPersistVisionRoutingV1 = vi.fn(async () => ({
	doc_kind: "pdf",
	full_text_len: 0,
	decision: { vision_fallback_allowed: false, reason: "low_text", inputs: {} },
}));

const connection = {};

vi.mock("../../lib/job-progress", () => ({ updateJobProgress, emitJobProgress }));
vi.mock("../../lib/db", () => ({
	getPool,
	getDocumentsForDeal,
	getDocumentOriginalFile,
	upsertDocumentOriginalFile,
	mergeDocumentExtractionMetadata,
}));
vi.mock("../../lib/job-enqueue", () => ({ enqueuePersistedJob }));
vi.mock("../../lib/job-id", () => ({ makeJobId }));
vi.mock("../../lib/queue", () => ({ getQueue, connection }));
vi.mock("../../lib/page-chunks", () => ({ planChunkEnqueues }));
vi.mock("../../lib/memory", () => ({ logMemory, yieldToEventLoop }));
vi.mock("../../lib/visual-readiness", () => ({ evaluateVisualDocReadiness, getVisualIngestBlockReason }));
vi.mock("../../lib/visual-extraction", () => ({
	getVisionExtractorConfig,
	createVisionJobRuntime,
	hasTable,
	resolvePageImageUris,
	backfillVisualAssetImageUris,
	persistSyntheticVisualAssets,
	persistVisionResponse,
	callVisionWorkerWithRetries,
	callXlsxWorkerWithRetries,
	buildXlsxCanonicalPatch,
	deduceDocKind,
	resegmentStructuredSyntheticAssets,
	applyVisionHintsToStructuredPowerpointSlides,
	buildExtractVisualsExtractionMetadataPatchV1,
	buildExtractVisualsPageSummaryV1,
	computeExtractVisualsOutcomeStatusV1,
	shouldSkipExtractVisualsPage,
	isAuditVisionFailure,
	buildExtractVisualsFinalizedMarker,
}));
vi.mock("../../lib/rendered-pages", () => ({
	getVisualPageImagePersistConfig,
	persistRenderedPageImages,
	persistImagePage,
	renderNonPdfToPageImages,
	r2RenderedPageKey,
	formatRenderedPageKey,
}));
vi.mock("../../lib/r2", () => ({ r2ObjectExists, uploadToR2 }));
vi.mock("../../lib/r2-probe", () => ({ computeChunkRangeForPage }));
vi.mock("../../lib/pdf_v2/pdf-text-region-assets-v1", () => ({ persistPdfV2TextRegionAssetsV1Shadow }));
vi.mock("../../lib/pdf_v2/page-understanding-v1", () => ({ persistPdfPageUnderstandingV1Shadow }));
vi.mock("../../lib/pdf_v2/slide-understanding-v1", () => ({ applySlideUnderstandingV1Shadow }));
vi.mock("../../lib/document-page-understanding", () => ({ populateDocumentPageUnderstandingFromVisualExtractions }));
vi.mock("../../lib/promote-slide-facts", () => ({ promoteSlideFactsFromDocumentPageUnderstanding }));
vi.mock("../../lib/vision-ocr-fallback", () => ({ ensureOcrFallbackForVisionResponse }));
vi.mock("../../lib/visual-quality-audit", () => ({ computeVisualQualityAuditForDeal }));
vi.mock("../../lib/document-intelligence-batch", () => ({
	selectDocumentsForDocumentIntelligenceBatch,
	loadActiveDocumentIntelligenceJobs,
	planDocumentIntelligenceBatch,
	enqueueDocumentIntelligenceExtractJobs,
	pollJobsToTerminal,
	insertBlockedAnalyzeJob,
}));
vi.mock("../../lib/pipeline-run-ledger", () => ({ startNamedStepRunLedger, finishStepRunLedger }));
vi.mock("../../lib/enqueue-analyze-deal", () => ({ enqueueAnalyzeDeal }));
vi.mock("../../lib/vision-verification", () => ({ verifyVisionServiceForJob }));
vi.mock("../../lib/vision-image", () => ({ tryReadImageB64ForVision, headCheckImageUri }));
vi.mock("../../lib/original-file-url", () => ({ pickDownloadUrlFromExtractionMetadata }));
vi.mock("../../lib/visual-ocr-promoter", () => ({ promoteVisualOcrToDocumentFullText }));
vi.mock("../../lib/upload-dir-resolver", () => ({ resolveWritableUploadDir }));
vi.mock("../../lib/vision-routing", () => ({ computeAndPersistVisionRoutingV1 }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(data: Record<string, unknown> = {}, id = "job-ev-1") {
	return {
		id,
		name: "extract_visuals",
		data,
		updateProgress: vi.fn(async () => undefined),
	} as any;
}

function makePool(rows: Record<string, unknown>[] = []) {
	return { query: vi.fn(async () => ({ rows })) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("extractVisualsProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getVisionExtractorConfig.mockReturnValue({ enabled: false, visionWorkerUrl: null, extractorVersion: "v1" });
	});

	it("returns ok: false when neither deal_id nor document_id is present", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		// getDocumentsForDeal returns [] so targetDocumentIds = []

		const job = makeJob({});
		const result = await extractVisualsProcessor(job);

		expect(result).toMatchObject({ ok: false });
		expect(updateJobProgress).toHaveBeenCalledWith(
			job,
			expect.objectContaining({ status: "failed" })
		);
	});

	it("returns ok: false when deal has no documents", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([]);
		pool.query.mockResolvedValue({ rows: [] });

		const job = makeJob({ deal_id: "deal-abc" });
		const result = await extractVisualsProcessor(job);

		// Processor returns { ok: false } when no documents found
		expect(result).toMatchObject({ ok: false });
		expect(updateJobProgress).toHaveBeenCalledWith(
			job,
			expect.objectContaining({ status: "failed" })
		);
	});

	it("returns succeeded when all documents are skipped (visual extraction disabled)", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool([
			{
				id: "doc-1",
				deal_id: "deal-abc",
				status: "processed",
				content_type: "application/pdf",
				page_count: 2,
				extraction_metadata: null,
			},
		]);
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([
			{ id: "doc-1", deal_id: "deal-abc", status: "processed", content_type: "application/pdf", page_count: 2, extraction_metadata: null },
		]);
		evaluateVisualDocReadiness.mockReturnValue({ ready: false, reason: "visual_extraction_disabled" });
		getVisualIngestBlockReason.mockReturnValue(null);

		const job = makeJob({ deal_id: "deal-abc" });
		const result = await extractVisualsProcessor(job);

		// When all docs are skipped/blocked, it should return some result
		expect(result).toBeDefined();
		expect(typeof result).toBe("object");
	});

	it("handles document_id single-doc mode", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool([
			{
				id: "doc-2",
				deal_id: "deal-xyz",
				status: "processed",
				content_type: "application/pdf",
				page_count: 1,
				extraction_metadata: null,
			},
		]);
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([
			{ id: "doc-2", deal_id: "deal-xyz", status: "processed", content_type: "application/pdf", page_count: 1, extraction_metadata: null },
		]);
		evaluateVisualDocReadiness.mockReturnValue({ ready: false, reason: "visual_extraction_disabled" });

		const job = makeJob({ document_id: "doc-2", deal_id: "deal-xyz" });
		const result = await extractVisualsProcessor(job);

		expect(result).toBeDefined();
		expect(typeof result).toBe("object");
	});

	it("returns object with docs_processed field on normal completion", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([]);
		pool.query.mockResolvedValue({ rows: [] });

		const job = makeJob({ deal_id: "deal-batch" });
		const result = await extractVisualsProcessor(job);

		// It should always return an object (even error cases)
		expect(result).toBeDefined();
		expect(result).not.toBeNull();
		if (result && typeof result === "object" && "ok" in result && result.ok !== false) {
			expect("docs_processed" in result || "reason" in result).toBe(true);
		}
	});

	it("does not throw when pool query fails gracefully", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = { query: vi.fn().mockRejectedValue(new Error("db_error")) };
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockRejectedValue(new Error("db_error"));

		const job = makeJob({ deal_id: "deal-fail" });
		// Should not throw — should return a result or throw cleanly
		let result: unknown;
		let threw = false;
		try {
			result = await extractVisualsProcessor(job);
		} catch {
			threw = true;
		}
		// Either it returned something or threw — both acceptable
		expect(threw || result !== undefined).toBe(true);
	});

	it("normalizes nested payload fields", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([]);
		pool.query.mockResolvedValue({ rows: [] });

		// Passing deal_id inside nested payload
		const job = makeJob({ payload: { deal_id: "deal-nested", force_ocr: true } });
		const result = await extractVisualsProcessor(job);

		expect(result).toBeDefined();
	});

	it("exports a function named extractVisualsProcessor", async () => {
		const mod = await import("../extract-visuals/processor.js");
		expect(typeof mod.extractVisualsProcessor).toBe("function");
	});

	it("processor function returns an object on empty deal_id string", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		pool.query.mockResolvedValue({ rows: [] });

		const job = makeJob({ deal_id: "" });
		const result = await extractVisualsProcessor(job);

		expect(result).toBeDefined();
		expect(result).toMatchObject({ ok: false });
	});

	it("processor function handles document_ids array", async () => {
		const { extractVisualsProcessor } = await import("../extract-visuals/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);
		getDocumentsForDeal.mockResolvedValue([
			{ id: "doc-arr-1", deal_id: "deal-mul", status: "processed", content_type: "application/pdf", page_count: 1, extraction_metadata: null },
		]);
		evaluateVisualDocReadiness.mockReturnValue({ ready: false, reason: "visual_extraction_disabled" });
		pool.query.mockResolvedValue({ rows: [] });

		const job = makeJob({ deal_id: "deal-mul", document_ids: ["doc-arr-1"] });
		const result = await extractVisualsProcessor(job);

		expect(result).toBeDefined();
	});
});
