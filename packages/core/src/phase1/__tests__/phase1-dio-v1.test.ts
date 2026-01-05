import { generatePhase1DIOV1, mergePhase1IntoDIO } from "../phase1-dio-v1";

describe("generatePhase1DIOV1 (Phase 1 UI-usability)", () => {
	it("always produces executive_summary_v1 and claims with evidence snippets", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-1", name: "Acme", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-1",
					title: "Acme Deck",
					type: "pitch_deck",
					full_text:
						"We are building a SaaS platform for independent retail brands. Target customers: specialty DTC teams. Raising $1.5M seed. Current revenue: $25k MRR with 40 customers.",
				},
			],
		});

		expect(out.executive_summary_v1).toBeTruthy();
		expect(typeof out.executive_summary_v1.title).toBe("string");
		expect(typeof out.executive_summary_v1.one_liner).toBe("string");
		expect(out.executive_summary_v1.one_liner.trim().length).toBeGreaterThan(0);
		expect(out.executive_summary_v1.one_liner).not.toMatch(/No description provided/i);
		expect(Array.isArray(out.executive_summary_v1.unknowns)).toBe(true);

		expect(out.decision_summary_v1).toBeTruthy();
		expect(typeof out.decision_summary_v1.score).toBe("number");
		expect(out.decision_summary_v1.score).toBeGreaterThanOrEqual(0);
		expect(out.decision_summary_v1.score).toBeLessThanOrEqual(100);
		expect(["PASS", "CONSIDER", "GO"]).toContain(out.decision_summary_v1.recommendation);
		expect(Array.isArray(out.decision_summary_v1.reasons)).toBe(true);

		expect(Array.isArray(out.claims)).toBe(true);
		expect(out.claims.length).toBeGreaterThan(0);
		for (const c of out.claims) {
			expect(Array.isArray(c.evidence)).toBe(true);
			expect(c.evidence.length).toBeGreaterThan(0);
			expect(typeof c.evidence[0].snippet).toBe("string");
			expect(c.evidence[0].snippet.trim().length).toBeGreaterThan(0);
		}

		expect(out.executive_summary_v2).toBeTruthy();
		expect(Array.isArray(out.executive_summary_v2?.paragraphs)).toBe(true);
		expect(out.executive_summary_v2?.paragraphs.length).toBeGreaterThanOrEqual(1);
		expect(out.executive_summary_v2?.paragraphs.length).toBeLessThanOrEqual(2);
		expect(Array.isArray(out.executive_summary_v2?.highlights)).toBe(true);
		expect(out.executive_summary_v2?.highlights.length).toBeGreaterThan(0);
	});

	it("does not hard-reject product/ICP phrasing like 'predict' or 'Engine for …'", () => {
		const { generatePhase1DIOV1 } = require("../phase1-dio-v1");
		const out = generatePhase1DIOV1({
			deal: { deal_id: "webmax", name: "WebMax" },
			inputDocuments: [
				{
					document_id: "doc1",
					title: "WebMax Deck",
					full_text: "WebMax\nWe predict borrower readiness by unifying credit trends and CRM activity.",
				},
			],
			deal_overview_v2: {
				product_solution:
					"We predict borrower readiness by unifying credit trends, income signals, and CRM/LOS activity into an Intent & Ability Score.",
				market_icp: "Engine for Realtors and Loan Officers.",
				raise: "Unknown",
			},
		});

		expect(out.deal_overview_v2?.product_solution).toMatch(/predict borrower readiness/i);
		expect(out.deal_overview_v2?.market_icp).toMatch(/Realtors and Loan Officers/i);
		expect(out.executive_summary_v2?.missing ?? []).not.toContain("product_solution");
		expect(out.executive_summary_v2?.missing ?? []).not.toContain("market_icp");
	});

	it("executive_summary_v2 uses only structured Phase 1 signals (no OCR junk)", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-v2-no-ocr", name: "CleanCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-ocr",
					title: "OCR Junk",
					type: "pitch_deck",
					full_text:
						"THEBESTPARTOFHOCKEY @@@ #### #### \\uFFFD \\uFFFD //// ---- !!!! 1234 9999\n" +
						"%%%%%%%^^^^^^^^^^^^&&&&&&&********(((((((())))))\n",
				},
			],
			deal_overview_v2: {
				deal_name: "CleanCo",
				product_solution: "CleanCo helps operators automate pricing workflows.",
				market_icp: "Mid-market retail operators",
				business_model: "SaaS / subscription",
				raise: "Raising $2M seed",
				traction_signals: ["Revenue mentioned"],
				key_risks_detected: ["Competition"],
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		const text = [
			...(out.executive_summary_v2?.paragraphs ?? []),
			...(out.executive_summary_v2?.highlights ?? []),
		].join("\n");
		expect(text).toMatch(/CleanCo helps operators automate pricing workflows/i);
		expect(text).not.toMatch(/THEBESTPARTOFHOCKEY|@@@@|%%%%%|\uFFFD/i);
	});

	it("executive_summary_v2 fails closed and acknowledges missing overview fields", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-v2-missing", name: "MissingCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-memo",
					title: "Some memo",
					type: "memo",
					full_text: "We are building a platform for operators.",
				},
			],
			// Intentionally no deal_overview_v2 provided
		});

		expect(out.executive_summary_v2).toBeTruthy();
		expect(out.executive_summary_v2?.missing).toContain("product_solution");
		expect(out.executive_summary_v2?.missing).toContain("market_icp");
		const bullets = (out.executive_summary_v2?.highlights ?? []).join("\n");
		expect(bullets).toMatch(/Product: not provided/i);
		expect(bullets).toMatch(/ICP: not provided/i);
	});

	it("builds one_liner from overview only (OCR noise safe) and caps length", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-2", name: "NoiseCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-2",
					title: "NoiseCo OCR",
					type: "pitch_deck",
					full_text:
						"@@@ #### #### \\uFFFD \\uFFFD //// ---- !!!! 1234 9999\n" +
						"We are building a SaaS platform for independent retail brands.\n" +
						"Raising $2M seed to scale go-to-market.\n" +
						"Current revenue: $25k MRR with 40 customers.\n" +
						"#### #### #### #### #### #### #### #### #### #### #### ####\n" +
						"%%%%%%%^^^^^^^^^^^^&&&&&&&********(((((((())))))\\n",
				},
			],
		});

		expect(out.executive_summary_v1.one_liner.length).toBeLessThanOrEqual(300);
		// Should include deterministic overview-derived facts when present
		expect(out.executive_summary_v1.one_liner).toMatch(/business model:\s*saas/i);
		expect(out.executive_summary_v1.one_liner).toMatch(/raise:\s*(raising\s*)?\$?2m/i);
		expect(out.executive_summary_v1.one_liner).toMatch(/traction:/i);
		// Should not leak obvious OCR garbage patterns
		expect(out.executive_summary_v1.one_liner).not.toMatch(/\uFFFD|@@@@|%%%%%|\^\^\^\^\^/);
	});

	it("unknowns includes missing overview fields deterministically", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-3", name: "Barebones", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-3",
					title: "Barebones Note",
					type: "memo",
					full_text: "We are building a platform to solve a workflow problem for operators.",
				},
			],
		});

		// Product-ish wording present
		expect(out.executive_summary_v1.unknowns).not.toContain("product_solution");
		// Raise/traction not present
		expect(out.executive_summary_v1.unknowns).toContain("raise");
		expect(out.executive_summary_v1.unknowns).toContain("traction_signals");
	});

	it("real-estate preferred equity memo: executive_summary_v2 falls back to deterministic product/ICP and recognizes leasing GTM", () => {
		const memoText =
			"Offering Memorandum\n" +
			"We are raising $10M of preferred equity for the acquisition of a value-add multifamily property located in Austin, TX.\n" +
			"Market: Austin MSA with strong job growth and in-migration. Target renters include workforce households.\n" +
			"Business plan includes unit renovations, lease-up, and a leasing strategy to drive occupancy and rent growth.\n" +
			"Underwriting: NOI, cap rate, DSCR, LTV, IRR and equity multiple are provided in the pro forma.";

		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-re-1", name: "Austin Multifamily PrefEq", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-re-1",
					title: "Offering Memo",
					type: "memo",
					full_text: memoText,
				},
			],
			// Simulate upstream structured overview missing key fields
			deal_overview_v2: {
				deal_name: "Austin Multifamily PrefEq",
				deal_type: "startup_raise",
				business_model: "Services",
				raise: "Raising $10M preferred equity",
				// product_solution + market_icp intentionally omitted
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		expect(out.executive_summary_v2).toBeTruthy();
		const bullets = (out.executive_summary_v2?.highlights ?? []).join("\n");
		// Hard validation now fails closed: do not manufacture product/ICP from boilerplate.
		expect(bullets).toMatch(/Product:\s*not provided/i);
		expect(bullets).toMatch(/ICP:\s*not provided/i);
		// Coverage should treat leasing/occupancy strategy as GTM-equivalent for real estate
		expect(out.coverage.sections.gtm).not.toBe("missing");
		expect(out.decision_summary_v1.confidence).toBe("low");
		expect(out.decision_summary_v1.recommendation).not.toBe("GO");
	});

	it("extracts product_solution from pitch deck tagline on page 1", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-4", name: "TaglineCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-4",
					title: "TaglineCo Deck",
					type: "pitch_deck",
					pages: [
						{ page: 1, text: "TaglineCo\nTaglineCo helps independent retail brands automate inventory forecasting." },
						{ page: 2, text: "Problem\nInventory planning is broken for SMB retail." },
						{ page: 3, text: "Solution\nAI-driven demand forecasting and replenishment." },
					],
				},
			],
		});

		expect(out.executive_summary_v1.unknowns).not.toContain("product_solution");
		expect(out.executive_summary_v1.one_liner).toMatch(/taglineco helps independent retail brands automate inventory forecasting\./i);
	});

	it("extracts market_icp from 'Built for …' language in pitch deck", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-5", name: "BuiltForCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-5",
					title: "BuiltForCo Deck",
					type: "pitch_deck",
					pages: [
						{ page: 1, text: "BuiltForCo\nBuilt for independent retail brands and DTC operators" },
						{ page: 2, text: "Who we serve\n• Store operators\n• E-commerce teams" },
					],
				},
			],
		});

		expect(out.executive_summary_v1.unknowns).not.toContain("market_icp");
		expect(out.executive_summary_v1.one_liner).toMatch(/serves:\s*built for independent retail brands and dtc operators\./i);
	});

	it("rejects OCR junk candidates for product_solution and market_icp", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-6", name: "JunkCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-6",
					title: "JunkCo OCR Deck",
					type: "pitch_deck",
					pages: [
						{
							page: 1,
							text:
								"JunkCo\n@@@ #### #### \uFFFD \uFFFD //// ---- !!!! 1234 9999\n" +
								"Rp — - 7\n" +
								"%%%%%%%^^^^^^^^^^^^&&&&&&&********(((((((())))))\n",
						},
						{ page: 2, text: "WHO WE SERVE\n@@@@@ $$$$$ !!!!!" },
					],
				},
			],
		});

		expect(out.executive_summary_v1.unknowns).toContain("product_solution");
		expect(out.executive_summary_v1.unknowns).toContain("market_icp");
		expect(out.executive_summary_v1.one_liner).not.toMatch(/serves:\s*/i);
		expect(out.executive_summary_v1.one_liner).not.toMatch(/product:\s*/i);
	});

	it("rejects OCR-garbage claim evidence snippets (executive_summary_v1.evidence[0].snippet)", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-snippet-junk", name: "JunkSnipCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-snippet-junk",
					title: "JunkSnipCo Deck",
					type: "pitch_deck",
					pages: [
						{
							page: 1,
							text:
								"THEBESTPARTOFHOCKEY @@@ #### ####   //// ---- !!!! 1234 9999\n" +
								"%%%%%%%^^^^^^^^^^^^&&&&&&&********(((((((())))))\n" +
								"| | | | | | | | | | | | | |",
						},
						{ page: 2, text: "@@@@ ####  " },
						{ page: 3, text: "%%%%% ^^^^^ &&&&&" },
					],
				},
			],
		});

		expect(Array.isArray(out.executive_summary_v1.evidence)).toBe(true);
		expect(out.executive_summary_v1.evidence.length).toBeGreaterThan(0);
		const snippet0 = out.executive_summary_v1.evidence[0].snippet ?? "";
		expect(snippet0).toBeTruthy();
		// Should not accept the OCR garbage.
		expect(snippet0).not.toMatch(/THEBESTPARTOFHOCKEY/i);
		expect(snippet0).not.toMatch(/@@@@|%%%%%|\uFFFD/);
		// Deterministic safe fallback if nothing passes.
		expect(snippet0).toMatch(/^See document:/i);
	});

	it("accepts ALL CAPS tagline snippets when verb-like patterns are present", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-snippet-caps", name: "CapsCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-snippet-caps",
					title: "CapsCo Deck",
					type: "pitch_deck",
					pages: [
						{ page: 1, text: "CAPSCO\nTHE PLATFORM THAT HELPS TEAMS AUTOMATE WORKFLOWS" },
					],
				},
			],
		});

		const snippet0 = out.executive_summary_v1.evidence[0].snippet ?? "";
		expect(snippet0).toMatch(/THE PLATFORM THAT HELPS/i);
	});

	it("rejects roster/team list snippets for evidence", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-snippet-roster", name: "RosterCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-snippet-roster",
					title: "RosterCo Deck",
					type: "pitch_deck",
					pages: [
						{ page: 1, text: "OUR ON-AIR TALENT TEAM\nALICE, BOB, CAROL, DAVE" },
					],
				},
			],
		});

		const snippet0 = out.executive_summary_v1.evidence[0].snippet ?? "";
		expect(snippet0).toMatch(/^See document:/i);
		expect(snippet0).not.toMatch(/ON-AIR|TALENT TEAM/i);
	});

	it("rejects_industry_revenue_as_traction", () => {
		// 1) Industry/macro commentary should NOT count as company traction.
		const macro = generatePhase1DIOV1({
			deal: { deal_id: "deal-traction-macro", name: "Dropables", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-traction-macro",
					title: "Dropables Pitch Deck",
					type: "pitch_deck",
					full_text:
						"Global music revenue grew to $10B as streaming platforms command the majority of revenue.",
				},
			],
		});
		expect(macro.executive_summary_v1.traction_signals).not.toContain("Revenue mentioned");
		expect(macro.executive_summary_v1.traction_signals).not.toContain("Growth mentioned");
		expect(macro.executive_summary_v1.traction_signals).not.toContain("ARR mentioned");

		// 2) Company-owned revenue statement SHOULD count.
		const ownedRevenue = generatePhase1DIOV1({
			deal: { deal_id: "deal-traction-owned", name: "Acme", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-traction-owned",
					title: "Acme Deck",
					type: "pitch_deck",
					full_text: "We generated $2M in revenue in 2025.",
				},
			],
		});
		expect(ownedRevenue.executive_summary_v1.traction_signals).toContain("Revenue mentioned");

		// 3) ARR mention without ownership/metrics should be rejected.
		const arrNoContext = generatePhase1DIOV1({
			deal: { deal_id: "deal-traction-arr-no-context", name: "NoContextCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-traction-arr-no-context",
					title: "NoContextCo Deck",
					type: "pitch_deck",
					full_text: "ARR is important in this market.",
				},
			],
		});
		expect(arrNoContext.executive_summary_v1.traction_signals).not.toContain("ARR mentioned");

		// 4) ARR mention with ownership OR numeric should pass.
		const arrWithContext = generatePhase1DIOV1({
			deal: { deal_id: "deal-traction-arr-context", name: "ContextCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-traction-arr-context",
					title: "ContextCo Deck",
					type: "pitch_deck",
					full_text: "Our ARR is $500k annually.",
				},
			],
		});
		expect(arrWithContext.executive_summary_v1.traction_signals).toContain("ARR mentioned");
	});

	it("Dropables: score penalizes missing ICP", () => {
		const withICP = generatePhase1DIOV1({
			deal: { deal_id: "deal-dropables-with-icp", name: "Dropables", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-dropables-with-icp",
					title: "Dropables Pitch Deck",
					type: "pitch_deck",
					full_text:
						"Dropables helps musicians sell digital collectibles to fans. " +
						"Go-to-market: partnerships and direct sales. " +
						"Team: founders previously built and operated creator platforms. " +
						"We generated $2M in revenue in 2025. " +
						"Raising $1.5M seed.",
				},
			],
			deal_overview_v2: {
				deal_name: "Dropables",
				product_solution: "Dropables helps musicians sell digital collectibles to fans.",
				market_icp: "Built for independent musicians and superfans.",
				deal_type: "startup_raise",
				raise: "Raising $1.5M seed",
				business_model: "Unknown",
				traction_signals: [],
				key_risks_detected: [],
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		const missingICP = generatePhase1DIOV1({
			deal: { deal_id: "deal-dropables-missing-icp", name: "Dropables", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-dropables-missing-icp",
					title: "Dropables Pitch Deck",
					type: "pitch_deck",
					full_text:
						"Dropables helps musicians sell digital collectibles to fans. " +
						"Go-to-market: partnerships and direct sales. " +
						"Team: founders previously built and operated creator platforms. " +
						"We generated $2M in revenue in 2025. " +
						"Raising $1.5M seed.",
				},
			],
			deal_overview_v2: {
				deal_name: "Dropables",
				product_solution: "Dropables helps musicians sell digital collectibles to fans.",
				market_icp: null,
				deal_type: "startup_raise",
				raise: "Raising $1.5M seed",
				business_model: "Unknown",
				traction_signals: [],
				key_risks_detected: [],
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		expect(withICP.coverage.sections.market_icp).toBe("present");
		expect(missingICP.coverage.sections.market_icp).toBe("missing");
		expect(withICP.decision_summary_v1.score - missingICP.decision_summary_v1.score).toBeGreaterThanOrEqual(10);
	});

	it("caps confidence to med when product_solution is missing (even if coverage would be high)", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-conf-cap-1", name: "NoProductCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-conf-cap-1",
					title: "NoProductCo Deck",
					type: "pitch_deck",
					full_text:
						"Target customers: mid-market retail operators. Go-to-market: channel partnerships and direct sales. " +
						"Team: founders previously led growth at Shopify. We generated $2M in revenue in 2025 with 40 customers. " +
						"Raising $1.5M seed.",
				},
			],
		});

		expect(out.coverage.sections.product_solution).toBe("missing");
		expect(out.coverage.sections.gtm).toBe("present");
		// Hard rule: if product_solution OR ICP is empty after arbitration, confidence must be low and not GO.
		expect(out.executive_summary_v1.confidence.overall).toBe("low");
		expect(out.decision_summary_v1.confidence).toBe("low");
		expect(out.decision_summary_v1.recommendation).not.toBe("GO");
		expect(out.executive_summary_v2?.signals.confidence).toBe("low");
	});

	it("forces confidence to low when product_solution and gtm are both missing", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-conf-cap-2", name: "NoCoreCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-conf-cap-2",
					title: "NoCoreCo Memo",
					type: "memo",
					full_text:
						"Target customers: mid-market retail operators. Team: founders previously led operations at Amazon. " +
						"We generated $2M in revenue in 2025 with 40 customers. Raising $1.5M seed.",
				},
			],
		});

		expect(out.coverage.sections.product_solution).toBe("missing");
		expect(out.coverage.sections.gtm).toBe("missing");
		// Force: 2+ of {product_solution, gtm, traction} missing => low.
		expect(out.executive_summary_v1.confidence.overall).toBe("low");
		expect(out.decision_summary_v1.confidence).toBe("low");
		expect(out.decision_summary_v1.recommendation).not.toBe("GO");
		expect(out.executive_summary_v2?.signals.confidence).toBe("low");
	});

	it("arbitrates deal truth to prevent sports/media contamination from real-asset phrases", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-arb-1", name: "3ICE", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-arb-1",
					title: "3ICE League Deck",
					type: "pitch_deck",
					full_text:
						"3ICE is a professional hockey league with teams, athletes, and broadcast distribution. " +
						"We monetize via media rights and streaming partnerships. " +
						"(Legal boilerplate) This is not an offering memorandum for preferred equity in any hotel or property.",
				},
			],
			deal_overview_v2: {
				deal_name: "3ICE",
				deal_type: "real_estate_preferred_equity",
				product_solution: "3ICE operates a professional hockey league and broadcasts games to fans.",
				market_icp: "Sports fans and media partners",
				business_model: "SaaS / subscription",
				raise: "Raising $5M",
				traction_signals: [],
				key_risks_detected: [],
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		expect(out.executive_summary_v1.deal_type).toBe("startup_raise");
		// Truth wiring: executive summary and overview must agree.
		expect(out.deal_overview_v2?.deal_type).toBe("startup_raise");
		expect(out.executive_summary_v1.deal_type).toBe(out.deal_overview_v2?.deal_type);
		expect(out.executive_summary_v1.business_model).not.toMatch(/saas|subscription/i);
		expect(out.deal_overview_v2?.business_model ?? "").not.toMatch(/saas|subscription/i);
		expect(out.executive_summary_v1.one_liner).not.toMatch(/preferred\s+equity|hotel|property|offering\s+memorandum/i);
		const v2Text = [
			...(out.executive_summary_v2?.paragraphs ?? []),
			...(out.executive_summary_v2?.highlights ?? []),
		].join("\n");
		expect(v2Text).not.toMatch(/preferred\s+equity|hotel|property|offering\s+memorandum/i);

		// Clamp regression: if product_solution or market_icp are missing post-validation,
		// confidence must be low and recommendation cannot be GO.
		const outMissingCore = generatePhase1DIOV1({
			deal: { deal_id: "deal-arb-1-missing-core", name: "3ICE", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-arb-1-missing-core",
					title: "3ICE League Deck",
					type: "pitch_deck",
					full_text:
						"3ICE is a professional hockey league with teams, athletes, and broadcast distribution. " +
						"We monetize via media rights and streaming partnerships. " +
						"(Legal boilerplate) This is not an offering memorandum for preferred equity in any hotel or property.",
				},
			],
			deal_overview_v2: {
				deal_name: "3ICE",
				deal_type: "real_estate_preferred_equity",
				product_solution: null,
				market_icp: null,
				business_model: "SaaS / subscription",
				raise: "Raising $5M",
				traction_signals: [],
				key_risks_detected: [],
				generated_at: "2025-01-01T00:00:00.000Z",
			},
		});

		expect(outMissingCore.executive_summary_v1.deal_type).toBe("startup_raise");
		expect(outMissingCore.deal_overview_v2?.deal_type).toBe("startup_raise");
		expect(outMissingCore.executive_summary_v1.deal_type).toBe(outMissingCore.deal_overview_v2?.deal_type);
		expect(outMissingCore.executive_summary_v1.business_model).not.toMatch(/saas|subscription/i);
		expect(outMissingCore.deal_overview_v2?.business_model ?? "").not.toMatch(/saas|subscription/i);
		// Score must reflect missing fundamentals (post-processed truth), not remain inflated.
		expect(outMissingCore.decision_summary_v1.score).toBeLessThanOrEqual(out.decision_summary_v1.score - 20);
		expect(outMissingCore.executive_summary_v1.confidence.overall).toBe("low");
		expect(outMissingCore.decision_summary_v1.confidence).toBe("low");
		expect(outMissingCore.decision_summary_v1.recommendation).not.toBe("GO");
		expect(outMissingCore.executive_summary_v2?.signals.confidence).toBe("low");
		expect(outMissingCore.deal_overview_v2?.product_solution).toBeNull();
		expect(outMissingCore.deal_overview_v2?.market_icp).toBeNull();
		const v2TextMissingCore = [
			...(outMissingCore.executive_summary_v2?.paragraphs ?? []),
			...(outMissingCore.executive_summary_v2?.highlights ?? []),
		].join("\n");
		expect(v2TextMissingCore).not.toMatch(/preferred\s+equity|hotel|property|offering\s+memorandum/i);
	});

	it("normalizes Phase 1 overview synonyms into canonical fields (prevents 'Product: not provided')", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-synonyms", name: "SynonymCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-synonyms",
					title: "SynonymCo Deck",
					type: "pitch_deck",
					full_text: "SynonymCo helps retailers automate inventory workflows. Built for mid-market retailers. Raising $2M on a SAFE.",
				},
			],
			// Note: canonical keys intentionally omitted; synonyms provided instead.
			deal_overview_v2: {
				deal_name: "SynonymCo",
				product: "SynonymCo helps retailers automate inventory workflows.",
				icp: "Built for mid-market retailers.",
				terms: "Raising $2M on a SAFE",
			},
		});

		expect(out.deal_overview_v2).toBeTruthy();
		expect(out.deal_overview_v2?.product_solution).toMatch(/helps\s+retailers/i);
		expect(out.deal_overview_v2?.market_icp).toMatch(/mid-market\s+retailers/i);
		expect((out.deal_overview_v2 as any)?.raise_terms).toMatch(/\$2M/i);

		// Executive summary should not claim product/ICP missing if synonyms were present.
		expect(out.executive_summary_v2?.missing ?? []).not.toContain("product_solution");
		expect(out.executive_summary_v2?.missing ?? []).not.toContain("market_icp");
	});

	it("ExecutiveSummaryV2 uses canonical-first then synonym fallbacks for product/ICP/terms", () => {
		const { composeExecutiveSummaryV2 } = require("../phase1-dio-v1");
		const out = composeExecutiveSummaryV2({
			deal: { name: "TestCo" },
			overview_v2: {
				// Canonical fields intentionally missing
				product: "A workflow tool for operators",
				icp: "Mid-market logistics teams",
				terms: "$2M seed",
			},
			coverage: { sections: { documents: "present" } },
			decision_summary_v1: {
				score: 55,
				recommendation: "CONSIDER",
				reasons: [],
				blockers: [],
				next_requests: [],
				confidence: "low",
			},
		});

		expect(out.highlights.join("\n")).toMatch(/Product:\s+A workflow tool for operators/i);
		expect(out.highlights.join("\n")).toMatch(/ICP:\s+Mid-market logistics teams/i);
		expect(out.highlights.join("\n")).toMatch(/Raise\/terms:\s+\$2M seed/i);
		expect(out.highlights.join("\n")).not.toMatch(/not provided in Phase 1 overview/i);
	});

    it("mergePhase1IntoDIO preserves extra dio.phase1 fields (deal_overview_v2/update_report_v1)", () => {
        const existing = {
            dio: {
            phase1: {
				business_archetype_v1: { value: "services", confidence: 0.8 },
                deal_overview_v2: { product_solution: "X", market_icp: "Y" },
                update_report_v1: { summary: "changed" },
                executive_summary_v1: { one_liner: "old" },
            },
            },
        };

        const phase1 = generatePhase1DIOV1({
            deal: { deal_id: "deal-merge", name: "MergeCo", stage: "intake" },
            inputDocuments: [
            {
                document_id: "doc-merge",
                title: "MergeCo Deck",
                type: "pitch_deck",
                full_text: "We are building a SaaS platform. Raising $1M seed. ARR $100k.",
            },
            ],
        });

        const out = mergePhase1IntoDIO(existing, phase1);

        // preserved
		expect(out.dio.phase1.business_archetype_v1).toBeTruthy();
        expect(out.dio.phase1.deal_overview_v2).toBeTruthy();
        expect(out.dio.phase1.update_report_v1).toBeTruthy();

		// overwritten by deterministic phase1
        expect(out.dio.phase1.executive_summary_v1).toBeTruthy();
        expect(out.dio.phase1.executive_summary_v1.one_liner).not.toEqual("old");
		expect(out.dio.phase1.executive_summary_v2).toBeTruthy();
        });

	it("mergePhase1IntoDIO persists update_report_v1 from phase1 when provided", () => {
		const existing = {
			dio: {
				phase1: {
					executive_summary_v1: { one_liner: "old" },
				},
			},
		};

		const phase1 = generatePhase1DIOV1({
			deal: { deal_id: "deal-merge-report", name: "MergeReportCo", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-merge-report",
					title: "MergeReportCo Deck",
					type: "pitch_deck",
					full_text: "We are building a SaaS platform. Raising $1M seed.",
				},
			],
			update_report_v1: {
				generated_at: new Date("2025-01-01T00:00:00.000Z").toISOString(),
				previous_dio_found: true,
				summary: "No changes detected.",
				changes: [],
			},
		});

		const out = mergePhase1IntoDIO(existing, phase1);
		expect(out.dio.phase1.update_report_v1).toBeTruthy();
		expect(out.dio.phase1.update_report_v1.summary).toEqual("No changes detected.");
		expect(out.dio.phase1.update_report_v1.changes).toEqual([]);
	});

	it("can fall back to update_report_v1.after values when deal_overview_v2 omits product/ICP", () => {
		const { generatePhase1DIOV1 } = require("../phase1-dio-v1");
		const out = generatePhase1DIOV1({
			deal: { deal_id: "webmax", name: "WebMax" },
			inputDocuments: [
				{
					document_id: "doc1",
					title: "WebMax Deck",
					full_text: "(intentionally sparse)",
				},
			],
			deal_overview_v2: {
				product_solution: null,
				market_icp: null,
			},
			update_report_v1: {
				generated_at: new Date().toISOString(),
				changes: [
					{
						field: "deal_overview_v2.product_solution",
						change_type: "added",
						after: "We predict borrower readiness by unifying credit trends and CRM/LOS activity.",
					},
					{
						field: "deal_overview_v2.market_icp",
						change_type: "added",
						after: "Engine for Realtors and Loan Officers.",
					},
				],
			},
		});

		expect(out.deal_overview_v2?.product_solution).toMatch(/predict borrower readiness/i);
		expect(out.deal_overview_v2?.market_icp).toMatch(/Realtors and Loan Officers/i);
	});
});

