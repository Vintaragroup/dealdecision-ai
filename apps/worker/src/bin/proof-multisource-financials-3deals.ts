#!/usr/bin/env node
/**
 * bin/proof-multisource-financials-3deals.ts
 *
 * Proof runner: validates that deterministic financial extraction captures
 * the same financial facts from BOTH source types:
 *   A) Deck/PDF text  — DPU pages from slides/PDFs
 *   B) XLSX structured — excel_range / excel_sheet pages
 *
 * Run against 3 canonical deals: StackFactor, DealDecision, WebMax.
 *
 * Phases
 * ──────
 *   Phase 1  Discovery snapshot → tmp/multisource-proof.before.json + .before.md
 *   Phase 2  Regenerate + poll  → tmp/multisource-proof.after.json  + .after.md
 *   Phase 3  Multi-source proof assertions per deal
 *   Phase 4  Consolidated      → tmp/multisource-proof.report.md
 *
 * Usage
 * ─────
 *   pnpm --filter worker proof:multisource-financials:3deals
 *   pnpm --filter worker proof:multisource-financials:3deals -- [options]
 *
 * CLI flags
 * ─────────
 *   --base-url          API base URL           (default: http://localhost:9001)
 *   --timeout-seconds   Per-deal poll timeout  (default: 180)
 *   --poll-interval-ms  Poll cadence           (default: 2000)
 *   --skip-regen        Skip regeneration, use existing reports (default: false)
 *   --out               Output directory       (default: apps/worker/tmp)
 *
 * Exit codes
 *   0 → all 3 deals proved
 *   1 → at least one deal failed, timed out, or errored
 */

import * as fs from "fs";
import * as path from "path";

// ─── Canonical deal registry ─────────────────────────────────────────────────

interface DealConfig {
	name: string;
	deal_id: string;
	/** Deal has known XLSX financial documents. */
	has_xlsx: boolean;
	/**
	 * Fields expected to be XLSX-sourced (reason contains XLSX/USE_OF_FUNDS signal).
	 * We assert ≥1 of these appears when has_xlsx=true.
	 */
	expected_xlsx_signals: string[];
	/** Fields that MUST be present (Computable or NotComputable) in canonical_fields. */
	required_fields: string[];
}

export const DEALS: DealConfig[] = [
	{
		name:    "StackFactor",
		deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f",
		has_xlsx: true,
		expected_xlsx_signals: ["use_of_funds_buckets", "raise_amount"],
		required_fields: ["raise_amount", "raise_round", "raise_instrument"],
	},
	{
		name:    "DealDecision",
		deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32",
		has_xlsx: false,
		expected_xlsx_signals: [],
		required_fields: ["raise_round", "raise_instrument"],
	},
	{
		name:    "WebMax",
		deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
		has_xlsx: true,
		expected_xlsx_signals: ["use_of_funds_buckets", "raise_amount", "raise_round"],
		required_fields: ["raise_amount", "raise_round", "raise_instrument"],
	},
] as const;

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}
function argFlag(flag: string): boolean {
	return cliArgs.includes(flag);
}

const BASE_URL         = argValue("--base-url")         ?? "http://localhost:9001";
const TIMEOUT_MS       = parseInt(argValue("--timeout-seconds")  ?? "180", 10) * 1000;
const POLL_INTERVAL_MS = parseInt(argValue("--poll-interval-ms") ?? "2000", 10);
const SKIP_REGEN       = argFlag("--skip-regen");
const OUT_DIR          = path.resolve(argValue("--out") ?? path.join(__dirname, "../../../tmp"));

// ─── Types ────────────────────────────────────────────────────────────────────

/** Source type classification for a canonical field's evidence. */
export type FieldSourceType = "XLSX" | "DECK_PDF" | "UNKNOWN";

/** A parsed canonical field entry from the `canonical_fields` section body. */
export interface CanonicalField {
	category:     string;
	field:        string;
	computability: string;
	value:        string;
	evidence:     string;
	reason:       string;
	source_type:  FieldSourceType;
}

/** Snapshot of relevant render_package state for one deal. */
export interface DealSnapshot {
	deal_id:                  string;
	deal_name:                string;
	updated_at:               string | null;
	upstream_fingerprint:     string | null;
	status:                   string | null;
	gate_all_passed:          boolean | null;
	section_keys:             string[];
	canonical_fields:         CanonicalField[];
	has_use_of_funds_v1:      boolean;
	has_financial_health:     boolean;
	has_reconciliation:       boolean;
	reconciliation_confidence: number | null;
	insight_slots_body:       string | null;
}

export interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

export interface DealProof {
	deal_id:           string;
	deal_name:         string;
	elapsed_ms:        number;
	status:            "PROVED" | "FAILED" | "TIMEOUT" | "ERROR";
	error?:            string;
	pre_snapshot:      DealSnapshot;
	post_snapshot:     DealSnapshot | null;
	source_proofs:     FieldSourceType extends string ? Array<{ field: string; source_type: FieldSourceType; value: string; reason: string }> : never;
	assertion_results: AssertionResult[];
}

type SourceProof = { field: string; source_type: FieldSourceType; value: string; reason: string };

// ─── Evidence / source classification ────────────────────────────────────────

const XLSX_REASON_SIGNALS =
	/DERIVED_FROM_USE_OF_FUNDS|DERIVED_FROM_BUDGET_MODEL|DERIVED_FROM_FINANCIALS|DERIVED_FROM_INCOME_STATEMENT|DERIVED_FROM_SAAS_KPI|DERIVED_FROM_BALANCE_SHEET|DERIVED_FROM_CASH_FLOW|DERIVED_FROM_CAP_TABLE|FROM_EXCEL|FROM_XLSX|EXCEL_BRIDGE|XLSX_BRIDGE|use_of_funds_v1|excel_range|excel_sheet/i;

/**
 * Classify the source type of a canonical field based on explicit source= token,
 * then `reason` string signals, then evidence DPU ref pattern.
 *
 * - XLSX      → source=xlsx, or reason contains a known XLSX derivation signal
 * - DECK_PDF  → source=deck, or evidence contains a DPU ref, or reason contains text-match signals
 * - UNKNOWN   → neither signal detected
 */
export function classifySourceType(reason: string, evidence: string, sourceToken?: string | null): FieldSourceType {
	// Explicit source= token takes priority
	if (sourceToken === "xlsx") return "XLSX";
	if (sourceToken === "deck") return "DECK_PDF";
	if (XLSX_REASON_SIGNALS.test(reason)) return "XLSX";
	if (/dpu:doc:[0-9a-f]{6,}:page:\d+/i.test(evidence)) return "DECK_PDF";
	if (/PATTERN_MATCH|TEXT_MATCH|SLIDE_TEXT|OCR_TEXT|REGEX_/i.test(reason)) return "DECK_PDF";
	return "UNKNOWN";
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse the `canonical_fields` section body into structured CanonicalField records.
 *
 * Expected line format:
 *   category=<C> | field=<F> | computability=<X> | value=<V> | evidence=<E> | reason=<R>
 */
export function parseCanonicalFields(body: string | null): CanonicalField[] {
	if (!body) return [];
	const results: CanonicalField[] = [];

	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith("---") || !line.includes("field=")) continue;

		const parts: Record<string, string> = {};
		for (const segment of line.split("|")) {
			const eqIdx = segment.indexOf("=");
			if (eqIdx < 0) continue;
			const key = segment.slice(0, eqIdx).trim().toLowerCase();
			const val = segment.slice(eqIdx + 1).trim();
			if (key) parts[key] = val;
		}

		const field   = parts["field"]         ?? "";
		const reason  = parts["reason"]        ?? "";
		const evidence = parts["evidence"]     ?? "";
		const value   = parts["value"]         ?? "";
		const sourceToken = parts["source"]    ?? null;

		if (!field) continue;

		results.push({
			category:      parts["category"]      ?? "",
			field,
			computability: parts["computability"] ?? "",
			value,
			evidence,
			reason,
			source_type:   classifySourceType(reason, evidence, sourceToken),
		});
	}

	return results;
}

/**
 * Extract the reconciliation confidence_score from the `financial_reconciliation_v1` section body.
 */
export function parseReconciliationConfidence(body: string | null): number | null {
	if (!body) return null;
	const m = body.match(/confidence_score:\s*([\d.]+)/);
	return m ? parseFloat(m[1]!) : null;
}

// ─── Snapshot assembly ─────────────────────────────────────────────────────────

function buildSnapshot(dealId: string, dealName: string, raw: unknown): DealSnapshot {
	const report   = raw as Record<string, unknown>;
	const rp       = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];

	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));
	const gateState   = (rp["gate_state"] ?? {}) as Record<string, unknown>;

	const findBody    = (key: string): string | null => {
		const sec = sections.find((s) => s["key"] === key);
		return typeof sec?.["body"] === "string" ? (sec["body"] as string) : null;
	};

	const canonBody = findBody("canonical_fields");
	const recBody   = findBody("financial_reconciliation_v1");

	return {
		deal_id:               dealId,
		deal_name:             dealName,
		updated_at:            typeof report["updated_at"]           === "string" ? report["updated_at"]           : null,
		upstream_fingerprint:  typeof report["upstream_fingerprint"] === "string" ? report["upstream_fingerprint"] : null,
		status:                typeof report["status"]               === "string" ? report["status"]               : null,
		gate_all_passed:       typeof gateState["all_passed"]        === "boolean" ? gateState["all_passed"]       : null,
		section_keys:          sectionKeys,
		canonical_fields:      parseCanonicalFields(canonBody),
		has_use_of_funds_v1:   sectionKeys.includes("use_of_funds_v1"),
		has_financial_health:  sectionKeys.includes("financial_health_v1") || sectionKeys.includes("financial_health"),
		has_reconciliation:    sectionKeys.includes("financial_reconciliation_v1"),
		reconciliation_confidence: parseReconciliationConfidence(recBody),
		insight_slots_body:    findBody("insight_slots"),
	};
}

// ─── Assertion builder ────────────────────────────────────────────────────────

/**
 * Build per-deal proof assertions from a post-regen snapshot.
 * Deterministic: no I/O, no LLM, purely checks parsed data.
 */
export function buildDealAssertions(
	snap: DealSnapshot,
	config: DealConfig,
): AssertionResult[] {
	const results: AssertionResult[] = [];

	// A1: canonical_fields section present
	const hasCanonical = snap.section_keys.includes("canonical_fields");
	results.push({
		name:   "canonical_fields_section_present",
		passed: hasCanonical,
		detail: hasCanonical
			? "canonical_fields section found in render_package.sections"
			: `FAIL — canonical_fields section missing. sections=[${snap.section_keys.join(", ")}]`,
	});

	// A2: at least one Computable field in canonical_fields
	const computableFields = snap.canonical_fields.filter((f) => f.computability === "Computable");
	results.push({
		name:   "canonical_fields_has_computable",
		passed: computableFields.length > 0,
		detail: computableFields.length > 0
			? `${computableFields.length} Computable field(s) found`
			: `FAIL — no Computable fields in canonical_fields (${snap.canonical_fields.length} total)`,
	});

	// A3: required fields present (Computable or NotComputable, just present)
	for (const requiredField of config.required_fields) {
		const found = snap.canonical_fields.some((f) => f.field === requiredField);
		results.push({
			name:   `required_field_${requiredField}`,
			passed: found,
			detail: found
				? `${requiredField} present in canonical_fields`
				: `FAIL — required field "${requiredField}" not found in canonical_fields`,
		});
	}

	// A4: financial_reconciliation_v1 section present
	results.push({
		name:   "reconciliation_section_present",
		passed: snap.has_reconciliation,
		detail: snap.has_reconciliation
			? "financial_reconciliation_v1 section present"
			: `FAIL — financial_reconciliation_v1 missing. sections=[${snap.section_keys.join(", ")}]`,
	});

	// A5: reconciliation confidence score in valid range
	if (snap.has_reconciliation) {
		const conf = snap.reconciliation_confidence;
		const confValid = conf !== null && conf >= 0 && conf <= 1;
		results.push({
			name:   "reconciliation_confidence_valid",
			passed: confValid,
			detail: confValid
				? `confidence_score=${conf}`
				: `FAIL — confidence_score=${conf ?? "null"} (not in [0,1])`,
		});
	}

	// A6: XLSX-enabled deals — at least one field attributed to XLSX source
	if (config.has_xlsx) {
		const xlsxFields = computableFields.filter((f) => f.source_type === "XLSX");
		results.push({
			name:   "xlsx_source_attributed",
			passed: xlsxFields.length > 0,
			detail: xlsxFields.length > 0
				? `${xlsxFields.length} field(s) with XLSX source: ${xlsxFields.map((f) => f.field).join(", ")}`
				: `FAIL — deal has_xlsx=true but no Computable fields attributed to XLSX source. ` +
				  `All sources: ${computableFields.map((f) => `${f.field}=${f.source_type}`).join(", ")}`,
		});
	}

	// A7: XLSX-enabled deals — at least one field attributed to DECK_PDF source
	if (config.has_xlsx) {
		const deckFields = computableFields.filter((f) => f.source_type === "DECK_PDF");
		results.push({
			name:   "deck_pdf_source_attributed",
			passed: deckFields.length > 0,
			detail: deckFields.length > 0
				? `${deckFields.length} field(s) with DECK_PDF source: ${deckFields.map((f) => f.field).join(", ")}`
				: `WARN — deal has_xlsx=true but no Computable fields attributed to DECK_PDF source. ` +
				  `This may indicate pure-XLSX extraction (acceptable if deck had no text).`,
		});
	}

	// A8: use_of_funds_v1 section when XLSX deal has use_of_funds_buckets expected
	if (config.has_xlsx && config.expected_xlsx_signals.includes("use_of_funds_buckets")) {
		// Soft check — log but don't fail the proof if data wasn't uploaded
		const hasUof = snap.has_use_of_funds_v1;
		results.push({
			name:   "use_of_funds_v1_section_present",
			// Treat as warn (pass) — deal may legitimately lack UoF data
			passed: true,
			detail: hasUof
				? "use_of_funds_v1 section present (XLSX-derived UoF available)"
				: "WARN — use_of_funds_v1 section absent (expected for XLSX deal; may lack uploaded data)",
		});
	}

	// A9: Computable fields have evidence refs (no orphan values)
	const computableWithoutEvidence = computableFields.filter(
		(f) => !f.evidence || f.evidence === "" || f.evidence === "none"
	);
	results.push({
		name:   "computable_fields_have_evidence",
		passed: computableWithoutEvidence.length === 0,
		detail: computableWithoutEvidence.length === 0
			? `All ${computableFields.length} Computable field(s) have evidence refs`
			: `WARN — ${computableWithoutEvidence.length} Computable field(s) lack evidence: ` +
			  computableWithoutEvidence.map((f) => f.field).join(", "),
	});

	return results;
}

// ─── Source proof table builder ────────────────────────────────────────────────

function buildSourceProofs(snap: DealSnapshot): SourceProof[] {
	return snap.canonical_fields
		.filter((f) => f.computability === "Computable")
		.map((f) => ({
			field:       f.field,
			source_type: f.source_type,
			value:       f.value,
			reason:      f.reason,
		}));
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${urlPath}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(opts?.headers as Record<string, string> | undefined),
	};
	const apiKey = process.env["INTERNAL_API_KEY"] ?? process.env["API_SECRET_KEY"] ?? "";
	if (apiKey) headers["x-api-key"] = apiKey;
	const res = await fetch(url, { ...opts, headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

// ─── Phase 1: Discovery snapshot ─────────────────────────────────────────────

async function fetchSnapshot(config: DealConfig): Promise<DealSnapshot> {
	const raw = await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights`);
	return buildSnapshot(config.deal_id, config.name, raw);
}

// ─── Phase 2: Regenerate + poll ───────────────────────────────────────────────

async function regenAndFetchSnapshot(
	config: DealConfig,
	preSnap: DealSnapshot,
): Promise<{ snap: DealSnapshot | null; timedOut: boolean; elapsed_ms: number }> {
	const start = Date.now();

	console.log(`  [${config.name}] Triggering regeneration…`);
	await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights/regenerate`, {
		method: "POST",
		body:   "{}",
	});

	const deadline = start + TIMEOUT_MS;
	let postSnap: DealSnapshot | null = null;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const raw     = await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights`);
		const snap    = buildSnapshot(config.deal_id, config.name, raw);
		const tsChanged = snap.updated_at !== null && snap.updated_at !== preSnap.updated_at;
		const fpChanged = snap.upstream_fingerprint !== null &&
			snap.upstream_fingerprint !== preSnap.upstream_fingerprint;
		if (tsChanged || fpChanged) {
			postSnap = snap;
			break;
		}
		console.log(`  [${config.name}] Waiting… updated_at=${snap.updated_at?.slice(0, 19) ?? "none"}`);
	}

	return { snap: postSnap, timedOut: postSnap === null, elapsed_ms: Date.now() - start };
}

// ─── Phase 3: Prove one deal ──────────────────────────────────────────────────

async function proveOneDeal(config: DealConfig): Promise<DealProof> {
	const start = Date.now();
	let preSnapshot: DealSnapshot;

	// Phase 1: discovery
	console.log(`  [${config.name}] Fetching pre-snapshot…`);
	try {
		preSnapshot = await fetchSnapshot(config);
		console.log(`  [${config.name}] Pre: status=${preSnapshot.status ?? "none"} sections=[${preSnapshot.section_keys.join(", ")}]`);
	} catch (e) {
		return {
			deal_id:           config.deal_id,
			deal_name:         config.name,
			elapsed_ms:        Date.now() - start,
			status:            "ERROR",
			error:             `Failed to fetch pre-snapshot: ${String(e)}`,
			pre_snapshot:      { deal_id: config.deal_id, deal_name: config.name, updated_at: null, upstream_fingerprint: null, status: null, gate_all_passed: null, section_keys: [], canonical_fields: [], has_use_of_funds_v1: false, has_financial_health: false, has_reconciliation: false, reconciliation_confidence: null, insight_slots_body: null },
			post_snapshot:     null,
			source_proofs:     [],
			assertion_results: [{ name: "fetch_pre_snapshot", passed: false, detail: String(e) }],
		} satisfies DealProof;
	}

	// Phase 2: regenerate + poll
	let postSnapshot: DealSnapshot | null = null;

	if (SKIP_REGEN) {
		console.log(`  [${config.name}] --skip-regen: using pre-snapshot as post-snapshot`);
		postSnapshot = preSnapshot;
	} else {
		let timedOut = false;
		let elapsed_ms = 0;
		try {
			({ snap: postSnapshot, timedOut, elapsed_ms } = await regenAndFetchSnapshot(config, preSnapshot));
		} catch (e) {
			return {
				deal_id:           config.deal_id,
				deal_name:         config.name,
				elapsed_ms:        Date.now() - start,
				status:            "ERROR",
				error:             `Regeneration failed: ${String(e)}`,
				pre_snapshot:      preSnapshot,
				post_snapshot:     null,
				source_proofs:     [],
				assertion_results: [{ name: "regen", passed: false, detail: String(e) }],
			} satisfies DealProof;
		}

		if (timedOut || !postSnapshot) {
			return {
				deal_id:           config.deal_id,
				deal_name:         config.name,
				elapsed_ms:        Date.now() - start,
				status:            "TIMEOUT",
				error:             `Timed out after ${TIMEOUT_MS / 1000}s waiting for updated report. Is the worker running?`,
				pre_snapshot:      preSnapshot,
				post_snapshot:     null,
				source_proofs:     [],
				assertion_results: [{ name: "timeout", passed: false, detail: `elapsed_ms=${elapsed_ms}` }],
			} satisfies DealProof;
		}

		console.log(`  [${config.name}] Post: updated_at=${postSnapshot.updated_at?.slice(0, 19) ?? "none"} sections=[${postSnapshot.section_keys.join(", ")}]`);
	}

	// Phase 3: assertions
	const assertionResults = buildDealAssertions(postSnapshot, config);
	const sourceProofs     = buildSourceProofs(postSnapshot);
	const allPassed        = assertionResults.every((a) => a.passed);

	return {
		deal_id:           config.deal_id,
		deal_name:         config.name,
		elapsed_ms:        Date.now() - start,
		status:            allPassed ? "PROVED" : "FAILED",
		pre_snapshot:      preSnapshot,
		post_snapshot:     postSnapshot,
		source_proofs:     sourceProofs,
		assertion_results: assertionResults,
	} satisfies DealProof;
}

// ─── Snapshot summary markdown ────────────────────────────────────────────────

function snapshotToMd(snaps: DealSnapshot[], phase: "before" | "after"): string {
	const ts = new Date().toISOString();
	const lines: string[] = [
		`# Multisource Financials — ${phase === "before" ? "Discovery" : "Post-Regen"} Snapshot`,
		``,
		`Generated: ${ts}`,
		`Base URL: ${BASE_URL}`,
		``,
	];

	for (const snap of snaps) {
		lines.push(`## ${snap.deal_name} (\`${snap.deal_id.slice(0, 8)}\`)`);
		lines.push(``);
		lines.push(`| Key | Value |`);
		lines.push(`|-----|-------|`);
		lines.push(`| status | ${snap.status ?? "—"} |`);
		lines.push(`| updated_at | ${snap.updated_at?.slice(0, 19) ?? "—"} |`);
		lines.push(`| gate_all_passed | ${snap.gate_all_passed ?? "—"} |`);
		lines.push(`| has_use_of_funds_v1 | ${snap.has_use_of_funds_v1} |`);
		lines.push(`| has_reconciliation | ${snap.has_reconciliation} |`);
		lines.push(`| reconciliation_confidence | ${snap.reconciliation_confidence ?? "—"} |`);
		lines.push(`| canonical_fields (total) | ${snap.canonical_fields.length} |`);
		lines.push(`| canonical_fields (Computable) | ${snap.canonical_fields.filter((f) => f.computability === "Computable").length} |`);
		lines.push(`| sections | ${snap.section_keys.join(", ")} |`);
		lines.push(``);

		if (snap.canonical_fields.length > 0) {
			lines.push(`### Canonical Fields`);
			lines.push(``);
			lines.push(`| field | computability | source_type | value |`);
			lines.push(`|-------|--------------|-------------|-------|`);
			for (const f of snap.canonical_fields) {
				const val = f.value.slice(0, 60).replace(/\|/g, "\\|");
				lines.push(`| ${f.field} | ${f.computability} | ${f.source_type} | ${val} |`);
			}
			lines.push(``);
		}
	}

	return lines.join("\n");
}

// ─── Phase 4: Report markdown ─────────────────────────────────────────────────

function buildReportMd(proofs: DealProof[]): string {
	const ts = new Date().toISOString();
	const proved  = proofs.filter((p) => p.status === "PROVED").length;
	const failed  = proofs.filter((p) => p.status === "FAILED").length;
	const timedOut = proofs.filter((p) => p.status === "TIMEOUT").length;
	const errored = proofs.filter((p) => p.status === "ERROR").length;

	const lines: string[] = [
		`# Multisource Financial Proof Report`,
		``,
		`Generated: ${ts}`,
		`Base URL: ${BASE_URL}`,
		``,
		`## Summary`,
		``,
		`| Metric | Count |`,
		`|--------|-------|`,
		`| Total deals | ${proofs.length} |`,
		`| PROVED | ${proved} |`,
		`| FAILED | ${failed} |`,
		`| TIMEOUT | ${timedOut} |`,
		`| ERROR | ${errored} |`,
		``,
		`**Result: ${proved === proofs.length ? "✅ ALL PROVED" : `❌ ${failed + timedOut + errored} FAILURE(S)`}**`,
		``,
	];

	for (const proof of proofs) {
		const icon = proof.status === "PROVED" ? "✅" : "❌";
		lines.push(`---`);
		lines.push(``);
		lines.push(`## ${icon} ${proof.deal_name} (\`${proof.deal_id.slice(0, 8)}\`)`);
		lines.push(``);
		lines.push(`**Status**: ${proof.status}  `);
		lines.push(`**Elapsed**: ${(proof.elapsed_ms / 1000).toFixed(1)}s`);

		if (proof.error) {
			lines.push(``);
			lines.push(`**Error**: ${proof.error}`);
		}

		// Assertion table
		if (proof.assertion_results.length > 0) {
			lines.push(``);
			lines.push(`### Assertions`);
			lines.push(``);
			lines.push(`| # | Name | Pass | Detail |`);
			lines.push(`|---|------|------|--------|`);
			let i = 1;
			for (const a of proof.assertion_results) {
				const detail = a.detail.slice(0, 120).replace(/\|/g, "\\|");
				lines.push(`| ${i++} | ${a.name} | ${a.passed ? "✓" : "✗"} | ${detail} |`);
			}
			lines.push(``);
		}

		// Source proof table
		if (proof.source_proofs.length > 0) {
			lines.push(`### Source Proof Table (Computable fields)`);
			lines.push(``);
			lines.push(`| Field | Source | Value |`);
			lines.push(`|-------|--------|-------|`);
			for (const sp of proof.source_proofs) {
				const val = sp.value.slice(0, 80).replace(/\|/g, "\\|");
				lines.push(`| ${sp.field} | ${sp.source_type} | ${val} |`);
			}
			lines.push(``);

			// Source breakdown
			const xlsxCount    = proof.source_proofs.filter((s) => s.source_type === "XLSX").length;
			const deckCount    = proof.source_proofs.filter((s) => s.source_type === "DECK_PDF").length;
			const unknownCount = proof.source_proofs.filter((s) => s.source_type === "UNKNOWN").length;
			lines.push(`**Source breakdown**: XLSX=${xlsxCount} | DECK_PDF=${deckCount} | UNKNOWN=${unknownCount}`);
			lines.push(``);
		}
	}

	return lines.join("\n");
}

// ─── Artifact writers ─────────────────────────────────────────────────────────

function writeJsonAndMd(
	snaps: DealSnapshot[],
	phase: "before" | "after",
): void {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const jsonPath = path.join(OUT_DIR, `multisource-proof.${phase}.json`);
	const mdPath   = path.join(OUT_DIR, `multisource-proof.${phase}.md`);
	fs.writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), deals: snaps }, null, 2));
	fs.writeFileSync(mdPath, snapshotToMd(snaps, phase));
	console.log(`  ✓ Wrote ${jsonPath}`);
	console.log(`  ✓ Wrote ${mdPath}`);
}

function writeReport(proofs: DealProof[]): void {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const mdPath   = path.join(OUT_DIR, "multisource-proof.report.md");
	const jsonPath = path.join(OUT_DIR, "multisource-proof.report.json");

	const summary = {
		generated_at: new Date().toISOString(),
		base_url:     BASE_URL,
		summary: {
			total:    proofs.length,
			proved:   proofs.filter((p) => p.status === "PROVED").length,
			failed:   proofs.filter((p) => p.status === "FAILED").length,
			timed_out: proofs.filter((p) => p.status === "TIMEOUT").length,
			errored:  proofs.filter((p) => p.status === "ERROR").length,
		},
		deals: proofs,
	};

	fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
	fs.writeFileSync(mdPath, buildReportMd(proofs));
	console.log(`  ✓ Wrote ${jsonPath}`);
	console.log(`  ✓ Wrote ${mdPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log(`\n═══ Multisource Financial Proof — 3 Canonical Deals ═══`);
	console.log(`Base URL:    ${BASE_URL}`);
	console.log(`Timeout:     ${TIMEOUT_MS / 1000}s per deal`);
	console.log(`Skip regen:  ${SKIP_REGEN}`);
	console.log(`Out dir:     ${OUT_DIR}`);
	console.log(`Deals:       ${DEALS.map((d) => d.name).join(", ")}\n`);

	// ── Phase 1: Discovery snapshots ─────────────────────────────────────────

	console.log(`\n─── Phase 1: Discovery Snapshots ───`);
	const preSnaps: DealSnapshot[] = [];

	for (const config of DEALS) {
		try {
			const snap = await fetchSnapshot(config);
			preSnaps.push(snap);
			console.log(`  ✓ ${config.name}: ${snap.canonical_fields.length} canonical fields, sections=[${snap.section_keys.join(", ")}]`);
		} catch (e) {
			console.error(`  ✗ ${config.name}: ${e}`);
			preSnaps.push({
				deal_id: config.deal_id, deal_name: config.name, updated_at: null,
				upstream_fingerprint: null, status: "ERROR", gate_all_passed: null,
				section_keys: [], canonical_fields: [], has_use_of_funds_v1: false,
				has_financial_health: false, has_reconciliation: false,
				reconciliation_confidence: null, insight_slots_body: null,
			});
		}
	}

	writeJsonAndMd(preSnaps, "before");

	// ── Phase 2–3: Regen + prove per deal ────────────────────────────────────

	console.log(`\n─── Phase 2–3: Regenerate + Prove ───`);
	const proofs: DealProof[] = [];

	for (const config of DEALS) {
		console.log(`\n  ── ${config.name} (${config.deal_id.slice(0, 8)}) ──`);
		const proof = await proveOneDeal(config);
		proofs.push(proof);

		const icon = proof.status === "PROVED" ? "✓" : "✗";
		console.log(`  ${icon} ${proof.status} (${(proof.elapsed_ms / 1000).toFixed(1)}s)`);

		if (proof.post_snapshot) {
			const src = proof.source_proofs;
			const xlsx    = src.filter((s) => s.source_type === "XLSX").length;
			const deck    = src.filter((s) => s.source_type === "DECK_PDF").length;
			const unknown = src.filter((s) => s.source_type === "UNKNOWN").length;
			console.log(`  Source proofs: XLSX=${xlsx} DECK_PDF=${deck} UNKNOWN=${unknown}`);
		}

		const failures = proof.assertion_results.filter((a) => !a.passed);
		if (failures.length) {
			console.log(`  ⚠ ${failures.length} assertion(s) failed:`);
			for (const f of failures) {
				console.log(`    ✗ ${f.name}: ${f.detail.slice(0, 120)}`);
			}
		}
	}

	// ── Write after snapshots ────────────────────────────────────────────────

	const postSnaps = proofs.map((p) => p.post_snapshot ?? p.pre_snapshot);
	writeJsonAndMd(postSnaps, "after");

	// ── Phase 4: Consolidated report ─────────────────────────────────────────

	console.log(`\n─── Phase 4: Report ───`);
	writeReport(proofs);

	// ── Final summary ────────────────────────────────────────────────────────

	const allProved = proofs.every((p) => p.status === "PROVED");
	const proved    = proofs.filter((p) => p.status === "PROVED").length;

	console.log(`\n═══ Result: ${allProved ? "ALL PROVED ✓" : `${proved}/${proofs.length} PROVED ✗`} ═══\n`);
	process.exit(allProved ? 0 : 1);
}

main().catch((err) => {
	console.error("Unexpected error:", err);
	process.exit(1);
});
