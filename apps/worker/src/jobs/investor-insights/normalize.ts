/**
 * Deterministic OCR normalization for investor-insights extraction.
 *
 * All transformations are:
 *   - Token-level and context-gated (never blanket string replaces)
 *   - Fully auditable via NormalizationEvent[]
 *   - Single-pass per rule (no quadratic loops)
 *   - Deterministic: same input always produces same output
 *
 * Rule catalogue
 *   A. money_symbol_S_to_$      – S before digits (OCR $ → S confusion)
 *   B. range_dash_fix           – collapse spaces around dash between money tokens
 *   C. magnitude_double_to_single – 1.5MM → 1.5M, 10BB → 10B
 *   D. magnitude_word_to_letter – "$4 million" → "$4M" in money context
 *   E. ocr_digit_confusion      – O→0, l/I→1 inside money digit spans
 *   F. whitespace_inside_money  – "$ 4 M" → "$4M", "€ 5 . 6 M" → "€5.6M"
 */

export type NormalizationEvent = {
	rule: string;
	before: string;
	after: string;
	/** Up to ±30 chars of surrounding text at the point of the change. */
	context: string;
};

export type NormalizedText = {
	text: string;
	events: NormalizationEvent[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function contextSnippet(src: string, offset: number, matchLen: number): string {
	const start = Math.max(0, offset - 30);
	const end = Math.min(src.length, offset + matchLen + 30);
	return src.slice(start, end);
}

/**
 * Apply a single regex rule to `text` with an event-recording replacer.
 * The `replacer` receives (fullMatch, ...captureGroups) and returns the replacement.
 * An event is recorded only when replacement !== match.
 */
function applyRule(
	text: string,
	pattern: RegExp,
	events: NormalizationEvent[],
	ruleName: string,
	replacer: (match: string, ...args: unknown[]) => string
): string {
	// Clone the regex so lastIndex resets correctly even if caller reuses it.
	const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
	return text.replace(re, (match, ...args) => {
		// args = [group1, group2, ..., offset, originalString, namedGroups?]
		const offset = args[args.length - 2] as number;
		const src = args[args.length - 1] as string;
		const replacement = replacer(match, ...args.slice(0, -2));
		if (replacement !== match) {
			events.push({
				rule: ruleName,
				before: match,
				after: replacement,
				context: contextSnippet(src, offset, match.length),
			});
		}
		return replacement;
	});
}

// ── Currency symbol shared fragment ──────────────────────────────────────────

const CUR = String.raw`(?:[€$£]|\bUSD\b|\bEUR\b|\bGBP\b)`;

// ── Rule A: S → $ in money context ───────────────────────────────────────────
// Matches a standalone S (at a word boundary) immediately or with a small space
// before digits. Does NOT match when S is part of a word (e.g. "Sales", "Series").
//
// Pattern: \bS followed by lookahead: optional whitespace, then digit(s) with
// optional decimal and optional magnitude suffix at word boundary.
//
// Examples that MUST match:   S4M  S2.5MM  S 4M  S4   S800,000
// Examples that MUST NOT match: Sales  Series  SAM  SOM  SAFE

const RULE_A_PATTERN = /\bS(?=\s*\d[\d,.]*(?:\.\d+)?(?:\s*(?:MM|BB|[KMBTkmbt]|million|billion|thousand|trillion))?\b)/g;

// ── Rule B: range dash fix ────────────────────────────────────────────────────
// Collapse whitespace around a dash separating two money tokens.
// Handles: "$2M - $4M" → "$2M-$4M", "$2M – $4M" → "$2M-$4M"

const RULE_B_PATTERN = /((?:[€$£]|\bUSD\b|\bEUR\b|\bGBP\b)\s*[\d,.]+(?:\.\d+)?(?:\s*(?:MM|BB|[KMBTkmbt]))?)\s+[-–—]\s+((?:[€$£]|\bUSD\b|\bEUR\b|\bGBP\b)\s*[\d,.]+)/g;

// ── Rule C: double magnitude → single (1.5MM → 1.5M, 10BB → 10B) ─────────────
// Only when the double-letter suffix directly follows a digit.

const RULE_C_MM_PATTERN = /(\d)(MM)\b/gi;
const RULE_C_BB_PATTERN = /(\d)(BB)\b/gi;

// ── Rule D: word magnitudes → letter in money context ────────────────────────
// "$4 million" → "$4M", "€5.6 billion" → "€5.6B"
// Context: must be preceded by a currency+digit token.

const RULE_D_PATTERN = /((?:[€$£]|\bUSD\b|\bEUR\b|\bGBP\b)\s*\d[\d,.]*(?:\.\d+)?)\s+(million|billion|thousand|trillion)\b/gi;

const WORD_TO_LETTER: Record<string, string> = {
	million: "M", billion: "B", thousand: "K", trillion: "T",
};

// ── Rule E: OCR digit-letter confusions inside money digit spans ──────────────
// Only replaces O→0, l→1, I→1 in the digit portion of a money token.
// Pattern: currency prefix, then a digit-like span containing at least one real digit.
// We scan the numeric part and fix character by character.

const RULE_E_PATTERN = /((?:[€$£])\s*)([OIl\d][OIl\d,.\s]*)/g;

function fixOcrDigits(numSpan: string): string {
	// Only apply when there's at least one real digit already in the span.
	if (!/\d/.test(numSpan)) return numSpan;
	return numSpan.replace(/O/g, "0").replace(/[lI]/g, "1");
}

// ── Rule F: whitespace inside money token ────────────────────────────────────
// "$ 4 M" → "$4M",  "€ 5 . 6 M" → "€5.6M"
// Pattern: currency followed by spaces interspersed with digits/decimal/commas/magnitude.

const RULE_F_PATTERN = /([€$£])\s+(\d[\d,.\s]*(?:MM|BB|[KMBTkmbt])?)\b/g;

function collapseMoneyWhitespace(digitPart: string): string {
	// Remove spaces everywhere inside the numeric portion.
	return digitPart.replace(/\s+/g, "");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Apply all normalization rules to `raw` and return normalized text + audit log.
 * Rules are applied in order A → F; each rule sees the output of the previous.
 */
export function normalizeForExtraction(raw: string): NormalizedText {
	const events: NormalizationEvent[] = [];
	let text = raw;

	// Rule A: S → $ in money context
	text = applyRule(text, RULE_A_PATTERN, events, "money_symbol_S_to_$",
		(match) => match.replace(/^S/, "$"),
	);

	// Rule B: collapse spaces around dash in money ranges
	text = applyRule(text, RULE_B_PATTERN, events, "range_dash_fix",
		(_match, a, b) => `${a as string}-${b as string}`,
	);

	// Rule C-1: MM → M after digit
	text = applyRule(text, RULE_C_MM_PATTERN, events, "magnitude_mm_to_m",
		(_match, digit) => `${digit as string}M`,
	);

	// Rule C-2: BB → B after digit
	text = applyRule(text, RULE_C_BB_PATTERN, events, "magnitude_bb_to_b",
		(_match, digit) => `${digit as string}B`,
	);

	// Rule D: word magnitudes in money context
	text = applyRule(text, RULE_D_PATTERN, events, "magnitude_word_to_letter",
		(_match, curDigit, word) => {
			const letter = WORD_TO_LETTER[(word as string).toLowerCase()] ?? (word as string);
			return `${curDigit as string}${letter}`;
		},
	);

	// Rule E: OCR digit confusions (O→0, l/I→1) inside money digit spans
	text = applyRule(text, RULE_E_PATTERN, events, "ocr_digit_confusion",
		(_match, curPrefix, numSpan) => {
			const fixed = fixOcrDigits(numSpan as string);
			return `${curPrefix as string}${fixed}`;
		},
	);

	// Rule F: whitespace inside money tokens
	text = applyRule(text, RULE_F_PATTERN, events, "whitespace_inside_money",
		(_match, cur, digitPart) => {
			const collapsed = collapseMoneyWhitespace(digitPart as string);
			return `${cur as string}${collapsed}`;
		},
	);

	return { text, events };
}
