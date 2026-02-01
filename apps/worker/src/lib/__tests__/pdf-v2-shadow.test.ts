import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock v1 PDF extractor so this test is deterministic and doesn't require real PDFs.
vi.mock("../processors/pdf", () => {
	return {
		extractPDFContent: vi.fn(async () => ({
			metadata: { pages: 1 },
			pages: [{ pageNumber: 1, text: "hello", slideTitle: "", words: [], metrics: [], tables: [] }],
			summary: { totalWords: 1, totalPages: 1, processedPages: 1, mainHeadings: [], keyNumbers: [], textItems: 1 },
		})),
	};
});

vi.mock("../processors/pdf-v2", () => {
	return {
		extractPDFContentV2Shadow: vi.fn(async () => ({
			status: "ok",
			mode: "v2_shadow",
			extractor_version: "pdf_v2_shadow",
			document_id: "doc_1",
			created_at: new Date("2025-01-01T00:00:00.000Z").toISOString(),
			summary: { pages: 1, native_only_pages: 1, ocr_pages: 0, hybrid_pages: 0, scanned_pages: 0, text_pages: 1, native_methods: { pdfplumber: 1 } },
			pages: [],
		})),
	};
});

import { processDocument } from "../processors";

describe("pdf v2 shadow wiring", () => {
	const env = { ...process.env };

	beforeEach(() => {
		process.env = { ...env };
	});

	afterEach(() => {
		process.env = env;
		vi.clearAllMocks();
	});

	it("defaults to v1 (no pdf_v2 attached)", async () => {
		delete process.env.PDF_EXTRACT_MODE;
		const analysis = await processDocument(Buffer.from("%PDF-FAKE"), "file.pdf", "doc_1", "deal_1");
		expect(analysis.contentType).toBe("pdf");
		expect((analysis.content as any).pdf_v2).toBeTruthy();
	});

	it("attaches pdf_v2 artifacts in v2_shadow", async () => {
		process.env.PDF_EXTRACT_MODE = "v2_shadow";
		const analysis = await processDocument(Buffer.from("%PDF-FAKE"), "file.pdf", "doc_1", "deal_1");
		expect(analysis.contentType).toBe("pdf");
		expect((analysis.content as any).pdf_v2).toBeTruthy();
		expect((analysis.content as any).pdf_v2.status).toBe("ok");
	});
});
