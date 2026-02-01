import { defaultShadowFeatureMode } from "../pipeline-policy";

type BBox = { x: number; y: number; w: number; h: number };

type PdfV2Block = {
	text: string;
	bbox: BBox;
	bbox_units?: "normalized";
};

type PdfV1Word = {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	conf: number; // 0..100
};

type PdfContentV1Like = {
	pages: Array<{
		pageNumber: number;
		text: string;
		words: PdfV1Word[];
	}>;
	pdf_v2?: unknown;
};

type PdfV2UnifiedPageLike = {
	page_index: number;
	page_number: number;
	classification?: { kind?: "text" | "scanned" };
	native?: {
		method?: string;
		text?: string;
		blocks?: PdfV2Block[];
		confidence?: number;
	};
	ocr?: {
		provider?: string;
		text?: string;
		avg_confidence?: number;
	};
	final?: { method?: "native" | "ocr" | "hybrid"; text?: string };
	understanding_v1?: unknown;
};

type PdfV2ArtifactsLike = {
	status?: "ok" | "error";
	pages?: PdfV2UnifiedPageLike[];
};

export type SlideUnderstandingMode = "off" | "shadow" | "primary";

export type SlideUnderstandingV1RegionRole = "title" | "body" | "footer" | "other";

export type SlideUnderstandingV1Region = {
	region_id: string;
	role: SlideUnderstandingV1RegionRole;
	bbox_units: "normalized";
	bbox: BBox;
	text: string;
	conf: number; // 0..1
};

export type SlideUnderstandingV1TitleCandidate = {
	text: string;
	source_region_id?: string;
	score: number;
	reasons: string[];
};

export type SlideUnderstandingV1Metric = {
	label?: string;
	value: string;
	unit?: string;
	context: string;
	conf: number; // 0..1
	source_bbox: { bbox_units: "normalized"; bbox: BBox };
	source_text: string;
};

export type SlideUnderstandingV1SlideType =
	| "problem"
	| "solution"
	| "traction"
	| "market"
	| "business_model"
	| "product"
	| "competition"
	| "go_to_market"
	| "team"
	| "financials"
	| "raise_terms"
	| "use_of_funds"
	| "risks"
	| "other";

export type SlideUnderstandingV1 = {
	version: "slide_understanding_v1";
	created_at: string;
	page_index: number;
	method: "pdfplumber" | "pymupdf" | "ocr" | "hybrid" | "native";
	text_raw: string;
	regions: SlideUnderstandingV1Region[];
	title: string;
	title_candidates: SlideUnderstandingV1TitleCandidate[];
	title_confidence: number;
	slide_type: SlideUnderstandingV1SlideType;
	slide_type_confidence: number;
	evidence_signals: string[];
	key_metrics: SlideUnderstandingV1Metric[];
	summary: string;
	summary_confidence: number;
};

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function normalizeText(s: string): string {
	return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizeBoilerplateKey(s: string): string {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9@\.\/:\-\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function looksLikeBoilerplate(s: string): boolean {
	const t = normalizeText(s).toLowerCase();
	if (!t) return true;
	if (/https?:\/\//.test(t) || /\bwww\./.test(t)) return true;
	if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return true;
	if (/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(t)) return true;
	return false;
}

function bboxUnion(a: BBox, b: BBox): BBox {
	const x0 = Math.min(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	const x1 = Math.max(a.x + a.w, b.x + b.w);
	const y1 = Math.max(a.y + a.h, b.y + b.h);
	return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function bboxArea(b: BBox): number {
	return Math.max(0, b.w) * Math.max(0, b.h);
}

type UnifiedBlock = {
	text: string;
	bbox: BBox;
	conf: number; // 0..1
	source: "native" | "ocr";
};

function normalizeOcrWords(words: PdfV1Word[]): UnifiedBlock[] {
	const cleaned = (Array.isArray(words) ? words : [])
		.map((w) => ({
			text: normalizeText(w.text),
			x: Number(w.x || 0),
			y: Number(w.y || 0),
			width: Number(w.width || 0),
			height: Number(w.height || 0),
			conf: Number(w.conf || 0),
		}))
		.filter((w) => w.text.length > 0 && w.width > 0 && w.height > 0);

	let maxX = 0;
	let maxY = 0;
	for (const w of cleaned) {
		maxX = Math.max(maxX, w.x + w.width);
		maxY = Math.max(maxY, w.y + w.height);
	}
	const denomX = maxX > 0 ? maxX : 1;
	const denomY = maxY > 0 ? maxY : 1;

	return cleaned.map((w) => ({
		text: w.text,
		bbox: {
			x: clamp01(w.x / denomX),
			y: clamp01(w.y / denomY),
			w: clamp01(w.width / denomX),
			h: clamp01(w.height / denomY),
		},
		conf: clamp01(w.conf / 100),
		source: "ocr",
	}));
}

function normalizeNativeBlocks(blocks: PdfV2Block[] | undefined): UnifiedBlock[] {
	return (Array.isArray(blocks) ? blocks : [])
		.map((b) => ({
			text: normalizeText(b.text),
			bbox: {
				x: clamp01(Number(b.bbox?.x ?? 0)),
				y: clamp01(Number(b.bbox?.y ?? 0)),
				w: clamp01(Number(b.bbox?.w ?? 0)),
				h: clamp01(Number(b.bbox?.h ?? 0)),
			},
		}))
		.filter((b) => b.text.length > 0 && b.bbox.w > 0 && b.bbox.h > 0)
		.map((b) => ({ ...b, conf: 1, source: "native" as const }));
}

function compactTextFromBlocks(blocks: UnifiedBlock[], maxChars = 4000): string {
	const s = blocks
		.slice()
		.sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x))
		.map((b) => b.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (s.length <= maxChars) return s;
	return s.slice(0, maxChars - 1).trim() + "…";
}

function computeBoilerplateSet(pages: Array<{ titleText: string; footerText: string }>, processedPages: number): Set<string> {
	const freq: Record<string, number> = {};
	for (const p of pages) {
		for (const s of [p.titleText, p.footerText]) {
			const key = normalizeBoilerplateKey(s);
			if (!key) continue;
			freq[key] = (freq[key] || 0) + 1;
		}
	}
	// Require repetition across pages to count as boilerplate.
	// Otherwise, 1-page docs would incorrectly treat every string as boilerplate.
	const threshold = Math.max(2, Math.ceil(processedPages * 0.4));
	const out = new Set<string>();
	for (const [k, count] of Object.entries(freq)) {
		if (count >= threshold) out.add(k);
	}
	return out;
}

function clusterIntoRegions(blocks: UnifiedBlock[], boilerplate: Set<string>): SlideUnderstandingV1Region[] {
	const sorted = blocks
		.filter((b) => !looksLikeBoilerplate(b.text))
		.slice()
		.sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x));

	const titleBlocks = sorted.filter((b) => b.bbox.y <= 0.25);
	const footerBlocks = sorted.filter((b) => b.bbox.y >= 0.85);
	const bodyBlocks = sorted.filter((b) => b.bbox.y > 0.25 && b.bbox.y < 0.85);

	const mkRegion = (region_id: string, role: SlideUnderstandingV1RegionRole, regionBlocks: UnifiedBlock[]): SlideUnderstandingV1Region => {
		let bbox: BBox = { x: 0, y: 0, w: 1, h: 1 };
		let conf = 0;
		let text = "";
		if (regionBlocks.length) {
			bbox = regionBlocks.reduce((acc, b) => bboxUnion(acc, b.bbox), regionBlocks[0].bbox);
			conf = clamp01(regionBlocks.reduce((sum, b) => sum + b.conf, 0) / regionBlocks.length);
			text = regionBlocks
				.slice()
				.sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x))
				.map((b) => b.text)
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();
		}
		if (boilerplate.has(normalizeBoilerplateKey(text))) {
			text = "";
			conf = 0;
		}
		return { region_id, role, bbox_units: "normalized", bbox, text, conf };
	};

	const regions: SlideUnderstandingV1Region[] = [];
	regions.push(mkRegion("r_title", "title", titleBlocks));

	// Body clustering into 1-10 regions (combined with title/footer to stay <= 12)
	const body = (() => {
		if (!bodyBlocks.length) return [];
		const cx = bodyBlocks.map((b) => b.bbox.x + b.bbox.w / 2);
		const left = cx.filter((x) => x < 0.45).length / Math.max(1, cx.length);
		const right = cx.filter((x) => x > 0.55).length / Math.max(1, cx.length);
		const twoCols = left >= 0.2 && right >= 0.2;

		type Band = { blocks: UnifiedBlock[]; col: "left" | "right" | "single" };
		const makeBands = (colBlocks: UnifiedBlock[], col: Band["col"]): Band[] => {
			const out: Band[] = [];
			const sortedCol = colBlocks.slice().sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x));
			let current: UnifiedBlock[] = [];
			let lastY = -1;
			for (const b of sortedCol) {
				const y = b.bbox.y;
				const gap = lastY >= 0 ? y - lastY : 0;
				if (current.length && gap > 0.06) {
					out.push({ blocks: current, col });
					current = [];
				}
				current.push(b);
				lastY = y;
			}
			if (current.length) out.push({ blocks: current, col });
			return out;
		};

		let bands: Band[] = [];
		if (twoCols) {
			const leftBlocks = bodyBlocks.filter((b) => (b.bbox.x + b.bbox.w / 2) < 0.5);
			const rightBlocks = bodyBlocks.filter((b) => (b.bbox.x + b.bbox.w / 2) >= 0.5);
			bands = [...makeBands(leftBlocks, "left"), ...makeBands(rightBlocks, "right")];
		} else {
			bands = makeBands(bodyBlocks, "single");
		}

		// Merge tiny bands to avoid explosion
		bands.sort((a, b) => (a.blocks[0]?.bbox.y ?? 0) - (b.blocks[0]?.bbox.y ?? 0));
		const merged: Band[] = [];
		for (const band of bands) {
			const area = band.blocks.reduce((sum, b) => sum + bboxArea(b.bbox), 0);
			if (!merged.length) {
				merged.push(band);
				continue;
			}
			if (area < 0.005 && merged.length) {
				merged[merged.length - 1].blocks.push(...band.blocks);
				continue;
			}
			merged.push(band);
		}

		// Cap body regions to 10 to leave room for title/footer
		const cap = 10;
		return merged.slice(0, cap);
	})();

	for (let i = 0; i < body.length; i += 1) {
		regions.push(mkRegion(`r_body_${i + 1}`, "body", body[i].blocks));
	}

	regions.push(mkRegion("r_footer", "footer", footerBlocks));

	// Ensure 3-12 regions by merging empties and trimming
	let nonEmpty = regions.filter((r) => r.text.trim().length > 0);
	if (nonEmpty.length < 3) {
		// If title/footer empty, promote early body text into title, and keep placeholders.
		// Keep region count stable for downstream auditing.
		nonEmpty = regions;
	}

	let out = regions;
	if (out.length > 12) {
		// Merge smallest regions into nearest by y until <= 12
		while (out.length > 12) {
			const candidates = out
				.map((r, idx) => ({ idx, area: bboxArea(r.bbox), empty: r.text.trim().length === 0 }))
				.filter((c) => !out[c.idx].region_id.startsWith("r_title") && !out[c.idx].region_id.startsWith("r_footer"));
			candidates.sort((a, b) => (a.empty === b.empty ? a.area - b.area : a.empty ? -1 : 1));
			const pick = candidates[0];
			if (!pick) break;
			const victim = out[pick.idx];
			// Find nearest region by vertical proximity
			let bestIdx = -1;
			let bestDist = Number.POSITIVE_INFINITY;
			for (let j = 0; j < out.length; j += 1) {
				if (j === pick.idx) continue;
				const d = Math.abs(out[j].bbox.y - victim.bbox.y);
				if (d < bestDist) {
					bestDist = d;
					bestIdx = j;
				}
			}
			if (bestIdx >= 0) {
				out[bestIdx] = {
					...out[bestIdx],
					bbox: bboxUnion(out[bestIdx].bbox, victim.bbox),
					text: normalizeText([out[bestIdx].text, victim.text].filter(Boolean).join(" ")),
					conf: clamp01((out[bestIdx].conf + victim.conf) / 2),
				};
			}
			out.splice(pick.idx, 1);
		}
	}

	// Final guarantee: if still < 3, add stable empties
	while (out.length < 3) {
		out.push({ region_id: `r_pad_${out.length + 1}`, role: "other", bbox_units: "normalized", bbox: { x: 0, y: 0, w: 1, h: 1 }, text: "", conf: 0 });
	}

	return out;
}

function isLikelyTitleText(title: string): { ok: boolean; reasons: string[] } {
	const reasons: string[] = [];
	const t = normalizeText(title);
	if (!t) return { ok: false, reasons: ["empty"] };
	if (t.length < 8) return { ok: false, reasons: ["too_short"] };
	if (t.length > 140) return { ok: false, reasons: ["too_long"] };
	if (looksLikeBoilerplate(t)) return { ok: false, reasons: ["boilerplate"] };
	if (!/\b[a-zA-Z]{3,}\b/.test(t)) reasons.push("few_alpha_words");
	const weird = (t.match(/[\]\[\)\(\{\}\|<>\\]/g) || []).length;
	if (weird >= 2) return { ok: false, reasons: ["weird_punct"] };
	return { ok: true, reasons };
}

function selectTitle(regions: SlideUnderstandingV1Region[], boilerplate: Set<string>): { title: string; candidates: SlideUnderstandingV1TitleCandidate[]; confidence: number } {
	const cands: SlideUnderstandingV1TitleCandidate[] = [];

	const pushCandidate = (text: string, sourceRegionId?: string, base = 0.6, reason?: string) => {
		const t = normalizeText(text);
		if (!t) return;
		const key = normalizeBoilerplateKey(t);
		if (key && boilerplate.has(key)) return;
		const { ok, reasons } = isLikelyTitleText(t);
		if (!ok) return;
		let score = base;
		if (/[A-Z]{3,}/.test(t)) score -= 0.05;
		if ((t.match(/[0-9]/g) || []).length > (t.length * 0.25)) score -= 0.1;
		if (reason) reasons.push(reason);
		cands.push({ text: t, source_region_id: sourceRegionId, score: clamp01(score), reasons });
	};

	const titleRegion = regions.find((r) => r.role === "title");
	if (titleRegion?.text) pushCandidate(titleRegion.text, titleRegion.region_id, 0.92, "from_title_region");

	const bodyRegions = regions.filter((r) => r.role === "body" && r.text);
	if (bodyRegions[0]?.text) {
		const firstLine = normalizeText(bodyRegions[0].text).split(/(?<=[.!?])\s+/)[0];
		pushCandidate(firstLine, bodyRegions[0].region_id, 0.72, "from_body_region");
	}

	// Fallback: find any short, high-conf region near top
	const topCandidates = regions
		.filter((r) => r.text && r.bbox.y <= 0.35)
		.sort((a, b) => (b.conf - a.conf) || (a.bbox.y - b.bbox.y));
	for (const r of topCandidates.slice(0, 3)) {
		pushCandidate(r.text, r.region_id, 0.68, "top_region_fallback");
	}

	cands.sort((a, b) => b.score - a.score);
	const best = cands[0];
	return {
		title: best?.text || "",
		candidates: cands.slice(0, 8),
		confidence: best ? clamp01(0.55 + best.score * 0.45) : 0,
	};
}

type SlideRule = {
	id: string;
	type: SlideUnderstandingV1SlideType;
	score: number;
	patterns: RegExp[];
};

function hasFinancingContext(text: string): boolean {
	const t = normalizeText(text).toLowerCase();
	if (!t) return false;

	// Core financing terms
	if (/(\braise\b|\braising\b|\bfund(ing|raise)\b|\binvest(ment|ors?)\b|\blead\s+invest(or|ment)\b)/i.test(t)) return true;
	if (/(\bvaluation\b|\bpre[- ]?money\b|\bpost[- ]?money\b|\bterm\s*sheet\b|\bcap\s*table\b|\bcaptable\b)/i.test(t)) return true;
	if (/(\bdilution\b|\bownership\b|\bequity\b|\bconvertible\b|\bnote\b|\bsafe\b|\bdebentures?\b)/i.test(t)) return true;

	// Dollar amounts can contribute only if they're near financing terms.
	// This avoids treating arbitrary budgets or sports amounts as raise terms.
	const hasDollar = /(?:\bUSD\b\s*\$?|\$)\s*-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?/i.test(t);
	if (hasDollar) {
		const financeNear = /(\braise\b|\braising\b|\bfunding\b|\bvaluation\b|\bpre[- ]?money\b|\bpost[- ]?money\b|\bcap\s*table\b|\bterm\s*sheet\b|\bequity\b|\bsafe\b|\bconvertible\b|\bnote\b|\binvestors?\b)/i;
		if (financeNear.test(t)) return true;
	}

	return false;
}

function isSportsOpeningRoundContext(text: string): boolean {
	const t = normalizeText(text).toLowerCase();
	if (!t) return false;
	if (!/\bopening\s+round\b/i.test(t)) return false;
	// Common sports/bracket language
	return /(\bplayoffs?\b|\bseason\b|\bmatch\b|\bgame\b|\bteam\b|\bleague\b|\bchampionship\b|\btournament\b|\bbracket\b|\bvs\b|\bscore\b|\bovertime\b)/i.test(t);
}

const SLIDE_RULES: SlideRule[] = [
	{ id: "use_of_funds_phrase", type: "use_of_funds", score: 3, patterns: [/use of funds/i, /use\s+of\s+proceeds/i, /allocation of/i] },
	// NOTE: "round" is intentionally excluded here; it's gated separately to avoid false positives like "opening round".
	{ id: "raise_terms_phrase", type: "raise_terms", score: 3, patterns: [/terms/i, /valuation/i, /pre-?money/i, /post-?money/i, /cap table/i, /term\s*sheet/i, /dilution/i, /\bsafe\b/i, /convertible/i, /\bnote\b/i, /\bequity\b/i, /investors?/i, /lead\s+invest(or|ment)/i] },
	// Funding round tokens can contribute ONLY if there is explicit financing context on the same page.
	{ id: "raise_terms_round_token", type: "raise_terms", score: 2, patterns: [/\bseed\b/i, /\bseries\s*[a-e]\b/i, /\bround\b/i] },
	{ id: "financials_tokens", type: "financials", score: 3, patterns: [/revenue/i, /arr\b/i, /mrr\b/i, /ebitda/i, /gross margin/i, /burn/i, /runway/i, /cash/i, /income statement/i, /p\s*&\s*l/i] },
	{ id: "team_tokens", type: "team", score: 2, patterns: [/team/i, /founder/i, /ceo/i, /cto/i, /cfo/i, /leadership/i, /advisors?/i] },
	{ id: "traction_tokens", type: "traction", score: 2, patterns: [/traction/i, /growth/i, /customers?/i, /users?/i, /retention/i, /churn/i, /nrr\b|ndr\b/i] },
	{ id: "market_tokens", type: "market", score: 2, patterns: [/tam\b/i, /sam\b/i, /som\b/i, /market size/i, /market opportunity/i] },
	{ id: "problem_tokens", type: "problem", score: 2, patterns: [/problem/i, /pain point/i, /challenge/i] },
	{ id: "solution_tokens", type: "solution", score: 2, patterns: [/solution/i, /our approach/i, /we solve/i] },
	{ id: "product_tokens", type: "product", score: 2, patterns: [/product/i, /platform/i, /features?/i, /demo/i] },
	{ id: "competition_tokens", type: "competition", score: 2, patterns: [/competition/i, /competitors?/i, /vs\.?/i, /differentiation/i] },
	{ id: "gtm_tokens", type: "go_to_market", score: 2, patterns: [/go to market/i, /gtm\b/i, /distribution/i, /sales\s+strategy/i, /marketing/i] },
	{ id: "business_model_tokens", type: "business_model", score: 2, patterns: [/business model/i, /how we make money/i, /pricing/i, /unit economics/i] },
	{ id: "risks_tokens", type: "risks", score: 2, patterns: [/risks?/i, /mitigation/i, /regulatory/i, /compliance/i] },
];

function classifySlideType(text: string): { slide_type: SlideUnderstandingV1SlideType; confidence: number; signals: string[] } {
	const t = normalizeText(text).toLowerCase();
	if (!t) return { slide_type: "other", confidence: 0, signals: [] };

	const hasFinance = hasFinancingContext(t);
	const sportsOpeningRound = isSportsOpeningRoundContext(t);

	const scores = new Map<SlideUnderstandingV1SlideType, number>();
	const signals: string[] = [];
	for (const rule of SLIDE_RULES) {
		// Gate round/seed/series tokens behind explicit financing context.
		if (rule.id === "raise_terms_round_token" && !hasFinance) continue;
		let hit = 0;
		for (const p of rule.patterns) {
			if (p.test(t)) hit += 1;
		}
		if (hit > 0) {
			scores.set(rule.type, (scores.get(rule.type) || 0) + rule.score * hit);
			signals.push(rule.id);
		}
	}

	let bestType: SlideUnderstandingV1SlideType = "other";
	let bestScore = 0;
	for (const [k, v] of scores.entries()) {
		if (v > bestScore) {
			bestScore = v;
			bestType = k;
		}
	}

	if (bestScore <= 0) return { slide_type: "other", confidence: 0.3, signals: [] };

	// Optional negative guard: sports bracket language should not be interpreted as fundraising.
	// If we matched raise_terms purely from round/bracket language (no financing context), block it.
	if (bestType === "raise_terms" && sportsOpeningRound && !hasFinance) {
		return { slide_type: "other", confidence: 0.35, signals: signals.filter((s) => s !== "raise_terms_round_token") };
	}

	return {
		slide_type: bestType,
		confidence: clamp01(0.45 + Math.min(0.55, bestScore / 10)),
		signals,
	};
}

const METRIC_LABELS = ["arr", "mrr", "cac", "ltv", "gm", "gm%", "gross margin", "churn", "retention", "nrr", "ndr", "ebitda", "noi", "runway", "burn", "users", "customers", "stores", "locations"];

function inferLabel(window: string): string | undefined {
	const w = window.toLowerCase();
	for (const key of METRIC_LABELS) {
		const re = new RegExp(`\\b${key.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\b`, "i");
		if (re.test(w)) return key;
	}
	return undefined;
}

function extractMetricsFromRegions(regions: SlideUnderstandingV1Region[]): SlideUnderstandingV1Metric[] {
	const out: SlideUnderstandingV1Metric[] = [];
	const seen = new Set<string>();

	const push = (m: SlideUnderstandingV1Metric) => {
		const key = `${m.label || ""}::${m.value}::${m.unit || ""}::${normalizeBoilerplateKey(m.context)}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(m);
	};

	// Currency: require a $ symbol or an explicit USD prefix to avoid matching arbitrary integers like "3" in "3ICE".
	const currencyRe = /(?:\bUSD\b\s*\$?|\$)\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)(\s*(?:K|M|B|MM|BN|million|billion))?/gi;
	// Avoid \b after % (not a word char) so matches like "70%" are captured.
	const percentRe = /(\d{1,3}(?:\.\d+)?\s*%)|(\d{1,3}\s*[–-]\s*\d{1,3}\s*%)/gi;
	const yearRe = /\b(19|20)\d{2}\b/g;
	// Unitized metrics (bounded): value near a known metric label.
	const unitizedRe = /(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:K|M|B)?)\s*(ARR|MRR|CAC|LTV|GM%|GM|EBITDA|NOI|users?|customers?|stores?|locations?)\b/gi;

	for (const r of regions) {
		const text = r.text || "";
		if (!text) continue;
		const clean = text.replace(/\s+/g, " ");

		const run = (re: RegExp, unitHint?: string) => {
			let m: RegExpExecArray | null;
			re.lastIndex = 0;
			while ((m = re.exec(clean))) {
				const raw = m[0];
				const idx = m.index;
				const window = clean.slice(Math.max(0, idx - 40), Math.min(clean.length, idx + raw.length + 40));
				const label = inferLabel(window);
				const unit = unitHint || (label && label.includes("%") ? "%" : undefined);
				const conf = clamp01(0.55 + (label ? 0.2 : 0) + (r.role === "body" ? 0.05 : 0));
				push({
					label,
					value: normalizeText(raw),
					unit,
					context: normalizeText(window),
					conf,
					source_bbox: { bbox_units: "normalized", bbox: r.bbox },
					source_text: r.text,
				});
				if (out.length >= 25) return;
			}
		};

		run(currencyRe, "$");
		if (out.length >= 25) break;
		run(percentRe, "%");
		if (out.length >= 25) break;
		run(yearRe, "year");
		if (out.length >= 25) break;
		run(unitizedRe);
		if (out.length >= 25) break;
	}

	return out;
}

function buildSummary(
	params: {
		title: string;
		slide_type: SlideUnderstandingV1SlideType;
		metrics: SlideUnderstandingV1Metric[];
		regions: SlideUnderstandingV1Region[];
	}
): { summary: string; confidence: number } {
	const title = normalizeText(params.title);
	const metrics = params.metrics.slice(0, 4);
	const metricBits = metrics.map((m) => m.value).filter(Boolean);
	const body = params.regions
		.filter((r) => r.role === "body" && r.text)
		.sort((a, b) => a.bbox.y - b.bbox.y)
		.map((r) => r.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

	const bodySnippet = body.length > 220 ? body.slice(0, 217).trim() + "…" : body;

	let s1 = "";
	if (params.slide_type !== "other") {
		s1 = title
			? `Slide focuses on ${params.slide_type.replace(/_/g, " ")}: ${title}.`
			: `Slide focuses on ${params.slide_type.replace(/_/g, " ")}.`;
	} else {
		s1 = title ? `Slide: ${title}.` : "Slide summary.";
	}

	let s2 = "";
	if (metricBits.length) {
		s2 = `Key figures mentioned: ${metricBits.join(", ")}.`;
	}

	let s3 = "";
	if (bodySnippet) {
		s3 = bodySnippet;
		// keep it sentence-like and bounded
		if (s3.length > 0 && !/[.!?]$/.test(s3)) s3 += ".";
	}

	const summary = [s1, s2, s3].filter((x) => normalizeText(x).length > 0).join(" ").trim();
	const confidence = clamp01(0.35 + (title ? 0.25 : 0) + (bodySnippet ? 0.2 : 0) + (metricBits.length ? 0.2 : 0));
	return { summary, confidence };
}

function getPdfV2Artifacts(pdf: PdfContentV1Like): PdfV2ArtifactsLike | null {
	const v = (pdf as any)?.pdf_v2;
	if (!v || typeof v !== "object") return null;
	return v as PdfV2ArtifactsLike;
}

function resolveMethod(page: PdfV2UnifiedPageLike): SlideUnderstandingV1["method"] {
	const final = page.final?.method;
	if (final === "ocr") return "ocr";
	if (final === "hybrid") return "hybrid";
	if (final === "native") {
		const nm = String(page.native?.method || "native").toLowerCase();
		if (nm.includes("pdfplumber")) return "pdfplumber";
		if (nm.includes("pymupdf")) return "pymupdf";
		return "native";
	}
	// fallback
	return "native";
}

export function applySlideUnderstandingV1Shadow(pdf: PdfContentV1Like, opts?: { now?: string }): { applied: boolean } {
	const mode = String(process.env.PDF_SLIDE_UNDERSTANDING_MODE || defaultShadowFeatureMode(process.env))
		.trim()
		.toLowerCase() as SlideUnderstandingMode;
	if (mode !== "shadow") return { applied: false };

	const v2 = getPdfV2Artifacts(pdf);
	if (!v2 || v2.status !== "ok" || !Array.isArray(v2.pages)) return { applied: false };

	const now = opts?.now || new Date().toISOString();
	const pages = v2.pages;

	// Precompute per-page title/footer texts for boilerplate detection.
	const preRegions = pages.map((p) => {
		const nativeBlocks = normalizeNativeBlocks(p.native?.blocks);
		const v1Page = pdf.pages?.[p.page_index];
		const ocrBlocks = v1Page?.words?.length ? normalizeOcrWords(v1Page.words) : [];
		const blocks = nativeBlocks.length ? nativeBlocks : ocrBlocks;
		const tempRegions = clusterIntoRegions(blocks, new Set());
		const titleText = tempRegions.find((r) => r.role === "title")?.text || "";
		const footerText = tempRegions.find((r) => r.role === "footer")?.text || "";
		return { titleText, footerText };
	});
	const boilerplate = computeBoilerplateSet(preRegions, pages.length);

	for (const p of pages) {
		if (p.understanding_v1 && typeof p.understanding_v1 === "object") {
			// Don't overwrite if already present.
			continue;
		}

		const nativeBlocks = normalizeNativeBlocks(p.native?.blocks);
		const v1Page = pdf.pages?.[p.page_index];
		const ocrBlocks = v1Page?.words?.length ? normalizeOcrWords(v1Page.words) : [];
		const preferNative = nativeBlocks.length > 0;
		const blocks = preferNative ? nativeBlocks : ocrBlocks;

		const regions = clusterIntoRegions(blocks, boilerplate);
		const titleSel = selectTitle(regions, boilerplate);

		const textRaw = normalizeText(p.final?.text || p.native?.text || v1Page?.text || compactTextFromBlocks(blocks));
		const combinedForType = normalizeText([titleSel.title, regions.filter((r) => r.role === "body").map((r) => r.text).join(" ")].join(" "));
		const typeRes = classifySlideType(combinedForType);

		const metrics = extractMetricsFromRegions(regions);
		const sum = buildSummary({ title: titleSel.title, slide_type: typeRes.slide_type, metrics, regions });

		const understanding: SlideUnderstandingV1 = {
			version: "slide_understanding_v1",
			created_at: now,
			page_index: p.page_index,
			method: resolveMethod(p),
			text_raw: textRaw,
			regions,
			title: titleSel.title,
			title_candidates: titleSel.candidates,
			title_confidence: titleSel.confidence,
			slide_type: typeRes.slide_type,
			slide_type_confidence: typeRes.confidence,
			evidence_signals: typeRes.signals,
			key_metrics: metrics,
			summary: sum.summary,
			summary_confidence: sum.confidence,
		};

		(p as any).understanding_v1 = understanding;
	}

	return { applied: true };
}
