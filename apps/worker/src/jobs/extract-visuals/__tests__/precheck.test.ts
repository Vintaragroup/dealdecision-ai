/**
 * precheck.test.ts
 *
 * Behavioral tests for runExtractVisualsPrecheck.
 * Covers: empty docs early exit, disabled config, missing tables,
 * successful ready path, chunk/coordinator detection, explicitDocumentIds,
 * and DB-lookup resolution by deal_id.
 */

// Env must be set before any imports that touch db.ts
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.ENABLE_VISUAL_EXTRACTION = "1";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/db", () => ({
	getPool: vi.fn(),
	getDocumentsForDeal: vi.fn().mockResolvedValue([]),
	mergeDocumentExtractionMetadata: vi.fn().mockResolvedValue(undefined),
	getDocumentOriginalFile: vi.fn().mockResolvedValue(null),
	upsertDocumentOriginalFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/visual-extraction", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/visual-extraction")>(
		"../../../lib/visual-extraction"
	);
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
		resolvePageImageUris: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("../../../lib/vision-verification", () => ({
	verifyVisionServiceForJob: vi.fn().mockResolvedValue({ ok: true, reason: null }),
}));

vi.mock("../../../lib/enqueue-analyze-deal", () => ({
	enqueueAnalyzeDeal: vi.fn().mockResolvedValue({ enqueued: false }),
}));

vi.mock("../../../lib/worker-utils", () => ({
	makeDevLogger: vi.fn(() => vi.fn()),
	updateJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/memory", () => ({
	logMemory: vi.fn(),
	yieldToEventLoop: vi.fn().mockResolvedValue(undefined),
}));

import { runExtractVisualsPrecheck } from "../precheck";
import { getPool, getDocumentsForDeal } from "../../../lib/db";
import { getVisionExtractorConfig, hasTable } from "../../../lib/visual-extraction";
import { verifyVisionServiceForJob } from "../../../lib/vision-verification";
import { enqueueAnalyzeDeal } from "../../../lib/enqueue-analyze-deal";
import { updateJob } from "../../../lib/worker-utils";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePoolMock() {
	return {
		query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
	};
}

function makeJob(overrides: {
	id?: string;
	data?: Record<string, unknown>;
} = {}) {
	return {
		id: overrides.id ?? "job-precheck-1",
		data: overrides.data ?? {},
		updateProgress: vi.fn(),
	} as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runExtractVisualsPrecheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		const pool = makePoolMock();
		vi.mocked(getPool).mockReturnValue(pool as any);

		vi.mocked(getVisionExtractorConfig).mockReturnValue({
			enabled: true,
			visionWorkerUrl: "http://vision.mock",
			extractorVersion: "v1",
			maxPages: 50,
		} as any);
		vi.mocked(verifyVisionServiceForJob).mockResolvedValue({ ok: true, reason: null } as any);
		vi.mocked(hasTable).mockResolvedValue(true);
		vi.mocked(getDocumentsForDeal).mockResolvedValue([]);
	});

	// ── 1. Empty targetDocumentIds → failed=true ────────────────────────────────

	it("returns failed=true when no document_id, document_ids, or deal_id is provided", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, {});

		expect(result.failed).toBe(true);
		if (result.failed) {
			expect(result.result.ok).toBe(false);
		}
		expect(vi.mocked(updateJob)).toHaveBeenCalledWith(
			job,
			"failed",
			expect.stringContaining("Missing document_id"),
			100
		);
	});

	it("returns failed=true when deal_id is provided but DB returns empty docs", async () => {
		vi.mocked(getDocumentsForDeal).mockResolvedValue([]);
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { deal_id: "deal-empty" });

		expect(result.failed).toBe(true);
	});

	// ── 2. config.enabled=false → failed=true ───────────────────────────────────

	it("returns failed=true with skipped+reason=disabled when ENABLE_VISUAL_EXTRACTION is off", async () => {
		vi.mocked(getVisionExtractorConfig).mockReturnValue({
			enabled: false,
			visionWorkerUrl: "http://vision.mock",
			extractorVersion: "v1",
			maxPages: 50,
		} as any);

		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { document_id: "doc-0001" });

		expect(result.failed).toBe(true);
		if (result.failed) {
			expect(result.result.ok).toBe(false);
			expect(result.result.skipped).toBe(true);
			expect(result.result.reason).toBe("disabled");
		}
		expect(vi.mocked(enqueueAnalyzeDeal)).toHaveBeenCalledWith(
			expect.objectContaining({ skipReason: "visual_extraction_disabled" })
		);
	});

	// ── 3. Missing required tables → failed=true ────────────────────────────────

	it("returns failed=true with skipped+reason=tables_missing when visual tables are absent", async () => {
		// hasTable returns false for the required visual tables
		vi.mocked(hasTable).mockResolvedValue(false);

		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { document_id: "doc-0001" });

		expect(result.failed).toBe(true);
		if (result.failed) {
			expect(result.result.ok).toBe(false);
			expect(result.result.skipped).toBe(true);
			expect(result.result.reason).toBe("tables_missing");
		}
		expect(vi.mocked(enqueueAnalyzeDeal)).toHaveBeenCalledWith(
			expect.objectContaining({ skipReason: "visual_tables_missing" })
		);
	});

	// ── 4. Successful ready path → failed=false ──────────────────────────────────

	it("returns failed=false with a populated context when all checks pass", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { document_id: "doc-happy" });

		expect(result.failed).toBe(false);
		if (!result.failed) {
			const ctx = result.context;
			expect(ctx.targetDocumentIds).toEqual(["doc-happy"]);
			expect(ctx.documentId).toBe("doc-happy");
			expect(ctx.pool).toBeDefined();
			expect(ctx.config.enabled).toBe(true);
			expect(ctx.visionEnabledForJob).toBe(true);
			expect(ctx.extractorVersion).toBe("v1");
			expect(ctx.tablesOk).toBe(true);
			expect(ctx.structuredExtractorVersion).toBe("structured_native_v1");
		}
	});

	it("exposes all required context fields", async () => {
		const job = makeJob({ id: "job-ctx-check" });
		const result = await runExtractVisualsPrecheck(job, {
			document_id: "doc-ctx",
			deal_id: "deal-ctx",
			force_resegment: true,
			force_ocr: true,
			enqueue_deep_scan: true,
		});

		expect(result.failed).toBe(false);
		if (!result.failed) {
			const ctx = result.context;
			// Verify all 26 context fields are present and typed
			expect(typeof ctx.pool).toBe("object");
			expect(typeof ctx.payload).toBe("object");
			expect(ctx.documentId).toBe("doc-ctx");
			expect(ctx.dealId).toBe("deal-ctx");
			expect(typeof ctx.dealIdForAudit).toBe("string");
			expect(Array.isArray(ctx.targetDocumentIds)).toBe(true);
			expect(typeof ctx.config).toBe("object");
			expect(typeof ctx.visionRuntime).toBe("object");
			expect(typeof ctx.visionEnabledForJob).toBe("boolean");
			expect(typeof ctx.extractorVersion).toBe("string");
			expect(typeof ctx.structuredExtractorVersion).toBe("string");
			expect(typeof ctx.allowRenderedPagesFallback).toBe("boolean");
			expect(typeof ctx.nonPdfRenderEnabled).toBe("boolean");
			expect(ctx.tablesOk).toBe(true);
			expect(typeof ctx.originalFileTablesOk).toBe("boolean");
			expect(typeof ctx.documentsMetaStatusOk).toBe("boolean");
			expect(ctx.forceResegment).toBe(true);
			expect(ctx.forceReextract).toBe(false);
			expect(ctx.forceOcr).toBe(true);
			expect(ctx.enqueueDeepScan).toBe(true);
			expect(typeof ctx.requestedPageStart).toBe("number");
			expect(ctx.imageUris).toBeUndefined();
			expect(typeof ctx.isChunkJob).toBe("boolean");
			expect(typeof ctx.isCoordinator).toBe("boolean");
		}
	});

	// ── 5. Chunk job detection ────────────────────────────────────────────────────

	it("sets isChunkJob=true and isCoordinator=false when chunk is present", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, {
			document_id: "doc-chunk",
			chunk: { page_start: 0, page_end: 50 },
		});

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.isChunkJob).toBe(true);
			expect(result.context.isCoordinator).toBe(false);
			expect(result.context.requestedPageStart).toBe(0);
			expect(result.context.requestedPageEnd).toBe(50);
		}
	});

	it("sets isChunkJob=true from top-level page_start/page_end fields", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, {
			document_id: "doc-chunk-flat",
			page_start: 10,
			page_end: 20,
		});

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.isChunkJob).toBe(true);
			expect(result.context.requestedPageStart).toBe(10);
			expect(result.context.requestedPageEnd).toBe(20);
		}
	});

	// ── 6. Coordinator job detection ──────────────────────────────────────────────

	it("sets isChunkJob=false and isCoordinator=true when no chunk is present", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { document_id: "doc-coord" });

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.isChunkJob).toBe(false);
			expect(result.context.isCoordinator).toBe(true);
		}
	});

	// ── 7. explicitDocumentIds resolution ─────────────────────────────────────────

	it("resolves targetDocumentIds from document_ids array", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, {
			document_ids: ["doc-a", "doc-b", "doc-c"],
		});

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.targetDocumentIds).toEqual(["doc-a", "doc-b", "doc-c"]);
			expect(result.context.documentId).toBeUndefined();
		}
	});

	it("filters invalid entries out of document_ids", async () => {
		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, {
			// 123 is a number, empty string is invalid
			document_ids: ["doc-valid", 123, "", "doc-also-valid"] as any,
		});

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.targetDocumentIds).toEqual(["doc-valid", "doc-also-valid"]);
		}
	});

	// ── 8. DB lookup resolution by deal_id ────────────────────────────────────────

	it("resolves targetDocumentIds from DB when only deal_id is provided", async () => {
		vi.mocked(getDocumentsForDeal).mockResolvedValue([
			{ document_id: "doc-db-1" },
			{ document_id: "doc-db-2" },
		] as any);

		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { deal_id: "deal-db-test" });

		expect(result.failed).toBe(false);
		if (!result.failed) {
			expect(result.context.targetDocumentIds).toEqual(["doc-db-1", "doc-db-2"]);
			expect(result.context.dealId).toBe("deal-db-test");
		}
		expect(vi.mocked(getDocumentsForDeal)).toHaveBeenCalledWith("deal-db-test");
	});

	it("returns failed=true when getDocumentsForDeal throws", async () => {
		vi.mocked(getDocumentsForDeal).mockRejectedValue(new Error("DB connection refused"));

		const job = makeJob();
		const result = await runExtractVisualsPrecheck(job, { deal_id: "deal-db-fail" });

		expect(result.failed).toBe(true);
		if (result.failed) {
			expect(result.result.ok).toBe(false);
		}
		expect(vi.mocked(updateJob)).toHaveBeenCalledWith(
			job,
			"failed",
			expect.stringContaining("DB connection refused"),
			100
		);
	});
});
