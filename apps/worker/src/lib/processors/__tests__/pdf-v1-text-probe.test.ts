import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock pdfjs so we don't need a real PDF.
vi.mock("pdfjs-dist/legacy/build/pdf.js", () => {
	return {
		GlobalWorkerOptions: { disableWorker: true },
		getDocument: ({ data }: { data: Uint8Array }) => {
			// Keep behavior deterministic based on buffer content.
			const isSparse = Buffer.from(data).toString("utf8").includes("SPARSE");

			const makePage = (pageNumber: number) => {
				const page = {
					view: [0, 0, 1000, 1000],
					getTextContent: async () => {
						if (isSparse) {
							return { items: [] };
						}
						const text =
							"This is a normal text PDF page with sufficient native extraction for gating.";
						return {
							items: [
								{
									str: `${text} page=${pageNumber}`,
									transform: [1, 0, 0, 1, 0, 0],
									width: 100,
									height: 12,
								},
							],
						};
					},
				};
				return page;
			};

			return {
				promise: Promise.resolve({
					numPages: 2,
					getPage: async (i: number) => makePage(i),
					getMetadata: async () => ({ title: "Test PDF" }),
					destroy: async () => {},
				}),
			};
		},
	};
});

import { extractPDFContent, type PdfTextProbe } from "../pdf";

describe("pdf v1 text-probe OCR gating", () => {
	const env = { ...process.env };

	beforeEach(() => {
		process.env = { ...env };
	});

	afterEach(() => {
		process.env = env;
		vi.clearAllMocks();
	});

	it("skips OCR when native text is sufficient and persists probe via callback", async () => {
		process.env.PDF_MIN_TEXT_THRESHOLD_CHARS = "10";

		const onTextProbe = vi.fn<[PdfTextProbe], Promise<void>>(async () => {});
		const ocrPageV1 = vi.fn(async () => {
			return {
				text: "v1 ocr text",
				words: [{ text: "Hello", x: 0, y: 0, width: 10, height: 10, conf: 90 }],
				provider: "tesseract" as const,
				scale: 4,
				imageWidth: 1000,
				imageHeight: 1000,
				skippedRegions: 0,
				regions: [],
			};
		});
		const out = await extractPDFContent(Buffer.from("%PDF-TEXT"), { docId: "doc_1", onTextProbe, ocrPageV1 });

		expect(onTextProbe).toHaveBeenCalledTimes(1);
		expect(onTextProbe.mock.calls[0]?.[0]?.needsOcr).toBe(false);
		expect(out.summary.needsOcr).toBe(false);
		expect(out.summary.pageOcr?.attempted).toBe(false);
		expect(ocrPageV1).not.toHaveBeenCalled();
	});

	it("runs OCR when native text is sparse", async () => {
		process.env.PDF_MIN_TEXT_THRESHOLD_CHARS = "10";

		const onTextProbe = vi.fn<[PdfTextProbe], Promise<void>>(async () => {});
		const ocrPageV1 = vi.fn(async () => {
			return {
				text: "v1 ocr text",
				words: [{ text: "Hello", x: 0, y: 0, width: 10, height: 10, conf: 90 }],
				provider: "tesseract" as const,
				scale: 4,
				imageWidth: 1000,
				imageHeight: 1000,
				skippedRegions: 0,
				regions: [],
			};
		});
		const out = await extractPDFContent(Buffer.from("%PDF-SPARSE"), { docId: "doc_2", onTextProbe, ocrPageV1 });

		expect(onTextProbe).toHaveBeenCalledTimes(1);
		expect(onTextProbe.mock.calls[0]?.[0]?.needsOcr).toBe(true);
		expect(out.summary.needsOcr).toBe(true);
		expect(out.summary.pageOcr?.attempted).toBe(true);
		expect(ocrPageV1).toHaveBeenCalled();
	});
});
