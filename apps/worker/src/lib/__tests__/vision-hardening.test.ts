import { describe, expect, it, vi } from "vitest";

import { callVisionWorker, createVisionJobRuntime } from "../visual-extraction";

function makeResponse(params: {
	ok: boolean;
	status: number;
	headers?: Record<string, string>;
	json?: any;
}) {
	const headerMap = new Map<string, string>();
	for (const [k, v] of Object.entries(params.headers ?? {})) headerMap.set(k.toLowerCase(), v);
	return {
		ok: params.ok,
		status: params.status,
		headers: {
			get: (key: string) => headerMap.get(String(key).toLowerCase()) ?? null,
		},
		json: async () => params.json ?? {},
	} as any;
}

describe("vision hardening", () => {
	it("disables vision for the job when /health returns 404", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
			error: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi.fn(async (url: string) => {
			if (url.endsWith("/health")) return makeResponse({ ok: false, status: 404 });
			throw new Error(`unexpected fetch: ${url}`);
		});

		const config = { enabled: true, visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "vision_v1", maxPages: 10 } as any;
		const runtime = createVisionJobRuntime({ config, logger, logMeta: { job_id: "job_1", deal_id: "deal_1" } });

		const res = await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "vision_v1" } as any,
			{ fetchImpl: fetchImpl as any, logger, runtime }
		);

		expect(res).toBeNull();
		expect(runtime.disabled).toBe(true);
		expect(runtime.disabledEvent).toBe("VISION_DISABLED_NO_SERVER");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const disabled = logs.find((l) => l.event === "VISION_DISABLED_NO_SERVER");
		expect(disabled).toMatchObject({ where: "health", status_code: 404 });
	});

	it("disables vision when OpenAPI lacks POST /extract-visuals", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
			error: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const fetchImpl = vi.fn(async (url: string) => {
			if (url.endsWith("/health")) return makeResponse({ ok: true, status: 200, json: { ok: true } });
			if (url.endsWith("/openapi.json")) return makeResponse({ ok: true, status: 200, json: { paths: {} } });
			throw new Error(`unexpected fetch: ${url}`);
		});

		const config = { enabled: true, visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "vision_v1", maxPages: 10 } as any;
		const runtime = createVisionJobRuntime({ config, logger, logMeta: { job_id: "job_1" } });

		const res = await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "vision_v1" } as any,
			{ fetchImpl: fetchImpl as any, logger, runtime }
		);

		expect(res).toBeNull();
		expect(runtime.disabled).toBe(true);
		expect(runtime.disabledEvent).toBe("VISION_DISABLED_OPENAPI_MISSING_ROUTE");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const disabled = logs.find((l) => l.event === "VISION_DISABLED_OPENAPI_MISSING_ROUTE");
		expect(disabled).toMatchObject({ where: "openapi", missing: "POST /extract-visuals" });
	});

	it("runs health/openapi once per job, and disables on 404 from /extract-visuals", async () => {
		const logs: any[] = [];
		const logger = {
			log: (msg: string) => logs.push(JSON.parse(msg)),
			warn: (msg: string) => logs.push(JSON.parse(msg)),
			error: (msg: string) => logs.push(JSON.parse(msg)),
		} as any;

		const counts: Record<string, number> = { health: 0, openapi: 0, extract: 0 };
		const fetchImpl = vi.fn(async (url: string, init?: any) => {
			if (url.endsWith("/health")) {
				counts.health += 1;
				return makeResponse({ ok: true, status: 200, json: { ok: true } });
			}
			if (url.endsWith("/openapi.json")) {
				counts.openapi += 1;
				return makeResponse({
					ok: true,
					status: 200,
					json: { paths: { "/extract-visuals": { post: {} } } },
				});
			}
			if (url.endsWith("/extract-visuals") && init?.method === "POST") {
				counts.extract += 1;
				if (counts.extract === 1) {
					return makeResponse({
						ok: true,
						status: 200,
						json: { document_id: "doc_1", page_index: 0, extractor_version: "vision_v1", assets: [] },
					});
				}
				return makeResponse({ ok: false, status: 404, headers: { "x-render-routing": "no-server" } });
			}
			throw new Error(`unexpected fetch: ${url}`);
		});

		const config = { enabled: true, visionWorkerUrl: "https://vision.example", timeoutMs: 1000, extractorVersion: "vision_v1", maxPages: 10 } as any;
		const runtime = createVisionJobRuntime({ config, logger, logMeta: { job_id: "job_1" } });

		const ok = await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 0, image_uri: "x", extractor_version: "vision_v1" } as any,
			{ fetchImpl: fetchImpl as any, logger, runtime }
		);
		expect(ok).not.toBeNull();
		expect(counts.health).toBe(1);
		expect(counts.openapi).toBe(1);

		const fail = await callVisionWorker(
			config,
			{ document_id: "doc_1", page_index: 1, image_uri: "x", extractor_version: "vision_v1" } as any,
			{ fetchImpl: fetchImpl as any, logger, runtime }
		);
		expect(fail).toBeNull();
		expect(counts.health).toBe(1);
		expect(counts.openapi).toBe(1);
		expect(runtime.disabled).toBe(true);
		expect(runtime.disabledEvent).toBe("VISION_DISABLED_NO_SERVER");
		const disabled = logs.find((l) => l.event === "VISION_DISABLED_NO_SERVER");
		expect(disabled).toBeTruthy();
	});
});
