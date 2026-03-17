import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
const updateJobProgress = vi.fn(async () => undefined);
const getPool = vi.fn();
const getDocumentOriginalFile = vi.fn();
const mergeDocumentExtractionMetadata = vi.fn(async () => undefined);
const updateDocumentAnalysis = vi.fn(async () => undefined);
const getR2BucketIfEnabled = vi.fn(() => null as string | null);
const getDocumentStorageMode = vi.fn(() => "local" as string);
const uploadToR2 = vi.fn(async () => undefined);
const r2ObjectExists = vi.fn(async () => true);
const getVisualPageImagePersistConfig = vi.fn(() => ({ maxPages: 10, dpiScaling: 1 }));
const persistRenderedPageImages = vi.fn(async () => ({
	rendered_pages_count: 5,
	rendered_pages_dir: "/tmp/test-renders",
	page_count_detected: 5,
}));
const persistImagePage = vi.fn(async () => ({
	rendered_pages_dir: "/tmp/test-renders",
}));
const r2RenderedPageKey = vi.fn((prefix: string, idx: number) => `${prefix}/page_${String(idx).padStart(4, "0")}.png`);
const convertOfficeToPdfBuffer = vi.fn(async () => ({
	pdf: Buffer.from("%PDF-1.4"),
	reason: null,
}));
const getQueue = vi.fn(() => ({ add: vi.fn(async () => undefined) }));
const makeJobId = vi.fn((_type: string, parts: string[]) => parts.join("__"));
const enqueueExtractVisualsIfPossible = vi.fn(async () => false);
const getVisionExtractorConfig = vi.fn(() => ({ enabled: false }));
const shouldSkipExtractVisualsAfterRenderV1 = vi.fn(() => false);
const resolveWritableUploadDir = vi.fn(async () => "/tmp/test-uploads");
const computeAndPersistVisionRoutingV1 = vi.fn(async () => ({
	doc_kind: "pdf",
	full_text_len: 0,
	decision: { vision_fallback_allowed: false, reason: "low_text", inputs: {} },
}));

vi.mock("../../lib/job-progress", () => ({ updateJobProgress }));
vi.mock("../../lib/db", () => ({
	getPool,
	mergeDocumentExtractionMetadata,
	updateDocumentAnalysis,
	getDocumentOriginalFile,
}));
vi.mock("../../lib/document-storage-mode", () => ({ getR2BucketIfEnabled, getDocumentStorageMode }));
vi.mock("../../lib/r2", () => ({ uploadToR2, r2ObjectExists }));
vi.mock("../../lib/rendered-pages", () => ({
	getVisualPageImagePersistConfig,
	persistRenderedPageImages,
	persistImagePage,
	r2RenderedPageKey,
	convertOfficeToPdfBuffer,
}));
vi.mock("../../lib/queue", () => ({ getQueue }));
vi.mock("../../lib/job-id", () => ({ makeJobId }));
vi.mock("../../lib/visual-extraction", () => ({
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
}));
vi.mock("../../lib/render-followups", () => ({ shouldSkipExtractVisualsAfterRenderV1 }));
vi.mock("../../lib/upload-dir-resolver", () => ({ resolveWritableUploadDir }));
vi.mock("../../lib/vision-routing", () => ({ computeAndPersistVisionRoutingV1 }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(data: Record<string, unknown> = {}, id = "job-rdp-1") {
	return {
		id,
		data,
		updateProgress: vi.fn(async () => undefined),
	} as any;
}

function makePool(rows: Record<string, unknown>[] = []) {
	return { query: vi.fn(async () => ({ rows })) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderDocumentPagesProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: no R2, local storage
		getR2BucketIfEnabled.mockReturnValue(null);
		getDocumentStorageMode.mockReturnValue("local");
		getVisionExtractorConfig.mockReturnValue({ enabled: false });
	});

	it("returns missing_document_id when document_id is absent", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool();
		getPool.mockReturnValue(pool);

		const job = makeJob({ deal_id: "deal-1" });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toEqual({ ok: false, reason: "missing_document_id" });
		expect(updateJobProgress).toHaveBeenCalledWith(
			job,
			expect.objectContaining({ status: "failed", message: "Missing document_id" })
		);
	});

	it("returns missing_original_bytes when getDocumentOriginalFile throws", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockRejectedValue(new Error("not found"));

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-1" });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toEqual({ ok: false, reason: "missing_original_bytes" });
	});

	it("returns missing_original_bytes when buffer is empty", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({ bytes: Buffer.alloc(0), file_name: "doc.pdf", mime_type: "application/pdf" });

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-1" });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toEqual({ ok: false, reason: "missing_original_bytes" });
	});

	it("normalizes nested payload wrapper and extracts document_id", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("%PDF-1.4 rest of pdf"),
			file_name: "doc.pdf",
			mime_type: "application/pdf",
		});
		persistRenderedPageImages.mockResolvedValue({
			rendered_pages_count: 5,
			rendered_pages_dir: "/tmp/test",
			page_count_detected: 5,
		});

		// Nested payload wrapper
		const job = makeJob({ payload: { deal_id: "deal-1", document_id: "doc-via-payload", page_start: 0, page_end: 5 } });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toMatchObject({ ok: true });
		expect(persistRenderedPageImages).toHaveBeenCalledWith(
			expect.objectContaining({ documentId: "doc-via-payload" })
		);
	});

	it("renders PDF chunk and emits PDF_RENDERED_PAGES_CHUNK + RENDER_CHUNK_DONE log events", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("%PDF-1.4 rest"),
			file_name: "test.pdf",
			mime_type: "application/pdf",
		});
		persistRenderedPageImages.mockResolvedValue({
			rendered_pages_count: 5,
			rendered_pages_dir: "/tmp/renders",
			page_count_detected: 5,
		});

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-pdf", page_start: 0, page_end: 5 });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toMatchObject({ ok: true, rendered: 5, total_pages: 5 });

		const calls = logSpy.mock.calls.map((c) => {
			try { return JSON.parse(c[0]); } catch { return null; }
		}).filter(Boolean);
		const events = calls.map((c: any) => c.event);

		expect(events).toContain("PDF_RENDERED_PAGES_CHUNK");
		expect(events).toContain("RENDER_CHUNK_DONE");

		logSpy.mockRestore();
	});

	it("success: calls updateJob with 'succeeded' and returns ok=true", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("%PDF-1.4 rest"),
			file_name: "test.pdf",
			mime_type: "application/pdf",
		});

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-ok", page_start: 0, page_end: 5 });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toMatchObject({ ok: true });
		const succeededCalls = (updateJobProgress as any).mock.calls.filter(
			(c: any[]) => c[1]?.status === "succeeded"
		);
		expect(succeededCalls.length).toBeGreaterThan(0);
	});

	it("triggers extract_visuals when vision config is enabled and final chunk", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 5, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("%PDF-1.4 rest"),
			file_name: "test.pdf",
			mime_type: "application/pdf",
		});
		persistRenderedPageImages.mockResolvedValue({
			rendered_pages_count: 5,
			rendered_pages_dir: "/tmp/renders",
			page_count_detected: 5,
		});
		getVisionExtractorConfig.mockReturnValue({ enabled: true });
		shouldSkipExtractVisualsAfterRenderV1.mockReturnValue(false);
		enqueueExtractVisualsIfPossible.mockResolvedValue(true);

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-vis", page_start: 0, page_end: 5 });
		await renderDocumentPagesProcessor(job);

		expect(computeAndPersistVisionRoutingV1).toHaveBeenCalledWith(
			expect.objectContaining({ documentId: "doc-vis", stage: "render_document_pages" })
		);
		expect(enqueueExtractVisualsIfPossible).toHaveBeenCalled();
	});

	it("office doc conversion failure returns ok=false reason=office_to_pdf_failed", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 0, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("PK\x03\x04"), // zip-like pptx
			file_name: "deck.pptx",
			mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		});
		convertOfficeToPdfBuffer.mockResolvedValue({ pdf: null as any, reason: "libreoffice_error" as any });

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-pptx" });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toEqual({ ok: false, reason: "office_to_pdf_failed" });
	});

	it("image document renders as single page and returns ok=true rendered=1", async () => {
		const { renderDocumentPagesProcessor } = await import("../render-document-pages/processor.js");
		const pool = makePool([{ page_count: 0, extraction_metadata: null, deal_id: "deal-1" }]);
		getPool.mockReturnValue(pool);
		getDocumentOriginalFile.mockResolvedValue({
			bytes: Buffer.from("PNG\x89"),
			file_name: "chart.png",
			mime_type: "image/png",
		});
		persistImagePage.mockResolvedValue({ rendered_pages_dir: "/tmp/img-renders" });

		const job = makeJob({ deal_id: "deal-1", document_id: "doc-img" });
		const result = await renderDocumentPagesProcessor(job);

		expect(result).toMatchObject({ ok: true, rendered: 1, total_pages: 1 });
		expect(persistImagePage).toHaveBeenCalled();
		expect(persistRenderedPageImages).not.toHaveBeenCalled();
	});
});
