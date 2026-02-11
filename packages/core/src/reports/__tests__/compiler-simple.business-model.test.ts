import { compileDIOToReportWithPromotedFacts } from "../compiler-simple";

describe("compileDIOToReportWithPromotedFacts business model", () => {
	it("prefers promoted DTC + Wholesale over Phase 1 Licensing", () => {
		const now = new Date().toISOString();
		const dio: any = {
			schema_version: "1.0.0",
			dio_id: "00000000-0000-4000-8000-000000000501",
			deal_id: "00000000-0000-4000-8000-000000000502",
			created_at: now,
			updated_at: now,
			analysis_version: 1,
			dio_context: { primary_doc_type: "pitch_deck" },
			inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
			analyzer_results: {
				slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
				metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0, metrics_analyzed: [] },
				visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
				narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
				financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0, risks: [], evidence_ids: [] },
				risk_assessment: {
					analyzer_version: "1.0.0",
					executed_at: now,
					status: "insufficient_data",
					coverage: 0,
					confidence: 0,
					overall_risk_score: null,
					total_risks: 0,
					critical_count: 0,
					high_count: 0,
					risks_by_category: { market: [], team: [], financial: [], execution: [] },
					evidence_ids: [],
				},
			},
			dio: {
				phase1: {
					deal_overview_v2: { business_model: "Licensing", sources: [{ document_id: "doc-1", page: 3 }] },
					executive_summary_v1: { business_model: "Licensing", evidence: [{ document_id: "doc-1", page: 3 }] },
				},
			},
		};

		const promotedFacts: any[] = [
			{
				source_type: "business_model_fact",
				fact_type: "business_model_v1",
				confidence: 0.9,
				extracted_at: now,
				source_path: "doc:doc-2:page:5",
				source_document_id: "doc-2",
				evidence_id: "deal:00000000-0000-4000-8000-000000000502:fact:business_model_v1",
				content_json: {
					fact_type: "business_model_v1",
					value_json: { display: "Omnichannel (DTC + Wholesale/Retail)", secondary_tags: ["Licensing"] },
					provenance: { page_index: 14, slide_title: "Go to Market" },
				},
			},
		];

		const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });
		expect(report.structured_summary?.business_model?.value).toBe("Omnichannel (DTC + Wholesale/Retail)");
		expect(report.structured_summary?.business_model?.value).not.toBe("Licensing");
		// Sources should carry through provenance for UI citations.
		expect((report.structured_summary?.business_model?.sources?.[0] as any)?.page_index).toBe(14);
		expect((report.structured_summary?.business_model?.sources?.[0] as any)?.page).toBe(15);
	});

	it("nulls business_model when no primary source exists", () => {
		const now = new Date().toISOString();
		const dio: any = {
			schema_version: "1.0.0",
			dio_id: "00000000-0000-4000-8000-000000000601",
			deal_id: "00000000-0000-4000-8000-000000000602",
			created_at: now,
			updated_at: now,
			analysis_version: 1,
			dio_context: { primary_doc_type: "pitch_deck" },
			inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
			analyzer_results: {},
			dio: { phase1: { executive_summary_v1: { business_model: "Licensing", evidence: [] } } },
		};

		const promotedFacts: any[] = [
			{
				source_type: "promoted_slide_fact",
				fact_type: "business_model_v1",
				confidence: 0.9,
				extracted_at: now,
				// Intentionally no source_document_id, no meta, and no provenance
				content_json: {
					fact_type: "business_model_v1",
					value_json: { display: "Omnichannel (DTC + Wholesale/Retail)" },
				},
			},
		];

		const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });
		expect(report.structured_summary?.business_model?.value).toBeNull();
		expect(report.structured_summary?.business_model?.confidence).toBe(0);
		expect(report.structured_summary?.business_model?.sources ?? []).toHaveLength(0);
	});

	it("prefers Phase 1 business model arbitration over promoted facts", () => {
		const now = new Date().toISOString();
		const dio: any = {
			schema_version: "1.0.0",
			dio_id: "00000000-0000-4000-8000-000000000701",
			deal_id: "00000000-0000-4000-8000-000000000702",
			created_at: now,
			updated_at: now,
			analysis_version: 1,
			dio_context: { primary_doc_type: "pitch_deck" },
			inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
			analyzer_results: {},
			dio: {
				phase1: {
					business_model_arbitration_v1: {
						business_model: "saas",
						confidence: 0.81,
						evidence: [
							{ model: "saas", kind: "subscription_signals", weight: 0.9, detail: "MRR/ARR mentioned", source: "phase1" },
						],
					},
					deal_overview_v2: { business_model: "Real estate investment", sources: [{ document_id: "doc-1", page: 3 }] },
				},
			},
		};

		const promotedFacts: any[] = [
			{
				source_type: "business_model_fact",
				fact_type: "business_model_v1",
				confidence: 0.9,
				extracted_at: now,
				source_document_id: "doc-2",
				content_json: {
					fact_type: "business_model_v1",
					value_json: { display: "Omnichannel (DTC + Wholesale/Retail)" },
					provenance: { page_index: 9, slide_title: "Business Model" },
				},
			},
		];

		const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });
		expect(report.structured_summary?.business_model?.value).toBe("saas");
		expect(report.structured_summary?.business_model?.label).toBe("Arbitrated");
		expect(report.structured_summary?.business_model?.confidence).toBeCloseTo(0.81);
		expect((report.structured_summary?.business_model?.sources?.[0] as any)?.kind).toBe("phase1.business_model_arbitration_v1");
	});
});
