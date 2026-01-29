import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.ENABLE_VISUAL_EXTRACTION = "1";

let extractVisualsProcessor: ((job: any) => Promise<any>) | null = null;
let deepScanVisualsProcessor: ((job: any) => Promise<any>) | null = null;
let callVisionWorkerWithRetriesSpy: ((...args: any[]) => Promise<any>) | null = null;

const mockedDocState: {
	deal_id: string;
	type: string;
	extraction_metadata: any;
	full_text_len: number;
} = {
	deal_id: "deal-from-doc",
	type: "application/pdf",
	// Default: make PDF eligible for last-resort vision fallback.
	extraction_metadata: { doc_kind: "pdf", needsOcr: true, pageOcr: { attempted: true } },
	full_text_len: 0,
};

const originalFetch: any = (globalThis as any).fetch;

// Capture the processor that index.ts registers.
vi.mock("../lib/queue", () => {
	return {
		connection: {
			set: vi.fn(async () => "OK"),
		},
		createWorker: (name: string, processor: any) => {
			if (name === "extract_visuals") extractVisualsProcessor = processor;
			if (name === "deep_scan_visuals") deepScanVisualsProcessor = processor;
			return {};
		},
		getQueue: (_name: string) => ({ add: vi.fn(async () => undefined) }),
		logWorkerQueueConfig: vi.fn(),
	};
});

vi.mock("../lib/job-progress", () => ({
	updateJobProgress: vi.fn(async () => undefined),
}));

// Keep the real vision retry logic so VISION_REQUEST_START is emitted,
// but stub persistence helpers to keep the test hermetic.
vi.mock("../lib/visual-extraction", async (importOriginal) => {
	const actual: any = await importOriginal();
	callVisionWorkerWithRetriesSpy = vi.fn(async (...args: any[]) => actual.callVisionWorkerWithRetries(...args));
	return {
		...actual,
		callVisionWorkerWithRetries: callVisionWorkerWithRetriesSpy,
		getVisionExtractorConfig: () => ({
			enabled: true,
			visionWorkerUrl: "http://vision",
			extractorVersion: "test",
			timeoutMs: 1000,
			maxPages: 10,
		}),
		hasTable: vi.fn(async () => true),
		resolvePageImageUris: vi.fn(async () => ["https://example.com/page_0.png"]),
		persistVisionResponse: vi.fn(async () => ({ persisted: 0, withImageUri: 0 })),
		persistSyntheticVisualAssets: vi.fn(async () => 0),
		backfillVisualAssetImageUris: vi.fn(async () => ({ updated: 0 })),
		backfillVisualAssetPageImageUris: vi.fn(async () => ({ updated: 0 })),
	};
});

// Mock DB access via pg Pool used by apps/worker/src/lib/db.ts.
vi.mock("pg", () => {
	class MockPool {
		async query(sql: string, params?: any[]) {
			const q = String(sql);
			// deep_scan_visuals per-doc metadata load
			if (q.includes("SELECT deal_id, extraction_metadata") && q.includes("FROM documents WHERE id = $1")) {
				return {
					rows: [
						{
							deal_id: mockedDocState.deal_id,
							extraction_metadata: mockedDocState.extraction_metadata,
						},
					],
				};
			}
			// computeAndPersistVisionRoutingV1 query
			if (q.includes("length(coalesce(full_text,''))") && q.includes("FROM documents WHERE id = $1")) {
				return {
					rows: [
						{
							extraction_metadata: mockedDocState.extraction_metadata,
							type: mockedDocState.type,
							full_text_len: mockedDocState.full_text_len,
						},
					],
				};
			}
			// Guard precheck: documents WHERE id = ANY($1)
			if (q.includes("FROM documents WHERE id = ANY")) {
				const ids = ((params as any)?.[0] ?? []) as string[];
				return {
					rows: ids.map((id) => ({
						id,
						deal_id: mockedDocState.deal_id,
						title: "Doc",
						type: mockedDocState.type,
						status: "ready_for_analysis",
						meta_status: "succeeded",
						page_count: 1,
						extraction_metadata: mockedDocState.extraction_metadata,
						deleted_at: null,
					})),
				};
			}
			// Per-doc metadata load
			if (q.includes("SELECT deal_id, type, title, extraction_metadata") && q.includes("FROM documents WHERE id = $1")) {
				return {
					rows: [
						{
							deal_id: mockedDocState.deal_id,
							type: mockedDocState.type,
							title: "Doc",
							extraction_metadata: mockedDocState.extraction_metadata,
							structured_data: {},
							full_content: {},
							page_count: 1,
						},
					],
				};
			}
			// Various other queries: keep them no-op.
			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

function makeJob(data: any) {
	return { id: "job-vision-deal-id", name: "extract_visuals", data } as any;
}

function makeDeepScanJob(data: any) {
	return { id: "job-deep-scan", name: "deep_scan_visuals", data } as any;
}

describe("extract_visuals vision logs include deal_id", () => {
	beforeAll(async () => {
		await import("../index");
		expect(extractVisualsProcessor).toBeTypeOf("function");
			expect(deepScanVisualsProcessor).toBeTypeOf("function");
		expect(callVisionWorkerWithRetriesSpy).toBeTypeOf("function");
	});

	beforeEach(() => {
		(callVisionWorkerWithRetriesSpy as any)?.mockClear?.();
		// Deterministic network for: verifyVisionServiceForJob + extract-visuals + image HEAD.
		(globalThis as any).fetch = vi.fn(async (url: any, init?: any) => {
			const u = String(url ?? "");
			const method = String(init?.method ?? "GET").toUpperCase();
			if (u.endsWith("/health")) {
				return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
			}
			if (u.endsWith("/openapi.json")) {
				return new Response(JSON.stringify({ paths: { "/extract-visuals": { post: {} } } }), { status: 200, headers: { "content-type": "application/json" } });
			}
			if ((method === "HEAD" || method === "GET") && u.startsWith("https://example.com/page_")) {
				return new Response("", { status: 200, headers: { "content-type": "image/png" } });
			}
			if (u.endsWith("/extract-visuals")) {
				return new Response(
					JSON.stringify({
						document_id: "doc-1",
						page_index: 0,
						extractor_version: "test",
						assets: [
							{
								asset_type: "image_text",
								bbox: { x: 0, y: 0, w: 1, h: 1 },
								confidence: 0.5,
								image_uri: null,
								image_hash: null,
								extraction: { ocr_text: "x", ocr_blocks: [], structured_json: {}, units: null, labels: {}, model_version: null, confidence: 0.5 },
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			}
			return new Response("", { status: 200 });
		});
	});

	afterAll(() => {
		(globalThis as any).fetch = originalFetch;
	});

	it("VISION_REQUEST_START.deal_id is non-null when job payload lacks deal_id but docMeta has it", async () => {
		mockedDocState.type = "application/pdf";
		mockedDocState.extraction_metadata = { doc_kind: "pdf", needsOcr: true, pageOcr: { attempted: true } };
		mockedDocState.full_text_len = 0;

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);

		// Chunk-style job: omit deal_id; DB docMeta provides it.
		await extractVisualsProcessor!(
			makeJob({
				document_id: "doc-1",
				page_start: 0,
				page_end: 1,
			})
		);

		const events = logSpy.mock.calls
			.map((c) => c[0])
			.filter((v) => typeof v === "string" && v.trim().startsWith("{"))
			.map((s) => {
				try {
					return JSON.parse(String(s));
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		const starts = events.filter((e: any) => e.event === "VISION_REQUEST_START");
		const dones = events.filter((e: any) => e.event === "VISION_REQUEST_DONE");
		expect(starts.length).toBeGreaterThan(0);
		expect(dones.length).toBeGreaterThan(0);

		const assertNonNull = (obj: any, key: string) => {
			expect(obj).toHaveProperty(key);
			expect(obj[key]).not.toBeNull();
			expect(obj[key]).not.toBeUndefined();
		};

		for (const e of [starts[0], dones[0]]) {
			assertNonNull(e, "deal_id");
			assertNonNull(e, "job_id");
			assertNonNull(e, "document_id");
			assertNonNull(e, "page_index");
			assertNonNull(e, "doc_kind");
			assertNonNull(e, "page_range");
			assertNonNull(e, "chunk");
			expect(e.page_range).toMatchObject({ start: 0, end: 1 });
			expect(e.chunk).toMatchObject({ page_start: 0, page_end: 1 });
		}

		expect(starts[0].deal_id).toBe("deal-from-doc");
		expect(starts[0].job_id).toBe("job-vision-deal-id");
		expect(starts[0].document_id).toBe("doc-1");
		expect(starts[0].page_index).toBe(0);
		expect(starts[0].doc_kind).toBe("pdf");
		expect(callVisionWorkerWithRetriesSpy).toBeTruthy();
		expect((callVisionWorkerWithRetriesSpy as any).mock.calls.length).toBeGreaterThan(0);

		logSpy.mockRestore();
	});

	it("VISION_REQUEST_START/DONE include required logMeta fields for deep_scan_visuals", async () => {
		mockedDocState.type = "application/pdf";
		mockedDocState.extraction_metadata = { doc_kind: "pdf", needsOcr: true, pageOcr: { attempted: true } };
		mockedDocState.full_text_len = 0;

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);

		await deepScanVisualsProcessor!(
			makeDeepScanJob({
				deal_id: "deal-from-job",
				document_ids: ["doc-1"],
				page_start: 0,
				page_end: 1,
			})
		);

		const events = logSpy.mock.calls
			.map((c) => c[0])
			.filter((v) => typeof v === "string" && v.trim().startsWith("{"))
			.map((s) => {
				try {
					return JSON.parse(String(s));
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		const starts = events.filter((e: any) => e.event === "VISION_REQUEST_START");
		const dones = events.filter((e: any) => e.event === "VISION_REQUEST_DONE");
		expect(starts.length).toBeGreaterThan(0);
		expect(dones.length).toBeGreaterThan(0);

		const assertNonNull = (obj: any, key: string) => {
			expect(obj).toHaveProperty(key);
			expect(obj[key]).not.toBeNull();
			expect(obj[key]).not.toBeUndefined();
		};

		for (const e of [starts[0], dones[0]]) {
			assertNonNull(e, "deal_id");
			assertNonNull(e, "job_id");
			assertNonNull(e, "document_id");
			assertNonNull(e, "page_index");
			assertNonNull(e, "doc_kind");
			assertNonNull(e, "page_range");
			assertNonNull(e, "chunk");
			expect(e.page_range).toMatchObject({ start: 0, end: 1 });
			expect(e.chunk).toMatchObject({ page_start: 0, page_end: 1 });
		}

		expect(starts[0].job_id).toBe("job-deep-scan");
		expect(starts[0].document_id).toBe("doc-1");
		expect(starts[0].page_index).toBe(0);
		expect(starts[0].doc_kind).toBe("pdf");

		logSpy.mockRestore();
	});

	it("policy blocks vision calls for editable PDFs", async () => {
		// Editable PDF case: needsOcr=false => never call vision.
		mockedDocState.type = "application/pdf";
		mockedDocState.extraction_metadata = { doc_kind: "pdf", needsOcr: false, pageOcr: { attempted: false } };
		mockedDocState.full_text_len = 5000;

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);

		await extractVisualsProcessor!(
			makeJob({
				document_id: "doc-1",
				page_start: 0,
				page_end: 1,
			})
		);

		expect((callVisionWorkerWithRetriesSpy as any).mock.calls.length).toBe(0);

		logSpy.mockRestore();
	});
});
