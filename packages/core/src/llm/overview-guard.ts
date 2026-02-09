import type { LlmOverviewV1 as LlmOverviewV1Type } from "./overview-schema";
import { LlmOverviewV1Schema } from "./overview-schema";

export type OverviewGuardViolation = {
	code: string;
	path: string;
	message: string;
};

export type OverviewGuardError = {
	degraded: boolean;
	invalid_fields: number;
	dropped_bullets: number;
	violations_total: number;
	violations: OverviewGuardViolation[];
};

export type OverviewDegradeResult = {
	ok: boolean;
	overview: LlmOverviewV1Type;
	error?: OverviewGuardError;
};

const normalizeWhitespace = (v: unknown): string => {
	if (typeof v !== "string") return "";
	return v.replace(/\s+/g, " ").trim();
};

const normalizeWhitespacePreserveNewlines = (v: unknown): string => {
	if (typeof v !== "string") return "";
	const raw = v.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	// Collapse spaces/tabs within a line, but keep newline structure.
	const lines = raw
		.split("\n")
		.map((line) => line.replace(/[\t ]+/g, " ").trim());
	// Keep at most one blank line between blocks.
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const safeJson = (v: unknown): string => {
	try {
		return JSON.stringify(v);
	} catch {
		return "";
	}
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

// Common deck artifacts / headings that are not named entities.
// Case-insensitive: these tokens will never be treated as a new entity.
const NON_ENTITY_TOKENS = new Set([
	"continued",
	"appendix",
	"summary",
	"overview",
	"highlights",
	"notes",
	// Common sentence starters that are not entities in overlay bullets
	"reliance",
	"need",
	"detailed",
	// Investment-analysis overview structure labels / common non-entity tokens
	"signal",
	"implication",
	"uncertainty",
	"decision",
	"tension",
	"decision tension",
	"deterministic",
]);

const isNonEntityToken = (candidate: string): boolean => {
	const norm = normalizeWhitespace(candidate)
		.replace(/^[^A-Za-z0-9]+/, "")
		.replace(/[^A-Za-z0-9]+$/, "")
		.toLowerCase();
	if (!norm) return false;
	return NON_ENTITY_TOKENS.has(norm);
};

type CitationRef = { page?: number; slide_title?: string; evidence_id?: string };

type DeterministicSource = { page: number; slide_title: string | null };

const collectDeterministicSources = (reportExcerpt: any): DeterministicSource[] => {
	const out: DeterministicSource[] = [];
	const seen = new Set<string>();

	const push = (page: unknown, slide_title: unknown) => {
		const p = typeof page === "number" && Number.isFinite(page) ? page : null;
		if (p == null) return;
		const t = typeof slide_title === "string" ? normalizeWhitespace(slide_title) : "";
		const key = `${p}|${t.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ page: p, slide_title: t || null });
	};

	// KPI sources (stable / explicit)
	const kpis = reportExcerpt?.structured_summary?.kpis;
	if (kpis && typeof kpis === "object") {
		for (const key of ["raise", "revenue", "customers", "growth"]) {
			push(kpis?.[key]?.source?.page, kpis?.[key]?.source?.slide_title);
		}
		push(
			kpis?.performance?.marketing_attributed_revenue_v1?.source?.page,
			kpis?.performance?.marketing_attributed_revenue_v1?.source?.slide_title
		);
	}

	// Generic: walk excerpt and collect any {page, slide_title} pair that looks deterministic.
	const walk = (node: any, depth: number) => {
		if (depth > 10) return;
		if (node == null) return;
		if (typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const v of node) walk(v, depth + 1);
			return;
		}
		if (typeof node.page === "number") push(node.page, node.slide_title);
		for (const v of Object.values(node)) walk(v, depth + 1);
	};
	walk(reportExcerpt, 0);

	return out;
};

const citationMatchesDeterministic = (citation: CitationRef, deterministic: DeterministicSource[]): boolean => {
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

const hasDeterministicCitation = (citations: unknown, deterministic: DeterministicSource[]): boolean => {
	if (!Array.isArray(citations) || citations.length === 0) return false;
	for (const c of citations) {
		if (c && typeof c === "object" && citationMatchesDeterministic(c as any, deterministic)) return true;
	}
	return false;
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

	walkStrings(getAtPath(reportExcerpt, "deal_summary_v1"), 0);
	walkStrings(getAtPath(reportExcerpt, "structured_summary"), 0);
	walkStrings(getAtPath(reportExcerpt, "score_explanation.understanding_v1"), 0);
	// Include all slide titles embedded in excerpt (broad but deterministic).
	walkStrings(reportExcerpt, 0);

	return { allowedStringsLower, allowedTextLower: chunks.join("\n") };
};

const extractEntityCandidates = (text: string): string[] => {
	const raw = String(text || "");
	if (!raw.trim()) return [];

	const escapeRegex = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

	// Suppress sentence-start Title Case tokens that are common non-entities in bullets
	// (e.g., "Reliance on …", "Need to …", "Detailed coverage …").
	// Only applies when the token is the first token (optionally after a bullet prefix)
	// AND the following token begins with a lowercase letter.
	const suppressSentenceStartNonEntityToken = (tok: string): boolean => {
		if (!/^[A-Z][a-z]+$/.test(tok)) return false;
		if (!isNonEntityToken(tok)) return false;
		const esc = escapeRegex(tok);
		const re = new RegExp(`^\\s*(?:[•*\\-]\\s+)?[^A-Za-z0-9]*${esc}\\b\\s+[a-z]`);
		return re.test(raw);
	};

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

	for (const m of raw.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []) {
		const norm = normalizeWhitespace(m);
		if (!norm) continue;
		if (/^Series\s+[A-Z]$/i.test(norm)) continue;
		push(norm);
	}

	const tokenRe = /\b[A-Z][A-Za-z]{3,}\b|\b[A-Z]{4,}\b/g;
	const tokens = raw.match(tokenRe) ?? [];
	const uniq = Array.from(new Set(tokens.map((t) => normalizeWhitespace(t)).filter(Boolean) as string[]));

	for (const tok of uniq) {
		if (!tok) continue;
		if (ignoreSingle.has(tok)) continue;
		if (/^Series$/i.test(tok)) continue;
		if (suppressSentenceStartNonEntityToken(tok)) continue;
		push(tok);
	}

	return candidates;
};

// More conservative entity extraction mode used for investment-analysis reasoning.
// Rationale: sentence-start Titlecase words (e.g. "Confidence") are common false positives.
// We still catch multi-word proper nouns ("Acme Corp") and long acronyms ("MICROSOFT").
const extractEntityCandidatesMultiwordOnly = (text: string): string[] => {
	const raw = String(text || "");
	if (!raw.trim()) return [];

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

	for (const m of raw.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []) {
		const norm = normalizeWhitespace(m);
		if (!norm) continue;
		if (/^Series\s+[A-Z]$/i.test(norm)) continue;
		push(norm);
	}

	for (const m of raw.match(/\b[A-Z]{4,}\b/g) ?? []) {
		push(m);
	}

	return candidates;
};

const firstDisallowedEntity = (
	text: string,
	allowed: { allowedStringsLower: Set<string>; allowedTextLower: string }
): string | null => {
	const allowedText = allowed.allowedTextLower;
	for (const c of extractEntityCandidates(text)) {
		const lower = normalizeWhitespace(c).toLowerCase();
		if (!lower) continue;
		if (allowed.allowedStringsLower.has(lower)) continue;
		if (allowedText.includes(lower)) continue;
		return c;
	}
	return null;
};

const firstDisallowedEntityMultiwordOnly = (
	text: string,
	allowed: { allowedStringsLower: Set<string>; allowedTextLower: string }
): string | null => {
	const allowedText = allowed.allowedTextLower;
	for (const c of extractEntityCandidatesMultiwordOnly(text)) {
		const lower = normalizeWhitespace(c).toLowerCase();
		if (!lower) continue;
		if (allowed.allowedStringsLower.has(lower)) continue;
		if (allowedText.includes(lower)) continue;
		return c;
	}
	return null;
};

// Numeric + KPI token handling
const numericTokenRe = /\$?\b\d[\d,]*(?:\.\d+)?(?:\s?(?:MM|M|B))?%?\b/gi;

const kpiTokens = [
	"revenue",
	"arr",
	"mrr",
	"irr",
	"moic",
	"cap_rate",
	"cac",
	"ltv",
	"margin",
	"runway",
	"burn",
] as const;

const missingEvidencePattern =
	/(missing|not provided|not disclosed|unknown|unclear|no evidence|not included|not reported|not available|needs clarification|cannot verify|insufficient data)/i;

const allowsUncitedKpiAsMissingEvidence = (text: string, path: string): boolean => {
	// Only allow this relaxation in the explicit overview fields requested.
	const allowedPath =
		path === "overview.investment_analysis_overview" ||
		path.startsWith("overview.strengths_overlay[") ||
		path.startsWith("overview.concerns_overlay[") ||
		path.startsWith("overview.coverage_gaps_overlay[");
	if (!allowedPath) return false;

	if (!missingEvidencePattern.test(String(text || ""))) return false;
	// Must not include numbers.
	if (textHasNumericToken(text)) return false;
	return true;
};

const overlaySentenceStartEntitySuppression = new Set(
	[
		"Conduct",
		"Investors",
		"Lack",
		"Insufficient",
		"Potential",
		"Clarity",
		"Insights",
		"Information",
		"Projections",
		"Execution",
		"Risk",
		"Upside",
		"Downside",
		"Evidence",
		"Coverage",
		"Benchmarking",
		"Financial",
		"Market",
		"Customer",
		"Team",
	].map((s) => s.toLowerCase()),
);

const firstBulletToken = (text: string): string | null => {
	const raw = String(text || "");
	const trimmed = raw.replace(/^\s*(?:[•*\-]\s+)?/, "").replace(/^[^A-Za-z0-9]+/, "");
	const m = trimmed.match(/^([A-Za-z]+)/);
	return m?.[1] ? m[1] : null;
};

const textHasKpiToken = (text: string): string | null => {
	const s = String(text || "");
	for (const token of kpiTokens) {
		const pattern = token.includes("_") ? token.replace(/_/g, "[ _-]") : token;
		const re = new RegExp(`\\b${pattern}\\b`, "i");
		if (re.test(s)) return token;
	}
	return null;
};

const textHasNumericToken = (text: string): boolean => {
	const s = String(text || "");
	return (s.match(numericTokenRe) ?? []).length > 0;
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

const commitmentMarkers = ["will", "expects", "guarantees"];
const inferenceMarkers = ["indicates", "implies", "suggests"];

const forceUncertaintyMarkers = (text: string): string => {
	let out = String(text || "");
	out = out.replace(/\bindicates\b/gi, "may indicate");
	out = out.replace(/\bimplies\b/gi, "may imply");
	out = out.replace(/\bsuggests\b/gi, "may suggest");
	return out;
};

const uncertaintyMarkers = ["may", "might", "suggests", "appears", "possibly", "likely", "could"] as const;

const hasUncertaintyLanguage = (text: string): boolean => {
	const t = normalizeWhitespace(text).toLowerCase();
	if (!t) return false;
	for (const w of uncertaintyMarkers) {
		if (new RegExp(`\\b${w}\\b`, "i").test(t)) return true;
	}
	return false;
};

const extractAllIndices = (re: RegExp, text: string): number[] => {
	const out: number[] = [];
	const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
	let m: RegExpExecArray | null;
	while ((m = r.exec(text)) !== null) {
		out.push(m.index);
		if (m.index === r.lastIndex) r.lastIndex++;
	}
	return out;
};

const validateInvestmentAnalysisStructure = (opts: {
	text: string;
	path: string;
	push: (v: OverviewGuardViolation) => void;
}): boolean => {
	const raw = String(opts.text || "");
	const text = raw.trim();
	if (!text) return true;

	// Parsing robustness: tolerate extra spaces after ':' while still requiring the literal label names.
	const signalRe = /(^|\n)\s*[•*\-]?\s*Signal\s*:\s*/gmi;
	const implRe = /(^|\n)\s*[•*\-]?\s*Implication\s*:\s*/gmi;
	const uncRe = /(^|\n)\s*[•*\-]?\s*Uncertainty\s*:\s*/gmi;
	const tensionRe = /(^|\n)\s*[•*\-]?\s*Decision\s*Tension\s*:\s*/gmi;

	const sIdx = extractAllIndices(signalRe, text);
	const iIdx = extractAllIndices(implRe, text);
	const uIdx = extractAllIndices(uncRe, text);
	const dIdx = extractAllIndices(tensionRe, text);

	const n = sIdx.length;
	if (!(n >= 2 && n <= 4) || iIdx.length !== n || uIdx.length !== n || dIdx.length !== n) {
		opts.push({
			code: "investment_overview.structure.required_points",
			path: opts.path,
			message: `Expected 2–4 points with labels Signal/Implication/Uncertainty/Decision Tension. Found Signal=${sIdx.length}, Implication=${iIdx.length}, Uncertainty=${uIdx.length}, DecisionTension=${dIdx.length}.`,
		});
		return false;
	}

	const hasUncertainty = (segment: string): boolean => {
		const t = normalizeWhitespace(segment).toLowerCase();
		if (!t) return false;
		for (const w of uncertaintyMarkers) {
			if (new RegExp(`\\b${w}\\b`, "i").test(t)) return true;
		}
		return false;
	};

	for (let k = 0; k < n; k++) {
		if (!(sIdx[k] < iIdx[k] && iIdx[k] < uIdx[k] && uIdx[k] < dIdx[k])) {
			opts.push({
				code: "investment_overview.structure.order",
				path: opts.path,
				message: `Point ${k + 1} must contain labels in order: Signal, Implication, Uncertainty, Decision Tension.`,
			});
			return false;
		}

		// Implication segment must include uncertainty language.
		const implStart = iIdx[k];
		const implEnd = uIdx[k];
		const seg = text.slice(implStart, implEnd);
		if (!hasUncertainty(seg)) {
			opts.push({
				code: "investment_overview.implication.requires_uncertainty_language",
				path: opts.path,
				message: `Point ${k + 1} Implication must use uncertainty language (may/might/suggests/appears/possibly/likely).`,
			});
			return false;
		}
	}

	return true;
};

const makeEmptyOverview = (): LlmOverviewV1Type => {
	return {
		version: "llm_overview_v1",
		hero_header: "",
		deal_summary: { hero: "", mid: "", long: "" },
		investment_analysis_overview: "",
		strengths_overlay: [],
		concerns_overlay: [],
		coverage_gaps_overlay: [],
		citations: [],
		quality_flags: [],
	};
};

const deterministicOneLiner = (reportExcerpt: any): string => {
	const s =
		normalizeWhitespace(reportExcerpt?.deal_summary_v1?.one_liner) ||
		normalizeWhitespace(reportExcerpt?.deal_summary?.tiers?.hero) ||
		normalizeWhitespace(reportExcerpt?.structured_summary?.company_name) ||
		"";
	return s;
};

const deterministicDealSummaryHeroTier = (reportExcerpt: any): string => {
	return normalizeWhitespace(reportExcerpt?.deal_summary?.tiers?.hero) || "";
};

export function degradeOverviewV1(args: { reportExcerpt: unknown; overview: unknown }): OverviewDegradeResult {
	const reportExcerpt: any = (args as any)?.reportExcerpt ?? {};
	const overviewIn: any = (args as any)?.overview ?? {};

	const allowedEntity = buildAllowedEntityCorpus(reportExcerpt);
	const deterministicSources = collectDeterministicSources(reportExcerpt);

	const violationsAll: OverviewGuardViolation[] = [];
	const push = (v: OverviewGuardViolation) => violationsAll.push(v);

	const base: any = {
		...makeEmptyOverview(),
		...(overviewIn && typeof overviewIn === "object" ? overviewIn : {}),
		version: "llm_overview_v1",
	};

	const next: LlmOverviewV1Type = makeEmptyOverview();
	let degraded = false;
	let invalid_fields = 0;
	let dropped_bullets = 0;

	const citations = Array.isArray(base.citations) ? base.citations : [];
	(next as any).citations = citations;
	(next as any).quality_flags = Array.isArray(base.quality_flags) ? base.quality_flags.slice() : [];

	const requireCitationIfNumericOrKpi = (text: string, path: string): boolean => {
		const hasNumeric = textHasNumericToken(text);
		const kpi = textHasKpiToken(text);
		if (!hasNumeric && !kpi) return true;
		// Allow KPI *tokens* without citation only when explicitly framed as missing/unclear evidence
		// and ONLY when no numeric tokens are present.
		if (!hasNumeric && kpi && allowsUncitedKpiAsMissingEvidence(text, path)) return true;
		if (hasDeterministicCitation(citations, deterministicSources)) return true;
		push({
			code: "citation.required_for_numeric_or_kpi",
			path,
			message: `Numeric/KPI token${kpi ? ` ('${kpi}')` : ""} requires at least one deterministic citation.`,
		});
		return false;
	};

	const validateEntities = (text: string, path: string): boolean => {
		const ent =
			path === "overview.investment_analysis_overview"
				? firstDisallowedEntityMultiwordOnly(text, allowedEntity)
				: firstDisallowedEntity(text, allowedEntity);
		if (!ent) return true;
		// Overlay bullets only: suppress sentence-start Title Case "entities" that are
		// actually generic sentence starters (e.g. Conduct, Investors, Lack, etc.).
		if (
			(path.startsWith("overview.strengths_overlay[") ||
				path.startsWith("overview.concerns_overlay[") ||
				path.startsWith("overview.coverage_gaps_overlay["))
		) {
			const first = firstBulletToken(text);
			if (first && first.toLowerCase() === ent.toLowerCase()) {
				if (overlaySentenceStartEntitySuppression.has(first.toLowerCase())) return true;
			}
		}
		push({
			code: "entity.new_not_in_excerpt",
			path,
			message: `Entity '${ent}' is not present in the allowlisted excerpt corpus.`,
		});
		return false;
	};

	const validateInterpretationLanguage = (text: string, path: string): { ok: boolean; maybeRewritten: string } => {
		const commitment = hasAnyWord(text, commitmentMarkers);
		if (commitment && !hasDeterministicCitation(citations, deterministicSources)) {
			push({
				code: "commitment.citation_required",
				path,
				message: `Commitment marker '${commitment}' requires a deterministic citation.`,
			});
			return { ok: false, maybeRewritten: text };
		}

		const inference = hasAnyWord(text, inferenceMarkers);
		if (inference && !hasDeterministicCitation(citations, deterministicSources)) {
			// If the text already uses uncertainty language, accept it.
			if (hasUncertaintyLanguage(text)) {
				return { ok: true, maybeRewritten: text };
			}

			const rewritten = forceUncertaintyMarkers(text);
			if (rewritten !== text) {
				push({
					code: "inference.forced_uncertainty",
					path,
					message: `Inference marker '${inference}' lacked citations; added uncertainty language.`,
				});
				return { ok: true, maybeRewritten: rewritten };
			}

			push({
				code: "inference.requires_citation_or_uncertainty",
				path,
				message: `Inference marker '${inference}' requires a deterministic citation or uncertainty language.`,
			});
			return { ok: false, maybeRewritten: text };
		}

		return { ok: true, maybeRewritten: text };
	};

	const validateTextField = (opts: {
		text: unknown;
		path: string;
		requireNumericOrKpiCitation?: boolean;
		fallback?: () => string;
		preserveNewlines?: boolean;
	}): string => {
		const normalizeOut = opts.preserveNewlines ? normalizeWhitespacePreserveNewlines : normalizeWhitespace;
		const raw = typeof opts.text === "string" ? opts.text : "";
		const path = opts.path;
		let text = normalizeOut(raw);
		if (!text) return "";

		if (!validateEntities(text, path)) {
			invalid_fields++;
			degraded = true;
			return opts.fallback ? opts.fallback() : "";
		}

		if (opts.requireNumericOrKpiCitation && !requireCitationIfNumericOrKpi(text, path)) {
			invalid_fields++;
			degraded = true;
			return opts.fallback ? opts.fallback() : "";
		}

		const interp = validateInterpretationLanguage(text, path);
		if (!interp.ok) {
			invalid_fields++;
			degraded = true;
			return opts.fallback ? opts.fallback() : "";
		}
		if (interp.maybeRewritten !== text) degraded = true;
		text = normalizeOut(interp.maybeRewritten);
		return text;
	};

	const detOneLiner = deterministicOneLiner(reportExcerpt);
	const detTierHero = deterministicDealSummaryHeroTier(reportExcerpt);

	// hero_header
	next.hero_header = validateTextField({
		text: base.hero_header,
		path: "overview.hero_header",
		requireNumericOrKpiCitation: true,
		fallback: () => detOneLiner,
	});

	// deal_summary.hero (special deterministic fallback)
	next.deal_summary.hero = validateTextField({
		text: base?.deal_summary?.hero,
		path: "overview.deal_summary.hero",
		fallback: () => detTierHero,
	});

	// deal_summary.mid/long degrade-to-empty on failure
	next.deal_summary.mid = validateTextField({
		text: base?.deal_summary?.mid,
		path: "overview.deal_summary.mid",
	});
	next.deal_summary.long = validateTextField({
		text: base?.deal_summary?.long,
		path: "overview.deal_summary.long",
	});

	// investment_analysis_overview
	next.investment_analysis_overview = validateTextField({
		text: base.investment_analysis_overview,
		path: "overview.investment_analysis_overview",
		requireNumericOrKpiCitation: true,
		preserveNewlines: true,
	});
	if (next.investment_analysis_overview) {
		const ok = validateInvestmentAnalysisStructure({
			text: next.investment_analysis_overview,
			path: "overview.investment_analysis_overview",
			push,
		});
		if (!ok) {
			invalid_fields++;
			degraded = true;
			next.investment_analysis_overview = "";
		}
	}

	const validateBullets = (arr: unknown, pathPrefix: string): string[] => {
		const raw = Array.isArray(arr) ? arr : [];
		const keep: string[] = [];
		for (let i = 0; i < raw.length; i++) {
			const path = `${pathPrefix}[${i}]`;
			const bullet = validateTextField({
				text: raw[i],
				path,
				requireNumericOrKpiCitation: true,
				fallback: () => "",
			});
			if (!bullet) {
				if (typeof raw[i] === "string" && normalizeWhitespace(raw[i])) {
					dropped_bullets++;
					degraded = true;
				}
				continue;
			}
			keep.push(bullet);
		}
		return keep;
	};

	next.strengths_overlay = validateBullets(base.strengths_overlay, "overview.strengths_overlay");
	next.concerns_overlay = validateBullets(base.concerns_overlay, "overview.concerns_overlay");
	next.coverage_gaps_overlay = validateBullets(base.coverage_gaps_overlay, "overview.coverage_gaps_overlay");

	if (degraded) {
		if (!next.quality_flags.includes("guard_degraded")) next.quality_flags.push("guard_degraded");
	}

	// Ensure final output conforms to schema (and applies defaults/max bounds).
	const parsed = LlmOverviewV1Schema.safeParse(next);
	const final = parsed.success ? parsed.data : makeEmptyOverview();
	if (!parsed.success) {
		degraded = true;
		invalid_fields++;
		push({
			code: "schema.invalid_after_degrade",
			path: "overview",
			message: `Overview failed schema validation after degrade: ${safeJson(parsed.error?.issues?.[0] ?? null)}`,
		});
	}

	const violations_total = violationsAll.length;
	const ok = violations_total === 0;
	const error: OverviewGuardError | undefined =
		!ok || degraded
			? {
				degraded,
				invalid_fields,
				dropped_bullets,
				violations_total,
				violations: violationsAll.slice(0, 10),
			}
			: undefined;

	return { ok, overview: final, error };
}
