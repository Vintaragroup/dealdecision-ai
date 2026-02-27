/**
 * Bank Transactions Parser V1
 *
 * Deterministically parses bank transaction export data from XLSX DPU payloads
 * (excel_range page_type with rows_preview).
 *
 * This is NOT a row-level transaction parser — it aggregates totals:
 *   - total_debits   (sum of all debit/outflow amounts)
 *   - total_credits  (sum of all credit/inflow amounts)
 *   - net_change     (credits − debits)
 *   - row_count      (number of transaction rows parsed)
 *   - date_range     (min / max date strings found in date column)
 *   - ending_balance (last balance value if present)
 *   - monthly_burn   (|net_change| / estimated_months when net_change < 0)
 *
 * Detection heuristic:
 *   - Identify the "debit/credit/balance" column layout from the header row.
 *   - Header must contain recognisable debit OR credit column labels.
 *   - Skip rows that are themselves headers or summary subtotals.
 *
 * Design constraints: pure TypeScript, no DB calls, conservative.
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export interface BankTransactionsV1 {
	schema_version: "bank_transactions_v1";
	source: {
		document_id: string;
		page_ref:    string;
	};
	/** Number of transaction rows detected (not counting header/total rows). */
	row_count:      number;
	/** Sum of all debit (outflow) amounts. Always positive (absolute value). */
	total_debits:   number | null;
	/** Sum of all credit (inflow) amounts. Always positive. */
	total_credits:  number | null;
	/** Credits − debits — net cash change over the period. */
	net_change:     number | null;
	/**
	 * Earliest and latest date strings found in the date column.
	 * Raw strings as found in the spreadsheet.
	 */
	date_range:     { earliest: string; latest: string } | null;
	/** Last balance value found in the running balance column. */
	ending_balance: number | null;
	derived?: {
		/**
		 * Estimated monthly burn: |net_change| / estimated_months.
		 * estimated_months is derived from date_range when parseable (or null).
		 */
		estimated_months?: number | null;
		monthly_burn?:      number | null;
	};
	diagnostics: {
		columns_detected: Record<string, string>; // { date: "col_B", debit: "col_C", ... }
		parse_warnings:   string[];
	};
}

// ─── Header detection ─────────────────────────────────────────────────────────

type ColRole = "date" | "description" | "debit" | "credit" | "balance";

const HEADER_PATTERNS: Array<{ role: ColRole; pattern: RegExp }> = [
	{ role: "date",        pattern: /^(?:date|transaction\s+date|posting\s+date|value\s+date|txn\s+date)$/i },
	{ role: "description", pattern: /^(?:description|merchant|payee|narration|memo|reference|details?)$/i },
	{ role: "debit",       pattern: /^(?:debit|debit\s+amount|withdrawal|out|money\s+out|outflow|charge)$/i },
	{ role: "credit",      pattern: /^(?:credit|credit\s+amount|deposit|in|money\s+in|inflow|receipt)$/i },
	{ role: "balance",     pattern: /^(?:balance|running\s+balance|closing\s+balance|account\s+balance)$/i },
];

type RowObject = Record<string, unknown>;

function detectHeaderRow(rowsPreview: unknown[]): Map<ColRole, string> | null {
	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as RowObject;
		const roles = new Map<ColRole, string>();
		for (const [k, v] of Object.entries(row)) {
			const s = String(v ?? "").trim();
			for (const { role, pattern } of HEADER_PATTERNS) {
				if (pattern.test(s) && !roles.has(role)) {
					roles.set(role, k);
					break;
				}
			}
		}
		// Must have at least debit OR credit to consider this a transaction header
		if (roles.has("debit") || roles.has("credit")) return roles;
	}
	return null;
}

function parseAmount(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const s = String(v).trim().replace(/\(([^)]+)\)/, "$1").replace(/[$,\s]/g, "");
	const n = Number(s);
	return Number.isFinite(n) ? Math.abs(n) : null;
}

const SKIP_LABELS_RE = /^(?:total|subtotal|grand\s+total|opening|closing|balance|date|description|debit|credit)$/i;
const DATE_RE = /\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4}/;

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseBankTransactionsV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): BankTransactionsV1 | null {
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;
	if (p["page_type"] !== "excel_range") return null;

	const structured = p["structured"] as Record<string, unknown> | null | undefined;
	if (!structured || structured["kind"] !== "excel_range") return null;

	const rowsPreview = structured["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	const headerRoles = detectHeaderRow(rowsPreview);
	if (!headerRoles) return null;  // not a transaction sheet

	const debitCol   = headerRoles.get("debit");
	const creditCol  = headerRoles.get("credit");
	const balanceCol = headerRoles.get("balance");
	const dateCol    = headerRoles.get("date");

	// Need at least one of debit/credit
	if (!debitCol && !creditCol) return null;

	let rowCount = 0;
	let totalDebits  = 0;
	let totalCredits = 0;
	let endingBalance: number | null = null;
	const parseWarnings: string[] = [];
	let headerSkipped = false;
	const dateValues: string[] = [];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as RowObject;
		const labelCell = String(row["col_A"] ?? "").trim();

		// Skip header row and summary-looking rows
		if (!headerSkipped && (headerRoles.get("date") ? debitCol && String(row[debitCol] ?? "").match(/^(?:debit|withdrawal)$/i) : false)) {
			headerSkipped = true;
			continue;
		}
		if (SKIP_LABELS_RE.test(labelCell)) continue;

		// Extract date
		if (dateCol) {
			const dateStr = String(row[dateCol] ?? "").trim();
			if (DATE_RE.test(dateStr)) dateValues.push(dateStr);
		}

		// Attempt to extract debit/credit amounts
		const debit  = debitCol  ? parseAmount(row[debitCol]) : null;
		const credit = creditCol ? parseAmount(row[creditCol]) : null;

		let isTransactionRow = false;
		if (debit !== null && debit > 0)  { totalDebits  += debit;  isTransactionRow = true; }
		if (credit !== null && credit > 0) { totalCredits += credit; isTransactionRow = true; }

		if (isTransactionRow) rowCount++;

		// Track latest balance
		if (balanceCol) {
			const bal = parseAmount(row[balanceCol]);
			if (bal !== null) endingBalance = row[balanceCol] as number; // raw signed value
		}
	}

	// Re-read ending balance as signed value
	if (balanceCol) {
		for (let i = rowsPreview.length - 1; i >= 0; i--) {
			const rawRow = rowsPreview[i];
			if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
			const row = rawRow as RowObject;
			const raw = row[balanceCol];
			if (raw === null || raw === undefined) continue;
			const s = String(raw).trim().replace(/\(([^)]+)\)/, "-$1").replace(/[$,]/g, "");
			const n = Number(s);
			if (Number.isFinite(n)) { endingBalance = n; break; }
		}
	}

	if (rowCount === 0) return null;

	const netChange = totalCredits - totalDebits;

	// Derive monthly burn from date range if possible
	let estimatedMonths: number | null = null;
	let monthlyBurn: number | null = null;

	const dateRange = dateValues.length >= 2
		? { earliest: dateValues[0]!, latest: dateValues[dateValues.length - 1]! }
		: null;

	if (dateRange) {
		const parseDate = (s: string): Date | null => {
			const d = new Date(s);
			return isNaN(d.getTime()) ? null : d;
		};
		const d0 = parseDate(dateRange.earliest);
		const d1 = parseDate(dateRange.latest);
		if (d0 && d1) {
			const diffMs = Math.abs(d1.getTime() - d0.getTime());
			const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
			if (diffMonths >= 0.5) {
				estimatedMonths = Math.round(diffMonths * 10) / 10;
			}
		}
	}

	if (netChange < 0 && estimatedMonths && estimatedMonths > 0) {
		monthlyBurn = Math.abs(netChange) / estimatedMonths;
	}

	const hasDerived = estimatedMonths !== null || monthlyBurn !== null;

	return {
		schema_version: "bank_transactions_v1",
		source:         { document_id: source.documentId, page_ref: source.pageRef },
		row_count:      rowCount,
		total_debits:   totalDebits > 0 ? totalDebits : null,
		total_credits:  totalCredits > 0 ? totalCredits : null,
		net_change:     totalDebits > 0 || totalCredits > 0 ? netChange : null,
		date_range:     dateRange,
		ending_balance: endingBalance,
		...(hasDerived ? {
			derived: {
				estimated_months: estimatedMonths,
				monthly_burn:     monthlyBurn,
			},
		} : {}),
		diagnostics: {
			columns_detected: Object.fromEntries(
				[...headerRoles.entries()].map(([role, col]) => [role, col])
			),
			parse_warnings: parseWarnings,
		},
	};
}
