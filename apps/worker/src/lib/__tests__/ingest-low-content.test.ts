import { describe, it, expect } from "vitest";

import { decideLowContentOutcome } from "../ingest-low-content";

describe("decideLowContentOutcome", () => {
	it("pdf low-content retries then needs_ocr", () => {
		const retry = decideLowContentOutcome({
			contentType: "pdf",
			attempt: 0,
			completenessReason: "summary=10 chars, headings=0, metrics=0, score=0.00",
		});
		expect(retry.kind).toBe("retry");
		expect(retry.jobStatus).toBe("retrying");
		expect(retry.nextAttempt).toBe(1);

		const needsOcr = decideLowContentOutcome({
			contentType: "pdf",
			attempt: 2,
			completenessReason: "summary=500 chars, headings=0, metrics=0, score=0.40",
		});
		expect(needsOcr.kind).toBe("needs_ocr");
		expect(needsOcr.jobStatus).toBe("succeeded_with_warnings");
		expect(needsOcr.docStatus).toBe("needs_ocr");
		expect(needsOcr.enqueue.document_intelligence_extract).toBe(true);
		expect(needsOcr.enqueue.render_document_pages).toEqual({ force_ocr: true });
	});

	it("non-pdf low-content after retries fails", () => {
		const res = decideLowContentOutcome({
			contentType: "powerpoint",
			attempt: 2,
			completenessReason: "summary=0 chars, headings=0, metrics=0, score=0.00",
		});
		expect(res.kind).toBe("fail");
		expect(res.jobStatus).toBe("failed");
		expect(res.docStatus).toBe("failed");
	});
});
