import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let extractVisualsProcessor: ((job: any) => Promise<any>) | null = null;

function getMocks(): Record<string, any> {
	const g: any = globalThis as any;
	if (!g.__extract_visuals_ingest_wait_test_mocks) g.__extract_visuals_ingest_wait_test_mocks = {};
	return g.__extract_visuals_ingest_wait_test_mocks as Record<string, any>;
}

vi.mock("../lib/queue", () => {
	const queues: Record<string, { add: any }> = {};
	getMocks().queues = queues;
	return {
		connection: { set: vi.fn(async () => "OK") },
		createWorker: (name: string, processor: any) => {
			if (name === "extract_visuals") extractVisualsProcessor = processor;
			return {};
		},
		getQueue: (name: string) => {
			if (!queues[name]) queues[name] = { add: vi.fn(async () => undefined) };
			return queues[name];
		},
		getBullmqRuntimeInfo: () => ({ version: "test", resolved: "mock" }),
		logWorkerQueueConfig: vi.fn(),
	};
});

vi.mock("../lib/job-progress", () => ({
	updateJobProgress: (() => {
		const fn = vi.fn(async () => undefined);
		getMocks().updateJobProgress = fn;
		return fn;
	})(),
}));

vi.mock("../lib/visual-extraction", async (importOriginal) => {
	const actual: any = await importOriginal();
	const resolvePageImageUris = vi.fn(async () => Array.from({ length: 5 }, (_, i) => `https://example.com/page_${i}.png`));
	getMocks().resolvePageImageUris = resolvePageImageUris;
	return {
		...actual,
		getVisionExtractorConfig: () => ({
			enabled: true,
			visionWorkerUrl: "http://vision",
			extractorVersion: "test",
			timeoutMs: 1000,
			maxPages: 10,
		}),
		hasTable: vi.fn(async () => true),
		resolvePageImageUris,
		persistSyntheticVisualAssets: vi.fn(async () => 0),
		persistVisionResponse: vi.fn(async () => 0),
		backfillVisualAssetImageUris: vi.fn(async () => ({ updated: 0 })),
		callVisionWorkerWithRetries: vi.fn(async () => ({ document_id: "doc-1", page_index: 0, extractor_version: "test", assets: [] })),
	};
});

vi.mock("pg", () => {
	class MockPool {
		async query(sql: string, params?: any[]) {
			const m = getMocks();
			if (!m.pgQueries) m.pgQueries = [];
			m.pgQueries.push({ sql: String(sql), params });

			const q = String(sql);
			// meta_status column exists
			if (q.includes("information_schema.columns") && q.includes("column_name = 'meta_status'")) {
				return { rows: [{ ok: 1 }] };
			}

			// Guard readiness checks (documents WHERE id = ANY($1))
			if (q.includes("FROM documents WHERE id = ANY")) {
				const ids = ((params as any)?.[0] ?? []) as string[];
				const callCount = (m.docsAnyCallCount = (m.docsAnyCallCount ?? 0) + 1);
				// First pass: meta_status not succeeded => blocked.
				// Second pass: meta_status succeeded => ready.
				const metaStatus = callCount >= 2 ? "succeeded" : "processing";
				return {
					rows: ids.map((id) => ({
						id,
						deal_id: "deal-1",
						title: "Doc",
						type: "application/pdf",
						status: "ready_for_analysis",
						meta_status: metaStatus,
						page_count: 5,
						extraction_metadata: { doc_kind: "pdf", status: metaStatus },
						deleted_at: null,
					}))
				};
			}

			// tables present
			if (q.toLowerCase().includes("select to_regclass") || q.toLowerCase().includes("from information_schema.tables")) {
				return { rows: [{ ok: 1 }] };
			}

			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

let didImportWorker = false;

describe("extract_visuals ingest_not_complete wait", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(getMocks() as any).docsAnyCallCount = 0;
		// NOTE: worker clamps poll interval to >=250ms.
		process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "2000";
		process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = "250";
		process.env.EXTRACT_VISUALS_ALLOW_RENDERED_PAGES_FALLBACK = "0";
	});

	it("waits for ingest readiness instead of failing immediately", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (url: any, init?: any) => {
			const u = String(url ?? "");
			const method = String(init?.method ?? "GET").toUpperCase();
			if (u.endsWith("/health")) {
				return new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (u.endsWith("/openapi.json")) {
				return new Response(
					JSON.stringify({ paths: { "/extract-visuals": { post: {} } } }),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			}
			// Image URI probe uses GET+Range, not HEAD. Return 206 for range requests.
			if (method === "GET" && String((init as any)?.headers?.Range ?? "").startsWith("bytes=")) {
				return new Response("", { status: 206, headers: { "content-type": "image/png" } });
			}
			return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
		}) as any;

		vi.useFakeTimers();
		if (!didImportWorker) {
			// Load index.ts AFTER mocks so it registers the processor.
			await import("../index");
			didImportWorker = true;
		}
		try {
			expect(extractVisualsProcessor).toBeTruthy();

			const job = {
				id: `job-${Math.random().toString(16).slice(2)}`,
				name: "extract_visuals",
				data: { deal_id: "deal-1", document_ids: ["doc-1"] },
				updateProgress: vi.fn(async () => undefined),
				queueName: "extract_visuals",
			};

			const promise = (extractVisualsProcessor as any)(job);
			// Allow the wait loop to advance.
			await vi.advanceTimersByTimeAsync(300);
			await expect(promise).resolves.toEqual(expect.objectContaining({ ok: true }));

			const updateJobProgress = getMocks().updateJobProgress as any;
			const statuses = (updateJobProgress.mock.calls ?? [])
				.map((c: any[]) => c?.[1]?.status)
				.filter((v: any) => typeof v === "string");
			expect(statuses).not.toContain("failed");
			// Should have emitted at least one blocked-stage progress update.
			const stages = (updateJobProgress.mock.calls ?? [])
				.map((c: any[]) => c?.[1]?.stage)
				.filter((v: any) => typeof v === "string");
			expect(stages).toContain("blocked");
		} finally {
			vi.useRealTimers();
			globalThis.fetch = originalFetch as any;
		}
	});
});
