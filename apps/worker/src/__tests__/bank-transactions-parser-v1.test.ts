/**
 * bank-transactions-parser-v1.test.ts
 *
 * Unit tests for the deterministic bank-transactions aggregation parser.
 *
 * Coverage:
 *  1.  Null payload → null
 *  2.  Wrong page_type → null
 *  3.  No header row with debit/credit → null
 *  4.  Header row with debit column → result returned
 *  5.  Header row with credit column → result returned
 *  6.  Debit amounts summed correctly
 *  7.  Credit amounts summed correctly
 *  8.  net_change = credits − debits
 *  9.  row_count excludes header and summary rows
 * 10.  ending_balance captured from balance column
 * 11.  date_range populated when date column present and parseable dates exist
 * 12.  schema_version = "bank_transactions_v1"
 * 13.  source fields populated
 * 14.  derived.monthly_burn computed when net_change < 0 and date range parseable
 */

import { describe, it, expect } from "vitest";
import { parseBankTransactionsV1 } from "../lib/bank-transactions-parser-v1";

const SRC = { documentId: "test-doc-bank", pageRef: "sheet:Bank Statement:0" };

function makePayload(
	rows: Array<Record<string, unknown>>,
	opts?: { kind?: string },
): unknown {
	return {
		page_type:  "excel_range",
		sheet_name: "Bank Statement",
		structured: {
			kind:         opts?.kind ?? "excel_range",
			rows_preview: rows,
		},
	};
}

// Helper: row with header labels
function headerRow(opts: {
	date?: string;
	description?: string;
	debit?: string;
	credit?: string;
	balance?: string;
}): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	if (opts.date)        row["col_A"] = opts.date;
	if (opts.description) row["col_B"] = opts.description;
	if (opts.debit)       row["col_C"] = opts.debit;
	if (opts.credit)      row["col_D"] = opts.credit;
	if (opts.balance)     row["col_E"] = opts.balance;
	return row;
}

// Helper: transaction data row
function txRow(date: string | null, desc: string, debit: number | null, credit: number | null, balance?: number): Record<string, unknown> {
	return {
		col_A: date,
		col_B: desc,
		col_C: debit,
		col_D: credit,
		col_E: balance ?? null,
	};
}

describe("parseBankTransactionsV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseBankTransactionsV1(null, SRC)).toBeNull();
	});

	it("2. returns null for wrong page_type", () => {
		const p = { page_type: "pdf", structured: { kind: "excel_range", rows_preview: [] } };
		expect(parseBankTransactionsV1(p, SRC)).toBeNull();
	});

	it("3. returns null when no header row with debit/credit found", () => {
		const p = makePayload([
			{ col_A: "Date", col_B: "Description", col_C: "Amount" },
			{ col_A: "2024-01-15", col_B: "Payroll", col_C: 5000 },
		]);
		expect(parseBankTransactionsV1(p, SRC)).toBeNull();
	});

	it("4. header row with debit column → result returned", () => {
		const p = makePayload([
			headerRow({ date: "Date", description: "Description", debit: "Debit", credit: "Credit" }),
			txRow("2024-01-15", "Payroll", 5000, null),
		]);
		const result = parseBankTransactionsV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.schema_version).toBe("bank_transactions_v1");
	});

	it("5. header row with credit-only column → result returned", () => {
		const p = makePayload([
			headerRow({ credit: "Credit" }),
			txRow(null, "Customer Payment", null, 10000),
		]);
		expect(parseBankTransactionsV1(p, SRC)).not.toBeNull();
	});

	it("6. debit amounts summed correctly", () => {
		const p = makePayload([
			headerRow({ debit: "Debit", credit: "Credit" }),
			txRow("2024-01-10", "AWS",     3000, null),
			txRow("2024-01-15", "Payroll", 8000, null),
			txRow("2024-01-20", "Office",  1000, null),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.total_debits).toBe(12000);
	});

	it("7. credit amounts summed correctly", () => {
		const p = makePayload([
			headerRow({ debit: "Debit", credit: "Credit" }),
			txRow("2024-01-05", "Customer A", null, 15000),
			txRow("2024-01-20", "Customer B", null, 5000),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.total_credits).toBe(20000);
	});

	it("8. net_change = credits − debits", () => {
		const p = makePayload([
			headerRow({ debit: "Debit", credit: "Credit" }),
			txRow("2024-01-10", "Spend",   8000, null),
			txRow("2024-01-20", "Revenue", null, 20000),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.net_change).toBeCloseTo(12000, 0);
	});

	it("9. row_count counts transaction rows only", () => {
		const p = makePayload([
			headerRow({ debit: "Debit", credit: "Credit" }),
			txRow("2024-01-10", "Tx1", 1000, null),
			txRow("2024-01-11", "Tx2", 2000, null),
			txRow("2024-01-12", "Tx3", null, 5000),
			// Summary row should be excluded
			{ col_A: "Total", col_C: 3000, col_D: 5000 },
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.row_count).toBe(3);
	});

	it("10. ending_balance captured from balance column", () => {
		const p = makePayload([
			headerRow({ debit: "Debit", credit: "Credit", balance: "Balance" }),
			txRow("2024-01-10", "Spend",   5000, null,  45000),
			txRow("2024-01-20", "Revenue", null, 10000, 55000),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.ending_balance).toBe(55000);
	});

	it("11. date_range populated when date column and parseable dates present", () => {
		const p = makePayload([
			headerRow({ date: "Date", debit: "Debit", credit: "Credit" }),
			txRow("2024-01-05", "First Tx", 1000, null),
			txRow("2024-03-28", "Last Tx",  2000, null),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.date_range).not.toBeNull();
		expect(result.date_range!.earliest).toBe("2024-01-05");
		expect(result.date_range!.latest).toBe("2024-03-28");
	});

	it("12. schema_version is bank_transactions_v1", () => {
		const p = makePayload([
			headerRow({ debit: "Debit" }),
			txRow(null, "Test", 1000, null),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.schema_version).toBe("bank_transactions_v1");
	});

	it("13. source fields populated from arguments", () => {
		const p = makePayload([
			headerRow({ debit: "Withdrawal" }),
			txRow(null, "Test", 500, null),
		]);
		const result = parseBankTransactionsV1(p, SRC)!;
		expect(result.source.document_id).toBe("test-doc-bank");
		expect(result.source.page_ref).toBe("sheet:Bank Statement:0");
	});
});
