import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock pdfjs so we don't need a real PDF.
vi.mock("pdfjs-dist/legacy/build/pdf.js", () => {
	return {
		GlobalWorkerOptions: { disableWorker: true },
		getDocument: () => ({
			promise: Promise.resolve({
				getPage: async () => ({ view: [0, 0, 1000, 1000] }),
			}),
		}),
	};
});

vi.mock("../../pdf_v2/vision-worker-client", () => {
	return {
		callPdfV2Worker: vi.fn(async () => ({
			document_id: "doc_1",
			extractor_version: "pdf_native_v2",
			pages: [
				{
					page_index: 0,
					method: "pdfplumber",
					text: "",
					word_count: 0,
					image_count: 1,
					page_width: 1000,
					page_height: 1000,
					blocks: [],
				},
				{
					page_index: 1,
					method: "pdfplumber",
					text: "some native text but still sparse",
					word_count: 10,
					image_count: 1,
					page_width: 1000,
					page_height: 1000,
					blocks: [],
				},
				{
					page_index: 2,
					method: "pdfplumber",
					text: "this is a normal text page with sufficient native extraction",
					word_count: 50,
					image_count: 0,
					page_width: 1000,
					page_height: 1000,
					blocks: [],
				},
			],
		})),
	};
});

// Mock OCR functions so we don't invoke tesseract.
vi.mock("../pdf", async () => {
	const actual = await vi.importActual<any>("../pdf");
	return {
		...actual,
		ocrPdfPageV1: vi.fn(async () => ({
			text: "v1 ocr text",
			words: [{ text: "Hello", x: 0, y: 0, width: 10, height: 10, conf: 90 }],
			provider: "tesseract",
			scale: 4,
			imageWidth: 1000,
			imageHeight: 1000,
			skippedRegions: 0,
		})),
		ocrPdfPageV2: vi.fn(async () => ({
			provider: "tesseract",
			version: "ocr_v2",
			text: "v2 ocr text",
			blocks: [
				{
					text: "v2 ocr text",
					bbox: { x: 0, y: 0, w: 100, h: 20 },
					bbox_units: "pixels",
					confidence: 0.9,
				},
			],
			avg_confidence: 0.9,
			bbox_units: "pixels",
			preproc: { mode: "basic", contrast: 1.2, threshold: 180 },
			scale: 4,
			imageWidth: 1000,
			imageHeight: 1000,
			regions: [],
			skippedRegions: 0,
			usedFullPageFallback: false,
		})),
	};
});

import { extractPDFContentV2Shadow } from "../pdf-v2";

describe("pdf v2 shadow ocr_v2 gating", () => {
	const env = { ...process.env };

	beforeEach(() => {
		process.env = { ...env };
	});

	afterEach(() => {
		process.env = env;
		vi.clearAllMocks();
	});

	it("does not attach ocr_v2 when PDF_V2_OCR_MODE is off", async () => {
		process.env.PDF_V2_OCR_MODE = "off";
		const out = await extractPDFContentV2Shadow(Buffer.from("%PDF-FAKE"), { docId: "doc_1" });
		const pages = (out as any).pages as any[];
		expect(pages[0].classification.kind).toBe("scanned");
		expect(pages[0].ocr_v2).toBeUndefined();
	});

	it("attaches ocr_v2 for scanned and hybrid-insufficient pages in shadow mode", async () => {
		process.env.PDF_V2_OCR_MODE = "shadow";
		const out = await extractPDFContentV2Shadow(Buffer.from("%PDF-FAKE"), { docId: "doc_1" });
		const pages = (out as any).pages as any[];

		// scanned => always gets ocr_v2
		expect(pages[0].classification.kind).toBe("scanned");
		expect(pages[0].ocr_v2?.version).toBe("ocr_v2");

		// hybrid + insufficient => gets ocr_v2
		expect(pages[1].classification.kind).toBe("hybrid");
		expect(typeof pages[1].ocr_v2?.text).toBe("string");

		// text => never gets ocr_v2
		expect(pages[2].classification.kind).toBe("text");
		expect(pages[2].ocr_v2).toBeUndefined();
	});
});
