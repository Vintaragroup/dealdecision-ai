/**
 * use-of-funds-timeseries-v1.ts
 *
 * Parses a monthly spend-plan ("Allocation of Funds" or "Use of Funds") from
 * an excel_sheet DPU page whose data lives in page_text (pipe-delimited row
 * format written by structured_native_v1).
 *
 * Produces a UseOfFundsV1 object with basis="spend_plan_timeseries" so it
 * integrates naturally with pickBestUseOfFunds() and the existing UoF slot.
 */

import type { UseOfFundsV1, UseOfFundsBucket } from "./use-of-funds-parser-v1";

// ---------------------------------------------------------------------------
// Sheet title detection
// ---------------------------------------------------------------------------

const SHEET_TITLE_PATTERNS: RegExp[] = [
	/alloc(?:ation)?\s+of\s+funds?/i,
	/valuation.*alloc/i,
	/use\s+of\s+funds?/i,
	/spend\s+plan/i,
	/capital\s+alloc/i,
];

function isAllocationSheet(sheetTitle: string): boolean {
	return SHEET_TITLE_PATTERNS.some((re) => re.test(sheetTitle));
}

// ---------------------------------------------------------------------------
// Label-to-bucket mapping
// ---------------------------------------------------------------------------

interface BucketRule {
	patterns: RegExp[];
	bucket: string;
}

const BUCKET_RULES: BucketRule[] = [
	{
		patterns: [/^sales\s*\d*$/i, /^business\s+dev/i, /^revenue\s+gen/i],
		bucket: "Sales",
	},
	{
		patterns: [
			/^design$/i,
			/^engineer/i,
			/^product\s+dev/i,
			/^R\s*&\s*D/i,
			/^technology/i,
			/^dev(elopment)?$/i,
		],
		bucket: "Engineering / Product",
	},
	{
		patterns: [
			/^marketing/i,
			/campaigns?/i,
			/^advertising/i,
			/^brand/i,
			/^growth/i,
			/relax\s+campaigns?/i,
			/mw\s+campaigns?/i,
		],
		bucket: "Marketing",
	},
	{
		patterns: [
			/^data\s/i,
			/mls\s+feed/i,
			/^retr$/i,
			/property\s+boundar/i,
			/property\s+data/i,
			/infra(structure)?/i,
			/^cloud/i,
			/^hosting/i,
			/^server/i,
			/^aws/i,
			/^azure/i,
			/saas\s+tools?/i,
		],
		bucket: "Data / Infrastructure",
	},
	{
		patterns: [
			/^operations?\s*\d*$/i,
			/strategic\s+rel/i,
			/^g\s*&\s*a/i,
			/general\s+&?\s*admin/i,
			/^admin/i,
			/^hr\s/i,
			/payroll\s+ops/i,
			/office/i,
		],
		bucket: "G&A / Operations",
	},
	{
		patterns: [
			/^legal/i,
			/^compliance/i,
			/^accounting/i,
			/^finance$/i,
			/^audit/i,
			/^tax/i,
		],
		bucket: "Legal / Finance",
	},
	{
		patterns: [
			/^expenses?\s+fixed/i,
			/^fixed\s+costs?/i,
			/^fixed\s+expenses?/i,
			/^overhead/i,
		],
		bucket: "Fixed Operations",
	},
	{
		patterns: [/^expenses?\s+variable/i, /^variable\s+costs?/i],
		bucket: "Variable Operations",
	},
];

/** Labels that are section headers with no financial data — always skip. */
const GROUP_HEADER_LABELS: RegExp[] = [
	/^payroll$/i,
	/^data\s+costs?$/i,
	/^marketing$/i,
	/^expenses?\s+variable$/i,
	/^variable\s+costs?$/i,
	/^salaries?$/i,
	/^staff$/i,
	/^headcount$/i,
	/^personnel$/i,
];

/** "Total" / subtotal row labels — skip. */
const SUBTOTAL_LABELS: RegExp[] = [
	/^total$/i,
	/^sub[\s-]?total/i,
	/^grand\s+total/i,
];

function mapLabelToBucket(label: string): string | null {
	const trimmed = label.trim();

	// Exact group-header skip
	if (GROUP_HEADER_LABELS.some((re) => re.test(trimmed))) return null;
	// Subtotal skip
	if (SUBTOTAL_LABELS.some((re) => re.test(trimmed))) return null;

	for (const rule of BUCKET_RULES) {
		if (rule.patterns.some((re) => re.test(trimmed))) {
			return rule.bucket;
		}
	}

	// Fallback: non-empty label → "Other"
	return trimmed.length > 0 ? "Other" : null;
}

// ---------------------------------------------------------------------------
// page_text row parser
// follows the same "- row_n: label | val1 | val2 | ..." format as
// implied-capital-allocation-v1.ts
// ---------------------------------------------------------------------------

interface ParsedTextRow {
	rowIndex: number;
	label: string;
	/** All pipe-delimited cell values after the label */
	cells: string[];
}

const ROW_LINE_RE = /^-\s*row_(\d+):\s*(.+)$/;

function parsePageTextRows(pageText: string): ParsedTextRow[] {
	const results: ParsedTextRow[] = [];
	for (const line of pageText.split("\n")) {
		const m = line.match(ROW_LINE_RE);
		if (!m) continue;
		const rowIndex = parseInt(m[1], 10);
		const parts = m[2].split("|").map((s) => s.trim());
		const label = parts[0] ?? "";
		const cells = parts.slice(1);
		results.push({ rowIndex, label, cells });
	}
	return results;
}

// ---------------------------------------------------------------------------
// Dollar value extraction
// ---------------------------------------------------------------------------

/** Returns the numeric value of a dollar string like "$32,000.00" or "32000" */
function parseDollarValue(cell: string): number | null {
	const cleaned = cell.replace(/[$,\s]/g, "");
	const n = parseFloat(cleaned);
	return isNaN(n) ? null : n;
}

/** Returns true if cell looks like a month name or "Month N" header */
function isMonthCell(cell: string): boolean {
	return /^(January|February|March|April|May|June|July|August|September|October|November|December|Month\s+\d+)$/i.test(
		cell.trim()
	);
}

/** Returns true if cell looks like a "Year N Total" header */
function isYearTotalCell(cell: string): boolean {
	return /Year\s*\d+\s*Total/i.test(cell.trim());
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface ParseUseOfFundsTimeseriesOptions {
	documentId: string;
	pageRef: string;
}

/**
 * Parse a monthly spend-plan page into a UseOfFundsV1 structure.
 *
 * Returns null when:
 * - page_type is not "excel_sheet"
 * - sheet title does not match an allocation pattern
 * - fewer than 3 rows with nonzero sums are found
 * - total spend is 0
 * - parse_quality < 0.5
 */
export function parseUseOfFundsTimeseriesV1(
	payload: unknown,
	opts: ParseUseOfFundsTimeseriesOptions
): UseOfFundsV1 | null {
	if (!payload || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;

	// Must be an excel_sheet page (not excel_range)
	if (p["page_type"] !== "excel_sheet") return null;

	// Sheet title must match an allocation pattern
	const rawSheetTitle =
		typeof p["sheet_name"] === "string"
			? p["sheet_name"]
			: typeof p["page_title"] === "string"
				? p["page_title"]
				: "";
	// Also check page_text header for "Sheet: <name>"
	const pageText = typeof p["page_text"] === "string" ? p["page_text"] : "";
	const sheetHeaderMatch = pageText.match(/^Sheet:\s*(.+)/im);
	const sheetTitle = rawSheetTitle || (sheetHeaderMatch ? sheetHeaderMatch[1].trim() : "");

	if (!isAllocationSheet(sheetTitle)) return null;

	const textRows = parsePageTextRows(pageText);
	if (textRows.length === 0) return null;

	// -----------------------------------------------------------------------
	// Identify header row — the first row whose cells contain month-like values
	// -----------------------------------------------------------------------
	let headerRowIndex = -1;
	let yearTotalColOffset = -1; // 0-based offset within cells[] for "Year N Total"
	let monthCount = 0;

	for (let i = 0; i < textRows.length; i++) {
		const row = textRows[i];
		const monthCells = row.cells.filter((c) => isMonthCell(c));
		if (monthCells.length >= 3) {
			headerRowIndex = i;
			monthCount = monthCells.length;
			// Find "Year N Total" column
			const ytIdx = row.cells.findIndex((c) => isYearTotalCell(c));
			if (ytIdx !== -1) yearTotalColOffset = ytIdx;
			break;
		}
	}

	const warnings: string[] = [];
	if (headerRowIndex === -1) {
		// No explicit month header found; we'll treat all numeric cells as values
		warnings.push("no_month_header_detected");
	}

	// -----------------------------------------------------------------------
	// Parse data rows
	// -----------------------------------------------------------------------

	const bucketAccum: Map<string, number> = new Map();
	let parsedRows = 0;

	for (let i = headerRowIndex + 1; i < textRows.length; i++) {
		const row = textRows[i];
		if (!row.label) continue;

		const bucket = mapLabelToBucket(row.label);
		if (bucket === null) continue; // group header or subtotal — skip

		// If we have a Year Total column, prefer that single value
		let rowSum = 0;
		if (yearTotalColOffset !== -1 && row.cells[yearTotalColOffset] !== undefined) {
			const v = parseDollarValue(row.cells[yearTotalColOffset]);
			if (v !== null && v > 0) {
				rowSum = v;
			}
		}

		// Otherwise sum all numeric cells (exclude header-like cells and zero-only)
		if (rowSum === 0) {
			for (const cell of row.cells) {
				const v = parseDollarValue(cell);
				if (v !== null) rowSum += v;
			}
		}

		if (rowSum === 0) {
			// All zeros — could be an unpopulated line item; skip for quality
			continue;
		}

		parsedRows++;
		bucketAccum.set(bucket, (bucketAccum.get(bucket) ?? 0) + rowSum);
	}

	// -----------------------------------------------------------------------
	// Quality gate
	// -----------------------------------------------------------------------

	const nonzeroBuckets = bucketAccum.size;
	const totalAmount = Array.from(bucketAccum.values()).reduce((a, b) => a + b, 0);

	if (nonzeroBuckets < 3 || totalAmount <= 0) return null;

	const parseQuality = Math.min(1, parsedRows / Math.max(1, nonzeroBuckets + 2));
	if (parseQuality < 0.5) {
		warnings.push("parse_quality_too_low");
		return null;
	}

	// -----------------------------------------------------------------------
	// Build output
	// -----------------------------------------------------------------------

	const buckets: UseOfFundsBucket[] = Array.from(bucketAccum.entries()).map(
		([label, amount]) => ({
			category: label,
			amount,
			percent: totalAmount > 0 ? Math.round((amount / totalAmount) * 1000) / 10 : null,
		})
	);

	// Sort descending by amount
	buckets.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

	const basisNote = `IMPLIED from monthly spend plan "${sheetTitle}": ${monthCount > 0 ? monthCount + " months" : "months"} summed across ${parsedRows} line items`;

	return {
		schema_version: "use_of_funds_v1",
		basis: "spend_plan_timeseries",
		basis_note: basisNote,
		source: {
			document_id: opts.documentId,
			page_ref: opts.pageRef,
		},
		buckets,
		total_amount: totalAmount,
		total_percent: buckets.reduce((s, b) => s + (b.percent ?? 0), 0),
		diagnostics: {
			header_row_found: headerRowIndex !== -1,
			parsed_rows: parsedRows,
			parse_warnings: warnings,
		},
	};
}
