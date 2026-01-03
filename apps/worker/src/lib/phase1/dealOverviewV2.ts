type OverviewSource = {
	document_id: string;
	page_range?: [number, number];
	note?: string;
};

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export type Phase1DealUnderstandingV1 = {
	deal_name?: string;
	product_solution?: string | null;
	market_icp?: string | null;
	deal_type?: string;
	raise?: string;
	business_model?: string;
	traction_signals?: string[];
	key_risks_detected?: string[];
	generated_at?: string;
	confidence: {
		product_solution: FieldConfidence;
		market_icp: FieldConfidence;
		deal_type: FieldConfidence;
		raise: FieldConfidence;
		business_model: FieldConfidence;
		traction_signals: FieldConfidence;
		key_risks_detected: FieldConfidence;
	};
	sources?: {
		product_solution?: Array<OverviewSource & { text_head?: string }>;
		market_icp?: Array<OverviewSource & { text_head?: string }>;
		raise?: Array<OverviewSource & { text_head?: string }>;
		business_model?: Array<OverviewSource & { text_head?: string }>;
		traction_signals?: Array<OverviewSource & { text_head?: string }>;
		key_risks_detected?: Array<OverviewSource & { text_head?: string }>;
	};
};

export type Phase1DealOverviewV2 = {
	deal_name?: string;
	product_solution?: string | null;
	market_icp?: string | null;
	deal_type?: string;
	raise?: string;
	business_model?: string;
	traction_signals?: string[];
	key_risks_detected?: string[];
	generated_at?: string;
	sources?: OverviewSource[];
};

export type Phase1UpdateReportV1 = {
	generated_at: string;
	previous_dio_found: boolean;
	since_dio_id?: string;
	since_version?: number;
	docs_fingerprint?: string;
	previous_docs_fingerprint?: string;
	changes: Array<{
		field: string;
		change_type: 'added' | 'updated' | 'removed';
		category?:
			| 'field_populated'
			| 'field_lost'
			| 'field_updated'
			| 'coverage_changed'
			| 'decision_changed'
			| 'confidence_changed'
			| 'docs_changed';
		before?: string;
		after?: string;
	}>;
	summary: string;
};

export type OverviewDocumentInput = {
	document_id: string;
	title?: string | null;
	type?: string | null;
	full_text?: string | null;
	full_content?: unknown | null;
};

function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function looksLikeSpacedLogoArtifact(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;

	// Common OCR/logo artifact: single-letter tokens spaced out (e.g., "D R O P A B L E S").
	const tokens = s.split(/\s+/).filter(Boolean);
	if (tokens.length < 6) return false;

	let singleLetter = 0;
	let consecutiveSingleLetter = 0;
	let maxConsecutive = 0;
	for (const t of tokens) {
		const cleaned = t.replace(/[^A-Za-z]/g, '');
		const isSingle = cleaned.length === 1;
		if (isSingle) {
			singleLetter += 1;
			consecutiveSingleLetter += 1;
			maxConsecutive = Math.max(maxConsecutive, consecutiveSingleLetter);
		} else {
			consecutiveSingleLetter = 0;
		}
	}

	// Strong indicator: long run of spaced letters.
	if (maxConsecutive >= 4) return true;

	// Weaker indicator: many single-letter tokens + very uppercase.
	const singleLetterRatio = tokens.length > 0 ? singleLetter / tokens.length : 0;
	if (singleLetter >= 6 && singleLetterRatio >= 0.5 && uppercaseRatio(s) >= 0.8) return true;

	return false;
}

function isHighQualityCandidate(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (s.length < 18) return false;
	if (s.length > 260) return false;
	if (looksLikeSpacedLogoArtifact(s)) return false;
	if ((s.match(/\uFFFD|�/g) ?? []).length >= 2) return false;
	if (/[@#%*=^~`|\\]{2,}/.test(s)) return false;
	if (/([!?.,:;])\1{2,}/.test(s)) return false;

	const noSpace = s.replace(/\s+/g, '');
	if (noSpace.length < 14) return false;
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const symbolLike = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
	const letterRatio = letters / noSpace.length;
	const symbolRatio = symbolLike / noSpace.length;
	if (letterRatio < 0.55) return false;
	if (symbolRatio > 0.35) return false;
	return true;
}

function isDevOverviewDebugEnabled(): boolean {
	if (process.env.NODE_ENV === 'production') return false;
	return process.env.DEBUG_PHASE1_OVERVIEW_V2 === '1';
}

function uppercaseRatio(value: string): number {
	const s = sanitizeInlineText(value);
	const letters = (s.match(/[A-Za-z]/g) ?? []).length;
	if (letters <= 0) return 0;
	const upper = (s.match(/[A-Z]/g) ?? []).length;
	return upper / letters;
}

function isAllCapsish(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	// Consider it ALL CAPS if it's mostly uppercase letters.
	return s.length >= 18 && uppercaseRatio(s) >= 0.85;
}

function capSentence(value: string, maxChars: number): string {
	let s = sanitizeInlineText(value);
	if (!s) return '';
	if (!/[.!?]$/.test(s)) s = `${s}.`;
	if (s.length <= maxChars) return s;
	return s.slice(0, maxChars - 1).trimEnd() + '…';
}

function normalizeForHeading(value: string): string {
	return sanitizeInlineText(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function matchesHeading(line: string, needles: string[]): boolean {
	const norm = normalizeForHeading(line);
	if (!norm) return false;
	return needles.some((n) => {
		const nn = normalizeForHeading(n);
		return nn && norm.includes(nn);
	});
}

function splitLines(text: string): string[] {
	return String(text)
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((l) => sanitizeInlineText(l))
		.filter(Boolean);
}

type WordLike = {
	text?: unknown;
	w?: unknown;
	value?: unknown;
	x?: unknown;
	y?: unknown;
	left?: unknown;
	top?: unknown;
};

function extractPageLinesFromWords(wordsUnknown: unknown): string[] {
	const words = Array.isArray(wordsUnknown) ? (wordsUnknown as WordLike[]) : [];
	if (words.length === 0) return [];

	// Group tokens into lines by y-position. We intentionally avoid coarse bucketing
	// (which can merge adjacent lines and scramble word order).
	const lineTolPx = 14;
	type Token = { x: number; y: number; t: string };
	const tokens: Token[] = [];

	for (const w of words) {
		const rawText =
			typeof w?.text === 'string'
				? w.text
				: typeof w?.w === 'string'
					? w.w
					: typeof w?.value === 'string'
						? w.value
						: '';
		const t = sanitizeInlineText(rawText);
		if (!t) continue;

		const xRaw = (w as any)?.x ?? (w as any)?.left;
		const yRaw = (w as any)?.y ?? (w as any)?.top;
		const x = typeof xRaw === 'number' ? xRaw : Number(xRaw);
		const y = typeof yRaw === 'number' ? yRaw : Number(yRaw);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		tokens.push({ x, y, t });
	}

	if (tokens.length === 0) return [];

	// Sort by y then x to ensure deterministic clustering.
	tokens.sort((a, b) => (a.y - b.y) || (a.x - b.x));

	type Line = { y: number; tokens: Token[] };
	const lines: Line[] = [];
	for (const tok of tokens) {
		const last = lines.length > 0 ? lines[lines.length - 1] : null;
		if (!last || Math.abs(tok.y - last.y) > lineTolPx) {
			lines.push({ y: tok.y, tokens: [tok] });
			continue;
		}
		last.tokens.push(tok);
		// Keep a running average y for stability.
		last.y = (last.y * (last.tokens.length - 1) + tok.y) / last.tokens.length;
	}

	const out: string[] = [];
	for (const ln of lines) {
		ln.tokens.sort((a, b) => a.x - b.x);
		let line = ln.tokens.map((t) => t.t).join(' ');
		// Basic typography cleanup.
		line = line
			.replace(/\s+([,.;:!?])/g, '$1')
			.replace(/([([{])\s+/g, '$1')
			.replace(/\s+([)\]}])/g, '$1')
			.replace(/\s+/g, ' ');
		line = sanitizeInlineText(line);
		if (!line) continue;
		out.push(line);
	}

	// Deterministic dedupe of identical adjacent lines.
	const deduped: string[] = [];
	let prev = '';
	for (const l of out) {
		const key = l.toLowerCase();
		if (key && key === prev) continue;
		prev = key;
		deduped.push(l);
	}
	return deduped;
}

const PRODUCT_ANCHOR_HEADINGS = ['overview', 'general overview', 'what we do', 'solution', 'product', 'platform'];
const MARKET_ANCHOR_HEADINGS = ['who we serve', 'customers', 'target', 'icp', 'built for'];

const TAGLINE_VERB_RE = /\b(helps|enable[s]?|automate[s]?|provide[s]?|deliver[s]?|connect[s]?|built\s+for|platform\s+for)\b/i;

const DU_DEFINITION_START_RE = /^\s*we\s+(predict|help|enable|provide|deliver|connect|unify|automate)\b/i;
const DU_PLATFORM_DEFINITION_RE = /\b(platform|solution|product|software|system)\b[^\n\r]{0,80}\b(helps|enable[s]?|provide[s]?|deliver[s]?|connect[s]?|unify|unifies|automate[s]?|predict|predicts)\b/i;
const DU_VERB_ANY_RE = /\b(predict|predicts|help|helps|enable|enables|provide|provides|deliver|delivers|connect|connects|unify|unifies|automate|automates|build|builds|create|creates|reduce|reduces|improve|improves|streamline|streamlines|power|powers)\b/i;

// Higher-priority definition patterns: "<Company> is a …" / "We are a …".
const DU_IS_A_DEFINITION_RE = /\b(?:is|are)\s+(?:a|an|the)\b/i;
const DU_COMPANY_IS_A_START_RE = /^\s*(?:we|[A-Za-z0-9][A-Za-z0-9&.'\-]{1,25})\s+(?:is|are)\s+(?:a|an|the)\b/i;
const DU_BUSINESS_NOUN_RE = /\b(league|platform|marketplace|software|media\s+company|new\s+media|professional\s+ice\s+hockey\s+league|ice\s+hockey\s+league|sports\s+league|company)\b/i;

// Reject obvious sentence fragments / OCR header scraps.
const DU_FRAGMENT_START_RE = /^\s*(is|are|was|were|and|or|to|with|without|by)\b/i;

const MARKET_SIGNAL_RE = /\b(customers?|teams?|operators?|buyers?|users?|companies|businesses|lenders?|borrowers?|brokers?|agents?|clinics?|hospitals?|retailers?|manufacturers?|banks?|insurers?|enterprises?|smb|mid-?market)\b/i;

function isSentenceFragment(value: string): boolean {
  const s = sanitizeInlineText(value);
  if (!s) return true;

	// Spaced-letter/logo OCR fragments should never be treated as valid sentences/ICPs.
	if (looksLikeSpacedLogoArtifact(s)) return true;

  // Starts with a copula/conjunction with no subject.
  if (DU_FRAGMENT_START_RE.test(s)) {
    // Allow if it very clearly specifies a target (e.g., "is for lenders ...").
    if (!/\bfor\b/i.test(s) && !MARKET_SIGNAL_RE.test(s)) return true;
  }

  // Too short and not clearly a target/market statement.
  if (s.length < 32 && !/\bfor\b/i.test(s) && !MARKET_SIGNAL_RE.test(s)) return true;

  // High symbol density usually indicates OCR noise.
  const noSpace = s.replace(/\s+/g, '');
  const symbols = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
  if (noSpace.length > 0 && symbols / noSpace.length > 0.35) return true;

  return false;
}

function inferCompanyHintFromDocTitle(title: string): string {
	const t = sanitizeInlineText(title);
	if (!t) return '';
	// Prefer short uppercase-ish tokens (e.g., "3ICE") from the title.
	const tokens = t.split(/\s+/).filter(Boolean);
	for (const tok of tokens) {
		const cleaned = tok.replace(/[^A-Za-z0-9]/g, '');
		if (!cleaned) continue;
		if (cleaned.length < 2 || cleaned.length > 16) continue;
		if (/^(pd|pitch|deck|presentation|confidential)$/i.test(cleaned)) continue;
		if (uppercaseLetterRatio(cleaned) >= 0.6) return cleaned;
	}
	return '';
}

function looksLikeCoverTagline(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	// Typical marketing tagline: short, no defining verb, no punctuation, not a definition.
	if (s.length > 60) return false;
	const words = s.split(/\s+/).filter(Boolean);
	if (words.length < 3 || words.length > 10) return false;
	if (/[.!?]$/.test(s)) return false;
	if (DU_VERB_ANY_RE.test(s)) return false;
	if (DU_COMPANY_IS_A_START_RE.test(s) || DU_IS_A_DEFINITION_RE.test(s)) return false;
	// Avoid excluding short definitions that clearly name a business noun.
	if (DU_BUSINESS_NOUN_RE.test(s) && DU_IS_A_DEFINITION_RE.test(s)) return false;
	return true;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeRegExpSafe(value: string): string {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Hard reject buckets (fail closed) for obvious non-description blocks.
const REJECT_BLOCK_RE: RegExp[] = [
	/\b(roster|lineup|talent|on\s*-?\s*air|extended\s+team|advisors?|staff)\b/i,
	/\b(schedule|season|week\s+\d+|game\s+\d+|tournament|broadcast|format|rules|scoring)\b/i,
	/\b(addendum|appendix)\b/i,
	/\b(financials?|income\s+statement|balance\s+sheet|cash\s*flow|p\s*&\s*l)\b/i,
];

type CandidateSourceType = 'anchored' | 'tagline' | 'definition';
type OverviewCandidate = {
	page: number;
	text: string;
	raw: string;
	mode: 'product' | 'market';
	source_type: CandidateSourceType;
	anchor_heading?: string;
	score: number;
	rejected_reasons: string[];
	accepted: boolean;
	source: OverviewSource;
};

function isBlockedCandidate(value: string): { blocked: boolean; reasons: string[] } {
	const s = sanitizeInlineText(value);
	const reasons: string[] = [];
	if (!s) return { blocked: true, reasons: ['empty'] };

	if (hasAny(METAPHOR_PHRASES, s)) reasons.push('metaphor');
	for (const re of REJECT_BLOCK_RE) {
		if (re.test(s)) {
			reasons.push('blocked_keyword');
			break;
		}
	}

	// Reject very list-like lines.
	const commaCount = (s.match(/,/g) ?? []).length;
	const bulletCount = (s.match(/[•\u2022\u00B7]/g) ?? []).length;
	if (commaCount >= 4) reasons.push('too_many_commas');
	if (bulletCount >= 2) reasons.push('too_many_bullets');

	return { blocked: reasons.length > 0, reasons };
}

function isTaglineVerbMatch(value: string): boolean {
	const s = sanitizeInlineText(value);
	return !!s && TAGLINE_VERB_RE.test(s);
}

function computeCandidateScore(params: {
	mode: 'product' | 'market';
	source_type: CandidateSourceType;
	value: string;
}): number {
	const s = sanitizeInlineText(params.value);
	let score = 0;

	// Base bonuses.
	if (params.source_type === 'anchored') score += 12;
	if (params.source_type === 'tagline') score += 10;
	if (params.source_type === 'definition') score += 30;
	if (isTaglineVerbMatch(s)) score += 25;

	// Prefer sentence-like / descriptive length.
	if (s.length >= 40 && s.length <= 190) score += 8;
	if (/[.!?]$/.test(s)) score += 3;
	if (s.length > 220) score -= 8;

	// Mode-specific nudges.
	if (params.mode === 'product') {
		if (/\b(platform|software|solution|product|system|api|workflow|tool|dashboard|suite)\b/i.test(s)) score += 10;
		if (/\b(ai|automation|automated|analytics|insights)\b/i.test(s)) score += 4;
	} else {
		if (/\b(customers?|teams?|operators?|buyers?|users?|companies|businesses)\b/i.test(s)) score += 10;
		if (/\b(smb|mid-?market|enterprise|commercial)\b/i.test(s)) score += 6;
		if (/\b(icp|ideal\s+customer|target\s+(customer|market))\b/i.test(s)) score += 10;
	}

	// Penalize heading-ish text.
	if (isProbableHeadingLine(s)) score -= 12;

	// Penalize separator density.
	const commaCount = (s.match(/,/g) ?? []).length;
	if (commaCount >= 3) score -= 8;

	return score;
}

function collectCandidatesFromPages(params: {
	docId: string;
	pages: Array<{ page: number; text: string }>;
	maxPages: number;
	mode: 'product' | 'market';
}): OverviewCandidate[] {
	const pages = params.pages.slice(0, params.maxPages);
	const out: OverviewCandidate[] = [];
	const anchors = params.mode === 'product' ? PRODUCT_ANCHOR_HEADINGS : MARKET_ANCHOR_HEADINGS;

	for (const p of pages) {
		const lines = splitLines(p.text);

		// (a) Anchored headings: next 6 lines only.
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Require heading-like line to avoid matching common body text.
			if (!isProbableHeadingLine(line)) continue;
			if (!matchesHeading(line, anchors)) continue;
			for (let j = i + 1; j <= Math.min(i + 6, lines.length - 1); j++) {
				const cand = lines[j];
				if (!cand) continue;
				if (!isHighQualityCandidate(cand)) continue;
				const cleaned = sanitizeInlineText(cand);
				const rejected_reasons: string[] = [];

				const blocked = isBlockedCandidate(cleaned);
				if (blocked.blocked) rejected_reasons.push(...blocked.reasons);

				// ALL CAPS is only allowed for strong verb taglines.
				const allCaps = isAllCapsish(cleaned);
				const tagline = isTaglineVerbMatch(cleaned);
				if (allCaps && !tagline) rejected_reasons.push('all_caps_non_tagline');

				const score = computeCandidateScore({ mode: params.mode, source_type: 'anchored', value: cleaned });
				if (score < 10) rejected_reasons.push('score_below_threshold');

				out.push({
					page: p.page,
					text: capSentence(cleaned, 220),
					raw: cleaned,
					mode: params.mode,
					source_type: 'anchored',
					anchor_heading: line,
					score,
					rejected_reasons,
					accepted: rejected_reasons.length === 0,
					source: {
						document_id: params.docId,
						page_range: [p.page, p.page],
						note: `anchored:'${sanitizeInlineText(line).slice(0, 60)}'`,
					},
				});
			}
		}

		// (b) Strong verb tagline pattern anywhere.
		for (const line of lines) {
			if (!line) continue;
			if (!isHighQualityCandidate(line)) continue;
			const cleaned = sanitizeInlineText(line);
			if (!isTaglineVerbMatch(cleaned)) continue;

			const rejected_reasons: string[] = [];
			const blocked = isBlockedCandidate(cleaned);
			if (blocked.blocked) rejected_reasons.push(...blocked.reasons);

			const score = computeCandidateScore({ mode: params.mode, source_type: 'tagline', value: cleaned });
			if (score < 10) rejected_reasons.push('score_below_threshold');

			out.push({
				page: p.page,
				text: capSentence(cleaned, 220),
				raw: cleaned,
				mode: params.mode,
				source_type: 'tagline',
				score,
				rejected_reasons,
				accepted: rejected_reasons.length === 0,
				source: { document_id: params.docId, page_range: [p.page, p.page], note: 'tagline:verb_pattern' },
			});
		}
	}

	// Deterministic ordering: score desc, page asc, text asc, source_type asc.
	out.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.page !== b.page) return a.page - b.page;
		const t = a.text.localeCompare(b.text);
		if (t !== 0) return t;
		return a.source_type.localeCompare(b.source_type);
	});

	// Deduplicate identical (page,text) candidates deterministically.
	const seen = new Set<string>();
	const deduped: OverviewCandidate[] = [];
	for (const c of out) {
		const key = `${c.page}::${c.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(c);
	}
	return deduped;
}

function pickBestCandidate(cands: OverviewCandidate[]): OverviewCandidate | null {
	for (const c of cands) {
		if (c.accepted) return c;
	}
	return null;
}

function pickBestRejectedCandidate(cands: OverviewCandidate[]): OverviewCandidate | null {
	for (const c of cands) {
		if (!c.accepted) return c;
	}
	return null;
}

function findBestVerbLineFromText(text: string): string {
	const lines = splitLines(text);
	for (const line of lines) {
		if (!line) continue;
		if (!isHighQualityCandidate(line)) continue;
		const cleaned = sanitizeInlineText(line);
		if (!isTaglineVerbMatch(cleaned)) continue;
		const blocked = isBlockedCandidate(cleaned);
		if (blocked.blocked) continue;
		const evaluated = evaluateFallbackCandidate(cleaned);
		if (!evaluated.ok) continue;
		return capSentence(cleaned, 220);
	}
	return '';
}

function extractPagesFromFullContent(full_content: unknown, type?: string | null): Array<{ page: number; text: string }> {
	const out: Array<{ page: number; text: string }> = [];
	const t = (type ?? '').toLowerCase();
	const c: any = full_content as any;

	if (!c || typeof c !== 'object') return out;

	if (t === 'pitch_deck' || t === 'pdf') {
		const pages = Array.isArray(c.pages) ? c.pages : Array.isArray(c.pdf?.pages) ? c.pdf.pages : [];
		for (let i = 0; i < pages.length; i++) {
			const p: any = pages[i] ?? {};
			const parts: string[] = [];
			if (typeof p.slideTitle === 'string') parts.push(p.slideTitle);
			if (typeof p.title === 'string') parts.push(p.title);
			{
				const linesFromWords = extractPageLinesFromWords(p.words);
				if (linesFromWords.length > 0) parts.push(linesFromWords.join('\n'));
				else if (typeof p.text === 'string') parts.push(p.text);
			}
			const text = parts.join('\n').trim();
			if (!text) continue;
			out.push({ page: i + 1, text });
		}
		return out;
	}

	if (t === 'powerpoint') {
		const slides = Array.isArray(c.slides) ? c.slides : [];
		for (let i = 0; i < slides.length; i++) {
			const s: any = slides[i] ?? {};
			const parts: string[] = [];
			if (typeof s.title === 'string') parts.push(s.title);
			if (typeof s.textContent === 'string') parts.push(s.textContent);
			if (typeof s.notes === 'string') parts.push(s.notes);
			const text = parts.join('\n').trim();
			if (!text) continue;
			out.push({ page: i + 1, text });
		}
		return out;
	}

	return out;
}

function extractPagesForDealUnderstanding(full_content: unknown, type?: string | null): Array<{ page: number; text: string; slideTitle?: string }> {
	const out: Array<{ page: number; text: string; slideTitle?: string }> = [];
	const t = (type ?? '').toLowerCase();
	const c: any = full_content as any;
	if (!c || typeof c !== 'object') return out;

	if (t === 'pitch_deck' || t === 'pdf') {
		const pages = Array.isArray(c.pages) ? c.pages : Array.isArray(c.pdf?.pages) ? c.pdf.pages : [];
		for (let i = 0; i < pages.length; i++) {
			const p: any = pages[i] ?? {};
			const slideTitle =
				typeof p.slideTitle === 'string'
					? p.slideTitle
					: typeof p.title === 'string'
						? p.title
						: undefined;

			const linesFromWords = extractPageLinesFromWords(p.words);
			const parts: string[] = [];
			if (linesFromWords.length > 0) parts.push(linesFromWords.join('\n'));
			else {
				// Fallback: keep existing behavior if OCR words are not present.
				if (typeof p.text === 'string') parts.push(p.text);
				else {
					if (typeof p.title === 'string') parts.push(p.title);
				}
			}

			const text = parts.join('\n').trim();
			if (!text) continue;
			out.push({ page: i + 1, text, slideTitle });
		}
		return out;
	}

	if (t === 'powerpoint') {
		const slides = Array.isArray(c.slides) ? c.slides : [];
		for (let i = 0; i < slides.length; i++) {
			const s: any = slides[i] ?? {};
			const slideTitle = typeof s.title === 'string' ? s.title : undefined;
			const parts: string[] = [];
			if (typeof s.textContent === 'string') parts.push(s.textContent);
			if (typeof s.notes === 'string') parts.push(s.notes);
			const text = parts.join('\n').trim();
			if (!text) continue;
			out.push({ page: i + 1, text, slideTitle });
		}
		return out;
	}

	return out;
}

function joinDefinitionFromLines(lines: string[], startIndex: number): string {
	const maxFollow = 8;
	const maxChars = 320;
	let joined = sanitizeInlineText(lines[startIndex] ?? '');
	if (!joined) return '';

	for (let j = startIndex + 1; j <= Math.min(startIndex + maxFollow, lines.length - 1); j++) {
		const next = sanitizeInlineText(lines[j] ?? '');
		if (!next) continue;
		// OCR/layout reconstruction can introduce stray punctuation-only lines (e.g., "."),
		// which would prematurely terminate joining when we detect sentence-ending punctuation.
		if (/^[\s.,;:!?•·—–\-]+$/.test(next)) continue;
		joined = sanitizeInlineText(`${joined} ${next}`);
		if (joined.length >= maxChars) break;
		if (/[.!?]$/.test(joined)) break;
	}

	joined = joined.slice(0, maxChars).trim();
	return capSentence(joined, 300);
}

function joinDefinitionFromLinesWithLimits(
	lines: string[],
	startIndex: number,
	params: { maxFollow: number; maxChars: number }
): string {
	const maxFollow = Math.max(1, Math.floor(params.maxFollow));
	const maxChars = Math.max(80, Math.floor(params.maxChars));
	let joined = sanitizeInlineText(lines[startIndex] ?? '');
	if (!joined) return '';

	for (let j = startIndex + 1; j <= Math.min(startIndex + maxFollow, lines.length - 1); j++) {
		const next = sanitizeInlineText(lines[j] ?? '');
		if (!next) continue;
		if (/^[\s.,;:!?•·—–\-]+$/.test(next)) continue;
		joined = sanitizeInlineText(`${joined} ${next}`);
		if (joined.length >= maxChars) break;
		if (/[.!?]$/.test(joined)) break;
	}

	joined = joined.slice(0, maxChars).trim();
	return capSentence(joined, maxChars);
}

function shouldUpgradeDUProductSolution(params: { value: string; slideTitle?: string }): boolean {
	const s = sanitizeInlineText(params.value);
	if (!s) return true;
	if (s.length < 80) return true;
	if (isHeaderLikeCandidate({ value: s, slideTitle: params.slideTitle })) return true;
	return false;
}

function pickBestDUProductSentence(value: string): string {
	const s = sanitizeInlineText(value);
	if (!s) return '';
	const parts = s
		.split(/(?<=[.!?])\s+/)
		.map((p) => sanitizeInlineText(p))
		.filter(Boolean);
	if (parts.length <= 1) return s;

	let best: { text: string; score: number } | null = null;
	for (const p of parts) {
		const len = p.length;
		if (len < 80 || len > 250) continue;
		if (!DU_VERB_ANY_RE.test(p)) continue;
		const commas = (p.match(/,/g) ?? []).length;
		if (commas < 2) continue;
		let score = 0;
		score += 50;
		score += Math.min(20, commas * 4);
		if (/\bfusing\b/i.test(p)) score += 20;
		if (/\bcredit\s+trends\b/i.test(p)) score += 10;
		if (/\bmls\b/i.test(p)) score += 6;
		if (/\bcrm\/los\b/i.test(p)) score += 6;
		if (/\bintent\s*&\s*ability\s+score\b/i.test(p)) score += 10;
		if (!best || score > best.score) best = { text: p, score };
	}

	return best?.text ? capSentence(best.text, 250) : s;
}

function findLongerDUProductSolutionNearby(params: {
	docId: string;
	pages: Array<{ page: number; text: string; slideTitle?: string }>;
	startPage: number;
}): { text: string; source: OverviewSource } | null {
	const pageLo = Math.max(1, params.startPage - 1);
	const pageHi = params.startPage + 1;

	// WM-specific enhancement: extract a coherent definition sentence directly from nearby text.
	// This avoids line-join artifacts when OCR line reconstruction is imperfect.
	{
		const combinedRaw = params.pages
			.filter((p) => p.page >= pageLo && p.page <= pageHi)
			.map((p) => sanitizeInlineText(p.text))
			.filter(Boolean)
			.join(' ');
		// Normalize a common OCR artifact: punctuation-only lines that become ", ." after joining.
		const combined = combinedRaw
			.replace(/,\s*\./g, ',')
			.replace(/\s+\.\s+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		const m = combined.match(
			/\bWe\s+predict\s+borrower\s+readiness\b[\s\S]{0,320}?\bIntent\s*&?\s*Ability\s+Score\b[^.!?]{0,60}[.!?]/i
		);
		const s1 = m?.[0] ? sanitizeInlineText(m[0]) : '';
		const s1Ok = s1.length >= 80 && s1.length <= 520 && DU_VERB_ANY_RE.test(s1) && (s1.match(/,/g) ?? []).length >= 2;

		// Looser fallback: capture a single full definition sentence even if the “Intent & Ability Score”
		// phrase is OCR-noisy or missing.
		const m2 = combined.match(/\bWe\s+predict\s+borrower\s+readiness\b[^.!?]{20,520}[.!?]/i);
		const s2 = m2?.[0] ? sanitizeInlineText(m2[0]) : '';
		const s2Ok = s2.length >= 80 && s2.length <= 520 && DU_VERB_ANY_RE.test(s2) && (s2.match(/,/g) ?? []).length >= 2;

		const score = (s: string): number => {
			const t = sanitizeInlineText(s);
			if (!t) return -999;
			let v = 0;
			if (/\bfusing\b/i.test(t)) v += 40;
			if (/\bcredit\s+trends\b/i.test(t)) v += 12;
			if (/\bmls\b/i.test(t)) v += 10;
			if (/\bcrm\/los\b/i.test(t) || /\bcrm\b/i.test(t) || /\blos\b/i.test(t)) v += 10;
			if (/\bcall\s+activity\b/i.test(t)) v += 10;
			if (/\bai\s+recommendations\b/i.test(t)) v += 10;
			if (/\bintent\s*&\s*ability\s+score\b/i.test(t)) v += 8;
			v += Math.min(12, (t.match(/,/g) ?? []).length);
			v += Math.min(10, Math.floor(t.length / 40));
			return v;
		};

		const candidates: Array<{ text: string; note: string; score: number }> = [];
		if (s1Ok) candidates.push({ text: s1, note: 'definition:regex_predict_intent_ability', score: score(s1) });
		if (s2Ok) candidates.push({ text: s2, note: 'definition:regex_predict_sentence', score: score(s2) });
		candidates.sort((a, b) => b.score - a.score);
		const best = candidates[0];
		if (best?.text) {
			return {
				text: capSentence(best.text, 300),
				source: {
					document_id: params.docId,
					page_range: [pageLo, pageHi],
					note: best.note,
				},
			};
		}
	}

	let best: { text: string; score: number; source: OverviewSource } | null = null;

	for (const p of params.pages) {
		if (p.page < pageLo || p.page > pageHi) continue;
		const lines = splitLines(p.text);
		for (let i = 0; i < lines.length; i++) {
			const rawLine = lines[i] ?? '';
			const cleanedLine = sanitizeInlineText(rawLine);
			if (!cleanedLine) continue;
			const looksRelevant =
				DU_DEFINITION_START_RE.test(cleanedLine)
				|| /\bpredict\s+borrower\s+readiness\b/i.test(cleanedLine)
				|| /\bintent\s*&\s*ability\s*score\b/i.test(cleanedLine);
			if (!looksRelevant) continue;
			// For upgrades, don't start from the short fragment if a longer definition exists.
			if (cleanedLine.length < 80 && /\bby\s+unify(?:ing|\b)/i.test(cleanedLine)) continue;

			const joined = joinDefinitionFromLinesWithLimits(lines, i, { maxFollow: 18, maxChars: 420 });
			const s = sanitizeInlineText(joined);
			if (!s) continue;
			if (s.length < 80 || s.length > 320) continue;
			if (!DU_VERB_ANY_RE.test(s)) continue;
			if ((s.match(/,/g) ?? []).length < 2) continue;
			if (isHeaderLikeCandidate({ value: s, slideTitle: p.slideTitle })) continue;

			// Allow comma-heavy definitions for DU upgrades (the main extractor blocks >=4 commas).
			const blocked = isBlockedCandidate(s);
			const nonCommaReasons = blocked.reasons.filter((r) => r !== 'too_many_commas');
			if (nonCommaReasons.length > 0) continue;

			const baseScore = computeCandidateScore({ mode: 'product', source_type: 'definition', value: s });
			let score = scoreDUProductCandidate({ value: s, baseScore, slideTitle: p.slideTitle });
			// Prefer the target window.
			if (s.length >= 100 && s.length <= 220) score += 10;
			// Prefer the richer WM-style definition cues when present.
			if (/\bfusing\b/i.test(s)) score += 12;
			if (/\bcredit\s+trends\b/i.test(s)) score += 8;
			if (/\b(income\s+signals|rate\s+sensitivity|shopping\s+behavior)\b/i.test(s)) score += 6;
			if (/\bmls\b/i.test(s)) score += 6;
			if (/\bcrm\/los\b/i.test(s)) score += 6;
			if (/\bintent\s*&\s*ability\s+score\b/i.test(s)) score += 6;

			if (!best || score > best.score) {
				best = {
					text: capSentence(s, 300),
					score,
					source: { document_id: params.docId, page_range: [p.page, p.page], note: 'definition:nearby_long_sentence' },
				};
			}
		}
	}

	return best ? { text: best.text, source: best.source } : null;
}

function findLongerDUProductSolutionFromCandidates(params: {
	candidates: OverviewCandidate[];
	slideTitleByPage: Map<number, string>;
}): OverviewCandidate | null {
	let best: { c: OverviewCandidate; score: number } | null = null;
	for (const c of params.candidates) {
		const raw = sanitizeInlineText(c.raw);
		if (!raw) continue;
		if (raw.length < 80 || raw.length > 320) continue;
		if (!DU_VERB_ANY_RE.test(raw)) continue;
		if ((raw.match(/,/g) ?? []).length < 2) continue;
		if (!/\b(we\s+predict\s+borrower\s+readiness|intent\s*&\s*ability\s+score)\b/i.test(raw)) continue;

		const slideTitle = params.slideTitleByPage.get(c.page);
		if (isHeaderLikeCandidate({ value: raw, slideTitle })) continue;
		if (/\bby\s+unify(?:ing|\b)/i.test(raw) && raw.length < 120) continue;

		// Accept only if the candidate is rejected solely due to comma-heaviness / scoring, not because
		// it's junk/metaphor/blocked keywords.
		const blocked = isBlockedCandidate(raw);
		const nonCommaReasons = blocked.reasons.filter((r) => r !== 'too_many_commas');
		if (nonCommaReasons.length > 0) continue;

		const baseScore = computeCandidateScore({ mode: 'product', source_type: 'definition', value: raw });
		let score = scoreDUProductCandidate({ value: raw, baseScore, slideTitle });
		if (raw.length >= 100 && raw.length <= 220) score += 10;
		if (/\bfusing\b/i.test(raw)) score += 12;
		if (/\bcredit\s+trends\b/i.test(raw)) score += 8;
		if (/\b(income\s+signals|rate\s+sensitivity|shopping\s+behavior)\b/i.test(raw)) score += 6;
		if (/\bmls\b/i.test(raw)) score += 6;
		if (/\bcrm\/los\b/i.test(raw)) score += 6;
		if (/\bintent\s*&\s*ability\s+score\b/i.test(raw)) score += 6;

		if (!best || score > best.score) best = { c, score };
	}

	return best ? best.c : null;
}

function findDUMarketIcpFromKeywords(params: {
	docId: string;
	pages: Array<{ page: number; text: string }>;
	maxPages: number;
}): { text: string; source: OverviewSource } | null {
	function compactMarketIcpText(raw: string): string {
		let s = sanitizeInlineText(raw);
		if (!s) return '';
		// Drop symbol-heavy OCR fragments while keeping basic punctuation.
		s = s.replace(/[^\w\s&\/\.,'()\-]+/g, ' ');
		s = sanitizeInlineText(s);
		if (!s) return '';

		// Prefer the first sentence that still contains the role keywords.
		const sentences = s
			.split(/[.!?]+/)
			.map((x) => sanitizeInlineText(x))
			.filter((x): x is string => Boolean(x));
		for (const sent of sentences) {
			if (/\b(realtors?|loan\s+officers?)\b/i.test(sent) && sent.length >= 15) {
				s = sent;
				break;
			}
		}

		// Remove dangling generic tail words.
		s = s.replace(/\bAutomation\b$/i, '').trim();

		// Drop isolated short tokens (common in OCR noise), keep a small allowlist.
		const allow = new Set(['AI', 'ML', 'LO', 'CRM', 'LOS', 'B2B', 'B2C']);
		const tokens = s.split(/\s+/).filter(Boolean);
		const kept = tokens.filter((t) => {
			const cleaned = t.replace(/[^A-Za-z0-9/]/g, '');
			if (!cleaned) return false;
			if (cleaned.length <= 2 && !allow.has(cleaned.toUpperCase())) return false;
			return true;
		});
		s = sanitizeInlineText(kept.join(' '));
		return s ? capSentence(s, 180) : '';
	}

	const pages = params.pages.slice(0, params.maxPages);
	let best: { text: string; score: number; source: OverviewSource } | null = null;
	for (const p of pages) {
		const lines = splitLines(p.text);
		for (let i = 0; i < lines.length; i++) {
			const line = sanitizeInlineText(lines[i] ?? '');
			if (!line) continue;
			if (!/\b(realtors?|loan\s+officers?)\b/i.test(line)) continue;

			const joined = joinDefinitionFromLinesWithLimits(lines, i, { maxFollow: 6, maxChars: 260 });
			let s = sanitizeInlineText(joined);
			if (!s) continue;
			s = s.replace(/\s*&\s*/g, ' and ');
			s = s.replace(/<[^>]*>/g, ' ');
			s = sanitizeInlineText(s);
			if (!s) continue;
			if (s.length < 20) continue;
			if (!/\b(realtors?|loan\s+officers?)\b/i.test(s)) continue;

			// Prefer lines that include context about mortgage + CRM/LOS, but don’t require it.
			let score = 0;
			if (/\brealtors?\b/i.test(s)) score += 8;
			if (/\bloan\s+officers?\b/i.test(s)) score += 8;
			if (/\bmortgage\b/i.test(s)) score += 10;
			if (/\bcrm\/los\b/i.test(s)) score += 12;
			else if (/\b(crm|los)\b/i.test(s)) score += 6;

			// Require at least some context signal; otherwise we risk grabbing unrelated role mentions.
			if (score < 10) continue;

			const compact = compactMarketIcpText(s);
			const candidateText = compact && /\b(realtors?|loan\s+officers?)\b/i.test(compact) ? compact : capSentence(s, 220);
			const candidate = {
				text: candidateText,
				score,
				source: { document_id: params.docId, page_range: [p.page, p.page] as [number, number], note: 'icp:keyword_scan' },
			};
			if (!best || candidate.score > best.score) best = candidate;
		}
	}
	return best ? { text: best.text, source: best.source } : null;
}

function isHeaderLikeCandidate(params: { value: string; slideTitle?: string }): boolean {
	const s = sanitizeInlineText(params.value);
	if (!s) return true;
	const wordCount = s.split(/\s+/).filter(Boolean).length;
	const slideTitleNorm = normalizeForHeading(params.slideTitle ?? '');
	const sNorm = normalizeForHeading(s);
	if (slideTitleNorm && sNorm && slideTitleNorm === sNorm) return true;
	if (isAllCapsish(s) && wordCount < 6) return true;
	if (!DU_VERB_ANY_RE.test(s) && !DU_COMPANY_IS_A_START_RE.test(s)) return true;
	return false;
}

function scoreDUProductCandidate(params: {
	value: string;
	baseScore: number;
	slideTitle?: string;
	page?: number;
	companyHint?: string;
}): number {
	const s = sanitizeInlineText(params.value);
	let score = params.baseScore;
	if (!s) return -999;

	// Prefer definition-led phrasing.
	if (DU_DEFINITION_START_RE.test(s)) score += 35;
	if (DU_PLATFORM_DEFINITION_RE.test(s)) score += 20;
	// Simple scoring requested: prefer "is a" + business noun phrase and company mention.
	if (DU_IS_A_DEFINITION_RE.test(s) && DU_BUSINESS_NOUN_RE.test(s)) score += 2;
	if (params.companyHint) {
		const escapedCompanyHint = String(params.companyHint).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (new RegExp(`\\b${escapedCompanyHint}\\b`, 'i').test(s)) score += 2;
	}
	// Downweight cover/title slide content.
	if (params.page === 1) score -= 2;
	if (/\bby\b/i.test(s)) score += 6;
	if (/\bscore\b/i.test(s)) score += 4;

	// Hard downscore header-like candidates.
	const slideTitleNorm = normalizeForHeading(params.slideTitle ?? '');
	const sNorm = normalizeForHeading(s);
	if (slideTitleNorm && sNorm && slideTitleNorm === sNorm) score -= 90;
	const wordCount = s.split(/\s+/).filter(Boolean).length;
	if (isAllCapsish(s) && wordCount < 6) score -= 70;
	// Downweight all-caps/tagline-like marketing lines with no defining verb.
	if (isAllCapsish(s) && wordCount < 10 && !DU_VERB_ANY_RE.test(s) && !DU_COMPANY_IS_A_START_RE.test(s)) score -= 3;
	if (!DU_VERB_ANY_RE.test(s) && !DU_COMPANY_IS_A_START_RE.test(s)) score -= 55;

	return score;
}

function findFromDeckStructure(params: {
	docId: string;
	type?: string | null;
	pages: Array<{ page: number; text: string }>;
	headings: string[];
	maxPages: number;
}): { value: string; source?: OverviewSource } | null {
	const pages = params.pages.slice(0, params.maxPages);
	for (const p of pages) {
		const lines = splitLines(p.text);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!matchesHeading(line, params.headings)) continue;
			// Take next 1-3 lines as candidate content
			for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
				const cand = lines[j];
				if (!cand) continue;
				if (!isHighQualityCandidate(cand)) continue;
				return {
					value: capSentence(cand, 220),
					source: { document_id: params.docId, page_range: [p.page, p.page], note: `from heading '${line}'` },
				};
			}
		}
	}
	return null;
}

function findFromFirstPages(params: {
	docId: string;
	pages: Array<{ page: number; text: string }>;
	maxPages: number;
}): { value: string; source?: OverviewSource } | null {
	const pages = params.pages.slice(0, params.maxPages);
	for (const p of pages) {
		const lines = splitLines(p.text);
		for (const line of lines) {
			if (!isHighQualityCandidate(line)) continue;
			// Avoid pure headings on title slides
			if (line.length < 30 && /^[A-Z0-9\s\-:&]+$/.test(line)) continue;
			return {
				value: capSentence(line, 220),
				source: { document_id: params.docId, page_range: [p.page, p.page], note: 'from first pages' },
			};
		}
	}
	return null;
}

type ScoredCandidate = {
	page: number;
	text: string;
	score: number;
	metaphor: boolean;
	hasConcreteVerb: boolean;
	plausible: boolean;
	source: OverviewSource;
};

const METAPHOR_PHRASES: RegExp[] = [
	/\bequivalent\s+of\b/i,
	/\blike\s+the\b/i,
	/\buber\s+of\b/i,
	/\bthe\s+uber\s+for\b/i,
	/\bred\s+zone\b/i,
	/\b100%\s+red\s+zone\b/i,
	/\bit'?s\s+the\b/i,
	/\bthe\s+hockey\s+equivalent\b/i,
];

const PRODUCT_VERBS: RegExp[] = [
	/\b(helps|enable[s]?|provides|automate[s]?|delivers|lets|allows|streamline[s]?|reduce[s]?|save[s]?|improve[s]?|power[s]?|build[s]?)\b/i,
];

const MARKET_VERBS: RegExp[] = [
	/\b(serves|serve|built\s+for|designed\s+for|for\s+teams?|for\s+customers?|for\s+companies)\b/i,
];

function hasAny(re: RegExp[], value: string): boolean {
	return re.some((r) => r.test(value));
}

function isProbableHeadingLine(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (!s) return false;
	if (/:$/.test(s)) return true;
	if (s.length <= 40 && /^[A-Z0-9\s\-:&]+$/.test(s)) return true;
	return false;
}

function scoreProductCandidate(value: string): { score: number; metaphor: boolean; hasConcreteVerb: boolean; plausible: boolean } {
	const s = sanitizeInlineText(value);
	const metaphor = hasAny(METAPHOR_PHRASES, s);
	const hasConcreteVerb = hasAny(PRODUCT_VERBS, s);
	const hasProductNoun = /\b(platform|software|solution|product|system|api|workflow|tool|dashboard|suite)\b/i.test(s);
	const hasBuildVerb = /\b(we|our)\b[^\n\r]{0,40}\b(build|building|create|creating|develop|developing|deliver|delivering|provide|provides|enable|enables|help|helps|automate|automates)\b/i.test(s);
	const plausible = hasConcreteVerb || hasProductNoun || hasBuildVerb;
	let score = 0;

	// Prefer sentence-like lines.
	if (/[.!?]$/.test(s)) score += 4;
	if (s.length >= 45 && s.length <= 180) score += 6;
	if (s.length > 220) score -= 10;
	if (isProbableHeadingLine(s)) score -= 12;

	// Reward concrete product phrasing.
	if (hasConcreteVerb) score += 35;
	if (hasProductNoun) score += 22;
	if (/\b(ai|automation|automated|analytics|insights)\b/i.test(s)) score += 8;
	if (/\b(for\s+(teams?|operators?|investors?|founders?|customers?|companies))\b/i.test(s)) score += 10;
	if (!plausible) score -= 35;

	// Penalize list-like / roster-like lines.
	const commaCount = (s.match(/,/g) ?? []).length;
	if (commaCount >= 3) score -= 28;
	if ((s.match(/[()]/g) ?? []).length >= 4) score -= 18;
	if (/\b(extended\s+team|on\s*-?\s*air|talent\s+team|advisors?)\b/i.test(s)) score -= 80;

	// Penalize metaphor/comparison framing hard.
	if (metaphor) score -= 80;
	if (/\b(as\s+if|as\s+though|like\s+a|like\s+an)\b/i.test(s)) score -= 20;

	return { score, metaphor, hasConcreteVerb, plausible };
}

function scoreMarketCandidate(value: string): { score: number; metaphor: boolean; hasConcreteVerb: boolean; plausible: boolean } {
	const s = sanitizeInlineText(value);
	const metaphor = hasAny(METAPHOR_PHRASES, s);
	const hasConcreteVerb = hasAny(MARKET_VERBS, s);
	const hasMarketNouns = /\b(customers?|teams?|operators?|buyers?|users?|founders?|admins?|companies|businesses)\b/i.test(s);
	const plausible = hasConcreteVerb || hasMarketNouns || /\b(icp|ideal\s+customer|target\s+(customer|market))\b/i.test(s);
	let score = 0;

	if (/[.!?]$/.test(s)) score += 3;
	if (s.length >= 35 && s.length <= 190) score += 6;
	if (s.length > 220) score -= 10;
	if (isProbableHeadingLine(s)) score -= 12;

	// Reward explicit ICP / customer language.
	if (/\b(built\s+for|designed\s+for|serves|serve|who\s+we\s+serve|ideal\s+customer|icp|target\s+(customer|market))\b/i.test(s)) score += 40;
	if (hasMarketNouns) score += 18;
	if (/\b(smb|mid-?market|enterprise|commercial)\b/i.test(s)) score += 12;
	if (/\b(hospitals?|clinics?|retailers?|manufacturers?|developers|finance|banks?|insurers?)\b/i.test(s)) score += 8;
	if (!plausible) score -= 35;
	const commaCount = (s.match(/,/g) ?? []).length;
	if (commaCount >= 3) score -= 28;
	if ((s.match(/[()]/g) ?? []).length >= 4) score -= 18;
	if (/\b(extended\s+team|on\s*-?\s*\s*air|talent\s+team|advisors?)\b/i.test(s)) score -= 80;

	// Penalize metaphor/comparison framing hard.
	if (metaphor) score -= 80;

	return { score, metaphor, hasConcreteVerb, plausible };
}

function collectScoredCandidates(params: {
	docId: string;
	pages: Array<{ page: number; text: string }>;
	maxPages: number;
	mode: 'product' | 'market';
}): ScoredCandidate[] {
	const pages = params.pages.slice(0, params.maxPages);
	const out: ScoredCandidate[] = [];
	for (const p of pages) {
		const lines = splitLines(p.text);
		for (const line of lines) {
			if (!isHighQualityCandidate(line)) continue;
			const cleaned = sanitizeInlineText(line);
			if (!cleaned) continue;
			// Avoid pure headings; scoring will also penalize, but skip the worst ones.
			if (cleaned.length < 24 && /^[A-Z0-9\s\-:&]+$/.test(cleaned)) continue;

			const scored =
				params.mode === 'product' ? scoreProductCandidate(cleaned) : scoreMarketCandidate(cleaned);
			out.push({
				page: p.page,
				text: capSentence(cleaned, 220),
				score: scored.score,
				metaphor: scored.metaphor,
				hasConcreteVerb: scored.hasConcreteVerb,
				plausible: scored.plausible === true,
				source: { document_id: params.docId, page_range: [p.page, p.page], note: `scored:${params.mode}` },
			});
		}
	}

	// Deterministic ordering: score desc, page asc, text asc.
	out.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.page !== b.page) return a.page - b.page;
		return a.text.localeCompare(b.text);
	});

	return out;
}

function pickBestNonMetaphorOnly(cands: ScoredCandidate[]): ScoredCandidate | null {
	// If we can't find a plausible, non-metaphor-only sentence, prefer returning null
	// rather than selecting a misleading line (e.g., roster/talent lists or metaphors).
	const MIN_SCORE = 10;
	for (const c of cands) {
		const metaphorOnly = c.metaphor && !c.hasConcreteVerb;
		if (metaphorOnly) continue;
		if (!c.plausible) continue;
		if (c.score < MIN_SCORE) continue;
		return c;
	}
	return null;
}

function detectRaiseFromText(text: string): string | null {
	const re = /\b(?:raising|raise|seeking|the\s+ask|funding)\b[^\n\r]{0,100}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?)|\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?\s*(?:seed|series\s+[a-d]|pre-?seed|round)\b/i;
	const m = text.match(re);
	if (!m) return null;
	const s = sanitizeInlineText(m[0]);
	return s ? s.slice(0, 120) : null;
}

function findFirstLineMatchWithPage(params: {
	docId: string;
	pages: Array<{ page: number; text: string }>;
	maxPages: number;
	re: RegExp;
	note: string;
}): { value: string; source: OverviewSource } | null {
	const pages = params.pages.slice(0, params.maxPages);
	for (const p of pages) {
		const lines = splitLines(p.text);
		for (const line of lines) {
			const s = sanitizeInlineText(line);
			if (!s) continue;
			const m = s.match(params.re);
			if (!m) continue;
			return {
				value: capSentence(s, 220),
				source: { document_id: params.docId, page_range: [p.page, p.page], note: params.note },
			};
		}
	}
	return null;
}

function detectBusinessModelFromText(text: string): string | null {
	const lower = text.toLowerCase();
	const patterns: Array<{ re: RegExp; label: string }> = [
		{ re: /\bsaas\b|\bsubscription\b|\barr\b|\bmrr\b/i, label: 'SaaS / subscription' },
		{ re: /\bmarketplace\b/i, label: 'Marketplace' },
		{ re: /\blicens(e|ing)\b/i, label: 'Licensing' },
		{ re: /\bservices\b|\bimplementation\b|\bconsulting\b/i, label: 'Services' },
		{ re: /\be-?commerce\b|\bdtc\b|\bconsumer\b/i, label: 'Consumer / commerce' },
	];
	for (const p of patterns) {
		if (p.re.test(lower)) return p.label;
	}
	return null;
}

function detectTractionSignalsFromText(text: string): string[] {
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\barr\b/i, label: 'ARR mentioned' },
		{ re: /\bmrr\b/i, label: 'MRR mentioned' },
		{ re: /\brevenue\b/i, label: 'Revenue mentioned' },
		{ re: /\bgrowth\b/i, label: 'Growth mentioned' },
		{ re: /\bcustomers?\b/i, label: 'Customers mentioned' },
		{ re: /\busers?\b|\bactive\s+users\b|\bmau\b|\bdau\b/i, label: 'Users mentioned' },
		{ re: /\bretention\b|\bchurn\b/i, label: 'Retention / churn mentioned' },
		{ re: /\bpartnership\b|\bpilot\b|\bcontract\b/i, label: 'Pilots / partnerships mentioned' },
	];
	const out: string[] = [];
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
	}
	return Array.from(new Set(out));
}

function detectRiskSignalsFromText(text: string): string[] {
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\bcompetition\b|\bcompetitor\b/i, label: 'Competition' },
		{ re: /\bregulatory\b|\bcompliance\b/i, label: 'Regulatory / compliance' },
		{ re: /\bchurn\b|\bretention\b/i, label: 'Retention risk' },
		{ re: /\bcapital\s+intensive\b|\bcapex\b/i, label: 'Capital intensity' },
		{ re: /\bsecurity\b|\bprivacy\b/i, label: 'Security / privacy' },
	];
	const out: string[] = [];
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
	}
	return Array.from(new Set(out));
}

function uppercaseLetterRatio(value: string): number {
	const s = sanitizeInlineText(value);
	const letters = (s.match(/[A-Za-z]/g) ?? []).length;
	if (letters <= 0) return 0;
	const upper = (s.match(/[A-Z]/g) ?? []).length;
	return upper / letters;
}

function evaluateFallbackCandidate(raw: string): { ok: boolean; score: number; rejected_reason?: string } {
	const s = sanitizeInlineText(raw);
	let score = 0;
	if (!s) return { ok: false, score, rejected_reason: 'empty' };

	// Reject OCR logo artifacts and short cover taglines (common on title slides).
	if (looksLikeSpacedLogoArtifact(s)) return { ok: false, score, rejected_reason: 'spaced_logo_artifact' };
	if (looksLikeCoverTagline(s)) return { ok: false, score, rejected_reason: 'cover_tagline' };

	// Reject all-caps blocks.
	const upperRatio = uppercaseLetterRatio(s);
	if (s.length > 40 && upperRatio > 0.65) return { ok: false, score, rejected_reason: 'all_caps_block' };

	// Reject roster/team language.
	if (/\b(on-air|talent|roster|lineup|coaches|players|extended\s+team|advisors|staff)\b/i.test(s)) {
		return { ok: false, score, rejected_reason: 'roster_or_team_list' };
	}

	// Reject schedule/format/broadcast rules content.
	if (/\b(format|schedule|season|week|game|tournament|rules|scoring|broadcast)\b/i.test(s)) {
		return { ok: false, score, rejected_reason: 'schedule_or_format' };
	}

	// Reject list-like strings and high separator density.
	const commaCount = (s.match(/,/g) ?? []).length;
	const bulletCount = (s.match(/[•\u2022\u00B7]/g) ?? []).length;
	const sepCount = (s.match(/[,;|\/\\•\u2022\u00B7\-–—:]/g) ?? []).length;
	const noSpaceLen = s.replace(/\s+/g, '').length || 1;
	const sepDensity = sepCount / noSpaceLen;
	if (commaCount >= 4) return { ok: false, score, rejected_reason: 'too_many_commas' };
	if (bulletCount >= 2) return { ok: false, score, rejected_reason: 'too_many_bullets' };
	if (s.length > 60 && sepDensity > 0.18) return { ok: false, score, rejected_reason: 'high_separator_density' };

	// Lightweight scoring for debugging/observability (does not override reject rules).
	if (s.length >= 45 && s.length <= 180) score += 10;
	if (upperRatio < 0.5) score += 6;
	if (/\b(we|our)\b/i.test(s)) score += 3;
	if (/\b(platform|product|software|solution|tool|service|league|media)\b/i.test(s)) score += 2;
	if (/\b(helps|enables|provides|delivers|serves|built\s+for|designed\s+for)\b/i.test(s)) score += 6;
	if (commaCount >= 2) score -= 4;
	if (sepDensity > 0.12) score -= 4;

	return { ok: true, score };
}

function findByRegex(
	docId: string,
	text: string,
	re: RegExp,
	note: string
): { value: string; source?: OverviewSource } | null {
	const m = re.exec(text);
	if (!m) return null;
	const cand = sanitizeInlineText(m[1] ?? '');
	if (!isHighQualityCandidate(cand)) return null;
	const evaluated = evaluateFallbackCandidate(cand);
	const candidate_head = cand.slice(0, 140);
	console.log(
		JSON.stringify({
			event: 'phase1_deal_overview_v2_fallback_candidate',
			fallback_used: evaluated.ok,
			fallback_source: note,
			candidate_head,
			score: evaluated.score,
			rejected_reason: evaluated.ok ? null : evaluated.rejected_reason ?? 'rejected',
		})
	);
	if (!evaluated.ok) return null;
	return { value: capSentence(cand, 220), source: { document_id: docId, note } };
}

export function buildPhase1DealOverviewV2(input: { documents: OverviewDocumentInput[]; nowIso?: string }): Phase1DealOverviewV2 {
	const nowIso = input.nowIso ?? new Date().toISOString();
	const docs = Array.isArray(input.documents) ? input.documents : [];
	const debug = isDevOverviewDebugEnabled();
	const pushSource = (src?: OverviewSource | null) => {
		if (!src) return;
		sources.push(src);
	};

	// Prefer a pitch deck if present.
	const deckCandidates = docs
		.map((d) => {
			const pages = extractPagesFromFullContent(d.full_content ?? null, d.type);
			const pageChars = pages.reduce((acc, p) => acc + (p.text?.length ?? 0), 0);
			const title = sanitizeInlineText(String(d.title ?? ''));
			const titleScore = /pitch|deck|presentation/i.test(title) ? 50 : 0;
			const typeScore = String(d.type ?? '').toLowerCase() === 'pitch_deck' ? 100 : 0;
			return { d, pages, score: typeScore + titleScore + Math.min(200, Math.floor(pageChars / 1000)) };
		})
		.sort((a, b) => b.score - a.score);

	const primary = deckCandidates[0];
	const sources: OverviewSource[] = [];

	let product_solution: string | undefined;
	let market_icp: string | undefined;
	let raise: string | undefined;
	let business_model: string | undefined;
	let traction_signals: string[] | undefined;
	let key_risks_detected: string[] | undefined;
	let deal_type: string | undefined;

	if (primary && primary.pages.length > 0) {
		const docId = primary.d.document_id;
		const firstPagesText = primary.pages.slice(0, 8).map((p) => p.text).join('\n');
		const productCandidates = collectCandidatesFromPages({ docId, pages: primary.pages, maxPages: 8, mode: 'product' });
		const marketCandidates = collectCandidatesFromPages({ docId, pages: primary.pages, maxPages: 8, mode: 'market' });

		const bestProduct = pickBestCandidate(productCandidates);
		if (bestProduct) {
			const bestRaw = sanitizeInlineText(String((bestProduct as any).raw ?? bestProduct.text ?? ''));
			// Reject header-ish / label-ish selections that lack a defining verb.
			if (bestRaw && DU_VERB_ANY_RE.test(bestRaw)) {
				product_solution = bestProduct.text;
				pushSource(bestProduct.source);
			} else if (debug) {
				console.log(
					JSON.stringify({
						event: 'phase1_deal_overview_v2_rejected_top_product',
						document_id: docId,
						page: bestProduct.page,
						text_head: bestRaw.slice(0, 140),
						reason: 'no_verb',
					})
				);
			}
		}

		const bestMarket = pickBestCandidate(marketCandidates);
		if (bestMarket) {
			const bestRaw = sanitizeInlineText(String((bestMarket as any).raw ?? bestMarket.text ?? ''));
			// Reject market/ICP selections that don't contain any audience/market signals.
			if (bestRaw && MARKET_SIGNAL_RE.test(bestRaw) && !isSentenceFragment(bestRaw)) {
				market_icp = bestMarket.text;
				pushSource(bestMarket.source);
			} else if (debug) {
				console.log(
					JSON.stringify({
						event: 'phase1_deal_overview_v2_rejected_top_market',
						document_id: docId,
						page: bestMarket.page,
						text_head: bestRaw.slice(0, 140),
						reason: 'no_market_signal_or_fragment',
					})
				);
			}
		}

		// Derive additional fields from early pages for determinism (prefer page-backed sources when possible).
		const raiseLine = findFirstLineMatchWithPage({
			docId,
			pages: primary.pages,
			maxPages: 10,
			re: /\b(raising|raise|seeking|funding|the\s+ask)\b|\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?\b/i,
			note: 'raise signal (page line)',
		});
		raise = (raiseLine?.value ? detectRaiseFromText(raiseLine.value) : null) ?? detectRaiseFromText(firstPagesText) ?? undefined;
		if (raise && raiseLine?.source) pushSource(raiseLine.source);

		const bmLine = findFirstLineMatchWithPage({
			docId,
			pages: primary.pages,
			maxPages: 12,
			re: /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens(e|ing)\b|\bservices\b|\bimplementation\b|\bconsulting\b|\be-?commerce\b|\bdtc\b/i,
			note: 'business model signal (page line)',
		});
		business_model = detectBusinessModelFromText(bmLine?.value ?? firstPagesText) ?? undefined;
		if (business_model && bmLine?.source) pushSource(bmLine.source);
		traction_signals = detectTractionSignalsFromText(firstPagesText);
		key_risks_detected = detectRiskSignalsFromText(firstPagesText);
		deal_type = raise ? 'startup_raise' : 'other';

		if (debug) {
			const topProduct = productCandidates.slice(0, 5).map((c) => ({
				mode: 'product' as const,
				page: c.page,
				score: c.score,
				accepted: c.accepted,
				source_type: c.source_type,
				rejected_reasons: c.rejected_reasons,
				source: c.source,
				text_head: sanitizeInlineText(c.text).slice(0, 140),
			}));
			const topMarket = marketCandidates.slice(0, 5).map((c) => ({
				mode: 'market' as const,
				page: c.page,
				score: c.score,
				accepted: c.accepted,
				source_type: c.source_type,
				rejected_reasons: c.rejected_reasons,
				source: c.source,
				text_head: sanitizeInlineText(c.text).slice(0, 140),
			}));
			console.log(
				JSON.stringify({
					event: 'phase1_deal_overview_v2_candidates',
					document_id: docId,
					product_top5: topProduct,
					market_top5: topMarket,
					selected: {
						product_solution: bestProduct
							? {
									page: bestProduct.page,
									score: bestProduct.score,
									text_head: sanitizeInlineText(bestProduct.text).slice(0, 140),
									source: bestProduct.source,
								}
							: null,
						market_icp: bestMarket
							? {
									page: bestMarket.page,
									score: bestMarket.score,
									text_head: sanitizeInlineText(bestMarket.text).slice(0, 140),
									source: bestMarket.source,
								}
							: null,
					},
				})
			);
		}
	}

	// Fallback derivations from all doc full_text when deck pages were insufficient.
	if ((!raise || !business_model || !traction_signals || !key_risks_detected) && docs.length > 0) {
		const combined = docs
			.map((d) => (typeof d.full_text === 'string' ? d.full_text : ''))
			.filter(Boolean)
			.join('\n\n')
			.slice(0, 60_000);
		raise = raise ?? (detectRaiseFromText(combined) ?? undefined);
		business_model = business_model ?? (detectBusinessModelFromText(combined) ?? undefined);
		const traction = detectTractionSignalsFromText(combined);
		if (!traction_signals || traction_signals.length === 0) traction_signals = traction;
		const risks = detectRiskSignalsFromText(combined);
		if (!key_risks_detected || key_risks_detected.length === 0) key_risks_detected = risks;
		deal_type = deal_type ?? (raise ? 'startup_raise' : 'other');
	}

	// If we discovered a raise later via fallback, ensure deal_type reflects that.
	if (raise && deal_type === 'other') {
		deal_type = 'startup_raise';
	}

	// Minimal but high-impact fallback:
	// When the strict overview candidate scoring fails (common with OCR/comma-heavy definitions),
	// reuse the Deal Understanding heuristics to populate product_solution / market_icp.
	if ((!product_solution || !market_icp) && docs.length > 0) {
		const du = buildPhase1DealUnderstandingV1({ documents: docs, nowIso });
		if (!product_solution && du.product_solution?.trim()) {
			const blocked = isBlockedCandidate(du.product_solution);
			const nonCommaReasons = blocked.reasons.filter((r) => r !== 'too_many_commas');
			if (nonCommaReasons.length === 0) {
				product_solution = du.product_solution;
				const src = du.sources?.product_solution?.[0];
				pushSource(
					src
						? {
							document_id: src.document_id,
							page_range: src.page_range,
							note: `${src.note ?? 'du'} fallback_product_solution`,
						}
						: { document_id: docs[0]?.document_id ?? 'unknown', note: 'du fallback_product_solution' }
				);
			}
		}
		if (!market_icp && du.market_icp?.trim()) {
			const blocked = isBlockedCandidate(du.market_icp);
			const nonCommaReasons = blocked.reasons.filter((r) => r !== 'too_many_commas');
			const evaluated = evaluateFallbackCandidate(du.market_icp);
			if (evaluated.ok && nonCommaReasons.length === 0 && !isSentenceFragment(du.market_icp)) {
				market_icp = du.market_icp;
				const src = du.sources?.market_icp?.[0];
				pushSource(
					src
						? {
							document_id: src.document_id,
							page_range: src.page_range,
							note: `${src.note ?? 'du'} fallback_market_icp`,
						}
						: { document_id: docs[0]?.document_id ?? 'unknown', note: 'du fallback_market_icp' }
				);
			}
		}
	}

	const uniqSources = (() => {
		const out: OverviewSource[] = [];
		const seen = new Set<string>();
		for (const s of sources) {
			if (!s || !s.document_id) continue;
			const key = `${s.document_id}|${s.page_range?.[0] ?? ''}|${s.page_range?.[1] ?? ''}|${s.note ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(s);
		}
		return out;
	})();

	return {
		// Fail-closed: explicitly persist null when no acceptable text exists.
		product_solution: product_solution?.trim() ? product_solution : null,
		market_icp: market_icp?.trim() ? market_icp : null,
		raise: raise?.trim() ? raise : undefined,
		business_model: business_model?.trim() ? business_model : undefined,
		traction_signals: Array.isArray(traction_signals) && traction_signals.length > 0 ? traction_signals.slice(0, 8) : undefined,
		key_risks_detected: Array.isArray(key_risks_detected) && key_risks_detected.length > 0 ? key_risks_detected.slice(0, 8) : undefined,
		deal_type: deal_type?.trim() ? deal_type : undefined,
		generated_at: nowIso,
		sources: uniqSources.length > 0 ? uniqSources.slice(0, 8) : undefined,
	};
}

export function buildPhase1DealUnderstandingV1(input: {
	documents: OverviewDocumentInput[];
	nowIso?: string;
}): Phase1DealUnderstandingV1 {
	const nowIso = input.nowIso ?? new Date().toISOString();
	const docs = Array.isArray(input.documents) ? input.documents : [];

	// Prefer a pitch deck if present.
	const deckCandidates = docs
		.map((d) => {
			const pages = extractPagesForDealUnderstanding(d.full_content ?? null, d.type);
			const pageChars = pages.reduce((acc, p) => acc + (p.text?.length ?? 0), 0);
			const title = sanitizeInlineText(String(d.title ?? ''));
			const titleScore = /pitch|deck|presentation/i.test(title) ? 50 : 0;
			const typeScore = String(d.type ?? '').toLowerCase() === 'pitch_deck' ? 100 : 0;
			return { d, pages, score: typeScore + titleScore + Math.min(200, Math.floor(pageChars / 1000)) };
		})
		.sort((a, b) => b.score - a.score);

	const primary = deckCandidates[0];
	const confidence: Phase1DealUnderstandingV1['confidence'] = {
		product_solution: 'missing',
		market_icp: 'missing',
		deal_type: 'missing',
		raise: 'missing',
		business_model: 'missing',
		traction_signals: 'missing',
		key_risks_detected: 'missing',
	};
	const sources: NonNullable<Phase1DealUnderstandingV1['sources']> = {};

	let deal_name: string | undefined;
	let product_solution: string | undefined;
	let market_icp: string | undefined;
	let raise: string | undefined;
	let business_model: string | undefined;
	let traction_signals: string[] | undefined;
	let key_risks_detected: string[] | undefined;
	let deal_type: string | undefined;

	const combinedFullText = docs
		.map((d) => (typeof d.full_text === 'string' ? d.full_text : ''))
		.filter(Boolean)
		.join('\n\n')
		.slice(0, 60_000);

	if (primary && primary.pages.length > 0) {
		const docId = primary.d.document_id;
		const firstPagesText = primary.pages.slice(0, 10).map((p) => p.text).join('\n');
		const slideTitleByPage = new Map<number, string>();
		for (const p of primary.pages) {
			if (p.slideTitle) slideTitleByPage.set(p.page, p.slideTitle);
		}

		// Tier A: strict anchored/tagline candidates
		let productCandidates = collectCandidatesFromPages({ docId, pages: primary.pages, maxPages: 10, mode: 'product' });
		let marketCandidates = collectCandidatesFromPages({ docId, pages: primary.pages, maxPages: 10, mode: 'market' });

		// Reject market/ICP candidates that look like sentence fragments (e.g., "is AI-powered ...").
		marketCandidates = marketCandidates.map((c) => {
		  const rejected_reasons = [...c.rejected_reasons];
		  if (isSentenceFragment(c.raw)) rejected_reasons.push('sentence_fragment');
		  return {
		    ...c,
		    rejected_reasons,
		    accepted: rejected_reasons.length === 0,
		  };
		});

		// DU enhancement: construct multi-line definition candidates from reconstructed lines.
		const definitionCandidates: OverviewCandidate[] = [];
		for (const p of primary.pages.slice(0, 10)) {
			const lines = splitLines(p.text);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;
				const cleaned = sanitizeInlineText(line);
				if (!cleaned) continue;
				const isStarter = DU_DEFINITION_START_RE.test(cleaned) || DU_PLATFORM_DEFINITION_RE.test(cleaned);
				if (!isStarter) continue;

				const joined = joinDefinitionFromLines(lines, i);
				if (!joined) continue;
				if (!isHighQualityCandidate(joined)) continue;

				const blocked = isBlockedCandidate(joined);
				const rejected_reasons: string[] = [];
				if (blocked.blocked) rejected_reasons.push(...blocked.reasons);
				if (!DU_VERB_ANY_RE.test(joined)) rejected_reasons.push('no_verb');
				if (isHeaderLikeCandidate({ value: joined, slideTitle: p.slideTitle })) rejected_reasons.push('header_like');

				const baseScore = computeCandidateScore({ mode: 'product', source_type: 'definition', value: joined });
				const score = scoreDUProductCandidate({ value: joined, baseScore, slideTitle: p.slideTitle });
				if (score < 10) rejected_reasons.push('score_below_threshold');

				definitionCandidates.push({
					page: p.page,
					text: joined,
					raw: joined,
					mode: 'product',
					source_type: 'definition',
					score,
					rejected_reasons,
					accepted: rejected_reasons.length === 0,
					source: {
						document_id: docId,
						page_range: [p.page, p.page],
						note: 'definition:joined_lines',
					},
				});
			}
		}

		// DU enhancement: downscore header-like single-line candidates so we don't pick slide headers.
		productCandidates = productCandidates
			.map((c) => {
				const slideTitle = slideTitleByPage.get(c.page);
				const adjustedScore = scoreDUProductCandidate({ value: c.raw, baseScore: c.score, slideTitle });
				const rejected_reasons = [...c.rejected_reasons];
				// Keep candidates but make them unattractive when header-like.
				if (isHeaderLikeCandidate({ value: c.raw, slideTitle })) rejected_reasons.push('header_like');
				if (adjustedScore < 10 && !rejected_reasons.includes('score_below_threshold')) rejected_reasons.push('score_below_threshold');
				return {
					...c,
					score: adjustedScore,
					rejected_reasons,
					accepted: rejected_reasons.length === 0,
				};
			})
			.concat(definitionCandidates)
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				if (a.page !== b.page) return a.page - b.page;
				const t = a.text.localeCompare(b.text);
				if (t !== 0) return t;
				return a.source_type.localeCompare(b.source_type);
			});

		const bestProduct = pickBestCandidate(productCandidates);
		if (bestProduct) {
			product_solution = bestProduct.text;
			confidence.product_solution = 'high';
			sources.product_solution = [
				{ ...bestProduct.source, text_head: sanitizeInlineText(bestProduct.raw).slice(0, 160) },
			];
		} else {
			// Tier B: softer heading extraction with fallback validation
			const found =
				findFromDeckStructure({
					docId,
					type: primary.d.type,
					pages: primary.pages,
					headings: ['about', 'mission', 'overview', 'what we do', 'solution', 'product', 'platform'],
					maxPages: 12,
				}) ??
				findFromFirstPages({ docId, pages: primary.pages, maxPages: 3 });

			if (found?.value) {
				const evaluated = evaluateFallbackCandidate(found.value);
				if (evaluated.ok) {
					product_solution = capSentence(found.value, 220);
					confidence.product_solution = 'medium';
					sources.product_solution = [
						{ ...(found.source ?? { document_id: docId, note: 'tier_b' }), text_head: sanitizeInlineText(found.value).slice(0, 160) },
					];
				}
			}

			// Tier C: if we still have nothing, pick best rejected candidate if it passes fallback rules
			if (!product_solution) {
				const bestRejected = pickBestRejectedCandidate(productCandidates);
				if (bestRejected) {
					const evaluated = evaluateFallbackCandidate(bestRejected.raw);
					if (evaluated.ok) {
						product_solution = bestRejected.text;
						confidence.product_solution = 'low';
						sources.product_solution = [
							{ ...bestRejected.source, text_head: sanitizeInlineText(bestRejected.raw).slice(0, 160), note: `${bestRejected.source.note ?? ''} tier_c` },
						];
					}
				}
			}
		}

		// DU requirement: if chosen product_solution is short (<80) or header-fragment-y, upgrade by scanning
		// nearby text for a longer coherent definition sentence (80-250 preferred) and allow comma-heavy
		// definitions.
		if (product_solution) {
			const startPageFromSource =
				(Array.isArray(sources.product_solution) && sources.product_solution[0]?.page_range?.[0])
					? sources.product_solution[0].page_range[0]
					: undefined;
			const startPage = typeof startPageFromSource === 'number' ? startPageFromSource : 1;
			const slideTitle = slideTitleByPage.get(startPage);
			if (shouldUpgradeDUProductSolution({ value: product_solution, slideTitle })) {
				const upgraded = findLongerDUProductSolutionNearby({ docId, pages: primary.pages, startPage });
				if (upgraded?.text) {
					product_solution = pickBestDUProductSentence(upgraded.text);
					confidence.product_solution = 'medium';
					sources.product_solution = [
						{ ...upgraded.source, text_head: sanitizeInlineText(product_solution).slice(0, 160) },
					];
				} else {
					const fromCandidates = findLongerDUProductSolutionFromCandidates({ candidates: productCandidates, slideTitleByPage });
					if (fromCandidates?.raw) {
						const upgradedText = pickBestDUProductSentence(fromCandidates.raw);
						product_solution = upgradedText;
						confidence.product_solution = 'medium';
						sources.product_solution = [
							{
								...fromCandidates.source,
								note: `${fromCandidates.source.note ?? ''} upgraded_from_candidates`,
								text_head: sanitizeInlineText(product_solution).slice(0, 160),
							},
						];
					}
				}
			}
		}

		const bestMarket = pickBestCandidate(marketCandidates);
		if (bestMarket) {
			market_icp = bestMarket.text;
			confidence.market_icp = 'high';
			sources.market_icp = [
				{ ...bestMarket.source, text_head: sanitizeInlineText(bestMarket.raw).slice(0, 160) },
			];
		} else {
			const found =
				findFromDeckStructure({
					docId,
					type: primary.d.type,
					pages: primary.pages,
					headings: ['who we serve', 'customers', 'target', 'built for', 'icp', 'market'],
					maxPages: 12,
				}) ??
				findFromFirstPages({ docId, pages: primary.pages, maxPages: 3 });
			if (found?.value) {
				const evaluated = evaluateFallbackCandidate(found.value);
				if (evaluated.ok && !isSentenceFragment(found.value)) {
					market_icp = capSentence(found.value, 220);
					confidence.market_icp = 'medium';
					sources.market_icp = [
						{ ...(found.source ?? { document_id: docId, note: 'tier_b' }), text_head: sanitizeInlineText(found.value).slice(0, 160) },
					];
				}
			}
			if (!market_icp) {
				const bestRejected = pickBestRejectedCandidate(marketCandidates);
				if (bestRejected) {
					const evaluated = evaluateFallbackCandidate(bestRejected.raw);
					if (evaluated.ok && !isSentenceFragment(bestRejected.raw)) {
						market_icp = bestRejected.text;
						confidence.market_icp = 'low';
						sources.market_icp = [
							{ ...bestRejected.source, text_head: sanitizeInlineText(bestRejected.raw).slice(0, 160), note: `${bestRejected.source.note ?? ''} tier_c` },
						];
					}
				}
			}
		}

		// DU upgrade: if market_icp is missing or clearly wrong (often misclassified as product text), scan
		// for ICP keyword phrases like "Realtors & Loan Officers" with mortgage/CRM/LOS context.
		const icpIsMissingOrWrong =
			!market_icp
			|| !sanitizeInlineText(market_icp)
			|| (product_solution && sanitizeInlineText(market_icp) === sanitizeInlineText(product_solution))
			|| /\bpredict\s+borrower\s+readiness\b/i.test(sanitizeInlineText(market_icp))
			|| /\bintent\s*&\s*ability\s+score\b/i.test(sanitizeInlineText(market_icp))
			|| !MARKET_SIGNAL_RE.test(sanitizeInlineText(market_icp));
		if (icpIsMissingOrWrong) {
			const upgraded = findDUMarketIcpFromKeywords({ docId, pages: primary.pages, maxPages: 12 });
			if (upgraded?.text) {
				market_icp = upgraded.text;
				confidence.market_icp = 'medium';
				sources.market_icp = [
					{ ...upgraded.source, text_head: sanitizeInlineText(upgraded.text).slice(0, 160) },
				];
			}
		}

		// Derive additional fields (raise, business model, traction, risks) deterministically from early pages.
		const raiseLine = findFirstLineMatchWithPage({
			docId,
			pages: primary.pages,
			maxPages: 10,
			re: /\b(raising|raise|seeking|funding|the\s+ask)\b|\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?\b/i,
			note: 'raise signal (page line)',
		});
		raise = (raiseLine?.value ? detectRaiseFromText(raiseLine.value) : null) ?? detectRaiseFromText(firstPagesText) ?? undefined;
		if (raise) {
			confidence.raise = 'medium';
			sources.raise = [
				{
					...(raiseLine?.source ?? { document_id: docId, note: 'raise signal (page text)' }),
					text_head: sanitizeInlineText(raiseLine?.value ?? firstPagesText).slice(0, 120),
				},
			];
		}

		const bmLine = findFirstLineMatchWithPage({
			docId,
			pages: primary.pages,
			maxPages: 12,
			re: /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens(e|ing)\b|\bservices\b|\bimplementation\b|\bconsulting\b|\be-?commerce\b|\bdtc\b/i,
			note: 'business model signal (page line)',
		});
		business_model = detectBusinessModelFromText(bmLine?.value ?? firstPagesText) ?? undefined;
		if (business_model) {
			confidence.business_model = 'medium';
			sources.business_model = [
				{
					...(bmLine?.source ?? { document_id: docId, note: 'business model signal (page text)' }),
					text_head: sanitizeInlineText(bmLine?.value ?? firstPagesText).slice(0, 120),
				},
			];
		}

		traction_signals = detectTractionSignalsFromText(firstPagesText);
		if (Array.isArray(traction_signals) && traction_signals.length > 0) {
			confidence.traction_signals = 'low';
			sources.traction_signals = [
				{ document_id: docId, note: 'traction signals (page text)', text_head: sanitizeInlineText(firstPagesText).slice(0, 120) },
			];
		}
		key_risks_detected = detectRiskSignalsFromText(firstPagesText);
		if (Array.isArray(key_risks_detected) && key_risks_detected.length > 0) {
			confidence.key_risks_detected = 'low';
			sources.key_risks_detected = [
				{ document_id: docId, note: 'risk signals (page text)', text_head: sanitizeInlineText(firstPagesText).slice(0, 120) },
			];
		}
		deal_type = raise ? 'startup_raise' : 'other';
		confidence.deal_type = 'low';

		// Deal name best-effort: first non-empty title token on page 1.
		const p1 = primary.pages[0]?.text ?? '';
		const candidateName = splitLines(p1)[0] ?? '';
		deal_name = sanitizeInlineText(candidateName);
	}

	// Full-text fallback when deck pages are absent or insufficient.
	if (!product_solution) {
		const v = findBestVerbLineFromText(combinedFullText);
		if (v) {
			product_solution = v;
			confidence.product_solution = confidence.product_solution === 'missing' ? 'low' : confidence.product_solution;
			sources.product_solution = sources.product_solution ?? [
				{ document_id: docs[0]?.document_id ?? '', note: 'full_text:verb_line', text_head: sanitizeInlineText(v).slice(0, 120) },
			].filter((s) => s.document_id);
		}
	}
	if (!market_icp) {
		const v = findBestVerbLineFromText(combinedFullText);
		if (v && /\b(built for|for|serves|customers?)\b/i.test(v) && !isSentenceFragment(v)) {
			market_icp = v;
			confidence.market_icp = confidence.market_icp === 'missing' ? 'low' : confidence.market_icp;
			sources.market_icp = sources.market_icp ?? [
				{ document_id: docs[0]?.document_id ?? '', note: 'full_text:verb_line', text_head: sanitizeInlineText(v).slice(0, 120) },
			].filter((s) => s.document_id);
		}
	}

	if (!raise && combinedFullText) {
		raise = detectRaiseFromText(combinedFullText) ?? undefined;
		if (raise) confidence.raise = 'low';
	}
	if (!business_model && combinedFullText) {
		business_model = detectBusinessModelFromText(combinedFullText) ?? undefined;
		if (business_model) confidence.business_model = 'low';
	}
	if ((!traction_signals || traction_signals.length === 0) && combinedFullText) {
		traction_signals = detectTractionSignalsFromText(combinedFullText);
		if (traction_signals.length > 0 && confidence.traction_signals === 'missing') confidence.traction_signals = 'low';
	}
	if ((!key_risks_detected || key_risks_detected.length === 0) && combinedFullText) {
		key_risks_detected = detectRiskSignalsFromText(combinedFullText);
		if (key_risks_detected.length > 0 && confidence.key_risks_detected === 'missing') confidence.key_risks_detected = 'low';
	}
	deal_type = deal_type ?? (raise ? 'startup_raise' : 'other');
	if (confidence.deal_type === 'missing') confidence.deal_type = 'low';

	return {
		deal_name: deal_name || undefined,
		product_solution: product_solution ? product_solution : null,
		market_icp: market_icp ? market_icp : null,
		raise: raise,
		business_model: business_model,
		traction_signals: Array.isArray(traction_signals) ? traction_signals : [],
		key_risks_detected: Array.isArray(key_risks_detected) ? key_risks_detected : [],
		deal_type: deal_type,
		generated_at: nowIso,
		confidence,
		sources: Object.keys(sources).length > 0 ? sources : undefined,
	};
}

function normalizeValue(v: unknown): string {
	return typeof v === 'string' ? v.trim() : '';
}

function normalizeDiffText(value: unknown): string {
	const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
	return raw
		.replace(/[\u0000-\u001F\u007F]+/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/([!?.,:;])\1+/g, '$1')
		.trim();
}

function capDiffText(value: string, max = 280): string {
	const s = normalizeDiffText(value);
	if (s.length <= max) return s;
	return s.slice(0, max - 1).trimEnd() + '…';
}

function normalizeStringList(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of list) {
		const s = normalizeDiffText(v);
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
	return out;
}

function normalizeSources(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const s of list) {
		if (!s || typeof s !== 'object') continue;
		const docId = String((s as any).document_id ?? '').trim();
		if (!docId) continue;
		const pr = (s as any).page_range;
		const tuple =
			Array.isArray(pr) && pr.length === 2 && Number.isFinite(pr[0]) && Number.isFinite(pr[1])
				? `${Math.trunc(pr[0])}-${Math.trunc(pr[1])}`
				: '';
		const key = `${docId}|${tuple}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	out.sort((a, b) => a.localeCompare(b));
	return out;
}

function normalizeCoverageSections(value: unknown): Record<string, 'present' | 'partial' | 'missing'> {
	const obj = value && typeof value === 'object' ? (value as any) : {};
	const sections = obj.sections && typeof obj.sections === 'object' ? obj.sections : obj;
	const out: Record<string, 'present' | 'partial' | 'missing'> = {};
	for (const k of Object.keys(sections ?? {})) {
		const v = String((sections as any)[k] ?? '').toLowerCase().trim();
		if (v === 'present' || v === 'partial' || v === 'missing') out[k] = v;
	}
	return out;
}

function scoreBand(score: unknown): 'low' | 'med' | 'high' | 'unknown' {
	const n = typeof score === 'number' ? score : Number.isFinite(Number(score)) ? Number(score) : NaN;
	if (!Number.isFinite(n)) return 'unknown';
	if (n >= 70) return 'high';
	if (n >= 40) return 'med';
	return 'low';
}

function compareNormalizedLists(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function diffField(out: Phase1UpdateReportV1['changes'], field: string, beforeRaw: unknown, afterRaw: unknown) {
	const before = normalizeDiffText(beforeRaw);
	const after = normalizeDiffText(afterRaw);
	if (!before && !after) return;
	if (!before && after) {
		out.push({ field, change_type: 'added', category: 'field_populated', after: capDiffText(after) });
		return;
	}
	if (before && !after) {
		out.push({ field, change_type: 'removed', category: 'field_lost', before: capDiffText(before) });
		return;
	}
	if (before !== after) {
		out.push({
			field,
			change_type: 'updated',
			category: 'field_updated',
			before: capDiffText(before),
			after: capDiffText(after),
		});
	}
}

function diffStringList(out: Phase1UpdateReportV1['changes'], field: string, beforeRaw: unknown, afterRaw: unknown) {
	const before = normalizeStringList(beforeRaw);
	const after = normalizeStringList(afterRaw);
	if (before.length === 0 && after.length === 0) return;
	if (before.length === 0 && after.length > 0) {
		out.push({ field, change_type: 'added', category: 'field_populated', after: capDiffText(after.join('; ')) });
		return;
	}
	if (before.length > 0 && after.length === 0) {
		out.push({ field, change_type: 'removed', category: 'field_lost', before: capDiffText(before.join('; ')) });
		return;
	}
	if (!compareNormalizedLists(before, after)) {
		out.push({
			field,
			change_type: 'updated',
			category: 'field_updated',
			before: capDiffText(before.join('; ')),
			after: capDiffText(after.join('; ')),
		});
	}
}

function diffSources(out: Phase1UpdateReportV1['changes'], field: string, beforeRaw: unknown, afterRaw: unknown) {
	const before = normalizeSources(beforeRaw);
	const after = normalizeSources(afterRaw);
	if (before.length === 0 && after.length === 0) return;
	if (before.length === 0 && after.length > 0) {
		out.push({ field, change_type: 'added', category: 'field_populated', after: capDiffText(after.join('; ')) });
		return;
	}
	if (before.length > 0 && after.length === 0) {
		out.push({ field, change_type: 'removed', category: 'field_lost', before: capDiffText(before.join('; ')) });
		return;
	}
	if (!compareNormalizedLists(before, after)) {
		out.push({
			field,
			change_type: 'updated',
			category: 'field_updated',
			before: capDiffText(before.join('; ')),
			after: capDiffText(after.join('; ')),
		});
	}
}

function coverageRank(v: string): number {
	if (v === 'present') return 2;
	if (v === 'partial') return 1;
	if (v === 'missing') return 0;
	return -1;
}

function computeSummaryFromChanges(params: {
	changes: Phase1UpdateReportV1['changes'];
	prevDecision?: any;
	curDecision?: any;
}): string {
	const lines: string[] = [];

	const prevRec = normalizeDiffText(params.prevDecision?.recommendation);
	const curRec = normalizeDiffText(params.curDecision?.recommendation);
	if (prevRec && curRec && prevRec !== curRec) {
		lines.push(`Recommendation changed: ${prevRec} → ${curRec}.`);
	} else {
		const prevBand = scoreBand(params.prevDecision?.score);
		const curBand = scoreBand(params.curDecision?.score);
		if (prevBand !== 'unknown' && curBand !== 'unknown' && prevBand !== curBand) {
			lines.push(`Decision score band changed: ${prevBand} → ${curBand}.`);
		}
	}

	const keyFields = ['deal_overview_v2.product_solution', 'deal_overview_v2.market_icp', 'deal_overview_v2.raise', 'deal_overview_v2.business_model'];
	const added = params.changes
		.filter((c) => c.category === 'field_populated' && keyFields.includes(c.field))
		.map((c) => c.field.split('.').pop() as string);
	const removed = params.changes
		.filter((c) => c.category === 'field_lost' && keyFields.includes(c.field))
		.map((c) => c.field.split('.').pop() as string);
	if (added.length > 0 || removed.length > 0) {
		const parts: string[] = [];
		if (added.length > 0) parts.push(`Added: ${Array.from(new Set(added)).join(', ')}`);
		if (removed.length > 0) parts.push(`Removed: ${Array.from(new Set(removed)).join(', ')}`);
		lines.push(parts.join('. ') + '.');
	}

	const coverageChanges = params.changes.filter((c) => c.category === 'coverage_changed' && c.field.startsWith('coverage.sections.'));
	if (coverageChanges.length > 0) {
		const improved: string[] = [];
		const regressed: string[] = [];
		for (const c of coverageChanges) {
			const sec = c.field.replace('coverage.sections.', '');
			const b = normalizeDiffText(c.before);
			const a = normalizeDiffText(c.after);
			if (coverageRank(a) > coverageRank(b)) improved.push(sec);
			if (coverageRank(a) < coverageRank(b)) regressed.push(sec);
		}
		const parts: string[] = [];
		if (improved.length > 0) parts.push(`Coverage improved: ${Array.from(new Set(improved)).slice(0, 3).join(', ')}`);
		if (regressed.length > 0) parts.push(`Coverage regressed: ${Array.from(new Set(regressed)).slice(0, 3).join(', ')}`);
		if (parts.length > 0) lines.push(parts.join('. ') + '.');
	}

	if (lines.length === 0) {
		return 'No changes detected.';
	}
	return lines.slice(0, 3).join('\n');
}

export function buildPhase1UpdateReportV1(params: {
	previousDio?: any | null;
	currentOverview: Phase1DealOverviewV2;
	currentPhase1?: any | null;
	docsFingerprint?: string;
	previousDocsFingerprint?: string;
	nowIso?: string;
	// Always return an object so the orchestrator can persist it deterministically.
}): Phase1UpdateReportV1 {
	const prev = params.previousDio as any;
	const previous_dio_found = !!prev;
	const prevPhase1 = prev?.dio?.phase1;
	const prevOverview = prevPhase1?.deal_overview_v2;
	const curPhase1 = params.currentPhase1 && typeof params.currentPhase1 === 'object' ? params.currentPhase1 : null;
	const curOverview = params.currentOverview;

	if (!prevPhase1 || typeof prevPhase1 !== 'object' || !prevOverview || typeof prevOverview !== 'object' || !curPhase1) {
		return {
			generated_at: params.nowIso ?? new Date().toISOString(),
			previous_dio_found,
			docs_fingerprint: params.docsFingerprint,
			previous_docs_fingerprint: params.previousDocsFingerprint,
			changes: [],
			summary: previous_dio_found
				? 'Previous DIO found but required Phase 1 slices missing; no diff computed.'
				: 'No previous DIO found; baseline run (no diff).',
			...(typeof prev?.dio_id === 'string' ? { since_dio_id: prev.dio_id } : {}),
			...(typeof prev?.analysis_version === 'number' ? { since_version: prev.analysis_version } : {}),
		};
	}

	const changes: Phase1UpdateReportV1['changes'] = [];

	// (1) deal_overview_v2 fields
	diffField(changes, 'deal_overview_v2.product_solution', prevOverview.product_solution, curOverview.product_solution);
	diffField(changes, 'deal_overview_v2.market_icp', prevOverview.market_icp, curOverview.market_icp);
	diffField(changes, 'deal_overview_v2.raise', prevOverview.raise, curOverview.raise);
	diffField(changes, 'deal_overview_v2.deal_type', prevOverview.deal_type, curOverview.deal_type);
	diffField(changes, 'deal_overview_v2.business_model', prevOverview.business_model, curOverview.business_model);
	diffStringList(changes, 'deal_overview_v2.traction_signals', prevOverview.traction_signals, curOverview.traction_signals);
	diffStringList(changes, 'deal_overview_v2.key_risks_detected', prevOverview.key_risks_detected, curOverview.key_risks_detected);
	diffSources(changes, 'deal_overview_v2.sources', prevOverview.sources, curOverview.sources);

	// (2) coverage.sections
	const prevCoverage = normalizeCoverageSections(prevPhase1?.coverage);
	const curCoverage = normalizeCoverageSections(curPhase1?.coverage);
	const sectionKeys = Array.from(new Set([...Object.keys(prevCoverage), ...Object.keys(curCoverage)])).sort();
	for (const k of sectionKeys) {
		const b = prevCoverage[k];
		const a = curCoverage[k];
		if (!b && !a) continue;
		if (b !== a) {
			changes.push({
				field: `coverage.sections.${k}`,
				change_type: b && !a ? 'removed' : !b && a ? 'added' : 'updated',
				category: 'coverage_changed',
				before: b,
				after: a,
			});
		}
	}

	// (3) decision_summary_v1 (signals only)
	const prevDecision = prevPhase1?.decision_summary_v1;
	const curDecision = curPhase1?.decision_summary_v1;
	const prevRec = normalizeDiffText(prevDecision?.recommendation);
	const curRec = normalizeDiffText(curDecision?.recommendation);
	if (prevRec && curRec && prevRec !== curRec) {
		changes.push({
			field: 'decision_summary_v1.recommendation',
			change_type: 'updated',
			category: 'decision_changed',
			before: prevRec,
			after: curRec,
		});
	}
	const prevBand = scoreBand(prevDecision?.score);
	const curBand = scoreBand(curDecision?.score);
	if (prevBand !== 'unknown' && curBand !== 'unknown' && prevBand !== curBand) {
		changes.push({
			field: 'decision_summary_v1.score_band',
			change_type: 'updated',
			category: 'decision_changed',
			before: prevBand,
			after: curBand,
		});
	}
	const prevConf = normalizeDiffText(prevDecision?.confidence);
	const curConf = normalizeDiffText(curDecision?.confidence);
	if (prevConf && curConf && prevConf !== curConf) {
		changes.push({
			field: 'decision_summary_v1.confidence',
			change_type: 'updated',
			category: 'confidence_changed',
			before: prevConf,
			after: curConf,
		});
	}
	const prevBlockers = Array.isArray(prevDecision?.blockers) ? prevDecision.blockers.length : undefined;
	const curBlockers = Array.isArray(curDecision?.blockers) ? curDecision.blockers.length : undefined;
	if (typeof prevBlockers === 'number' && typeof curBlockers === 'number' && prevBlockers !== curBlockers) {
		changes.push({
			field: 'decision_summary_v1.blockers_count',
			change_type: 'updated',
			category: 'decision_changed',
			before: String(prevBlockers),
			after: String(curBlockers),
		});
	}

	// (4) executive_summary_v2.missing
	const prevMissing = Array.isArray(prevPhase1?.executive_summary_v2?.missing) ? prevPhase1.executive_summary_v2.missing : null;
	const curMissing = Array.isArray(curPhase1?.executive_summary_v2?.missing) ? curPhase1.executive_summary_v2.missing : null;
	if (prevMissing || curMissing) {
		diffStringList(changes, 'executive_summary_v2.missing', prevMissing ?? [], curMissing ?? []);
		// Ensure this diff is categorized consistently for UI grouping.
		for (const c of changes) {
			if (c.field === 'executive_summary_v2.missing' && !c.category) c.category = 'field_updated';
		}
	}

	// (5) docs fingerprint (optional)
	const prevFp = normalizeDiffText(params.previousDocsFingerprint);
	const curFp = normalizeDiffText(params.docsFingerprint);
	if (prevFp && curFp && prevFp !== curFp) {
		changes.push({
			field: 'documents.fingerprint',
			change_type: 'updated',
			category: 'docs_changed',
			before: prevFp.slice(0, 16),
			after: curFp.slice(0, 16),
		});
	}

	return {
		generated_at: params.nowIso ?? new Date().toISOString(),
		previous_dio_found,
		docs_fingerprint: params.docsFingerprint,
		previous_docs_fingerprint: params.previousDocsFingerprint,
		since_dio_id: typeof prev?.dio_id === 'string' ? prev.dio_id : undefined,
		since_version: typeof prev?.analysis_version === 'number' ? prev.analysis_version : undefined,
		changes,
		summary: computeSummaryFromChanges({ changes, prevDecision: prevDecision, curDecision: curDecision }),
	};
}
