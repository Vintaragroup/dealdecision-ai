/**
 * audit-investor-insights-coverage.ts
 *
 * Portfolio Full-Doc DPU Coverage Audit for Investor Insights slots.
 *
 * For every deal → every slot:
 *   1. Load DPU page texts via fetchAuditDataForDeal.
 *   2. Run the deterministic strict detector (current canonical patterns, including _RAISE_ADVERB).
 *   3. Compare recomputed result against the value stored in investor_insight_reports.
 *   4. For slots that are NotComputable on both stored AND recomputed, perform a semantic
 *      keyword scan to classify DETECTOR_GAP (keywords present but strict pattern missed)
 *      vs TRUE_ABSENCE (no relevant text found at all).
 *
 * Does NOT write to the database — read-only throughout.
 */

import type { Pool } from "pg";
import { normalizeForExtraction } from "./normalize";
import { fetchAuditDataForDeal } from "../../lib/db/audit-queries";
import { wrapPoolReadOnly, parseDealListFile, type DealListFile } from "./audit-investor-insights";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — Slot patterns (current canonical, kept in sync with processor.ts)
//
// NOTE: These are intentionally copied from processor.ts (not imported) so that
// the coverage audit can run without any DB job infrastructure. Whenever
// processor.ts patterns change, this section must be updated in the same PR.
// The key difference vs the copy in audit-investor-insights.ts (Section 1) is:
//   • _RAISE_ADVERB is included (fix for "raising approximately $10M")
// ═══════════════════════════════════════════════════════════════════════

const CURRENCY       = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT         = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX         = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;
const _NO_CUR        = `[^$€£\\n]`;
const _RAISE_ADVERB  = String.raw`(?:approximately|about|around|roughly|~\s*|over|under|nearly|some|a\s+total\s+of|up\s+to|at\s+least|just\s+over)?\s*`;
const RAISE_ANCHOR   = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

const RAISE_AMOUNT_PATTERN = new RegExp(
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	`|\\b(?:capital\\s+raise|round\\s+size|ticket\\s+size|proceeds|allocation)\\b${_NO_CUR}{0,40}?${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}\\s+(?:seed|series\\s+[a-cA-C]|pre[-\\s]seed|bridge)\\s*(?:round|raise|funding)?` +
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,60}?\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b` +
	`|\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b${_NO_CUR}{0,60}?${MONEY_FRAGMENT}` +
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}` +
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

const _RANGE_SEP = String.raw`\s*(?:–|-|to)\s*`;
const RAISE_RANGE_PATTERN = new RegExp(
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}`,
	"i"
);

// MARKET_PATTERN — kept in sync with processor.ts.
// Added Forms C+D on 20260225 (detector_gap=7, Carmoola evidence: "$212B Market Sizes").
const MARKET_PATTERN =
	/(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)[^$\n]{0,60}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,60}?(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)|\bmarket\s+size[s]?\b[^$\n]{0,80}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,80}?\bmarket\s+size[s]?\b/i;

const TRACTION_PATTERN =
	/(?:\bMRR\b|\bARR\b|\bmonthly\s+recurring\s+revenue\b|\bannual\s+recurring\s+revenue\b)(?:[^$\n]{0,60})?\$[\d,.]+\s*[BMKbmk]?/i;

const _TRACTION_PCT_KW = String.raw`(?:demo[- ]to[- ]close|close\s+rate|conversion\s+rate?|retention(?:\s+(?:ratio|rate))?|churn(?:\s+rate)?|lift|engagement(?:\s+rate)?|activation(?:\s+rate)?|nps\b|net\s+promoter|upsell(?:\s+rate)?|win\s+rate)`;
const _PCT_VALUE       = String.raw`\d+(?:\.\d+)?(?:\s*[–\-]\s*\d+(?:\.\d+)?)?\s*%`;
const TRACTION_PCT_PATTERN = new RegExp(
	`\\b${_TRACTION_PCT_KW}\\b[^\\n]{0,60}?${_PCT_VALUE}` +
	`|${_PCT_VALUE}[^\\n]{0,60}?\\b${_TRACTION_PCT_KW}\\b`,
	"i"
);

const VALUATION_PATTERN    = /(valuation|post[- ]money|pre[- ]money|safe cap|cap)\b/i;
// USE_OF_FUNDS — kept in sync with processor.ts (Section 1 comment).
// Added Forms U1–U4 on 20260225 (audit-evidence driven, detector_gap=8 baseline).
const USE_OF_FUNDS_PATTERN = /(?:use\s+of\s+(?:funds|proceeds|capital)|allocation\s+of\s+(?:funds|proceeds)|proceeds\s+will\s+be\s+used|capital\s+allocation|funds\s+will\s+be\s+(?:used|deployed|allocated))\b/i;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — Strict slot detectors
// ═══════════════════════════════════════════════════════════════════════

export interface StrictPage {
	document_id: string;
	page_index: number;
	text: string;   // normalised
	text_raw: string;
}

function dpuRef(documentId: string, pageIndex: number): string {
	const prefix = documentId.replace(/-/g, "").slice(0, 8);
	return `dpu:doc:${prefix}:page:${pageIndex}`;
}

function detectInPages(
	pages: StrictPage[],
	pattern: RegExp
): { snippet: string; ref: string } | null {
	for (const p of pages) {
		const m = pattern.exec(p.text);
		if (m) {
			return { snippet: m[0].slice(0, 80), ref: dpuRef(p.document_id, p.page_index) };
		}
	}
	return null;
}

export interface StrictResult {
	computable: boolean;
	value: string | null;
	evidence: string | null;
}

export const STRICT_DETECTORS: Array<{ name: string; detect: (pages: StrictPage[]) => StrictResult }> = [
	{
		name: "raise_terms",
		detect: (pages) => {
			const rng = detectInPages(pages, RAISE_RANGE_PATTERN);
			if (rng) return { computable: true, value: rng.snippet, evidence: rng.ref };
			const hit = detectInPages(pages, RAISE_AMOUNT_PATTERN);
			if (hit) return { computable: true, value: hit.snippet, evidence: hit.ref };
			return { computable: false, value: null, evidence: null };
		},
	},
	{
		name: "market_claims",
		detect: (pages) => {
			const hit = detectInPages(pages, MARKET_PATTERN);
			if (hit) return { computable: true, value: hit.snippet, evidence: hit.ref };
			return { computable: false, value: null, evidence: null };
		},
	},
	{
		name: "traction_signal",
		detect: (pages) => {
			const pct = detectInPages(pages, TRACTION_PCT_PATTERN);
			if (pct) return { computable: true, value: pct.snippet, evidence: pct.ref };
			const hit = detectInPages(pages, TRACTION_PATTERN);
			if (hit) return { computable: true, value: hit.snippet, evidence: hit.ref };
			return { computable: false, value: null, evidence: null };
		},
	},
	{
		name: "valuation_terms",
		detect: (pages) => {
			const hit = detectInPages(pages, VALUATION_PATTERN);
			if (hit) return { computable: true, value: hit.snippet, evidence: hit.ref };
			return { computable: false, value: null, evidence: null };
		},
	},
	{
		name: "use_of_funds",
		detect: (pages) => {
			const hit = detectInPages(pages, USE_OF_FUNDS_PATTERN);
			if (hit) return { computable: true, value: hit.snippet, evidence: hit.ref };
			return { computable: false, value: null, evidence: null };
		},
	},
];

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Semantic keyword maps (for DETECTOR_GAP / TRUE_ABSENCE scan)
//
// These are intentionally BROADER than the strict regex — they catch
// near-miss text that a human would recognise as relevant but the strict
// detector missed (e.g. "we plan to raise" or "market opportunity of ~$1B").
// ═══════════════════════════════════════════════════════════════════════

const SEMANTIC_HINTS: Record<string, string[]> = {
	raise_terms: [
		"rais", "raise", "raising", "raised", "fundrais", "fundraise",
		"seeking", "funding", "investment", "round", "seed", "series a",
		"series b", "bridge", "capital", "proceeds", "pre-seed",
		"$", "€", "£", "USD", "EUR", "GBP",
	],
	market_claims: [
		"tam", "sam", "som", "total addressable", "addressable market",
		"market size", "market opportunity", "market cap", "cagr",
		"billion", "trillion", "market growth", "industry size",
	],
	traction_signal: [
		"mrr", "arr", "revenue", "recurring", "customers", "users",
		"retention", "churn", "conversion", "growth", "sales", "pipeline",
		"demo", "activation", "engagement", "%", "percent",
	],
	valuation_terms: [
		"valuation", "post-money", "pre-money", "safe", "cap table",
		"priced round", "convertible", "note", "equity", "share price",
	],
	use_of_funds: [
		"use of funds", "use of proceeds", "allocation", "proceeds",
		"how we will use", "funds will", "deploy capital", "spend",
		"budget", "runway", "opex", "capex", "headcount",
	],
};

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — Public types
// ═══════════════════════════════════════════════════════════════════════

/**
 * Classification for a single slot in the coverage report.
 *
 *  OK_MATCH              — stored=Computable AND recomputed=Computable (healthy)
 *  REGRESSED             — stored=Computable AND recomputed=NotComputable (pattern regression)
 *  STALE_STORED          — stored=NotComputable AND recomputed=Computable (old stored result, pattern improved)
 *  DETECTOR_GAP          — both NotComputable, but semantic hints found (strict regex missed)
 *  TRUE_ABSENCE          — both NotComputable AND no semantic hints found (genuine absence)
 *  MISSING_REPORT        — no stored investor_insight_reports row for this deal
 *  DPU_LOAD_FAILED       — DPU pages unavailable (query error or zero pages)
 *  EVIDENCE_REF_MISSING  — stored=Computable but evidence ref absent from DPU rows
 */
export type SlotCoverageClassification =
	| "OK_MATCH"
	| "REGRESSED"
	| "STALE_STORED"
	| "DETECTOR_GAP"
	| "TRUE_ABSENCE"
	| "MISSING_REPORT"
	| "DPU_LOAD_FAILED"
	| "EVIDENCE_REF_MISSING";

export interface CandidatePage {
	ref: string;
	triggeredKeywords: string[];
	snippet: string;
}

export interface SlotCoverageResult {
	slot: string;
	stored_status: "Computable" | "NotComputable" | "Missing";
	stored_value: string | null;
	recomputed_status: "Computable" | "NotComputable";
	recomputed_value: string | null;
	classification: SlotCoverageClassification;
	/** Pages that matched semantic keywords but not the strict pattern. Populated when classification=DETECTOR_GAP. */
	candidate_pages: CandidatePage[];
	/** Number of DPU pages scanned for this deal. */
	dpu_pages_scanned: number;
}

export interface DealCoverageResult {
	deal_id: string;
	deal_label: string;
	audit_status: "ok" | "partial" | "no_report" | "dpu_empty" | "error";
	error: string | null;
	dpu_pages_total: number;
	slot_results: SlotCoverageResult[];
	summary: {
		ok_match: number;
		stale_stored: number;
		regressed: number;
		detector_gap: number;
		true_absence: number;
		dpu_load_failed: number;
		evidence_ref_missing: number;
	};
	/** Structured-data section presence detected in the stored render_package. */
	structured_coverage: {
		/** True when a financial_statement_v1 section is present in the stored render_package. */
		financial_statement_v1: boolean;
		/** True when a use_of_funds_v1 section is present in the stored render_package. */
		use_of_funds_v1: boolean;
	};
}

export interface TighteningCandidate {
	slot: string;
	detector_gap: number;
	/** Top-5 semantic keywords by occurrence count across all DETECTOR_GAP pages. */
	top_keywords: Array<{ keyword: string; count: number }>;
	/** Top-5 header-like text patterns from candidate page snippets. */
	top_headers: Array<{ text: string; count: number }>;
	/** Top-3 candidate evidence refs with a snippet preview. */
	top_refs: Array<{ ref: string; snippet: string }>;
}

export interface CoverageAuditReport {
	generated_at: string;
	/** Auto-selected slot + rationale for the next tightening iteration. */
	meta: {
		selected_slot: string | null;
		selected_slot_rationale: string;
	};
	deals: DealCoverageResult[];
	portfolio_summary: {
		total_deals: number;
		deals_ok: number;
		deals_with_gaps: number;
		deals_with_stale: number;
		deals_with_regressions: number;
		slot_breakdown: Array<{
			slot: string;
			ok_match: number;
			stale_stored: number;
			regressed: number;
			detector_gap: number;
			true_absence: number;
		}>;
		/** Counts of deals that have structured XLSX sections in their stored render_package. */
		structured_coverage_summary: {
			deals_with_financial_statement_v1: number;
			deals_with_use_of_funds_v1: number;
		};
	};
	/** Per-slot tightening candidates sorted by detector_gap desc, then slot name. */
	tightening_candidates: TighteningCandidate[];
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5 — Stored slots parser
//
// Parses the insight_slots section body (pipe-delimited lines) back into
// a map of slot name → {status, value}.
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedStoredSlot {
	status: "Computable" | "NotComputable";
	value: string | null;
	evidence: string | null;
	/** The reason code emitted by formatSlotLine, e.g. "DERIVED_FROM_FINANCIALS" or null. */
	reasonCode: string | null;
}

export function parseStoredSlots(body: string): Map<string, ParsedStoredSlot> {
	const result = new Map<string, ParsedStoredSlot>();
	if (!body) return result;
	for (const line of body.split("\n")) {
		// Format: "<slot>: Computable | value="..." | evidence=... | reason=..."
		// or:     "<slot>: NotComputable | value=none | evidence=none | reason=..."
		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;
		const slotName = line.slice(0, colonIdx).trim();
		const rest = line.slice(colonIdx + 1).trim();
		const parts = rest.split("|").map((p) => p.trim());
		const statusPart = parts[0] ?? "";
		const computable = statusPart.startsWith("Computable");
		let value: string | null = null;
		let evidence: string | null = null;
		let reasonCode: string | null = null;
		for (const part of parts.slice(1)) {
			const valM = /^value="(.*)"$/.exec(part);
			if (valM) { value = valM[1] ?? null; continue; }
			const evM = /^evidence=(.+)$/.exec(part);
			if (evM && evM[1] !== "none") { evidence = evM[1] ?? null; continue; }
			const reaM = /^reason=(.+)$/.exec(part);
			if (reaM && reaM[1] !== "none") { reasonCode = reaM[1] ?? null; }
		}
		result.set(slotName, {
			status:     computable ? "Computable" : "NotComputable",
			value:      computable ? value : null,
			evidence:   computable ? evidence : null,
			reasonCode: computable ? reasonCode : null,
		});
	}
	return result;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6 — Semantic keyword scanner
// ═══════════════════════════════════════════════════════════════════════

export function semanticScan(
	slotName: string,
	pages: StrictPage[]
): CandidatePage[] {
	const hints = SEMANTIC_HINTS[slotName] ?? [];
	if (hints.length === 0 || pages.length === 0) return [];

	const candidates: CandidatePage[] = [];
	for (const page of pages) {
		const lowerText = page.text.toLowerCase();
		const triggered: string[] = [];
		for (const kw of hints) {
			if (lowerText.includes(kw.toLowerCase())) {
				triggered.push(kw);
			}
		}
		if (triggered.length > 0) {
			// Find the rough position of the first hit for a meaningful snippet
			const firstKw = triggered[0]!;
			const pos = lowerText.indexOf(firstKw.toLowerCase());
			const start = Math.max(0, pos - 40);
			const snippet = page.text_raw.slice(start, start + 120).replace(/\n/g, " ");
			candidates.push({
				ref: dpuRef(page.document_id, page.page_index),
				triggeredKeywords: triggered,
				snippet,
			});
		}
	}
	return candidates;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7 — Per-deal coverage runner
// ═══════════════════════════════════════════════════════════════════════

async function runDealCoverage(
	pool: Pool,
	dealId: string,
	dealLabel: string
): Promise<DealCoverageResult> {
	let raw: Awaited<ReturnType<typeof fetchAuditDataForDeal>>;
	try {
		raw = await fetchAuditDataForDeal(pool, dealId);
	} catch (err) {
		const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
		return {
			deal_id: dealId,
			deal_label: dealLabel,
			audit_status: "error",
			error: msg,
			dpu_pages_total: 0,
			slot_results: [],
			summary: { ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 0, true_absence: 0, dpu_load_failed: 5, evidence_ref_missing: 0 },
			structured_coverage: { financial_statement_v1: false, use_of_funds_v1: false },
		};
	}

	// ── Build normalised page list ───────────────────────────────────────
	const pages: StrictPage[] = [];
	for (const row of raw.dpu_pages ?? []) {
		if (!row.page_text || row.page_text.trim().length === 0) continue;
		const norm = normalizeForExtraction(row.page_text);
		pages.push({
			document_id: row.document_id,
			page_index:  row.page_index,
			text:        norm.text,
			text_raw:    row.page_text,
		});
	}

	const dpuEmpty = pages.length === 0;

	// ── Parse stored slots body + structured-coverage flags ─────────────
	let storedSlots = new Map<string, ParsedStoredSlot>();
	let hasReport = false;
	let hasFinancialStatementV1 = false;
	let hasUseOfFundsV1 = false;

	if (raw.report) {
		hasReport = true;
		const rp = raw.report.render_package as { sections?: Array<Record<string, unknown>> } | null;
		const sections = Array.isArray(rp?.sections) ? rp!.sections : [];
		const slotSection = sections.find((s) => s["key"] === "insight_slots");
		const body = typeof slotSection?.["body"] === "string" ? (slotSection["body"] as string) : "";
		storedSlots = parseStoredSlots(body);
		hasFinancialStatementV1 = sections.some((s) => s["key"] === "financial_statement_v1");
		hasUseOfFundsV1 = sections.some((s) => s["key"] === "use_of_funds_v1");
	}

	// ── Evaluate each slot ───────────────────────────────────────────────
	const slotResults: SlotCoverageResult[] = [];
	const summaryCounts = { ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 0, true_absence: 0, dpu_load_failed: 0, evidence_ref_missing: 0 };

	for (const detector of STRICT_DETECTORS) {
		const slotName = detector.name;
		const stored = storedSlots.get(slotName);

		// Handle missing report
		if (!hasReport) {
			slotResults.push({
				slot: slotName,
				stored_status: "Missing",
				stored_value: null,
				recomputed_status: "NotComputable",
				recomputed_value: null,
				classification: "MISSING_REPORT",
				candidate_pages: [],
				dpu_pages_scanned: pages.length,
			});
			continue;
		}

		// Handle DPU unavailable — but exempt XLSX-derived slots which never rely on text pages.
		if (dpuEmpty) {
			const isXlsxDerived =
				stored?.reasonCode === "DERIVED_FROM_FINANCIALS" ||
				stored?.reasonCode === "DERIVED_FROM_USE_OF_FUNDS";
			if (isXlsxDerived && stored?.status === "Computable") {
				// XLSX-promoted slots are valid without text DPU pages — classify OK_MATCH.
				slotResults.push({
					slot: slotName,
					stored_status: stored.status,
					stored_value: stored.value ?? null,
					recomputed_status: "NotComputable",
					recomputed_value: null,
					classification: "OK_MATCH",
					candidate_pages: [],
					dpu_pages_scanned: 0,
				});
				summaryCounts.ok_match++;
				continue;
			}
			slotResults.push({
				slot: slotName,
				stored_status: stored?.status ?? "Missing",
				stored_value: stored?.value ?? null,
				recomputed_status: "NotComputable",
				recomputed_value: null,
				classification: "DPU_LOAD_FAILED",
				candidate_pages: [],
				dpu_pages_scanned: 0,
			});
			summaryCounts.dpu_load_failed++;
			continue;
		}

		// Run strict detector
		const recomputed = detector.detect(pages);
		const recomputedStatus: "Computable" | "NotComputable" = recomputed.computable ? "Computable" : "NotComputable";
		const storedStatus = stored?.status ?? "Missing";

		let classification: SlotCoverageClassification;
		let candidatePages: CandidatePage[] = [];

		if (storedStatus === "Missing" && recomputed.computable) {
			// No stored section but we can recompute — stale stored
			classification = "STALE_STORED";
			summaryCounts.stale_stored++;
		} else if (storedStatus === "Missing") {
			// No stored section and no recomputed — use semantic scan
			const semanticHits = semanticScan(slotName, pages);
			if (semanticHits.length > 0) {
				classification = "DETECTOR_GAP";
				candidatePages = semanticHits;
				summaryCounts.detector_gap++;
			} else {
				classification = "TRUE_ABSENCE";
				summaryCounts.true_absence++;
			}
		} else if (storedStatus === "Computable" && recomputed.computable) {
			// Both Computable — healthy
			classification = "OK_MATCH";
			summaryCounts.ok_match++;
		} else if (storedStatus === "Computable" && !recomputed.computable) {
			// Stored says Computable but recompute can't find it.
			//
			// Special case: DERIVED_FROM_FINANCIALS and DERIVED_FROM_USE_OF_FUNDS slots are promoted
			// from XLSX structured data, NOT from text patterns.  The strict-detector recompute will
			// never match them, so a NotComputable recompute result is expected and correct — classify OK_MATCH.
			if (stored?.reasonCode === "DERIVED_FROM_FINANCIALS" || stored?.reasonCode === "DERIVED_FROM_USE_OF_FUNDS") {
				classification = "OK_MATCH";
				summaryCounts.ok_match++;
			} else {
			// Check whether stored evidence ref exists in DPU pages
			const evRef = stored?.evidence ?? null;
			if (evRef) {
				const refMatch = /dpu:doc:([0-9a-f]{8}):page:(\d+)/.exec(evRef);
				if (refMatch) {
					const docPrefix = refMatch[1]!;
					const pageIdx   = parseInt(refMatch[2]!, 10);
					const found = pages.some(
						(p) => p.document_id.replace(/-/g, "").slice(0, 8) === docPrefix && p.page_index === pageIdx
					);
					if (!found) {
						classification = "EVIDENCE_REF_MISSING";
						summaryCounts.evidence_ref_missing++;
					} else {
						classification = "REGRESSED";
						summaryCounts.regressed++;
					}
				} else {
					classification = "REGRESSED";
					summaryCounts.regressed++;
				}
			} else {
				classification = "REGRESSED";
				summaryCounts.regressed++;
			}
			} // end else (not DERIVED_FROM_FINANCIALS)
		} else if (storedStatus === "NotComputable" && recomputed.computable) {
			// Stored is stale — pattern improved and now finds it
			classification = "STALE_STORED";
			summaryCounts.stale_stored++;
		} else {
			// Both NotComputable — semantic scan to distinguish gap vs absence
			const semanticHits = semanticScan(slotName, pages);
			if (semanticHits.length > 0) {
				classification = "DETECTOR_GAP";
				candidatePages = semanticHits;
				summaryCounts.detector_gap++;
			} else {
				classification = "TRUE_ABSENCE";
				summaryCounts.true_absence++;
			}
		}

		slotResults.push({
			slot:               slotName,
			stored_status:      storedStatus,
			stored_value:       stored?.value ?? null,
			recomputed_status:  recomputedStatus,
			recomputed_value:   recomputed.value,
			classification,
			candidate_pages:    candidatePages,
			dpu_pages_scanned:  pages.length,
		});
	}

	const hasGaps = summaryCounts.detector_gap > 0;
	const hasStale = summaryCounts.stale_stored > 0;
	const hasErr = summaryCounts.dpu_load_failed > 0;
	const auditStatus =
		!hasReport ? "no_report"
		: dpuEmpty  ? "dpu_empty"
		: hasErr     ? "error"
		: hasGaps || hasStale || summaryCounts.regressed > 0 ? "partial"
		: "ok";

	return {
		deal_id:           dealId,
		deal_label:        dealLabel,
		audit_status:      auditStatus,
		error:             null,
		dpu_pages_total:   pages.length,
		slot_results:      slotResults,
		summary:           summaryCounts,
		structured_coverage: {
			financial_statement_v1: hasFinancialStatementV1,
			use_of_funds_v1:        hasUseOfFundsV1,
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8 — Portfolio runner
// ═══════════════════════════════════════════════════════════════════════

export interface CoverageAuditOptions {
	labels?: Record<string, string>;
	/** Max parallel deal queries. Default: 4. */
	concurrency?: number;
}

/**
 * Run the coverage audit over a list of deal IDs.
 * Returns the full coverage report (no DB writes).
 */
export async function runCoverageAudit(
	pool: Pool,
	dealIds: string[],
	options: CoverageAuditOptions = {}
): Promise<CoverageAuditReport> {
	const { labels = {}, concurrency = 4 } = options;
	const safePool = wrapPoolReadOnly(pool);

	// Simple promise-pool: process at most `concurrency` deals in parallel
	const results: DealCoverageResult[] = new Array(dealIds.length);
	const queue = dealIds.map((id, idx) => ({ id, idx }));
	let qIdx = 0;

	async function worker(): Promise<void> {
		while (qIdx < queue.length) {
			const item = queue[qIdx++]!;
			const label = labels[item.id] ?? item.id.slice(0, 8);
			results[item.idx] = await runDealCoverage(safePool, item.id, label);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, dealIds.length) }, () => worker());
	await Promise.all(workers);

	// ── Portfolio summary ────────────────────────────────────────────────
	const slotNames = STRICT_DETECTORS.map((d) => d.name);
	const slotBreakdown = slotNames.map((slot) => {
		const counts = { slot, ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 0, true_absence: 0 };
		for (const deal of results) {
			const sr = deal.slot_results.find((s) => s.slot === slot);
			if (!sr) continue;
			switch (sr.classification) {
				case "OK_MATCH":     counts.ok_match++;     break;
				case "STALE_STORED": counts.stale_stored++; break;
				case "REGRESSED":    counts.regressed++;    break;
				case "DETECTOR_GAP": counts.detector_gap++; break;
				case "TRUE_ABSENCE": counts.true_absence++; break;
				default: break;
			}
		}
		return counts;
	});

	const dealsOk          = results.filter((d) => d.audit_status === "ok").length;
	const dealsWithGaps    = results.filter((d) => d.summary.detector_gap > 0).length;
	const dealsWithStale   = results.filter((d) => d.summary.stale_stored > 0).length;
	const dealsWithRegress = results.filter((d) => d.summary.regressed > 0).length;

	const tighteningCandidates = computeTighteningCandidates(results, slotBreakdown);
	const { slot: selectedSlot, rationale: selectedRationale } = selectNextSlot(tighteningCandidates);

	const dealsWithFinancialStmt = results.filter((d) => d.structured_coverage?.financial_statement_v1).length;
	const dealsWithUoF = results.filter((d) => d.structured_coverage?.use_of_funds_v1).length;

	return {
		generated_at: new Date().toISOString(),
		meta: {
			selected_slot:            selectedSlot,
			selected_slot_rationale:  selectedRationale,
		},
		deals: results,
		portfolio_summary: {
			total_deals:            dealIds.length,
			deals_ok:               dealsOk,
			deals_with_gaps:        dealsWithGaps,
			deals_with_stale:       dealsWithStale,
			deals_with_regressions: dealsWithRegress,
			slot_breakdown:         slotBreakdown,
			structured_coverage_summary: {
				deals_with_financial_statement_v1: dealsWithFinancialStmt,
				deals_with_use_of_funds_v1:        dealsWithUoF,
			},
		},
		tightening_candidates: tighteningCandidates,
	};
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9 — Markdown report printer
// ═══════════════════════════════════════════════════════════════════════

const CLASSIFICATION_EMOJI: Record<SlotCoverageClassification, string> = {
	OK_MATCH:             "✅",
	STALE_STORED:         "♻️",
	REGRESSED:            "⚠️",
	DETECTOR_GAP:         "🔍",
	TRUE_ABSENCE:         "—",
	MISSING_REPORT:       "🚫",
	DPU_LOAD_FAILED:      "❌",
	EVIDENCE_REF_MISSING: "🔗",
};

// ─────────────────────────────────────────────────────────────────────
// Helper: render a single tightening-candidate subsection
// ─────────────────────────────────────────────────────────────────────
function renderTighteningCandidate(c: TighteningCandidate): string[] {
	const lines: string[] = [];
	lines.push(`### ${c.slot} (${c.detector_gap} gap${c.detector_gap === 1 ? "" : "s"})`);
	lines.push("");

	if (c.top_keywords.length > 0) {
		const kwStr = c.top_keywords.map((k) => `\`${k.keyword}\`(${k.count})`).join(", ");
		lines.push(`**Top keywords:** ${kwStr}`);
	} else {
		lines.push("**Top keywords:** _none_");
	}

	if (c.top_headers.length > 0) {
		const hStr = c.top_headers.map((h) => `\`${h.text}\`(${h.count})`).join(", ");
		lines.push(`**Header-like patterns:** ${hStr}`);
	} else {
		lines.push("**Header-like patterns:** _none found_");
	}

	if (c.top_refs.length > 0) {
		lines.push("");
		lines.push("**Top evidence refs:**");
		for (const r of c.top_refs) {
			lines.push(`- \`${r.ref}\``);
			lines.push(`  > ${r.snippet.slice(0, 100)}`);
		}
	}
	lines.push("");
	return lines;
}

export function printCoverageMarkdown(report: CoverageAuditReport): string {
	// ── Top Tightening Candidates section ────────────────────────────────
	const tcLines: string[] = [
		"## 🎯 Top Tightening Candidates",
		"",
	];

	if (report.meta.selected_slot) {
		tcLines.push(`> **Next slot to tighten:** \`${report.meta.selected_slot}\``);
		tcLines.push(`> _Rationale: ${report.meta.selected_slot_rationale}_`);
		tcLines.push("");
	} else {
		tcLines.push("> _No DETECTOR\_GAP slots — portfolio fully covered by strict detectors!_ 🎉");
		tcLines.push("");
	}

	if (report.tightening_candidates.length > 0) {
		// Summary table
		tcLines.push("| Rank | Slot | 🔍 Gaps | Top Keywords |");
		tcLines.push("|------|------|---------|--------------|" );
		for (const [i, c] of report.tightening_candidates.entries()) {
			const kwStr = c.top_keywords.slice(0, 3).map((k) => `${k.keyword}(${k.count})`).join(", ") || "—";
			tcLines.push(`| ${i + 1} | ${c.slot} | ${c.detector_gap} | ${kwStr} |`);
		}
		tcLines.push("");

		// Per-slot subsections
		for (const c of report.tightening_candidates) {
			tcLines.push(...renderTighteningCandidate(c));
		}
	}

	tcLines.push("---");
	tcLines.push("");

	// ── Main report ───────────────────────────────────────────────────────
	const lines: string[] = [
		"# Investor Insights — Portfolio DPU Coverage Audit",
		"",
		`**Generated:** ${report.generated_at}`,
		"",
		...tcLines,
		"## Portfolio Summary",
		"",
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total deals | ${report.portfolio_summary.total_deals} |`,
		`| Deals fully OK | ${report.portfolio_summary.deals_ok} |`,
		`| Deals with detector gaps | ${report.portfolio_summary.deals_with_gaps} |`,
		`| Deals with stale stored results | ${report.portfolio_summary.deals_with_stale} |`,
		`| Deals with regressions | ${report.portfolio_summary.deals_with_regressions} |`,
		"",
		"## Slot Breakdown",
		"",
		`| Slot | ✅ OK | ♻️ Stale | ⚠️ Regressed | 🔍 Gap | — Absent |`,
		`|------|-------|----------|--------------|--------|----------|`,
		...report.portfolio_summary.slot_breakdown.map((s) =>
			`| ${s.slot} | ${s.ok_match} | ${s.stale_stored} | ${s.regressed} | ${s.detector_gap} | ${s.true_absence} |`
		),
		"",
		"## Structured Coverage (XLSX)",
		"",
		`| Section | Deals with data |`,
		`|---------|-----------------|`,
		`| financial_statement_v1 | ${report.portfolio_summary.structured_coverage_summary.deals_with_financial_statement_v1} / ${report.portfolio_summary.total_deals} |`,
		`| use_of_funds_v1 | ${report.portfolio_summary.structured_coverage_summary.deals_with_use_of_funds_v1} / ${report.portfolio_summary.total_deals} |`,
		"",
		"---",
		"",
		"## Per-Deal Results",
		"",
	];

	for (const deal of report.deals) {
		lines.push(`### ${deal.deal_label} (\`${deal.deal_id}\`)`);
		lines.push("");
		lines.push(`**Status:** ${deal.audit_status} | **DPU pages:** ${deal.dpu_pages_total}`);
		if (deal.error) lines.push(`**Error:** ${deal.error}`);
		lines.push("");

		if (deal.slot_results.length === 0) {
			lines.push("_No slot results (likely no report or DPU data)._");
			lines.push("");
			continue;
		}

		lines.push(`| Slot | Stored | Recomputed | Classification | Notes |`);
		lines.push(`|------|--------|------------|----------------|-------|`);

		for (const sr of deal.slot_results) {
			const emoji = CLASSIFICATION_EMOJI[sr.classification];
			const storedVal = sr.stored_value ? `\`${sr.stored_value.slice(0, 40)}\`` : "_none_";
			const recompVal = sr.recomputed_value ? `\`${sr.recomputed_value.slice(0, 40)}\`` : "_none_";
			const notes = sr.candidate_pages.length > 0
				? `${sr.candidate_pages.length} candidate page(s)`
				: "";
			lines.push(`| ${sr.slot} | ${sr.stored_status} ${storedVal} | ${sr.recomputed_status} ${recompVal} | ${emoji} ${sr.classification} | ${notes} |`);
		}
		lines.push("");

		// Show candidate pages for DETECTOR_GAP slots
		const gaps = deal.slot_results.filter((s) => s.classification === "DETECTOR_GAP");
		if (gaps.length > 0) {
			lines.push("#### Detector Gap — Candidate Pages");
			lines.push("");
			for (const sr of gaps) {
				lines.push(`**${sr.slot}:**`);
				for (const cp of sr.candidate_pages.slice(0, 3)) {
					lines.push(`- \`${cp.ref}\` — keywords: [${cp.triggeredKeywords.slice(0, 5).join(", ")}]`);
					lines.push(`  > ${cp.snippet.slice(0, 100)}`);
				}
				lines.push("");
			}
		}
	}

	// Legend
	lines.push("---");
	lines.push("");
	lines.push("## Legend");
	lines.push("");
	lines.push("| Symbol | Classification | Meaning |");
	lines.push("|--------|----------------|---------|");
	lines.push("| ✅ | OK_MATCH | Stored and recomputed both Computable |");
	lines.push("| ♻️ | STALE_STORED | Stored=NotComputable, recomputed now finds it |");
	lines.push("| ⚠️ | REGRESSED | Stored=Computable, recomputed can no longer find it |");
	lines.push("| 🔍 | DETECTOR_GAP | Both NotComputable, but semantic keywords found in DPU |");
	lines.push("| — | TRUE_ABSENCE | Both NotComputable, no relevant text in DPU |");
	lines.push("| 🚫 | MISSING_REPORT | No investor_insight_reports row for this deal |");
	lines.push("| ❌ | DPU_LOAD_FAILED | Zero usable DPU pages for this deal |");
	lines.push("| 🔗 | EVIDENCE_REF_MISSING | Evidence ref points to a page not in DPU |");
	lines.push("");

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10 — Deal-list parsing (re-export convenience)
// ═══════════════════════════════════════════════════════════════════════

export { parseDealListFile, wrapPoolReadOnly };
export type { DealListFile };

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11 — Header-like text detection
//
// Flags text lines that look like slide/section headers: ALL CAPS or
// Title Case (≥60 % capitalised words), ≤60 chars, containing at least
// one of the domain keywords below.
// ═══════════════════════════════════════════════════════════════════════

/** Domain keywords that signal an investor-deck section header. */
export const HEADER_KEYWORDS_UPPER = [
	"ALLOCATION", "PROCEEDS", "MARKET", "TAM", "SAM", "SOM",
	"USE OF FUNDS", "USE OF CAPITAL", "CAPITAL ALLOCATION",
	"CAP", "VALUATION", "RAISE", "RAISING", "TRACTION",
	"RETENTION", "REVENUE", "FUNDING", "INVESTMENT",
] as const;

/**
 * Return any lines from `text` that look like domain-relevant slide headers.
 * Line must be ≤60 chars, ALL CAPS or Title Case, and contain at least one
 * HEADER_KEYWORDS_UPPER keyword.
 */
export function extractHeaderLike(text: string): string[] {
	const headers: string[] = [];
	for (const raw of text.split(/\n/)) {
		const trimmed = raw.trim();
		if (trimmed.length === 0 || trimmed.length > 60) continue;

		// ALL CAPS: every alpha char is uppercase
		const isAllCaps = /[A-Z]/.test(trimmed) && trimmed === trimmed.toUpperCase();

		// Title Case: first word starts with uppercase AND ≥60 % of words start uppercase
		if (!isAllCaps) {
			const words = trimmed.split(/\s+/).filter(Boolean);
			if (words.length === 0 || !/^[A-Z]/.test(words[0]!)) continue;
			const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length;
			if (capitalised / words.length < 0.6) continue;
		}

		const upper = trimmed.toUpperCase();
		if (!HEADER_KEYWORDS_UPPER.some((kw) => upper.includes(kw))) continue;
		headers.push(trimmed);
	}
	return headers;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 12 — Tightening candidate computation + slot selection
// ═══════════════════════════════════════════════════════════════════════

/**
 * Investor-value priority order used for tie-breaking when two slots share
 * the same DETECTOR_GAP count.
 */
export const SLOT_PRIORITY: readonly string[] = [
	"raise_terms",
	"traction_signal",
	"valuation_terms",
	"use_of_funds",
	"market_claims",
];

/**
 * Build the ranked list of tightening candidates from a completed report's
 * deals and slot_breakdown. Exported for unit-testing.
 */
export function computeTighteningCandidates(
	deals: DealCoverageResult[],
	slotBreakdown: CoverageAuditReport["portfolio_summary"]["slot_breakdown"]
): TighteningCandidate[] {
	return slotBreakdown
		.filter((s) => s.detector_gap > 0)
		.map((s) => {
			const slot = s.slot;

			// Collect all candidate pages for DETECTOR_GAP instances of this slot
			const allCandidatePages = deals.flatMap((deal) =>
				deal.slot_results
					.filter((sr) => sr.slot === slot && sr.classification === "DETECTOR_GAP")
					.flatMap((sr) => sr.candidate_pages)
			);

			// Keyword frequency map
			const kwCounts = new Map<string, number>();
			for (const cp of allCandidatePages) {
				for (const kw of cp.triggeredKeywords) {
					const n = kw.toLowerCase();
					kwCounts.set(n, (kwCounts.get(n) ?? 0) + 1);
				}
			}

			// Header-like patterns from candidate snippets
			const headerCounts = new Map<string, number>();
			for (const cp of allCandidatePages) {
				for (const h of extractHeaderLike(cp.snippet)) {
					const norm = h.toUpperCase().trim();
					headerCounts.set(norm, (headerCounts.get(norm) ?? 0) + 1);
				}
			}

			// Top-3 unique refs
			const seenRefs = new Set<string>();
			const topRefs: TighteningCandidate["top_refs"] = [];
			for (const cp of allCandidatePages) {
				if (!seenRefs.has(cp.ref) && topRefs.length < 3) {
					seenRefs.add(cp.ref);
					topRefs.push({ ref: cp.ref, snippet: cp.snippet.slice(0, 100) });
				}
			}

			return {
				slot,
				detector_gap: s.detector_gap,
				top_keywords: [...kwCounts.entries()]
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.slice(0, 5)
					.map(([keyword, count]) => ({ keyword, count })),
				top_headers: [...headerCounts.entries()]
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.slice(0, 5)
					.map(([text, count]) => ({ text, count })),
				top_refs: topRefs,
			};
		})
		// Sort: descending gap count, then slot name alphabetically (stable)
		.sort((a, b) => b.detector_gap - a.detector_gap || a.slot.localeCompare(b.slot));
}

/**
 * Pick the next slot to tighten from a ranked candidate list.
 *
 * Tie-break order:
 *  1. Highest keyword concentration (top-keyword count / total keyword counts)
 *  2. Investor-value priority: raise_terms > traction_signal > valuation_terms
 *     > use_of_funds > market_claims
 */
export function selectNextSlot(
	candidates: TighteningCandidate[]
): { slot: string | null; rationale: string } {
	const gapped = candidates.filter((c) => c.detector_gap > 0); // already sorted desc
	if (gapped.length === 0) return { slot: null, rationale: "no DETECTOR_GAP slots found" };

	const maxGap = gapped[0]!.detector_gap;
	const tied   = gapped.filter((c) => c.detector_gap === maxGap);

	let winner: TighteningCandidate;
	if (tied.length === 1) {
		winner = tied[0]!;
	} else {
		// Tie-break 1: keyword concentration
		const withConc = tied.map((c) => {
			const total    = c.top_keywords.reduce((s, k) => s + k.count, 0);
			const topCount = c.top_keywords[0]?.count ?? 0;
			return { c, conc: total > 0 ? topCount / total : 0 };
		});
		const maxConc   = Math.max(...withConc.map((w) => w.conc));
		const afterConc = withConc.filter((w) => Math.abs(w.conc - maxConc) < 0.001).map((w) => w.c);

		// Tie-break 2: priority order
		winner = [...afterConc].sort((a, b) => {
			const ia = SLOT_PRIORITY.indexOf(a.slot);
			const ib = SLOT_PRIORITY.indexOf(b.slot);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		})[0]!;
	}

	const topKw = winner.top_keywords
		.slice(0, 3)
		.map((k) => `${k.keyword}(${k.count})`)
		.join(", ");
	return {
		slot:      winner.slot,
		rationale: `highest gaps=${maxGap}; top keywords: ${topKw || "(none)"}`,
	};
}
