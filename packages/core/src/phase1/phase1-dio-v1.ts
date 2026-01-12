import { createHash } from "crypto";
import { getSelectedPolicyIdFromAny } from "../classification/get-selected-policy-id";

export type Phase1ConfidenceBand = "low" | "med" | "high";

export type Phase1RecommendationV1 = "PASS" | "CONSIDER" | "GO";

export type Phase1ExecutiveSummaryEvidenceRefV1 = {
	claim_id: string;
	document_id: string;
	page?: number;
	page_range?: [number, number];
	snippet?: string;
};

export type Phase1ExecutiveSummaryV1 = {
	title: string;
	one_liner: string;
	deal_type: string;
	raise: string;
	business_model: string;
	traction_signals: string[];
	key_risks_detected: string[];
	unknowns: string[];
	confidence: {
		overall: Phase1ConfidenceBand;
		sections?: Record<string, Phase1ConfidenceBand>;
	};
	evidence: Phase1ExecutiveSummaryEvidenceRefV1[];
};

export type Phase1ExecutiveSummaryV2 = {
	// Deterministic, investor-grade composer output from Phase 1 structured signals.
	title: string;
	paragraphs: string[]; // 1–2 short paragraphs
	highlights: string[]; // bullets
	missing: string[]; // explicit acknowledgement of missing fields
	signals: {
		recommendation: Phase1RecommendationV1;
		score: number | null; // 0–100 when available; null when unavailable
		confidence: Phase1ConfidenceBand;
		blockers_count: number;
	};
	generated_at?: string; // derived from overview_v2.generated_at when present
};

export type ScoreSnapshot = {
	score: number | null;
	decision: Phase1RecommendationV1;
	confidence: Phase1ConfidenceBand;
	source: "overall" | "phase1" | "fallback";
};

function selectScoreSnapshot(args: {
	overall_score?: unknown;
	phase1_score?: unknown;
	decision: Phase1RecommendationV1;
	confidence: Phase1ConfidenceBand;
}): ScoreSnapshot {
	const overall = typeof args.overall_score === "number" && Number.isFinite(args.overall_score)
		? Math.round(args.overall_score)
		: null;
	if (overall != null) {
		return { score: overall, decision: args.decision, confidence: args.confidence, source: "overall" };
	}

	const phase1 = typeof args.phase1_score === "number" && Number.isFinite(args.phase1_score)
		? Math.round(args.phase1_score)
		: null;
	if (phase1 != null) {
		return { score: phase1, decision: args.decision, confidence: args.confidence, source: "phase1" };
	}

	return { score: null, decision: args.decision, confidence: args.confidence, source: "fallback" };
}

export type Phase1ClaimCategoryV1 =
	| "product"
	| "market"
	| "traction"
	| "terms"
	| "team"
	| "risk"
	| "other";

export type Phase1ClaimEvidenceV1 = {
	document_id: string;
	page?: number;
	page_range?: [number, number];
	snippet: string;
};

export type Phase1ClaimV1 = {
	claim_id: string;
	category: Phase1ClaimCategoryV1;
	text: string;
	evidence: Phase1ClaimEvidenceV1[];
};

export type Phase1CoverageV1 = {
	sections: Record<string, "present" | "partial" | "missing">;
	// Additive: richer semantics for UI/analytics without changing scoring math.
	section_details?: Record<string, Phase1CoverageSectionContractV1>;
	required_sections?: string[];
	sections_missing_list?: string[];
	missing_counts?: { required: number; missing: number; provided: number };
	section_labels?: Record<string, string>;
};

export type Phase1CoverageSectionWhyMissingV1 =
	| "empty_text"
	| "explicit_not_provided"
	| "no_evidence"
	| "low_confidence";

export type Phase1CoverageSectionContractV1 = {
	present: boolean;
	provided: boolean;
	confidence: number;
	confidence_band?: Phase1ConfidenceBand;
	why_missing?: Phase1CoverageSectionWhyMissingV1;
};

export type Phase1ExecutiveAccountabilityV1 = {
	support: {
		product: "evidence" | "inferred" | "missing";
		icp: "evidence" | "inferred" | "missing";
		market: "evidence" | "inferred" | "missing";
		business_model: "evidence" | "inferred" | "missing";
		traction: "evidence" | "inferred" | "missing";
		risks: "evidence" | "inferred" | "missing";
	};
	coverage_missing_sections: string[];
	evidence_counts: {
		claims_total: number;
		evidence_total: number;
	};
};

export type Phase1ExecutiveScoreAuditV1 = {
	score_reported: number | null;
	confidence_reported: Phase1ConfidenceBand;
	rubric_score: number;
	rubric_band: "high" | "med" | "low";
	mismatch: boolean;
	reasons: string[];
};

export type Phase1DecisionSummaryV1 = {
	score: number; // 0-100
	recommendation: Phase1RecommendationV1;
	reasons: string[];
	blockers: string[];
	next_requests: string[];
	confidence: Phase1ConfidenceBand;
};

export type Phase1DIOV1 = {
	executive_summary_v1: Phase1ExecutiveSummaryV1;
	executive_summary_v2?: Phase1ExecutiveSummaryV2;
	// Additive: optional investor-readable synthesis from the worker (Phase 1 only).
	deal_summary_v2?: {
		generated_at: string;
		model: string;
		summary: string;
		strengths: string[];
		risks: string[];
		open_questions: string[];
	};
	decision_summary_v1: Phase1DecisionSummaryV1;
	claims: Phase1ClaimV1[];
	coverage: Phase1CoverageV1;
	// Additive: deterministic business archetype classification (worker-provided).
	business_archetype_v1?: {
		value: string;
		confidence: number;
		generated_at?: string;
		evidence?: Array<{ document_id: string; page_range?: [number, number]; snippet: string; rule?: string }>;
	};
	// Additive: worker-computed canonical overview for Phase 1.
	deal_overview_v2?: {
		deal_name?: string;
		product_solution?: string | null;
		market_icp?: string | null;
		deal_type?: string;
		raise_terms?: string | null;
		raise?: string;
		go_to_market?: string | null;
		business_model?: string;
		traction_signals?: string[];
		key_risks_detected?: string[];
		generated_at?: string;
		sources?: Array<{ document_id: string; page_range?: [number, number]; note?: string }>;
	};
	// Additive: diff between latest stored DIO and current run.
	update_report_v1?: {
		generated_at: string;
		previous_dio_found?: boolean;
		since_dio_id?: string;
		since_version?: number;
		changes: Array<{ field: string; change_type: "added" | "updated" | "removed"; before?: string; after?: string }>;
		summary?: string;
	};
};

export type Phase1GeneratorDealInfo = {
	deal_id: string;
	name?: string | null;
	stage?: string | null;
};

export type Phase1GeneratorInputDocument = {
	document_id: string;
	title?: string | null;
	type?: string | null;
	page_count?: number | null;
	// Common structured extraction keys (best-effort; may vary by extractor)
	full_text?: string;
	fullText?: string;
	summary?: string;
	text_summary?: string;
	mainHeadings?: string[];
	headings?: string[];
	keyMetrics?: any[];
	metrics?: any[];
	pages?: Array<{ page?: number; text?: string }>; // if available
};

type DealOverviewV1 = {
	deal_name?: string;
	product_solution: string;
	market_icp: string;
	deal_type: string;
	raise: string;
	business_model: string;
	traction_signals: string[];
	traction_metrics: string[];
	key_risks_detected: string[];
	product_solution_present: boolean;
	market_icp_present: boolean;
};

function stableId(prefix: string, text: string): string {
	const norm = text.trim().toLowerCase();
	const hash = createHash("sha256").update(norm).digest("hex").slice(0, 12);
	return `${prefix}_${hash}`;
}

function safeString(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

function uniqStrings(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const s = v.trim();
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	return out;
}

function normalizeConfidenceToNumber(confidence: unknown): number | null {
	if (typeof confidence === "number" && Number.isFinite(confidence)) {
		return Math.max(0, Math.min(1, confidence));
	}
	if (typeof confidence === "string") {
		const c = confidence.trim().toLowerCase();
		if (c === "high") return 0.8;
		if (c === "med" || c === "medium") return 0.6;
		if (c === "low") return 0.35;
	}
	return null;
}

export function isSectionProvided(sectionObj: any): { provided: boolean; why_missing?: Phase1CoverageSectionWhyMissingV1 } {
	const MIN_TEXT_LEN = 20;
	const LOW_CONFIDENCE = 0.4;

	if (sectionObj == null) return { provided: false, why_missing: "empty_text" };
	if (typeof sectionObj !== "object") {
		const s = sanitizeInlineText(safeString(sectionObj));
		if (!s.trim()) return { provided: false, why_missing: "empty_text" };
		const lower = s.toLowerCase();
		if (/(not\s+provided|n\/?a|tbd|unknown|none)/i.test(lower)) return { provided: false, why_missing: "explicit_not_provided" };
		if (s.length < MIN_TEXT_LEN) return { provided: false, why_missing: "empty_text" };
		return { provided: true };
	}

	const evidenceIds = Array.isArray(sectionObj?.evidence_ids)
		? sectionObj.evidence_ids.filter((x: any) => typeof x === "string" && x.trim())
		: [];
	if (evidenceIds.length > 0) return { provided: true };

	const candidates: unknown[] = [
		sectionObj?.text,
		sectionObj?.summary,
		sectionObj?.value,
		sectionObj?.content,
		sectionObj?.description,
		sectionObj?.answer,
	];
	let text = "";
	for (const c of candidates) {
		if (typeof c === "string" && c.trim()) {
			text = sanitizeInlineText(c);
			break;
		}
	}
	const conf = normalizeConfidenceToNumber(sectionObj?.confidence) ?? normalizeConfidenceToNumber(sectionObj?.confidence_band);

	if (!text.trim()) return { provided: false, why_missing: "empty_text" };

	const lower = text.toLowerCase();
	if (/(not\s+provided|n\/?a|tbd|unknown|none)/i.test(lower)) return { provided: false, why_missing: "explicit_not_provided" };

	if (text.length < MIN_TEXT_LEN) {
		if (conf !== null && conf < LOW_CONFIDENCE) return { provided: false, why_missing: "low_confidence" };
		return { provided: false, why_missing: "empty_text" };
	}

	if (conf !== null && conf < LOW_CONFIDENCE) return { provided: false, why_missing: "low_confidence" };
	return { provided: true };
}

function getRequiredPhase1Sections(policy_id: string | null): string[] {
	// Default: keep existing Phase 1 coverage/scoring keys.
	const defaultRequired = [
		"product_solution",
		"market_icp",
		"raise_terms",
		"business_model",
		"traction",
		"financials",
		"team",
		"gtm",
		"risks",
	];

	if (policy_id === "real_estate_underwriting") {
		// Real-estate underwriting: avoid penalizing generic startup semantics (e.g., SaaS ICP phrasing).
		// Keep stored keys stable; UI can translate via section_labels.
		return [
			"product_solution",
			"market_icp",
			"raise_terms",
			"financials",
			"team",
			"gtm",
			"risks",
			"traction",
		];
	}

	return defaultRequired;
}

function getPhase1SectionLabels(policy_id: string | null): Record<string, string> {
	if (policy_id === "real_estate_underwriting") {
		return {
			product_solution: "asset / property overview",
			market_icp: "market & tenant profile",
			raise_terms: "capital stack / terms",
			financials: "underwriting / financials",
			team: "sponsor / operator",
			gtm: "business plan / leasing strategy",
			risks: "risks",
			traction: "occupancy / rent roll / performance",
			business_model: "strategy / model",
		};
	}

	return {
		product_solution: "product / solution",
		market_icp: "market / ICP",
		raise_terms: "raise / terms",
		business_model: "business model",
		traction: "traction",
		financials: "financials",
		team: "team",
		gtm: "go-to-market",
		risks: "risks",
	};
}

function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferCompanyHint(params: { dealName?: string | null; docs: Phase1GeneratorInputDocument[] }): string {
	const fromDeal = sanitizeInlineText(safeString(params.dealName));
	if (fromDeal) {
		// Prefer the first non-generic token from the deal name.
		for (const tok of fromDeal.split(/\s+/).filter(Boolean)) {
			const cleaned = tok.replace(/[^A-Za-z0-9]/g, "");
			if (!cleaned) continue;
			if (cleaned.length < 3 || cleaned.length > 24) continue;
			if (/^(deal|project|inc|llc|ltd|co)$/i.test(cleaned)) continue;
			return cleaned;
		}
	}

	// Fallback: pull a likely company token from a doc title (e.g., "Acme Deck").
	for (const d of params.docs) {
		const title = sanitizeInlineText(safeString(d?.title));
		if (!title) continue;
		for (const tok of title.split(/\s+/).filter(Boolean)) {
			const cleaned = tok.replace(/[^A-Za-z0-9]/g, "");
			if (!cleaned) continue;
			if (cleaned.length < 3 || cleaned.length > 24) continue;
			if (/^(pitch|deck|presentation|confidential|memo|report|overview)$/i.test(cleaned)) continue;
			return cleaned;
		}
	}

	return "";
}

function extractCandidateSentences(text: string): string[] {
	const raw = safeString(text);
	if (!raw.trim()) return [];
	const lines = raw.split(/\r?\n/g);
	const out: string[] = [];
	for (const ln of lines) {
		const line = sanitizeInlineText(ln);
		if (!line) continue;
		// Split on sentence endings when possible, but preserve short pitch-deck style fragments.
		const parts = line.split(/(?<=[.!?])\s+/g).map((p) => sanitizeInlineText(p)).filter(Boolean);
		for (const p of parts) {
			if (p.length < 18) continue;
			out.push(p);
			if (out.length >= 180) return out;
		}
	}
	return out;
}

function isCompanyTractionSnippet(snippet: string, companyHint?: string): boolean {
	const s = sanitizeInlineText(snippet);
	if (!s) return false;

	const ownership = /\b(we|our|us)\b/i.test(s)
		|| (companyHint
			? new RegExp(`\\b${escapeRegExp(companyHint)}\\b`, "i").test(s)
			: false);

	// Concrete company traction metrics (prefer numeric/units) rather than generic mentions.
	const hasCurrencyOrPercent = /[$€£]\s?\d/.test(s) || /\b\d+(?:\.\d+)?\s*%\b/.test(s);
	const hasKpiCount = /\b\d[\d,]*(?:\.\d+)?\s+(customers?|users?|transactions?)\b/i.test(s);
	const hasArrMrrGmvWithNumber = /\b(arr|mrr|gmv)\b[^\n\r]{0,18}[$€£]?\s?\d/i.test(s);
	const hasRunRateWithNumber = /\brun\s+rate\b/i.test(s) && /[$€£]?\s?\d/.test(s);
	const hasRetentionOrChurnWithNumber = /\b(retention|churn)\b/i.test(s) && /\d/.test(s);
	const hasBookingsWithNumber = /\bbookings?\b/i.test(s) && /[$€£]?\s?\d/.test(s);
	const hasConcreteMetric =
		hasCurrencyOrPercent
		|| hasKpiCount
		|| hasArrMrrGmvWithNumber
		|| hasRunRateWithNumber
		|| hasRetentionOrChurnWithNumber
		|| hasBookingsWithNumber;

	// Hard reject macro/industry commentary even if numeric.
	// This is intentionally strict to avoid counting industry-level numbers as company traction.
	const macroHardBlock = /\b(industry|market|global|platforms|streaming\s+industry|streaming\s+platforms?)\b/i.test(s)
		|| /\bthe\s+market\b/i.test(s)
		|| /\bmarket\s+(grew|growth|size|revenue)\b/i.test(s)
		|| /\b(worldwide|sector|macro|cagr|forecast|projection)\b/i.test(s);
	if (macroHardBlock) return false;

	// Require ownership AND either a numeric metric OR an operational traction verb.
	const operationalVerb = /\b(generated|reached|hit|achieved|booked|signed|closed|launched|onboarded|acquired|retained|renewed|expanded|grew|increased|decreased|scaled)\b/i.test(s);
	return ownership && (hasConcreteMetric || operationalVerb);
}

function hasSpacedLogoOcrArtifact(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	// e.g. "D R O P A B L E S" (5+ single-letter tokens separated by spaces)
	return /\b(?:[A-Za-z]\s+){4,}[A-Za-z]\b/.test(s);
}

function capsTokenRatio(value: string): number {
	const s = sanitizeInlineText(value);
	if (!s) return 0;
	const tokens = s.split(/\s+/g).filter(Boolean);
	if (tokens.length === 0) return 0;
	const capsTokens = tokens.filter((t) => {
		if (t.length < 2) return false;
		if (!/[A-Z]/.test(t)) return false;
		return /^[A-Z0-9]+$/.test(t);
	}).length;
	return capsTokens / tokens.length;
}

function hardValidateProductSolution(value: string): string {
	const s = sanitizeInlineText(value);
	if (!s) return "";
	if (hasSpacedLogoOcrArtifact(s)) return "";
	if (/^(unknown|n\/?a|none)$/i.test(s.trim())) return "";

	// Allow ALL CAPS taglines only if they look verb-like (not a logo/name artifact).
	if (capsTokenRatio(s) > 0.6) {
		const verbLike = /\b(HELPS|ENABLES|BUILT\s+FOR|PROVIDES|DELIVERS|AUTOMATES|CONNECTS|PLATFORM\s+FOR)\b/i.test(s);
		if (!verbLike) return "";
	}

	return s;
}

function hardValidateMarketICP(value: string): string {
	const s = sanitizeInlineText(value);
	if (!s) return "";
	if (hasSpacedLogoOcrArtifact(s)) return "";
	if (capsTokenRatio(s) > 0.4) return "";
	if (/^(unknown|n\/?a|none)$/i.test(s.trim())) return "";

	// ICP lines are often noun phrases; allow "for/target/built for" without requiring a business verb.
	const hasIcpSignal =
		/\b(icp|ideal\s+customer|target\s+customer|target\s+market|who\s+we\s+serve|customers?|buyers?)\b/i.test(s)
		|| /\b(for|target|targets|targeting|built\s+for|designed\s+for|used\s+by|serves?|operators?)\b/i.test(s);
	if (!hasIcpSignal && s.split(/\s+/g).filter(Boolean).length < 3) return "";
	return s;
}

function hardValidateRealEstateMarketIcp(value: string): string {
	const s = sanitizeInlineText(value);
	if (!s) return "";
	if (hasSpacedLogoOcrArtifact(s)) return "";
	if (capsTokenRatio(s) > 0.4) return "";
	if (/^(unknown|n\/?a|none)$/i.test(s.trim())) return "";

	// For RE underwriting, we treat market_icp as "market & tenant profile".
	// Allow noun-phrase evidence (no business verb required), but require RE market/tenant signals.
	const hasSignal =
		/\b(market|msa|submarket|tenant|renters?|leasing|occupanc|job\s+growth|in-?migration|demographic|population|workforce)\b/i.test(s);
	if (!hasSignal) return "";

	const tokens = s.split(/\s+/g).filter(Boolean);
	if (tokens.length < 4) return "";
	return s;
}

function normalizeOverviewSentence(value: string, maxChars: number): string {
	let s = safeString(value);
	if (!s.trim()) return "";

	// Collapse common OCR junk / artifacts.
	s = s
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/(?:—|–|_){2,}/g, " ")
		.replace(/[@#%*=^~`|\\]{2,}/g, " ")
		.replace(/\bRp\b\s*[—–-]+\s*\d+(?:\s*[—–-]+\s*\d+)?/gi, " ")
		.replace(/\b\d+\s*[—–-]+\s*\d+\b/g, " ")
		.replace(/([!?.,:;])\1{2,}/g, "$1")
		.replace(/\s+/g, " ");

	s = sanitizeInlineText(s);
	if (!s) return "";

	// Ensure we return a sentence-like fragment.
	if (!/[.!?]$/.test(s)) s = `${s}.`;
	return capOneLiner(s, maxChars);
}

function isHighQualityOverviewCandidate(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (s.length < 18) return false;
	if ((s.match(/\uFFFD|�/g) ?? []).length >= 2) return false;
	if (/[@#%*=^~`|\\]{2,}/.test(s)) return false;
	if (/([!?.,:;])\1{2,}/.test(s)) return false;
	if (/(?:—|–|_){2,}/.test(s)) return false;

	const noSpace = s.replace(/\s+/g, "");
	if (noSpace.length < 14) return false;
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const symbolLike = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
	const letterRatio = letters / noSpace.length;
	const symbolRatio = symbolLike / noSpace.length;
	if (letterRatio < 0.55) return false;
	if (symbolRatio > 0.35) return false;

	const tokens = s.split(/\s+/g).filter(Boolean);
	const letterTokens = tokens.filter((t) => /[A-Za-z]/.test(t));
	const upperTokens = letterTokens.filter((t) => /^[A-Z]{2,}$/.test(t.replace(/[^A-Za-z]/g, "")));
	if (letterTokens.length >= 5 && upperTokens.length / letterTokens.length > 0.4) return false;

	return true;
}

function normalizeForMatch(value: string): string {
	return safeString(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function headingMatches(line: string, needles: string[]): boolean {
	const norm = normalizeForMatch(line);
	if (!norm) return false;
	for (const n of needles) {
		const needle = normalizeForMatch(n);
		if (!needle) continue;
		if (norm.includes(needle)) return true;
	}
	return false;
}

function isProbableHeading(line: string): boolean {
	const s = sanitizeInlineText(line);
	if (!s) return false;
	if (s.length > 72) return false;
	if (/:$/.test(s)) return true;
	const lettersOnly = s.replace(/[^A-Za-z]/g, "");
	if (lettersOnly.length >= 6 && lettersOnly === lettersOnly.toUpperCase()) return true;
	return false;
}

function splitDeckLines(text: string): string[] {
	return safeString(text)
		.split(/\r\n|\n|\r/g)
		.map((l) => sanitizeInlineText(l))
		.filter(Boolean);
}

function extractFromPitchDeckPages(params: {
	pages: Array<{ page?: number; text?: string }>;
	mode: "product" | "market";
}): string {
	const pages = Array.isArray(params.pages) ? params.pages : [];
	if (pages.length === 0) return "";

	const ordered = [...pages].sort((a, b) => {
		const ap = typeof a.page === "number" ? a.page : Number.POSITIVE_INFINITY;
		const bp = typeof b.page === "number" ? b.page : Number.POSITIVE_INFINITY;
		return ap - bp;
	});

	const firstPages = ordered.slice(0, 3);
	const taglineCandidates: string[] = [];
	const headingCandidates: string[] = [];

	const productHeadings = ["what we do", "overview", "our product", "product", "solution", "platform", "our solution"];
	const marketHeadings = ["who we serve", "customers", "customer", "built for", "for", "ideal customer", "icp", "target customer", "target market"];

	const builtForRe = /\b(built\s+for|for)\b\s+[^\n\r]{0,140}/i;
	const helpsRe = /\b\w[^\n\r]{0,60}\b(helps|enables|empowers|lets|allows|automates|provides|builds|delivers)\b[^\n\r]{0,140}/i;

	// (a) Title slide + first 2 pages: look for short, sentence-like taglines.
	for (const p of firstPages) {
		const lines = splitDeckLines(p.text ?? "");
		for (const line of lines) {
			const m = params.mode === "market" ? line.match(builtForRe) : line.match(helpsRe);
			if (m && isHighQualityOverviewCandidate(m[0])) taglineCandidates.push(m[0]);
			// Fallback: accept a clean short sentence-like line (product only).
			if (
				params.mode === "product" &&
				taglineCandidates.length < 4 &&
				isHighQualityOverviewCandidate(line) &&
				line.length <= 220
			) {
				taglineCandidates.push(line);
			}
			if (taglineCandidates.length >= 6) break;
		}
		if (taglineCandidates.length >= 6) break;
	}

	// (b,c) Headings + bullet lines under headings.
	const needles = params.mode === "market" ? marketHeadings : productHeadings;
	for (const p of ordered) {
		const lines = splitDeckLines(p.text ?? "");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!headingMatches(line, needles)) continue;
			if (!isProbableHeading(line) && line.length > 36) continue;

			for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
				const nxt = lines[j];
				if (!nxt) continue;
				if (isProbableHeading(nxt) && headingMatches(nxt, needles)) break;
				const bullet = nxt.replace(/^[-•*\u2022]\s+/, "").trim();
				if (!bullet) continue;
				if (!/^[-•*\u2022]/.test(nxt) && bullet.length > 220) continue;
				if (!isHighQualityOverviewCandidate(bullet)) continue;
				headingCandidates.push(bullet);
				if (headingCandidates.length >= 8) break;
			}
			if (headingCandidates.length >= 8) break;
		}
		if (headingCandidates.length >= 8) break;
	}

	const pick = (arr: string[]) => arr.find((c) => isHighQualityOverviewCandidate(c)) ?? "";
	return pick(taglineCandidates) || pick(headingCandidates);
}

function extractCanonicalValue(docs: Phase1GeneratorInputDocument[], key: "product_solution" | "market_icp"): string {
	for (const d of docs) {
		const v = (d as any)?.structured_data?.canonical?.[key] ?? (d as any)?.structuredData?.canonical?.[key] ?? (d as any)?.canonical?.[key];
		const s = sanitizeInlineText(safeString(v));
		if (!s) continue;
		if (s.toLowerCase() === "unknown") continue;
		if (!isHighQualityOverviewCandidate(s)) continue;
		return s;
	}
	return "";
}

function extractOverviewField(params: {
	docs: Phase1GeneratorInputDocument[];
	field: "product_solution" | "market_icp";
	readableText: string;
}): string {
	const docs = Array.isArray(params.docs) ? params.docs : [];
	const canonical = extractCanonicalValue(docs, params.field);
	if (canonical) return canonical;

	// Pitch deck page heuristics.
	for (const d of docs) {
		if (safeString(d.type).trim() !== "pitch_deck") continue;
		const pages = Array.isArray((d as any).pages) ? (((d as any).pages as any[]) ?? []) : [];
		const extracted = extractFromPitchDeckPages({
			pages,
			mode: params.field === "market_icp" ? "market" : "product",
		});
		if (extracted) return extracted;
	}

	// Safe non-deck fallback: deterministic, sentence-like snippets from extracted text.
	const fallback =
		params.field === "market_icp" ? detectMarketSnippet(params.readableText) : detectProductSnippet(params.readableText);
	if (fallback && isHighQualityOverviewCandidate(fallback)) return fallback;

	// Real-estate memo fallback: map offer memo signals into product/market fields.
	if (looksLikeRealEstateOffering(params.readableText)) {
		const reFallback =
			params.field === "market_icp"
				? detectRealEstateMarketIcp(params.readableText)
				: detectRealEstateProductSolution(params.readableText);
		if (reFallback && isHighQualityOverviewCandidate(reFallback)) return reFallback;
	}

	return "";
}

function isReadableSpan(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (s.length < 40) return false;
	const noSpace = s.replace(/\s+/g, "");
	if (noSpace.length < 30) return false;
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const symbols = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
	const letterRatio = letters / noSpace.length;
	const symbolRatio = symbols / noSpace.length;
	if (letterRatio < 0.55) return false;
	if (symbolRatio > 0.35) return false;
	if ((s.match(/�/g) ?? []).length >= 2) return false;
	return true;
}

function isReadableSignalSpan(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (s.length < 18) return false;
	if (!/(\brais(ing|e)\b|\bseeking\b|\bfunding\b|\bthe ask\b|\$|\bseed\b|\bpre-?seed\b|series\s+[a-d]|\bMRR\b|\bARR\b|\brevenue\b|\bcustomers?\b|\busers?\b)/i.test(s)) {
		return false;
	}
	const noSpace = s.replace(/\s+/g, "");
	if (noSpace.length < 14) return false;
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const symbols = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
	const letterRatio = letters / noSpace.length;
	const symbolRatio = symbols / noSpace.length;
	if (letterRatio < 0.4) return false;
	if (symbolRatio > 0.5) return false;
	if ((s.match(/�/g) ?? []).length >= 2) return false;
	return true;
}

function extractReadableSpansFromText(value: string): string[] {
	const raw = safeString(value);
	if (!raw.trim()) return [];
	const spans = raw
		.split(/\n{2,}|\r\n{2,}/g)
		.flatMap((p) => p.split(/\n|\r/g))
		.map((s) => sanitizeInlineText(s))
		.filter(Boolean);
	const out: string[] = [];
	for (const s of spans) {
		if (!isReadableSpan(s) && !isReadableSignalSpan(s)) continue;
		out.push(s);
		if (out.length >= 20) break;
	}
	return out;
}

function extractAllReadableText(docs: Phase1GeneratorInputDocument[]): string {
	const parts: string[] = [];
	for (const d of docs) {
		const text = pickBestText(d);
		if (text && isReadableSpan(text)) {
			parts.push(text);
		} else if (text) {
			parts.push(...extractReadableSpansFromText(text));
		}
		const pages = Array.isArray((d as any).pages) ? ((d as any).pages as any[]) : [];
		for (const p of pages) {
			const t = safeString(p?.text);
			if (t && isReadableSpan(t)) {
				parts.push(t);
			} else if (t) {
				parts.push(...extractReadableSpansFromText(t));
			}
		}
	}
	return parts.join("\n\n");
}

function capOneLiner(value: string, maxChars: number): string {
	const s = sanitizeInlineText(value);
	if (s.length <= maxChars) return s;
	const cut = s.slice(0, maxChars - 1);
	const lastSpace = cut.lastIndexOf(" ");
	const trimmed = (lastSpace >= Math.floor(maxChars * 0.6) ? cut.slice(0, lastSpace) : cut).trim();
	return `${trimmed}…`;
}

function buildDealOverviewV1(params: {
	dealName?: string | null;
	docs: Phase1GeneratorInputDocument[];
	canonical?: Partial<
		Pick<
			DealOverviewV1,
			"deal_type" | "raise" | "business_model" | "traction_signals" | "key_risks_detected" | "product_solution" | "market_icp"
		>
	>;
}): DealOverviewV1 {
	const docs = Array.isArray(params.docs) ? params.docs : [];
	const readableText = extractAllReadableText(docs).slice(0, 60_000);
	const companyHint = inferCompanyHint({ dealName: params.dealName, docs });

	const deal_type_detected = detectDealType({ docs, readableText }) ?? "Unknown";
	const raiseDetected = detectRaise(readableText);
	const raise_detected = raiseDetected ?? "Unknown";
	const business_model_detected = detectBusinessModel(readableText) ?? "Unknown";
	const traction_signals_detected = detectTractionSignals(readableText, companyHint);
	const traction_metrics_detected = detectTractionMetrics(readableText);
	const key_risks_detected = detectRiskSignals(readableText);

	const canonicalDealType = sanitizeInlineText(safeString(params.canonical?.deal_type));
	const canonicalRaise = sanitizeInlineText(safeString(params.canonical?.raise));
	const canonicalBusinessModel = sanitizeInlineText(safeString(params.canonical?.business_model));
	const canonicalTractionSignals = Array.isArray(params.canonical?.traction_signals)
		? params.canonical?.traction_signals.map((s) => sanitizeInlineText(safeString(s))).filter(Boolean)
		: undefined;
	const canonicalRisks = Array.isArray(params.canonical?.key_risks_detected)
		? params.canonical?.key_risks_detected.map((s) => sanitizeInlineText(safeString(s))).filter(Boolean)
		: undefined;
	const canonicalProductSolution = sanitizeInlineText(safeString((params.canonical as any)?.product_solution));
	const canonicalMarketIcp = sanitizeInlineText(safeString((params.canonical as any)?.market_icp));

	const deal_type = canonicalDealType && canonicalDealType.toLowerCase() !== "unknown" ? canonicalDealType : deal_type_detected;
	const raise = canonicalRaise && canonicalRaise.toLowerCase() !== "unknown" ? canonicalRaise : raise_detected;
	const business_model =
		canonicalBusinessModel && canonicalBusinessModel.toLowerCase() !== "unknown" ? canonicalBusinessModel : business_model_detected;
	const traction_signals = (canonicalTractionSignals && canonicalTractionSignals.length > 0 ? canonicalTractionSignals : traction_signals_detected).slice(0, 8);
	const risks = (canonicalRisks && canonicalRisks.length > 0 ? canonicalRisks : key_risks_detected).slice(0, 8);

	const extractedProduct = canonicalProductSolution && canonicalProductSolution.toLowerCase() !== "unknown" ? canonicalProductSolution : extractOverviewField({
		docs,
		field: "product_solution",
		readableText,
	});
	const extractedMarket = canonicalMarketIcp && canonicalMarketIcp.toLowerCase() !== "unknown" ? canonicalMarketIcp : extractOverviewField({
		docs,
		field: "market_icp",
		readableText,
	});

	const product_solution = normalizeOverviewSentence(extractedProduct, 180);
	const market_icp = normalizeOverviewSentence(extractedMarket, 180);
	const product_solution_present = !!product_solution.trim();
	const market_icp_present = !!market_icp.trim();

	return {
		deal_name: sanitizeInlineText(safeString(params.dealName)),
		product_solution,
		market_icp,
		deal_type,
		raise,
		business_model,
		traction_signals: uniqStrings(traction_signals),
		traction_metrics: uniqStrings(traction_metrics_detected),
		key_risks_detected: uniqStrings(risks),
		product_solution_present,
		market_icp_present,
	};
}

function pickBestText(doc: Phase1GeneratorInputDocument): string {
	const candidates = [
		safeString((doc as any).full_text),
		safeString((doc as any).fullText),
		safeString((doc as any).full_text_raw),
		safeString((doc as any).raw_text),
		safeString((doc as any).combined_text),
		safeString((doc as any).text_summary),
		safeString((doc as any).summary),
		safeString((doc as any).text),
	];
	for (const c of candidates) {
		const s = c.trim();
		if (s.length >= 40) return s;
	}
	for (const c of candidates) {
		const s = c.trim();
		if (s.length > 0) return s;
	}
	return "";
}

function uppercaseLetterRatio(value: string): number {
	const s = sanitizeInlineText(value);
	const letters = (s.match(/[A-Za-z]/g) ?? []).length;
	if (letters <= 0) return 0;
	const upper = (s.match(/[A-Z]/g) ?? []).length;
	return upper / letters;
}

function isHighQualityEvidenceSnippet(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	if (s.length < 24) return false;

	// OCR replacement chars / obvious artifact blocks.
	if ((s.match(/\uFFFD|�/g) ?? []).length >= 1) return false;
	if (/[@#%*=^~`|\\]{2,}/.test(s)) return false;
	if (/([!?.,:;])\1{2,}/.test(s)) return false;

	const noSpace = s.replace(/\s+/g, "");
	if (noSpace.length < 18) return false;
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const symbolLike = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
	const letterRatio = letters / noSpace.length;
	const symbolRatio = symbolLike / noSpace.length;
	if (letterRatio < 0.45) return false;
	if (symbolRatio > 0.45) return false;

	// Reject roster/team / credits / staff lists.
	if (/\b(on\s*-?\s*air|talent|roster|lineup|coaches|players|extended\s+team|advisors?|staff|board\s+of\s+directors)\b/i.test(s)) {
		return false;
	}

	// Reject schedule/format/broadcast blocks (common OCR false positives).
	if (/\b(format|schedule|season|week|game|tournament|rules|scoring|broadcast|timeslot|airing)\b/i.test(s)) {
		return false;
	}

	// Reject table-like / separator-heavy blocks.
	const commaCount = (s.match(/,/g) ?? []).length;
	const bulletCount = (s.match(/[•\u2022\u00B7]/g) ?? []).length;
	const sepCount = (s.match(/[,;|\/\\•\u2022\u00B7\-–—:]/g) ?? []).length;
	const sepDensity = sepCount / (noSpace.length || 1);
	if (commaCount >= 5) return false;
	if (bulletCount >= 2) return false;
	if (s.length > 60 && sepDensity > 0.18) return false;

	// Allow ALL-CAPS taglines if they are actually descriptive (verb-like patterns).
	const upperRatio = uppercaseLetterRatio(s);
	const capsHeavy = s.length > 40 && upperRatio > 0.65;
	if (capsHeavy) {
		const verbLike = /\b(HELPS|ENABLES|BUILT\s+FOR|PROVIDES|DELIVERS|AUTOMATES|CONNECTS|PLATFORM\s+FOR)\b/i.test(s);
		if (!verbLike) return false;
	}

	return true;
}

function pickSnippetFromDoc(doc: Phase1GeneratorInputDocument, hint?: RegExp): { snippet: string; page?: number } {
	const pages = Array.isArray((doc as any).pages) ? ((doc as any).pages as any[]) : [];
	const orderedPages = [...pages].sort((a, b) => {
		const ap = typeof a?.page === "number" ? a.page : Number.POSITIVE_INFINITY;
		const bp = typeof b?.page === "number" ? b.page : Number.POSITIVE_INFINITY;
		return ap - bp;
	});

	const buildPageSnippetCandidate = (raw: string): string => {
		const lines = raw
			.split(/\r\n|\n|\r/g)
			.map((l) => sanitizeInlineText(l))
			.filter(Boolean);
		if (lines.length === 0) return sanitizeInlineText(raw).slice(0, 280);
		// Prefer a short multi-line excerpt (avoids pure headings in the first line).
		const joined = lines.slice(0, 3).join(" ");
		return sanitizeInlineText(joined).slice(0, 280);
	};

	const tryCandidate = (snippetRaw: string, page?: number): { snippet: string; page?: number } | null => {
		const snippet = buildPageSnippetCandidate(snippetRaw);
		if (!snippet) return null;
		if (!isHighQualityEvidenceSnippet(snippet)) return null;
		return { snippet, page };
	};

	// 1) Hint-matching pages first (deterministic order).
	if (orderedPages.length > 0) {
		if (hint) {
			for (const p of orderedPages) {
				const text = safeString(p?.text).trim();
				if (!text) continue;
				if (!hint.test(text)) continue;
				const page = typeof p?.page === "number" ? p.page : undefined;
				const hit = tryCandidate(text, page);
				if (hit) return hit;
			}
		}

		// 2) Then first ~5 non-empty pages.
		let seenNonEmpty = 0;
		for (const p of orderedPages) {
			const text = safeString(p?.text).trim();
			if (!text) continue;
			seenNonEmpty += 1;
			const page = typeof p?.page === "number" ? p.page : undefined;
			const hit = tryCandidate(text, page);
			if (hit) return hit;
			if (seenNonEmpty >= 5) break;
		}
	}

	// 3) Fallback: use best available extracted text, with optional hint window.
	const text = pickBestText(doc);
	if (text) {
		if (hint) {
			const m = text.match(hint);
			if (m && m.index != null) {
				const start = Math.max(0, m.index - 60);
				const window = text.slice(start, start + 280);
				const windowCandidate = sanitizeInlineText(window);
				if (windowCandidate && isHighQualityEvidenceSnippet(windowCandidate)) return { snippet: windowCandidate };
			}
		}
		const firstCandidate = sanitizeInlineText(text.slice(0, 280));
		if (firstCandidate && isHighQualityEvidenceSnippet(firstCandidate)) return { snippet: firstCandidate };
	}

	// 4) Deterministic safe fallback (never empty).
	const title = safeString(doc.title).trim();
	return { snippet: title ? `See document: ${title}` : "See source document" };
}

function detectBusinessModel(text: string): string | null {
	const lower = text.toLowerCase();
	if (looksLikeRealEstateOffering(text)) {
		return /\bpreferred\s+equity\b/i.test(text)
			? "Real estate investment (preferred equity)"
			: "Real estate investment";
	}
	const patterns: Array<{ re: RegExp; label: string }> = [
		{ re: /\bsaas\b|\bsubscription\b|\barr\b|\bmrr\b/i, label: "SaaS / subscription" },
		{ re: /\bmarketplace\b/i, label: "Marketplace" },
		{ re: /\blicens(e|ing)\b/i, label: "Licensing" },
		{ re: /\bservices\b|\bimplementation\b|\bconsulting\b/i, label: "Services" },
		{ re: /\be-?commerce\b|\bdtc\b|\bconsumer\b/i, label: "Consumer / commerce" },
	];
	for (const p of patterns) {
		if (p.re.test(lower)) return p.label;
	}
	return null;
}

function looksLikeRealEstateOffering(text: string): boolean {
	const t = safeString(text);
	if (!t.trim()) return false;
	const signals = [
		/\b(preferred\s+equity|mezzanine|bridge\s+loan|senior\s+loan|debt\s+service|dscr|ltv)\b/i,
		/\b(real\s+estate|property|multifamily|apartment|industrial|office|retail|self-?storage|hospitality|hotel|resort)\b/i,
		/\b(noi|cap\s*rate|cash-?on-?cash|equity\s+multiple|irr|pro\s*forma|rent\s+roll)\b/i,
		/\b(occupanc|lease-?up|leasing|tenant|rent\s+growth|absorption|submarket|msa)\b/i,
		/\b(sponsor|operator|general\s+partner|\bgp\b|\blp\b|fund|spv)\b/i,
	];
	let hit = 0;
	for (const re of signals) {
		if (re.test(t)) hit += 1;
		if (hit >= 2) return true;
	}
	return false;
}

function detectRealEstateProductSolution(text: string): string | null {
	const t = safeString(text);
	if (!t.trim()) return null;

	const instrumentMatch = t.match(/\b(preferred\s+equity|mezzanine|bridge\s+loan|senior\s+loan)\b/i);
	const instrument = instrumentMatch ? instrumentMatch[1].toLowerCase().replace(/\s+/g, " ").trim() : "investment";

	const propertyMatch = t.match(/\b(multifamily|apartment|industrial|office|retail|self-?storage|hospitality|hotel)\b/i);
	const property = propertyMatch ? propertyMatch[1].toLowerCase().replace(/\s+/g, " ").trim() : "property";

	const locMatch = t.match(/\b(located\s+in|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}(?:,\s*[A-Z]{2})?)\b/);
	const loc = locMatch ? sanitizeInlineText(locMatch[2]) : "";

	const sentence = loc
		? `Preferred equity investment in a ${property} property in ${loc}.`
		: instrument.includes("preferred equity")
			? `Preferred equity investment in a ${property} property.`
			: `Real estate ${instrument} for a ${property} property.`;

	const normalized = normalizeOverviewSentence(sentence, 180);
	return normalized.trim().length >= 24 ? normalized : null;
}

function detectRealEstateMarketIcp(text: string): string | null {
	const t = safeString(text);
	if (!t.trim()) return null;
	const patterns: RegExp[] = [
		/\b(submarket|msa|market)\b[\s\S]{0,180}/i,
		/\b(demographic|population|median\s+income|job\s+growth)\b[\s\S]{0,180}/i,
		/\b(tenant|renters?|leasing|occupanc)\b[\s\S]{0,180}/i,
		/\b(workforce\s+housing|class\s*[abc])\b[\s\S]{0,180}/i,
	];
	for (const re of patterns) {
		const m = t.match(re);
		if (!m) continue;
		const s = sanitizeInlineText(m[0].replace(/\s+/g, " ").trim());
		if (s.length >= 35) return s.slice(0, 180);
	}
	return null;
}

function extractSnippetWindow(text: string, re: RegExp, windowChars: number): string {
	const t = safeString(text);
	const m = t.match(re);
	if (!m || m.index == null) return "";
	const start = Math.max(0, m.index - Math.floor(windowChars * 0.25));
	const end = Math.min(t.length, m.index + (m[0]?.length ?? 0) + Math.floor(windowChars * 0.75));
	return sanitizeInlineText(t.slice(start, end));
}

function detectRealEstateProductFromSparseText(text: string): string {
	const t = safeString(text);
	if (!t.trim()) return "";

	const window =
		extractSnippetWindow(
			t,
			/\b(preferred\s+equity|offering\s+memorandum|investment\s+opportunit|total\s+investment|total\s+capitalization|acquisition|development|project|property|asset)\b/i,
			240
		) || "";
	if (window && isHighQualityOverviewCandidate(window)) return normalizeOverviewSentence(window, 180);

	// Deterministic, non-specific paraphrase only when a real-estate investment keyword is present.
	if (/\b(preferred\s+equity|offering\s+memorandum|total\s+investment|property|asset|real\s+estate)\b/i.test(t)) {
		return normalizeOverviewSentence("Real estate investment opportunity (see offering memo for details)", 180);
	}
	return "";
}

function detectRealEstateMarketFromSparseText(text: string): string {
	const t = safeString(text);
	if (!t.trim()) return "";

	const window =
		extractSnippetWindow(
			t,
			/\b(market|msa|submarket|tenant|leasing|occupanc|rent\s+growth|demographic|population|job\s+growth|in-?migration)\b/i,
			240
		) || "";
	if (window && isHighQualityOverviewCandidate(window)) return normalizeOverviewSentence(window, 180);

	if (/\b(market|tenant|leasing|occupanc|msa|submarket)\b/i.test(t)) {
		return normalizeOverviewSentence("Target market and tenant profile are described in the offering memo", 180);
	}
	return "";
}

function hasAnyExtractedText(docs: Phase1GeneratorInputDocument[]): boolean {
	for (const d of docs) {
		if (pickBestText(d).trim().length >= 20) return true;
		const pages = Array.isArray((d as any).pages) ? ((d as any).pages as any[]) : [];
		if (pages.some((p) => safeString(p?.text).trim().length >= 20)) return true;
	}
	return false;
}

function detectProductSnippet(text: string): string | null {
	const candidates: RegExp[] = [
		/\b(we|our company|the team)\s+(is|are)\s+(building|creating|developing)\b[^\n\r]{0,160}/i,
		/\b(platform|product|solution)\b[^\n\r]{0,160}/i,
		/\b(problem|solution)\b[^\n\r]{0,160}/i,
	];
	for (const re of candidates) {
		const m = text.match(re);
		if (!m) continue;
		const s = m[0].replace(/\s+/g, " ").trim();
		if (s.length >= 30) return s.slice(0, 180);
	}
	return null;
}

function detectMarketSnippet(text: string): string | null {
	const candidates: RegExp[] = [
		/\b(ideal customer|icp|target customer|target market|buyer|persona)\b[^\n\r]{0,160}/i,
		/\b(TAM|SAM|SOM)\b[^\n\r]{0,120}/i,
		/\b(industry|vertical)\b[^\n\r]{0,140}/i,
	];
	for (const re of candidates) {
		const m = text.match(re);
		if (!m) continue;
		const s = m[0].replace(/\s+/g, " ").trim();
		if (s.length >= 25) return s.slice(0, 160);
	}
	return null;
}

type Phase1OverviewExtractorField = "product_solution" | "market_icp" | "raise_terms" | "go_to_market" | "key_risks_detected";

type Phase1OverviewExtractorEvidence = {
	field: Phase1OverviewExtractorField;
	document_id: string;
	snippet: string;
	confidence: number; // 0..1
};

type Phase1OverviewExtractorOutput = {
	fields: {
		product_solution: string | null;
		market_icp: string | null;
		raise_terms: string | null;
		go_to_market: string | null;
		key_risks_detected: string[] | null;
	};
	evidence: Phase1OverviewExtractorEvidence[];
	warnings: string[];
};

function capSnippet(value: string, maxChars: number): string {
	const s = sanitizeInlineText(value);
	if (s.length <= maxChars) return s;
	return s.slice(0, maxChars - 1).trimEnd() + "…";
}

function takeSentenceish(value: string, maxChars: number): string {
	const s = sanitizeInlineText(value);
	if (!s.trim()) return "";
	const cut = s.slice(0, Math.min(s.length, maxChars + 80));
	const m = cut.match(/^(.{30,}?[.!?])\s+/);
	if (m?.[1]) return capOneLiner(m[1], maxChars);
	return capOneLiner(s, maxChars);
}

function extractAfterHeading(text: string, heading: RegExp, maxChars: number): string {
	const m = text.match(heading);
	if (!m || m.index == null) return "";
	const start = m.index;
	const window = text.slice(start, start + 2200);
	const lines = window
		.split(/\r\n|\n|\r/g)
		.map((l) => sanitizeInlineText(l))
		.filter((l) => l.trim().length > 0);
	if (lines.length <= 1) return "";
	// Drop the heading line.
	const contentLines = lines.slice(1);
	// Stop early if we hit another obvious heading.
	const outLines: string[] = [];
	for (const l of contentLines) {
		if (outLines.length >= 3) break;
		if (/^(?:product|solution|market|icp|target|customer|raising|fundraising|terms|use of funds|go\s*-?to\s*-?market|gtm|risks?|challenges?|competition)\b[:\-\s]*$/i.test(l)) {
			break;
		}
		outLines.push(l);
	}
	const joined = outLines.join(" ").trim();
	return takeSentenceish(joined, maxChars);
}

function extractWindow(text: string, re: RegExp, maxChars: number): { snippet: string; confidence: number } | null {
	const m = text.match(re);
	if (!m || m.index == null) return null;
	const idx = m.index;
	const start = Math.max(0, idx - 90);
	const window = text.slice(start, start + 340);
	const snippet = takeSentenceish(window, maxChars);
	if (!snippet.trim()) return null;
	const strong = /\$\s?\d|\b(raising|seeking|funding|round|terms)\b/i.test(snippet)
		|| /\b(ICP|target\s+customer|go\s*-?to\s*-?market|\bGTM\b)\b/i.test(snippet);
	return { snippet, confidence: strong ? 0.75 : 0.6 };
}

export function extractPhase1OverviewFromDocuments(
	docs: Array<{ document_id: string; title?: string | null; full_text?: string | null }>
): Phase1OverviewExtractorOutput {
	const warnings: string[] = [];
	const evidence: Phase1OverviewExtractorEvidence[] = [];

	type Candidate = { value: string; document_id: string; confidence: number; rawSnippet: string };
	const productCands: Candidate[] = [];
	const marketCands: Candidate[] = [];
	const raiseCands: Candidate[] = [];
	const gtmCands: Candidate[] = [];
	const riskCands: Array<{ items: string[]; document_id: string; confidence: number; rawSnippet: string }> = [];

	for (const d of docs) {
		const docId = safeString(d.document_id).trim();
		if (!docId) continue;
		const text = safeString(d.full_text).slice(0, 120_000);
		if (!text.trim()) continue;

		// Product / solution
		const productHeading = /^(?:\s*)(Product|Solution|What\s+we\s+do|Platform|Overview)\s*[:\-]?\s*$/im;
		const productAfter = extractAfterHeading(text, productHeading, 220);
		if (productAfter) {
			productCands.push({ value: productAfter, document_id: docId, confidence: 0.85, rawSnippet: productAfter });
		} else {
			const win = extractWindow(text, /\b(what\s+we\s+do|we\s+(?:are|re)\s+building|our\s+platform|our\s+product|our\s+solution)\b/i, 220);
			if (win) productCands.push({ value: win.snippet, document_id: docId, confidence: win.confidence, rawSnippet: win.snippet });
		}

		// Market / ICP
		const marketHeading = /^(?:\s*)(Target\s+Customer|Target\s+Market|ICP|Ideal\s+Customer|Who\s+we\s+serve|Customer)\s*[:\-]?\s*$/im;
		const marketAfter = extractAfterHeading(text, marketHeading, 220);
		if (marketAfter) {
			marketCands.push({ value: marketAfter, document_id: docId, confidence: 0.85, rawSnippet: marketAfter });
		} else {
			const win = extractWindow(text, /\b(ICP|ideal\s+customer|target\s+customer|target\s+market|who\s+we\s+serve|buyers?)\b/i, 220);
			if (win) marketCands.push({ value: win.snippet, document_id: docId, confidence: win.confidence, rawSnippet: win.snippet });
		}

		// Raise / terms
		const raiseHeading = /^(?:\s*)(Raising|Fundraising|Round|Terms|The\s+Ask|Seeking)\s*[:\-]?\s*$/im;
		const raiseAfter = extractAfterHeading(text, raiseHeading, 220);
		const raiseWin = extractWindow(text, /\b(raising|seeking|funding|fundraise|fundraising|the\s+ask|round|terms)\b[^\n\r]{0,90}(\$\s?\d|\b\d+(?:\.\d+)?\s*(?:m|mm|million|k)\b)?/i, 220);
		const useOfFunds = extractWindow(text, /\b(use\s+of\s+funds|proceeds|allocation)\b[^\n\r]{0,160}/i, 220);
		const raiseCandidate = (() => {
			const parts: string[] = [];
			if (raiseAfter) parts.push(raiseAfter);
			else if (raiseWin?.snippet) parts.push(raiseWin.snippet);
			if (useOfFunds?.snippet && !parts.join(" ").toLowerCase().includes("use of funds")) parts.push(useOfFunds.snippet);
			const joined = parts.join(" ").trim();
			return joined ? capOneLiner(joined, 220) : "";
		})();
		if (raiseCandidate) {
			const strongAmt = /\$\s?\d|\b\d+(?:\.\d+)?\s*(?:m|mm|million|k)\b/i.test(raiseCandidate);
			raiseCands.push({ value: raiseCandidate, document_id: docId, confidence: strongAmt ? 0.85 : 0.65, rawSnippet: raiseCandidate });
		}

		// GTM
		const gtmHeading = /^(?:\s*)(Go\s*-?to\s*-?Market|GTM|Sales|Distribution|Channels|Marketing)\s*[:\-]?\s*$/im;
		const gtmAfter = extractAfterHeading(text, gtmHeading, 220);
		if (gtmAfter) {
			gtmCands.push({ value: gtmAfter, document_id: docId, confidence: 0.85, rawSnippet: gtmAfter });
		} else {
			const win = extractWindow(text, /\b(go\s*-?to\s*-?market|\bgtm\b|sales\s+motion|distribution|channels?|pricing|marketing)\b/i, 220);
			if (win) gtmCands.push({ value: win.snippet, document_id: docId, confidence: win.confidence, rawSnippet: win.snippet });
		}

		// Risks (prefer explicit headings; pull a few bullet-ish items)
		const risksHeading = /^(?:\s*)(Risks?|Challenges?|Competition|Regulatory|Security)\s*[:\-]?\s*$/im;
		const risksAfter = extractAfterHeading(text, risksHeading, 260);
		if (risksAfter) {
			const items = risksAfter
				.split(/(?:\u2022|\u00B7|•|\n)/g)
				.map((x) => sanitizeInlineText(x).trim())
				.filter((x) => x.length >= 6)
				.slice(0, 4);
			if (items.length > 0) riskCands.push({ items, document_id: docId, confidence: 0.8, rawSnippet: risksAfter });
		} else {
			const win = extractWindow(text, /\b(risks?|challenges?|competition|regulatory|security|dependenc(?:e|y))\b[^\n\r]{0,170}/i, 200);
			if (win) riskCands.push({ items: [win.snippet], document_id: docId, confidence: 0.6, rawSnippet: win.snippet });
		}
	}

	const pickBest = <T extends { confidence: number }>(items: T[]): T | null => {
		if (items.length === 0) return null;
		const ranked = [...items].sort((a, b) => b.confidence - a.confidence);
		return ranked[0] ?? null;
	};

	const bestProduct = pickBest(productCands);
	const bestMarket = pickBest(marketCands);
	const bestRaise = pickBest(raiseCands);
	const bestGtm = pickBest(gtmCands);
	const bestRisks = pickBest(riskCands);

	const addEvidence = (field: Phase1OverviewExtractorField, cand: Candidate | null) => {
		if (!cand) return;
		evidence.push({
			field,
			document_id: cand.document_id,
			snippet: capSnippet(cand.rawSnippet, 200),
			confidence: Math.max(0, Math.min(1, cand.confidence)),
		});
	};

	addEvidence("product_solution", bestProduct);
	addEvidence("market_icp", bestMarket);
	addEvidence("raise_terms", bestRaise);
	addEvidence("go_to_market", bestGtm);
	if (bestRisks) {
		evidence.push({
			field: "key_risks_detected",
			document_id: bestRisks.document_id,
			snippet: capSnippet(bestRisks.rawSnippet, 200),
			confidence: Math.max(0, Math.min(1, bestRisks.confidence)),
		});
	}

	if (!bestProduct) warnings.push("product_solution not found in document text");
	if (!bestMarket) warnings.push("market_icp not found in document text");
	if (!bestRaise) warnings.push("raise/terms not found in document text");
	if (!bestGtm) warnings.push("go_to_market not found in document text");
	if (!bestRisks) warnings.push("risks not found in document text");

	return {
		fields: {
			product_solution: bestProduct ? normalizeOverviewSentence(bestProduct.value, 220) : null,
			market_icp: bestMarket ? normalizeOverviewSentence(bestMarket.value, 220) : null,
			raise_terms: bestRaise ? sanitizeInlineText(bestRaise.value) : null,
			go_to_market: bestGtm ? normalizeOverviewSentence(bestGtm.value, 220) : null,
			key_risks_detected: bestRisks ? uniqStrings(bestRisks.items).slice(0, 6) : null,
		},
		evidence,
		warnings,
	};
}

function detectTractionMetrics(text: string): string[] {
	const out: string[] = [];
	const patterns: Array<{ re: RegExp; label: (m: RegExpMatchArray) => string }> = [
		{ re: /\bARR\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `ARR mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\bMRR\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `MRR mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\brevenue\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `Revenue mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\b(\d[\d,]*)\s+(customers?|clients?)\b/i, label: (m) => `${m[1].replace(/,/g, "")} customers mentioned` },
		{ re: /\b(\d[\d,]*)\s+(users?)\b/i, label: (m) => `${m[1].replace(/,/g, "")} users mentioned` },
	];
	for (const p of patterns) {
		const m = text.match(p.re);
		if (m) out.push(p.label(m));
	}
	return uniqStrings(out);
}

function coverageStatusFromText(text: string, patterns: RegExp[], fallback?: "present" | "partial" | "missing"): "present" | "partial" | "missing" {
	if (!text.trim()) return fallback ?? "missing";
	for (const re of patterns) {
		if (re.test(text)) return "present";
	}
	return fallback ?? "missing";
}

function clampScore(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, Math.round(v)));
}

function buildDecisionSummary(params: {
	coverage: Phase1CoverageV1;
	docs: Phase1GeneratorInputDocument[];
}): Phase1DecisionSummaryV1 {
	const sections = params.coverage.sections;
	const docsPresent = sections.documents === "present";
	if (!docsPresent) {
		const reasons = [
			"No documents available for analysis.",
			"Upload a pitch deck, memo, or financials to enable analysis.",
		];
		const blockers = ["Upload a pitch deck, memo, or financials to enable analysis."];
		const next_requests = ["Upload at least one pitch deck or financial snapshot."];
		return {
			score: 0,
			recommendation: "PASS",
			reasons,
			blockers,
			next_requests,
			confidence: "low",
		};
	}

	// Deterministic rubric: start from 100 and subtract for missing/partial key sections.
	// This ensures score always exists even with missing data.
	const penalties: Array<{ key: string; missing: number; partial: number; reason: string; request: string }> = [
		{
			key: "product_solution",
			missing: 20,
			partial: 10,
			reason: "Product / solution is not clearly described in extracted documents.",
			request: "Add 1 slide or 1 paragraph describing the problem, solution, and why now.",
		},
		{
			key: "market_icp",
			missing: 15,
			partial: 8,
			reason: "Target market / ICP is not clearly described in extracted documents.",
			request: "Add ICP definition (buyer, user, segment) and market sizing (TAM/SAM/SOM or bottom-up).",
		},
		{
			key: "gtm",
			missing: 12,
			partial: 6,
			reason: "Go-to-market approach is not described (channels, pricing, sales motion).",
			request: "Add GTM plan: channels, pricing, sales cycle, and pipeline assumptions.",
		},
		{
			key: "business_model",
			missing: 10,
			partial: 5,
			reason: "Business model is unclear (how the company makes money).",
			request: "Add monetization model (pricing, unit economics, revenue streams).",
		},
		{
			key: "traction",
			missing: 15,
			partial: 8,
			reason: "Traction metrics are not disclosed (revenue/users/customers/growth/retention).",
			request: "Add current KPIs (revenue/ARR/MRR, customers/users, growth, retention/churn).",
		},
		{
			key: "financials",
			missing: 15,
			partial: 8,
			reason: "Financial readiness data is missing (burn, runway, cash, margins).",
			request: "Add burn, runway, cash balance, and margin profile (or a simple P&L).",
		},
		{
			key: "team",
			missing: 10,
			partial: 5,
			reason: "Team / founder background is not clearly presented in extracted documents.",
			request: "Add founder bios (roles, relevant experience, prior outcomes).",
		},
		{
			key: "raise_terms",
			missing: 6,
			partial: 3,
			reason: "Raise amount / terms are not clearly stated.",
			request: "Add raise amount, round type, and expected use of funds.",
		},
	];

	let score = 100;

	type RankedReason = {
		key: string;
		status: "present" | "partial" | "missing";
		penaltyApplied: number;
		reason: string;
		request: string;
	};

	const ranked: RankedReason[] = [];
	for (const p of penalties) {
		const status = (sections[p.key] ?? "missing") as "present" | "partial" | "missing";
		if (status === "missing") {
			score -= p.missing;
			ranked.push({
				key: p.key,
				status,
				penaltyApplied: p.missing,
				reason: p.reason,
				request: p.request,
			});
		} else if (status === "partial") {
			score -= p.partial;
			ranked.push({
				key: p.key,
				status,
				penaltyApplied: p.partial,
				reason: p.reason,
				request: p.request,
			});
		}
	}

	// Rank reasons by impact (missing/partial penalty), descending.
	ranked.sort((a, b) => {
		if (b.penaltyApplied !== a.penaltyApplied) return b.penaltyApplied - a.penaltyApplied;
		if (a.status !== b.status) return a.status === "missing" ? -1 : 1;
		return a.key.localeCompare(b.key);
	});

	// Blockers are a strict subset of reasons (missing + critical only, capped).
	const criticalKeys = new Set(["product_solution", "market_icp", "financials", "team", "raise_terms"]);
	const blockerItems = ranked
		.filter((r) => r.status === "missing" && criticalKeys.has(r.key))
		.slice(0, 5);

	const blockers = uniqStrings(blockerItems.map((b) => b.reason));
	const next_requests = blockerItems.map((b) => b.request).slice(0, blockers.length);

	const reasons: string[] = [];
	// Ensure blockers are included in reasons, then fill up to 10 with the remaining ranked reasons.
	for (const b of blockers) reasons.push(b);
	for (const r of ranked) {
		if (reasons.length >= 10) break;
		if (reasons.some((x) => x.toLowerCase() === r.reason.toLowerCase())) continue;
		reasons.push(r.reason);
	}

	const finalScore = clampScore(score);

	// Recommendation derived deterministically from score thresholds.
	const criticalMissing = ["product_solution", "market_icp", "team", "financials"].filter(
		(k) => (sections[k] ?? "missing") === "missing"
	).length;
	let recommendation: Phase1RecommendationV1;
	if (finalScore >= 75 && criticalMissing <= 1) recommendation = "GO";
	else if (finalScore >= 50) recommendation = "CONSIDER";
	else recommendation = "PASS";

	const confidence: Phase1ConfidenceBand = confidenceFromCoverage(params.coverage);

	return {
		score: finalScore,
		recommendation,
		reasons: uniqStrings(reasons).slice(0, 10),
		blockers: uniqStrings(blockers).slice(0, 10),
		next_requests: next_requests.slice(0, 10),
		confidence,
	};
}

function detectRaise(text: string): string | null {
	// Only extract when present verbatim in text.
	const re = /\b(?:raising|raise|seeking|the ask|funding)\b[^\n\r]{0,80}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?)|\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?\s*(?:seed|series\s+[a-d]|pre-?seed|round)\b/i;
	const m = text.match(re);
	if (!m) return null;
	const s = m[0].trim();
	return s.length > 0 ? s.slice(0, 120) : null;
}

function detectDealTypeFromDocs(docs: Phase1GeneratorInputDocument[]): string | null {
	const types = uniqStrings(
		docs
			.map((d) => safeString(d.type).trim())
			.filter(Boolean)
	);
	if (types.length === 0) return null;
	if (types.some((t) => t === "pitch_deck")) return "startup_raise";
	if (types.some((t) => t === "financials")) return "startup_raise";
	return "other";
}

function detectDealType(params: { docs: Phase1GeneratorInputDocument[]; readableText: string }): string | null {
	if (looksLikeRealEstateOffering(params.readableText)) {
		return /\bpreferred\s+equity\b/i.test(params.readableText) ? "real_estate_preferred_equity" : "real_estate_offering";
	}
	return detectDealTypeFromDocs(params.docs);
}

type DomainAnchorScores = {
	sports_media: number;
	real_asset: number;
	saas: number;
	marketplace: number;
};

function takeTopDocumentText(docs: Phase1GeneratorInputDocument[], maxChars: number): string {
	const chunks: string[] = [];
	for (const d of docs) {
		const title = safeString((d as any).title).trim();
		if (title) chunks.push(title);

		const pages = Array.isArray((d as any).pages) ? (d as any).pages : null;
		if (pages && pages.length > 0) {
			const top = pages
				.slice(0, 2)
				.map((p: any) => safeString(p?.text))
				.filter(Boolean)
				.join("\n");
			if (top.trim()) chunks.push(top);
		} else {
			const ft = safeString((d as any).full_text);
			if (ft.trim()) chunks.push(ft.slice(0, 2000));
		}

		if (chunks.join("\n\n").length >= maxChars) break;
	}
	return sanitizeInlineText(chunks.join("\n\n")).slice(0, maxChars);
}

function domainAnchorScores(text: string): DomainAnchorScores {
	const t = text || "";
	const count = (re: RegExp) => (t.match(re) ?? []).length;
	return {
		sports_media:
			count(/\b(hockey|nhl|nba|nfl|mlb|soccer|football|baseball|basketball|league|athlete|athletes|team|teams|fan|fans|broadcast|broadcast\s+partners?|media\s+rights|on-?air|streaming|season|seasons|arena|arenas|stadium|stadiums)\b/gi) +
			count(/\b(podcast|creator|influencer|content)\b/gi),
		real_asset:
			count(/\b(preferred\s+equity|offering\s+memorandum|cap\s*rate|noi|dscr|ltv|irr|equity\s+multiple)\b/gi) +
			count(/\b(property|multifamily|hotel|apartment|acquisition|lease-?up|tenant|occupanc|rent\s+growth)\b/gi),
		saas:
			count(/\b(saas|subscription|platform|api|workflow|automation|b2b|arr|mrr)\b/gi),
		marketplace:
			count(/\b(marketplace|buyers?\b|sellers?\b|two-?sided|take\s*rate|gmv)\b/gi),
	};
}

function isLegalBoilerplate(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	return /\b(offering\s+memorandum|private\s+placement|regulation\s+d|securities\s+act|not\s+an\s+offer|no\s+representation\s+or\s+warranty|forward-?looking)\b/i.test(s);
}

function hasBusinessVerbForModelEvidence(value: string): boolean {
	const s = sanitizeInlineText(value);
	return /\b(build|built|building|operate|operates|operating|monetize|monetizes|monetizing|enable|enables|enabling|provide|provides|providing|sell|sells|selling|license|licenses|licensing)\b/i.test(s);
}

function hasValidBusinessModelEvidence(params: {
	evidenceText: string;
	business_model: string;
	primary: keyof DomainAnchorScores;
	scores: DomainAnchorScores;
}): boolean {
	const model = sanitizeInlineText(params.business_model);
	if (!model || model === "Unknown") return false;

	const lower = model.toLowerCase();
	let modelHint: RegExp | null = null;
	if (/saas|subscription/.test(lower)) modelHint = /\b(saas|subscription|arr|mrr|api|platform|workflow|automation)\b/i;
	else if (/marketplace/.test(lower)) modelHint = /\b(marketplace|two-?sided|buyers?|sellers?|take\s*rate|gmv)\b/i;
	else if (/licens/.test(lower)) modelHint = /\b(license|licensing|royalt)\b/i;
	else if (/services/.test(lower)) modelHint = /\b(services|consulting|implementation)\b/i;
	else if (/consumer|commerce|e-?commerce|dtc/.test(lower)) modelHint = /\b(e-?commerce|dtc|consumer|checkout|cart|orders?)\b/i;

	// Domain alignment: for strong sports/media or real-asset domains, avoid software-ish models
	// unless explicit software anchors exist.
	if (params.primary === "sports_media" || params.primary === "real_asset") {
		const softwareish = /saas|subscription|marketplace/.test(lower);
		const hasExplicitSoftware = params.scores.saas > 0 || params.scores.marketplace > 0;
		if (softwareish && !hasExplicitSoftware) return false;
	}

	const sentences = extractCandidateSentences(params.evidenceText);
	for (const sent of sentences) {
		const s = sanitizeInlineText(sent);
		if (!s) continue;
		if (isLegalBoilerplate(s)) continue;
		if (!isHighQualityEvidenceSnippet(s)) continue;
		if (!hasBusinessVerbForModelEvidence(s)) continue;
		if (modelHint && !modelHint.test(s)) continue;
		return true;
	}

	return false;
}

function pickPrimaryDomain(scores: DomainAnchorScores): { primary: keyof DomainAnchorScores; strong: boolean } {
	const entries = Object.entries(scores) as Array<[keyof DomainAnchorScores, number]>;
	entries.sort((a, b) => b[1] - a[1]);
	const [primary, top] = entries[0] ?? ["saas", 0];
	const second = entries[1]?.[1] ?? 0;
	const strong = top >= 4 && top >= second + 2;
	return { primary, strong };
}

function containsAny(text: string, res: RegExp[]): boolean {
	const t = text || "";
	for (const re of res) {
		if (re.test(t)) return true;
	}
	return false;
}

function arbitrateDealTruth(params: {
	domainText: string;
	deal_type: string;
	business_model: string;
	product_solution: string;
	market_icp: string;
	looksRE: boolean;
}): {
	deal_type: string;
	business_model: string;
	product_solution: string;
	market_icp: string;
	looksRE: boolean;
} {
	const scores = domainAnchorScores(params.domainText);
	const pick = pickPrimaryDomain(scores);

	const reBlockers = [
		/\bpreferred\s+equity\b/i,
		/\boffering\s+memorandum\b/i,
		/\bcap\s*rate\b/i,
		/\bnoi\b/i,
		/\bdscr\b/i,
		/\bltv\b/i,
		/\birr\b/i,
		/\bequity\s+multiple\b/i,
		/\bproperty\b/i,
		/\bmultifamily\b/i,
		/\bapartment\b/i,
		/\bhotel\b/i,
		/\btenant\b/i,
		/\boccupanc\w*\b/i,
		/\blease-?up\b/i,
		/\brent\s+growth\b/i,
		/\bacquisition\b/i,
	];
	const saasBlockers = [/\bsaas\b/i, /\bsubscription\b/i, /\bmarketplace\b/i, /\btake\s*rate\b/i, /\bapi\b/i, /\bplatform\b/i];

	let looksRE = params.looksRE;
	let deal_type = params.deal_type;
	let business_model = params.business_model;
	let product_solution = params.product_solution;
	let market_icp = params.market_icp;

	if (pick.primary === "sports_media" && pick.strong) {
		looksRE = false;
		deal_type = "startup_raise";

		// Strip real-asset contamination deterministically (fail closed to empty/Unknown).
		if (containsAny(product_solution, reBlockers)) product_solution = "";
		if (containsAny(market_icp, reBlockers)) market_icp = "";
		if (containsAny(business_model, reBlockers) || /real\s*estate/i.test(business_model)) business_model = "Unknown";

		// Prevent SaaS/subscription classification unless explicit software signals exist.
		const hasExplicitSoftware = scores.saas > 0 || scores.marketplace > 0;
		if (!hasExplicitSoftware && containsAny(business_model, saasBlockers)) business_model = "Unknown";
	} else if (pick.primary === "real_asset" && pick.strong) {
		looksRE = true;
		const hasDigitalSupport = scores.saas > 0 || scores.marketplace > 0;
		if (!hasDigitalSupport) {
			if (containsAny(product_solution, saasBlockers)) product_solution = "";
			if (containsAny(business_model, saasBlockers)) business_model = "Unknown";
			if (containsAny(market_icp, saasBlockers)) market_icp = "";
		}
	}

	return {
		deal_type,
		business_model,
		product_solution,
		market_icp,
		looksRE,
	};
}

function detectTractionSignals(text: string, companyHint?: string): string[] {
	const sentences = extractCandidateSentences(text);
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\barr\b/i, label: "ARR mentioned" },
		{ re: /\bmrr\b/i, label: "MRR mentioned" },
		{ re: /\brevenue\b/i, label: "Revenue mentioned" },
		{ re: /\bgrowth\b/i, label: "Growth mentioned" },
		{ re: /\bcustomers?\b/i, label: "Customers mentioned" },
		{ re: /\busers?\b|\bactive users\b|\bmau\b|\bdau\b/i, label: "Users mentioned" },
		{ re: /\bretention\b|\bchurn\b/i, label: "Retention / churn mentioned" },
		{ re: /\bpartnership\b|\bpilot\b|\bcontract\b/i, label: "Pilots / partnerships mentioned" },
	];
	const out: string[] = [];
	const gated = new Set(["ARR mentioned", "Revenue mentioned", "Growth mentioned"]);
	for (const sig of signals) {
		if (!gated.has(sig.label)) {
			if (sig.re.test(text)) out.push(sig.label);
			continue;
		}

		// Gate revenue/growth/ARR to avoid counting industry commentary as traction.
		let ok = false;
		for (const sent of sentences) {
			if (!sig.re.test(sent)) continue;
			if (isCompanyTractionSnippet(sent, companyHint)) {
				ok = true;
				break;
			}
		}
		if (ok) out.push(sig.label);
	}
	return uniqStrings(out);
}

function detectRiskSignals(text: string): string[] {
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\bcompetition\b|\bcompetitor\b/i, label: "Competition" },
		{ re: /\bregulatory\b|\bcompliance\b/i, label: "Regulatory / compliance" },
		{ re: /\bchurn\b|\bretention\b/i, label: "Retention risk" },
		{ re: /\bcapital intensive\b|\bcapex\b/i, label: "Capital intensity" },
		{ re: /\bsecurity\b|\bprivacy\b/i, label: "Security / privacy" },
	];
	const out: string[] = [];
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
	}
	return uniqStrings(out);
}

function sectionStatus(value: string, arr?: string[]): "present" | "partial" | "missing" {
	const v = value.trim();
	if (v && v.toLowerCase() !== "unknown") return "present";
	if (Array.isArray(arr) && arr.length > 0) return "partial";
	return "missing";
}

function confidenceFromCoverage(coverage: Phase1CoverageV1): Phase1ConfidenceBand {
	const statuses = Object.values(coverage.sections);
	const present = statuses.filter((s) => s === "present").length;
	const partial = statuses.filter((s) => s === "partial").length;
	if (present >= 5) return "high";
	if (present >= 3 || (present >= 2 && partial >= 2)) return "med";
	return "low";
}

function capConfidenceFromCoreMissing(
	sections: Phase1CoverageV1["sections"],
	confidence: Phase1ConfidenceBand
): Phase1ConfidenceBand {
	if (!sections || typeof sections !== "object") return confidence;
	const status = (k: string) => (sections as any)[k] as "present" | "partial" | "missing" | undefined;
	const missingCore = ["product_solution", "gtm", "traction"].filter((k) => status(k) === "missing").length;
	if (missingCore >= 2) return "low";
	if (
		confidence === "high" &&
		(status("product_solution") === "missing" || status("gtm") === "missing")
	) {
		return "med";
	}
	return confidence;
}

function safeNonEmpty(value: unknown): string {
	const s = sanitizeInlineText(safeString(value));
	return s;
}

function normalizePhase1OverviewV2(input: unknown): any {
	if (!input || typeof input !== "object") return null;
	const obj: any = input;

	const pick = (keys: string[]): string => {
		for (const k of keys) {
			const v = obj?.[k];
			if (typeof v === "string" && v.trim()) return sanitizeInlineText(v);
		}
		return "";
	};

	const toNullOrNormalizedSentence = (value: string, maxChars: number): string | null => {
		const s = sanitizeInlineText(value);
		if (!s.trim()) return null;
		return normalizeOverviewSentence(s, maxChars).trim() ? normalizeOverviewSentence(s, maxChars) : null;
	};

	const toNullOrInline = (value: string): string | null => {
		const s = sanitizeInlineText(value);
		return s.trim() ? s : null;
	};

	const out: any = { ...obj };

	const existingProduct = typeof obj.product_solution === "string" ? sanitizeInlineText(obj.product_solution) : "";
	const existingMarket = typeof obj.market_icp === "string" ? sanitizeInlineText(obj.market_icp) : "";
	const existingRaiseTerms = typeof obj.raise_terms === "string" ? sanitizeInlineText(obj.raise_terms) : "";
	const existingGtm = typeof (obj as any).go_to_market === "string"
		? sanitizeInlineText((obj as any).go_to_market)
		: typeof (obj as any).gtm === "string"
			? sanitizeInlineText((obj as any).gtm)
			: "";

	if (existingProduct.trim()) {
		out.product_solution = toNullOrNormalizedSentence(existingProduct, 220);
	} else {
		const candidate = pick([
			"product",
			"solution",
			"product_description",
			"productDescription",
			"value_prop",
			"valueProp",
			"offering",
			"one_liner",
			"oneLiner",
		]);
		out.product_solution = toNullOrNormalizedSentence(candidate, 220);
	}

	if (existingMarket.trim()) {
		out.market_icp = toNullOrNormalizedSentence(existingMarket, 220);
	} else {
		const candidate = pick([
			"icp",
			"target_customer",
			"targetCustomer",
			"target_market",
			"targetMarket",
			"customers",
			"customer",
			"audience",
			"who_we_serve",
			"whoWeServe",
			"buyer",
		]);
		out.market_icp = toNullOrNormalizedSentence(candidate, 220);
	}

	if (existingRaiseTerms.trim()) {
		out.raise_terms = toNullOrInline(existingRaiseTerms);
	} else {
		// Prefer explicit terms/raise fields; fall back to round/ask wording.
		const candidate = pick([
			"raiseTerms",
			"raise_terms",
			"terms",
			"raise",
			"round",
			"ask",
			"fundraise",
			"fundraising",
		]);
		out.raise_terms = toNullOrInline(candidate);
	}

	if (existingGtm.trim()) {
		out.go_to_market = toNullOrNormalizedSentence(existingGtm, 220);
	} else {
		const candidate = pick([
			"go_to_market",
			"goToMarket",
			"gtm",
			"sales",
			"distribution",
			"channels",
			"marketing",
		]);
		out.go_to_market = toNullOrNormalizedSentence(candidate, 220);
	}

	// Convenience: if raise is missing but raise_terms exists, set raise (do not overwrite non-empty).
	const existingRaise = typeof obj.raise === "string" ? sanitizeInlineText(obj.raise) : "";
	if (!existingRaise.trim() && typeof out.raise_terms === "string" && out.raise_terms.trim()) {
		out.raise = out.raise_terms;
	}

	return out;
}

function formatList(values: string[], maxItems: number): string {
	const items = uniqStrings(values).slice(0, maxItems);
	if (items.length === 0) return "";
	return items.join(", ");
}

function coverageGapsSummary(coverage: Phase1CoverageV1): { missing: string[]; partial: string[] } {
	const sections = coverage && typeof coverage === "object" ? coverage.sections : null;
	const missing: string[] = [];
	const partial: string[] = [];
	if (!sections || typeof sections !== "object") return { missing, partial };

	const ordered: Array<{ key: string; label: string }> = [
		{ key: "product_solution", label: "product" },
		{ key: "market_icp", label: "market" },
		{ key: "raise_terms", label: "raise/terms" },
		{ key: "business_model", label: "business model" },
		{ key: "traction", label: "traction" },
		{ key: "financials", label: "financials" },
		{ key: "team", label: "team" },
		{ key: "gtm", label: "go-to-market" },
		{ key: "risks", label: "risks" },
	];

	for (const s of ordered) {
		const status = (sections as any)[s.key];
		if (status === "missing") missing.push(s.label);
		if (status === "partial") partial.push(s.label);
	}
	return { missing, partial };
}

const toFinite = (value: unknown): number | null => {
	if (value === null || value === undefined) return null;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
};

export function buildPhase1ExecutiveAccountability(params: {
	coverage?: Phase1CoverageV1 | null;
	claims?: Phase1ClaimV1[] | null;
}): Phase1ExecutiveAccountabilityV1 | null {
	const coverage = params.coverage && typeof params.coverage === "object" ? params.coverage : null;
	const claims = Array.isArray(params.claims) ? params.claims : [];
	if (!coverage || !coverage.sections || typeof coverage.sections !== "object") return null;

	const sections = coverage.sections;
	const hasEvidenceFor = (cats: Phase1ClaimCategoryV1[]): boolean =>
		claims.some((c) => cats.includes(c.category) && Array.isArray(c.evidence) && c.evidence.length > 0);
	const statusFor = (sectionKey: string, cats: Phase1ClaimCategoryV1[]): "evidence" | "inferred" | "missing" => {
		if ((sections as any)[sectionKey] === "missing") return "missing";
		return hasEvidenceFor(cats) ? "evidence" : "inferred";
	};

	const coverageMissing = Array.isArray(coverage.sections_missing_list)
		? coverage.sections_missing_list.filter((x) => typeof x === "string" && x.trim().length > 0)
		: coverageGapsSummary(coverage).missing;

	const evidence_total = claims.reduce((acc, c) => acc + (Array.isArray(c.evidence) ? c.evidence.length : 0), 0);

	return {
		support: {
			product: statusFor("product_solution", ["product"]),
			icp: statusFor("market_icp", ["market"]),
			market: statusFor("market_icp", ["market"]),
			business_model: statusFor("business_model", ["product"]),
			traction: statusFor("traction", ["traction"]),
			risks: statusFor("risks", ["risk"]),
		},
		coverage_missing_sections: uniqStrings(coverageMissing),
		evidence_counts: {
			claims_total: claims.length,
			evidence_total,
		},
	};
}

export function buildPhase1ScoreAudit(params: {
	coverage?: Phase1CoverageV1 | null;
	signals?: { score?: number | null; confidence?: Phase1ConfidenceBand | null } | null;
}): Phase1ExecutiveScoreAuditV1 | null {
	const coverage = params.coverage && typeof params.coverage === "object" ? params.coverage : null;
	if (!coverage || !coverage.sections || typeof coverage.sections !== "object") return null;

	const sections = coverage.sections;
	const missingMarketIcp = (sections as any).market_icp === "missing";
	const missingTraction = (sections as any).traction === "missing";
	const missingBusinessModel = (sections as any).business_model === "missing";
	const missingRisks = (sections as any).risks === "missing";

	const rawScore = 100
		- (missingMarketIcp ? 10 : 0)
		- (missingMarketIcp ? 10 : 0) // market + icp treated independently
		- (missingTraction ? 10 : 0)
		- (missingBusinessModel ? 5 : 0)
		- (missingRisks ? 5 : 0);
	const rubric_score = clampScore(rawScore);
	const rubric_band = rubric_score >= 75 ? "high" : rubric_score >= 50 ? "med" : "low";

	const score_reported = toFinite(params.signals?.score);
	const confidence_reported = (params.signals?.confidence as Phase1ConfidenceBand) ?? "low";
	const delta = score_reported == null ? 0 : Math.abs(score_reported - rubric_score);
	const mismatch = score_reported != null && delta >= 15;
	const reasons: string[] = [];
	if (mismatch) reasons.push(`Reported score deviates from rubric by ${Math.round(delta)} points`);

	return {
		score_reported,
		confidence_reported,
		rubric_score,
		rubric_band,
		mismatch,
		reasons,
	};
}

export function composeExecutiveSummaryV2(params: {
	deal: Phase1GeneratorDealInfo;
	overview_v2: unknown;
	coverage: Phase1CoverageV1;
	decision_summary_v1: Phase1DecisionSummaryV1;
	overall_score?: number | null;
}): Phase1ExecutiveSummaryV2 {
	const overview = (params.overview_v2 && typeof params.overview_v2 === "object") ? (params.overview_v2 as any) : null;

	const safeNonEmptyKnown = (v: unknown): string | null => {
		const s = safeNonEmpty(v);
		if (!s) return null;
		if (s.trim().toLowerCase() === "unknown") return null;
		return s;
	};

	const pickOverviewText = (o: any, keys: string[]): string | null => {
		if (!o || typeof o !== "object") return null;
		for (const k of keys) {
			const v = safeNonEmptyKnown((o as any)[k]);
			if (v) return v;
		}
		return null;
	};

	const dealName = safeNonEmpty(overview?.deal_name) || safeNonEmpty(params.deal?.name) || "This deal";
	const product = pickOverviewText(overview, [
		"product_solution",
		"product",
		"solution",
		"product_description",
		"value_prop",
		"value_proposition",
		"Product",
	]);
	const market = pickOverviewText(overview, [
		"market_icp",
		"icp",
		"market",
		"target_customer",
		"target_market",
		"ICP",
		"Market",
	]);
	const raise = pickOverviewText(overview, [
		"raise",
		"raise_terms",
		"terms",
		"round",
		"Raise",
		"Terms",
	]);
	const businessModel = pickOverviewText(overview, [
		"business_model",
		"model",
		"businessModel",
		"BusinessModel",
	]);
	const tractionSignals = Array.isArray(overview?.traction_signals)
		? overview.traction_signals.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];
	const riskSignals = Array.isArray(overview?.key_risks_detected)
		? overview.key_risks_detected.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];

	const missing: string[] = [];
	if (!product) missing.push("product_solution");
	if (!market) missing.push("market_icp");
	if (!raise) missing.push("raise");
	if (!businessModel) missing.push("business_model");
	if (tractionSignals.length === 0) missing.push("traction_signals");
	if (riskSignals.length === 0) missing.push("key_risks_detected");

	const gaps = coverageGapsSummary(params.coverage);
	if (gaps.missing.length > 0) missing.push("coverage_missing_sections");

	const rec = params.decision_summary_v1.recommendation;
	const confidence = params.decision_summary_v1.confidence;
	const blockersCount = Array.isArray(params.decision_summary_v1.blockers) ? params.decision_summary_v1.blockers.length : 0;

	const scoreSnapshot = selectScoreSnapshot({
		overall_score: params.overall_score,
		phase1_score: (params.decision_summary_v1 as any)?.score,
		decision: rec,
		confidence,
	});
	const scoreText = scoreSnapshot.score == null
		? "Score unavailable (insufficient data)"
		: `${scoreSnapshot.score}/100`;

	const p1Parts: string[] = [];
	if (product) {
		p1Parts.push(`${dealName}: ${product}`);
	} else {
		p1Parts.push(`${dealName}: Product description not provided yet.`);
	}
	if (market) p1Parts.push(`Target customer: ${market}`);
	if (businessModel) p1Parts.push(`Business model: ${businessModel}`);
	if (raise) p1Parts.push(`Raise/terms: ${raise}`);
	const p1 = capOneLiner(normalizeOverviewSentence(p1Parts.join(" "), 340), 340);

	const p2Bits: string[] = [];
	p2Bits.push(`Phase 1 signal: ${rec} (${scoreText}, confidence ${confidence}).`);
	if (blockersCount > 0) p2Bits.push(`Blockers flagged: ${blockersCount}.`);
	if (gaps.missing.length > 0 || gaps.partial.length > 0) {
		const gapTextParts: string[] = [];
		if (gaps.missing.length > 0) gapTextParts.push(`missing ${gaps.missing.join(", ")}`);
		if (gaps.partial.length > 0) gapTextParts.push(`partial ${gaps.partial.join(", ")}`);
		p2Bits.push(`Coverage gaps: ${gapTextParts.join("; ")}.`);
	}
	const p2 = capOneLiner(normalizeOverviewSentence(p2Bits.join(" "), 340), 340);

	const highlights: string[] = [];
	highlights.push(`Recommendation: ${rec} (${scoreText}, confidence ${confidence}).`);
	highlights.push(product ? `Product: ${capOneLiner(product, 220)}` : "Product: not provided in Phase 1 overview.");
	highlights.push(market ? `ICP: ${capOneLiner(market, 220)}` : "ICP: not provided in Phase 1 overview.");
	highlights.push(raise ? `Raise/terms: ${capOneLiner(raise, 140)}` : "Raise/terms: not provided.");
	highlights.push(businessModel ? `Business model: ${capOneLiner(businessModel, 120)}` : "Business model: not provided.");
	const tractionText = formatList(tractionSignals, 3);
	const risksText = formatList(riskSignals, 3);
	if (tractionText || risksText) {
		const bits: string[] = [];
		if (tractionText) bits.push(`Traction: ${tractionText}.`);
		if (risksText) bits.push(`Risks: ${risksText}.`);
		highlights.push(bits.join(" "));
	} else {
		highlights.push("Traction & risks: not evidenced yet.");
	}

	const title = safeNonEmpty(params.deal?.name)
		? `${safeNonEmpty(params.deal.name)} — Executive Summary`
		: "Executive Summary";

	const generatedAt = safeNonEmpty(overview?.generated_at);
	const out: Phase1ExecutiveSummaryV2 = {
		title,
		paragraphs: [p1, p2].filter((x) => x.trim()).slice(0, 2),
		highlights: highlights.filter((x) => x.trim()).slice(0, 6),
		missing: uniqStrings(missing),
		signals: {
			recommendation: rec,
			score: scoreSnapshot.score,
			confidence,
			blockers_count: blockersCount,
		},
		...(generatedAt ? { generated_at: generatedAt } : {}),
	};

	// Enforce 1–2 paragraphs deterministically.
	if (out.paragraphs.length === 0) out.paragraphs = ["Executive summary pending: Phase 1 overview not available yet."];
	if (out.paragraphs.length > 2) out.paragraphs = out.paragraphs.slice(0, 2);

	return out;
}

export function generatePhase1DIOV1(params: {
	deal: Phase1GeneratorDealInfo;
	inputDocuments: Phase1GeneratorInputDocument[];
	dio?: unknown;
	deal_overview_v2?: unknown;
	business_archetype_v1?: unknown;
	update_report_v1?: unknown;
	maxClaims?: number;
}): Phase1DIOV1 {
	const maxClaims = Math.max(1, Math.min(25, params.maxClaims ?? 10));
	const docs = Array.isArray(params.inputDocuments) ? params.inputDocuments : [];
	const policyId = getSelectedPolicyIdFromAny(params.dio);
	const policyAllowsRealEstateMarketIcp = policyId === "real_estate_underwriting";

	const combinedText = docs
		.map((d) => pickBestText(d))
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 60_000);
	const domainText = takeTopDocumentText(docs, 8_000);

	const overview = buildDealOverviewV1({
		dealName: params.deal.name,
		docs,
	});

	const overviewV2 = (params.deal_overview_v2 && typeof params.deal_overview_v2 === "object")
		? (params.deal_overview_v2 as any)
		: null;
	const overviewV2Normalized = normalizePhase1OverviewV2(overviewV2);
	const updateReportV1 = (params.update_report_v1 && typeof params.update_report_v1 === "object")
		? (params.update_report_v1 as any)
		: null;
	const updateAfter = (field: string): string => {
		const changes = Array.isArray(updateReportV1?.changes) ? updateReportV1.changes : [];
		for (const c of changes) {
			if (!c || typeof c !== "object") continue;
			if ((c as any).field !== field) continue;
			const after = (c as any).after;
			if (typeof after === "string" && after.trim()) return sanitizeInlineText(after);
		}
		return "";
	};
	let businessArchetypeV1 = (params.business_archetype_v1 && typeof params.business_archetype_v1 === "object")
		? (params.business_archetype_v1 as any)
		: null;
	const businessArchetypeValue = safeString(businessArchetypeV1?.value).toLowerCase();
	const archetypeLooksRE = businessArchetypeValue === "real_estate" || businessArchetypeValue.includes("real_estate");

	const v2Product = overviewV2Normalized?.product_solution && typeof overviewV2Normalized.product_solution === "string"
		? normalizeOverviewSentence(overviewV2Normalized.product_solution, 220)
		: normalizeOverviewSentence(updateAfter("deal_overview_v2.product_solution"), 220);
	const v2Market = overviewV2Normalized?.market_icp && typeof overviewV2Normalized.market_icp === "string"
		? normalizeOverviewSentence(overviewV2Normalized.market_icp, 220)
		: normalizeOverviewSentence(updateAfter("deal_overview_v2.market_icp"), 220);
	const v2DealType = overviewV2Normalized?.deal_type && typeof overviewV2Normalized.deal_type === "string"
		? sanitizeInlineText(overviewV2Normalized.deal_type)
		: "";
	const v2Raise = overviewV2Normalized?.raise && typeof overviewV2Normalized.raise === "string"
		? sanitizeInlineText(overviewV2Normalized.raise)
		: "";
	const v2BusinessModel = overviewV2Normalized?.business_model && typeof overviewV2Normalized.business_model === "string"
		? sanitizeInlineText(overviewV2Normalized.business_model)
		: "";
	const v2Traction = Array.isArray(overviewV2Normalized?.traction_signals)
		? overviewV2Normalized.traction_signals.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];
	const v2Risks = Array.isArray(overviewV2Normalized?.key_risks_detected)
		? overviewV2Normalized.key_risks_detected.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];

	const overviewExtract = extractPhase1OverviewFromDocuments(
		docs.map((d) => ({
			document_id: d.document_id,
			title: d.title,
			full_text: pickBestText(d),
		}))
	);
	const extractEv = (field: Phase1OverviewExtractorField): Phase1OverviewExtractorEvidence | null =>
		overviewExtract.evidence.find((e) => e.field === field) ?? null;
	const extractedWithMinConfidence = (field: Phase1OverviewExtractorField, minConfidence: number): string => {
		const value = safeNonEmpty((overviewExtract.fields as any)?.[field]);
		const ev = extractEv(field);
		if (!value) return "";
		if (!ev) return "";
		if (typeof ev.confidence !== "number" || !Number.isFinite(ev.confidence)) return "";
		if (ev.confidence < minConfidence) return "";
		return value;
	};
	const extractedProduct = extractedWithMinConfidence("product_solution", 0.7);
	const extractedMarket = extractedWithMinConfidence("market_icp", 0.7);
	const extractedRaiseTerms = extractedWithMinConfidence("raise_terms", 0.65);
	const extractedGtm = extractedWithMinConfidence("go_to_market", 0.65);
	const extractedRisksList = Array.isArray(overviewExtract.fields.key_risks_detected)
		? overviewExtract.fields.key_risks_detected.map((x) => sanitizeInlineText(String(x))).filter(Boolean)
		: [];
	const extractedRisks = (() => {
		const ev = extractEv("key_risks_detected");
		if (!ev || typeof ev.confidence !== "number" || !Number.isFinite(ev.confidence) || ev.confidence < 0.65) return [];
		return uniqStrings(extractedRisksList).slice(0, 8);
	})();

	const baseLooksRE = looksLikeRealEstateOffering(combinedText) || archetypeLooksRE;

	let deal_type = (baseLooksRE && /\bstartup_raise\b/i.test(v2DealType)) ? overview.deal_type : (v2DealType || overview.deal_type);
	const raise = v2Raise || overview.raise;
	let business_model = (baseLooksRE && /\bservices\b/i.test(v2BusinessModel) && /real\s+estate/i.test(overview.business_model))
		? overview.business_model
		: (v2BusinessModel || overview.business_model);
	const traction_signals = v2Traction.length > 0 ? uniqStrings(v2Traction) : overview.traction_signals;
	const key_risks_detected = v2Risks.length > 0
		? uniqStrings(v2Risks)
		: extractedRisks.length > 0
			? extractedRisks
			: overview.key_risks_detected;
	const raiseDetected = raise !== "Unknown" ? raise : null;

	const title = params.deal.name?.trim() ? `${params.deal.name} — Executive Summary` : "Executive Summary";
	const anyText = hasAnyExtractedText(docs);

	// Build an understanding-only one-liner from the deterministic overview (no raw snippets; no invention).
	const tractionMetrics = overview.traction_metrics;
	const oneLinerParts: string[] = [];
	const dealName = overview.deal_name?.trim() ? overview.deal_name.trim() : "";
	let productSentence = v2Product
		|| extractedProduct
		|| (overview.product_solution?.trim() ? overview.product_solution.trim() : "");
	let marketSentence = v2Market
		|| extractedMarket
		|| (overview.market_icp?.trim() ? overview.market_icp.trim() : "");

	const arbitration = arbitrateDealTruth({
		domainText,
		deal_type,
		business_model,
		product_solution: productSentence,
		market_icp: marketSentence,
		looksRE: baseLooksRE,
	});
	deal_type = arbitration.deal_type;
	business_model = arbitration.business_model;
	productSentence = arbitration.product_solution;
	marketSentence = arbitration.market_icp;
	const looksRE = arbitration.looksRE;

	// Business model / archetype evidence quality gate (after arbitration, before coverage/score).
	if (business_model !== "Unknown") {
		const scores = domainAnchorScores(domainText);
		const pick = pickPrimaryDomain(scores);
		const evidenceTextForModelGate = extractAllReadableText(docs).slice(0, 60_000);
		const ok = hasValidBusinessModelEvidence({
			evidenceText: evidenceTextForModelGate,
			business_model,
			primary: pick.primary,
			scores,
		});
		if (!ok) {
			business_model = "Unknown";
			if (businessArchetypeV1 && typeof (businessArchetypeV1 as any).confidence === "number") {
				businessArchetypeV1 = {
					...(businessArchetypeV1 as any),
					confidence: Math.min((businessArchetypeV1 as any).confidence, 0.3),
				};
			}
		}
	}

	// Hard validation: reject contaminated/low-quality product/ICP values and do not replace with fallback.
	let productHardRejected = false;
	let marketHardRejected = false;
	const validatedProduct = hardValidateProductSolution(productSentence);
	if (productSentence.trim() && !validatedProduct.trim()) productHardRejected = true;
	productSentence = validatedProduct;
	const validatedMarket = looksRE
		? (policyAllowsRealEstateMarketIcp ? hardValidateRealEstateMarketIcp(marketSentence) : hardValidateProductSolution(marketSentence))
		: hardValidateMarketICP(marketSentence);
	if (marketSentence.trim() && !validatedMarket.trim()) marketHardRejected = true;
	marketSentence = validatedMarket;

	// Last-resort fallback for real-estate memos where worker deal_overview_v2 omits product/ICP and
	// extracted text may be sparse or numeric-heavy.
	// IMPORTANT: do not apply fallbacks if values were hard-rejected.
	let productFromRealEstateFallback = false;
	let marketFromRealEstateFallback = false;
	if (looksRE && !productHardRejected && !productSentence.trim()) {
		const fallback = detectRealEstateProductFromSparseText(combinedText);
		if (fallback) {
			productSentence = fallback;
			productFromRealEstateFallback = true;
		}
	}
	if (looksRE && !marketHardRejected && !marketSentence.trim()) {
		const fallback = detectRealEstateMarketFromSparseText(combinedText);
		if (fallback) {
			marketSentence = fallback;
			marketFromRealEstateFallback = true;
		}
	}
	// Validate again after any real-estate fallback.
	if (!productHardRejected) productSentence = hardValidateProductSolution(productSentence);
	if (!marketHardRejected) {
		// Keep real-estate deals conservative: require explicit market/tenant signals.
		marketSentence = looksRE
			? (policyAllowsRealEstateMarketIcp ? hardValidateRealEstateMarketIcp(marketSentence) : hardValidateProductSolution(marketSentence))
			: hardValidateMarketICP(marketSentence);
	}

	// Final post-arbitration, post-validation truth object.
	const finalTruth = {
		deal_type,
		product_solution: productSentence.trim() ? productSentence : "",
		market_icp: marketSentence.trim() ? marketSentence : "",
		business_model,
		raise,
		traction_signals,
		key_risks_detected,
	};
	if (productSentence && dealName && productSentence.toLowerCase().startsWith(dealName.toLowerCase())) {
		oneLinerParts.push(productSentence);
	} else {
		if (dealName) oneLinerParts.push(`${dealName}:`);
		if (productSentence) oneLinerParts.push(`Product: ${productSentence}`);
	}
	if (finalTruth.market_icp) oneLinerParts.push(`Serves: ${finalTruth.market_icp}`);
	if (finalTruth.deal_type !== "Unknown") oneLinerParts.push(`Deal type: ${finalTruth.deal_type}.`);
	if (finalTruth.business_model !== "Unknown") oneLinerParts.push(`Business model: ${finalTruth.business_model}.`);
	if (finalTruth.raise !== "Unknown") oneLinerParts.push(`Raise: ${finalTruth.raise}.`);
	const tractionBits = uniqStrings([
		...finalTruth.traction_signals,
		...tractionMetrics,
	]).slice(0, 3);
	if (tractionBits.length > 0) oneLinerParts.push(`Traction: ${tractionBits.join("; ")}.`);
	if (oneLinerParts.length <= 1) {
		// Fallback that is never empty when docs exist.
		if (docs.length > 0) oneLinerParts.push(`Documents present: ${docs.length}.`);
		if (!anyText && docs.length > 0) oneLinerParts.push("Extracted text not available yet.");
	}
	let one_liner = capOneLiner(oneLinerParts.join(" "), 300);
	if (!one_liner && docs.length > 0) one_liner = capOneLiner(`Summary pending. Documents present: ${docs.length}.`, 300);
	if (!one_liner) one_liner = "Summary pending.";

	const unknowns: string[] = [];
	if (finalTruth.deal_type === "Unknown") unknowns.push("deal_type");
	if (finalTruth.raise === "Unknown") unknowns.push("raise");
	if (finalTruth.business_model === "Unknown") unknowns.push("business_model");
	if (finalTruth.traction_signals.length === 0 && tractionMetrics.length === 0) unknowns.push("traction_signals");
	if (finalTruth.key_risks_detected.length === 0) unknowns.push("key_risks_detected");
	if (!finalTruth.product_solution.trim()) unknowns.push("product_solution");
	if (!finalTruth.market_icp.trim()) unknowns.push("market_icp");

	const termsEv = extractEv("raise_terms");
	const termsStatus: "present" | "partial" | "missing" = finalTruth.raise === "Unknown"
		? (extractedRaiseTerms
			? ((termsEv && typeof termsEv.confidence === "number" && termsEv.confidence >= 0.75) ? "present" : "partial")
			: "missing")
		: "present";
	const productStatus: "present" | "partial" | "missing" = finalTruth.product_solution.trim() ? "present" : "missing";
	const marketStatus: "present" | "partial" | "missing" = finalTruth.market_icp.trim() ? "present" : "missing";
	const tractionStatus: "present" | "partial" | "missing" = sectionStatus(
		"",
		finalTruth.traction_signals.length > 0 ? finalTruth.traction_signals : tractionMetrics
	);
	const financialsStatus: "present" | "partial" | "missing" = coverageStatusFromText(
		combinedText,
		[/(revenue|arr|mrr|burn|runway|cash|margin|expenses|profit|noi|cap\s*rate|dscr|ltv|irr|equity\s+multiple|cash-?on-?cash|pro\s*forma)\b/i],
		docs.some((d) => safeString(d.type).trim() === "financials") ? "partial" : "missing"
	);
	const risksStatus: "present" | "partial" | "missing" = sectionStatus("", finalTruth.key_risks_detected);
	const gtmEv = extractEv("go_to_market");
	const gtmStatusBase: "present" | "partial" | "missing" = looksRE
		? coverageStatusFromText(
			combinedText,
			[/(leasing|lease-?up|tenant|occupanc|rent\s+growth|broker|marketing\s+plan|absorption|value-?add|renovation)\b/i],
			"missing"
		)
		: coverageStatusFromText(combinedText, [/(go\s*-?to\s*-?market|\bgtm\b|pricing|sales\s+motion|distribution|channel)\b/i], "missing");
	const gtmStatus: "present" | "partial" | "missing" = extractedGtm
		? ((gtmEv && typeof gtmEv.confidence === "number" && gtmEv.confidence >= 0.75) ? "present" : "partial")
		: gtmStatusBase;

	const coverage: Phase1CoverageV1 = {
		sections: {
			deal_type: finalTruth.deal_type === "Unknown" ? "missing" : "present",
			raise_terms: termsStatus,
			terms: termsStatus,
			business_model: finalTruth.business_model === "Unknown" ? "missing" : "present",
			product_solution: productStatus,
			product: productStatus,
			market_icp: marketStatus,
			market: marketStatus,
			gtm: gtmStatus,
			team: coverageStatusFromText(combinedText, [/(founder|team|ceo|cto|co-founder|background|experience)\b/i], "missing"),
			traction: tractionStatus,
			financials: financialsStatus,
			risks: risksStatus,
			documents: docs.length > 0 ? "present" : "missing",
		},
	};

	const sectionConfidence: Record<string, Phase1ConfidenceBand> = {
		deal_type: finalTruth.deal_type === "Unknown" ? "low" : "med",
		raise_terms: finalTruth.raise === "Unknown" ? "low" : "med",
		business_model: finalTruth.business_model === "Unknown" ? "low" : "med",
		traction: finalTruth.traction_signals.length > 0 ? "med" : "low",
		risks: finalTruth.key_risks_detected.length > 0 ? "med" : "low",
		product_solution: finalTruth.product_solution.trim() ? "med" : "low",
		market_icp: finalTruth.market_icp.trim() ? "med" : "low",
		gtm: coverage.sections.gtm === "present" ? "med" : "low",
		team: coverage.sections.team === "present" ? "med" : "low",
		financials: coverage.sections.financials === "present" ? "med" : coverage.sections.financials === "partial" ? "low" : "low",
	};

	let overall = capConfidenceFromCoreMissing(coverage.sections, confidenceFromCoverage(coverage));

	const decision_summary_v1 = buildDecisionSummary({ coverage, docs });
	decision_summary_v1.confidence = overall;

	// Post-score penalty step (applies after arbitration+validation): ensure missing fundamentals reduce the numeric score.
	// Do not change scoring weights; apply deterministic adjustments on top of the existing rubric.
	let postPenalty = 0;
	if (!finalTruth.product_solution.trim()) postPenalty += 10;
	if (!finalTruth.market_icp.trim()) postPenalty += 10;
	if (finalTruth.raise === "Unknown" || coverage.sections.raise_terms === "missing") postPenalty += 5;
	if (coverage.sections.gtm === "missing") postPenalty += 5;
	if (postPenalty > 0) {
		decision_summary_v1.score = clampScore((decision_summary_v1.score ?? 0) - postPenalty);
	}

	// Hard rule: if product_solution OR market_icp is empty after arbitration+validation,
	// confidence MUST be low and recommendation MUST NOT be GO.
	if (!finalTruth.product_solution.trim() || !finalTruth.market_icp.trim()) {
		overall = "low";
		decision_summary_v1.confidence = "low";
		if (decision_summary_v1.recommendation === "GO") decision_summary_v1.recommendation = "CONSIDER";
	}

	const overviewSourcesFromExtractor = overviewExtract.evidence
		.map((e) => ({
			document_id: e.document_id,
			note: capSnippet(`${e.field} (conf ${Math.round(e.confidence * 100)}%): ${e.snippet}`, 220),
		}))
		.slice(0, 8);
	const mergedSources = (() => {
		const existing = Array.isArray((overviewV2Normalized as any)?.sources) ? (overviewV2Normalized as any).sources : [];
		const cleanedExisting = existing
			.filter((s: any) => s && typeof s === "object" && typeof s.document_id === "string")
			.map((s: any) => ({ document_id: String(s.document_id), note: typeof s.note === "string" ? capSnippet(s.note, 220) : undefined }));
		const combined = [...cleanedExisting, ...overviewSourcesFromExtractor];
		const out: Array<{ document_id: string; note?: string }> = [];
		const seen = new Set<string>();
		for (const s of combined) {
			const key = `${s.document_id}|${s.note ?? ""}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(s);
			if (out.length >= 12) break;
		}
		return out.length > 0 ? out : undefined;
	})();

	const mergedOverviewCandidate: any = {
		...(overviewV2Normalized && typeof overviewV2Normalized === "object" ? overviewV2Normalized : {}),
		deal_name: safeNonEmpty((overviewV2Normalized as any)?.deal_name) || overview.deal_name,
		product_solution: finalTruth.product_solution.trim() ? finalTruth.product_solution : null,
		market_icp: finalTruth.market_icp.trim() ? finalTruth.market_icp : null,
		deal_type: finalTruth.deal_type,
		business_model: (() => {
			if (finalTruth.business_model !== "Unknown") return finalTruth.business_model;
			const candidate = safeNonEmpty((overviewV2Normalized as any)?.business_model) || safeNonEmpty(overview.business_model);
			if (!candidate) return "Unknown";
			const sourceDealType = safeNonEmpty((overviewV2Normalized as any)?.deal_type) || safeNonEmpty(overview.deal_type);
			const sourceLooksRealEstate = /^real_estate/i.test(sourceDealType);
			if (sourceLooksRealEstate) return "Unknown";
			return candidate;
		})(),
		raise: safeNonEmpty((overviewV2Normalized as any)?.raise) || finalTruth.raise,
		raise_terms: safeNonEmpty((overviewV2Normalized as any)?.raise_terms)
			|| extractedRaiseTerms
			|| (finalTruth.raise !== "Unknown" ? finalTruth.raise : null),
		go_to_market: safeNonEmpty((overviewV2Normalized as any)?.go_to_market) || extractedGtm || null,
		traction_signals: finalTruth.traction_signals,
		key_risks_detected: finalTruth.key_risks_detected,
		...(mergedSources ? { sources: mergedSources } : {}),
	};
	const mergedOverviewForV2 = (() => {
		const any = mergedOverviewCandidate as any;
		const hasAnyField =
			Boolean(safeNonEmpty(any?.product_solution))
			|| Boolean(safeNonEmpty(any?.market_icp))
			|| Boolean(safeNonEmpty(any?.raise_terms))
			|| Boolean(safeNonEmpty(any?.go_to_market))
			|| (Array.isArray(any?.traction_signals) && any.traction_signals.length > 0)
			|| (Array.isArray(any?.key_risks_detected) && any.key_risks_detected.length > 0)
			|| Boolean(safeNonEmpty(any?.raise))
			|| Boolean(safeNonEmpty(any?.business_model));
		return hasAnyField ? any : null;
	})();

	const executive_summary_v2 = composeExecutiveSummaryV2({
		deal: params.deal,
		overview_v2: mergedOverviewForV2 ?? overviewV2Normalized ?? overviewV2,
		coverage,
		decision_summary_v1,
		overall_score: (params.dio && typeof params.dio === "object") ? (params.dio as any)?.overall_score : null,
	});

	const claims: Phase1ClaimV1[] = [];

	const addClaim = (category: Phase1ClaimCategoryV1, text: string, evidenceFrom: Phase1GeneratorInputDocument, hint?: RegExp) => {
		const t = text.trim();
		if (!t) return;
		const claim_id = stableId(`p1_${category}`, t);
		const ev = pickSnippetFromDoc(evidenceFrom, hint);
		const snippet = ev.snippet.trim() ? ev.snippet.trim() : "Document provided";
		claims.push({
			claim_id,
			category,
			text: t,
			evidence: [
				{
					document_id: evidenceFrom.document_id,
					snippet,
					page: ev.page,
				},
			],
		});
	};

	// Baseline claims (always make at least one claim when docs exist)
	if (docs.length > 0) {
		const first = docs[0];
		addClaim(
			"other",
			`Documents provided for analysis (${docs.length} total).`,
			first
		);
	}

	const docWithRaise = raiseDetected
		? docs.find((d) => pickBestText(d).toLowerCase().includes(raiseDetected.toLowerCase())) ?? docs[0]
		: null;
	if (docWithRaise && raiseDetected) {
		addClaim("terms", `Raise mentioned: ${raiseDetected}`, docWithRaise, /\b(raising|raise|seeking|ask|funding)\b|\$\s?\d/i);
	}

	if (finalTruth.business_model !== "Unknown" && docs.length > 0) {
		addClaim("product", `Business model signal detected: ${finalTruth.business_model}.`, docs[0], /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens/i);
	}

	if (finalTruth.traction_signals.length > 0 && docs.length > 0) {
		addClaim("traction", `Traction signals detected: ${finalTruth.traction_signals.join(", ")}.`, docs[0], /\barr\b|\bmrr\b|\brevenue\b|\bgrowth\b|\bcustomer/i);
	}

	if (finalTruth.key_risks_detected.length > 0 && docs.length > 0) {
		addClaim("risk", `Risk signals mentioned: ${finalTruth.key_risks_detected.join(", ")}.`, docs[0], /\brisk\b|\bcompetition\b|\bregulatory\b|\bsecurity\b/i);
	}

	// Additional evidence-backed claims from document types
	for (const d of docs) {
		const t = safeString(d.type).trim();
		if (!t) continue;
		if (t === "pitch_deck") {
			addClaim("product", "Pitch deck provided.", d, /\bproblem\b|\bsolution\b|\bproduct\b/i);
		}
		if (t === "financials") {
			addClaim("traction", "Financials document provided.", d, /\brevenue\b|\bburn\b|\bcash\b|\brunway\b/i);
		}
	}

	const uniqueClaims: Phase1ClaimV1[] = [];
	const seenClaimIds = new Set<string>();
	for (const c of claims) {
		if (seenClaimIds.has(c.claim_id)) continue;
		seenClaimIds.add(c.claim_id);
		uniqueClaims.push(c);
		if (uniqueClaims.length >= maxClaims) break;
	}

	// Additive: richer section semantics for UI. Keep coverage.sections as-is to avoid changing scoring math.
	const labelMap = getPhase1SectionLabels(policyId);
	const required = getRequiredPhase1Sections(policyId);

	const evidenceIdsFor = (category: Phase1ClaimCategoryV1): string[] =>
		uniqueClaims.filter((c) => c.category === category).map((c) => c.claim_id).filter(Boolean);

	const looksLikeRealEstateMarketEvidence = /\b(market|msa|submarket|tenant|tenants|leasing|lease-?up|occupanc|rent\s+growth|workforce\s+housing)\b/i.test(combinedText);

	const sectionInputs: Record<string, any> = {
		product_solution: {
			text: safeNonEmpty(mergedOverviewForV2?.product_solution) || safeNonEmpty(finalTruth.product_solution) || "",
			evidence_ids: evidenceIdsFor("product"),
			confidence_band: sectionConfidence.product_solution,
		},
		market_icp: {
			text: safeNonEmpty(mergedOverviewForV2?.market_icp) || safeNonEmpty(finalTruth.market_icp) || (policyId === "real_estate_underwriting" && looksLikeRealEstateMarketEvidence ? "Market and tenant profile are described in the offering memo." : ""),
			evidence_ids: evidenceIdsFor("market"),
			confidence_band: sectionConfidence.market_icp,
		},
		raise_terms: {
			text: safeNonEmpty(mergedOverviewForV2?.raise_terms) || safeNonEmpty(mergedOverviewForV2?.raise) || safeNonEmpty(finalTruth.raise) || "",
			evidence_ids: evidenceIdsFor("terms"),
			confidence_band: sectionConfidence.raise_terms,
		},
		business_model: {
			text: safeNonEmpty(mergedOverviewForV2?.business_model) || safeNonEmpty(finalTruth.business_model) || "",
			evidence_ids: [],
			confidence_band: sectionConfidence.business_model,
		},
		traction: {
			text: formatList([...(finalTruth.traction_signals ?? []), ...(tractionMetrics ?? [])], 6),
			evidence_ids: evidenceIdsFor("traction"),
			confidence_band: sectionConfidence.traction,
		},
		financials: {
			text: coverage.sections.financials === "present" ? "Financial metrics are referenced in the documents." : coverage.sections.financials === "partial" ? "Financials are partially provided (document present)." : "",
			evidence_ids: [],
			confidence_band: sectionConfidence.financials,
		},
		team: {
			text: coverage.sections.team === "present" ? "Team/sponsor information is referenced in the documents." : "",
			evidence_ids: evidenceIdsFor("team"),
			confidence_band: sectionConfidence.team,
		},
		gtm: {
			text: safeNonEmpty((mergedOverviewForV2 as any)?.go_to_market)
				|| (coverage.sections.gtm === "present" || coverage.sections.gtm === "partial"
					? "Go-to-market / plan is referenced in the documents."
					: ""),
			evidence_ids: [],
			confidence_band: sectionConfidence.gtm,
		},
		risks: {
			text: formatList(finalTruth.key_risks_detected ?? [], 6),
			evidence_ids: evidenceIdsFor("risk"),
			confidence_band: sectionConfidence.risks,
		},
	};

	const section_details: Record<string, Phase1CoverageSectionContractV1> = {};
	for (const k of Object.keys(sectionInputs)) {
		const present = Boolean(coverage.sections && Object.prototype.hasOwnProperty.call(coverage.sections, k));
		const src = sectionInputs[k];
		const conf = normalizeConfidenceToNumber(src?.confidence) ?? normalizeConfidenceToNumber(src?.confidence_band) ?? 0.5;
		const provided = isSectionProvided({ ...src, confidence: conf });
		section_details[k] = {
			present,
			provided: provided.provided,
			confidence: conf,
			...(typeof src?.confidence_band === "string" ? { confidence_band: src.confidence_band } : {}),
			...(provided.provided ? {} : { why_missing: provided.why_missing ?? "empty_text" }),
		};
	}

	const sections_missing_list = required.filter((k) => {
		const d = section_details[k];
		return !d || d.provided !== true;
	});

	coverage.section_details = section_details;
	coverage.required_sections = required;
	coverage.sections_missing_list = sections_missing_list;
	coverage.missing_counts = {
		required: required.length,
		missing: sections_missing_list.length,
		provided: Math.max(0, required.length - sections_missing_list.length),
	};
	coverage.section_labels = labelMap;

	const accountability_v1 = buildPhase1ExecutiveAccountability({ coverage, claims: uniqueClaims });
	const score_audit_v1 = buildPhase1ScoreAudit({ coverage, signals: (executive_summary_v2 as any)?.signals });
	if (executive_summary_v2 && typeof executive_summary_v2 === "object") {
		if (accountability_v1) (executive_summary_v2 as any).accountability_v1 = accountability_v1;
		if (score_audit_v1) (executive_summary_v2 as any).score_audit_v1 = score_audit_v1;
	}

	// Executive summary evidence: include claim pointers + snippet if available
	const executiveEvidence: Phase1ExecutiveSummaryEvidenceRefV1[] = uniqueClaims
		.slice(0, 6)
		.map((c) => {
			const ev0 = c.evidence[0];
			return {
				claim_id: c.claim_id,
				document_id: ev0.document_id,
				page: ev0.page,
				page_range: ev0.page_range,
				snippet: ev0.snippet,
			};
		});

	return {
		executive_summary_v1: {
			title,
			one_liner,
			deal_type: finalTruth.deal_type,
			raise: finalTruth.raise,
			business_model: finalTruth.business_model,
			traction_signals: finalTruth.traction_signals,
			key_risks_detected: finalTruth.key_risks_detected,
			unknowns: uniqStrings(unknowns),
			confidence: {
				overall,
				sections: sectionConfidence,
			},
			evidence: executiveEvidence,
		},
		executive_summary_v2,
		decision_summary_v1,
		claims: uniqueClaims,
		coverage,
		business_archetype_v1: businessArchetypeV1 ? (businessArchetypeV1 as any) : undefined,
		deal_overview_v2: mergedOverviewForV2 ? (mergedOverviewForV2 as any) : undefined,
		update_report_v1:
			params.update_report_v1 && typeof params.update_report_v1 === "object" ? (params.update_report_v1 as any) : undefined,
	};
}

export function mergePhase1IntoDIO(dio: any, phase1: Phase1DIOV1): any {
  const base = dio && typeof dio === "object" ? dio : {};
  const dioNode = base.dio && typeof base.dio === "object" ? base.dio : {};
  const existingPhase1 =
    dioNode.phase1 && typeof dioNode.phase1 === "object" ? dioNode.phase1 : {};

	const STANDARD_PHASE1_COVERAGE_KEYS = [
		"product_solution",
		"market_icp",
		"raise_terms",
		"business_model",
		"traction",
		"risks",
		"team",
		"gtm",
		"financials",
		"deal_type",
		"documents",
	] as const;

	type CoverageStatus = "present" | "partial" | "missing";

	function isCoverageStatus(v: unknown): v is CoverageStatus {
		return v === "present" || v === "partial" || v === "missing";
	}

	function normalizeCoverageSections(input: unknown): Record<string, CoverageStatus> {
		if (!input || typeof input !== "object") return {};
		const out: Record<string, CoverageStatus> = {};
		for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
			if (typeof k !== "string") continue;
			if (isCoverageStatus(v)) out[k] = v;
		}
		return out;
	}

	function inferCoverageSectionsFromPhase1(source: any): Record<string, CoverageStatus> {
		const s = source && typeof source === "object" ? source : {};
		const es1 = (s as any).executive_summary_v1;
		const ov2 = (s as any).deal_overview_v2;
		const claims = Array.isArray((s as any).claims) ? ((s as any).claims as any[]) : [];

		const dealType = typeof ov2?.deal_type === "string" ? ov2.deal_type : typeof es1?.deal_type === "string" ? es1.deal_type : "";
		const raise = typeof ov2?.raise === "string" ? ov2.raise : typeof es1?.raise === "string" ? es1.raise : "";
		const businessModel =
			typeof ov2?.business_model === "string" ? ov2.business_model : typeof es1?.business_model === "string" ? es1.business_model : "";

		const productSolution =
			typeof ov2?.product_solution === "string" && ov2.product_solution.trim()
				? ov2.product_solution
				: typeof es1?.one_liner === "string"
					? es1.one_liner
					: "";
		const marketIcp = typeof ov2?.market_icp === "string" ? ov2.market_icp : "";

		const tractionSignals = Array.isArray(es1?.traction_signals) ? es1.traction_signals : [];
		const keyRisks = Array.isArray(es1?.key_risks_detected) ? es1.key_risks_detected : [];

		const claimText = claims
			.map((c: any) => (typeof c?.text === "string" ? c.text : ""))
			.filter((t: string) => t.trim().length > 0)
			.join(" \n");
		const combinedText = `${typeof es1?.one_liner === "string" ? es1.one_liner : ""}\n${claimText}`;

		const anyEvidence = claims.some((c: any) => Array.isArray(c?.evidence) && c.evidence.some((e: any) => typeof e?.document_id === "string" && e.document_id.trim()));
		const anyClaims = claims.length > 0;

		const anyCategory = (cat: string) => claims.some((c: any) => c?.category === cat);

		const gtmPresent = /(go\s*-?to\s*-?market|\bgtm\b|pricing|sales\s+motion|distribution|channel)\b/i.test(combinedText);
		const teamPresent = /(founder|team|ceo|cto|co-founder|background|experience)\b/i.test(combinedText) || anyCategory("team");
		const financialsPresent =
			/(revenue|arr|mrr|burn|runway|cash|margin|expenses|profit|noi|cap\s*rate|dscr|ltv|irr|equity\s+multiple|cash-?on-?cash|pro\s*forma)\b/i.test(
				combinedText
			);

		const out: Record<string, CoverageStatus> = {
			deal_type: dealType && dealType !== "Unknown" ? "present" : "missing",
			raise_terms: raise && raise !== "Unknown" ? "present" : "missing",
			business_model: businessModel && businessModel !== "Unknown" ? "present" : "missing",
			product_solution:
				typeof ov2?.product_solution === "string" && ov2.product_solution.trim()
					? "present"
					: anyCategory("product")
						? "partial"
						: productSolution.trim()
							? "partial"
							: "missing",
			market_icp: typeof marketIcp === "string" && marketIcp.trim() ? "present" : anyCategory("market") ? "partial" : "missing",
			traction: tractionSignals.length > 0 || anyCategory("traction") ? "present" : "missing",
			risks: keyRisks.length > 0 || anyCategory("risk") ? "present" : "missing",
			gtm: gtmPresent ? "present" : "missing",
			team: teamPresent ? "present" : "missing",
			financials: financialsPresent ? "present" : "missing",
			documents: anyEvidence ? "present" : anyClaims ? "partial" : "missing",
		};

		return out;
	}

	function ensurePhase1Coverage(incomingPhase1: any, existing: any): Phase1CoverageV1 {
			const existingCoverage = existing?.coverage && typeof existing.coverage === "object" ? existing.coverage : {};
			const incomingCoverage = incomingPhase1?.coverage && typeof incomingPhase1.coverage === "object" ? incomingPhase1.coverage : {};
			const existingSections = normalizeCoverageSections(existingCoverage?.sections);
			const incomingSections = normalizeCoverageSections(incomingCoverage?.sections);
		const inferred = inferCoverageSectionsFromPhase1(incomingPhase1 && typeof incomingPhase1 === "object" ? incomingPhase1 : existing);

		const merged: Record<string, CoverageStatus> = {
			...existingSections,
			...incomingSections,
		};

		for (const k of STANDARD_PHASE1_COVERAGE_KEYS) {
			if (!merged[k]) merged[k] = inferred[k] ?? "missing";
		}

		// Preserve additive coverage metadata for UI/analytics while keeping canonical sections normalized.
		return {
			...existingCoverage,
			...incomingCoverage,
			sections: merged,
		};
	}

	const business_archetype_v1 = (phase1 as any)?.business_archetype_v1;
	const deal_overview_v2 = (phase1 as any)?.deal_overview_v2;
	const update_report_v1 = (phase1 as any)?.update_report_v1;
	const executive_summary_v2 = (phase1 as any)?.executive_summary_v2;
	const deal_summary_v2 = (phase1 as any)?.deal_summary_v2;

	const coverage = ensurePhase1Coverage(phase1 as any, existingPhase1);

  return {
    ...base,
    dio: {
      ...dioNode,
      phase1: {
        // Preserve extra nodes (deal_overview_v2, update_report_v1, etc.)
        ...existingPhase1,

        // Overwrite deterministic Phase 1 contract keys
				executive_summary_v1: phase1.executive_summary_v1,
				...(executive_summary_v2 && typeof executive_summary_v2 === "object" ? { executive_summary_v2 } : {}),
        decision_summary_v1: phase1.decision_summary_v1,
        claims: phase1.claims,
		coverage,

			...(deal_summary_v2 && typeof deal_summary_v2 === "object" ? { deal_summary_v2 } : {}),

				...(business_archetype_v1 && typeof business_archetype_v1 === "object" ? { business_archetype_v1 } : {}),
				...(deal_overview_v2 && typeof deal_overview_v2 === "object" ? { deal_overview_v2 } : {}),
				...(update_report_v1 && typeof update_report_v1 === "object" ? { update_report_v1 } : {}),
      },
    },
  };
}

export function stripExecutiveSummaryEvidenceForList(input: any): any {
	if (!input || typeof input !== "object") return input;
	const { evidence, ...rest } = input as any;
	return rest;
}
