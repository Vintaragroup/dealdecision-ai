import { describe, expect, it } from "vitest";
import {
	buildDeepScanExtractionMetadataPatch,
	buildDeepScanPageSummaryV1,
	computeDeepScanOutcomeStatus,
	callVisionWorkerWithRetries,
} from "../visual-extraction";
import { vi } from "vitest";

describe("deep scan outcome semantics", () => {
	it("timeouts then succeed -> succeeded", async () => {
		const fetchImpl = vi
			.fn()
			.mockImplementationOnce(async (_url: string, init: any) => {
				return await new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (!signal) return reject(new Error("missing signal"));
					signal.addEventListener("abort", () => {
						const err: any = new Error("This operation was aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			})
			.mockImplementationOnce(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					document_id: "doc_1",
					page_index: 0,
					extractor_version: "v2",
					assets: [{ asset_type: "image_text" }],
				}),
			} as any));

		const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 10, extractorVersion: "v2" } as any;
		const res = await callVisionWorkerWithRetries(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "v2" } as any,
			{ fetchImpl, logger: null, logMeta: { deal_id: "deal_1" }, timeoutsMs: [10, 50], backoffMs: [1] }
		);

		expect(res.response).toBeTruthy();
		const summary = buildDeepScanPageSummaryV1({ attempted: 1, succeeded: 1, failures: [] });
		const status = computeDeepScanOutcomeStatus({ attempted: summary.attempted, succeeded: summary.succeeded });
		expect(status).toBe("succeeded");
	});

	it("one page fails but others succeed -> succeeded_with_warnings; metadata includes failure", () => {
		const failures = [{ page_index: 19, reason: "timeout", attempts_used: 3, elapsed_ms: 90000, status_code: null }];
		const summary = buildDeepScanPageSummaryV1({ attempted: 2, succeeded: 1, failures });
		const status = computeDeepScanOutcomeStatus({ attempted: summary.attempted, succeeded: summary.succeeded });
		expect(status).toBe("succeeded_with_warnings");

		const patch = buildDeepScanExtractionMetadataPatch({ existingVisualExtraction: {}, summary, status });
		const ve: any = (patch as any).visual_extraction;
		expect(ve.deep_scan_status).toBe("succeeded_with_warnings");
		expect(ve.deep_scan_page_summary_v1).toMatchObject({
			version: 1,
			attempted: 2,
			succeeded: 1,
			failed: 1,
		});
		expect(Array.isArray(ve.deep_scan_page_summary_v1.failures)).toBe(true);
		expect(ve.deep_scan_page_summary_v1.failures[0]).toMatchObject({ page_index: 19, reason: "timeout" });
	});

	it("all pages fail -> failed; metadata shows succeeded=0", () => {
		const failures = [
			{ page_index: 0, reason: "HTTP_429", attempts_used: 2, status_code: 429 },
			{ page_index: 1, reason: "timeout", attempts_used: 3, status_code: null },
		];
		const summary = buildDeepScanPageSummaryV1({ attempted: 2, succeeded: 0, failures });
		const status = computeDeepScanOutcomeStatus({ attempted: summary.attempted, succeeded: summary.succeeded });
		expect(status).toBe("failed");

		const patch = buildDeepScanExtractionMetadataPatch({ existingVisualExtraction: {}, summary, status });
		const ve: any = (patch as any).visual_extraction;
		expect(ve.deep_scan_status).toBe("failed");
		expect(ve.deep_scan_page_summary_v1).toMatchObject({ attempted: 2, succeeded: 0, failed: 2 });
	});
});
