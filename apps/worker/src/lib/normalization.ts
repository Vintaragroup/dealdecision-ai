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

function labelToMetricKey(label: string): keyof CanonicalMetrics | null {
	const s = normalizeLabel(label);
	if (!s) return null;

	// Canonical metrics (deterministic, generic label matching)
	if (/(^|\b)(revenue|sales|net sales|turnover|income)\b/.test(s)) return "revenue";
	if (/(^|\b)(expenses|expense|opex|operating expense|operating expenses|sg&a|sga|operating spend)\b/.test(s)) return "expenses";
	if (/(^|\b)(cogs|cost of goods sold|cost of goods|cost of revenue)\b/.test(s)) return "cogs";
	if (/(^|\b)(cash balance|cash on hand|ending cash|beginning cash|cash)\b/.test(s)) return "cash_balance";
	if (/(^|\b)(gross margin|gm%|gross margin %)\b/.test(s)) return "gross_margin";
	return null;
}

function extractExcelCanonical(params: {
	excel: any;
}): { metrics: Partial<CanonicalMetrics>; evidence: CanonicalEvidenceDraft[] } {
	const excel = params.excel;
	const sheets: any[] = Array.isArray(excel?.sheets) ? excel.sheets : [];
	const out: Partial<CanonicalMetrics> = {};
	const evidence: CanonicalEvidenceDraft[] = [];

	for (const sheet of sheets) {
		const sheetName = typeof sheet?.name === "string" ? sheet.name : "Sheet";
		const rows: any[] = Array.isArray(sheet?.rows) ? sheet.rows : [];
		const headers: string[] = Array.isArray(sheet?.headers) ? sheet.headers : [];
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

			const key = labelToMetricKey(label);
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

			// First match wins for determinism across duplicate labels.
			if (out[key] == null) {
				(out as any)[key] = picked.value;
				const labelCol = headers.length > 0 ? headers[0] : "(unknown)";
				const snippet = {
					label,
					label_col: labelCol,
					value_col: picked.col,
					value_raw: picked.raw,
				};
				evidence.push({
					metric_key: key,
					value: picked.value,
					source_pointer: `sheet=${sheetName} row_idx=${rowIdx + 1} col=${JSON.stringify(picked.col)} col_idx=${picked.col_idx} snippet=${JSON.stringify(snippet)}`,
				});
			}
		}
	}

	return { metrics: out, evidence };
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
		const { metrics, evidence } = extractExcelCanonical({ excel: params.content as any });
		Object.assign(canonical_metrics, metrics);
		canonicalEvidence = evidence;
	}

	// Derived metrics (deterministic)
	if (canonical_metrics.cash_balance != null) {
		const expenses = canonical_metrics.expenses;
		const revenue = canonical_metrics.revenue;
		if (expenses != null) {
			const burn = revenue != null ? expenses - revenue : expenses;
			canonical_metrics.burn_rate = burn;
			canonicalEvidence.push({
				metric_key: "burn_rate",
				value: burn,
				source_pointer: `type=derived metric=burn_rate derived_from=${JSON.stringify({ expenses, revenue })}`,
			});
			if (burn > 0) {
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
