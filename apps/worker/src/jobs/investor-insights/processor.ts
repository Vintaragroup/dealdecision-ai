/**
 * Investor Insight Engine – Stage 0 Processor (thin orchestrator)
 *
 * This file is the entry-point for the BullMQ investor_insights queue.
 * All logic has been extracted into stage modules under ./stages/:
 *
 *   _shared.ts              — constants, fingerprint helpers, shared interfaces
 *   stage-0-load-inputs.ts  — DB loaders (upstream snapshot, coverage, history)
 *   stage-1-gates.ts        — gate section builders
 *   stage-2-deterministic.ts— slot detection, Phase 2 canonical fields, thesis stub
 *   stage-3-llm.ts          — LLM section builders (governed summary, exec summary, product profile)
 *   stage-4-render-package.ts — buildRenderPackage + persistReport
 *
 * Binding spec:
 *   docs/Active/Authoritative/investor-analysis-engine/Investor-Insight-Engine–Execution-Contract-binding.md
 *   apps/worker/src/contracts/investor-insights/schemas.ts
 */

import type { Job } from "bullmq";
import type { Pool } from "pg";

import {
	InvestorInsightsJobSchema,
	type GateState,
	type ComplianceState,
	type RenderPackage,
	type EvidenceGateState,
} from "../../contracts/investor-insights/schemas";
import {
	computeEvidenceGateV1,
	EVIDENCE_GATE_COVERAGE_THRESHOLD,
} from "./evidence-gate-v1";
import {
	validateGateState,
	validateRenderPackage,
	validateNoEmptyBlocks,
} from "../../contracts/investor-insights/validators";
import { getPool } from "../../lib/db";
import { evaluateGates } from "./gates";
import { normalizeForExtraction, type NormalizationEvent } from "./normalize";
import {
	fuseDealCanonicalFacts,
	buildDealFusionSection,
	type FusedFact,
} from "./deal-fusion";
import {
	parseFinancialStatementV1,
	pickBestStatement,
	type FinancialStatementV1,
} from "../../lib/financial-statement-parser.js";
import { buildFinancialFactRegistryV1 } from "../../lib/build-financial-fact-registry-v1.js";
import { buildReconciliationSummary } from "../../lib/cross-source-reconciliation.js";
import { upsertFinancialFactsV1 } from "../../lib/db/financial-facts-db.js";
import { buildFinancialCoverageV1 } from "../../lib/financial-facts/build-financial-coverage-v1.js";
import { detectFinancialFactConflictsV1 } from "../../lib/financial-facts/detect-financial-fact-conflicts-v1.js";
import { buildFinancialTruthV1, hasXlsxFromTruthMap } from "../../lib/financial-facts/build-financial-truth-v1.js";
import { detectMentionsInEvidenceText } from "../../lib/deck-financial-signals-v1.js";
import {
	computeFinancialCoveragePct,
	deriveFinancialRiskFlags,
} from "../../lib/financial-facts/financial-coverage-signals-v1.js";

// ── Stage imports ─────────────────────────────────────────────────────────────
import {
	VERSION_PINS,
	buildDeterministicFingerprint,
	buildFallbackFingerprint,
	buildComplianceState,
} from "./stages/_shared";
import {
	loadUpstreamSnapshot,
	loadCoverageSnapshot,
	loadDealName,
	loadPreviousFusedFacts,
	loadPreviousGovernedSummary,
	loadPreviousGovernedExecSummary,
} from "./stages/stage-0-load-inputs";
import {
	normMetricsFromInputs,
	buildGateFailedSections,
	buildDeterministicOnlySections,
	buildG3OnlyFailSections,
	buildEvidenceGateFailedSections,
	buildG3DiagnosticsSection,
} from "./stages/stage-1-gates";
import {
	type InsightSlotInputs,
	type DpuPage,
	type EvidenceSnippet,
	loadInsightSlotInputs,
	extractDpuText,
	buildInsightSlotsSection,
	buildInsightSlotsSections,
	buildPhase2Sections,
	buildThesisInputs,
	buildInvestorThesisStubSection,
	extractPhase2Result,
	formatCanonicalFieldLine,
	buildProductNarrativeBody,
	deriveFinancialFactsV1,
	buildFullContradictionBundle,
} from "./stages/stage-2-deterministic";
import {
	buildGovernedSummarySection,
	buildGovernedExecutiveSummarySection,
	buildProductProfileSection,
	buildKeyFactsSynthesisSection,
	buildLlmInterpretationSection,
} from "./stages/stage-3-llm";
import {
	buildRenderPackage,
	persistReport,
	applyCanonicalDecisionV1,
} from "./stages/stage-4-render-package";
import { runIntelligenceStage } from "./stages/stage-5-intelligence";
import { runDpuOcrBackfillForDeal } from "../../lib/dpu-ocr-backfill-v1";
import { maybeEnqueueInvestorInsightsAfterOcrImprovement } from "../../lib/ocr-auto-rerun-v1";
import {
	classifyDeterministicOnlyRecoverable,
	buildRecoveryMetadata,
} from "./stages/recovery";
import { type GovernedSkip } from "./stages/governed-skip";
import { XLSX_DPU_USEFUL_HEURISTIC_VERSION } from "./stages/_shared";
import { resolveOverviewFallbacksV1 } from "./stages/deterministic-slot-fallback-v1.js";
import { runExternalDiligenceV1, buildExternalDiligenceRenderSection } from "./external-diligence/external-diligence-v1";
import { computeLimitedScoringV1, buildLimitedScoringSection } from "./limited-scoring-v1";
import { resolveCanonicalIdentity, buildCanonicalIdentityRenderSection } from "./canonical-identity/resolve-canonical-identity";

// ─── Binding constants ─────────────────────────────────────────────────────────

/** Queue name (binding). Task spec: "investor_insights" */
export const QUEUE_NAME = "investor_insights" as const;

/** BullMQ job name (binding). Task spec: "generate_investor_insights" */
export const JOB_NAME = "generate_investor_insights" as const;

// ─── Re-exports (public API — originally exported directly from processor.ts) ───
export type { ThesisInputsV1 } from "./stages/stage-2-deterministic";
export {
	computeConfidenceCap,
	buildInvestorThesisStubSection,
} from "./stages/stage-2-deterministic";

// ─── PR22: Deterministic overview slot helper ─────────────────────────────────

/**
 * Build the deterministic_overview_slots payload for the render_package.
 *
 * Strips the verbose `evidence` / `debug` arrays (worker-internal) from each
 * slot before persisting so the render_package stays compact.
 *
 * Only called when DETERMINISTIC_SLOT_FALLBACK_V1=true.
 */
function buildDeterministicOverviewSlots(
	dpuPages: DpuPage[]
): RenderPackage["deterministic_overview_slots"] {
	const raw = resolveOverviewFallbacksV1(dpuPages);
	const toSlot = (
		s: { value: string; confidence: number; provenance: "deterministic_fallback_v1" } | undefined
	): { value: string; confidence: number; provenance: "deterministic_fallback_v1" } | undefined =>
		s ? { value: s.value, confidence: s.confidence, provenance: s.provenance } : undefined;

	const product = toSlot(raw.product);
	const market = toSlot(raw.market);
	const businessModel = toSlot(raw.business_model);

	if (!product && !market && !businessModel) return undefined;

	return {
		...(product && { product }),
		...(market && { market }),
		...(businessModel && { business_model: businessModel }),
	};
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
		mode,
		override_llm_mode: overrideLlmMode,
	} = parsed;

	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE0_START",
			deal_id: dealId,
			engine_version: engineVersion,
			force_recompute: forceRecompute,
			triggered_by: triggeredBy ?? null,
			mode,
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

	// ── 3. Gates failed → fail-soft (G3-only) or fail-closed (all others) ───────
	if (!gateState.all_passed) {
		const failedGates = gateState.results.filter((r) => !r.passed);

		// Fail-soft reason codes: structural/readability failures → deterministic_only.
		// QUERY_FAILED is intentionally excluded (DB failure → fail-closed).
		const G3_FAIL_SOFT_CODES = new Set([
			"GATE_STRUCTURED_JSON_MISSING",
			"GATE_STRUCTURED_JSON_PARSE_FAILED",
			"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
		]);

		// Fail-soft: only G3 failed AND the reason is a soft code → deterministic_only.
		const g3OnlyFail =
			failedGates.length === 1 &&
			failedGates[0]?.gate === "G3" &&
			G3_FAIL_SOFT_CODES.has(failedGates[0]?.reason_code ?? "");

		const persistStatus = g3OnlyFail ? "deterministic_only" : "failed";
		const logEvent = g3OnlyFail
			? "INVESTOR_INSIGHTS_G3_FAIL_SOFT"
			: "INVESTOR_INSIGHTS_ENQUEUE_BLOCKED";

		console.log(
			JSON.stringify({
				event: logEvent,
				deal_id: dealId,
				engine_version: engineVersion,
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				ts: new Date().toISOString(),
			})
		);

		// WS-A PR20: classify recovery eligibility when G3 soft-failed and emit
		// a stable observability event so external monitors can trigger recovery.
		if (g3OnlyFail) {
			const recovery = classifyDeterministicOnlyRecoverable(gateState);
			console.log(
				JSON.stringify({
					event: "DETERMINISTIC_ONLY_RECOVERY_ELIGIBLE",
					deal_id: dealId,
					engine_version: engineVersion,
					recoverable: recovery.recoverable,
					reason_code: recovery.reason_code,
					gate: recovery.gate,
					ts: new Date().toISOString(),
				})
			);
		}

		const fallbackFp = buildFallbackFingerprint(dealId, engineVersion);
		const [coverage, insightSlotInputs, previousFusedFacts, gfDealName] = await Promise.all([
			loadCoverageSnapshot(pool, dealId),
			loadInsightSlotInputs(pool, dealId, gateState),
			loadPreviousFusedFacts(pool, dealId),
			loadDealName(pool, dealId),
		]);
		const gfCanonicalIdentity = gfDealName
			? resolveCanonicalIdentity(insightSlotInputs.dpuPages, gfDealName, insightSlotInputs.documentTitles)
			: null;
		console.log(JSON.stringify({
			event: "CANONICAL_IDENTITY_DEBUG",
			v: "CANONICAL_IDENTITY_BUILD_V3",
			deal_id: dealId,
			path: "gate_fail",
			entered_name: gfCanonicalIdentity?.entered_deal_name ?? null,
			canonical_company_name: gfCanonicalIdentity?.canonical_company_name ?? null,
			confidence: gfCanonicalIdentity?.canonical_company_name_confidence ?? null,
			mismatch_flagged: gfCanonicalIdentity?.mismatch_flagged ?? null,
			ts: new Date().toISOString(),
		}));
		const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
		const phase2Sections = buildPhase2Sections(insightSlotInputs);
		const thesisInputsForScoring = buildThesisInputs(insightSlotInputs);
		const thesisSection = g3OnlyFail
			? buildInvestorThesisStubSection(thesisInputsForScoring)
			: null;
		const gfLimitedScoringResult = computeLimitedScoringV1(thesisInputsForScoring, insightSlotInputs);
		const limitedScoringSection = buildLimitedScoringSection(gfLimitedScoringResult);
		const nm = normMetricsFromInputs(insightSlotInputs);
		const fusionResult = fuseDealCanonicalFacts(
			insightSlotInputs.dpuPages, insightSlotInputs.evidenceSnippets, previousFusedFacts
		);
		const fusionSection = buildDealFusionSection(fusionResult);
		const sections = g3OnlyFail
			? buildG3OnlyFailSections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection, nm)
			: buildGateFailedSections(gateState, coverage, insightSlotsSections, phase2Sections, nm);
		sections.push(fusionSection);
		sections.push(limitedScoringSection);

		// Append diagnostics for any structural G3 failure (QUERY_FAILED is excluded
		// since it indicates a DB problem, not a readability one).
		const G3_DIAG_CODES = new Set([
			"GATE_STRUCTURED_JSON_MISSING",
			"GATE_STRUCTURED_JSON_PARSE_FAILED",
			"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
		]);
		const g3Result = gateState.results.find(
			(r) => r.gate === "G3" && !r.passed && G3_DIAG_CODES.has(r.reason_code ?? "")
		);
		if (g3Result) {
			const diagSection = await buildG3DiagnosticsSection(pool, dealId);
			if (diagSection) sections.push(diagSection);
		}

		const renderPackage = buildRenderPackage({
			dealId,
			status: persistStatus,
			gateState,
			complianceState,
			upstreamFingerprint: fallbackFp,
			engineVersion,
			sections,
			// PR22: deterministic slot fallbacks (flag-gated)
			deterministicOverviewSlots: process.env["DETERMINISTIC_SLOT_FALLBACK_V1"] === "true"
				? buildDeterministicOverviewSlots(insightSlotInputs.dpuPages)
				: undefined,
			canonicalIdentity: gfCanonicalIdentity ?? undefined,
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
				event: logEvent,
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				g3_only_fail_soft: g3OnlyFail,
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
			status: persistStatus,
			gateState,
			complianceState,
			renderPackage: validatedPkg,
			auditLog,
			fusedFacts: fusionResult.facts,
			financialFacts: insightSlotInputs.bestFinancialStatement
				? deriveFinancialFactsV1(insightSlotInputs.bestFinancialStatement)
				: null,
			narrativeContradictionBundle: buildFullContradictionBundle(insightSlotInputs),
		});

		// Best-effort: populate financial fact registry (non-blocking)
		try {
			const factsToUpsert = buildFinancialFactRegistryV1({
				dealId,
				financialStatement: insightSlotInputs.bestFinancialStatement ?? null,
				saasKpis: insightSlotInputs.saasKpis ?? null,
				balanceSheet: insightSlotInputs.balanceSheet ?? null,
				cashFlow: insightSlotInputs.cashFlow ?? null,
				reconciliation: insightSlotInputs.financialReconciliation ?? null,
				deckSignals: insightSlotInputs.deckFinancialSignals ?? null,
				workbookFacts: insightSlotInputs.workbookFacts,
				existingDbFacts: insightSlotInputs.existingDbFacts,
			});
			insightSlotInputs.crossSourceReconciliation = buildReconciliationSummary(factsToUpsert);
			const upserted = await upsertFinancialFactsV1(pool, factsToUpsert);
			const fi = await applyFinancialIntelligenceV1(pool, reportId, dealId, factsToUpsert, insightSlotInputs);
			// ── FTRL: build financial truth map ─────────────────────────────────────
			const financialTruth = buildFinancialTruthV1({
				facts: factsToUpsert,
				deckFinancialSignals: insightSlotInputs.deckFinancialSignals,
				pipelineB: {
					revenue_latest: insightSlotInputs.bestFinancialStatement?.derived?.revenue_latest ?? null,
					burn_monthly: insightSlotInputs.cashFlow?.derived?.monthly_burn_from_ops ?? null,
					runway_months: insightSlotInputs.cashFlow?.derived?.runway_months ?? null,
					cash_latest: insightSlotInputs.balanceSheet?.derived?.cash_latest ?? null,
				},
			});
			insightSlotInputs.financialTruth = financialTruth;
			console.log(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1",
				deal_id: dealId,
				upserted_count: upserted,
				cross_source_summary: insightSlotInputs.crossSourceReconciliation,
				financial_coverage_pct:   fi.coverage_pct,
				financial_conflict_count: fi.conflict_count,
				financial_risk_flags:     fi.risk_flags,
				path: "gates_failed",
				financial_truth: Object.fromEntries(
					Object.entries(financialTruth).map(([m, r]) => [
						m,
						{
							state: r.state,
							resolved_value: r.resolved_value,
							resolved_source_kind: r.resolved_source_kind,
							resolution_strategy: r.resolution_strategy,
							disagreement: r.disagreement,
							disagreement_pct: r.disagreement_pct != null ? Math.round(r.disagreement_pct * 10) / 10 : null,
							source_count: r.source_count,
						},
					])
				),
				ts: new Date().toISOString(),
			}));
		} catch (factErr) {
			console.error(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1_ERROR",
				deal_id: dealId,
				error: factErr instanceof Error ? factErr.message : String(factErr),
				path: "gates_failed",
				ts: new Date().toISOString(),
			}));
		}

		// Best-effort: persist canonical decision summary (non-blocking).
		await applyCanonicalDecisionV1(pool, reportId, dealId, validatedPkg);

		// ── Stage 5: Intelligence Pass (guarantee) ───────────────────────────────
		// Run Stage 5 even in the gate-fail path so every analyzed deal receives
		// challenge pass + conviction data regardless of gate outcomes.
		const gfStage5Status = await runStage5WithContext(pool, {
			dealId,
			dealName: gfDealName,
			engineVersion,
			reportId,
			evidenceCount: 0, // upstream snapshot not loaded in gate-fail path
			sectionCount: sections.length,
			evidenceGatePassed: false,
			investorInsightsStatus: persistStatus,
			overrideLlmMode: null,
			upstreamFingerprint: fallbackFp,
			insightSlotInputs,
			limitedScoringResult: gfLimitedScoringResult,
			fusionResult,
		});
		console.log(JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE5_STATUS",
			deal_id: dealId,
			path: "gates_failed",
			persist_status: persistStatus,
			stage5_status: gfStage5Status,
			ts: new Date().toISOString(),
		}));

		return {
			ok: true,
			status: persistStatus,
			report_id: reportId,
			failed_gates: failedGates.map((g) => g.gate),
			stage5_status: gfStage5Status,
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
			const { rows } = await pool.query<{ id: string; status: string; has_canonical_identity: boolean }>(
				`SELECT id, status,
				        (render_package->'canonical_identity') IS NOT NULL AS has_canonical_identity
				   FROM public.investor_insight_reports
				  WHERE deal_id = $1::uuid
				    AND engine_version = $2::text
				    AND upstream_fingerprint = $3::text
				  LIMIT 1`,
				[dealId, engineVersion, upstreamFingerprint]
			);
			if (rows[0]) {
				if (rows[0].has_canonical_identity) {
					// Bypass dedup when the prior run produced only deterministic output (no LLM
					// synthesis — typically caused by a missing API key at the time of the original
					// run).  Re-running when status is "deterministic_only" is safe and cheap;
					// it ensures interpretation fields are populated on subsequent runs.
					const isDeterministicOnly = rows[0].status === "deterministic_only";
					if (isDeterministicOnly) {
						console.log(
							JSON.stringify({
								event: "INVESTOR_INSIGHTS_DEDUP_BYPASS_DETERMINISTIC_ONLY",
								reason_code: "DETERMINISTIC_ONLY_NEEDS_LLM_RETRY",
								v: "CANONICAL_IDENTITY_BUILD_V3",
								deal_id: dealId,
								engine_version: engineVersion,
								upstream_fingerprint: upstreamFingerprint,
								existing_report_id: rows[0].id,
								existing_status: rows[0].status,
								ts: new Date().toISOString(),
							})
						);
					} else {
						// Full dedup hit — cached report already contains canonical_identity.
						console.log(
							JSON.stringify({
								event: "INVESTOR_INSIGHTS_DEDUP_HIT",
								reason_code: "FP_IDEMPOTENT_HIT_SKIP",
								v: "CANONICAL_IDENTITY_BUILD_V3",
								deal_id: dealId,
								engine_version: engineVersion,
								upstream_fingerprint: upstreamFingerprint,
								existing_report_id: rows[0].id,
								existing_status: rows[0].status,
								ts: new Date().toISOString(),
							})
						);
						// Stage 5 not run — prior run assumed complete; dedup skips reprocessing.
						console.log(JSON.stringify({
							event: "INVESTOR_INSIGHTS_STAGE5_STATUS",
							deal_id: dealId,
							path: "dedup_skip",
							stage5_status: "skipped",
							reason: "dedup_hit_prior_run_assumed_complete",
							ts: new Date().toISOString(),
						}));
						return {
							ok: true,
							status: "dedup_skip",
							reason_code: "FP_IDEMPOTENT_HIT_SKIP",
							report_id: rows[0].id,
							stage5_status: "skipped",
						};
					}
				}
				// Report predates canonical_identity feature — bypass dedup so this
				// run refreshes the persisted render_package with the new field.
				console.log(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_DEDUP_BYPASS_CANONICAL",
						reason_code: "CANONICAL_IDENTITY_MISSING",
						v: "CANONICAL_IDENTITY_BUILD_V3",
						deal_id: dealId,
						engine_version: engineVersion,
						existing_report_id: rows[0].id,
						ts: new Date().toISOString(),
					})
				);
			}
		} catch {
			// Dedup check is best-effort; failure must not block downstream work
		}
	}

	// ── 6a. Load coverage metrics for Evidence Gate evaluation ────────────────
	let coverage = await loadCoverageSnapshot(pool, dealId);

	// PR31: capture coverage ratios before and after OCR backfill so the
	// auto-rerun helper (step 6a-rerun below) can compute the improvement delta.
	// Both remain null when OCR backfill was skipped or failed.
	let coverageRatioBeforeOcr: number | null = null;
	let coverageRatioAfterOcr: number | null = null;

	// ── 6a-ocr. Targeted OCR backfill (flag-gated: DPU_OCR_BACKFILL_V1=true) ──
	// Runs BEFORE the evidence gate so that pages backfilled here count toward
	// the E2 coverage threshold. Only triggers when coverage is currently below
	// threshold and there are empty DPU pages with stored image URIs.
	if (process.env["DPU_OCR_BACKFILL_V1"] === "true") {
		const currentCoveragePct = coverage.dpuPageCount > 0
			? (coverage.dpuNonemptyPages + coverage.xlsxBonusPages) / coverage.dpuPageCount
			: 0;
		if (currentCoveragePct < EVIDENCE_GATE_COVERAGE_THRESHOLD) {
			coverageRatioBeforeOcr = currentCoveragePct;
			try {
				await runDpuOcrBackfillForDeal(pool, dealId);
				// Reload coverage so the updated page_text rows count toward E2.
				coverage = await loadCoverageSnapshot(pool, dealId);
				coverageRatioAfterOcr = coverage.dpuPageCount > 0
					? (coverage.dpuNonemptyPages + coverage.xlsxBonusPages) / coverage.dpuPageCount
					: 0;
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "DPU_OCR_BACKFILL_ERROR",
						deal_id: dealId,
						error: err instanceof Error ? err.message : String(err),
					})
				);
				// Non-fatal: continue with original coverage if backfill fails.
				// Clear before-ratio so auto-rerun is not triggered on a failed backfill.
				coverageRatioBeforeOcr = null;
			}
		}
	}

	// WS-C PR20: emit XLSX_DPU_USEFUL_PAGES when XLSX bonus pages were found so
	// that the adjustment is visible in logs alongside the evidence gate metrics.
	if (coverage.xlsxBonusPages > 0) {
		console.log(
			JSON.stringify({
				event: "XLSX_DPU_USEFUL_PAGES",
				deal_id: dealId,
				pages_total: coverage.dpuPageCount,
				useful_pages: coverage.xlsxBonusPages,
				dpu_nonempty_pages_base: coverage.dpuNonemptyPages,
				dpu_nonempty_pages_adjusted: coverage.dpuNonemptyPages + coverage.xlsxBonusPages,
				heuristic_version: XLSX_DPU_USEFUL_HEURISTIC_VERSION,
				ts: new Date().toISOString(),
			})
		);
	}

	// ── 6b. Compute Evidence Gate v1 (deterministic quality check) ────────
	const evidenceGate = computeEvidenceGateV1({
		docs_count: coverage.docsCount,
		expected_pages_total: coverage.dpuPageCount,
		// WS-C PR20: add xlsx bonus pages so XLSX-heavy deals are not penalised
		// by the E2 coverage check when page_text is empty but rows data exists.
		dpu_nonempty_pages: coverage.dpuNonemptyPages + coverage.xlsxBonusPages,
		evidence_count: coverage.evidenceCount,
	});

	console.log(
		JSON.stringify({
			event: evidenceGate.passed
				? "INVESTOR_INSIGHTS_EVIDENCE_GATE_PASS"
				: "INVESTOR_INSIGHTS_EVIDENCE_GATE_FAIL",
			deal_id: dealId,
			engine_version: engineVersion,
			passed: evidenceGate.passed,
			blocking_reason: evidenceGate.blocking_reason,
			metrics: evidenceGate.metrics,
			ts: new Date().toISOString(),
		})
	);

	if (!evidenceGate.passed) {
		// ── Evidence gate blocked LLM stages — persist deterministic output only ──
		const [insightSlotInputs, previousFusedFacts, dealName] = await Promise.all([
			loadInsightSlotInputs(pool, dealId, gateState),
			loadPreviousFusedFacts(pool, dealId),
			loadDealName(pool, dealId),
		]);
		const canonicalIdentity = dealName
			? resolveCanonicalIdentity(insightSlotInputs.dpuPages, dealName, insightSlotInputs.documentTitles)
			: null;
		console.log(JSON.stringify({
			event: "CANONICAL_IDENTITY_DEBUG",
			v: "CANONICAL_IDENTITY_BUILD_V3",
			deal_id: dealId,
			path: "evidence_gate_fail",
			entered_name: canonicalIdentity?.entered_deal_name ?? null,
			canonical_company_name: canonicalIdentity?.canonical_company_name ?? null,
			confidence: canonicalIdentity?.canonical_company_name_confidence ?? null,
			mismatch_flagged: canonicalIdentity?.mismatch_flagged ?? null,
			ts: new Date().toISOString(),
		}));
		const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
		const phase2Sections = buildPhase2Sections(insightSlotInputs);
		const thesisInputsForScoring = buildThesisInputs(insightSlotInputs);
		const thesisSection = buildInvestorThesisStubSection(thesisInputsForScoring);
		const egLimitedScoringResult = computeLimitedScoringV1(thesisInputsForScoring, insightSlotInputs);
		const limitedScoringSection = buildLimitedScoringSection(egLimitedScoringResult);
		const fusionResult = fuseDealCanonicalFacts(
			insightSlotInputs.dpuPages, insightSlotInputs.evidenceSnippets, previousFusedFacts
		);
		const fusionSection = buildDealFusionSection(fusionResult);
		const sections = buildEvidenceGateFailedSections(
			gateState, coverage, evidenceGate,
			insightSlotsSections, phase2Sections, thesisSection,
			normMetricsFromInputs(insightSlotInputs)
		);
		sections.push(fusionSection);
		sections.push(limitedScoringSection);

		// PR34: LLM interpretation with evidence caveat (evidence gate failed — limited coverage).
		// Non-fatal: runs best-effort and is a no-op when LLM is unavailable.
		const egGovernedSkips: GovernedSkip[] = [];
		// PR35: External diligence (best-effort, non-fatal).
		const egPhase2 = extractPhase2Result(insightSlotInputs);
		const egCanonicalFieldsBody = egPhase2.fields.length > 0
			? egPhase2.fields.map(formatCanonicalFieldLine).join("\n")
			: null;
		const egExternalDiligence = await runExternalDiligenceV1(insightSlotInputs, {
			deal_id: dealId,
			dealName: dealName ?? undefined,
			canonicalFieldsBody: egCanonicalFieldsBody,
			canonicalIdentity,
		}).catch((err) => {
			console.warn(JSON.stringify({
				event: "EXTERNAL_DILIGENCE_CATCH",
				deal_id: dealId,
				path: "evidence_gate_fail",
				error: err instanceof Error ? err.message : String(err),
			}));
			return null;
		});
		const llmInterpretationEg = await buildLlmInterpretationSection(insightSlotInputs, {
			evidenceCaveat: true,
			governedSkips: egGovernedSkips,
			deal_id: dealId,
			dealName: dealName ?? undefined,
			productNarrativeBody: buildProductNarrativeBody(insightSlotInputs),
			externalDiligenceBody: egExternalDiligence?.body ?? null,
		});
		if (llmInterpretationEg) {
			sections.unshift(llmInterpretationEg);
		}
		// PR35: Push external diligence section when results were found
		const egExtDiligenceSection = egExternalDiligence?.diligence
			? buildExternalDiligenceRenderSection(egExternalDiligence.diligence)
			: null;
		if (egExtDiligenceSection) {
			sections.push(egExtDiligenceSection);
		}
		// Canonical identity debug section (mismatch warnings visible to reviewers)
		const egCanonicalIdentitySection = canonicalIdentity
			? buildCanonicalIdentityRenderSection(canonicalIdentity)
			: null;
		if (egCanonicalIdentitySection) {
			sections.push(egCanonicalIdentitySection);
		}

		const renderPackage = buildRenderPackage({
			dealId,
			status: "deterministic_only",
			gateState,
			complianceState,
			upstreamFingerprint,
			engineVersion,
			sections,
			evidenceGate,
			// PR34: include governed_skips when LLM interpretation was skipped
			governedSkips: egGovernedSkips.length > 0 ? egGovernedSkips : undefined,
			// PR22: deterministic slot fallbacks (flag-gated)
			deterministicOverviewSlots: process.env["DETERMINISTIC_SLOT_FALLBACK_V1"] === "true"
				? buildDeterministicOverviewSlots(insightSlotInputs.dpuPages)
				: undefined,
			canonicalIdentity: canonicalIdentity ?? undefined,
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

		const auditLogEvidenceGateFail = [
			{
				stage: "stage_0",
				event: "INVESTOR_INSIGHTS_EVIDENCE_GATE_FAIL_PERSIST",
				upstream_fingerprint: upstreamFingerprint,
				dpu_count: upstream.dpuCount,
				dpu_coverage: upstream.dpuCoverage,
				evidence_count: upstream.evidenceCount,
				visual_asset_count: upstream.visualAssetCount,
				overlay_exists: upstream.overlayExists,
				evidence_gate_blocking_reason: evidenceGate.blocking_reason,
				engine_version: engineVersion,
				constitution_version: VERSION_PINS.constitution_version,
				schema_version: VERSION_PINS.schema_version,
				governance_version: VERSION_PINS.governance_version,
				ui_contract_version: VERSION_PINS.ui_contract_version,
				ts: new Date().toISOString(),
			},
		];

		const egReportId = await persistReport(pool, {
			dealId,
			engineVersion,
			upstreamFingerprint,
			status: "deterministic_only",
			gateState,
			complianceState,
			renderPackage: validatedPkg,
			auditLog: auditLogEvidenceGateFail,
			fusedFacts: fusionResult.facts,
			financialFacts: insightSlotInputs.bestFinancialStatement
				? deriveFinancialFactsV1(insightSlotInputs.bestFinancialStatement)
				: null,
			governedSummaryRecord: null,
			governedExecutiveSummaryRecord: null,
			narrativeContradictionBundle: buildFullContradictionBundle(insightSlotInputs),
		});

		// Best-effort: populate financial fact registry (non-blocking)
		try {
			const factsToUpsert = buildFinancialFactRegistryV1({
				dealId,
				financialStatement: insightSlotInputs.bestFinancialStatement ?? null,
				saasKpis: insightSlotInputs.saasKpis ?? null,
				balanceSheet: insightSlotInputs.balanceSheet ?? null,
				cashFlow: insightSlotInputs.cashFlow ?? null,
				reconciliation: insightSlotInputs.financialReconciliation ?? null,
				deckSignals: insightSlotInputs.deckFinancialSignals ?? null,
				workbookFacts: insightSlotInputs.workbookFacts,
				existingDbFacts: insightSlotInputs.existingDbFacts,
			});
			insightSlotInputs.crossSourceReconciliation = buildReconciliationSummary(factsToUpsert);
			const upserted = await upsertFinancialFactsV1(pool, factsToUpsert);
			const fi = await applyFinancialIntelligenceV1(pool, egReportId, dealId, factsToUpsert, insightSlotInputs);
			// ── FTRL: build financial truth map ─────────────────────────────────────
			const financialTruth = buildFinancialTruthV1({
				facts: factsToUpsert,
				deckFinancialSignals: insightSlotInputs.deckFinancialSignals,
				pipelineB: {
					revenue_latest: insightSlotInputs.bestFinancialStatement?.derived?.revenue_latest ?? null,
					burn_monthly: insightSlotInputs.cashFlow?.derived?.monthly_burn_from_ops ?? null,
					runway_months: insightSlotInputs.cashFlow?.derived?.runway_months ?? null,
					cash_latest: insightSlotInputs.balanceSheet?.derived?.cash_latest ?? null,
				},
			});
			insightSlotInputs.financialTruth = financialTruth;
			console.log(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1",
				deal_id: dealId,
				upserted_count: upserted,
				cross_source_summary: insightSlotInputs.crossSourceReconciliation,
				financial_coverage_pct:   fi.coverage_pct,
				financial_conflict_count: fi.conflict_count,
				financial_risk_flags:     fi.risk_flags,
				path: "evidence_gate_fail",
				financial_truth: Object.fromEntries(
					Object.entries(financialTruth).map(([m, r]) => [
						m,
						{
							state: r.state,
							resolved_value: r.resolved_value,
							resolved_source_kind: r.resolved_source_kind,
							resolution_strategy: r.resolution_strategy,
							disagreement: r.disagreement,
							disagreement_pct: r.disagreement_pct != null ? Math.round(r.disagreement_pct * 10) / 10 : null,
							source_count: r.source_count,
						},
					])
				),
				ts: new Date().toISOString(),
			}));
		} catch (factErr) {
			console.error(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1_ERROR",
				deal_id: dealId,
				error: factErr instanceof Error ? factErr.message : String(factErr),
				path: "evidence_gate_fail",
				ts: new Date().toISOString(),
			}));
		}

		// Best-effort: persist canonical decision summary (non-blocking).
		await applyCanonicalDecisionV1(pool, egReportId, dealId, validatedPkg);

		// ── Stage 5: Intelligence Pass (guarantee) ───────────────────────────────
		// Run Stage 5 even when the evidence gate blocked LLM stages so every
		// analyzed deal receives challenge pass + conviction data.
		const egStage5Status = await runStage5WithContext(pool, {
			dealId,
			dealName,
			engineVersion,
			reportId: egReportId,
			evidenceCount: upstream.evidenceCount,
			sectionCount: sections.length,
			evidenceGatePassed: false,
			investorInsightsStatus: "deterministic_only",
			overrideLlmMode: null,
			upstreamFingerprint,
			insightSlotInputs,
			limitedScoringResult: egLimitedScoringResult,
			fusionResult,
		});

		console.log(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_EVIDENCE_GATE_FAIL_COMPLETE",
				deal_id: dealId,
				engine_version: engineVersion,
				upstream_fingerprint: upstreamFingerprint,
				report_id: egReportId,
				blocking_reason: evidenceGate.blocking_reason,
				stage5_status: egStage5Status,
				ts: new Date().toISOString(),
			})
		);

		// ── 6a-rerun (PR31): auto-rerun if OCR materially improved coverage ────
		// Best-effort: fire-and-forget so this path never delays or breaks the return.
		// The policy helper handles dedup, cooldown, and "already running" checks.
		// getQueue is imported lazily so module-level queue init is not triggered
		// in tests that don't mock the queue module.
		if (coverageRatioBeforeOcr !== null && coverageRatioAfterOcr !== null) {
			maybeEnqueueInvestorInsightsAfterOcrImprovement({
				pool,
				dealId,
				coverageBefore: coverageRatioBeforeOcr,
				coverageAfter: coverageRatioAfterOcr,
				threshold: EVIDENCE_GATE_COVERAGE_THRESHOLD,
				enqueue: {
					add: async (name, data, opts) => {
						// Lazy: avoids module-level Redis URL validation in unit tests.
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const { getQueue } = await import("../../lib/queue.js") as any;
						return getQueue("investor_insights").add(name, data, opts);
					},
				},
			}).catch((err) => {
				console.warn(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_AUTO_RERUN_ERROR",
						deal_id: dealId,
						error: err instanceof Error ? err.message : String(err),
						ts: new Date().toISOString(),
					})
				);
			});
		}

		return {
			ok: true,
			status: "deterministic_only",
			report_id: egReportId,
			upstream_fingerprint: upstreamFingerprint,
			evidence_gate_passed: false,
			stage5_status: egStage5Status,
		};
	}

	// ── 6c. Evidence gate passed — load remaining inputs and run LLM stages ───
	const [insightSlotInputs, previousFusedFacts, previousGovernedSummary, previousGovernedExecSummary, dealName] = await Promise.all([
		loadInsightSlotInputs(pool, dealId, gateState),
		loadPreviousFusedFacts(pool, dealId),
		loadPreviousGovernedSummary(pool, dealId),
		loadPreviousGovernedExecSummary(pool, dealId),
		loadDealName(pool, dealId),
	]);
	const canonicalIdentity = dealName
		? resolveCanonicalIdentity(insightSlotInputs.dpuPages, dealName, insightSlotInputs.documentTitles)
		: null;
	console.log(JSON.stringify({
		event: "CANONICAL_IDENTITY_DEBUG",
		v: "CANONICAL_IDENTITY_BUILD_V3",
		deal_id: dealId,
		path: "main",
		entered_name: canonicalIdentity?.entered_deal_name ?? null,
		canonical_company_name: canonicalIdentity?.canonical_company_name ?? null,
		confidence: canonicalIdentity?.canonical_company_name_confidence ?? null,
		mismatch_flagged: canonicalIdentity?.mismatch_flagged ?? null,
		ts: new Date().toISOString(),
	}));
	const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
	const phase2Sections = buildPhase2Sections(insightSlotInputs);
	const thesisInputsForScoring = buildThesisInputs(insightSlotInputs);
	const thesisSection = buildInvestorThesisStubSection(thesisInputsForScoring);
	const limitedScoringResult = computeLimitedScoringV1(thesisInputsForScoring, insightSlotInputs);
	const limitedScoringSection = buildLimitedScoringSection(limitedScoringResult);
	const fusionResult = fuseDealCanonicalFacts(
		insightSlotInputs.dpuPages, insightSlotInputs.evidenceSnippets, previousFusedFacts
	);
	const fusionSection = buildDealFusionSection(fusionResult);
	const productNarrativeBody = buildProductNarrativeBody(insightSlotInputs);

	// WS-B PR20: mutable array to collect governed-stage skip events from all
	// three LLM builders.  Passed via opts and populated by recordGovernedSkip.
	const governedSkips: GovernedSkip[] = [];
	const llmOpts = { governedSkips, deal_id: dealId, forceRecompute };

	const governedResult = await buildGovernedSummarySection(
		insightSlotInputs,
		previousGovernedSummary,
		engineVersion,
		VERSION_PINS.governance_version,
		dealName ?? undefined,
		productNarrativeBody ?? undefined,
		llmOpts,
		canonicalIdentity?.canonical_company_name ?? null
	);
	const governedExecResult = await buildGovernedExecutiveSummarySection(
		insightSlotInputs,
		coverage,
		gateState,
		previousGovernedExecSummary,
		engineVersion,
		VERSION_PINS.governance_version,
		dealName ?? undefined,
		productNarrativeBody ?? undefined,
		llmOpts,
		canonicalIdentity?.canonical_company_name ?? null
	);
	// Compute canonical fields body for product profile (same source as governed summaries)
	const phase2ForProfile = extractPhase2Result(insightSlotInputs);
	const canonicalFieldsBodyForProfile = phase2ForProfile.fields.length > 0
		? phase2ForProfile.fields.map(formatCanonicalFieldLine).join("\n")
		: null;
	const productProfileSection = await buildProductProfileSection(
		insightSlotInputs,
		canonicalFieldsBodyForProfile,
		dealName ?? undefined,
		llmOpts
	);
	const sections = buildDeterministicOnlySections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection, normMetricsFromInputs(insightSlotInputs));
	if (governedResult) {
		const statusIdx = sections.findIndex((s) => s.key === "analysis_status");
		const insertAt = statusIdx >= 0 ? statusIdx + 1 : 2;
		sections.splice(insertAt, 0, governedResult.section);
	}
	if (governedExecResult) {
		// Insert the exec summary immediately before governed_summary_v1 (or at position 2)
		const govSummaryIdx = sections.findIndex((s) => s.key === "governed_summary_v1");
		const insertAt = govSummaryIdx >= 0 ? govSummaryIdx : 2;
		sections.splice(insertAt, 0, governedExecResult.section);
	}
	if (productProfileSection) {
		sections.push(productProfileSection);
	}
	// Global Key Facts recovery: synthesize investor-readable narratives for all 4
	// Key Facts cards from broader evidence. This is the highest-priority UI source.
	const keyFactsSynthesisSection = await buildKeyFactsSynthesisSection(
		insightSlotInputs,
		canonicalFieldsBodyForProfile,
		productProfileSection?.body ?? null,
		dealName ?? undefined,
		llmOpts
	);
	if (keyFactsSynthesisSection) {
		sections.push(keyFactsSynthesisSection);
	}
	sections.push(fusionSection);
	sections.push(limitedScoringSection);

	// PR34: LLM interpretation (no caveat — evidence gate passed, full coverage).
	// Prepended as the first section so it renders at the top of the decision surface.
	// Non-fatal: runs best-effort and is a no-op when LLM is unavailable.
	// PR35: External diligence (best-effort, non-blocking).
	const extDiligencePhase2 = extractPhase2Result(insightSlotInputs);
	const extDiligenceCanonicalBody = extDiligencePhase2.fields.length > 0
		? extDiligencePhase2.fields.map(formatCanonicalFieldLine).join("\n")
		: null;
	const externalDiligence = await runExternalDiligenceV1(insightSlotInputs, {
		deal_id: dealId,
		dealName: dealName ?? undefined,
		canonicalFieldsBody: extDiligenceCanonicalBody,
		canonicalIdentity,
	}).catch((err) => {
		console.warn(JSON.stringify({
			event: "EXTERNAL_DILIGENCE_CATCH",
			deal_id: dealId,
			path: "happy_path",
			error: err instanceof Error ? err.message : String(err),
		}));
		return null;
	});
	const llmInterpretation = await buildLlmInterpretationSection(insightSlotInputs, {
		evidenceCaveat: false,
		governedSkips,
		deal_id: dealId,
		dealName: dealName ?? undefined,
		productNarrativeBody,
		externalDiligenceBody: externalDiligence?.body ?? null,
	});
	if (llmInterpretation) {
		sections.unshift(llmInterpretation);
	}
	// PR35: Push external diligence section when results were found
	const extDiligenceSection = externalDiligence?.diligence
		? buildExternalDiligenceRenderSection(externalDiligence.diligence)
		: null;
	if (extDiligenceSection) {
		sections.push(extDiligenceSection);
	}
	// Canonical identity debug section (mismatch warnings visible to reviewers)
	const canonicalIdentitySection = canonicalIdentity
		? buildCanonicalIdentityRenderSection(canonicalIdentity)
		: null;
	if (canonicalIdentitySection) {
		sections.push(canonicalIdentitySection);
	}

	// WS-A PR20: build recovery metadata when mode="recover_structured_json".
	const recoveryMetadata = mode === "recover_structured_json"
		? buildRecoveryMetadata({
				reason_code: classifyDeterministicOnlyRecoverable(gateState).reason_code,
				result: "succeeded",
		  })
		: undefined;

	const renderPackage = buildRenderPackage({
		dealId,
		status: "deterministic_only",
		gateState,
		complianceState,
		upstreamFingerprint,
		engineVersion,
		sections,
		evidenceGate,
		// WS-B PR20: include governed_skips when any LLM stage was skipped
		governedSkips: governedSkips.length > 0 ? governedSkips : undefined,
		// WS-A PR20: include recovery metadata when applicable
		recoveryMetadata,
		// PR22: deterministic slot fallbacks (flag-gated)
		deterministicOverviewSlots: process.env["DETERMINISTIC_SLOT_FALLBACK_V1"] === "true"
			? buildDeterministicOverviewSlots(insightSlotInputs.dpuPages)
			: undefined,
		canonicalIdentity: canonicalIdentity ?? undefined,
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
		fusedFacts: fusionResult.facts,
		financialFacts: insightSlotInputs.bestFinancialStatement
			? deriveFinancialFactsV1(insightSlotInputs.bestFinancialStatement)
			: null,
		governedSummaryRecord: governedResult?.record ?? null,
		governedExecutiveSummaryRecord: governedExecResult?.record ?? null,
		narrativeContradictionBundle: buildFullContradictionBundle(insightSlotInputs),
	});

	// Best-effort: populate financial fact registry (non-blocking)
	try {
		const factsToUpsert = buildFinancialFactRegistryV1({
			dealId,
			financialStatement: insightSlotInputs.bestFinancialStatement ?? null,
			saasKpis: insightSlotInputs.saasKpis ?? null,
			balanceSheet: insightSlotInputs.balanceSheet ?? null,
			cashFlow: insightSlotInputs.cashFlow ?? null,
			reconciliation: insightSlotInputs.financialReconciliation ?? null,
			deckSignals: insightSlotInputs.deckFinancialSignals ?? null,
			workbookFacts: insightSlotInputs.workbookFacts,
			existingDbFacts: insightSlotInputs.existingDbFacts,
		});
		insightSlotInputs.crossSourceReconciliation = buildReconciliationSummary(factsToUpsert);
		const upserted = await upsertFinancialFactsV1(pool, factsToUpsert);
		const fi = await applyFinancialIntelligenceV1(pool, reportId, dealId, factsToUpsert, insightSlotInputs);
		// ── FTRL: build financial truth map ───────────────────────────────────────
		const financialTruth = buildFinancialTruthV1({
			facts: factsToUpsert,
			deckFinancialSignals: insightSlotInputs.deckFinancialSignals,
			pipelineB: {
				revenue_latest: insightSlotInputs.bestFinancialStatement?.derived?.revenue_latest ?? null,
				burn_monthly: insightSlotInputs.cashFlow?.derived?.monthly_burn_from_ops ?? null,
				runway_months: insightSlotInputs.cashFlow?.derived?.runway_months ?? null,
				cash_latest: insightSlotInputs.balanceSheet?.derived?.cash_latest ?? null,
			},
		});
		insightSlotInputs.financialTruth = financialTruth;
		console.log(JSON.stringify({
			event: "POPULATE_FINANCIAL_FACTS_V1",
			deal_id: dealId,
			upserted_count: upserted,
			cross_source_summary: insightSlotInputs.crossSourceReconciliation,
			financial_coverage_pct:   fi.coverage_pct,
			financial_conflict_count: fi.conflict_count,
			financial_risk_flags:     fi.risk_flags,
			path: "happy_path",
			financial_truth: Object.fromEntries(
				Object.entries(financialTruth).map(([m, r]) => [
					m,
					{
						state: r.state,
						resolved_value: r.resolved_value,
						resolved_source_kind: r.resolved_source_kind,
						resolution_strategy: r.resolution_strategy,
						disagreement: r.disagreement,
						disagreement_pct: r.disagreement_pct != null ? Math.round(r.disagreement_pct * 10) / 10 : null,
						source_count: r.source_count,
					},
				])
			),
			ts: new Date().toISOString(),
		}));
	} catch (factErr) {
		console.error(JSON.stringify({
			event: "POPULATE_FINANCIAL_FACTS_V1_ERROR",
			deal_id: dealId,
			error: factErr instanceof Error ? factErr.message : String(factErr),
			path: "happy_path",
			ts: new Date().toISOString(),
		}));
	}

	// Best-effort: persist canonical decision summary (non-blocking).
	await applyCanonicalDecisionV1(pool, reportId, dealId, validatedPkg);

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

	// ── 8. Stage 5: Intelligence Pass ───────────────────────────────────────
	//
	// Guaranteed to run from all analysis paths via runStage5WithContext.
	// CONTRACT: non-throwing, non-blocking, observational only.
	// Gated by DDAI_INTELLIGENCE_LAYER_ENABLED=1.
	const stage5Status = await runStage5WithContext(pool, {
		dealId,
		dealName,
		engineVersion,
		reportId,
		evidenceCount: upstream.evidenceCount,
		sectionCount: sections.length,
		evidenceGatePassed: evidenceGate.passed,
		investorInsightsStatus: overrideLlmMode ? "complete" : "deterministic_only",
		overrideLlmMode,
		upstreamFingerprint,
		insightSlotInputs,
		limitedScoringResult,
		fusionResult,
	});
	console.log(JSON.stringify({
		event: "INVESTOR_INSIGHTS_STAGE5_STATUS",
		deal_id: dealId,
		path: "full",
		stage5_status: stage5Status,
		ts: new Date().toISOString(),
	}));

	// When override_llm_mode is true and Stage 5 completed successfully, promote
	// the persisted report status from deterministic_only → complete.
	if (overrideLlmMode && stage5Status === "completed") {
		try {
			await pool.query(
				`UPDATE public.investor_insight_reports
				    SET status     = 'complete',
				        updated_at = NOW()
				  WHERE id = $1::uuid`,
				[reportId],
			);
			console.log(JSON.stringify({
				event: "INVESTOR_INSIGHTS_STATUS_PROMOTED",
				deal_id: dealId,
				report_id: reportId,
				from_status: "deterministic_only",
				to_status: "complete",
				reason: "override_llm_mode+stage5_completed",
				ts: new Date().toISOString(),
			}));
		} catch (promoteErr) {
			console.error(JSON.stringify({
				event: "INVESTOR_INSIGHTS_STATUS_PROMOTE_FAILED",
				deal_id: dealId,
				report_id: reportId,
				error: promoteErr instanceof Error ? promoteErr.message : String(promoteErr),
				ts: new Date().toISOString(),
			}));
		}
	}

	return {
		ok: true,
		status: overrideLlmMode && stage5Status === "completed" ? "complete" : "deterministic_only",
		report_id: reportId,
		upstream_fingerprint: upstreamFingerprint,
		stage5_status: stage5Status,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stage 5 shared execution context
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared inputs for runStage5WithContext — passed from any analysis exit path.
 */
interface Stage5Context {
	dealId: string;
	dealName: string | null;
	engineVersion: string;
	reportId: string;
	/** Evidence count for URSS proxy. Use 0 when upstream snapshot was not loaded. */
	evidenceCount: number;
	/** Number of sections in the render package (used in evaluator). */
	sectionCount: number;
	evidenceGatePassed: boolean;
	/** Status of the investor_insights run (e.g. "deterministic_only", "complete", "failed"). */
	investorInsightsStatus: string;
	overrideLlmMode: string | null | undefined;
	upstreamFingerprint: string;
	insightSlotInputs: InsightSlotInputs;
	limitedScoringResult: ReturnType<typeof computeLimitedScoringV1>;
	fusionResult: ReturnType<typeof fuseDealCanonicalFacts>;
}

/**
 * Run Stage 5 (Intelligence Pass) from any analysis path.
 *
 * Extracts all necessary input proxies from context, calls runIntelligenceStage,
 * and patches the report_payload with challenge pass output.
 *
 * CONTRACT — this function must NEVER:
 *   • throw an unhandled exception
 *   • mutate or override any field in the caller's return value
 *   • gate or block the caller's return
 *
 * Returns a stage5_status label:
 *   "completed" — Stage 5 ran successfully and results were persisted
 *   "skipped"   — Feature flag disabled (DDAI_INTELLIGENCE_LAYER_ENABLED !== "1")
 *   "failed"    — Stage 5 ran but encountered an error (stage5_error non-null)
 */
async function runStage5WithContext(
	pool: Pool,
	ctx: Stage5Context,
): Promise<"completed" | "skipped" | "failed"> {
	try {
		const {
			dealId,
			dealName,
			engineVersion,
			reportId,
			evidenceCount,
			sectionCount,
			evidenceGatePassed,
			investorInsightsStatus,
			upstreamFingerprint,
			insightSlotInputs,
			limitedScoringResult,
			fusionResult,
		} = ctx;

		const orsProxy = limitedScoringResult.overall_limited_score ?? 50;
		const dciProxy = limitedScoringResult.completeness_score ?? 50;
		const fhcProxy = limitedScoringResult.traction_signal_score ?? 50;
		const urssProxy = Math.min(
			100,
			(evidenceCount < 5 ? 40 : 0) +
			(insightSlotInputs.dpuLoadFailed ? 30 : 0) +
			(fusionResult.conflicts.length * 10),
		);
		const verdictProxy =
			orsProxy >= 70 && limitedScoringResult.scoring_confidence === "high"
				? "GO"
				: orsProxy >= 45
				? "CONSIDER"
				: "NO_GO";

		const financialCoveragePct = insightSlotInputs.financialCoverage
			? computeFinancialCoveragePct(insightSlotInputs.financialCoverage)
			: 0;

		const ft = insightSlotInputs.financialTruth;
		const balanceSheet = insightSlotInputs.balanceSheet;
		const cashFlow = insightSlotInputs.cashFlow;

		const arrStructured: number | null = ft?.arr?.resolved_value ?? null;
		const burnMonthly: number | null =
			ft?.burn_rate?.resolved_value ?? cashFlow?.derived?.monthly_burn_from_ops ?? null;
		const runwayMonths: number | null =
			ft?.runway_months?.resolved_value ?? cashFlow?.derived?.runway_months ?? null;
		const cashOnHand: number | null =
			ft?.cash_on_hand?.resolved_value ?? balanceSheet?.derived?.cash_latest ?? null;

		const arrNarrative: number | null = (() => {
			const mentions = insightSlotInputs.deckFinancialSignals?.arr_mrr_mentions ?? [];
			for (const m of mentions) {
				if (!/\bARR\b|annual\s+recurring/i.test(m.text)) continue;
				const match = /\$([\d,]+(?:\.\d+)?)\s*([KMBTkmbt]?)/.exec(m.text);
				if (!match) continue;
				const raw = parseFloat(match[1]!.replace(/,/g, ""));
				if (isNaN(raw) || raw <= 0) continue;
				const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
				return raw * (multipliers[match[2]!.toLowerCase()] ?? 1);
			}
			return null;
		})();

		const deckSignals = insightSlotInputs.deckFinancialSignals;
		const evidenceMentions = detectMentionsInEvidenceText(insightSlotInputs.evidenceSnippets);
		const arrHasNarrativeMention = arrNarrative != null || evidenceMentions.has_arr;
		const burnHasNarrativeMention =
			(deckSignals?.has_burn ?? false) ||
			(deckSignals?.burn_mentions?.length ?? 0) > 0 ||
			evidenceMentions.has_burn;
		const runwayHasNarrativeMention =
			(deckSignals?.has_runway ?? false) ||
			(deckSignals?.runway_mentions?.length ?? 0) > 0 ||
			evidenceMentions.has_runway;

		const stage5Result = await runIntelligenceStage(pool, {
			deal_id: dealId,
			deal_name: dealName ?? dealId,
			org_id: null,
			engine_version: engineVersion,
			upstream_fingerprint: upstreamFingerprint,
			ors_score: orsProxy,
			dci_score: dciProxy,
			fhc_score: fhcProxy,
			urss_score: urssProxy,
			verdict: verdictProxy,
			scoreband_key: `${verdictProxy.toLowerCase()}_${
				limitedScoringResult.scoring_confidence === "high" ? "high" :
				limitedScoringResult.scoring_confidence === "medium" ? "medium" : "low"
			}`,
			evidence_count: evidenceCount,
			contradiction_count: fusionResult.conflicts.length,
			financial_conflicts: fusionResult.conflicts,
			section_count: sectionCount,
			dpu_provenance_missing: insightSlotInputs.dpuLoadFailed,
			xlsx_extraction_had_llm_fallback: false,
			evidence_gate_passed: evidenceGatePassed,
			investor_insights_status: investorInsightsStatus,
			llm_cache_age_days: null,
			arr_narrative: arrNarrative,
			arr_structured: arrStructured,
			burn_rate_monthly: burnMonthly,
			runway_months: runwayMonths,
			cash_on_hand: cashOnHand,
			financial_completeness_pct: financialCoveragePct,
			has_xlsx: ft != null
				? hasXlsxFromTruthMap(ft)
				: (insightSlotInputs.financialStatements?.length ?? 0) > 0,
			has_cap_table: insightSlotInputs.capTable != null,
			financial_truth_states: ft ? {
				revenue:                      ft.revenue?.state ?? null,
				arr:                          ft.arr?.state ?? null,
				burn_rate:                    ft.burn_rate?.state ?? null,
				runway_months:                ft.runway_months?.state ?? null,
				cash:                         ft.cash_on_hand?.state ?? null,
				revenue_resolved_source_kind: ft.revenue?.resolved_source_kind ?? null,
				arr_resolved_source_kind:     ft.arr?.resolved_source_kind ?? null,
				burn_resolved_source_kind:    ft.burn_rate?.resolved_source_kind ?? null,
				cash_resolved_source_kind:    ft.cash_on_hand?.resolved_source_kind ?? null,
			} : null,
			arr_has_narrative_mention: arrHasNarrativeMention,
			burn_has_narrative_mention: burnHasNarrativeMention,
			runway_has_narrative_mention: runwayHasNarrativeMention,
			market_presence_score: limitedScoringResult.market_presence_score,
			traction_signal_score: limitedScoringResult.traction_signal_score,
			has_saas_kpis: insightSlotInputs.saasKpis != null,
			has_traction_facts: insightSlotInputs.dealTractionFacts.length > 0,
		});

		// Feature flag off → run_id is empty string (disabledResult).
		if (stage5Result.run_id === "") {
			return "skipped";
		}

		// Patch report_payload with challenge pass output.
		if (stage5Result.stage5_error === null) {
			try {
				const cp = stage5Result.challenge_pass_result;
				const financialTruthSummary = ft ? {
					revenue:       { state: ft.revenue?.state       ?? null, source: ft.revenue?.resolved_source_kind       ?? null, disagreement_pct: ft.revenue?.disagreement_pct       ?? null, has_disagreement: ft.revenue?.disagreement       ?? false },
					arr:           { state: ft.arr?.state           ?? null, source: ft.arr?.resolved_source_kind           ?? null, disagreement_pct: ft.arr?.disagreement_pct           ?? null, has_disagreement: ft.arr?.disagreement           ?? false },
					burn_rate:     { state: ft.burn_rate?.state     ?? null, source: ft.burn_rate?.resolved_source_kind     ?? null, disagreement_pct: ft.burn_rate?.disagreement_pct     ?? null, has_disagreement: ft.burn_rate?.disagreement     ?? false },
					runway_months: { state: ft.runway_months?.state ?? null, source: ft.runway_months?.resolved_source_kind ?? null, disagreement_pct: ft.runway_months?.disagreement_pct ?? null, has_disagreement: ft.runway_months?.disagreement ?? false },
					cash_on_hand:  { state: ft.cash_on_hand?.state  ?? null, source: ft.cash_on_hand?.resolved_source_kind  ?? null, disagreement_pct: ft.cash_on_hand?.disagreement_pct  ?? null, has_disagreement: ft.cash_on_hand?.disagreement  ?? false },
				} : null;
				await pool.query(
					`UPDATE public.investor_insight_reports
					   SET report_payload = COALESCE(report_payload, '{}'::jsonb) || $2::jsonb
					 WHERE id = $1::uuid`,
					[
						reportId,
						JSON.stringify({
							challenge_pass: {
								opposing_case:            cp.opposing_case_summary,
								verdict_resistance_score: cp.verdict_resistance_score,
								verdict_resistance_label: cp.verdict_resistance_label,
								flag_count_critical:      cp.flag_count_critical,
								flag_count_error:         cp.flag_count_error,
								flag_count_warn:          cp.flag_count_warn,
								primary_challenge_reason: cp.primary_challenge_reason,
								missing_evidence:         cp.missing_evidence,
								diligence_gaps:           cp.diligence_gaps,
							},
							financial_truth_summary: financialTruthSummary,
						}),
					],
				);
			} catch (patchErr) {
				console.error(JSON.stringify({
					event: "INVESTOR_INSIGHTS_STAGE5_PATCH_FAILED",
					deal_id: dealId,
					error: patchErr instanceof Error ? patchErr.message : String(patchErr),
					ts: new Date().toISOString(),
				}));
			}
			return "completed";
		}

		// stage5_error was non-null — Stage 5 ran but failed internally.
		return "failed";
	} catch (s5Err) {
		console.error(JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE5_UNCAUGHT",
			deal_id: ctx.dealId,
			error: s5Err instanceof Error ? s5Err.message : String(s5Err),
			ts: new Date().toISOString(),
		}));
		return "failed";
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 9 — Financial Coverage + Conflict Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute financial coverage + conflicts from a fact registry, store results on
 * insightSlotInputs, and patch the persisted report payload in a single UPDATE.
 *
 * Always resolves (never throws) — coverage/conflict errors are non-fatal.
 * Returns a compact summary for structured logging.
 */
async function applyFinancialIntelligenceV1(
	pool: Pool,
	reportId: string,
	dealId: string,
	facts: ReturnType<typeof buildFinancialFactRegistryV1>,
	insightSlotInputs: InsightSlotInputs,
): Promise<{ coverage_pct: number; conflict_count: number; risk_flags: string[] }> {
	const coverage  = buildFinancialCoverageV1(dealId, facts);
	const conflicts = detectFinancialFactConflictsV1(facts);
	const riskFlags = deriveFinancialRiskFlags(coverage, conflicts);

	insightSlotInputs.financialCoverage  = coverage;
	insightSlotInputs.financialConflicts = conflicts;
	insightSlotInputs.financialRiskFlags = riskFlags;

	// Best-effort: patch the report payload with coverage intelligence.
	// Uses COALESCE so a NULL report_payload is treated as an empty object.
	try {
		await pool.query(
			`UPDATE public.investor_insight_reports
			   SET report_payload = COALESCE(report_payload, '{}'::jsonb) || $2::jsonb
			 WHERE id = $1::uuid`,
			[reportId, JSON.stringify({
				financial_coverage_v1:  coverage,
				financial_conflicts_v1: conflicts,
				financial_risk_flags:   riskFlags,
			})]
		);
	} catch {
		// Non-fatal — coverage data still available in insightSlotInputs.
	}

	return {
		coverage_pct:   computeFinancialCoveragePct(coverage),
		conflict_count: conflicts.length,
		risk_flags:     riskFlags,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Repair exports — offline slot backfill
//
// Used by apps/worker/src/bin/repair-insight-slots.ts to fix stale reports
// where DPU data was finalized after the investor-insights job last ran.
// These functions WRITE to the DB and must NOT be called from the audit runner.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recompute the insight_slots section body for a deal using current DPU data.
 *
 * Runs the same Stage-1 slot evaluation as the main processor, but without
 * requiring a BullMQ Job object or gate state. Intended for offline repair.
 *
 * @returns The newline-joined slot body string.
 */
export async function recomputeInsightSlotBody(
	pool: Pool,
	dealId: string,
): Promise<string> {
	let dpuPages: DpuPage[] = [];
	let evidenceSnippets: EvidenceSnippet[] = [];
	let dpuLoadFailed = false;
	const normEvents: NormalizationEvent[] = [];
	const repairFinancialStatements: FinancialStatementV1[] = [];

	try {
		const { rows } = await pool.query<{ document_id: string; page_index: number; payload: unknown }>(
			`SELECT document_id, page_index, payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1
			  ORDER BY document_id ASC, page_index ASC
			  LIMIT 500`,
			[dealId]
		);
		dpuPages = rows
			.map((r) => {
				const raw = extractDpuText(r.payload);
				if (!raw) return null;
				const norm = normalizeForExtraction(raw);
				normEvents.push(...norm.events);
				return {
					document_id: r.document_id,
					page_index:  r.page_index,
					text:        norm.text,
					text_raw:    raw,
					norm_events_count: norm.events.length,
				};
			})
			.filter((p): p is DpuPage => p !== null);
		// Parse XLSX financial statements so the repair path can also promote
		// traction_signal via the canonical-to-slot bridge.
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_range") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const stmt = parseFinancialStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (stmt) repairFinancialStatements.push(stmt);
		}
	} catch {
		dpuLoadFailed = true;
	}

	await pool
		.query<{ id: string; claim_text: string | null }>(
			`SELECT evidence_id AS id, content_text AS claim_text FROM public.evidence_items WHERE deal_id = $1::uuid ORDER BY evidence_id ASC LIMIT 50`,
				// ORDER BY evidence_id ASC ensures deterministic evidence selection across re-runs
			[dealId]
		)
		.then(({ rows }) => {
			evidenceSnippets = rows.map((row) => {
				if (!row.claim_text) return { ...row, claim_text_norm: null };
				const norm = normalizeForExtraction(row.claim_text);
				normEvents.push(...norm.events);
				return { ...row, claim_text_norm: norm.text };
			});
		})
		.catch(() => { /* evidence_items is supplemental; failure is non-fatal */ });

	const inputs: InsightSlotInputs = {
		dpuPages,
		evidenceSnippets,
		dpuLoadFailed,
		g3Passed: true, // repair assumes gates already passed for persisted reports
		dpuDiag: {
			queryOk:        !dpuLoadFailed,
			rowCount:       dpuPages.length,
			usablePageCount: dpuPages.length,
			sample:         dpuPages[0] ? `${dpuPages[0].page_index}: ${dpuPages[0].text.slice(0, 80)}` : "n/a",
		},
		normEvents,
		financialStatements: repairFinancialStatements,
		bestFinancialStatement: pickBestStatement(repairFinancialStatements),
		useOfFundsStatements: [],
		bestUseOfFundsStatement: null,
		impliedCapitalAllocation: null,
		impliedFromIncomeStatement: null,
		financialLayoutClassification: null,
		financialReconciliation: null,
		balanceSheet: null,
		cashFlow: null,
		capTable: null,
		saasKpis: null,
		bankTransactions: null,
		deckFinancialSignals: null,
		workbookFacts: [],
		dealTractionFacts: [],
		documentTitles: [],
	};

	return buildInsightSlotsSection(inputs).body ?? "";
}

/**
 * Repair the stored insight_slots section for a deal.
 *
 * Reads the current DPU data, re-evaluates all 5 slot detectors, and replaces
 * the insight_slots body in the most recent investor_insight_reports row.
 * If the insight_slots section is absent from render_package.sections it is
 * appended; if no report row exists the deal is skipped.
 *
 * All other render_package fields are left untouched.
 *
 * @returns Object with updated flag, newBody, and oldBody (null when absent).
 */
export async function repairInsightSlotsInReport(
	pool: Pool,
	dealId: string,
): Promise<{ updated: boolean; newBody: string; oldBody: string | null }> {
	const newBody = await recomputeInsightSlotBody(pool, dealId);

	// Fetch the latest report row
	const { rows: existing } = await pool.query<{
		id: string;
		render_package: unknown;
	}>(
		`SELECT id, render_package
		   FROM public.investor_insight_reports
		  WHERE deal_id = $1
		  ORDER BY updated_at DESC
		  LIMIT 1`,
		[dealId]
	);

	if (existing.length === 0) {
		// No report exists for this deal — cannot repair in-place
		return { updated: false, newBody, oldBody: null };
	}

	const { id: reportId, render_package } = existing[0]!;
	const rp = (render_package ?? {}) as { sections?: Array<Record<string, unknown>> };
	const sections: Array<Record<string, unknown>> = Array.isArray(rp.sections) ? [...rp.sections] : [];

	// Find existing insight_slots section
	const existingIdx = sections.findIndex((s) => s["key"] === "insight_slots");
	const oldBody: string | null =
		existingIdx >= 0 && typeof sections[existingIdx]!["body"] === "string"
			? (sections[existingIdx]!["body"] as string)
			: null;

	const newSection = {
		key:      "insight_slots",
		title:    "Deterministic Insight Slots",
		kind:     "message",
		body:     newBody,
		fallback: "Insight slot extraction unavailable.",
	};

	if (existingIdx >= 0) {
		sections[existingIdx] = newSection;
	} else {
		// Section absent (very old report) — append it
		sections.push(newSection);
	}

	const updatedRp = { ...rp, sections };

	await pool.query(
		`UPDATE public.investor_insight_reports
		    SET render_package = $2::jsonb,
		        updated_at     = NOW()
		  WHERE id = $1`,
		[reportId, JSON.stringify(updatedRp)]
	);

	return { updated: true, newBody, oldBody };
}

// ── Internal exports (unit tests only — not part of public API) ────────────────
/**
 * @internal
 * Exposes deterministic section-builder functions for unit testing.
 * Do not import these in production code paths.
 */
export const _sectionBuilders = {
	buildDeterministicOnlySections,
	buildG3OnlyFailSections,
	buildGateFailedSections,
	buildEvidenceGateFailedSections,
};
