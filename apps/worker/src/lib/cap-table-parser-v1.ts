/**
 * Cap Table Parser V1
 *
 * Deterministically parses Cap Table / Capitalization Schedule / Ownership Table
 * data from XLSX DPU payloads (excel_range page_type with rows_preview).
 *
 * Extracted rows (stakeholder entries):
 *   - name:   col_A label
 *   - shares: numeric cell (first data column matching share-like integer)
 *   - pct:    numeric cell matching 0–100 range with % formatting cue
 *
 * Aggregate outputs:
 *   - option_pool_pct     (row labelled "option pool" or "ESOP" / "equity pool")
 *   - total_shares        (aggregated from "total" / "grand total" rows)
 *   - post_money_valuation (if present in header or summary rows)
 *   - safe_notes_present  (boolean: any rows mention SAFEs / convertible notes)
 *
 * Design rules: conservative — never fabricates missing fields.
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CapTableStakeholder {
	name:   string;
	shares: number | null;
	pct:    number | null;
	/** Row type: "common", "preferred", "option_pool", "safe_note", "total", "other" */
	row_type: "common" | "preferred" | "option_pool" | "safe_note" | "total" | "other";
}

export interface CapTableV1 {
	schema_version: "cap_table_v1";
	source: {
		document_id: string;
		page_ref:    string;
	};
	stakeholders:        CapTableStakeholder[];
	option_pool_pct:     number | null;
	total_shares:        number | null;
	/**
	 * Fully-diluted post-money share count.
	 * Parsed from rows labelled "Post-Money Shares" / "Fully Diluted Shares";
	 * falls back to total_shares when no explicit row found.
	 */
	post_money_shares:   number | null;
	total_pct:           number | null;
	post_money_valuation: number | null;
	safe_notes_present:  boolean;
	diagnostics: {
		parsed_rows:    number;
		parse_warnings: string[];
	};
}

// ─── Row type classifiers ─────────────────────────────────────────────────────

const ROW_TYPE_PATTERNS: Array<{ pattern: RegExp; type: CapTableStakeholder["row_type"] }> = [
	{ pattern: /option\s+pool|esop|equity\s+pool|unissued\s+options?|reserve/i, type: "option_pool" },
	{ pattern: /\bsafe\b|convertible\s+note|promissory\s+note/i,                type: "safe_note" },
	{ pattern: /preferred\s+(?:stock|shares?)|series\s+[a-zA-Z0-9]+/i,          type: "preferred" },
	{ pattern: /^(?:total|grand\s+total|totals?)$/i,                             type: "total" },
	{ pattern: /common\s+(?:stock|shares?)|founder|employee|management|vested/i, type: "common" },
];

function classifyRowType(label: string): CapTableStakeholder["row_type"] {
	const t = label.trim();
	for (const { pattern, type } of ROW_TYPE_PATTERNS) {
		if (pattern.test(t)) return type;
	}
	return "other";
}

// ─── Column analysers ─────────────────────────────────────────────────────────

type RowObject = Record<string, unknown>;

function cellStr(v: unknown): string {
	return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * Clean OCR artifacts in numeric strings.
 * Handles common OCR substitutions: letter-O → digit-0 in numeric contexts.
 * E.g. "0.O5%" → "0.05%", "5O%" → "50%", "1OO,000" → "100,000".
 */
function fixOcrArtifacts(s: string): string {
	// Replace letter-O with digit-0 when it is adjacent to numeric
	// characters (digits, decimal point, comma, or percent sign).
	return s.replace(/(?<=[0-9,.$])O|O(?=[0-9,.%])/g, "0");
}

/**
 * Extract a share count guess from a cell value.
 * Shares tend to be large integers with no decimal or % suffix.
 */
function parseSharesValue(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const s = fixOcrArtifacts(String(v).replace(/[$,\s]/g, "").trim());
	if (s.endsWith("%")) return null; // skip percent cells
	const n = Number(s);
	return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : null;
}

/**
 * Extract a percentage from a cell value.
 * Accepts "47.5%", 0.475 (fraction form), 47.5.
 */
function parsePctValue(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const s = fixOcrArtifacts(String(v).trim());
	if (s.endsWith("%")) {
		const n = Number(s.slice(0, -1).replace(/,/g, ""));
		return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
	}
	const n = Number(s.replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	// Fraction form (0–1) → convert to percentage
	if (n >= 0 && n <= 1) return Math.round(n * 1000) / 10;
	// Already a percentage
	if (n >= 0 && n <= 100) return Math.round(n * 10) / 10;
	return null;
}

/**
 * Heuristic: given all non-label cells in a row, find the likely shares
 * column (large integer) and the likely pct column (0–100 or fraction).
 */
function extractSharesAndPct(row: RowObject): { shares: number | null; pct: number | null } {
	const entries = Object.entries(row)
		.filter(([k]) => k !== "col_A" && k !== "col_B")
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));

	let shares: number | null = null;
	let pct: number | null = null;

	for (const [, v] of entries) {
		if (pct === null) {
			const p = parsePctValue(v);
			if (p !== null) { pct = p; continue; }
		}
		if (shares === null) {
			const s = parseSharesValue(v);
			if (s !== null) { shares = s; }
		}
	}
	return { shares, pct };
}

/**
 * Extract a post-money valuation hint from a cell value ($M / $B notation).
 */
function extractValuation(row: RowObject): number | null {
	for (const [k, v] of Object.entries(row)) {
		if (k === "col_A") continue;
		const s = String(v ?? "").trim().replace(/[$,\s]/g, "");
		// Accept $XM or $XB formats
		const mB = s.match(/^([\d.]+)([MBmb])$/);
		if (mB) {
			const n = Number(mB[1]);
			const mult = /[Bb]/.test(mB[2]!) ? 1_000_000_000 : 1_000_000;
			if (Number.isFinite(n)) return n * mult;
		}
		const plain = Number(s);
		if (Number.isFinite(plain) && plain > 1_000_000) return plain;
	}
	return null;
}

const SKIP_LABELS = new Set(["category", "name", "shareholder", "stakeholder", "investor", "entity", ""]);
const VALUATION_HEADER_RE       = /post[- ]money\s+valuation?|post[- ]money|post\s+money\s+val/i;
/** Matches rows that explicitly declare post-money / fully-diluted share count. */
const POST_MONEY_SHARES_HEADER_RE = /post[- ]money\s+shares?|fully[- ]diluted\s+shares?|total\s+shares?\s+(?:outstanding|issued|fully\s+diluted)/i;

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseCapTableV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): CapTableV1 | null {
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;
	if (p["page_type"] !== "excel_range") return null;

	const structured = p["structured"] as Record<string, unknown> | null | undefined;
	if (!structured || structured["kind"] !== "excel_range") return null;

	const rowsPreview = structured["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	const stakeholders: CapTableStakeholder[] = [];
	const parseWarnings: string[] = [];
	let safeNotesPresent = false;
	let totalShares: number | null = null;
	let postMoneySharesExplicit: number | null = null;
	let totalPct: number | null = null;
	let postMoneyValuation: number | null = null;

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as RowObject;
		const label = typeof row["col_A"] === "string" ? row["col_A"].trim() : "";
		if (!label || SKIP_LABELS.has(label.toLowerCase())) continue;

		// Check for post-money valuation hint in label
		if (VALUATION_HEADER_RE.test(label) && postMoneyValuation === null) {
			const val = extractValuation(row);
			if (val !== null) { postMoneyValuation = val; continue; }
		}

		// Check for explicit post-money / fully-diluted share count row
		if (POST_MONEY_SHARES_HEADER_RE.test(label) && postMoneySharesExplicit === null) {
			const { shares: pmShares } = extractSharesAndPct(row);
			if (pmShares !== null) { postMoneySharesExplicit = pmShares; continue; }
		}

		const rowType = classifyRowType(label);
		const { shares, pct } = extractSharesAndPct(row);

		// If no numeric data at all, skip
		if (shares === null && pct === null) continue;

		if (rowType === "safe_note") safeNotesPresent = true;

		if (rowType === "total") {
			if (shares !== null) totalShares = shares;
			if (pct !== null)    totalPct    = pct;
			continue; // don't add total rows to stakeholders array
		}

		stakeholders.push({ name: label, shares, pct, row_type: rowType });
	}

	if (stakeholders.length === 0) return null;

	const optionPoolRow = stakeholders.find((s) => s.row_type === "option_pool");
	const optionPoolPct = optionPoolRow?.pct ?? null;

	// If total_pct not explicitly found, try to sum from stakeholders
	if (totalPct === null) {
		const sumPct = stakeholders.reduce((acc, s) => (s.pct !== null ? acc + s.pct : acc), 0);
		if (sumPct > 0) totalPct = Math.round(sumPct * 10) / 10;
	}

	return {
		schema_version:       "cap_table_v1",
		source:               { document_id: source.documentId, page_ref: source.pageRef },
		stakeholders,
		option_pool_pct:      optionPoolPct,
		total_shares:         totalShares,
		post_money_shares:    postMoneySharesExplicit ?? totalShares,
		total_pct:            totalPct,
		post_money_valuation: postMoneyValuation,
		safe_notes_present:   safeNotesPresent,
		diagnostics: {
			parsed_rows:    stakeholders.length,
			parse_warnings: parseWarnings,
		},
	};
}

export function pickBestCapTable(tables: CapTableV1[]): CapTableV1 | null {
	if (tables.length === 0) return null;
	return tables.reduce((best, curr) => {
		if (curr.diagnostics.parsed_rows > best.diagnostics.parsed_rows) return curr;
		return best;
	});
}
