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
	buildDeckFinancialSignalsSection,
	buildProductSignalsBundleSection,
	buildGtmSignalsBundleSection,
	extractPhase2Result,
	formatCanonicalFieldLine,
	formatConflictLine,
	buildProductNarrativeBody,
	buildProductNarrativeBundle,
} from "./stage-2-deterministic";
import {
	serializeContradictionMarkersBody,
	type NarrativeContradictionBundle,
} from "../narrative-contradiction-v1";
import { buildFullContradictionBundle } from "./stage-2-deterministic";
import type { GateState } from "../../../contracts/investor-insights/schemas";
import {
	recordGovernedSkip,
	productProfileReasonToSkipCode,
	llmInterpretationReasonToSkipCode,
	type GovernedSkip,
} from "./governed-skip";
import {
	generateLlmInterpretationV1,
	serializeLlmInterpretationBody,
	type LlmInterpretationV1,
} from "../llm-interpretation-v1";
import {
	generateKeyFactsSynthesisV1,
	serializeKeyFactsSynthesisBody,
} from "../llm-key-facts-synthesis-v1";

export async function buildGovernedSummarySection(
	inputs: InsightSlotInputs,
	previousRecord: GovernedSummaryRecord | null,
	engineVersion: string,
	governanceVersion: string,
	dealName?: string,
	productNarrativeBody?: string,
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string; forceRecompute?: boolean },
	canonicalCompanyName?: string | null
): Promise<{ section: RenderPackage["sections"][number]; record: GovernedSummaryRecord } | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);

		// Phase 4 (numeric-context gate): exclude CONFLICTING-confidence fields from
		// canonicalFieldsBody so that unresolved cross-source conflicts cannot be
		// presented as definitive facts in the governed narrative.
		// The values are still visible in conflictsBody as WITHHELD notices, so the
		// LLM knows to hedge language appropriately for those fields.
		const safeFields = phase2Result.fields.filter(
			(f) => f.confidence !== "CONFLICTING"
		);
		const withheldConflictedFields = phase2Result.fields.filter(
			(f) => f.confidence === "CONFLICTING"
		);
		const canonicalFieldsBody = safeFields.map(formatCanonicalFieldLine).join("\n");

		// Build conflicts body, augmented with withheld-conflict notices for any
		// CONFLICTING-confidence Computable fields that were excluded above.
		const conflictLines = phase2Result.conflicts.map(formatConflictLine);
		for (const f of withheldConflictedFields) {
			if (f.computability === "Computable" && f.value !== null) {
				conflictLines.push(
					`WITHHELD field=${f.field} | reason=CONFLICTING_FIELD_SUPPRESSED | value_withheld="${f.value}" | confidence=CONFLICTING`
				);
			}
		}
		const conflictsBody = conflictLines.length > 0 ? conflictLines.join("\n") : null;

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

		// PR36.9: Compute full 7-topic contradiction bundle once in stage-2 (deterministic).
		const gsContradictionBundle: NarrativeContradictionBundle =
			buildFullContradictionBundle(inputs);
		const contradictionMarkersBody = serializeContradictionMarkersBody(gsContradictionBundle);

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
			canonicalCompanyName: canonicalCompanyName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
			contradictionMarkersBody,
			forceRecompute: opts?.forceRecompute ?? false,
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

		// Inject evidence_refs deterministically from inputs — not LLM-generated.
		// This populates the field after validation so it doesn't affect fingerprinting.
		const evidenceIds = inputs.evidenceSnippets.map((ev) => ev.id).filter(Boolean);
		if (evidenceIds.length > 0) {
			record.summary.evidence_refs = evidenceIds;
		}

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
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string; forceRecompute?: boolean },
	canonicalCompanyName?: string | null
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

		// PR36.9: Compute full 7-topic contradiction bundle once in stage-2 (deterministic).
		const execContradictionBundle: NarrativeContradictionBundle =
			buildFullContradictionBundle(inputs);
		const execContradictionMarkersBody = serializeContradictionMarkersBody(execContradictionBundle);

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
			canonicalCompanyName: canonicalCompanyName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
			contradictionMarkersBody: execContradictionMarkersBody,
			forceRecompute: opts?.forceRecompute ?? false,
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
 * Build the key_facts_synthesis_v1 section — global Key Facts recovery path.
 *
 * Synthesizes investor-readable 1–2 sentence narratives for the four Key Facts cards
 * (product, market, business_model, raise_terms) from broader evidence when raw
 * extraction quality is insufficient.
 *
 * This section is read by the UI as the highest-priority candidate for all Key Facts
 * fields, superseding raw structured extractions and falling back gracefully.
 *
 * Returns null when evidence is insufficient or the LLM is unavailable.
 */
export async function buildKeyFactsSynthesisSection(
	inputs: InsightSlotInputs,
	canonicalFieldsBody: string | null,
	/** Serialized ProductProfileV1 JSON string from the product_profile_v1 section, if available. */
	productProfileBody: string | null,
	dealName?: string,
	opts?: { governedSkips?: GovernedSkip[]; deal_id?: string; report_id?: string }
): Promise<RenderPackage["sections"][number] | null> {
	try {
		const productNarrativeBody = buildProductNarrativeBody(inputs);
		const slotsSection = buildInsightSlotsSection(inputs);
		const insightSlotsBody =
			typeof slotsSection.body === "string" && slotsSection.body.trim().length > 0
				? slotsSection.body
				: null;

		const evidenceSnippets = inputs.evidenceSnippets
			.filter((e) => e.claim_text && e.claim_text.trim().length > 20)
			.slice(0, 8)
			.map((e) => ({ id: e.id, text: e.claim_text! }));

		const result = await generateKeyFactsSynthesisV1({
			productProfileBody,
			productNarrativeBody,
			insightSlotsBody,
			canonicalFieldsBody,
			evidenceSnippets,
			dealName,
		});

		if (!result.ok) {
			console.log(
				JSON.stringify({
					event: "KEY_FACTS_SYNTHESIS_V1_SKIP",
					reason: result.reason,
					deal_id: opts?.deal_id,
				})
			);
			return null;
		}

		console.log(
			JSON.stringify({
				event: "KEY_FACTS_SYNTHESIS_V1_RESOLVED",
				product_status: result.value.diagnostics.product.synthesis_status,
				market_status: result.value.diagnostics.market.synthesis_status,
				business_model_status: result.value.diagnostics.business_model.synthesis_status,
				raise_terms_status: result.value.diagnostics.raise_terms.synthesis_status,
				deal_id: opts?.deal_id,
			})
		);

		return {
			key: "key_facts_synthesis_v1",
			title: "Key Facts Synthesis",
			kind: "message",
			body: serializeKeyFactsSynthesisBody(result.value),
			fallback: "Key facts synthesis unavailable.",
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "KEY_FACTS_SYNTHESIS_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
				deal_id: opts?.deal_id,
			})
		);
		return null;
	}
}

/**
 * Build the deck_financial_signals_v1 section from pitch-deck–derived signal mentions.
 * Only emitted when extractDeckFinancialSignalsV1 found at least one mention.
 */

// ─── PR34: LLM Interpretation section ────────────────────────────────────────

/**
 * Build the llm_interpretation_v1 section — investment posture, confidence,
 * executive summary, strengths, risks, and next questions.
 *
 * Called AFTER deterministic stages complete in both the happy path (evidence
 * gate passed) and the evidence-gate-fail path (with evidenceCaveat=true).
 *
 * Returns null when the LLM is unavailable or the output fails validation.
 * Failure is non-fatal; the governing principle is "no section is better than
 * a hallucinated section".
 */
export async function buildLlmInterpretationSection(
	inputs: InsightSlotInputs,
	opts?: {
		evidenceCaveat?: boolean;
		governedSkips?: GovernedSkip[];
		deal_id?: string;
		report_id?: string;
		dealName?: string;
		productNarrativeBody?: string | null;
		/** PR35: serialised external diligence body from runExternalDiligenceV1 */
		externalDiligenceBody?: string | null;
	}
): Promise<RenderPackage["sections"][number] | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);
		const canonicalFieldsBody = phase2Result.fields.length > 0
			? phase2Result.fields.map(formatCanonicalFieldLine).join("\n")
			: null;
		const conflictsBody = phase2Result.conflicts.length > 0
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
		const financialHealthBody = inputs.bestFinancialStatement
			? (buildFinancialHealthMetricsSection(inputs.bestFinancialStatement)?.body ?? null)
			: null;
		const financialReconciliationBody = inputs.financialReconciliation
			? (buildFinancialReconciliationSection(inputs.financialReconciliation).body ?? null)
			: null;
		const deckFinancialSignalsBody = inputs.deckFinancialSignals
			? (buildDeckFinancialSignalsSection(inputs.deckFinancialSignals).body ?? null)
			: null;
		const productSignalsBundle = buildProductSignalsBundleSection(inputs);
		const gtmSignalsBundle = buildGtmSignalsBundleSection(inputs);
		const productNarrativeBundle = buildProductNarrativeBundle(inputs);

		const productSignalsBundleBody = productSignalsBundle.body ?? null;
		const gtmSignalsBundleBody = gtmSignalsBundle.body ?? null;

		// PR36.9: Compute full 7-topic contradiction bundle once in stage-2 (deterministic).
		const contradictionBundle: NarrativeContradictionBundle =
			buildFullContradictionBundle(inputs);
		const contradictionMarkersBody = serializeContradictionMarkersBody(contradictionBundle);

		// Use productNarrativeBody from opts (caller-provided) if given, otherwise derive
		// from the already-ranked product narrative bundle computed above.
		const productNarrativeBody =
			opts?.productNarrativeBody ?? productNarrativeBundle.selectedText ?? null;

		const result = await generateLlmInterpretationV1({
			canonicalFieldsBody,
			insightSlotsBody,
			financialStmtBody,
			useOfFundsBody,
			financialHealthBody,
			financialReconciliationBody,
			deckFinancialSignalsBody,
			productSignalsBundleBody,
			gtmSignalsBundleBody,
			externalDiligenceBody: opts?.externalDiligenceBody ?? null,
			conflictsBody,
			dealName: opts?.dealName ?? undefined,
			productNarrativeBody,
			contradictionMarkersBody,
			evidenceCaveat: opts?.evidenceCaveat ?? false,
		});

		if (!result.ok) {
			console.log(
				JSON.stringify({
					event: "LLM_INTERPRETATION_V1_SKIP",
					reason: result.reason,
					deal_id: opts?.deal_id ?? null,
				})
			);
			if (opts?.governedSkips) {
				recordGovernedSkip({
					stage: "llm_interpretation_v1",
					reason_code: llmInterpretationReasonToSkipCode(result.reason),
					deal_id: opts?.deal_id,
					report_id: opts?.report_id,
					governedSkips: opts.governedSkips,
				});
			}
			return null;
		}

		console.log(
			JSON.stringify({
				event: "LLM_INTERPRETATION_V1_RESOLVED",
				posture: result.value.posture,
				confidence: result.value.confidence,
				evidence_caveat: result.value.evidence_caveat !== null,
				deal_id: opts?.deal_id ?? null,
			})
		);

		return {
			key: "llm_interpretation_v1",
			title: "Investment Interpretation",
			kind: "message",
			body: serializeLlmInterpretationBody(result.value),
			fallback: "Investment interpretation unavailable.",
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "LLM_INTERPRETATION_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
				deal_id: opts?.deal_id ?? null,
			})
		);
		if (opts?.governedSkips) {
			recordGovernedSkip({
				stage: "llm_interpretation_v1",
				reason_code: "unknown",
				deal_id: opts?.deal_id,
				report_id: opts?.report_id,
				governedSkips: opts.governedSkips,
			});
		}
		return null;
	}
}

// Re-export LlmInterpretationV1 type for consumers that import from this stage module.
export type { LlmInterpretationV1 } from "../llm-interpretation-v1";