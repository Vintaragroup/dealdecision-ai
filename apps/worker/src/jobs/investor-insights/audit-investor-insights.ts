/**
 * audit-investor-insights.ts
 *
 * Governance-grade, read-only audit runner for the Investor Insights panel.
 *
 * Upgrades in v2:
 *   1. Deal-list input (stable portfolio mode)
 *   2. Concurrency control (promise pool)
 *   3. Pre-flight document coverage diagnostics
 *   4. Delta mode (regression tracking vs. baseline)
 *   5. CI gate mode (--fail-on / --max-failures → exit(1))
 *   6. Failure class → engineering action map
 *   7. Safe-mode assertions (read-only enforcement)
 */

import type { Pool } from "pg";
import { normalizeForExtraction } from "./normalize";
import { fetchAuditDataForDeal, type AuditDpuRow } from "../../lib/db/audit-queries";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — Slot patterns (copied from processor.ts — intentional)
// ═══════════════════════════════════════════════════════════════════════

const MARKET_PATTERN =
	/(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)[^$\n]{0,60}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,60}?(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)/i;

const TRACTION_PATTERN =
	/(?:\bMRR\b|\bARR\b|\bmonthly\s+recurring\s+revenue\b|\bannual\s+recurring\s+revenue\b)(?:[^$\n]{0,60})?\$[\d,.]+\s*[BMKbmk]?/i;

const _TRACTION_PCT_KW = String.raw`(?:demo[- ]to[- ]close|close\s+rate|conversion\s+rate?|retention(?:\s+(?:ratio|rate))?|churn(?:\s+rate)?|lift|engagement(?:\s+rate)?|activation(?:\s+rate)?|nps\b|net\s+promoter|upsell(?:\s+rate)?|win\s+rate)`;
const _PCT_VALUE = String.raw`\d+(?:\.\d+)?(?:\s*[–\-]\s*\d+(?:\.\d+)?)?\s*%`;
const TRACTION_PCT_PATTERN = new RegExp(
	`\\b${_TRACTION_PCT_KW}\\b[^\\n]{0,60}?${_PCT_VALUE}` +
	`|${_PCT_VALUE}[^\\n]{0,60}?\\b${_TRACTION_PCT_KW}\\b`,
	"i"
);

const VALUATION_PATTERN = /(valuation|post[- ]money|pre[- ]money|safe cap|cap)\b/i;
const USE_OF_FUNDS_PATTERN = /(use of (funds|proceeds)|allocation of proceeds|proceeds will be used)\b/i;

const CURRENCY       = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT         = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX         = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;
const _NO_CUR = `[^$€£\\n]`;
const RAISE_ANCHOR = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

const RAISE_AMOUNT_PATTERN = new RegExp(
	`${RAISE_ANCHOR}\\s+${MONEY_FRAGMENT}` +
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
	`${RAISE_ANCHOR}\\s+${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}`,
	"i"
);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — Internal detection helpers
// ═══════════════════════════════════════════════════════════════════════

interface RecomputePage {
	document_id: string;
	page_index: number;
	text: string;
	text_raw: string;
}

function buildEvidenceRef(document_id: string, page_index: number): string {
	const prefix = document_id.replace(/-/g, "").slice(0, 8);
	return `dpu:doc:${prefix}:page:${page_index}`;
}

function detectInPages(
	pages: RecomputePage[],
	pattern: RegExp
): { snippet: string; ref: string } | null {
	for (const page of pages) {
		const m = pattern.exec(page.text);
		if (m) {
			return { snippet: m[0].slice(0, 80), ref: buildEvidenceRef(page.document_id, page.page_index) };
		}
	}
	return null;
}

interface SlotRecomputed {
	computable: boolean;
	value: string | null;
	evidence: string | null;
}

const SLOT_DETECTORS: Array<{ name: string; detect: (pages: RecomputePage[]) => SlotRecomputed }> = [
	{
		name: "raise_terms",
		detect: (pages) => {
			const rangeHit = detectInPages(pages, RAISE_RANGE_PATTERN);
			if (rangeHit) return { computable: true, value: rangeHit.snippet, evidence: rangeHit.ref };
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
			const pctHit = detectInPages(pages, TRACTION_PCT_PATTERN);
			if (pctHit) return { computable: true, value: pctHit.snippet, evidence: pctHit.ref };
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
// SECTION 3 — Safe mode (upgrade 7)
// ═══════════════════════════════════════════════════════════════════════

/** Thrown when a write query is attempted while read-only mode is active. */
export class ReadOnlyViolationError extends Error {
	constructor(query: string) {
		super(
			`[audit:safe-mode] READ-ONLY VIOLATION — write query attempted:\n  ${query.slice(0, 120)}`
		);
		this.name = "ReadOnlyViolationError";
	}
}

const WRITE_QUERY_RE =
	/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|COPY|CALL|BEGIN\s+(?:TRANSACTION|WORK)?|COMMIT|ROLLBACK|SAVEPOINT|LOCK)\b/i;

/**
 * wrapPoolReadOnly
 *
 * Returns a proxy around the pg Pool that throws ReadOnlyViolationError
 * immediately if any write-pattern SQL is submitted via pool.query().
 */
export function wrapPoolReadOnly(pool: Pool): Pool {
	const assertSelect = (text: string): void => {
		if (WRITE_QUERY_RE.test(text)) {
			throw new ReadOnlyViolationError(text);
		}
	};

	return new Proxy(pool, {
		get(target, prop) {
			if (prop === "query") {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				return (...args: any[]) => {
					const queryArg = args[0];
					const text =
						typeof queryArg === "string" ? queryArg
						: typeof queryArg === "object" && queryArg !== null && typeof queryArg.text === "string"
						? queryArg.text
						: "";
					assertSelect(text);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					return (target.query as any)(...args);
				};
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (target as any)[prop];
		},
	});
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — Public types
// ═══════════════════════════════════════════════════════════════════════

export type SlotStatus = "Computable" | "NotComputable" | "Missing";
export type FailureTag =
	| "MISSING_DPU"
	| "EMPTY_TEXT"
	| "FALSE_NEGATIVE"
	| "BAD_EVIDENCE_REF"
	| "PARSE_HAZARD"
	| "OTHER";

export interface SlotValidation {
	evidence_ref_resolves: boolean | null;
	snippet_found_in_page_text: boolean | null;
	page_text_len: number | null;
}

export interface SlotAuditResult {
	slot: string;
	stored_status: SlotStatus;
	stored_value: string | null;
	stored_evidence: string | null;
	recomputed_status: SlotStatus;
	recomputed_value: string | null;
	recomputed_evidence: string | null;
	validation: SlotValidation;
	failure_tag: FailureTag | null;
	notes: string | null;
}

/** Per-document DPU coverage stats (upgrade 3). */
export interface DocCoverageDiagnostic {
	document_id: string;
	document_id_prefix: string;
	title: string;
	mime_type: string | null;
	page_count_meta: number | null;
	dpu_pages_present: number;
	empty_text_pages: number;
	pct_empty: number;
	max_page_index: number | null;
}

export interface DealAuditResult {
	deal_id: string;
	deal_label: string;
	audit_status: "ok" | "partial" | "failed" | "NOT_FOUND";
	error: string | null;
	documents: Array<{
		id: string;
		title: string;
		type: string;
		mime_type: string | null;
		page_count: number | null;
		status: string;
	}>;
	dpu: {
		total_pages: number;
		empty_text_pages: number;
		non_empty_pages: number;
		avg_text_len: number;
		doc_coverage: Array<{ document_id: string; pages_present: number }>;
	};
	/** Pre-flight per-document diagnostics (upgrade 3). */
	doc_coverage_diagnostics: DocCoverageDiagnostic[];
	report: {
		present: boolean;
		status: string | null;
		engine_version: string | null;
		updated_at: string | null;
		sections_present: string[];
	};
	slots: SlotAuditResult[];
	failure_tags: FailureTag[];
}

export interface AuditSummary {
	total_deals: number;
	deals_ok: number;
	deals_partial: number;
	deals_failed: number;
	deals_not_found: number;
	top_failure_tags: Array<{ tag: FailureTag; count: number }>;
	top_missing_slots: Array<{ slot: string; not_computable_count: number; false_negative_count: number }>;
}

/** Recommended action per failure class (upgrade 6). */
export interface FixRecommendation {
	failure_tag: FailureTag;
	subsystem: string;
	action: string;
	count: number;
}

/** Delta comparison against a baseline report (upgrade 4). */
export interface DeltaReport {
	baseline_generated_at: string;
	current_generated_at: string;
	failures_reduced: number;
	failures_increased: number;
	new_failure_tags: FailureTag[];
	deals_newly_failing: Array<{ deal_id: string; deal_label: string; new_tags: FailureTag[] }>;
	deals_newly_ok: Array<{ deal_id: string; deal_label: string }>;
	tag_deltas: Array<{ tag: FailureTag; baseline_count: number; current_count: number; delta: number }>;
	slot_deltas: Array<{ slot: string; baseline_not_computable: number; current_not_computable: number; delta: number }>;
}

export interface AuditReport {
	generated_at: string;
	deals: DealAuditResult[];
	summary: AuditSummary;
	fix_recommendations: FixRecommendation[];
	delta: DeltaReport | null;
}

/** Input format for --deal-list (upgrade 1). */
export interface DealListEntry {
	name: string;
	deal_id: string;
}

export interface DealListFile {
	deals: DealListEntry[];
}

export interface AuditOptions {
	labels?: Record<string, string>;
	/** Max concurrent deal queries. Default: 4. */
	concurrency?: number;
	/** Wrap pool in read-only assertion mode. Default: true. */
	readOnly?: boolean;
	/** Baseline report for delta computation. */
	baseline?: AuditReport;
}

/** Options for the CI gate (upgrade 5). */
export interface GateOptions {
	failOn: FailureTag[];
	maxFailures: number;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5 — Deal list parsing (upgrade 1)
// ═══════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * parseDealListFile
 *
 * Validates and parses a {deals:[{name,deal_id},...]} JSON object.
 * Throws with a descriptive message on schema violation.
 */
export function parseDealListFile(raw: unknown): DealListFile {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error('Deal list file must be a JSON object with a "deals" array');
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj["deals"])) {
		throw new Error('Deal list file must have a top-level "deals" array');
	}
	const deals: DealListEntry[] = [];
	for (let i = 0; i < obj["deals"].length; i++) {
		const entry = obj["deals"][i];
		if (typeof entry !== "object" || entry === null) {
			throw new Error(`deals[${i}] must be an object`);
		}
		const e = entry as Record<string, unknown>;
		if (typeof e["name"] !== "string" || e["name"].trim() === "") {
			throw new Error(`deals[${i}].name must be a non-empty string`);
		}
		if (typeof e["deal_id"] !== "string" || !UUID_RE.test(e["deal_id"])) {
			throw new Error(`deals[${i}].deal_id must be a valid UUID (got: ${String(e["deal_id"])})`);
		}
		deals.push({ name: e["name"].trim(), deal_id: e["deal_id"] });
	}
	if (deals.length === 0) {
		throw new Error("Deal list must contain at least one entry");
	}
	return { deals };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6 — Evidence ref parsing (unchanged public API)
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedEvidenceRef {
	type: "dpu" | "evidence_item" | "unknown";
	docPrefix: string | null;
	pageIndex: number | null;
	itemPrefix: string | null;
}

export function parseEvidenceRef(ref: string): ParsedEvidenceRef {
	const dpuMatch = /^dpu:doc:([0-9a-f]{8}):page:(\d+)$/i.exec(ref);
	if (dpuMatch) {
		return { type: "dpu", docPrefix: dpuMatch[1].toLowerCase(), pageIndex: parseInt(dpuMatch[2], 10), itemPrefix: null };
	}
	const evMatch = /^evidence:item:([0-9a-f]{8})$/i.exec(ref);
	if (evMatch) {
		return { type: "evidence_item", docPrefix: null, pageIndex: null, itemPrefix: evMatch[1].toLowerCase() };
	}
	return { type: "unknown", docPrefix: null, pageIndex: null, itemPrefix: null };
}

export function resolveEvidenceRef(
	ref: string,
	dpuRows: AuditDpuRow[]
): AuditDpuRow | null {
	const parsed = parseEvidenceRef(ref);
	if (parsed.type !== "dpu" || parsed.docPrefix === null || parsed.pageIndex === null) {
		return null;
	}
	return dpuRows.find(
		(r) =>
			r.document_id.replace(/-/g, "").toLowerCase().startsWith(parsed.docPrefix!) &&
			r.page_index === parsed.pageIndex
	) ?? null;
}

export function findSnippetInPageText(snippet: string, pageText: string): boolean {
	if (!snippet || !pageText) return false;
	const norm = normalizeForExtraction(snippet.trim()).text;
	const rawHaystack = normalizeForExtraction(pageText).text;
	// XLSX/structured page_text uses '|' as a cell-column separator.
	// The extraction pipeline sanitizes '|' → '/' when writing slot values via
	// formatSlotLine (same replacement: /\|/g → "/", no extra spaces).
	// Mirror that exact substitution in the haystack so comparisons survive the
	// round-trip: e.g. "retention ratio | 60.00%" ↔ "Retention ratio / 60.00%",
	// and "xellejixel| double" ↔ "xellejixel/ double".
	const haystack = rawHaystack.replace(/\|/g, "/");
	if (haystack.toLowerCase().includes(norm.toLowerCase())) return true;
	const stub = norm.slice(0, Math.min(40, norm.length));
	return stub.length > 3 && haystack.toLowerCase().includes(stub.toLowerCase());
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7 — Stored slot body parser
// ═══════════════════════════════════════════════════════════════════════

interface StoredSlotLine {
	slot: string;
	status: SlotStatus;
	value: string | null;
	evidence: string | null;
}

export function parseStoredSlotsBody(body: string): StoredSlotLine[] {
	return body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.flatMap((line): StoredSlotLine[] => {
			const colonIdx = line.indexOf(":");
			if (colonIdx === -1) return [];
			const slot = line.slice(0, colonIdx).trim();
			const rest = line.slice(colonIdx + 1).trim();
			const parts = rest.split(/ \| /).map((p) => p.trim());
			const rawStatus = (parts[0] ?? "").trim();
			const status: SlotStatus =
				rawStatus === "Computable" ? "Computable"
				: rawStatus === "NotComputable" ? "NotComputable"
				: "Missing";
			const pick = (key: string): string | null => {
				const part = parts.find((p) => p.startsWith(`${key}=`));
				if (!part) return null;
				const raw = part.slice(key.length + 1).trim();
				if (raw === "none") return null;
				if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
				return raw;
			};
			return [{ slot, status, value: pick("value"), evidence: pick("evidence") }];
		});
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8 — Failure classification
// ═══════════════════════════════════════════════════════════════════════

export function classifySlotFailure(opts: {
	dpuEmpty: boolean;
	dpuMissing: boolean;
	storedComputable: boolean;
	recomputedComputable: boolean;
	evidenceResolves: boolean | null;
	snippetFound: boolean | null;
	hasParseHazard: boolean;
}): FailureTag | null {
	const { dpuMissing, dpuEmpty, storedComputable, recomputedComputable, evidenceResolves, snippetFound, hasParseHazard } = opts;
	if (dpuMissing) return "MISSING_DPU";
	if (dpuEmpty) return "EMPTY_TEXT";
	if (storedComputable && evidenceResolves === false) return "BAD_EVIDENCE_REF";
	if (storedComputable && snippetFound === false) return "BAD_EVIDENCE_REF";
	if (hasParseHazard) return "PARSE_HAZARD";
	if (!storedComputable && recomputedComputable) return "FALSE_NEGATIVE";
	if (storedComputable && !recomputedComputable) return "OTHER";
	return null;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9 — Fix recommendations (upgrade 6)
// ═══════════════════════════════════════════════════════════════════════

const FIX_CLASS_MAP: Record<FailureTag, { subsystem: string; action: string }> = {
	MISSING_DPU: {
		subsystem: "Extraction pipeline / job orchestration",
		action:    "Verify document_page_understanding records exist; check DPU worker job queue and deal_id FK linkage.",
	},
	EMPTY_TEXT: {
		subsystem: "DPU extraction branch / page_text integrity",
		action:    "Inspect payload->>'page_text' in document_page_understanding; check OCR/extraction code path for this MIME type.",
	},
	BAD_EVIDENCE_REF: {
		subsystem: "Evidence encoding or page_index mismatch",
		action:    "Verify dpuEvidenceRef() uses correct document_id prefix and page_index; check DPU row existence at referenced index.",
	},
	FALSE_NEGATIVE: {
		subsystem: "Regex / pattern gap in processor.ts",
		action:    "Add or expand pattern (RAISE_AMOUNT_PATTERN, TRACTION_PCT_PATTERN, etc.) to cover undetected text.",
	},
	PARSE_HAZARD: {
		subsystem: "Slot formatting / sanitization regression",
		action:    "Ensure formatSlotLine() sanitizes '|' to '/' before embedding in pipe-delimited slot body.",
	},
	OTHER: {
		subsystem: "General / undefined gap",
		action:    "Inspect deal manually; stored=Computable but recomputed=NotComputable suggests pattern regression.",
	},
};

export function buildFixRecommendations(deals: DealAuditResult[]): FixRecommendation[] {
	const tagCounts = new Map<FailureTag, number>();
	for (const deal of deals) {
		for (const slot of deal.slots) {
			if (slot.failure_tag) {
				tagCounts.set(slot.failure_tag, (tagCounts.get(slot.failure_tag) ?? 0) + 1);
			}
		}
	}
	return (Object.keys(FIX_CLASS_MAP) as FailureTag[])
		.filter((t) => (tagCounts.get(t) ?? 0) > 0)
		.sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0))
		.map((tag) => ({
			failure_tag: tag,
			subsystem: FIX_CLASS_MAP[tag].subsystem,
			action:    FIX_CLASS_MAP[tag].action,
			count:     tagCounts.get(tag) ?? 0,
		}));
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10 — Delta computation (upgrade 4)
// ═══════════════════════════════════════════════════════════════════════

export function computeDelta(baseline: AuditReport, current: AuditReport): DeltaReport {
	const baselineByDeal = new Map<string, DealAuditResult>();
	for (const d of baseline.deals) baselineByDeal.set(d.deal_id, d);

	const baselineTagCounts = new Map<FailureTag, number>();
	const currentTagCounts  = new Map<FailureTag, number>();
	const baselineSlotNC    = new Map<string, number>();
	const currentSlotNC     = new Map<string, number>();

	for (const d of baseline.deals) {
		for (const t of d.failure_tags) baselineTagCounts.set(t, (baselineTagCounts.get(t) ?? 0) + 1);
		for (const s of d.slots) if (s.stored_status !== "Computable") baselineSlotNC.set(s.slot, (baselineSlotNC.get(s.slot) ?? 0) + 1);
	}
	for (const d of current.deals) {
		for (const t of d.failure_tags) currentTagCounts.set(t, (currentTagCounts.get(t) ?? 0) + 1);
		for (const s of d.slots) if (s.stored_status !== "Computable") currentSlotNC.set(s.slot, (currentSlotNC.get(s.slot) ?? 0) + 1);
	}

	const allTags = [...new Set([...baselineTagCounts.keys(), ...currentTagCounts.keys()])] as FailureTag[];
	const tagDeltas = allTags
		.map((tag) => ({
			tag,
			baseline_count: baselineTagCounts.get(tag) ?? 0,
			current_count:  currentTagCounts.get(tag) ?? 0,
			delta: (currentTagCounts.get(tag) ?? 0) - (baselineTagCounts.get(tag) ?? 0),
		}))
		.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

	const allSlots = [...new Set([...baselineSlotNC.keys(), ...currentSlotNC.keys()])];
	const slotDeltas = allSlots
		.map((slot) => ({
			slot,
			baseline_not_computable: baselineSlotNC.get(slot) ?? 0,
			current_not_computable:  currentSlotNC.get(slot) ?? 0,
			delta: (currentSlotNC.get(slot) ?? 0) - (baselineSlotNC.get(slot) ?? 0),
		}))
		.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

	const currentByDeal = new Map<string, DealAuditResult>();
	for (const d of current.deals) currentByDeal.set(d.deal_id, d);

	const dealsNewlyFailing: DeltaReport["deals_newly_failing"] = [];
	for (const d of current.deals) {
		const base = baselineByDeal.get(d.deal_id);
		const baseTags = new Set(base?.failure_tags ?? []);
		const newTags = d.failure_tags.filter((t) => !baseTags.has(t));
		if (newTags.length > 0) {
			dealsNewlyFailing.push({ deal_id: d.deal_id, deal_label: d.deal_label, new_tags: newTags });
		}
	}

	const dealsNewlyOk: DeltaReport["deals_newly_ok"] = [];
	for (const d of baseline.deals) {
		if (d.failure_tags.length === 0) continue;
		const cur = currentByDeal.get(d.deal_id);
		if (cur && cur.failure_tags.length === 0) {
			dealsNewlyOk.push({ deal_id: d.deal_id, deal_label: d.deal_label });
		}
	}

	const newFailureTags = allTags.filter(
		(t) => (baselineTagCounts.get(t) ?? 0) === 0 && (currentTagCounts.get(t) ?? 0) > 0
	);

	const baselineTotal = [...baselineTagCounts.values()].reduce((s, c) => s + c, 0);
	const currentTotal  = [...currentTagCounts.values()].reduce((s, c) => s + c, 0);
	const netDelta      = currentTotal - baselineTotal;

	return {
		baseline_generated_at: baseline.generated_at,
		current_generated_at:  current.generated_at,
		failures_reduced:  netDelta < 0 ? Math.abs(netDelta) : 0,
		failures_increased: netDelta > 0 ? netDelta : 0,
		new_failure_tags:      newFailureTags,
		deals_newly_failing:   dealsNewlyFailing,
		deals_newly_ok:        dealsNewlyOk,
		tag_deltas:            tagDeltas,
		slot_deltas:           slotDeltas,
	};
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11 — CI gate (upgrade 5)
// ═══════════════════════════════════════════════════════════════════════

export interface GateResult {
	passed: boolean;
	violations: Array<{ tag: FailureTag; count: number; max_allowed: number }>;
}

/**
 * checkGate
 *
 * Returns a GateResult — does NOT call process.exit.
 */
export function checkGate(report: AuditReport, opts: GateOptions): GateResult {
	const tagCounts = new Map<FailureTag, number>();
	for (const d of report.deals) {
		for (const t of d.failure_tags) {
			tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
		}
	}
	const violations: GateResult["violations"] = [];
	for (const tag of opts.failOn) {
		const count = tagCounts.get(tag) ?? 0;
		if (count > opts.maxFailures) {
			violations.push({ tag, count, max_allowed: opts.maxFailures });
		}
	}
	return { passed: violations.length === 0, violations };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 12 — Concurrency promise pool (upgrade 2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * pooledMap
 *
 * Runs an async mapper with at most `concurrency` tasks at once.
 * Output order matches input order.
 */
export async function pooledMap<T, U>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<U>
): Promise<U[]> {
	const results: U[] = new Array(items.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (true) {
			const idx = nextIndex++;
			if (idx >= items.length) break;
			results[idx] = await fn(items[idx], idx);
		}
	};
	const cap = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: cap }, () => worker()));
	return results;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 13 — Document coverage diagnostics (upgrade 3)
// ═══════════════════════════════════════════════════════════════════════

function buildDocCoverageDiagnostics(
	documents: DealAuditResult["documents"],
	dpuRows: AuditDpuRow[]
): DocCoverageDiagnostic[] {
	return documents.map((doc) => {
		const docRows   = dpuRows.filter((r) => r.document_id === doc.id);
		const emptyRows = docRows.filter((r) => !r.page_text || r.page_text.trim().length === 0);
		const pctEmpty  = docRows.length > 0 ? Math.round((emptyRows.length / docRows.length) * 100) : 100;
		const maxPageIndex = docRows.length > 0 ? Math.max(...docRows.map((r) => r.page_index)) : null;
		return {
			document_id:        doc.id,
			document_id_prefix: doc.id.slice(0, 8),
			title:              doc.title,
			mime_type:          doc.mime_type,
			page_count_meta:    doc.page_count,
			dpu_pages_present:  docRows.length,
			empty_text_pages:   emptyRows.length,
			pct_empty:          pctEmpty,
			max_page_index:     maxPageIndex,
		};
	});
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 14 — Slot audit per deal
// ═══════════════════════════════════════════════════════════════════════

function hasParseHazardInValue(value: string | null): boolean {
	return value !== null && value.includes("|");
}

function auditSlotsForDeal(opts: {
	dpuRows: AuditDpuRow[];
	recomputePages: RecomputePage[];
	storedBody: string | null;
	dpuMissingForDeal: boolean;
}): SlotAuditResult[] {
	const { dpuRows, recomputePages, storedBody, dpuMissingForDeal } = opts;

	const storedMap = new Map<string, StoredSlotLine>();
	if (storedBody) {
		for (const line of parseStoredSlotsBody(storedBody)) {
			storedMap.set(line.slot, line);
		}
	}

	const dpuTotalPages = dpuRows.length;
	const dpuNonEmpty   = dpuRows.filter((r) => r.page_text && r.page_text.trim().length > 0).length;
	const results: SlotAuditResult[] = [];

	for (const detector of SLOT_DETECTORS) {
		const stored     = storedMap.get(detector.name) ?? null;
		const recomputed = detector.detect(recomputePages);

		const storedStatus: SlotStatus     = stored ? stored.status : "Missing";
		const recomputedStatus: SlotStatus = recomputed.computable ? "Computable" : "NotComputable";

		let evidenceResolves: boolean | null = null;
		let snippetFound: boolean | null     = null;
		let pageTextLen: number | null       = null;

		if (stored?.evidence) {
			const resolved = resolveEvidenceRef(stored.evidence, dpuRows);
			evidenceResolves = resolved !== null;
			if (resolved) {
				pageTextLen = resolved.page_text?.length ?? 0;
				if (stored.value) snippetFound = findSnippetInPageText(stored.value, resolved.page_text ?? "");
			}
		}

		const hasParseHazard = hasParseHazardInValue(stored?.value ?? null);

		const failureTag = classifySlotFailure({
			dpuMissing:           dpuMissingForDeal || dpuTotalPages === 0,
			dpuEmpty:             dpuTotalPages > 0 && dpuNonEmpty === 0,
			storedComputable:     storedStatus === "Computable",
			recomputedComputable: recomputedStatus === "Computable",
			evidenceResolves,
			snippetFound,
			hasParseHazard,
		});

		let notes: string | null = null;
		if (storedStatus === "Missing" && storedBody !== null) {
			notes = "Slot absent from stored body — may be a schema generation gap";
		} else if (storedStatus !== recomputedStatus) {
			notes = `stored=${storedStatus} vs recomputed=${recomputedStatus}`;
		}

		results.push({
			slot: detector.name,
			stored_status:       storedStatus,
			stored_value:        stored?.value ?? null,
			stored_evidence:     stored?.evidence ?? null,
			recomputed_status:   recomputedStatus,
			recomputed_value:    recomputed.value,
			recomputed_evidence: recomputed.evidence,
			validation: { evidence_ref_resolves: evidenceResolves, snippet_found_in_page_text: snippetFound, page_text_len: pageTextLen },
			failure_tag: failureTag,
			notes,
		});
	}
	return results;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 15 — Summary builder
// ═══════════════════════════════════════════════════════════════════════

function buildSummary(deals: DealAuditResult[]): AuditSummary {
	const tagCounts         = new Map<FailureTag, number>();
	const slotNotComputable = new Map<string, number>();
	const slotFalseNeg      = new Map<string, number>();

	for (const deal of deals) {
		for (const tag of deal.failure_tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		for (const slot of deal.slots) {
			if (slot.stored_status !== "Computable") slotNotComputable.set(slot.slot, (slotNotComputable.get(slot.slot) ?? 0) + 1);
			if (slot.failure_tag === "FALSE_NEGATIVE") slotFalseNeg.set(slot.slot, (slotFalseNeg.get(slot.slot) ?? 0) + 1);
		}
	}

	return {
		total_deals:     deals.length,
		deals_ok:        deals.filter((d) => d.audit_status === "ok").length,
		deals_partial:   deals.filter((d) => d.audit_status === "partial").length,
		deals_failed:    deals.filter((d) => d.audit_status === "failed").length,
		deals_not_found: deals.filter((d) => d.audit_status === "NOT_FOUND").length,
		top_failure_tags: Array.from(tagCounts.entries())
			.sort(([, a], [, b]) => b - a)
			.map(([tag, count]) => ({ tag, count })),
		top_missing_slots: Array.from(slotNotComputable.entries())
			.sort(([, a], [, b]) => b - a)
			.map(([slot, not_computable_count]) => ({
				slot,
				not_computable_count,
				false_negative_count: slotFalseNeg.get(slot) ?? 0,
			})),
	};
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 16 — Main runner (upgrades 2, 3, 7)
// ═══════════════════════════════════════════════════════════════════════

export async function runInvestorInsightsAudit(
	pool: Pool,
	dealIds: string[],
	opts: AuditOptions = {}
): Promise<AuditReport> {
	const labels      = opts.labels ?? {};
	const concurrency = opts.concurrency ?? 4;
	const safePool    = opts.readOnly !== false ? wrapPoolReadOnly(pool) : pool;

	const dealResults = await pooledMap(dealIds, concurrency, async (dealId) => {
		const label = labels[dealId] ?? dealId.slice(0, 8);
		try {
			const data = await fetchAuditDataForDeal(safePool, dealId);

			const documents = (data.documents ?? []).map((d) => ({
				id: d.id, title: d.title, type: d.type,
				mime_type: d.mime_type ?? null, page_count: d.page_count ?? null, status: d.status,
			}));

			const dpuRows      = data.dpu_pages ?? [];
			const nonEmptyRows = dpuRows.filter((r) => r.page_text && r.page_text.trim().length > 0);
			const totalTextLen = nonEmptyRows.reduce((s, r) => s + (r.page_text?.length ?? 0), 0);
			const avgTextLen   = nonEmptyRows.length > 0 ? Math.round(totalTextLen / nonEmptyRows.length) : 0;

			const docPageCounts = new Map<string, number>();
			for (const row of dpuRows) docPageCounts.set(row.document_id, (docPageCounts.get(row.document_id) ?? 0) + 1);

			const dpu = {
				total_pages:      dpuRows.length,
				empty_text_pages: dpuRows.length - nonEmptyRows.length,
				non_empty_pages:  nonEmptyRows.length,
				avg_text_len:     avgTextLen,
				doc_coverage:     Array.from(docPageCounts.entries())
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([document_id, pages_present]) => ({ document_id, pages_present })),
			};

			const reportRow = data.report;
			let sectionsPresent: string[] = [];
			let storedSlotBody: string | null = null;
			if (reportRow?.render_package) {
				const rp = reportRow.render_package as Record<string, unknown>;
				const sections = Array.isArray(rp["sections"]) ? rp["sections"] as Array<Record<string, unknown>> : [];
				sectionsPresent = sections.map((s) => typeof s["key"] === "string" ? s["key"] : null).filter((k): k is string => k !== null);
				const slotsSec = sections.find((s) => s["key"] === "insight_slots");
				if (slotsSec && typeof slotsSec["body"] === "string") storedSlotBody = slotsSec["body"];
			}

			const report = {
				present:          reportRow !== null,
				status:           reportRow?.status ?? null,
				engine_version:   reportRow?.engine_version ?? null,
				updated_at:       reportRow?.updated_at ?? null,
				sections_present: sectionsPresent,
			};

			const recomputePages: RecomputePage[] = nonEmptyRows
				.map((row) => {
					const text_raw = row.page_text ?? "";
					const { text } = normalizeForExtraction(text_raw);
					return { document_id: row.document_id, page_index: row.page_index, text, text_raw };
				})
				.sort((a, b) => {
					const dc = a.document_id.localeCompare(b.document_id);
					return dc !== 0 ? dc : a.page_index - b.page_index;
				});

			const dpuMissingForDeal = dpuRows.length === 0 && documents.length > 0;
			const slots = auditSlotsForDeal({ dpuRows, recomputePages, storedBody: storedSlotBody, dpuMissingForDeal });

			const allFailureTags = slots.map((s) => s.failure_tag).filter((t): t is FailureTag => t !== null);

			const auditStatus: DealAuditResult["audit_status"] =
				!reportRow && documents.length === 0 ? "NOT_FOUND"
				: allFailureTags.length === 0 ? "ok"
				: allFailureTags.some((t) => t === "MISSING_DPU" || t === "BAD_EVIDENCE_REF") ? "failed"
				: "partial";

			const result: DealAuditResult = {
				deal_id:    dealId,
				deal_label: label,
				audit_status: auditStatus,
				error: null,
				documents,
				dpu,
				doc_coverage_diagnostics: buildDocCoverageDiagnostics(documents, dpuRows),
				report,
				slots,
				failure_tags: [...new Set(allFailureTags)],
			};
			return result;
		} catch (err) {
			const result: DealAuditResult = {
				deal_id:    dealId,
				deal_label: label,
				audit_status: "failed",
				error: err instanceof Error ? err.message : String(err),
				documents: [],
				dpu: { total_pages: 0, empty_text_pages: 0, non_empty_pages: 0, avg_text_len: 0, doc_coverage: [] },
				doc_coverage_diagnostics: [],
				report: { present: false, status: null, engine_version: null, updated_at: null, sections_present: [] },
				slots: [],
				failure_tags: ["OTHER"],
			};
			return result;
		}
	});

	const summary             = buildSummary(dealResults);
	const fix_recommendations = buildFixRecommendations(dealResults);

	const tempReport: AuditReport = {
		generated_at: new Date().toISOString(),
		deals: dealResults,
		summary,
		fix_recommendations,
		delta: null,
	};

	const delta = opts.baseline ? computeDelta(opts.baseline, tempReport) : null;

	return { ...tempReport, delta };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 17 — Markdown renderer (all 6 required sections)
// ═══════════════════════════════════════════════════════════════════════

export function printAuditMarkdown(report: AuditReport): string {
	const lines: string[] = [];

	lines.push("# Investor Insights Audit Report");
	lines.push("");
	lines.push(`Generated: ${report.generated_at}`);
	lines.push("");

	// 1) Portfolio Summary
	const s = report.summary;
	lines.push("## Portfolio Summary");
	lines.push("");
	lines.push(`| Metric | Count |`);
	lines.push(`|--------|-------|`);
	lines.push(`| Total deals | ${s.total_deals} |`);
	lines.push(`| OK (no failures) | ${s.deals_ok} |`);
	lines.push(`| Partial | ${s.deals_partial} |`);
	lines.push(`| Failed | ${s.deals_failed} |`);
	lines.push(`| Not Found | ${s.deals_not_found} |`);
	lines.push("");

	// 2) Document Coverage Diagnostics
	lines.push("## Document Coverage Diagnostics");
	lines.push("");
	lines.push(`| Deal | Doc (prefix) | Title | MIME | Pages Meta | DPU Pages | Empty | % Empty | Max Page |`);
	lines.push(`|------|-------------|-------|------|-----------|-----------|-------|---------|---------|`);
	for (const deal of report.deals) {
		if (deal.doc_coverage_diagnostics.length === 0) {
			lines.push(`| ${deal.deal_label} | — | _no docs_ | — | — | — | — | — | — |`);
		} else {
			for (const dc of deal.doc_coverage_diagnostics) {
				lines.push(
					`| ${deal.deal_label} | ${dc.document_id_prefix} | ${esc(dc.title)} | ${dc.mime_type ?? "—"} | ${dc.page_count_meta ?? "—"} | ${dc.dpu_pages_present} | ${dc.empty_text_pages} | ${dc.pct_empty}% | ${dc.max_page_index ?? "—"} |`
				);
			}
		}
	}
	lines.push("");

	// 3) Slot Failure Matrix
	lines.push("## Slot Failure Matrix");
	lines.push("");
	if (s.top_failure_tags.length > 0) {
		lines.push("### Top Failure Categories");
		lines.push("");
		lines.push(`| Category | Deals Affected |`);
		lines.push(`|----------|---------------|`);
		for (const { tag, count } of s.top_failure_tags) {
			lines.push(`| ${tag} | ${count} |`);
		}
		lines.push("");
	}
	if (s.top_missing_slots.length > 0) {
		lines.push("### Top Missing / Not Computable Slots");
		lines.push("");
		lines.push(`| Slot | Not Computable (deals) | False Negatives |`);
		lines.push(`|------|------------------------|-----------------|`);
		for (const { slot, not_computable_count, false_negative_count } of s.top_missing_slots) {
			lines.push(`| ${slot} | ${not_computable_count} | ${false_negative_count} |`);
		}
		lines.push("");
	}

	// 4) Global Holes Rollup
	const allHoles = report.deals.flatMap((d) =>
		d.slots
			.filter((sl) => sl.failure_tag !== null)
			.map((sl) => ({
				deal_label:   d.deal_label,
				slot:         sl.slot,
				category:     sl.failure_tag!,
				evidence_ref: sl.stored_evidence ?? "—",
				snippet:      (sl.stored_value ?? sl.recomputed_value ?? "—").slice(0, 60),
			}))
	);
	if (allHoles.length > 0) {
		lines.push("## Global Holes Rollup");
		lines.push("");
		lines.push(`| Deal | Slot | Category | Evidence Ref | Snippet |`);
		lines.push(`|------|------|----------|--------------|---------|`);
		for (const h of allHoles) {
			lines.push(`| ${h.deal_label} | ${h.slot} | ${h.category} | ${h.evidence_ref} | ${esc(h.snippet)} |`);
		}
		lines.push("");
	}

	// 5) Recommended Fix Classes
	if (report.fix_recommendations.length > 0) {
		lines.push("## Recommended Fix Classes");
		lines.push("");
		lines.push(`| Failure Class | Count | Subsystem | Recommended Action |`);
		lines.push(`|---------------|-------|-----------|--------------------|`);
		for (const r of report.fix_recommendations) {
			lines.push(`| ${r.failure_tag} | ${r.count} | ${r.subsystem} | ${esc(r.action)} |`);
		}
		lines.push("");
	}

	// 6) Changes Since Baseline
	if (report.delta) {
		const d = report.delta;
		lines.push("## Changes Since Baseline");
		lines.push("");
		lines.push(`Baseline generated: ${d.baseline_generated_at}`);
		lines.push(`Current generated:  ${d.current_generated_at}`);
		lines.push("");
		lines.push(`- Failures **reduced**: ${d.failures_reduced}`);
		lines.push(`- Failures **increased**: ${d.failures_increased}`);
		if (d.new_failure_tags.length > 0) {
			lines.push(`- **Newly introduced failure classes**: ${d.new_failure_tags.join(", ")}`);
		}
		lines.push("");
		if (d.tag_deltas.length > 0) {
			lines.push("### Failure Tag Deltas");
			lines.push("");
			lines.push(`| Tag | Baseline | Current | Delta |`);
			lines.push(`|-----|----------|---------|-------|`);
			for (const td of d.tag_deltas) {
				const sign = td.delta > 0 ? "+" : "";
				lines.push(`| ${td.tag} | ${td.baseline_count} | ${td.current_count} | ${sign}${td.delta} |`);
			}
			lines.push("");
		}
		if (d.deals_newly_failing.length > 0) {
			lines.push("### Deals Newly Failing");
			lines.push("");
			for (const df of d.deals_newly_failing) {
				lines.push(`- **${df.deal_label}** (\`${df.deal_id}\`): ${df.new_tags.join(", ")}`);
			}
			lines.push("");
		}
		if (d.deals_newly_ok.length > 0) {
			lines.push("### Deals Newly OK");
			lines.push("");
			for (const dok of d.deals_newly_ok) {
				lines.push(`- **${dok.deal_label}** (\`${dok.deal_id}\`): all failures resolved`);
			}
			lines.push("");
		}
		if (d.slot_deltas.length > 0) {
			lines.push("### Slot Coverage Deltas");
			lines.push("");
			lines.push(`| Slot | Baseline NC | Current NC | Delta |`);
			lines.push(`|------|-------------|------------|-------|`);
			for (const sd of d.slot_deltas) {
				const sign = sd.delta > 0 ? "+" : "";
				lines.push(`| ${sd.slot} | ${sd.baseline_not_computable} | ${sd.current_not_computable} | ${sign}${sd.delta} |`);
			}
			lines.push("");
		}
	}

	// Per-deal sections
	lines.push("## Per-Deal Results");
	lines.push("");

	for (const deal of report.deals) {
		lines.push(`### ${deal.deal_label} (\`${deal.deal_id}\`)`);
		lines.push("");
		lines.push(`**Status**: ${deal.audit_status}${deal.error ? ` — ${deal.error}` : ""}`);
		lines.push("");

		lines.push("#### Documents");
		lines.push("");
		if (deal.documents.length === 0) {
			lines.push("_No documents found._");
		} else {
			lines.push(`| # | ID | Title | Type | MIME | Pages |`);
			lines.push(`|---|-----|-------|------|------|-------|`);
			deal.documents.forEach((doc, i) => {
				lines.push(`| ${i + 1} | ${doc.id.slice(0, 8)} | ${esc(doc.title)} | ${doc.type} | ${doc.mime_type ?? "—"} | ${doc.page_count ?? "—"} |`);
			});
		}
		lines.push("");

		const dp = deal.dpu;
		lines.push("#### DPU Coverage");
		lines.push("");
		lines.push(`Pages: **${dp.total_pages}** total | **${dp.non_empty_pages}** non-empty | **${dp.empty_text_pages}** empty | avg text len: **${dp.avg_text_len}**`);
		if (dp.doc_coverage.length > 0) {
			lines.push("");
			lines.push(`| Document ID (prefix) | Pages Present |`);
			lines.push(`|----------------------|--------------|`);
			for (const dc of dp.doc_coverage) {
				lines.push(`| ${dc.document_id.slice(0, 8)} | ${dc.pages_present} |`);
			}
		}
		lines.push("");

		const r = deal.report;
		lines.push("#### Investor Insights Report");
		lines.push("");
		lines.push(r.present
			? `Status: **${r.status}** | Engine: ${r.engine_version} | Updated: ${r.updated_at}`
			: "_No report found._");
		if (r.sections_present.length > 0) lines.push(`Sections: ${r.sections_present.map((k) => "`" + k + "`").join(", ")}`);
		lines.push("");

		lines.push("#### Insight Slots");
		lines.push("");
		if (deal.slots.length === 0) {
			lines.push("_No slot data (report absent or no DPU pages)._");
		} else {
			lines.push(`| Slot | Stored | Recomputed | Evidence Resolves | Snippet Found | Failure |`);
			lines.push(`|------|--------|------------|-------------------|---------------|---------|`);
			for (const slot of deal.slots) {
				const evOk = slot.validation.evidence_ref_resolves === null ? "—" : slot.validation.evidence_ref_resolves ? "✓" : "✗";
				const snOk = slot.validation.snippet_found_in_page_text === null ? "—" : slot.validation.snippet_found_in_page_text ? "✓" : "✗";
				lines.push(`| ${slot.slot} | ${slot.stored_status} | ${slot.recomputed_status} | ${evOk} | ${snOk} | ${slot.failure_tag ?? "—"} |`);
			}
		}
		lines.push("");

		const holes = deal.slots.filter((sl) => sl.failure_tag !== null);
		if (holes.length > 0) {
			lines.push("#### Holes");
			lines.push("");
			lines.push(`| Slot | Category | Evidence Ref | Value / Notes |`);
			lines.push(`|------|----------|--------------|---------------|`);
			for (const h of holes) {
				const valSnip = h.stored_value ?? h.recomputed_value ?? "—";
				lines.push(`| ${h.slot} | ${h.failure_tag} | ${h.stored_evidence ?? "—"} | ${esc(valSnip.slice(0, 60))}${h.notes ? ` _(${h.notes})_` : ""} |`);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

/** Escape Markdown table cell content. */
function esc(s: string): string {
	return s.replace(/\|/g, "/").replace(/\n/g, " ").trim();
}
