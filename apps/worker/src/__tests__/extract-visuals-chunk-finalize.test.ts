import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let extractVisualsProcessor: ((job: any) => Promise<any>) | null = null;

const originalFetch: any = (globalThis as any).fetch;

const getMocks = () => {
	const g: any = globalThis as any;
	if (!g.__extract_visuals_test_mocks) g.__extract_visuals_test_mocks = {};
	return g.__extract_visuals_test_mocks as Record<string, any>;
};

// Capture the processor that index.ts registers.
vi.mock("../lib/queue", () => {
	const queues: Record<string, { add: any }> = {};
	getMocks().queues = queues;
	return {
		connection: {
			set: vi.fn(async () => "OK"),
		},
		createWorker: (name: string, processor: any) => {
			if (name === "extract_visuals") extractVisualsProcessor = processor;
			return {};
		},
		getQueue: (name: string) => {
			if (!queues[name]) queues[name] = { add: vi.fn(async () => undefined) };
			return queues[name];
		},
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
	const resolvePageImageUris = vi.fn(async (_pool: any, _docId: string) => {
		return Array.from({ length: 32 }, (_, i) => `https://example.com/page_${i}.png`);
	});
	const callVisionWorkerWithRetries = vi.fn(async (_config: any, request: any) => {
		const ocrText = request?.include_ocr ? `Hello from OCR page ${request?.page_index ?? 0}` : null;
		return {
			response: {
				document_id: request?.document_id ?? "doc-1",
				page_index: request?.page_index ?? 0,
				extractor_version: request?.extractor_version ?? "test",
				assets: [
					{
						asset_type: "image_text",
						bbox: { x: 0, y: 0, w: 1, h: 1 },
						confidence: 0.9,
						quality_flags: {},
						image_uri: null,
						image_hash: null,
						extraction: {
							ocr_text: ocrText,
							ocr_blocks: request?.include_ocr ? [{ text: "Hello" }] : [],
							structured_json: { segment_key: "unit_test" },
							labels: {},
							confidence: 0.9,
						},
					},
				],
			},
			attempts: [],
		};
	});
	getMocks().resolvePageImageUris = resolvePageImageUris;
	getMocks().callVisionWorkerWithRetries = callVisionWorkerWithRetries;
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
		persistVisionResponse: vi.fn(async () => ({ persisted: 1, withImageUri: 1 })),
		backfillVisualAssetImageUris: vi.fn(async () => ({ updated: 0 })),
		callVisionWorkerWithRetries,
	};
});

// Make DB access hermetic by mocking pg Pool used by apps/worker/src/lib/db.ts.
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
			// documents WHERE id = ANY($1)
			if (q.includes("FROM documents WHERE id = ANY")) {
				const ids = ((params as any)?.[0] ?? []) as string[];
				return {
					rows: ids.map((id) => ({
						id,
						deal_id: "deal-1",
						title: "Doc",
						type: "application/pdf",
						// Visual readiness guard requires documents.status === "ready_for_analysis"
						status: "ready_for_analysis",
						meta_status: "succeeded",
						page_count: 32,
						extraction_metadata: { doc_kind: "pdf" },
						deleted_at: null,
					})),
				};
			}
			// documents WHERE id = $1 LIMIT 1
			if (q.includes("FROM documents WHERE id = $1") && q.includes("LIMIT 1")) {
				return {
					rows: [
						{
							deal_id: "deal-1",
							type: "application/pdf",
							title: "Doc",
							status: "ready_for_analysis",
							meta_status: "succeeded",
							extraction_metadata: { doc_kind: "pdf" },
							structured_data: {},
							full_content: {},
							full_text: "",
							full_text_absent_reason: "no_text_extracted",
							page_count: 32,
						},
					],
				};
			}
			// vision routing query
			if (q.includes("length(coalesce(full_text,''))") && q.includes("FROM documents") && q.includes("WHERE id = $1")) {
				return {
					rows: [
						{
							extraction_metadata: { doc_kind: "pdf" },
							type: "application/pdf",
							full_text_len: 0,
						},
					],
				};
			}
			// documents full_text lookup for OCR promotion
			if (q.includes("SELECT full_text") && q.includes("full_text_absent_reason") && q.includes("FROM documents") && q.includes("LIMIT 1")) {
				return {
					rows: [
						{
							full_text: "",
							full_text_absent_reason: "no_text_extracted",
							extraction_metadata: { doc_kind: "pdf" },
						},
					],
				};
			}
			// OCR join query
			if (q.includes("FROM visual_assets") && q.includes("JOIN visual_extractions") && q.includes("WHERE va.document_id = $1")) {
				return {
					rows: [
						{ page_index: 0, ocr_text: "Hello from OCR" },
						{ page_index: 1, ocr_text: "Second page OCR" },
					],
				};
			}
			// documents full_text update
			if (q.includes("UPDATE documents") && q.includes("SET full_text = $2") && q.includes("full_text_absent_reason")) {
				m.updatedFullText = (params as any[])?.[1];
				return { rows: [] };
			}
			// visual_assets count query
			if (q.includes("FROM visual_assets") && q.includes("COUNT")) {
				return { rows: [{ c: 0 }] };
			}
			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

function makeJob(data: any) {
	return {
		id: "job-1",
		name: "extract_visuals",
		data,
	} as any;
}

describe("extract_visuals chunking finalization", () => {
	beforeAll(async () => {
		await import("../index");
		expect(extractVisualsProcessor).toBeTypeOf("function");
	});

	beforeEach(async () => {
		// Keep vision verification deterministic for these unit tests.
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
				return new Response(
					JSON.stringify({ paths: { "/extract-visuals": { post: {} } } }),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			}

			// Page image HEAD checks may occur; return OK.
			if ((method === "HEAD" || method === "GET") && u.startsWith("https://example.com/page_")) {
				return new Response("", { status: 200, headers: { "content-type": "image/png" } });
			}

			// Default: OK empty
			return new Response("", { status: 200 });
		});

		process.env.ENABLE_VISUAL_EXTRACTION = "1";
		process.env.ENABLE_PY_EXCEL_EXTRACTION = "0";
		getMocks().updateJobProgress?.mockClear?.();
		getMocks().resolvePageImageUris?.mockClear?.();
		getMocks().callVisionWorkerWithRetries?.mockClear?.();
		getMocks().pgQueries = [];
		const queues = getMocks().queues ?? {};
		for (const q of Object.values(queues)) {
			(q as any)?.add?.mockClear?.();
		}
	});

	// Restore fetch for any other suites.
	// (Vitest runs all tests in this workspace even when passing a single file.)
	afterAll(() => {
		(globalThis as any).fetch = originalFetch;
	});

	it("coordinator enqueues chunks and exits without finalizing/analyzing", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined as any);
		const m = getMocks();

		expect(extractVisualsProcessor).toBeTypeOf("function");
		const res = await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1" }));
		if (res?.coordinator !== true) {
			console.error("[TEST_DIAG] coordinator result", res);
		}
		expect(Array.isArray(m.pgQueries)).toBe(true);
		expect((m.pgQueries ?? []).length).toBeGreaterThan(0);
		expect(res?.coordinator).toBe(true);

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

		expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_CHUNK_ENQUEUED")).toBe(true);

		// 32 pages at chunkSize=10 => 4 chunks
		const inserts = (m.pgQueries ?? []).filter((q: any) => String(q?.sql ?? "").includes("INSERT INTO jobs"));
		const extractJobInserts = inserts.filter((q: any) => q?.params?.[3] === "extract_visuals");
		expect(extractJobInserts.length).toBe(4);
		expect(events.some((e: any) => e.event === "ANALYZE_DEAL_ENQUEUED")).toBe(false);
		expect(m.callVisionWorkerWithRetries).not.toHaveBeenCalled();
		expect(res?.coordinator).toBe(true);

		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it("final chunk finalizes and enqueues analyze_deal exactly once", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		// last chunk for 32 pages
		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 30, page_end: 32 }));

		const inserts = (m.pgQueries ?? []).filter((q: any) => String(q?.sql ?? "").includes("INSERT INTO jobs"));
		const analyzeJobInserts = inserts.filter((q: any) => q?.params?.[3] === "analyze_deal");
		expect(analyzeJobInserts.length).toBe(1);

		const analyzeLogs = logSpy.mock.calls
			.map((c) => c[0])
			.filter((v) => typeof v === "string" && v.trim().startsWith("{"))
			.map((s) => {
				try {
					return JSON.parse(String(s));
				} catch {
					return null;
				}
			})
			.filter((e: any) => e && e.event === "ANALYZE_DEAL_ENQUEUED");

		expect(analyzeLogs.length).toBe(1);
		logSpy.mockRestore();
	});

	it("final chunk promotes OCR into documents.full_text (search index)", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 30, page_end: 32 }));

		expect(typeof m.updatedFullText).toBe("string");
		expect(String(m.updatedFullText)).toContain("Hello from OCR");
		expect(String(m.updatedFullText)).toContain("Second page OCR");

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

		expect(events.some((e: any) => e.event === "OCR_TEXT_PROMOTED" && e.promoted === true)).toBe(true);
		expect(events.some((e: any) => e.event === "SEARCH_INDEX_UPDATED")).toBe(true);

		logSpy.mockRestore();
	});

	it("requests OCR mode for PDF when full_text is missing", async () => {
		process.env.VISION_OCR_EXTRACTOR_VERSION = "vision_ocr_v1";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 30, page_end: 32 }));

		expect(m.callVisionWorkerWithRetries).toHaveBeenCalled();
		const firstCall = (m.callVisionWorkerWithRetries as any).mock.calls?.[0] ?? [];
		const req = firstCall?.[1] ?? null;
		expect(req?.extractor_version).toBe("vision_ocr_v1");
		expect(req?.include_ocr).toBe(true);
		expect(req?.mode).toBe("ocr");
		expect(req?.return_blocks).toBe(true);

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

		expect(events.some((e: any) => e.event === "OCR_REQUEST_START")).toBe(true);
		expect(events.some((e: any) => e.event === "OCR_REQUEST_DONE" && (e.ocr_chars ?? 0) > 0)).toBe(true);
		expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_SUMMARY" && (e.ocr_pages_with_text ?? 0) > 0)).toBe(true);

		logSpy.mockRestore();
	});

	it("non-final chunk does not enqueue analyze_deal", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 10 }));

		const inserts = (m.pgQueries ?? []).filter((q: any) => String(q?.sql ?? "").includes("INSERT INTO jobs"));
		const analyzeJobInserts = inserts.filter((q: any) => q?.params?.[3] === "analyze_deal");
		expect(analyzeJobInserts.length).toBe(0);

		const analyzeLogs = logSpy.mock.calls
			.map((c) => c[0])
			.filter((v) => typeof v === "string" && v.trim().startsWith("{"))
			.map((s) => {
				try {
					return JSON.parse(String(s));
				} catch {
					return null;
				}
			})
			.filter((e: any) => e && e.event === "ANALYZE_DEAL_ENQUEUED");

		expect(analyzeLogs.length).toBe(0);
		logSpy.mockRestore();
	});
});
