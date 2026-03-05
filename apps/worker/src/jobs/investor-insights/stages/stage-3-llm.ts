/**
 * Stage 3 — LLM-backed section builders.
 *
 * buildGovernedSummarySection, buildGovernedExecutiveSummarySection,
 * buildProductProfileSection.  All three call helpers from stage-2 and
 * the governed-summary / product-profile generators.
 *
 * Extracted verbatim from processor.ts (PR17.6 Lite split).
 */

import type { RenderPackage } from "../../../contracts/investor-insights/schemas";
import {
	serializeGovernedSummaryBody,
	resolveGovernedSummaryWithCache,
	type GovernedSummaryRecord,
} from "../governed-summary-v1";
import {
	resolveGovernedExecSummaryWithCache,
	serializeGovernedExecSummaryBody,
	formatCoverageNote,
	type GovernedExecutiveSummaryRecord,
} from "../governed-executive-summary-v1";
import {
	generateProductProfileV1,
	serializeProductProfileBody,
} from "../product-profile-v1";
import type { InsightSlotInputs } from "./stage-2-deterministic";
import type { CoverageSnapshot } from "./_shared";
import {
	buildInsightSlotsSection,
	buildFinancialStatementSection,
	buildUseOfFundsV1Section,
	buildFinancialHealthMetricsSection,
	formatImpliedCapitalForCorpus,
	buildFinancialReconciliationSection,
	extractPhase2Result,
	formatCanonicalFieldLine,
	formatConflictLine,
	buildProductNarrativeBody,
} from "./stage-2-deterministic";
import type { GateState } from "../../../contracts/investor-insights/schemas";
import {
	recordGovernedSkip,
	productProfileReasonToSkipCode,
	type GovernedSkip,
} from "./governed-skip";

export async function buildGovernedSummarySection(
	inputs: InsightSlotInputs,
	previousRecord: GovernedSummaryRecord | null,
	engineVersion: string,
	governanceVersion: string,
	dealName?: string,
	productNarrativeBody?: string,
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string }
): Promise<{ section: RenderPackage["sections"][number]; record: GovernedSummaryRecord } | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);
		const canonicalFieldsBody = phase2Result.fields.map(formatCanonicalFieldLine).join("\n");
		const conflictsBody =
			phase2Result.conflicts.length > 0
				? phase2Result.conflicts.map(formatConflictLine).join("\n")
				: null;
		const slotsSection = buildInsightSlotsSection(inputs);
		const insightSlotsBody =
			typeof slotsSection.body === "string" && slotsSection.body.trim().length > 0
				? slotsSection.body
				: null;
		const financialStmtBody = inputs.bestFinancialStatement
			? (buildFinancialStatementSection(inputs.bestFinancialStatement).body ?? null)
			: null;
		const useOfFundsBody = inputs.bestUseOfFundsStatement
			? (buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement).body ?? null)
			: null;
		const impliedCapitalBody = inputs.impliedCapitalAllocation
			? formatImpliedCapitalForCorpus(inputs.impliedCapitalAllocation)
			: null;
		const financialHealthBody = inputs.bestFinancialStatement
			? (buildFinancialHealthMetricsSection(inputs.bestFinancialStatement)?.body ?? null)
			: null;
		const financialReconciliationBody = inputs.financialReconciliation
			? (buildFinancialReconciliationSection(inputs.financialReconciliation).body ?? null)
			: null;

		const record = await resolveGovernedSummaryWithCache({
			canonicalFieldsBody,
			insightSlotsBody,
			financialStmtBody,
			useOfFundsBody,
			impliedCapitalBody,
			financialHealthBody,
			financialReconciliationBody,
			conflictsBody,
			previousRecord,
			engineVersion,
			governanceVersion,
			dealName: dealName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
		});

		if (!record || !record.validation_ok) {
			if (record && !record.validation_ok) {
				console.log(
					JSON.stringify({
						event: "GOVERNED_SUMMARY_V1_SKIP",
						reason: "validation_failed",
						unknown_tokens: record.unknown_tokens,
					})
				);
				recordGovernedSkip({
					stage: "governed_summary_v1",
					reason_code: "validation_failed",
					deal_id: opts?.deal_id,
					report_id: opts?.report_id,
					governedSkips: opts?.governedSkips,
				});
			} else {
				// record is null — LLM resolver returned nothing (cache miss + LLM unavailable)
				recordGovernedSkip({
					stage: "governed_summary_v1",
					reason_code: "unknown",
					deal_id: opts?.deal_id,
					report_id: opts?.report_id,
					governedSkips: opts?.governedSkips,
				});
			}
			return null;
		}

		console.log(
			JSON.stringify({
				event: "GOVERNED_SUMMARY_V1_RESOLVED",
				source: record.source,
				fingerprint: record.fingerprint,
				engine_version: engineVersion,
				governance_version: governanceVersion,
			})
		);

		const body = serializeGovernedSummaryBody(record.summary);

		// Dev-only: append corpus inclusion markers so E2E tooling can assert that
		// UoF inputs were included in the governed-summary corpus without a DB read.
		// Enabled when DEV_GOVERNED_MARKERS=1 in the environment; always omitted in production.
		let bodyFinal = body;
		if (process.env["NODE_ENV"] !== "production" && process.env["DEV_GOVERNED_MARKERS"] === "1") {
			const hasUofSlot =
				typeof insightSlotsBody === "string" &&
				/DERIVED_FROM_USE_OF_FUNDS/.test(insightSlotsBody);
			const hasBudgetSlot =
				typeof insightSlotsBody === "string" &&
				/DERIVED_FROM_BUDGET_MODEL/.test(insightSlotsBody);
			const markers = [
				`use_of_funds_slot=${hasUofSlot ? "true" : "false"}`,
				`use_of_funds_v1=${useOfFundsBody && inputs.bestUseOfFundsStatement ? "true" : "false"}`,
				`implied_capital_v1=${impliedCapitalBody ? "true" : "false"}`,
				`financial_health_v1=${financialHealthBody ? "true" : "false"}`,
				`financial_reconciliation_v1=${financialReconciliationBody ? "true" : "false"}`,
				`budget_model_slot=${hasBudgetSlot ? "true" : "false"}`,
			].join(", ");
			bodyFinal += `\n%%inputs_included: ${markers}%%`;
		}

		return {
			section: {
				key: "governed_summary_v1",
				title: "AI-Governed Investment Summary",
				kind: "message",
				body: bodyFinal,
				fallback: "Executive summary unavailable.",
			},
			record,
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "GOVERNED_SUMMARY_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		recordGovernedSkip({
			stage: "governed_summary_v1",
			reason_code: "unknown",
			deal_id: opts?.deal_id,
			report_id: opts?.report_id,
			governedSkips: opts?.governedSkips,
		});
		return null;
	}
}

/**
 * Asynchronously build the governed_executive_summary_v1 section using a
 * cache-first strategy that mirrors buildGovernedSummarySection.
 *
 * Uses the same corpus as governed_summary_v1 PLUS coverage and gate state so
 * the fingerprint invalidates when data coverage changes.
 *
 * Returns both the UI section and the GovernedExecutiveSummaryRecord for
 * persistence in report_payload.governed_executive_summary_v1.
 */
export async function buildGovernedExecutiveSummarySection(
	inputs: InsightSlotInputs,
	coverage: CoverageSnapshot,
	gateState: GateState,
	previousRecord: GovernedExecutiveSummaryRecord | null,
	engineVersion: string,
	governanceVersion: string,
	dealName?: string,
	productNarrativeBody?: string,
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string }
): Promise<{
	section: RenderPackage["sections"][number];
	record: GovernedExecutiveSummaryRecord;
} | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);
		const canonicalFieldsBody = phase2Result.fields.map(formatCanonicalFieldLine).join("\n");
		const conflictsBody =
			phase2Result.conflicts.length > 0
				? phase2Result.conflicts.map(formatConflictLine).join("\n")
				: null;
		const slotsSection = buildInsightSlotsSection(inputs);
		const insightSlotsBody =
			typeof slotsSection.body === "string" && slotsSection.body.trim().length > 0
				? slotsSection.body
				: null;
		const financialStmtBody = inputs.bestFinancialStatement
			? (buildFinancialStatementSection(inputs.bestFinancialStatement).body ?? null)
			: null;
		const useOfFundsBody = inputs.bestUseOfFundsStatement
			? (buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement).body ?? null)
			: null;
		const impliedCapitalBody = inputs.impliedCapitalAllocation
			? formatImpliedCapitalForCorpus(inputs.impliedCapitalAllocation)
			: null;
		const financialHealthBody = inputs.bestFinancialStatement
			? (buildFinancialHealthMetricsSection(inputs.bestFinancialStatement)?.body ?? null)
			: null;
		const financialReconciliationBody = inputs.financialReconciliation
			? (buildFinancialReconciliationSection(inputs.financialReconciliation).body ?? null)
			: null;

		// Deterministic coverage note (not passed to LLM — injected after generation)
		const coverageNote = formatCoverageNote({
			dpuNonemptyPages: coverage.dpuNonemptyPages,
			dpuPageCount: coverage.dpuPageCount,
			evidenceCount: coverage.evidenceCount,
		});

		// Deterministic gate state text for fingerprint only (not sent to LLM)
		const gateResults = gateState.results ?? [];
		const passCount = gateResults.filter((g) => g.passed).length;
		const failCount = gateResults.filter((g) => !g.passed).length;
		const gateStateText = `gates=${gateResults.length} pass=${passCount} fail=${failCount}`;

		const record = await resolveGovernedExecSummaryWithCache({
			canonicalFieldsBody,
			insightSlotsBody,
			financialStmtBody,
			useOfFundsBody,
			impliedCapitalBody,
			financialHealthBody,
			financialReconciliationBody,
			conflictsBody,
			coverageText: coverageNote,
			gateStateText,
			coverageNote,
			previousRecord,
			engineVersion,
			governanceVersion,
			dealName: dealName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
		});

		if (!record) {
			recordGovernedSkip({
				stage: "governed_executive_summary_v1",
				reason_code: "unknown",
				deal_id: opts?.deal_id,
				report_id: opts?.report_id,
				governedSkips: opts?.governedSkips,
			});
			return null;
		}

		if (!record.validation_ok) {
			const hasSummaryContent = record.summary.headline.trim().length > 0;
			console.warn(
				JSON.stringify({
					event: "GOVERNED_EXECUTIVE_SUMMARY_V1_WARN",
					reason: "validation_failed",
					unknown_tokens: record.unknown_tokens,
					has_content: hasSummaryContent,
				})
			);
			// If no content was preserved (hard LLM failure), drop the section.
			// When content IS present (soft parity failure), fall through and emit
			// the section with validated=false so the job is not blocked.
			if (!hasSummaryContent) {
				recordGovernedSkip({
					stage: "governed_executive_summary_v1",
					reason_code: "validation_failed",
					deal_id: opts?.deal_id,
					report_id: opts?.report_id,
					governedSkips: opts?.governedSkips,
				});
				return null;
			}
		}

		console.log(
			JSON.stringify({
				event: "GOVERNED_EXECUTIVE_SUMMARY_V1_RESOLVED",
				source: record.source,
				fingerprint: record.fingerprint,
				engine_version: engineVersion,
				governance_version: governanceVersion,
			})
		);

		const body = serializeGovernedExecSummaryBody(record.summary);

		return {
			section: {
				key: "governed_executive_summary_v1",
				title: "AI Executive Summary",
				kind: "message",
				body,
				fallback: "Executive summary unavailable.",
			},
			record,
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "GOVERNED_EXECUTIVE_SUMMARY_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		recordGovernedSkip({
			stage: "governed_executive_summary_v1",
			reason_code: "unknown",
			deal_id: opts?.deal_id,
			report_id: opts?.report_id,
			governedSkips: opts?.governedSkips,
		});
		return null;
	}
}

/**
 * Build the product_profile_v1 section using a governed LLM synthesis.
 *
 * Sources product narrative text from DPU pages (already filtered by
 * buildProductNarrativeBody), plus bounded evidence snippets for citation.
 * Returns null when product narrative is absent or LLM is unavailable.
 */
export async function buildProductProfileSection(
	inputs: InsightSlotInputs,
	canonicalFieldsBody: string | null,
	dealName?: string,
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string }
): Promise<RenderPackage["sections"][number] | null> {
	try {
		const productNarrativeBody = buildProductNarrativeBody(inputs);

		// Build bounded evidence snippets for citation
		const evidenceSnippets = inputs.evidenceSnippets
			.filter((e) => e.claim_text && e.claim_text.trim().length > 20)
			.slice(0, 8)
			.map((e) => ({ id: e.id, text: e.claim_text! }));

		const result = await generateProductProfileV1({
			productNarrativeBody,
			canonicalFieldsBody,
			evidenceSnippets,
			dealName,
		});

		if (!result.ok) {
			console.log(
				JSON.stringify({
					event: "PRODUCT_PROFILE_V1_SKIP",
					reason: result.reason,
				})
			);
			recordGovernedSkip({
				stage: "product_profile_v1",
				reason_code: productProfileReasonToSkipCode(result.reason),
				deal_id: opts?.deal_id,
				report_id: opts?.report_id,
				governedSkips: opts?.governedSkips,
			});
			return null;
		}

		console.log(
			JSON.stringify({
				event: "PRODUCT_PROFILE_V1_RESOLVED",
				product_type: result.value.product_type,
				ai_claims_present: result.value.ai_claims_present,
				ai_evidence_strength: result.value.ai_evidence_strength,
				sources_count: result.value.sources.length,
			})
		);

		return {
			key: "product_profile_v1",
			title: "Product Profile",
			kind: "message",
			body: serializeProductProfileBody(result.value),
			fallback: "Product profile unavailable.",
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "PRODUCT_PROFILE_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		recordGovernedSkip({
			stage: "product_profile_v1",
			reason_code: "unknown",
			deal_id: opts?.deal_id,
			report_id: opts?.report_id,
			governedSkips: opts?.governedSkips,
		});
		return null;
	}
}

/**
 * Build the deck_financial_signals_v1 section from pitch-deck–derived signal mentions.
 * Only emitted when extractDeckFinancialSignalsV1 found at least one mention.
 */

