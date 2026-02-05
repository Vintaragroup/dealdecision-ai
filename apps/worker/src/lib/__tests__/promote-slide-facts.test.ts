import { describe, it, expect } from "vitest";

describe("promote slide facts", () => {
	it("extracts raise terms and business model deterministically", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const raise = __test__.parseRaiseTermsFromText(
			"The Ask\nRaising $3M Seed SAFE with $10M valuation cap."
		);
		expect(raise).toBeTruthy();
		expect(raise?.value_json?.display).toContain("$3M");
		expect(raise?.value_json?.instrument).toBe("SAFE");
		expect(raise?.value_json?.valuation_cap?.amount).toBe(10_000_000);

		const raise2 = __test__.parseRaiseTermsFromText(
			"Capital Raise\nEquity $1.5MM raise on a $6MM valuation."
		);
		expect(raise2).toBeTruthy();
		expect(raise2?.value_json?.instrument).toBe("Equity");
		expect(raise2?.value_json?.amount?.amount).toBe(1_500_000);
		expect(raise2?.value_json?.valuation?.amount).toBe(6_000_000);
		expect(String(raise2?.value_json?.display ?? "")).toContain("$1.5M");

		const bm = __test__.inferBusinessModelFromText(
			"Go-to-market Channels\nOmnichannel: DTC ecommerce + retail partners like Whole Foods."
		);
		expect(bm).toBeTruthy();
		expect(bm?.value_json?.display).toBe("Omnichannel (DTC + Wholesale/Retail)");
	});

	it("resolves primary business model as DTC + Wholesale and keeps Licensing secondary", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

		const inserts: any[] = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				const q = String(sql);
				if (q.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}
				if (q.includes("FROM public.document_page_understanding")) {
					return {
						rows: [
							{
								page_index: 0,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Go to Market Strategy",
										bullets: ["Most of our business is direct via our website"],
									},
									page_text: "Go to Market Strategy\nMost of our business is direct via our website",
								},
							},
							{
								page_index: 1,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:01.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Wholesale Expansion",
										bullets: ["Wholesale", "Retail accounts"],
									},
									page_text: "Wholesale Expansion\nWholesale\nRetail accounts",
								},
							},
							{
								page_index: 2,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:02.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Licensing Examples",
										bullets: ["Licensing"],
									},
									page_text: "Licensing Examples\nLicensing",
								},
							},
						],
					};
				}
				if (q.includes("INSERT INTO evidence_items")) {
					inserts.push({ sql: q, params });
					return { rows: [{ inserted: true }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			},
		};

		const res = await promoteSlideFactsFromDocumentPageUnderstanding(pool, {
			dealId: "11111111-1111-1111-1111-111111111111",
			documentId: "22222222-2222-2222-2222-222222222222",
			pageStart: 0,
			pageEnd: 3,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		const bmFact = res.facts.find((f: any) => f?.fact_type === "business_model_v1");
		expect(bmFact).toBeTruthy();
		expect(String((bmFact as any).value_json?.display ?? "")).toBe("Omnichannel (DTC + Wholesale/Retail)");
		expect(String((bmFact as any).value_json?.display ?? "")).not.toBe("Licensing");
		expect(Array.isArray((bmFact as any).value_json?.secondary_tags)).toBe(true);
		expect(((bmFact as any).value_json?.secondary_tags ?? [])).toContain("Licensing");

		// Also assert we persist as a dedicated source_type.
		const bmInsert = inserts.find((x) => Array.isArray(x.params) && x.params[2] === "business_model_fact");
		expect(bmInsert).toBeTruthy();
		if (bmInsert) {
			const contentJson = JSON.parse(String(bmInsert.params[9]));
			expect(contentJson?.value_json?.display).toBe("Omnichannel (DTC + Wholesale/Retail)");
		}
	});

	it("queries DPU and upserts into evidence_items", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

		const queries: Array<{ sql: string; params?: any[] }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql: String(sql), params });
				const q = String(sql);
				if (q.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}
				if (q.includes("FROM public.document_page_understanding")) {
					return {
						rows: [
							{
								page_index: 6,
								payload: {
									source: { extracted_at: "2026-01-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "The Ask",
										bullets: ["Raising $3M Seed SAFE", "$10M valuation cap"],
									},
									page_text: "The Ask\nRaising $3M Seed SAFE\n$10M valuation cap",
								},
							},
						],
					};
				}
				if (q.includes("INSERT INTO evidence_items")) {
					return { rows: [{ inserted: true }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			},
		};

		const res = await promoteSlideFactsFromDocumentPageUnderstanding(pool, {
			dealId: "11111111-1111-1111-1111-111111111111",
			documentId: "22222222-2222-2222-2222-222222222222",
			pageStart: 6,
			pageEnd: 7,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		expect(res.facts.length).toBeGreaterThan(0);
		expect(queries.some((x) => x.sql.includes("FROM public.document_page_understanding"))).toBe(true);
		expect(queries.some((x) => x.sql.includes("INSERT INTO evidence_items"))).toBe(true);
		expect(queries.some((x) => x.sql.includes("ON CONFLICT (evidence_id)"))).toBe(true);
	});

	it("prefers raise_terms segment_key slide for raise selection", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

		const pool: any = {
			query: async (sql: string) => {
				const q = String(sql);
				if (q.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}
				if (q.includes("FROM public.document_page_understanding")) {
					return {
						rows: [
							{
								page_index: 10,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Traction",
										bullets: ["Raising $2M"],
									},
									page_text: "Traction\nRaising $2M",
								},
							},
							{
								page_index: 19,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:01.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Capital Raise",
										segment_key: "raise_terms",
										bullets: ["Equity $1.5MM raise on a $6MM valuation."],
									},
									page_text: "Capital Raise\nEquity $1.5MM raise on a $6MM valuation.",
								},
							},
						],
					};
				}
				if (q.includes("INSERT INTO evidence_items")) {
					return { rows: [{ inserted: true }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			},
		};

		const res = await promoteSlideFactsFromDocumentPageUnderstanding(pool, {
			dealId: "11111111-1111-1111-1111-111111111111",
			documentId: "22222222-2222-2222-2222-222222222222",
			pageStart: 0,
			pageEnd: 25,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		const raiseFact = res.facts.find((f: any) => f?.fact_type === "raise_terms_v1");
		expect(raiseFact).toBeTruthy();
		expect((raiseFact as any).meta?.page_index).toBe(19);
		expect((raiseFact as any).value_json?.amount?.amount).toBe(1_500_000);
	});

	it("prefers business_model segment_key slide for business model citation", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

		const pool: any = {
			query: async (sql: string) => {
				const q = String(sql);
				if (q.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}
				if (q.includes("FROM public.document_page_understanding")) {
					return {
						rows: [
							{
								page_index: 12,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Licensing Model",
										bullets: [
											"Primary revenue is licensing",
											"Brand licensing and royalties",
											"IP licensing revenue",
										],
									},
									page_text: "Licensing Model\nPrimary revenue is licensing\nBrand licensing and royalties\nIP licensing revenue",
								},
							},
							{
								page_index: 15,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:01.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Business Model",
										segment_key: "business_model",
										bullets: [
											"Most of our business is direct via our website",
											"DTC ecommerce",
											"Wholesale to retail partners",
										],
									},
									page_text: "Business Model\nMost of our business is direct via our website\nDTC ecommerce\nWholesale to retail partners",
								},
							},
						],
					};
				}
				if (q.includes("INSERT INTO evidence_items")) {
					return { rows: [{ inserted: true }], rowCount: 1 };
				}
				return { rows: [], rowCount: 0 };
			},
		};

		const res = await promoteSlideFactsFromDocumentPageUnderstanding(pool, {
			dealId: "11111111-1111-1111-1111-111111111111",
			documentId: "22222222-2222-2222-2222-222222222222",
			pageStart: 0,
			pageEnd: 25,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		const bmFact = res.facts.find((f: any) => f?.fact_type === "business_model_v1");
		expect(bmFact).toBeTruthy();
		expect((bmFact as any).value_json?.display).toBe("Omnichannel (DTC + Wholesale/Retail)");
		expect((bmFact as any).meta?.page_index).toBe(15);
		expect((bmFact as any).meta?.segment_key).toBe("business_model");
	});
});
