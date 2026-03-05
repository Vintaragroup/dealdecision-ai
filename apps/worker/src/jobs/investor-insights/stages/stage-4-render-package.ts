/**
 * Stage 4 — Render package builder + persistence.
 *
 * buildRenderPackage: deterministic assembly of the render_package JSON object.
 * persistReport:      DB upsert into investor_insight_reports.
 *
 * Both are called by the main orchestrator after all sections are assembled.
 */

import type { Pool } from "pg";

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
}): RenderPackage {
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

	// ── Debug: log success after insert ─────────────────────────────────────
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
