/**
 * PR6: Extract Visuals Finalization Reliability
 *
 * Tests:
 *   1. buildExtractVisualsFinalizedMarker pure-function unit tests
 *   2. extract_visuals worker — FINALIZE_START / FINALIZE_SUCCESS events + finalized marker writes
 *   3. extract_visuals worker — lock-skip path enqueues finalize_extract_visuals recovery job
 *   4. extract_visuals worker — XLSX (no pages) path writes finalized marker
 *   5. finalize_extract_visuals recovery processor — correct behavior (lock, markers, analyze_deal)
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { buildExtractVisualsFinalizedMarker } from "../lib/visual-extraction";

// ─── Shared worker capture ────────────────────────────────────────────────────

let extractVisualsProcessor: ((job: any) => Promise<any>) | null = null;
let finalizeExtractVisualsProcessor: ((job: any) => Promise<any>) | null = null;

const getMocks = () => {
	const g: any = globalThis as any;
	if (!g.__ev_finalize_test_mocks) g.__ev_finalize_test_mocks = {};
	return g.__ev_finalize_test_mocks as Record<string, any>;
};

vi.mock("../lib/queue", () => {
	const queues: Record<string, { add: any }> = {};
	const mocks = getMocks();
	mocks.queues = queues;

	// Default: SET NX succeeds (lock acquired). Tests can override via mocks.connectionSetImpl.
	const connectionSet = vi.fn(async (...args: any[]) => {
		const m = getMocks();
		if (typeof m.connectionSetImpl === "function") return m.connectionSetImpl(...args);
		return "OK";
	});
	const connectionGet = vi.fn(async (...args: any[]) => {
		const m = getMocks();
		if (typeof m.connectionGetImpl === "function") return m.connectionGetImpl(...args);
		return null;
	});
	const connectionDel = vi.fn(async () => 1);

	mocks.connectionSet = connectionSet;
	mocks.connectionGet = connectionGet;
	mocks.connectionDel = connectionDel;

	return {
		connection: { set: connectionSet, get: connectionGet, del: connectionDel },
		createWorker: (name: string, processor: any) => {
			if (name === "extract_visuals") extractVisualsProcessor = processor;
			if (name === "finalize_extract_visuals") finalizeExtractVisualsProcessor = processor;
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
	updateJobProgress: vi.fn(async () => undefined),
        emitJobProgress: vi.fn(async () => undefined),
}));

vi.mock("../lib/visual-extraction", async (importOriginal) => {
	const actual: any = await importOriginal();
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
		resolvePageImageUris: vi.fn(async (_pool: any, _docId: string) =>
			Array.from({ length: 4 }, (_, i) => `https://example.com/page_${i}.png`)
		),
		persistSyntheticVisualAssets: vi.fn(async () => 0),
		persistVisionResponse: vi.fn(async () => ({ persisted: 1, withImageUri: 1 })),
		backfillVisualAssetImageUris: vi.fn(async () => ({ updated: 0 })),
		callVisionWorkerWithRetries: vi.fn(async (_config: any, request: any) => ({
			response: {
				document_id: request?.document_id ?? "doc-1",
				page_index: request?.page_index ?? 0,
				extractor_version: "test",
				assets: [],
			},
			attempts: [],
		})),
	};
});

// ─── DB mock ──────────────────────────────────────────────────────────────────

vi.mock("pg", () => {
	class MockPool {
		async query(sql: string, params?: any[]) {
			const m = getMocks();
			if (!m.pgQueries) m.pgQueries = [];
			m.pgQueries.push({ sql: String(sql), params });
			const q = String(sql);

			// meta_status column check
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
						status: "ready_for_analysis",
						meta_status: "succeeded",
						page_count: 4,
						extraction_metadata: { doc_kind: "pdf" },
						deleted_at: null,
					})),
				};
			}
			// Routing probe query
			if (q.includes("length(coalesce(full_text,''))") && q.includes("FROM documents") && q.includes("WHERE id = $1")) {
				return {
					rows: [
						{
							extraction_metadata: { doc_kind: "pdf" },
							type: "application/pdf",
							full_content: null,
							page_count: 4,
							full_text_len: 0,
						},
					],
				};
			}
			// FINALIZE: documents WHERE id = $1 LIMIT 1 (includes extraction_metadata + full_content)
			if (q.includes("FROM documents WHERE id = $1") && q.includes("LIMIT 1") && q.includes("full_content")) {
				const m2 = getMocks();
				const docType =
					typeof m2.finalizeDocType === "string" ? m2.finalizeDocType : "application/pdf";
				const pages =
					Array.isArray(m2.finalizeDocPages) ? m2.finalizeDocPages : [
						{
							page_index: 0,
							understanding_v1: { slide_type: "overview", slide_type_confidence: 0.9, title: "Overview" },
						},
						{
							page_index: 1,
							understanding_v1: { slide_type: "team", slide_type_confidence: 0.85, title: "Team" },
						},
					];
				const existingExtractionMetadata =
					m2.finalizeExistingExtractionMetadata !== undefined
						? m2.finalizeExistingExtractionMetadata
						: { doc_kind: "pdf" };
				return {
					rows: [
						{
							deal_id: "deal-1",
							type: docType,
							extraction_metadata: existingExtractionMetadata,
							full_content: pages.length > 0 ? { pdf_v2: { pages } } : {},
							page_count: pages.length,
						},
					],
				};
			}
			// documents full_text for OCR promotion
			if (q.includes("SELECT full_text") && q.includes("full_text_absent_reason") && q.includes("FROM documents") && q.includes("LIMIT 1")) {
				return { rows: [{ full_text: "", full_text_absent_reason: "no_text_extracted", extraction_metadata: {} }] };
			}
			// OCR join query
			if (q.includes("FROM visual_assets") && q.includes("JOIN visual_extractions") && q.includes("WHERE va.document_id = $1")) {
				return { rows: [] };
			}
			// documents UPDATE full_text
			if (q.includes("UPDATE documents") && q.includes("SET full_text")) {
				return { rows: [] };
			}
			// documents UPDATE extraction_metadata (mergeDocumentExtractionMetadata)
			if (q.includes("UPDATE documents") && q.includes("|| $2::jsonb")) {
				return { rows: [] };
			}
			// DPU fallback query
			if (q.includes("document_page_understanding") && q.includes("pages_with_understanding")) {
				const m2 = getMocks();
				const dpuRows = m2.dpuFallbackRows ?? 0;
				return {
					rows: [
						{
							pages_with_understanding: dpuRows,
							page_start: dpuRows > 0 ? 0 : null,
							page_end: dpuRows > 0 ? dpuRows - 1 : null,
							title_hint: null,
						},
					],
				};
			}
			// visual_assets count
			if (q.includes("FROM visual_assets") && q.includes("COUNT")) {
				return { rows: [{ c: 0 }] };
			}
			// visual_assets skip-existing precheck
			if (q.includes("FROM visual_assets") && q.includes("WHERE va.document_id") && q.includes("va.page_index")) {
				return { rows: [] };
			}
			// visual_assets upsert
			if (q.includes("INSERT INTO visual_assets") && q.includes("RETURNING id")) {
				return { rows: [{ id: "va-1" }] };
			}
			// visual_extractions upsert
			if (q.includes("INSERT INTO visual_extractions") && q.includes("ON CONFLICT")) {
				return { rows: [], rowCount: 1 } as any;
			}
			// PR7-lite: maybeEnqueueAnalyzeDealGuarantee prerequisites check
			// Returns: no active analyze_deal, 1 doc, 0 unfinalized → all guards pass
			if (q.includes("AS active_analyze_status") && q.includes("AS total_docs") && q.includes("AS unfinalized_visual_docs")) {
				return {
					rows: [
						{
							active_analyze_status: null,
							total_docs: 1,
							unfinalized_visual_docs: 0,
						},
					],
				};
			}
			// jobs INSERT (enqueuePersistedJob)
			if (q.includes("INSERT INTO jobs")) {
				return { rows: [{ id: "job-recovered-1" }] };
			}
			// DB meta queries (inet_server_addr, db_host)
			if (q.includes("inet_server_addr") || q.includes("current_database")) {
				return { rows: [{ db_host: "localhost", db_name: "test" }] };
			}
			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(data: any) {
	return { id: "job-1", name: "extract_visuals", data } as any;
}

function makeFinalizeJob(data: any) {
	return { id: "job-finalize-1", name: "finalize_extract_visuals", data } as any;
}

function parseLogs(logSpy: { mock: { calls: any[][] } }) {
	return logSpy.mock.calls
		.map((c) => c[0])
		.filter((v): v is string => typeof v === "string" && v.trim().startsWith("{"))
		.map((s) => {
			try {
				return JSON.parse(s);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

/** Find all mergeDocumentExtractionMetadata DB updates and parse their patch payloads. */
function extractionMetadataPatches(): any[] {
	const m = getMocks();
	return (m.pgQueries ?? [])
		.filter(
			(q: any) =>
				String(q?.sql ?? "").includes("UPDATE documents") &&
				String(q?.sql ?? "").includes("|| $2::jsonb")
		)
		.map((q: any) => {
			try {
				return JSON.parse(String(q?.params?.[1] ?? "{}"));
			} catch {
				return {};
			}
		});
}

const originalFetch = (globalThis as any).fetch;

// ─── Module bootstrap ─────────────────────────────────────────────────────────

describe("PR6: Extract Visuals Finalization Reliability", () => {
	beforeAll(async () => {
		(globalThis as any).fetch = vi.fn(async (url: any, init?: any) => {
			const u = String(url ?? "");
			const method = String((init as any)?.method ?? "GET").toUpperCase();
			if (u.endsWith("/health"))
				return new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			if (u.endsWith("/openapi.json"))
				return new Response(JSON.stringify({ paths: { "/extract-visuals": { post: {} } } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			if (u.startsWith("https://example.com/page_")) {
				if (method === "GET" && String((init as any)?.headers?.Range ?? "").startsWith("bytes="))
					return new Response("", { status: 206, headers: { "content-type": "image/png" } });
				return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "image/png" } });
			}
			return new Response("", { status: 200 });
		});

		process.env.ENABLE_VISUAL_EXTRACTION = "1";
		process.env.ENABLE_PY_EXCEL_EXTRACTION = "0";
		process.env.DATABASE_URL =
			process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecision_test";
		process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

		await import("../index");
		expect(extractVisualsProcessor).toBeTypeOf("function");
		expect(finalizeExtractVisualsProcessor).toBeTypeOf("function");
	});

	beforeEach(() => {
		const m = getMocks();
		m.pgQueries = [];
		m.connectionSetImpl = undefined;
		m.connectionGetImpl = undefined;
		m.finalizeDocType = undefined;
		m.finalizeDocPages = undefined;
		m.finalizeExistingExtractionMetadata = undefined;
		m.dpuFallbackRows = 0;
		m.connectionSet?.mockClear?.();
		m.connectionGet?.mockClear?.();
		m.connectionDel?.mockClear?.();
		const queues = m.queues ?? {};
		for (const q of Object.values(queues)) {
			(q as any)?.add?.mockClear?.();
		}
	});

	afterAll(() => {
		(globalThis as any).fetch = originalFetch;
	});

	// ─── Section 1: buildExtractVisualsFinalizedMarker pure-function unit tests ───

	describe("buildExtractVisualsFinalizedMarker", () => {
		it("returns an object with extract_visuals_finalized key", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: "job-abc", docsFinalized: 1 });
			expect(result).toHaveProperty("extract_visuals_finalized");
		});

		it("ok is always true", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: null, docsFinalized: 0 });
			expect(result.extract_visuals_finalized.ok).toBe(true);
		});

		it("sets finalized_by_job_id from param", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: "job-xyz", docsFinalized: 1 });
			expect(result.extract_visuals_finalized.finalized_by_job_id).toBe("job-xyz");
		});

		it("accepts null finalized_by_job_id", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: null, docsFinalized: 1 });
			expect(result.extract_visuals_finalized.finalized_by_job_id).toBeNull();
		});

		it("sets docs_finalized from param", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: 3 });
			expect(result.extract_visuals_finalized.docs_finalized).toBe(3);
		});

		it("clamps negative docs_finalized to 0", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: -5 });
			expect(result.extract_visuals_finalized.docs_finalized).toBe(0);
		});

		it("uses provided finalizedAt", () => {
			const ts = "2026-01-15T10:00:00.000Z";
			const result = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: 1, finalizedAt: ts });
			expect(result.extract_visuals_finalized.finalized_at).toBe(ts);
		});

		it("defaults finalized_at to current ISO timestamp when not provided", () => {
			const before = Date.now();
			const result = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: 1 });
			const after = Date.now();
			const ts = new Date(result.extract_visuals_finalized.finalized_at).getTime();
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after);
		});

		it("finalized_at is a valid ISO-8601 string", () => {
			const result = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: 1 });
			expect(() => new Date(result.extract_visuals_finalized.finalized_at).toISOString()).not.toThrow();
		});

		it("result contains exactly the expected keys inside extract_visuals_finalized", () => {
			const inner = buildExtractVisualsFinalizedMarker({ jobId: "j", docsFinalized: 1 })
				.extract_visuals_finalized;
			expect(Object.keys(inner).sort()).toEqual(
				["docs_finalized", "finalized_at", "finalized_by_job_id", "ok"].sort()
			);
		});
	});

	// ─── Section 2: FINALIZE_START / FINALIZE_SUCCESS events + marker writes ──────

	describe("extract_visuals finalize for-loop events and markers", () => {
		it("emits EXTRACT_VISUALS_FINALIZE_START for the last chunk", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			// 4-page doc, pages 0-3 is the last chunk
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_START")).toBe(true);
			logSpy.mockRestore();
		});

		it("FINALIZE_START includes deal_id and document_ids", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			const start = events.find((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_START");
			expect(start?.deal_id).toBe("deal-1");
			expect(Array.isArray(start?.document_ids)).toBe(true);
			expect(start?.document_ids).toContain("doc-1");
			logSpy.mockRestore();
		});

		it("emits EXTRACT_VISUALS_FINALIZE_SUCCESS after for-loop completes", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_SUCCESS")).toBe(true);
			logSpy.mockRestore();
		});

		it("writes extract_visuals_finalized marker via mergeDocumentExtractionMetadata when page_segments written", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			logSpy.mockRestore();

			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeTruthy();
			expect(finalizedPatch.extract_visuals_finalized.ok).toBe(true);
			expect(finalizedPatch.extract_visuals_finalized.docs_finalized).toBe(1);
		});

		it("FINALIZE_START is not emitted for non-final chunks", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			// 4-page doc, pages 0-2 is NOT the last chunk
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 2 }));
			const events = parseLogs(logSpy);
			expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_START")).toBe(false);
			logSpy.mockRestore();
		});

		it("writes extract_visuals_finalized marker in already_present path", async () => {
			// Simulate page_segments_v1 already present in extraction_metadata
			getMocks().finalizeExistingExtractionMetadata = {
				doc_kind: "pdf",
				page_segments_v1: { version: "page_segments_v1", segments: [] },
			};

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			logSpy.mockRestore();

			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeTruthy();
		});

		it("writes extract_visuals_finalized marker for XLSX doc with no DPU pages (no_pages_with_understanding)", async () => {
			// XLSX doc: empty full_content pages, no DPU rows
			getMocks().finalizeDocPages = [];
			getMocks().dpuFallbackRows = 0;

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			// PAGE_SEGMENTS_V1_SKIP with reason=no_pages_with_understanding should be emitted
			expect(
				events.some((e: any) => e.event === "PAGE_SEGMENTS_V1_SKIP" && e.reason === "no_pages_with_understanding")
			).toBe(true);

			// extract_visuals_finalized marker must still be written
			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeTruthy();
			expect(finalizedPatch?.extract_visuals_finalized?.ok).toBe(true);
		});

		it("FINALIZE_SUCCESS is not emitted when lock-skip blocks finalization", async () => {
			// Override connection.set to return null (lock held)
			getMocks().connectionSetImpl = async () => null;
			getMocks().connectionGetImpl = async () =>
				JSON.stringify({ job_id: "other-job", acquired_at: Date.now() - 5000 });

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			expect(events.some((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_SUCCESS")).toBe(false);
		});
	});

	// ─── Section 3: lock-skip → recovery job enqueued ────────────────────────────

	describe("extract_visuals lock-skip recovery job enqueue", () => {
		it("enqueues finalize_extract_visuals job when lock is freshly held", async () => {
			// Lock is held by "other-job" for only 5 seconds — not stale
			getMocks().connectionSetImpl = async () => null;
			getMocks().connectionGetImpl = async () =>
				JSON.stringify({ job_id: "other-job", acquired_at: Date.now() - 5000 });

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			// LOCK_SKIP must be logged
			expect(
				events.some((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_LOCK_SKIP" && e.reason === "lock_already_held")
			).toBe(true);

			// finalize_extract_visuals job must have been inserted via enqueuePersistedJob
			const jobInserts = (getMocks().pgQueries ?? []).filter((q: any) =>
				String(q?.sql ?? "").includes("INSERT INTO jobs") &&
				JSON.stringify(q?.params ?? "").includes("finalize_extract_visuals")
			);
			expect(jobInserts.length).toBeGreaterThan(0);
		});

		it("recovery job payload contains deal_id, document_ids, and from_chunk_job_id", async () => {
			getMocks().connectionSetImpl = async () => null;
			getMocks().connectionGetImpl = async () =>
				JSON.stringify({ job_id: "original-job", acquired_at: Date.now() - 3000 });

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			logSpy.mockRestore();

			const jobInserts = (getMocks().pgQueries ?? []).filter((q: any) =>
				String(q?.sql ?? "").includes("INSERT INTO jobs") &&
				JSON.stringify(q?.params ?? "").includes("finalize_extract_visuals")
			);
			expect(jobInserts.length).toBeGreaterThan(0);
			const payloadStr = JSON.stringify(jobInserts[0]?.params ?? "");
			expect(payloadStr).toContain("deal-1");
			expect(payloadStr).toContain("doc-1");
			expect(payloadStr).toContain("job-1"); // from_chunk_job_id = job.id
		});

		it("enqueues recovery job when connection.get throws (inner catch path)", async () => {
			getMocks().connectionSetImpl = async () => null;
			getMocks().connectionGetImpl = async () => {
				throw new Error("redis connection error");
			};

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			logSpy.mockRestore();

			const jobInserts = (getMocks().pgQueries ?? []).filter((q: any) =>
				String(q?.sql ?? "").includes("INSERT INTO jobs") &&
				JSON.stringify(q?.params ?? "").includes("finalize_extract_visuals")
			);
			expect(jobInserts.length).toBeGreaterThan(0);
		});

		it("does NOT enqueue recovery job when lock is successfully acquired", async () => {
			// Default: connection.set returns "OK" (lock acquired normally)
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await extractVisualsProcessor!(makeJob({ deal_id: "deal-1", document_id: "doc-1", page_start: 0, page_end: 4 }));
			logSpy.mockRestore();

			const recoveryJobInserts = (getMocks().pgQueries ?? []).filter((q: any) =>
				String(q?.sql ?? "").includes("INSERT INTO jobs") &&
				JSON.stringify(q?.params ?? "").includes("finalize_extract_visuals")
			);
			expect(recoveryJobInserts.length).toBe(0);
		});
	});

	// ─── Section 4: finalize_extract_visuals recovery processor ──────────────────

	describe("finalize_extract_visuals recovery processor", () => {
		it("skips with reason when deal_id is missing", async () => {
			const logSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ document_ids: ["doc-1"] })
			);
			logSpy.mockRestore();
			expect(result?.ok).toBe(false);
			expect(result?.reason).toBe("missing_deal_id_or_document_ids");
		});

		it("skips with reason when document_ids is empty", async () => {
			const logSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: [] })
			);
			logSpy.mockRestore();
			expect(result?.ok).toBe(false);
			expect(result?.reason).toBe("missing_deal_id_or_document_ids");
		});

		it("acquires lock and writes finalized marker for a normal PDF doc", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			logSpy.mockRestore();

			expect(result?.ok).toBe(true);

			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeTruthy();
			expect(finalizedPatch?.extract_visuals_finalized?.ok).toBe(true);
		});

		it("writes page_segments_v1 for a PDF doc with pages", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			expect(events.some((e: any) => e.event === "PAGE_SEGMENTS_V1_WRITTEN")).toBe(true);
		});

		it("writes finalized marker for XLSX doc with no pages (no_pages_with_understanding)", async () => {
			getMocks().finalizeDocPages = [];
			getMocks().dpuFallbackRows = 0;

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-xlsx"] })
			);
			logSpy.mockRestore();

			expect(result?.ok).toBe(true);

			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeTruthy();
		});

		it("skips finalization when lock is freshly held by another job", async () => {
			getMocks().connectionSetImpl = async () => null;
			getMocks().connectionGetImpl = async () =>
				JSON.stringify({ job_id: "other-recovery", acquired_at: Date.now() - 2000 });

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			// Should skip gracefully
			expect(result?.ok).toBe(true);
			expect(result?.reason).toBe("lock_held_by_concurrent_runner");

			// No finalized marker should be written
			const patches = extractionMetadataPatches();
			const finalizedPatch = patches.find((p) => p?.extract_visuals_finalized !== undefined);
			expect(finalizedPatch).toBeUndefined();
		});

		it("takes over a stale lock (> 120s) and runs finalization", async () => {
			// Lock is 130 seconds old — stale
			getMocks().connectionSetImpl = async (key: string, _val: string, ...rest: any[]) => {
				// First call (NX) fails; second call (takeover without NX) succeeds
				const isNx = rest.includes("NX");
				if (isNx) return null;
				return "OK";
			};
			getMocks().connectionGetImpl = async () =>
				JSON.stringify({ job_id: "crashed-job", acquired_at: Date.now() - 130_000 });

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			const result = await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			logSpy.mockRestore();

			// Should have acquired via stale takeover and succeeded
			expect(result?.ok).toBe(true);
		});

		it("releases lock after successful finalization", async () => {
			const m = getMocks();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			logSpy.mockRestore();

			// Lock del must have been called
			expect(m.connectionDel).toHaveBeenCalled();
		});

		it("emits EXTRACT_VISUALS_FINALIZE_SUCCESS for recovery path", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			const events = parseLogs(logSpy);
			logSpy.mockRestore();

			const success = events.find((e: any) => e.event === "EXTRACT_VISUALS_FINALIZE_SUCCESS");
			expect(success).toBeTruthy();
			expect(success?.source).toBe("finalize_extract_visuals_recovery");
		});

		it("enqueues analyze_deal after successful recovery finalization", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as any);
			await finalizeExtractVisualsProcessor!(
				makeFinalizeJob({ deal_id: "deal-1", document_ids: ["doc-1"] })
			);
			logSpy.mockRestore();

			const analyzeInserts = (getMocks().pgQueries ?? []).filter(
				(q: any) =>
					String(q?.sql ?? "").includes("INSERT INTO jobs") &&
					JSON.stringify(q?.params ?? "").includes("analyze_deal")
			);
			expect(analyzeInserts.length).toBeGreaterThan(0);
		});
	});
});
