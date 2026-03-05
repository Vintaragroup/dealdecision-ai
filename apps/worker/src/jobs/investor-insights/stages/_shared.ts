/**
 * Shared types, constants, and pure helpers used across multiple investor-insights stage modules.
 *
 * Rules:
 *   - No DB calls
 *   - No LLM calls
 *   - No side effects
 *   - No imports from other stage modules (this is the base layer)
 */

import { createHash } from "crypto";
import type { ComplianceState } from "../../../contracts/investor-insights/schemas";

// ─── Binding constants (version-pins.md) ───────────────────────────────────────

/** Version pins – must be present in every render package and audit entry. */
export const VERSION_PINS = {
	constitution_version: "v2.0",
	engine_version: "v1",
	schema_version: "v2",
	governance_version: "v1.1",
	ui_contract_version: "v1",
} as const;

// ─── Fingerprint helpers ───────────────────────────────────────────────────────

/**
 * Build the upstream fingerprint (SHA-256 over canonical JSON).
 * Canonicalization: keys sorted lexicographically, primitive-array values sorted.
 * Binding: Execution Contract §4.2–4.3.
 */
export function buildDeterministicFingerprint(input: {
	dealId: string;
	engineVersion: string;
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	overlayExists: boolean;
	visualAssetCount: number;
}): string {
	// Keys sorted lexicographically per §4.2
	const canonical = JSON.stringify({
		deal_id: input.dealId,
		dpu_count: input.dpuCount,
		dpu_coverage: Number(input.dpuCoverage.toFixed(6)),
		engine_version: input.engineVersion,
		evidence_count: input.evidenceCount,
		overlay_exists: input.overlayExists,
		visual_asset_count: input.visualAssetCount,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fallback fingerprint used when gates fail (no upstream snapshot available)
 * or when the canonical computation itself fails.
 * Unique per-run (timestamp) so each fail-closed run gets its own row.
 */
export function buildFallbackFingerprint(dealId: string, engineVersion: string): string {
	return createHash("sha256")
		.update(`${dealId}:${engineVersion}:fallback:${Date.now()}`)
		.digest("hex")
		.slice(0, 16);
}

// ─── Compliance state builder ─────────────────────────────────────────────────

export function buildComplianceState(events: ComplianceState["events"] = []): ComplianceState {
	const hasFail = events.some((e) => e.severity === "error");
	return {
		status: events.length === 0 ? "not_run" : hasFail ? "failed" : "passed",
		events,
	};
}

// ─── Upstream snapshot ────────────────────────────────────────────────────────

export interface UpstreamSnapshot {
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	visualAssetCount: number;
	overlayExists: boolean;
}

// ─── Coverage snapshot ──────────────────────────────────────────────────────────

export interface CoverageSnapshot {
	docsCount: number;
	dpuPageCount: number;
	dpuNonemptyPages: number;
	evidenceCount: number;
	visualsCount: number;
	/** Names of sub-queries that were rejected via Promise.allSettled. Empty = all succeeded. */
	coverageQueryErrors: string[];
	/**
	 * WS-C PR20: XLSX pages that lack meaningful page_text but contain structured
	 * row data (page_type="excel_range" AND payload.rows array present).
	 *
	 * These are undercounted by the standard dpu_nonempty_pages metric because the
	 * text extraction pipeline produces empty strings from XLSX cells.  Adding
	 * xlsxBonusPages to dpu_nonempty_pages before the evidence gate E2 check gives
	 * a more accurate coverage estimate for XLSX-heavy deals.
	 *
	 * Defaults to 0 when the sub-query fails (fail-open, non-blocking).
	 */
	xlsxBonusPages: number;
}

// ─── DPU / slot input types ───────────────────────────────────────────────────

export interface DpuPage {
	document_id: string;
	page_index: number;
	/** Normalized OCR text — used by all detectors. */
	text: string;
	/** Original OCR output before normalization. */
	text_raw: string;
	/** Number of normalization transform events applied to this page. */
	norm_events_count: number;
}

export interface EvidenceSnippet {
	id: string;
	claim_text: string | null;
	/** Normalized form of claim_text, or null when claim_text was empty/null. */
	claim_text_norm: string | null;
}

export interface DpuDiagnostics {
	queryOk: boolean;
	rowCount: number;
	usablePageCount: number;
	sample: string;
	errorMessage?: string;
	errorCode?: string;
}

// ─── WS-C PR20: XLSX page usefulness heuristic ───────────────────────────────

/**
 * Heuristic version tag — increment when the rule set changes so log events
 * and test assertions can pin to a specific behaviour.
 */
export const XLSX_DPU_USEFUL_HEURISTIC_VERSION = "v1" as const;

/**
 * Determine whether an XLSX (excel_range) DPU page should be counted as
 * "useful" for the purposes of the evidence-gate E2 coverage check.
 *
 * Standard page_text non-empty check tends to under-count XLSX pages because
 * the extraction pipeline often produces an empty string even when the page
 * contains structured financial data.
 *
 * A page is counted as useful when ANY of the following hold:
 *   1. page_text length >= 80 characters.
 *   2. page_text contains >= 3 numeric KPI-like tokens (digits, optionally
 *      prefixed/suffixed with $, %, commas, dots, or K/M/B).
 *
 * This function is the canonical definition; the SQL query in
 * loadCoverageSnapshot uses a simplified approximation (condition 1 only via
 * character-count, plus `payload->'rows'` presence) to avoid per-row text
 * scanning at the DB layer.  Unit tests validate both agree on the common cases.
 *
 * @param page_text  The page_text string from document_page_understanding.payload.
 * @param page_type  The page_type value; this heuristic only applies to 'excel_range'.
 */
export function isXlsxPageUseful(page_text: string, page_type: string): boolean {
	if (page_type !== "excel_range") {
		// Non-XLSX pages: standard non-empty check.
		return page_text.trim().length > 0;
	}

	// Condition 1: at least 80 chars of text.
	if (page_text.length >= 80) return true;

	// Condition 2: >= 3 numeric KPI-like tokens.
	const numericTokenPattern = /(?<!\S)[\$£€]?[\d,]+(?:\.\d+)?[%KMBkmb]?(?!\S)/g;
	const matches = page_text.match(numericTokenPattern) ?? [];
	if (matches.length >= 3) return true;

	return false;
}

