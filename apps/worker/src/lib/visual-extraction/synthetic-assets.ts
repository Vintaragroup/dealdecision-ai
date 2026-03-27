// visual-extraction/synthetic-assets.ts
// toTextLoose, Excel analysis helpers, inferSegmentKeyFromStructured,
// resegmentStructuredSyntheticAssets, applyVisionHintsToStructuredPowerpointSlides,
// persistSyntheticVisualAssets, enqueueExtractVisualsIfPossible,
// buildExtractVisualsFinalizedMarker — verbatim extraction.

import type { Pool } from "pg";
import { createHash } from "crypto";
import { sanitizeText } from "@dealdecision/core";
import { makeJobId, sanitizeJobId } from "../job-id";
import type {
    VisionExtractorConfig,
    VisionJobRuntime,
    VisionAsset,
    VisionExtractResponse,
    ExtractVisualsFinalizedMarker,
} from "./types";
import {
    coerceSegmentKey,
    classifySegmentKeyFromText,
    parseBool,
    SEGMENT_KEYS,
    type SegmentKey,
} from "./_shared";
import { resolvePageImageUris } from "./page-uri-resolver";
import {
    getVisionExtractorConfig,
    createVisionJobRuntime,
    callVisionWorker,
    callVisionWorkerWithRetries,
} from "./vision-worker-client";
import { persistVisionResponse } from "./visual-persistence";
import fs from "fs/promises";

let didWarnVisualExtractionDisabled = false;

type LogLike = Pick<Console, "log" | "warn" | "error">;
type FsLike = Pick<typeof fs, "readdir" | "stat">;

type SyntheticAssetBuild = {
	pageIndex: number;
	asset: VisionAsset;
};

function hashKey(parts: Array<string | number>): string {
	return createHash("sha256").update(parts.map((p) => String(p)).join("|"), "utf8").digest("hex");
}

export function toTextLoose(node: unknown): string {
	const seen = new WeakSet<object>();

	const stripPoison = (s: string) => {
		// Never allow implicit object stringification markers to leak into classifier text.
		const cleaned = s.replace(/\[object Object\]/g, " ");
		return cleaned.replace(/\s+/g, " ").trim();
	};

	const walk = (value: unknown, depth: number): string => {
		if (value == null) return "";
		if (typeof value === "string") return stripPoison(value);
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		if (Array.isArray(value)) {
			const parts = value.map((v) => walk(v, depth - 1)).filter(Boolean);
			return stripPoison(parts.join("\n"));
		}
		if (typeof value !== "object") return "";
		if (depth <= 0) return "";

		const obj = value as any;
		if (seen.has(obj)) return "";
		seen.add(obj);

		const parts: string[] = [];

		// Common direct keys.
		for (const k of ["text", "value", "content"]) {
			const v = obj?.[k];
			const t = walk(v, depth - 1);
			if (t) parts.push(t);
		}

		// Common rich-text container keys.
		if (Array.isArray(obj?.runs)) {
			const runText = obj.runs.map((r: any) => walk(r, depth - 1)).filter(Boolean).join("");
			if (runText) parts.push(stripPoison(runText));
		}

		for (const k of ["children", "items", "elements"]) {
			if (!Array.isArray(obj?.[k])) continue;
			const t = (obj[k] as any[]).map((c) => walk(c, depth - 1)).filter(Boolean).join("\n");
			if (t) parts.push(stripPoison(t));
		}

		return stripPoison(parts.join("\n"));
	};

	return walk(node, 8);
}

function cleanTextForClassification(input: unknown): string {
	const raw = toTextLoose(input);
	if (!raw) return "";
	// Guard: strip any remaining poisoning artifacts (defensive in case upstream already persisted it).
	return raw.replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
}

type ExcelSheetUnderstandingV1 = {
	schema_version: "excel_sheet_understanding_v1";
	sheet_name: string;
	detected_type:
		| "revenue"
		| "expenses"
		| "cash_flow"
		| "use_of_funds"
		| "valuation"
		| "cap_table"
		| "financial_model"
		| "unknown";
	confidence: number; // 0..1
	segment_key?: SegmentKey;

	metrics_v1?: ExcelSheetMetricsV1;

	structure: {
		row_count?: number;
		header_count?: number;
		headers_sample: string[];
		row_labels_sample: string[];
		numeric_columns_sample: string[];
	};

	time: {
		granularity: "monthly" | "quarterly" | "annual" | "unknown";
		headers_detected: boolean;
		time_headers_sample: string[];
	};

	units: {
		currency_hint: string | null;
	};

	flags: string[];
};

type ExcelTimeSeriesTableLite = {
	kind?: string;
	name?: string;
	label_col?: string;
	value_cols: Array<{ col: string; header: string }>;
	rows: Array<{ label: string; values: Record<string, { value?: unknown; formula?: string }> }>;
};
type ExcelSheetMetricsV1 = {
	schema_version: "excel_sheet_metrics_v1";
	source: "time_series_table" | "sheet_rows" | "grid_preview" | "none";

	time_series?: {
		period_count: number;
		first_period_label: string | null;
		last_period_label: string | null;
		granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	};

	key_series?: {
		label: string;
		start_value: number | null;
		end_value: number | null;
		growth_pct: number | null;
		start_period_label: string | null;
		end_period_label: string | null;
		missing_ratio: number;
	};

	distribution?: {
		total_value: number;
		top_categories: Array<{ label: string; value: number; pct_of_total: number }>;
		percent_column_sum?: { value: number; expected: 1 | 100; within_tolerance: boolean };
	};

	quality: {
		numeric_cells: number;
		total_cells_scanned: number;
		numeric_ratio: number;
	};

	flags: string[];
};

function parseExcelNumeric(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value !== "string") return null;
	let t = value.trim();
	if (!t) return null;
	// Handle (123) negative accounting format.
	let negative = false;
	if (/^\(.*\)$/.test(t)) {
		negative = true;
		t = t.replace(/^\(|\)$/g, "");
	}
	// Remove currency symbols and thousand separators.
	t = t.replace(/[$€£,\s]/g, "");
	if (!t) return null;
	let isPercent = false;
	if (/%$/.test(t)) {
		isPercent = true;
		t = t.replace(/%$/, "");
	}
	// Common suffixes like k/m/b.
	let multiplier = 1;
	if (/^[+-]?[0-9]*\.?[0-9]+[kmb]$/i.test(t)) {
		const suffix = t.slice(-1).toLowerCase();
		t = t.slice(0, -1);
		if (suffix === "k") multiplier = 1_000;
		if (suffix === "m") multiplier = 1_000_000;
		if (suffix === "b") multiplier = 1_000_000_000;
	}
	const n = Number(t);
	if (!Number.isFinite(n)) return null;
	let out = n * multiplier;
	if (isPercent) out = out / 100;
	if (negative) out = -out;
	return out;
}

function formatCompactNumber(n: number, currencyHint: string | null): string {
	const abs = Math.abs(n);
	const sign = n < 0 ? "-" : "";
	const prefix = currencyHint === "USD" ? "$" : currencyHint === "EUR" ? "€" : currencyHint === "GBP" ? "£" : "";
	const fmt = (v: number, suffix: string) => `${sign}${prefix}${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${suffix}`;
	if (abs >= 1_000_000_000) return fmt(abs / 1_000_000_000, "B");
	if (abs >= 1_000_000) return fmt(abs / 1_000_000, "M");
	if (abs >= 1_000) return fmt(abs / 1_000, "K");
	return `${sign}${prefix}${abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}`;
}

function formatPct(p: number): string {
	return `${(p * 100).toFixed(Math.abs(p) >= 1 ? 0 : 1)}%`;
}

function parseTimeSortKey(header: string): { sortKey: number | null; label: string } {
	const raw = cleanTextForClassification(header);
	const t = raw.toLowerCase();
	if (!t) return { sortKey: null, label: raw };

	// Month N
	const mN = t.match(/^month\s*(\d+)\b/);
	if (mN) return { sortKey: Number(mN[1]), label: raw };

	// Month name
	const monthMap: Record<string, number> = {
		jan: 1,
		january: 1,
		feb: 2,
		february: 2,
		mar: 3,
		march: 3,
		apr: 4,
		april: 4,
		may: 5,
		jun: 6,
		june: 6,
		jul: 7,
		july: 7,
		aug: 8,
		august: 8,
		sep: 9,
		september: 9,
		oct: 10,
		october: 10,
		nov: 11,
		november: 11,
		dec: 12,
		december: 12,
	};
	if (monthMap[t] != null) return { sortKey: monthMap[t], label: raw };

	// Quarter (optionally with year)
	const q = t.match(/\bq([1-4])\b(?:\s*(\d{4}))?/);
	if (q) {
		const qn = Number(q[1]);
		const yr = q[2] ? Number(q[2]) : 0;
		return { sortKey: yr ? yr * 10 + qn : qn, label: raw };
	}

	// FY / Year
	const fy = t.match(/^fy\s*(\d{2,4})$/);
	if (fy) {
		let year = Number(fy[1]);
		if (year < 100) year = 2000 + year;
		return { sortKey: year, label: raw };
	}
	const year = t.match(/^(\d{4})$/);
	if (year) return { sortKey: Number(year[1]), label: raw };

	return { sortKey: null, label: raw };
}

function buildMetricsFromTimeSeriesTable(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	table: ExcelTimeSeriesTableLite;
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cols = Array.isArray(input.table?.value_cols) ? input.table.value_cols : [];
	const rows = Array.isArray(input.table?.rows) ? input.table.rows : [];

	const colMeta = cols
		.map((c) => {
			const header = cleanTextForClassification(c?.header ?? c?.col);
			const parsed = parseTimeSortKey(header);
			return { col: String(c?.col ?? ""), header, sortKey: parsed.sortKey, label: parsed.label };
		})
		.filter((c) => c.col);

	// Keep original order if we cannot sort meaningfully.
	const canSort = colMeta.some((c) => c.sortKey != null);
	const ordered = canSort
		? [...colMeta].sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		})
		: colMeta;

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (!label.trim()) return 0;
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "expenses") {
			if (/\b(total\s*)?(expense|opex|cogs)\b/.test(label)) return 6;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "cash_flow") {
			if (/\b(cash\s*flow|burn|runway|cash\s*balance)\b/.test(label)) return 6;
		}
		return 1;
	};

	type SeriesCandidate = {
		label: string;
		values: Array<number | null>;
		missing: number;
		numericCount: number;
		score: number;
		endValue: number | null;
	};
	let best: SeriesCandidate | null = null;
	let bestAny: SeriesCandidate | null = null;

	let numericCells = 0;
	let totalCells = 0;

	const isLikelyRatioRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(retention|ratio|margin|%|percent|pct)\b/.test(t);
	};

	const isLikelyTotalRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(total|subtotal|sum)\b/.test(t);
	};

	const isLikelyHeaderRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		// Avoid selecting section headers like "Revenue" with no values.
		return /^(revenue|sales|expenses|opex|cogs|cash\s*flow|runway|burn)$/i.test(t);
	};

	const computeCandidate = (r: any): SeriesCandidate => {
		const label = cleanTextForClassification(r?.label);
		const series: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (const c of ordered) {
			totalCells += 1;
			// NOTE: excel.ts stores time-series row values keyed by the header string (e.g. "Month 1"),
			// not by the column letter. Prefer header key and fall back to column letter.
			const valuesObj = (r as any)?.values ?? {};
			const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
			const n = parseExcelNumeric(cell?.value);
			if (n == null) missing += 1;
			else {
				numericCells += 1;
				numericCount += 1;
				endValue = n;
			}
			series.push(n);
		}
		const score = pickRowScore(label);
		return { label, values: series, missing, numericCount, score, endValue };
	};

	for (const r of rows.slice(0, 120)) {
		const cand = computeCandidate(r);
		// Track best-any regardless of data coverage (debugging / fallback)
		if (!bestAny) bestAny = cand;
		else {
			const betterScore = cand.score > bestAny.score;
			const betterEnd = (cand.endValue ?? -Infinity) > (bestAny.endValue ?? -Infinity);
			const fewerMissing = cand.missing < bestAny.missing;
			if (betterScore || (cand.score === bestAny.score && (betterEnd || fewerMissing))) {
				bestAny = cand;
			}
		}

		// Only consider as key series if it has enough numeric coverage.
		// NOTE: do not exclude labels like "Revenue" here; many real sheets have a numeric Revenue row.
		const viable = cand.numericCount >= 2;
		if (!viable) continue;
		if (!best) best = cand;
		else {
			// Prefer higher semantic score, then higher numeric coverage, then fewer missing.
			const betterScore = cand.score > best.score;
			const betterCoverage = cand.numericCount > best.numericCount;
			const fewerMissing = cand.missing < best.missing;
			if (betterScore || (cand.score === best.score && (betterCoverage || fewerMissing))) {
				best = cand;
			}
		}
	}

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "time_series_table",
		time_series: {
			period_count: periodCount,
			first_period_label: firstPeriod,
			last_period_label: lastPeriod,
			granularity: input.granularity,
		},
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	// If the expected headline row (e.g. "Revenue") exists but has no values, derive a usable series from line items.
	const maybeDeriveSumSeries = (): SeriesCandidate | null => {
		if (periodCount < 2) return null;
		if (input.detectedType !== "revenue" && input.detectedType !== "expenses" && input.detectedType !== "cash_flow") return null;

		// Build per-row numeric series once for summation.
		const candidates: Array<{ label: string; values: Array<number | null>; numericCount: number }> = [];
		for (const r of rows.slice(0, 150)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (isLikelyRatioRowLabel(label)) continue;
			if (isLikelyTotalRowLabel(label)) continue;
			// Do not include blank header-like rows (they tend to be section labels).
			if (isLikelyHeaderRowLabel(label)) continue;
			const valuesObj = (r as any)?.values ?? {};
			const series = ordered.map((c) => {
				const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
				return parseExcelNumeric(cell?.value);
			});
			const numericCount = series.filter((v) => v != null).length;
			if (numericCount < 2) continue;
			candidates.push({ label, values: series, numericCount });
		}
		if (candidates.length < 2) return null;

		const sumSeries: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (let i = 0; i < periodCount; i++) {
			let s = 0;
			let count = 0;
			for (const r of candidates) {
				const v = r.values[i];
				if (v == null) continue;
				s += v;
				count += 1;
			}
			if (count === 0) {
				missing += 1;
				sumSeries.push(null);
			} else {
				numericCount += 1;
				endValue = s;
				sumSeries.push(s);
			}
		}

		const label = input.detectedType === "expenses" ? "Estimated total expenses (sum of line items)" : "Estimated total (sum of line items)";
		return { label, values: sumSeries, missing, numericCount, score: 2, endValue };
	};

	// If we're a revenue/expenses/cash-flow sheet and the semantic "total" row is present but empty,
	// a derived sum-of-lines series is usually a better investor-facing headline than picking a random line item.
	const derivedPreferred = (() => {
		const derived = maybeDeriveSumSeries();
		if (!derived) return null;
		if (!bestAny) return null;
		if (bestAny.numericCount >= 2) return null;
		// Only prefer derivation when the strongest semantic match is a header-ish total row with no values.
		if (bestAny.score < 4) return null;
		if (!isLikelyHeaderRowLabel(bestAny.label)) return null;
		return derived;
	})();

	if ((derivedPreferred || best) && periodCount >= 2) {
		const chosen = derivedPreferred ?? best!;
		const firstIdx = chosen.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = chosen.values.length - 1; i >= 0; i--) if (chosen.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (chosen.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (chosen.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? chosen.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

		metrics.key_series = {
			label: chosen.label || "(unlabeled)",
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (derivedPreferred) flags.push("derived_key_series_sum_of_rows");

		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${chosen.label || "Key series"} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(
				`metrics_v1(time_series_table): key_series=${chosen.label || "(unlabeled)"}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
			);
		} else {
			analystEvidence.push(
				`metrics_v1(time_series_table): selected key_series=${chosen.label || "(unlabeled)"}, but could not compute start/end (insufficient numeric values).`
			);
			flags.push("key_series_missing_values");
		}
	}

	// Fallback: if no viable series was found, try deriving a series from row sums.
	if (!metrics.key_series && (!best || (best.numericCount < 2 && periodCount >= 2)) && periodCount >= 2) {
		const derived = maybeDeriveSumSeries();
		if (derived) {
			const firstIdx = derived.values.findIndex((v) => v != null);
			const lastIdx = (() => {
				for (let i = derived.values.length - 1; i >= 0; i--) if (derived.values[i] != null) return i;
				return -1;
			})();
			const start = firstIdx >= 0 ? (derived.values[firstIdx] as number) : null;
			const end = lastIdx >= 0 ? (derived.values[lastIdx] as number) : null;
			const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
			const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
			const missingRatio = periodCount > 0 ? derived.missing / periodCount : 1;
			let growthPct: number | null = null;
			if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

			metrics.key_series = {
				label: derived.label,
				start_value: start,
				end_value: end,
				growth_pct: growthPct,
				start_period_label: startLabel ?? null,
				end_period_label: endLabel ?? null,
				missing_ratio: missingRatio,
			};
			flags.push("derived_key_series_sum_of_rows");
			if (start != null && end != null) {
				investorEvidence.push(
					`${derived.label} changes from ${formatCompactNumber(start, input.currencyHint)} to ${formatCompactNumber(end, input.currencyHint)} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthPct != null ? ` (${formatPct(growthPct)} change)` : ""}.`
				);
				analystEvidence.push(
					`metrics_v1(time_series_table): derived key_series from sum of line items; periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
				);
			} else {
				analystEvidence.push(
					"metrics_v1(time_series_table): attempted to derive a key series from row sums, but still could not compute start/end."
				);
				flags.push("key_series_missing_values");
			}
		}
	}

	if (metrics.quality.numeric_ratio < 0.15) flags.push("low_numeric_ratio");
	if (periodCount > 0 && metrics.key_series && metrics.key_series.missing_ratio > 0.5) flags.push("high_missing_ratio");

	return { metrics, investorEvidence, analystEvidence };
}

function buildMetricsFromGridPreview(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	headers: string[];
	gridCells: any[];
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	// Attempt: header row is row 1.
	const headerCols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < Math.min(20, input.headers.length); i++) {
		const colLetter = String.fromCharCode("A".charCodeAt(0) + i);
		const addr = `${colLetter}1`;
		const c = byAddr.get(addr);
		const h = cleanTextForClassification(c?.w ?? c?.v ?? input.headers[i]);
		if (!h) continue;
		headerCols.push({ col: colLetter, header: h });
	}

	const numericCols = headerCols.filter((c) => isMonthHeaderToken(c.header) || /\b(month|q[1-4]|fy|\d{4})\b/i.test(c.header));
	const ordered = numericCols
		.map((c) => ({ ...c, ...parseTimeSortKey(c.header) }))
		.sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		});

	let numericCells = 0;
	let totalCells = 0;

	// Find a candidate label row (prefer row 2..15).
	const candidateRows: Array<{ row: number; label: string; values: Array<number | null>; missing: number }> = [];
	for (let rr = 2; rr <= 18; rr++) {
		const labelCell = byAddr.get(`A${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v);
		if (!label) continue;
		const values: Array<number | null> = [];
		let missing = 0;
		for (const c of ordered) {
			totalCells += 1;
			const vCell = byAddr.get(`${c.col}${rr}`);
			const n = parseExcelNumeric(vCell?.v ?? vCell?.w);
			if (n == null) missing += 1;
			else numericCells += 1;
			values.push(n);
		}
		candidateRows.push({ row: rr, label, values, missing });
	}

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
		}
		if (input.detectedType === "use_of_funds") {
			if (/\b(total|sum)\b/.test(label)) return 3;
		}
		return 1;
	};

	let best = candidateRows
		.map((r) => ({ ...r, score: pickRowScore(r.label) }))
		.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			const aEnd = (() => {
				for (let i = a.values.length - 1; i >= 0; i--) if (a.values[i] != null) return a.values[i] as number;
				return -Infinity;
			})();
			const bEnd = (() => {
				for (let i = b.values.length - 1; i >= 0; i--) if (b.values[i] != null) return b.values[i] as number;
				return -Infinity;
			})();
			return bEnd - aEnd;
		})[0];

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "grid_preview",
		time_series: periodCount
			? { period_count: periodCount, first_period_label: firstPeriod, last_period_label: lastPeriod, granularity: input.granularity }
			: undefined,
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	if (best && periodCount >= 2) {
		const firstIdx = best.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = best.values.length - 1; i >= 0; i--) if (best.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (best.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (best.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? best.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);
		metrics.key_series = {
			label: best.label,
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${best.label} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(`metrics_v1(grid_preview): key_series=${best.label}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`);
		}
	}

	if (metrics.quality.numeric_ratio < 0.08) flags.push("low_numeric_ratio");
	return { metrics, investorEvidence, analystEvidence };
}

function buildUseOfFundsDistributionFromSheetRows(input: {
	headers: string[];
	rows: Array<Record<string, unknown>>;
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const rows = Array.isArray(input.rows) ? input.rows : [];
	if (headers.length === 0 || rows.length === 0) {
		return { distribution: null, flags: ["use_of_funds:no_headers_or_rows"], evidence: { investor, analyst } };
	}

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "categories", "purpose", "use", "allocation", "item", "line item", "metric", "description", "col_a", "col a", "label"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share", "portion"];

	const headerScores = headers.map((h) => {
		const n = headerNorm(h);
		const labelScore = labelHints.some((k) => n.includes(k)) ? 3 : 0;
		const amountScore = amountHints.some((k) => n.includes(k)) ? 2 : 0;
		const pctScore = pctHints.some((k) => n.includes(k)) ? 2 : 0;
		return { h, n, labelScore, amountScore, pctScore };
	});

	const getColumnStats = (header: string) => {
		let numericCount = 0;
		let total = 0;
		let max = -Infinity;
		let sum = 0;
		for (const r of rows.slice(0, 250)) {
			const v = (r as any)?.[header];
			const n = parseExcelNumeric(v);
			total += 1;
			if (n == null) continue;
			numericCount += 1;
			sum += n;
			if (n > max) max = n;
		}
		return {
			numericCount,
			total,
			numericRatio: total > 0 ? numericCount / total : 0,
			max: numericCount > 0 ? max : null,
			sum: numericCount > 0 ? sum : 0,
		};
	};

	let labelCol = headerScores.sort((a, b) => b.labelScore - a.labelScore).find((s) => s.labelScore > 0)?.h;
	if (!labelCol) labelCol = headers[0];

	const candidates = headers.map((h) => ({ h, stats: getColumnStats(h), score: headerScores.find((s) => s.h === h) }));
	const amountCol = candidates
		.map((c) => {
			const hint = c.score?.amountScore ?? 0;
			const statScore = c.stats.numericRatio;
			const magnitudeScore = c.stats.max != null ? Math.min(3, Math.log10(Math.max(1, Math.abs(c.stats.max))) / 2) : 0;
			return { h: c.h, totalScore: hint + statScore + magnitudeScore };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	const pctCol = candidates
		.map((c) => {
			const hint = c.score?.pctScore ?? 0;
			if (c.stats.numericRatio < 0.3 || c.stats.max == null) return { h: c.h, totalScore: -1 };
			const max = Math.abs(c.stats.max);
			const rangeScore = max <= 1.2 ? 3 : max <= 120 ? 2 : 0;
			return { h: c.h, totalScore: hint + rangeScore + c.stats.numericRatio };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col"], evidence: { investor, analyst } };

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (const r of rows.slice(0, 500)) {
		const labelRaw = cleanTextForClassification((r as any)?.[labelCol]);
		if (!labelRaw) continue;
		const label = labelRaw.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const value = parseExcelNumeric((r as any)?.[amountCol]);
		if (value == null) continue;
		const pctRaw = pctCol ? parseExcelNumeric((r as any)?.[pctCol]) : null;
		items.push({ label, value, pctRaw });
		if (items.length >= 120) break;
	}
	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(6, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.03 : Math.abs(sum - 100) <= 3;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function buildUseOfFundsDistributionFromGridPreview(input: {
	headers: string[];
	gridCells: any[];
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	if (cells.length === 0) return { distribution: null, flags: ["use_of_funds:no_grid_preview"], evidence: { investor, analyst } };

	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const maxCols = Math.min(12, Math.max(3, headers.length));

	const getHeaderAt = (colLetter: string): string => {
		const c = byAddr.get(`${colLetter}1`);
		const h = cleanTextForClassification(c?.w ?? c?.v);
		if (h) return h;
		const idx = colLetter.charCodeAt(0) - "A".charCodeAt(0);
		return headers[idx] ?? colLetter;
	};

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "purpose", "allocation", "item", "description", "metric", "label", "col a", "col_a"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share"];

	// Determine candidate columns A.. up to maxCols.
	const cols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < maxCols; i++) {
		cols.push({ col: String.fromCharCode("A".charCodeAt(0) + i), header: getHeaderAt(String.fromCharCode("A".charCodeAt(0) + i)) });
	}

	const colScores = cols.map((c) => {
		const n = headerNorm(c.header);
		return {
			...c,
			labelScore: labelHints.some((k) => n.includes(k)) ? 3 : 0,
			amountScore: amountHints.some((k) => n.includes(k)) ? 2 : 0,
			pctScore: pctHints.some((k) => n.includes(k)) ? 2 : 0,
		};
	});

	let labelCol = colScores.sort((a, b) => b.labelScore - a.labelScore)[0]?.col ?? "A";
	if (!labelCol) labelCol = "A";

	// Score amount column by numeric density in rows 2..18.
	const amountCandidates = cols
		.filter((c) => c.col !== labelCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const headerHint = colScores.find((s) => s.col === c.col)?.amountScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const mag = Number.isFinite(max) ? Math.min(3, Math.log10(Math.max(1, Math.abs(max))) / 2) : 0;
			return { col: c.col, header: c.header, score: headerHint + density + mag };
		})
		.sort((a, b) => b.score - a.score);

	const amountCol = amountCandidates[0]?.col;
	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col_grid"], evidence: { investor, analyst } };

	// Percent column detection.
	const pctCandidates = cols
		.filter((c) => c.col !== labelCol && c.col !== amountCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const hint = colScores.find((s) => s.col === c.col)?.pctScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const rangeScore = Number.isFinite(max) ? (Math.abs(max) <= 1.2 ? 3 : Math.abs(max) <= 120 ? 2 : 0) : 0;
			return { col: c.col, header: c.header, score: hint + density + rangeScore };
		})
		.sort((a, b) => b.score - a.score);
	const pctCol = pctCandidates[0]?.score > 1.5 ? pctCandidates[0].col : null;

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (let rr = 2; rr <= 40; rr++) {
		const labelCell = byAddr.get(`${labelCol}${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v)?.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const valueCell = byAddr.get(`${amountCol}${rr}`);
		const value = parseExcelNumeric(valueCell?.v ?? valueCell?.w);
		if (value == null) continue;
		const pct = pctCol ? parseExcelNumeric(byAddr.get(`${pctCol}${rr}`)?.v ?? byAddr.get(`${pctCol}${rr}`)?.w) : null;
		items.push({ label, value, pctRaw: pct });
		if (items.length >= 40) break;
	}

	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items_grid"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total_grid"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(4, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.05 : Math.abs(sum - 100) <= 5;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds:grid_preview): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function isMonthHeaderToken(s: string): boolean {
	const t = String(s ?? "").trim().toLowerCase();
	if (!t) return false;
	if (/^month\s*\d+\b/.test(t)) return true;
	if (/^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/.test(t)) return true;
	if (/\bq[1-4]\b/.test(t)) return true;
	if (/^fy\s*\d{2,4}$/.test(t)) return true;
	if (/^\d{4}$/.test(t)) return true;
	return false;
}

function inferExcelDetectedType(textRaw: string): { type: ExcelSheetUnderstandingV1["detected_type"]; confidence: number; flags: string[] } {
	const t = String(textRaw ?? "").toLowerCase();
	const flags: string[] = [];
	if (!t.trim()) return { type: "unknown", confidence: 0.3, flags };

	const hasRevenue = /\b(revenue|revenues|sales|arr|mrr)\b/.test(t);
	const hasExpenses = /\b(expense|expenses|opex|operating expense|cogs|cost of goods)\b/.test(t);
	const hasCashFlow = /\b(cash flow|cashflow|burn|runway|cash balance)\b/.test(t);
	const hasUseOfFunds = /\b(use of funds|allocation of funds|funds allocation)\b/.test(t);
	const hasValuation = /\b(valuation|pre-money|post-money|waterfall|return multiple|exit)\b/.test(t);
	const hasCapTable = /\b(cap table|captable|ownership|dilution|option pool|share)\b/.test(t);

	if (hasUseOfFunds) return { type: "use_of_funds", confidence: 0.9, flags: ["matched:use_of_funds"] };
	if (hasCapTable) return { type: "cap_table", confidence: 0.85, flags: ["matched:cap_table"] };
	if (hasValuation) return { type: "valuation", confidence: 0.85, flags: ["matched:valuation"] };
	if (hasCashFlow) return { type: "cash_flow", confidence: 0.8, flags: ["matched:cash_flow"] };
	if (hasRevenue && !hasExpenses) return { type: "revenue", confidence: 0.75, flags: ["matched:revenue"] };
	if (hasExpenses && !hasRevenue) return { type: "expenses", confidence: 0.75, flags: ["matched:expenses"] };
	if (hasRevenue && hasExpenses) return { type: "financial_model", confidence: 0.7, flags: ["matched:revenue+expenses"] };

	return { type: "financial_model", confidence: 0.55, flags: ["default:financial_model"] };
}

function inferCurrencyHint(textRaw: string): string | null {
	const t = String(textRaw ?? "");
	if (!t) return null;
	if (/(\$|usd\b)/i.test(t)) return "USD";
	if (/(€|eur\b)/i.test(t)) return "EUR";
	if (/(£|gbp\b)/i.test(t)) return "GBP";
	return null;
}

function buildExcelSheetUnderstandingV1(input: {
	sheetName: string;
	segmentKey?: SegmentKey;
	headers: string[];
	rowCount?: number;
	numericColumns: string[];
	gridCells: any[];
	table?: ExcelTimeSeriesTableLite;
	sheetRows?: Array<Record<string, unknown>>;
}): { understanding: ExcelSheetUnderstandingV1; investor_summary: string; analyst_summary: string } {
	const headersSample = (Array.isArray(input.headers) ? input.headers : []).slice(0, 18).map((h) => cleanTextForClassification(h)).filter(Boolean);
	const numericColumnsSample = (Array.isArray(input.numericColumns) ? input.numericColumns : []).slice(0, 10).map((h) => cleanTextForClassification(h)).filter(Boolean);

	const colALabels: string[] = [];
	for (const c of Array.isArray(input.gridCells) ? input.gridCells : []) {
		const addr = typeof c?.a === "string" ? c.a : "";
		if (!addr) continue;
		// Prefer column A labels as the most common “row label” column.
		if (!/^A\d+$/i.test(addr)) continue;
		const label = cleanTextForClassification(c?.w ?? c?.v);
		if (!label) continue;
		// Skip obvious header-ish tokens
		if (isMonthHeaderToken(label)) continue;
		if (!colALabels.includes(label)) colALabels.push(label);
		if (colALabels.length >= 12) break;
	}

	// If there is no grid preview (common for structured-native Excel), fall back to table row labels.
	if (colALabels.length === 0 && input.table && Array.isArray(input.table.rows) && input.table.rows.length > 0) {
		for (const r of input.table.rows.slice(0, 18)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (!colALabels.includes(label)) colALabels.push(label);
			if (colALabels.length >= 12) break;
		}
	}

	const classifyText = [
		input.sheetName ? `sheet: ${input.sheetName}` : "",
		headersSample.length ? `headers: ${headersSample.join(" ")}` : "",
		numericColumnsSample.length ? `numeric: ${numericColumnsSample.join(" ")}` : "",
		colALabels.length ? `labels: ${colALabels.join(" ")}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const detected = inferExcelDetectedType(classifyText);
	const currencyHint = inferCurrencyHint(classifyText);

	const timeHeadersSample = headersSample.filter(isMonthHeaderToken).slice(0, 10);
	const timeHeadersDetected = timeHeadersSample.length >= 2;
	let granularity: ExcelSheetUnderstandingV1["time"]["granularity"] = "unknown";
	if (timeHeadersDetected) {
		const joined = timeHeadersSample.join(" ").toLowerCase();
		if (/(month\s*\d+|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(joined)) granularity = "monthly";
		else if (/\bq[1-4]\b/.test(joined)) granularity = "quarterly";
		else if (/\b\d{4}\b|\bfy\b/.test(joined)) granularity = "annual";
	}

	const baseFlags = [
		...detected.flags,
		...(timeHeadersDetected ? ["time_headers_detected"] : ["time_headers_missing"]),
		...(currencyHint ? [`currency:${currencyHint}`] : []),
	].filter(Boolean);

	let metrics: ExcelSheetMetricsV1 | undefined;
	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];
	if (input.table && Array.isArray(input.table.value_cols) && Array.isArray(input.table.rows) && input.table.value_cols.length >= 2) {
		const res = buildMetricsFromTimeSeriesTable({
			detectedType: detected.type,
			granularity,
			currencyHint,
			table: input.table,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	} else if (Array.isArray(input.gridCells) && input.gridCells.length > 0) {
		const res = buildMetricsFromGridPreview({
			detectedType: detected.type,
			granularity,
			currencyHint,
			headers: input.headers,
			gridCells: input.gridCells,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	}

	// For use-of-funds style sheets, compute a distribution summary from sheet rows if available.
	if (detected.type === "use_of_funds" && Array.isArray(input.sheetRows) && input.sheetRows.length > 0) {
		const dist = buildUseOfFundsDistributionFromSheetRows({
			headers: Array.isArray(input.headers) ? input.headers : [],
			rows: input.sheetRows,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "sheet_rows",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
				// If we already had another source, keep it but mark the distribution came from rows.
				if (metrics.source === "grid_preview" || metrics.source === "time_series_table") metrics.source = "sheet_rows";
			}
			// For use-of-funds, distribution evidence is usually the most relevant.
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	// Fallback: if we couldn't compute distribution from rows, try the grid preview.
	if (detected.type === "use_of_funds" && (!metrics?.distribution || metrics.distribution.top_categories.length === 0) && Array.isArray(input.gridCells)) {
		const dist = buildUseOfFundsDistributionFromGridPreview({
			headers: Array.isArray(input.headers) ? input.headers : [],
			gridCells: input.gridCells,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "grid_preview",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
			}
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	const flags = [
		...baseFlags,
		...(metrics?.flags?.length
			? metrics.flags.map((f) => {
				const cleaned = String(f || "").replace(/^metrics:/, "");
				return cleaned ? `metrics:${cleaned}` : "";
			})
			: []),
	].filter(Boolean);

	const understanding: ExcelSheetUnderstandingV1 = {
		schema_version: "excel_sheet_understanding_v1",
		sheet_name: input.sheetName,
		detected_type: detected.type,
		confidence: Math.max(0.05, Math.min(1, detected.confidence)),
		segment_key: input.segmentKey,
		metrics_v1: metrics,
		structure: {
			row_count: typeof input.rowCount === "number" ? input.rowCount : undefined,
			header_count: Array.isArray(input.headers) ? input.headers.length : undefined,
			headers_sample: headersSample,
			row_labels_sample: colALabels,
			numeric_columns_sample: numericColumnsSample,
		},
		time: {
			granularity,
			headers_detected: timeHeadersDetected,
			time_headers_sample: timeHeadersSample,
		},
		units: {
			currency_hint: currencyHint,
		},
		flags,
	};

	const rowCountText = typeof understanding.structure.row_count === "number" ? `${understanding.structure.row_count}` : "an unknown number of";
	const headerCountText = typeof understanding.structure.header_count === "number" ? `${understanding.structure.header_count}` : "an unknown number of";
	const typeLabel = understanding.detected_type.replace(/_/g, " ");
	const timeText = understanding.time.headers_detected
		? `It appears to be organized as a ${understanding.time.granularity} time series.`
		: "Time-series headers were not clearly detected.";
	const buildInvestorHeadline = (): string => {
		const m = understanding.metrics_v1;
		if (understanding.detected_type === "use_of_funds" && m?.distribution) {
			const total = formatCompactNumber(m.distribution.total_value, understanding.units.currency_hint);
			const top1 = m.distribution.top_categories?.[0];
			const topText = top1
				? `Largest line item is ${top1.label} at ${formatCompactNumber(top1.value, understanding.units.currency_hint)} (${formatPct(top1.pct_of_total)} of total).`
				: "";
			const pctOk = m.distribution.percent_column_sum
				? m.distribution.percent_column_sum.within_tolerance
					? "Percent column sums look consistent."
					: "Percent column does not sum cleanly; treat the % breakdown as suspect until verified."
				: "";
			return [`Use of funds totals ${total}.`, topText, pctOk].filter(Boolean).join(" ").trim();
		}
		if (m?.key_series && m.key_series.start_value != null && m.key_series.end_value != null) {
			const startTxt = formatCompactNumber(m.key_series.start_value, understanding.units.currency_hint);
			const endTxt = formatCompactNumber(m.key_series.end_value, understanding.units.currency_hint);
			const growthTxt = typeof m.key_series.growth_pct === "number" ? ` (${formatPct(m.key_series.growth_pct)} change)` : "";
			const trend =
				typeof m.key_series.growth_pct === "number"
					? m.key_series.growth_pct > 0.2
						? "This suggests strong growth over the period."
						: m.key_series.growth_pct < -0.1
							? "This suggests a declining trajectory over the period."
							: "This suggests relatively stable performance over the period."
					: "";
			return [
				`${m.key_series.label} changes from ${startTxt} to ${endTxt} from ${m.key_series.start_period_label ?? "(start)"} to ${m.key_series.end_period_label ?? "(end)"}${growthTxt}.`,
				trend,
				m.key_series.missing_ratio > 0.35 ? "Note: many period values are missing." : "",
			]
				.filter(Boolean)
				.join(" ")
				.trim();
		}
		return "";
	};

	const investorHeadline = buildInvestorHeadline();
	const investor_summary = [
		investorHeadline,
		`${understanding.sheet_name} is classified as ${typeLabel}.`,
		timeText,
		understanding.units.currency_hint ? `Currency hint: ${understanding.units.currency_hint}.` : "",
		// Keep a secondary evidence sentence (if present) to help UI previews.
		investorEvidence.length && investorEvidence[0] !== investorHeadline ? investorEvidence[0] : "",
		`Structure: ${rowCountText} rows, ${headerCountText} columns.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	const analyst_summary = [
		`Detected type=${understanding.detected_type} (confidence=${understanding.confidence.toFixed(2)}), segment_key=${understanding.segment_key ?? "(none)"}.`,
		understanding.metrics_v1
			? `metrics_v1(source=${understanding.metrics_v1.source}): numeric_ratio=${understanding.metrics_v1.quality.numeric_ratio.toFixed(2)}.`
			: "metrics_v1: (none)",
		`Headers sample: ${understanding.structure.headers_sample.slice(0, 10).join(" | ") || "(none)"}.`,
		understanding.structure.row_labels_sample.length
			? `Row label sample (col A): ${understanding.structure.row_labels_sample.join(" | ")}.`
			: "Row label sample: (none detected from grid preview).",
		analystEvidence.length ? analystEvidence[0] : "",
		`Flags: ${understanding.flags.join(", ") || "(none)"}.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	return { understanding, investor_summary, analyst_summary };
}

function normalizeTextList(value: unknown, maxItems: number): string[] {
	const arr = Array.isArray(value) ? value : [];
	const out: string[] = [];
	for (const item of arr) {
		const t = cleanTextForClassification(item).trim();
		if (!t) continue;
		out.push(t);
		if (out.length >= maxItems) break;
	}
	return out;
}


export function inferSegmentKeyFromStructured(params: {
	structuredJson: unknown;
	source: string;
	documentTitle?: string | null;
}): SegmentKey {
	const sj = (params.structuredJson ?? {}) as any;
	const docTitle = typeof params.documentTitle === "string" ? params.documentTitle : "";
	const title = cleanTextForClassification(sj?.title);
	const textSnippet = cleanTextForClassification(sj?.text_snippet);
	const heading = cleanTextForClassification(sj?.heading);
	const bullets = normalizeTextList(sj?.bullets, 20).join("\n");
	const paragraphs = normalizeTextList(sj?.paragraphs, 20).join("\n");
	const sheetName = cleanTextForClassification(sj?.sheet_name);
	const headers = normalizeTextList(sj?.headers, 20).join("\n");
	const numericColumns = normalizeTextList(sj?.numeric_columns, 20).join("\n");
	const sampleRows = Array.isArray(sj?.sample_rows) ? sj.sample_rows : [];
	const firstRowPreview = Array.isArray(sampleRows?.[0])
		? sampleRows[0].slice(0, 20).map((v: any) => cleanTextForClassification(v)).filter(Boolean).join(" ")
		: "";

	const combined = [
		docTitle,
		title,
		heading,
		textSnippet,
		bullets,
		paragraphs,
		sheetName ? `sheet: ${sheetName}` : "",
		headers ? `headers: ${headers}` : "",
		numericColumns ? `numeric: ${numericColumns}` : "",
		firstRowPreview ? `row0: ${firstRowPreview}` : "",
	]
		.filter(Boolean)
		.join("\n");

	// Excel defaults to financials unless there's a stronger signal.
	if (params.source === "structured_excel") {
		const inferred = classifySegmentKeyFromText(combined, "financials");
		return inferred || "financials";
	}

	return classifySegmentKeyFromText(combined, "unknown");
}

export async function resegmentStructuredSyntheticAssets(params: {
	pool: Pool;
	documentId: string;
	documentTitle?: string | null;
}): Promise<{ updated_assets: number; updated_extractions: number }> {
	const sources = ["structured_word", "structured_powerpoint", "structured_excel"];
	const { rows } = await params.pool.query<{
		id: string;
		quality_flags: any;
		structured_json: any;
	}> (
		`SELECT va.id,
		        va.quality_flags,
		        ve.structured_json
		   FROM visual_assets va
		   LEFT JOIN visual_extractions ve
		     ON ve.visual_asset_id = va.id
		    AND ve.extractor_version = va.extractor_version
		  WHERE va.document_id = $1
		    AND (va.quality_flags->>'source') = ANY($2)`,
		[sanitizeText(params.documentId), sources]
	);

	let updatedAssets = 0;
	let updatedExtractions = 0;
	for (const row of rows) {
		const source = typeof row?.quality_flags?.source === "string" ? row.quality_flags.source : "";
		if (!source) continue;
		const inferred = inferSegmentKeyFromStructured({
			structuredJson: row.structured_json,
			source,
			documentTitle: params.documentTitle ?? null,
		});
		if (!inferred) continue;

		const seg = String(inferred);
		// Update visual_assets.quality_flags.segment_key
		const res1 = await params.pool.query(
			`UPDATE visual_assets
			    SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedAssets += (res1 as any)?.rowCount ?? 0;

		// Update visual_extractions.structured_json.segment_key (debug/secondary)
		const res2 = await params.pool.query(
			`UPDATE visual_extractions
			    SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE visual_asset_id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedExtractions += (res2 as any)?.rowCount ?? 0;
	}

	return { updated_assets: updatedAssets, updated_extractions: updatedExtractions };
}

export async function applyVisionHintsToStructuredPowerpointSlides(params: {
	pool: Pool;
	dealId?: string;
	jobId?: string;
	documentId: string;
	pageImageUris: string[];
	structuredExtractorVersion?: string;
	visionConfig: VisionExtractorConfig;
	visionRuntime?: VisionJobRuntime;
	env?: NodeJS.ProcessEnv;
	logger?: LogLike;
	forceReextract?: boolean;
	callVisionWorkerWithRetries?: typeof callVisionWorkerWithRetries;
}): Promise<{
	attempted: number;
	updated: number;
	skipped_has_content: number;
	skipped_existing: number;
	skipped_no_uri: number;
	skipped_has_text: number;
	skipped_has_segment: number;
	errors: number;
}> {
	const env = params.env ?? process.env;
	const logger = params.logger ?? console;
	const dealId = typeof params.dealId === "string" ? params.dealId : "";
	const jobId = typeof params.jobId === "string" ? params.jobId : "";
	const forceReextract = Boolean(params.forceReextract);
	const callVisionWithRetries = params.callVisionWorkerWithRetries ?? callVisionWorkerWithRetries;
	const structuredExtractorVersion = params.structuredExtractorVersion ?? "structured_native_v1";
	// Force-vu is request-mode only; all canonical/dedupe is done on baseExtractorVersion.
	const baseExtractorVersion = String(params.visionConfig?.extractorVersion ?? "").replace(/_force_vu$/, "");
	const forcedExtractorVersion = `${baseExtractorVersion}_force_vu`;
	const extractorVersionsForDedupe = [baseExtractorVersion, forcedExtractorVersion].filter(Boolean);
	const persistSegmentMinConf = (() => {
		const raw = env.STRUCTURED_VISION_HINT_PERSIST_MIN_CONFIDENCE;
		const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
		return 0.55;
	})();

	const enableStructuredVisionHints = parseBool(
		env.ENABLE_STRUCTURED_VISION_HINTS ?? ((env.VISION_BASE_URL || env.VISION_WORKER_URL) && String(env.VISION_BASE_URL || env.VISION_WORKER_URL).trim() ? "1" : "0")
	);
	if (!enableStructuredVisionHints) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}
	if (!params.visionConfig?.enabled) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}
	if (!Array.isArray(params.pageImageUris) || params.pageImageUris.length === 0) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}

	// Candidates: structured_powerpoint synthetic assets with unknown segment and no prior vision_understanding_v1.
	// We do additional “no-text” gating in JS to avoid over-writing legitimate structured classification.
	const { rows } = await params.pool.query<{
		visual_asset_id: string;
		visual_extraction_id: string;
		page_index: number;
		quality_flags: any;
		structured_json: any;
	}>(
		`
			SELECT va.id AS visual_asset_id,
			       ve.id AS visual_extraction_id,
			       va.page_index,
			       va.quality_flags,
			       ve.structured_json
			  FROM visual_assets va
			  JOIN visual_extractions ve
			    ON ve.visual_asset_id = va.id
			   AND ve.extractor_version = va.extractor_version
			 WHERE va.document_id = $1
			   AND va.extractor_version = $2
			   AND (va.quality_flags->>'source') = 'structured_powerpoint'
			   AND COALESCE(va.quality_flags->>'segment_key','unknown') = 'unknown'
			   AND COALESCE(ve.structured_json->>'segment_key','unknown') = 'unknown'
			   AND NOT (ve.structured_json ? 'vision_understanding_v1')
			 ORDER BY va.page_index ASC
			 LIMIT 200
		`,
		[sanitizeText(params.documentId), sanitizeText(structuredExtractorVersion)]
	);

	let attempted = 0;
	let updated = 0;
	let skippedHasContent = 0;
	let skippedExisting = 0;
	let skippedNoUri = 0;
	let skippedHasText = 0;
	let skippedHasSegment = 0;
	let errors = 0;

	const hasMeaningfulContent = (slide: any): boolean => {
		const sj = (slide ?? {}) as any;
		const title = typeof sj?.title === "string" ? sj.title.trim() : "";
		if (title.length >= 3) return true;

		const bullets = Array.isArray(sj?.bullets) ? sj.bullets : [];
		const bulletCount = bullets.filter((b: any) => typeof b === "string" && b.trim().length >= 3).length;
		if (bulletCount >= 1) return true;

		const notes = typeof sj?.notes === "string" ? sj.notes.trim() : "";
		if (notes.length >= 10) return true;

		const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
		if (snippet.length >= 20) return true;

		// Structured objects: some extractors may include table/image metadata arrays.
		const hasStructuredObjects = (() => {
			const candidates: unknown[] = [sj?.tables, sj?.images, sj?.charts, sj?.shapes, sj?.objects, sj?.media];
			for (const c of candidates) {
				if (Array.isArray(c) && c.length > 0) return true;
				if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c as any).length > 0) return true;
			}
			return false;
		})();
		return hasStructuredObjects;
	};

	for (const row of rows ?? []) {
		const pageIndex = typeof row.page_index === "number" ? row.page_index : -1;
		if (pageIndex < 0) continue;
		const pageImageUri = pageIndex < params.pageImageUris.length ? params.pageImageUris[pageIndex] : null;
		if (!pageImageUri) {
			skippedNoUri += 1;
			continue;
		}

		const qf = (row.quality_flags ?? {}) as any;
		const existingSeg = coerceSegmentKey(qf?.segment_key);
		if (existingSeg && existingSeg !== "unknown") {
			skippedHasSegment += 1;
			continue;
		}

		const sj = (row.structured_json ?? {}) as any;
		const kind = typeof sj?.kind === "string" ? sj.kind : "";
		if (kind !== "powerpoint_slide") continue;
		const alreadyHasVu = Boolean(sj && typeof sj === "object" && (sj as any).vision_understanding_v1 != null);
		const alreadyHasSlideTypeHint = (() => {
			const st = (sj as any).resolved_slide_type ?? (sj as any).slide_type ?? (sj as any).slide_type_hint;
			return typeof st === "string" && st.trim().length > 0;
		})();
		const sjSegment = coerceSegmentKey(typeof (sj as any).segment_key === "string" ? (sj as any).segment_key : null);
		const alreadyHasSegmentHint = Boolean(sjSegment && sjSegment !== "unknown");
		if (!forceReextract && (alreadyHasVu || alreadyHasSlideTypeHint || alreadyHasSegmentHint)) {
			skippedExisting += 1;
			continue;
		}

		// Tight gating: we ONLY run vision hints when content is missing.
		// Do not call vision just because classification is unknown.
		if (hasMeaningfulContent(sj)) {
			skippedHasContent += 1;
			continue;
		}
		// Intentionally do not gate on having title/bullets/text: if deterministic structured classification
		// still produced segment_key=unknown, try vision-understanding as a rescue signal.

		// Strict rerun guard: if the per-page vision extraction already exists (either base or forced
		// version), do not call the vision worker again.
		if (!forceReextract) {
			try {
				const { rows: existing } = await params.pool.query(
					`
						SELECT 1
						  FROM visual_assets
						 WHERE document_id = $1
						   AND page_index = $2
						   AND extractor_version = ANY($3::text[])
						 LIMIT 1
					`,
					[sanitizeText(params.documentId), pageIndex, extractorVersionsForDedupe]
				);
				if ((existing?.length ?? 0) > 0) {
					skippedExisting += 1;
					continue;
				}
			} catch {
				// best-effort; if the guard query fails, continue with the vision call.
			}
		}

		attempted += 1;
		try {
			const { response: visionResp } = await callVisionWithRetries(
				params.visionConfig,
				{
					document_id: params.documentId,
					page_index: pageIndex,
					image_uri: pageImageUri,
					// Request-mode only; do not treat this as a canonical persisted extractor version.
					extractor_version: forcedExtractorVersion,
				},
				{
					timeoutsMs: [20_000],
					runtime: params.visionRuntime,
					logger,
					logMeta: {
						caller: "structured_ppt_vision_hints",
						stage: "structured_powerpoint_vision_hints",
						deal_id: String(dealId ?? ""),
						job_id: String(jobId ?? ""),
						document_id: String(params.documentId ?? ""),
						page_index: pageIndex,
						structured_extractor_version: String(structuredExtractorVersion ?? ""),
						base_extractor_version: String(baseExtractorVersion ?? ""),
						forced_extractor_version: String(forcedExtractorVersion ?? ""),
					},
				}
			);

			const bestVu = (() => {
				const assets = Array.isArray(visionResp?.assets) ? visionResp!.assets : [];
				let best: any | null = null;
				let bestConf = -1;
				for (const va of assets) {
					const sj2 = (va as any)?.extraction?.structured_json;
					const vu = sj2 && typeof sj2 === "object" ? (sj2 as any).vision_understanding_v1 : null;
					if (!vu || typeof vu !== "object") continue;
					const confRaw = (vu as any).confidence;
					const conf = typeof confRaw === "number" && Number.isFinite(confRaw) ? confRaw : 0;
					if (conf > bestConf) {
						bestConf = conf;
						best = vu;
					}
				}
				return best;
			})();
			const vuToPersist: any = (() => {
				if (bestVu && typeof bestVu === "object") return { ...bestVu, extractor_version: baseExtractorVersion };
				return {
					segment_hint: "unknown",
					confidence: 0,
					note: "no_vision_understanding_v1_found",
					extractor_version: baseExtractorVersion,
				};
			})();

			const hintSeg = coerceSegmentKey(typeof vuToPersist.segment_hint === "string" ? vuToPersist.segment_hint : null);
			const hintConfRaw = vuToPersist.confidence;
			const hintConf = typeof hintConfRaw === "number" && Number.isFinite(hintConfRaw) ? hintConfRaw : null;
			const persistSegment = Boolean(hintSeg && hintSeg !== "unknown" && hintConf != null && hintConf >= persistSegmentMinConf);

			// Always persist vision_understanding_v1; persist segment_key only if hint is strong.
			await params.pool.query(
				`
					UPDATE visual_extractions
					   SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{vision_understanding_v1}', $2::jsonb, true)
					 WHERE id = $1
				`,
				[sanitizeText(row.visual_extraction_id), JSON.stringify(vuToPersist)]
			);

			if (persistSegment) {
				// Write-through a confident segment assignment.
				await params.pool.query(
					`UPDATE visual_extractions
					   SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
					 WHERE id = $1`,
					[sanitizeText(row.visual_extraction_id), hintSeg]
				);

				await params.pool.query(
					`
						UPDATE visual_assets
						   SET quality_flags = jsonb_set(
								jsonb_set(
									jsonb_set(
										jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true),
										'{segment_source}', to_jsonb('structured_vision_understanding_v1'::text), true
									),
									'{accepted_v1}', 'true'::jsonb, true
								),
								'{accepted_reason_v1}', to_jsonb('structured_powerpoint_no_text_vision_hint'::text), true
							 )
						 WHERE id = $1
					`,
					[sanitizeText(row.visual_asset_id), hintSeg]
				);
				if (hintConf != null) {
					await params.pool.query(
						`UPDATE visual_assets
						   SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_confidence}', to_jsonb($2::numeric), true)
						 WHERE id = $1`,
						[sanitizeText(row.visual_asset_id), hintConf]
					);
				}
				updated += 1;
			}
		} catch (err) {
			errors += 1;
			logger.warn(
				`[extract_visuals] structured PowerPoint vision hint failed doc=${params.documentId} page=${pageIndex}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return {
		attempted,
		updated,
		skipped_has_content: skippedHasContent,
		skipped_existing: skippedExisting,
		skipped_no_uri: skippedNoUri,
		skipped_has_text: skippedHasText,
		skipped_has_segment: skippedHasSegment,
		errors,
	};
}

function buildSyntheticAssets(params: {
	docKind: string;
	structuredData: any;
	fullContent: any;
}): SyntheticAssetBuild[] {
	const out: SyntheticAssetBuild[] = [];
	const kind = params.docKind;

	const coalesceWordSections = (sectionsIn: any[]): any[] => {
		// Goal: preserve text fidelity while producing a bounded number of nodes suitable for
		// per-segment scoring. We bucket paragraph-level text into segment-specific chunks.
		const MAX_SECTIONS_SCANNED = 200;
		const MAX_CHUNKS_EMITTED = 25;
		const MAX_PARAGRAPHS_PER_CHUNK = 18;
		const MAX_CLASSIFY_TEXT_CHARS = 2400;
		const MAX_TEXT_SNIPPET_CHARS = 900;

		type NormSection = {
			heading: string | null;
			level: number | null;
			paragraphs: string[];
			tableRows: unknown[];
			textSnippet: string;
			segmentKey: SegmentKey;
		};

		const normalizeSection = (section: any): NormSection | null => {
			const heading = cleanTextForClassification(section?.heading) || null;
			const paragraphsRawUnknown = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
			const paragraphsRaw = paragraphsRawUnknown
				.map((p: unknown) => toTextLoose(p))
				.map((p: string) => p.trim())
				.filter(Boolean);
			const paragraphs = normalizeTextList(paragraphsRaw, 30);
			const tableRows = Array.isArray(section?.tables?.[0]?.rows) ? section.tables[0].rows.slice(0, 5) : [];
			const sectionText = cleanTextForClassification(section?.text);
			const textSnippetBase = sectionText || paragraphs.join(" ");
			const textSnippet = textSnippetBase ? textSnippetBase.slice(0, MAX_TEXT_SNIPPET_CHARS) : "";

			if (isEmptyWordSection({ heading, textSnippet, paragraphs, tableRows })) return null;

			const classifyText = [heading ?? "", textSnippet, paragraphs.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			return {
				heading,
				level: typeof section?.level === "number" ? section.level : null,
				paragraphs,
				tableRows,
				textSnippet,
				segmentKey,
			};
		};

		type SegmentBucket = {
			headings: string[];
			paragraphs: string[];
			unit_count: number;
		};

		const tableItems: any[] = [];
		const buckets = new Map<SegmentKey, SegmentBucket>();
		const getBucket = (k: SegmentKey): SegmentBucket => {
			const existing = buckets.get(k);
			if (existing) return existing;
			const created: SegmentBucket = { headings: [], paragraphs: [], unit_count: 0 };
			buckets.set(k, created);
			return created;
		};

		const sections = sectionsIn.slice(0, MAX_SECTIONS_SCANNED).map(normalizeSection).filter(Boolean) as NormSection[];
		for (const s of sections) {
			// Emit tables as their own items (high signal, often financials/traction).
			if (Array.isArray(s.tableRows) && s.tableRows.length > 0) {
				const cellTexts: string[] = [];
				for (const row of s.tableRows.slice(0, 6) as any[]) {
					if (!Array.isArray(row)) continue;
					for (const cell of row.slice(0, 10)) {
						const t = cleanTextForClassification(cell);
						if (t) cellTexts.push(t);
						if (cellTexts.length >= 60) break;
					}
					if (cellTexts.length >= 60) break;
				}
				const classifyText = [s.heading ?? "", cellTexts.join(" "), s.textSnippet].filter(Boolean).join("\n").slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
				tableItems.push({
					kind: "word_section",
					segment_key: segmentKey,
					heading: s.heading,
					level: s.level,
					text_snippet: s.textSnippet,
					paragraphs: [],
					table_rows: s.tableRows,
					member_count: 1,
					member_segment_keys: [segmentKey],
				});
			}

			const headingKey = s.heading ? classifySegmentKeyFromText(s.heading, "unknown") : "unknown";
			const unitTexts = s.paragraphs.length > 0 ? s.paragraphs : s.textSnippet ? [s.textSnippet] : [];
			for (const unit of unitTexts) {
				const combined = [s.heading ?? "", unit].filter(Boolean).join("\n");
				let seg = classifySegmentKeyFromText(combined, "unknown");
				if (seg === "unknown" && headingKey !== "unknown") seg = headingKey;
				const bucket = getBucket(seg);
				if (s.heading) bucket.headings.push(s.heading);
				bucket.paragraphs.push(unit);
				bucket.unit_count += 1;
			}
		}

		const outItems: any[] = [];
		// Prefer deterministic segment order; emit unknown last.
		const orderedSegments: SegmentKey[] = [...SEGMENT_KEYS];
		for (const seg of orderedSegments) {
			const bucket = buckets.get(seg);
			if (!bucket) continue;
			const headings = normalizeTextList(bucket.headings, 12);
			// Split into multiple chunks if needed.
			let chunkIndex = 0;
			let cursor = 0;
			while (cursor < bucket.paragraphs.length && outItems.length < MAX_CHUNKS_EMITTED) {
				chunkIndex += 1;
				const paras = bucket.paragraphs.slice(cursor, cursor + MAX_PARAGRAPHS_PER_CHUNK);
				cursor += MAX_PARAGRAPHS_PER_CHUNK;
				const paragraphs = normalizeTextList(paras, MAX_PARAGRAPHS_PER_CHUNK);
				const heading = seg !== "unknown" ? seg : headings[0] ?? null;
				const textSnippet = cleanTextForClassification(paragraphs.join("\n")).slice(0, MAX_TEXT_SNIPPET_CHARS);
				const classifyText = [headings.join("\n"), textSnippet, paragraphs.join("\n")]
					.filter(Boolean)
					.join("\n")
					.slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const stableSeg = seg !== "unknown" ? seg : classifySegmentKeyFromText(classifyText, "unknown");

				outItems.push({
					kind: "word_section",
					segment_key: stableSeg,
					heading,
					headings,
					level: null,
					text_snippet: textSnippet,
					paragraphs,
					table_rows: [],
					member_count: paragraphs.length,
					member_segment_keys: Array.from({ length: paragraphs.length }).map(() => stableSeg),
					chunk_index: chunkIndex,
				});
			}
		}

		return [...tableItems, ...outItems].slice(0, MAX_CHUNKS_EMITTED);
	};

	const hasAnyTableContent = (rows: unknown): boolean => {
		if (!Array.isArray(rows) || rows.length === 0) return false;
		for (const row of rows) {
			if (!Array.isArray(row)) continue;
			for (const cell of row) {
				const t = cleanTextForClassification(cell);
				if (t) return true;
			}
		}
		return false;
	};

	const isEmptyWordSection = (section: {
		heading: string | null;
		textSnippet: string;
		paragraphs: string[];
		tableRows: unknown[];
	}): boolean => {
		const hasHeading = typeof section.heading === "string" && section.heading.trim().length > 0;
		const hasSnippet = typeof section.textSnippet === "string" && section.textSnippet.trim().length > 0;
		const hasParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.some((p) => typeof p === "string" && p.trim().length > 0);
		const hasTable = hasAnyTableContent(section.tableRows);
		return !hasHeading && !hasSnippet && !hasParagraphs && !hasTable;
	};

	if (kind === "excel") {
		const forceExcelSegmentKey = (segmentKey: SegmentKey, classifyText: string): SegmentKey => {
			const t = (classifyText ?? "").toLowerCase();
			const financialSignal = /\b(revenue|revenues|cogs|cost of goods|gross margin|gross profit|expenses|opex|operating expense|p\s*&\s*l|income statement|ebitda|cash balance|cashflow|cash flow|burn|runway|balance sheet|arr|mrr|unit economics)\b/.test(
				t
			);
			const raiseSignal = /\b(cap table|captable|ownership|dilution|valuation|pre-money|post-money|round|financing|raise|use of funds|allocation of funds|term sheet|safe\b|convertible note|note\b)\b/.test(
				t
			);
			if (financialSignal && !raiseSignal) return "financials";
			if (raiseSignal && !financialSignal) return "raise_terms";
			return segmentKey;
		};

		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		sheets.forEach((sheet: any, idx: number) => {
			const sheetName = sheet?.name ?? `Sheet ${idx + 1}`;
			const sheetPageIndex = idx;
			const headers = Array.isArray(sheet?.headers) ? sheet.headers.slice(0, 50) : [];
			const rowCount = typeof sheet?.summary?.totalRows === "number" ? sheet.summary.totalRows : (Array.isArray(sheet?.rows) ? sheet.rows.length : 0);
			const numericColumns = Array.isArray(sheet?.summary?.numericColumns) ? sheet.summary.numericColumns.slice(0, 25) : [];
			const tables = Array.isArray(sheet?.tables) ? sheet.tables : [];
			const gridCells = Array.isArray(sheet?.gridPreview?.cells) ? sheet.gridPreview.cells : [];

			const gridPreviewText = gridCells
				.slice(0, 60)
				.map((c: any) => cleanTextForClassification(c?.w ?? c?.v ?? c?.f))
				.filter(Boolean)
				.join(" ")
				.slice(0, 800);

			// Prefer table-derived structured assets (more signal) if present.
			if (tables.length > 0) {
				for (const [tableIdx, t] of tables.slice(0, 6).entries()) {
					const cols = Array.isArray(t?.value_cols) ? t.value_cols : [];
					const rowLabels = Array.isArray(t?.rows) ? t.rows.slice(0, 10).map((r: any) => cleanTextForClassification(r?.label)).filter(Boolean) : [];
					const classifyText = [
						sheetName ? `sheet: ${sheetName}` : "",
						t?.name ? `table: ${t.name}` : "",
						cols.length ? `cols: ${cols.map((c: any) => c?.header ?? c?.col).filter(Boolean).join(" ")}` : "",
						rowLabels.length ? `rows: ${rowLabels.join(" ")}` : "",
					]
						.filter(Boolean)
						.join("\n");
					const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
					const summary = buildExcelSheetUnderstandingV1({
						sheetName,
						segmentKey,
						headers: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 40),
						rowCount: Array.isArray(t?.rows) ? t.rows.length : undefined,
						numericColumns: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 25),
						gridCells,
						table: t as any,
					});
					const structuredJson = {
						kind: "excel_sheet",
						segment_key: segmentKey,
						sheet_name: sheetName,
						table: t,
						summary: sheet?.summary ?? {},
						understanding_v1: summary.understanding,
						summary_text_investor: summary.investor_summary,
						summary_text_analyst: summary.analyst_summary,
					};
					out.push({
						pageIndex: sheetPageIndex,
						asset: {
							asset_type: "table",
							bbox: { x: 0, y: 0, w: 1, h: 1 },
							confidence: 0.9,
							quality_flags: { source: "structured_excel", segment_key: segmentKey },
							image_uri: null,
							image_hash: hashKey([params.docKind, sheetName, t?.name ?? tableIdx, "table"]),
							extraction: {
								ocr_text: null,
								ocr_blocks: [],
								structured_json: structuredJson,
								units: null,
								labels: { source: "structured_excel" },
								model_version: null,
								confidence: 0.9,
							},
						},
					});
				}
			}

			// Fallback: emit a sheet-summary synthetic asset.
			const classifyText = [
				sheetName ? `sheet: ${sheetName}` : "",
				headers?.length ? `headers: ${headers.join(" ")}` : "",
				numericColumns?.length ? `numeric: ${numericColumns.join(" ")}` : "",
				gridPreviewText ? `preview: ${gridPreviewText}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
			const summary = buildExcelSheetUnderstandingV1({
				sheetName,
				segmentKey,
				headers,
				rowCount,
				numericColumns,
				gridCells,
				sheetRows: Array.isArray(sheet?.rows) ? (sheet.rows as any[]) : undefined,
			});
			const structuredJson = {
				kind: "excel_sheet",
				segment_key: segmentKey,
				sheet_name: sheetName,
				headers,
				row_count: rowCount,
				grid_preview: { maxRows: sheet?.gridPreview?.maxRows, maxCols: sheet?.gridPreview?.maxCols, cells: gridCells.slice(0, 800) },
				summary: sheet?.summary ?? {},
				understanding_v1: summary.understanding,
				summary_text_investor: summary.investor_summary,
				summary_text_analyst: summary.analyst_summary,
			};
			out.push({
				pageIndex: sheetPageIndex,
				asset: {
					asset_type: "table",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.9,
					quality_flags: { source: "structured_excel", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, sheetName, "sheet"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_excel" },
						model_version: null,
						confidence: 0.9,
					},
				},
			});
		});
		return out;
	}

	if (kind === "word") {
		const sections = Array.isArray(params.fullContent?.sections) ? params.fullContent.sections : [];
		const coalesced = coalesceWordSections(sections);
		coalesced.forEach((structuredJson: any, idx: number) => {
			const segmentKey = coerceSegmentKey(structuredJson?.segment_key) ?? "unknown";
			const heading = cleanTextForClassification(structuredJson?.heading) || null;
			const tableRows = Array.isArray(structuredJson?.table_rows) ? structuredJson.table_rows : [];
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: tableRows.length > 0 ? "table" : "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_word", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, heading ?? idx, tableRows.length > 0 ? "table" : "text"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_word" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
		return out;
	}

	if (kind === "powerpoint") {
		const slides = Array.isArray(params.fullContent?.slides) ? params.fullContent.slides : [];
		slides.slice(0, 50).forEach((slide: any, idx: number) => {
			const bullets = normalizeTextList(slide?.bullets, 15);
			const title = typeof slide?.title === "string" ? slide.title : null;
			const textSnippet = typeof slide?.text === "string" ? slide.text.slice(0, 500) : "";
			const classifyText = [title ?? "", textSnippet, bullets.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			const structuredJson = {
				kind: "powerpoint_slide",
				segment_key: segmentKey,
				slide_number: typeof slide?.slideNumber === "number" ? slide.slideNumber : idx + 1,
				title,
				bullets,
				text_snippet: textSnippet,
				notes: typeof slide?.notes === "string" ? slide.notes.slice(0, 500) : null,
				images: Array.isArray(slide?.images) ? slide.images : [],
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_powerpoint", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, structuredJson.slide_number ?? idx]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_powerpoint" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
	}

	return out;
}

export async function persistSyntheticVisualAssets(params: {
	pool: Pool;
	documentId: string;
	docKind: string;
	structuredData: any;
	fullContent: any;
	extractorVersion?: string;
	visionRuntime?: VisionJobRuntime;
	env?: NodeJS.ProcessEnv;
}): Promise<number> {
	const env = params.env ?? process.env;
	const extractorVersion = params.extractorVersion ?? "structured_native_v1";

	const enableStructuredVisionHints = parseBool(
		env.ENABLE_STRUCTURED_VISION_HINTS ?? ((env.VISION_BASE_URL || env.VISION_WORKER_URL) && String(env.VISION_BASE_URL || env.VISION_WORKER_URL).trim() ? "1" : "0")
	);

	const pageImageUris = await (async (): Promise<string[]> => {
		if (!enableStructuredVisionHints) return [];
		try {
			return await resolvePageImageUris(params.pool, params.documentId, { env });
		} catch {
			return [];
		}
	})();

	const visionConfig = enableStructuredVisionHints ? getVisionExtractorConfig(env) : null;
	const visionRuntime = visionConfig
		? (params.visionRuntime ??
				createVisionJobRuntime({
					config: visionConfig,
					logger: console,
					logMeta: { stage: "persist_synthetic_visual_assets", document_id: params.documentId },
				}))
		: null;

	const cleanupStaleExcelSheetSummaries = async (): Promise<void> => {
		if (params.docKind !== "excel") return;
		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		const sheetNames = sheets
			.map((s: any, idx: number) => (typeof s?.name === "string" && s.name.trim() ? s.name.trim() : `Sheet ${idx + 1}`))
			.filter((n: any) => typeof n === "string" && n.length > 0);
		if (sheetNames.length === 0) return;
		const stableSheetHashes = sheetNames.map((name: string) => hashKey(["excel", name, "sheet"]));

		// Remove stale/legacy synthetic sheet-summary assets so lineage doesn't accumulate duplicates.
		// Criteria:
		// - structured synthetic extractor version
		// - kind=excel_sheet + has headers (sheet-summary, not table-derived)
		// - sheet_name in this document's current sheets
		// - either image_hash is not one of the stable per-sheet hashes OR headers contain __EMPTY*
		await params.pool.query(
			`
			WITH stale AS (
				SELECT va.id
				FROM visual_assets va
				JOIN visual_extractions ve
				  ON ve.visual_asset_id = va.id
				 AND ve.extractor_version = va.extractor_version
				WHERE va.document_id = $1
				  AND va.extractor_version = $2
				  AND (ve.structured_json->>'kind') = 'excel_sheet'
				  AND (ve.structured_json ? 'headers')
				  AND (ve.structured_json->>'sheet_name') = ANY($3::text[])
				  AND (
					va.image_hash IS NULL
					OR NOT (va.image_hash = ANY($4::text[]))
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements_text(ve.structured_json->'headers') AS h(value)
						WHERE value ILIKE '__empty%'
					)
				  )
			)
			DELETE FROM visual_assets
			WHERE id IN (SELECT id FROM stale)
			`,
			[params.documentId, extractorVersion, sheetNames, stableSheetHashes]
		);
	};

	await cleanupStaleExcelSheetSummaries();
	const assets = buildSyntheticAssets({ docKind: params.docKind, structuredData: params.structuredData, fullContent: params.fullContent });
	if (assets.length === 0) return 0;

	let persisted = 0;
	const grouped = new Map<number, VisionAsset[]>();
	for (const entry of assets) {
		const list = grouped.get(entry.pageIndex) ?? [];
		list.push(entry.asset);
		grouped.set(entry.pageIndex, list);
	}

	for (const [pageIndex, assetList] of grouped.entries()) {
		const pageImageUri = pageIndex >= 0 && pageIndex < pageImageUris.length ? pageImageUris[pageIndex] : null;

		// Lightweight vision-understanding hints for structured PowerPoint slides that have unknown segment_key.
		// This reduces downstream default fallbacks without changing computed_v1 determinism.
		if (enableStructuredVisionHints && visionConfig && pageImageUri) {
			try {
				const needsVisionHint = assetList.some((a) => {
					const qf = (a?.quality_flags ?? {}) as any;
					if (typeof qf?.source !== "string" || qf.source !== "structured_powerpoint") return false;
					const seg = coerceSegmentKey(qf?.segment_key);
					if (seg && seg !== "unknown") return false;
					const sj = (a?.extraction?.structured_json ?? {}) as any;
					const kind = typeof sj?.kind === "string" ? sj.kind : "";
					if (kind !== "powerpoint_slide") return false;
					// If slide text already exists, prefer structured classification; otherwise use vision hint.
					const title = typeof sj?.title === "string" ? sj.title.trim() : "";
					const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
					const bullets = Array.isArray(sj?.bullets) ? sj.bullets.filter((b: any) => typeof b === "string" && b.trim()).length : 0;
					return !(title || snippet || bullets > 0);
				});

				if (needsVisionHint) {
					const visionResp = await callVisionWorker(
						visionConfig,
						{
							document_id: params.documentId,
							page_index: pageIndex,
							image_uri: pageImageUri,
							extractor_version: visionConfig.extractorVersion,
						},
						{ runtime: visionRuntime ?? undefined }
					);

					const bestVu = (() => {
						const assets = Array.isArray(visionResp?.assets) ? visionResp!.assets : [];
						let best: any | null = null;
						let bestConf = -1;
						for (const va of assets) {
							const sj = (va as any)?.extraction?.structured_json;
							const vu = sj && typeof sj === "object" ? (sj as any).vision_understanding_v1 : null;
							if (!vu || typeof vu !== "object") continue;
							const confRaw = (vu as any).confidence;
							const conf = typeof confRaw === "number" && Number.isFinite(confRaw) ? confRaw : 0;
							if (conf > bestConf) {
								bestConf = conf;
								best = vu;
							}
						}
						return best;
					})();

					if (bestVu && typeof bestVu === "object") {
						const hintSeg = coerceSegmentKey(typeof (bestVu as any).segment_hint === "string" ? (bestVu as any).segment_hint : null);
						const hintConfRaw = (bestVu as any).confidence;
						const hintConf = typeof hintConfRaw === "number" && Number.isFinite(hintConfRaw) ? hintConfRaw : null;

						for (let k = 0; k < assetList.length; k++) {
							const a = assetList[k];
							const qf = { ...((a?.quality_flags ?? {}) as any) };
							if (qf.source !== "structured_powerpoint") continue;
							const existingSeg = coerceSegmentKey(qf.segment_key);
							if (existingSeg && existingSeg !== "unknown") continue;

							const extraction = (a as any)?.extraction;
							const sj = { ...(((extraction?.structured_json ?? {}) as any) ?? {}) };
							if (typeof sj.vision_understanding_v1 !== "object" || sj.vision_understanding_v1 == null) {
								sj.vision_understanding_v1 = bestVu;
							}

							if (hintSeg && hintSeg !== "unknown") {
								qf.segment_key = hintSeg;
								if (typeof qf.segment_source !== "string" || !qf.segment_source.trim()) qf.segment_source = "vision_understanding_v1";
								if (hintConf != null) qf.segment_confidence = hintConf;
								// Also update structured_json.segment_key so API can use persisted segment fallback.
								if (typeof sj.segment_key !== "string" || sj.segment_key === "unknown") sj.segment_key = hintSeg;
							}

							assetList[k] = {
								...a,
								quality_flags: qf,
								extraction: {
									...extraction,
									structured_json: sj,
								},
							};
						}
					}
				}
			} catch {
				// best-effort only
			}
		}

		const response: VisionExtractResponse = {
			document_id: params.documentId,
			page_index: pageIndex,
			extractor_version: extractorVersion,
			assets: assetList,
		};
		const { persisted: pCount } = await persistVisionResponse(params.pool, response, { pageImageUri, env });
		persisted += pCount;
	}

	return persisted;
}

export async function enqueueExtractVisualsIfPossible(params: {
	pool: Pool;
	queue: { add: (name: string, data: any, opts?: any) => Promise<unknown> };
	config: VisionExtractorConfig;
	documentId: string;
	dealId: string;
	logger?: LogLike;
	resolveOptions?: { fsImpl?: FsLike; env?: NodeJS.ProcessEnv };
	imageUrisOverride?: string[];
	/**
	 * Optional override/extra fields to include in the enqueued extract_visuals job payload.
	 * Intended for one-off debugging/verification without changing default behavior.
	 */
	jobDataOverride?: Record<string, unknown>;
	/**
	 * When true, requires rendered_pages_r2 metadata to exist and be complete before enqueueing.
	 * Defaults to true in production.
	 */
	requireRenderedPagesR2?: boolean;
}): Promise<boolean> {
	const logger = params.logger ?? console;
	if (!params.config.enabled) {
		// Optional fail-safe warning: once per process, when ingest completion tries to enqueue visuals.
		// Only warn for unset or explicit "0" to avoid noisy logs for other falsey values.
		const raw = process.env.ENABLE_VISUAL_EXTRACTION;
		const normalized = typeof raw === "string" ? raw.trim() : "";
		if (!didWarnVisualExtractionDisabled && (normalized.length === 0 || normalized === "0")) {
			didWarnVisualExtractionDisabled = true;
			logger.warn("Visual extraction disabled: ENABLE_VISUAL_EXTRACTION not set");
		}
		return false;
	}

	const envNode = (params.resolveOptions?.env?.NODE_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
	const requireRenderedPagesR2 =
		typeof params.requireRenderedPagesR2 === "boolean" ? params.requireRenderedPagesR2 : envNode === "production";

	const imageUrisOverride = Array.isArray(params.imageUrisOverride)
		? params.imageUrisOverride.filter((u) => typeof u === "string" && u.length > 0)
		: null;

	// Hard guardrail: in production (or when explicitly required), only enqueue visuals when rendered_pages_r2 is present and complete.
	// This prevents enqueueing extract_visuals too early (before render_document_pages finishes writing page images).
	if (requireRenderedPagesR2 && !imageUrisOverride) {
		try {
			const { rows } = await params.pool.query<{ extraction_metadata: unknown | null }>(
				"SELECT extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(params.documentId)]
			);
			const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object" ? (rows[0].extraction_metadata as any) : null;
			const renderedR2 =
				metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
			if (!renderedR2) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "rendered_pages_r2_missing",
					})
				);
				return false;
			}
			const renderedCount =
				typeof metaObj?.rendered_pages_count === "number" && Number.isFinite(metaObj.rendered_pages_count)
					? metaObj.rendered_pages_count
					: 0;
			const renderedSoFar =
				typeof metaObj?.rendered_pages_rendered === "number" && Number.isFinite(metaObj.rendered_pages_rendered)
					? metaObj.rendered_pages_rendered
					: null;
			if (!renderedCount || renderedCount <= 0) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "rendered_pages_count_missing",
						rendered_pages_count: renderedCount,
						rendered_pages_rendered: renderedSoFar,
					})
				);
				return false;
			}
			if (renderedSoFar == null || renderedSoFar < renderedCount) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "render_incomplete",
						rendered_pages_count: renderedCount,
						rendered_pages_rendered: renderedSoFar,
					})
				);
				return false;
			}
		} catch (err) {
			logger.warn(
				JSON.stringify({
					event: "extract_visuals_enqueue_guard_failed",
					document_id: params.documentId,
					error: err instanceof Error ? err.message : String(err),
				})
			);
			return false;
		}
	}

	const imageUris = imageUrisOverride
		? imageUrisOverride
		: await resolvePageImageUris(params.pool, params.documentId, {
				logger,
				fsImpl: params.resolveOptions?.fsImpl,
				env: params.resolveOptions?.env,
		  });
	if (imageUris.length === 0) {
		logger.log(
			JSON.stringify({
				event: "extract_visuals_enqueue_skipped",
				document_id: params.documentId,
				reason: "no_page_images_available",
			})
		);
		return false;
	}

	try {
		const safeJobId = sanitizeJobId(makeJobId("extract_visuals", [params.documentId]));
		await params.queue.add(
			"extract_visuals",
			{
				...(params.jobDataOverride && typeof params.jobDataOverride === "object" ? params.jobDataOverride : {}),
				document_id: params.documentId,
				deal_id: params.dealId,
				extractor_version: params.config.extractorVersion,
				image_uris: imageUris,
			},
			{
				jobId: safeJobId,
				removeOnComplete: true,
				removeOnFail: false,
				delay: 750,
			}
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.toLowerCase().includes("exists")) {
			logger.log(
				JSON.stringify({
					event: "extract_visuals_already_enqueued",
					document_id: params.documentId,
					pages: imageUris.length,
				})
			);
			return true;
		}
		throw err;
	}
	logger.log(
		JSON.stringify({
			event: "extract_visuals_enqueued",
			document_id: params.documentId,
			pages: imageUris.length,
		})
	);
	return true;
}

// ─── Extract Visuals Finalized Marker ────────────────────────────────────────

/**
 * Durable marker written to extraction_metadata once finalization fully succeeds
 * for a document. Enables downstream services to distinguish "finalize ran" from
 * "finalize was skipped/lost" without relying on log queries.
 */


/**
 * Builds an `extraction_metadata` patch containing the `extract_visuals_finalized`
 * marker.  Pure function — no I/O.
 *
 * Usage:
 * ```ts
 * await mergeDocumentExtractionMetadata({
 *   documentId: docId,
 *   patch: buildExtractVisualsFinalizedMarker({ jobId, docsFinalized: 1 }),
 * });
 * ```
 */
export function buildExtractVisualsFinalizedMarker(params: {
	jobId: string | null;
	docsFinalized: number;
	finalizedAt?: string;
}): { extract_visuals_finalized: ExtractVisualsFinalizedMarker } {
	return {
		extract_visuals_finalized: {
			ok: true,
			finalized_at: params.finalizedAt ?? new Date().toISOString(),
			finalized_by_job_id: params.jobId,
			docs_finalized: Math.max(0, params.docsFinalized),
		},
	};
}

