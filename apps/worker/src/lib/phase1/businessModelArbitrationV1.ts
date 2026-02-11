import { arbitrateBusinessModelV1 } from "@dealdecision/core";
import type {
	BusinessModelArbitrationInput,
	BusinessModelArbitrationResult,
	BusinessModelCandidate,
	BusinessModelKpi,
	BusinessModelRevenueType,
} from "@dealdecision/core";

type DocInput = {
	document_id: string;
	title?: string | null;
	type?: string | null;
	full_text?: string | null;
	full_content?: unknown | null;
};

function sanitizeInlineText(value: string): string {
	return value
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractPagesFromFullContent(full_content: unknown, type?: string | null): Array<{ page: number; title?: string; text: string }> {
	const out: Array<{ page: number; title?: string; text: string }> = [];
	const t = (type ?? "").toLowerCase();
	const c: any = full_content as any;
	if (!c || typeof c !== "object") return out;

	if (t === "pitch_deck" || t === "pdf") {
		const pages = Array.isArray(c.pages) ? c.pages : Array.isArray(c.pdf?.pages) ? c.pdf.pages : [];
		for (let i = 0; i < pages.length; i++) {
			const p: any = pages[i] ?? {};
			const parts: string[] = [];
			const title = typeof p.slideTitle === "string" ? p.slideTitle : typeof p.title === "string" ? p.title : "";
			if (title) parts.push(title);
			if (typeof p.text === "string") parts.push(p.text);
			const text = parts.join("\n").trim();
			if (!text) continue;
			out.push({ page: i + 1, title: title || undefined, text });
		}
		return out;
	}

	if (t === "powerpoint") {
		const slides = Array.isArray(c.slides) ? c.slides : [];
		for (let i = 0; i < slides.length; i++) {
			const s: any = slides[i] ?? {};
			const parts: string[] = [];
			const title = typeof s.title === "string" ? s.title : "";
			if (title) parts.push(title);
			if (typeof s.textContent === "string") parts.push(s.textContent);
			if (typeof s.notes === "string") parts.push(s.notes);
			const text = parts.join("\n").trim();
			if (!text) continue;
			out.push({ page: i + 1, title: title || undefined, text });
		}
		return out;
	}

	return out;
}

function uniqStrings(xs: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const x of xs) {
		const s = String(x ?? "").trim();
		if (!s) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function detectRevenueTypesFromText(textLc: string): BusinessModelRevenueType[] {
	const out: BusinessModelRevenueType[] = [];
	if (/\bsaas\b|\bsubscription\b|recurring\s+revenue|\bmrr\b|\barr\b/.test(textLc)) out.push("saas_subscriptions");
	if (/\blicens(e|ing)\b|\broyalt(y|ies)\b/.test(textLc)) out.push("licensing");
	if (/\bservices\b|\bconsulting\b|\bimplementation\b|\bagency\b/.test(textLc)) out.push("services");
	if (/\brent\b|\blease\b|\btenant\b|rent\s+roll|occupancy/.test(textLc)) out.push("rents");
	if (/\bgmv\b|take\s+rate|transaction\s+volume|\btransactions?\b/.test(textLc)) out.push("transactional");
	return uniqStrings(out) as BusinessModelRevenueType[];
}

function detectKpisFromText(textLc: string): BusinessModelKpi[] {
	const out: BusinessModelKpi[] = [];
	if (/\bmrr\b|monthly\s+recurring\s+revenue/.test(textLc)) out.push("mrr");
	if (/\barr\b|annual\s+recurring\s+revenue/.test(textLc)) out.push("arr");
	if (/\bnrr\b/.test(textLc)) out.push("nrr");
	if (/\bndr\b|\bnet\s+dollar\s+retention\b/.test(textLc)) out.push("ndr");
	if (/\bchurn\b/.test(textLc)) out.push("churn");
	if (/\bcac\b|customer\s+acquisition\s+cost/.test(textLc)) out.push("cac");
	if (/\bltv\b|lifetime\s+value/.test(textLc)) out.push("ltv");
	if (/\bgmv\b/.test(textLc)) out.push("gmv");
	if (/take\s+rate/.test(textLc)) out.push("take_rate");
	if (/\bnoi\b|net\s+operating\s+income/.test(textLc)) out.push("noi");
	if (/cap\s*rate|\bcaprate\b/.test(textLc)) out.push("cap_rate");
	if (/\bdscr\b|debt\s+service\s+coverage/.test(textLc)) out.push("dscr");
	if (/\bltv\b|loan[-\s]?to[-\s]?value/.test(textLc) && (/property|real\s+estate/.test(textLc))) out.push("ltv_real_estate");
	return uniqStrings(out) as BusinessModelKpi[];
}

function detectDescriptorsFromText(textLc: string): string[] {
	const out: string[] = [];
	const push = (s: string, re: RegExp) => {
		if (re.test(textLc)) out.push(s);
	};

	push("platform", /\bplatform\b/);
	push("software", /\bsoftware\b/);
	push("api", /\bapi\b/);
	push("dashboard", /\bdashboard\b/);
	push("workflow", /\bworkflow\b/);
	push("ai-powered", /ai[-\s]?powered|\bartificial\s+intelligence\b|\bmachine\s+learning\b|\bml\b/);
	push("compliance", /\bcompliance\b|\bregulatory\b|\bregulation\b|\baudit\b|\bsoc\s*2\b|\bhipaa\b|\bgdpr\b|\bkyc\b|\baml\b/);
	push("property", /\bproperty\b|\breal\s+estate\b|\bmultifamily\b|\btenant\b/);

	return uniqStrings(out);
}

function detectSlideArchetypesFromPages(pages: Array<{ title?: string; text: string }>): string[] {
	const out: string[] = [];
	for (const p of pages) {
		const title = sanitizeInlineText(String(p.title ?? ""));
		const t = title.toLowerCase();
		if (!t) continue;
		if (/revenue\s+model|pricing|business\s+model|how\s+we\s+make\s+money/.test(t)) out.push("Revenue Model");
		if (/traction|kpi|metrics|growth/.test(t)) out.push("Traction");
		if (/gtm|go[-\s]?to[-\s]?market|distribution|channels|sales/.test(t)) out.push("GTM");
		if (/use\s+of\s+funds|funding\s+use|allocation/.test(t)) out.push("Use of Funds");
	}
	return uniqStrings(out);
}

function mapOverviewBusinessModelToCandidate(v: unknown): BusinessModelCandidate | null {
	const s = typeof v === "string" ? v.trim() : "";
	if (!s) return null;
	return { business_model: s, confidence: 0.45, source: "phase1.deal_overview_v2.business_model" };
}

function mapArchetypeToCandidate(archetype: any): BusinessModelCandidate | null {
	const value = typeof archetype?.value === "string" ? archetype.value.trim() : "";
	if (!value) return null;
	const confidence = typeof archetype?.confidence === "number" ? archetype.confidence : 0.5;
	return { business_model: value, confidence, source: "phase1.business_archetype_v1" };
}

export function buildPhase1BusinessModelArbitrationV1(params: {
	documents: DocInput[];
	deal_overview_v2?: any;
	business_archetype_v1?: any;
}): BusinessModelArbitrationResult {
	const docs = Array.isArray(params.documents) ? params.documents : [];

	const combined = docs
		.map((d) => (typeof d.full_text === "string" ? d.full_text : ""))
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 80_000);

	const pages = docs
		.flatMap((d) => extractPagesFromFullContent(d.full_content ?? null, d.type).slice(0, 20))
		.slice(0, 120);

	const combinedPagesText = pages.map((p) => p.text).join("\n\n").slice(0, 120_000);
	const textLc = sanitizeInlineText([combined, combinedPagesText].filter(Boolean).join("\n\n")).toLowerCase();

	const detected_revenue_types = detectRevenueTypesFromText(textLc);
	const kpis_present = detectKpisFromText(textLc);
	const product_descriptors = detectDescriptorsFromText(textLc);
	const slide_archetypes = detectSlideArchetypesFromPages(pages);

	const candidates: BusinessModelCandidate[] = [];
	const overviewCandidate = mapOverviewBusinessModelToCandidate(params.deal_overview_v2?.business_model);
	if (overviewCandidate) candidates.push(overviewCandidate);
	const archetypeCandidate = mapArchetypeToCandidate(params.business_archetype_v1);
	if (archetypeCandidate) candidates.push(archetypeCandidate);

	const input: BusinessModelArbitrationInput = {
		detected_revenue_types,
		kpis_present,
		product_descriptors,
		slide_archetypes,
		candidates,
	};

	return arbitrateBusinessModelV1(input);
}
