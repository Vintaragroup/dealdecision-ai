import { describe, expect, it, vi } from "vitest";

// We mock the OCR helpers to throw.
vi.mock("../pdf", () => {
	return {
		extractPDFContent: vi.fn(async () => {
			throw new Error("not used by v2 shadow");
		}),
		ocrPdfPageV1: vi.fn(async () => {
			throw new Error("OCR timed out after 120000ms");
		}),
		ocrPdfPageV2: vi.fn(async () => {
			throw new Error("OCR v2 failed after 120000ms");
		}),
	};
});

// Mock vision-worker PDF v2 native extraction.
vi.mock("../../pdf_v2/vision-worker-client", () => {
	return {
		callPdfV2Worker: vi.fn(async () => {
			return {
				document_id: "doc_1",
				extractor_version: "pdf_native_v2",
				pages: [
					{
						page_index: 0,
						method: "pymupdf",
						text: "native text exists",
						word_count: 0,
						image_count: 1,
						page_width: 1,
						page_height: 1,
						blocks: [],
					},
				],
			};
		}),
	};
});

vi.mock("../../visual-extraction", () => {
	return {
		getVisionExtractorConfig: vi.fn(() => ({}) as any),
	};
});

type MockPdfTextContent = { items: Array<{ str?: string }> };

function makePdfjsPage(text: string) {
	return {
		getTextContent: async (): Promise<MockPdfTextContent> => ({
			items: [{ str: text }],
		}),
	};
}

vi.mock("pdfjs-dist/legacy/build/pdf.js", () => {
	const doc = {
		numPages: 1,
		getPage: async (_: number) => makePdfjsPage("native text exists"),
	};

	return {
		getDocument: (_: unknown) => ({
			promise: Promise.resolve(doc),
		}),
		GlobalWorkerOptions: {},
	};
});

// Import after mocks.
import { extractPDFContentV2Shadow, needsOcr } from "../pdf-v2";

describe("pdf v2 OCR failures are non-fatal", () => {
	it("records structured OCR errors and still returns native text", async () => {
		process.env.PDF_V2_OCR_MODE = "shadow";
		const result = await extractPDFContentV2Shadow(Buffer.from("%PDF-1.4"), { docId: "doc_1", fileName: "x.pdf" });

		expect(result.status).toBe("ok");
		expect(result.pages).toBeDefined();

		expect(result.pages!).toHaveLength(1);
		const page = result.pages![0];
		// OCR errors recorded
		expect(page.ocr_error).toMatchObject({
			stage: "pdf_v2_ocr_v1",
			page_index: 0,
			timeout_ms: 120000,
		});
		expect(page.ocr_v2_error).toMatchObject({
			stage: "pdf_v2_ocr_v2",
			page_index: 0,
			timeout_ms: 120000,
		});

		// Still succeeds via native text
		expect(page.final.text).toContain("native text exists");
	});
});

describe("pdf v2 per-page OCR gating", () => {
	it("forces OCR for scanned pages", () => {
		expect(
			needsOcr({
				kind: "scanned",
				reason: "x",
				native_word_count: 100,
				native_text_len: 1000,
				image_count: 1,
			})
		).toBe(true);
	});

	it("forces OCR when native text or word count is empty", () => {
		expect(
			needsOcr({
				kind: "text",
				reason: "x",
				native_word_count: 0,
				native_text_len: 500,
				image_count: 0,
			})
		).toBe(true);

		expect(
			needsOcr({
				kind: "text",
				reason: "x",
				native_word_count: 10,
				native_text_len: 0,
				image_count: 0,
			})
		).toBe(true);
	});
});
