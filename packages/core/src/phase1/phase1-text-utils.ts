import { createHash } from "crypto";

export function stableId(prefix: string, text: string): string {
	const norm = text.trim().toLowerCase();
	const hash = createHash("sha256").update(norm).digest("hex").slice(0, 12);
	return `${prefix}_${hash}`;
}

export function safeString(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function uniqStrings(values: string[]): string[] {
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

export function normalizeConfidenceToNumber(confidence: unknown): number | null {
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

export function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function capsTokenRatio(value: string): number {
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

export function capOneLiner(value: string, maxChars: number): string {
	const s = sanitizeInlineText(value);
	if (s.length <= maxChars) return s;
	const cut = s.slice(0, maxChars - 1);
	const lastSpace = cut.lastIndexOf(" ");
	const trimmed = (lastSpace >= Math.floor(maxChars * 0.6) ? cut.slice(0, lastSpace) : cut).trim();
	return `${trimmed}…`;
}

export function normalizeOverviewSentence(value: string, maxChars: number): string {
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

export function normalizeForMatch(value: string): string {
	return safeString(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
