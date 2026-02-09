import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.ENABLE_VISUAL_EXTRACTION = "1";

let deepScanVisualsProcessor: ((job: any) => Promise<any>) | null = null;

const originalFetch: any = (globalThis as any).fetch;

const getMocks = () => {
	const g: any = globalThis as any;
	if (!g.__deep_scan_visuals_rerun_test_mocks) g.__deep_scan_visuals_rerun_test_mocks = {};
	return g.__deep_scan_visuals_rerun_test_mocks as Record<string, any>;
};

vi.mock("../lib/queue", () => {
	return {
		connection: { set: vi.fn(async () => "OK") },
		createWorker: (name: string, processor: any) => {
			if (name === "deep_scan_visuals") deepScanVisualsProcessor = processor;
			return {};
		},
		getQueue: (_name: string) => ({ add: vi.fn(async () => undefined) }),
		getBullmqRuntimeInfo: () => ({ version: "test", resolved: "mock" }),
		logWorkerQueueConfig: vi.fn(),
	};
});

vi.mock("../lib/job-progress", () => ({
	updateJobProgress: vi.fn(async () => undefined),
}));

vi.mock("../lib/visual-extraction", async (importOriginal) => {
	const actual: any = await importOriginal();

	const resolvePageImageUris = vi.fn(async (_pool: any, _docId: string) => ["https://example.com/page_0.png"]);
	const callVisionWorkerWithRetries = vi.fn(async () => {
		return {
			response: {
				document_id: "doc-1",
				page_index: 0,
				extractor_version: "vision_v1_force_vu",
				assets: [
					{
						asset_type: "image_text",
						bbox: { x: 0, y: 0, w: 1, h: 1 },
						confidence: 0.5,
						quality_flags: {},
						image_uri: null,
						image_hash: null,
						extraction: {
							ocr_text: "x",
							ocr_blocks: [],
							structured_json: {},
							units: null,
							labels: {},
							model_version: null,
							confidence: 0.5,
						},
					},
				],
			},
			attempts: [],
		};
	});

	const persistVisionResponse = vi.fn(async (_pool: any, res: any) => {
		const m = getMocks();
		const key = `${String(res?.document_id ?? "")}::${String(res?.page_index ?? "")}::${String(res?.extractor_version ?? "")}`;
		(m.existingPages as Set<string>).add(key);
		return { persisted: 1, withImageUri: 1 };
	});

	getMocks().resolvePageImageUris = resolvePageImageUris;
	getMocks().callVisionWorkerWithRetries = callVisionWorkerWithRetries;
	getMocks().persistVisionResponse = persistVisionResponse;

	return {
		...actual,
		getVisionExtractorConfig: () => ({
			enabled: true,
			visionWorkerUrl: "http://vision",
			extractorVersion: "vision_v1",
			timeoutMs: 1000,
			maxPages: 10,
		}),
		hasTable: vi.fn(async () => true),
		resolvePageImageUris,
		persistVisionResponse,
		persistSyntheticVisualAssets: vi.fn(async () => 0),
		backfillVisualAssetImageUris: vi.fn(async () => ({ updated: 0 })),
		backfillVisualAssetPageImageUris: vi.fn(async () => ({ updated: 0 })),
		callVisionWorkerWithRetries,
	};
});

vi.mock("pg", () => {
	class MockPool {
		async query(sql: string, params?: any[]) {
			const m = getMocks();
			if (!m.pgQueries) m.pgQueries = [];
			m.pgQueries.push({ sql: String(sql), params });

			const q = String(sql);

			if (q.includes("information_schema.columns") && q.includes("column_name = 'meta_status'")) {
				return { rows: [{ ok: 1 }] };
			}

			// computeAndPersistVisionRoutingV1 query
			if (q.includes("length(coalesce(full_text,''))") && q.includes("FROM documents WHERE id = $1")) {
				return {
					rows: [
						{
							extraction_metadata: { doc_kind: "pdf", needsOcr: true, pageOcr: { attempted: true } },
							type: "application/pdf",
							full_text_len: 0,
						},
					],
				};
			}

			// deep_scan_visuals per-doc metadata load
			if (q.includes("SELECT deal_id, extraction_metadata") && q.includes("FROM documents WHERE id = $1")) {
				return {
					rows: [
						{
							deal_id: "deal-1",
							extraction_metadata: { doc_kind: "pdf" },
						},
					],
				};
			}

			// Strict rerun preflight: visual_assets exists
			if (q.includes("FROM visual_assets") && q.includes("va.document_id") && q.includes("va.page_index") && q.includes("va.extractor_version") && q.includes("LIMIT 1")) {
				const docId = String((params as any)?.[0] ?? "");
				const pageIndex = String((params as any)?.[1] ?? "");
				const extractorVersion = String((params as any)?.[2] ?? "");
				const key = `${docId}::${pageIndex}::${extractorVersion}`;
				return { rows: (m.existingPages as Set<string>).has(key) ? [{ ok: 1 }] : [] };
			}

			// pageHasVisionUnderstanding query: default to no
			if (q.includes("FROM visual_assets") && q.includes("JOIN visual_extractions") && q.includes("vision_understanding_v1")) {
				return { rows: [] };
			}

			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

function makeJob(data: any) {
	return {
		id: "job-deep-scan-rerun",
		name: "deep_scan_visuals",
		data,
	} as any;
}

describe("deep_scan_visuals rerun skip existing", () => {
	beforeAll(async () => {
		getMocks().existingPages = new Set<string>();
		await import("../index");
		expect(deepScanVisualsProcessor).toBeTypeOf("function");
	});

	beforeEach(() => {
		getMocks().existingPages = new Set<string>();
		getMocks().callVisionWorkerWithRetries?.mockClear?.();
		getMocks().persistVisionResponse?.mockClear?.();

		(globalThis as any).fetch = vi.fn(async (url: any, init?: any) => {
			const u = String(url ?? "");
			const method = String(init?.method ?? "GET").toUpperCase();

			if (u.endsWith("/health")) {
				return new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}

			if (u.endsWith("/openapi.json")) {
				return new Response(JSON.stringify({ paths: { "/extract-visuals": { post: {} } } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}

			if ((method === "HEAD" || method === "GET") && u.startsWith("https://example.com/page_")) {
				return new Response("", { status: 200, headers: { "content-type": "image/png" } });
			}

			return new Response("", { status: 200 });
		});
	});

	afterAll(() => {
		(globalThis as any).fetch = originalFetch;
	});

	it("does not call vision worker on rerun when page already exists", async () => {
		await deepScanVisualsProcessor!(
			makeJob({
				deal_id: "deal-1",
				document_ids: ["doc-1"],
				page_start: 0,
				page_end: 1,
			})
		);
		expect(getMocks().callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
		expect(getMocks().persistVisionResponse).toHaveBeenCalledTimes(1);

		await deepScanVisualsProcessor!(
			makeJob({
				deal_id: "deal-1",
				document_ids: ["doc-1"],
				page_start: 0,
				page_end: 1,
			})
		);

		// Second run should be skipped by the strict preflight guard.
		expect(getMocks().callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
	});
});
