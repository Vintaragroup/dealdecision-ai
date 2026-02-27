#!/usr/bin/env node
/**
 * bin/verify-uof-and-implied-3deals.ts
 *
 * E2E proof: Use-of-Funds coverage (timeseries XLSX + income-statement fallback)
 * works correctly across 3 deals.
 *
 * Phases
 * ──────
 * 1. DISCOVERY  — DB queries: document + DPU inventory per deal
 * 2. REGENERATE — POST /api/v1/deals/:id/investor-insights/regenerate
 * 3. POLL       — wait for updated_at to change, snapshot render_package
 * 4. PROVE      — per-deal assertions
 * 5. REPORT     — write artifacts, print summary, exit 0/1
 *
 * Expected outcomes
 * ─────────────────
 *   WebMax       → OK_TIMESERIES_UOF   (use_of_funds_v1 section from monthly spend plan;
 *                                        slot reason = DERIVED_FROM_USE_OF_FUNDS,
 *                                        basis = spend_plan_timeseries)
 *   DealDecision → OK_TEXT or NOT_PRESENT  (income stmt has no expense categories → stays text)
 *   StackFactor  → OK_BUDGET_MODEL     (regression: budget model must not break)
 *
 * Usage
 * ─────
 *   pnpm --filter worker verify:uof-and-implied:3deals
 *   pnpm --filter worker verify:uof-and-implied:3deals -- \
 *     --base-url http://localhost:9001 \
 *     --timeout-seconds 180 \
 *     --poll-interval-ms 2000 \
 *     --out apps/worker/tmp
 *
 * Artifacts
 * ─────────
 *   apps/worker/tmp/uof-and-implied-verify-3deals.json
 *   apps/worker/tmp/uof-and-implied-verify-3deals.md
 *
 * Exit codes
 *   0 → all assertions passed
 *   1 → at least one deal failed, timed out, errored, or has a wiring bug
 */

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

// ─── Configuration ────────────────────────────────────────────────────────────

const DEALS = [
	{ name: "WebMax",       deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4" },
	{ name: "DealDecision", deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "StackFactor",  deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
] as const;

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE_URL         = argValue("--base-url")         ?? "http://localhost:9001";
const TIMEOUT_SECONDS  = parseInt(argValue("--timeout-seconds")  ?? "180", 10);
const TIMEOUT_MS       = TIMEOUT_SECONDS * 1000;
const POLL_INTERVAL_MS = parseInt(argValue("--poll-interval-ms") ?? "2000", 10);
const OUT_DIR_ARG      = argValue("--out");

// ─── DB pool ─────────────────────────────────────────────────────────────────

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

type UofOutcome =
	| "OK_TIMESERIES_UOF"   // use_of_funds_v1 section present, DERIVED_FROM_USE_OF_FUNDS, basis=spend_plan_timeseries
	| "OK_EXPLICIT_UOF"     // explicit (non-timeseries) use_of_funds_v1
	| "OK_BUDGET_MODEL"     // StackFactor regression: DERIVED_FROM_BUDGET_MODEL
	| "OK_TEXT"             // text-pattern UoF slot
	| "NOT_PRESENT"         // no UoF signal
	| "WIRING_BUG";         // section present but slot NOT promoted

interface DpuPageTypeSummary { page_type: string; count: number; }

interface DocDiscovery {
	doc_id:          string;
	filename:        string | null;
	dpu_page_count:  number;
	page_type_summary: DpuPageTypeSummary[];
	allocation_sheets: string[];
}

interface DealDiscovery {
	deal_id:   string;
	deal_name: string;
	docs:      DocDiscovery[];
	error?:    string;
}

interface InsightsProof {
	updated_at:                   string | null;
	sections_present:             string[];
	has_uof_v1_section:           boolean;
	uof_v1_body_preview:          string | null;
	uof_v1_basis:                 string | null;
	uof_v1_basis_note:            string | null;
	has_implied_capital_section:  boolean;
	use_of_funds_slot_line:       string | null;
	use_of_funds_slot_reason:     string | null;
	use_of_funds_slot_value_preview: string | null;
	use_of_funds_slot_evidence:   string | null;
}

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

interface DealResult {
	deal_id:         string;
	deal_name:       string;
	discovery:       DealDiscovery | null;
	status:          "ok" | "fail" | "timeout" | "error";
	error?:          string;
	elapsed_ms:      number;
	outcome:         UofOutcome | null;
	pre_updated_at:  string | null;
	post_updated_at: string | null;
	proof:           InsightsProof | null;
	assertions:      AssertionResult[];
}

// ─── DB: Discovery ────────────────────────────────────────────────────────────

async function runDiscovery(dealId: string, dealName: string): Promise<DealDiscovery> {
	if (!pool) {
		return { deal_id: dealId, deal_name: dealName, docs: [], error: "DATABASE_URL not set" };
	}
	try {
		const docsRes = await pool.query<{ id: string; filename: string | null }>(
			`SELECT d.id::text, f.file_name AS filename
			   FROM documents d
			   LEFT JOIN document_files f ON f.document_id = d.id
			  WHERE d.deal_id = $1::uuid ORDER BY d.uploaded_at, d.id`,
			[dealId]
		);
		const dpuRes = await pool.query<{
			doc_id: string;
			page_type: string | null;
			page_text_hint: string | null;
		}>(
			`SELECT d.id::text AS doc_id,
			        dpu.payload->>'page_type' AS page_type,
			        left(dpu.payload->>'page_text', 120) AS page_text_hint
			   FROM document_page_understanding dpu
			   JOIN documents d ON d.id = dpu.document_id
			  WHERE d.deal_id = $1::uuid
			  ORDER BY d.uploaded_at, d.id, dpu.page_index`,
			[dealId]
		);

		const dpuByDoc = new Map<string, typeof dpuRes.rows>();
		for (const r of dpuRes.rows) {
			const rows = dpuByDoc.get(r.doc_id) ?? [];
			rows.push(r);
			dpuByDoc.set(r.doc_id, rows);
		}

		const docs: DocDiscovery[] = docsRes.rows.map((doc) => {
			const dpuRows = dpuByDoc.get(doc.id) ?? [];
			const typeCount = new Map<string, number>();
			for (const r of dpuRows) {
				const t = r.page_type ?? "unknown";
				typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
			}
			const page_type_summary = Array.from(typeCount.entries())
				.map(([page_type, count]) => ({ page_type, count }))
				.sort((a, b) => b.count - a.count);

			const allocationSheets = dpuRows
				.filter((r) => r.page_type === "excel_sheet" && /alloc|use.of.funds/i.test(r.page_text_hint ?? ""))
				.map((r) => (r.page_text_hint ?? "").split("\n")[0] ?? "");

			return {
				doc_id:          doc.id,
				filename:        doc.filename,
				dpu_page_count:  dpuRows.length,
				page_type_summary,
				allocation_sheets: allocationSheets,
			};
		});

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
		throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
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
	priorUpdatedAt: string | null
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

function extractProof(rawData: unknown): InsightsProof {
	const report   = rawData as Record<string, unknown>;
	const rp       = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];

	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));
	const findBody    = (key: string): string | null => {
		const s = sections.find((s) => s["key"] === key);
		return typeof s?.["body"] === "string" ? s["body"] : null;
	};

	const uofBody          = findBody("use_of_funds_v1");
	const insightSlotsBody = findBody("insight_slots") ?? "";

	// Extract basis from the use_of_funds_v1 section body
	const basisMatch     = uofBody?.match(/basis:\s*"?([a-z_]+)"?/i);
	const basisNoteMatch = uofBody?.match(/basis_note:\s*"?([^"\n]+)"?/i);

	// Find use_of_funds slot line
	const uofSlotLine = insightSlotsBody
		.split("\n")
		.find((l) => /^use_of_funds\s*[:|]/.test(l.trim())) ?? null;

	// Parse reason and value from slot line
	const reasonMatch    = uofSlotLine?.match(/reason[=:]\s*([A-Z_]+)/i);
	const evidenceMatch  = uofSlotLine?.match(/dpu:[^\s|)]+/);
	const valueMatch     = uofSlotLine?.match(/value="([^"]*?)"/);

	return {
		updated_at:                      typeof report["updated_at"] === "string" ? report["updated_at"] : null,
		sections_present:                sectionKeys,
		has_uof_v1_section:              sectionKeys.includes("use_of_funds_v1"),
		uof_v1_body_preview:             uofBody ? uofBody.slice(0, 600) : null,
		uof_v1_basis:                    basisMatch ? (basisMatch[1] ?? null) : null,
		uof_v1_basis_note:               basisNoteMatch ? (basisNoteMatch[1] ?? null) : null,
		has_implied_capital_section:     sectionKeys.includes("implied_capital_allocation_v1"),
		use_of_funds_slot_line:          uofSlotLine,
		use_of_funds_slot_reason:        reasonMatch ? (reasonMatch[1] ?? null) : null,
		use_of_funds_slot_value_preview: valueMatch ? (valueMatch[1] ?? "").slice(0, 400) : null,
		use_of_funds_slot_evidence:      evidenceMatch ? evidenceMatch[0] : null,
	};
}

// ─── Outcome classification ───────────────────────────────────────────────────

function classifyOutcome(proof: InsightsProof): UofOutcome {
	const hasUofSection     = proof.has_uof_v1_section;
	const isImpliedSection  = proof.has_implied_capital_section;
	const reason            = proof.use_of_funds_slot_reason ?? "";
	const isComputable      = !!proof.use_of_funds_slot_line?.includes("Computable");
	const basis             = proof.uof_v1_basis ?? "";

	// Timeseries UoF: use_of_funds_v1 section present with spend_plan_timeseries basis
	if (hasUofSection && reason === "DERIVED_FROM_USE_OF_FUNDS" && basis === "spend_plan_timeseries") {
		return "OK_TIMESERIES_UOF";
	}

	// Explicit UoF section present with DERIVED_FROM_USE_OF_FUNDS (explicit table)
	if (hasUofSection && reason === "DERIVED_FROM_USE_OF_FUNDS") {
		return "OK_EXPLICIT_UOF";
	}

	// Budget model derivation (StackFactor regression)
	if (reason === "DERIVED_FROM_BUDGET_MODEL") return "OK_BUDGET_MODEL";

	// Wiring bug: section present but slot not promoted
	if ((hasUofSection || isImpliedSection) && !isComputable) return "WIRING_BUG";

	// Text-based slot
	if (isComputable) return "OK_TEXT";

	return "NOT_PRESENT";
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function runAssertions(
	dealName: string,
	proof: InsightsProof,
	outcome: UofOutcome
): AssertionResult[] {
	const a: AssertionResult[] = [];

	// Universal: no wiring bugs
	a.push({
		name:   "no_wiring_bug",
		passed:  outcome !== "WIRING_BUG",
		detail:  outcome === "WIRING_BUG"
			? `UoF section is present but use_of_funds slot was NOT promoted (WIRING_BUG)`
			: `outcome=${outcome} — no wiring bug`,
	});

	// ─ WebMax ─ must have timeseries UoF
	if (dealName === "WebMax") {
		const isTimeseries = outcome === "OK_TIMESERIES_UOF";
		a.push({
			name:   "webmax_has_timeseries_uof",
			passed:  isTimeseries,
			detail:  isTimeseries
				? `use_of_funds_v1 section present with spend_plan_timeseries basis and DERIVED_FROM_USE_OF_FUNDS slot ✓`
				: `Expected OK_TIMESERIES_UOF for WebMax but got outcome=${outcome} (slot reason='${proof.use_of_funds_slot_reason ?? "null"}', basis='${proof.uof_v1_basis ?? "null"}')`,
		});

		// Slot value must contain [IMPLIED]
		const slotVal = proof.use_of_funds_slot_value_preview ?? proof.use_of_funds_slot_line ?? "";
		const hasImplied = /implied/i.test(slotVal);
		a.push({
			name:   "webmax_slot_value_contains_implied",
			passed:  hasImplied,
			detail:  hasImplied
				? `Slot value contains 'IMPLIED' language ✓`
				: `Slot value missing 'IMPLIED': ${slotVal.slice(0, 200)}`,
		});

		// Section body must contain 'spend_plan_timeseries'
		const uofBody = proof.uof_v1_body_preview ?? "";
		const hasTimeserisBasis = /spend_plan_timeseries/i.test(uofBody);
		a.push({
			name:   "webmax_uof_section_has_timeseries_basis",
			passed:  hasTimeserisBasis,
			detail:  hasTimeserisBasis
				? `use_of_funds_v1 section body contains 'spend_plan_timeseries' ✓`
				: `Section body missing 'spend_plan_timeseries': ${uofBody.slice(0, 200)}`,
		});

		// Must NOT be budget model (budget model should not fire for WebMax)
		a.push({
			name:   "webmax_not_budget_model",
			passed:  outcome !== "OK_BUDGET_MODEL",
			detail:  outcome !== "OK_BUDGET_MODEL"
				? `Correctly NOT derived from budget model ✓`
				: `UNEXPECTED: WebMax slot derived from budget model — falsely matched StackFactor budget sheet`,
		});
	}

	// ─ DealDecision ─ must NOT have timeseries or budget model derivation
	if (dealName === "DealDecision") {
		const acceptableOutcomes: UofOutcome[] = ["OK_TEXT", "NOT_PRESENT", "OK_EXPLICIT_UOF"];
		const isAcceptable = acceptableOutcomes.includes(outcome);
		a.push({
			name:   "dealdecision_not_timeseries_or_budget_model",
			passed:  isAcceptable,
			detail:  isAcceptable
				? `DealDecision outcome=${outcome} — income statement has no expense categories (correct) ✓`
				: `UNEXPECTED: DealDecision got outcome=${outcome}. Income statement should return null.`,
		});

		// Must NOT have the implied_capital_allocation_v1 section
		a.push({
			name:   "dealdecision_no_implied_capital_section",
			passed:  !proof.has_implied_capital_section,
			detail:  !proof.has_implied_capital_section
				? `implied_capital_allocation_v1 section absent (correct) ✓`
				: `UNEXPECTED: implied_capital_allocation_v1 section present for DealDecision`,
		});
	}

	// ─ StackFactor ─ regression: must still be OK_BUDGET_MODEL
	if (dealName === "StackFactor") {
		const isBudgetModel = outcome === "OK_BUDGET_MODEL";
		a.push({
			name:   "stackfactor_still_ok_budget_model",
			passed:  isBudgetModel,
			detail:  isBudgetModel
				? `StackFactor outcome=OK_BUDGET_MODEL (regression check passed) ✓`
				: `REGRESSION: StackFactor got outcome=${outcome} — expected OK_BUDGET_MODEL`,
		});

		// implied_capital section must still be present
		a.push({
			name:   "stackfactor_has_implied_capital_section",
			passed:  proof.has_implied_capital_section,
			detail:  proof.has_implied_capital_section
				? `implied_capital_allocation_v1 section present ✓`
				: `REGRESSION: implied_capital_allocation_v1 section MISSING for StackFactor`,
		});
	}

	return a;
}

// ─── Per-deal runner ──────────────────────────────────────────────────────────

async function runDeal(deal: (typeof DEALS)[number]): Promise<DealResult> {
	const start = Date.now();

	// 1. Discovery
	console.log(`  [1/4] Discovery...`);
	const discovery = await runDiscovery(deal.deal_id, deal.name);
	if (discovery.error) {
		console.log(`       ⚠ ${discovery.error}`);
	} else {
		const alloc = discovery.docs.flatMap((d) => d.allocation_sheets);
		console.log(`       docs=${discovery.docs.length}, allocation_sheets=[${alloc.slice(0, 3).join(", ")}]`);
	}

	// 2. Pre-snapshot
	console.log(`  [2/4] Pre-snapshot...`);
	const priorSnap = await getInsightsSnapshot(deal.deal_id);
	const priorUpdatedAt = priorSnap?.updated_at ?? null;
	console.log(`       pre_updated_at=${priorUpdatedAt ?? "null"}`);

	// 3. Regenerate
	console.log(`  [3/4] Regenerate...`);
	try {
		await triggerRegenerate(deal.deal_id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`       ✗ Regenerate failed: ${msg}`);
		return {
			deal_id:         deal.deal_id,
			deal_name:       deal.name,
			discovery:       discovery,
			status:          "error",
			error:           `Regenerate failed: ${msg}`,
			elapsed_ms:      Date.now() - start,
			outcome:         null,
			pre_updated_at:  priorUpdatedAt,
			post_updated_at: null,
			proof:           null,
			assertions:      [],
		};
	}

	// 4. Poll for fresh snapshot
	console.log(`  [4/4] Polling (timeout=${TIMEOUT_SECONDS}s)...`);
	const freshResult = await pollUntilFresh(deal.deal_id, priorUpdatedAt);

	if (freshResult === "timeout") {
		console.log(`       ✗ Timed out after ${TIMEOUT_SECONDS}s`);
		return {
			deal_id:         deal.deal_id,
			deal_name:       deal.name,
			discovery,
			status:          "timeout",
			elapsed_ms:      Date.now() - start,
			outcome:         null,
			pre_updated_at:  priorUpdatedAt,
			post_updated_at: null,
			proof:           null,
			assertions:      [],
		};
	}

	const proof   = freshResult;
	const outcome = classifyOutcome(proof);
	const assertions = runAssertions(deal.name, proof, outcome);
	const allPassed  = assertions.every((a) => a.passed);

	console.log(`       outcome=${outcome} | ${allPassed ? "✓ PASS" : "✗ FAIL"}`);
	for (const a of assertions) {
		console.log(`       ${a.passed ? "✓" : "✗"} [${a.name}] ${a.detail}`);
	}

	return {
		deal_id:         deal.deal_id,
		deal_name:       deal.name,
		discovery,
		status:          allPassed ? "ok" : "fail",
		elapsed_ms:      Date.now() - start,
		outcome,
		pre_updated_at:  priorUpdatedAt,
		post_updated_at: proof.updated_at,
		proof,
		assertions,
	};
}

// ─── Report writing ───────────────────────────────────────────────────────────

function buildMdReport(results: DealResult[]): string {
	const lines: string[] = [];
	lines.push("# UoF + Implied Capital Verification — 3 Deals\n");
	lines.push(`Generated: ${new Date().toISOString()}\n`);

	const allPassed = results.every((r) => r.status === "ok");
	lines.push(`**Overall: ${allPassed ? "✓ ALL PASSED" : "✗ SOME FAILED"}**\n`);

	for (const r of results) {
		lines.push(`## ${r.deal_name} — ${r.status.toUpperCase()}`);
		lines.push(`- outcome: \`${r.outcome ?? "null"}\``);
		lines.push(`- elapsed: ${r.elapsed_ms}ms`);
		lines.push(`- updated_at: ${r.post_updated_at ?? "null"}`);
		lines.push(`- slot_reason: \`${r.proof?.use_of_funds_slot_reason ?? "null"}\``);
		lines.push(`- uof_basis: \`${r.proof?.uof_v1_basis ?? "null"}\``);
		lines.push("");
		if (r.assertions.length > 0) {
			lines.push("### Assertions");
			for (const a of r.assertions) {
				lines.push(`- ${a.passed ? "✓" : "✗"} **${a.name}**: ${a.detail}`);
			}
			lines.push("");
		}
		if (r.error) {
			lines.push(`> Error: ${r.error}`);
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log("=== verify-uof-and-implied-3deals ===");
	console.log(`BASE_URL=${BASE_URL}  TIMEOUT=${TIMEOUT_SECONDS}s  POLL=${POLL_INTERVAL_MS}ms`);
	console.log("");

	const results: DealResult[] = [];

	for (const deal of DEALS) {
		console.log(`\n── ${deal.name} (${deal.deal_id}) ──`);
		const result = await runDeal(deal);
		results.push(result);
	}

	// Determine output directory
	const outDir = OUT_DIR_ARG
		? path.resolve(OUT_DIR_ARG)
		: path.resolve(process.cwd(), "apps/worker/tmp");
	fs.mkdirSync(outDir, { recursive: true });

	// Write JSON artifact
	const jsonPath = path.join(outDir, "uof-and-implied-verify-3deals.json");
	fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2) + "\n", "utf8");
	console.log(`\n✓ JSON artifact: ${jsonPath}`);

	// Write MD artifact
	const mdPath = path.join(outDir, "uof-and-implied-verify-3deals.md");
	fs.writeFileSync(mdPath, buildMdReport(results), "utf8");
	console.log(`✓ MD artifact:   ${mdPath}`);

	// Summary
	const allPassed = results.every((r) => r.status === "ok");
	console.log(`\n${"─".repeat(60)}`);
	console.log(`RESULT: ${allPassed ? "✓ ALL PASSED" : "✗ SOME FAILED"}`);
	for (const r of results) {
		const icon = r.status === "ok" ? "✓" : "✗";
		const failed = r.assertions.filter((a) => !a.passed);
		console.log(
			`  ${icon} ${r.deal_name.padEnd(14)} outcome=${String(r.outcome ?? "null").padEnd(22)} status=${r.status}${failed.length > 0 ? ` (${failed.length} assertion(s) failed)` : ""}`
		);
	}

	if (pool) await pool.end();

	process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
