import type { Pool } from "pg";

import { stableJsonStringify } from "../../lib/stable-json";
import { sha256Hex } from "../evidence/canonical-evidence";

export type DocumentIntelligenceExtractInput = {
	deal_id: string;
	document_id: string;
	run_id?: string | null;
	step_run_id?: string | null;
};

export type FunctionalSectionLabel =
	| "overview"
	| "problem"
	| "product"
	| "go_to_market"
	| "traction"
	| "team"
	| "financials"
	| "raise_terms"
	| "risks";

export type DocumentIntelligenceStepSummary = {
	deal_id: string;
	document_id: string;
	evidence_total: number;
	by_signal_category: Record<string, number>;
	by_section_label: Record<string, number>;
	by_page_section_label: Record<string, Record<string, number>>;
};

export type DocumentIntelligenceExtractResult = {
	ok: true;
	summary: DocumentIntelligenceStepSummary;
	inserted: number;
	updated: number;
	warnings: string[];
	/**
	 * Used by the worker run-ledger wrapper to persist deterministic step summaries.
	 * (Not part of any end-user API response.)
	 */
	__step_summary: DocumentIntelligenceStepSummary;
};

type TextBlock = {
	source_path: string;
	page_index: number | null;
	text: string;
	title: string | null;
};

const EXTRACTOR_NAME = "document_intelligence";
const EXTRACTOR_VERSION = "v1";

function normalizeText(text: string): string {
	return String(text ?? "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/[\t ]+/g, " ")
		.replace(/\n[\t ]+/g, "\n")
		.replace(/[\t ]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function computeSignalEvidenceId(seed: {
	deal_id: string;
	document_id: string;
	source_path: string;
	content_text?: string | null;
	content_json?: unknown;
	extractor_name: string;
	extractor_version: string;
}): string {
	const payload = stableJsonStringify({
		deal_id: seed.deal_id,
		document_id: seed.document_id,
		source_path: seed.source_path,
		content_text: seed.content_text ? normalizeText(seed.content_text) : null,
		content_json: seed.content_json ?? null,
		extractor_name: seed.extractor_name,
		extractor_version: seed.extractor_version,
	});
	return `ev_${sha256Hex(payload).slice(0, 32)}`;
}

function uniqSorted(values: string[]): string[] {
	return Array.from(new Set(values.map((v) => String(v)))).sort((a, b) => a.localeCompare(b));
}

function inc(map: Record<string, number>, key: string, by = 1) {
	map[key] = (map[key] ?? 0) + by;
}

async function hasTable(pool: Pick<Pool, "query">, table: string): Promise<boolean> {
	try {
		const res = await pool.query<{ oid: string | null }>(`SELECT to_regclass($1) AS oid`, [table]);
		return Boolean(res.rows?.[0]?.oid);
	} catch {
		return false;
	}
}

async function hasColumn(pool: Pick<Pool, "query">, table: string, column: string): Promise<boolean> {
	try {
		const res = await pool.query<{ ok: number }>(
			`SELECT 1 AS ok
			   FROM information_schema.columns
			  WHERE table_schema = 'public'
			    AND table_name = $1
			    AND column_name = $2
			  LIMIT 1`,
			[String(table), String(column)]
		);
		return res.rowCount === 1;
	} catch {
		return false;
	}
}

function pickTitleFromText(text: string): string | null {
	const t = normalizeText(text);
	if (!t) return null;
	const first = t.split(/\n+/g)[0]?.trim() ?? "";
	if (!first) return null;
	// Guard: treat very long first lines as body.
	if (first.length > 120) return null;
	return first;
}

const SECTION_RULES: Array<{ label: FunctionalSectionLabel; title: RegExp[]; body: RegExp[] }> = [
	{
		label: "overview",
		title: [/\boverview\b/i, /\bsummary\b/i, /\bintroduction\b/i, /\babout\b/i],
		body: [/\boverview\b/i, /\bsummary\b/i, /\bwho we are\b/i],
	},
	{ label: "problem", title: [/\bproblem\b/i, /\bpain\b/i, /\bchallenge\b/i], body: [/\bproblem\b/i, /\bpain\b/i, /\bwhy now\b/i] },
	{
		label: "product",
		title: [/\bproduct\b/i, /\bsolution\b/i, /\bplatform\b/i, /\bhow it works\b/i],
		body: [/\bproduct\b/i, /\bsolution\b/i, /\bworkflow\b/i, /\barchitecture\b/i],
	},
	{
		label: "go_to_market",
		title: [/\bgo[- ]?to[- ]?market\b/i, /\bgtm\b/i, /\bdistribution\b/i, /\bsales\b/i, /\bmarketing\b/i, /\bpricing\b/i],
		body: [/\bgo[- ]?to[- ]?market\b/i, /\bchannels?\b/i, /\bdistribution\b/i, /\bsales\b/i, /\bmarketing\b/i, /\bpricing\b/i],
	},
	{ label: "traction", title: [/\btraction\b/i, /\bgrowth\b/i, /\bmilestones\b/i, /\bcustomers?\b/i], body: [/\btraction\b/i, /\bgrowth\b/i, /\bpipeline\b/i, /\bretention\b/i] },
	{ label: "team", title: [/\bteam\b/i, /\bfounder\b/i, /\bleadership\b/i, /\badvisors?\b/i], body: [/\bteam\b/i, /\bfounder\b/i, /\bleadership\b/i] },
	{
		label: "financials",
		title: [/\bfinancials?\b/i, /\brevenue\b/i, /\bmrr\b/i, /\barr\b/i, /\bburn\b/i, /\brunway\b/i, /\bprojections?\b/i],
		body: [/\bfinancials?\b/i, /\brevenue\b/i, /\bmrr\b/i, /\barr\b/i, /\bburn\b/i, /\brunway\b/i, /\bmargin\b/i],
	},
	{ label: "raise_terms", title: [/\braise\b/i, /\bfunding\b/i, /\bround\b/i, /\buse of funds\b/i, /\bterms\b/i, /\bvaluation\b/i, /\bcap table\b/i], body: [/\brais(e|ing)\b/i, /\bfunding\b/i, /\bvaluation\b/i, /\bterms\b/i] },
	{ label: "risks", title: [/\brisks?\b/i, /\bcompetition\b/i, /\bthreats?\b/i, /\bregulatory\b/i], body: [/\brisks?\b/i, /\bcompetition\b/i, /\bregulatory\b/i] },
];

function classifyFunctionalSection(title: string | null, body: string): { label: FunctionalSectionLabel; confidence: number } | null {
	const t = title ? normalizeText(title) : "";
	const b = normalizeText(body);
	if (!t && !b) return null;

	let best: { label: FunctionalSectionLabel; score: number; titleHit: boolean } | null = null;
	for (const r of SECTION_RULES) {
		let score = 0;
		let titleHit = false;
		if (t) {
			for (const re of r.title) {
				if (re.test(t)) {
					score += 2;
					titleHit = true;
					break;
				}
			}
		}
		if (b) {
			for (const re of r.body) {
				if (re.test(b)) {
					score += 1;
					break;
				}
			}
		}
		if (score <= 0) continue;
		if (!best || score > best.score) best = { label: r.label, score, titleHit };
		else if (best && score === best.score) {
			// Deterministic tie-break: keep earlier rule in SECTION_RULES.
			// best already earlier, so do nothing.
		}
	}
	if (!best) return null;
	const confidence = best.titleHit ? 0.85 : best.score >= 2 ? 0.75 : 0.65;
	return { label: best.label, confidence };
}

type EntityMatch = { kind: "email" | "url" | "money" | "percent" | "date"; value: string; start: number; end: number };

function findEntities(text: string): EntityMatch[] {
	const t = normalizeText(text);
	if (!t) return [];
	const matches: EntityMatch[] = [];

	const pushAll = (kind: EntityMatch["kind"], re: RegExp, post?: (v: string) => string) => {
		for (const m of t.matchAll(re)) {
			const raw = String(m[0] ?? "");
			if (!raw) continue;
			const start = typeof m.index === "number" ? m.index : t.indexOf(raw);
			const end = start + raw.length;
			const value = post ? post(raw) : raw;
			matches.push({ kind, value, start, end });
		}
	};

	pushAll("email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (v) => v.toLowerCase());
	pushAll("url", /\bhttps?:\/\/[^\s)\]]+\b/gi);
	pushAll("url", /\bwww\.[^\s)\]]+\b/gi, (v) => `https://${v}`);
	pushAll("percent", /\b\d+(?:\.\d+)?\s?%\b/g);
	pushAll("money", /\b(?:\$|USD\s?)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:k|m|b)?\b/gi, (v) => v.replace(/\s+/g, " ").trim());
	pushAll("money", /\b\d+(?:\.\d+)?\s?(?:million|billion)\s?(?:usd|dollars)?\b/gi, (v) => v.replace(/\s+/g, " ").trim());
	pushAll("date", /\b(?:Q[1-4]\s?\d{4})\b/gi, (v) => v.toUpperCase().replace(/\s+/g, ""));
	pushAll("date", /\b\d{4}-\d{2}-\d{2}\b/g);
	pushAll("date", /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi, (v) => v.replace(/\s+/g, " ").trim());

	// Stable ordering + de-dupe
	matches.sort((a, b) => (a.start - b.start) || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
	const out: EntityMatch[] = [];
	const seen = new Set<string>();
	for (const m of matches) {
		const k = stableJsonStringify({ kind: m.kind, value: m.value, start: m.start, end: m.end });
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(m);
	}
	return out;
}

function parseMoneyToUsd(valueRaw: string): { normalized_usd: number | null; currency_hint: string | null } {
	const v0 = String(valueRaw ?? "").trim();
	if (!v0) return { normalized_usd: null, currency_hint: null };
	const v = v0.toLowerCase();
	let currency: string | null = null;
	if (v.includes("$")) currency = "USD";
	if (v.includes("usd")) currency = "USD";

	let multiplier = 1;
	let numStr = v.replace(/usd/g, "").replace(/\$/g, "").trim();

	if (/\b(billion)\b/.test(numStr)) {
		multiplier = 1_000_000_000;
		numStr = numStr.replace(/\bbillion\b/g, "");
	} else if (/\b(million)\b/.test(numStr)) {
		multiplier = 1_000_000;
		numStr = numStr.replace(/\bmillion\b/g, "");
	}

	const suffixMatch = numStr.match(/(\d[\d,]*(?:\.\d+)?)(\s?)([kmb])\b/);
	if (suffixMatch) {
		numStr = suffixMatch[1] ?? numStr;
		const suf = suffixMatch[3];
		if (suf === "k") multiplier = 1_000;
		if (suf === "m") multiplier = 1_000_000;
		if (suf === "b") multiplier = 1_000_000_000;
	}

	const n = Number(String(numStr).replace(/,/g, "").trim());
	if (!Number.isFinite(n)) return { normalized_usd: null, currency_hint: currency };
	return { normalized_usd: n * multiplier, currency_hint: currency };
}

type MetricMatch = {
	metric: "mrr" | "arr" | "valuation" | "raise_amount" | "cac" | "ltv";
	raw: string;
	amount_raw?: string;
	amount_usd?: number | null;
	start: number;
	end: number;
};

function findMetrics(text: string): MetricMatch[] {
	const t = normalizeText(text);
	if (!t) return [];

	const out: MetricMatch[] = [];

	const find = (metric: MetricMatch["metric"], re: RegExp, amountGroupIndex: number) => {
		for (const m of t.matchAll(re)) {
			const raw = String(m[0] ?? "");
			if (!raw) continue;
			const start = typeof m.index === "number" ? m.index : t.indexOf(raw);
			const end = start + raw.length;
			const amountRaw = amountGroupIndex >= 0 ? String(m[amountGroupIndex] ?? "") : "";
			const parsed = amountRaw ? parseMoneyToUsd(amountRaw) : { normalized_usd: null, currency_hint: null };
			out.push({ metric, raw, amount_raw: amountRaw || undefined, amount_usd: parsed.normalized_usd, start, end });
		}
	};

	find("mrr", /\bMRR\b[^\n\r\d$]{0,20}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);
	find("mrr", /((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b[^\n\r]{0,16}\bMRR\b/gi, 1);
	find("arr", /\bARR\b[^\n\r\d$]{0,20}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);
	find("arr", /((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b[^\n\r]{0,16}\bARR\b/gi, 1);
	find("valuation", /\b(?:pre-?money|post-?money)?\s*valuation\b[^\n\r\d$]{0,20}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);
	find("raise_amount", /\b(?:raising|raise|round|seeking)\b[^\n\r\d$]{0,24}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);
	find("cac", /\bCAC\b[^\n\r\d$]{0,24}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);
	find("ltv", /\bLTV\b[^\n\r\d$]{0,24}((?:\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?)\b/gi, 1);

	out.sort((a, b) => (a.start - b.start) || a.metric.localeCompare(b.metric) || a.raw.localeCompare(b.raw));
	const seen = new Set<string>();
	const dedup: MetricMatch[] = [];
	for (const m of out) {
		const k = stableJsonStringify({ metric: m.metric, raw: m.raw, start: m.start, end: m.end });
		if (seen.has(k)) continue;
		seen.add(k);
		dedup.push(m);
	}
	return dedup;
}

function detectDocTypeHints(args: { docTitle: string | null; docType: string | null; allText: string }): Array<{ hint: string; confidence: number; reason: string }> {
	const title = normalizeText(args.docTitle ?? "");
	const type = String(args.docType ?? "").trim();
	const txt = normalizeText(args.allText).toLowerCase();

	const hints: Array<{ hint: string; confidence: number; reason: string }> = [];

	if (type) {
		hints.push({ hint: type, confidence: 0.9, reason: "documents.type" });
	}

	const addIf = (hint: string, re: RegExp, confidence: number, reason: string) => {
		if (re.test(title) || re.test(txt)) hints.push({ hint, confidence, reason });
	};

	addIf("pitch_deck", /\bpitch deck\b|\bdeck\b/i, 0.75, "keyword");
	addIf("cap_table", /\bcap table\b|\bcapitalization table\b/i, 0.8, "keyword");
	addIf("financial_statement", /\bincome statement\b|\bbalance sheet\b|\bcash flow\b|\bp&l\b/i, 0.8, "keyword");
	addIf("model", /\bfinancial model\b|\bassumptions\b|\bmodel\b/i, 0.7, "keyword");
	addIf("contract", /\bagreement\b|\bcontract\b|\bterms and conditions\b/i, 0.7, "keyword");

	// RC-001: SEC regulatory filing classifiers — high confidence, doc-family signals.
	// Detected in title or body text; title match is definitive.
	addIf("sec_filing_s1", /\bform\s+s-?1\b|\bregistration\s+statement\b/i, 0.95, "sec_keyword");
	addIf("sec_filing_10k", /\bform\s+10-?k\b|\bannual\s+report\s+pursuant\s+to\s+section\s+13\b/i, 0.95, "sec_keyword");
	addIf("sec_filing_10q", /\bform\s+10-?q\b|\bquarterly\s+report\s+pursuant\s+to\s+section\s+13\b/i, 0.95, "sec_keyword");
	addIf("regulatory_filing", /\bsecurities\s+and\s+exchange\s+commission\b|\bsec\.gov\b/i, 0.85, "sec_keyword");

	// Deterministic ordering + de-dupe
	hints.sort((a, b) => b.confidence - a.confidence || a.hint.localeCompare(b.hint) || a.reason.localeCompare(b.reason));
	const out: Array<{ hint: string; confidence: number; reason: string }> = [];
	const seen = new Set<string>();
	for (const h of hints) {
		const key = stableJsonStringify({ hint: h.hint, reason: h.reason });
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(h);
	}
	return out;
}

export type EvidenceItemWrite = {
	evidence_id: string;
	deal_id: string;
	source_type: string;
	source_path: string;
	source_document_id?: string | null;
	tags: string[];
	confidence: number;
	extracted_at: string;
	content_text?: string | null;
	content_json?: unknown | null;
	meta: Record<string, unknown>;
};

function buildEvidenceItemsForBlocks(args: {
	deal_id: string;
	document_id: string;
	doc_title: string | null;
	doc_type: string | null;
	extracted_at: string;
	blocks: TextBlock[];
}): { items: EvidenceItemWrite[]; summary: Omit<DocumentIntelligenceStepSummary, "deal_id" | "document_id"> } {
	const items: EvidenceItemWrite[] = [];

	const bySignal: Record<string, number> = {};
	const bySection: Record<string, number> = {};
	const byPageSection: Record<string, Record<string, number>> = {};

	const add = (it: Omit<EvidenceItemWrite, "evidence_id"> & { content_sig?: { text?: string | null; json?: unknown } }) => {
		const tags = uniqSorted(it.tags);
		const evidence_id = computeSignalEvidenceId({
			deal_id: args.deal_id,
			document_id: args.document_id,
			source_path: it.source_path,
			content_text: it.content_sig?.text ?? it.content_text ?? null,
			content_json: it.content_sig?.json ?? it.content_json ?? null,
			extractor_name: EXTRACTOR_NAME,
			extractor_version: EXTRACTOR_VERSION,
		});
		items.push({
			evidence_id,
			deal_id: it.deal_id,
			source_type: it.source_type,
			source_path: it.source_path,
			source_document_id: it.source_document_id ?? null,
			tags,
			confidence: Math.max(0, Math.min(1, it.confidence)),
			extracted_at: it.extracted_at,
			content_text: it.content_text ?? null,
			content_json: it.content_json ?? null,
			meta: it.meta,
		});
	};

	for (const block of args.blocks) {
		const section = classifyFunctionalSection(block.title, block.text);
		if (section) {
			const pageKey = block.page_index == null ? "doc" : `page_${block.page_index + 1}`;
			inc(bySignal, "functional_section");
			inc(bySection, section.label);
			byPageSection[pageKey] = byPageSection[pageKey] ?? {};
			inc(byPageSection[pageKey]!, section.label);

			add({
				deal_id: args.deal_id,
				source_type: "document_intelligence_signal",
				source_path: `${block.source_path}:functional_section`,
				source_document_id: args.document_id,
				tags: ["signal:functional_section", `section:${section.label}`],
				confidence: section.confidence,
				extracted_at: args.extracted_at,
				content_text: block.title ? `${block.title}\n\n${block.text}`.slice(0, 1500) : block.text.slice(0, 1500),
				content_json: {
					label: section.label,
					page_index: block.page_index,
					title: block.title,
				},
				meta: {
					extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
					signal_category: "functional_section",
					page_index: block.page_index,
				},
			});
		}

		const entities = findEntities(block.text);
		for (let i = 0; i < Math.min(entities.length, 50); i++) {
			const e = entities[i]!;
			inc(bySignal, "entity");
			add({
				deal_id: args.deal_id,
				source_type: "document_intelligence_signal",
				source_path: `${block.source_path}:entity:${e.kind}:${i}`,
				source_document_id: args.document_id,
				tags: ["signal:entity", `entity:${e.kind}`],
				confidence: e.kind === "email" || e.kind === "url" ? 0.9 : 0.75,
				extracted_at: args.extracted_at,
				content_text: e.value,
				content_json: { kind: e.kind, value: e.value, start: e.start, end: e.end, page_index: block.page_index },
				meta: {
					extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
					signal_category: "entity",
					page_index: block.page_index,
				},
				content_sig: { text: e.value },
			});
		}

		const metrics = findMetrics(block.text);
		for (let i = 0; i < Math.min(metrics.length, 50); i++) {
			const m = metrics[i]!;
			inc(bySignal, "metric");
			add({
				deal_id: args.deal_id,
				source_type: "document_intelligence_signal",
				source_path: `${block.source_path}:metric:${m.metric}:${i}`,
				source_document_id: args.document_id,
				tags: ["signal:metric", `metric:${m.metric}`],
				confidence: m.amount_usd != null ? 0.85 : 0.7,
				extracted_at: args.extracted_at,
				content_text: m.raw,
				content_json: {
					metric: m.metric,
					raw: m.raw,
					amount_raw: m.amount_raw ?? null,
					amount_usd: m.amount_usd ?? null,
					page_index: block.page_index,
					start: m.start,
					end: m.end,
				},
				meta: {
					extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
					signal_category: "metric",
					page_index: block.page_index,
				},
				content_sig: { json: { metric: m.metric, raw: m.raw, amount_usd: m.amount_usd ?? null } },
			});
		}
	}

	const allText = args.blocks.map((b) => b.text).join("\n\n");
	const hints = detectDocTypeHints({ docTitle: args.doc_title, docType: args.doc_type, allText });
	for (let i = 0; i < Math.min(hints.length, 10); i++) {
		const h = hints[i]!;
		inc(bySignal, "doc_type_hint");
		add({
			deal_id: args.deal_id,
			source_type: "document_intelligence_signal",
			source_path: `doc:${args.document_id}:doc_type_hint:${h.hint}:${i}`,
			source_document_id: args.document_id,
			tags: ["signal:doc_type_hint", `doc_type:${h.hint}`],
			confidence: h.confidence,
			extracted_at: args.extracted_at,
			content_text: h.hint,
			content_json: { hint: h.hint, reason: h.reason },
			meta: {
				extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
				signal_category: "doc_type_hint",
			},
			content_sig: { text: h.hint },
		});
	}

	// RC-002: Going concern detection — emit dedicated evidence item when auditor language is found.
	// Phrase is specific enough to avoid false positives; used in 10-K/10-Q and some financials.
	const GOING_CONCERN_RE =
		/substantial\s+doubt.*(?:going\s+concern|ability\s+to\s+continue)|going\s+concern.*substantial\s+doubt|ability\s+to\s+continue\s+as\s+a\s+going\s+concern/i;
	if (GOING_CONCERN_RE.test(allText)) {
		inc(bySignal, "going_concern_signal");
		add({
			deal_id: args.deal_id,
			source_type: "document_intelligence_signal",
			source_path: `doc:${args.document_id}:signal:going_concern`,
			source_document_id: args.document_id,
			tags: ["signal:going_concern", "risk:going_concern"],
			confidence: 0.95,
			extracted_at: args.extracted_at,
			content_text: "going_concern",
			content_json: { signal: "going_concern", detected: true },
			meta: {
				extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_VERSION },
				signal_category: "going_concern",
			},
			content_sig: { text: "going_concern" },
		});
	}

	// Stable ordering for writes + deterministic summaries.
	items.sort((a, b) => {
		const at = (a.tags?.[0] ?? "").localeCompare(b.tags?.[0] ?? "");
		if (at) return at;
		const ap = String(a.source_path).localeCompare(String(b.source_path));
		if (ap) return ap;
		return String(a.evidence_id).localeCompare(String(b.evidence_id));
	});

	return {
		items,
		summary: {
			evidence_total: items.length,
			by_signal_category: bySignal,
			by_section_label: bySection,
			by_page_section_label: byPageSection,
		},
	};
}

export class DocumentIntelligenceService {
	constructor(private readonly pool: Pool) {}

	private writeShape: { hasRunId: boolean; hasStepRunId: boolean; hasUpdatedAtTrigger: boolean } | null = null;

	private async getEvidenceItemsWriteShape(): Promise<{ hasRunId: boolean; hasStepRunId: boolean; hasUpdatedAtTrigger: boolean }> {
		if (this.writeShape) return this.writeShape;
		try {
			const { rows } = await this.pool.query<{ column_name: string }>(
				`SELECT column_name
				   FROM information_schema.columns
				  WHERE table_schema = 'public'
				    AND table_name = 'evidence_items'`
			);
			const cols = new Set((rows ?? []).map((r) => String(r.column_name)));

			let hasUpdatedAtTrigger = false;
			try {
				const trg = await this.pool.query(
					`SELECT 1
					   FROM pg_trigger t
					   JOIN pg_class c ON c.oid = t.tgrelid
					   JOIN pg_namespace n ON n.oid = c.relnamespace
					  WHERE n.nspname = 'public'
					    AND c.relname = 'evidence_items'
					    AND t.tgname = 'trg_evidence_items_set_updated_at'
					    AND NOT t.tgisinternal
					  LIMIT 1`
				);
				hasUpdatedAtTrigger = trg.rowCount === 1;
			} catch {
				hasUpdatedAtTrigger = false;
			}

			this.writeShape = {
				hasRunId: cols.has("run_id"),
				hasStepRunId: cols.has("step_run_id"),
				hasUpdatedAtTrigger,
			};
			return this.writeShape;
		} catch {
			this.writeShape = { hasRunId: false, hasStepRunId: false, hasUpdatedAtTrigger: false };
			return this.writeShape;
		}
	}

	private async upsertEvidenceItems(items: EvidenceItemWrite[], opts?: { run_id?: string | null; step_run_id?: string | null }): Promise<{ inserted: number; updated: number; warnings: string[] }> {
		const warnings: string[] = [];
		let inserted = 0;
		let updated = 0;

		try {
			await this.pool.query("SELECT 1 FROM evidence_items LIMIT 1");
		} catch (err: any) {
			return { inserted: 0, updated: 0, warnings: [`evidence_items_unavailable:${err?.code ?? "unknown"}`] };
		}

		const shape = await this.getEvidenceItemsWriteShape();

		const baseColumns = [
			"evidence_id",
			"deal_id",
			"source_type",
			"source_path",
			"source_document_id",
			"tags",
			"confidence",
			"extracted_at",
			"content_text",
			"content_json",
			"meta",
		] as const;

		const conflictSet: string[] = [
			"confidence = GREATEST(evidence_items.confidence, EXCLUDED.confidence)",
			"tags = EXCLUDED.tags",
			"extracted_at = GREATEST(evidence_items.extracted_at, EXCLUDED.extracted_at)",
			"content_text = EXCLUDED.content_text",
			"content_json = EXCLUDED.content_json",
			"meta = EXCLUDED.meta",
		];
		if (!shape.hasUpdatedAtTrigger) conflictSet.unshift("updated_at = now()");

		const extraCols: string[] = [];
		if (shape.hasRunId && opts?.run_id) extraCols.push("run_id");
		if (shape.hasStepRunId && opts?.step_run_id) extraCols.push("step_run_id");

		if (extraCols.includes("run_id")) conflictSet.push("run_id = COALESCE(evidence_items.run_id, EXCLUDED.run_id)");
		if (extraCols.includes("step_run_id")) conflictSet.push("step_run_id = COALESCE(evidence_items.step_run_id, EXCLUDED.step_run_id)");

		const columns = [...baseColumns, ...extraCols];

		// Chunk to avoid huge SQL.
		const chunkSize = 200;
		for (let offset = 0; offset < items.length; offset += chunkSize) {
			const chunk = items.slice(offset, offset + chunkSize);
			const values: any[] = [];
			const rowsSql: string[] = [];
			for (const it of chunk) {
				const rowVals = [
					it.evidence_id,
					it.deal_id,
					it.source_type,
					it.source_path,
					it.source_document_id ?? null,
					it.tags ?? [],
					it.confidence,
					it.extracted_at,
					it.content_text ?? null,
					it.content_json == null ? null : JSON.stringify(it.content_json),
					JSON.stringify(it.meta ?? {}),
				];
				if (extraCols.includes("run_id")) rowVals.push(opts?.run_id ?? null);
				if (extraCols.includes("step_run_id")) rowVals.push(opts?.step_run_id ?? null);

				const start = values.length;
				values.push(...rowVals);
				const placeholders = rowVals.map((_, idx) => `$${start + idx + 1}`).join(", ");
				rowsSql.push(`(${placeholders})`);
			}

			const sql = `INSERT INTO evidence_items (${columns.join(", ")}) VALUES\n${rowsSql.join(",\n")}
ON CONFLICT (evidence_id) DO UPDATE SET
${conflictSet.join(",\n")}
RETURNING (xmax = 0) as inserted`;

			try {
				const res = await this.pool.query(sql, values);
				for (const r of res.rows ?? []) {
					if (Boolean((r as any).inserted)) inserted++;
					else updated++;
				}
			} catch (err: any) {
				warnings.push(`evidence_upsert_failed:${err?.code ?? "unknown"}`);
			}
		}

		return { inserted, updated, warnings };
	}

	private async loadTextBlocks(dealId: string, documentId: string): Promise<{ doc: any | null; blocks: TextBlock[]; warnings: string[] }> {
		const warnings: string[] = [];

		const hasDeletedAt = await hasColumn(this.pool as any, "documents", "deleted_at");
		const hasUpdatedAt = await hasColumn(this.pool as any, "documents", "updated_at");

		let doc: any | null = null;
		try {
			const res = await this.pool.query(
				`SELECT id::text as id,
				        deal_id::text as deal_id,
				        title,
				        type,
				        full_text,
				        uploaded_at${hasUpdatedAt ? ", updated_at" : ""}
				   FROM documents
				  WHERE id = $1 AND deal_id = $2${hasDeletedAt ? " AND deleted_at IS NULL" : ""}
				  LIMIT 1`,
				[documentId, dealId]
			);
			doc = res.rows?.[0] ?? null;
		} catch (err: any) {
			warnings.push(`document_load_failed:${err?.code ?? "unknown"}`);
			doc = null;
		}

		const blocks: TextBlock[] = [];

		const visualsOk = (await hasTable(this.pool as any, "visual_assets")) && (await hasTable(this.pool as any, "visual_extractions"));
		if (visualsOk) {
			const hasOcrText = await hasColumn(this.pool as any, "visual_extractions", "ocr_text");
			const hasStructuredSummary = await hasColumn(this.pool as any, "visual_extractions", "structured_summary");
			const hasStructuredJson = await hasColumn(this.pool as any, "visual_extractions", "structured_json");

			const ocrTextSel = hasOcrText ? "le.ocr_text" : "NULL::text AS ocr_text";
			const structuredSummarySel = hasStructuredSummary ? "le.structured_summary" : "NULL::jsonb AS structured_summary";
			const structuredJsonSel = hasStructuredJson ? "le.structured_json" : "NULL::jsonb AS structured_json";

			try {
				const res = await this.pool.query(
					`WITH latest_extractions AS (
						SELECT ve.*, ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
						  FROM visual_extractions ve
					)
					SELECT va.id::text AS visual_asset_id,
					       va.page_index,
					       ${ocrTextSel},
					       ${structuredSummarySel},
					       ${structuredJsonSel}
					  FROM visual_assets va
					  LEFT JOIN latest_extractions le ON le.visual_asset_id = va.id AND le.rn = 1
					 WHERE va.document_id = $1
					 ORDER BY va.page_index ASC, va.id ASC`,
					[documentId]
				);

				for (const row of res.rows ?? []) {
					const pageIndex = row.page_index == null ? null : Number(row.page_index);
					const ocrText = typeof row.ocr_text === "string" ? row.ocr_text : "";
					let structuredText = "";
					if (!ocrText) {
						const ss = row.structured_summary;
						if (typeof ss === "string") structuredText = ss;
						else if (ss && typeof ss === "object") structuredText = JSON.stringify(ss);
						const sj = row.structured_json;
						if (!structuredText && sj && typeof sj === "object") {
							// Minimal deterministic extraction: collect obvious text keys if present.
							const title = typeof (sj as any).slide_title === "string" ? String((sj as any).slide_title) : "";
							const body = typeof (sj as any).text === "string" ? String((sj as any).text) : "";
							structuredText = normalizeText([title, body].filter(Boolean).join("\n"));
						}
					}
					const txt = normalizeText(ocrText || structuredText);
					if (!txt) continue;
					const title = pickTitleFromText(txt);
					blocks.push({
						source_path: `doc:${documentId}:page:${pageIndex == null ? "?" : pageIndex + 1}`,
						page_index: pageIndex,
						text: txt,
						title,
					});
				}
			} catch (err: any) {
				warnings.push(`visual_text_load_failed:${err?.code ?? "unknown"}`);
			}
		}

		if (blocks.length === 0) {
			const fullText = doc && typeof doc.full_text === "string" ? doc.full_text : "";
			const ft = normalizeText(fullText);
			if (ft) {
				const paras = ft.split(/\n\n+/g).map((p: string) => p.trim()).filter(Boolean);
				const max = 25;
				for (let i = 0; i < Math.min(paras.length, max); i++) {
					const p = paras[i]!;
					const title = i === 0 ? pickTitleFromText(p) : null;
					blocks.push({
						source_path: `doc:${documentId}:para:${i}`,
						page_index: null,
						text: p,
						title,
					});
				}
			}
		}

		blocks.sort((a, b) => {
			const ap = (a.page_index ?? 1e9) - (b.page_index ?? 1e9);
			if (ap) return ap;
			return a.source_path.localeCompare(b.source_path);
		});

		return { doc, blocks, warnings };
	}

	async extractSignals(input: DocumentIntelligenceExtractInput): Promise<DocumentIntelligenceExtractResult> {
		const dealId = String(input.deal_id);
		const documentId = String(input.document_id);

		const { doc, blocks, warnings: loadWarnings } = await this.loadTextBlocks(dealId, documentId);
		const docTitle = doc && typeof doc.title === "string" ? doc.title : null;
		const docType = doc && typeof doc.type === "string" ? doc.type : null;
		const extractedAtRaw =
			doc && (doc.updated_at || doc.uploaded_at) ? new Date(doc.updated_at || doc.uploaded_at).toISOString() : new Date().toISOString();

		const { items, summary: s } = buildEvidenceItemsForBlocks({
			deal_id: dealId,
			document_id: documentId,
			doc_title: docTitle,
			doc_type: docType,
			extracted_at: extractedAtRaw,
			blocks,
		});

		const write = await this.upsertEvidenceItems(items, { run_id: input.run_id ?? null, step_run_id: input.step_run_id ?? null });

		const summary: DocumentIntelligenceStepSummary = {
			deal_id: dealId,
			document_id: documentId,
			...s,
		};

		return {
			ok: true,
			summary,
			inserted: write.inserted,
			updated: write.updated,
			warnings: [...loadWarnings, ...write.warnings],
			__step_summary: summary,
		};
	}
}

export const __test__ = {
	normalizeText,
	computeSignalEvidenceId,
	classifyFunctionalSection,
	findEntities,
	findMetrics,
	buildEvidenceItemsForBlocks,
};
