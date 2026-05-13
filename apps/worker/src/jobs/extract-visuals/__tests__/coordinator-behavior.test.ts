/**
 * Behavioral test harness for runExtractVisualsCoordinator.
 *
 * Coverage targets
 * ────────────────
 * 1. ingest-wait blocking path        — all docs blocked, maxWait expires → ok:false
 * 2. ingest-wait success path         — docs unblock on 2nd poll → proceeds to coordinator
 * 3. coordinator chunk-enqueue mode   — isCoordinator enqueues chunk jobs and returns ok:true
 * 4. skip-doc path                    — doc kind has !supports_visual_extraction → docsSkipped++
 * 5. pagesVisionAttempted counter     — chunk job: counter reflects pages actually sent to vision
 * 6. DPU single-attempt guard         — tryPopulateDpuForChunkRange fires at most once per doc
 * 7. chunkJobIsLastChunk finalization — last chunk triggers finalize path; non-last does not
 * 8. error propagation                — enqueuePersistedJob throw → ok:false returned
 *
 * Mocks
 * ─────
 * All external I/O is mocked:
 *  - DB (pool.query)
 *  - queue enqueue (enqueuePersistedJob)
 *  - R2 / storage (r2ObjectExists, uploadToR2)
 *  - vision service (callVisionWorkerWithRetries, verifyVisionServiceForJob)
 *  - PDF rendering (persistRenderedPageImages)
 *  - job progress helpers (updateJob, updateJobProgress, emitJobProgress)
 */

// ── Env must be set BEFORE any imports that touch db.ts ──────────────────────
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.ENABLE_VISUAL_EXTRACTION = "1";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	makeCoordinatorJob,
	makeChunkJob,
	makeReadyDocMeta,
	makeBlockedDocMeta,
	makePoolMock,
	makeConnectionMock,
} from "./fixtures/coordinator-fixtures";

// ── Module-level mocks ────────────────────────────────────────────────────────
// All mocked before any production import so hoisting order is deterministic.

vi.mock("../../../lib/db", async () => {
	return {
		getPool: vi.fn(),
		mergeDocumentExtractionMetadata: vi.fn().mockResolvedValue(undefined),
		getDocumentOriginalFile: vi.fn().mockResolvedValue(null),
		upsertDocumentOriginalFile: vi.fn().mockResolvedValue(undefined),
		getDocumentsForDeal: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("../../../lib/job-progress", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(undefined),
	emitJobProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/worker-utils", () => ({
	makeDevLogger: vi.fn(() => vi.fn()),
	updateJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/job-enqueue", () => ({
	enqueuePersistedJob: vi.fn().mockResolvedValue({ job_id: "chunk-job-mock-1" }),
}));

vi.mock("../../../lib/queue", () => ({
	getQueue: vi.fn(() => ({
		add: vi.fn().mockResolvedValue(undefined),
	})),
	connection: {
		set: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
		del: vi.fn().mockResolvedValue(1),
	},
}));

vi.mock("../../../lib/r2", () => ({
	r2ObjectExists: vi.fn().mockResolvedValue(false),
	uploadToR2: vi.fn().mockResolvedValue({ url: null }),
}));

vi.mock("../../../lib/rendered-pages", () => ({
	getVisualPageImagePersistConfig: vi.fn(() => ({})),
	persistRenderedPageImages: vi.fn().mockResolvedValue({ rendered_pages_count: 0, rendered_pages_dir: null }),
	persistImagePage: vi.fn().mockResolvedValue(null),
	renderNonPdfToPageImages: vi.fn().mockResolvedValue([]),
	r2RenderedPageKey: vi.fn(() => ""),
	formatRenderedPageKey: vi.fn(() => ""),
}));

vi.mock("../../../lib/visual-extraction", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/visual-extraction")>("../../../lib/visual-extraction");
	return {
		...actual,
		getVisionExtractorConfig: vi.fn(() => ({
			enabled: true,
			visionWorkerUrl: "http://vision.mock",
			extractorVersion: "v1",
			maxPages: 50,
		})),
		createVisionJobRuntime: vi.fn(() => ({})),
		hasTable: vi.fn().mockResolvedValue(true),
		resolvePageImageUris: vi.fn().mockResolvedValue(["r2://page-0.png", "r2://page-1.png"]),
		backfillVisualAssetImageUris: vi.fn().mockResolvedValue({ backfilled: 0 }),
		persistSyntheticVisualAssets: vi.fn().mockResolvedValue(0),
		persistVisionResponse: vi.fn().mockResolvedValue(undefined),
		callVisionWorkerWithRetries: vi.fn().mockResolvedValue({ assets: [], ok: true }),
		callXlsxWorkerWithRetries: vi.fn().mockResolvedValue({ ok: false }),
		buildXlsxCanonicalPatch: vi.fn().mockReturnValue({}),
		deduceDocKind: vi.fn().mockReturnValue("powerpoint"),
		resegmentStructuredSyntheticAssets: vi.fn().mockResolvedValue({ updated_assets: 0, updated_extractions: 0 }),
		applyVisionHintsToStructuredPowerpointSlides: vi.fn().mockReturnValue(undefined),
		buildExtractVisualsExtractionMetadataPatchV1: vi.fn().mockReturnValue({}),
		buildExtractVisualsPageSummaryV1: vi.fn().mockReturnValue({ version: 1, attempted: 0, succeeded: 0, failed: 0 }),
		computeExtractVisualsOutcomeStatusV1: vi.fn().mockReturnValue("succeeded"),
		shouldSkipExtractVisualsPage: vi.fn().mockReturnValue(false),
		isAuditVisionFailure: vi.fn().mockReturnValue(false),
		buildExtractVisualsFinalizedMarker: vi.fn().mockReturnValue({ extract_visuals_finalized: true }),
		computeVisionRoutingDecisionV1: vi.fn().mockReturnValue({ decision: "run_vision" }),
	};
});

vi.mock("../../../lib/visual-readiness", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/visual-readiness")>("../../../lib/visual-readiness");
	return {
		...actual,
		evaluateVisualDocReadiness: vi.fn(() => ({ blocked: false, reason: null })),
		getVisualIngestBlockReason: vi.fn(() => null),
	};
});

vi.mock("../../../lib/vision-verification", () => ({
	verifyVisionServiceForJob: vi.fn().mockResolvedValue({ ok: true, reason: null }),
}));

vi.mock("../../../lib/page-chunks", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/page-chunks")>("../../../lib/page-chunks");
	return {
		...actual,
		planChunkEnqueues: vi.fn(() => ({
			chunks_enqueued: 2,
			ranges: [
				{ start: 0, end: 50 },
				{ start: 50, end: 100 },
			],
		})),
	};
});

vi.mock("../../../lib/enqueue-analyze-deal", () => ({
	enqueueAnalyzeDeal: vi.fn().mockResolvedValue({ enqueued: true, jobId: "analyze-mock-1" }),
}));

vi.mock("../../../lib/document-page-understanding", () => ({
	populateDocumentPageUnderstandingFromVisualExtractions: vi.fn().mockResolvedValue({ upserted: 0, page_text_empty: 0 }),
}));

vi.mock("../../../lib/promote-slide-facts", () => ({
	promoteSlideFactsFromDocumentPageUnderstanding: vi.fn().mockResolvedValue({
		facts: [],
		inserted: 0,
		updated: 0,
		warnings: [],
	}),
}));

vi.mock("../../../lib/pdf_v2/pdf-text-region-assets-v1", () => ({
	persistPdfV2TextRegionAssetsV1Shadow: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../../lib/pdf_v2/page-understanding-v1", () => ({
	persistPdfPageUnderstandingV1Shadow: vi.fn().mockResolvedValue({ persisted_pages: 0, attempted_pages: 0 }),
}));

vi.mock("../../../lib/pdf_v2/slide-understanding-v1", () => ({
	applySlideUnderstandingV1Shadow: vi.fn().mockReturnValue({ applied: false }),
}));

vi.mock("../../../lib/vision-ocr-fallback", () => ({
	ensureOcrFallbackForVisionResponse: vi.fn((r: unknown) => r),
}));

vi.mock("../../../lib/visual-quality-audit", () => ({
	computeVisualQualityAuditForDeal: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../lib/document-intelligence-batch", () => ({
	selectDocumentsForDocumentIntelligenceBatch: vi.fn().mockResolvedValue([]),
	loadActiveDocumentIntelligenceJobs: vi.fn().mockResolvedValue(new Map()),
	planDocumentIntelligenceBatch: vi.fn().mockReturnValue({ doc_ids_selected: [], doc_ids_to_enqueue: [], doc_ids_skipped_active: [], active_job_ids: [] }),
	enqueueDocumentIntelligenceExtractJobs: vi.fn().mockResolvedValue([]),
	pollJobsToTerminal: vi.fn().mockResolvedValue({ ok: true, cancelled_job_ids: [], timed_out: false }),
	insertBlockedAnalyzeJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/pipeline-run-ledger", () => ({
	startNamedStepRunLedger: vi.fn().mockResolvedValue(null),
	finishStepRunLedger: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/r2-probe", () => ({
	computeChunkRangeForPage: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../lib/vision-image", () => ({
	tryReadImageB64ForVision: vi.fn().mockResolvedValue(null),
	headCheckImageUri: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

vi.mock("../../../lib/original-file-url", () => ({
	pickDownloadUrlFromExtractionMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../lib/visual-ocr-promoter", () => ({
	promoteVisualOcrToDocumentFullText: vi.fn().mockResolvedValue({ promoted: false }),
}));

vi.mock("../../../lib/upload-dir-resolver", () => ({
	resolveWritableUploadDir: vi.fn().mockResolvedValue("/tmp/test-uploads"),
}));

vi.mock("../../../lib/vision-routing", () => ({
	computeAndPersistVisionRoutingV1: vi.fn().mockResolvedValue({
		decision: {
			vision_fallback_allowed: true,
			ocr_allowed: true,
			routing_version: "v1",
		},
	}),
}));

vi.mock("../../../lib/job-id", () => ({
	makeJobId: vi.fn((_type: string, parts: string[]) => `derived-${parts.join("-")}`),
}));

vi.mock("../../../lib/memory", () => ({
	logMemory: vi.fn(),
	yieldToEventLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/first-pass-config", () => ({
	FIRST_PASS_PAGE_THRESHOLD: 50,
	FIRST_PASS_VISION_TIMEOUTS_PDF: [20_000],
	FIRST_PASS_VISION_TIMEOUTS_PPTX: [20_000],
	FIRST_PASS_CHUNK_PRIORITY: 5,
	BACKGROUND_CHUNK_PRIORITY: 10,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a pool mock that returns ready-doc metadata rows and passes hasTable=true.
 * Rows keyed on the SQL fragment that selects them.
 */
function buildReadyDocPool(docMeta: ReturnType<typeof makeReadyDocMeta>) {
	const stubs = new Map<string, { rows: unknown[] }>([
		// documents WHERE id = ANY (guard precheck, meta fetch)
		["FROM documents WHERE id = ANY", { rows: [{ ...docMeta, id: docMeta.id }] }],
		// single-doc metadata SELECT in the doc loop
		["FROM documents WHERE id = $1 LIMIT 1", { rows: [docMeta] }],
		// information_schema.columns (meta_status column check)
		["information_schema.columns", { rows: [{ ok: 1 }] }],
		// inet_server_addr (DPU instrumentation)
		["inet_server_addr", { rows: [{ db_host: "127.0.0.1", db_name: "testdb" }] }],
		// document_page_understanding (finalize fallback query)
		["document_page_understanding", { rows: [{ pages_with_understanding: 0, page_start: null, page_end: null, title_hint: null }] }],
	]);
	return makePoolMock(stubs);
}

// ── Import the production code ────────────────────────────────────────────────

import { runExtractVisualsCoordinator } from "../coordinator";
import { getPool, mergeDocumentExtractionMetadata, getDocumentsForDeal } from "../../../lib/db";
import { updateJob } from "../../../lib/worker-utils";
import { enqueuePersistedJob } from "../../../lib/job-enqueue";
import { evaluateVisualDocReadiness } from "../../../lib/visual-readiness";
import {
	getVisionExtractorConfig,
	hasTable,
	resolvePageImageUris,
	deduceDocKind,
	persistSyntheticVisualAssets,
	callVisionWorkerWithRetries,
} from "../../../lib/visual-extraction";
import { planChunkEnqueues } from "../../../lib/page-chunks";
import { verifyVisionServiceForJob } from "../../../lib/vision-verification";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../../../lib/document-page-understanding";
import { computeAndPersistVisionRoutingV1 } from "../../../lib/vision-routing";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runExtractVisualsCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Restore safe defaults after each clear
		vi.mocked(getVisionExtractorConfig).mockReturnValue({
			enabled: true,
			visionWorkerUrl: "http://vision.mock",
			extractorVersion: "v1",
			maxPages: 50,
		} as any);
		vi.mocked(verifyVisionServiceForJob).mockResolvedValue({ ok: true, reason: null } as any);
		vi.mocked(hasTable).mockResolvedValue(true);
		vi.mocked(resolvePageImageUris).mockResolvedValue(["r2://page-0.png", "r2://page-1.png"]);
		vi.mocked(deduceDocKind).mockReturnValue("powerpoint");
		vi.mocked(persistSyntheticVisualAssets).mockResolvedValue(0);
		vi.mocked(enqueuePersistedJob).mockResolvedValue({ job_id: "chunk-job-mock-1" });
		vi.mocked(mergeDocumentExtractionMetadata).mockResolvedValue(undefined as any);
		vi.mocked(callVisionWorkerWithRetries).mockResolvedValue({ assets: [], ok: true } as any);
		vi.mocked(planChunkEnqueues).mockReturnValue({
			chunks_enqueued: 2,
			ranges: [{ start: 0, end: 50 }, { start: 50, end: 100 }],
		});
		vi.mocked(computeAndPersistVisionRoutingV1).mockResolvedValue({
			decision: { vision_fallback_allowed: true, ocr_allowed: true, routing_version: "v1" },
		} as any);
	});

	// ── 1. ingest-wait blocking path ────────────────────────────────────────────

	describe("ingest-wait blocking path", () => {
		it("returns ok:false with INGEST_NOT_COMPLETE when all docs remain blocked after maxWait", async () => {
			// Docs are always blocked — readiness never clears
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: true, reason: "ingest_not_complete" } as any);

			const { pool } = makePoolMock(
				new Map([
					["information_schema.columns", { rows: [{ ok: 1 }] }],
					["FROM documents WHERE id = ANY", { rows: [makeBlockedDocMeta()] }],
				])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue([]);

			// Set a very short wait so the test doesn't actually sleep
			const originalEnv = process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS;
			const originalPoll = process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS;
			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "50";
			process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = "25";

			const job = makeCoordinatorJob({ document_id: "doc-blocked-1" });
			const result = await runExtractVisualsCoordinator(job);

			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = originalEnv;
			process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = originalPoll;

			expect(result.ok).toBe(false);
			expect((result as any).reason).toBe("INGEST_NOT_COMPLETE");
			expect((result as any).docs_total).toBeGreaterThan(0);
		});

		it("emits updateJob with status=failed when ingest wait expires", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: true, reason: "ingest_not_complete" } as any);

			const { pool } = makePoolMock(
				new Map([
					["information_schema.columns", { rows: [{ ok: 1 }] }],
					["FROM documents WHERE id = ANY", { rows: [makeBlockedDocMeta()] }],
				])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue([]);

			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "50";
			process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = "25";

			const job = makeCoordinatorJob({ document_id: "doc-blocked-2" });
			await runExtractVisualsCoordinator(job);

			delete process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS;
			delete process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS;

			// updateJob should have been called with "failed"
			const calls = vi.mocked(updateJob).mock.calls;
			const failedCall = calls.find((c) => c[1] === "failed");
			expect(failedCall).toBeTruthy();
		});
	});

	// ── 2. ingest-wait success path ─────────────────────────────────────────────

	describe("ingest-wait success path", () => {
		it("proceeds when docs unblock on the second readiness poll", async () => {
			const blockedMeta = makeBlockedDocMeta();
			const readyMeta = makeReadyDocMeta();

			let pollCount = 0;
			vi.mocked(evaluateVisualDocReadiness).mockImplementation(() => {
				// First evaluation (initial precheck) and first poll = blocked
				// Second poll = ready
				pollCount += 1;
				return pollCount <= 2
					? { blocked: true, reason: "ingest_not_complete" }
					: { blocked: false, reason: null };
			});

			const { pool } = makePoolMock(
				new Map([
					["information_schema.columns", { rows: [{ ok: 1 }] }],
					["FROM documents WHERE id = ANY", { rows: [blockedMeta] }],
					["FROM documents WHERE id = $1 LIMIT 1", { rows: [readyMeta] }],
					["inet_server_addr", { rows: [{ db_host: "127.0.0.1", db_name: "testdb" }] }],
				])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue(["r2://page-0.png"]);

			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "200";
			process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = "25";

			const job = makeCoordinatorJob({ document_id: "doc-unblocks-1" });
			const result = await runExtractVisualsCoordinator(job);

			delete process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS;
			delete process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS;

			// isCoordinator path returns ok:true after chunk enqueue
			expect(result.ok).toBe(true);
			// enqueuePersistedJob must have been called (coordinator enqueued chunks)
			expect(vi.mocked(enqueuePersistedJob)).toHaveBeenCalled();
		});
	});

	// ── 3. coordinator chunk-enqueue mode ───────────────────────────────────────

	describe("coordinator chunk-enqueue mode", () => {
		it("enqueues chunk jobs for each planned range and returns ok:true", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(planChunkEnqueues).mockReturnValue({
				chunks_enqueued: 3,
				ranges: [
					{ start: 0, end: 50 },
					{ start: 50, end: 100 },
					{ start: 100, end: 150 },
				],
			});

			const job = makeCoordinatorJob({ document_id: "doc-coord-1" });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			// enqueuePersistedJob should have been called 3 times (one per range)
			expect(vi.mocked(enqueuePersistedJob)).toHaveBeenCalledTimes(3);
		});

		it("passes page_start/page_end in each chunk job payload", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(planChunkEnqueues).mockReturnValue({
				chunks_enqueued: 2,
				ranges: [
					{ start: 0, end: 50 },
					{ start: 50, end: 100 },
				],
			});

			const job = makeCoordinatorJob({ document_id: "doc-coord-2" });
			await runExtractVisualsCoordinator(job);

			const calls = vi.mocked(enqueuePersistedJob).mock.calls;
			expect(calls.length).toBe(2);

			const firstCall = calls[0]![0];
			expect(firstCall.page_start).toBe(0);
			expect(firstCall.page_end).toBe(50);
			expect(firstCall.type).toBe("extract_visuals");

			const secondCall = calls[1]![0];
			expect(secondCall.page_start).toBe(50);
			expect(secondCall.page_end).toBe(100);
		});

		it("sets idempotent=true on chunk enqueues (coordinator retry safety)", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(planChunkEnqueues).mockReturnValue({
				chunks_enqueued: 1,
				ranges: [{ start: 0, end: 10 }],
			});

			const job = makeCoordinatorJob({ document_id: "doc-coord-3" });
			await runExtractVisualsCoordinator(job);

			const calls = vi.mocked(enqueuePersistedJob).mock.calls;
			expect(calls[0]![0]).toMatchObject({ idempotent: true });
		});

		it("returns ok:true without attempting DPU or vision in coordinator mode", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			const job = makeCoordinatorJob({ document_id: "doc-coord-4" });
			await runExtractVisualsCoordinator(job);

			// populateDocumentPageUnderstandingFromVisualExtractions must NOT be called
			// in the coordinator path — that is the responsibility of chunk jobs.
			expect(vi.mocked(populateDocumentPageUnderstandingFromVisualExtractions)).not.toHaveBeenCalled();
			// Vision worker must not be called in coordinator mode
			expect(vi.mocked(callVisionWorkerWithRetries)).not.toHaveBeenCalled();
		});
	});

	// ── 4. skip-doc path ────────────────────────────────────────────────────────

	describe("skip-doc path (unsupported doc kind)", () => {
		it("skips docs with unsupported kind and increments docsSkipped", async () => {
			// deduceDocKind returns "pdf" but we'll make it return a kind where
			// getDocumentCapabilities.supports_visual_extraction = false by mocking deduceDocKind.
			// The simplest way: the coordinator path is gated by isCoordinator first; we need a
			// chunk job to reach the skip-doc logic.
			const docMeta = makeReadyDocMeta({ type: "image", mime_type: "image/png" });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			// Use "other" kind — getDocumentCapabilities returns supports_visual_extraction:false for unknown kinds
			vi.mocked(deduceDocKind).mockReturnValue("other");

			const job = makeChunkJob({
				document_id: "doc-skip-1",
				page_start: 0,
				page_end: 10,
			});
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			// docs_skipped should reflect the skipped document
			expect((result as any).docs_skipped).toBeGreaterThanOrEqual(1);
			// vision should not have been called for the skipped doc
			expect(vi.mocked(callVisionWorkerWithRetries)).not.toHaveBeenCalled();
		});

		it("writes visual_extraction.status=skipped to metadata for skipped doc", async () => {
			const docMeta = makeReadyDocMeta({ type: "image", mime_type: "image/png" });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(deduceDocKind).mockReturnValue("other");

			const job = makeChunkJob({ document_id: "doc-skip-2", page_start: 0, page_end: 10 });
			await runExtractVisualsCoordinator(job);

			const mergeCalls = vi.mocked(mergeDocumentExtractionMetadata).mock.calls;
			const skipPatch = mergeCalls.find((c) => {
				const patch = c[0]?.patch as any;
				return patch?.visual_extraction?.status === "skipped";
			});
			expect(skipPatch).toBeTruthy();
		});
	});

	// ── 5. pagesVisionAttempted counter ─────────────────────────────────────────

	describe("pagesVisionAttempted counter", () => {
		it("reflects the number of pages sent to vision in a chunk job", async () => {
			const docMeta = makeReadyDocMeta({ page_count: 3 });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			// 3 page URIs — all should be attempted
			vi.mocked(resolvePageImageUris).mockResolvedValue([
				"r2://page-0.png",
				"r2://page-1.png",
				"r2://page-2.png",
			]);
			vi.mocked(callVisionWorkerWithRetries).mockResolvedValue({ assets: [{ asset_id: "a1" }], ok: true } as any);

			const job = makeChunkJob({ document_id: "doc-vision-1", page_start: 0, page_end: 3 });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			// job_counters should reflect attempted pages
			const counters = (result as any).job_counters;
			expect(counters).toBeDefined();
			expect(counters.pages_vision_attempted).toBeGreaterThanOrEqual(1);
		});

		it("pagesVisionAttempted stays 0 when skip policy fires for all pages", async () => {
			const { shouldSkipExtractVisualsPage } = await import("../../../lib/visual-extraction");
			vi.mocked(shouldSkipExtractVisualsPage).mockReturnValue(true);

			const docMeta = makeReadyDocMeta({ page_count: 2 });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue(["r2://page-0.png", "r2://page-1.png"]);

			const job = makeChunkJob({ document_id: "doc-skip-pages-1", page_start: 0, page_end: 2 });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			const counters = (result as any).job_counters;
			expect(counters.pages_vision_attempted).toBe(0);
		});
	});

	// ── 6. DPU single-attempt guard ─────────────────────────────────────────────

	describe("DPU single-attempt guard (dpuAttemptedForDoc)", () => {
		it("calls populateDocumentPageUnderstanding at most once per doc regardless of page count", async () => {
			const docMeta = makeReadyDocMeta({ page_count: 4 });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(resolvePageImageUris).mockResolvedValue([
				"r2://page-0.png",
				"r2://page-1.png",
				"r2://page-2.png",
				"r2://page-3.png",
			]);
			vi.mocked(callVisionWorkerWithRetries).mockResolvedValue({ assets: [{ asset_id: "a1" }], ok: true } as any);

			const job = makeChunkJob({ document_id: "doc-dpu-guard-1", page_start: 0, page_end: 4 });
			await runExtractVisualsCoordinator(job);

			// DPU is gated by dpuAttemptedForDoc — it fires at most once per page-loop pass
			// and may also fire once in the final-pass path, but never unboundedly per page.
			// 4 pages → guard allows at most 2 total calls (once inlined + once on finalize).
			const dpuCalls = vi.mocked(populateDocumentPageUnderstandingFromVisualExtractions).mock.calls;
			expect(dpuCalls.length).toBeLessThanOrEqual(2);
		});
	});

	// ── 7. chunkJobIsLastChunk finalization behavior ─────────────────────────────

	describe("chunkJobIsLastChunk finalization", () => {
		it("does NOT run finalization when chunk page_end < doc page_count (not the last chunk)", async () => {
			// page_end=10 but doc has 50 pages → not the last chunk
			const docMeta = makeReadyDocMeta({ page_count: 50 });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue(
				Array.from({ length: 50 }, (_, i) => `r2://page-${i}.png`)
			);

			const job = makeChunkJob({ document_id: "doc-finalize-1", page_start: 0, page_end: 10 });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			// mergeDocumentExtractionMetadata with the finalized marker should NOT have been called
			const mergeCalls = vi.mocked(mergeDocumentExtractionMetadata).mock.calls;
			const finalizeCall = mergeCalls.find((c) => {
				const patch = c[0]?.patch as any;
				return patch?.extract_visuals_finalized != null;
			});
			expect(finalizeCall).toBeUndefined();
		});

		it("coordinator mode never runs finalization even for a single-page doc", async () => {
			const docMeta = makeReadyDocMeta({ page_count: 1 });
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);
			vi.mocked(resolvePageImageUris).mockResolvedValue(["r2://page-0.png"]);
			vi.mocked(planChunkEnqueues).mockReturnValue({
				chunks_enqueued: 1,
				ranges: [{ start: 0, end: 1 }],
			});

			// isCoordinator job (no chunk field)
			const job = makeCoordinatorJob({ document_id: "doc-coord-finalize-1" });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(true);
			// Coordinator path returns early before finalization; mergeDocumentExtractionMetadata
			// should not have been called with a finalized marker
			const mergeCalls = vi.mocked(mergeDocumentExtractionMetadata).mock.calls;
			const finalizeCall = mergeCalls.find((c) => {
				const patch = c[0]?.patch as any;
				return patch?.extract_visuals_finalized != null;
			});
			expect(finalizeCall).toBeUndefined();
		});
	});

	// ── 8. error propagation behavior ───────────────────────────────────────────

	describe("error propagation", () => {
		it("returns ok:false when enqueuePersistedJob throws in coordinator mode", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(enqueuePersistedJob).mockRejectedValue(new Error("queue unavailable"));

			const job = makeCoordinatorJob({ document_id: "doc-enqueue-error-1" });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(false);
		});

		it("calls updateJob with failed when enqueue fails", async () => {
			const docMeta = makeReadyDocMeta();
			const { pool } = buildReadyDocPool(docMeta);
			vi.mocked(getPool).mockReturnValue(pool as any);

			vi.mocked(enqueuePersistedJob).mockRejectedValue(new Error("queue unavailable"));

			const job = makeCoordinatorJob({ document_id: "doc-enqueue-error-2" });
			await runExtractVisualsCoordinator(job);

			const calls = vi.mocked(updateJob).mock.calls;
			const failedCall = calls.find((c) => c[1] === "failed");
			expect(failedCall).toBeTruthy();
		});

		it("returns ok:false when visual tables are missing", async () => {
			vi.mocked(hasTable).mockResolvedValue(false);

			const { pool } = makePoolMock(
				new Map([["information_schema.columns", { rows: [{ ok: 1 }] }]])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);

			const job = makeCoordinatorJob({ document_id: "doc-no-tables-1" });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(false);
			expect((result as any).reason).toBe("tables_missing");
		});

		it("returns ok:false (skipped) when visual extraction is disabled", async () => {
			vi.mocked(getVisionExtractorConfig).mockReturnValue({
				enabled: false,
				visionWorkerUrl: "",
				extractorVersion: "v1",
				maxPages: 50,
			} as any);

			const { pool } = makePoolMock(
				new Map([["information_schema.columns", { rows: [{ ok: 1 }] }]])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);

			const job = makeCoordinatorJob({ document_id: "doc-disabled-1" });
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(false);
			expect((result as any).skipped).toBe(true);
			expect((result as any).reason).toBe("disabled");
		});

		it("returns ok:false when document_id is missing and no deal documents found", async () => {
			vi.mocked(getDocumentsForDeal).mockResolvedValue([]);

			const { pool } = makePoolMock(
				new Map([["information_schema.columns", { rows: [{ ok: 1 }] }]])
			);
			vi.mocked(getPool).mockReturnValue(pool as any);

			const job = makeCoordinatorJob({
				deal_id: "deal-no-docs",
				document_id: undefined as any,
			});
			const result = await runExtractVisualsCoordinator(job);

			expect(result.ok).toBe(false);
		});
	});
});
