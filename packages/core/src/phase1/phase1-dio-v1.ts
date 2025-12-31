import { createHash } from "crypto";

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
		score: number; // 0–100
		confidence: Phase1ConfidenceBand;
		blockers_count: number;
	};
	generated_at?: string; // derived from overview_v2.generated_at when present
};

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
		raise?: string;
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

function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
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

	const deal_type_detected = detectDealTypeFromDocs(docs) ?? "Unknown";
	const raiseDetected = detectRaise(readableText);
	const raise_detected = raiseDetected ?? "Unknown";
	const business_model_detected = detectBusinessModel(readableText) ?? "Unknown";
	const traction_signals_detected = detectTractionSignals(readableText);
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

function detectTractionSignals(text: string): string[] {
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
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
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

function safeNonEmpty(value: unknown): string {
	const s = sanitizeInlineText(safeString(value));
	return s;
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

export function composeExecutiveSummaryV2(params: {
	deal: Phase1GeneratorDealInfo;
	overview_v2: unknown;
	coverage: Phase1CoverageV1;
	decision_summary_v1: Phase1DecisionSummaryV1;
}): Phase1ExecutiveSummaryV2 {
	const overview = (params.overview_v2 && typeof params.overview_v2 === "object") ? (params.overview_v2 as any) : null;

	const dealName = safeNonEmpty(overview?.deal_name) || safeNonEmpty(params.deal?.name) || "This deal";
	const product = safeNonEmpty(overview?.product_solution);
	const market = safeNonEmpty(overview?.market_icp);
	const raise = safeNonEmpty(overview?.raise);
	const businessModel = safeNonEmpty(overview?.business_model);
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
	const score = params.decision_summary_v1.score;
	const confidence = params.decision_summary_v1.confidence;
	const blockersCount = Array.isArray(params.decision_summary_v1.blockers) ? params.decision_summary_v1.blockers.length : 0;

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
	p2Bits.push(`Phase 1 signal: ${rec} (${score}/100, confidence ${confidence}).`);
	if (blockersCount > 0) p2Bits.push(`Blockers flagged: ${blockersCount}.`);
	if (gaps.missing.length > 0 || gaps.partial.length > 0) {
		const gapTextParts: string[] = [];
		if (gaps.missing.length > 0) gapTextParts.push(`missing ${gaps.missing.join(", ")}`);
		if (gaps.partial.length > 0) gapTextParts.push(`partial ${gaps.partial.join(", ")}`);
		p2Bits.push(`Coverage gaps: ${gapTextParts.join("; ")}.`);
	}
	const p2 = capOneLiner(normalizeOverviewSentence(p2Bits.join(" "), 340), 340);

	const highlights: string[] = [];
	highlights.push(`Recommendation: ${rec} (${score}/100, confidence ${confidence}).`);
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
			score,
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

	const combinedText = docs
		.map((d) => pickBestText(d))
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 60_000);

	const overview = buildDealOverviewV1({
		dealName: params.deal.name,
		docs,
	});

	const overviewV2 = (params.deal_overview_v2 && typeof params.deal_overview_v2 === "object")
		? (params.deal_overview_v2 as any)
		: null;
	const businessArchetypeV1 = (params.business_archetype_v1 && typeof params.business_archetype_v1 === "object")
		? (params.business_archetype_v1 as any)
		: null;

	const v2Product = overviewV2?.product_solution && typeof overviewV2.product_solution === "string"
		? normalizeOverviewSentence(overviewV2.product_solution, 220)
		: "";
	const v2Market = overviewV2?.market_icp && typeof overviewV2.market_icp === "string"
		? normalizeOverviewSentence(overviewV2.market_icp, 220)
		: "";
	const v2DealType = overviewV2?.deal_type && typeof overviewV2.deal_type === "string"
		? sanitizeInlineText(overviewV2.deal_type)
		: "";
	const v2Raise = overviewV2?.raise && typeof overviewV2.raise === "string"
		? sanitizeInlineText(overviewV2.raise)
		: "";
	const v2BusinessModel = overviewV2?.business_model && typeof overviewV2.business_model === "string"
		? sanitizeInlineText(overviewV2.business_model)
		: "";
	const v2Traction = Array.isArray(overviewV2?.traction_signals)
		? overviewV2.traction_signals.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];
	const v2Risks = Array.isArray(overviewV2?.key_risks_detected)
		? overviewV2.key_risks_detected.filter((x: any) => typeof x === "string").map((x: string) => sanitizeInlineText(x)).filter(Boolean)
		: [];

	const deal_type = v2DealType || overview.deal_type;
	const raise = v2Raise || overview.raise;
	const business_model = v2BusinessModel || overview.business_model;
	const traction_signals = v2Traction.length > 0 ? uniqStrings(v2Traction) : overview.traction_signals;
	const key_risks_detected = v2Risks.length > 0 ? uniqStrings(v2Risks) : overview.key_risks_detected;
	const raiseDetected = raise !== "Unknown" ? raise : null;

	const title = params.deal.name?.trim() ? `${params.deal.name} — Executive Summary` : "Executive Summary";
	const anyText = hasAnyExtractedText(docs);

	// Build an understanding-only one-liner from the deterministic overview (no raw snippets; no invention).
	const tractionMetrics = overview.traction_metrics;
	const oneLinerParts: string[] = [];
	const dealName = overview.deal_name?.trim() ? overview.deal_name.trim() : "";
	const productSentence = v2Product || (overview.product_solution?.trim() ? overview.product_solution.trim() : "");
	const marketSentence = v2Market || (overview.market_icp?.trim() ? overview.market_icp.trim() : "");
	if (productSentence && dealName && productSentence.toLowerCase().startsWith(dealName.toLowerCase())) {
		oneLinerParts.push(productSentence);
	} else {
		if (dealName) oneLinerParts.push(`${dealName}:`);
		if (productSentence) oneLinerParts.push(`Product: ${productSentence}`);
	}
	if (marketSentence) oneLinerParts.push(`Serves: ${marketSentence}`);
	if (deal_type !== "Unknown") oneLinerParts.push(`Deal type: ${deal_type}.`);
	if (business_model !== "Unknown") oneLinerParts.push(`Business model: ${business_model}.`);
	if (raise !== "Unknown") oneLinerParts.push(`Raise: ${raise}.`);
	const tractionBits = uniqStrings([
		...traction_signals,
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
	if (deal_type === "Unknown") unknowns.push("deal_type");
	if (raise === "Unknown") unknowns.push("raise");
	if (business_model === "Unknown") unknowns.push("business_model");
	if (traction_signals.length === 0 && tractionMetrics.length === 0) unknowns.push("traction_signals");
	if (key_risks_detected.length === 0) unknowns.push("key_risks_detected");
	if (!productSentence.trim()) unknowns.push("product_solution");
	if (!marketSentence.trim()) unknowns.push("market_icp");

	const termsStatus: "present" | "partial" | "missing" = raise === "Unknown" ? "missing" : "present";
	const productStatus: "present" | "partial" | "missing" = productSentence.trim() ? "present" : "missing";
	const marketStatus: "present" | "partial" | "missing" = marketSentence.trim() ? "present" : "missing";
	const tractionStatus: "present" | "partial" | "missing" = sectionStatus(
		"",
		traction_signals.length > 0 ? traction_signals : tractionMetrics
	);
	const financialsStatus: "present" | "partial" | "missing" = coverageStatusFromText(
		combinedText,
		[/(revenue|arr|mrr|burn|runway|cash|margin|expenses|profit)\b/i],
		docs.some((d) => safeString(d.type).trim() === "financials") ? "partial" : "missing"
	);
	const risksStatus: "present" | "partial" | "missing" = sectionStatus("", key_risks_detected);

	const coverage: Phase1CoverageV1 = {
		sections: {
			deal_type: deal_type === "Unknown" ? "missing" : "present",
			raise_terms: termsStatus,
			terms: termsStatus,
			business_model: business_model === "Unknown" ? "missing" : "present",
			product_solution: productStatus,
			product: productStatus,
			market_icp: marketStatus,
			market: marketStatus,
			gtm: coverageStatusFromText(combinedText, [/(go\s*-?to\s*-?market|\bgtm\b|pricing|sales\s+motion|distribution|channel)\b/i], "missing"),
			team: coverageStatusFromText(combinedText, [/(founder|team|ceo|cto|co-founder|background|experience)\b/i], "missing"),
			traction: tractionStatus,
			financials: financialsStatus,
			risks: risksStatus,
			documents: docs.length > 0 ? "present" : "missing",
		},
	};

	const sectionConfidence: Record<string, Phase1ConfidenceBand> = {
		deal_type: deal_type === "Unknown" ? "low" : "med",
		raise_terms: raise === "Unknown" ? "low" : "med",
		business_model: business_model === "Unknown" ? "low" : "med",
		traction: traction_signals.length > 0 ? "med" : "low",
		risks: key_risks_detected.length > 0 ? "med" : "low",
		product_solution: overview.product_solution.trim() ? "med" : "low",
		market_icp: overview.market_icp.trim() ? "med" : "low",
		gtm: coverage.sections.gtm === "present" ? "med" : "low",
		team: coverage.sections.team === "present" ? "med" : "low",
		financials: coverage.sections.financials === "present" ? "med" : coverage.sections.financials === "partial" ? "low" : "low",
	};

	const overall = confidenceFromCoverage(coverage);

	const decision_summary_v1 = buildDecisionSummary({ coverage, docs });

	const executive_summary_v2 = composeExecutiveSummaryV2({
		deal: params.deal,
		overview_v2: overviewV2,
		coverage,
		decision_summary_v1,
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

	if (business_model !== "Unknown" && docs.length > 0) {
		addClaim("product", `Business model signal detected: ${business_model}.`, docs[0], /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens/i);
	}

	if (traction_signals.length > 0 && docs.length > 0) {
		addClaim("traction", `Traction signals detected: ${traction_signals.join(", ")}.`, docs[0], /\barr\b|\bmrr\b|\brevenue\b|\bgrowth\b|\bcustomer/i);
	}

	if (key_risks_detected.length > 0 && docs.length > 0) {
		addClaim("risk", `Risk signals mentioned: ${key_risks_detected.join(", ")}.`, docs[0], /\brisk\b|\bcompetition\b|\bregulatory\b|\bsecurity\b/i);
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
			deal_type,
			raise,
			business_model,
			traction_signals,
			key_risks_detected,
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
		deal_overview_v2: overviewV2 ? (overviewV2 as any) : undefined,
		update_report_v1:
			params.update_report_v1 && typeof params.update_report_v1 === "object" ? (params.update_report_v1 as any) : undefined,
	};
}

export function mergePhase1IntoDIO(dio: any, phase1: Phase1DIOV1): any {
  const base = dio && typeof dio === "object" ? dio : {};
  const dioNode = base.dio && typeof base.dio === "object" ? base.dio : {};
  const existingPhase1 =
    dioNode.phase1 && typeof dioNode.phase1 === "object" ? dioNode.phase1 : {};

	const business_archetype_v1 = (phase1 as any)?.business_archetype_v1;
	const deal_overview_v2 = (phase1 as any)?.deal_overview_v2;
	const update_report_v1 = (phase1 as any)?.update_report_v1;
	const executive_summary_v2 = (phase1 as any)?.executive_summary_v2;

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
        coverage: phase1.coverage,

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
