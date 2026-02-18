import type { Pool } from "pg";
import { segmentDpuPage } from "./segment-dpu-page";

type DpuRow = {
	document_id: string;
	page_index: number;
	payload: any;
};

type SlideRow = {
	row: DpuRow;
	slideText: string;
	slideTitle: string | null;
	slide_number: number | null;
	segment_key: string | null;
	structured_segment_key_raw: string | null;
	segment_reason: {
		rules_hit: string[];
		keywords_hit: string[];
		classifier_confidence: number | null;
		source: "deterministic";
	};
	bullets: string[];
	extracted_at: string;
};

type RevenueScope = 'company_financials_table' | 'company_total' | 'channel_attributed';

export type BusinessModelEvidenceRole = "primary" | "supporting" | "excluded";

export type BusinessModelEvidenceAssessment = {
	role: BusinessModelEvidenceRole;
	exclusion_reason: string | null;
	primary_signals: string[];
	supporting_signals: string[];
};

export type BusinessModelEvidenceRef = {
	document_id: string;
	page_index: number;
	slide_title: string | null;
	segment_key: string | null;
};

export type DerivedPromotedFactRow = {
	evidence_id: string;
	deal_id: string;
	source_type: string;
	source_path: string;
	source_document_id: string | null;
	confidence: number;
	extracted_at: string;
	content_json: any;
	meta: any;
};

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	return code === "42P01";
}

const asNonEmptyString = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v.trim() : null;

const normalizeText = (raw: string): string => raw.replace(/\s+/g, " ").trim();

function extractSlideNumberFromPayload(payload: any): number | null {
	const structured = payload?.structured ?? null;
	const source = payload?.source ?? null;

	const candidates = [
		structured?.slide_number,
		structured?.ppt_slide_number,
		source?.slide_number,
		source?.ppt_slide_number,
		source?.ppt_slide,
		payload?.slide_number,
		payload?.ppt_slide_number,
	];

	for (const v of candidates) {
		const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

function buildSlideTextFromPayload(payload: any): { text: string; slide_title: string | null; segment_key: string | null; bullets: string[] } {
	const structured = payload?.structured ?? null;
	const textBlocks = payload?.text_blocks ?? null;

	const slide_title =
		asNonEmptyString(structured?.title) ??
		asNonEmptyString(structured?.slide_title) ??
		asNonEmptyString(textBlocks?.title) ??
		null;

	const bullets: string[] = Array.isArray(structured?.bullets)
		? structured.bullets.filter((b: any) => typeof b === "string").map((b: string) => b.trim()).filter(Boolean)
		: Array.isArray(textBlocks?.bullets)
			? textBlocks.bullets.filter((b: any) => typeof b === "string").map((b: string) => b.trim()).filter(Boolean)
			: [];

	const notes = asNonEmptyString(structured?.notes) ?? asNonEmptyString(textBlocks?.notes) ?? null;
	const snippet = asNonEmptyString(structured?.text_snippet) ?? asNonEmptyString(textBlocks?.text_snippet) ?? null;
	const pageText = asNonEmptyString(payload?.page_text) ?? null;
	const normalized = asNonEmptyString(payload?.normalized_text) ?? null;
	const segment_key = asNonEmptyString(structured?.segment_key) ?? null;

	const parts = [slide_title, bullets.join("\n"), notes, snippet, pageText, normalized]
		.filter((p) => typeof p === "string" && p.trim());
	return { text: normalizeText(parts.join("\n")), slide_title, segment_key, bullets };
}

function classifyBusinessModelEvidence(input: {
	slide_title: string | null;
	segment_key: string | null;
	bullets: string[];
	text: string;
}): BusinessModelEvidenceAssessment {
	const title = String(input.slide_title ?? "").trim();
	const titleLower = title.toLowerCase();
	const seg = String(input.segment_key ?? "").trim().toLowerCase();
	const textLower = String(input.text ?? "").toLowerCase();
	const bullets = Array.isArray(input.bullets) ? input.bullets : [];
	const bulletsJoined = bullets.join("\n");
	const bulletsLower = bulletsJoined.toLowerCase();

	// Some decks express their business model primarily through revenue line items (e.g. media rights, sponsorships).
	// Those often appear on slides that otherwise look like "financials". We allow those through.
	const allowsFinancialBusinessModel =
		/\b(media\s+rights?|sponsorships?|title\s+sponsorship|licens(?:e|ing|ed))\b/i.test(textLower) &&
		/\brevenues?\b/i.test(textLower);

	const exclusionRules: Array<{ reason: string; hit: boolean }> = [
		{
			reason: "team_advisors_hiring",
			hit:
				seg === "team" ||
				titleLower.includes("team") ||
				titleLower.includes("advisors") ||
				titleLower.includes("advisory") ||
				titleLower.includes("leadership") ||
				titleLower.includes("founder") ||
				titleLower.includes("founders") ||
				titleLower.includes("hiring") ||
				titleLower.includes("careers") ||
				titleLower.includes("join the team") ||
				titleLower.includes("org chart"),
		},
		{
			reason: "financial_only",
			hit:
				seg === "financials" ||
				titleLower.includes("financial") ||
				titleLower.includes("projections") ||
				titleLower.includes("forecast") ||
				titleLower.includes("unit economics") ||
				titleLower.includes("income statement") ||
				titleLower.includes("cash flow") ||
				titleLower.includes("balance sheet") ||
				titleLower.includes("runway") ||
				titleLower.includes("valuation") ||
				titleLower.includes("cap table"),
		},
		{
			reason: "equipment_ops_only",
			hit:
				seg === "operations" ||
				titleLower.includes("operations") ||
				titleLower.includes("manufacturing") ||
				titleLower.includes("supply chain") ||
				titleLower.includes("logistics") ||
				titleLower.includes("facility") ||
				titleLower.includes("equipment") ||
				titleLower.includes("process") ||
				titleLower.includes("production"),
		},
		{
			reason: "opportunity_vision",
			hit:
				titleLower.includes("opportunity") ||
				titleLower.includes("vision") ||
				titleLower.includes("mission") ||
				titleLower.includes("why now") ||
				titleLower.includes("market opportunity") ||
				titleLower.includes("problem") ||
				titleLower.includes("solution") ||
				titleLower.includes("the future"),
		},
	];

	const exclusion = exclusionRules.find((r) => r.hit);
	if (exclusion) {
		// Override: allow financial slides through if they contain explicit business-model revenue lines.
		if (exclusion.reason === 'financial_only' && allowsFinancialBusinessModel) {
			// continue
		} else {
		return { role: "excluded", exclusion_reason: exclusion.reason, primary_signals: [], supporting_signals: [] };
		}
	}

	const channelTokens = [
		"direct to consumer",
		"dtc",
		"ecommerce",
		"e-commerce",
		"shopify",
		"online sales",
		"website sales",
		"wholesale",
		"retail",
		"retailer",
		"retailers",
		"brick and mortar",
		"brick & mortar",
		"b2b",
		"b2c",
		"distributor",
		"distribution",
		"channel",
		"channels",
		"licensing",
		"license",
		"partners",
		"partnership",
	];

	const isChannelReferential = channelTokens.some((t) => textLower.includes(t) || bulletsLower.includes(t) || titleLower.includes(t));

	const primaryTitleKeywords = [
		"business model",
		"go to market",
		"go-to-market",
		"gtm",
		"distribution",
		"route to market",
		"routes to market",
		"channel strategy",
		"channels",
		"pricing",
	];
	const hasPrimaryTitleKeyword = primaryTitleKeywords.some((k) => titleLower.includes(k));

	const primarySegmentKeys = new Set(["business_model", "go_to_market", "distribution", "pricing"]);
	const hasPrimarySegmentKey = seg ? primarySegmentKeys.has(seg) : false;

	const hasChannelBulletStructure = bullets.some((b) => {
		const s = String(b).trim().toLowerCase();
		if (!s) return false;
		if (s.startsWith("channels:") || s.startsWith("channel:") || s.startsWith("distribution:") || s.startsWith("route to market")) return true;
		// Common pattern: list-style bullet that is mostly channels
		const hasAny = ["dtc", "wholesale", "retail", "licens"].some((t) => s.includes(t));
		const hasVerb = ["sell", "selling", "sold", "via", "through"].some((t) => s.includes(t));
		return hasAny && hasVerb;
	});

	const primary_signals: string[] = [];
	const supporting_signals: string[] = [];
	if (hasPrimaryTitleKeyword) primary_signals.push("title_keyword");
	if (hasPrimarySegmentKey) primary_signals.push("segment_key");
	if (hasChannelBulletStructure) primary_signals.push("channel_bullet_structure");

	// Revenue line-item business model (common in media/sports decks).
	// Treat as primary evidence even when the slide is otherwise "financial".
	if (allowsFinancialBusinessModel) primary_signals.push('revenue_line_items');

	if (isChannelReferential) supporting_signals.push("channel_referential");

	const role: BusinessModelEvidenceRole =
		primary_signals.length > 0 ? "primary" : isChannelReferential ? "supporting" : "excluded";
	const exclusion_reason = role === "excluded" ? "not_channel_referential" : null;
	return { role, exclusion_reason, primary_signals, supporting_signals };
}

export function classifyBusinessModelEvidenceFromDpuSlide(row: {
	slideText: string;
	slideTitle: string | null;
	segment_key: string | null;
	bullets: string[];
}): BusinessModelEvidenceAssessment {
	return classifyBusinessModelEvidence({
		slide_title: row.slideTitle,
		segment_key: row.segment_key,
		bullets: row.bullets,
		text: row.slideText,
	});
}

const DPU_DISALLOWED_GROWTH_SEGMENTS = new Set(['team', 'advisors', 'about', 'story']);
const DPU_DISALLOWED_CUSTOMERS_SEGMENTS = new Set(['team', 'advisors']);
const DPU_DISALLOWED_REVENUE_SEGMENTS = new Set(['team', 'advisors', 'equipment']);

const DPU_GROWTH_INTENT_KEYWORDS = ['growth', 'forecast', 'financial', 'performance', 'revenue', 'sales'];
const DPU_CUSTOMERS_INTENT_KEYWORDS = ['serving', 'customers', 'accounts', 'retailers', 'courses'];

function includesAny(haystack: string, keywords: string[]): boolean {
	const h = haystack.toLowerCase();
	return keywords.some((k) => h.includes(k));
}

function normalizeSegmentKey(seg: string | null): string | null {
	const s = typeof seg === 'string' ? seg.trim().toLowerCase() : '';
	return s ? s : null;
}

function tokenizeLoose(s: string): string[] {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9$%]+/g, ' ')
		.trim()
		.split(/\s+/g)
		.filter(Boolean);
}

function hasRevenueTokenNearAmount(bullet: string, amountIndex: number, windowTokens: number): boolean {
	const tokens = tokenizeLoose(bullet);
	if (tokens.length === 0) return false;
	const start = Math.max(0, amountIndex - windowTokens);
	const end = Math.min(tokens.length, amountIndex + windowTokens + 1);
	for (let i = start; i < end; i++) {
		if (tokens[i] === 'revenue') return true;
	}
	return false;
}

function isOpportunityStyle(text: string): boolean {
	const t = text.toLowerCase();
	if (t.includes('opportunity')) return true;
	if (t.includes('annual opportunity')) return true;
	if (t.includes('within driving distance')) return true;
	if (t.includes('could be')) return true;
	if (t.includes('potential')) return true;
	if (t.includes('per year in retail revenue')) return true;
	if (t.includes('potential revenue')) return true;
	return false;
}

function formatUsdShort(amount: number): string {
	if (!Number.isFinite(amount) || amount <= 0) return "Unknown";
	if (amount >= 1e9) {
		const v = amount / 1e9;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}B`;
	}
	if (amount >= 1e6) {
		const v = amount / 1e6;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}MM`;
	}
	if (amount >= 1e3) {
		const v = amount / 1e3;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}K`;
	}
	return `$${Math.round(amount)}`;
}

function formatUsdDisplay(amount: number): string {
	if (!Number.isFinite(amount) || amount <= 0) return "Unknown";
	if (amount >= 1e9) {
		const v = amount / 1e9;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}B`;
	}
	if (amount >= 1e6) {
		const v = amount / 1e6;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}M`;
	}
	if (amount >= 1e3) {
		const v = amount / 1e3;
		const s = String(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1));
		return `$${s}k`;
	}
	return `$${Math.round(amount)}`;
}

function extractYearNearIndex(text: string, index: number): number | null {
	const start = Math.max(0, index - 30);
	const end = Math.min(text.length, index + 30);
	const window = text.slice(start, end);
	const m = window.match(/\b(20\d{2})\b/);
	if (!m?.[1]) return null;
	const year = Number(m[1]);
	return Number.isFinite(year) ? year : null;
}

function parseRevenueFromSlides(rows: SlideRow[]): Array<{
	subtype: 'annual' | 'attributed' | 'forecast';
	display: string;
	amount: number;
	year: number | null;
	scope: RevenueScope;
	channel?: 'email_sms' | null;
	typing_reason?: string | null;
	note_snippet: string | null;
	primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null };
}> {
	const currentYear = new Date().getFullYear();
	const moneyRe = /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:mm|m|million|mn|bn|b|k|thousand)?/gi;
	const detectMarketingAttribution = (
		bulletLower: string,
		slideContextLower: string
	): { channel: 'email_sms' | null; typing_reason: string } | null => {
		const bullet = String(bulletLower ?? '').toLowerCase();
		const ctx = String(slideContextLower ?? '').toLowerCase();
		const s = `${bullet} ${ctx}`.trim();
		if (!s) return null;

		const hasEmail = s.includes('email');
		const hasSms = s.includes('sms');
		const hasEmailSmsToken =
			s.includes('email/sms') || s.includes('email & sms') || s.includes('email and sms') || s.includes('sms/email');

		const hasAttributed = s.includes('attributed');
		const hasCampaign = s.includes('campaign') || s.includes('paid media') || s.includes('paid') || s.includes('ads') || s.includes('ad spend');
		const hasPerformance = s.includes('roas') || s.includes('cac') || s.includes('conversion');
		const hasMarketing = s.includes('marketing');

		// Keep deterministic and conservative: require revenue mention plus marketing/attribution signals.
		const mentionsRevenue = s.includes('revenue') || s.includes('sales') || s.includes('gmv');
		if (!mentionsRevenue) return null;

		const strong = hasAttributed || hasEmail || hasSms || hasEmailSmsToken || hasCampaign;
		// If the bullet includes performance attribution signals (ROAS/CAC/conversion), treat it as marketing-attributed
		// even if the word "marketing" or "campaign" isn't present.
		const weakButSupported = hasPerformance;
		if (!strong && !weakButSupported) return null;

		const tokens: string[] = [];
		if (hasAttributed) tokens.push('attributed');
		if (hasEmailSmsToken) tokens.push('email/sms');
		else {
			if (hasEmail) tokens.push('email');
			if (hasSms) tokens.push('sms');
		}
		if (s.includes('campaign')) tokens.push('campaign');
		if (s.includes('paid media')) tokens.push('paid media');
		if (s.includes('ad spend')) tokens.push('ad spend');
		if (s.includes('roas')) tokens.push('roas');
		if (s.includes('cac')) tokens.push('cac');
		if (s.includes('conversion')) tokens.push('conversion');
		if (s.includes('marketing')) tokens.push('marketing');

		const channel: 'email_sms' | null = (hasEmail || hasSms || hasEmailSmsToken || s.includes('automated marketing journeys'))
			? 'email_sms'
			: null;

		const uniq = Array.from(new Set(tokens)).sort((a, b) => a.localeCompare(b));
		return { channel, typing_reason: `marketing_attributed_revenue_v1: tokens=[${uniq.join(', ')}]` };
	};
	const prefer = (c: { subtype: string; slideTitle: string | null; slideText: string; year: number | null; segment_key: string | null }): number => {
		const title = String(c.slideTitle ?? '').toLowerCase();
		const t = c.slideText.toLowerCase();
		const seg = normalizeSegmentKey(c.segment_key);
		let score = 0;
		if (title.includes('business performance')) score += 12;
		if (title.includes('financial')) score += 10;
		if (title.includes('performance')) score += 9;
		if (title.includes('growth forecast')) score += 7;
		if (c.subtype === 'forecast') score += 6;
		if (c.subtype === 'attributed') score += 3;
		if (seg === 'equipment') score -= 20;
		if (title.includes('equipment')) score -= 12;
		if (t.includes('revenue')) score += 2;
		if (t.includes('arr') || t.includes('sales')) score += 1;
		if (typeof c.year === 'number' && c.year >= currentYear) score += 2;
		return score;
	};

	const candidates: Array<{
		subtype: 'annual' | 'attributed' | 'forecast';
		display: string;
		amount: number;
		year: number | null;
		scope: RevenueScope;
		channel?: 'email_sms' | null;
		typing_reason?: string | null;
		note_snippet: string | null;
		slideTitle: string | null;
		slideText: string;
		primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null };
	}> = [];

	for (const r of rows) {
		const seg = normalizeSegmentKey(r.segment_key);
		const titleLower = String(r.slideTitle ?? '').toLowerCase();
		const titleIsFinancialOrPerformance = titleLower.includes('financial') || titleLower.includes('performance');
		const allowEquipment = seg !== 'equipment' || titleIsFinancialOrPerformance;
		if (!allowEquipment && seg === 'equipment') continue;
		if (seg && DPU_DISALLOWED_REVENUE_SEGMENTS.has(seg) && !titleIsFinancialOrPerformance) continue;

		const bullets = Array.isArray(r.bullets) && r.bullets.length > 0 ? r.bullets : [r.slideText];
		const slideContextLower = [r.slideTitle, r.slideText, ...bullets]
			.map((v) => String(v ?? '').trim())
			.filter((v) => v.length > 0)
			.join(' ')
			.toLowerCase();
		for (const bulletRaw of bullets) {
			const bullet = String(bulletRaw ?? '').trim();
			if (!bullet || !bullet.includes('$')) continue;
			const bulletLower = bullet.toLowerCase();
			if (isOpportunityStyle(bulletLower)) continue;

			for (const m of bullet.matchAll(moneyRe)) {
				const token = String(m[0] ?? '').trim();
				const idx = typeof m.index === 'number' ? m.index : -1;
				if (!token || idx < 0) continue;
				const amount = parseMoneyToken(token);
				if (!amount) continue;

				const year = extractYearNearIndex(bullet, idx);
				const tokens = tokenizeLoose(bullet);
				const amountTokenIndex = (() => {
					if (tokens.length === 0) return -1;
					// Find the first token that looks like a money token.
					for (let i = 0; i < tokens.length; i++) {
						if (tokens[i].includes('$')) return i;
					}
					return -1;
				})();

				const isForecast =
					titleLower.includes('forecast') ||
					titleLower.includes('projection') ||
					titleLower.includes('projections') ||
					(typeof year === 'number' && year >= currentYear);

				// Intent gating for revenue_v1: Financial/Performance title, OR revenue token near the amount.
				// Allow forecast slides to contribute forecast subtype even if revenue token is absent (used for growth_outlook_v1).
				const hasRevenueNear = amountTokenIndex >= 0 ? hasRevenueTokenNearAmount(bullet, amountTokenIndex, 10) : bulletLower.includes('revenue');
				const revenueAllowed = titleIsFinancialOrPerformance || hasRevenueNear || (isForecast && titleLower.includes('forecast'));
				if (!revenueAllowed) continue;

				// Proximity rule: require "revenue" in the same bullet as the amount unless it's explicitly a Financials/Performance slide.
				if (!titleIsFinancialOrPerformance && !bulletLower.includes('revenue') && !isForecast) continue;

				const attribution = detectMarketingAttribution(bulletLower, slideContextLower);
				const isAttributed = attribution != null;
				const channel = attribution?.channel ?? null;
				const typing_reason = attribution?.typing_reason ?? null;

				const subtype: 'annual' | 'attributed' | 'forecast' = isForecast ? 'forecast' : isAttributed ? 'attributed' : 'annual';
				const scope: RevenueScope = subtype === 'attributed' ? 'channel_attributed' : 'company_total';
				const display = formatUsdDisplay(amount);
				const note_snippet = asNonEmptyString(bullet.slice(0, 240));
				candidates.push({
					subtype,
					scope,
					channel,
					typing_reason,
					display,
					amount,
					year: subtype === 'forecast' ? year : null,
					note_snippet,
					slideTitle: r.slideTitle,
					slideText: bullet,
					primary: {
						document_id: r.row.document_id,
						page_index: r.row.page_index,
						slide_title: r.slideTitle,
						segment_key: r.segment_key,
					},
				});
			}
		}
	}

	if (candidates.length === 0) return [];

	// Pick best per subtype to avoid emitting a large set.
	const bestBySubtype = new Map<string, (typeof candidates)[number]>();
	for (const c of candidates) {
		const prev = bestBySubtype.get(c.subtype);
		if (!prev) {
			bestBySubtype.set(c.subtype, c);
			continue;
		}
		const a = prefer({ subtype: c.subtype, slideTitle: c.slideTitle, slideText: c.slideText, year: c.year, segment_key: c.primary.segment_key });
		const b = prefer({ subtype: prev.subtype, slideTitle: prev.slideTitle, slideText: prev.slideText, year: prev.year, segment_key: prev.primary.segment_key });
		if (a > b || (a === b && c.primary.page_index > prev.primary.page_index)) {
			bestBySubtype.set(c.subtype, c);
		}
	}

	// Return stable ordering.
	const order: Array<'annual' | 'attributed' | 'forecast'> = ['annual', 'attributed', 'forecast'];
	return order
		.map((k) => bestBySubtype.get(k))
		.filter(Boolean)
		.map((c) => ({
			subtype: c!.subtype,
			scope: c!.scope,
			channel: (c as any)?.channel ?? null,
			typing_reason: (c as any)?.typing_reason ?? null,
			display: c!.display,
			amount: c!.amount,
			year: c!.year,
			note_snippet: c!.note_snippet,
			primary: c!.primary,
		}));
}

function parseRevenueFromFinancialTableSlides(rows: SlideRow[], currentYear: number): Array<{
	subtype: 'annual' | 'forecast' | 'ytd';
	year_kind: 'completed' | 'forecast' | 'ytd';
	year_label_raw: string;
	row_name: string;
	value_raw: string;
	display: string;
	amount: number;
	year: number;
	scope: RevenueScope;
	note_snippet: string | null;
	primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null; slide_number: number | null };
}> {
	// Heuristic parser for slides that contain a revenue row with year columns.
	// DPU for PPTX doesn't always preserve structured tables, so we parse from bullets/text.
	// Require $ or a scale suffix to avoid accidentally capturing a year (e.g. "2023").
	const moneyLikeRe = /(?:\$\s*\d[\d,]*(?:\.\d+)?\s*(?:mm|mn|m|million|k|thousand|bn|b|billion)?|\d[\d,]*(?:\.\d+)?\s*(?:mm|mn|m|million|k|thousand|bn|b|billion))/gi;
	const yearLabelRe = /\b(20\d{2})\b(?:\s*(ytd|e|f|est|forecast|proj|projected))?/gi;

	const parseMoneyLikeToken = (token: string): number | null => {
		const t = String(token ?? '').trim();
		if (!t) return null;
		const m = t.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(mm|mn|m|million|k|thousand|bn|b|billion))?/i);
		if (!m?.[1]) return null;
		const n = Number(String(m[1]).replace(/,/g, ''));
		if (!Number.isFinite(n)) return null;
		const suf = String(m[2] ?? '').trim().toLowerCase();
		const mult =
			suf === 'mm' || suf === 'mn' || suf === 'm' || suf === 'million'
				? 1e6
				: suf === 'bn' || suf === 'b' || suf === 'billion'
					? 1e9
					: suf === 'k' || suf === 'thousand'
						? 1e3
						: 1;
		return n * mult;
	};

	const out: Array<{
		subtype: 'annual' | 'forecast' | 'ytd';
		year_kind: 'completed' | 'forecast' | 'ytd';
		year_label_raw: string;
		row_name: string;
		value_raw: string;
		display: string;
		amount: number;
		year: number;
		scope: RevenueScope;
		note_snippet: string | null;
		primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null; slide_number: number | null };
	}> = [];

	for (const r of rows) {
		const titleLower = String(r.slideTitle ?? '').toLowerCase();
		const seg = normalizeSegmentKey(r.segment_key);
		const maybeFinancial = titleLower.includes('financial') || titleLower.includes('income statement') || titleLower.includes('p&l') || seg === 'financials';
		if (!maybeFinancial) continue;

		const candidatesText = Array.isArray(r.bullets) && r.bullets.length > 0 ? r.bullets : [r.slideText];
		for (const lineRaw of candidatesText) {
			const line = String(lineRaw ?? '').trim();
			if (!line) continue;
			const lower = line.toLowerCase();
			if (!lower.includes('revenue')) continue;

			const labels: Array<{
				year: number;
				year_label_raw: string;
				year_kind: 'completed' | 'forecast' | 'ytd';
				subtype: 'annual' | 'forecast' | 'ytd';
				start: number;
				end: number;
			}> = [];
			for (const m of line.matchAll(yearLabelRe)) {
				if (!m?.[1] || typeof m.index !== 'number') continue;
				const year = Number(m[1]);
				if (!Number.isFinite(year)) continue;
				const suffix = String(m[2] ?? '').trim().toLowerCase();
				const year_label_raw = String(m[0] ?? '').trim();
				const year_kind: 'completed' | 'forecast' | 'ytd' =
					suffix === 'ytd'
						? 'ytd'
						: (suffix === 'e' || suffix === 'f' || suffix === 'est' || suffix === 'forecast' || suffix === 'proj' || suffix === 'projected' || year >= currentYear)
							? 'forecast'
							: 'completed';
				const subtype: 'annual' | 'forecast' | 'ytd' = year_kind === 'completed' ? 'annual' : year_kind;
				labels.push({ year, year_label_raw, year_kind, subtype, start: m.index, end: m.index + year_label_raw.length });
			}
			labels.sort((a, b) => a.start - b.start);
			if (labels.length < 3) continue;

			const row_name = (() => {
				const first = labels[0];
				const head = first ? line.slice(0, first.start).trim() : '';
				const cleaned = head.replace(/[:\-–—]+\s*$/, '').trim();
				return asNonEmptyString(cleaned) ?? 'Revenue';
			})();

			for (let i = 0; i < labels.length; i++) {
				const label = labels[i];
				const next = labels[i + 1] ?? null;
				const window = line.slice(label.end, next ? next.start : line.length);
				const moneyHit = window.match(moneyLikeRe);
				if (!moneyHit?.[0]) continue;
				const tokenRaw = String(moneyHit[0] ?? '').trim();
				const token = tokenRaw.startsWith('$') ? tokenRaw : `$${tokenRaw}`;
				const amt = parseMoneyLikeToken(token);
				if (typeof amt !== 'number' || !Number.isFinite(amt) || amt <= 0) continue;

				out.push({
					subtype: label.subtype,
					year_kind: label.year_kind,
					year_label_raw: label.year_label_raw,
					row_name,
					value_raw: token,
					display: token,
					amount: amt,
					year: label.year,
					scope: 'company_financials_table',
					note_snippet: asNonEmptyString(line.slice(0, 240)),
					primary: {
						document_id: r.row.document_id,
						page_index: r.row.page_index,
						slide_title: r.slideTitle,
						segment_key: r.segment_key,
						slide_number: r.slide_number,
					},
				});
			}
		}
	}

	if (out.length === 0) return [];
	// Prefer ordering by most recent year; tie-breaker by later page.
	out.sort((a, b) => b.year - a.year || b.primary.page_index - a.primary.page_index);
	return out;
}

function parseCustomersWholesaleAccountsFromSlides(rows: SlideRow[]): {
	display: string;
	count: number;
	subtype: 'wholesale_accounts';
	note_snippet: string | null;
	primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null };
} | null {
	const isStrongWholesaleIntent = (raw: string): boolean => {
		const text = String(raw ?? "").trim();
		if (!text) return false;
		const lower = text.toLowerCase();
		const hasServing = lower.includes("serving") && /\b\d{1,6}\b/.test(lower);
		if (!hasServing) return false;
		const channelHit = [
			"retailer",
			"green grass",
			"brick and mortar",
			"accounts",
			"wholesale",
		].some((k) => lower.includes(k));
		return channelHit;
	};

	const candidates: Array<{ total: number; note: string; row: any; score: number }> = [];
	for (const r of rows) {
		const seg = normalizeSegmentKey(r.segment_key);
		const isDisallowedSeg = Boolean(seg && DPU_DISALLOWED_CUSTOMERS_SEGMENTS.has(seg));
		const titleLower = String(r.slideTitle ?? '').toLowerCase();
		const bullets = Array.isArray(r.bullets) && r.bullets.length > 0 ? r.bullets : [r.slideText];
		const anyStrongWholesale = bullets.some((b) => isStrongWholesaleIntent(String(b ?? "")));
		// Allow strong wholesale intent even when slide is in a typically-disallowed segment (e.g., team).
		if (isDisallowedSeg && !anyStrongWholesale) continue;
		const anyIntent = includesAny(titleLower, DPU_CUSTOMERS_INTENT_KEYWORDS) || bullets.some((b) => includesAny(String(b ?? ''), DPU_CUSTOMERS_INTENT_KEYWORDS));
		if (!anyIntent) continue;

		// Only evaluate bullets for customer breakdown patterns.
		for (const bulletRaw of bullets) {
			const text = String(bulletRaw ?? '').trim();
			if (!text) continue;
			const lower = text.toLowerCase();
			if (!lower.includes('serving') && !lower.includes('retailer') && !lower.includes('wholesale') && !lower.includes('account') && !lower.includes('customer') && !lower.includes('course')) continue;

			const strongWholesale = isStrongWholesaleIntent(text);
			if (isDisallowedSeg && !strongWholesale) continue;

			const serving = (() => {
				const m = text.match(/\bserv(?:ing|es)?\s+(\d{1,6})\b/i);
				return m?.[1] ? Number(m[1]) : null;
			})();
			const retailers = (() => {
				const m = text.match(/\b(\d{1,6})\s*retailers?\b/i);
				return m?.[1] ? Number(m[1]) : null;
			})();
			const other = (() => {
				const m = text.match(/\b(\d{1,6})\s*other\b/i);
				return m?.[1] ? Number(m[1]) : null;
			})();
			const accounts = (() => {
				const m = text.match(/\b(\d{1,6})\s*(?:wholesale\s+)?accounts?\b/i);
				return m?.[1] ? Number(m[1]) : null;
			})();

			const parts: Array<{ k: string; v: number }> = [];
			if (typeof serving === 'number' && Number.isFinite(serving)) parts.push({ k: 'serving', v: serving });
			if (typeof retailers === 'number' && Number.isFinite(retailers)) parts.push({ k: 'retailers', v: retailers });
			if (typeof other === 'number' && Number.isFinite(other)) parts.push({ k: 'other', v: other });
			if (typeof accounts === 'number' && Number.isFinite(accounts)) parts.push({ k: 'accounts', v: accounts });
			if (parts.length < 2) continue;

			const total = parts.reduce((acc, p) => acc + p.v, 0);
			if (!Number.isFinite(total) || total <= 0) continue;

			const note = `${parts.map((p) => `${p.v} ${p.k}`).join(' + ')} = ${total}`;
			let score = 0;
			if (lower.includes('serving')) score += 2;
			if (lower.includes('account')) score += 1;
			if (lower.includes('wholesale')) score += 3;
			if (lower.includes('retailer')) score += 2;
			if (titleLower.includes('traction') || titleLower.includes('customers') || titleLower.includes('partners')) score += 2;
			if (total >= 10) score += 1;
			if (parts.length >= 3) score += 1;
			if (isDisallowedSeg) score -= strongWholesale ? 6 : 50;

			candidates.push({ total, note, row: r, score });
		}
	}
	if (candidates.length === 0) return null;
	const best = candidates.slice().sort((a, b) => b.score - a.score || b.total - a.total)[0];
	return {
		display: String(best.total),
		count: best.total,
		subtype: 'wholesale_accounts',
		note_snippet: best.note,
		primary: {
			document_id: best.row.row.document_id,
			page_index: best.row.row.page_index,
			slide_title: best.row.slideTitle,
			segment_key: best.row.segment_key,
		},
	};
}

function parseGrowthPercentFromSlides(rows: SlideRow[]): {
	display: string;
	percent: number;
	primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null };
	note_snippet: string | null;
} | null {
	const candidates: Array<{ percent: number; display: string; row: any; score: number; note: string | null }> = [];
	for (const r of rows) {
		const seg = normalizeSegmentKey(r.segment_key);
		if (seg && DPU_DISALLOWED_GROWTH_SEGMENTS.has(seg)) continue;
		const titleLower = String(r.slideTitle ?? '').toLowerCase();
		const bullets = Array.isArray(r.bullets) && r.bullets.length > 0 ? r.bullets : [r.slideText];
		const hasIntent = includesAny(titleLower, DPU_GROWTH_INTENT_KEYWORDS) || bullets.some((b) => includesAny(String(b ?? ''), DPU_GROWTH_INTENT_KEYWORDS));
		if (!hasIntent) continue;

		for (const bulletRaw of bullets) {
			const text = String(bulletRaw ?? '').trim();
			if (!text) continue;
			const lower = text.toLowerCase();
			const m = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s*(?:yoy|y\/y|year\s*over\s*year)\b/i);
			if (!m?.[1]) continue;
			const pct = Number(m[1]);
			if (!Number.isFinite(pct) || pct <= 0) continue;

			// Keyword proximity: YoY plus growth signal in the same bullet.
			const hasGrowthSignal = lower.includes('growth') || lower.includes('increase') || lower.includes('returning');
			if (!hasGrowthSignal) continue;

			const display = `${pct}% YoY`;
			let score = 0;
			if (titleLower.includes('growth forecast')) score += 10;
			else if (titleLower.includes('financial')) score += 7;
			else if (titleLower.includes('performance')) score += 6;
			else if (titleLower.includes('growth')) score += 5;
			else if (titleLower.includes('forecast')) score += 4;
			if (lower.includes('growth')) score += 2;
			if (pct >= 10) score += 1;
			candidates.push({ percent: pct, display, row: r, score, note: asNonEmptyString(text.slice(0, 240)) });
		}
	}
	if (candidates.length === 0) return null;
	const best = candidates.slice().sort((a, b) => b.score - a.score || b.percent - a.percent)[0];
	return {
		display: best.display,
		percent: best.percent,
		primary: {
			document_id: best.row.row.document_id,
			page_index: best.row.row.page_index,
			slide_title: best.row.slideTitle,
			segment_key: best.row.segment_key,
		},
		note_snippet: best.note,
	};
}

function parseMoneyToken(s: string): number | null {
	const m = s.match(/\$\s*(\d[\d,]*(?:\.\d+)?)(\s*(?:mm|m|million|mn|bn|b|k|thousand))?/i);
	if (!m) return null;
	const n = Number(String(m[1]).replace(/,/g, ''));
	if (!Number.isFinite(n)) return null;
	const suf = String(m[2] ?? "").trim().toLowerCase();
	const mult =
		suf === "mm" || suf === "m" || suf === "million" || suf === "mn"
			? 1e6
			: suf === "bn" || suf === "b"
				? 1e9
				: suf === "k" || suf === "thousand"
					? 1e3
					: 1;
	return n * mult;
}


function inferBusinessModelLabel(rows: Array<{ row: DpuRow; slideText: string; slideTitle: string | null; segment_key: string | null; bullets: string[] }>): {
	label: string;
	primary_sources: BusinessModelEvidenceRef[];
	supporting_sources: BusinessModelEvidenceRef[];
	secondary_tags: string[];
	diagnostics: {
		has_media_signals: boolean;
		has_ecom_mechanics: boolean;
		ecom_mechanics_hits?: string[];
		dtc_hits: string[];
		media_hits: string[];
		applied_guards: string[];
		decision_reason: string;
	};
} | null {
	// DTC detection: allow broad channel language, but do NOT treat generic "ecommerce" as mechanics.
	const dtcRe = /\b(direct\s*to\s*consumer|\bdtc\b|d2c|e-?commerce|shopify|online\s+store|direct\s+via\s+website|website\s+sales)\b/i;
	const ecomMechanicsSignals: Array<{ rx: RegExp; neg: RegExp; kind: string }> = [
		{ rx: /\bcheckout\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?checkout\b/i, kind: 'checkout' },
		{ rx: /\bcart\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?cart\b/i, kind: 'cart' },
		{ rx: /\borders?\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?orders?\b/i, kind: 'orders' },
		{ rx: /\bskus?\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?skus?\b/i, kind: 'skus' },
		{ rx: /\bstorefront\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?storefront\b/i, kind: 'storefront' },
		{ rx: /\badd\s+to\s+cart\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?add\s+to\s+cart\b/i, kind: 'add_to_cart' },
		{ rx: /\bfulfillment\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?fulfillment\b/i, kind: 'fulfillment' },
		{ rx: /\binventory\b/i, neg: /\b(?:not|no|without)\s+(?:an?\s+)?inventory\b/i, kind: 'inventory' },
	];
	const wholesaleRe = /\b(wholesale|retail|brick\s*(?:&|and)\s*mortar|retailer|retailers|golf\s*courses|pro\s*shops|stores?)\b/i;
	// Treat media rights explicitly as licensing-like.
	const licensingRe = /\b(licens\w*|media\s+rights?)\b/i;
	const mediaSignals: Array<{ rx: RegExp; kind: string }> = [
		{ rx: /\btitle\s+sponsorship\b/i, kind: 'title_sponsorship' },
		{ rx: /\bsponsorship\b/i, kind: 'sponsorship' },
		{ rx: /\bsponsor\b/i, kind: 'sponsor' },
		{ rx: /\bmedia\s+partner\b/i, kind: 'media_partner' },
		{ rx: /\bmedia\s+rights?\b/i, kind: 'media_rights' },
		{ rx: /\bbroadcast\b/i, kind: 'broadcast' },
		{ rx: /\bstreaming\b/i, kind: 'streaming' },
		{ rx: /\bweb\s*series\b/i, kind: 'webseries' },
		{ rx: /\bwebseries\b/i, kind: 'webseries' },
		{ rx: /\bcontent\s+distribution\b/i, kind: 'content_distribution' },
		{ rx: /\bdistribution\b/i, kind: 'distribution' },
		{ rx: /\bcontent\s+production\b/i, kind: 'content_production' },
		{ rx: /\bviewership\b/i, kind: 'viewership' },
		{ rx: /\beyeballs\b/i, kind: 'eyeballs' },
	];
	const mediaLikeRe = new RegExp(mediaSignals.map((s) => `(?:${s.rx.source})`).join('|'), 'i');

	const collectMediaHits = (text: string): string[] => {
		const out: string[] = [];
		for (const s of mediaSignals) {
			if (s.rx.test(text)) out.push(s.kind);
		}
		out.sort();
		return Array.from(new Set(out));
	};

	const collectEcomMechanicsHits = (text: string): string[] => {
		const out: string[] = [];
		for (const s of ecomMechanicsSignals) {
			if (s.rx.test(text) && !s.neg.test(text)) out.push(s.kind);
		}
		out.sort();
		return Array.from(new Set(out));
	};

	const assessed = rows.map((r) => {
		const assessment = classifyBusinessModelEvidenceFromDpuSlide(r);
		const t = r.slideText;
		const mechanics_hits = collectEcomMechanicsHits(t);
		return {
			dtc: dtcRe.test(t),
			ecom_mechanics: mechanics_hits.length > 0,
			mechanics_hits,
			wholesale: wholesaleRe.test(t),
			licensing: licensingRe.test(t),
			media_like: mediaLikeRe.test(t) || mediaLikeRe.test(String(r.slideTitle ?? '')),
			media_hits: Array.from(new Set([...collectMediaHits(t), ...collectMediaHits(String(r.slideTitle ?? ''))])),
			row: r,
			assessment,
		};
	});

	const hits = assessed.filter((h) => h.assessment.role !== "excluded");
	const excludedHits = assessed.filter((h) => h.assessment.role === "excluded");

	const hasDtc = hits.some((h) => h.dtc);
	const hasWholesale = hits.some((h) => h.wholesale);
	const hasLicensing = hits.some((h) => h.licensing);
	const hasMediaLike = hits.some((h) => h.media_like) || assessed.some((h) => h.media_like);
	const hasEcomMechanics = hits.some((h) => h.ecom_mechanics) || assessed.some((h) => h.ecom_mechanics);
	const ecom_mechanics_hits = Array.from(new Set(assessed.flatMap((h) => h.mechanics_hits ?? []))).slice().sort().slice(0, 24);
	const media_hits = Array.from(new Set(assessed.flatMap((h) => h.media_hits ?? []))).slice().sort().slice(0, 24);
	const dtc_hits = Array.from(new Set(assessed.flatMap((h) => (h.dtc ? ['dtc_channel_language'] : [])))).slice().sort();
	const applied_guards: string[] = [];

	if (!hasDtc && !hasWholesale && !hasLicensing) return null;

	// Hard exclusion: media/sponsorship + no ecommerce mechanics => never infer DTC.
	const dtcAllowed = !(hasMediaLike && !hasEcomMechanics);
	if (!dtcAllowed) applied_guards.push('media_blocks_dtc_without_ecom_mechanics');

	// If the only signal was DTC channel language and it's blocked by the media guard, return null.
	if (!dtcAllowed && hasDtc && !hasWholesale && !hasLicensing) return null;

	const label = (dtcAllowed && hasDtc) && hasWholesale
		? "Omnichannel (DTC + Wholesale/Retail)"
		: hasWholesale
			? "Wholesale/Retail"
			: (dtcAllowed && hasDtc)
				? "DTC Ecommerce"
				: "Licensing";

	const secondary_tags: string[] = [];
	if (hasLicensing && label !== "Licensing") secondary_tags.push("Licensing");

	// Pick a primary source: must be primary-role evidence (strict).
	const primaryCandidates = hits.filter((h) => h.assessment.role === "primary");
	if (primaryCandidates.length === 0) {
		// Canonical restriction: no primary -> do not infer.
		return null;
	}

	// Prefer a DTC or wholesale page depending on label; prefer GTM/Distribution/Pricing titles.
	const prefer = (h: (typeof hits)[number]): number => {
		const title = String(h.row.slideTitle ?? "").toLowerCase();
		let score = 0;
		if (label === "Omnichannel (DTC + Wholesale/Retail)") {
			if (h.dtc) score += 2;
			if (h.wholesale) score += 2;
		} else if (label === "DTC Ecommerce") {
			if (h.dtc) score += 3;
		} else if (label === "Wholesale/Retail") {
			if (h.wholesale) score += 3;
		} else {
			if (h.licensing) score += 3;
		}
		if (title.includes("go to market") || title.includes("go-to-market") || title.includes("channels")) score += 2;
		if (title.includes("wholesale") || title.includes("retail")) score += 1;
		if (title.includes("business model")) score += 3;
		if (title.includes("distribution")) score += 2;
		if (title.includes("pricing")) score += 2;
		return score;
	};

	const sortedPrimary = primaryCandidates
		.slice()
		.sort((a, b) => prefer(b) - prefer(a) || b.row.row.page_index - a.row.row.page_index);
	const best = sortedPrimary[0];

	const supportingCandidates = hits.filter((h) => h.assessment.role === "supporting");
	const supporting: BusinessModelEvidenceRef[] = [];
	for (const h of supportingCandidates) {
		// Supporting allowed only if channel-referential; we already enforce that in classifier.
		if ((hasDtc && h.dtc) || (hasWholesale && h.wholesale) || (hasLicensing && h.licensing)) {
			supporting.push({
				document_id: h.row.row.document_id,
				page_index: h.row.row.page_index,
				slide_title: h.row.slideTitle,
				segment_key: (h.row as any).segment_key ?? null,
			});
		}
	}
	// de-dupe supporting by doc+page, exclude primary page, limit 3
	const seen = new Set<string>();
	const primaryKey = `${best.row.row.document_id}:${best.row.row.page_index}`;
	seen.add(primaryKey);
	const dedupSupporting = supporting
		.filter((s) => {
			const k = `${s.document_id}:${s.page_index}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		})
		.slice(0, 3);

	void excludedHits; // explicitly unused; kept for diagnostics expansion if needed

	return {
		label,
		primary_sources: [
			{
				document_id: best.row.row.document_id,
				page_index: best.row.row.page_index,
				slide_title: best.row.slideTitle,
				segment_key: (best.row as any).segment_key ?? null,
			},
		],
		supporting_sources: dedupSupporting,
		secondary_tags,
		diagnostics: {
			has_media_signals: hasMediaLike,
			has_ecom_mechanics: hasEcomMechanics,
			ecom_mechanics_hits: ecom_mechanics_hits.length ? ecom_mechanics_hits : undefined,
			dtc_hits,
			media_hits,
			applied_guards,
			decision_reason: `media=${hasMediaLike ? 1 : 0} mechanics=${hasEcomMechanics ? 1 : 0} dtcAllowed=${dtcAllowed ? 1 : 0} label=${label}`,
		},
	};
}

function parseRaiseFromSlides(rows: Array<{ row: DpuRow; slideText: string; slideTitle: string | null; segment_key: string | null }>): {
	display: string;
	amount: number;
	valuation: number | null;
	primary: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null };
} | null {
	const preference = (r: { slideTitle: string | null; slideText: string }): number => {
		const title = String(r.slideTitle ?? "").toLowerCase();
		let score = 0;
		if (title.includes("capital raise") || title.includes("raise") || title.includes("fund") || title.includes("financing")) score += 6;
		if (r.slideText.toLowerCase().includes("valuation")) score += 2;
		if (r.slideText.toLowerCase().includes("raise")) score += 2;
		return score;
	};

	const candidates = rows
		.map((r) => {
			const text = r.slideText;
			const lower = text.toLowerCase();
			if (!lower.includes("raise") && !lower.includes("fund") && !lower.includes("valuation") && !lower.includes("$")) return null;

			// Prefer the money token closest to the word "raise" if present.
			let amount: number | null = null;
			const raiseIx = lower.includes("raise") ? lower.indexOf("raise") : -1;
			const moneyRe = /\$\s*\d+(?:\.\d+)?\s*(?:mm|m|million|mn|bn|b|k|thousand)?/gi;
			const moneyHits: Array<{ token: string; index: number }> = [];
			for (const m of text.matchAll(moneyRe)) {
				const token = String(m[0] ?? "");
				const index = typeof m.index === "number" ? m.index : -1;
				if (token && index >= 0) moneyHits.push({ token, index });
			}
			if (moneyHits.length === 0) return null;
			if (raiseIx >= 0) {
				moneyHits.sort((a, b) => Math.abs(a.index - raiseIx) - Math.abs(b.index - raiseIx));
				amount = parseMoneyToken(moneyHits[0].token);
			} else {
				amount = parseMoneyToken(moneyHits[0].token);
			}
			if (!amount) return null;
			let valuation: number | null = null;
			// Look for valuation amount immediately adjacent to the word "valuation".
			const before = text.match(/(\$\s*\d+(?:\.\d+)?\s*(?:mm|m|million|mn|bn|b|k|thousand)?)[^$]{0,20}\bvaluation\b/i);
			const after = text.match(/\bvaluation\b[^$]{0,20}(\$\s*\d+(?:\.\d+)?\s*(?:mm|m|million|mn|bn|b|k|thousand)?)/i);
			if (before?.[1]) valuation = parseMoneyToken(before[1]);
			else if (after?.[1]) valuation = parseMoneyToken(after[1]);
			return {
				amount,
				valuation,
				row: r,
				pref: preference({ slideTitle: r.slideTitle, slideText: text }),
			};
		})
		.filter(Boolean) as Array<{ amount: number; valuation: number | null; row: any; pref: number }>;

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.pref - a.pref || (b.valuation ? 1 : 0) - (a.valuation ? 1 : 0));
	const best = candidates[0];
	return {
		display: formatUsdShort(best.amount),
		amount: best.amount,
		valuation: best.valuation,
		primary: {
			document_id: best.row.row.document_id,
			page_index: best.row.row.page_index,
			slide_title: best.row.slideTitle,
			segment_key: best.row.segment_key,
		},
	};
}

export async function derivePromotedFactsFromDpuForDeal(pool: Pool, dealId: string): Promise<DerivedPromotedFactRow[]> {
	const id = typeof dealId === "string" ? dealId.trim() : "";
	if (!id) return [];

	try {
		await pool.query("SELECT 1 FROM document_page_understanding LIMIT 1");
	} catch (err: any) {
		if (isMissingTableError(err)) return [];
		return [];
	}

	let rows: DpuRow[] = [];
	try {
		const res = await pool.query(
			`SELECT document_id::text as document_id,
			        page_index,
			        payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1::uuid
			    AND payload IS NOT NULL
			  ORDER BY document_id ASC, page_index ASC
			  LIMIT 4000`,
			[id]
		);
		rows = (res.rows ?? []).map((r: any) => ({
			document_id: String(r.document_id ?? ""),
			page_index: Number(r.page_index ?? 0),
			payload: r.payload,
		}));
	} catch (err: any) {
		if (isMissingTableError(err)) return [];
		return [];
	}

	const slideRows: SlideRow[] = rows
		.map((row) => {
			const built = buildSlideTextFromPayload(row.payload);
			const segmented = segmentDpuPage({ title: built.slide_title, bullets: built.bullets });
			return {
				row,
				slideText: built.text,
				slideTitle: built.slide_title,
				slide_number: extractSlideNumberFromPayload(row.payload),
				segment_key: segmented.segment_key,
				structured_segment_key_raw: built.segment_key,
				segment_reason: {
					rules_hit: [
						...segmented.reason.title_rules_hit.map((x) => `segmenter:title:${x}`),
						...segmented.reason.bullet_rules_hit.map((x) => `segmenter:bullet:${x}`),
						...segmented.reason.override_rules_hit.map((x) => `segmenter:override:${x}`),
						"segmenter:dpu_page_v1",
					],
					keywords_hit: segmented.reason.keywords,
					classifier_confidence: segmented.confidence,
					source: "deterministic" as const,
				},
				bullets: built.bullets,
				extracted_at: asNonEmptyString(row.payload?.source?.extracted_at) ?? new Date().toISOString(),
			} satisfies SlideRow;
		})
		.filter((r) => r.slideText.length > 0);

	const slideKey = (document_id: string, page_index: number): string => `${document_id}:${page_index}`;
	const slideById = new Map<string, SlideRow>();
	for (const r of slideRows) slideById.set(slideKey(r.row.document_id, r.row.page_index), r);
	const slideNumberFor = (document_id: string, page_index: number): number | null => {
		const hit = slideById.get(slideKey(document_id, page_index));
		return typeof hit?.slide_number === 'number' && Number.isFinite(hit.slide_number) ? hit.slide_number : null;
	};
	const segmentMetaFor = (document_id: string, page_index: number): { segment_key: string | null; segment_reason: any | null } => {
		const hit = slideById.get(slideKey(document_id, page_index));
		return { segment_key: hit?.segment_key ?? null, segment_reason: hit?.segment_reason ?? null };
	};

	const out: DerivedPromotedFactRow[] = [];

	const raise = parseRaiseFromSlides(slideRows);
	if (raise) {
		const seg = segmentMetaFor(raise.primary.document_id, raise.primary.page_index);
		const valuationNote = raise.valuation ? `on ${formatUsdShort(raise.valuation)} valuation` : null;
		out.push({
			evidence_id: `deal:${id}:dpu_fact:raise_terms_v1`,
			deal_id: id,
			source_type: "dpu_derived_fact",
			source_path: `doc:${raise.primary.document_id}:page:${raise.primary.page_index + 1}`,
			source_document_id: raise.primary.document_id,
			confidence: 0.75,
			extracted_at: slideRows.find((r) => r.row.document_id === raise.primary.document_id && r.row.page_index === raise.primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type: "raise_terms_v1",
				value_json: {
					display: raise.display,
					raw_text: null,
					amount: { amount: raise.amount, currency: "USD" },
					valuation: raise.valuation ? { amount: raise.valuation, currency: "USD" } : null,
					note_snippet: valuationNote,
				},
				provenance: {
					source_document_id: raise.primary.document_id,
					page_index: raise.primary.page_index,
					slide_title: raise.primary.slide_title,
					segment_key: seg.segment_key ?? raise.primary.segment_key,
					segment_reason: seg.segment_reason,
				},
			},
			meta: {
				document_id: raise.primary.document_id,
				page_index: raise.primary.page_index,
				slide_title: raise.primary.slide_title,
				segment_key: seg.segment_key ?? raise.primary.segment_key,
				segment_reason: seg.segment_reason,
			},
		});
	}

	const model = inferBusinessModelLabel(
		slideRows.map((r) => ({ row: r.row, slideText: r.slideText, slideTitle: r.slideTitle, segment_key: r.segment_key, bullets: r.bullets }))
	);
	if (model) {
		const primary = model.primary_sources[0];
		const primarySeg = segmentMetaFor(primary.document_id, primary.page_index);
		const enrich = (s: { document_id: string; page_index: number; slide_title: string | null; segment_key: string | null }): any => {
			const seg = segmentMetaFor(s.document_id, s.page_index);
			return {
				source_document_id: s.document_id,
				page_index: s.page_index,
				slide_title: s.slide_title,
				segment_key: seg.segment_key ?? s.segment_key,
				segment_reason: seg.segment_reason,
			};
		};
		out.push({
			evidence_id: `deal:${id}:dpu_fact:business_model_v1`,
			deal_id: id,
			source_type: "dpu_derived_fact",
			source_path: `doc:${primary.document_id}:page:${primary.page_index + 1}`,
			source_document_id: primary.document_id,
			confidence: 0.72,
			extracted_at: slideRows.find((r) => r.row.document_id === primary.document_id && r.row.page_index === primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type: "business_model_v1",
				value_json: {
					display: model.label,
					secondary_tags: model.secondary_tags,
					diagnostics: model.diagnostics,
				},
				provenance: {
					source_document_id: primary.document_id,
					page_index: primary.page_index,
					slide_title: primary.slide_title,
					segment_key: primarySeg.segment_key ?? primary.segment_key,
					segment_reason: primarySeg.segment_reason,
					primary_sources: model.primary_sources.map(enrich),
					supporting_sources: model.supporting_sources.map(enrich),
					// Back-compat for existing consumers
					supporting: model.supporting_sources.map(enrich),
				},
			},
			meta: {
				document_id: primary.document_id,
				page_index: primary.page_index,
				slide_title: primary.slide_title,
				segment_key: primarySeg.segment_key ?? primary.segment_key,
				segment_reason: primarySeg.segment_reason,
			},
		});
	}

	// KPI fallbacks (Option A): deterministic, labeled facts from DPU.
	const nowYear = new Date().getFullYear();
	const tableRevenueFacts = parseRevenueFromFinancialTableSlides(slideRows, nowYear);
	for (const rev of tableRevenueFacts) {
		const seg = segmentMetaFor(rev.primary.document_id, rev.primary.page_index);
		out.push({
			evidence_id: `deal:${id}:dpu_fact:revenue_v1:${rev.subtype}:table:${rev.year}:${rev.year_kind}`,
			deal_id: id,
			source_type: 'dpu_derived_fact',
			source_path: `doc:${rev.primary.document_id}:page:${rev.primary.page_index + 1}`,
			source_document_id: rev.primary.document_id,
			confidence: rev.subtype === 'annual' ? 0.76 : rev.subtype === 'ytd' ? 0.72 : 0.7,
			extracted_at: slideRows.find((r) => r.row.document_id === rev.primary.document_id && r.row.page_index === rev.primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type: 'revenue_v1',
				value_json: {
					display: rev.display,
					subtype: rev.subtype,
					year: rev.year,
					year_kind: rev.year_kind,
					year_label_raw: rev.year_label_raw,
					scope: rev.scope,
					row_name: rev.row_name,
					value_raw: rev.value_raw,
					note_snippet: rev.note_snippet,
					amount: { amount: rev.amount, currency: 'USD' },
				},
				provenance: {
					source_document_id: rev.primary.document_id,
					page_index: rev.primary.page_index,
					slide_title: rev.primary.slide_title,
					slide_number: rev.primary.slide_number,
					ppt_slide_number: rev.primary.slide_number,
					segment_key: seg.segment_key ?? rev.primary.segment_key,
					segment_reason: seg.segment_reason,
					scope: rev.scope,
					year: rev.year,
					row_name: rev.row_name,
					value_raw: rev.value_raw,
					year_kind: rev.year_kind,
					year_label_raw: rev.year_label_raw,
				},
			},
			meta: {
				document_id: rev.primary.document_id,
				page_index: rev.primary.page_index,
				slide_title: rev.primary.slide_title,
				slide_number: rev.primary.slide_number,
				ppt_slide_number: rev.primary.slide_number,
				segment_key: seg.segment_key ?? rev.primary.segment_key,
				segment_reason: seg.segment_reason,
				subtype: rev.subtype,
				year: rev.year,
				year_kind: rev.year_kind,
				year_label_raw: rev.year_label_raw,
				scope: rev.scope,
				row_name: rev.row_name,
				value_raw: rev.value_raw,
			},
		});
	}

	const revenueFacts = parseRevenueFromSlides(slideRows);
	for (const rev of revenueFacts) {
		const seg = segmentMetaFor(rev.primary.document_id, rev.primary.page_index);
		const fact_type = rev.subtype === 'attributed' ? 'marketing_attributed_revenue_v1' : 'revenue_v1';
		const channel = rev.subtype === 'attributed' ? (rev.channel ?? null) : null;
		const typing_reason = rev.subtype === 'attributed' ? (rev.typing_reason ?? null) : null;
		out.push({
			evidence_id: `deal:${id}:dpu_fact:${fact_type}:${rev.subtype}:${rev.year ?? 'na'}`,
			deal_id: id,
			source_type: "dpu_derived_fact",
			source_path: `doc:${rev.primary.document_id}:page:${rev.primary.page_index + 1}`,
			source_document_id: rev.primary.document_id,
			confidence: rev.subtype === 'annual' ? 0.66 : rev.subtype === 'attributed' ? 0.62 : 0.6,
			extracted_at: slideRows.find((r) => r.row.document_id === rev.primary.document_id && r.row.page_index === rev.primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type,
				value_json: {
					display: rev.display,
					subtype: rev.subtype,
					year: rev.year,
					scope: rev.scope,
					...(channel ? { channel } : {}),
					...(typing_reason ? { typing_reason } : {}),
					note_snippet: rev.note_snippet,
					amount: { amount: rev.amount, currency: "USD" },
				},
				provenance: {
					source_document_id: rev.primary.document_id,
					page_index: rev.primary.page_index,
					slide_title: rev.primary.slide_title,
					segment_key: seg.segment_key ?? rev.primary.segment_key,
					segment_reason: seg.segment_reason,
					scope: rev.scope,
					...(channel ? { channel } : {}),
				},
			},
			meta: {
				document_id: rev.primary.document_id,
				page_index: rev.primary.page_index,
				slide_title: rev.primary.slide_title,
				segment_key: seg.segment_key ?? rev.primary.segment_key,
				segment_reason: seg.segment_reason,
				subtype: rev.subtype,
				year: rev.year,
				scope: rev.scope,
				...(channel ? { channel } : {}),
				...(typing_reason ? { typing_reason } : {}),
			},
		});
	}

	const customers = parseCustomersWholesaleAccountsFromSlides(slideRows);
	if (customers) {
		const seg = segmentMetaFor(customers.primary.document_id, customers.primary.page_index);
		out.push({
			evidence_id: `deal:${id}:dpu_fact:customers_v1:${customers.subtype}`,
			deal_id: id,
			source_type: "dpu_derived_fact",
			source_path: `doc:${customers.primary.document_id}:page:${customers.primary.page_index + 1}`,
			source_document_id: customers.primary.document_id,
			confidence: 0.62,
			extracted_at: slideRows.find((r) => r.row.document_id === customers.primary.document_id && r.row.page_index === customers.primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type: "customers_v1",
				value_json: {
					display: customers.display,
					count: customers.count,
					subtype: customers.subtype,
					note_snippet: customers.note_snippet,
				},
				provenance: {
					source_document_id: customers.primary.document_id,
					page_index: customers.primary.page_index,
					slide_title: customers.primary.slide_title,
					segment_key: seg.segment_key ?? customers.primary.segment_key,
					segment_reason: seg.segment_reason,
				},
			},
			meta: {
				document_id: customers.primary.document_id,
				page_index: customers.primary.page_index,
				slide_title: customers.primary.slide_title,
				segment_key: seg.segment_key ?? customers.primary.segment_key,
				segment_reason: seg.segment_reason,
				subtype: customers.subtype,
			},
		});
	}

	const growth = parseGrowthPercentFromSlides(slideRows);
	if (growth) {
		const seg = segmentMetaFor(growth.primary.document_id, growth.primary.page_index);
		out.push({
			evidence_id: `deal:${id}:dpu_fact:growth_v1:yoy_percent`,
			deal_id: id,
			source_type: "dpu_derived_fact",
			source_path: `doc:${growth.primary.document_id}:page:${growth.primary.page_index + 1}`,
			source_document_id: growth.primary.document_id,
			confidence: 0.6,
			extracted_at: slideRows.find((r) => r.row.document_id === growth.primary.document_id && r.row.page_index === growth.primary.page_index)?.extracted_at ?? new Date().toISOString(),
			content_json: {
				fact_type: "growth_v1",
				value_json: {
					display: growth.display,
					percent: growth.percent,
					subtype: 'yoy_percent',
					note_snippet: growth.note_snippet,
				},
				provenance: {
					source_document_id: growth.primary.document_id,
					page_index: growth.primary.page_index,
					slide_title: growth.primary.slide_title,
					segment_key: seg.segment_key ?? growth.primary.segment_key,
					segment_reason: seg.segment_reason,
				},
			},
			meta: {
				document_id: growth.primary.document_id,
				page_index: growth.primary.page_index,
				slide_title: growth.primary.slide_title,
				segment_key: seg.segment_key ?? growth.primary.segment_key,
				segment_reason: seg.segment_reason,
			},
		});
	}

	// Derived growth outlook from forecast revenue when explicit growth percent is absent.
	if (!growth) {
		const forecastRev = revenueFacts.find((r) => r.subtype === 'forecast' && typeof r.year === 'number' && Number.isFinite(r.year));
		if (forecastRev && forecastRev.year) {
			const seg = segmentMetaFor(forecastRev.primary.document_id, forecastRev.primary.page_index);
			out.push({
				evidence_id: `deal:${id}:dpu_fact:growth_outlook_v1:forecast:${forecastRev.year}`,
				deal_id: id,
				source_type: "dpu_derived_fact",
				source_path: `doc:${forecastRev.primary.document_id}:page:${forecastRev.primary.page_index + 1}`,
				source_document_id: forecastRev.primary.document_id,
				confidence: 0.58,
				extracted_at: slideRows.find((r) => r.row.document_id === forecastRev.primary.document_id && r.row.page_index === forecastRev.primary.page_index)?.extracted_at ?? new Date().toISOString(),
				content_json: {
					fact_type: "growth_outlook_v1",
					value_json: {
						display: `Forecast: ${forecastRev.display} (${forecastRev.year})`,
						subtype: 'forecast',
						year: forecastRev.year,
						note_snippet: forecastRev.note_snippet,
					},
					provenance: {
						source_document_id: forecastRev.primary.document_id,
						page_index: forecastRev.primary.page_index,
						slide_title: forecastRev.primary.slide_title,
						segment_key: seg.segment_key ?? forecastRev.primary.segment_key,
						segment_reason: seg.segment_reason,
					},
				},
				meta: {
					document_id: forecastRev.primary.document_id,
					page_index: forecastRev.primary.page_index,
					slide_title: forecastRev.primary.slide_title,
					segment_key: seg.segment_key ?? forecastRev.primary.segment_key,
					segment_reason: seg.segment_reason,
					year: forecastRev.year,
				},
			});
		}
	}

	return out;
}
