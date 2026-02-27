/**
 * Use-of-Funds Parser V1
 *
 * Parses "Use of Funds / Use of Proceeds / Capital Allocation" spreadsheet tabs
 * from XLSX DPU payloads (excel_range page_type).  Works from
 * payload.structured.rows_preview (the same structured array used by
 * financial-statement-parser.ts).
 *
 * Design rules:
 *   - Pure function: no DB calls, no side-effects
 *   - Conservative: emits null / empty results rather than hallucinating
 *   - Detects header rows by keyword matching, then parses label/amount/pct rows
 *   - Returns schema_version: "use_of_funds_v1" for stable forward-compatibility
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UseOfFundsBucket {
	/** Category label from the spreadsheet row, e.g. "Sales & Marketing" */
	category: string;
	/** Absolute dollar amount, or null if not present */
	amount: number | null;
	/** Percent allocation (0–100), or null if not present */
	percent: number | null;
}

export interface UseOfFundsV1 {
	schema_version: "use_of_funds_v1";
	/**
	 * How this UoF was derived.
	 * - "explicit_table": from a named Use-of-Funds / Allocation table (default when omitted)
	 * - "spend_plan_timeseries": derived by summing monthly spend plan columns
	 */
	basis?: "explicit_table" | "spend_plan_timeseries";
	/**
	 * Human-readable note about basis, e.g. for timeseries: implied language.
	 * May be undefined for explicit tables.
	 */
	basis_note?: string;
	source: {
		document_id: string;
		page_ref: string;
	};
	/** Ordered allocation buckets (row order preserved) */
	buckets: UseOfFundsBucket[];
	/** Sum of all bucket amounts when available */
	total_amount: number | null;
	/** Sum of all bucket percentages (should be ~100 when well-formed) */
	total_percent: number | null;
	diagnostics: {
		header_row_found: boolean;
		parsed_rows: number;
		parse_warnings: string[];
	};
}

// ─── Header keyword detection ─────────────────────────────────────────────────

const UOF_HEADER_PATTERNS = [
	/use\s+of\s+(?:funds|proceeds|capital|raise|investment)/i,
	/allocation\s+of\s+(?:funds|proceeds|capital)/i,
	/capital\s+allocation/i,
	/fund(?:s)?\s+allocation/i,
	/proceeds\s+allocation/i,
	/budget\s+allocation/i,
	/round\s+alloc/i,
	/funding\s+(?:breakdown|plan|use|alloc)/i,
	/investment\s+(?:breakdown|plan|allocation)/i,
	/(?:fund|money|capital|proceeds?|raise)\s+deploy/i,
	/how\s+(?:we\s+(?:will\s+)?use|funds?\s+(?:will\s+be\s+)?used|we\s+plan\s+to\s+use)/i,
	/where\s+(?:the\s+)?(?:money|funds?|capital)\s+(?:goes|will\s+go|is\s+going)/i,
];

/** Category label patterns to use — strings that look like allocation bucket names */
const SKIP_LABELS = new Set([
	"total", "totals", "grand total", "subtotal", "total allocation",
	"total use of funds", "total use of proceeds", "total raise",
	"category", "description", "item", "line item", "allocation",
]);

// ─── Row parser helpers ───────────────────────────────────────────────────────

type RowObject = Record<string, unknown>;

function cellStr(v: unknown): string {
	if (v === null || v === undefined) return "";
	return String(v).trim();
}

function parseNumericCell(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "number") return isFinite(v) ? v : null;
	const s = String(v).replace(/[$,%\s,]/g, "").trim();
	const n = parseFloat(s);
	return isFinite(n) ? n : null;
}

/**
 * Detect if a value looks like a percentage (0–100 range OR literal "%" suffix).
 */
function looksLikePercent(v: unknown): boolean {
	if (v === null || v === undefined) return false;
	if (typeof v === "string" && v.includes("%")) return true;
	const s = String(v).trim();
	if (s.includes("%")) return true;
	const n = parseNumericCell(v);
	if (n === null) return false;
	// Heuristic: if the number column is 0–100 and there's no "$" prefix it's likely a %
	return n >= 0 && n <= 100;
}

/**
 * Extract column keys from a row object, sorted.
 */
function rowCols(row: RowObject): string[] {
	return Object.keys(row).sort();
}

/**
 * Find the "label" column — typically col_A or the leftmost non-null key.
 */
function findLabelCol(row: RowObject): string | null {
	const cols = rowCols(row);
	for (const c of cols) {
		if (typeof row[c] === "string" && (row[c] as string).trim().length > 0) return c;
	}
	return null;
}

/**
 * Detect if a row is a header row for a Use-of-Funds section.
 */
function isUofHeader(row: RowObject): boolean {
	const cols = rowCols(row);
	for (const c of cols) {
		const s = cellStr(row[c]);
		if (UOF_HEADER_PATTERNS.some((p) => p.test(s))) return true;
	}
	return false;
}

/**
 * Detect if a row looks like a "total" summary row.
 */
function isTotalRow(label: string): boolean {
	return SKIP_LABELS.has(label.toLowerCase().trim());
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a use-of-funds table from an excel_range DPU payload.
 *
 * The function attempts to:
 * 1. Guard: verify page_type === "excel_range" and structured.kind === "excel_range"
 * 2. Find a header row via keyword matching
 * 3. From the row AFTER the header, scan for label + amount/percent columns
 * 4. Emit buckets until a blank row or end of data
 *
 * Returns null when:
 *   - payload is not an excel_range page
 *   - no UoF header is found
 *   - fewer than 1 bucket is parsed
 */
export function parseUseOfFundsV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string }
): UseOfFundsV1 | null {
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;

	if (p["page_type"] !== "excel_range") return null;
	const structured = p["structured"];
	if (!structured || typeof structured !== "object") return null;
	const s = structured as Record<string, unknown>;
	if (s["kind"] !== "excel_range") return null;

	const rowsPreview = s["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	const rows = rowsPreview as RowObject[];
	const warnings: string[] = [];

	// ── 0. Check segment_key signal ───────────────────────────────────────────
	// If the Python extractor already classified this sheet as a Use-of-Funds sheet
	// via _detect_segment_key, trust that signal.  The title row ("Use of Funds") is
	// often chosen as best_hr and therefore excluded from rows_preview, so we cannot
	// rely solely on finding a UoF keyword inside rows_preview.
	const segmentKeyIsUof = s["segment_key"] === "use_of_funds";

	// ── 1. Find the UoF header row ────────────────────────────────────────────
	// When segment_key signals UoF, only scan up to 5 rows (faster + avoids false hits
	// in data rows that happen to contain words like "funds").
	let headerIdx = -1;
	const headerScanLimit = segmentKeyIsUof ? Math.min(rows.length, 5) : rows.length;
	for (let i = 0; i < headerScanLimit; i++) {
		if (isUofHeader(rows[i]!)) {
			headerIdx = i;
			break;
		}
	}

	// headerRowFound is true when:
	//   a) an explicit UoF header keyword is present in rows_preview, OR
	//   b) segment_key already classified the sheet as use_of_funds upstream
	const headerRowFound = headerIdx >= 0 || segmentKeyIsUof;

	// Require an explicit header row OR segment_key signal — fall-through without
	// either risks false positives on income-statement tabs.
	if (!headerRowFound) return null;

	// When the title row was excluded from rows_preview (it was best_hr), start from 0.
	const parseFromIdx = headerIdx >= 0 ? headerIdx + 1 : 0;

	// ── 2. Determine which columns carry amounts vs percents ──────────────────
	let amountCol: string | null = null;
	let percentCol: string | null = null;

	// A. Use structured.headers names directly (most reliable: keys in rows_preview
	//    match the headers array, so e.g. "Amount ($)" → amountCol = "Amount ($)").
	const structuredHeaders: string[] = Array.isArray(s["headers"])
		? (s["headers"] as unknown[]).map((h) => cellStr(h as unknown))
		: [];
	for (const hdr of structuredHeaders) {
		const hl = hdr.toLowerCase();
		if (
			!amountCol &&
			(hl.includes("amount") || hl.includes("$") || hl.includes("fund") ||
				hl.includes("raise") || hl === "cost" || hl === "value" || hl === "budget")
		) {
			amountCol = hdr;
		} else if (
			!percentCol &&
			(hl.includes("%") || hl.includes("percent") || hl.includes("alloc") ||
				hl.includes("share") || hl === "pct" || hl === "ratio")
		) {
			percentCol = hdr;
		}
	}

	// B. Scan sample row values for column-semantic signals (covers col_A/col_B style).
	const sampleRows = rows.slice(parseFromIdx, parseFromIdx + 5);
	if (!amountCol && !percentCol) {
		for (const sr of sampleRows) {
			const sampleLabelCol = findLabelCol(sr);
			const cols = rowCols(sr).filter((c) => c !== sampleLabelCol);
			if (cols.length === 0) continue;
			for (const col of cols) {
				const v = sr[col];
				if (v === null || v === undefined || v === "") continue;
				const s = cellStr(v);
				const sl = s.toLowerCase();
				if (s.includes("$") || sl.includes("amount") || sl.includes("fund") || sl.includes("raise")) {
					if (!amountCol) amountCol = col;
				} else if (s.includes("%") || sl.includes("percent") || sl.includes("allocation")) {
					if (!percentCol) percentCol = col;
				}
			}
			if (amountCol || percentCol) break;
		}
	}

	// If we still haven't identified columns, try heuristics on numeric values
	if (!amountCol && !percentCol) {
		const numericCols: Map<string, number[]> = new Map();
		for (const sr of sampleRows) {
			const sampleLabelCol = findLabelCol(sr);
			for (const [col, val] of Object.entries(sr)) {
				if (col === sampleLabelCol) continue;
				const n = parseNumericCell(val);
				if (n === null) continue;
				const arr = numericCols.get(col) ?? [];
				arr.push(n);
				numericCols.set(col, arr);
			}
		}
		// Column with values > 100 is likely amount; column with values 0–100 is percent
		for (const [col, vals] of numericCols) {
			const maxVal = Math.max(...vals);
			if (maxVal > 100 && !amountCol) amountCol = col;
			else if (maxVal <= 100 && !percentCol) percentCol = col;
		}
	}

	// ── 3. Parse allocation buckets ───────────────────────────────────────────
	const buckets: UseOfFundsBucket[] = [];
	let totalAmount = 0;
	let hasTotalAmount = false;
	let totalPercent = 0;
	let hasTotalPercent = false;

	for (let i = parseFromIdx; i < rows.length; i++) {
		const row = rows[i]!;
		const labelCol = findLabelCol(row);
		if (!labelCol) continue;
		const label = cellStr(row[labelCol]);
		if (!label || label.length < 2) continue;
		if (isTotalRow(label)) continue;

		// Stop at a second header row or a blank label
		if (UOF_HEADER_PATTERNS.some((p) => p.test(label))) break;

		let amount: number | null = null;
		let percent: number | null = null;

		// Try identified columns first
		if (amountCol && row[amountCol] !== null && row[amountCol] !== undefined) {
			amount = parseNumericCell(row[amountCol]);
		}
		if (percentCol && row[percentCol] !== null && row[percentCol] !== undefined) {
			const rawPct = row[percentCol];
			const n = parseNumericCell(rawPct);
			if (n !== null) {
				percent = looksLikePercent(rawPct) && n <= 100 ? n : null;
			}
		}

		// Fallback: scan all non-label columns for any remaining null values
		if (amount === null) {
			const cols = rowCols(row).filter((c) => c !== labelCol);
			for (const col of cols) {
				const v = row[col];
				if (v === null || v === undefined) continue;
				const n = parseNumericCell(v);
				if (n === null) continue;
				if (looksLikePercent(v) && n <= 100 && percent === null) {
					percent = n;
				} else if (n > 100 && amount === null) {
					amount = n;
				} else if (n <= 100 && percent === null) {
					// Ambiguous — treat as percent if no amount-sized value seen yet
					percent = n;
				}
			}
		}

		if (amount !== null || percent !== null) {
			buckets.push({ category: label, amount, percent });
			if (amount !== null) { totalAmount += amount; hasTotalAmount = true; }
			if (percent !== null) { totalPercent += percent; hasTotalPercent = true; }
		}
	}

	if (buckets.length === 0) return null;

	// Warn when totals look suspicious
	if (hasTotalPercent && Math.abs(totalPercent - 100) > 5) {
		warnings.push(`percent_sum_unexpected: ${totalPercent.toFixed(1)}`);
	}

	return {
		schema_version: "use_of_funds_v1",
		source: { document_id: source.documentId, page_ref: source.pageRef },
		buckets,
		total_amount: hasTotalAmount ? Number(totalAmount.toFixed(2)) : null,
		total_percent: hasTotalPercent ? Number(totalPercent.toFixed(1)) : null,
		diagnostics: {
			header_row_found: headerRowFound,
			parsed_rows: buckets.length,
			parse_warnings: warnings,
		},
	};
}

/**
 * Select the best Use-of-Funds statement from a list.
 * Preference: most buckets → has total_amount → has total_percent.
 */
export function pickBestUseOfFunds(stmts: UseOfFundsV1[]): UseOfFundsV1 | null {
	if (stmts.length === 0) return null;
	return stmts.reduce((best, curr) => {
		if (curr.buckets.length > best.buckets.length) return curr;
		if (curr.buckets.length === best.buckets.length) {
			if (curr.total_amount !== null && best.total_amount === null) return curr;
			if (curr.total_percent !== null && best.total_percent === null) return curr;
		}
		return best;
	});
}
