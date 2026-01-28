import { describe, expect, it } from "vitest";
import {
	buildExtractVisualsExtractionMetadataPatchV1,
	buildExtractVisualsPageSummaryV1,
	computeExtractVisualsOutcomeStatusV1,
} from "../visual-extraction";

describe("extract visuals outcome semantics", () => {
	it("skipped existing counts as success (no false failed)", () => {
		const status = computeExtractVisualsOutcomeStatusV1({ visionAttempted: 1, visionSucceeded: 0, skippedExisting: 1 });
		expect(status).toBe("succeeded_with_warnings");
	});

	it("all vision attempts fail and no skips => failed", () => {
		const status = computeExtractVisualsOutcomeStatusV1({ visionAttempted: 2, visionSucceeded: 0, skippedExisting: 0 });
		expect(status).toBe("failed");
	});

	it("metadata patch overwrites stale failed status", () => {
		const summary = buildExtractVisualsPageSummaryV1({
			visionAttempted: 1,
			visionSucceeded: 1,
			skippedExisting: 0,
			failures: [],
			completedAt: "2026-01-28T00:00:00.000Z",
		});

		const patch = buildExtractVisualsExtractionMetadataPatchV1({
			existingVisualExtraction: { status: "failed", page_summary_v1: { old: true } },
			summary,
			status: "succeeded",
			extractorVersion: "vX",
		});

		const ve: any = (patch as any).visual_extraction;
		expect(ve.status).toBe("succeeded");
		expect(ve.extract_visuals_status).toBe("succeeded");
		expect(ve.extract_visuals_page_summary_v1).toMatchObject({ version: 1, attempted: 1, succeeded: 1, failed: 0 });
		expect(ve.page_summary_v1).toMatchObject({ version: 1, attempted: 1, succeeded: 1, failed: 0 });
	});
});
