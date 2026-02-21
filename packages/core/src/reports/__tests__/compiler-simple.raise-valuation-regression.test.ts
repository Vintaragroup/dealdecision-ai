import { compileDIOToReportWithPromotedFacts } from "../compiler-simple";

describe("compileDIOToReportWithPromotedFacts raise regression (valuation must not leak into raise)", () => {
	it("uses $2M ask for raise and cites ask slide (not $200M valuation)", () => {
		const now = new Date().toISOString();

		const dio: any = {
			schema_version: "1.0.0",
			dio_id: "00000000-0000-4000-8000-000000009911",
			deal_id: "00000000-0000-4000-8000-000000009912",
			created_at: now,
			updated_at: now,
			analysis_version: 1,
			dio_context: { primary_doc_type: "pitch_deck" },
			inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
			analyzer_results: {},
			dio: { phase1: {} },
		};

		const promotedFacts: any[] = [
			{
				fact_type: "raise_terms_v1",
				confidence: 0.9,
				extracted_at: now,
				evidence_id: "deal:00000000-0000-4000-8000-000000009912:fact:raise_terms_v1",
				content_json: {
					fact_type: "raise_terms_v1",
					value_json: {
						display: "The Ask: Raising $2M",
						raw_text: "The Ask: Raising $2M",
						amount: { amount: 2000000 },
					},
					provenance: {
						source_document_id: "doc-1",
						page_index: 0,
						slide_title: "The Ask: Raising $2M",
					},
				},
				meta: { document_id: "doc-1", page_index: 0 },
			},
			{
				fact_type: "valuation_v1",
				confidence: 0.9,
				extracted_at: now,
				content_json: {
					fact_type: "valuation_v1",
					value_json: {
						display: "$200M post-money valuation",
						raw_text: "$200M post-money valuation",
						amount: { amount: 200000000 },
						valuation_type: "post_money",
					},
					provenance: {
						source_document_id: "doc-1",
						page_index: 1,
						slide_title: "$200M post-money valuation",
					},
				},
				meta: { document_id: "doc-1", page_index: 1 },
			},
		];

		const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });
		expect(report.structured_summary).toBeTruthy();
		const raise = report.structured_summary!.raise;
		expect(raise.value).toBeTruthy();
		expect(String(raise.value)).toContain("$2");

		// Ensure valuation does not appear anywhere in raise fields.
		const raiseJson = JSON.stringify(raise);
		expect(raiseJson).not.toContain("$200M");
		expect(raiseJson).not.toMatch(/\b200\s*m\b/i);
		expect(raiseJson).not.toMatch(/post-?money/i);
		expect(raiseJson).not.toMatch(/\bvaluation\b/i);

		// Citation must point to the ask slide (page_index 0 / page 1).
		expect(Array.isArray(raise.sources)).toBe(true);
		expect(raise.sources.length).toBeGreaterThan(0);
		const primary = raise.sources[0] as any;
		expect(primary.source_document_id).toBe("doc-1");
		expect(primary.page_index).toBe(0);
		expect(primary.page).toBe(1);
		expect(primary.source_path).toBe("doc:doc-1:page:1");
		expect(String(primary.slide_title ?? "")).toMatch(/ask/i);
	});
});
