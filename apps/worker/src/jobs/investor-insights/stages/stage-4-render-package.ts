/**
 * Stage 4 — Render package builder + persistence.
 *
 * buildRenderPackage: deterministic assembly of the render_package JSON object.
 * persistReport:      DB upsert into investor_insight_reports.
 *
 * Both are called by the main orchestrator after all sections are assembled.
 */

import type { Pool } from "pg";

import { buildOrchestratorReportV1 } from "@dealdecision/core";

import type {
	GateState,
	ComplianceState,
	RenderPackage,
	EvidenceGateState,
	GovernedSkipRecord,
} from "../../../contracts/investor-insights/schemas";
import type { FusedFact } from "../deal-fusion";
import type { FinancialFactsV1 } from "../../../lib/financial-facts-v1.js";
import type { GovernedSummaryRecord } from "../governed-summary-v1";
import type { GovernedExecutiveSummaryRecord } from "../governed-executive-summary-v1";
import type { NarrativeContradictionBundle } from "../narrative-contradiction-v1";
import type { CanonicalIdentityResult } from "../canonical-identity/canonical-identity-schema";
import { VERSION_PINS } from "./_shared";

// ─── Render package builder ───────────────────────────────────────────────────

export function buildRenderPackage(opts: {
	dealId: string;
	status: RenderPackage["status"];
	gateState: GateState;
	complianceState: ComplianceState;
	upstreamFingerprint: string;
	engineVersion: string;
	sections: RenderPackage["sections"];
	evidenceGate?: EvidenceGateState;
	/** WS-B PR20: governed-skip records; omitted when all LLM stages completed. */
	governedSkips?: GovernedSkipRecord[];
	/** WS-A PR20: recovery metadata; only present when mode="recover_structured_json". */
	recoveryMetadata?: RenderPackage["recovery_metadata"];
	/** PR22: deterministic Overview-tab slot fallbacks (optional, flag-gated). */
	deterministicOverviewSlots?: RenderPackage["deterministic_overview_slots"];
	/** Canonical company identity result — mapped to structured UI field when present. */
	canonicalIdentity?: CanonicalIdentityResult | null;
}): RenderPackage {
	const canonicalIdentityUi: RenderPackage["canonical_identity"] = opts.canonicalIdentity
		? {
				entered_name: opts.canonicalIdentity.entered_deal_name,
				canonical_company_name: opts.canonicalIdentity.canonical_company_name,
				confidence: opts.canonicalIdentity.canonical_company_name_confidence,
				mismatch_flagged: opts.canonicalIdentity.mismatch_flagged,
				evidence_summary: opts.canonicalIdentity.identity_evidence ?? null,
		  }
		: undefined;
	return {
		render_version: "ui_contract_v1",
		ui_contract_version: VERSION_PINS.ui_contract_version,
		engine_version: opts.engineVersion,
		schema_version: VERSION_PINS.schema_version,
		governance_version: VERSION_PINS.governance_version,
		constitution_version: VERSION_PINS.constitution_version,
		deal_id: opts.dealId,
		upstream_fingerprint: opts.upstreamFingerprint,
		status: opts.status,
		gate_state: opts.gateState,
		compliance_state: opts.complianceState,
		sections: opts.sections,
		...(opts.evidenceGate !== undefined && { evidence_gate: opts.evidenceGate }),
		...(opts.governedSkips !== undefined && opts.governedSkips.length > 0 && { governed_skips: opts.governedSkips }),
		...(opts.recoveryMetadata !== undefined && { recovery_metadata: opts.recoveryMetadata }),
		...(opts.deterministicOverviewSlots !== undefined && { deterministic_overview_slots: opts.deterministicOverviewSlots }),
		...(canonicalIdentityUi !== undefined && { canonical_identity: canonicalIdentityUi }),
		no_empty_blocks: true,
		audit_footer: {
			stage: "stage_0",
			generated_at: new Date().toISOString(),
			engine_version: opts.engineVersion,
			schema_version: VERSION_PINS.schema_version,
			governance_version: VERSION_PINS.governance_version,
			constitution_version: VERSION_PINS.constitution_version,
		},
	};
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistReport(
	pool: Pool,
	opts: {
		dealId: string;
		engineVersion: string;
		upstreamFingerprint: string;
		status: string;
		gateState: GateState;
		complianceState: ComplianceState;
		renderPackage: RenderPackage;
		auditLog: unknown[];
		/** Fused canonical facts to persist in report_payload. */
		fusedFacts?: FusedFact[];
		/** Derived financial facts to persist in report_payload. */
		financialFacts?: FinancialFactsV1 | null;
		/** Governed summary record (with fingerprint) to persist in report_payload. */
		governedSummaryRecord?: GovernedSummaryRecord | null;
		/** Governed executive summary record to persist in report_payload. */
		governedExecutiveSummaryRecord?: GovernedExecutiveSummaryRecord | null;
		/**
		 * PR36.9: Full 7-topic contradiction bundle to persist in report_payload.
		 * Additive-only — null/undefined means the field is omitted from the payload.
		 */
		narrativeContradictionBundle?: NarrativeContradictionBundle | null;
	}
): Promise<string> {
	// ── Debug: log DB context once per call ─────────────────────────────────
	const { rows: dbCtxRows } = await pool.query<{ db: string; schema: string }>(
		"SELECT current_database() AS db, current_schema() AS schema"
	);
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_DB_CONTEXT",
			db: dbCtxRows[0]?.db ?? null,
			schema: dbCtxRows[0]?.schema ?? null,
			deal_id: opts.dealId,
			ts: new Date().toISOString(),
		})
	);

	// ── Debug: log attempt before insert ────────────────────────────────────
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_PERSIST_ATTEMPT",
			deal_id: opts.dealId,
			engine_version: opts.engineVersion,
			status: opts.status,
			upstream_fingerprint: opts.upstreamFingerprint,
			ts: new Date().toISOString(),
		})
	);

	let insertedId: string;
	try {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO public.investor_insight_reports
			   (deal_id, engine_version, upstream_fingerprint, status,
			    gate_state, compliance_state, render_package, report_payload, audit_log)
			 VALUES
			   ($1::uuid, $2::text, $3::text, $4::text,
			    $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
			 ON CONFLICT (deal_id, engine_version, upstream_fingerprint) DO UPDATE
			   SET status            = EXCLUDED.status,
			       gate_state        = EXCLUDED.gate_state,
			       compliance_state  = EXCLUDED.compliance_state,
			       render_package    = EXCLUDED.render_package,
			       report_payload    = EXCLUDED.report_payload,
			       audit_log         = EXCLUDED.audit_log,
			       updated_at        = now()
			 RETURNING id`,
			[
				opts.dealId,
				opts.engineVersion,
				opts.upstreamFingerprint,
				opts.status,
				JSON.stringify(opts.gateState),
				JSON.stringify(opts.complianceState),
				JSON.stringify(opts.renderPackage),
				JSON.stringify({ // report_payload: machine-readable facts
					...(opts.fusedFacts ? { fused_facts: opts.fusedFacts } : {}),
					...(opts.financialFacts ? { financial_facts_v1: opts.financialFacts } : {}),
					...(opts.governedSummaryRecord ? { governed_summary_v1: opts.governedSummaryRecord } : {}),
					...(opts.governedExecutiveSummaryRecord ? { governed_executive_summary_v1: opts.governedExecutiveSummaryRecord } : {}),
					...(opts.narrativeContradictionBundle ? { narrative_contradiction_bundle: opts.narrativeContradictionBundle } : {}),
				}),
				JSON.stringify(opts.auditLog),
			]
		);
		insertedId = rows[0]?.id ?? "";
	} catch (err) {
		const pgErr = err as Record<string, unknown>;
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_PERSIST_ERROR",
				deal_id: opts.dealId,
				engine_version: opts.engineVersion,
				status: opts.status,
				upstream_fingerprint: opts.upstreamFingerprint,
				err_code: typeof pgErr["code"] === "string" ? pgErr["code"] : null,
				err_message: err instanceof Error ? err.message : String(err),
				err_detail: typeof pgErr["detail"] === "string" ? pgErr["detail"] : null,
				err_constraint: typeof pgErr["constraint"] === "string" ? pgErr["constraint"] : null,
				stack: err instanceof Error ? err.stack : null,
				ts: new Date().toISOString(),
			})
		);
		throw err;
	}

	// ── Debug: log success after upsert ─────────────────────────────────────
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_PERSIST_OK",
			deal_id: opts.dealId,
			engine_version: opts.engineVersion,
			status: opts.status,
			upstream_fingerprint: opts.upstreamFingerprint,
			inserted_id: insertedId,
			ts: new Date().toISOString(),
		})
	);

	return insertedId;
}

// ─── Canonical Decision persistence ───────────────────────────────────────────

/**
 * Best-effort: resolve canonical_decision_v1 from the render package +
 * deals.overall_score, then patch investor_insight_reports.report_payload.
 *
 * Follows the same non-blocking pattern as applyFinancialIntelligenceV1 —
 * always resolves, never throws. Canonical decision data remains available
 * on-demand via GET /orchestrator-report even when this patch is skipped.
 *
 * Called after persistReport in all three processor paths.
 */
export async function applyCanonicalDecisionV1(
	pool: Pool,
	reportId: string,
	dealId: string,
	renderPackage: RenderPackage,
): Promise<void> {
	try {
		const { rows } = await pool.query<{ overall_score: number | null }>(
			`SELECT overall_score FROM public.deals WHERE id = $1::uuid`,
			[dealId],
		);
		const overall_score =
			typeof rows[0]?.overall_score === "number" ? rows[0].overall_score : null;

		const report = buildOrchestratorReportV1({ dealId, renderPackage, overall_score });
		const cd = report.canonical_decision;
		if (!cd) return;

		await pool.query(
			`UPDATE public.investor_insight_reports
			   SET report_payload = COALESCE(report_payload, '{}'::jsonb) || $2::jsonb
			 WHERE id = $1::uuid`,
			[reportId, JSON.stringify({ canonical_decision_v1: cd })],
		);
	} catch {
		// non-fatal — canonical decision available on-demand via /orchestrator-report
	}
}
