import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock v1 PDF extraction to return a hybrid-like result: one page has text, one is empty.
vi.mock("../pdf", () => {
	return {
		extractPDFContent: vi.fn(async () => {
			return {
				metadata: { pages: 2 },
				pages: [
					{ pageNumber: 1, text: "Native page 1", words: [], metrics: [], tables: [] },
					{ pageNumber: 2, text: "", words: [], metrics: [], tables: [] },
				],
				summary: {
					totalWords: 0,
					totalPages: 2,
					processedPages: 2,
					mainHeadings: [],
					keyNumbers: [],
					textItems: 0,
					needsOcr: false,
					textProbe: {
						min_text_threshold_chars: 800,
						char_count: 1000,
						word_count: 10,
						pages_with_text: 1,
						pages_probed: 2,
						decision: "text_ok_skip_ocr",
						decided_at: new Date().toISOString(),
					},
					pageOcr: { attempted: false, pages_attempted: 0, failed_pages: [], errors: [] },
				},
			};
		}),
	};
});

// Mock v2 shadow extraction to provide final OCR text for the empty page.
vi.mock("../pdf-v2", () => {
	return {
		extractPDFContentV2Primary: vi.fn(async () => {
			throw new Error("not used");
		}),
		extractPDFContentV2Shadow: vi.fn(async () => {
			return {
				status: "ok",
				mode: "v2_shadow",
				extractor_version: "pdf_v2_shadow",
				document_id: "doc_1",
				created_at: new Date().toISOString(),
				summary: {
					pages: 2,
					native_only_pages: 1,
					ocr_pages: 1,
					hybrid_pages: 0,
					scanned_pages: 1,
					text_pages: 1,
					native_methods: { pymupdf: 2 },
				},
				pages: [
					{
						page_index: 0,
						page_number: 1,
						classification: {
							kind: "text",
							reason: "native_text_present",
							native_word_count: 10,
							native_text_len: 12,
							image_count: 0,
						},
						bbox_units: "normalized",
						native: { method: "pymupdf", text: "Native page 1", word_count: 10, blocks: [], confidence: 1 },
						final: { method: "native", text: "Native page 1" },
					},
					{
						page_index: 1,
						page_number: 2,
						classification: {
							kind: "scanned",
							reason: "native_text_sparse",
							native_word_count: 0,
							native_text_len: 0,
							image_count: 1,
						},
						bbox_units: "normalized",
						native: { method: "pymupdf", text: "", word_count: 0, blocks: [], confidence: 1 },
						ocr: { provider: "tesseract", text: "OCR page 2", word_count: 2, avg_confidence: 0.9, bbox_units: "pixels" },
						final: { method: "ocr", text: "OCR page 2" },
					},
				],
			};
		}),
	};
});

// Avoid slide understanding side effects.
vi.mock("../../pipeline-policy", () => {
	return {
		defaultPdfExtractMode: () => "v2_shadow",
		defaultShadowFeatureMode: () => "off",
	};
});

import { processDocument } from "../index";

describe("pdf v2 shadow merges final text into empty v1 pages", () => {
	const env = { ...process.env };

	beforeEach(() => {
		process.env = { ...env, PDF_EXTRACT_MODE: "v2_shadow", PDF_SLIDE_UNDERSTANDING_MODE: "off" };
	});

	afterEach(() => {
		process.env = env;
		vi.clearAllMocks();
	});

	it("fills v1 empty page text from v2 final text", async () => {
		const res = await processDocument(Buffer.from("%PDF-TEST"), "deck.pdf", "doc_1", "deal_1");
		expect(res.contentType).toBe("pdf");
		const content: any = res.content;
		expect(content?.pages?.[1]?.text).toBe("OCR page 2");
		expect(content?.pdf_v2).toBeDefined();
	});
});
