import type { LlmNarrationV1 as LlmNarrationV1Type } from "./narration-schema";

export type NarrationGuardViolation = {
	code: string;
	path: string;
	message: string;
};

export type NarrationGuardResult = {
	ok: boolean;
	violations: NarrationGuardViolation[];
};

export type NarrationDegradeResult = {
	narration: LlmNarrationV1Type;
	degraded: boolean;
	invalid_sections: number;
	dropped_insights: number;
	dropped_suggestions: number;
};

type ValidateNoNewFactsArgs = {
	reportExcerpt: unknown;
	narration: unknown;
};

const normalizeWhitespace = (v: unknown): string => {
	if (typeof v !== "string") return "";
	return v.replace(/\s+/g, " ").trim();
};

const safeJson = (v: unknown): string => {
	try {
		return JSON.stringify(v);
	} catch {
		return "";
	}
};

const normalizeNumericToken = (raw: string): string => {
	const s0 = normalizeWhitespace(raw);
	if (!s0) return "";

	// Remove surrounding punctuation that often borders tokens.
	let s = s0.replace(/^[\[("'`]+/, "").replace(/[\])"'`.]+$/, "");

	// Strip commas and internal whitespace (e.g., "20 %" -> "20%", "$ 1,000" -> "$1000").
	s = s.replace(/,/g, "").replace(/\s+/g, "");

	// Normalize optional currency prefix.
	s = s.replace(/^\$/, "");

	// Normalize suffix case conservatively; do NOT convert MM <-> M.
	s = s.replace(/(mm|m|b)$/, (m) => m.toUpperCase());

	return s;
};

const getAtPath = (root: any, path: string): unknown => {
	const parts = path.split(".").filter(Boolean);
	let cur: any = root;
	for (const part of parts) {
		if (!cur || typeof cur !== "object") return undefined;
		cur = cur[part];
	}
	return cur;
};

const buildAllowlistCorpus = (reportExcerpt: any): string => {
	// Intentionally narrow: only stringify selected stable excerpt subtrees.
	const allowlistedPaths = [
		"structured_summary",
		"deal_summary_v1",
		"score_explanation.understanding_v1",
		"citations.total_sources",
		"citations.unique_pages",
	];

	const chunks: string[] = [];
	for (const p of allowlistedPaths) {
		const value = getAtPath(reportExcerpt, p);
		if (value === undefined) continue;
		chunks.push(safeJson(value));
	}
	return chunks.join("\n");
};

const buildAllowlistStringCorpus = (reportExcerpt: any): string => {
	const out: string[] = [];
	const seen = new Set<any>();
	const walk = (node: any, depth: number) => {
		if (depth > 10) return;
		if (node == null) return;
		if (typeof node === "string") {
			const s = normalizeWhitespace(node);
			if (s) out.push(s);
			return;
		}
		if (typeof node !== "object") return;
		if (seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const v of node) walk(v, depth + 1);
			return;
		}
		for (const v of Object.values(node)) walk(v, depth + 1);
	};

	// Only traverse the allowlisted excerpt subtrees.
	for (const p of [
		"structured_summary",
		"deal_summary_v1",
		"score_explanation.understanding_v1",
		"citations",
	]) {
		walk(getAtPath(reportExcerpt, p), 0);
	}

	return out.join("\n");
};

const collectNormalizedNumericTokensFromCorpus = (corpus: string): Set<string> => {
	const out = new Set<string>();
	if (!corpus) return out;

	// Capture numeric-like tokens with optional currency prefix, decimal, suffix, and percent.
	const re = /\$?\b\d[\d,]*(?:\.\d+)?(?:\s?(?:MM|M|B))?%?\b/gi;
	const matches = corpus.match(re) ?? [];
	for (const m of matches) {
		const n = normalizeNumericToken(m);
		if (n) out.add(n);
	}
	return out;
};

const collectDeterministicKpiValueRaws = (reportExcerpt: any): Set<string> => {
	const out = new Set<string>();
	const kpis = reportExcerpt?.structured_summary?.kpis;
	if (!kpis || typeof kpis !== "object") return out;

	const maybeAdd = (v: unknown) => {
		const s = normalizeWhitespace(v);
		if (s) out.add(s);
	};

	for (const key of ["raise", "revenue", "customers", "growth"]) {
		maybeAdd(kpis?.[key]?.value_raw);
	}
	maybeAdd(kpis?.performance?.marketing_attributed_revenue_v1?.value_raw);

	return out;
};

const collectDeterministicKpiValueRawsNormalized = (reportExcerpt: any): Set<string> => {
	const raw = collectDeterministicKpiValueRaws(reportExcerpt);
	const out = new Set<string>();
	for (const v of raw) {
		const n = normalizeNumericToken(v);
		if (n) out.add(n);
	}
	return out;
};

type CitationRef = { page?: number; slide_title?: string; evidence_id?: string };

type DeterministicKpiSource = { page: number; slide_title: string | null };

const collectDeterministicKpiSources = (reportExcerpt: any): DeterministicKpiSource[] => {
	const kpis = reportExcerpt?.structured_summary?.kpis;
	if (!kpis || typeof kpis !== "object") return [];

	const sources: Array<DeterministicKpiSource> = [];
	const push = (src: any) => {
		const page = typeof src?.page === "number" && Number.isFinite(src.page) ? src.page : null;
		if (page == null) return;
		const slide_title = typeof src?.slide_title === "string" ? normalizeWhitespace(src.slide_title) : null;
		sources.push({ page, slide_title: slide_title || null });
	};

	for (const key of ["raise", "revenue", "customers", "growth"]) {
		push(kpis?.[key]?.source);
	}
	push(kpis?.performance?.marketing_attributed_revenue_v1?.source);

	return sources;
};

// Capture numeric-like tokens with optional currency prefix, decimal, suffix (MM/M/B), and percent.
// Important: the suffix must be part of the match so that $1.5MM and $1.5M are treated as different tokens.
const numericTokenRe = /\$?\b\d[\d,]*(?:\.\d+)?(?:\s?(?:MM|M|B))?%?\b/gi;

const kpiTokens = ["revenue", "arr", "mrr", "irr", "moic", "cap_rate", "cac", "ltv", "margin", "runway", "burn"] as const;

// Suggestions are uncited; allow KPI-token usage without citations only when the same token
// already appears in deterministic open items/issues.
// Safety exception: some KPI tokens still require citations even in suggestions.
const SUGGESTION_KPI_TOKENS_REQUIRE_CITATION_EVEN_IN_SUGGESTIONS = new Set(["moic"] as const);

const sentenceSplit = (text: string): string[] => {
	const t = normalizeWhitespace(text);
	if (!t) return [];
	return t.split(/(?<=[.!?])\s+/g).filter(Boolean);
};

const sentenceHasKpiToken = (sentence: string): string | null => {
	const s = sentence;
	for (const token of kpiTokens) {
		const pattern = token.includes("_") ? token.replace(/_/g, "[ _-]") : token;
		const re = new RegExp(`\\b${pattern}\\b`, "i");
		if (re.test(s)) return token;
	}
	return null;
};

const citationMatchesDeterministic = (citation: CitationRef, deterministic: DeterministicKpiSource[]): boolean => {
	// evidence_id matching is supported by the narration schema, but stable excerpt sources only include page/slide_title.
	const page = typeof citation?.page === "number" && Number.isFinite(citation.page) ? citation.page : null;
	if (page == null) return false;

	const title = typeof citation?.slide_title === "string" ? normalizeWhitespace(citation.slide_title) : "";

	for (const src of deterministic) {
		if (src.page !== page) continue;
		if (!title) return true;
		const srcTitle = normalizeWhitespace(src.slide_title ?? "");
		if (!srcTitle) return true;
		if (srcTitle === title) return true;
	}
	return false;
};

const narrationToText = (narration: any): string => {
	const parts: string[] = [];
	if (typeof narration?.summary === "string") parts.push(narration.summary);

	if (Array.isArray(narration?.sections)) {
		for (const sec of narration.sections) {
			if (typeof sec?.title === "string") parts.push(sec.title);
			if (typeof sec?.body === "string") parts.push(sec.body);
		}
	}

	if (narration?.suggestions && typeof narration.suggestions === "object") {
		const gaps = Array.isArray(narration.suggestions.gaps) ? narration.suggestions.gaps : [];
		for (const g of gaps) {
			if (typeof g?.key === "string") parts.push(g.key);
			if (typeof g?.rationale === "string") parts.push(g.rationale);
		}
		const qs = Array.isArray(narration.suggestions.questions) ? narration.suggestions.questions : [];
		for (const q of qs) if (typeof q === "string") parts.push(q);
	}

	if (Array.isArray(narration?.quality_flags)) {
		for (const f of narration.quality_flags) if (typeof f === "string") parts.push(f);
	}

	return parts.join("\n");
};

const reservedKeys = ["structured_summary", "promoted_facts", "score_explanation"] as const;

const containsReservedKey = (text: string): string | null => {
	const t = normalizeWhitespace(text);
	if (!t) return null;
	for (const k of reservedKeys) {
		const re = new RegExp(`\\b${k}\\b`);
		if (re.test(t)) return k;
	}
	return null;
};

const inferenceMarkers = ["suggests", "suggest", "implies", "imply", "indicates", "indicate", "appears", "appear", "may", "might", "likely"];

// Uncertainty markers required for hypothesis-tier insights.
const uncertaintyMarkers = ["may", "might", "likely", "appears", "appear", "suggests", "suggest"];

// Commitment language tuning:
// - Tier A: banned unless cited AND sentence matches excerpt verbatim.
// - Tier B: requires a citation in the same section.
// - Tier C: allowed without citation.
const commitmentTierA = ["guarantee", "guarantees", "guaranteed", "prove", "proves", "clearly"];
const commitmentTierB = ["will", "must"];
const commitmentTierC = ["can", "could"];

// Section titles are UI headings and often not factual claims. To reduce false positives,
// we allowlist a small set of safe headings and skip entity gating for those titles only.
const SAFE_SECTION_TITLES = [
	"Current Status",
	"Open Items",
	"Customer Base",
	"Customers",
	"Risks",
	"Next Steps",
	"Highlights",
	"Key Metrics",
	"Marketing Performance",
	"Business Model",
	"Market",
	"Product",
	"Go-to-Market",
	"Team",
	"Traction",
	"Financials",
	"Raise Terms",
	"Recommendations",
] as const;

const safeSectionTitlesLower = new Set(SAFE_SECTION_TITLES.map((t) => normalizeWhitespace(t).toLowerCase()));

// Common sentence starters that are not entities, but often get Title-Case at sentence start.
// Case-insensitive; used only for sentence-start suppression (NOT a global ignore list).
// NOTE: Keep this in parity with overview-guard.ts.
const COMMON_SENTENCE_STARTERS = new Set(
	[
		"clarity",
		"understanding",
		"currently",
		"clear",
		"transparent",
		"specific",
		"reliable",
		"insufficient",
		"lack",
		"potential",
		"insights",
		"information",
		"projections",
		"operations",
		"operational",
		"legal",
		"forecasted",
		"heavy",
		"current",
		"unclear",
	].map((s) => s.toLowerCase()),
);

// Common deck artifacts / headings that are not named entities.
// Case-insensitive: these tokens will never be treated as a new entity.
const NON_ENTITY_TOKENS = new Set([
	"continued",
	"continue",
	"appendix",
	"summary",
	"overview",
	"highlights",
	"notes",
	"grounded",
	"provide",
	// Common sentence starters that are not entities in overlay-like free-text
	"reliance",
	"need",
	"detailed",
	"this",
	"that",
	"these",
	"those",
	"overall",
	"key",
	"primary",
	"secondary",
]);

const isNonEntityToken = (candidate: string): boolean => {
	const norm = normalizeWhitespace(candidate)
		.replace(/^[^A-Za-z0-9]+/, "")
		.replace(/[^A-Za-z0-9]+$/, "")
		.toLowerCase();
	if (!norm) return false;
	return NON_ENTITY_TOKENS.has(norm);
};

const isSafeSectionTitle = (title: string): boolean => {
	const t = normalizeWhitespace(title).toLowerCase();
	if (!t) return false;
	return safeSectionTitlesLower.has(t);
};

const hasAnyWord = (text: string, words: string[]): string | null => {
	const t = normalizeWhitespace(text).toLowerCase();
	if (!t) return null;
	for (const w of words) {
		const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
		if (re.test(t)) return w;
	}
	return null;
};

const buildAllowedEntityCorpus = (reportExcerpt: any): { allowedStringsLower: Set<string>; allowedTextLower: string } => {
	const allowedStringsLower = new Set<string>();
	const chunks: string[] = [];
	const seen = new Set<any>();

	const add = (s: unknown) => {
		if (typeof s !== "string") return;
		const norm = normalizeWhitespace(s);
		if (!norm) return;
		const lower = norm.toLowerCase();
		allowedStringsLower.add(lower);
		chunks.push(lower);
	};

	const walkStrings = (node: any, depth: number) => {
		if (depth > 10) return;
		if (node == null) return;
		if (typeof node === "string") {
			add(node);
			return;
		}
		if (typeof node !== "object") return;
		if (seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const v of node) walkStrings(v, depth + 1);
			return;
		}
		for (const [k, v] of Object.entries(node)) {
			if (k === "slide_title") add(v);
			walkStrings(v, depth + 1);
		}
	};

	// a) All strings in deal_summary_v1
	walkStrings(getAtPath(reportExcerpt, "deal_summary_v1"), 0);
	// b) All strings in structured_summary
	walkStrings(getAtPath(reportExcerpt, "structured_summary"), 0);
	// c) Slide titles from deterministic sources where available (e.g., KPI sources)
	for (const src of collectDeterministicKpiSources(reportExcerpt)) {
		if (typeof src?.slide_title === "string" && src.slide_title.trim()) add(src.slide_title);
	}
	// d) Citation slide titles (derived by walking excerpt for slide_title keys)
	walkStrings(reportExcerpt, 0);

	return { allowedStringsLower, allowedTextLower: chunks.join("\n") };
};

const extractEntityCandidates = (text: string): string[] => {
	const raw = String(text || "");
	if (!raw.trim()) return [];

	const escapeRegex = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

	const ignoreSingle = new Set([
		"This",
		"That",
		"These",
		"Those",
		"Further",
		"Additional",
		"However",
		"Overall",
		"Open",
		"Questions",
		"What",
		"Change",
		"Mind",
		"Traction",
		"Risk",
		"Risks",
		"Market",
		"Team",
		"Product",
		"Customers",
		"Growth",
		"Revenue",
		"Raise",
		"Series",
		"Valid",
		"Invalid",
	]);

	const candidates: string[] = [];
	const seen = new Set<string>();

	const push = (s: string) => {
		const norm = normalizeWhitespace(s);
		if (!norm) return;
		if (isNonEntityToken(norm)) return;
		if (seen.has(norm)) return;
		seen.add(norm);
		candidates.push(norm);
	};

	// Title Case sequences length>=2 (e.g., "Palm Capital").
	for (const m of raw.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []) {
		const norm = normalizeWhitespace(m);
		if (!norm) continue;
		// Ignore financing round phrase.
		if (/^Series\s+[A-Z]$/i.test(norm)) continue;
		push(norm);
	}

	// Single tokens length>=4.
	const tokenRe = /\b[A-Z][A-Za-z]{3,}\b|\b[A-Z]{4,}\b/g;
	const tokens = raw.match(tokenRe) ?? [];
	const uniq = Array.from(new Set(tokens.map((t) => normalizeWhitespace(t)).filter(Boolean) as string[]));

	// Suppress sentence-start Title Case tokens that are common non-entities.
	// Applies only when token is the first token (optionally after a bullet prefix)
	// AND the next token begins with a lowercase letter.
	const suppressSentenceStartNonEntityToken = (tok: string): boolean => {
		if (!/^[A-Z][a-z]+$/.test(tok)) return false; // do not suppress acronyms
		if (!COMMON_SENTENCE_STARTERS.has(tok.toLowerCase())) return false;
		const esc = escapeRegex(tok);
		const re = new RegExp(`^\\s*(?:[•*\\-]\\s+)?${esc}\\b\\s+[a-z]`);
		return re.test(raw);
	};

	for (const tok of uniq) {
		if (!tok) continue;
		if (ignoreSingle.has(tok)) continue;
		if (/^Series$/i.test(tok)) continue;
		if (suppressSentenceStartNonEntityToken(tok)) continue;
		push(tok);
	}

	return candidates;
};

const firstDisallowedEntity = (text: string, allowed: { allowedStringsLower: Set<string>; allowedTextLower: string }): string | null => {
	const allowedText = allowed.allowedTextLower;
	for (const c of extractEntityCandidates(text)) {
		const lower = normalizeWhitespace(c).toLowerCase();
		if (!lower) continue;
		if (allowed.allowedStringsLower.has(lower)) continue;
		// Allow verbatim substring match in any allowlisted string (case-insensitive).
		if (allowedText.includes(lower)) continue;
		return c;
	}
	return null;
};

const collectNumericTokens = (text: string): string[] => {
	const tokens = String(text || "").match(numericTokenRe) ?? [];
	return Array.from(new Set(tokens));
};

const hasNewNumericToken = (
	text: string,
	allowlistNumericTokens: Set<string>,
	deterministicValueRaws: Set<string>
): string | null => {
	for (const rawToken of collectNumericTokens(text)) {
		const token = normalizeNumericToken(rawToken);
		if (!token) continue;
		const ok = allowlistNumericTokens.has(token) || deterministicValueRaws.has(token);
		if (!ok) return rawToken;
	}
	return null;
};

const makePlaceholderSection = (title: string, reason: string): LlmNarrationV1Type["sections"][number] => {
	return {
		title: title || "Guarded section",
		body:
			reason ||
			"This section was withheld by the governed narration guard due to insufficient evidence-basis or validation violations.",
		what_would_change_my_mind:
			"Provide new cited deterministic evidence within the allowlisted excerpt that supports this section.",
		evidence_basis: "no_evidence",
	};
};

export function degradeNarrationV1(args: {
	narration: LlmNarrationV1Type;
	violations: NarrationGuardViolation[];
}): NarrationDegradeResult {
	const narration = args?.narration;
	const violations = Array.isArray(args?.violations) ? args.violations : [];

	const invalidSectionIndexes = new Set<number>();
	for (const v of violations) {
		const m = /^narration\.sections\[(\d+)\]/.exec(v.path);
		if (!m) continue;
		const idx = Number(m[1]);
		if (Number.isFinite(idx)) invalidSectionIndexes.add(idx);
	}

	const invalidInsightIndexes = new Set<number>();
	for (const v of violations) {
		const m = /^narration\.insights\[(\d+)\]/.exec(v.path);
		if (!m) continue;
		const idx = Number(m[1]);
		if (Number.isFinite(idx)) invalidInsightIndexes.add(idx);
	}

	let degraded = false;
	let invalid_sections = 0;
	let dropped_insights = 0;
	let dropped_suggestions = 0;

	const next: LlmNarrationV1Type = {
		...narration,
		summary: narration.summary,
		sections: Array.isArray(narration.sections) ? narration.sections.slice() : [],
		insights: Array.isArray((narration as any).insights) ? ((narration as any).insights as any[]).slice() : [],
		suggestions: narration.suggestions,
		quality_flags: Array.isArray(narration.quality_flags) ? narration.quality_flags.slice() : [],
	};

	// Degrade summary if it is flagged.
	if (violations.some((v) => v.path === "narration.summary")) {
		next.summary = "Summary omitted (guarded).";
		degraded = true;
		if (!next.quality_flags.includes("guard_degraded_summary")) next.quality_flags.push("guard_degraded_summary");
	}

	// Degrade invalid sections.
	for (const idx of invalidSectionIndexes) {
		if (!next.sections[idx]) continue;
		const title = typeof (next.sections[idx] as any)?.title === "string" ? (next.sections[idx] as any).title : "Guarded section";
		next.sections[idx] = makePlaceholderSection(title, "This section was withheld by the governed narration guard.");
		invalid_sections++;
		degraded = true;
	}

	// Drop invalid insights without degrading sections.
	if (Array.isArray((next as any).insights) && invalidInsightIndexes.size > 0) {
		const insights: any[] = Array.isArray((next as any).insights) ? ((next as any).insights as any[]) : [];
		const keep: any[] = [];
		for (let i = 0; i < insights.length; i++) {
			if (invalidInsightIndexes.has(i)) {
				dropped_insights++;
				degraded = true;
				continue;
			}
			keep.push(insights[i]);
		}
		(next as any).insights = keep;
	}

	// Drop invalid suggestions items if flagged.
	if (next.suggestions && typeof next.suggestions === "object") {
		const gaps = Array.isArray((next.suggestions as any).gaps) ? (next.suggestions as any).gaps : [];
		const questions = Array.isArray((next.suggestions as any).questions) ? (next.suggestions as any).questions : [];

		const gapKeep: any[] = [];
		for (let i = 0; i < gaps.length; i++) {
			const path = `narration.suggestions.gaps[${i}]`;
			if (violations.some((v) => v.path.startsWith(path))) {
				dropped_suggestions++;
				degraded = true;
				continue;
			}
			gapKeep.push(gaps[i]);
		}

		const qKeep: any[] = [];
		for (let i = 0; i < questions.length; i++) {
			const path = `narration.suggestions.questions[${i}]`;
			if (violations.some((v) => v.path.startsWith(path))) {
				dropped_suggestions++;
				degraded = true;
				continue;
			}
			qKeep.push(questions[i]);
		}

		(next.suggestions as any) = { ...next.suggestions, gaps: gapKeep, questions: qKeep };
	}

	if (degraded && !next.quality_flags.includes("guard_degraded")) next.quality_flags.push("guard_degraded");

	return { narration: next, degraded, invalid_sections, dropped_insights, dropped_suggestions };
}

export function validateNoNewFacts(args: ValidateNoNewFactsArgs): NarrationGuardResult {
	const reportExcerpt: any = args?.reportExcerpt ?? {};
	const narration: any = args?.narration ?? {};

	const violations: NarrationGuardViolation[] = [];
	const push = (v: NarrationGuardViolation) => violations.push(v);

	const allowlistCorpus = buildAllowlistCorpus(reportExcerpt);
	const allowedEntity = buildAllowedEntityCorpus(reportExcerpt);
	const allowlistNumericTokens = collectNormalizedNumericTokensFromCorpus(allowlistCorpus);
	const deterministicValueRaws = collectDeterministicKpiValueRawsNormalized(reportExcerpt);
	const deterministicSources = collectDeterministicKpiSources(reportExcerpt);

	// Suggestions cannot include citations; allow limited KPI-token usage if the same token
	// already appears in deterministic diligence_open_items text or structured_summary.issues.
	const deterministicSuggestionKpiTokens = (() => {
		const chunks: string[] = [];

		const issues = reportExcerpt?.structured_summary?.issues;
		if (Array.isArray(issues)) {
			for (const it of issues) {
				if (typeof it === "string") chunks.push(it);
				else if (it && typeof it === "object" && typeof (it as any).text === "string") chunks.push((it as any).text);
			}
		}

		const openItems = reportExcerpt?.score_explanation?.understanding_v1?.diligence_open_items;
		if (Array.isArray(openItems)) {
			for (const it of openItems) {
				if (typeof it === "string") chunks.push(it);
				else if (it && typeof it === "object" && typeof (it as any).text === "string") chunks.push((it as any).text);
			}
		}

		const textLower = normalizeWhitespace(chunks.join("\n")).toLowerCase();
		const out = new Set<string>();
		for (const token of kpiTokens) {
			if (SUGGESTION_KPI_TOKENS_REQUIRE_CITATION_EVEN_IN_SUGGESTIONS.has(token as any)) continue;
			const pattern = token.includes("_") ? token.replace(/_/g, "[ _-]") : token;
			const re = new RegExp(`\\b${pattern}\\b`, "i");
			if (re.test(textLower)) out.add(token);
		}
		return out;
	})();

	// Marker strings: used to confirm dist build contains these changes.
	// (Search dist/llm/narration-guard.js for these identifiers.)
	const __GLNL_GUARD_TITLE_SKIP_V1__ = "__GLNL_GUARD_TITLE_SKIP_V1__";
	const __GLNL_GUARD_SUGGESTION_KEY_SKIP_V1__ = "__GLNL_GUARD_SUGGESTION_KEY_SKIP_V1__";
	const skipEntityForTitle = __GLNL_GUARD_TITLE_SKIP_V1__.length > 0;
	const skipEntityForSuggestionKey = __GLNL_GUARD_SUGGESTION_KEY_SKIP_V1__.length > 0;

	const validateChunk = (opts: {
		text: string;
		path: string;
		citations?: CitationRef[];
		allowKpi?: boolean;
		evidenceBasis?: string;
		skipEntity?: boolean;
		skipInference?: boolean;
		allowedKpiTokens?: Set<string>;
	}) => {
		const text = opts.text || "";
		const path = opts.path;
		const citations = Array.isArray(opts.citations) ? opts.citations : [];
		const allowKpi = Boolean(opts.allowKpi);
		const evidenceBasis = typeof opts.evidenceBasis === "string" ? opts.evidenceBasis : "";
		const skipEntity = Boolean(opts.skipEntity);
		const skipInference = Boolean(opts.skipInference);
		const allowedKpiTokens = opts.allowedKpiTokens;

			// Suggestions are prompts, not narrative claims.
			// Do not require citations for inference/commitment language within narration.suggestions.*
			const isSuggestionPath = path.startsWith("narration.suggestions.");

		const reserved = containsReservedKey(text);
		if (reserved) {
			push({
				code: "override_attempt.contains_reserved_key",
				path,
				message: `Narration contains reserved key '${reserved}' which is not allowed.`,
			});
		}

		const newNum = hasNewNumericToken(text, allowlistNumericTokens, deterministicValueRaws);
		if (newNum) {
			push({
				code: "numeric_token.not_in_excerpt",
				path,
				message: `Numeric token '${newNum}' is not present in the allowlisted report excerpt corpus.`,
			});
		}

		// Entity gating: allowlist-first. Apply broadly (summary/body/wcm/suggestions) to preserve fact-safety.
		// Exception: pass skipEntity=true for fields that should not be entity-gated (e.g., section titles).
		if (!skipEntity) {
			const ent = firstDisallowedEntity(text, allowedEntity);
			if (ent) {
				push({
					code: "entity.new_not_in_excerpt",
					path,
					message: `Entity '${ent}' is not present in the allowlisted excerpt entity corpus.`,
				});
			}
		}

		if (!isSuggestionPath && !skipInference) {
			const inference = hasAnyWord(text, inferenceMarkers);
			if (inference && citations.length === 0) {
				push({
					code: "inference.basis_required",
					path,
					message: `Inference marker '${inference}' requires at least one citation (basis) to deterministic evidence.`,
				});
			}
		}

		// Commitment language tuning.
		// Skip for suggestions: suggestions are questions/prompts, not commitments.
		if (!isSuggestionPath) {
			for (const sentence of sentenceSplit(text)) {
				const sNorm = normalizeWhitespace(sentence);
				if (!sNorm) continue;
				const sLower = sNorm.toLowerCase();

				const a = hasAnyWord(sentence, commitmentTierA);
				if (a) {
					const ok = citations.length > 0 && allowlistCorpus.toLowerCase().includes(sLower);
					if (!ok) {
						push({
							code: "commitment.tier_a.banned",
							path,
							message: `Tier A commitment '${a}' is banned unless the same sentence is cited and appears verbatim in the excerpt.`,
						});
					}
					continue;
				}

				const b = hasAnyWord(sentence, commitmentTierB);
				if (b && citations.length === 0) {
					push({
						code: "commitment.tier_b.citation_required",
						path,
						message: `Tier B commitment '${b}' requires a citation in the same section.`,
					});
					continue;
				}

				// Tier C always allowed.
				void hasAnyWord(sentence, commitmentTierC);
			}
		}

		// KPI token citation enforcement (existing rule): applies only when KPI tokens are present.
		if (!allowKpi) {
			for (const sentence of sentenceSplit(text)) {
				const tok = sentenceHasKpiToken(sentence);
				if (!tok) continue;
				if (allowedKpiTokens && allowedKpiTokens.has(tok)) continue;
				push({
					code: "kpi_token.missing_citation",
					path,
					message: `KPI token '${tok}' is not allowed here without a matching citation.`,
				});
			}
		} else {
			const hasMatchingCitation = citations.some((c) => citationMatchesDeterministic(c, deterministicSources));
			for (const sentence of sentenceSplit(text)) {
				const tok = sentenceHasKpiToken(sentence);
				if (!tok) continue;
				if (!hasMatchingCitation) {
					push({
						code: "kpi_token.citation_required",
						path,
						message: `KPI token '${tok}' requires a citation matching a deterministic KPI source in the report excerpt.`,
					});
				}
			}
		}
	};

	// Summary: treat as inference-only; no citations possible.
	if (typeof narration?.summary === "string") {
		validateChunk({ text: narration.summary, path: "narration.summary", citations: [], allowKpi: false, evidenceBasis: "no_evidence" });
	}

	// Sections: validate body/title/decision trigger. Enforce decision trigger presence.
	const sections = Array.isArray(narration?.sections) ? (narration.sections as Array<LlmNarrationV1Type["sections"][number]>) : [];
	for (let i = 0; i < sections.length; i++) {
		const sec: any = sections[i];
		const title = typeof sec?.title === "string" ? sec.title : "";
		const body = typeof sec?.body === "string" ? sec.body : "";
		const wcm = typeof sec?.what_would_change_my_mind === "string" ? sec.what_would_change_my_mind : "";
		const citations = Array.isArray(sec?.citations) ? (sec.citations as CitationRef[]) : [];
		const evidenceBasis = typeof sec?.evidence_basis === "string" ? sec.evidence_basis : "";

		// Required: what_would_change_my_mind must be present and non-empty.
		if (!normalizeWhitespace(wcm)) {
			push({
				code: "section.decision_trigger.required",
				path: `narration.sections[${i}].what_would_change_my_mind`,
				message: "Each section must include a non-empty 'what_would_change_my_mind' decision trigger.",
			});
		}

		// Validate each textual field.
		validateChunk({
			text: title,
			path: `narration.sections[${i}].title`,
			citations,
			allowKpi: true,
			evidenceBasis,
			skipEntity: skipEntityForTitle,
		});
		validateChunk({ text: body, path: `narration.sections[${i}].body`, citations, allowKpi: true, evidenceBasis });
		validateChunk({ text: wcm, path: `narration.sections[${i}].what_would_change_my_mind`, citations, allowKpi: true, evidenceBasis });
	}

	// Insights (GLNL v2): validate insight invariants; drop invalid insights by path.
	const insights = Array.isArray((narration as any)?.insights) ? (((narration as any).insights as any[]) ?? []) : [];
	for (let i = 0; i < insights.length; i++) {
		const ins: any = insights[i];
		const title = typeof ins?.title === "string" ? ins.title : "";
		const claim = typeof ins?.claim === "string" ? ins.claim : "";
		const wcm = typeof ins?.what_would_change_my_mind === "string" ? ins.what_would_change_my_mind : "";
		const tier = typeof ins?.tier === "string" ? ins.tier : "";
		const evidenceBasis = typeof ins?.evidence_basis === "string" ? ins.evidence_basis : "";
		const basis = Array.isArray(ins?.basis) ? (ins.basis as CitationRef[]) : [];

		// Required: hypothesis must have a decision trigger; all tiers require non-empty wcm.
		if (!normalizeWhitespace(wcm)) {
			push({
				code: "insight.decision_trigger.required",
				path: `narration.insights[${i}].what_would_change_my_mind`,
				message: "Each insight must include a non-empty 'what_would_change_my_mind' decision trigger.",
			});
		}

		// Basis/evidence_basis consistency.
		if (evidenceBasis === "cited" && basis.length === 0) {
			push({
				code: "insight.evidence_basis.cited_requires_basis",
				path: `narration.insights[${i}].basis`,
				message: "Insight evidence_basis='cited' requires a non-empty basis[].",
			});
		}
		if (evidenceBasis === "no_evidence" && basis.length > 0) {
			push({
				code: "insight.evidence_basis.no_evidence_requires_empty_basis",
				path: `narration.insights[${i}].basis`,
				message: "Insight evidence_basis='no_evidence' requires basis=[] (no citations).",
			});
		}

		// Tier gating.
		if (tier === "restatement") {
			if (basis.length === 0 || evidenceBasis !== "cited") {
				push({
					code: "insight.tier.restatement.citation_required",
					path: `narration.insights[${i}]`,
					message: "Restatement insights must be cited (evidence_basis='cited' with non-empty basis[]).",
				});
			}
		}
		if (tier === "implication") {
			if (basis.length === 0 || evidenceBasis !== "cited") {
				push({
					code: "insight.tier.implication.citation_required",
					path: `narration.insights[${i}]`,
					message: "Implication insights must be cited (evidence_basis='cited' with non-empty basis[]).",
				});
			}
		}
		if (tier === "hypothesis") {
			const unc = hasAnyWord(claim, uncertaintyMarkers);
			if (!unc) {
				push({
					code: "insight.tier.hypothesis.uncertainty_required",
					path: `narration.insights[${i}].claim`,
					message: "Hypothesis insights must include an uncertainty marker (e.g., may/might/likely/appears/suggests).",
				});
			}
		}

		// Validate insight textual fields.
		validateChunk({ text: title, path: `narration.insights[${i}].title`, citations: basis, allowKpi: true, evidenceBasis, skipEntity: true });
		validateChunk({
			text: claim,
			path: `narration.insights[${i}].claim`,
			citations: basis,
			allowKpi: true,
			evidenceBasis,
			skipInference: tier === "hypothesis" && evidenceBasis === "no_evidence" && basis.length === 0,
		});
		validateChunk({ text: wcm, path: `narration.insights[${i}].what_would_change_my_mind`, citations: basis, allowKpi: true, evidenceBasis });
	}

	// Suggestions: validate to avoid new numbers/entities; drop invalid items by path.
	if (narration?.suggestions && typeof narration.suggestions === "object") {
		const gaps = Array.isArray((narration.suggestions as any).gaps) ? (narration.suggestions as any).gaps : [];
		for (let i = 0; i < gaps.length; i++) {
			const g: any = gaps[i];
			const key = typeof g?.key === "string" ? g.key : "";
			const rationale = typeof g?.rationale === "string" ? g.rationale : "";
			validateChunk({
				text: key,
				path: `narration.suggestions.gaps[${i}].key`,
				citations: [],
				allowKpi: false,
				evidenceBasis: "no_evidence",
				skipEntity: skipEntityForSuggestionKey,
			});
			validateChunk({
				text: rationale,
				path: `narration.suggestions.gaps[${i}].rationale`,
				citations: [],
				allowKpi: false,
				evidenceBasis: "no_evidence",
				allowedKpiTokens: deterministicSuggestionKpiTokens,
			});
		}
		const questions = Array.isArray((narration.suggestions as any).questions) ? (narration.suggestions as any).questions : [];
		for (let i = 0; i < questions.length; i++) {
			const q = typeof questions[i] === "string" ? questions[i] : "";
			validateChunk({
				text: q,
				path: `narration.suggestions.questions[${i}]`,
				citations: [],
				allowKpi: false,
				evidenceBasis: "no_evidence",
				allowedKpiTokens: deterministicSuggestionKpiTokens,
			});
		}
	}

	return { ok: violations.length === 0, violations };
}
