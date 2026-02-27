/**
 * implied-capital-income-statement-v1.ts
 *
 * Attempts to derive a capital allocation breakdown from an income-statement
 * excel_range page (rows_preview format).  Returns null when the page does not
 * contain at least 3 individual expense category line items.
 *
 * When non-null, produces an IncomeStatementAllocationV1 stored as
 * InsightSlotInputs.impliedFromIncomeStatement, fed into the 3rd-level
 * fallback of evalUseOfFundsSlot() with reason DERIVED_FROM_INCOME_STATEMENT.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncomeStatementBucket {
	category: string;
	annual_amount: number;
	pct_of_total: number;
	column_key: string;
}

export interface IncomeStatementAllocationV1 {
	schema_version: "income_statement_allocation_v1";
	basis: "income_statement";
	basis_note: string;
	source: {
		document_id: string;
		page_ref: string;
	};
	period_label: string;
	buckets: IncomeStatementBucket[];
	total_annual_amount: number;
	diagnostics: {
		expense_rows_parsed: number;
		nonzero_rows: number;
		parse_warnings: string[];
	};
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const IS_REVENUE_TOTAL_RE = /total\s+rev(enues?)?/i;
const IS_EXPENSE_TOTAL_RE = /total\s+exp(enses?)?/i;
const IS_INCOME_STATEMENT_TITLE_RE =
	/income\s+statement|pro[\s-]?forma|profit\s+&?\s*loss|p\s*&\s*l/i;

const SKIP_LABEL_RES: RegExp[] = [
	/^total\b/i,
	/^sub[\s-]?total/i,
	/^grand\s+total/i,
	/^gross\s+profit/i,
	/^operating\s+(income|loss)/i,
	/^net\s+(income|loss|profit)/i,
	/^ebit(da)?$/i,
	/^revenue/i,
	/^summary/i,
	/^section/i,
	/^\s*$/,
];

// ---------------------------------------------------------------------------
// Bucket mapping
// ---------------------------------------------------------------------------

interface BucketRule {
	patterns: RegExp[];
	bucket: string;
}

const EXPENSE_BUCKET_RULES: BucketRule[] = [
	{
		patterns: [/payroll/i, /salary|salaries/i, /wages/i, /compensation/i],
		bucket: "Payroll",
	},
	{
		patterns: [/marketing/i, /advertising/i, /campaigns?/i, /brand/i, /growth/i],
		bucket: "Marketing",
	},
	{
		patterns: [
			/technology/i,
			/software/i,
			/saas/i,
			/infra(structure)?/i,
			/hosting/i,
			/cloud/i,
			/engineering/i,
		],
		bucket: "Technology",
	},
	{
		patterns: [/legal/i, /compliance/i, /regulatory/i, /licensing/i],
		bucket: "Legal",
	},
	{
		patterns: [
			/g\s*&\s*a/i,
			/general\s+&?\s*admin/i,
			/admin/i,
			/office/i,
			/facilities/i,
			/rent/i,
		],
		bucket: "G&A",
	},
	{
		patterns: [/sales/i, /business\s+dev/i, /\bbd\b/i],
		bucket: "Sales",
	},
	{
		patterns: [/research/i, /r\s*&\s*d/i, /\bdevelopment\b/i],
		bucket: "R&D",
	},
	{
		patterns: [/customer\s+success/i, /\bsupport\b/i],
		bucket: "Customer Success",
	},
	{
		patterns: [/depreciation/i, /amortization/i],
		bucket: "Depreciation",
	},
];

function mapExpenseLabelToBucket(label: string): string | null {
	const trimmed = label.trim();
	if (SKIP_LABEL_RES.some((re) => re.test(trimmed))) return null;
	for (const rule of EXPENSE_BUCKET_RULES) {
		if (rule.patterns.some((re) => re.test(trimmed))) return rule.bucket;
	}
	return trimmed.length > 0 ? "Other" : null;
}

// ---------------------------------------------------------------------------
// Row value extraction
// ---------------------------------------------------------------------------

function extractFirstYearValue(
	row: Record<string, unknown>
): { val: number; columnKey: string } | null {
	const candidates: Array<{ key: string; val: number }> = [];
	for (const [key, raw] of Object.entries(row)) {
		if (key === "label") continue;
		if (typeof raw === "number" && !isNaN(raw) && raw !== 0) {
			candidates.push({ key, val: raw });
		} else if (typeof raw === "string") {
			const cleaned = raw.replace(/[$,\s]/g, "");
			const n = parseFloat(cleaned);
			if (!isNaN(n) && n !== 0) candidates.push({ key, val: n });
		}
	}
	if (candidates.length === 0) return null;

	// Prefer earliest year column
	const yearKeys = candidates
		.filter((c) => /^20\d{2}$/.test(c.key))
		.sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10));
	if (yearKeys.length > 0) return { val: yearKeys[0].val, columnKey: yearKeys[0].key };

	// col_1 / year_1 style
	const col1 = candidates.find((c) => /col_1|year_1|yr_1/i.test(c.key));
	if (col1) return { val: col1.val, columnKey: col1.key };

	return { val: candidates[0].val, columnKey: candidates[0].key };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface ParseIncomeStatementOptions {
	documentId: string;
	pageRef: string;
}

/**
 * Parse expense-category line items from an income-statement excel_range page.
 *
 * Returns null when:
 * - page_type is not "excel_range"
 * - no income-statement title or boundary signals detected
 * - fewer than 3 individual expense categories with nonzero values found
 */
export function parseImpliedCapitalIncomeStatementV1(
	payload: unknown,
	opts: ParseIncomeStatementOptions
): IncomeStatementAllocationV1 | null {
	if (!payload || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;

	if (p["page_type"] !== "excel_range") return null;

	const rowsPreview = p["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	const allLabels: string[] = rowsPreview
		.map((r: unknown) => {
			if (r && typeof r === "object" && "label" in r) {
				const l = (r as Record<string, unknown>)["label"];
				return typeof l === "string" ? l : "";
			}
			return "";
		})
		.filter(Boolean);

	const hasTitle = allLabels.some((l) => IS_INCOME_STATEMENT_TITLE_RE.test(l));
	const hasExpenseTotal = allLabels.some((l) => IS_EXPENSE_TOTAL_RE.test(l));
	if (!hasTitle && !hasExpenseTotal) return null;

	// Walk rows; enter expense section after "Total Revenues" boundary
	let inExpenseSection = !allLabels.some((l) => IS_REVENUE_TOTAL_RE.test(l));
	let expenseSectionEnded = false;

	const bucketAccum: Map<string, { total: number; columnKey: string }> = new Map();
	let expenseRowsParsed = 0;
	let nonzeroRows = 0;
	const warnings: string[] = [];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object") continue;
		const row = rawRow as Record<string, unknown>;
		const label = typeof row["label"] === "string" ? row["label"].trim() : "";
		if (!label) continue;

		if (IS_REVENUE_TOTAL_RE.test(label)) {
			inExpenseSection = true;
			continue;
		}
		if (IS_EXPENSE_TOTAL_RE.test(label)) {
			expenseSectionEnded = true;
			inExpenseSection = false;
			continue;
		}
		if (!inExpenseSection || expenseSectionEnded) continue;

		const bucket = mapExpenseLabelToBucket(label);
		if (bucket === null) continue;

		expenseRowsParsed++;
		const extracted = extractFirstYearValue(row);
		if (extracted === null || extracted.val <= 0) continue;

		nonzeroRows++;
		const existing = bucketAccum.get(bucket);
		bucketAccum.set(bucket, {
			total: (existing?.total ?? 0) + extracted.val,
			columnKey: existing?.columnKey ?? extracted.columnKey,
		});
	}

	// Quality gate
	if (bucketAccum.size < 3 || nonzeroRows < 3) return null;

	const totalAmount = Array.from(bucketAccum.values()).reduce((s, v) => s + v.total, 0);
	if (totalAmount <= 0) return null;

	const sampleColKey = Array.from(bucketAccum.values())[0].columnKey;
	const periodLabel = /^20\d{2}$/.test(sampleColKey)
		? sampleColKey
		: sampleColKey.replace(/_/g, " ");

	const buckets: IncomeStatementBucket[] = Array.from(bucketAccum.entries())
		.map(([category, { total, columnKey }]) => ({
			category,
			annual_amount: total,
			pct_of_total: Math.round((total / totalAmount) * 1000) / 10,
			column_key: columnKey,
		}))
		.sort((a, b) => b.annual_amount - a.annual_amount);

	return {
		schema_version: "income_statement_allocation_v1",
		basis: "income_statement",
		basis_note: `IMPLIED from income statement expense section (${periodLabel}): ${nonzeroRows} line items, ${buckets.length} categories`,
		source: { document_id: opts.documentId, page_ref: opts.pageRef },
		period_label: periodLabel,
		buckets,
		total_annual_amount: totalAmount,
		diagnostics: {
			expense_rows_parsed: expenseRowsParsed,
			nonzero_rows: nonzeroRows,
			parse_warnings: warnings,
		},
	};
}
