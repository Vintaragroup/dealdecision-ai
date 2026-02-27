#!/usr/bin/env node
/**
 * bin/verify-implied-capital-3deals-e2e.ts
 *
 * Full E2E proof: "Implied Capital Allocation (Budget Model)" pipeline works
 * correctly for 3 deals.
 *
 * Phases
 * ──────
 * 1. DISCOVERY  — DB queries: document inventory + DPU page coverage per deal
 * 2. REGENERATE — POST /api/v1/deals/:id/investor-insights/regenerate (bypasses dedup)
 * 3. POLL       — wait for updated_at to change, then snapshot render_package
 * 4. PROVE      — extract compact proof object and run per-deal assertions
 * 5. REPORT     — write JSON + MD artifacts, print summary, exit 0/1
 *
 * Expected outcomes
 * ─────────────────
 *   StackFactor  → OK_BUDGET_MODEL  (implied_capital_allocation_v1 section + slot promoted)
 *   DealDecision → NOT_PRESENT or OK_TEXT/OK_EXPLICIT_UOF  (must NOT be budget model)
 *   WebMax       → NOT_PRESENT or OK_TEXT/OK_EXPLICIT_UOF  (must NOT be budget model)
 *
 * Usage
 * ─────
 *   pnpm --filter worker verify:implied-capital:3deals
 *   pnpm --filter worker verify:implied-capital:3deals -- \
 *     --base-url http://localhost:9001 \
 *     --timeout-seconds 180 \
 *     --poll-interval-ms 2000 \
 *     --out apps/worker/tmp
 *
 * Artifacts
 * ─────────
 *   apps/worker/tmp/implied-capital-verify-3deals.json  — machine-readable
 *   apps/worker/tmp/implied-capital-verify-3deals.md    — human-readable summary
 *
 * Exit codes
 *   0 → all assertions passed (no wiring bugs)
 *   1 → at least one deal failed, timed out, errored, or has a wiring bug
 */

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

// ─── Configuration ────────────────────────────────────────────────────────────

const DEALS = [
	{ name: "StackFactor",  deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
	{ name: "DealDecision", deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "WebMax",       deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4" },
] as const;

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE_URL          = argValue("--base-url")          ?? "http://localhost:9001";
const TIMEOUT_SECONDS   = parseInt(argValue("--timeout-seconds")   ?? "180", 10);
const TIMEOUT_MS        = TIMEOUT_SECONDS * 1000;
const POLL_INTERVAL_MS  = parseInt(argValue("--poll-interval-ms")  ?? "2000", 10);
const OUT_DIR_ARG       = argValue("--out");

// ─── DB pool ────────────────────────────────────────────────────────────────

const cs = process.env["DATABASE_URL"];
let pool: Pool | null = null;
if (cs) {
	pool = new Pool({
		connectionString: cs,
		ssl:
			cs.includes("sslmode=require") || process.env["PGSSLMODE"] === "require"
				? { rejectUnauthorized: false }
				: false,
	});
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImpliedCapitalOutcome =
	| "OK_BUDGET_MODEL"    // implied_capital_v1 section + slot reason=DERIVED_FROM_BUDGET_MODEL
	| "OK_EXPLICIT_UOF"    // explicit use_of_funds_v1 section (budget model not needed)
	| "OK_TEXT"            // text-pattern UoF slot promotion
	| "NOT_PRESENT"        // no UoF data of any kind — acceptable for non-budget-model deals
	| "WIRING_BUG";        // implied_capital section present but slot NOT promoted

interface DocRow {
	id: string;
	filename: string | null;
	mime_type: string | null;
}

interface DpuSheetRow {
	page_index: number;
	page_type: string;
	sheet_title: string | null;
	text_len: number;
	text_preview: string;
}

interface DpuPageTypeSummary {
	page_type: string;
	count: number;
}

interface DocDiscovery {
	doc_id:         string;
	filename:       string | null;
	mime_type:      string | null;
	dpu_page_count: number;
	page_type_summary: DpuPageTypeSummary[];
	excel_sheets:   DpuSheetRow[];
}

interface DealDiscovery {
	deal_id:    string;
	deal_name:  string;
	docs:       DocDiscovery[];
	error?:     string;
}

interface UofSlotParsed {
	raw_line:        string;
	is_computable:   boolean;
	reason:          string | null;
	value_preview:   string | null;
	evidence:        string | null;
}

interface InsightsProof {
	updated_at:                                   string | null;
	upstream_fingerprint:                         string | null;
	sections_present:                             string[];
	has_implied_capital_allocation_v1_section:    boolean;
	implied_capital_allocation_v1_body_preview:   string | null;
	use_of_funds_slot_line:                       string | null;
	use_of_funds_slot_reason:                     string | null;
	use_of_funds_slot_value_preview:              string | null;
	use_of_funds_slot_evidence:                   string | null;
	governed_summary_v1_present:                  boolean;
	governed_summary_mentions_implied:            boolean;
	governed_summary_body_preview:                string | null;
}

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

interface DealResult {
	deal_id:        string;
	deal_name:      string;
	discovery:      DealDiscovery | null;
	status:         "ok" | "fail" | "timeout" | "error";
	error?:         string;
	elapsed_ms:     number;
	outcome:        ImpliedCapitalOutcome | null;
	pre_updated_at: string | null;
	post_updated_at:string | null;
	proof:          InsightsProof | null;
	assertions:     AssertionResult[];
}

// ─── DB: Discovery ────────────────────────────────────────────────────────────

async function runDiscovery(dealId: string, dealName: string): Promise<DealDiscovery> {
	if (!pool) {
		return {
			deal_id:   dealId,
			deal_name: dealName,
			docs:      [],
			error:     "DATABASE_URL not set — discovery skipped",
		};
	}

	try {
		// 1. Get all documents for this deal
		const docsRes = await pool.query<{
			id: string;
			filename: string | null;
			mime_type: string | null;
		}>(
			`SELECT d.id::text, f.file_name AS filename, COALESCE(f.mime_type, d.mime_type) AS mime_type
			   FROM documents d
			   LEFT JOIN document_files f ON f.document_id = d.id
			  WHERE d.deal_id = $1::uuid
			  ORDER BY d.uploaded_at, d.id`,
			[dealId],
		);

		// 2. Get DPU pages for all docs (including sheet title from page_text first line)
		const dpuRes = await pool.query<{
			doc_id:      string;
			page_index:  number;
			page_type:   string | null;
			segment_key: string | null;
			title_hint:  string | null;
			text_len:    number;
			text_preview:string | null;
		}>(
			`SELECT
			   d.id::text AS doc_id,
			   dpu.page_index,
			   dpu.payload->>'page_type'    AS page_type,
			   dpu.payload->>'segment_key'  AS segment_key,
			   left(dpu.payload->>'page_text', 200) AS title_hint,
			   length(dpu.payload->>'page_text')    AS text_len,
			   left(dpu.payload->>'page_text', 400) AS text_preview
			 FROM document_page_understanding dpu
			 JOIN documents d ON d.id = dpu.document_id
			WHERE d.deal_id = $1::uuid
			ORDER BY d.uploaded_at, d.id, dpu.page_index`,
			[dealId],
		);

		// Group DPU rows by doc_id
		const dpuByDoc = new Map<string, typeof dpuRes.rows>();
		for (const row of dpuRes.rows) {
			if (!dpuByDoc.has(row.doc_id)) dpuByDoc.set(row.doc_id, []);
			dpuByDoc.get(row.doc_id)!.push(row);
		}

		const docs: DocDiscovery[] = [];
		for (const doc of docsRes.rows) {
			const dpuRows = dpuByDoc.get(doc.id) ?? [];

			// Page type summary counts
			const typeCount = new Map<string, number>();
			for (const r of dpuRows) {
				const t = r.page_type ?? "unknown";
				typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
			}
			const page_type_summary: DpuPageTypeSummary[] = [];
			for (const [pt, count] of typeCount.entries()) {
				page_type_summary.push({ page_type: pt, count });
			}
			page_type_summary.sort((a, b) => b.count - a.count);

			// Excel sheet details (page_type = "excel_sheet")
			const excel_sheets: DpuSheetRow[] = dpuRows
				.filter((r) => r.page_type === "excel_sheet")
				.map((r) => {
					// Extract sheet name from first line of page_text
					const firstLine = (r.title_hint ?? "").split("\n")[0] ?? "";
					const sheetTitle = firstLine.replace(/^[-\s]*/, "").trim().slice(0, 80) || null;
					return {
						page_index: r.page_index,
						page_type:  r.page_type ?? "excel_sheet",
						sheet_title: sheetTitle,
						text_len:    r.text_len ?? 0,
						text_preview: (r.text_preview ?? "").slice(0, 300),
					};
				});

			docs.push({
				doc_id:            doc.id,
				filename:          doc.filename,
				mime_type:         doc.mime_type,
				dpu_page_count:    dpuRows.length,
				page_type_summary,
				excel_sheets,
			});
		}

		return { deal_id: dealId, deal_name: dealName, docs };
	} catch (err) {
		return {
			deal_id:   dealId,
			deal_name: dealName,
			docs:      [],
			error:     err instanceof Error ? err.message : String(err),
		};
	}
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${urlPath}`;
	const res = await fetch(url, opts);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${body.slice(0, 300)}`);
	}
	return res.json();
}

async function getInsightsSnapshot(dealId: string): Promise<InsightsProof | null> {
	try {
		const data = await apiFetch(`/api/v1/deals/${dealId}/investor-insights`);
		return extractProof(data);
	} catch {
		return null;
	}
}

async function triggerRegenerate(dealId: string): Promise<void> {
	await apiFetch(`/api/v1/deals/${dealId}/investor-insights/regenerate`, { method: "POST" });
}

async function pollUntilFresh(
	dealId: string,
	priorUpdatedAt: string | null,
): Promise<InsightsProof | "timeout"> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		const snap = await getInsightsSnapshot(dealId);
		if (!snap) continue;
		if (snap.updated_at !== priorUpdatedAt) return snap;
	}
	return "timeout";
}

// ─── Proof extraction ─────────────────────────────────────────────────────────

function parseUofSlotLine(line: string): UofSlotParsed {
	const isComputable = line.includes("Computable");

	// Extract reason — looks for "reason=SOMETHING" or "reason: SOMETHING"
	const reasonMatch  = line.match(/reason[=:]\s*([A-Z_]+)/i);
	const reason       = reasonMatch ? (reasonMatch[1] ?? null) : null;

	// Extract evidence — "dpu:doc:..." pattern
	const evidenceMatch = line.match(/dpu:[^\s|)]+/);
	const evidence      = evidenceMatch ? evidenceMatch[0]! : null;

	// Extract value — content between first "value=" and next "|" or end of line
	const valueMatch = line.match(/value="([^"]*?)"/);
	let value_preview: string | null = null;
	if (valueMatch) {
		value_preview = (valueMatch[1] ?? "").slice(0, 400);
	} else {
		// Try unquoted: value=<text> | ...
		const uvMatch = line.match(/value=([^|]+)/);
		if (uvMatch) value_preview = (uvMatch[1] ?? "").trim().slice(0, 400);
	}

	return {
		raw_line:      line.trim(),
		is_computable: isComputable,
		reason,
		value_preview,
		evidence,
	};
}

function extractProof(rawData: unknown): InsightsProof {
	const report   = rawData as Record<string, unknown>;
	const rp       = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];

	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));

	const findBody = (key: string): string | null => {
		const s = sections.find((s) => s["key"] === key);
		return typeof s?.["body"] === "string" ? s["body"] : null;
	};

	const impliedCapBody     = findBody("implied_capital_allocation_v1");
	const insightSlotsBody   = findBody("insight_slots") ?? "";
	const govSummaryBody     = findBody("governed_summary_v1");

	// Find the use_of_funds slot line
	const uofSlotLine = insightSlotsBody
		.split("\n")
		.find((l) => /^use_of_funds\s*[:|]/.test(l.trim())) ?? null;

	const slotParsed = uofSlotLine ? parseUofSlotLine(uofSlotLine) : null;

	return {
		updated_at:                                 typeof report["updated_at"]            === "string" ? report["updated_at"]            : null,
		upstream_fingerprint:                       typeof report["upstream_fingerprint"]  === "string" ? report["upstream_fingerprint"]  : null,
		sections_present:                           sectionKeys,
		has_implied_capital_allocation_v1_section:  sectionKeys.includes("implied_capital_allocation_v1"),
		implied_capital_allocation_v1_body_preview: impliedCapBody ? impliedCapBody.slice(0, 400) : null,
		use_of_funds_slot_line:                     uofSlotLine,
		use_of_funds_slot_reason:                   slotParsed?.reason ?? null,
		use_of_funds_slot_value_preview:            slotParsed?.value_preview ?? null,
		use_of_funds_slot_evidence:                 slotParsed?.evidence ?? null,
		governed_summary_v1_present:                sectionKeys.includes("governed_summary_v1"),
		// Checks for "implied" OR "budget model" / "budget" since the LLM may paraphrase.
		governed_summary_mentions_implied:            govSummaryBody
			? /implied|budget\s+model|budget\s+allocation/i.test(govSummaryBody)
			: false,
		governed_summary_body_preview:                govSummaryBody ? govSummaryBody.slice(0, 600) : null,
	};
}

// ─── Outcome classification ───────────────────────────────────────────────────

function classifyOutcome(proof: InsightsProof): ImpliedCapitalOutcome {
	const hasImpliedSection = proof.has_implied_capital_allocation_v1_section;
	const hasUofSection     = proof.sections_present.includes("use_of_funds_v1");
	const reason            = proof.use_of_funds_slot_reason ?? "";
	const isComputable      = !!proof.use_of_funds_slot_line?.includes("Computable");

	// Explicit UoF section → not our feature, acceptable
	if (hasUofSection) return "OK_EXPLICIT_UOF";

	// Slot promoted via budget model reason
	if (reason === "DERIVED_FROM_BUDGET_MODEL") return "OK_BUDGET_MODEL";

	// Implied section present but slot NOT promoted → wiring bug
	if (hasImpliedSection && !isComputable) return "WIRING_BUG";

	// Text-based slot
	if (isComputable) return "OK_TEXT";

	return "NOT_PRESENT";
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function runAssertions(
	dealName: string,
	proof: InsightsProof,
	outcome: ImpliedCapitalOutcome,
): AssertionResult[] {
	const a: AssertionResult[] = [];

	// --- Universal assertions ---

	// 1. No wiring bug
	a.push({
		name:   "no_wiring_bug",
		passed:  outcome !== "WIRING_BUG",
		detail:  outcome === "WIRING_BUG"
			? `implied_capital_allocation_v1 section is present but use_of_funds slot was NOT promoted (outcome=WIRING_BUG)`
			: `outcome=${outcome} — no wiring bug detected`,
	});

	// 2. If implied capital section is present: must contain [IMPLIED] label
	if (proof.has_implied_capital_allocation_v1_section) {
		const body     = proof.implied_capital_allocation_v1_body_preview ?? "";
		const hasLabel = /IMPLIED/i.test(body);
		a.push({
			name:   "implied_capital_section_has_implied_label",
			passed:  hasLabel,
			detail:  hasLabel
				? `implied_capital_allocation_v1 body contains 'IMPLIED' label ✓`
				: `MISSING 'IMPLIED' label in implied_capital_allocation_v1 body — first 400 chars: ${body.slice(0, 200)}`,
		});

		const hasBudgetBasis = /budget_model/i.test(body);
		a.push({
			name:   "implied_capital_section_has_budget_model_basis",
			passed:  hasBudgetBasis,
			detail:  hasBudgetBasis
				? `implied_capital_allocation_v1 body contains 'budget_model' basis ✓`
				: `MISSING 'budget_model' in implied_capital_allocation_v1 body`,
		});
	}

	// --- StackFactor-specific: must have budget model derivation ---

	if (dealName === "StackFactor") {
		// Must have the implied_capital_allocation_v1 section
		a.push({
			name:   "stackfactor_has_implied_capital_section",
			passed:  proof.has_implied_capital_allocation_v1_section,
			detail:  proof.has_implied_capital_allocation_v1_section
				? `implied_capital_allocation_v1 section found in StackFactor report ✓`
				: `MISSING implied_capital_allocation_v1 section! (expected — StackFactor has Budget + Employee Costs XLSX)`,
		});

		// slot reason must be DERIVED_FROM_BUDGET_MODEL
		const isBudgetModel = outcome === "OK_BUDGET_MODEL";
		a.push({
			name:   "stackfactor_slot_reason_is_derived_from_budget_model",
			passed:  isBudgetModel,
			detail:  isBudgetModel
				? `use_of_funds slot promoted with DERIVED_FROM_BUDGET_MODEL reason ✓`
				: `use_of_funds slot reason is '${proof.use_of_funds_slot_reason ?? "null"}', expected DERIVED_FROM_BUDGET_MODEL (outcome=${outcome})`,
		});

		// slot value must contain [IMPLIED]
		const slotValue = proof.use_of_funds_slot_value_preview ?? "";
		const hasImpliedInValue = /IMPLIED/i.test(slotValue) || /implied/i.test(proof.use_of_funds_slot_line ?? "");
		a.push({
			name:   "stackfactor_slot_value_contains_implied",
			passed:  hasImpliedInValue,
			detail:  hasImpliedInValue
				? `slot value contains 'IMPLIED' language ✓`
				: `slot value does not contain 'IMPLIED' — value: ${slotValue.slice(0, 150)}`,
		});

		// evidence must point to dpu:doc:... (from an excel_sheet DPU page)
		const evidence       = proof.use_of_funds_slot_evidence ?? "";
		const hasValidEvRef  = /^dpu:doc:[a-f0-9]+:page:\d+$/.test(evidence);
		a.push({
			name:   "stackfactor_slot_evidence_is_dpu_ref",
			passed:  hasValidEvRef,
			detail:  hasValidEvRef
				? `evidence ref is valid DPU ref: ${evidence} ✓`
				: `evidence ref is invalid or missing: '${evidence}'`,
		});

		// governed summary must mention "implied" or "budget model" / "budget allocation"
		a.push({
			name:   "stackfactor_governed_summary_mentions_implied",
			passed:  proof.governed_summary_mentions_implied,
			detail:  proof.governed_summary_mentions_implied
				? `governed_summary_v1 body mentions implied/budget-model language ✓`
				: `governed_summary_v1 does NOT mention 'implied' or 'budget model' — LLM corpus may need review — body preview: ${(proof.governed_summary_body_preview ?? "").slice(0, 300)}`,
		});
	}

	// --- DealDecision / WebMax — must NOT show budget model derivation ---

	if (dealName === "DealDecision" || dealName === "WebMax") {
		const shouldNotHaveBudgetModel = outcome !== "OK_BUDGET_MODEL";
		a.push({
			name:   `${dealName.toLowerCase()}_not_budget_model_derived`,
			passed:  shouldNotHaveBudgetModel,
			detail:  shouldNotHaveBudgetModel
				? `use_of_funds slot is NOT DERIVED_FROM_BUDGET_MODEL (outcome=${outcome}) ✓`
				: `UNEXPECTED: use_of_funds slot is DERIVED_FROM_BUDGET_MODEL for ${dealName} — this deal should not have Budget Model XLSX`,
		});

		// implied_capital section must NOT be present for these deals
		// (if it somehow appears, it means a false positive parse triggered)
		const noImpliedSection = !proof.has_implied_capital_allocation_v1_section;
		a.push({
			name:   `${dealName.toLowerCase()}_no_implied_capital_section`,
			passed:  noImpliedSection,
			detail:  noImpliedSection
				? `implied_capital_allocation_v1 section is absent (correct) ✓`
				: `UNEXPECTED: implied_capital_allocation_v1 section is present for ${dealName} — check for false-positive parse of non-StackFactor XLSX`,
		});
	}

	return a;
}

// ─── Per-deal runner ──────────────────────────────────────────────────────────

async function runDeal(deal: (typeof DEALS)[number]): Promise<DealResult> {
	const start = Date.now();

	// Phase 1: Discovery
	console.log(`  [1/4] Discovery (DB)...`);
	const discovery = await runDiscovery(deal.deal_id, deal.name);
	if (discovery.error) {
		console.log(`       ⚠ Discovery error: ${discovery.error}`);
	} else {
		const docCount = discovery.docs.length;
		const totalDpu = discovery.docs.reduce((s, d) => s + d.dpu_page_count, 0);
		const xlsxDocs = discovery.docs.filter((d) =>
			(d.mime_type ?? "").includes("spreadsheet") ||
			(d.mime_type ?? "").includes("excel") ||
			(d.filename ?? "").toLowerCase().endsWith(".xlsx"),
		);
		console.log(`       docs=${docCount}, total_dpu_pages=${totalDpu}, xlsx_docs=${xlsxDocs.length}`);
		for (const doc of discovery.docs) {
			const typeSummary = doc.page_type_summary
				.map((p) => `${p.page_type}×${p.count}`)
				.join(", ");
			console.log(`       • ${doc.doc_id.slice(0, 8)}  ${(doc.filename ?? "(unknown)").slice(0, 50).padEnd(52)}  ${typeSummary}`);
			for (const sheet of doc.excel_sheets) {
				console.log(`         └─ page=${sheet.page_index}  len=${sheet.text_len}  "${(sheet.sheet_title ?? "(no title)").slice(0, 60)}"`);
			}
		}
	}

	const base = {
		deal_id:         deal.deal_id,
		deal_name:       deal.name,
		discovery,
		outcome:         null as ImpliedCapitalOutcome | null,
		pre_updated_at:  null as string | null,
		post_updated_at: null as string | null,
		proof:           null as InsightsProof | null,
		assertions:      [] as AssertionResult[],
	};

	try {
		// Phase 2: Capture pre-regen snapshot
		console.log(`  [2/4] Capturing pre-regen snapshot...`);
		const preProof = await getInsightsSnapshot(deal.deal_id);
		base.pre_updated_at = preProof?.updated_at ?? null;
		console.log(`       pre_updated_at=${base.pre_updated_at ?? "(none)"}`);

		// Phase 3: Trigger fresh regeneration (bypasses dedup)
		console.log(`  [3/4] Triggering regenerate...`);
		await triggerRegenerate(deal.deal_id);
		console.log(`       ✓ Regenerate enqueued — polling up to ${TIMEOUT_SECONDS}s...`);

		const result = await pollUntilFresh(deal.deal_id, base.pre_updated_at);
		if (result === "timeout") {
			return {
				...base,
				status:     "timeout",
				elapsed_ms: Date.now() - start,
				error:      `Timed out after ${TIMEOUT_SECONDS}s waiting for updated_at to change from '${base.pre_updated_at}'`,
			};
		}

		base.post_updated_at = result.updated_at;
		base.proof = result;
		console.log(`       ✓ Report refreshed at ${result.updated_at}`);

		// Phase 4: Classify + Assert
		console.log(`  [4/4] Classifying and asserting...`);
		const outcome    = classifyOutcome(result);
		const assertions = runAssertions(deal.name, result, outcome);
		base.outcome     = outcome;
		base.assertions  = assertions;

		const allPassed = assertions.every((a) => a.passed);
		return {
			...base,
			status:     allPassed ? "ok" : "fail",
			elapsed_ms: Date.now() - start,
		};
	} catch (err) {
		return {
			...base,
			status:     "error",
			elapsed_ms: Date.now() - start,
			error:      err instanceof Error ? err.message : String(err),
		};
	}
}

// ─── Diagnostic dump (on failure) ────────────────────────────────────────────

function printDiagnostics(result: DealResult): void {
	console.log(`\n  ─── DIAGNOSTICS for ${result.deal_name} (${result.deal_id}) ───`);

	if (result.error) {
		console.log(`  ERROR: ${result.error}`);
	}

	const proof = result.proof;
	if (!proof) {
		console.log(`  No proof snapshot available.`);
		return;
	}

	console.log(`\n  sections_present: [${proof.sections_present.join(", ")}]`);
	console.log(`  has_implied_capital_allocation_v1_section: ${proof.has_implied_capital_allocation_v1_section}`);
	console.log(`  use_of_funds_slot_line: ${proof.use_of_funds_slot_line ?? "(none)"}`);
	console.log(`  use_of_funds_slot_reason: ${proof.use_of_funds_slot_reason ?? "(none)"}`);
	console.log(`  use_of_funds_slot_value_preview: ${(proof.use_of_funds_slot_value_preview ?? "(none)").slice(0, 200)}`);
	console.log(`  use_of_funds_slot_evidence: ${proof.use_of_funds_slot_evidence ?? "(none)"}`);
	console.log(`  governed_summary_v1_present: ${proof.governed_summary_v1_present}`);
	console.log(`  governed_summary_mentions_implied: ${proof.governed_summary_mentions_implied}`);

	if (proof.implied_capital_allocation_v1_body_preview) {
		console.log(`\n  implied_capital_allocation_v1 body (preview):`);
		console.log(`  ┌─────────────────────────────────────────────────────`);
		for (const line of proof.implied_capital_allocation_v1_body_preview.split("\n").slice(0, 20)) {
			console.log(`  │ ${line}`);
		}
		console.log(`  └─────────────────────────────────────────────────────`);
	}

	if (proof.governed_summary_body_preview) {
		console.log(`\n  governed_summary_v1 body (preview):`);
		console.log(`  ┌─────────────────────────────────────────────────────`);
		for (const line of proof.governed_summary_body_preview.split("\n").slice(0, 10)) {
			console.log(`  │ ${line}`);
		}
		console.log(`  └─────────────────────────────────────────────────────`);
	}

	// Discovery: show excel sheet DPU details for debugging
	const disc = result.discovery;
	if (disc && disc.docs.length > 0) {
		console.log(`\n  Discovery — excel_sheet DPU pages:`);
		for (const doc of disc.docs) {
			if (doc.excel_sheets.length === 0) continue;
			console.log(`    Doc ${doc.doc_id.slice(0, 8)}  "${(doc.filename ?? "(unknown)").slice(0, 50)}":`);
			for (const sheet of doc.excel_sheets) {
				console.log(`      page=${sheet.page_index}  len=${sheet.text_len}`);
				if (sheet.text_preview) {
					const preview = sheet.text_preview.slice(0, 300).replace(/\n/g, "↵");
					console.log(`      text: ${preview}`);
				}
			}
		}
	}

	// Print failing assertion details
	const failing = result.assertions.filter((a) => !a.passed);
	if (failing.length > 0) {
		console.log(`\n  Failed assertions:`);
		for (const a of failing) {
			console.log(`    ✗ ${a.name}: ${a.detail}`);
		}
	}
}

// ─── Markdown report ─────────────────────────────────────────────────────────

function buildMarkdown(results: DealResult[]): string {
	const lines: string[] = [
		"# Implied Capital Allocation — 3-Deal E2E Proof",
		``,
		`**Run at:** ${new Date().toISOString()}  `,
		`**Base URL:** \`${BASE_URL}\`  `,
		`**Timeout:** ${TIMEOUT_SECONDS}s  `,
		``,
	];

	for (const r of results) {
		const statusIcon = r.status === "ok" ? "✅" : r.status === "fail" ? "❌" : "⚠️";
		lines.push(`---`);
		lines.push(``);
		lines.push(`## ${statusIcon} ${r.deal_name}`);
		lines.push(``);
		lines.push(`| Field | Value |`);
		lines.push(`|:------|:------|`);
		lines.push(`| deal_id | \`${r.deal_id}\` |`);
		lines.push(`| status | ${r.status} |`);
		lines.push(`| outcome | **${r.outcome ?? "n/a"}** |`);
		lines.push(`| elapsed | ${r.elapsed_ms}ms |`);
		lines.push(`| pre_updated_at | ${r.pre_updated_at ?? "(none)"} |`);
		lines.push(`| post_updated_at | ${r.post_updated_at ?? "(none)"} |`);
		if (r.error) lines.push(`| error | ${r.error} |`);

		const proof = r.proof;
		if (proof) {
			lines.push(`| sections_present | \`${proof.sections_present.join(", ")}\` |`);
			lines.push(`| has_implied_capital_allocation_v1 | **${proof.has_implied_capital_allocation_v1_section}** |`);
			lines.push(`| use_of_funds_slot_reason | \`${proof.use_of_funds_slot_reason ?? "null"}\` |`);
			lines.push(`| use_of_funds_slot_evidence | \`${proof.use_of_funds_slot_evidence ?? "null"}\` |`);
			lines.push(`| governed_summary_v1_present | ${proof.governed_summary_v1_present} |`);
			lines.push(`| governed_summary_mentions_implied | **${proof.governed_summary_mentions_implied}** |`);
		}
		lines.push(``);

		if (proof?.use_of_funds_slot_line) {
			lines.push(`**use_of_funds slot line:**`);
			lines.push(`\`\`\``);
			lines.push(proof.use_of_funds_slot_line.slice(0, 400));
			lines.push(`\`\`\``);
			lines.push(``);
		}

		if (proof?.implied_capital_allocation_v1_body_preview) {
			lines.push(`**implied_capital_allocation_v1 section (preview):**`);
			lines.push(`\`\`\``);
			lines.push(proof.implied_capital_allocation_v1_body_preview.slice(0, 500));
			lines.push(`\`\`\``);
			lines.push(``);
		}

		if (proof?.use_of_funds_slot_value_preview) {
			lines.push(`**use_of_funds slot value (preview):**`);
			lines.push(`> ${proof.use_of_funds_slot_value_preview.slice(0, 300)}`);
			lines.push(``);
		}

		// Discovery summary
		const disc = r.discovery;
		if (disc && disc.docs.length > 0) {
			lines.push(`### Discovery`);
			lines.push(``);
			lines.push(`| doc_id | filename | dpu_pages | page_types | excel_sheets |`);
			lines.push(`|:-------|:---------|:----------|:-----------|:-------------|`);
			for (const doc of disc.docs) {
				const typeSummary = doc.page_type_summary.map((p) => `${p.page_type}×${p.count}`).join(", ");
				lines.push(`| \`${doc.doc_id.slice(0, 8)}\` | ${(doc.filename ?? "(unknown)").slice(0, 40)} | ${doc.dpu_page_count} | ${typeSummary} | ${doc.excel_sheets.length} |`);
			}
			lines.push(``);

			const excelDocs = disc.docs.filter((d) => d.excel_sheets.length > 0);
			if (excelDocs.length > 0) {
				lines.push(`**Excel sheet DPU pages:**`);
				lines.push(``);
				for (const doc of excelDocs) {
					lines.push(`*${doc.filename ?? doc.doc_id.slice(0, 8)}:*`);
					lines.push(``);
					lines.push(`| page | sheet_title | text_len |`);
					lines.push(`|:-----|:------------|:---------|`);
					for (const sheet of doc.excel_sheets) {
						lines.push(`| ${sheet.page_index} | ${(sheet.sheet_title ?? "(none)").slice(0, 50)} | ${sheet.text_len} |`);
					}
					lines.push(``);
				}
			}
		}

		lines.push(`### Assertions`);
		lines.push(``);
		for (const assertion of r.assertions) {
			const icon = assertion.passed ? "✅" : "❌";
			lines.push(`- ${icon} **${assertion.name}**: ${assertion.detail}`);
		}
		lines.push(``);
	}

	const allOk = results.every((r) => r.status === "ok");
	const passCount = results.filter((r) => r.status === "ok").length;
	lines.push(`---`);
	lines.push(``);
	lines.push(`## Summary`);
	lines.push(``);
	lines.push(`**Overall: ${allOk ? "✅ PASS" : "❌ FAIL"}**  `);
	lines.push(`${passCount}/${results.length} deals passed all assertions.`);

	const outcomes = results.map((r) => `${r.deal_name}: \`${r.outcome ?? "n/a"}\``).join(" | ");
	lines.push(``);
	lines.push(`Outcomes: ${outcomes}`);

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("╔══════════════════════════════════════════════════════════════╗");
	console.log("║  Implied Capital Allocation — 3-Deal E2E Proof               ║");
	console.log("╚══════════════════════════════════════════════════════════════╝");
	console.log(`  Base URL: ${BASE_URL}`);
	console.log(`  Timeout:  ${TIMEOUT_SECONDS}s per deal`);
	console.log(`  DB:       ${pool ? "connected" : "no DATABASE_URL — discovery will be skipped"}`);
	console.log("");

	const results: DealResult[] = [];

	for (const deal of DEALS) {
		console.log(`\n▶ ${deal.name} (${deal.deal_id})`);
		const result = await runDeal(deal);
		results.push(result);

		const statusIcon = result.status === "ok" ? "✅" : result.status === "fail" ? "❌" : "⚠️";
		console.log(`\n  ${statusIcon} status=${result.status}  outcome=${result.outcome ?? "n/a"}  elapsed=${result.elapsed_ms}ms`);

		// Print assertion summary
		for (const a of result.assertions) {
			const icon = a.passed ? "  ✓" : "  ✗";
			console.log(`${icon} ${a.name}: ${a.detail}`);
		}

		// Print diagnostics for any non-ok deal
		if (result.status !== "ok") {
			printDiagnostics(result);
		}
	}

	// ── Write artifacts ────────────────────────────────────────────────────────

	const outDir = OUT_DIR_ARG
		? path.resolve(OUT_DIR_ARG)
		: path.join(process.cwd(), "tmp");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

	const jsonPath = path.join(outDir, "implied-capital-verify-3deals.json");
	const mdPath   = path.join(outDir, "implied-capital-verify-3deals.md");
	fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
	fs.writeFileSync(mdPath, buildMarkdown(results));

	console.log(`\n─ Artifacts ─────────────────────────────────────────────────────`);
	console.log(`  ${jsonPath}`);
	console.log(`  ${mdPath}`);

	// ── Final summary ──────────────────────────────────────────────────────────

	const passCount = results.filter((r) => r.status === "ok").length;
	const failCount = results.length - passCount;

	console.log(`\n─ Summary ───────────────────────────────────────────────────────`);
	for (const r of results) {
		const icon = r.status === "ok" ? "✅" : r.status === "fail" ? "❌" : "⚠️";
		console.log(`  ${icon} ${r.deal_name.padEnd(14)} outcome=${String(r.outcome ?? "n/a").padEnd(22)} sections=[${(r.proof?.sections_present ?? []).join(", ")}]`);
	}
	console.log(``);
	console.log(`  ${passCount}/${results.length} passed${failCount > 0 ? `, ${failCount} failed` : ""}`);

	const hasWiringBug = results.some((r) => r.outcome === "WIRING_BUG");
	if (hasWiringBug) {
		console.error("\n❌ WIRING BUG detected — implied_capital section present but slot not promoted.");
		if (pool) await pool.end();
		process.exit(1);
	}
	if (failCount > 0) {
		console.error(`\n❌ ${failCount} deal(s) failed assertions or errored — check diagnostics above.`);
		if (pool) await pool.end();
		process.exit(1);
	}

	console.log("\n✅ All 3-deal assertions passed — Implied Capital Allocation pipeline is working correctly.");
	if (pool) await pool.end();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	if (pool) pool.end().catch(() => undefined);
	process.exit(1);
});
