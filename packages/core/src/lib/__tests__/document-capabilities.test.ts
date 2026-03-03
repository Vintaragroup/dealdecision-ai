import { getDocumentCapabilities, getInitialRenderedPagesChunk } from "../document-capabilities";

describe("document capabilities", () => {
	it("classifies pptx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "deck.pptx" });
		expect(caps.kind).toBe("powerpoint");
		expect(caps.supports_visual_extraction).toBe(true);
		expect(caps.supports_page_rendering).toBe(true);
		expect(caps.supports_text_extraction).toBe(true);
		expect(caps.render_source).toBe("office");
		expect(caps.visualExtractable).toBe(true);
		expect(caps.renderedPages.required).toBe(true);
	});

	it("classifies docx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "memo.docx" });
		expect(caps.kind).toBe("word");
		expect(caps.supports_visual_extraction).toBe(true);
		expect(caps.render_source).toBe("office");
		expect(caps.visualExtractable).toBe(true);
		expect(caps.renderedPages.required).toBe(true);
	});

	/**
	 * XLSX / spreadsheet documents use structured extraction (excel_range / excel_py), NOT
	 * rendered page images.  Marking supports_page_rendering=false prevents two bugs:
	 *
	 *  1. PAGE_COUNT_UNKNOWN: XLSX with page_count=0 was incorrectly flagged as needing
	 *     page rendering, causing the UI to be stuck on "Preparing documents…" forever.
	 *  2. Page-based readiness: even if page_count>0 (e.g. LibreOffice sets it), the
	 *     readiness SQL now excludes XLSX from the generate_series expected-pages CTE.
	 *
	 * supports_visual_extraction remains true so the document still enters the extraction
	 * pipeline (via the structured / excel_py path).
	 */
	it("classifies xlsx as visual-extractable but NOT page-rendering (structured extraction path)", () => {
		const caps = getDocumentCapabilities({ fileName: "model.xlsx" });
		expect(caps.kind).toBe("excel");
		expect(caps.supports_visual_extraction).toBe(true);
		expect(caps.visualExtractable).toBe(true);
		// XLSX uses structured extraction, not rendered page images:
		expect(caps.supports_page_rendering).toBe(false);
		expect(caps.renderedPages.required).toBe(false);
		expect(caps.renderedPages.supported).toBe(false);
		expect(caps.render_source).toBe("office");
	});

	it("classifies xls as visual-extractable but NOT page-rendering", () => {
		const caps = getDocumentCapabilities({ fileName: "legacy.xls" });
		expect(caps.kind).toBe("excel");
		expect(caps.supports_page_rendering).toBe(false);
		expect(caps.renderedPages.required).toBe(false);
	});

	it("classifies spreadsheet mime type as excel without page rendering", () => {
		const caps = getDocumentCapabilities({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
		expect(caps.kind).toBe("excel");
		expect(caps.supports_page_rendering).toBe(false);
		expect(caps.renderedPages.required).toBe(false);
	});

	it("classifies csv as not visual-extractable", () => {
		const caps = getDocumentCapabilities({ fileName: "data.csv" });
		expect(caps.kind).toBe("csv");
		expect(caps.supports_text_extraction).toBe(true);
		expect(caps.supports_page_rendering).toBe(false);
		expect(caps.supports_visual_extraction).toBe(false);
		expect(caps.visualExtractable).toBe(false);
		expect(caps.renderedPages.required).toBe(false);
	});

	it("uses 1-page chunk for images", () => {
		const caps = getDocumentCapabilities({ fileName: "image.png" });
		expect(caps.requires_ocr).toBe(true);
		expect(caps.render_source).toBe("image");
		const chunk = getInitialRenderedPagesChunk({ capabilities: caps, maxPagesPerChunk: 15, totalPagesHint: null });
		expect(chunk).toEqual({ page_start: 0, page_end: 1 });
	});
});
