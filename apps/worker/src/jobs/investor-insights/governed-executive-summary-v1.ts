/**
 * governed-executive-summary-v1.ts
 *
 * Governed LLM executive summary layer for the AI Analysis Tab.
 *
 * Produces a richer, narrative-quality executive summary with:
 *   - headline (1 line: company + stage + what they do)
 *   - one_liner (1 sentence elevator pitch)
 *   - paragraphs (2–4 narrative paragraphs)
 *   - strengths (3–6 bullets)
 *   - risks (3–6 bullets)
 *   - open_questions (3–6 bullets)
 *   - coverage_note (1–2 lines summarizing data quality)
 *
 * Design contract (same as governed-summary-v1.ts):
 *  - The LLM may ONLY restate, summarize, or rephrase values already
 *    present in the canonical input corpus.
 *  - It MUST NOT introduce any numbers, dollar amounts, percentages, or
 *    year values that do not appear verbatim (after normalization) in the
 *    canonical input text.
 *  - If the numeric-parity validator rejects the output, validation_ok=false
 *    is stored and the section is not rendered.
 *  - coverage_note IS generated deterministically (not by LLM) from the
 *    CoverageSnapshot, so it is exempt from numeric-parity checking.
 *  - All output tokens are persisted in report_payload; no separate DB table
 *    is required.
 */

import { createHash } from "crypto";
import {
	OpenAIGPT4oProvider,
} from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";
import { normalizeForFingerprint, validateNoNewNumbers, validateCompanyName, normalizeLlmFinanceShorthand } from "./governed-summary-v1";

// Re-export normalizeForFingerprint and validateCompanyName so consumers only need one import
export { normalizeForFingerprint, validateCompanyName };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GovernedExecutiveSummaryV1 {
	schema_version: "governed_executive_summary_v1";
	/**
	 * 1-line headline: company name + what they do + stage.
	 * E.g. "Acme Corp — SaaS platform for SMB logistics (Seed)"
	 */
	headline: string;
	/**
	 * 1-sentence elevator pitch.
	 * @deprecated — omitted in new LLM contract; retained for backward-compat with cached records.
	 */
	one_liner?: string;
	/**
	 * 3–6 analytical paragraphs covering product mechanics, differentiation,
	 * traction, and deal terms. No hallucinated numbers.
	 * Paragraphs are ordered: product → problem+diff → market/traction → deal terms.
	 */
	summary_paragraphs: string[];
	/** 3–5 key strengths. Each ≤120 chars. */
	strengths: string[];
	/** 3–5 key risks or areas of concern. Each ≤120 chars. */
	risks: string[];
	/** 3–5 open questions an investor should explore. Each ≤140 chars. */
	open_questions: string[];
	/**
	 * 1–2 line deterministic note about data coverage/quality.
	 * Generated directly from CoverageSnapshot values — NOT by LLM.
	 */
	coverage_note: string;
	/** True when numeric-parity validation passed. */
	validated: boolean;
}

export interface GovernedExecutiveSummaryArgs {
	canonicalFieldsBody: string | null;
	insightSlotsBody: string | null;
	financialStmtBody: string | null;
	useOfFundsBody: string | null;
	impliedCapitalBody: string | null;
	financialHealthBody: string | null;
	financialReconciliationBody: string | null;
	conflictsBody: string | null;
	/** Pre-formatted coverage note (injected by caller, not the LLM). */
	coverageNote: string;
	dealName?: string;
	/**
	 * Canonical company name resolved from document evidence.
	 * When present and different from dealName, the Deal Identity block will
	 * note both so the LLM uses the correct name from the deck.
	 */
	canonicalCompanyName?: string | null;
	/** Product/narrative text from non-financial deck pages. */
	productNarrativeBody?: string | null;
	/** PR36.9: Serialized contradiction markers body. */
	contradictionMarkersBody?: string | null;
}

export type GovernedExecutiveSummaryResult =
	| { ok: true; value: GovernedExecutiveSummaryV1 }
	// When ok=false and reason="numeric_parity_failed", `value` may be present
	// (containing the generated content with validated=false) so the caller can
	// soft-fail and still emit the section rather than dropping it entirely.
	| { ok: false; reason: string; unknownTokens?: string[]; value?: GovernedExecutiveSummaryV1 };

/**
 * Structured reason codes emitted in GOVERNED_EXECUTIVE_SUMMARY_V1_CACHE log events.
 */
export type ExecutiveSummaryCacheMissReason =
	| "cache_miss_no_previous"
	| "cache_miss_fingerprint_mismatch"
	| "cache_miss_validation_failed"
	| "cache_miss_force_recompute";

// ─── Persistence record ───────────────────────────────────────────────────────

/**
 * Persisted record stored under `report_payload.governed_executive_summary_v1`
 * in investor_insight_reports.
 */
export interface GovernedExecutiveSummaryRecord {
	schema_version: "governed_executive_summary_v1";
	/** SHA-256 of the deterministic input corpus at time of generation. */
	fingerprint: string;
	/** LLM model used (e.g. "gpt-4o-mini"). */
	model: string;
	/** ISO-8601 timestamp of when this summary was generated. */
	created_at: string;
	/** True when numeric-parity validation passed. */
	validation_ok: boolean;
	/** Numeric tokens that failed parity (empty when validation_ok=true). */
	unknown_tokens: string[];
	/** The validated summary content. */
	summary: GovernedExecutiveSummaryV1;
	/** "generated" = LLM was called; "cached" = reused from prior run. */
	source: "generated" | "cached";
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * All deterministic text inputs that the executive summary is allowed to use.
 * Any change in these inputs must produce a different fingerprint.
 * Includes coverage and gate state text (not present in governed_summary_v1).
 */
export interface GovernedExecutiveSummaryFingerprintInputs {
	canonicalText: string;
	slotsText: string;
	/** Deterministically-formatted coverage note (e.g. "23/30 pages; 47 evidence items"). */
	coverageText: string;
	/** Deterministically-formatted gate state summary (e.g. "PASS/FAIL/CONDITIONAL"). */
	gateStateText: string;
	fsText?: string | null;
	uofText?: string | null;
	impliedCapitalText?: string | null;
	financialHealthText?: string | null;
	financialReconciliationText?: string | null;
	conflictsText?: string | null;
	engineVersion?: string | null;
	governanceVersion?: string | null;
	/** Deal name for cache invalidation when name is first set. */
	dealNameText?: string | null;
	/**
	 * Canonical company name for cache invalidation (Fix F).
	 * When canonical identity newly resolves or changes, the fingerprint must
	 * change so the cached exec summary is not reused with the old identity.
	 */
	canonicalCompanyNameText?: string | null;
	/** Product narrative text for cache invalidation. */
	productNarrativeText?: string | null;
	/** PR36.9: Contradiction markers text for cache invalidation. */
	contradictionMarkersText?: string | null;
}

/**
 * Compute a stable SHA-256 fingerprint of the exec-summary input corpus.
 *
 * The fingerprint changes when:
 *  - Any of the canonical text inputs change
 *  - coverage or gate state text changes
 *  - engine_version or governance_version change
 */
export function computeGovernedExecSummaryFingerprintV1(
	inputs: GovernedExecutiveSummaryFingerprintInputs
): string {
	const obj = {
		schema: "governed_executive_summary_fingerprint_v1",
		canonical_fields: normalizeForFingerprint(inputs.canonicalText),
		insight_slots: normalizeForFingerprint(inputs.slotsText),
		coverage: normalizeForFingerprint(inputs.coverageText),
		gate_state: normalizeForFingerprint(inputs.gateStateText),
		financial_stmt: inputs.fsText ? normalizeForFingerprint(inputs.fsText) : null,
		use_of_funds: inputs.uofText ? normalizeForFingerprint(inputs.uofText) : null,
		implied_capital: inputs.impliedCapitalText ? normalizeForFingerprint(inputs.impliedCapitalText) : null,
		financial_health: inputs.financialHealthText ? normalizeForFingerprint(inputs.financialHealthText) : null,
		financial_reconciliation: inputs.financialReconciliationText ? normalizeForFingerprint(inputs.financialReconciliationText) : null,
		conflicts: inputs.conflictsText ? normalizeForFingerprint(inputs.conflictsText) : null,
		engine_version: inputs.engineVersion ?? null,
		governance_version: inputs.governanceVersion ?? null,
		deal_name: inputs.dealNameText ?? null,
		canonical_company_name: inputs.canonicalCompanyNameText ?? null,
		product_narrative: inputs.productNarrativeText ? normalizeForFingerprint(inputs.productNarrativeText) : null,
		contradiction_markers: inputs.contradictionMarkersText ? normalizeForFingerprint(inputs.contradictionMarkersText) : null,
	};
	// JSON.stringify with sorted keys for determinism
	const orderedKeys = Object.keys(obj).sort() as Array<keyof typeof obj>;
	const stable = JSON.stringify(
		Object.fromEntries(orderedKeys.map((k) => [k, obj[k]]))
	);
	return createHash("sha256").update(stable).digest("hex");
}

// ─── Coverage note formatter (deterministic — not LLM) ───────────────────────

/**
 * Build a deterministic 1–2 line coverage note from numeric coverage values.
 * This is NOT sent to the LLM — it is injected directly into the summary.
 */
export function formatCoverageNote(opts: {
	dpuNonemptyPages: number;
	dpuPageCount: number;
	evidenceCount: number;
}): string {
	const { dpuNonemptyPages, dpuPageCount, evidenceCount } = opts;
	const pct =
		dpuPageCount > 0
			? Math.round((dpuNonemptyPages / dpuPageCount) * 100)
			: 0;
	const coverageStr =
		dpuPageCount > 0
			? `${dpuNonemptyPages}/${dpuPageCount} pages parsed (${pct}%)`
			: "No document pages detected";
	const evidenceStr =
		evidenceCount > 0
			? `${evidenceCount} evidence item${evidenceCount !== 1 ? "s" : ""} extracted`
			: "No evidence items extracted";
	return `${coverageStr}. ${evidenceStr}.`;
}

// ─── Cache resolver (pure / injectable — fully unit-testable) ─────────────────

export interface ResolveGovernedExecSummaryArgs {
	canonicalFieldsBody: string | null;
	insightSlotsBody: string | null;
	financialStmtBody: string | null;
	useOfFundsBody: string | null;
	impliedCapitalBody: string | null;
	financialHealthBody: string | null;
	financialReconciliationBody: string | null;
	conflictsBody: string | null;
	/** Pre-formatted coverage text used in fingerprint (e.g. "23/30 pages; 47 evidence items"). */
	coverageText: string;
	/** Pre-formatted gate state text used in fingerprint (e.g. "stage=SEED gate=PASS"). */
	gateStateText: string;
	/** Pre-formatted coverage note to inject into summary (deterministic). */
	coverageNote: string;
	/** Previous persisted record for cache-hit check. */
	previousRecord: GovernedExecutiveSummaryRecord | null;
	/** ENGINE_VERSION pin for fingerprint. */
	engineVersion: string;
	/** GOVERNANCE_VERSION pin for fingerprint. */
	governanceVersion: string;
	dealName?: string;
	/**
	 * Canonical company name resolved from document evidence.
	 * When present and different from dealName, the Deal Identity block will
	 * note both so the LLM uses the correct name from the deck.
	 */
	canonicalCompanyName?: string | null;
	/** Product/narrative text from non-financial deck pages. */
	productNarrativeBody?: string | null;
	/** PR36.9: Serialized contradiction markers body. */
	contradictionMarkersBody?: string | null;
	/**
	 * When true, bypass the fingerprint cache and always regenerate via LLM.
	 * Used when the caller knows the truth state has materially changed (e.g.,
	 * force_recompute from a user-triggered force_refresh request).
	 */
	forceRecompute?: boolean;
	/**
	 * Injectable generate function — defaults to `generateGovernedExecSummaryV1`.
	 * Overriding in tests avoids any real LLM calls.
	 */
	generateFn?: (args: GovernedExecutiveSummaryArgs) => Promise<GovernedExecutiveSummaryResult>;
}

/**
 * Core cache logic for governed executive summaries (pure, no DB calls).
 *
 * Algorithm:
 *  1. Compute fingerprint of current corpus.
 *  2. If previousRecord exists, fingerprint matches, and validation_ok=true → cache hit.
 *  3. Otherwise call generateFn (LLM).
 *  4. Build + return a GovernedExecutiveSummaryRecord regardless of LLM outcome.
 *
 * Returns null only when there is no canonical data at all.
 */
export async function resolveGovernedExecSummaryWithCache(
	args: ResolveGovernedExecSummaryArgs
): Promise<GovernedExecutiveSummaryRecord | null> {
	const {
		canonicalFieldsBody,
		insightSlotsBody,
		financialStmtBody,
		useOfFundsBody,
		impliedCapitalBody,
		financialHealthBody,
		financialReconciliationBody,
		conflictsBody,
		coverageText,
		gateStateText,
		coverageNote,
		previousRecord,
		engineVersion,
		governanceVersion,
		dealName,
		canonicalCompanyName,
		productNarrativeBody,
		contradictionMarkersBody,
		forceRecompute = false,
		generateFn = generateGovernedExecSummaryV1,
	} = args;

	// Require at least canonical_fields or insight_slots to proceed
	if (!canonicalFieldsBody && !insightSlotsBody) {
		return null;
	}

	// Compute fingerprint of current inputs
	const fingerprint = computeGovernedExecSummaryFingerprintV1({
		canonicalText: canonicalFieldsBody ?? "",
		slotsText: insightSlotsBody ?? "",
		coverageText,
		gateStateText,
		fsText: financialStmtBody,
		uofText: useOfFundsBody,
		impliedCapitalText: impliedCapitalBody,
		financialHealthText: financialHealthBody,
		financialReconciliationText: financialReconciliationBody,
		conflictsText: conflictsBody,
		engineVersion,
		governanceVersion,
		dealNameText: dealName ?? null,
		canonicalCompanyNameText: canonicalCompanyName ?? null,
		productNarrativeText: productNarrativeBody ?? null,
		contradictionMarkersText: contradictionMarkersBody ?? null,
	});

	// ── Determine cache miss reason ───────────────────────────────────────────
	function resolveCacheOutcome():
		| { hit: true }
		| { hit: false; reason: ExecutiveSummaryCacheMissReason } {		if (forceRecompute) {
			return { hit: false, reason: "cache_miss_force_recompute" };
		}		if (previousRecord === null || previousRecord === undefined) {
			return { hit: false, reason: "cache_miss_no_previous" };
		}
		if (previousRecord.fingerprint !== fingerprint) {
			return { hit: false, reason: "cache_miss_fingerprint_mismatch" };
		}
		if (previousRecord.validation_ok !== true) {
			return { hit: false, reason: "cache_miss_validation_failed" };
		}
		if (previousRecord.summary === null || previousRecord.summary === undefined) {
			return { hit: false, reason: "cache_miss_validation_failed" };
		}
		return { hit: true };
	}
	const cacheOutcome = resolveCacheOutcome();

	// ── Emit structured observability log ─────────────────────────────────────
	console.log(
		JSON.stringify({
			event: "GOVERNED_EXECUTIVE_SUMMARY_V1_CACHE",
			outcome: cacheOutcome.hit ? "hit" : "miss",
			reason: cacheOutcome.hit ? "cache_hit" : cacheOutcome.reason,
			fingerprint: fingerprint.slice(0, 16) + "…",
			engine_version: engineVersion,
			governance_version: governanceVersion,
			previous_record_exists: previousRecord !== null,
		})
	);

	// ── Cache hit ─────────────────────────────────────────────────────────────
	if (cacheOutcome.hit) {
		return {
			...previousRecord!,
			source: "cached" as const,
		};
	}

	// ── Generate via LLM ──────────────────────────────────────────────────────
	const result = await generateFn({
		canonicalFieldsBody,
		insightSlotsBody,
		financialStmtBody,
		useOfFundsBody,
		impliedCapitalBody,
		financialHealthBody,
		financialReconciliationBody,
		conflictsBody,
		coverageNote,
		dealName,		canonicalCompanyName,		productNarrativeBody,
		contradictionMarkersBody,
	});

	if (result.ok) {
		return {
			schema_version: "governed_executive_summary_v1",
			fingerprint,
			model: "gpt-4o-mini",
			created_at: new Date().toISOString(),
			validation_ok: true,
			unknown_tokens: [],
			summary: result.value,
			source: "generated",
		};
	}

	// LLM failed or validation failed — persist failure record.
	// When the failure is numeric_parity only, result.value contains the
	// generated content so we can soft-fail instead of emitting an empty summary.
	return {
		schema_version: "governed_executive_summary_v1",
		fingerprint,
		model: "gpt-4o-mini",
		created_at: new Date().toISOString(),
		validation_ok: false,
		unknown_tokens: result.unknownTokens ?? [],
		summary: result.value ?? {
			schema_version: "governed_executive_summary_v1",
			headline: "",
			summary_paragraphs: [],
			strengths: [],
			risks: [],
			open_questions: [],
			coverage_note: coverageNote,
			validated: false,
		},
		source: "generated",
	};
}

// ─── Output quality validator (no LLM — deterministic) ───────────────────────

const MARKETING_FILLER_RE =
	/\b(cutting[- ]edge|innovative\s+solutions?|comprehensive\s+platform|best[- ]in[- ]class|state[- ]of[- ]the[- ]art|revolutionary|game[- ]changing|next[- ]generation|industry[- ]leading|disruptive(?:\s+technology)?|ground[- ]breaking)\b/i;

/**
 * Check LLM-generated output for institutional tone violations:
 *  - Marketing filler phrases (MARKETING_FILLER_RE)
 *  - TAM mentioned more than once
 *
 * Returns `{ ok: true }` when output is clean.
 * Returns `{ ok: false, issues: string[] }` listing each violation.
 *
 * Note: this does NOT gate persistence — violations are logged only.
 * Use alongside `validateNoNewNumbers` and `validateCompanyName`.
 */
export function validateOutputQuality(text: string): { ok: boolean; issues: string[] } {
	const issues: string[] = [];

	// Check for marketing filler
	const fillerMatch = MARKETING_FILLER_RE.exec(text);
	if (fillerMatch) {
		issues.push(`Marketing filler phrase detected: "${fillerMatch[0]}"`);
	}

	// Check TAM frequency — at most 1
	const tamMatches = [...text.matchAll(/\bTAM\b/g)];
	if (tamMatches.length > 1) {
		issues.push(`TAM mentioned ${tamMatches.length} times (max 1)`);
	}

	return { ok: issues.length === 0, issues };
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
	"You are an institutional investment analyst preparing an executive summary for an internal investment committee. " +
	"You will be given structured canonical data deterministically extracted from deal documents, " +
	"plus optional product/narrative context from pitch deck slides. " +
	"\n\nWrite analytically, not promotional. " +
	"Avoid marketing adjectives unless directly supported by evidence in the corpus. " +
	"\n\nPrioritize clarity of:\n" +
	"  1) What the company actually does (mechanics — not marketing language)\n" +
	"  2) Who it serves (customer segment, use case)\n" +
	"  3) The problem it solves (concretely)\n" +
	"  4) How it differentiates versus alternatives (only if supported in corpus)\n" +
	"  5) Traction or validation signals (only if present)\n" +
	"  6) Investment structure snapshot (briefly, in the final paragraph only)\n" +
	"\nIf information is missing, state that explicitly instead of generalizing." +
	"\n\nOUTPUT STRUCTURE — summary_paragraphs order:\n" +
	"  Paragraph 1: Product + customer — what the company builds and who uses it.\n" +
	"  Paragraph 2: Problem + differentiation — the specific problem solved and how this solution differs from alternatives. " +
	"    If no differentiation is explicitly described in the corpus, write exactly: " +
	"    'Differentiation versus incumbents is not clearly detailed in the provided materials.'\n" +
	"  Paragraph 3: Market context and traction signals (if present). TAM may be mentioned at most once.\n" +
	"  Paragraph 4 (final): Deal terms and financial metrics only. Do not repeat financials elsewhere.\n" +
	"\nSTRICT RULES — violation will cause your output to be discarded:\n" +
	"1. Use the exact company name from the Deal Identity section. NEVER substitute 'Startup Corp' or any other placeholder.\n" +
	"2. Do NOT introduce any numbers, dollar amounts, percentages, or year values NOT present in the canonical data.\n" +
	"3. Do NOT guess, extrapolate, or infer metrics not explicitly stated.\n" +
	"4. If a section has insufficient data, state that explicitly (e.g. 'Product details not available in the provided materials.').\n" +
	"5. headline: 1 line only — company name + specific value proposition + stage (e.g. 'Acme Corp — B2B route-optimization SaaS (Seed)').\n" +
	"6. summary_paragraphs: 3–6 paragraphs following the structure above. Financial raise must appear only in the final paragraph.\n" +
	"7. strengths: 3–5 bullets. Each ≤120 chars. Evidence-based only.\n" +
	"8. risks: 3–5 bullets. Each ≤120 chars.\n" +
	"9. open_questions: 3–5 bullets. Each ≤140 chars.\n" +
	"10. Do NOT use phrases like 'cutting-edge', 'innovative solutions', 'comprehensive platform', 'best-in-class', 'state-of-the-art', 'revolutionary', 'game-changing', or 'industry-leading' unless these exact words appear in the corpus.\n" +
	"11. TAM may be mentioned at most once across all paragraphs. Do not list TAM/SAM/SOM as a trio unless central to the thesis.\n" +
	"12. No sentence may begin with the company name more than once across all paragraphs.\n" +
	"13. Return ONLY valid JSON with exactly these keys:\n" +
	'    { "headline": "...", "summary_paragraphs": [...], "strengths": [...], "risks": [...], "open_questions": [...] }\n' +
	"14. No markdown. No code fences. No extra keys.\n" +
	"15. NARRATIVE EVIDENCE CONTRADICTIONS (PR36.9): When a '## Narrative Evidence Contradictions' section appears in the corpus:\n" +
	"    - A topic marked status=CONFLICTING: do NOT write a confident settled claim about that topic. " +
	"State instead: 'Materials present conflicting signals regarding [topic].'\n" +
	"    - A topic marked status=MIXED: qualify language — e.g. 'Materials suggest [claim] with mixed framing.' " +
	"or 'Evidence is not fully consistent regarding [topic].'\n" +
	"    - Do NOT invent reconciliation between conflicting claims. Preserve the uncertainty rather than choosing one interpretation.";

/**
 * Call gpt-4o-mini to generate a governed executive summary from canonical inputs.
 * Validates output has no hallucinated numbers before returning.
 * The coverage_note field is injected AFTER generation (deterministic, not LLM).
 */
export async function generateGovernedExecSummaryV1(
	args: GovernedExecutiveSummaryArgs
): Promise<GovernedExecutiveSummaryResult> {
	// Build canonical corpus for LLM context and parity validation.
	// Ordering: identity → product → market context → traction → financial health → deal terms → reconciliation.
	// This anchors the model on product mechanics before financial details.
	const parts: string[] = [];

	// 1. Deal Identity
	const displayName = args.canonicalCompanyName ?? args.dealName;
	if (displayName) {
		const hasCanonicalMismatch =
			args.canonicalCompanyName &&
			args.dealName &&
			args.canonicalCompanyName.toLowerCase() !== args.dealName.toLowerCase();

		const identityNote = hasCanonicalMismatch
			? `Deal name: ${args.canonicalCompanyName} (as named in submitted materials; entered as "${args.dealName}")`
			: `Deal name: ${displayName}`;
		parts.push(`## Deal Identity\n${identityNote}`);
	}

	// 2. Product Narrative — always inject a section; if absent, provide explicit placeholder
	if (args.productNarrativeBody && args.productNarrativeBody.trim().length > 0) {
		parts.push(`## Product Narrative\n${args.productNarrativeBody}`);
	} else {
		parts.push(`## Product Narrative\nProduct details not available in the provided materials.`);
	}

	// 3. Market Context (canonical fields — raise, market, stage)
	if (args.canonicalFieldsBody) parts.push(`## Market Context\n${args.canonicalFieldsBody}`);

	// 4. Traction Signals (insight slots)
	if (args.insightSlotsBody) parts.push(`## Traction Signals\n${args.insightSlotsBody}`);

	// 5. Financial Health
	if (args.financialHealthBody) parts.push(`## Financial Health\n${args.financialHealthBody}`);

	// 6. Deal Terms (financial statement, use of funds, implied capital)
	const dealTermsParts: string[] = [];
	if (args.financialStmtBody) dealTermsParts.push(args.financialStmtBody);
	if (args.useOfFundsBody) dealTermsParts.push(`Use of Funds:\n${args.useOfFundsBody}`);
	if (args.impliedCapitalBody) dealTermsParts.push(`Implied Capital:\n${args.impliedCapitalBody}`);
	if (dealTermsParts.length > 0) parts.push(`## Deal Terms\n${dealTermsParts.join("\n\n")}`);

	// 7. Reconciliation Signals
	if (args.financialReconciliationBody) parts.push(`## Reconciliation Signals\n${args.financialReconciliationBody}`);

	// 8. Conflicts
	if (args.conflictsBody) parts.push(`## Conflicting Fields\n${args.conflictsBody}`);

	// 9. Narrative evidence contradictions (PR36.9)
	if (args.contradictionMarkersBody) parts.push(`## Narrative Evidence Contradictions\n${args.contradictionMarkersBody}`);

	// Require at least one substantive section beyond the product placeholder
	const hasSubstantiveData = !!(args.canonicalFieldsBody || args.insightSlotsBody);
	if (!hasSubstantiveData) {
		return { ok: false, reason: "no_canonical_data" };
	}

	const canonicalCorpus = parts.join("\n\n");

	// Phase 4 — differentiation fallback instruction appended to user content
	const diffInstruction =
		"\n\n--- ANALYST INSTRUCTION ---\n" +
		"If no explicit differentiation language appears in the corpus above, write in the second paragraph: " +
		'"Differentiation versus incumbents is not clearly detailed in the provided materials."';

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return { ok: false, reason: "missing_openai_api_key" };
	}

	const providerConfig: ProviderConfig = {
		type: "openai",
		enabled: true,
		priority: 1,
		apiKey,
		timeout: 45_000,
		retries: 2,
	};

	const provider = new OpenAIGPT4oProvider(providerConfig);

	const userContent = canonicalCorpus + diffInstruction;

	let response: Awaited<ReturnType<typeof provider.complete>>;
	try {
		response = await provider.complete({
			task: "synthesis",
			model: "gpt-4o-mini" as any,
			temperature: 0,
			max_tokens: 1800,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userContent },
			],
			metadata: { kind: "governed_executive_summary_v1" },
		});
	} catch {
		return { ok: false, reason: "llm_call_failed" };
	}

	if (!response?.content) {
		return { ok: false, reason: "llm_empty_response" };
	}

	// Parse JSON output
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content.trim());
	} catch {
		const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
		if (!jsonMatch) return { ok: false, reason: "llm_output_not_json" };
		try {
			parsed = JSON.parse(jsonMatch[0]);
		} catch {
			return { ok: false, reason: "llm_output_not_json" };
		}
	}

	const p = parsed as Record<string, unknown>;
	if (
		!p ||
		typeof p !== "object" ||
		Array.isArray(p) ||
		typeof p.headline !== "string" ||
		!Array.isArray(p.summary_paragraphs) ||
		!Array.isArray(p.strengths) ||
		!Array.isArray(p.risks) ||
		!Array.isArray(p.open_questions)
	) {
		return { ok: false, reason: "llm_output_schema_mismatch" };
	}

	// Coerce arrays to string[]
	const toStringArray = (arr: unknown[], maxChars: number): string[] =>
		(arr as unknown[])
			.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
			.map((s) => s.trim().slice(0, maxChars));

	const headline = (p.headline as string).trim().slice(0, 200);
	const summary_paragraphs = toStringArray(p.summary_paragraphs as unknown[], 1000).slice(0, 6);
	const strengths = toStringArray(p.strengths as unknown[], 120).slice(0, 5);
	const risks = toStringArray(p.risks as unknown[], 120).slice(0, 5);
	const open_questions = toStringArray(p.open_questions as unknown[], 140).slice(0, 5);

	// Numeric-parity validation — only on LLM-generated text (not coverage_note).
	// Apply finance-shorthand normalization first so lowercase suffixes like "$3.5b"
	// and "$600m" are treated consistently, and the magnitude-expansion fallback
	// inside validateNoNewNumbers can resolve them against canonical full-integer
	// forms (e.g. "$3,500,000,000").
	const rawLlmOutput = [headline, ...summary_paragraphs, ...strengths, ...risks, ...open_questions].join(" ");
	const llmOutput = normalizeLlmFinanceShorthand(rawLlmOutput);
	const { ok: parityOk, unknown: unknownTokens } = validateNoNewNumbers(llmOutput, canonicalCorpus);

	if (!parityOk) {
		// Return the generated content alongside the failure so callers can
		// soft-fail (log a warning and still emit the section) rather than
		// dropping the executive summary entirely for borderline token cases.
		return {
			ok: false,
			reason: "numeric_parity_failed",
			unknownTokens,
			value: {
				schema_version: "governed_executive_summary_v1",
				headline,
				summary_paragraphs,
				strengths,
				risks,
				open_questions,
				coverage_note: args.coverageNote,
				validated: false,
			},
		};
	}

	return {
		ok: true,
		value: {
			schema_version: "governed_executive_summary_v1",
			headline,
			summary_paragraphs,
			strengths,
			risks,
			open_questions,
			// coverage_note injected from args (deterministic — not LLM output)
			coverage_note: args.coverageNote,
			validated: true,
		},
	};
}

// ─── Section body serializer ──────────────────────────────────────────────────

/**
 * Serialize a GovernedExecutiveSummaryV1 to a human-readable body string suitable
 * for the render_package section body field.
 *
 * Embeds structured JSON after a delimiter for UI parsing without a separate field.
 */
export function serializeGovernedExecSummaryBody(value: GovernedExecutiveSummaryV1): string {
	const lines: string[] = [];

	lines.push(value.headline);
	lines.push("");

	// one_liner is deprecated — only emit if present (backward compat with old cached records)
	if (value.one_liner) {
		lines.push(value.one_liner);
		lines.push("");
	}

	const paragraphs = value.summary_paragraphs ?? [];
	if (paragraphs.length > 0) {
		paragraphs.forEach((p) => {
			lines.push(p);
			lines.push("");
		});
	}

	if (value.strengths.length > 0) {
		lines.push("Strengths");
		value.strengths.forEach((s) => lines.push(`• ${s}`));
		lines.push("");
	}

	if (value.risks.length > 0) {
		lines.push("Risks");
		value.risks.forEach((r) => lines.push(`• ${r}`));
		lines.push("");
	}

	if (value.open_questions.length > 0) {
		lines.push("Open Questions");
		value.open_questions.forEach((q) => lines.push(`• ${q}`));
		lines.push("");
	}

	if (value.coverage_note) {
		lines.push(`Coverage: ${value.coverage_note}`);
		lines.push("");
	}

	// Embed structured JSON for UI parsing
	lines.push("---governed_executive_summary_v1_json---");
	lines.push(JSON.stringify(value));

	return lines.join("\n");
}

/**
 * Parse a GovernedExecutiveSummaryV1 from a section body string previously
 * created by serializeGovernedExecSummaryBody. Returns null on parse failure.
 */
export function parseGovernedExecSummaryBody(body: string): GovernedExecutiveSummaryV1 | null {
	const delimiter = "---governed_executive_summary_v1_json---\n";
	const idx = body.indexOf(delimiter);
	if (idx === -1) return null;
	try {
		const json = body.slice(idx + delimiter.length).trim();
		const parsed = JSON.parse(json) as GovernedExecutiveSummaryV1;
		if (parsed?.schema_version !== "governed_executive_summary_v1") return null;
		return parsed;
	} catch {
		return null;
	}
}
