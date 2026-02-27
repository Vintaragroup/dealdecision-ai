/**
 * Implied Capital Allocation Parser V1
 *
 * Derives an implied capital allocation structure from operational budget model
 * XLSX sheets (Budget + Employee Costs) when no explicit "Use of Funds" sheet
 * exists.
 *
 * Data source: `page_text` field from `excel_sheet` DPU payloads produced by
 * the `structured_native_v1` fallback extractor.  The `rows_preview` array is
 * empty for this extractor, so we parse the pipe-delimited `page_text` instead.
 *
 * Design rules:
 *   - Pure function: no DB calls, no side-effects
 *   - Conservative: emits null rather than hallucinating
 *   - All output is marked as IMPLIED (not a stated raise allocation)
 *   - Works from page_type === "excel_sheet" (NOT "excel_range")
 *   - parse_quality score gates downstream promotion (≥0.5 required)
 *
 * Output bucket categories (investor-friendly labels):
 *   Engineering / R&D  →  employee_costs (R&D department)
 *   Sales              →  employee_costs (Sales department)
 *   Marketing          →  employee_costs (Marketing department)
 *   G&A / Management   →  employee_costs (G&A department)
 *   Customer Support   →  employee_costs (Support department)
 *   Infrastructure / Cloud → infra_budget (Budget sheet Other Costs table)
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ImpliedCapitalAllocationBucket {
	/** Investor-friendly category label */
	category: string;
	/** Implied annual cost in USD (sum of Q1–Q4), or null when data is incomplete */
	annual_cost_usd: number | null;
	/** Fraction of total (0–1), set after all buckets are computed */
	pct_of_total: number | null;
	/** Which sheet this bucket was derived from */
	source: "employee_costs" | "infra_budget";
	/** DPU page reference for evidence tracing */
	evidence_ref: string;
}

export interface ImpliedCapitalAllocationV1 {
	schema_version: "implied_capital_allocation_v1";
	/**
	 * Always "budget_model" — this is derived from an operational budget, not
	 * an explicit investor raise allocation.
	 */
	basis: "budget_model";
	/**
	 * Human-readable disclaimer that MUST surface in every render.
	 * "IMPLIED from operational budget model — not an explicit raise allocation"
	 */
	basis_note: string;
	source: {
		document_id: string;
		/** All DPU page refs used (e.g. "dpu:doc:1cc11a36:page:1") */
		page_refs: string[];
	};
	/** e.g. "Q1–Q4 2026" */
	period_label: string;
	/** Ordered allocation buckets */
	buckets: ImpliedCapitalAllocationBucket[];
	/** Sum of all bucket annual costs in USD, or null if incomplete */
	total_annual_cost_usd: number | null;
	diagnostics: {
		sheets_used: string[];
		infra_rows_parsed: number;
		employee_rows_parsed: number;
		/** 0–1; 1.0 = all data present; ≥0.5 = promotable to slot */
		parse_quality: number;
		notes: string[];
	};
}

// ─── Bucket category mapping ──────────────────────────────────────────────────

/**
 * Map raw department names (from Employee Costs sheet) to investor-friendly labels.
 */
const DEPT_TO_BUCKET: Record<string, string> = {
	"g&a": "G&A / Management",
	"ga": "G&A / Management",
	"general & administrative": "G&A / Management",
	"general and administrative": "G&A / Management",
	"r&d": "Engineering / R&D",
	"rd": "Engineering / R&D",
	"research and development": "Engineering / R&D",
	"research & development": "Engineering / R&D",
	"engineering": "Engineering / R&D",
	"product": "Engineering / R&D",
	"sales": "Sales",
	"business development": "Sales",
	"marketing": "Marketing",
	"support": "Customer Support",
	"customer support": "Customer Support",
	"customer success": "Customer Support",
	"operations": "Operations",
	"ops": "Operations",
};

/**
 * Normalize a raw department name to a canonical investor bucket label.
 */
function normalizeDept(raw: string): string {
	const key = raw.toLowerCase().replace(/[^a-z0-9&\s]/g, "").trim();
	return DEPT_TO_BUCKET[key] ?? capitalizeFirst(raw.trim());
}

function capitalizeFirst(s: string): string {
	return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ─── page_text parser helpers ─────────────────────────────────────────────────

/**
 * Parse a dollar amount from a cell string like "$1,000" → 1000.
 * Returns null when the string cannot be parsed as a number.
 */
function parseDollarCell(cell: string): number | null {
	const cleaned = cell.replace(/[$,\s]/g, "").trim();
	if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "n/a") return null;
	const n = parseFloat(cleaned);
	return isFinite(n) ? n : null;
}

/**
 * Parse a headcount/decimal cell like "0.5" or "7.5".
 * Returns 0 when cell is blank, dash, or unparseable.
 */
function parseHeadcountCell(cell: string): number {
	const cleaned = cell.replace(/,/g, "").trim();
	if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "n/a") return 0;
	const n = parseFloat(cleaned);
	return isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Parse all data rows from a `page_text` string.
 *
 * The page_text format for excel_sheet pages:
 *   Sheet: {name}
 *   Summary: ...
 *   Headers: ...
 *   - {row_number}: {col1} | {col2} | ...
 *
 * Returns an array of cell arrays (one per data row).
 * The row number prefix is stripped; blank-cell collapsing is NOT reversed
 * here — callers must handle variable-length rows.
 */
function parsePageTextRows(pageText: string): string[][] {
	const rows: string[][] = [];
	for (const line of pageText.split("\n")) {
		const m = /^-\s*\d+:\s*(.+)$/.exec(line.trim());
		if (!m || !m[1]) continue;
		const cells = m[1].split(" | ").map((c) => c.trim());
		rows.push(cells);
	}
	return rows;
}

// ─── Budget Sheet parser ──────────────────────────────────────────────────────

interface InfraRow {
	category: string;
	q1: number | null;
	q2: number | null;
	q3: number | null;
	q4: number | null;
	annual: number | null;
}

/**
 * Parse the "Other Costs / Department" left-side table from the Budget sheet.
 *
 * The Budget sheet has two side-by-side tables. The left table runs in columns
 * 1–5 (category label + Q1/Q2/Q3/Q4 dollar amounts). Rows that belong to the
 * left table are identified by their second cell starting with "$".
 *
 * Example row: "AI | $1,000 | $3,000 | $3,000 | $5,125 | Marketing | 0.5 ..."
 *   → category="AI", q1=1000, q2=3000, q3=3000, q4=5125
 */
function parseBudgetInfraRows(pageText: string): InfraRow[] {
	const rows = parsePageTextRows(pageText);
	const result: InfraRow[] = [];

	for (const cells of rows) {
		if (cells.length < 2) continue;
		// Left-table infra cost rows are identified by cells[1] starting with "$"
		const col2 = cells[1] ?? "";
		if (!col2.startsWith("$")) continue;

		const category = cells[0] ?? "";
		// Skip summary/total rows
		const lc = category.toLowerCase();
		if (lc === "" || lc === "total" || lc === "grand total" || lc === "subtotal") continue;
		// Skip header rows that carry column labels
		if (/^\d+q\d{4}$/i.test(lc) || lc === "department" || lc === "other costs") continue;

		const q1 = parseDollarCell(cells[1] ?? "");
		const q2 = parseDollarCell(cells[2] ?? "");
		const q3 = parseDollarCell(cells[3] ?? "");
		const q4 = parseDollarCell(cells[4] ?? "");

		const definedAmounts = [q1, q2, q3, q4].filter((v): v is number => v !== null);
		const annual = definedAmounts.length > 0 ? definedAmounts.reduce((a, b) => a + b, 0) : null;

		result.push({ category, q1, q2, q3, q4, annual });
	}

	return result;
}

// ─── Employee Costs sheet parser ─────────────────────────────────────────────

interface EmployeeDeptCost {
	department: string;
	/** Implied Q1–Q4 annual run-rate cost (sum of quarterly costs Q1–Q4) */
	annual_cost_usd: number;
	/** Number of employee rows contributing to this department */
	row_count: number;
}

/**
 * Parse the Employee Costs sheet into per-department annual salary costs.
 *
 * Row format (after page_text parsing):
 *   cells[0] = Department  (e.g. "G&A", "R&D", "Sales")
 *   cells[1] = Annual Base Salary  (e.g. "$120,000")
 *   cells[2] = Role  (e.g. "CEO")
 *   cells[3..n] = Headcount per quarter (periods 1, 2, 3, ...)
 *
 * For each row we compute: Q1_cost = cells[3] * salary / 4, etc.
 * Annual cost = sum(Q1_cost + Q2_cost + Q3_cost + Q4_cost).
 *
 * Rows are identified by: cells[0] is a non-empty string that is NOT a column
 * header, AND cells[1] starts with "$".
 */
function parseEmployeeCosts(pageText: string): Map<string, EmployeeDeptCost> {
	const rows = parsePageTextRows(pageText);
	const deptMap = new Map<string, EmployeeDeptCost>();

	for (const cells of rows) {
		if (cells.length < 3) continue;
		const deptRaw = cells[0] ?? "";
		const salaryCell = cells[1] ?? "";

		// Employee rows have a department in col 0 and salary in col 1
		if (!salaryCell.startsWith("$")) continue;
		if (deptRaw === "" || deptRaw.toLowerCase() === "department") continue;

		const annualSalary = parseDollarCell(salaryCell);
		if (annualSalary === null || annualSalary <= 0) continue;

		// Headcount values start at cells[3] (after dept, salary, role)
		// periods 1..n correspond to quarterly plan periods
		const hcCells = cells.slice(3); // Q1, Q2, Q3, Q4, Q5, ...
		const q1hc = parseHeadcountCell(hcCells[0] ?? "0");
		const q2hc = parseHeadcountCell(hcCells[1] ?? "0");
		const q3hc = parseHeadcountCell(hcCells[2] ?? "0");
		const q4hc = parseHeadcountCell(hcCells[3] ?? "0");

		const qCost = (hc: number) => hc * annualSalary / 4;
		// Annual Q1–Q4 cost for this employee row
		const annualCost = qCost(q1hc) + qCost(q2hc) + qCost(q3hc) + qCost(q4hc);

		const dept = normalizeDept(deptRaw);
		const existing = deptMap.get(dept);
		if (existing) {
			existing.annual_cost_usd += annualCost;
			existing.row_count += 1;
		} else {
			deptMap.set(dept, {
				department: dept,
				annual_cost_usd: annualCost,
				row_count: 1,
			});
		}
	}

	return deptMap;
}

// ─── Sheet identification ─────────────────────────────────────────────────────

function isBudgetSheet(sheetName: string): boolean {
	return /budget/i.test(sheetName);
}

function isEmployeeCostsSheet(sheetName: string): boolean {
	return /employee\s*(costs?|spend|salary|compensation|pay)/i.test(sheetName) ||
		/payroll/i.test(sheetName) ||
		/salary|salaries/i.test(sheetName);
}

// ─── Period label detection ───────────────────────────────────────────────────

/**
 * Extract a period label from the Budget sheet's page_text.
 * Looks for quarterly column patterns like "1Q2026".
 * Falls back to "Q1–Q4" when not found.
 */
function extractPeriodLabel(pageText: string): string {
	const match = /(\d+Q(\d{4}))/i.exec(pageText);
	if (match && match[2]) {
		const year = match[2];
		return `Q1–Q4 ${year}`;
	}
	return "Q1–Q4 (year unknown)";
}

// ─── Main parser ──────────────────────────────────────────────────────────────

type RawDpuRow = {
	document_id: string;
	page_index: number;
	payload: unknown;
};

/**
 * Parse an implied capital allocation from a set of DPU rows containing
 * `excel_sheet` page_type entries.
 *
 * The function searches all supplied rows for:
 *   1. A Budget sheet (identified by sheet_name "Budget" or similar) → infra costs
 *   2. An Employee Costs sheet → salary costs by department
 *
 * Returns null when:
 *   - No `excel_sheet` DPU rows are found
 *   - Neither the Budget sheet nor Employee Costs sheet is found
 *   - parse_quality < 0.3 (insufficient data)
 */
export function parseImpliedCapitalAllocationV1(
	dpuRows: RawDpuRow[],
	context: { documentId: string }
): ImpliedCapitalAllocationV1 | null {
	// Filter to excel_sheet pages only (structured_native_v1 fallback)
	const excelSheetRows = dpuRows.filter((r) => {
		const p = r.payload as Record<string, unknown> | null;
		return p?.["page_type"] === "excel_sheet";
	});

	if (excelSheetRows.length === 0) return null;

	let budgetPageText: string | null = null;
	let budgetPageRef: string | null = null;
	let budgetSheetName: string | null = null;

	let employeePageText: string | null = null;
	let employeePageRef: string | null = null;
	let employeeSheetName: string | null = null;

	for (const row of excelSheetRows) {
		const p = row.payload as Record<string, unknown>;
		const s = (p["structured"] ?? {}) as Record<string, unknown>;
		const sheetName = (s["sheet_name"] as string | undefined) ?? "";
		const pageText = (p["page_text"] as string | undefined) ?? "";
		const pageRef = `dpu:doc:${row.document_id.replace(/-/g, "").slice(0, 8)}:page:${row.page_index}`;

		if (isBudgetSheet(sheetName) && budgetPageText === null) {
			budgetPageText = pageText;
			budgetPageRef = pageRef;
			budgetSheetName = sheetName;
		}
		if (isEmployeeCostsSheet(sheetName) && employeePageText === null) {
			employeePageText = pageText;
			employeePageRef = pageRef;
			employeeSheetName = sheetName;
		}
	}

	// Need at least one of the two sheets to proceed
	if (!budgetPageText && !employeePageText) return null;

	const notes: string[] = [];
	const sheetsUsed: string[] = [];
	const pageRefs: string[] = [];
	const buckets: ImpliedCapitalAllocationBucket[] = [];

	// ── Parse Budget sheet — infra costs ─────────────────────────────────────
	let infraRowsParsed = 0;
	let infraTotal = 0;

	if (budgetPageText && budgetPageRef) {
		sheetsUsed.push(budgetSheetName ?? "Budget");
		pageRefs.push(budgetPageRef);
		notes.push("page_text parsed from structured_native_v1 (excel_sheet fallback)");

		const infraRows = parseBudgetInfraRows(budgetPageText);
		infraRowsParsed = infraRows.length;

		if (infraRows.length > 0) {
			// Group all infra line items into one "Infrastructure / Cloud" bucket
			const annuals = infraRows.map((r) => r.annual).filter((a): a is number => a !== null);
			const totalInfra = annuals.length > 0 ? annuals.reduce((a, b) => a + b, 0) : null;
			if (totalInfra !== null) infraTotal = totalInfra;

			buckets.push({
				category: "Infrastructure / Cloud",
				annual_cost_usd: totalInfra,
				pct_of_total: null,
				source: "infra_budget",
				evidence_ref: budgetPageRef,
			});

			if (infraRows.length < 3) {
				notes.push(`Only ${infraRows.length} infra cost row(s) parsed from Budget sheet — may be incomplete`);
			}
		} else {
			notes.push("Budget sheet found but no dollar-amount rows detected in Other Costs table");
		}
	}

	// ── Parse Employee Costs sheet — salary costs by dept ────────────────────
	let employeeRowsParsed = 0;
	let employeeTotal = 0;

	if (employeePageText && employeePageRef) {
		sheetsUsed.push(employeeSheetName ?? "Employee Costs");
		pageRefs.push(employeePageRef);

		const deptMap = parseEmployeeCosts(employeePageText);
		employeeRowsParsed = Array.from(deptMap.values()).reduce((s, d) => s + d.row_count, 0);

		for (const [dept, data] of deptMap.entries()) {
			employeeTotal += data.annual_cost_usd;
			buckets.push({
				category: dept,
				annual_cost_usd: data.annual_cost_usd > 0 ? Math.round(data.annual_cost_usd) : null,
				pct_of_total: null,
				source: "employee_costs",
				evidence_ref: employeePageRef,
			});
		}

		if (deptMap.size === 0) {
			notes.push("Employee Costs sheet found but no department salary rows parsed");
		}
	}

	// ── Compute totals + percentages ──────────────────────────────────────────
	const totalCost = (infraTotal > 0 || employeeTotal > 0)
		? Math.round(infraTotal + employeeTotal)
		: null;

	if (totalCost !== null && totalCost > 0) {
		for (const b of buckets) {
			if (b.annual_cost_usd !== null && b.annual_cost_usd > 0) {
				b.pct_of_total = Math.round((b.annual_cost_usd / totalCost) * 1000) / 10;
			}
		}
	}

	// Sort by annual_cost_usd descending (largest bucket first)
	buckets.sort((a, b) => (b.annual_cost_usd ?? 0) - (a.annual_cost_usd ?? 0));

	// ── Quality score ─────────────────────────────────────────────────────────
	// 0.0 = nothing parsed
	// 0.5 = one sheet partially parsed
	// 0.7 = both sheets parsed with some rows
	// 0.9 = both sheets with ≥3 infra rows AND ≥3 dept buckets
	// 1.0 = complete (both sheets, ≥5 infra rows, ≥4 dept buckets)
	let parseQuality = 0.0;
	if (infraRowsParsed > 0 || employeeRowsParsed > 0) parseQuality = 0.4;
	if (infraRowsParsed >= 3) parseQuality += 0.15;
	if (employeeRowsParsed >= 5) parseQuality += 0.15;
	if (buckets.filter((b) => b.source === "employee_costs").length >= 3) parseQuality += 0.15;
	if (buckets.filter((b) => b.source === "employee_costs").length >= 4) parseQuality += 0.1;
	if (infraRowsParsed >= 5) parseQuality += 0.05;
	parseQuality = Math.min(1.0, parseQuality);

	// Quality floor: refuse to emit results below 0.3 to avoid noisy outputs
	if (parseQuality < 0.3) {
		notes.push(`parse_quality=${parseQuality.toFixed(2)} below minimum threshold — returning null`);
		return null;
	}

	// ── Period label ──────────────────────────────────────────────────────────
	const periodLabel = budgetPageText
		? extractPeriodLabel(budgetPageText)
		: "Q1–Q4 (year unknown)";

	return {
		schema_version: "implied_capital_allocation_v1",
		basis: "budget_model",
		basis_note: "IMPLIED from operational budget model — not an explicit raise allocation",
		source: {
			document_id: context.documentId,
			page_refs: pageRefs,
		},
		period_label: periodLabel,
		buckets,
		total_annual_cost_usd: totalCost,
		diagnostics: {
			sheets_used: sheetsUsed,
			infra_rows_parsed: infraRowsParsed,
			employee_rows_parsed: employeeRowsParsed,
			parse_quality: Math.round(parseQuality * 100) / 100,
			notes,
		},
	};
}
