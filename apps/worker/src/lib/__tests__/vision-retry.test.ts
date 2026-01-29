import { describe, expect, it, vi } from "vitest";
import { callVisionWorkerWithRetries } from "../visual-extraction";

describe("callVisionWorkerWithRetries", () => {
	it("retries on HTTP 429 and succeeds", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi
			.fn()
			.mockImplementationOnce(async () => ({ ok: false, status: 429, json: async () => ({}) } as any))
			.mockImplementationOnce(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					document_id: "doc_1",
					page_index: 7,
					extractor_version: "v2",
					assets: [{ asset_type: "image_text" }],
				}),
			} as any));

		const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "v2" } as any;
		const res = await callVisionWorkerWithRetries(
			config,
			{ document_id: "doc_1", page_index: 7, image_uri: "https://signed.example/p/page_0007.png", extractor_version: "v2" } as any,
			{ fetchImpl, logger, logMeta: { deal_id: "deal_1" }, timeoutsMs: [50, 50], backoffMs: [1] }
		);

		expect(res.response).toBeTruthy();
		expect(res.attempts.length).toBe(2);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(logs.some((l) => l.event === "VISION_REQUEST_RETRY")).toBe(true);
	});

	it("retries on abort/timeout and then succeeds", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi
			.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>()
			.mockImplementationOnce(async (_url: RequestInfo | URL, init: any) => {
				return await new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (!signal) return reject(new Error("missing signal"));
					signal.addEventListener("abort", () => {
						const err: any = new Error("aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			})
			.mockImplementationOnce(async () =>
				new Response(
					JSON.stringify({
						document_id: "doc_1",
						page_index: 1,
						extractor_version: "v2",
						assets: [{ asset_type: "image_text" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				)
			);

		const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 10, extractorVersion: "v2" } as any;
		const res = await callVisionWorkerWithRetries(
			config,
			{ document_id: "doc_1", page_index: 1, image_uri: "x", extractor_version: "v2" } as any,
			{ fetchImpl, logger, logMeta: { deal_id: "deal_1" }, timeoutsMs: [10, 50], backoffMs: [1] }
		);

		expect(res.response).toBeTruthy();
		expect(res.attempts.length).toBe(2);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(logs.some((l) => l.event === "VISION_REQUEST_RETRY")).toBe(true);
	});

	it("treats AbortError/'This operation was aborted' as retryable and uses exponential backoff by default", async () => {
		vi.useFakeTimers();
		try {
			const logs: any[] = [];
			const logger = {
				log: (msg: string) => logs.push(JSON.parse(msg)),
				warn: (msg: string) => logs.push(JSON.parse(msg)),
			} as any;

			const callTimes: number[] = [];
			let calls = 0;
			const fetchImpl = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async (_url: any, init: any) => {
				callTimes.push(Date.now());
				calls += 1;
				if (calls < 3) {
					return await new Promise((_resolve, reject) => {
						const signal = init?.signal as AbortSignal | undefined;
						if (!signal) return reject(new Error("missing signal"));
						signal.addEventListener("abort", () => {
							const err: any = new Error("This operation was aborted");
							err.name = "AbortError";
							reject(err);
						});
					});
				}
				return new Response(
					JSON.stringify({
						document_id: "doc_1",
						page_index: 0,
						extractor_version: "v2",
						assets: [{ asset_type: "image_text" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			});

			const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 5, extractorVersion: "v2" } as any;
			const promise = callVisionWorkerWithRetries(
				config,
				{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "v2" } as any,
				{ fetchImpl, logger, logMeta: { deal_id: "deal_1" }, timeoutsMs: [5, 5, 5], jitterPct: 0 }
			);

			// Let the first attempt start.
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(1);

			// Attempt 1 aborts at t=5ms, then waits exp backoff 500ms before attempt 2.
			await vi.advanceTimersByTimeAsync(5);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(499);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(1);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(2);

			// Attempt 2 aborts at +5ms, then waits exp backoff 1000ms before attempt 3.
			await vi.advanceTimersByTimeAsync(5);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(999);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(1);
			await vi.runAllTicks();
			expect(fetchImpl).toHaveBeenCalledTimes(3);

			const res = await promise;
			expect(res.response).toBeTruthy();
			expect(res.attempts.length).toBe(3);
			expect(res.attempts[0].error_kind).toBe("abort");
			expect(String(res.attempts[0].error)).toContain("aborted");
			expect(res.attempts[1].error_kind).toBe("abort");
			expect(String(res.attempts[1].error)).toContain("aborted");

			// Sanity: call timestamps reflect backoff (5ms timeout + 500ms, then +5ms + 1000ms).
			expect(callTimes.length).toBe(3);
			expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(505);
			expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(1005);
			expect(logs.some((l) => l.event === "VISION_REQUEST_RETRY" && l.reason === "abort")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
