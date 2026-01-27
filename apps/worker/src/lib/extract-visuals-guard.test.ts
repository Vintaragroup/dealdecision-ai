import { describe, expect, it } from "vitest";
import { evaluateVisualDocReadiness } from "./visual-readiness";

describe("evaluateVisualDocReadiness", () => {
	it("allows ready docs to proceed while isolating blocked docs", () => {
		const ready = evaluateVisualDocReadiness({
			id: "ready-1",
			status: "ready_for_analysis",
			deletedAt: null,
			metaStatus: "succeeded",
		});

		const blocked = evaluateVisualDocReadiness({
			id: "blocked-1",
			status: "processing",
			deletedAt: null,
			metaStatus: null,
		});

		expect(ready.blocked).toBe(false);
		expect(blocked.blocked).toBe(true);
		expect(blocked.reason).toBe("ingest_not_complete");
	});

	it("does not block based on stale jobs-table state", () => {
		const readyEvenIfJobFailed = evaluateVisualDocReadiness({
			id: "ready-2",
			status: "ready_for_analysis",
			deletedAt: null,
			metaStatus: "succeeded",
			jobStatus: "failed",
		});
		expect(readyEvenIfJobFailed.blocked).toBe(false);
	});
});
