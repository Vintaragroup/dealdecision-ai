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
	});

	it("UPSERT conflict handler preserves non-empty page_text when incoming payload is empty — regression guard", async () => {
		// Regression guard: ON CONFLICT must use CASE guard so a vision re-run that produces
		// page_text='' never overwrites a previously-good page_text (e.g. written by PDF enrichment).
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "3", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "88888888-8888-8888-8888-888888888888",
		});

		const dealUpsert = capturedSql.find(
			(q) => q.includes("ON CONFLICT (document_id, page_index, version) DO UPDATE") && !q.includes("generate_series")
		);
		expect(dealUpsert).toBeDefined();
		// CASE guard: must not overwrite existing good text with empty incoming payload.
		expect(dealUpsert).toContain("COALESCE(document_page_understanding.payload->>'page_text', '') <> ''");
		expect(dealUpsert).toContain("COALESCE(EXCLUDED.payload->>'page_text', '') = ''");
		expect(dealUpsert).toContain("THEN document_page_understanding.payload");
		expect(dealUpsert).toContain("ELSE EXCLUDED.payload");
	});
});

describe("resolveBestDpuPageText", () => {
	it("returns pdf_text source when pdfText meets minPdfLength", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({ pdfText: "This is thirty characters exactly!!", structuredText: "structured text with enough length here", ocrText: "ocr fallback" });
		expect(result.source).toBe("pdf_text");
		expect(result.extractor).toBe("worker.pdf");
		expect(result.pageType).toBe("pdf_text");
		expect(result.text).toBe("This is thirty characters exactly!!");
	});

	it("skips pdfText below minPdfLength and falls back to structured", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({
			pdfText: "short",          // < 25 chars, skip
			structuredText: "This structured text is definitely more than forty characters long",
			ocrText: "ocr text",
		});
		expect(result.source).toBe("structured");
		expect(result.extractor).toBe("vision_v1");
		expect(result.pageType).toBe("page_image");
	});

	it("uses structured when no pdfText and structured meets minStructuredLength", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({
			pdfText: null,
			structuredText: "Exactly enough structured text right here for this test case yes",
		});
		expect(result.source).toBe("structured");
	});

	it("falls through to ocr when pdfText and structuredText both below thresholds", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({
			pdfText: null,
			structuredText: "too short",   // < 40
			ocrText: "OCR text for this page",
		});
		expect(result.source).toBe("ocr");
		expect(result.extractor).toBe("ocr");
	});

	it("falls through to vision when only visionPageText is present", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({
			visionPageText: "fallback vision output",
			visionExtractorVersion: "vision_v2",
		});
		expect(result.source).toBe("vision");
		expect(result.extractor).toBe("vision_v2");
	});

	it("returns empty source when no usable candidates", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		const result = resolveBestDpuPageText({});
		expect(result.source).toBe("empty");
		expect(result.text).toBe("");
	});

	it("respects custom minPdfLength override", async () => {
		const { resolveBestDpuPageText } = await import("../document-page-understanding.js");
		// 'hello world' is 11 chars; with minPdfLength=5 it should be accepted
		const result = resolveBestDpuPageText({ pdfText: "hello world", minPdfLength: 5 });
		expect(result.source).toBe("pdf_text");
	});
});

describe("enrichDpuWithEmbeddedPdfText", () => {
	it("document-scoped: calls UPDATE using full_content->pages with correct clauses", async () => {
		const { enrichDpuWithEmbeddedPdfText } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const capturedParams: any[][] = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				capturedSql.push(String(sql));
				capturedParams.push(params ?? []);
				return { rows: [{ enriched: "4" }], rowCount: 1 };
			},
		};

		const result = await enrichDpuWithEmbeddedPdfText(pool, {
			documentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			pageStart: 0,
			pageEnd: 4,
			version: "page_understanding_v1",
		});

		expect(result.enriched).toBe(4);
		expect(capturedSql).toHaveLength(1);
		const sql = capturedSql[0]!;
		// Must pull from documents.full_content->pages
		expect(sql).toContain("full_content->'pages'");
		// Must use document_id filter
		expect(sql).toContain("d.id = $1::uuid");
		// Must only update rows where page_text is empty
		expect(sql).toContain("COALESCE(dpu.payload->>'page_text', '') = ''");
		// Must set worker.pdf as extractor
		expect(sql).toContain("\"worker.pdf\"");
		// Must set pdf_text as page_type
		expect(sql).toContain("\"pdf_text\"");
		// Must set quality flag
		expect(sql).toContain("used_pdf_text");
		// Must return COUNT(*)::bigint AS enriched
		expect(sql).toContain("COUNT(*)::bigint AS enriched");
		// Params: [docId, minLen, pageStart, pageEnd, version]
		expect(capturedParams[0]).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", 25, 0, 4, "page_understanding_v1"]);
	});

	it("deal-scoped: uses deal_id filter and correct param order", async () => {
		const { enrichDpuWithEmbeddedPdfText } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const capturedParams: any[][] = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				capturedSql.push(String(sql));
				capturedParams.push(params ?? []);
				return { rows: [{ enriched: "13" }], rowCount: 1 };
			},
		};

		const result = await enrichDpuWithEmbeddedPdfText(pool, {
			dealId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
			version: "page_understanding_v1",
		});

		expect(result.enriched).toBe(13);
		const sql = capturedSql[0]!;
		expect(sql).toContain("d.deal_id = $1::uuid");
		expect(sql).toContain("full_content->'pages'");
		expect(sql).toContain("COALESCE(dpu.payload->>'page_text', '') = ''");
		// Params: [dealId, minLen, version]
		expect(capturedParams[0]).toEqual(["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", 25, "page_understanding_v1"]);
	});

	it("returns enriched=0 and skips query when neither documentId nor dealId supplied", async () => {
		const { enrichDpuWithEmbeddedPdfText } = await import("../document-page-understanding.js");
		let called = false;
		const pool: any = {
			query: async () => {
				called = true;
				return { rows: [] };
			},
		};
		const result = await enrichDpuWithEmbeddedPdfText(pool, {});
		expect(result.enriched).toBe(0);
		expect(called).toBe(false);
	});

	it("respects custom minPdfTextLength in SQL params", async () => {
		const { enrichDpuWithEmbeddedPdfText } = await import("../document-page-understanding.js");
		const capturedParams: any[] = [];
		const pool: any = {
			query: async (_sql: string, params?: any[]) => {
				capturedParams.push(...(params ?? []));
				return { rows: [{ enriched: "0" }] };
			},
		};
		await enrichDpuWithEmbeddedPdfText(pool, { dealId: "cccccccc-cccc-cccc-cccc-cccccccccccc", minPdfTextLength: 80 });
		// Second param is minLen
		expect(capturedParams[1]).toBe(80);
	});
});

describe("populateDocumentPageUnderstandingFromVisualExtractions — PDF enrichment wiring", () => {
	it("calls enrichDpuWithEmbeddedPdfText after the main upsert for deal-level runs", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");
		const logs: any[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((msg: any) => {
			try { logs.push(typeof msg === "string" ? JSON.parse(msg) : msg); } catch { logs.push(msg); }
		});

		const sqlCalls: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				sqlCalls.push(String(sql));
				// Simulate 3 pages with empty page_text (the main upsert)
				if (String(sql).includes("ON CONFLICT") && !String(sql).includes("generate_series")) {
					return { rows: [{ upserted: "3", page_text_empty: "3" }], rowCount: 1 };
				}
				// Enrichment query returns 3 enriched rows
				if (String(sql).includes("COUNT(*)::bigint AS enriched")) {
					return { rows: [{ enriched: "3" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "0", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		const res = await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
		});

		expect(res.upserted).toBe(3);
		// Enrichment SQL must have been called
		expect(sqlCalls.some((q) => q.includes("COUNT(*)::bigint AS enriched"))).toBe(true);
		// The enrichment log event should have been emitted
		const enrichLog = logs.find((l) => l?.event === "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_PDF_ENRICH");
		expect(enrichLog).toBeDefined();
		expect(enrichLog?.enriched).toBe(3);
		expect(enrichLog?.mode).toBe("deal_wide");

		spy.mockRestore();
	});

	it("calls enrichDpuWithEmbeddedPdfText after backfill for document-range runs", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const sqlCalls: Array<{ sql: string }> = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				sqlCalls.push({ sql: String(sql) });
				if (String(sql).includes("COUNT(*)::bigint AS inserted")) {
					return { rows: [{ inserted: "0" }], rowCount: 1 };
				}
				if (String(sql).includes("COUNT(*)::bigint AS enriched")) {
					return { rows: [{ enriched: "0" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "5", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
			dealId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
			pageStart: 0,
			pageEnd: 5,
			version: "page_understanding_v1",
		});

		// Order must be: [0] main upsert, [1] backfill, [2] enrichment (never before backfill)
		const mainIdx = sqlCalls.findIndex((q) => q.sql.includes("va.page_index >= $2") && q.sql.includes("ON CONFLICT"));
		const backfillIdx = sqlCalls.findIndex((q) => q.sql.includes("generate_series($2::int"));
		const enrichIdx = sqlCalls.findIndex((q) => q.sql.includes("COUNT(*)::bigint AS enriched"));

		expect(mainIdx).toBeGreaterThanOrEqual(0);
		expect(backfillIdx).toBeGreaterThan(mainIdx);
		expect(enrichIdx).toBeGreaterThan(backfillIdx);

		spy.mockRestore();
	});
});