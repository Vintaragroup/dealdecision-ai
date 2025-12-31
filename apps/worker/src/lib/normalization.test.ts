import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToCanonical } from "./normalization";
import * as XLSX from "xlsx";
import { extractExcelContent } from "./processors/excel";

test("normalizeToCanonical always includes canonical keys", () => {
	const out = normalizeToCanonical({
		contentType: "pdf",
		content: null,
		structuredData: {
			keyMetrics: [],
			mainHeadings: [],
			textSummary: "",
			entities: [],
		},
	});

	assert.ok(out.structuredData.canonical);
	assert.ok(out.structuredData.canonical.company);
	assert.ok(out.structuredData.canonical.deal);
	assert.ok(out.structuredData.canonical.traction);
	assert.ok(out.structuredData.canonical.financials);
	assert.ok(out.structuredData.canonical.financials.canonical_metrics);
	assert.ok(Object.prototype.hasOwnProperty.call(out.structuredData.canonical.financials.canonical_metrics, "revenue"));
	assert.equal(out.structuredData.canonical.financials.canonical_metrics.revenue, null);
});

test("normalizeToCanonical maps Excel revenue/expenses/cash and derives burn+runway deterministically", () => {
	const excelContent: any = {
		sheets: [
			{
				name: "P&L",
				headers: ["Line Item", "2024-01", "2024-02"],
				rows: [
					{ "Line Item": "Revenue", "2024-01": 90, "2024-02": 100 },
					{ "Line Item": "Expenses", "2024-01": 120, "2024-02": 130 },
					{ "Line Item": "Cash Balance", "2024-02": 520 },
				],
			},
		],
	};

	const out = normalizeToCanonical({
		contentType: "excel",
		content: excelContent,
		structuredData: {
			keyFinancialMetrics: {},
			keyMetrics: [],
			mainHeadings: [],
			textSummary: "",
			entities: [],
		},
	});

	const m = out.structuredData.canonical.financials.canonical_metrics;
	assert.equal(m.revenue, 100);
	assert.equal(m.expenses, 130);
	assert.equal(m.cash_balance, 520);
	assert.equal(m.burn_rate, 30);
	assert.ok(m.runway_months != null);
	assert.equal(Number((m.runway_months as number).toFixed(4)), Number((520 / 30).toFixed(4)));

	// Evidence pointers include sheet/row/column
	assert.ok(out.canonicalEvidence.some((e) => e.metric_key === "revenue" && e.source_pointer.includes("sheet=P&L")));
});

test("normalizeToCanonical maps canonical financial metrics from a minimal synthetic workbook (xlsx)", () => {
	// Build a minimal real .xlsx buffer to ensure we exercise the actual Excel extractor.
	const aoa = [
		["Line Item", "2024-01", "2024-02"],
		["Revenue", 90, 100],
		["COGS", 45, 50],
		["Expenses", 120, 130],
		["Cash Balance", null, 520],
		["Gross Margin %", "55%", "50%"],
	];

	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.aoa_to_sheet(aoa);
	XLSX.utils.book_append_sheet(wb, ws, "P&L");
	const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

	const extracted = extractExcelContent(buffer);
	const out = normalizeToCanonical({
		contentType: "excel",
		content: extracted as any,
		structuredData: {
			keyFinancialMetrics: {},
			keyMetrics: [],
			mainHeadings: [],
			textSummary: "",
			entities: [],
		},
	});

	const m = out.structuredData.canonical.financials.canonical_metrics;
	assert.equal(m.revenue, 100);
	assert.equal(m.cogs, 50);
	assert.equal(m.expenses, 130);
	assert.equal(m.cash_balance, 520);
	assert.equal(m.gross_margin, 50);
	assert.equal(m.burn_rate, 30);
	assert.ok(m.runway_months != null);

	const revenueEv = out.canonicalEvidence.find((e) => e.metric_key === "revenue");
	assert.ok(revenueEv);
	assert.ok(revenueEv!.source_pointer.includes("sheet=P&L"));
	assert.ok(revenueEv!.source_pointer.includes("row_idx="));
	assert.ok(revenueEv!.source_pointer.includes("col="));
	assert.ok(revenueEv!.source_pointer.includes("snippet="));
});
