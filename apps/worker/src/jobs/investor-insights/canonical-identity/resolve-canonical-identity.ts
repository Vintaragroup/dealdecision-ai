/**
 * Canonical Company Identity Resolver
 *
 * Deterministic / heuristic resolver — NO LLM calls.
 *
 * Extracts company name candidates from DPU page text using multiple signals,
 * scores and deduplicates them, then returns the winning canonical identity
 * together with confidence metadata downstream systems can act on.
 *
 * Entry point: resolveCanonicalIdentity()
 *
 * Signal sources (highest → lowest weight):
 *   title_slide    Page 0: first short, title-case, non-sentence line
 *   domain_email   Domain token extracted from an in-document email / URL
 *   about_slide    "Company: X", "About X", "Introducing X" slides
 *   repeated_token CamelCase / brand token seen on 3+ distinct pages
 *   filename       Stem of an uploaded document filename
 *   entered_name   User-entered deal name (last resort / fallback only)
 *
 * Confidence tiers:
 *   high   title_slide + domain_email (or three corroborating signals)
 *   medium title_slide alone, or about_slide, or repeated_token (3+ pages)
 *   low    filename only, or single weak text signal
 *   none   only user-entered name — no document evidence
 */

import type { DpuPage } from "../stages/stage-2-deterministic";
import { normalizeCompanyName } from "../external-diligence/query-entity-utils";
import type {
	CanonicalIdentityCandidate,
	CanonicalIdentityConfidence,
	CanonicalIdentityResult,
	CanonicalIdentitySource,
} from "./canonical-identity-schema";

// ─── Pattern constants ────────────────────────────────────────────────────────

/** "Company: Acme" / "About Acme" / "Introducing Acme" */
const LABEL_RE =
	/(?:^|\n)\s*(?:Company|About|Introducing)\s*[:\-]\s*([A-Z][A-Za-z0-9&\-.,\s]{1,40}?)(?:\n|$)/m;

/** "Acme is a platform…" — brand token followed by descriptor verb */
const IS_A_RE =
	/^([A-Z][A-Za-z0-9&\-.]{2,35})\s+(?:is|are|provides?|offers?|enables?|helps?)\b/m;

/** Extract localpart domain from email: captures domain stem in group 1 */
const EMAIL_DOMAIN_RE = /\b[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9\-]{3,})\.[a-z]{2,}\b/g;

/** Extract domain stem from URL: captures stem in group 1 */
const URL_DOMAIN_RE = /https?:\/\/(?:www\.)?([a-zA-Z0-9\-]{3,})\.[a-z]{2,}/g;

/** Title-slide headline RE: 1-4 space-separated title-case words, line owns the whole line */
const TITLE_LINE_RE =
	/^([A-Z][A-Za-z0-9&\-.]{1,35}(?:\s+[A-Z][A-Za-z0-9&\-.]{0,25}){0,3})\s*$/m;

/**
 * Capitalized brand / CamelCase token:
 *   WorkflowAI, FlowDash, PayLink, Complyant, SaaS (≥ 4 chars), etc.
 * Deliberately excludes pure acronyms like "CEO" or "API" (≤ 3 chars all-caps).
 */
const BRAND_TOKEN_RE =
	/\b([A-Z][a-z]{2,}(?:[A-Z][a-z]*)+|[A-Z]{2,}[a-z]{2,}[A-Z][A-Za-z]*|[A-Z][a-z]{3,})\b/g;

// ─── Stopwords that should never be mistaken for company names ────────────────

const STOPWORDS = new Set([
	"About", "Company", "Team", "Product", "Service", "Platform", "Solution",
	"Market", "Using", "Today", "Building", "Helping", "Enabling", "Working",
	"Investors", "Investor", "Investment", "Strategy", "Vision", "Mission", "Overview",
	"Summary", "Executive", "Introduction", "Appendix", "Agenda", "Deck", "Slide",
	"Revenue", "Growth", "Data", "Analytics", "Report", "Results",
	"Business", "Technology", "Customer", "Customers", "Partner", "Partners",
	"Series", "Stage", "Round", "Fund", "Capital", "Venture", "Pitch",
	"Confidential", "Private", "Page", "Section", "Update",
	// Common pronouns / determiners that appear at sentence starts
	"This", "That", "These", "Those", "Here", "There", "Such", "Each",
	"Some", "Many", "Most", "More", "Less", "They", "Their",
]);

// ─── Source priority (for primary source selection) ────────────────────────────

const SOURCE_PRIORITY: CanonicalIdentitySource[] = [
	"title_slide",
	"domain_email",
	"about_slide",
	"repeated_token",
	"filename",
	"entered_name",
];

/** Numeric weight per source — used only for ranking multiple candidates */
const SOURCE_RANK_WEIGHT: Record<CanonicalIdentitySource, number> = {
	title_slide: 7,
	domain_email: 6,
	about_slide: 5,
	repeated_token: 4,
	filename: 2,
	entered_name: 1,
};

// ─── Internal accumulator ─────────────────────────────────────────────────────

interface CandidateAcc {
	/** Best display-form name seen for this normalised key */
	name: string;
	normalized: string;
	sources: Set<CanonicalIdentitySource>;
	page_indices: Set<number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simple character-level Levenshtein similarity ratio in [0, 1].
 * Returns 1.0 for identical strings, 0.0 when one is empty.
 */
function levenshteinRatio(a: string, b: string): number {
	if (a === b) return 1.0;
	if (a.length === 0 || b.length === 0) return 0.0;
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dp: number[] = Array.from({ length: rows * cols }, (_, i) => {
		const r = Math.floor(i / cols);
		const c = i % cols;
		if (r === 0) return c;
		if (c === 0) return r;
		return 0;
	});

	for (let r = 1; r < rows; r++) {
		for (let c = 1; c < cols; c++) {
			const cost = a[r - 1] === b[c - 1] ? 0 : 1;
			dp[r * cols + c] = Math.min(
				(dp[(r - 1) * cols + c] ?? r) + 1,
				(dp[r * cols + (c - 1)] ?? c) + 1,
				(dp[(r - 1) * cols + (c - 1)] ?? r + c - 1) + cost
			);
		}
	}
	const dist = dp[(rows - 1) * cols + (cols - 1)] ?? Math.max(a.length, b.length);
	return 1 - dist / Math.max(a.length, b.length, 1);
}

/**
 * Compute confidence tier from the set of corroborating sources.
 *
 * Spec:
 *   high   = title_slide + domain_email, OR 3+ independent signals
 *   medium = title_slide alone, or about_slide ± repeated_token, or repeated_token alone
 *   low    = filename only
 *   none   = no document evidence (only entered_name fallback)
 */
function computeConfidence(sources: Set<CanonicalIdentitySource>): CanonicalIdentityConfidence {
	const s = sources;
	if (s.size === 0) return "none";
	if (s.size === 1 && s.has("entered_name")) return "none";

	const hasTitle = s.has("title_slide");
	const hasDomain = s.has("domain_email");
	const hasAbout = s.has("about_slide");
	const hasRepeated = s.has("repeated_token");
	const hasFilename = s.has("filename");

	// Three or more independent document signals → high
	const documentSignalCount = [hasTitle, hasDomain, hasAbout, hasRepeated].filter(Boolean).length;
	if (documentSignalCount >= 3) return "high";

	// Two corroborating strong signals → high
	if (hasTitle && hasDomain) return "high";
	if (hasTitle && hasAbout) return "high";
	if (hasDomain && hasAbout) return "high";
	if (hasDomain && hasRepeated) return "high";

	// Single strong primary signal → medium
	if (hasTitle || hasAbout || hasRepeated) return "medium";

	// Domain alone (no text corroboration) → medium
	if (hasDomain) return "medium";

	// Only filename → low
	if (hasFilename) return "low";

	return "low";
}

/** Rank a candidate numerically for tie-breaking (higher = better) */
function rankCandidate(acc: CandidateAcc): number {
	let score = 0;
	for (const src of acc.sources) {
		score += SOURCE_RANK_WEIGHT[src];
	}
	// Bonus for appearing on more distinct pages
	score += Math.min(acc.page_indices.size, 8) * 0.5;
	return score;
}

/** Return the primary (highest-priority) source for a candidate */
function primarySource(sources: Set<CanonicalIdentitySource>): CanonicalIdentitySource {
	for (const s of SOURCE_PRIORITY) {
		if (sources.has(s)) return s;
	}
	return "entered_name";
}

/**
 * Generate a human-readable evidence summary string.
 * Used in identity_evidence field and the debug render section.
 */
function buildEvidenceString(
	winner: CandidateAcc,
	confidence: CanonicalIdentityConfidence,
	enteredName: string
): string {
	const parts: string[] = [];
	if (winner.sources.has("title_slide")) parts.push("found on title slide");
	if (winner.sources.has("domain_email")) parts.push("corroborated by email/URL domain");
	if (winner.sources.has("about_slide")) parts.push("found in About/Company slide");
	if (winner.sources.has("repeated_token")) {
		parts.push(`repeated across ${winner.page_indices.size} slide(s)`);
	}
	if (winner.sources.has("filename")) parts.push("inferred from filename");

	const sourcePart = parts.length > 0 ? parts.join(", ") : "no document evidence";
	const normEntered = normalizeCompanyName(enteredName).toLowerCase();
	const normWinner = winner.normalized;
	const mismatch = normEntered !== normWinner;

	const mismatchPart = mismatch
		? `. Mismatch detected: entered "${enteredName}" differs from document name "${winner.name}".`
		: "";

	return `Canonical name "${winner.name}" (confidence: ${confidence}) — ${sourcePart}${mismatchPart}`;
}

// ─── Title-slide extraction ───────────────────────────────────────────────────

/**
 * Extract the best company name candidate from a title slide (page_index 0).
 *
 * Strategy: iterate through the first 12 non-empty lines; accept the first
 * that looks like a company name (1–4 words, title-case, no sentence words,
 * no URL/email chars, not a stopword).
 */
function extractTitleSlideCandidate(page: DpuPage): string | null {
	const lines = page.text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length >= 3 && l.length <= 50);

	for (const line of lines.slice(0, 12)) {
		// Skip lines that look like sentences (contain function words)
		if (/\b(?:is|are|and|the|for|in|on|at|to|of|with|will|we|our)\b/i.test(line)) continue;
		// Skip lines with URL/email characters
		if (/[@/:]/.test(line)) continue;
		// Skip lines containing digits (dates, years, version numbers)
		if (/\d/.test(line)) continue;
		if (/\.\w{2,4}$/.test(line)) continue; // ends in extension-like pattern
		// Skip all-caps lines that look like labels ("CONFIDENTIAL", "DECK 2025")
		if (/^[A-Z][A-Z\s]{3,}$/.test(line) && line.split(" ").length <= 3) continue;

		const words = line.split(/\s+/).filter(Boolean);
		// Must be 1–4 words, start with uppercase
		if (words.length < 1 || words.length > 4) continue;
		if (!/^[A-Z]/.test(line)) continue;

		const firstWord = words[0] ?? "";
		if (STOPWORDS.has(firstWord)) continue;

		// Looks like a plausible company name heading
		return line;
	}
	return null;
}

// ─── Domain corroboration ─────────────────────────────────────────────────────

/**
 * Collect all domain stem tokens extracted from emails and URLs across all pages.
 * Returns a map from normalised domain token → set of page indices.
 */
function collectDomainTokens(pages: DpuPage[]): Map<string, Set<number>> {
	const domainMap = new Map<string, Set<number>>();

	function addToken(tok: string, pageIndex: number): void {
		const lower = tok.toLowerCase();
		if (lower.length < 3) return;
		// Skip generic platform domains
		if (["gmail", "yahoo", "hotmail", "outlook", "proton", "icloud", "google",
			"linkedin", "twitter", "facebook", "crunchbase", "youtube"].includes(lower)) return;
		const s = domainMap.get(lower) ?? new Set<number>();
		s.add(pageIndex);
		domainMap.set(lower, s);
	}

	for (const page of pages) {
		const text = page.text ?? "";

		// Reset lastIndex before reuse
		EMAIL_DOMAIN_RE.lastIndex = 0;
		URL_DOMAIN_RE.lastIndex = 0;

		let m: RegExpExecArray | null;
		while ((m = EMAIL_DOMAIN_RE.exec(text)) !== null) {
			if (m[1]) addToken(m[1], page.page_index);
		}
		while ((m = URL_DOMAIN_RE.exec(text)) !== null) {
			if (m[1]) addToken(m[1], page.page_index);
		}
	}
	return domainMap;
}

// ─── Repeated brand tokens ────────────────────────────────────────────────────

/**
 * Find brand tokens appearing on ≥ 3 distinct pages.
 * Returns a map from raw token → set of page indices.
 */
function collectRepeatedBrandTokens(pages: DpuPage[]): Map<string, Set<number>> {
	const freq = new Map<string, Set<number>>();

	for (const page of pages) {
		const text = page.text ?? "";
		const seenOnPage = new Set<string>();

		// Reset lastIndex
		BRAND_TOKEN_RE.lastIndex = 0;

		let m: RegExpExecArray | null;
		while ((m = BRAND_TOKEN_RE.exec(text)) !== null) {
			const tok = m[1]!;
			if (STOPWORDS.has(tok)) continue;
			if (tok.length < 4) continue;
			if (!seenOnPage.has(tok)) {
				seenOnPage.add(tok);
				const s = freq.get(tok) ?? new Set<number>();
				s.add(page.page_index);
				freq.set(tok, s);
			}
		}
	}

	// Keep only tokens appearing on 3+ distinct pages
	const result = new Map<string, Set<number>>();
	for (const [tok, pageSet] of freq) {
		if (pageSet.size >= 3) result.set(tok, pageSet);
	}
	return result;
}

// ─── Candidate accumulator helpers ───────────────────────────────────────────

function upsertCandidate(
	acc: Map<string, CandidateAcc>,
	name: string,
	source: CanonicalIdentitySource,
	pageIndices: number[]
): void {
	const normalized = normalizeCompanyName(name).toLowerCase();
	if (!normalized || normalized.length < 2) return;

	const existing = acc.get(normalized);
	if (existing) {
		existing.sources.add(source);
		for (const idx of pageIndices) existing.page_indices.add(idx);
		// Prefer shorter, cleaner display names (first one extracted usually cleaner)
	} else {
		acc.set(normalized, {
			name: name.trim(),
			normalized,
			sources: new Set([source]),
			page_indices: new Set(pageIndices),
		});
	}
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the canonical company identity from DPU pages.
 *
 * @param pages       DPU pages extracted from uploaded documents
 * @param dealName    User-entered deal name (never overwritten; used as fallback)
 * @param filenames   Optional: stems/titles of uploaded document filenames
 */
export function resolveCanonicalIdentity(
	pages: DpuPage[],
	dealName: string,
	filenames?: string[] | null
): CanonicalIdentityResult {
	const acc = new Map<string, CandidateAcc>();

	// ── Signal 1: Title slide ─────────────────────────────────────────────────
	const titlePage = pages.find((p) => p.page_index === 0);
	if (titlePage) {
		const titleCandidate = extractTitleSlideCandidate(titlePage);
		if (titleCandidate) {
			upsertCandidate(acc, titleCandidate, "title_slide", [0]);
		}
	}

	// ── Signal 2: About / Company / Introducing slides ────────────────────────
	for (const page of pages) {
		const text = page.text ?? "";

		const mLabel = LABEL_RE.exec(text);
		if (mLabel?.[1]) {
			const name = mLabel[1].trim().replace(/\s{2,}/g, " ").slice(0, 60);
			if (!STOPWORDS.has(name.split(" ")[0] ?? "")) {
				upsertCandidate(acc, name, "about_slide", [page.page_index]);
			}
		}

		// "X is a..." pattern (first 5 pages only — avoids false positives in body text)
		if (page.page_index < 5) {
			const mIsA = IS_A_RE.exec(text);
			if (mIsA?.[1]) {
				const name = mIsA[1].trim().slice(0, 60);
				if (!STOPWORDS.has(name)) {
					upsertCandidate(acc, name, "about_slide", [page.page_index]);
				}
			}
		}
	}

	// ── Signal 3: Domain / email corroboration ────────────────────────────────
	const domainTokens = collectDomainTokens(pages);
	for (const [domTok, pageSet] of domainTokens) {
		// Check if this domain token matches an existing candidate (fuzzy match ≥ 0.75)
		let matched = false;
		for (const [normKey, candidate] of acc) {
			const sim = levenshteinRatio(domTok, normKey);
			if (sim >= 0.75) {
				candidate.sources.add("domain_email");
				for (const idx of pageSet) candidate.page_indices.add(idx);
				matched = true;
				break;
			}
		}
		if (!matched) {
			// Register domain token as a standalone candidate
			// Capitalise the first letter for display
			const display = domTok.charAt(0).toUpperCase() + domTok.slice(1);
			upsertCandidate(acc, display, "domain_email", Array.from(pageSet));
		}
	}

	// ── Signal 4: Repeated brand tokens ──────────────────────────────────────
	const repeatedTokens = collectRepeatedBrandTokens(pages);
	for (const [tok, pageSet] of repeatedTokens) {
		// Check if token normalizes to an existing candidate
		const normTok = normalizeCompanyName(tok).toLowerCase();
		if (acc.has(normTok)) {
			const existing = acc.get(normTok)!;
			existing.sources.add("repeated_token");
			for (const idx of pageSet) existing.page_indices.add(idx);
		} else {
			upsertCandidate(acc, tok, "repeated_token", Array.from(pageSet));
		}
	}

	// ── Signal 5: Filenames ───────────────────────────────────────────────────
	if (filenames && filenames.length > 0) {
		for (const filename of filenames) {
			// Strip extension and transform underscores/hyphens to spaces
			const stem = filename
				.replace(/\.[a-zA-Z0-9]{2,5}$/, "")
				.replace(/[_\-]+/g, " ")
				.trim();
			if (stem.length >= 3 && /[A-Z]/.test(stem)) {
				const candidate = normalizeCompanyName(stem);
				if (candidate && !STOPWORDS.has(candidate.split(" ")[0] ?? "")) {
					upsertCandidate(acc, candidate, "filename", []);
				}
			}
		}
	}

	// ── Select winner ─────────────────────────────────────────────────────────
	let bestKey: string | null = null;
	let bestRank = -Infinity;

	for (const [key, candidate] of acc) {
		const rank = rankCandidate(candidate);
		if (rank > bestRank) {
			bestRank = rank;
			bestKey = key;
		}
	}

	// Build the CanonicalIdentityCandidate list (sorted by rank desc)
	const allCandidates: CanonicalIdentityCandidate[] = Array.from(acc.values())
		.map((c) => ({
			name: c.name,
			normalized: c.normalized,
			score: rankCandidate(c),
			sources: Array.from(c.sources) as CanonicalIdentitySource[],
			page_indices: Array.from(c.page_indices).sort((a, b) => a - b),
		}))
		.sort((a, b) => b.score - a.score);

	// ── Fallback to entered name when no document evidence ────────────────────
	if (bestKey === null || allCandidates.length === 0) {
		const normEntered = normalizeCompanyName(dealName);
		const fallbackCandidate: CanonicalIdentityCandidate = {
			name: dealName,
			normalized: normEntered.toLowerCase(),
			score: 0,
			sources: ["entered_name"],
			page_indices: [],
		};
		return {
			entered_deal_name: dealName,
			canonical_company_name: dealName,
			canonical_company_name_confidence: "none",
			canonical_name_source: "entered_name",
			mismatch_flagged: false,
			identity_evidence: `No document evidence found. Falling back to entered deal name "${dealName}".`,
			winning_candidate: fallbackCandidate,
			rejected_candidates: [],
		};
	}

	const winnerAcc = acc.get(bestKey)!;
	const winnerCandidate = allCandidates[0]!;
	const rejectedCandidates = allCandidates.slice(1);

	const confidence = computeConfidence(winnerAcc.sources);
	const primary = primarySource(winnerAcc.sources);

	// ── Mismatch detection ────────────────────────────────────────────────────
	// Flag when the normalised entered name differs from the canonical name
	// (any difference at medium/high confidence indicates possible typo or alias).
	const normEntered = normalizeCompanyName(dealName).toLowerCase();
	const normWinner = winnerAcc.normalized;
	const mismatch_flagged =
		(confidence === "high" || confidence === "medium") &&
		normEntered !== normWinner;

	const evidence = buildEvidenceString(winnerAcc, confidence, dealName);

	return {
		entered_deal_name: dealName,
		canonical_company_name: winnerAcc.name,
		canonical_company_name_confidence: confidence,
		canonical_name_source: primary,
		mismatch_flagged,
		identity_evidence: evidence,
		winning_candidate: winnerCandidate,
		rejected_candidates: rejectedCandidates,
	};
}

// ─── Render section builder ───────────────────────────────────────────────────

/**
 * Build a render-package section from a CanonicalIdentityResult.
 *
 * Returns null when confidence is "none" (no document evidence — nothing worth
 * surfacing to the UI).  The section is kind: "message" so existing renderers
 * can display it without schema changes.
 */
export function buildCanonicalIdentityRenderSection(
	result: CanonicalIdentityResult
): {
	key: string;
	title: string;
	kind: "message";
	body: string;
	fallback: string;
} | null {
	if (result.canonical_company_name_confidence === "none") return null;

	const lines: string[] = [
		`**Entered deal name:** ${result.entered_deal_name}`,
		`**Canonical company name:** ${result.canonical_company_name}`,
		`**Confidence:** ${result.canonical_company_name_confidence}`,
		`**Primary source:** ${result.canonical_name_source}`,
		`**Mismatch flagged:** ${result.mismatch_flagged ? "yes" : "no"}`,
		``,
		result.identity_evidence,
	];

	if (result.rejected_candidates.length > 0) {
		lines.push(``, `**Other candidates considered:**`);
		for (const c of result.rejected_candidates.slice(0, 5)) {
			lines.push(`- "${c.name}" (sources: ${c.sources.join(", ")})`);
		}
	}

	return {
		key: "canonical_identity_v1",
		title: "Deal Identity Resolution",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Deal identity resolution not available.",
	};
}
