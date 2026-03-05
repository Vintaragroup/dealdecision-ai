import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../lib/ocr/safe-tesseract", () => {
	return {
		safeTesseractRecognizeBuffer: vi.fn(async () => ({
			text: "Revenue Growth\n$1.2M ARR\nQ/Q +25%",
			confidence: 92,
		})),
	};
});

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
	emitJobProgress: vi.fn(async () => undefined),
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
	const persistVisionResponse = vi.fn(async (...args: any[]) => {
		if (getMocks().useRealPersistVisionResponse) {
			return actual.persistVisionResponse(...args);
		}
		return { persisted: 1, withImageUri: 1 };
	});
	getMocks().persistVisionResponse = persistVisionResponse;
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
		persistVisionResponse,
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
			if (!m.visualAssets) m.visualAssets = new Set<string>();
			if (!m.visualExtractions) m.visualExtractions = [];

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
			// computeAndPersistVisionRoutingV1 query (must run before the generic documents LIMIT 1 handler)
			if (q.includes("length(coalesce(full_text,''))") && q.includes("FROM documents") && q.includes("WHERE id = $1")) {
				const fullTextOverride = typeof m.docFullTextOverride === "string" ? m.docFullTextOverride : "";
				const absentReasonOverride =
					m.docFullTextAbsentReasonOverride === null
						? null
						: (typeof m.docFullTextAbsentReasonOverride === "string" ? m.docFullTextAbsentReasonOverride : "no_text_extracted");
				const needsOcr = absentReasonOverride != null || fullTextOverride.trim().length === 0;
				return {
					rows: [
						{
							extraction_metadata: {
								doc_kind: "pdf",
								pdf_text_probe: { needsOcr },
								pageOcr: { attempted: true },
							},
							type: "application/pdf",
							full_content: null,
							page_count: 32,
							full_text_len: fullTextOverride.length,
						},
					],
				};
			}
			// documents WHERE id = $1 LIMIT 1
			if (q.includes("FROM documents WHERE id = $1") && q.includes("LIMIT 1")) {
				const fullTextOverride = typeof m.docFullTextOverride === "string" ? m.docFullTextOverride : "";
				const absentReasonOverride =
					m.docFullTextAbsentReasonOverride === null
						? null
						: (typeof m.docFullTextAbsentReasonOverride === "string" ? m.docFullTextAbsentReasonOverride : "no_text_extracted");
				const needsOcr = absentReasonOverride != null || fullTextOverride.trim().length === 0;
				return {
					rows: [
						{
							deal_id: "deal-1",
							type: "application/pdf",
							title: "Doc",
							status: "ready_for_analysis",
							meta_status: "succeeded",
							extraction_metadata: {
								doc_kind: "pdf",
								pdf_text_probe: { needsOcr },
								pageOcr: { attempted: true },
							},
							structured_data: {},
							full_content: {},
							full_text: fullTextOverride,
							full_text_absent_reason: absentReasonOverride,
							page_count: 32,
						},
					],
				};
			}
						// extract_visuals skip-existing precheck
						if (q.includes("FROM visual_assets") && q.includes("WHERE va.document_id") && q.includes("va.page_index") && q.includes("va.extractor_version")) {
							const docId = String((params as any[])?.[0] ?? "");
							const pageIndex = Number((params as any[])?.[1] ?? -1);
							const extractorVersion = String((params as any[])?.[2] ?? "");
							const key = `${docId}::${pageIndex}::${extractorVersion}`;
							return { rows: m.visualAssets.has(key) ? [{ ok: 1 }] : [] };
						}
						// visual_assets upsert
						if (q.includes("INSERT INTO visual_assets") && q.includes("RETURNING id")) {
							const docId = String((params as any[])?.[0] ?? "");
							const pageIndex = Number((params as any[])?.[1] ?? -1);
							const extractorVersion = String((params as any[])?.[6] ?? "");
							const id = `va-${docId}-${pageIndex}-${extractorVersion}`;
							m.visualAssets.add(`${docId}::${pageIndex}::${extractorVersion}`);
							return { rows: [{ id }] };
						}
						// visual_extractions upsert
						if (q.includes("INSERT INTO visual_extractions") && q.includes("ON CONFLICT")) {
							m.visualExtractions.push({ sql: q, params });
							return { rows: [], rowCount: 1 } as any;
						}
						// evidence_links upsert/update
						if (q.includes("UPDATE evidence_links") || q.includes("INSERT INTO evidence_links")) {
							return { rows: [], rowCount: 0 } as any;
						}
			// (vision routing query handled above)
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
		const here = path.dirname(fileURLToPath(import.meta.url));
		const fixturePath = path.join(here, "fixtures", "rendered-slide-sample.png");
		const fixtureBytes = fs.readFileSync(fixturePath);

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

			// Page image probe uses GET+Range (presigned URLs return 403 for HEAD).
			// Respond with 206 for range requests; full body for any other GET.
			if (u.startsWith("https://example.com/page_")) {
				if (method === "GET" && String((init as any)?.headers?.Range ?? "").startsWith("bytes=")) {
					return new Response("", { status: 206, headers: { "content-type": "image/png" } });
				}
				return new Response(fixtureBytes, { status: 200, headers: { "content-type": "image/png" } });
			}

			// Default: OK empty
			return new Response("", { status: 200 });
		});

		process.env.ENABLE_VISUAL_EXTRACTION = "1";
		process.env.ENABLE_PY_EXCEL_EXTRACTION = "0";
		getMocks().updateJobProgress?.mockClear?.();
		getMocks().resolvePageImageUris?.mockClear?.();
		getMocks().callVisionWorkerWithRetries?.mockClear?.();
		getMocks().persistVisionResponse?.mockClear?.();
		getMocks().pgQueries = [];
		getMocks().visualAssets = new Set<string>();
		getMocks().visualExtractions = [];
		getMocks().useRealPersistVisionResponse = false;
		getMocks().docFullTextOverride = "";
		getMocks().docFullTextAbsentReasonOverride = "no_text_extracted";
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

		expect(
			events.some(
				(e: any) => e.event === "EXTRACT_VISUALS_ENQUEUE" || e.event === "EXTRACT_VISUALS_CHUNK_ENQUEUED"
			)
		).toBe(true);

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

		// New OCR promotion should trigger a follow-up DPU rebuild job.
		const queues = (m.queues ?? {}) as Record<string, any>;
		expect(typeof queues.populate_document_page_understanding?.add).toBe("function");
		expect(queues.populate_document_page_understanding.add).toHaveBeenCalled();

		logSpy.mockRestore();
	});

	it("requests OCR mode for PDF when full_text is missing", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 30, page_end: 32 }));

		expect(m.callVisionWorkerWithRetries).toHaveBeenCalled();
		const firstCall = (m.callVisionWorkerWithRetries as any).mock.calls?.[0] ?? [];
		const req = firstCall?.[1] ?? null;
		expect(req?.extractor_version).toBe("test");
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

	it("persists OCR text and increments pages_with_ocr when needsOcr=true", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();
		m.useRealPersistVisionResponse = true;

		await extractVisualsProcessor!(
			makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 1, skip_existing: false })
		);

		// Ensure OCR was requested
		const firstCall = (m.callVisionWorkerWithRetries as any).mock.calls?.[0] ?? [];
		const req = firstCall?.[1] ?? null;
		expect(req?.include_ocr).toBe(true);

		// Ensure OCR was persisted (upsertVisualExtraction parameter $2 is ocr_text)
		const inserts = Array.isArray(m.visualExtractions) ? m.visualExtractions : [];
		expect(inserts.length).toBeGreaterThan(0);
		const firstInsertParams = (inserts[0] as any)?.params ?? [];
		const persistedOcrText = firstInsertParams?.[1];
		expect(typeof persistedOcrText).toBe("string");
		expect(String(persistedOcrText)).toContain("Hello from OCR");

		// Ensure job counters incremented
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
		const jobSummary = events.find((e: any) => e.event === "EXTRACT_VISUALS_JOB_SUMMARY");
		expect(jobSummary?.counters?.pages_vision_attempted).toBeGreaterThan(0);
		expect(jobSummary?.counters?.pages_with_ocr).toBeGreaterThan(0);

		logSpy.mockRestore();
	});

	it("needsOcr=false does not require OCR fields", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();
		m.useRealPersistVisionResponse = true;
		m.docFullTextOverride = "This PDF has native text.";
		m.docFullTextAbsentReasonOverride = null;

		await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 1 }));

		const firstCall = (m.callVisionWorkerWithRetries as any).mock.calls?.[0] ?? [];
		const req = firstCall?.[1] ?? null;
		expect(req?.include_ocr ?? false).toBe(false);

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
		const jobSummary = events.find((e: any) => e.event === "EXTRACT_VISUALS_JOB_SUMMARY");
		// With local OCR fallback enabled, we may still attach OCR text even when needsOcr=false.
		expect(jobSummary?.counters?.pages_with_ocr ?? 0).toBe(1);

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

	it("emits DOC_PLAN and starts vision (or logs skip reasons) when URIs exist and skip_existing=false", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();

		await extractVisualsProcessor!(
			makeJob({
				deal_id: "deal-1",
				document_id: "doc-1",
				page_start: 0,
				page_end: 1,
				skip_existing: false,
				force_reextract: true,
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

		const plan = events.find((e: any) => e.event === "EXTRACT_VISUALS_DOC_PLAN");
		expect(plan).toBeTruthy();
		expect(plan.document_id).toBe("doc-1");
		expect(plan.total_pages).toBeGreaterThan(0);
		expect(plan.skip_existing).toBe(false);
		expect(plan.page_range_start).toBe(0);
		expect(plan.page_range_end).toBe(1);

		const urisResolved = events.find((e: any) => e.event === "EXTRACT_VISUALS_URIS_RESOLVED");
		expect(urisResolved).toBeTruthy();
		expect(urisResolved.document_id).toBe("doc-1");
		expect(urisResolved.uris_count).toBeGreaterThan(0);

		const summary = events.find((e: any) => e.event === "EXTRACT_VISUALS_DOC_SUMMARY");
		expect(summary).toBeTruthy();
		const skipped = events.filter((e: any) => e.event === "EXTRACT_VISUALS_PAGE_SKIPPED");
		expect((summary?.vision_calls_started ?? 0) > 0 || skipped.length > 0).toBe(true);

		// If not skipped, we should have started at least one vision call.
		if (skipped.length === 0) {
			expect(m.callVisionWorkerWithRetries).toHaveBeenCalled();
			expect(summary?.vision_calls_started ?? 0).toBeGreaterThan(0);

			const prep = events.find((e: any) => e.event === "VISION_REQUEST_PREP");
			expect(prep).toBeTruthy();
			expect(prep.document_id).toBe("doc-1");

			const persisted = events.find((e: any) => e.event === "VISION_PERSIST_RESULT");
			expect(persisted).toBeTruthy();
			expect(persisted.document_id).toBe("doc-1");
		}

		logSpy.mockRestore();
	});

	it("adds local OCR fallback when structured text is too short", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
		const m = getMocks();
		m.useRealPersistVisionResponse = true;

		// Force needsOcr=false so the vision request doesn't include OCR; local fallback should run.
		m.docFullTextOverride = "some extracted PDF text";
		m.docFullTextAbsentReasonOverride = null;

		await extractVisualsProcessor!(
			makeJob({
				deal_id: "deal-1",
				document_id: "doc-1",
				page_start: 0,
				page_end: 1,
				skip_existing: false,
				force_reextract: true,
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

		const plan = events.find((e: any) => e?.event === "EXTRACT_VISUALS_DOC_PLAN");
		expect(plan).toBeTruthy();
		expect(plan?.is_chunk_job).toBe(true);
		expect(plan?.skip_existing).toBe(false);

		const skipped = events.find((e: any) => e?.event === "EXTRACT_VISUALS_PAGE_SKIPPED");
		if (skipped) {
			expect(skipped?.reason_code).toBe("__expected_not_skipped__");
		}

		expect(m.callVisionWorkerWithRetries).toHaveBeenCalled();
		// Ensure OCR text was persisted (upsertVisualExtraction parameter $2 is ocr_text)
		const inserts = Array.isArray(m.visualExtractions) ? m.visualExtractions : [];
		expect(inserts.length).toBeGreaterThan(0);
		const firstInsertParams = (inserts[0] as any)?.params ?? [];
		const persistedOcrText = firstInsertParams?.[1];
		expect(typeof persistedOcrText).toBe("string");
		expect(String(persistedOcrText)).toContain("Revenue Growth");

		const lens = events.find((e: any) => e?.event === "VISION_PAGE_TEXT_LENS");
		expect(lens).toBeTruthy();
		expect(lens?.fallback_used).toBe(true);
		expect(typeof lens?.primary_text_len).toBe("number");
		expect(typeof lens?.ocr_text_len).toBe("number");
		expect(typeof lens?.final_page_text_len).toBe("number");

		logSpy.mockRestore();
	});
});
