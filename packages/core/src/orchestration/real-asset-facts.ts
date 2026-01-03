import { createHash } from "crypto";
import type { EvidenceSnapshot, FactRow } from "../types/dio";

type AnyDoc = any;

type BuildFactsParams = {
	documents: AnyDoc[];
	analysis_cycle: number;
	now_iso: string;
};

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

// Deterministic UUID-like string derived from a seed.
// Not a true RFC4122 v5 UUID, but stable and well-formed for our schema needs.
function stableUuid(seed: string): string {
	const hex = sha256Hex(seed).slice(0, 32);
	// Inject version/variant bits to look like a v4 UUID.
	const a = hex.slice(0, 8);
	const b = hex.slice(8, 12);
	const c = `4${hex.slice(13, 16)}`;
	const dNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	const d = `${dNibble}${hex.slice(17, 20)}`;
	const e = hex.slice(20, 32);
	return `${a}-${b}-${c}-${d}-${e}`;
}

function normalize(text: string): string {
	return (text || "").toLowerCase();
}

function getDocText(doc: AnyDoc): string {
	const candidates: unknown[] = [
		doc?.full_text,
		doc?.fullText,
		doc?.text_summary,
		doc?.textSummary,
		doc?.summary,
		doc?.structuredData?.textSummary,
		doc?.structured_data?.textSummary,
		doc?.structuredData?.summary,
		doc?.structured_data?.summary,
		doc?.text,
	];
	for (const v of candidates) {
		if (typeof v === "string") {
			const s = v.trim();
			if (s.length > 0) return s;
		}
	}
	return "";
}

function getDocId(doc: AnyDoc, idx: number): string {
	const id =
		(typeof doc?.document_id === "string" && doc.document_id) ||
		(typeof doc?.id === "string" && doc.id) ||
		(typeof doc?.__stable_doc_id === "string" && doc.__stable_doc_id) ||
		"";
	return id || stableUuid(`doc:${idx}:${String(doc?.title ?? doc?.filename ?? "")}`);
}

function getDocTitle(doc: AnyDoc): string {
	return (
		(typeof doc?.title === "string" && doc.title) ||
		(typeof doc?.filename === "string" && doc.filename) ||
		(typeof doc?.fileName === "string" && doc.fileName) ||
		"Document"
	);
}

function snippetAround(text: string, start: number, end: number, window = 90): string {
	const lo = Math.max(0, start - window);
	const hi = Math.min(text.length, end + window);
	const raw = text.slice(lo, hi);
	return raw.replace(/\s+/g, " ").trim();
}

export function detectRealEstatePreferredEquity(text: string): boolean {
	const t = normalize(text);
	const realEstateSignals = ["real estate", "property", "multifamily", "apartment", "noi", "cap rate", "rent roll", "ltv", "dscr"];
	const prefEquitySignals = [
		"preferred equity",
		"pref equity",
		"mezzanine",
		"capital stack",
		"offering memorandum",
		"private placement",
		"subscription agreement",
		"ppm",
	];
	const score = (needles: string[]) => needles.reduce((acc, n) => (t.includes(n) ? acc + 1 : acc), 0);
	return score(realEstateSignals) >= 2 && score(prefEquitySignals) >= 2;
}

export function buildRealAssetFactArtifacts(params: BuildFactsParams): {
	appended_evidence: EvidenceSnapshot[];
	fact_table: FactRow[];
} {
	const { documents, analysis_cycle, now_iso } = params;

	const docs = Array.isArray(documents) ? documents : [];
	const primaryIdx = docs.findIndex((d) => typeof getDocText(d) === "string" && getDocText(d).length > 0);
	const idx = primaryIdx >= 0 ? primaryIdx : 0;
	const doc = docs[idx];
	const docText = getDocText(doc);

	if (!doc || !docText) {
		return { appended_evidence: [], fact_table: [] };
	}

	if (!detectRealEstatePreferredEquity(docText)) {
		return { appended_evidence: [], fact_table: [] };
	}

	const docId = getDocId(doc, idx);
	const docTitle = getDocTitle(doc);

	type Candidate = {
		key: string;
		claim: (m: RegExpMatchArray) => string;
		confidence: number;
		re: RegExp;
	};

	const candidates: Candidate[] = [
		{
			key: "structure_preferred_equity",
			re: /(preferred\s+equity)/i,
			confidence: 0.85,
			claim: () => "Deal structure includes preferred equity",
		},
		{
			key: "doc_offering_memo",
			re: /(offering\s+memorandum|private\s+placement\s+memorandum|\bppm\b)/i,
			confidence: 0.8,
			claim: (m) => `Document type: ${m[0]}`,
		},
		{
			key: "ltv",
			re: /\bLTV\b[^\d]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i,
			confidence: 0.85,
			claim: (m) => `Loan-to-value (LTV): ${m[1]}%`,
		},
		{
			key: "dscr",
			re: /\bDSCR\b[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:x|\b)/i,
			confidence: 0.8,
			claim: (m) => `Debt service coverage ratio (DSCR): ${m[1]}x`,
		},
		{
			key: "cap_rate",
			re: /(cap\s*rate)\b[^\d]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i,
			confidence: 0.8,
			claim: (m) => `Cap rate: ${m[2]}%`,
		},
		{
			key: "noi",
			re: /\bNOI\b[^\d\$]{0,12}\$?([\d,]+(?:\.\d+)?)/i,
			confidence: 0.75,
			claim: (m) => `Net Operating Income (NOI): $${m[1]}`,
		},
		{
			key: "target_irr",
			re: /(target\s+irr|\birr\b)\b[^\d]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i,
			confidence: 0.8,
			claim: (m) => `Target IRR: ${m[2]}%`,
		},
		{
			key: "target_multiple",
			re: /(moic|multiple)\b[^\d]{0,12}(\d+(?:\.\d+)?)\s*x/i,
			confidence: 0.75,
			claim: (m) => `Target multiple: ${m[2]}x`,
		},
		{
			key: "term",
			re: /\bterm\b[^\d]{0,12}(\d{1,3})\s*(months|month|years|year)\b/i,
			confidence: 0.7,
			claim: (m) => `Term: ${m[1]} ${m[2]}`,
		},
	];

	const appended_evidence: EvidenceSnapshot[] = [];
	const fact_table: FactRow[] = [];

	const seenKeys = new Set<string>();

	const addFactFromMatch = (key: string, match: RegExpMatchArray, confidence: number) => {
		if (seenKeys.has(key)) return;
		seenKeys.add(key);

		const start = match.index ?? 0;
		const end = start + match[0].length;
		const snippet = snippetAround(docText, start, end);

		const evidence_id = stableUuid(`evidence:${docId}:${key}:${snippet}`);
		appended_evidence.push({
			evidence_id,
			source: "extraction",
			kind: "fact_extracted",
			text: snippet,
			confidence,
			created_at: now_iso,
		} as EvidenceSnapshot);

		const rawClaim = `${candidates.find((c) => c.key === key)?.claim(match) ?? match[0]} (source: ${docTitle})`;
		const claim = rawClaim.length > 200 ? rawClaim.slice(0, 197) + "…" : rawClaim;
		const id = stableUuid(`fact:${docId}:${key}:${claim}`);
		fact_table.push({
			id,
			claim,
			source: `doc:${docId}`,
			page: "n/a",
			confidence,
			created_cycle: analysis_cycle,
			created_at: now_iso,
			evidence_id,
		} as FactRow);
	};

	for (const c of candidates) {
		const m = docText.match(c.re);
		if (!m) continue;
		addFactFromMatch(c.key, m, c.confidence);
	}

	// If we still don't have enough coverage, add keyword-backed facts from deterministic snippets.
	const fallbackKeywords: Array<{ key: string; needle: RegExp; claim: string; confidence: number }> = [
		{ key: "asset_is_real_estate", needle: /real\s+estate|\bproperty\b/i, claim: "Offering relates to a real estate property investment", confidence: 0.7 },
		{ key: "mentions_capital_stack", needle: /capital\s+stack/i, claim: "Document discusses the capital stack", confidence: 0.65 },
		{ key: "mentions_sponsor", needle: /\bsponsor\b|\bborrower\b/i, claim: "Document references a sponsor/borrower", confidence: 0.65 },
		{ key: "mentions_rent_roll", needle: /rent\s+roll/i, claim: "Document references a rent roll", confidence: 0.65 },
	];

	for (const fb of fallbackKeywords) {
		if (fact_table.length >= 8) break;
		const m = docText.match(fb.needle);
		if (!m) continue;
		addFactFromMatch(fb.key, m, fb.confidence);
	}

	return { appended_evidence, fact_table };
}
