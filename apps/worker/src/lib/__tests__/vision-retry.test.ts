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
			.fn()
			.mockImplementationOnce(async (_url: string, init: any) => {
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
			.mockImplementationOnce(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					document_id: "doc_1",
					page_index: 1,
					extractor_version: "v2",
					assets: [{ asset_type: "image_text" }],
				}),
			} as any));

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
});
