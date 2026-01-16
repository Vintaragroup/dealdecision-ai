import { expect, test } from "vitest";
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

	expect(out.structuredData.canonical).toBeTruthy();
	expect(out.structuredData.canonical.company).toBeTruthy();
	expect(out.structuredData.canonical.deal).toBeTruthy();
	expect(out.structuredData.canonical.traction).toBeTruthy();
	expect(out.structuredData.canonical.financials).toBeTruthy();
	expect(out.structuredData.canonical.financials.canonical_metrics).toBeTruthy();
	expect(Object.prototype.hasOwnProperty.call(out.structuredData.canonical.financials.canonical_metrics, "revenue")).toBe(true);
	expect(out.structuredData.canonical.financials.canonical_metrics.revenue).toBeNull();
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
	expect(m.revenue).toBe(100);
	expect(m.expenses).toBe(130);
	expect(m.cash_balance).toBe(520);
	expect(m.burn_rate).toBe(30);
	expect(m.runway_months).not.toBeNull();
	expect(Number((m.runway_months as number).toFixed(4))).toBe(Number((520 / 30).toFixed(4)));

	// Evidence pointers include sheet/row/column
	expect(out.canonicalEvidence.some((e) => e.metric_key === "revenue" && e.source_pointer.includes("sheet=P&L"))).toBe(true);
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
	expect(m.revenue).toBe(100);
	expect(m.cogs).toBe(50);
	expect(m.expenses).toBe(130);
	expect(m.cash_balance).toBe(520);
	expect(m.gross_margin).toBe(50);
	expect(m.burn_rate).toBe(30);
	expect(m.runway_months).not.toBeNull();

	const revenueEv = out.canonicalEvidence.find((e) => e.metric_key === "revenue");
	expect(revenueEv).toBeTruthy();
	expect(revenueEv!.source_pointer).toContain("sheet=P&L");
	expect(revenueEv!.source_pointer).toContain("row_idx=");
	expect(revenueEv!.source_pointer).toContain("col=");
	expect(revenueEv!.source_pointer).toContain("snippet=");
});

test("extractExcelContent detects month time-series tables and normalization can derive expenses", () => {
	// This shape mirrors common financial models: first row has Month headers, first column has line items.
	const aoa = [
		["", "", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
		["Expenses", "", 100, 110, 120, 130, 140, 150],
		["Revenue", "", 60, 70, 80, 90, 100, 110],
		["Cash Balance", "", 500, 480, 460, 440, 420, 400],
	];

	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.aoa_to_sheet(aoa);
	XLSX.utils.book_append_sheet(wb, ws, "Model");
	const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

	const extracted = extractExcelContent(buffer);
	const modelSheet: any = extracted.sheets.find((s: any) => s.name === "Model");
	expect(modelSheet).toBeTruthy();
	expect(Array.isArray(modelSheet.tables)).toBe(true);
	expect(modelSheet.tables.length).toBeGreaterThan(0);

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
	expect(m.expenses).toBe(150);
	expect(m.revenue).toBe(110);
	expect(m.cash_balance).toBe(400);
	expect(out.canonicalEvidence.some((e) => e.source_pointer.includes("table="))).toBe(true);
});

test("extractExcelContent normalizes multi-row merged headers (no __EMPTY headers)", () => {
	const aoa = [
		["", "Revenue", null, "Expenses", null],
		["Line Item", "Jan", "Feb", "Jan", "Feb"],
		["Product A", 10, 12, 5, 6],
		["Product B", 15, 18, 7, 9],
	];

	const wb = XLSX.utils.book_new();
	const ws: any = XLSX.utils.aoa_to_sheet(aoa);
	ws["!merges"] = [
		{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
		{ s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
	];
	XLSX.utils.book_append_sheet(wb, ws, "Model");
	const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

	const extracted = extractExcelContent(buffer);
	const modelSheet: any = extracted.sheets.find((s: any) => s.name === "Model");
	expect(modelSheet).toBeTruthy();
	expect(Array.isArray(modelSheet.headers)).toBe(true);
	expect(modelSheet.headers.some((h: string) => /__empty/i.test(h))).toBe(false);

	// Combined headers should be present for merged groups.
	expect(modelSheet.headers).toContain("Revenue / Jan");
	expect(modelSheet.headers).toContain("Revenue / Feb");
	expect(modelSheet.headers).toContain("Expenses / Jan");
	expect(modelSheet.headers).toContain("Expenses / Feb");
});
