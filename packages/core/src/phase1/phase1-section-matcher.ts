import { normalizeForMatch, sanitizeInlineText, safeString } from "./phase1-text-utils";

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function headingMatches(line: string, needles: string[]): boolean {
	const norm = normalizeForMatch(line);
	if (!norm) return false;
	for (const n of needles) {
		const needle = normalizeForMatch(n);
		if (!needle) continue;
		if (norm.includes(needle)) return true;
	}
	return false;
}

export function isProbableHeading(line: string): boolean {
	const s = sanitizeInlineText(line);
	if (!s) return false;
	if (s.length > 72) return false;
	if (/:$/.test(s)) return true;
	const lettersOnly = s.replace(/[^A-Za-z]/g, "");
	if (lettersOnly.length >= 6 && lettersOnly === lettersOnly.toUpperCase()) return true;
	return false;
}

export function splitDeckLines(text: string): string[] {
	return safeString(text)
		.split(/\r\n|\n|\r/g)
		.map((l) => sanitizeInlineText(l))
		.filter(Boolean);
}
