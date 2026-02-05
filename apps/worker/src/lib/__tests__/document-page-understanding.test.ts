import { describe, it, expect } from "vitest";

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

		const queries: Array<{ sql: string; params: any[] | undefined }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql: String(sql), params });
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
	});
});
