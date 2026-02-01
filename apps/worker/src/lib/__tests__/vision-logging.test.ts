import { describe, expect, it, vi } from "vitest";
import { callVisionWorker } from "../visual-extraction";

describe("callVisionWorker logging", () => {
	it("emits VISION_REQUEST_START and VISION_REQUEST_DONE with required fields", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi.fn(async () => {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					document_id: "doc_1",
					page_index: 0,
					extractor_version: "v1",
					assets: [],
				}),
			} as any;
		});

		const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "v1" } as any;
		await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "https://signed.example/prefix/page_000.png", extractor_version: "v1" } as any,
			{
				fetchImpl,
				logger,
				logMeta: { deal_id: "deal_1" },
				attempt: 1,
			}
		);

		expect(logs.length).toBeGreaterThanOrEqual(2);
		const start = logs.find((l) => l.event === "VISION_REQUEST_START");
		const done = logs.find((l) => l.event === "VISION_REQUEST_DONE");

		expect(start).toMatchObject({
			event: "VISION_REQUEST_START",
			deal_id: "deal_1",
			document_id: "doc_1",
			page_index: 0,
			vision_base_url: "https://vision.example",
		});

		expect(done).toMatchObject({
			event: "VISION_REQUEST_DONE",
			deal_id: "deal_1",
			document_id: "doc_1",
			page_index: 0,
			vision_base_url: "https://vision.example",
			status_code: 200,
		});
		expect(typeof done.elapsed_ms).toBe("number");
	});

	it("logs VISION_REQUEST_DONE with error on fetch throw", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi.fn(async () => {
			throw new Error("boom");
		});

		const config = { visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "v1" } as any;
		const res = await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "v1" } as any,
			{ fetchImpl, logger, logMeta: { deal_id: "deal_1" }, attempt: 2 }
		);

		expect(res).toBeNull();
		const done = logs.find((l) => l.event === "VISION_REQUEST_DONE");
		expect(done).toMatchObject({
			event: "VISION_REQUEST_DONE",
			deal_id: "deal_1",
			status_code: null,
		});
		expect(String(done.error)).toContain("boom");
	});
});
