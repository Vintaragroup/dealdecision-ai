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

	it("does not misclassify media/sponsorship content as DTC Ecommerce", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const bm = __test__.inferBusinessModelFromText(
			[
				"Go to Market",
				"title sponsorship",
				"digital webseries",
				"media partner",
				"distribution via streaming platforms",
				"consumer ecommerce awareness (not a storefront)",
			].join("\n")
		);

		// For media decks without explicit ecommerce mechanics, we should not infer DTC Ecommerce.
		// Preferably, we return null (no inference) unless there is explicit licensing/wholesale/saas evidence.
		if (bm?.value_json?.display) {
			expect(String(bm.value_json.display)).not.toBe("DTC Ecommerce");
			expect(Boolean((bm.value_json as any)?.diagnostics?.has_media_signals)).toBe(true);
			expect(Boolean((bm.value_json as any)?.diagnostics?.has_ecom_mechanics)).toBe(false);
			// If we produced a label, ensure the media guard is recorded.
			expect(((bm.value_json as any)?.diagnostics?.applied_guards ?? [])).toContain(
				"media_blocks_dtc_without_ecom_mechanics"
			);
		} else {
			expect(bm).toBeNull();
		}
	});

	// ── RC-S6-003: RaaS over Licensing ────────────────────────────────────────────
	it("RC-S6-003: resolves Robot-as-a-Service (RaaS) when deck has explicit RaaS language, NOT Licensing", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		// PAI-style deck: primary model is RaaS; licensing refers to IP input, not revenue model.
		const bm = __test__.inferBusinessModelFromText(
			[
				"Business Model",
				"Robot as a Service (RaaS): customers lease humanoid robots at $75K–$100K+ per year.",
				"We own and manage the asset. RaaS drives recurring revenue.",
				"Technology: licensed NASA's Robonaut 2 Hand Patent Portfolio as technical foundation.",
				"Licensing of IP is an input to our product, not our revenue model.",
			].join("\n")
		);
		expect(bm).toBeTruthy();
		expect(bm?.value_json?.display).toBe("Robot-as-a-Service (RaaS)");
		expect(bm?.value_json?.display).not.toBe("Licensing");
		expect((bm?.value_json?.scores?.raas ?? 0)).toBeGreaterThanOrEqual(5);
	});

	it("RC-S6-003: RaaS keyword alone is sufficient to override Licensing classification", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const bm = __test__.inferBusinessModelFromText(
			[
				"Revenue Model",
				"RaaS subscription: per-robot fee billed monthly. Customers do not own hardware.",
				"IP licensing from third-party patents enables product capabilities.",
			].join("\n")
		);
		expect(bm).toBeTruthy();
		expect(bm?.value_json?.display).toBe("Robot-as-a-Service (RaaS)");
	});

	// ── RC-S6-001: Enterprise tech OCR-noise guard ─────────────────────────────
	it("RC-S6-001: does not classify as DTC Ecommerce when only ecom-mechanics noise present with enterprise signals", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		// Weavstra-style OCR noise: enterprise deck with spurious "orders" / "customers" from OCR.
		// No explicit DTC keyword ("DTC", "e-commerce", "Shopify", "online store") present.
		const bm = __test__.inferBusinessModelFromText(
			[
				"Enterprise AI Platform",
				"Sovereign AI infrastructure for government and enterprise customers.",
				"Orders processed securely via our quantum-grade middleware layer.",
				"Deep-tech data center AI platform with embedded compliance.",
				"B2B enterprise software licensing and deployment pipeline.",
			].join("\n")
		);
		// Must not resolve to DTC Ecommerce — "orders" and "customers" are noise in this context.
		if (bm !== null) {
			expect(bm.value_json?.display).not.toBe("DTC Ecommerce");
			expect((bm.value_json?.diagnostics?.applied_guards ?? [])).toContain(
				"enterprise_tech_blocks_mechanics_only_dtc"
			);
		}
	});

	it("RC-S6-001: DTC classification survives when explicit DTC keyword is present alongside enterprise signals", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		// Explicit "DTC e-commerce" keyword in deck — enterprise guard must NOT suppress this.
		const bm = __test__.inferBusinessModelFromText(
			[
				"Go to Market",
				"DTC e-commerce storefront for enterprise buyers purchasing direct.",
				"Enterprise software enabling the checkout flow.",
			].join("\n")
		);
		// Has explicit DTC keyword — enterprise guard should not fire.
		expect(bm).toBeTruthy();
		expect(bm?.value_json?.display).toBe("DTC Ecommerce");
	});

	it("suppresses standalone Wholesale/Retail label for marketplace/fintech channel language", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const bm = __test__.inferBusinessModelFromText(
			[
				"Go to Market",
				"Distribution channels include affiliate and partner channels",
				"Two-sided marketplace with platform fees and commission model",
				"Consumer lending platform for personal finance users",
			].join("\n")
		);

		// RC-007: this corpus has marketplace/fintech context but no explicit "wholesale" token.
		// It previously leaked into a standalone Wholesale/Retail label from generic channel terms.
		expect(bm).toBeNull();
	});

	it("real_estate_underwriting maps channel language to preferred-equity real-estate model", async () => {
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
								page_index: 1,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Business Model",
										segment_key: "business_model",
										bullets: [
											"Preferred equity in multifamily assets",
											"DTC outreach and retail partner updates",
										],
									},
									page_text: "Preferred equity in multifamily assets with NOI and cap rate focus",
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
			pageEnd: 5,
			version: "page_understanding_v1",
			selectedPolicyId: "real_estate_underwriting",
		});

		expect(res.ok).toBe(true);
		const bmFact = res.facts.find((f: any) => f?.fact_type === "business_model_v1");
		expect(bmFact).toBeTruthy();
		expect(String((bmFact as any).value_json?.display ?? "")).toBe("Real estate investment (preferred equity)");
		expect(String((bmFact as any).value_json?.display ?? "")).not.toContain("Omnichannel");
		expect(((bmFact as any).value_json?.diagnostics?.applied_guards ?? [])).toContain(
			"startup_channel_label_suppressed_for_real_estate",
		);
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

	it("infers page range when pageEnd is not provided", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

		const queries: Array<{ sql: string; params?: any[] }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql: String(sql), params });
				const q = String(sql);
				if (q.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}
				if (q.includes("SELECT MAX(page_index)")) {
					return { rows: [{ max_page_index: 2 }], rowCount: 1 };
				}
				if (q.includes("FROM public.document_page_understanding")) {
					return {
						rows: [
							{
								page_index: 2,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Go-to-market Channels",
										bullets: ["Omnichannel: DTC ecommerce + retail partners like Whole Foods."],
									},
									page_text: "Go-to-market Channels\nOmnichannel: DTC ecommerce + retail partners like Whole Foods.",
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
			pageEnd: 0,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		expect(queries.some((x) => x.sql.includes("SELECT MAX(page_index)"))).toBe(true);
		expect(queries.some((x) => x.sql.includes("FROM public.document_page_understanding"))).toBe(true);
		expect(queries.some((x) => x.sql.includes("INSERT INTO evidence_items"))).toBe(true);
		expect(res.facts.some((f: any) => f?.fact_type === "business_model_v1")).toBe(true);
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

	it("raise_terms_v1 guard: '$8B TAM' must not emit raise_terms_v1", async () => {
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
								page_index: 0,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "Market Size",
										bullets: ["$8B TAM"],
									},
									page_text: "$8B TAM",
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
			pageEnd: 1,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		expect(res.facts.some((f: any) => f?.fact_type === "raise_terms_v1")).toBe(false);
	});

	it("raise_terms_v1 guard: explicit ask must emit raise_terms_v1 with $2M", async () => {
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
								page_index: 0,
								payload: {
									source: { extracted_at: "2026-02-01T00:00:00.000Z" },
									structured: {
										kind: "powerpoint_slide",
										title: "The Ask",
										bullets: ["Raising $2M via SAFE"],
									},
									page_text: "The Ask: Raising $2M via SAFE",
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
			pageEnd: 1,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		const raiseFact = res.facts.find((f: any) => f?.fact_type === "raise_terms_v1");
		expect(raiseFact).toBeTruthy();
		expect(String((raiseFact as any)?.value_json?.display ?? "")).toContain("$2M");
		expect((raiseFact as any)?.value_json?.amount?.amount).toBe(2_000_000);
	});

	it("slideTypeToSegmentKey maps known types and handles edge cases", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");
		const fn = __test__.slideTypeToSegmentKey;

		expect(fn("raise_terms")).toBe("raise_terms");
		expect(fn("market")).toBe("market");
		expect(fn("financials")).toBe("financials");
		expect(fn("go_to_market")).toBe("distribution");
		expect(fn("use_of_funds")).toBe("raise_terms");
		expect(fn("other")).toBeNull();
		expect(fn(null)).toBeNull();
		expect(fn(undefined)).toBeNull();
		expect(fn("  ")).toBeNull();
	});

	it("resolved_slide_type on DPU row is used as segment_key fallback", async () => {
		const { promoteSlideFactsFromDocumentPageUnderstanding } = await import("../promote-slide-facts.js");

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
									// Simulates PDF DPU row: structured.segment_key is absent (PDF limitation),
									// but resolved_slide_type was patched in by page-understanding-v1.
									structured: {
										kind: "pdf_page",
										title: "The Ask",
										bullets: ["Raising $3M Seed SAFE", "$10M valuation cap"],
									},
									page_text: "The Ask\nRaising $3M Seed SAFE\n$10M valuation cap",
									resolved_slide_type: "raise_terms",
									resolved_slide_type_confidence: 0.85,
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
			pageEnd: 1,
			version: "page_understanding_v1",
		});

		expect(res.ok).toBe(true);
		// Should extract raise terms from the PDF page using the resolved_slide_type fallback boost.
		const raiseFact = res.facts.find((f: any) => f?.fact_type === "raise_terms_v1");
		expect(raiseFact).toBeTruthy();
	});
});
// ─── P5 Phase 3 — has_real_estate_signals regex hardening ────────────────────

describe("Phase 3: has_real_estate_signals — generic lending terms must not trigger real-estate override", () => {
	it("car-finance text with 'ltv' does NOT set has_real_estate_signals", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		// Carmoola-like text: LTV is a car-loan metric, not a real estate signal.
		const bm = __test__.inferBusinessModelFromText(
			[
				"Go-to-Market",
				"Direct consumer car financing platform.",
				"We offer DTC auto loans at competitive LTV ratios.",
				"Consumers apply via mobile and receive instant approvals.",
			].join("\n")
		);

		// has_real_estate_signals must NOT fire on LTV alone
		expect((bm?.value_json as any)?.diagnostics?.has_real_estate_signals).toBe(false);
		// Display must NOT be 'Real estate structured investment'
		expect(bm?.value_json?.display).not.toBe("Real estate structured investment");
	});

	it("car-finance text with 'dscr' does NOT set has_real_estate_signals", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const bm = __test__.inferBusinessModelFromText(
			[
				"Business Model",
				"Consumer lending platform with DSCR-based risk scoring.",
				"Direct-to-consumer subscriptions for credit monitoring.",
				"ARR of $2.1M across 5,000 subscribers.",
			].join("\n")
		);

		expect((bm?.value_json as any)?.diagnostics?.has_real_estate_signals).toBe(false);
	});

	it("text with unambiguous 'real estate' DOES set has_real_estate_signals", async () => {
		const { __test__ } = await import("../promote-slide-facts.js");

		const bm = __test__.inferBusinessModelFromText(
			[
				"Investment Strategy",
				"Multifamily real estate investment with preferred equity tranches.",
				"NOI yield targeting 6-8% cap rate.",
			].join("\n")
		);

		// Real estate specific terms should still trigger the flag
		if (bm) {
			expect((bm.value_json as any)?.diagnostics?.has_real_estate_signals).toBe(true);
		}
		// Note: bm may be null if no primary model label is selected for this real-estate text
	});
});