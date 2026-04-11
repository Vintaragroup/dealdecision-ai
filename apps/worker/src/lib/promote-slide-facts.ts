import type { Pool } from "pg";
import {
	containsMarketSizingLanguage,
	inferIsRaiseAskSlide,
	toPolicyAwareBusinessModelDisplay,
	getSelectedPolicyIdFromAny,
} from "@dealdecision/core";

export type PromoteSlideFactsParams = {
	dealId: string;
	documentId: string;
	pageStart: number;
	pageEnd: number;
	selectedPolicyId?: string | null;
	version?: string;
	runId?: string | null;
	stepRunId?: string | null;
};

export type PromotedFactType = "raise_terms_v1" | "business_model_v1";

export type PromotedFact = {
	fact_type: PromotedFactType;
	source_type?: string;
	tags?: string[];
	value_json: Record<string, any>;
	confidence: number;
	extracted_at: string;
	source_path: string;
	source_document_id: string;
	meta: Record<string, any>;
};

function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(1, v));
}

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	return code === "42P01";
}

function asNonEmptyString(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeText(raw: string): string {
	return raw
		.replace(/\r\n/g, "\n")
		.replace(/\t/g, " ")
		.replace(/[ ]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function stableEvidenceId(dealId: string, factType: PromotedFactType): string {
	return `deal:${dealId}:fact:${factType}`;
}

function toIsoDate(v: unknown): string {
	try {
		if (typeof v === "string" && v.trim()) {
			const d = new Date(v);
			if (!Number.isNaN(d.getTime())) return d.toISOString();
		}
	} catch {
		// ignore
	}
	return new Date().toISOString();
}

async function loadSelectedPolicyId(pool: Pool, dealId: string): Promise<string | null> {
	if (!dealId) return null;
	try {
		const res = await pool.query(
			`SELECT dio_data
			   FROM public.deal_intelligence_objects
			  WHERE deal_id = $1::uuid
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[dealId],
		);
		const row = (res.rows ?? [])[0] as any;
		if (!row || !row.dio_data || typeof row.dio_data !== "object") return null;
		return getSelectedPolicyIdFromAny(row.dio_data);
	} catch {
		return null;
	}
}

type Money = { amount: number; currency: "USD" | "EUR" | "GBP" | null };

function parseScaledNumber(s: string): number | null {
	const m = s.match(/(-?\d+(?:[\d,]*\d)?(?:\.\d+)?)(\s*[kKmMbB])?\b/);
	if (!m) return null;
	const base = Number(String(m[1]).replace(/,/g, ""));
	if (!Number.isFinite(base)) return null;
	const suffix = (m[2] || "").trim().toLowerCase();
	const mult = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
	return base * mult;
}

function parseMoneyCandidates(text: string): Array<{ money: Money; raw: string; index: number }> {
	const out: Array<{ money: Money; raw: string; index: number }> = [];
	const rx = /([$€£])\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.(\d+))?\s*(k|m|mm|million|b|bn|billion)?/gi;
	for (const m of text.matchAll(rx)) {
		const sym = m[1];
		const num = `${m[2]}${m[3] ? `.${m[3]}` : ""}`;
		const suffixRaw = m[4] ? String(m[4]) : "";
		const suffix = (() => {
			const s = suffixRaw.trim().toLowerCase();
			if (!s) return "";
			if (s === "mm" || s === "million") return "m";
			if (s === "bn" || s === "billion") return "b";
			return s;
		})();
		const amt = parseScaledNumber(`${num}${suffix}`);
		if (!amt || !Number.isFinite(amt)) continue;
		const currency = sym === "$" ? "USD" : sym === "€" ? "EUR" : sym === "£" ? "GBP" : null;
		out.push({ money: { amount: amt, currency }, raw: m[0], index: m.index ?? 0 });
	}
	return out;
}

function parseBareMoneyCandidates(text: string): Array<{ money: Money; raw: string; index: number }> {
	// Best-effort: match amounts like "1.5MM" or "6M" without currency symbol.
	// Only used as a fallback in raise parsing (so context filters still apply).
	const out: Array<{ money: Money; raw: string; index: number }> = [];
	const rx = /\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.(\d+))?\s*(k|m|mm|million|b|bn|billion)\b/gi;
	for (const m of text.matchAll(rx)) {
		const num = `${m[1]}${m[2] ? `.${m[2]}` : ""}`;
		const suffixRaw = m[3] ? String(m[3]) : "";
		const suffix = (() => {
			const s = suffixRaw.trim().toLowerCase();
			if (s === "mm" || s === "million") return "m";
			if (s === "bn" || s === "billion") return "b";
			return s;
		})();
		const amt = parseScaledNumber(`${num}${suffix}`);
		if (!amt || !Number.isFinite(amt)) continue;
		out.push({ money: { amount: amt, currency: null }, raw: m[0], index: m.index ?? 0 });
	}
	return out;
}

function pickRaiseAmount(text: string): { money: Money | null; raw: string | null; confidence: number; reason: string } {
	const candidates = (() => {
		const withSym = parseMoneyCandidates(text);
		if (withSym.length > 0) return withSym;
		return parseBareMoneyCandidates(text);
	})();
	if (candidates.length === 0) return { money: null, raw: null, confidence: 0, reason: "no_money" };

	const scored = candidates
		.map((c) => {
			const before = text.slice(Math.max(0, c.index - 40), c.index).toLowerCase();
			const after = text.slice(c.index, Math.min(text.length, c.index + 60)).toLowerCase();
			let score = 0;
			if (/(raise|raising|seeking|target|ask|asking|funding|investment)/.test(before) || /(raise|raising|seeking|target)/.test(after)) score += 3;
			if (/(seed|series\s*[abc]|pre[- ]?seed)/.test(after) || /(seed|series\s*[abc]|pre[- ]?seed)/.test(before)) score += 1;
			// Penalize if it looks like revenue/ARR/etc.
			if (/(arr|revenue|sales|gmv|run[- ]?rate)/.test(before) || /(arr|revenue|sales|gmv|run[- ]?rate)/.test(after)) score -= 2;
			// Penalize if it looks like a historical outcome rather than a fundraising ask
			// (e.g. "created $2B in value", "helped raise $2B in enterprise value").
			if (/(in\s+(?:enterprise\s+)?value|in\s+value\s+created)/.test(after)) score -= 3;
			if (/(helped?\b|helping\b)/.test(before)) score -= 3;
			// Prefer mid-sized amounts (typical raises) over tiny ones.
			if (c.money.amount >= 250_000 && c.money.amount <= 200_000_000) score += 1;
			return { ...c, score };
		})
		.sort((a, b) => b.score - a.score || a.index - b.index || b.money.amount - a.money.amount);

	const best = scored[0];
	if (!best) return { money: null, raw: null, confidence: 0, reason: "no_best" };
	const confidence = clamp01(0.55 + 0.1 * best.score);
	return { money: best.money, raw: best.raw, confidence, reason: best.score >= 3 ? "context_keyword" : "fallback" };
}

/**
 * Returns true when the slide text references a fund or AUM context that should
 * never be promoted as a startup raise amount (e.g. "$100M Alternatives Fund",
 * "$500M AUM", "Limited Partner commitment").
 */
function containsFundAumLanguage(text: string): boolean {
	return /\b(?:alternatives?\s+fund|alternative\s+investment|aum|assets?\s+under\s+management|fund\s+size|investment\s+vehicle|limited\s+partners?(?:hip)?|\blp\b|general\s+partners?(?:hip)?|\bgp\b|fund\s+of\s+funds?|carried\s+interest|management\s+fee|endowment\s+fund|hedge\s+fund|private\s+equity\s+fund|venture\s+capital\s+fund|family\s+office|feeder\s+fund|co[\s-]invest)\b/i.test(text);
}

/**
 * Returns true when the text contains SPAC / de-SPAC / post-merger-public financial
 * boilerplate that should never contribute to startup raise or business model scoring.
 * e.g. EX-99.5 pro-forma balance sheets, Form S-4 merger proxy footnotes.
 */
function containsSpacFinancialLanguage(text: string): boolean {
	return /\b(?:public\s+shares?|public\s+stockholders?|business\s+combination\s+(?:agreement|transaction)|trust\s+account|blank\s+check\s+company|minimum\s+cash\s+condition|gross\s+cash\s+proceeds|pro\s+forma\s+enterprise\s+value|sponsor\s+(?:shares?|warrants?)|founder\s+(?:shares?|warrants?))\b/i.test(text);
}

function parseRaiseTermsFromText(text: string): { value_json: Record<string, any>; confidence: number } | null {
	const t = normalizeText(text);
	if (!t) return null;

	const lower = t.toLowerCase();
	const isRaiseSlide = /(raise|raising|funding|investment|round|seed|series\s*[abc]|pre[- ]?seed|the ask|seeking)/.test(lower);
	if (!isRaiseSlide) return null;

	// Defense-in-depth: "raised as of [date]" / "prior to the Closings" / "issued prior to"
	// describe SPAC pro-forma footnote context — notes already extinguished at merger close.
	if (/\braised\s+as\s+of\b|\bprior\s+to\s+the\s+closings?\b|\bissued\s+prior\s+to\b/i.test(lower)) return null;

	const picked = pickRaiseAmount(t);
	const amount = picked.money;

	const instrument = /(\bsafe\b)/i.test(t) ? "SAFE" : /(convertible\s+note)/i.test(t) ? "Convertible Note" : /(\bequity\b)/i.test(t) ? "Equity" : null;
	const round = /\bpre[- ]?seed\b/i.test(t)
		? "Pre-Seed"
		: /\bseed\b/i.test(t)
			? "Seed"
			: /\bseries\s*a\b/i.test(t)
				? "Series A"
				: /\bseries\s*b\b/i.test(t)
					? "Series B"
					: /\bseries\s*c\b/i.test(t)
						? "Series C"
						: null;

	let valuationCap: Money | null = null;
	const capRx = /(valuation\s*(?:cap)?|cap)\s*(?:of|:)?\s*([$€£]\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*[kKmMbB]?)/i;
	const capMatch = t.match(capRx);
	if (capMatch?.[2]) {
		const capCand = parseMoneyCandidates(capMatch[2]);
		if (capCand[0]) valuationCap = capCand[0].money;
	}
	if (!valuationCap) {
		// Handle reversed pattern: "$10M valuation cap".
		const capRx2 = /([$€£]\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*[kKmMbB]?)\s*(valuation\s*cap|cap)\b/i;
		const capMatch2 = t.match(capRx2);
		if (capMatch2?.[1]) {
			const capCand = parseMoneyCandidates(capMatch2[1]);
			if (capCand[0]) valuationCap = capCand[0].money;
		}
	}

	let valuation: Money | null = null;
	let valuationKind: string | null = null;
	// Patterns like: "on a $6MM valuation", "$6M valuation", "pre-money valuation $6M".
	const valRx1 = /(pre[- ]?money\s+)?valuation\s*(?:of|:|=|at|on)?\s*([$€£]\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|mm|million|b|bn|billion)?)/i;
	const valMatch1 = t.match(valRx1);
	if (valMatch1?.[2]) {
		const valCand = parseMoneyCandidates(valMatch1[2]);
		if (valCand[0]) {
			valuation = valCand[0].money;
			valuationKind = valMatch1[1] ? "pre_money" : null;
		}
	}
	if (!valuation) {
		const valRx2 = /([$€£]\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|mm|million|b|bn|billion)?)\s*(pre[- ]?money\s+)?valuation\b/i;
		const valMatch2 = t.match(valRx2);
		if (valMatch2?.[1]) {
			const valCand = parseMoneyCandidates(valMatch2[1]);
			if (valCand[0]) {
				valuation = valCand[0].money;
				valuationKind = valMatch2[2] ? "pre_money" : null;
			}
		}
	}

	const value_json: Record<string, any> = {
		amount: amount ? { amount: amount.amount, currency: amount.currency } : null,
		round,
		instrument,
		valuation_cap: valuationCap ? { amount: valuationCap.amount, currency: valuationCap.currency } : null,
		valuation: valuation ? { amount: valuation.amount, currency: valuation.currency } : null,
		valuation_kind: valuationKind,
		raw_text: t,
	};

	let confidence = 0.5;
	if (amount) confidence += 0.25;
	if (round) confidence += 0.05;
	if (instrument) confidence += 0.05;
	if (valuationCap) confidence += 0.05;
	if (valuation) confidence += 0.05;
	if (picked.confidence) confidence = Math.max(confidence, picked.confidence);
	confidence = clamp01(confidence);

	// Provide a UI-friendly display string.
	const displayParts: string[] = [];
	if (amount?.currency === "USD") displayParts.push(`$${formatCompact(amount.amount)}`);
	else if (amount) displayParts.push(`${formatCompact(amount.amount)}${amount.currency ? ` ${amount.currency}` : ""}`);
	if (round) displayParts.push(round);
	if (instrument) displayParts.push(instrument);
	if (valuationCap?.currency === "USD") displayParts.push(`cap $${formatCompact(valuationCap.amount)}`);
	if (valuation?.currency === "USD") displayParts.push(`@ $${formatCompact(valuation.amount)} valuation`);
	value_json.display = displayParts.length ? displayParts.join(" ") : null;

	return { value_json, confidence };
}

function formatCompact(amount: number): string {
	const abs = Math.abs(amount);
	if (abs >= 1e9) return `${trimZeros((amount / 1e9).toFixed(2))}B`;
	if (abs >= 1e6) return `${trimZeros((amount / 1e6).toFixed(2))}M`;
	if (abs >= 1e3) return `${trimZeros((amount / 1e3).toFixed(2))}K`;
	return String(Math.round(amount));
}

function trimZeros(s: string): string {
	return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function inferBusinessModelFromText(text: string): { value_json: Record<string, any>; confidence: number } | null {
	// Back-compat: treat plain text as a single-slide candidate.
	const t = normalizeText(text);
	if (!t) return null;
	const resolved = resolveBusinessModelFromSlides([
		{
			text: t,
			slide_title: null,
			document_id: "",
			page_index: null,
			extracted_at: new Date().toISOString(),
		},
	], null);
	if (!resolved) return null;
	return { value_json: resolved.value_json, confidence: resolved.confidence };
}

type BusinessModelSlideInput = {
	text: string;
	slide_title: string | null;
	segment_key?: string | null;
	document_id: string;
	page_index: number | null;
	extracted_at: string;
};

type BusinessModelSlideScore = {
	input: BusinessModelSlideInput;
	scores: { dtc: number; wholesale: number; saas: number; licensing: number; licensing_raw: number; title_boost: number; hcp: number };
	signals: {
		has_media_signals: boolean;
		has_ecom_mechanics: boolean;
		dtc_hits: string[];
		media_hits: string[];
		ecom_mechanics_hits: string[];
	};
	snippet: string | null;
	quality: 'high' | 'med' | 'low';
};

function extractSnippet(text: string, rx: RegExp, maxLen = 140): string | null {
	try {
		const m = text.match(rx);
		if (!m || typeof m.index !== 'number') return null;
		const idx = m.index;
		const start = Math.max(0, idx - 60);
		const end = Math.min(text.length, idx + Math.max(40, m[0].length) + 60);
		const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
		if (!raw) return null;
		return raw.length > maxLen ? `${raw.slice(0, maxLen - 1).trim()}…` : raw;
	} catch {
		return null;
	}
}

function scoreBusinessModelSlide(input: BusinessModelSlideInput): BusinessModelSlideScore | null {
	const t = normalizeText(input.text);
	if (!t) return null;
	const lower = t.toLowerCase();
	const title = (input.slide_title ?? '').toLowerCase().trim();
	const segmentKey = (input.segment_key ?? '').toLowerCase().trim();

	// Block: SPAC financial filings (EX-99.5, Form S-4) must never contribute to
	// business model classification. Their balance sheets and footnotes contain generic
	// business language that is noise in the context of a startup analysis.
	if (containsSpacFinancialLanguage(t)) return null;

	// Media / sponsorship language is often present in sports/content decks and can
	// superficially look "online" without being ecommerce.
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

	// Strict ecommerce mechanics: do NOT treat generic "ecommerce"/"website"/"digital" as mechanics.
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

	const titleCore = /(business\s+model|go\s*to\s*market|go[- ]?to[- ]?market|gtm|distribution|channels?|channel\s+strategy|sales\s+channels?|revenue\s+model|how\s+we\s+sell|where\s+we\s+sell|route\s+to\s+market)/i;
	const titleLicensingExamples = /(licensing\s+examples?|examples\s+of\s+licensing)/i;
	const titleLicensing = /\blicens(?:e|ing|ed)\b/i;

	let titleBoost = 0;
	if (segmentKey === 'business_model') titleBoost += 6;
	else if (segmentKey === 'go_to_market' || segmentKey === 'distribution' || segmentKey === 'channels') titleBoost += 2;
	if (title && titleCore.test(title)) titleBoost += 3;
	if (title && /(distribution|channels?|go\s*to\s*market|gtm|route\s+to\s+market)/i.test(title)) titleBoost += 1;
	if (title && titleLicensingExamples.test(title)) titleBoost -= 4;
	if (title && titleLicensing.test(title) && !titleCore.test(title)) titleBoost -= 1;

	const dtcPatterns: Array<{ rx: RegExp; w: number; kind: string }> = [
		{ rx: /\b(dt c|dtc|d2c|direct[- ]to[- ]consumer|direct to consumer|ecommerce|e-?commerce|shopify|online\s+store)\b/i, w: 3, kind: 'dtc_keyword' },
		// Use plural "orders" only — singular "order" in "in order to" is a false positive.
		{ rx: /\b(checkout|cart|orders|skus?|storefront|online\s+store|add\s+to\s+cart)\b/i, w: 2, kind: 'ecom_mechanics' },
		{ rx: /\b(email|sms)\b/i, w: 1, kind: 'email_sms' },
		{ rx: /\bpaid\s+search\b/i, w: 1, kind: 'paid_search' },
		{ rx: /most\s+of\s+our\s+business\s+is\s+direct\b[^\n]{0,80}\bwebsite\b/i, w: 6, kind: 'direct_via_website_phrase' },
		{ rx: /\bdirect\b[^\n]{0,80}\bvia\b[^\n]{0,40}\bwebsite\b/i, w: 4, kind: 'direct_via_website' },
	];

	const wholesalePatterns: Array<{ rx: RegExp; w: number; kind: string }> = [
		{ rx: /\bwholesale\b/i, w: 4, kind: 'wholesale' },
		{ rx: /\b(retail|retailers?|brick\s+and\s+mortar|b\s*&\s*m|in-?store|stores?)\b/i, w: 3, kind: 'retail' },
		{ rx: /\b(accounts?|account\s+base|green\s+grass)\b/i, w: 2, kind: 'accounts' },
		{ rx: /\b(channels?|channel\s+partners?|distribution|distributor|inside\s+sales)\b/i, w: 2, kind: 'channels' },
	];

	const saasPatterns: Array<{ rx: RegExp; w: number; kind: string }> = [
		{ rx: /\b(arr|mrr)\b/i, w: 3, kind: 'arr_mrr' },
		{ rx: /\bsubscription\b/i, w: 3, kind: 'subscription' },
	];

	const licensingPatterns: Array<{ rx: RegExp; w: number; kind: string }> = [
		{ rx: /\blicens(?:e|ing|ed)\b/i, w: 3, kind: 'licensing' },
		{ rx: /\broyalt(?:y|ies)\b/i, w: 2, kind: 'royalties' },
		{ rx: /\b(ip\s+licens(?:e|ing)|brand\s+licens(?:e|ing))\b/i, w: 2, kind: 'ip_brand_licensing' },
		// Treat media rights explicitly as licensing-like.
		{ rx: /\bmedia\s+rights?\b/i, w: 3, kind: 'media_rights' },
		{ rx: /\b(primary|core|main)\b[^\n]{0,40}\blicens(?:e|ing|ed)\b/i, w: 5, kind: 'licensing_primary_claim' },
		{ rx: /\brevenue\b[^\n]{0,40}\blicens(?:e|ing|ed)\b/i, w: 4, kind: 'licensing_revenue' },
	];

	// HCP / B2B2C / medtech patterns — healthcare-provider-mediated distribution where the
	// company sells through clinical channels (hospitals, physicians, care pathways) rather
	// than directly to consumers or traditional retail/wholesale accounts.
	const hcpPatterns: Array<{ rx: RegExp; w: number; kind: string }> = [
		{ rx: /\bb2b2c\b/i, w: 5, kind: 'b2b2c' },
		{ rx: /\b(healthcare\s+provider|hcp|physician|clinician|medical\s+practitioner)\b/i, w: 4, kind: 'hcp' },
		{ rx: /\b(hospital|clinic|medical\s+center|health\s+system)\b/i, w: 2, kind: 'healthcare_facility' },
		{ rx: /\b(medical\s+device|medtech|health\s+tech)\b/i, w: 3, kind: 'medtech' },
		{ rx: /\b(remote\s+patient\s+monitoring|virtual\s+care\s+suite|telehealth|digital\s+health)\b/i, w: 3, kind: 'digital_health' },
		{ rx: /\b(prescribed|prescribing|prescription|clinical\s+(?:protocol|pathway)|care\s+pathway)\b/i, w: 3, kind: 'clinical_pathway' },
	];

	const collectKinds = (patterns: Array<{ rx: RegExp; kind: string; neg?: RegExp }>): string[] => {
		const out: string[] = [];
		for (const p of patterns) {
			if (p.rx.test(t) && !p.neg?.test(t)) out.push(p.kind);
		}
		out.sort();
		return Array.from(new Set(out));
	};

	const scoreFrom = (patterns: Array<{ rx: RegExp; w: number }>): number => {
		let s = 0;
		for (const p of patterns) {
			if (p.rx.test(t)) s += p.w;
		}
		return s;
	};

	const media_hits = collectKinds(mediaSignals);
	const ecom_mechanics_hits = collectKinds(ecomMechanicsSignals);
	const has_media_signals = media_hits.length > 0;
	const has_ecom_mechanics = ecom_mechanics_hits.length > 0;
	const dtc_hits = collectKinds(dtcPatterns);

	let dtc = scoreFrom(dtcPatterns);
	const wholesale = scoreFrom(wholesalePatterns);
	const saas = scoreFrom(saasPatterns);
	const licensingRaw = scoreFrom(licensingPatterns);
	let licensing = licensingRaw;
	const hcp = scoreFrom(hcpPatterns);

	// Hard exclusion: if media/sponsorship signals are present AND ecommerce mechanics are not,
	// DTC cannot be selected (even if generic "ecommerce" appears).
	if (has_media_signals && !has_ecom_mechanics) {
		// Keep dtc_hits for diagnostics, but zero the DTC score to prevent selection.
		dtc = 0;
	}

	// If this looks like “Licensing examples”, heavily downweight licensing for *primary* selection.
	// (We still retain raw mention counts for secondary tagging.)
	if (title && titleLicensingExamples.test(title)) licensing = Math.max(0, licensing - 6);

	const isCandidate =
		titleCore.test(title) ||
		dtc > 0 ||
		wholesale > 0 ||
		saas > 0 ||
		licensing > 0 ||
		licensingRaw > 0 ||
		hcp > 0;
	if (!isCandidate) return null;

	const snippet =
		extractSnippet(t, /most\s+of\s+our\s+business\s+is\s+direct\b[^\n]{0,80}\bwebsite\b/i) ||
		extractSnippet(t, /\bdirect\b[^\n]{0,80}\bwebsite\b/i) ||
		extractSnippet(t, /\bwholesale\b/i) ||
		extractSnippet(t, /\blicens(?:e|ing|ed)\b/i) ||
		(t.length > 140 ? `${t.slice(0, 139).trim()}…` : t);

	const total = dtc + wholesale + saas + licensing + hcp + Math.max(0, titleBoost);
	const quality: 'high' | 'med' | 'low' = total >= 9 ? 'high' : total >= 5 ? 'med' : 'low';

	return {
		input: { ...input, text: t },
		scores: { dtc, wholesale, saas, licensing, licensing_raw: licensingRaw, title_boost: titleBoost, hcp },
		signals: {
			has_media_signals,
			has_ecom_mechanics,
			dtc_hits,
			media_hits,
			ecom_mechanics_hits,
		},
		snippet,
		quality,
	};
}

function looksLikeBoilerplateBusinessModelText(text: string): boolean {
	const t = normalizeText(text).toLowerCase();
	if (!t) return true;
	if (t.length < 24) return true;
	if (/\b(this\s+presentation|confidential|forward[-\s]?looking|not\s+an\s+offer|terms\s+and\s+conditions)\b/i.test(t)) return true;
	if (/\ball\s+rights\s+reserved\b/i.test(t)) return true;
	return false;
}

function resolveBusinessModelFromSlides(
	slides: BusinessModelSlideInput[],
	policyId: string | null,
): { value_json: Record<string, any>; confidence: number; extracted_at: string; best: BusinessModelSlideScore } | null {
	const scored: BusinessModelSlideScore[] = [];
	for (const s of slides) {
		if (looksLikeBoilerplateBusinessModelText(s.text)) continue;
		const row = scoreBusinessModelSlide(s);
		if (row) scored.push(row);
	}
	if (scored.length === 0) return null;

	const has_media_signals = scored.some((r) => r.signals.has_media_signals);
	const has_ecom_mechanics = scored.some((r) => r.signals.has_ecom_mechanics);
	// Require unambiguous real-estate terms only. Generic lending/finance terms (ltv, dscr,
	// preferred equity) appear in fintech, car-finance, and SBA-lending decks and must NOT
	// fire this flag — those deals have explicit startup policy IDs that take precedence.
	const has_real_estate_signals = scored.some((r) => /\b(real\s+estate|multifamily|noi|cap\s*rate|offering\s+memorandum)\b/i.test(r.input.text));
	const has_fund_signals = scored.some((r) => /\b(aum|assets\s+under\s+management|limited\s+partner|\blp\b|\bgp\b|fund\s+vehicle|fund\s+size|spv)\b/i.test(r.input.text));
	const is_preferred_equity = scored.some((r) => /\bpreferred\s+equity\b/i.test(r.input.text));
	const dtc_hits = Array.from(new Set(scored.flatMap((r) => r.signals.dtc_hits))).slice().sort().slice(0, 24);
	const media_hits = Array.from(new Set(scored.flatMap((r) => r.signals.media_hits))).slice().sort().slice(0, 24);
	const applied_guards: string[] = [];

	const rowTotalScore = (row: BusinessModelSlideScore): number => (
		row.scores.dtc +
		row.scores.wholesale +
		row.scores.saas +
		row.scores.licensing +
		(row.scores.hcp ?? 0) +
		Math.max(0, row.scores.title_boost)
	);

	const segmentPreference = (row: BusinessModelSlideScore): number => {
		const seg = (row.input.segment_key ?? '').toLowerCase().trim();
		if (seg === 'business_model') return 3;
		if (seg === 'go_to_market' || seg === 'distribution' || seg === 'channels') return 2;
		return seg ? 1 : 0;
	};

	const weightedTotals = { dtc: 0, wholesale: 0, saas: 0, licensing: 0, hcp: 0 };
	let bestOverall: BusinessModelSlideScore | null = null;
	let maxExtractedAt = scored[0]?.input.extracted_at ?? new Date().toISOString();
	let licensingPrimaryHits = 0;
	let licensingMentions = 0;
	let dtcMentions = 0;
	let wholesaleMentions = 0;

	for (const row of scored) {
		const qMult = row.quality === 'high' ? 1.25 : row.quality === 'med' ? 1.05 : 1;
		const titleBoost = row.scores.title_boost;
		const baseMult = 1 + Math.max(0, titleBoost) * 0.08;
		const mult = qMult * baseMult;
		weightedTotals.dtc += row.scores.dtc * mult;
		weightedTotals.wholesale += row.scores.wholesale * mult;
		weightedTotals.saas += row.scores.saas * mult;
		weightedTotals.licensing += row.scores.licensing * mult;
		weightedTotals.hcp += (row.scores.hcp ?? 0) * mult;

		if (row.scores.licensing_raw > 0) licensingMentions += 1;
		if (row.scores.dtc > 0) dtcMentions += 1;
		if (row.scores.wholesale > 0) wholesaleMentions += 1;
		if (row.scores.licensing >= 7) licensingPrimaryHits += 1;

		if (!bestOverall) bestOverall = row;
		else {
			const a = bestOverall;
			const aScore = rowTotalScore(a);
			const bScore = rowTotalScore(row);
			if (bScore > aScore) bestOverall = row;
		}

		if (row.input.extracted_at > maxExtractedAt) maxExtractedAt = row.input.extracted_at;
	}
	if (!bestOverall) return null;

	let dtc = weightedTotals.dtc;
	const wholesale = weightedTotals.wholesale;
	const saas = weightedTotals.saas;
	const licensing = weightedTotals.licensing;
	const hcp = weightedTotals.hcp;

	if (has_media_signals && !has_ecom_mechanics) {
		applied_guards.push('media_blocks_dtc_without_ecom_mechanics');
		dtc = 0;
	}

	// RC-007: Detect marketplace / fintech / platform / lending signals across all slides.
	// When these signals dominate and no explicit "wholesale" keyword is present,
	// the wholesale scoring is most likely triggered by "channel", "distribution partner"
	// or "accounts" language that does not indicate an actual wholesale business.
	const allSlideText = scored.map((r) => r.input.text).join(' ');
	const hasMarketplacePlatformSignals = /\b(marketplace|two[\s-]?sided|platform\s+fees?|take[\s-]rate|commission\s+model|fintech|lending\s+platform|neobank|credit\s+(platform|marketplace)|personal\s+finance\s+platform|financial\s+services\s+platform|insurance\s+marketplace|loan\s+(marketplace|platform)|payments?\s+platform|consumer\s+lending)\b/i.test(allSlideText);
	const hasExplicitWholesaleKeyword = /\bwholesale\b/i.test(allSlideText);

	const otherMax = Math.max(dtc, wholesale, saas);
	const licensingIsPrimary = (
		licensingPrimaryHits >= 2 &&
		licensingMentions >= 2 &&
		licensing >= 8 &&
		licensing >= otherMax * 1.5
	);

	let primaryLabel: string | null = null;
	if (licensingIsPrimary) {
		primaryLabel = 'Licensing';
	} else if (saas >= dtc && saas >= wholesale && saas >= 6) {
		primaryLabel = 'Subscription/SaaS';
	} else if (hcp >= 6 && hcp >= wholesale * 0.5 && dtc < 3) {
		// HCP / B2B2C channels: clinical distribution through healthcare providers dominates
		// over general wholesale signals when DTC interest is low.
		primaryLabel = 'B2B2C / HCP-Mediated';
	} else {
		// DTC often appears as a single explicit phrase (“DTC ecommerce”).
		// Use a lower threshold than wholesale, which tends to have more redundant signals.
		const hasDtc = dtc >= 3;
		const hasWholesale = wholesale >= 4;
		if (hasDtc && hasWholesale) primaryLabel = 'Omnichannel (DTC + Wholesale/Retail)';
		else if (hasDtc) primaryLabel = 'DTC Ecommerce';
		else if (hasWholesale) primaryLabel = 'Wholesale/Retail';
		else if (dtc > 0 || wholesale > 0) {
			primaryLabel = dtc >= wholesale ? 'DTC Ecommerce' : 'Wholesale/Retail';
		} else {
			primaryLabel = null;
		}
	}

	// RC-007: Suppress standalone "Wholesale/Retail" when marketplace / fintech / platform
	// signals are present and the actual word "wholesale" does not appear in the deck.
	// These companies use "channels", "distribution partners", "accounts" in their decks
	// which triggers wholesale patterns falsely. Without an explicit "wholesale" keyword
	// it is not a wholesale business — fall through to no label rather than mislabel.
	if (
		(primaryLabel === 'Wholesale/Retail') &&
		hasMarketplacePlatformSignals &&
		!hasExplicitWholesaleKeyword
	) {
		applied_guards.push('marketplace_platform_blocks_wholesale_without_keyword');
		primaryLabel = null;
	}

	if (!primaryLabel) return null;

	const displayMapping = toPolicyAwareBusinessModelDisplay({
		policyId,
		rawLabel: primaryLabel,
		hasRealEstateSignals: has_real_estate_signals,
		hasFundSignals: has_fund_signals,
		isPreferredEquity: is_preferred_equity,
	});
	const displayLabel = displayMapping.display;
	if (!displayLabel) return null;
	for (const reason of displayMapping.suppressedReasons) applied_guards.push(reason);

	const supportsPrimary = (row: BusinessModelSlideScore): boolean => {
		if (primaryLabel === 'Licensing') return row.scores.licensing_raw > 0;
		if (primaryLabel === 'Subscription/SaaS') return row.scores.saas > 0;
		if (primaryLabel === 'DTC Ecommerce') return row.scores.dtc > 0;
		if (primaryLabel === 'Wholesale/Retail') return row.scores.wholesale > 0;
		if (primaryLabel === 'Omnichannel (DTC + Wholesale/Retail)') return row.scores.dtc > 0 || row.scores.wholesale > 0;
		if (primaryLabel === 'B2B2C / HCP-Mediated') return (row.scores.hcp ?? 0) > 0;
		return false;
	};

	const relevantScore = (row: BusinessModelSlideScore): number => {
		if (primaryLabel === 'Licensing') return row.scores.licensing_raw;
		if (primaryLabel === 'Subscription/SaaS') return row.scores.saas;
		if (primaryLabel === 'DTC Ecommerce') return row.scores.dtc;
		if (primaryLabel === 'Wholesale/Retail') return row.scores.wholesale;
		if (primaryLabel === 'Omnichannel (DTC + Wholesale/Retail)') return row.scores.dtc + row.scores.wholesale;
		if (primaryLabel === 'B2B2C / HCP-Mediated') return row.scores.hcp ?? 0;
		return rowTotalScore(row);
	};

	const hasBothChannels = (row: BusinessModelSlideScore): boolean => row.scores.dtc > 0 && row.scores.wholesale > 0;

	const best = (
		scored
			.filter((r) => supportsPrimary(r))
			.slice()
			.sort((a, b) => {
				const ap = segmentPreference(a);
				const bp = segmentPreference(b);
				if (bp !== ap) return bp - ap;
				if (primaryLabel === 'Omnichannel (DTC + Wholesale/Retail)') {
					const aBoth = hasBothChannels(a) ? 1 : 0;
					const bBoth = hasBothChannels(b) ? 1 : 0;
					if (bBoth !== aBoth) return bBoth - aBoth;
				}
				const ar = relevantScore(a);
				const br = relevantScore(b);
				if (br !== ar) return br - ar;
				const at = rowTotalScore(a);
				const bt = rowTotalScore(b);
				if (bt !== at) return bt - at;
				if (b.input.extracted_at !== a.input.extracted_at) return b.input.extracted_at.localeCompare(a.input.extracted_at);
				const apg = typeof a.input.page_index === 'number' ? a.input.page_index : Number.POSITIVE_INFINITY;
				const bpg = typeof b.input.page_index === 'number' ? b.input.page_index : Number.POSITIVE_INFINITY;
				if (apg !== bpg) return apg - bpg;
				return String(a.input.slide_title ?? '').localeCompare(String(b.input.slide_title ?? ''));
			})[0] ??
			bestOverall
	);

	const secondaryTags: string[] = [];
	if (!licensingIsPrimary && licensingMentions > 0) secondaryTags.push('Licensing');

	// Confidence based on multi-slide corroboration and signal strength.
	let confidence = 0.55;
	const totalSignals = dtc + wholesale + saas + licensing + hcp;
	if (totalSignals >= 10) confidence += 0.18;
	else if (totalSignals >= 6) confidence += 0.12;
	else if (totalSignals >= 3) confidence += 0.06;
	if (dtcMentions + wholesaleMentions >= 2) confidence += 0.08;
	if (primaryLabel === 'Omnichannel (DTC + Wholesale/Retail)') confidence += 0.08;
	confidence = clamp01(confidence);

	const topSources = scored
		.slice()
		.sort((a, b) => {
			return rowTotalScore(b) - rowTotalScore(a);
		})
		.slice(0, 3)
		.map((r) => ({
			document_id: r.input.document_id || null,
			page_index: r.input.page_index,
			slide_title: r.input.slide_title,
			snippet: r.snippet,
			scores: r.scores,
			quality: r.quality,
		}));

	const value_json: Record<string, any> = {
		primary_label: primaryLabel,
		display_label_raw: primaryLabel,
		secondary_tags: secondaryTags,
		scores: {
			dtc: Math.round(dtc * 100) / 100,
			wholesale: Math.round(wholesale * 100) / 100,
			saas: Math.round(saas * 100) / 100,
			licensing: Math.round(licensing * 100) / 100,
			hcp: Math.round(hcp * 100) / 100,
		},
		sources: topSources,
		display: displayLabel,
		note_snippet: best.snippet,
		diagnostics: {
			policy_id: policyId,
			routing_mode: "deterministic_policy_aware_v1",
			has_media_signals,
			has_ecom_mechanics,
			has_real_estate_signals,
			has_fund_signals,
			is_preferred_equity,
			dtc_hits,
			media_hits,
			applied_guards,
			decision_reason: `totals(dtc=${Math.round(dtc * 100) / 100}, wholesale=${Math.round(wholesale * 100) / 100}, saas=${Math.round(saas * 100) / 100}, licensing=${Math.round(licensing * 100) / 100}, hcp=${Math.round(hcp * 100) / 100}) raw_label=${primaryLabel} display=${displayLabel}`,
		},
	};

	return { value_json, confidence, extracted_at: maxExtractedAt, best };
}

function raisePreferenceScore(input: { slide_title: string | null; segment_key: string | null; slide_text: string }): number {
	const title = (input.slide_title ?? '').toLowerCase();
	const seg = (input.segment_key ?? '').toLowerCase();
	const lower = (input.slide_text ?? '').toLowerCase();
	let score = 0;
	if (seg === 'raise_terms' || seg === 'use_of_funds') score += 3;
	if (/\b(capital\s+raise|the\s+ask|raise|raising|funding|investment)\b/.test(title)) score += 2;
	if (/\b(valuation|pre-?money|post-?money|cap\s*table|term\s*sheet|safe|convertible|equity)\b/.test(lower)) score += 1;
	return score;
}

function slideTypeToSegmentKey(slideType: string | null | undefined): string | null {
	if (!slideType) return null;
	const t = slideType.trim().toLowerCase();
	if (t === 'go_to_market') return 'distribution';
	if (t === 'use_of_funds') return 'raise_terms';
	if (t === 'other' || t === '') return null;
	return t;
}

function buildSlideTextFromPayload(payload: any): {
	text: string;
	slide_title: string | null;
	slide_number: number | null;
	segment_key: string | null;
	bullets: string[];
} {
	const structured = payload?.structured ?? null;
	const textBlocks = payload?.text_blocks ?? null;

	const slide_title =
		asNonEmptyString(structured?.title) ??
		asNonEmptyString(structured?.slide_title) ??
		asNonEmptyString(textBlocks?.title) ??
		asNonEmptyString(payload?.slide_title) ??
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

	const slide_number_raw = structured?.slide_number ?? structured?.slideIndex ?? structured?.page_index;
	const slide_number = typeof slide_number_raw === "number" && Number.isFinite(slide_number_raw) ? Math.floor(slide_number_raw) : null;

	const segment_key =
		asNonEmptyString(structured?.segment_key) ??
		slideTypeToSegmentKey(asNonEmptyString(payload?.resolved_slide_type)) ??
		null;

	const parts = [slide_title, bullets.join("\n"), notes, snippet, pageText, normalized].filter((p) => typeof p === "string" && p.trim());
	const text = normalizeText(parts.join("\n"));

	return { text, slide_title, slide_number, segment_key, bullets };
}

function betterCandidate(a: PromotedFact, b: PromotedFact): PromotedFact {
	if (b.confidence > a.confidence) return b;
	if (b.confidence < a.confidence) return a;
	// tie-breaker: extracted_at
	if (b.extracted_at > a.extracted_at) return b;
	if (b.extracted_at < a.extracted_at) return a;
	return a;
}

async function upsertPromotedFact(
	pool: Pool,
	dealId: string,
	fact: PromotedFact,
	_opts?: { run_id?: string | null; step_run_id?: string | null }
): Promise<{ inserted: number; updated: number }> {
	// IMPORTANT: evidence_id must be stable and deal-scoped.
	// Derive from the explicit dealId param (not from meta), so persistence is deterministic.
	const evidenceId = stableEvidenceId(dealId, fact.fact_type);
	const betterExpr = `(EXCLUDED.confidence > evidence_items.confidence OR (EXCLUDED.confidence = evidence_items.confidence AND EXCLUDED.extracted_at > evidence_items.extracted_at))`;
	// Allow re-materializing a fact for the same slide candidate even if extracted_at/confidence are unchanged.
	// This is important for deterministic rule updates: we want reruns to refresh content_json/diagnostics
	// without letting a worse candidate overwrite the current winner.
	const sameCandidateExpr = `(
		EXCLUDED.source_document_id IS NOT DISTINCT FROM evidence_items.source_document_id
		AND (EXCLUDED.meta->>'page_index') IS NOT DISTINCT FROM (evidence_items.meta->>'page_index')
		AND (EXCLUDED.meta->>'segment_key') IS NOT DISTINCT FROM (evidence_items.meta->>'segment_key')
	)`;
	const refreshExpr = `(${betterExpr} OR ${sameCandidateExpr})`;

	const meta = {
		...(fact.meta ?? {}),
		run_id: typeof _opts?.run_id === "string" && _opts.run_id.trim().length > 0 ? _opts.run_id.trim() : null,
		step_run_id:
			typeof _opts?.step_run_id === "string" && _opts.step_run_id.trim().length > 0 ? _opts.step_run_id.trim() : null,
		promoter: "promoteSlideFactsFromDocumentPageUnderstanding",
		promoter_version: "2026-02-17",
	};
	const sql = `INSERT INTO evidence_items (
	evidence_id,
	deal_id,
	source_type,
	source_path,
	source_document_id,
	tags,
	confidence,
	extracted_at,
	content_text,
	content_json,
	meta
) VALUES (
	$1,
	$2::uuid,
	$3,
	$4,
	$5::uuid,
	$6,
	$7,
	$8::timestamptz,
	$9,
	$10::jsonb,
	$11::jsonb
)
ON CONFLICT (evidence_id) DO UPDATE SET
	confidence = GREATEST(evidence_items.confidence, EXCLUDED.confidence),
	extracted_at = GREATEST(evidence_items.extracted_at, EXCLUDED.extracted_at),
	tags = CASE WHEN ${refreshExpr} THEN EXCLUDED.tags ELSE evidence_items.tags END,
	source_path = CASE WHEN ${refreshExpr} THEN EXCLUDED.source_path ELSE evidence_items.source_path END,
	source_document_id = CASE WHEN ${refreshExpr} THEN EXCLUDED.source_document_id ELSE evidence_items.source_document_id END,
	content_text = CASE WHEN ${refreshExpr} THEN EXCLUDED.content_text ELSE evidence_items.content_text END,
	content_json = CASE WHEN ${refreshExpr} THEN EXCLUDED.content_json ELSE evidence_items.content_json END,
	meta = CASE WHEN ${refreshExpr} THEN EXCLUDED.meta ELSE evidence_items.meta END,
	updated_at = now()
RETURNING (xmax = 0) as inserted`;

	const params = [
		evidenceId,
		dealId,
		fact.source_type ?? "promoted_slide_fact",
		fact.source_path,
		fact.source_document_id,
		Array.isArray(fact.tags) && fact.tags.length > 0 ? fact.tags : [`fact`, `fact_type:${fact.fact_type}`],
		clamp01(fact.confidence),
		fact.extracted_at,
		JSON.stringify({ fact_type: fact.fact_type, display: fact.value_json?.display ?? null, note_snippet: fact.value_json?.note_snippet ?? null }),
		JSON.stringify({
			fact_type: fact.fact_type,
			value_json: fact.value_json,
			provenance: {
				source_path: fact.source_path,
				source_document_id: fact.source_document_id,
				page_index: fact.meta.page_index,
				slide_number: fact.meta.slide_number ?? null,
				segment_key: fact.meta.segment_key ?? null,
				slide_title: fact.meta.slide_title ?? null,
			},
		}),
		JSON.stringify(meta),
	];

	const res = await pool.query(sql, params);
	let inserted = 0;
	let updated = 0;
	for (const row of res.rows ?? []) {
		if (row && (row as any).inserted) inserted += 1;
		else updated += 1;
	}
	return { inserted, updated };
}

export async function promoteSlideFactsFromDocumentPageUnderstanding(pool: Pool, params: PromoteSlideFactsParams): Promise<{ ok: boolean; inserted: number; updated: number; facts: PromotedFact[]; warnings: string[] }> {
	const warnings: string[] = [];
	const version = (params.version ?? "page_understanding_v1").trim();
	const dealId = String(params.dealId ?? "").trim();
	const documentId = String(params.documentId ?? "").trim();
	const paramPolicyId = typeof params.selectedPolicyId === "string" && params.selectedPolicyId.trim().length > 0
		? params.selectedPolicyId.trim()
		: null;
	const selectedPolicyId = paramPolicyId ?? (await loadSelectedPolicyId(pool, dealId));
	const pageStart = Math.max(0, Math.floor(params.pageStart ?? 0));
	let pageEnd = Math.max(pageStart, Math.floor(params.pageEnd ?? pageStart));

	if (!dealId || !documentId) return { ok: true, inserted: 0, updated: 0, facts: [], warnings: [] };

	try {
		await pool.query("SELECT 1 FROM evidence_items LIMIT 1");
	} catch (err: any) {
		if (isMissingTableError(err)) return { ok: true, inserted: 0, updated: 0, facts: [], warnings: ["evidence_items_missing"] };
		warnings.push(`evidence_items_unavailable:${err?.code ?? "unknown"}`);
		return { ok: true, inserted: 0, updated: 0, facts: [], warnings };
	}

	// If caller did not provide a usable pageEnd (common when documents.page_count is missing),
	// infer the effective page range from existing DPU rows.
	if (pageEnd <= pageStart) {
		try {
			const res = await pool.query(
				`SELECT MAX(page_index) AS max_page_index
				   FROM public.document_page_understanding
				  WHERE document_id = $1::uuid
				    AND deal_id = $2::uuid
				    AND version = $3`,
				[documentId, dealId, version]
			);
			const maxIdxRaw = (res.rows?.[0] as any)?.max_page_index;
			const maxIdx = typeof maxIdxRaw === 'number' ? maxIdxRaw : Number(maxIdxRaw);
			if (Number.isFinite(maxIdx) && maxIdx >= pageStart) pageEnd = Math.max(pageStart, Math.floor(maxIdx) + 1);
		} catch (err: any) {
			if (isMissingTableError(err)) return { ok: true, inserted: 0, updated: 0, facts: [], warnings: ["document_page_understanding_missing"] };
			warnings.push(`dpu_range_infer_failed:${err?.code ?? "unknown"}`);
		}
	}

	if (pageEnd <= pageStart) return { ok: true, inserted: 0, updated: 0, facts: [], warnings };

	let dpuRows: Array<{ page_index: number; payload: any }> = [];
	try {
		const res = await pool.query(
			`SELECT page_index, payload
			   FROM public.document_page_understanding
			  WHERE document_id = $1::uuid
			    AND deal_id = $2::uuid
			    AND version = $3
			    AND page_index >= $4
			    AND page_index < $5
			  ORDER BY page_index ASC`,
			[documentId, dealId, version, pageStart, pageEnd]
		);
		dpuRows = (res.rows ?? []).map((r: any) => ({ page_index: Number(r.page_index ?? 0), payload: r.payload }));
	} catch (err: any) {
		if (isMissingTableError(err)) return { ok: true, inserted: 0, updated: 0, facts: [], warnings: ["document_page_understanding_missing"] };
		warnings.push(`dpu_load_failed:${err?.code ?? "unknown"}`);
		return { ok: true, inserted: 0, updated: 0, facts: [], warnings };
	}

	const bestByType = new Map<PromotedFactType, PromotedFact>();
	const raiseCandidates: Array<{ fact: PromotedFact; preference: number }> = [];
	const businessModelSlides: BusinessModelSlideInput[] = [];

	for (const row of dpuRows) {
		const payload = row.payload ?? {};
		const source = payload?.source ?? {};
		const extractedAt = toIsoDate(source?.extracted_at);
		const slide = buildSlideTextFromPayload(payload);
		const slideText = slide.text;
		if (!slideText) continue;

		const baseMeta = {
			deal_id: dealId,
			document_id: documentId,
			page_index: row.page_index,
			slide_number: slide.slide_number,
			segment_key: slide.segment_key,
			slide_title: slide.slide_title,
		};

		const raise = (() => {
			// Guardrail: only promote raise_terms_v1 when the slide is truly an explicit "ask"
			// and never when the slide looks like market sizing (TAM/SAM/SOM / market is $X)
			// or when the slide describes a fund vehicle (AUM, LP, alternatives fund, etc.)
			// or when the slide is SPAC / de-SPAC financial boilerplate (pro-forma footnotes,
			// EX-99.5 balance sheets, Form S-4 merger proxy disclosures).
			if (containsMarketSizingLanguage(slideText)) return null;
			if (!inferIsRaiseAskSlide(slideText)) return null;
			if (containsFundAumLanguage(slideText)) return null;
			if (containsSpacFinancialLanguage(slideText)) return null;
			return parseRaiseTermsFromText(slideText);
		})();
		if (raise) {
			const fact: PromotedFact = {
				fact_type: "raise_terms_v1",
				value_json: raise.value_json,
				confidence: raise.confidence,
				extracted_at: extractedAt,
				source_path: `doc:${documentId}:page:${row.page_index + 1}`,
				source_document_id: documentId,
				meta: baseMeta,
			};
			raiseCandidates.push({
				fact,
				preference: raisePreferenceScore({ slide_title: slide.slide_title, segment_key: slide.segment_key, slide_text: slideText }),
			});
		}

		businessModelSlides.push({
			text: slideText,
			slide_title: slide.slide_title,
			segment_key: slide.segment_key,
			document_id: documentId,
			page_index: row.page_index,
			extracted_at: extractedAt,
		});
	}

	// Choose best raise candidate with a deterministic preference for raise_terms pages.
	if (raiseCandidates.length > 0) {
		raiseCandidates.sort((a, b) => {
			if (b.preference !== a.preference) return b.preference - a.preference;
			if (b.fact.confidence !== a.fact.confidence) return b.fact.confidence - a.fact.confidence;
			if (b.fact.extracted_at !== a.fact.extracted_at) return b.fact.extracted_at.localeCompare(a.fact.extracted_at);
			return 0;
		});
		bestByType.set('raise_terms_v1', raiseCandidates[0].fact);
	}

	// Business model: resolve across all slides in this chunk.
	const resolvedModel = resolveBusinessModelFromSlides(businessModelSlides, selectedPolicyId);
	if (resolvedModel) {
		const bestMeta = {
			deal_id: dealId,
			document_id: documentId,
			page_index: resolvedModel.best.input.page_index ?? (dpuRows[0]?.page_index ?? 0),
			slide_number: null,
			segment_key: resolvedModel.best.input.segment_key ?? null,
			slide_title: resolvedModel.best.input.slide_title,
		};

		const secondary = Array.isArray(resolvedModel.value_json?.secondary_tags)
			? resolvedModel.value_json.secondary_tags.filter((x: any) => typeof x === 'string' && x.trim().length > 0).map((x: string) => x.trim())
			: [];
		const tags = [
			'fact',
			'fact_type:business_model_v1',
			'signal:business_model',
			'field:primary_model',
			...secondary.map((t: string) => `secondary:${t}`),
		];

		const bestDoc = typeof resolvedModel.best.input.document_id === 'string' && resolvedModel.best.input.document_id.trim()
			? resolvedModel.best.input.document_id.trim()
			: documentId;
		const bestPageIndex = typeof resolvedModel.best.input.page_index === 'number' ? resolvedModel.best.input.page_index : (bestMeta.page_index ?? 0);
		const sourcePath = `doc:${bestDoc}:page:${bestPageIndex + 1}`;

		const fact: PromotedFact = {
			fact_type: 'business_model_v1',
			source_type: 'business_model_fact',
			tags,
			value_json: resolvedModel.value_json,
			confidence: resolvedModel.confidence,
			extracted_at: resolvedModel.extracted_at,
			source_path: sourcePath,
			source_document_id: bestDoc,
			meta: bestMeta,
		};
		const existing = bestByType.get(fact.fact_type);
		bestByType.set(fact.fact_type, existing ? betterCandidate(existing, fact) : fact);
	}

	const facts = Array.from(bestByType.values()).sort((a, b) => b.confidence - a.confidence || b.extracted_at.localeCompare(a.extracted_at));
	if (facts.length === 0) {
		// Warn (but do not fail): promotion is best-effort.
		console.warn(
			JSON.stringify({
				event: "PROMOTE_SLIDE_FACTS_ZERO_FACTS",
				deal_id: dealId,
				document_id: documentId,
				page_start: pageStart,
				page_end: pageEnd,
				version,
				dpu_rows_loaded: dpuRows.length,
				warnings,
				ts: new Date().toISOString(),
			})
		);
	}

	// Stale-raise cleanup: if this document scan produced no raise candidate, delete any
	// previously stored raise_terms_v1 evidence that was sourced from THIS document.
	// This prevents a stale false-positive raise (e.g. from a B2B abbreviation or an advisor
	// bio page) from persisting across re-runs once the underlying detection rule is fixed.
	// We scope the delete to `source_document_id = documentId` so that a valid raise found
	// in a sibling document is not erased.
	if (raiseCandidates.length === 0) {
		const raiseEvidenceId = stableEvidenceId(dealId, 'raise_terms_v1');
		try {
			await pool.query(
				`DELETE FROM evidence_items
				  WHERE evidence_id = $1
				    AND deal_id   = $2::uuid
				    AND source_document_id = $3::uuid`,
				[raiseEvidenceId, dealId, documentId]
			);
		} catch {
			// Non-fatal: deletion is best-effort. On next successful promotion the
			// stale row will be overwritten by the correct candidate.
		}
	}

	let inserted = 0;
	let updated = 0;
	for (const fact of facts) {
		try {
			const res = await upsertPromotedFact(pool, dealId, fact, { run_id: params.runId ?? null, step_run_id: params.stepRunId ?? null });
			inserted += res.inserted;
			updated += res.updated;
		} catch (err: any) {
			warnings.push(`promoted_fact_upsert_failed:${err?.code ?? "unknown"}`);
		}
	}

	return { ok: true, inserted, updated, facts, warnings };
}

export const __test__ = {
	parseRaiseTermsFromText,
	inferBusinessModelFromText,
	stableEvidenceId,
	slideTypeToSegmentKey,
};
