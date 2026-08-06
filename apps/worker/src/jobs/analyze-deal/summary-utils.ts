/**
 * summary-utils.ts
 *
 * Pure, stateless helpers used by analyze-deal/processor.ts.
 * No I/O. No side effects. No imports from outside this file.
 */

// ---------------------------------------------------------------------------
// JSON / coercion helpers
// ---------------------------------------------------------------------------

export function safeJsonParseObject(raw: string): Record<string, unknown> | null {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		// Best-effort recovery: extract first {...} block.
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			const candidate = trimmed.slice(start, end + 1);
			try {
				const parsed = JSON.parse(candidate);
				return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
			} catch {
				return null;
			}
		}
		return null;
	}
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function envFlagEnabled(value: string | undefined): boolean {
	const normalized = String(value ?? "").trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

// ---------------------------------------------------------------------------
// DealSummaryV2 type
// ---------------------------------------------------------------------------

export type DealSummaryV2 = {
	generated_at: string;
	model: string;
	summary: {
		one_liner: string;
		paragraphs: [string, string, string];
	};
	strengths: string[];
	risks: string[];
	open_questions: string[];
};

// ---------------------------------------------------------------------------
// Text / paragraph helpers
// ---------------------------------------------------------------------------

export function countWords(value: string): number {
	const s = String(value ?? "");
	const words = s.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

export function countSentences(value: string): number {
	const s = String(value ?? "").trim();
	if (!s) return 0;
	const parts = s.split(/[.!?]+\s*/).map((p) => p.trim()).filter(Boolean);
	return parts.length;
}

const SUMMARY_BROKEN_ARTICLE_RX = /\bis an\s+for\b/gi;
export const SUMMARY_INVESTMENT_KEYWORDS_RX =
	/\b(invest|investment|conviction|recommend|recommendation|proceed|pass|hold|score|risk|raise|round|valuation|diligence|gating)\b/i;

export function cleanupSummarySentence(text: string): string {
	if (!text) return text;
	let out = text.replace(SUMMARY_BROKEN_ARTICLE_RX, "is for");
	out = out.replace(/\s+/g, " ").trim();
	return out;
}

export function enforceInvestmentOneLiner(text: string, opts: { recommendation?: string | null }): string {
	const cleaned = cleanupSummarySentence(text);
	if (!cleaned) return cleaned;
	if (SUMMARY_INVESTMENT_KEYWORDS_RX.test(cleaned)) return cleaned;
	const rec = typeof opts.recommendation === "string" && opts.recommendation.trim().length > 0 ? opts.recommendation.trim() : null;
	const prefix = rec ? `Investment view (${rec})` : "Investment view";
	return `${prefix}: ${cleaned}`;
}

export function ensureParagraphConstraints(paragraph: string, opts: { minWords: number; minSentences: number; maxSentences: number; padSentences: string[] }): string {
	let p = String(paragraph ?? "").replace(/\s+/g, " ").trim();
	if (!p) p = "Key details are not provided in Phase 1 yet.";

	const makeSentence = (s: string) => {
		let t = String(s ?? "").replace(/\s+/g, " ").trim();
		if (!t) return "";
		if (!/[.!?]$/.test(t)) t += ".";
		return t;
	};

	if (!/[.!?]$/.test(p)) p += ".";

	let sentences = p.split(/[.!?]+\s*/).map((s) => s.trim()).filter(Boolean);
	while (sentences.length > opts.maxSentences) {
		sentences = [sentences.slice(0, opts.maxSentences - 1).join("; "), ...sentences.slice(opts.maxSentences - 1)];
	}

	let padIdx = 0;
	while (sentences.length < opts.minSentences && padIdx < opts.padSentences.length) {
		const s = makeSentence(opts.padSentences[padIdx++]);
		if (s) sentences.push(s.replace(/[.!?]$/, ""));
	}

	p = sentences.map((s) => makeSentence(s)).join(" ").trim();
	while (countWords(p) < opts.minWords && padIdx < opts.padSentences.length) {
		const s = makeSentence(opts.padSentences[padIdx++]);
		if (s) p = (p + " " + s).trim();
		if (countSentences(p) > opts.maxSentences) {
			const parts = p.split(/[.!?]+\s*/).map((x) => x.trim()).filter(Boolean);
			const clamped = [parts.slice(0, opts.maxSentences - 1).join("; "), ...parts.slice(opts.maxSentences - 1)];
			p = clamped.map((s2) => makeSentence(s2)).join(" ").trim();
		}
	}
	return p;
}

export function normalizeParagraphs(value: unknown, padSentences: string[]): [string, string, string] | null {
	if (!Array.isArray(value) || value.length !== 3) return null;
	const raw = value.map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : ""));
	const p1 = ensureParagraphConstraints(raw[0], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p2 = ensureParagraphConstraints(raw[1], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p3 = ensureParagraphConstraints(raw[2], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	return [p1, p2, p3];
}

export function coerceDealSummaryV2(parsed: Record<string, unknown>, nowIso: string, padSentences: string[]): DealSummaryV2 | null {
	const summaryNode = (parsed as any).summary;
	const oneLinerRaw =
		summaryNode && typeof summaryNode === "object" && typeof (summaryNode as any).one_liner === "string"
			? (summaryNode as any).one_liner
			: "";
	const one_liner = oneLinerRaw.replace(/\s+/g, " ").trim();
	if (!one_liner) return null;

	const paragraphs =
		summaryNode && typeof summaryNode === "object" ? normalizeParagraphs((summaryNode as any).paragraphs, padSentences) : null;
	if (!paragraphs) return null;

	const strengths =
		isStringArray(parsed.strengths)
			? parsed.strengths
			: isStringArray((parsed as any).key_strengths)
				? (parsed as any).key_strengths
				: [];
	const risks =
		isStringArray(parsed.risks)
			? parsed.risks
			: isStringArray((parsed as any).key_risks)
				? (parsed as any).key_risks
				: [];
	const open_questions =
		isStringArray(parsed.open_questions)
			? parsed.open_questions
			: isStringArray((parsed as any).openQuestions)
				? (parsed as any).openQuestions
				: [];
	const model = typeof parsed.model === "string" ? parsed.model : "gpt-4o-mini";
	return {
		generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : nowIso,
		model,
		summary: {
			one_liner,
			paragraphs,
		},
		strengths,
		risks,
		open_questions,
	};
}

// ---------------------------------------------------------------------------
// Policy predicates (pure — no I/O, no env reads)
// ---------------------------------------------------------------------------

export function isRealEstatePolicyId(policyId: string | null | undefined): boolean {
	const v = typeof policyId === "string" ? policyId.trim().toLowerCase() : "";
	return v === "real_estate_underwriting" || v.includes("real_estate");
}

export const STARTUP_BUSINESS_MODEL_RE = /\b(omnichannel|dtc|wholesale|retail|consumer|subscription|saas|ecommerce)\b/i;
export const PLACEHOLDER_BUSINESS_MODEL_RE = /^(unknown|n\/a|na|none|tbd)$/i;

// ---------------------------------------------------------------------------
// Deterministic fallback summary builder
// ---------------------------------------------------------------------------

export function buildDeterministicDealSummaryV2Fallback(nowIso: string, input: {
	dealId: string;
	dealName?: string | null;
	phase1_deal_overview_v2: unknown;
	phase1_executive_summary_v2: unknown;
	phase1_decision_summary_v1: unknown;
	eligibleDocuments: Array<{ id: string; title: string | null; type: string | null; page_count: number | null }>;
}): DealSummaryV2 {
	const overview = input.phase1_deal_overview_v2 && typeof input.phase1_deal_overview_v2 === "object" ? (input.phase1_deal_overview_v2 as any) : {};
	const exec = input.phase1_executive_summary_v2 && typeof input.phase1_executive_summary_v2 === "object" ? (input.phase1_executive_summary_v2 as any) : {};
	const signals = exec.signals && typeof exec.signals === "object" ? exec.signals : {};
	const score = typeof signals.score === "number" && Number.isFinite(signals.score) ? signals.score : null;
	const recommendation = typeof signals.recommendation === "string" ? signals.recommendation : null;
	const confidence = typeof signals.confidence === "string" ? signals.confidence : null;

	const product = typeof overview.product_solution === "string" && overview.product_solution.trim() ? overview.product_solution.trim() : "Product not provided in Phase 1.";
	const icp = typeof overview.market_icp === "string" && overview.market_icp.trim() ? overview.market_icp.trim() : "ICP not provided in Phase 1.";
	const model = typeof overview.business_model === "string" && overview.business_model.trim() ? overview.business_model.trim() : "Business model not provided in Phase 1.";
	const missing = Array.isArray(exec.missing) ? exec.missing.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, 8) : [];
	const tractionSignals = Array.isArray(overview.traction_signals) ? overview.traction_signals.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, 5) : [];

	const docCount = input.eligibleDocuments.length;
	const totalPages = input.eligibleDocuments.reduce((sum, d) => sum + (typeof d.page_count === "number" ? d.page_count : 0), 0);
	const dealName = typeof input.dealName === "string" && input.dealName.trim() ? input.dealName.trim() : "This deal";
	const one_liner = `${dealName}: ${product.length > 140 ? product.slice(0, 140).trimEnd() + "…" : product}`;

	const padSentences = [
		`What it is: ${product}`,
		`Target customer / ICP: ${icp}`,
		`Business model signal: ${model}`,
		recommendation && score != null && confidence ? `Phase 1 signal: ${recommendation} (${score}/100, confidence ${confidence}).` : "Phase 1 signal exists but scoring details may be incomplete.",
		missing.length > 0 ? `Coverage gaps flagged in Phase 1 include: ${missing.join(", ")}.` : "Coverage gaps were not explicitly listed in Phase 1 output.",
		`Inputs available at this stage come from ${docCount} extracted document(s) (${totalPages} page(s) total) and Phase 1 structured summaries; treat unknowns as open diligence items.`,
	];

	const p1 = ensureParagraphConstraints("", { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p2 = ensureParagraphConstraints("", { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p3 = ensureParagraphConstraints(
		tractionSignals.length > 0 ? `Traction signals observed: ${tractionSignals.join(", ")}.` : "Traction signals were not evidenced in Phase 1.",
		{ minWords: 60, minSentences: 2, maxSentences: 4, padSentences }
	);

	const strengths: string[] = [];
	if (typeof overview.product_solution === "string" && overview.product_solution.trim()) strengths.push("Clear product description present in Phase 1.");
	if (typeof overview.market_icp === "string" && overview.market_icp.trim()) strengths.push("Identified ICP / target customer.");
	if (tractionSignals.length > 0) strengths.push(`Traction signals: ${tractionSignals.slice(0, 2).join(", ")}.`);
	if (strengths.length === 0) strengths.push("Phase 1 provides a starting point but coverage is limited.");

	const risks = missing.length > 0 ? missing.slice(0, 5).map((m: string) => `Missing: ${m}.`) : ["Missing key diligence details (raise/terms, go-to-market, risks)."];
	const open_questions = missing.length > 0 ? missing.slice(0, 6).map((m: string) => `Clarify: ${m}.`) : ["Clarify raise amount and terms.", "Clarify go-to-market strategy.", "Clarify traction metrics and unit economics."];

	return {
		generated_at: nowIso,
		model: "gpt-4o-mini",
		summary: {
			one_liner,
			paragraphs: [p1, p2, p3],
		},
		strengths,
		risks,
		open_questions,
	};
}
