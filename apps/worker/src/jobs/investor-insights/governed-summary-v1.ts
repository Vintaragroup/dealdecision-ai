/**
 * governed-summary-v1.ts
 *
 * Governed LLM summary layer for the Investor Insights render_package.
 *
 * Design contract:
 *  - The LLM may ONLY restate, summarize, or rephrase values already
 *    present in the canonical input corpus.
 *  - It MUST NOT introduce any numbers, dollar amounts, percentages, or
 *    year values that do not appear verbatim (after normalization) in the
 *    canonical input text.
 *  - If the numeric-parity validator rejects the output, a deterministic
 *    fallback message is returned instead (ok: false, reason: "numeric_parity_failed").
 *  - All output tokens are persisted in report_payload; no separate DB table
 *    is required.
 */

import { createHash } from "crypto";
import {
	OpenAIGPT4oProvider,
} from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GovernedSummaryV1 {
	schema_version: "governed_summary_v1";
	/**
	 * 2–4 sentence executive summary of the investment opportunity.
	 * No new numbers beyond those in canonical data.
	 */
	executive_summary: string;
	/** 3–5 key strengths. Each ≤100 chars. */
	strengths: string[];
	/** 3–5 key risks or areas of concern. Each ≤100 chars. */
	risks: string[];
	/** 2–4 open questions an investor should explore. Each ≤120 chars. */
	open_questions: string[];
	/** True when numeric-parity validation passed. */
	validated: boolean;
}

export interface GovernedSummaryArgs {
	canonicalFieldsBody: string | null;
	insightSlotsBody: string | null;
	financialStmtBody: string | null;
	useOfFundsBody: string | null;
	impliedCapitalBody: string | null;
	financialHealthBody: string | null;
	financialReconciliationBody: string | null;
	conflictsBody: string | null;
	dealName?: string;
	/** Product/narrative text from deck pages (not financial tables). */
	productNarrativeBody?: string | null;
}

export type GovernedSummaryResult =
	| { ok: true; value: GovernedSummaryV1 }
	| { ok: false; reason: string; unknownTokens?: string[] };

/**
 * Structured reason codes emitted in GOVERNED_SUMMARY_V1_CACHE log events.
 * Used for operational dashboards and alerting.
 */
export type CacheMissReason =
	| "cache_miss_no_previous"
	| "cache_miss_fingerprint_mismatch"
	| "cache_miss_validation_failed";

// ─── Persistence record (stored in report_payload.governed_summary_v1) ───────

/**
 * Persisted record that accompanies every governed summary generation attempt.
 * Stored under `report_payload.governed_summary_v1` in investor_insight_reports.
 */
export interface GovernedSummaryRecord {
	schema_version: "governed_summary_v1";
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
	summary: GovernedSummaryV1;
	/** "generated" = LLM was called; "cached" = reused from prior run. */
	source: "generated" | "cached";
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * All deterministic text inputs that the governed summary is allowed to use.
 * Any change in these inputs must produce a different fingerprint.
 */
export interface GovernedSummaryFingerprintInputs {
	canonicalText: string;
	slotsText: string;
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
	/** Product narrative text for cache invalidation. */
	productNarrativeText?: string | null;
}

/**
 * Normalise a text string so that superficial whitespace differences
 * (trailing spaces, mixed line-endings, double-spaces) never change the
 * fingerprint while meaningful content differences always do.
 */
export function normalizeForFingerprint(s: string): string {
	return s
		.replace(/\r\n/g, "\n")   // normalize CRLF → LF
		.replace(/\s+/g, " ")     // collapse all whitespace runs to a single space
		.trim();
}

/**
 * Compute a stable SHA-256 fingerprint of the governed-summary input corpus.
 *
 * The fingerprint changes when:
 *  - Any of the canonical text inputs change
 *  - engine_version or governance_version change
 *
 * The fingerprint is stable across runs for identical inputs.
 */
export function computeGovernedSummaryFingerprintV1(
	inputs: GovernedSummaryFingerprintInputs
): string {
	const obj = {
		schema: "governed_summary_fingerprint_v1",
		canonical_fields: normalizeForFingerprint(inputs.canonicalText),
		insight_slots: normalizeForFingerprint(inputs.slotsText),
		financial_stmt: inputs.fsText ? normalizeForFingerprint(inputs.fsText) : null,
		use_of_funds: inputs.uofText ? normalizeForFingerprint(inputs.uofText) : null,
		implied_capital: inputs.impliedCapitalText ? normalizeForFingerprint(inputs.impliedCapitalText) : null,
		financial_health: inputs.financialHealthText ? normalizeForFingerprint(inputs.financialHealthText) : null,
		financial_reconciliation: inputs.financialReconciliationText ? normalizeForFingerprint(inputs.financialReconciliationText) : null,
		conflicts: inputs.conflictsText ? normalizeForFingerprint(inputs.conflictsText) : null,
		engine_version: inputs.engineVersion ?? null,
		governance_version: inputs.governanceVersion ?? null,
		deal_name: inputs.dealNameText ?? null,
		product_narrative: inputs.productNarrativeText ? normalizeForFingerprint(inputs.productNarrativeText) : null,
	};
	// JSON.stringify with sorted keys for determinism
	const orderedKeys = Object.keys(obj).sort() as Array<keyof typeof obj>;
	const stable = JSON.stringify(
		Object.fromEntries(orderedKeys.map((k) => [k, obj[k]]))
	);
	return createHash("sha256").update(stable).digest("hex");
}

// ─── Cache resolver (pure / injectable — fully unit-testable) ─────────────────

export interface ResolveGovernedSummaryArgs {
	/** Pre-extracted canonical-fields section body text. */
	canonicalFieldsBody: string | null;
	/** Pre-extracted insight_slots section body text. */
	insightSlotsBody: string | null;
	/** Pre-extracted financial_statement section body text (if any). */
	financialStmtBody: string | null;
	/** Pre-extracted use_of_funds section body text (if any). */
	useOfFundsBody: string | null;
	/** Pre-extracted implied_capital_allocation section body text (if any). */
	impliedCapitalBody: string | null;
	/** Pre-extracted financial_health_metrics section body text (if any). */
	financialHealthBody: string | null;
	/** Pre-extracted financial_reconciliation section body text (if any). */
	financialReconciliationBody: string | null;
	/** Pre-extracted conflicts section body text (if any). */
	conflictsBody: string | null;
	/** Previous persisted GovernedSummaryRecord to test for cache hit. */
	previousRecord: GovernedSummaryRecord | null;
	/** ENGINE_VERSION pin for fingerprint. */
	engineVersion: string;
	/** GOVERNANCE_VERSION pin for fingerprint. */
	governanceVersion: string;
	/** Optional deal name for LLM context and fingerprint invalidation. */
	dealName?: string;
	/** Product/narrative text from non-financial deck pages. */
	productNarrativeBody?: string | null;
	/**
	 * Injectable generate function — defaults to `generateGovernedSummaryV1`.
	 * Overriding this in tests avoids any real LLM calls.
	 */
	generateFn?: (args: GovernedSummaryArgs) => Promise<GovernedSummaryResult>;
}

/**
 * Core cache logic for governed summaries (pure, no DB calls).
 *
 * Algorithm:
 *  1. Compute fingerprint of current corpus.
 *  2. If previousRecord exists, fingerprint matches, and validation_ok=true → return cache hit.
 *  3. Otherwise call generateFn (LLM).
 *  4. Build + return a GovernedSummaryRecord regardless of LLM outcome.
 *     When LLM fails → record with validation_ok=false; callers should decide
 *     whether to render a section from it.
 *
 * Returns null only when there is no canonical data at all.
 */
export async function resolveGovernedSummaryWithCache(
	args: ResolveGovernedSummaryArgs
): Promise<GovernedSummaryRecord | null> {
	const {
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
		dealName,
		productNarrativeBody,
		generateFn = generateGovernedSummaryV1,
	} = args;

	// Require at least canonical_fields or insight_slots to proceed
	if (!canonicalFieldsBody && !insightSlotsBody) {
		return null;
	}

	// Compute fingerprint of current inputs
	const fingerprint = computeGovernedSummaryFingerprintV1({
		canonicalText: canonicalFieldsBody ?? "",
		slotsText: insightSlotsBody ?? "",
		fsText: financialStmtBody,
		uofText: useOfFundsBody,
		impliedCapitalText: impliedCapitalBody,
		financialHealthText: financialHealthBody,
		financialReconciliationText: financialReconciliationBody,
		conflictsText: conflictsBody,
		engineVersion,
		governanceVersion,
		dealNameText: dealName ?? null,
		productNarrativeText: productNarrativeBody ?? null,
	});

	// ── Determine cache miss reason (for observability) ──────────────────────
	function resolveCacheOutcome(): { hit: true } | { hit: false; reason: CacheMissReason } {
		if (previousRecord === null || previousRecord === undefined) {
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
			event: "GOVERNED_SUMMARY_V1_CACHE",
			outcome: cacheOutcome.hit ? "hit" : "miss",
			reason: cacheOutcome.hit ? "cache_hit" : cacheOutcome.reason,
			fingerprint: fingerprint.slice(0, 16) + "…",
			engine_version: engineVersion,
			governance_version: governanceVersion,
			previous_record_exists: previousRecord !== null,
		})
	);

	// ── Cache hit check ───────────────────────────────────────────────────────
	if (cacheOutcome.hit) {
		// Return a cloned record marked as cached
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
		dealName,		productNarrativeBody,	});

	if (result.ok) {
		return {
			schema_version: "governed_summary_v1",
			fingerprint,
			model: "gpt-4o-mini",
			created_at: new Date().toISOString(),
			validation_ok: true,
			unknown_tokens: [],
			summary: result.value,
			source: "generated",
		};
	}

	// LLM failed or validation failed — record the failure but don't surface a section
	return {
		schema_version: "governed_summary_v1",
		fingerprint,
		model: "gpt-4o-mini",
		created_at: new Date().toISOString(),
		validation_ok: false,
		unknown_tokens: result.unknownTokens ?? [],
		// Stub summary so the record is always structurally valid for persistence
		summary: {
			schema_version: "governed_summary_v1",
			executive_summary: "",
			strengths: [],
			risks: [],
			open_questions: [],
			validated: false,
		},
		source: "generated",
	};
}

// ─── Numeric-parity validator ─────────────────────────────────────────────────

/**
 * Regex covering numeric tokens that an LLM might hallucinate:
 *   - Dollar amounts:   $3,337,000  $2M  $1.5B  $500K
 *   - Percentages:      364.5%  60%  12.3%
 *   - Recent years:     2024  2025  2026  2027  2028  2029
 */
const NUMERIC_TOKEN_RE =
	/\$[\d,]+(?:\.\d+)?(?:\s*[BMKbmkTt]{1,2})?|\b[\d,]+(?:\.\d+)?%|20[2-9]\d\b/g;

/**
 * Normalize a numeric string for comparison:
 *   - Remove commas from digit sequences ($3,337,000 → $3337000)
 *   - Collapse whitespace ($2 M → $2M)
 *   - Strip trailing decimal zeros (60.00% → 60%, $1.50M → $1.5M)
 *   - Lowercase (for letter suffixes B/M/K and % sign)
 *   - Trim
 */
function normalizeNumToken(t: string): string {
	let s = t
		.replace(/,(?=\d)/g, "")  // strip digit-grouping commas
		.replace(/\s+/g, "")       // collapse whitespace (e.g., "$2 M" → "$2M")
		.toLowerCase()
		.trim();

	// Strip trailing decimal zeros before %, suffix letters, or end of string:
	//   "60.00%"  → "60%"    (pure zero decimal: ".00" removed)
	//   "1.50m"   → "1.5m"   (significant digit before trailing zeros: "0" stripped)
	//   "364.5%"  → "364.5%" (no trailing zeros: unchanged)
	s = s.replace(/(\d\.[1-9]*[1-9])0+(?=[%bmkt]|$)/g, "$1"); // strip trailing zeros after sig digit
	s = s.replace(/(\d)\.0+(?=[%bmkt]|$)/g, "$1");             // strip ".<all zeros>" entirely

	return s;
}

/**
 * Extract and normalize all numeric tokens from `text`.
 */
function extractNumericTokens(text: string): Set<string> {
	const tokens = new Set<string>();
	let m: RegExpExecArray | null;
	NUMERIC_TOKEN_RE.lastIndex = 0;
	while ((m = NUMERIC_TOKEN_RE.exec(text)) !== null) {
		tokens.add(normalizeNumToken(m[0]));
	}
	return tokens;
}

/**
 * Normalize finance shorthand suffixes in LLM output text to uppercase before
 * parity validation.  This is applied to LLM-generated text only (not canonical
 * corpus text) so that the two sides share a consistent token form.
 *
 * Examples:
 *   "$3.5b"  → "$3.5B"
 *   "$600m"  → "$600M"
 *   "$120k"  → "$120K"
 *   "$1.2T"  → "$1.2T" (already uppercase — no-op)
 *
 * Only the suffix letter following a dollar-prefixed number is uppercased; all
 * other text is left unchanged.
 */
export function normalizeLlmFinanceShorthand(text: string): string {
	// Match $<digits>[.<digits>]<k|m|b|t> (case-insensitive suffix).
	// The suffix must be a word boundary or followed by non-alphanumeric chars.
	return text.replace(/(\$[\d,]+(?:\.\d+)?)([kmbtKMBT])(?![a-zA-Z0-9])/g, (_, num, suffix) =>
		num + suffix.toUpperCase()
	);
}

/**
 * Expand a normalized shorthand token (e.g. "$3.5b") to its integer dollar
 * form (e.g. "$3500000000") for magnitude-equivalence fallback checks.
 *
 * Returns null when the token is not a recognized shorthand form.
 *
 * This is used as a fallback inside `validateNoNewNumbers` so that LLM output
 * using abbreviated forms passes when the canonical corpus expresses the same
 * value as a full integer (e.g. "$3,500,000,000").
 */
export function expandShorthandToken(normalized: string): string | null {
	// normalized token looks like "$3.5b", "$600m", "$120k", "$1.2t" (lowercase suffix)
	const m = /^\$([\d]+(?:\.[\d]+)?)([kmbt])$/.exec(normalized);
	if (!m) return null;
	const num = parseFloat(m[1]);
	const suffix = m[2];
	let multiplier: number;
	switch (suffix) {
		case "k": multiplier = 1_000; break;
		case "m": multiplier = 1_000_000; break;
		case "b": multiplier = 1_000_000_000; break;
		case "t": multiplier = 1_000_000_000_000; break;
		default: return null;
	}
	const expanded = Math.round(num * multiplier);
	return `$${expanded}`;
}

/**
 * Validate that every numeric token in `outputText` is present
 * (after normalization) in `canonicalText`.
 *
 * Accepts a token when ANY of the following holds:
 *  1. The normalized token appears as a substring of the normalized canonical text.
 *  2. The magnitude-expanded form of the token (e.g. "$3500000000" for "$3.5b")
 *     appears as a substring of the normalized canonical text.
 *
 * This allows LLM output using abbreviated shorthand (e.g. "$3.5B", "$600M")
 * to pass when the canonical corpus expresses the same value as a full integer
 * (e.g. "$3,500,000,000", "$600,000,000").
 *
 * @returns { ok: true } when all tokens pass, or
 *          { ok: false, unknown: string[] } with the failing raw tokens.
 */
export function validateNoNewNumbers(
	outputText: string,
	canonicalText: string
): { ok: boolean; unknown: string[] } {
	const canonicalNormalized = normalizeNumToken(canonicalText);
	const outputTokens = extractNumericTokens(outputText);
	const unknown: string[] = [];
	for (const tok of outputTokens) {
		// Primary check: direct substring match after normalization
		if (canonicalNormalized.includes(tok)) continue;

		// Fallback: check if the magnitude-expanded form is in canonical
		// (handles cases where canonical has "$3,500,000,000" and LLM emits "$3.5B")
		const expanded = expandShorthandToken(tok);
		if (expanded !== null && canonicalNormalized.includes(expanded)) continue;

		unknown.push(tok);
	}
	return { ok: unknown.length === 0, unknown };
}

/**
 * Validate that the LLM output uses the real company name and not a placeholder.
 *
 * Checks:
 *  1. Output does not contain known placeholder strings ("Startup Corp", "[Company]", etc.)
 *  2. When dealName is provided, the output mentions it (case-insensitive substring match).
 *
 * @returns { ok: true } when all checks pass, or
 *          { ok: false, issues: string[] } listing every violation.
 */
export function validateCompanyName(
	dealName: string | undefined | null,
	output: string
): { ok: boolean; issues: string[] } {
	const issues: string[] = [];
	const PLACEHOLDER_RE = /\bstartup\s+corp\b|\[company(?:\s+name)?\]|\bcompany\s+name\b/i;
	if (PLACEHOLDER_RE.test(output)) {
		issues.push(
			dealName
				? `LLM output contains a placeholder name instead of "${dealName}"`
				: "LLM output contains a placeholder company name"
		);
	}
	if (dealName && !output.toLowerCase().includes(dealName.toLowerCase())) {
		issues.push(`LLM output does not mention the expected deal name "${dealName}"`);
	}
	return { ok: issues.length === 0, issues };
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
	"You are an investment memo writer producing a concise, evidence-grounded summary of a startup deal. " +
	"You will be given structured canonical data extracted deterministically from deal documents, " +
	"plus optional product/narrative context from pitch deck slides. " +
	"\n\nSTRICT RULES — violation will cause your output to be discarded:\n" +
	"1. Use the exact company name from the Deal Identity section. NEVER substitute 'Startup Corp' or any placeholder.\n" +
	"2. Do NOT introduce any numbers, dollar amounts, percentages, or year values that are NOT present in the canonical data.\n" +
	"3. Do NOT guess, extrapolate, or infer metrics not explicitly stated.\n" +
	"4. If a section has insufficient data, use concise neutral language (e.g. 'Not disclosed.').\n" +
	"5. Keep executive_summary to 2–4 sentences. Each bullet in strengths/risks ≤100 chars. Each open_question ≤120 chars.\n" +
	"6. Return ONLY valid JSON with exactly these keys:\n" +
	'   { "executive_summary": "...", "strengths": [...], "risks": [...], "open_questions": [...] }\n' +
	"7. No markdown. No code fences. No extra keys.";

/**
 * Call gpt-4o-mini to generate a governed executive summary from canonical inputs.
 * Validates output has no hallucinated numbers before returning.
 */
export async function generateGovernedSummaryV1(
	args: GovernedSummaryArgs
): Promise<GovernedSummaryResult> {
	// Build canonical corpus for validation and LLM context
	// Order: identity → product → market/financials (most context-rich first)
	const parts: string[] = [];
	if (args.dealName) parts.push(`## Deal Identity\nDeal name: ${args.dealName}`);
	if (args.productNarrativeBody) parts.push(`## Product Narrative\n${args.productNarrativeBody}`);
	if (args.canonicalFieldsBody) parts.push(`## Canonical Fields\n${args.canonicalFieldsBody}`);
	if (args.insightSlotsBody) parts.push(`## Insight Slots\n${args.insightSlotsBody}`);
	if (args.financialStmtBody) parts.push(`## Financial Statement\n${args.financialStmtBody}`);
	if (args.useOfFundsBody) parts.push(`## Use of Funds\n${args.useOfFundsBody}`);
	if (args.impliedCapitalBody) parts.push(`## Implied Capital Allocation\n${args.impliedCapitalBody}`);
	if (args.financialHealthBody) parts.push(`## Financial Health Metrics\n${args.financialHealthBody}`);
	if (args.financialReconciliationBody) parts.push(`## Financial Reconciliation\n${args.financialReconciliationBody}`);
	if (args.conflictsBody) parts.push(`## Conflicting Fields\n${args.conflictsBody}`);

	if (parts.length === 0) {
		return {
			ok: false,
			reason: "no_canonical_data",
		};
	}

	const canonicalCorpus = parts.join("\n\n");

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return {
			ok: false,
			reason: "missing_openai_api_key",
		};
	}

	const providerConfig: ProviderConfig = {
		type: "openai",
		enabled: true,
		priority: 1,
		apiKey,
		timeout: 30_000,
		retries: 2,
	};

	const provider = new OpenAIGPT4oProvider(providerConfig);

	const userContent = canonicalCorpus;

	let response: Awaited<ReturnType<typeof provider.complete>>;
	try {
		response = await provider.complete({
			task: "synthesis",
			model: "gpt-4o-mini" as any,
			temperature: 0,
			max_tokens: 800,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userContent },
			],
			metadata: { kind: "governed_summary_v1" },
		});
	} catch (err) {
		return {
			ok: false,
			reason: "llm_call_failed",
		};
	}

	if (!response?.content) {
		return {
			ok: false,
			reason: "llm_empty_response",
		};
	}

	// Parse JSON output
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content.trim());
	} catch {
		// Try to extract JSON from response text in case model added preamble
		const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
		if (!jsonMatch) {
			return { ok: false, reason: "llm_output_not_json" };
		}
		try {
			parsed = JSON.parse(jsonMatch[0]);
		} catch {
			return { ok: false, reason: "llm_output_not_json" };
		}
	}

	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		typeof (parsed as Record<string, unknown>).executive_summary !== "string" ||
		!Array.isArray((parsed as Record<string, unknown>).strengths) ||
		!Array.isArray((parsed as Record<string, unknown>).risks) ||
		!Array.isArray((parsed as Record<string, unknown>).open_questions)
	) {
		return { ok: false, reason: "llm_output_schema_mismatch" };
	}

	const raw = parsed as {
		executive_summary: string;
		strengths: unknown[];
		risks: unknown[];
		open_questions: unknown[];
	};

	// Coerce arrays to string[]
	const toStringArray = (arr: unknown[]): string[] =>
		arr
			.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
			.map((s) => s.trim().slice(0, 150));

	const executive_summary = raw.executive_summary.trim();
	const strengths = toStringArray(raw.strengths);
	const risks = toStringArray(raw.risks);
	const open_questions = toStringArray(raw.open_questions);

	// Numeric-parity validation.
	// Apply finance-shorthand normalization before the parity check so that LLM
	// tokens like "$3.5b" / "$600m" use consistent uppercase suffixes, and the
	// magnitude-expansion fallback inside validateNoNewNumbers can resolve them
	// against canonical forms like "$3,500,000,000".
	const rawOutput = [
		executive_summary,
		...strengths,
		...risks,
		...open_questions,
	].join(" ");
	const fullOutput = normalizeLlmFinanceShorthand(rawOutput);

	const { ok: parityOk, unknown: unknownTokens } = validateNoNewNumbers(
		fullOutput,
		canonicalCorpus
	);

	if (!parityOk) {
		return {
			ok: false,
			reason: "numeric_parity_failed",
			unknownTokens,
		};
	}

	return {
		ok: true,
		value: {
			schema_version: "governed_summary_v1",
			executive_summary,
			strengths,
			risks,
			open_questions,
			validated: true,
		},
	};
}

// ─── Section body serializer ──────────────────────────────────────────────────

/**
 * Serialize a GovernedSummaryV1 to a human-readable body string suitable for
 * the render_package section body field.
 *
 * The JSON representation is also embedded at the end under a delimiter so
 * that the UI can parse structured data without a separate field.
 */
export function serializeGovernedSummaryBody(value: GovernedSummaryV1): string {
	const lines: string[] = [];

	lines.push(`Executive Summary`);
	lines.push(value.executive_summary);
	lines.push("");

	if (value.strengths.length > 0) {
		lines.push(`Strengths`);
		value.strengths.forEach((s) => lines.push(`• ${s}`));
		lines.push("");
	}

	if (value.risks.length > 0) {
		lines.push(`Risks`);
		value.risks.forEach((r) => lines.push(`• ${r}`));
		lines.push("");
	}

	if (value.open_questions.length > 0) {
		lines.push(`Open Questions`);
		value.open_questions.forEach((q) => lines.push(`• ${q}`));
		lines.push("");
	}

	// Embed structured JSON for UI parsing
	lines.push(`---governed_summary_v1_json---`);
	lines.push(JSON.stringify(value));

	return lines.join("\n");
}

/**
 * Parse a GovernedSummaryV1 from a section body string previously created
 * by serializeGovernedSummaryBody. Returns null on parse failure.
 */
export function parseGovernedSummaryBody(body: string): GovernedSummaryV1 | null {
	const delimiter = "---governed_summary_v1_json---\n";
	const idx = body.indexOf(delimiter);
	if (idx === -1) return null;
	try {
		const json = body.slice(idx + delimiter.length).trim();
		const parsed = JSON.parse(json) as GovernedSummaryV1;
		if (parsed?.schema_version !== "governed_summary_v1") return null;
		return parsed;
	} catch {
		return null;
	}
}
