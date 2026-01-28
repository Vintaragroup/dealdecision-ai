import { getDocumentCapabilities, getInitialRenderedPagesChunk } from "../document-capabilities";

describe("document capabilities", () => {
	it("classifies pptx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "deck.pptx" });
		expect(caps.kind).toBe("powerpoint");
		expect(caps.visualExtractable).toBe(true);
		expect(caps.renderedPages.required).toBe(true);
	});

	it("classifies docx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "memo.docx" });
		expect(caps.kind).toBe("word");
		expect(caps.visualExtractable).toBe(true);
		expect(caps.renderedPages.required).toBe(true);
	});

	it("classifies xlsx as visual-extractable + rendered pages required", () => {
		const caps = getDocumentCapabilities({ fileName: "model.xlsx" });
		expect(caps.kind).toBe("excel");
		expect(caps.visualExtractable).toBe(true);
	});

	it("classifies csv as not visual-extractable", () => {
		const caps = getDocumentCapabilities({ fileName: "data.csv" });
		expect(caps.kind).toBe("csv");
		expect(caps.visualExtractable).toBe(false);
		expect(caps.renderedPages.required).toBe(false);
	});

	it("uses 1-page chunk for images", () => {
		const caps = getDocumentCapabilities({ fileName: "image.png" });
		const chunk = getInitialRenderedPagesChunk({ capabilities: caps, maxPagesPerChunk: 15, totalPagesHint: null });
		expect(chunk).toEqual({ page_start: 0, page_end: 1 });
	});
});
