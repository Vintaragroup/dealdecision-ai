import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.hoisted ensures these are initialized before any vi.mock factory runs,
// which is required when processor.ts imports from @dealdecision/core alongside
// mocked relative lib modules.

const mocks = vi.hoisted(() => {
	const mockPoolQuery = vi.fn(async (_sql: string, _params?: any[]) => ({ rows: [] }));
	return {
		updateJob: vi.fn(async () => undefined),
		updateJobProgress: vi.fn(async () => undefined),
		emitJobProgress: vi.fn(async () => undefined),
		getDocumentsForDeal: vi.fn(async (): Promise<any[]> => [{ document_id: "doc-abc" }]),
		mergeDocumentExtractionMetadata: vi.fn(async () => undefined),
		mockPoolQuery,
		getPool: vi.fn(() => ({ query: mockPoolQuery })),
		getVisionExtractorConfig: vi.fn(() => ({
			enabled: true,
			visionWorkerUrl: "http://vision-mock",
			extractorVersion: "v1",
			maxPages: 10,
		})),
		createVisionJobRuntime: vi.fn(() => ({})),
		verifyVisionServiceForJob: vi.fn(async () => ({ ok: true })),
		hasTable: vi.fn(async () => true),
		resolvePageImageUris: vi.fn(async () => ["http://img/0.png"]),
		callVisionWorkerWithRetries: vi.fn(async () => ({
			response: { assets: [{ type: "page" }], extractor_version: "v1" },
			attempts: [],
		})),
		persistVisionResponse: vi.fn(async () => ({ persisted: 1 })),
		computeAndPersistVisionRoutingV1: vi.fn(async () => ({
			decision: { vision_fallback_allowed: true, reason: null },
			doc_kind: "pdf",
		})),
		buildDeepScanExtractionMetadataPatch: vi.fn((args: any) => ({ deep_scan: args })),
		buildDeepScanPageSummaryV1: vi.fn((args: any) => ({
			attempted: args.attempted ?? 0,
			succeeded: args.succeeded ?? 0,
			failed: 0,
			failures: args.failures ?? [],
		})),
		computeDeepScanOutcomeStatus: vi.fn(() => "succeeded" as const),
		enqueuePersistedJob: vi.fn(async () => undefined),
		planChunkEnqueues: vi.fn((args: any) => ({
			ranges: [{ start: 0, end: args.chunkSize }],
			chunks_enqueued: 1,
		})),
		tryReadImageB64ForVision: vi.fn(async () => null),
		headCheckImageUri: vi.fn(async () => ({ ok: true, method: "HEAD", status: 200 })),
		logMemory: vi.fn(),
		yieldToEventLoop: vi.fn(async () => undefined),
	};
});

vi.mock("../../../lib/worker-utils", () => ({ updateJob: mocks.updateJob }));
vi.mock("../../../lib/job-progress", () => ({
	updateJobProgress: mocks.updateJobProgress,
	emitJobProgress: mocks.emitJobProgress,
}));
vi.mock("../../../lib/db", () => ({
	getPool: mocks.getPool,
	mergeDocumentExtractionMetadata: mocks.mergeDocumentExtractionMetadata,
	getDocumentsForDeal: mocks.getDocumentsForDeal,
}));
vi.mock("../../../lib/visual-extraction", () => ({
	getVisionExtractorConfig: mocks.getVisionExtractorConfig,
	createVisionJobRuntime: mocks.createVisionJobRuntime,
	hasTable: mocks.hasTable,
	resolvePageImageUris: mocks.resolvePageImageUris,
	callVisionWorkerWithRetries: mocks.callVisionWorkerWithRetries,
	persistVisionResponse: mocks.persistVisionResponse,
	buildDeepScanExtractionMetadataPatch: mocks.buildDeepScanExtractionMetadataPatch,
	buildDeepScanPageSummaryV1: mocks.buildDeepScanPageSummaryV1,
	computeDeepScanOutcomeStatus: mocks.computeDeepScanOutcomeStatus,
}));
vi.mock("../../../lib/vision-routing", () => ({
	computeAndPersistVisionRoutingV1: mocks.computeAndPersistVisionRoutingV1,
}));
vi.mock("../../../lib/vision-verification", () => ({
	verifyVisionServiceForJob: mocks.verifyVisionServiceForJob,
}));
vi.mock("../../../lib/job-enqueue", () => ({ enqueuePersistedJob: mocks.enqueuePersistedJob }));
vi.mock("../../../lib/page-chunks", () => ({ planChunkEnqueues: mocks.planChunkEnqueues }));
vi.mock("../../../lib/vision-image", () => ({
	tryReadImageB64ForVision: mocks.tryReadImageB64ForVision,
	headCheckImageUri: mocks.headCheckImageUri,
}));
vi.mock("../../../lib/memory", () => ({
	logMemory: mocks.logMemory,
	yieldToEventLoop: mocks.yieldToEventLoop,
}));

import { deepScanVisualsProcessor } from "../processor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(data: Record<string, unknown> = {}, id = "job-dsv-1") {
	return { id, data } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deepScanVisualsProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getVisionExtractorConfig.mockReturnValue({
			enabled: true,
			visionWorkerUrl: "http://vision-mock",
			extractorVersion: "v1",
			maxPages: 10,
		});
		mocks.verifyVisionServiceForJob.mockResolvedValue({ ok: true });
		mocks.hasTable.mockResolvedValue(true);
		mocks.mockPoolQuery.mockResolvedValue({ rows: [] });
		mocks.resolvePageImageUris.mockResolvedValue(["http://img/0.png"]);
		mocks.callVisionWorkerWithRetries.mockResolvedValue({
			response: { assets: [{ type: "page" }], extractor_version: "v1" },
			attempts: [],
		});
		mocks.persistVisionResponse.mockResolvedValue({ persisted: 1 });
		mocks.computeAndPersistVisionRoutingV1.mockResolvedValue({
			decision: { vision_fallback_allowed: true, reason: null },
			doc_kind: "pdf",
		});
		mocks.buildDeepScanPageSummaryV1.mockReturnValue({
			attempted: 1, succeeded: 1, failed: 0, failures: [],
		});
		mocks.computeDeepScanOutcomeStatus.mockReturnValue("succeeded");
		mocks.headCheckImageUri.mockResolvedValue({ ok: true, method: "HEAD", status: 200 });
		mocks.tryReadImageB64ForVision.mockResolvedValue(null);
		mocks.getDocumentsForDeal.mockResolvedValue([{ document_id: "doc-abc" }]);
		mocks.yieldToEventLoop.mockResolvedValue(undefined);
		mocks.createVisionJobRuntime.mockReturnValue({});
	});

	// 1) Importability
	it("exports deepScanVisualsProcessor as an async function", () => {
		expect(typeof deepScanVisualsProcessor).toBe("function");
	});

	// 2) Early-exit: missing deal_id
	it("returns { ok: false, reason: missing_deal_id } when deal_id is absent", async () => {
		const result = await deepScanVisualsProcessor(makeJob({}));
		expect(result).toEqual({ ok: false, reason: "missing_deal_id" });
		expect(mocks.updateJob).toHaveBeenCalledWith(expect.anything(), "failed", "Missing deal_id", 100);
	});

	// 3) Early-exit: vision extraction disabled
	it("returns { ok: false, skipped: true, reason: disabled } when visual extraction is off", async () => {
		mocks.getVisionExtractorConfig.mockReturnValue({
			enabled: false,
			visionWorkerUrl: "http://vision-mock",
			extractorVersion: "v1",
			maxPages: 10,
		});
		const result = await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		expect(result).toEqual({ ok: false, skipped: true, reason: "disabled" });
	});

	// 4) Early-exit: vision service verification fails
	it("throws VISION_UNAVAILABLE when vision service verification fails", async () => {
		mocks.verifyVisionServiceForJob.mockResolvedValue({ ok: false, reason: "connection_refused" });
		await expect(
			deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }))
		).rejects.toThrow("VISION_UNAVAILABLE");
	});

	// 5) Early-exit: visual tables missing
	it("returns { ok: false, skipped: true, reason: tables_missing } when DB tables are absent", async () => {
		mocks.hasTable.mockResolvedValue(false);
		const result = await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		expect(result).toEqual({ ok: false, skipped: true, reason: "tables_missing" });
	});

	// 6) Early-exit: no documents found for deal
	it("returns { ok: false, reason: no_documents } when deal has no documents", async () => {
		mocks.getDocumentsForDeal.mockResolvedValue([]);
		const result = await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		expect(result).toEqual({ ok: false, reason: "no_documents" });
	});

	// 7) Happy-path smoke: returns ok:true with summary
	it("returns { ok: true, summary } on successful single-page scan", async () => {
		const result = await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		expect(result.ok).toBe(true);
		expect(result.summary).toBeDefined();
		expect(result.summary.deal_id).toBe("deal-1");
	});

	// 8) DEEP_SCAN_VISUALS_SUMMARY event emitted
	it("emits DEEP_SCAN_VISUALS_SUMMARY log event on completion", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		const loggedEvents = consoleSpy.mock.calls
			.map((args) => { try { return JSON.parse(args[0]); } catch { return null; } })
			.filter(Boolean);
		const summary = loggedEvents.find((e: any) => e.event === "DEEP_SCAN_VISUALS_SUMMARY");
		expect(summary).toBeDefined();
		expect(summary.deal_id).toBe("deal-1");
		consoleSpy.mockRestore();
	});

	// 9) Chunk enqueue when totalPages > chunkSize
	it("enqueues chunk jobs with type deep_scan_visuals when totalPages > chunkSize", async () => {
		mocks.resolvePageImageUris.mockResolvedValue(
			Array.from({ length: 15 }, (_, i) => `http://img/${i}.png`)
		);
		mocks.planChunkEnqueues.mockReturnValue({
			ranges: [{ start: 0, end: 10 }, { start: 10, end: 15 }],
			chunks_enqueued: 2,
		});
		await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1", document_ids: ["doc-abc"] }));
		expect(mocks.enqueuePersistedJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: "deep_scan_visuals", deal_id: "deal-1" })
		);
	});

	// 10) deal_id derived from DB when only document_ids provided
	it("derives deal_id from DB when document_ids are provided without deal_id", async () => {
		mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ deal_id: "derived-deal" }] });
		const result = await deepScanVisualsProcessor(makeJob({ document_ids: ["doc-xyz"] }));
		expect(result).not.toEqual(expect.objectContaining({ reason: "missing_deal_id" }));
		expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
			"SELECT deal_id FROM documents WHERE id = $1 LIMIT 1",
			expect.any(Array)
		);
	});

	// 11) VISION_SERVICE_VERIFICATION_FAILED event logged before throw
	it("logs VISION_SERVICE_VERIFICATION_FAILED event before throwing", async () => {
		mocks.verifyVisionServiceForJob.mockResolvedValue({ ok: false, reason: "timeout" });
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(
			deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }))
		).rejects.toThrow();
		const logged = warnSpy.mock.calls
			.map((args) => { try { return JSON.parse(args[0]); } catch { return null; } })
			.filter(Boolean);
		const verFailed = logged.find((e: any) => e.event === "VISION_SERVICE_VERIFICATION_FAILED");
		expect(verFailed).toBeDefined();
		expect(verFailed.stage).toBe("deep_scan_visuals");
		warnSpy.mockRestore();
	});

	// 12) updateJob called with "running" status
	it("calls updateJob with running status after starting scan", async () => {
		await deepScanVisualsProcessor(makeJob({ deal_id: "deal-1" }));
		expect(mocks.updateJob).toHaveBeenCalledWith(
			expect.anything(), "running", expect.any(String), expect.any(Number)
		);
	});
});
