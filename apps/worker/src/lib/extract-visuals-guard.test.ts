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

	it("allows needs_ocr docs when ingest meta succeeded", () => {
		const res = evaluateVisualDocReadiness({
			id: "needs-ocr-1",
			status: "needs_ocr",
			deletedAt: null,
			metaStatus: "succeeded",
		});
		expect(res.blocked).toBe(false);
		expect(res.reason).toBe(null);
	});

	// Regression: documents where ingest left status='completed' (pre-fix path) must still
	// be blocked by the guard. The fix to ingest changes the status to 'ready_for_analysis'
	// going forward; older docs with 'completed' remain blocked until reconcile-ingest runs.
	it("blocks docs with status=completed even when metaStatus=succeeded (old ingest path)", () => {
		const res = evaluateVisualDocReadiness({
			id: "old-ingest-1",
			status: "completed",
			deletedAt: null,
			metaStatus: "succeeded",
		});
		expect(res.blocked).toBe(true);
		expect(res.reason).toBe("ingest_not_complete");
	});

	// After the fix: ingest sets status='ready_for_analysis' + ready_for_analysis_at together.
	// When ready_for_analysis_at is set, status is 'ready_for_analysis', so the guard passes.
	it("does not block when ingest set status=ready_for_analysis (ready_for_analysis_at was populated)", () => {
		const res = evaluateVisualDocReadiness({
			id: "fixed-ingest-1",
			status: "ready_for_analysis",
			deletedAt: null,
			metaStatus: "succeeded",
		});
		expect(res.blocked).toBe(false);
		expect(res.reason).toBe(null);
	});

	// When ready_for_analysis_at is null (ingest hasn't completed or is still on old path),
	// the status is not yet 'ready_for_analysis', so the guard blocks.
	it("blocks when ready_for_analysis_at is null (ingest not yet completed)", () => {
		// Simulates a document mid-ingest: status=processing, no metaStatus yet.
		const res = evaluateVisualDocReadiness({
			id: "pending-ingest-1",
			status: "processing",
			deletedAt: null,
			metaStatus: null,
		});
		expect(res.blocked).toBe(true);
		expect(res.reason).toBe("ingest_not_complete");
	});
});
