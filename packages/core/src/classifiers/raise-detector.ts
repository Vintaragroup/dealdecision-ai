const DEFAULT_WINDOW_TOKENS = 20;

type Token = string;

function normalizeInput(text: string): string {
	return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function tokenize(text: string): Token[] {
	// Keep money-ish tokens (e.g. "$2m", "8b") and plain words.
	// This intentionally mirrors API-side tokenization to keep semantics aligned.
	const src = String(text ?? "").toLowerCase();
	return (src.match(/[a-z]+|\$?\d[\d,.]*(?:\.\d+)?(?:k|m|mm|b|bn)?/g) ?? [])
		.map((t) => t.trim())
		.filter(Boolean);
}

export function containsMarketSizingLanguage(text: string): boolean {
	const t = String(text ?? "").toLowerCase();
	return [
		/\b(tam|sam|som)\b/i,
		/\bmarket\s+size\b/i,
		/\btotal\s+addressable\s+market\b/i,
		/\bserviceable\s+addressable\s+market\b/i,
		/\bserviceable\s+obtainable\s+market\b/i,
		/\b(total|serviceable|obtainable)\s+(addressable|available)\s+market\b/i,
		/\baddressable\s+market\b/i,
		/\bmarket\s+opportunit(y|ies)\b/i,
		/\bmarket\s*(?:is|=)\s*\$\s*\d[\d,.]*(?:\.\d+)?\s*(?:k|m|mm|b|bn|million|billion)\b/i,
		/\b\$\s*\d[\d,.]*(?:\.\d+)?\s*(?:b|bn|billion|m|mm|million)\s+market\b/i,
		/\b(?:billion|million)\s+market\b/i,
	].some((re) => re.test(t));
}

function isMoneyLikeToken(tok: string, prev: string | null, next: string | null): boolean {
	if (!tok) return false;
	if (/\$\d/.test(tok)) return true;
	if (/^\d[\d,.]*(?:\.\d+)?(?:k|m|mm|b|bn)$/i.test(tok)) {
		// Guard: abbreviations like "B2B", "B2C", "G2G" tokenize as a single-letter token
		// followed by a digit+suffix token (e.g. ["b", "2b"]). A bare single-letter token
		// immediately before signals an alphanumeric abbreviation, not a monetary amount.
		if (prev !== null && /^[a-z]$/i.test(prev)) return false;
		return true;
	}

	// Handle "2 million" / "8 billion".
	if ((tok === "million" || tok === "billion") && prev && /^\d[\d,.]*(?:\.\d+)?$/i.test(prev)) return true;
	if (/^\d[\d,.]*(?:\.\d+)?$/i.test(tok) && next && (next === "million" || next === "billion")) return true;

	return false;
}

function isMarketSizingContextNear(tokens: Token[], moneyIndex: number): boolean {
	const near: string[] = [];
	for (let d = -2; d <= 2; d += 1) {
		if (d === 0) continue;
		const j = moneyIndex + d;
		if (j >= 0 && j < tokens.length) near.push(tokens[j]);
	}
	return near.some((t) =>
		t === "tam" ||
		t === "sam" ||
		t === "som" ||
		t === "market" ||
		t === "opportunity" ||
		t === "addressable" ||
		t === "size"
	);
}

function hasAnchorToken(tokens: Token[]): number[] {
	const anchorIdx: number[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const t = tokens[i];
		if (t === "raising" || t === "raise" || t === "seeking" || t === "seek" || t === "safe" || t === "convertible" || t === "equity") {
			// Guard: "raise" / "raising" must not appear in a historical/portfolio context.
			// "helped companies raise $2B" describes an advisor's track record, not the
			// company's own fundraising ask. Check the 6-token window before the anchor.
			if (t === "raise" || t === "raising") {
				const lookback = tokens.slice(Math.max(0, i - 6), i);
				if (lookback.some((x) => x === "helped" || x === "help" || x === "helps" || x === "helping")) {
					continue;
				}
			}
			anchorIdx.push(i);
			continue;
		}

		// Phrase anchors.
		if (t === "ask" && tokens[i - 1] === "the") {
			anchorIdx.push(i);
			continue;
		}
		if (t === "raising" && tokens[i - 1] === "are" && tokens[i - 2] === "we") {
			anchorIdx.push(i);
			continue;
		}
	}
	return anchorIdx;
}

export function hasRaiseAskLanguageWithNearbyAmount(text: string, windowTokens: number = DEFAULT_WINDOW_TOKENS): boolean {
	const window = Number.isFinite(windowTokens) ? Math.max(1, Math.floor(windowTokens)) : DEFAULT_WINDOW_TOKENS;
	const combined = normalizeInput(text);
	if (!combined) return false;

	const tokens = tokenize(combined);
	if (tokens.length === 0) return false;

	const anchorIdx = hasAnchorToken(tokens);
	if (anchorIdx.length === 0) return false;

	const moneyIdxAll: number[] = [];
	const moneyIdxNonMarket: number[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const prev = i > 0 ? tokens[i - 1] : null;
		const next = i + 1 < tokens.length ? tokens[i + 1] : null;
		if (!isMoneyLikeToken(tokens[i], prev, next)) continue;
		moneyIdxAll.push(i);
		if (!isMarketSizingContextNear(tokens, i)) moneyIdxNonMarket.push(i);
	}
	if (moneyIdxAll.length === 0) return false;

	// Require proximity to a money token that is not just market-sizing context.
	return anchorIdx.some((a) => moneyIdxNonMarket.some((m) => Math.abs(a - m) <= window));
}

export function inferIsRaiseAskSlide(text: string): boolean {
	const combined = normalizeInput(text);
	if (!combined) return false;

	// Primary rule: explicit ask/instrument anchor + nearby amount.
	// Market sizing language must not cause false positives by itself.
	return hasRaiseAskLanguageWithNearbyAmount(combined, DEFAULT_WINDOW_TOKENS);
}
