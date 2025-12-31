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
});

