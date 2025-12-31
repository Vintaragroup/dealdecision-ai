type OverviewSource = {
	document_id: string;
	page_range?: [number, number];
	note?: string;
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

function isHighQualityCandidate(value: string): boolean {
	const s = sanitizeInlineText(value);
	if (s.length < 18) return false;
	if (s.length > 260) return false;
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

const PRODUCT_ANCHOR_HEADINGS = ['overview', 'what we do', 'solution', 'product', 'platform'];
const MARKET_ANCHOR_HEADINGS = ['who we serve', 'customers', 'target', 'icp', 'built for'];

const TAGLINE_VERB_RE = /\b(helps|enable[s]?|automate[s]?|provide[s]?|deliver[s]?|connect[s]?|built\s+for|platform\s+for)\b/i;

// Hard reject buckets (fail closed) for obvious non-description blocks.
const REJECT_BLOCK_RE: RegExp[] = [
	/\b(roster|lineup|talent|on\s*-?\s*air|extended\s+team|advisors?|staff)\b/i,
	/\b(schedule|season|week\s+\d+|game\s+\d+|tournament|broadcast|format|rules|scoring)\b/i,
	/\b(addendum|appendix)\b/i,
	/\b(financials?|income\s+statement|balance\s+sheet|cash\s*flow|p\s*&\s*l)\b/i,
];

type CandidateSourceType = 'anchored' | 'tagline';
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
			if (typeof p.text === 'string') parts.push(p.text);
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
			product_solution = bestProduct.text;
			sources.push(bestProduct.source);
		}

		const bestMarket = pickBestCandidate(marketCandidates);
		if (bestMarket) {
			market_icp = bestMarket.text;
			sources.push(bestMarket.source);
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
		if (raise && raiseLine?.source) sources.push(raiseLine.source);

		const bmLine = findFirstLineMatchWithPage({
			docId,
			pages: primary.pages,
			maxPages: 12,
			re: /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens(e|ing)\b|\bservices\b|\bimplementation\b|\bconsulting\b|\be-?commerce\b|\bdtc\b/i,
			note: 'business model signal (page line)',
		});
		business_model = detectBusinessModelFromText(bmLine?.value ?? firstPagesText) ?? undefined;
		if (business_model && bmLine?.source) sources.push(bmLine.source);
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
		sources: sources.length > 0 ? sources.slice(0, 8) : undefined,
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
