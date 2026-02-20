import { describe, it, expect, vi } from "vitest";

describe("document_page_understanding population", () => {
	it("runs deterministic upsert and returns counts", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [{ upserted: "7", page_text_empty: "2" }], rowCount: 1 };
			},
		};

		const res = await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "11111111-1111-1111-1111-111111111111",
		});

		expect(res.upserted).toBe(7);
		expect(res.page_text_empty).toBe(2);
		expect(queries.some((q) => q.includes("INSERT INTO public.document_page_understanding"))).toBe(true);
		expect(queries.some((q) => q.includes("ON CONFLICT (document_id, page_index, version)"))).toBe(true);
	});

	it("filters by document + page range and uses conflict target", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");
		const logs: any[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((msg: any) => {
			try {
				logs.push(typeof msg === "string" ? JSON.parse(msg) : msg);
			} catch {
				logs.push(msg);
			}
		});

		const queries: Array<{ sql: string; params: any[] | undefined }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql: String(sql), params });
				if (String(sql).includes("COUNT(*)::bigint AS inserted")) {
					return { rows: [{ inserted: "9" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "31", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		const res = await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "22222222-2222-2222-2222-222222222222",
			dealId: "33333333-3333-3333-3333-333333333333",
			pageStart: 10,
			pageEnd: 20,
			version: "page_understanding_v1",
		});

		expect(res.upserted).toBe(31);
		expect(res.page_text_empty).toBe(0);

		const q0 = queries[0];
		expect(q0?.sql.includes("va.page_index >= $2")).toBe(true);
		expect(q0?.sql.includes("va.page_index < $3")).toBe(true);
		expect(q0?.sql.includes("ON CONFLICT (document_id, page_index, version)")).toBe(true);
		// Regression guard: ensure OCR fallback + OCR-derived parsing is present.
		expect(q0?.sql.includes("ocr_text_clean")).toBe(true);
		expect(q0?.sql.includes("{text_blocks,ocr_text}")).toBe(true);
		expect(q0?.sql.includes("regexp_split_to_array")).toBe(true);
		expect(q0?.sql.includes("'used_ocr_fallback', (ocr_text_clean IS NOT NULL) AND ((NOT structured_ok) OR COALESCE(length(page_text), 0) < 40)")).toBe(true);
		// page_text_empty now treats either page_text OR text_snippet as understanding.
		expect(q0?.sql.includes("payload->'text_blocks'->>'text_snippet'")).toBe(true);
		// Eligibility is driven by joins (visual_assets -> visual_extractions), not documents.type metadata.
		expect(q0?.sql.includes("ILIKE '%presentation%'")).toBe(false);
		expect(q0?.sql.includes("ILIKE '%powerpoint%'")).toBe(false);
		expect(q0?.sql.includes("ILIKE '%presentationml%'")).toBe(false);
		expect(q0?.params).toEqual([
			"22222222-2222-2222-2222-222222222222",
			10,
			20,
			"page_understanding_v1",
		]);

		const q1 = queries[1];
		expect(q1?.sql.includes("generate_series($2::int, ($3::int) - 1)")).toBe(true);
		expect(q1?.sql.includes("missing_visual_extraction")).toBe(true);
		expect(q1?.sql.includes("ON CONFLICT (document_id, page_index, version) DO NOTHING")).toBe(true);
		expect(q1?.params).toEqual([
			"22222222-2222-2222-2222-222222222222",
			10,
			20,
			"page_understanding_v1",
		]);

		const startLog = logs.find((l) => l && typeof l === "object" && l.event === "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_START");
		expect(startLog?.deal_id).toBe("33333333-3333-3333-3333-333333333333");
		spy.mockRestore();
	});

	it("UPSERT conflict handler advances created_at for freshness anchor — deal-level rerun regression", async () => {
		// Regression guard: when the same DPU rows are upserted a second time (rerun),
		// the ON CONFLICT handler MUST set created_at = now() so the freshness query
		// (MAX(GREATEST(created_at, COALESCE(updated_at, created_at)))) advances past
		// min_dpu_created_at and the readiness gate does not stay stuck as DPU_STALE.
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "5", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "55555555-5555-5555-5555-555555555555",
		});

		// Find the deal-level UPSERT (no documentId supplied → uses sqlDeal path)
		const dealUpsert = capturedSql.find(
			(q) => q.includes("ON CONFLICT (document_id, page_index, version) DO UPDATE") &&
			       !q.includes("generate_series") // exclude the missing-rows stub
		);
		expect(dealUpsert).toBeDefined();
		// The conflict handler MUST advance created_at so reruns unlock the freshness gate.
		expect(dealUpsert).toMatch(/created_at\s*=\s*now\(\)/);
		expect(dealUpsert).toMatch(/updated_at\s*=\s*now\(\)/);
	});

	it("UPSERT conflict handler advances created_at for freshness anchor — document-range rerun regression", async () => {
		// Same guarantee for the document-range code path (chunk-scoped UPSERT).
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				if (String(sql).includes("COUNT(*)::bigint")) {
					return { rows: [{ inserted: "0" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "12", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "66666666-6666-6666-6666-666666666666",
			dealId: "77777777-7777-7777-7777-777777777777",
			pageStart: 0,
			pageEnd: 12,
			version: "page_understanding_v1",
		});

		// Find the document-range UPSERT (has page_index >= $2 filter)
		const rangeUpsert = capturedSql.find(
			(q) => q.includes("va.page_index >= $2") &&
			       q.includes("ON CONFLICT (document_id, page_index, version) DO UPDATE")
		);
		expect(rangeUpsert).toBeDefined();
		// Must advance created_at so rerun freshness anchor advances.
		expect(rangeUpsert).toMatch(/created_at\s*=\s*now\(\)/);
		expect(rangeUpsert).toMatch(/updated_at\s*=\s*now\(\)/);
	});});