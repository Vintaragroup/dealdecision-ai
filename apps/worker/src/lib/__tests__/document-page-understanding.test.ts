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

describe("populateDocumentPageUnderstandingFromVisualExtractions — excel_sheet DPU population", () => {
	it("deal-level SQL contains excel_sheet prepared fields, passthrough columns, and CASE arm", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "11110000-aaaa-bbbb-cccc-dddd00001111",
		});

		const dealSql = capturedSql.find(
			(q) => q.includes("FROM docs d") && q.includes("ON CONFLICT (document_id, page_index, version)")
		);
		expect(dealSql).toBeDefined();

		// prepared: new excel_sheet fields (NULLIF/COALESCE form, check field ref and alias separately)
		expect(dealSql).toContain("structured_json->>'sheet_name'");
		expect(dealSql).toContain("AS excel_sheet_name");
		expect(dealSql).toContain("structured_json->>'summary_text_investor'");
		expect(dealSql).toContain("AS excel_summary_investor");
		expect(dealSql).toContain("END AS excel_grid_preview_text");

		// grid_preview aggregation tokens
		expect(dealSql).toContain("{grid_preview,cells}");
		expect(dealSql).toContain("cell.value->>'w'");
		expect(dealSql).toContain("cell.value->>'v'");
		expect(dealSql).toContain("cell.value->>'a'");
		expect(dealSql).toContain("LIMIT 12");

		// computed passthrough
		expect(dealSql).toContain("excel_sheet_name,");
		expect(dealSql).toContain("excel_summary_investor,");
		expect(dealSql).toContain("excel_grid_preview_text,");

		// page_text CASE arm
		expect(dealSql).toContain("WHEN sj_kind = 'excel_sheet'");
		expect(dealSql).toContain("'Sheet: ' || excel_sheet_name");
		expect(dealSql).toContain("'Summary: ' || excel_summary_investor");
		expect(dealSql).toContain("'Headers: ' || excel_headers_text");
	});

	it("document-range SQL also contains excel_sheet fields and CASE arm", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				if (String(sql).includes("COUNT(*)::bigint AS inserted")) {
					return { rows: [{ inserted: "0" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "22220000-aaaa-bbbb-cccc-dddd00002222",
			dealId: "33330000-aaaa-bbbb-cccc-dddd00003333",
			pageStart: 0,
			pageEnd: 2,
		});

		const rangeSql = capturedSql.find(
			(q) => q.includes("va.page_index >= $2") && q.includes("ON CONFLICT (document_id, page_index, version)")
		);
		expect(rangeSql).toBeDefined();

		expect(rangeSql).toContain("structured_json->>'sheet_name'");
		expect(rangeSql).toContain("AS excel_sheet_name");
		expect(rangeSql).toContain("AS excel_summary_investor");
		expect(rangeSql).toContain("END AS excel_grid_preview_text");
		expect(rangeSql).toContain("{grid_preview,cells}");
		expect(rangeSql).toContain("WHEN sj_kind = 'excel_sheet'");
		expect(rangeSql).toContain("'Sheet: ' || excel_sheet_name");
		expect(rangeSql).toContain("'Summary: ' || excel_summary_investor");
	});

	it("excel_sheet CASE arm is before excel_range arm, which is before structured_ok arm", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "44440000-aaaa-bbbb-cccc-dddd00004444",
		});

		const dealSql = capturedSql.find((q) => q.includes("FROM docs d") && q.includes("ON CONFLICT"));
		expect(dealSql).toBeDefined();

		const sheetPos = dealSql!.indexOf("WHEN sj_kind = 'excel_sheet'");
		const rangePos = dealSql!.indexOf("WHEN sj_kind = 'excel_range'");
		const endPageTextPos = dealSql!.indexOf("END AS page_text,");

		expect(sheetPos).toBeGreaterThan(0);
		expect(rangePos).toBeGreaterThan(sheetPos);   // excel_sheet before excel_range

		// structured_ok arm follows excel_range inside same CASE
		const structuredAfterRange = dealSql!.indexOf("WHEN COALESCE(length(NULLIF(BTRIM(concat_ws", rangePos + 1);
		expect(structuredAfterRange).toBeGreaterThan(rangePos);

		// All arms are before END AS page_text,
		expect(sheetPos).toBeLessThan(endPageTextPos);
		expect(rangePos).toBeLessThan(endPageTextPos);
		expect(structuredAfterRange).toBeLessThan(endPageTextPos);
	});

	it("grid_preview SQL uses address 'a' for row grouping and 'w'/'v' for display values", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "55550000-aaaa-bbbb-cccc-dddd00005555",
		});

		const dealSql = capturedSql.find((q) => q.includes("FROM docs d") && q.includes("ON CONFLICT"));
		expect(dealSql).toBeDefined();

		// Row number extraction from address field 'a' using regexp
		expect(dealSql).toContain("regexp_replace(cell.value->>'a', '[^0-9]', '', 'g')::int");
		// Column letter ordering from address field 'a'
		expect(dealSql).toContain("ORDER BY regexp_replace(cell.value->>'a', '[^A-Z]', '', 'g')");
		// Prefer 'w' (display text) over 'v' (raw value)
		expect(dealSql).toContain("COALESCE(cell.value->>'w', cell.value->>'v', '')");
		// GROUP BY and ORDER BY row_num with LIMIT 12
		expect(dealSql).toContain("GROUP BY row_num");
		expect(dealSql).toContain("ORDER BY row_num");
		expect(dealSql).toContain("LIMIT 12");
	});
});

describe("populateDocumentPageUnderstandingFromVisualExtractions — excel_range DPU population", () => {
	it("deal-level SQL contains excel_range WHEN arm, prepared fields, and rows_preview extraction", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "aaaabbbb-aaaa-bbbb-cccc-ddddeeeeeeee",
		});

		const dealSql = capturedSql.find(
			(q) => q.includes("FROM docs d") && q.includes("ON CONFLICT (document_id, page_index, version)")
		);
		expect(dealSql).toBeDefined();

		// New prepared fields
		expect(dealSql).toContain("structured_json->>'kind' AS sj_kind");
		expect(dealSql).toContain("jsonb_array_elements_text(structured_json->'headers')");
		expect(dealSql).toContain("END AS excel_headers_text");
		expect(dealSql).toContain("jsonb_array_elements(structured_json->'rows_preview')");
		expect(dealSql).toContain("END AS excel_rows_text");
		expect(dealSql).toContain("r.rn <= 12");
		expect(dealSql).toContain("c.value #>> '{}'");

		// New passthrough columns in computed SELECT
		expect(dealSql).toContain("sj_kind,");
		expect(dealSql).toContain("excel_headers_text,");
		expect(dealSql).toContain("excel_rows_text,");

		// New top-priority WHEN arm in page_text CASE
		expect(dealSql).toContain("WHEN sj_kind = 'excel_range'");
		expect(dealSql).toContain("'Headers: ' || excel_headers_text");

		// Existing PDF/PPTX arms preserved
		expect(dealSql).toContain("ocr_text_clean");
		expect(dealSql).toContain("ON CONFLICT (document_id, page_index, version)");
	});

	it("document-range SQL also contains excel_range WHEN arm and prepared fields", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				if (String(sql).includes("COUNT(*)::bigint AS inserted")) {
					return { rows: [{ inserted: "0" }], rowCount: 1 };
				}
				return { rows: [{ upserted: "2", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "11112222-1111-2222-3333-444455556666",
			dealId: "66665555-4444-3333-2222-111100009999",
			pageStart: 0,
			pageEnd: 3,
		});

		const rangeSql = capturedSql.find(
			(q) => q.includes("va.page_index >= $2") && q.includes("ON CONFLICT (document_id, page_index, version)")
		);
		expect(rangeSql).toBeDefined();

		expect(rangeSql).toContain("structured_json->>'kind' AS sj_kind");
		expect(rangeSql).toContain("END AS excel_headers_text");
		expect(rangeSql).toContain("END AS excel_rows_text");
		expect(rangeSql).toContain("WHEN sj_kind = 'excel_range'");
		expect(rangeSql).toContain("'Headers: ' || excel_headers_text");

		// Page-range params still present
		expect(rangeSql).toContain("va.page_index >= $2");
		expect(rangeSql).toContain("va.page_index < $3");
	});

	it("excel_range page_text CASE arm is BEFORE (higher priority than) the structured-ok arm", async () => {
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import("../document-page-understanding.js");

		const capturedSql: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				capturedSql.push(String(sql));
				return { rows: [{ upserted: "1", page_text_empty: "0" }], rowCount: 1 };
			},
		};

		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			dealId: "ffffffff-1111-2222-3333-444444444444",
		});

		const dealSql = capturedSql.find((q) => q.includes("FROM docs d") && q.includes("ON CONFLICT"));
		expect(dealSql).toBeDefined();

		// excel_range WHEN must appear inside the page_text CASE.
		// The structured-ok WHEN arm inside page_text CASE also starts with "WHEN COALESCE(length..." but
		// appears AFTER the excel_range WHEN. Search for it starting from just after excelWhenPos to confirm ordering.
		const excelWhenPos = dealSql!.indexOf("WHEN sj_kind = 'excel_range'");
		expect(excelWhenPos).toBeGreaterThan(0);

		// First "WHEN COALESCE(length..." after the excel_range WHEN is the structured-40 arm in page_text CASE
		const structuredWhenInPageTextPos = dealSql!.indexOf("WHEN COALESCE(length(NULLIF(BTRIM(concat_ws", excelWhenPos + 1);
		expect(structuredWhenInPageTextPos).toBeGreaterThan(excelWhenPos);

		// The excel_range WHEN arm must also appear before END AS page_text (i.e. it IS inside page_text CASE)
		const endPageTextPos = dealSql!.indexOf("END AS page_text,");
		expect(excelWhenPos).toBeLessThan(endPageTextPos);
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