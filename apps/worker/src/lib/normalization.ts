import type { ExtractedContent, DocumentAnalysis } from "./processors";

export type CanonicalMetrics = {
	revenue: number | null;
	expenses: number | null;
	cogs: number | null;
	cash_balance: number | null;
	burn_rate: number | null;
	runway_months: number | null;
	gross_margin: number | null;
};

export type CanonicalStructuredData = {
	canonical: {
		company: Record<string, unknown>;
		deal: Record<string, unknown>;
		traction: Record<string, unknown>;
		financials: {
			canonical_metrics: CanonicalMetrics;
		};
		risks: Record<string, unknown>;
	};
};

export type CanonicalEvidenceDraft = {
	metric_key: keyof CanonicalMetrics;
	value: number;
	source_pointer: string;
};

function toNumberLoose(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return null;
	let s = value.trim();
	if (!s) return null;

	// Accounting-style negatives: (1,234.56)
	let isParensNegative = false;
	const parens = s.match(/^\(\s*(.+?)\s*\)$/);
	if (parens) {
		isParensNegative = true;
		s = parens[1].trim();
	}

	const pct = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
	if (pct) {
		const v = Number.parseFloat(pct[1]);
		if (!Number.isFinite(v)) return null;
		return isParensNegative ? -v : v;
	}

	const m = s
		.replace(/,/g, "")
		.match(/\$?\s*(-?\d+(?:\.\d+)?)\s*([kmb]|thousand|million|billion)?\b/i);
	if (!m) return null;
	const base = Number.parseFloat(m[1]);
	if (!Number.isFinite(base)) return null;
	const mag = (m[2] || "").toLowerCase();
	const mult =
		mag === "k" || mag === "thousand"
			? 1_000
			: mag === "m" || mag === "million"
				? 1_000_000
				: mag === "b" || mag === "billion"
					? 1_000_000_000
					: 1;
	const out = base * mult;
	return isParensNegative ? -out : out;
}

function emptyCanonical(): CanonicalStructuredData {
	return {
		canonical: {
			company: {},
			deal: {},
			traction: {},
			financials: {
				canonical_metrics: {
					revenue: null,
					expenses: null,
					cogs: null,
					cash_balance: null,
					burn_rate: null,
					runway_months: null,
					gross_margin: null,
				},
			},
			risks: {},
		},
	};
}

function normalizeLabel(raw: string): string {
	return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSheetName(raw: string): string {
	return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function labelToMetricKey(label: string): keyof CanonicalMetrics | null {
	const s = normalizeLabel(label);
	if (!s) return null;

	// Canonical metrics (deterministic, generic label matching)
	if (/(^|\b)(revenue|sales|net sales|turnover|income)\b/.test(s)) return "revenue";
	// "Total Cost of Operations" and variants: map to expenses BEFORE the generic
	// "expense/opex" pattern so that this specific full-cost row wins over sub-lines.
	if (/(^|\b)(total\s+cost\s+of\s+operations?|costs?\s+of\s+operations?)\b/.test(s)) return "expenses";
	// Generic operating expenses: require the label does NOT contain "sales expense/cost"
	// (e.g. "Total Sales Expense") which is a department sub-line, not total opex.
	if (
		/(^|\b)(expenses|expense|opex|operating expense|operating expenses|sg&a|sga|operating spend)\b/.test(s) &&
		!/\bsales\s+(expense|cost|spend)\b/.test(s)
	)
		return "expenses";
	if (/(^|\b)(cogs|cost of goods sold|cost of goods|cost of revenue)\b/.test(s)) return "cogs";
	if (
		/(^|\b)(cash balance|cash on hand|cash available|cash remaining|ending cash|beginning cash|starting cash|bank balance|bank|cash)\b/.test(s) ||
		/(^|\b)(beginning balance|ending balance|balance remaining)\b/.test(s)
	)
		return "cash_balance";
	if (/(^|\b)(runway|months of runway|runway months|runway \(months\))\b/.test(s)) return "runway_months";
	if (/(^|\b)(gross margin|gm%|gross margin %)\b/.test(s)) return "gross_margin";
	return null;
}

function metricKeyFromLabelWithContext(params: {
	label: string;
	sheetName: string;
}): keyof CanonicalMetrics | null {
	const labelNorm = normalizeLabel(params.label);
	if (!labelNorm) return null;

	const base = labelToMetricKey(params.label);
	if (base) return base;

	// Deterministic sheet-context mapping for generic totals.
	// This enables sheets like "Revenue" or "Valuation - Allocation of Funds" where the row label is simply "Total".
	const isTotalLabel = labelNorm === "total" || /^total\b/.test(labelNorm);
	if (!isTotalLabel) return null;

	const sheet = normalizeSheetName(params.sheetName);
	const sheetLooksRevenue = /\brevenue\b/.test(sheet);
	const sheetLooksExpenses = /\b(expense|expenses|opex|operating)\b/.test(sheet) || /\b(valuation|allocation)\b/.test(sheet);

	if (sheetLooksRevenue) return "revenue";
	if (sheetLooksExpenses) return "expenses";
	return null;
}

function extractExcelCanonical(params: {
	excel: any;
}): { metrics: Partial<CanonicalMetrics>; evidence: CanonicalEvidenceDraft[]; debug?: any } {
	const excel = params.excel;
	const sheets: any[] = Array.isArray(excel?.sheets) ? excel.sheets : [];
	const out: Partial<CanonicalMetrics> = {};
	const evidence: CanonicalEvidenceDraft[] = [];

	const labelInventoryEnabled = process.env.XLSX_LABEL_INVENTORY === "1";
	const labelInventory: {
		sheets: Array<{
			sheet_name: string;
			labels: string[];
			matched_labels: Array<{ label: string; metric_key: keyof CanonicalMetrics }>;
		}>;
	} | null = labelInventoryEnabled ? { sheets: [] } : null;

	type Candidate = {
		metric_key: keyof CanonicalMetrics;
		value: number;
		label: string;
		sheet_name: string;
		source_pointer: string;
		priority: number;
		sheet_hint: number;
		order: number;
	};

	let orderCounter = 0;
	const candidatesByKey: Partial<Record<keyof CanonicalMetrics, Candidate[]>> = {};

	const sheetHintScore = (metricKey: keyof CanonicalMetrics, sheetName: string): number => {
		const s = normalizeSheetName(sheetName);
		if (metricKey === "revenue") return /\brevenue\b/.test(s) ? 2 : 0;
		if (metricKey === "expenses") return /\b(valuation|allocation|expense|expenses|opex|operating)\b/.test(s) ? 2 : 0;
		return 0;
	};

	const priorityScore = (metricKey: keyof CanonicalMetrics, label: string, sheetName: string): number => {
		const l = normalizeLabel(label);
		const s = normalizeSheetName(sheetName);
		const hasTotal = l.includes("total");
		const isExactTotal = l === "total";

		const labelLooksRevenue = /\b(revenue|sales|net sales|turnover|income)\b/.test(l);
		const labelLooksExpense = /\b(expense|expenses|opex|operating expense|operating expenses|operating spend|sg&a|sga|cost)\b/.test(l);
		const sheetLooksRevenue = /\brevenue\b/.test(s);
		const sheetLooksExpense = /\b(valuation|allocation|expense|expenses|opex|operating)\b/.test(s);

		// Highest: total + explicit metric context (or sheet context)
		if (metricKey === "revenue") {
			if (hasTotal && (labelLooksRevenue || sheetLooksRevenue)) return 100;
			if (isExactTotal && sheetLooksRevenue) return 90;
			// Lower: revenue-like line items (e.g., Sales 1)
			if (labelLooksRevenue || sheetLooksRevenue) return 50;
			return 10;
		}

		if (metricKey === "expenses") {
			if (hasTotal && (labelLooksExpense || sheetLooksExpense)) return 100;
			if (isExactTotal && sheetLooksExpense) return 90;
			if (labelLooksExpense || sheetLooksExpense) return 50;
			return 10;
		}

		// Non-target metrics: preserve existing behavior (first-match wins) by keeping priority flat.
		return 10;
	};

	const addCandidate = (args: {
		sheetName: string;
		label: string;
		value: number;
		source_pointer: string;
	}) => {
		const metric_key = metricKeyFromLabelWithContext({ label: args.label, sheetName: args.sheetName });
		if (!metric_key) return;

		const c: Candidate = {
			metric_key,
			value: args.value,
			label: args.label,
			sheet_name: args.sheetName,
			source_pointer: args.source_pointer,
			priority: priorityScore(metric_key, args.label, args.sheetName),
			sheet_hint: sheetHintScore(metric_key, args.sheetName),
			order: ++orderCounter,
		};
		(candidatesByKey[metric_key] ||= []).push(c);
	};

	for (const sheet of sheets) {
		const sheetName = typeof sheet?.name === "string" ? sheet.name : "Sheet";
		const labelsSet = labelInventoryEnabled ? new Set<string>() : null;
		const matchedSet = labelInventoryEnabled ? new Map<string, keyof CanonicalMetrics>() : null;
		const noteLabel = (label: string) => {
			if (!labelInventoryEnabled) return;
			const trimmed = typeof label === "string" ? label.trim() : "";
			if (!trimmed) return;
			labelsSet!.add(trimmed);
			const key = labelToMetricKey(trimmed);
			if (key) matchedSet!.set(trimmed, key);
		};

		const rows: any[] = Array.isArray(sheet?.rows) ? sheet.rows : [];
		const headers: string[] = Array.isArray(sheet?.headers) ? sheet.headers : [];
		const tables: any[] = Array.isArray(sheet?.tables) ? sheet.tables : [];

		// 1) Prefer time-series tables when present (common in real financial models).
		for (const t of tables) {
			if (!t || t.kind !== "time_series") continue;
			const tRows: any[] = Array.isArray(t.rows) ? t.rows : [];
			const valueCols: any[] = Array.isArray(t.value_cols) ? t.value_cols : [];
			if (valueCols.length === 0 || tRows.length === 0) continue;

			// Pick the last column header as "latest".
			const lastHeader = String(valueCols[valueCols.length - 1]?.header ?? "").trim();
			if (!lastHeader) continue;

			for (let i = 0; i < tRows.length; i++) {
				const tr = tRows[i];
				const label = typeof tr?.label === "string" ? tr.label : "";
				if (!label.trim()) continue;
				noteLabel(label);
				const cell = tr?.values?.[lastHeader];
				const raw = cell?.value ?? null;
				const n = toNumberLoose(raw);
				if (n == null) continue;
				addCandidate({
					sheetName,
					label,
					value: n,
					source_pointer: `sheet=${sheetName} table=${JSON.stringify(t?.name ?? "time_series")} row_label=${JSON.stringify(label)} latest_col=${JSON.stringify(lastHeader)} value_raw=${JSON.stringify(raw)}`,
				});
			}
		}
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			const row = rows[rowIdx];
			if (!row || typeof row !== "object") continue;

			// Find a likely label cell (prefer first header, else any string cell)
			let label: string | null = null;
			if (headers.length > 0) {
				const v = (row as any)[headers[0]];
				if (typeof v === "string" && v.trim()) label = v;
			}
			if (!label) {
				for (const [k, v] of Object.entries(row)) {
					if (typeof v === "string" && v.trim().length >= 3) {
						label = v;
						break;
					}
				}
			}
			if (!label) continue;
			noteLabel(label);

			const key = metricKeyFromLabelWithContext({ label, sheetName });
			if (!key) continue;

			// Pick the "latest" numeric value in the row by scanning headers right-to-left.
			let picked: { col: string; col_idx: number; raw: unknown; value: number } | null = null;
			const cols = headers.length > 0 ? headers : Object.keys(row);
			for (let i = cols.length - 1; i >= 0; i--) {
				const col = cols[i];
				const rawVal = (row as any)[col];
				const n = toNumberLoose(rawVal);
				if (n == null) continue;
				picked = { col, col_idx: i + 1, raw: rawVal, value: n };
				break;
			}
			if (!picked) continue;

			const labelCol = headers.length > 0 ? headers[0] : "(unknown)";
			const snippet = {
				label,
				label_col: labelCol,
				value_col: picked.col,
				value_raw: picked.raw,
			};
			addCandidate({
				sheetName,
				label,
				value: picked.value,
				source_pointer: `sheet=${sheetName} row_idx=${rowIdx + 1} col=${JSON.stringify(picked.col)} col_idx=${picked.col_idx} snippet=${JSON.stringify(snippet)}`,
			});
		}

		if (labelInventoryEnabled) {
			labelInventory!.sheets.push({
				sheet_name: sheetName,
				labels: Array.from(labelsSet!).sort(),
				matched_labels: Array.from(matchedSet!.entries())
					.sort((a, b) => a[0].localeCompare(b[0]))
					.map(([label, metric_key]) => ({ label, metric_key })),
			});
		}
	}

	// Deterministically select the best candidate per metric key.
	for (const [k, list] of Object.entries(candidatesByKey) as Array<[keyof CanonicalMetrics, Candidate[]]>) {
		if (!list || list.length === 0) continue;
		const selected = list
			.slice()
			.sort((a, b) => {
				if (b.priority !== a.priority) return b.priority - a.priority;
				if (b.sheet_hint !== a.sheet_hint) return b.sheet_hint - a.sheet_hint;
				return a.order - b.order;
			})[0];

		(out as any)[k] = selected.value;
		evidence.push({ metric_key: k, value: selected.value, source_pointer: selected.source_pointer });
	}

	return labelInventoryEnabled ? { metrics: out, evidence, debug: { xlsx_label_inventory_v1: labelInventory } } : { metrics: out, evidence };
}

export function normalizeToCanonical(params: {
	contentType: DocumentAnalysis["contentType"];
	content: ExtractedContent | null;
	structuredData: DocumentAnalysis["structuredData"];
}): {
	structuredData: DocumentAnalysis["structuredData"] & CanonicalStructuredData;
	canonicalEvidence: CanonicalEvidenceDraft[];
} {
	const base = emptyCanonical();
	let canonicalEvidence: CanonicalEvidenceDraft[] = [];
	const canonical_metrics: CanonicalMetrics = { ...base.canonical.financials.canonical_metrics };

	if (params.contentType === "excel" && params.content) {
		const { metrics, evidence, debug } = extractExcelCanonical({ excel: params.content as any });
		Object.assign(canonical_metrics, metrics);
		canonicalEvidence = evidence;
		if (debug && typeof debug === "object") {
			const existingDebug = (params.structuredData as any)?.debug;
			(params.structuredData as any).debug = {
				...(existingDebug && typeof existingDebug === "object" ? existingDebug : {}),
				...debug,
			};
		}
	}

	// Derived metrics (deterministic)
	if (canonical_metrics.cash_balance != null) {
		const expenses = canonical_metrics.expenses;
		const revenue = canonical_metrics.revenue;
		if (expenses != null) {
			const burn = revenue != null ? expenses - revenue : expenses;
			if (canonical_metrics.burn_rate == null) {
				canonical_metrics.burn_rate = burn;
				canonicalEvidence.push({
					metric_key: "burn_rate",
					value: burn,
					source_pointer: `type=derived metric=burn_rate derived_from=${JSON.stringify({ expenses, revenue })}`,
				});
			}
			if (burn > 0 && canonical_metrics.runway_months == null) {
				canonical_metrics.runway_months = canonical_metrics.cash_balance / burn;
				canonicalEvidence.push({
					metric_key: "runway_months",
					value: canonical_metrics.runway_months,
					source_pointer: `type=derived metric=runway_months derived_from=${JSON.stringify({ cash_balance: canonical_metrics.cash_balance, burn_rate: burn })}`,
				});
			}
		}
	}

	return {
		structuredData: {
			...params.structuredData,
			canonical: {
				...base.canonical,
				financials: {
					canonical_metrics,
				},
			},
		},
		canonicalEvidence,
	};
}
