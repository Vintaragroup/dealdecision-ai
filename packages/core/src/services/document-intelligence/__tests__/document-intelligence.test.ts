import { __test__, DocumentIntelligenceService } from "../document-intelligence";

type QueryResult = { rows?: any[]; rowCount?: number };

describe("DocumentIntelligence v1 determinism", () => {
	test("buildEvidenceItemsForBlocks is deterministic (stable IDs + stable ordering)", () => {
		const blocks = [
			{
				source_path: "doc:doc1:para:0",
				page_index: null,
				title: "Traction",
				text: "We hit $50k MRR in Jan 2025. Contact: founder@example.com. Learn more at www.example.com",
			},
			{
				source_path: "doc:doc1:para:1",
				page_index: null,
				title: "Raise",
				text: "Raising $2.5M at a $20M pre-money valuation.",
			},
		];

		const a = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: "Pitch Deck",
			doc_type: "pitch_deck",
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks,
		});

		const b = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: "Pitch Deck",
			doc_type: "pitch_deck",
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [...blocks].reverse(),
		});

		expect(a.items).toEqual(b.items);
		expect(a.summary).toEqual(b.summary);

		// Spot-check: evidence ids are stable and look like repo-style ids.
		for (const it of a.items) {
			expect(it.evidence_id.startsWith("ev_")).toBe(true);
			expect(it.evidence_id.length).toBeGreaterThan(10);
		}
	});

	test("summary counts are deterministic and include key categories", () => {
		const { summary } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: "Pitch Deck",
			doc_type: "pitch_deck",
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: null,
					title: "Team",
					text: "Email us at team@example.com",
				},
				{
					source_path: "doc:doc1:para:1",
					page_index: null,
					title: "Financials",
					text: "ARR is $1.2M; CAC is $120; LTV is $2400",
				},
			],
		});

		expect(summary.evidence_total).toBeGreaterThan(0);
		expect(summary.by_signal_category).toHaveProperty("functional_section");
		expect(summary.by_signal_category).toHaveProperty("entity");
		expect(summary.by_signal_category).toHaveProperty("metric");
	});

	// ── RC-001: SEC filing classifier ──────────────────────────────────────
	test("RC-001: detects FORM S-1 and emits sec_filing_s1 doc_type hint", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 0,
					title: null,
					text: "FORM S-1 REGISTRATION STATEMENT UNDER THE SECURITIES ACT OF 1933",
				},
			],
		});

		const hintItems = items.filter((i) => i.tags.includes("doc_type:sec_filing_s1"));
		expect(hintItems.length).toBeGreaterThanOrEqual(1);
		expect(hintItems[0]!.confidence).toBeGreaterThanOrEqual(0.9);
	});

	test("RC-001: detects FORM 10-K and emits sec_filing_10k doc_type hint", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 0,
					title: null,
					text: "ANNUAL REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT OF 1934 FORM 10-K",
				},
			],
		});

		const hintItems = items.filter((i) => i.tags.includes("doc_type:sec_filing_10k"));
		expect(hintItems.length).toBeGreaterThanOrEqual(1);
	});

	test("RC-001: detects FORM 10-Q and emits sec_filing_10q doc_type hint", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 0,
					title: null,
					text: "QUARTERLY REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT OF 1934",
				},
			],
		});

		const hintItems = items.filter((i) => i.tags.includes("doc_type:sec_filing_10q"));
		expect(hintItems.length).toBeGreaterThanOrEqual(1);
	});

	test("RC-001: regular pitch deck does NOT emit SEC filing hints", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: "Company Pitch Deck",
			doc_type: "pitch_deck",
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 0,
					title: "Traction",
					text: "ARR $1.2M",
				},
			],
		});

		const secItems = items.filter((i) =>
			i.tags.some((t) => t.startsWith("doc_type:sec_filing"))
		);
		expect(secItems.length).toBe(0);
	});

	// ── RC-002: Going concern detection ────────────────────────────────────
	test("RC-002: detects 'substantial doubt ... going concern' and emits risk:going_concern evidence", () => {
		const { items, summary } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 5,
					title: null,
					text: "The Company has incurred losses since inception. These conditions raise substantial doubt about the Company's ability to continue as a going concern.",
				},
			],
		});

		const gcItems = items.filter((i) => i.tags.includes("risk:going_concern"));
		expect(gcItems.length).toBe(1);
		expect(gcItems[0]!.confidence).toBeGreaterThanOrEqual(0.9);
		expect(summary.by_signal_category).toHaveProperty("going_concern_signal");
	});

	test("RC-002: 'going concern' variant phrase detected", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 3,
					title: null,
					text: "Management has concluded there is substantial doubt about the entity's going concern status.",
				},
			],
		});

		const gcItems = items.filter((i) => i.tags.includes("risk:going_concern"));
		expect(gcItems.length).toBe(1);
	});

	test("RC-002: normal financials without going concern language emit no risk:going_concern", () => {
		const { items } = __test__.buildEvidenceItemsForBlocks({
			deal_id: "deal1",
			document_id: "doc1",
			doc_title: null,
			doc_type: null,
			extracted_at: "2026-01-01T00:00:00.000Z",
			blocks: [
				{
					source_path: "doc:doc1:para:0",
					page_index: 0,
					title: "Financials",
					text: "Revenue was $1.2M in FY2024. Cash position is strong at $5M.",
				},
			],
		});

		const gcItems = items.filter((i) => i.tags.includes("risk:going_concern"));
		expect(gcItems.length).toBe(0);
	});
});

describe("DocumentIntelligenceService evidence provenance wiring", () => {
	test("includes run_id and step_run_id in evidence_items insert when columns exist", async () => {
		const captured: { inserts: string[] } = { inserts: [] };

		const pool = {
			query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
				// Evidence shape detection
				if (sql.includes("information_schema.columns") && sql.includes("table_name = 'evidence_items'")) {
					return {
						rows: [
							{ column_name: "evidence_id" },
							{ column_name: "run_id" },
							{ column_name: "step_run_id" },
						],
						rowCount: 3,
					};
				}
				if (sql.includes("pg_trigger") && sql.includes("trg_evidence_items_set_updated_at")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}

				// Schema drift checks
				if (sql.includes("information_schema.columns") && sql.includes("table_name = $1") && sql.includes("column_name = $2")) {
					return { rows: [], rowCount: 0 };
				}
				if (sql.includes("SELECT to_regclass")) {
					return { rows: [{ oid: null }], rowCount: 1 };
				}

				// Load document
				if (sql.includes("FROM documents") && sql.includes("WHERE id = $1") && sql.includes("deal_id = $2")) {
					return {
						rows: [
							{
								id: "doc1",
								deal_id: "deal1",
								title: "Pitch Deck",
								type: "pitch_deck",
								full_text: "Overview\nWe are raising $1M. Contact founder@example.com",
								uploaded_at: "2026-01-01T00:00:00.000Z",
							},
						],
						rowCount: 1,
					};
				}

				// Evidence table availability probe
				if (sql.includes("SELECT 1 FROM evidence_items")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}

				// Insert
				if (sql.startsWith("INSERT INTO evidence_items")) {
					captured.inserts.push(sql);
					return { rows: [{ inserted: true }], rowCount: 1 };
				}

				return { rows: [], rowCount: 0 };
			},
		} as any;

		const svc = new DocumentIntelligenceService(pool);
		const out = await svc.extractSignals({
			deal_id: "deal1",
			document_id: "doc1",
			run_id: "run-123",
			step_run_id: "step-456",
		});

		expect(out.ok).toBe(true);
		expect(captured.inserts.length).toBeGreaterThan(0);
		const insertSql = captured.inserts[0]!;
		expect(insertSql).toContain("run_id");
		expect(insertSql).toContain("step_run_id");
	});
});
