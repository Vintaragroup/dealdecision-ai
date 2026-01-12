import { describe, expect, it } from "vitest";
import { evaluateVisualDocReadiness } from "./visual-readiness";

describe("evaluateVisualDocReadiness", () => {
	it("allows ready docs to proceed while isolating blocked docs", () => {
		const ready = evaluateVisualDocReadiness({
			id: "ready-1",
			status: "completed",
			hasExtractionMetadata: true,
			pageCount: 4,
			hasRenderedPages: true,
			hasOriginalBytes: true,
		});

		const blocked = evaluateVisualDocReadiness({
			id: "blocked-1",
			status: "processing",
			hasExtractionMetadata: false,
			pageCount: 0,
			hasRenderedPages: false,
			hasOriginalBytes: true,
		});

		expect(ready.blocked).toBe(false);
		expect(blocked.blocked).toBe(true);
		expect(blocked.reason).toBe("status_not_ready");
	});
});
