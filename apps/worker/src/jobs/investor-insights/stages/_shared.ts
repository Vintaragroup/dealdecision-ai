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
