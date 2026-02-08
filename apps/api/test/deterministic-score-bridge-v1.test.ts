process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";

const now = new Date().toISOString();

function dioWithOkScores(dealId: string, version: number): any {
	return {
		schema_version: "1.0.0",
		dio_id: "00000000-0000-4000-8000-00000000b001",
		deal_id: dealId,
		created_at: now,
		updated_at: now,
		analysis_version: version,
		inputs: {
			documents: [],
			evidence: [],
			config: {
				analyzer_versions: {
					slide_sequence: "1.0.0",
					metric_benchmark: "1.0.0",
					visual_design: "1.0.0",
					narrative_arc: "1.0.0",
					financial_health: "1.0.0",
					risk_assessment: "1.0.0",
				},
				features: {
					tavily_enabled: false,
					mcp_enabled: false,
					llm_synthesis_enabled: false,
					debug_scoring: false,
				},
				parameters: {
					max_cycles: 3,
					depth_threshold: 2,
					min_confidence: 0.7,
				},
			},
		},
		analyzer_results: {
			slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, score: 80, pattern_match: "OK", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
			metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, overall_score: 80, metrics_analyzed: [{ metric: "ARR", value: "$1M" }], evidence_ids: [] },
			visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, design_score: 80, proxy_signals: {}, strengths: [], weaknesses: [], evidence_ids: [] },
			narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, pacing_score: 80, archetype: "", archetype_confidence: 0, emotional_beats: [], evidence_ids: [] },
			financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, runway_months: null, burn_multiple: null, health_score: 80, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
			risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.1, confidence: 0.8, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
		},
		planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
		fact_table: [],
		ledger_manifest: { cycles: 0, depth_delta: [], subgoals: 0, constraints: 0, dead_ends: 0, paraphrase_invariance: 0, calibration: { brier: 0 }, total_facts_added: 0, total_evidence_cited: 0, uncertain_claims: 0 },
		risk_map: [],
		decision: { recommendation: "CONDITIONAL", confidence: 0.5, tranche_plan: { t0_amount: null, milestones: [] }, verification_checklist: [], key_strengths: [], key_weaknesses: [], evidence_ids: [] },
		narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
		execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
	};
}

function dioWithTunedBaseline(args: {
	dealId: string;
	version: number;
	financialHealthScore: number | null;
	riskOverallScore: number | null;
	coverage: number;
}): any {
	const dio = dioWithOkScores(args.dealId, args.version);
	// Ensure score-bearing components can be controlled deterministically.
	if (!dio.analyzer_results) dio.analyzer_results = {};
	if (!dio.analyzer_results.financial_health) dio.analyzer_results.financial_health = { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: args.coverage, confidence: 0.8, runway_months: null, burn_multiple: null, health_score: 80, metrics: {}, risks: [], evidence_ids: [] };
	if (!dio.analyzer_results.risk_assessment) dio.analyzer_results.risk_assessment = { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: args.coverage, confidence: 0.8, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] };

	// If a score is null, delete the field to simulate missing numeric output.
	if (args.financialHealthScore === null) delete dio.analyzer_results.financial_health.health_score;
	else dio.analyzer_results.financial_health.health_score = args.financialHealthScore;

	if (args.riskOverallScore === null) delete dio.analyzer_results.risk_assessment.overall_risk_score;
	else dio.analyzer_results.risk_assessment.overall_risk_score = args.riskOverallScore;

	// Keep coverage controllable.
	dio.analyzer_results.financial_health.coverage = args.coverage;
	dio.analyzer_results.risk_assessment.coverage = args.coverage;

	return dio;
}

function dioWithAllAnalyzerScores(args: {
	dealId: string;
	version: number;
	score: number;
	riskOverallScore: number;
	coverage: number;
}): any {
	const dio = dioWithOkScores(args.dealId, args.version);
	const ar = dio.analyzer_results;

	ar.slide_sequence.score = args.score;
	ar.slide_sequence.coverage = args.coverage;

	ar.metric_benchmark.overall_score = args.score;
	ar.metric_benchmark.coverage = args.coverage;

	ar.visual_design.design_score = args.score;
	ar.visual_design.coverage = args.coverage;

	ar.narrative_arc.pacing_score = args.score;
	ar.narrative_arc.coverage = args.coverage;

	ar.financial_health.health_score = args.score;
	ar.financial_health.coverage = args.coverage;

	ar.risk_assessment.overall_risk_score = args.riskOverallScore;
	ar.risk_assessment.coverage = args.coverage;

	return dio;
}

function mkMockPool(args: {
	dealId: string;
	dioId: string;
	dio: any;
	dpuRows: Array<{ document_id: string; page_index: number; payload: any }>;
	visualAssets?: Array<{ id: string; quality_flags: any }>;
	evidenceItems?: any[];
}): any {
	const visual = Array.isArray(args.visualAssets) ? args.visualAssets : [];
	const evidence = Array.isArray(args.evidenceItems) ? args.evidenceItems : [];

	return {
		query: async (sql: string, params?: unknown[]) => {
			const q = String(sql);
			if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
				assert.deepEqual(params, [args.dealId]);
				return { rows: [{ id: args.dealId }] };
			}
			if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
				assert.deepEqual(params, [args.dealId]);
				return {
					rows: [
						{
							dio_id: args.dioId,
							analysis_version: 1,
							recommendation: null,
							overall_score: null,
							dio_data: args.dio,
							updated_at: now,
						},
					],
				};
			}
			if (q.includes("SELECT 1 FROM evidence_items")) {
				return { rows: [{ ok: 1 }], rowCount: 1 };
			}
			if (q.includes("SELECT 1 FROM document_page_understanding")) {
				return { rows: [{ ok: 1 }], rowCount: 1 };
			}
			if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
				assert.deepEqual(params, [args.dealId]);
				return { rows: evidence };
			}
			if (q.includes("FROM public.document_page_understanding")) {
				assert.deepEqual(params, [args.dealId]);
				return { rows: args.dpuRows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })) };
			}
			if (q.includes("FROM visual_assets") && q.includes("WHERE id = ANY")) {
				// params[0] is uuid[] list; ignore filter and return provided
				return { rows: visual.map((v) => ({ id: v.id, quality_flags: v.quality_flags })) };
			}
			if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
				return { rows: [] };
			}
			throw new Error(`Unexpected SQL in test: ${q}`);
		},
	};
}

function palmLikeDpuRows(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
	// Reuse titles/bullets from segment-dpu-page.palm.test.ts
	const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
		{ page_index: 1, title: "Industry Outlook.", bullets: [] },
		{ page_index: 2, title: "Our Product Journey.", bullets: [] },
		{ page_index: 8, title: "Business Performance", bullets: ["$800,000 in revenue", "Conversion rate 3.2%", "CAC improving QoQ"] },
		{ page_index: 9, title: "Growth Forecast.", bullets: ["20% MoM growth"] },
		{ page_index: 22, title: "Strategic Hires & Wholesale Build Out", bullets: ["Serving 32 retailers", "Brick and mortar accounts expanding", "Wholesale distribution build out"] },

		// Team-heavy (hiring-forward) slides to exercise archetype-aware drift dampening.
		{ page_index: 23, title: "Team", bullets: ["CEO", "CTO", "Head of Growth"] },
		{ page_index: 24, title: "Leadership Team", bullets: ["Hiring plan", "Key execs"] },
		{ page_index: 25, title: "Advisors", bullets: ["Industry advisors", "Board"] },
		{ page_index: 26, title: "Strategic Hires", bullets: ["VP Sales", "VP Ops"] },
		{ page_index: 27, title: "Org Chart", bullets: ["Team expansion", "Hiring roadmap"] },
	];

	return pages.map((p) => ({
		document_id: docId,
		page_index: p.page_index,
		payload: {
			structured: { title: p.title, bullets: p.bullets },
			source: { visual_asset_id: "00000000-0000-4000-8000-00000000c0aa" },
		},
	}));
}

function palmLikeDpuRowsCanonicalRevenue(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
	// Same as palmLikeDpuRows, but avoids performance-attribution tokens (conversion/CAC/ROAS)
	// so the revenue bullet remains canonical revenue_v1.
	const rows = palmLikeDpuRows(docId);
	return rows.map((r) => {
		if (r.page_index !== 8) return r;
		return {
			...r,
			payload: {
				...r.payload,
				structured: {
					...(r.payload?.structured ?? {}),
					bullets: ["$800,000 in revenue", "Wholesale expansion"],
				},
			},
		};
	});
}

function fullCriteriaDpuRows(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
	const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
		{ page_index: 1, title: "Market Opportunity", bullets: ["TAM $10B", "CAGR 20%"] },
		{ page_index: 2, title: "Product", bullets: ["Product validation", "Featured in press"] },
		{ page_index: 3, title: "Traction", bullets: ["$800,000 in revenue", "Conversion rate 3.2%"] },
		{ page_index: 4, title: "Financials Forecast", bullets: ["2026 forecast: $2.0M revenue", "Projection"] },
		{ page_index: 5, title: "Team", bullets: ["CEO", "CTO"] },
		{ page_index: 6, title: "Go To Market", bullets: ["Omni-channel distribution", "Wholesale partnerships"] },
		{ page_index: 7, title: "Business Performance", bullets: ["Serving 32 retailers", "20% MoM growth"] },
	];

	return pages.map((p) => ({
		document_id: docId,
		page_index: p.page_index,
		payload: {
			structured: { title: p.title, bullets: p.bullets },
			source: { visual_asset_id: "00000000-0000-4000-8000-00000000c0ab" },
		},
	}));
}

test("unadjusted==50 => overall stays 50 even if adjustment changes", async () => {
	const dealId = "00000000-0000-4000-8000-00000000c001";
	const dioId = "dio-unadjusted-50";

	const dioLowAdj = dioWithTunedBaseline({ dealId, version: 1, financialHealthScore: 50, riskOverallScore: 50, coverage: 0 });
	const dioHighAdj = dioWithTunedBaseline({ dealId, version: 1, financialHealthScore: 50, riskOverallScore: 50, coverage: 1 });

	let dioCall = 0;
	const pool = {
		query: async (sql: string, params?: unknown[]) => {
			const q = String(sql);
			if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
				assert.deepEqual(params, [dealId]);
				return { rows: [{ id: dealId }] };
			}
			if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
				dioCall += 1;
				const dio = dioCall === 1 ? dioLowAdj : dioHighAdj;
				return {
					rows: [
						{
							dio_id: dioId,
							analysis_version: 1,
							recommendation: null,
							overall_score: null,
							dio_data: dio,
							updated_at: now,
						},
					],
				};
			}
			if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("SELECT 1 FROM document_page_understanding")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) return { rows: [] };
			if (q.includes("FROM public.document_page_understanding")) {
				assert.deepEqual(params, [dealId]);
				return { rows: palmLikeDpuRows("doc-1").map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })) };
			}
			if (q.includes("FROM visual_assets") && q.includes("quality_flags")) return { rows: [] };
			throw new Error(`Unexpected SQL in test: ${q}`);
		},
	};

	const app = Fastify({ logger: false });
	await registerReportRoutes(app as any, pool as any);

	const res1 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res1.statusCode, 200);
	const body1 = res1.json() as any;
	const t1 = body1?.report?.metadata?.score_explanation?.totals;
	assert.equal(t1.unadjusted_overall_score, 50);
	assert.equal(t1.overall_score, 50);
	assert.ok(typeof t1.adjustment_factor === "number");

	const band1 = body1?.report?.metadata?.score_band_v2;
	assert.ok(band1 && typeof band1 === "object");
	assert.equal(band1.key, "consider_caution");

	const decision1 = body1?.report?.metadata?.decision_v1;
	assert.ok(decision1 && typeof decision1 === "object");
	assert.equal(decision1.recommendation_key, "consider");

	assert.equal(body1?.report?.recommendation, "consider");
	assert.equal(body1?.report?.grade, "Fair");
	assert.equal(body1?.report?.metadata?.decision_v1_report_alignment_v1, true);
	assert.ok(typeof body1?.report?.metadata?.legacy_recommendation_v0 === "string" && body1.report.metadata.legacy_recommendation_v0.length > 0);
	assert.ok(typeof body1?.report?.metadata?.legacy_grade_v0 === "string" && body1.report.metadata.legacy_grade_v0.length > 0);

	const res2 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res2.statusCode, 200);
	const body2 = res2.json() as any;
	const t2 = body2?.report?.metadata?.score_explanation?.totals;
	assert.equal(t2.unadjusted_overall_score, 50);
	assert.equal(t2.overall_score, 50);
	assert.ok(typeof t2.adjustment_factor === "number");
	assert.notEqual(t1.adjustment_factor, t2.adjustment_factor);

	const band2 = body2?.report?.metadata?.score_band_v2;
	assert.ok(band2 && typeof band2 === "object");
	assert.equal(band2.key, "consider_caution");

	const decision2 = body2?.report?.metadata?.decision_v1;
	assert.ok(decision2 && typeof decision2 === "object");
	assert.equal(decision2.recommendation_key, "consider");

	assert.equal(body2?.report?.recommendation, "consider");
	assert.equal(body2?.report?.grade, "Fair");
	assert.equal(body2?.report?.metadata?.decision_v1_report_alignment_v1, true);
	assert.ok(typeof body2?.report?.metadata?.legacy_recommendation_v0 === "string" && body2.report.metadata.legacy_recommendation_v0.length > 0);
	assert.ok(typeof body2?.report?.metadata?.legacy_grade_v0 === "string" && body2.report.metadata.legacy_grade_v0.length > 0);
});

test("hard pass guardrail triggers when score<45 and full criteria in place", async () => {
	const dealId = "00000000-0000-4000-8000-00000000c010";
	const dioId = "dio-hard-pass-guardrail";

	const dio = dioWithAllAnalyzerScores({ dealId, version: 1, score: 10, riskOverallScore: 95, coverage: 1 });

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: fullCriteriaDpuRows("doc-guardrail"),
		visualAssets: [],
		evidenceItems: [],
	});

	const app = Fastify({ logger: false });
	await registerReportRoutes(app as any, pool as any);

	const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res.statusCode, 200);
	const body = res.json() as any;

	const totals = body?.report?.metadata?.score_explanation?.totals;
	assert.ok(totals && typeof totals === "object");
	assert.ok(typeof totals.overall_score === "number");
	assert.ok(totals.overall_score < 45);
	assert.ok(typeof totals.coverage_ratio === "number");
	assert.ok(totals.coverage_ratio >= 0.85);
	assert.ok(typeof totals.unadjusted_overall_score === "number");

	const band = body?.report?.metadata?.score_band_v2;
	assert.ok(band && typeof band === "object");
	assert.equal(band.key, "hard_pass");

	const guardrail = body?.report?.metadata?.hard_pass_guardrail_v2;
	assert.ok(guardrail && typeof guardrail === "object");
	assert.equal(guardrail.triggered, true);
	assert.equal(guardrail.reason, "low_score_despite_full_coverage");
	assert.ok(typeof guardrail.note === "string" && guardrail.note.length > 0);
	assert.ok(guardrail.criteria_snapshot && typeof guardrail.criteria_snapshot === "object");

	const decision = body?.report?.metadata?.decision_v1;
	assert.ok(decision && typeof decision === "object");
	assert.equal(decision.recommendation_key, "hard_pass");
	assert.equal(decision.severity, "danger");

	assert.equal(body?.report?.recommendation, "pass");
	assert.equal(body?.report?.grade, "Needs Improvement");
	assert.equal(body?.report?.metadata?.decision_v1_report_alignment_v1, true);
	assert.ok(typeof body?.report?.metadata?.legacy_recommendation_v0 === "string" && body.report.metadata.legacy_recommendation_v0.length > 0);
	assert.ok(typeof body?.report?.metadata?.legacy_grade_v0 === "string" && body.report.metadata.legacy_grade_v0.length > 0);
});

test("unadjusted>50 and higher adjustment => overall increases (Δ>=1)", async () => {
	const dealId = "00000000-0000-4000-8000-00000000c002";
	const dioId = "dio-unadjusted-moves";

	const dioLowAdj = dioWithTunedBaseline({ dealId, version: 1, financialHealthScore: 80, riskOverallScore: 20, coverage: 0 });
	const dioHighAdj = dioWithTunedBaseline({ dealId, version: 1, financialHealthScore: 80, riskOverallScore: 20, coverage: 1 });

	let dioCall = 0;
	const pool = {
		query: async (sql: string, params?: unknown[]) => {
			const q = String(sql);
			if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
				assert.deepEqual(params, [dealId]);
				return { rows: [{ id: dealId }] };
			}
			if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
				dioCall += 1;
				const dio = dioCall === 1 ? dioLowAdj : dioHighAdj;
				return {
					rows: [
						{
							dio_id: dioId,
							analysis_version: 1,
							recommendation: null,
							overall_score: null,
							dio_data: dio,
							updated_at: now,
						},
					],
				};
			}
			if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("SELECT 1 FROM document_page_understanding")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) return { rows: [] };
			if (q.includes("FROM public.document_page_understanding")) {
				assert.deepEqual(params, [dealId]);
				return { rows: palmLikeDpuRows("doc-1").map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })) };
			}
			if (q.includes("FROM visual_assets") && q.includes("quality_flags")) return { rows: [] };
			throw new Error(`Unexpected SQL in test: ${q}`);
		},
	};

	const app = Fastify({ logger: false });
	await registerReportRoutes(app as any, pool as any);

	const res1 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res1.statusCode, 200);
	const t1 = (res1.json() as any)?.report?.metadata?.score_explanation?.totals;
	assert.ok(typeof t1.unadjusted_overall_score === "number");
	assert.ok(typeof t1.overall_score === "number");

	const res2 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res2.statusCode, 200);
	const t2 = (res2.json() as any)?.report?.metadata?.score_explanation?.totals;
	assert.ok(typeof t2.unadjusted_overall_score === "number");
	assert.ok(typeof t2.overall_score === "number");
	assert.ok((t2.overall_score - t1.overall_score) >= 1);
});

test("missing baseline inputs => unadjusted=null + pinned diagnostics + deterministic preview not applied", async () => {
	const dealId = "00000000-0000-4000-8000-00000000c003";
	const dioId = "dio-unadjusted-missing";

	process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";

	const dio = dioWithOkScores(dealId, 1);
	// Remove score-bearing analyzer outputs entirely.
	delete dio.analyzer_results.financial_health;
	delete dio.analyzer_results.risk_assessment;

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRows("doc-1"),
	});

	const app = Fastify({ logger: false });
	await registerReportRoutes(app as any, pool as any);

	const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res.statusCode, 200);
	const body = res.json() as any;
	const totals = body?.report?.metadata?.score_explanation?.totals;
	assert.equal(totals.unadjusted_overall_score, null);
	assert.equal(totals.overall_score, 50);
	assert.equal(totals.unadjusted_pinned, true);
	assert.ok(typeof totals.unadjusted_reason === "string" && totals.unadjusted_reason.length > 0);
	assert.ok(Array.isArray(totals.unadjusted_missing_inputs));
	assert.ok(totals.unadjusted_missing_inputs.some((s: string) => String(s).includes("financial_health")));
	assert.ok(totals.unadjusted_missing_inputs.some((s: string) => String(s).includes("risk_assessment")));

	const preview = body?.report?.metadata?.deterministic_score_preview_v1;
	assert.ok(preview);
	assert.equal(preview.applied, false);
	assert.equal(preview.gate?.blocked_by_unadjusted_pinned, true);
	assert.ok(Array.isArray(preview.notes) && preview.notes.includes("pinned_unadjusted"));
	assert.ok(typeof preview?.baseline?.unadjusted_pin_reason === "string" && preview.baseline.unadjusted_pin_reason.length > 0);
});

function promotedFactRow(args: {
	fact_type: string;
	docId: string;
	page_index: number;
	value_json: any;
	confidence?: number;
	}): any {
	return {
		evidence_id: `e-${args.fact_type}-${args.page_index}`,
		fact_type: args.fact_type,
		confidence: args.confidence ?? 0.8,
		extracted_at: now,
		source_path: `doc:${args.docId}:page:${args.page_index + 1}`,
		content_json: {
			fact_type: args.fact_type,
			value_json: args.value_json,
			provenance: {
				page_index: args.page_index,
				source_document_id: args.docId,
				primary_sources: [{ source_document_id: args.docId, page_index: args.page_index }],
			},
		},
		meta: { page_index: args.page_index, document_id: args.docId },
	};
}

function complianceKeywordDpuRows(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
	// Force archetype inference toward enterprise_saas_compliance via keywords,
	// and deliberately omit product to create a hard-critical misalignment that must block scoring.
	const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
		{ page_index: 0, title: "Industry Outlook.", bullets: ["SOC 2 compliance", "GDPR", "HIPAA", "audit controls", "security"] },
		{ page_index: 1, title: "Security & Compliance", bullets: ["audit readiness", "controls", "risk management"] },
		{ page_index: 2, title: "Traction", bullets: ["100 enterprise customers"] },
	];
	return pages.map((p) => ({
		document_id: docId,
		page_index: p.page_index,
		payload: {
			structured: { title: p.title, bullets: p.bullets },
			source: { visual_asset_id: "00000000-0000-4000-8000-00000000c0ac" },
		},
	}));
}

test("deterministic score bridge v1: flag off attaches metadata but does not change score", async () => {
	delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;

	const dealId = "00000000-0000-0000-0000-00000000d101";
	const dioId = "00000000-0000-4000-8000-00000000d201";
	const docId = "00000000-0000-4000-8000-00000000d301";

	const dio = dioWithOkScores(dealId, 1);

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRows(docId),
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);
		const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res.statusCode, 200);
		const body = res.json() as any;

		assert.equal(body.ready, true);
		assert.equal(typeof body.overallScore, "number");

		const meta = body.report?.metadata;
		assert.ok(meta);
		assert.ok(meta.deterministic_score_inputs_v1);
		assert.ok(meta.deterministic_score_preview_v1);
		assert.equal(meta.deterministic_score_preview_v1.enabled, false);
		assert.equal(meta.deterministic_score_preview_v1.applied, false);

		// Ensure inputs hash is present and stable looking
		assert.equal(typeof meta.deterministic_score_inputs_v1.inputs_hash, "string");
		assert.equal(meta.deterministic_score_inputs_v1.inputs_hash.length, 64);

		// Flag off must not mutate baseline score
		assert.equal(meta.deterministic_score_preview_v1.baseline.overall_score, body.overallScore);
	} finally {
		await app.close();
	}
});

test("deterministic score bridge v1: flag on applies measurable score change when not misaligned", async () => {
	process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";

	const dealId = "00000000-0000-0000-0000-00000000d102";
	const dioId = "00000000-0000-4000-8000-00000000d202";
	const docId = "00000000-0000-4000-8000-00000000d302";

	// Ensure this fixture is not pinned by shouldPinUnadjusted(): high coverage, non-zero KPIs.
	const dio = dioWithAllAnalyzerScores({ dealId, version: 1, score: 80, riskOverallScore: 20, coverage: 0.9 });

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRows(docId),
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);
		const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res.statusCode, 200);
		const body = res.json() as any;

		const meta = body.report?.metadata;
		assert.ok(meta);
		assert.equal(meta.deterministic_score_preview_v1.enabled, true);

		// Palm-like decks should land mostly_aligned (team-heavy is common) and not hard-block deterministic scoring.
		assert.ok(meta.archetype_segment_drift_v1);
		assert.equal(meta.archetype_segment_drift_v1.overall_assessment, "mostly_aligned");
		assert.ok(
			Array.isArray(meta.archetype_segment_drift_v1.compensating_patterns) &&
			meta.archetype_segment_drift_v1.compensating_patterns.some((cp: any) => cp?.missing_segment === "team_overrep_compensated_by_core_segments")
		);

		// If drift comes back misaligned (rare for this fixture), the bridge will stay preview-only.
		// We want the mainline to apply.
		assert.equal(meta.deterministic_score_preview_v1.gate.blocked_by_drift_misaligned, false);
		assert.equal(meta.deterministic_score_preview_v1.gate.drift_assessment, "mostly_aligned");
		assert.equal(meta.deterministic_score_preview_v1.gate.blocked_by_unadjusted_pinned, false);
		assert.equal(meta.deterministic_score_preview_v1.applied, true);

		const baseline = meta.deterministic_score_preview_v1.baseline.overall_score;
		const det = meta.deterministic_score_preview_v1.deterministic.overall_score;
		const modifier = meta.deterministic_score_preview_v1.modifier_v1?.modifier;
		const baseEvidence = meta.deterministic_score_preview_v1.baseline?.evidence_factor;
		const detEvidence = meta.deterministic_score_preview_v1.deterministic?.evidence_factor;

		assert.equal(typeof baseline, "number");
		assert.equal(typeof det, "number");
		assert.equal(typeof modifier, "number");
		assert.ok(modifier >= 0.85 && modifier <= 1.15);
		assert.ok(Array.isArray(meta.deterministic_score_preview_v1.applied_parts));
		assert.ok(meta.deterministic_score_preview_v1.applied_parts.length > 0);
		if (typeof baseEvidence === "number") {
			assert.equal(typeof detEvidence, "number");
			const expected = Math.min(1, Math.max(0, baseEvidence * modifier));
			assert.ok(Math.abs(detEvidence - expected) < 1e-9);
		}
		assert.equal(body.overallScore, det);
	} finally {
		await app.close();
		delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;
	}
});

test("deterministic score bridge v1: drift misaligned blocks application even when flag on", async () => {
	process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";

	const dealId = "00000000-0000-0000-0000-00000000d103";
	const dioId = "00000000-0000-4000-8000-00000000d203";
	const docId = "00000000-0000-4000-8000-00000000d303";

	const dio = dioWithOkScores(dealId, 1);

	const dpuRows = complianceKeywordDpuRows(docId);

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows,
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);
		const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res.statusCode, 200);
		const body = res.json() as any;

		const meta = body.report?.metadata;
		assert.ok(meta);
		assert.equal(meta.deterministic_score_preview_v1.enabled, true);
		assert.equal(meta.deterministic_score_preview_v1.gate.blocked_by_drift_misaligned, true);
		assert.equal(meta.deterministic_score_preview_v1.applied, false);

		// When blocked, overallScore remains baseline
		assert.equal(meta.deterministic_score_preview_v1.baseline.overall_score, body.overallScore);
	} finally {
		await app.close();
		delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;
	}
});

test("deterministic score bridge v1: does not pin when coverage>=0.80, kpis>=1, drift=mostly_aligned, confidence>=0.40", async () => {
	process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";

	const dealId = "00000000-0000-0000-0000-00000000d105";
	const dioId = "00000000-0000-4000-8000-00000000d205";
	const docId = "00000000-0000-4000-8000-00000000d305";

	const dio = dioWithAllAnalyzerScores({ dealId, version: 1, score: 80, riskOverallScore: 20, coverage: 0.9 });

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRows(docId),
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);
		const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res.statusCode, 200);
		const body = res.json() as any;

		const meta = body.report?.metadata;
		assert.ok(meta);
		const preview = meta.deterministic_score_preview_v1;
		assert.ok(preview);

		assert.ok(meta.archetype_segment_drift_v1);
		assert.equal(meta.archetype_segment_drift_v1.overall_assessment, "mostly_aligned");
		assert.equal(preview.gate.blocked_by_drift_misaligned, false);

		// Coverage and confidence should be healthy for this fixture.
		const totals = meta?.score_explanation?.totals;
		assert.ok(totals && typeof totals === "object");
		assert.ok(typeof totals.coverage_ratio === "number" && totals.coverage_ratio >= 0.8);
		if (typeof totals.confidence_score === "number") assert.ok(totals.confidence_score >= 0.4);

		// New pin policy: should not pin and should not carry a pin reason.
		assert.equal(preview.baseline.unadjusted_pinned, false);
		assert.ok(preview.baseline.unadjusted_pin_reason == null);
		assert.equal(preview.gate.blocked_by_unadjusted_pinned, false);

		// Deterministic overall is allowed to differ from baseline. If it happens to match,
		// assert it is not due to pinning.
		const baseOverall = preview.baseline.overall_score;
		const detOverall = preview.deterministic.overall_score;
		assert.equal(typeof baseOverall, "number");
		assert.equal(typeof detOverall, "number");
		if (detOverall === baseOverall) {
			assert.equal(preview.baseline.unadjusted_pinned, false);
			assert.equal(preview.gate.blocked_by_unadjusted_pinned, false);
		}
	} finally {
		await app.close();
		delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;
	}
});

test("deterministic score bridge v1: pins when low signal", async () => {
	process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";

	const dealId = "00000000-0000-0000-0000-00000000d106";
	const dioId = "00000000-0000-4000-8000-00000000d206";
	const docId = "00000000-0000-4000-8000-00000000d306";

	// Low coverage should trigger shouldPinUnadjusted() => low_coverage.
	const dio = dioWithAllAnalyzerScores({ dealId, version: 1, score: 80, riskOverallScore: 20, coverage: 0.1 });

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRows(docId),
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);
		const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res.statusCode, 200);
		const body = res.json() as any;

		const meta = body.report?.metadata;
		assert.ok(meta);
		const preview = meta.deterministic_score_preview_v1;
		assert.ok(preview);

		// Ensure we're exercising pinning (not drift misalignment).
		assert.ok(meta.archetype_segment_drift_v1);
		assert.equal(meta.archetype_segment_drift_v1.overall_assessment, "mostly_aligned");
		assert.equal(preview.gate.blocked_by_drift_misaligned, false);

		assert.equal(preview.baseline.unadjusted_pinned, true);
		assert.equal(preview.gate.blocked_by_unadjusted_pinned, true);
		assert.equal(preview.baseline.unadjusted_pin_reason, "low_coverage");

		// Pin behavior: freeze deterministic preview to baseline and do not apply.
		assert.equal(preview.applied, false);
		assert.equal(preview.deterministic.overall_score, preview.baseline.overall_score);
		assert.equal(preview.delta_overall_score, 0);
		assert.equal(body.overallScore, preview.baseline.overall_score);
	} finally {
		await app.close();
		delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;
	}
});

test("deterministic score bridge v1: inputs_hash stable + KPI page_index preserved", async () => {
	delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;

	const dealId = "00000000-0000-0000-0000-00000000d104";
	const dioId = "00000000-0000-4000-8000-00000000d204";
	const docId = "00000000-0000-4000-8000-00000000d304";

	const dio = dioWithOkScores(dealId, 1);

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRowsCanonicalRevenue(docId),
		evidenceItems: [],
	});

	const app = Fastify();
	try {
		await registerReportRoutes(app, pool);

		const res1 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res1.statusCode, 200);
		const b1 = res1.json() as any;
		const h1 = b1.report?.metadata?.deterministic_score_inputs_v1?.inputs_hash;
		assert.equal(typeof h1, "string");

		const res2 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
		assert.equal(res2.statusCode, 200);
		const b2 = res2.json() as any;
		const h2 = b2.report?.metadata?.deterministic_score_inputs_v1?.inputs_hash;
		assert.equal(h2, h1);

		// KPI page_index should flow through into inputs
		const kpis: any[] = b1.report?.metadata?.deterministic_score_inputs_v1?.kpis ?? [];
		const revenue = kpis.find((k) => k && k.key === 'revenue');
		assert.ok(revenue);
		assert.ok(Array.isArray(revenue.sources));
		assert.ok(revenue.sources.length > 0);
		assert.equal(revenue.sources[0].page_index, 8);
	} finally {
		await app.close();
	}
});
