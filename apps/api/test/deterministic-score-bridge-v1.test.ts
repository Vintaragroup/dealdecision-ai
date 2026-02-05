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
	// but keep operations segment missing to trigger a critical underrepresentation (expected_min=2).
	const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
		{ page_index: 0, title: "Industry Outlook.", bullets: ["SOC 2 compliance", "GDPR", "HIPAA", "audit controls", "security"] },
		{ page_index: 1, title: "Our Product Journey.", bullets: ["API-first workflow", "compliance automation"] },
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

		const meta = body.report?.metadata;
		assert.ok(meta);
		assert.equal(meta.deterministic_score_preview_v1.enabled, true);

		// If drift comes back misaligned (rare for this fixture), the bridge will stay preview-only.
		// We want the mainline to apply.
		assert.equal(meta.deterministic_score_preview_v1.gate.blocked_by_drift_misaligned, false);
		assert.equal(meta.deterministic_score_preview_v1.applied, true);

		const baseline = meta.deterministic_score_preview_v1.baseline.overall_score;
		const det = meta.deterministic_score_preview_v1.deterministic.overall_score;
		const modifier = meta.deterministic_score_preview_v1.modifier_v1?.modifier;
		const baseEvidence = meta.deterministic_score_preview_v1.baseline?.evidence_factor;
		const detEvidence = meta.deterministic_score_preview_v1.deterministic?.evidence_factor;

		assert.equal(typeof baseline, "number");
		assert.equal(typeof det, "number");
		assert.equal(typeof modifier, "number");
		assert.ok(modifier >= 0.9 && modifier <= 1.1);
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
		dpuRows: palmLikeDpuRows(docId),
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
