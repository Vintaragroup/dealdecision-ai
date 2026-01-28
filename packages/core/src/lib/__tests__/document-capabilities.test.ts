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

	it("classifies xlsx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "model.xlsx" });
		expect(caps.kind).toBe("excel");
		expect(caps.supports_visual_extraction).toBe(true);
		expect(caps.render_source).toBe("office");
		expect(caps.visualExtractable).toBe(true);
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
