/**
 * Investor Insight Engine – Stage 0 Processor
 *
 * Implements Stage 0 only (PR1 scope):
 *   - Parse job using InvestorInsightsJobSchema
 *   - Evaluate G0–G5 gates
 *   - Fail-closed: always persist a render_package even when gates fail
 *   - If gates pass: compute upstream fingerprint + dedup + persist deterministic_only
 *
 * Binding spec:
 *   docs/Active/Authoritative/investor-analysis-engine/Investor-Insight-Engine–Execution-Contract-binding.md
 *   docs/Active/Authoritative/investor-analysis-engine/contracts/investor-insights/version-pins.md
 *   apps/worker/src/contracts/investor-insights/schemas.ts
 *   apps/worker/src/contracts/investor-insights/validators.ts
 *
 * DO NOT add LLM calls in this file. Stage 5 (LLM) is out of scope for PR1.
 */

import { createHash } from "crypto";
import type { Job } from "bullmq";
import type { Pool } from "pg";

import {
	InvestorInsightsJobSchema,
	type GateState,
	type ComplianceState,
	type RenderPackage,
} from "../../contracts/investor-insights/schemas";
import {
	validateGateState,
	validateRenderPackage,
	validateNoEmptyBlocks,
} from "../../contracts/investor-insights/validators";
import { getPool } from "../../lib/db";
import { evaluateGates } from "./gates";

// ─── Binding constants (version-pins.md) ───────────────────────────────────────

/** Queue name (binding). Task spec: "investor_insights" */
export const QUEUE_NAME = "investor_insights" as const;

/** BullMQ job name (binding). Task spec: "generate_investor_insights" */
export const JOB_NAME = "generate_investor_insights" as const;

/** Version pins – must be present in every render package and audit entry. */
const VERSION_PINS = {
	constitution_version: "v2.0",
	engine_version: "v1",
	schema_version: "v2",
	governance_version: "v1.1",
	ui_contract_version: "v1",
} as const;

// ─── Fingerprint helpers ───────────────────────────────────────────────────────

/**
 * Build the upstream fingerprint (SHA-256 over canonical JSON).
 * Canonicalization: keys sorted lexicographically, primitive-array values sorted.
 * Binding: Execution Contract §4.2–4.3.
 */
function buildDeterministicFingerprint(input: {
	dealId: string;
	engineVersion: string;
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	overlayExists: boolean;
	visualAssetCount: number;
}): string {
	// Keys sorted lexicographically per §4.2
	const canonical = JSON.stringify({
		deal_id: input.dealId,
		dpu_count: input.dpuCount,
		dpu_coverage: Number(input.dpuCoverage.toFixed(6)),
		engine_version: input.engineVersion,
		evidence_count: input.evidenceCount,
		overlay_exists: input.overlayExists,
		visual_asset_count: input.visualAssetCount,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fallback fingerprint used when gates fail (no upstream snapshot available)
 * or when the canonical computation itself fails.
 * Unique per-run (timestamp) so each fail-closed run gets its own row.
 */
function buildFallbackFingerprint(dealId: string, engineVersion: string): string {
	return createHash("sha256")
		.update(`${dealId}:${engineVersion}:fallback:${Date.now()}`)
		.digest("hex")
		.slice(0, 16);
}

// ─── Upstream snapshot ────────────────────────────────────────────────────────

interface UpstreamSnapshot {
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	visualAssetCount: number;
	overlayExists: boolean;
}

/**
 * Collect upstream deterministic signal counts for the fingerprint.
 * All sub-queries are best-effort; failure returns zero-value for that field.
 */
async function loadUpstreamSnapshot(pool: Pool, dealId: string): Promise<UpstreamSnapshot> {
	let dpuCount = 0;
	let dpuCoverage = 0;
	let evidenceCount = 0;
	let visualAssetCount = 0;
	let overlayExists = false;

	await Promise.allSettled([
		pool
			.query<{ total: string; non_empty: string }>(
				`SELECT COUNT(*)::bigint AS total,
				        COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text','') <> '')::bigint AS non_empty
				   FROM public.document_page_understanding
				  WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				dpuCount = Number(rows[0]?.total ?? 0);
				const nonEmpty = Number(rows[0]?.non_empty ?? 0);
				dpuCoverage = dpuCount > 0 ? nonEmpty / dpuCount : 0;
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c FROM public.evidence_items WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				evidenceCount = Number(rows[0]?.c ?? 0);
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c
				   FROM public.visual_assets va
				   JOIN public.documents d ON d.id = va.document_id
				  WHERE d.deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				visualAssetCount = Number(rows[0]?.c ?? 0);
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c FROM public.governed_llm_overviews WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				overlayExists = Number(rows[0]?.c ?? 0) > 0;
			}),
	]);

	return { dpuCount, dpuCoverage, evidenceCount, visualAssetCount, overlayExists };
}

// ─── Compliance state builder ─────────────────────────────────────────────────

function buildComplianceState(events: ComplianceState["events"] = []): ComplianceState {
	const hasFail = events.some((e) => e.severity === "error");
	return {
		status: events.length === 0 ? "not_run" : hasFail ? "failed" : "passed",
		events,
	};
}

// ─── Section builders ─────────────────────────────────────────────────────────

/**
 * Build deterministic-only sections for a gate-failed (status="failed") render package.
 * Each section must satisfy validateNoEmptyBlocks: has items, body, or fallback.
 */
function buildGateFailedSections(gateState: GateState): RenderPackage["sections"] {
	const failedGates = gateState.results.filter((r) => !r.passed);
	const failSummary =
		failedGates.length > 0
			? `${failedGates.length} gate(s) failed: ${failedGates.map((g) => g.gate).join(", ")}`
			: "Gate evaluation error";

	return [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: failSummary,
		},
		{
			key: "message",
			title: "Analysis Status",
			kind: "message",
			body: `Investor analysis cannot proceed until readiness gates are met. ${failSummary}. Required remediation: resolve ${failedGates.map((g) => g.reason_code ?? g.gate).join(", ")}.`,
		},
	];
}

/**
 * Build deterministic-only sections when gates pass but Stage 5+ not yet run.
 */
function buildDeterministicOnlySections(gateState: GateState): RenderPackage["sections"] {
	return [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: "All readiness gates passed",
		},
		{
			key: "message",
			title: "Analysis Status",
			kind: "message",
			body: "Deterministic Stage 0 analysis complete. Full analytical interpretation (Stages 1–7) pending.",
		},
	];
}

// ─── Render package builder ───────────────────────────────────────────────────

function buildRenderPackage(opts: {
	dealId: string;
	status: RenderPackage["status"];
	gateState: GateState;
	complianceState: ComplianceState;
	upstreamFingerprint: string;
	engineVersion: string;
	sections: RenderPackage["sections"];
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

async function persistReport(
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
	}
): Promise<string> {
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
			JSON.stringify({}), // report_payload reserved for Stage 1+
			JSON.stringify(opts.auditLog),
		]
	);
	return rows[0]?.id ?? "";
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function generateInvestorInsightsProcessor(job: Job): Promise<unknown> {
	const rawData = job.data ?? {};

	// ── 1. Parse and validate job payload ──────────────────────────────────────
	let parsed: ReturnType<typeof InvestorInsightsJobSchema.parse>;
	try {
		parsed = InvestorInsightsJobSchema.parse(rawData);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(
			JSON.stringify({ event: "INVESTOR_INSIGHTS_JOB_PARSE_ERROR", job_id: job.id, error: msg })
		);
		throw err;
	}

	const {
		deal_id: dealId,
		engine_version: engineVersion,
		force_recompute: forceRecompute = false,
		triggered_by: triggeredBy,
	} = parsed;

	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE0_START",
			deal_id: dealId,
			engine_version: engineVersion,
			force_recompute: forceRecompute,
			triggered_by: triggeredBy ?? null,
			ts: new Date().toISOString(),
		})
	);

	const pool = getPool();

	// ── 2. Evaluate gates G0–G5 ───────────────────────────────────────────────
	const rawGateState = await evaluateGates(pool, { dealId, engineVersion });

	// Schema-validate gate state; log on failure but continue (fail-closed doctrine)
	let gateState: GateState;
	try {
		gateState = validateGateState(rawGateState);
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_GATE_STATE_SCHEMA_INVALID",
				reason_code: "SCHEMA_GATE_STATE_INVALID",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
		// Best-effort: use raw value; GateStateSchema failure is a schema issue not a blocker
		gateState = rawGateState;
	}

	const complianceState = buildComplianceState();

	// ── 3. Gates failed → fail-closed persist and exit ───────────────────────
	if (!gateState.all_passed) {
		const failedGates = gateState.results.filter((r) => !r.passed);

		console.log(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_ENQUEUE_BLOCKED",
				deal_id: dealId,
				engine_version: engineVersion,
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				ts: new Date().toISOString(),
			})
		);

		const fallbackFp = buildFallbackFingerprint(dealId, engineVersion);
		const sections = buildGateFailedSections(gateState);
		const renderPackage = buildRenderPackage({
			dealId,
			status: "failed",
			gateState,
			complianceState,
			upstreamFingerprint: fallbackFp,
			engineVersion,
			sections,
		});

		// Validate render package; log on failure but always persist (fail-closed)
		let validatedPkg = renderPackage;
		try {
			validatedPkg = validateRenderPackage(renderPackage);
			validateNoEmptyBlocks(validatedPkg);
		} catch (err) {
			console.error(
				JSON.stringify({
					event: "INVESTOR_INSIGHTS_RENDER_PKG_INVALID",
					reason_code: "SCHEMA_RENDER_PACKAGE_INVALID",
					deal_id: dealId,
					error: err instanceof Error ? err.message : String(err),
				})
			);
		}

		const auditLog = [
			{
				stage: "stage_0",
				event: "INVESTOR_INSIGHTS_ENQUEUE_BLOCKED",
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				engine_version: engineVersion,
				constitution_version: VERSION_PINS.constitution_version,
				schema_version: VERSION_PINS.schema_version,
				governance_version: VERSION_PINS.governance_version,
				ui_contract_version: VERSION_PINS.ui_contract_version,
				ts: new Date().toISOString(),
			},
		];

		const reportId = await persistReport(pool, {
			dealId,
			engineVersion,
			upstreamFingerprint: fallbackFp,
			status: "failed",
			gateState,
			complianceState,
			renderPackage: validatedPkg,
			auditLog,
		});

		return {
			ok: true,
			status: "failed",
			report_id: reportId,
			failed_gates: failedGates.map((g) => g.gate),
		};
	}

	// ── 4. Gates passed: compute upstream fingerprint ─────────────────────────
	const upstream = await loadUpstreamSnapshot(pool, dealId);

	let upstreamFingerprint: string;
	try {
		upstreamFingerprint = buildDeterministicFingerprint({
			dealId,
			engineVersion,
			...upstream,
		});
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_FP_FAILED",
				reason_code: "FP_HASH_FAILED",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
		upstreamFingerprint = buildFallbackFingerprint(dealId, engineVersion);
	}

	// ── 5. Dedup index check ──────────────────────────────────────────────────
	if (!forceRecompute) {
		try {
			const { rows } = await pool.query<{ id: string; status: string }>(
				`SELECT id, status
				   FROM public.investor_insight_reports
				  WHERE deal_id = $1::uuid
				    AND engine_version = $2::text
				    AND upstream_fingerprint = $3::text
				  LIMIT 1`,
				[dealId, engineVersion, upstreamFingerprint]
			);
			if (rows[0]) {
				console.log(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_DEDUP_HIT",
						reason_code: "FP_IDEMPOTENT_HIT_SKIP",
						deal_id: dealId,
						engine_version: engineVersion,
						upstream_fingerprint: upstreamFingerprint,
						existing_report_id: rows[0].id,
						existing_status: rows[0].status,
						ts: new Date().toISOString(),
					})
				);
				return {
					ok: true,
					status: "dedup_skip",
					reason_code: "FP_IDEMPOTENT_HIT_SKIP",
					report_id: rows[0].id,
				};
			}
		} catch {
			// Dedup check is best-effort; failure must not block downstream work
		}
	}

	// ── 6. Persist deterministic-only render package ──────────────────────────
	const sections = buildDeterministicOnlySections(gateState);
	const renderPackage = buildRenderPackage({
		dealId,
		status: "deterministic_only",
		gateState,
		complianceState,
		upstreamFingerprint,
		engineVersion,
		sections,
	});

	let validatedPkg = renderPackage;
	try {
		validatedPkg = validateRenderPackage(renderPackage);
		validateNoEmptyBlocks(validatedPkg);
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_RENDER_PKG_INVALID",
				reason_code: "SCHEMA_RENDER_PACKAGE_INVALID",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
	}

	const auditLog = [
		{
			stage: "stage_0",
			event: "INVESTOR_INSIGHTS_STAGE0_COMPLETE",
			upstream_fingerprint: upstreamFingerprint,
			dpu_count: upstream.dpuCount,
			dpu_coverage: upstream.dpuCoverage,
			evidence_count: upstream.evidenceCount,
			visual_asset_count: upstream.visualAssetCount,
			overlay_exists: upstream.overlayExists,
			engine_version: engineVersion,
			constitution_version: VERSION_PINS.constitution_version,
			schema_version: VERSION_PINS.schema_version,
			governance_version: VERSION_PINS.governance_version,
			ui_contract_version: VERSION_PINS.ui_contract_version,
			ts: new Date().toISOString(),
		},
	];

	const reportId = await persistReport(pool, {
		dealId,
		engineVersion,
		upstreamFingerprint,
		status: "deterministic_only",
		gateState,
		complianceState,
		renderPackage: validatedPkg,
		auditLog,
	});

	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE0_COMPLETE",
			deal_id: dealId,
			engine_version: engineVersion,
			upstream_fingerprint: upstreamFingerprint,
			report_id: reportId,
			dpu_count: upstream.dpuCount,
			dpu_coverage: upstream.dpuCoverage,
			evidence_count: upstream.evidenceCount,
			ts: new Date().toISOString(),
		})
	);

	return {
		ok: true,
		status: "deterministic_only",
		report_id: reportId,
		upstream_fingerprint: upstreamFingerprint,
	};
}
