process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";

const now = new Date().toISOString();

function dioWithOkScores(dealId: string, version: number): any {
	return {
		schema_version: "1.0.0",
		dio_id: "dio-palm-revenue",
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

function mkMockPool(args: {
	dealId: string;
	dioId: string;
	dio: any;
	dpuRows: Array<{ document_id: string; page_index: number; payload: any }>;
}): any {
	return {
		query: async (sql: string, params?: unknown[]) => {
			const q = String(sql);
			if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
				assert.deepEqual(params, [args.dealId]);
				return { rows: [{ id: args.dealId, llm_phase_mode: null }] };
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
			if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("SELECT 1 FROM document_page_understanding")) return { rows: [{ ok: 1 }], rowCount: 1 };
			if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
				return { rows: [] };
			}
			if (q.includes("FROM public.document_page_understanding")) {
				assert.deepEqual(params, [args.dealId]);
				return { rows: args.dpuRows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })) };
			}
			if (q.includes("FROM visual_assets") && q.includes("quality_flags")) return { rows: [] };
			throw new Error(`Unexpected SQL in test: ${q}`);
		},
	};
}

function palmLikeDpuRowsWithFinancialTable(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
	const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
		{ page_index: 1, title: "Industry Outlook.", bullets: [] },
		{ page_index: 2, title: "Our Product Journey.", bullets: [] },
		// Channel-attributed revenue should remain available, but never win as canonical when table revenue exists.
		{ page_index: 8, title: "Business Performance", bullets: ["Email/SMS attributed: $800,000 in revenue", "Conversion rate 3.2%", "CAC improving QoQ"] },
		// Financial table row includes year columns. This should become canonical revenue (2024) instead of $800k.
		{ page_index: 12, title: "The Financials.", bullets: ["Revenue 2022 $1.234M 2023 $1.900M 2024 $2.476M 2025 YTD $2.100M 2025E $2.900M 2026E $3.400M"] },
	];

	return pages.map((p) => ({
		document_id: docId,
		page_index: p.page_index,
		payload: {
			structured: { title: p.title, bullets: p.bullets },
			source: {
				visual_asset_id: "00000000-0000-4000-8000-00000000c0aa",
				// Simulate PPT slide numbering as carried by DPU. This is what we want to see on structured_summary.sources.
				ppt_slide_number: p.page_index === 12 ? 19 : null,
			},
		},
	}));
}

test("canonical revenue prefers financial table over channel-attributed revenue (Palm)", async () => {
	const dealId = "00000000-0000-4000-8000-00000000ca11";
	const dioId = "dio-palm-revenue";
	const dio = dioWithOkScores(dealId, 1);

	const pool = mkMockPool({
		dealId,
		dioId,
		dio,
		dpuRows: palmLikeDpuRowsWithFinancialTable("doc-palm"),
	});

	const app = Fastify({ logger: false });
	await registerReportRoutes(app as any, pool as any);

	const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
	assert.equal(res.statusCode, 200);
	const body = res.json() as any;

	const canonical = body?.report?.structured_summary?.revenue;
	assert.ok(canonical && typeof canonical === "object");
	assert.equal(canonical?.value?.amount, 2476000);
	assert.match(String(canonical?.value?.raw ?? ""), /\$2\.476\s*M/i);
	assert.doesNotMatch(String(canonical?.value?.raw ?? ""), /800\s*,?\s*000|\$\s*800\s*k/i);
	assert.equal(String(canonical?.selection_reason ?? ""), "financial_table_preferred");
	// Label should reflect the chosen year for table-derived revenue.
	assert.equal(String(canonical?.label ?? ""), "2024");

	const sources = Array.isArray(canonical?.sources) ? canonical.sources : [];
	assert.ok(sources.length > 0, "expected canonical revenue to carry at least one source");
	assert.equal(String(sources[0]?.slide_title ?? ""), "The Financials.");
	assert.ok(
		sources[0]?.slide_number === 19 || sources[0]?.slide_number === 20,
		`expected sources[0].slide_number in {19,20}, got ${String(sources[0]?.slide_number)}`
	);
	assert.ok(
		sources.some((s: any) => s && typeof s === "object" && s.page_index === 12),
		"expected canonical revenue to cite the financial table page (page_index=12)"
	);

	const promotedFacts = Array.isArray(body?.promoted_facts) ? body.promoted_facts : [];
	const attributed = promotedFacts.find((f: any) => f?.fact_type === "marketing_attributed_revenue_v1" && f?.value_json?.scope === "channel_attributed");
	assert.ok(attributed, "expected marketing-attributed revenue to remain available as secondary evidence");
	assert.equal(attributed?.value_json?.amount?.amount, 800000);
	assert.equal(String(attributed?.value_json?.channel ?? ""), "email_sms");

	const candidates = Array.isArray(canonical?.candidates) ? canonical.candidates : [];
	assert.ok(
		!candidates.some((c: any) => String(c?.value_raw ?? "").match(/800\s*,?\s*000|\$\s*800\s*k|800\s*k/i)),
		"expected canonical revenue candidates to exclude marketing-attributed $800k"
	);
	// Hard regression: when a financial table revenue exists, canonical must not fall back to attributed.
	assert.notEqual(canonical?.value?.amount, attributed?.value_json?.amount?.amount);
});
