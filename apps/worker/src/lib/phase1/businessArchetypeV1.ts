export type BusinessArchetypeValueV1 =
	| 'saas'
	| 'consumer_product'
	| 'marketplace'
	| 'services'
	| 'fund_spv'
	| 'real_estate'
	| 'other'
	| 'unknown';

export type BusinessArchetypeEvidenceV1 = {
	document_id: string;
	page_range?: [number, number];
	snippet: string;
	rule: string;
};

export type Phase1BusinessArchetypeV1 = {
	value: BusinessArchetypeValueV1;
	confidence: number; // 0..1
	generated_at: string;
	evidence: BusinessArchetypeEvidenceV1[];
};

export type BusinessArchetypeDocumentInput = {
	document_id: string;
	title?: string | null;
	type?: string | null;
	full_text?: string | null;
	full_content?: unknown | null;
};

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
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

function snippetFromMatch(text: string, idx: number, len = 180): string {
	const s = sanitizeInlineText(text);
	if (!s) return '';
	const start = Math.max(0, idx - Math.floor(len / 3));
	const end = Math.min(s.length, idx + Math.floor((2 * len) / 3));
	const slice = s.slice(start, end).trim();
	if (!slice) return '';
	return (start > 0 ? '…' : '') + slice + (end < s.length ? '…' : '');
}

type Rule = {
	id: string;
	re: RegExp;
	weight: number;
};

type ArchetypeSpec = {
	value: BusinessArchetypeValueV1;
	rules: Rule[];
	threshold: number;
};

const ARCHETYPES: ArchetypeSpec[] = [
	{
		value: 'fund_spv',
		threshold: 30,
		rules: [
			{ id: 'fund:spv', re: /\b(spv|special\s+purpose\s+vehicle)\b/i, weight: 40 },
			{ id: 'fund:lp_gp', re: /\b(limited\s+partners?|\blp\b|\bgp\b|general\s+partner)\b/i, weight: 26 },
			{ id: 'fund:carry_fees', re: /\b(carried\s+interest|carry|management\s+fee|capital\s+call)\b/i, weight: 22 },
			{ id: 'fund:fund', re: /\b(fund\s+I|fund\s+ii|fund\s+iii|fundraise|fundraising\s+for\s+the\s+fund)\b/i, weight: 18 },
		],
	},
	{
		value: 'consumer_product',
		threshold: 28,
		rules: [
			{ id: 'cpg:cpg_sku', re: /\b(cpg|sku|skus|sell[-\s]?through|unit\s+economics)\b/i, weight: 28 },
			{ id: 'cpg:retail_wholesale', re: /\b(retail|wholesale|distributor|distribution|grocery|mass\s+market)\b/i, weight: 22 },
			{ id: 'cpg:dtc_ecom', re: /\b(dtc|d2c|e-?commerce|shopify|amazon)\b/i, weight: 18 },
			{ id: 'cpg:brand', re: /\b(brand|consumer\s+product|product\s+line)\b/i, weight: 14 },
		],
	},
	{
		value: 'marketplace',
		threshold: 26,
		rules: [
			{ id: 'mkt:marketplace', re: /\b(marketplace|two-?sided|supply\s+and\s+demand)\b/i, weight: 30 },
			{ id: 'mkt:gmv_take_rate', re: /\b(gmv|take\s+rate|transaction\s+volume)\b/i, weight: 22 },
			{ id: 'mkt:buyers_sellers', re: /\b(buyers?\s+and\s+sellers?|hosts?\s+and\s+guests?)\b/i, weight: 14 },
		],
	},
	{
		value: 'services',
		threshold: 26,
		rules: [
			{ id: 'svc:services', re: /\b(consulting|agency|implementation|professional\s+services|managed\s+services)\b/i, weight: 28 },
			{ id: 'svc:sow', re: /\b(statement\s+of\s+work|\bsow\b|retainer)\b/i, weight: 22 },
			{ id: 'svc:billable', re: /\b(billable\s+hours?|utilization|hourly\s+rate)\b/i, weight: 14 },
		],
	},
	{
		value: 'saas',
		threshold: 24,
		rules: [
			{ id: 'saas:saas', re: /\b(saas|subscription|recurring\s+revenue)\b/i, weight: 26 },
			{ id: 'saas:arr_mrr', re: /\b(arr|mrr|annual\s+recurring\s+revenue|monthly\s+recurring\s+revenue)\b/i, weight: 22 },
			{ id: 'saas:platform_api', re: /\b(platform|api|workflow|dashboard)\b/i, weight: 10 },
		],
	},
	{
		value: 'real_estate',
		threshold: 30,
		rules: [
			{ id: 're:real_estate', re: /\b(real\s+estate|property|multifamily|single\s+family|tenant)\b/i, weight: 28 },
			{ id: 're:noicap', re: /\b(noi|cap\s+rate|net\s+operating\s+income)\b/i, weight: 26 },
		],
	},
];

function scoreTextForArchetype(text: string, spec: ArchetypeSpec): { score: number; matchedRuleIds: string[] } {
	const s = sanitizeInlineText(text);
	if (!s) return { score: 0, matchedRuleIds: [] };
	let score = 0;
	const matchedRuleIds: string[] = [];
	for (const rule of spec.rules) {
		rule.re.lastIndex = 0;
		if (rule.re.test(s)) {
			score += rule.weight;
			matchedRuleIds.push(rule.id);
		}
	}
	return { score, matchedRuleIds };
}

function findEvidenceForArchetype(params: {
	doc: BusinessArchetypeDocumentInput;
	spec: ArchetypeSpec;
	maxPages: number;
	maxEvidence: number;
}): BusinessArchetypeEvidenceV1[] {
	const out: BusinessArchetypeEvidenceV1[] = [];
	const pages = extractPagesFromFullContent(params.doc.full_content ?? null, params.doc.type).slice(0, params.maxPages);

	for (const rule of params.spec.rules) {
		for (const p of pages) {
			const t = sanitizeInlineText(p.text);
			if (!t) continue;
			rule.re.lastIndex = 0;
			const m = rule.re.exec(t);
			if (!m) continue;
			const idx = m.index ?? 0;
			out.push({
				document_id: params.doc.document_id,
				page_range: [p.page, p.page],
				snippet: snippetFromMatch(t, idx),
				rule: rule.id,
			});
			break;
		}
		if (out.length >= params.maxEvidence) return out.slice(0, params.maxEvidence);
	}

	// Fallback: full_text only.
	const fullText = typeof params.doc.full_text === 'string' ? params.doc.full_text : '';
	if (fullText) {
		const t = sanitizeInlineText(fullText);
		for (const rule of params.spec.rules) {
			rule.re.lastIndex = 0;
			const m = rule.re.exec(t);
			if (!m) continue;
			out.push({
				document_id: params.doc.document_id,
				snippet: snippetFromMatch(t, m.index ?? 0),
				rule: rule.id,
			});
			if (out.length >= params.maxEvidence) break;
		}
	}

	return out.slice(0, params.maxEvidence);
}

export function buildPhase1BusinessArchetypeV1(input: {
	documents: BusinessArchetypeDocumentInput[];
	nowIso?: string;
}): Phase1BusinessArchetypeV1 {
	const nowIso = input.nowIso ?? new Date().toISOString();
	const docs = Array.isArray(input.documents) ? input.documents : [];

	// Fail-closed: if there is no text, return unknown.
	const combinedText = docs
		.flatMap((d) => {
			const chunks: string[] = [];
			if (typeof d.full_text === 'string') chunks.push(d.full_text);
			const pages = extractPagesFromFullContent(d.full_content ?? null, d.type).map((p) => p.text);
			if (pages.length) chunks.push(pages.join('\n'));
			return chunks;
		})
		.filter(Boolean)
		.join('\n\n')
		.slice(0, 60_000);

	if (!combinedText.trim()) {
		return { value: 'unknown', confidence: 0, generated_at: nowIso, evidence: [] };
	}

	const scores = ARCHETYPES.map((spec) => ({ spec, ...scoreTextForArchetype(combinedText, spec) }))
		.sort((a, b) => b.score - a.score || a.spec.value.localeCompare(b.spec.value));

	const best = scores[0];
	const second = scores[1];

	if (!best || best.score <= 0 || best.score < best.spec.threshold) {
		return { value: 'unknown', confidence: 0, generated_at: nowIso, evidence: [] };
	}

	const secondScore = second?.score ?? 0;
	const confidence = clamp01(best.score / (best.score + secondScore + 10));

	// Evidence: take from the first doc(s) that match the top archetype rules.
	const evidence: BusinessArchetypeEvidenceV1[] = [];
	for (const d of docs) {
		const pagesText = extractPagesFromFullContent(d.full_content ?? null, d.type)
			.slice(0, 12)
			.map((p) => p.text)
			.join('\n')
			.slice(0, 20_000);
		const perDoc = scoreTextForArchetype([pagesText, d.full_text ?? ''].join('\n'), best.spec);
		if (perDoc.score <= 0) continue;
		evidence.push(
			...findEvidenceForArchetype({
				doc: d,
				spec: best.spec,
				maxPages: 12,
				maxEvidence: 3 - evidence.length,
			})
		);
		if (evidence.length >= 3) break;
	}

	return {
		value: best.spec.value,
		confidence,
		generated_at: nowIso,
		evidence: evidence.slice(0, 3),
	};
}
