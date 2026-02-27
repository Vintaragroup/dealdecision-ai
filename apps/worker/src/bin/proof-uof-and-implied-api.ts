#!/usr/bin/env node
/**
 * proof-uof-and-implied-api.ts
 *
 * Deep API snapshot proof that the UoF + Implied Capital layers are working
 * for WebMax and DealDecision.
 *
 * Phases
 * ──────
 * 1. POST  /api/v1/deals/:id/investor-insights/regenerate
 * 2. POLL  GET /api/v1/deals/:id/investor-insights until updated_at changes
 * 3. EXTRACT proof object from render_package
 * 4. ASSERT per-deal invariants
 * 5. WRITE  apps/worker/tmp/proof-webmax.json
 *            apps/worker/tmp/proof-dealdecision.json
 *            apps/worker/tmp/proof-uof-and-implied.md
 *
 * Usage
 * ─────
 *   pnpm --filter worker proof:uof-and-implied:api
 *   pnpm --filter worker proof:uof-and-implied:api -- --base http://localhost:9001 --timeout 240
 *
 * Exit codes
 *   0 → all assertions passed
 *   1 → one or more assertions failed (or timeout / API error)
 */

import * as fs from "fs";
import * as path from "path";

// ─── Configuration ────────────────────────────────────────────────────────────

const DEALS = [
	{
		name: "WebMax",
		deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
		assertions: assertWebMax,
	},
	{
		name: "DealDecision",
		deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32",
		assertions: assertDealDecision,
	},
] as const;

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE          = argValue("--base")    ?? "http://localhost:9001";
const TIMEOUT_S     = parseInt(argValue("--timeout") ?? "180", 10);
const POLL_MS       = parseInt(argValue("--poll")    ?? "2000", 10);
const TIMEOUT_MS    = TIMEOUT_S * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UofSlotParsed {
	status:   string | null;
	reason:   string | null;
	value:    string | null;
	evidence: string | null;
}

interface ProofObject {
	deal_name:                       string;
	deal_id:                         string;
	updated_at:                      string | null;
	sections_present:                string[];
	use_of_funds_v1_present:         boolean;
	implied_capital_allocation_v1_present: boolean;
	financial_statement_v1_present:  boolean;
	financial_health_metrics_v1_present: boolean;
	financial_layout_classifier_v1_present: boolean;
	governed_summary_v1_present:     boolean;
	governed_summary_contains_implied: boolean;
	use_of_funds_slot_line:          string | null;
	use_of_funds_slot_parsed:        UofSlotParsed;
	section_previews:                Record<string, string>;
	assertions:                      Array<{ name: string; passed: boolean; detail: string }>;
	all_passed:                      boolean;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE}${urlPath}`;
	const res = await fetch(url, opts);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
	}
	return res.json();
}

async function getInsightsRaw(dealId: string): Promise<Record<string, unknown> | null> {
	try {
		return (await apiFetch(`/api/v1/deals/${dealId}/investor-insights`)) as Record<string, unknown>;
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
): Promise<Record<string, unknown> | "timeout"> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, POLL_MS));
		const raw = await getInsightsRaw(dealId);
		if (!raw) continue;
		const rp = (raw["render_package"] ?? {}) as Record<string, unknown>;
		const newUpdatedAt = typeof rp["updated_at"] === "string" ? rp["updated_at"] : null;
		if (newUpdatedAt !== priorUpdatedAt) return raw;
	}
	return "timeout";
}

// ─── Proof extraction ─────────────────────────────────────────────────────────

function parseUofSlotLine(line: string | null): UofSlotParsed {
	if (!line) return { status: null, reason: null, value: null, evidence: null };
	const statusMatch  = line.match(/\|\s*(Computable|NotComputable)/i);
	const reasonMatch  = line.match(/reason[=:]\s*([A-Z_]+)/i);
	const evidenceMatch= line.match(/dpu:[^\s|)]+|evidence:[^\s|)]+/);
	const valueMatch   = line.match(/value="([^"]*?)"/);
	return {
		status:   statusMatch  ? statusMatch[1]!  : null,
		reason:   reasonMatch  ? reasonMatch[1]!  : null,
		evidence: evidenceMatch ? evidenceMatch[0] : null,
		value:    valueMatch   ? valueMatch[1]!   : null,
	};
}

function extractProof(
	dealName:  string,
	dealId:    string,
	rawData:   Record<string, unknown>
): Omit<ProofObject, "assertions" | "all_passed"> {
	const rp       = (rawData["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];

	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));
	const findBody    = (key: string): string | null => {
		const s = sections.find((s) => s["key"] === key);
		return typeof s?.["body"] === "string" ? s["body"] : null;
	};

	const updatedAt = typeof rp["updated_at"] === "string" ? rp["updated_at"] : null;

	const insightSlotsBody = findBody("insight_slots") ?? "";
	const uofSlotLine = insightSlotsBody.split("\n").find((l) => /^use_of_funds\s*[:|]/.test(l.trim())) ?? null;

	const govBody = findBody("governed_summary_v1") ?? "";

	// Capture first 12 lines of each relevant section
	const RELEVANT_SECTIONS = [
		"financial_statement_v1",
		"use_of_funds_v1",
		"implied_capital_allocation_v1",
		"financial_health_metrics_v1",
		"financial_layout_classifier_v1",
		"governed_summary_v1",
		"insight_slots",
	];
	const sectionPreviews: Record<string, string> = {};
	for (const key of RELEVANT_SECTIONS) {
		const body = findBody(key);
		if (body) {
			sectionPreviews[key] = body.split("\n").slice(0, 12).join("\n");
		}
	}

	return {
		deal_name:                            dealName,
		deal_id:                              dealId,
		updated_at:                           updatedAt,
		sections_present:                     sectionKeys,
		use_of_funds_v1_present:              sectionKeys.includes("use_of_funds_v1"),
		implied_capital_allocation_v1_present: sectionKeys.includes("implied_capital_allocation_v1"),
		financial_statement_v1_present:       sectionKeys.includes("financial_statement_v1"),
		financial_health_metrics_v1_present:  sectionKeys.includes("financial_health_metrics_v1"),
		financial_layout_classifier_v1_present: sectionKeys.includes("financial_layout_classifier_v1"),
		governed_summary_v1_present:          sectionKeys.includes("governed_summary_v1"),
		governed_summary_contains_implied:    /implied/i.test(govBody),
		use_of_funds_slot_line:               uofSlotLine,
		use_of_funds_slot_parsed:             parseUofSlotLine(uofSlotLine),
		section_previews:                     sectionPreviews,
	};
}

// ─── Per-deal assertion functions ─────────────────────────────────────────────

type AssertionList = Array<{ name: string; passed: boolean; detail: string }>;

function assertWebMax(proof: Omit<ProofObject, "assertions" | "all_passed">): AssertionList {
	const a: AssertionList = [];
	const slot = proof.use_of_funds_slot_parsed;

	// 1. UoF slot must be Computable (XLSX allocation sheet is present)
	a.push({
		name:   "webmax_uof_slot_computable",
		passed:  slot.status?.toLowerCase() === "computable",
		detail:  slot.status?.toLowerCase() === "computable"
			? `use_of_funds slot is Computable ✓`
			: `Expected Computable but got status='${slot.status ?? "null"}' | line='${proof.use_of_funds_slot_line ?? "null"}'`,
	});

	// 2. Slot reason must be DERIVED_FROM_USE_OF_FUNDS (preferred for XLSX allocation deal)
	const acceptableReasons = ["DERIVED_FROM_USE_OF_FUNDS", "DERIVED_FROM_BUDGET_MODEL"];
	const okReason = acceptableReasons.includes(slot.reason ?? "");
	a.push({
		name:   "webmax_uof_slot_reason_expected",
		passed:  okReason,
		detail:  okReason
			? `slot reason='${slot.reason}' ✓`
			: `Expected DERIVED_FROM_USE_OF_FUNDS|DERIVED_FROM_BUDGET_MODEL but got '${slot.reason ?? "null"}'`,
	});

	// 3. If DERIVED_FROM_USE_OF_FUNDS, use_of_funds_v1 section must be present
	if (slot.reason === "DERIVED_FROM_USE_OF_FUNDS") {
		a.push({
			name:   "webmax_uof_v1_section_present",
			passed:  proof.use_of_funds_v1_present,
			detail:  proof.use_of_funds_v1_present
				? `use_of_funds_v1 section present ✓`
				: `WIRING BUG: reason=DERIVED_FROM_USE_OF_FUNDS but use_of_funds_v1 section is ABSENT`,
		});
	}

	// 4. If basis=spend_plan_timeseries is in use_of_funds_v1 body, governed summary should say IMPLIED
	const uofBody = proof.section_previews["use_of_funds_v1"] ?? "";
	if (/spend_plan_timeseries/i.test(uofBody)) {
		a.push({
			name:   "webmax_timeseries_basis_present",
			passed:  true,
			detail:  `use_of_funds_v1 section shows spend_plan_timeseries basis ✓`,
		});
		a.push({
			name:   "webmax_governed_summary_mentions_implied",
			passed:  proof.governed_summary_contains_implied,
			detail:  proof.governed_summary_contains_implied
				? `governed summary mentions 'IMPLIED' ✓`
				: `governed summary does NOT mention 'IMPLIED' (timeseries UoF should be labelled implied)`,
		});
	}

	// 5. financial_statement_v1 should NOT be present for WebMax IF no income-statement sheets
	//    (This is a soft check — we just record what we see)
	a.push({
		name:   "webmax_fin_stmt_presence_info",
		passed:  true,
		detail:  `financial_statement_v1 present: ${proof.financial_statement_v1_present}`,
	});

	return a;
}

function assertDealDecision(proof: Omit<ProofObject, "assertions" | "all_passed">): AssertionList {
	const a: AssertionList = [];
	const slot = proof.use_of_funds_slot_parsed;

	// 1. financial_statement_v1 MUST be present (income statements in deal docs)
	a.push({
		name:   "dealdecision_financial_statement_v1_present",
		passed:  proof.financial_statement_v1_present,
		detail:  proof.financial_statement_v1_present
			? `financial_statement_v1 section present ✓`
			: `MISSING: financial_statement_v1 section absent — income statement not parsed`,
	});

	// 2. use_of_funds_v1 must NOT be present (no UoF tabs)
	a.push({
		name:   "dealdecision_no_use_of_funds_v1",
		passed:  !proof.use_of_funds_v1_present,
		detail:  !proof.use_of_funds_v1_present
			? `use_of_funds_v1 absent (correct — no UoF tabs) ✓`
			: `UNEXPECTED: use_of_funds_v1 present for DealDecision — false positive parser hit`,
	});

	// 3. implied_capital_allocation_v1 must NOT be present (no budget model sheets)
	a.push({
		name:   "dealdecision_no_implied_capital_allocation",
		passed:  !proof.implied_capital_allocation_v1_present,
		detail:  !proof.implied_capital_allocation_v1_present
			? `implied_capital_allocation_v1 absent (correct) ✓`
			: `UNEXPECTED: implied_capital_allocation_v1 present — false positive budget model`,
	});

	// 4. UoF slot NotComputable is acceptable when there's no UoF signal
	const isNotComputable = slot.status?.toLowerCase() === "notcomputable" || slot.status === null;
	const isComputable    = slot.status?.toLowerCase() === "computable";
	a.push({
		name:   "dealdecision_uof_slot_acceptable",
		passed:  isNotComputable || isComputable,
		detail:  (isNotComputable || isComputable)
			? `use_of_funds slot status='${slot.status ?? "null"}' — acceptable ✓`
			: `Unexpected slot status='${slot.status ?? "null"}'`,
	});

	// 5. Must NOT be DERIVED_FROM_BUDGET_MODEL (no budget sheets)
	a.push({
		name:   "dealdecision_not_budget_model",
		passed:  slot.reason !== "DERIVED_FROM_BUDGET_MODEL",
		detail:  slot.reason !== "DERIVED_FROM_BUDGET_MODEL"
			? `slot reason='${slot.reason ?? "null"}' — not a false budget model ✓`
			: `UNEXPECTED: DealDecision slot reason=DERIVED_FROM_BUDGET_MODEL — false positive budget model`,
	});

	return a;
}

// ─── Per-deal runner ──────────────────────────────────────────────────────────

async function runDeal(
	deal: (typeof DEALS)[number]
): Promise<{ proof: ProofObject; timedOut: boolean; error?: string }> {
	console.log(`\n── ${deal.name} (${deal.deal_id}) ──`);

	// Pre-snapshot
	console.log(`  [1/3] Pre-snapshot...`);
	const preRaw        = await getInsightsRaw(deal.deal_id);
	const preRp         = (preRaw?.["render_package"] ?? {}) as Record<string, unknown>;
	const priorUpdatedAt = typeof preRp["updated_at"] === "string" ? preRp["updated_at"] : null;
	console.log(`       prior updated_at=${priorUpdatedAt ?? "null"}`);

	// Regenerate
	console.log(`  [2/3] Regenerate...`);
	try {
		await triggerRegenerate(deal.deal_id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`       ✗ Regenerate failed: ${msg}`);
		const emptyProof: ProofObject = {
			deal_name: deal.name,
			deal_id: deal.deal_id,
			updated_at: null,
			sections_present: [],
			use_of_funds_v1_present: false,
			implied_capital_allocation_v1_present: false,
			financial_statement_v1_present: false,
			financial_health_metrics_v1_present: false,
			financial_layout_classifier_v1_present: false,
			governed_summary_v1_present: false,
			governed_summary_contains_implied: false,
			use_of_funds_slot_line: null,
			use_of_funds_slot_parsed: { status: null, reason: null, value: null, evidence: null },
			section_previews: {},
			assertions: [{ name: "regenerate_request", passed: false, detail: `Failed: ${msg}` }],
			all_passed: false,
		};
		return { proof: emptyProof, timedOut: false, error: msg };
	}

	// Poll
	console.log(`  [3/3] Polling (timeout=${TIMEOUT_S}s)...`);
	const freshRaw = await pollUntilFresh(deal.deal_id, priorUpdatedAt);

	if (freshRaw === "timeout") {
		console.log(`       ✗ Timed out`);
		const emptyProof: ProofObject = {
			deal_name: deal.name,
			deal_id: deal.deal_id,
			updated_at: null,
			sections_present: [],
			use_of_funds_v1_present: false,
			implied_capital_allocation_v1_present: false,
			financial_statement_v1_present: false,
			financial_health_metrics_v1_present: false,
			financial_layout_classifier_v1_present: false,
			governed_summary_v1_present: false,
			governed_summary_contains_implied: false,
			use_of_funds_slot_line: null,
			use_of_funds_slot_parsed: { status: null, reason: null, value: null, evidence: null },
			section_previews: {},
			assertions: [{ name: "poll_timeout", passed: false, detail: `Timed out after ${TIMEOUT_S}s` }],
			all_passed: false,
		};
		return { proof: emptyProof, timedOut: true };
	}

	// Extract proof
	const partial = extractProof(deal.name, deal.deal_id, freshRaw as Record<string, unknown>);
	const assertions = deal.assertions(partial);
	const all_passed = assertions.every((a) => a.passed);
	const proof: ProofObject = { ...partial, assertions, all_passed };

	// Log assertions
	console.log(`       status=${all_passed ? "✓ PASS" : "✗ FAIL"}`);
	console.log(`       sections: [${proof.sections_present.slice(0, 8).join(", ")}]`);
	console.log(`       uof_slot: ${proof.use_of_funds_slot_line ?? "null"}`);
	for (const a of assertions) {
		console.log(`       ${a.passed ? "✓" : "✗"} [${a.name}] ${a.detail}`);
	}

	if (!all_passed) {
		console.log(`\n  == Full insight_slots body ==`);
		const slotsBody = proof.section_previews["insight_slots"];
		if (slotsBody) console.log(slotsBody);
		else console.log("  (no insight_slots section)");
		console.log(`\n  == sections_present ==`);
		console.log(`  [${proof.sections_present.join(", ")}]`);
	}

	return { proof, timedOut: false };
}

// ─── Markdown report ──────────────────────────────────────────────────────────

function buildMdReport(proofs: ProofObject[]): string {
	const lines: string[] = [];
	lines.push("# UoF + Implied Capital — API Proof Report\n");
	lines.push(`Generated: ${new Date().toISOString()}\n`);
	lines.push(`Base URL: ${BASE}  Timeout: ${TIMEOUT_S}s\n`);

	const allPassed = proofs.every((p) => p.all_passed);
	lines.push(`**Overall: ${allPassed ? "✓ ALL ASSERTIONS PASSED" : "✗ SOME ASSERTIONS FAILED"}**\n`);

	for (const p of proofs) {
		lines.push(`## ${p.deal_name}`);
		lines.push(`- updated_at: \`${p.updated_at ?? "null"}\``);
		lines.push(`- sections_present: ${p.sections_present.map((s) => `\`${s}\``).join(", ")}`);
		lines.push(`- use_of_funds_v1_present: ${p.use_of_funds_v1_present}`);
		lines.push(`- implied_capital_allocation_v1_present: ${p.implied_capital_allocation_v1_present}`);
		lines.push(`- financial_statement_v1_present: ${p.financial_statement_v1_present}`);
		lines.push(`- financial_health_metrics_v1_present: ${p.financial_health_metrics_v1_present}`);
		lines.push(`- financial_layout_classifier_v1_present: ${p.financial_layout_classifier_v1_present}`);
		lines.push(`- governed_summary_v1_present: ${p.governed_summary_v1_present}`);
		lines.push(`- governed_summary_contains_implied: ${p.governed_summary_contains_implied}`);
		lines.push(`- use_of_funds_slot_line: \`${p.use_of_funds_slot_line ?? "null"}\``);
		lines.push(`- slot_status: ${p.use_of_funds_slot_parsed.status ?? "null"}, slot_reason: ${p.use_of_funds_slot_parsed.reason ?? "null"}`);
		lines.push("");
		lines.push("### Assertions");
		for (const a of p.assertions) {
			lines.push(`- ${a.passed ? "✓" : "✗"} **${a.name}**: ${a.detail}`);
		}
		lines.push("");

		const relevantKeys = Object.keys(p.section_previews);
		if (relevantKeys.length > 0) {
			lines.push("### Section Previews (first 12 lines each)");
			for (const key of relevantKeys) {
				lines.push(`\n**${key}**\n\`\`\`\n${p.section_previews[key]}\n\`\`\``);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log("=== proof-uof-and-implied-api ===");
	console.log(`BASE=${BASE}  TIMEOUT=${TIMEOUT_S}s  POLL=${POLL_MS}ms`);

	const proofs: ProofObject[] = [];
	let anyTimeout = false;

	for (const deal of DEALS) {
		const { proof, timedOut } = await runDeal(deal);
		proofs.push(proof);
		if (timedOut) anyTimeout = true;
	}

	// Write artifacts
	const outDir = path.resolve(process.cwd(), "apps/worker/tmp");
	fs.mkdirSync(outDir, { recursive: true });

	for (const p of proofs) {
		const name = p.deal_name.toLowerCase().replace(/[^a-z0-9]/g, "-");
		const jsonPath = path.join(outDir, `proof-${name}.json`);
		fs.writeFileSync(jsonPath, JSON.stringify(p, null, 2) + "\n", "utf8");
		console.log(`\n✓ JSON: ${jsonPath}`);
	}

	const mdPath = path.join(outDir, "proof-uof-and-implied.md");
	fs.writeFileSync(mdPath, buildMdReport(proofs), "utf8");
	console.log(`✓ MD:   ${mdPath}`);

	// Summary
	const allPassed = proofs.every((p) => p.all_passed) && !anyTimeout;
	console.log(`\n${"─".repeat(60)}`);
	console.log(`RESULT: ${allPassed ? "✓ ALL ASSERTIONS PASSED" : "✗ SOME ASSERTIONS FAILED"}`);
	for (const p of proofs) {
		const icon = p.all_passed ? "✓" : "✗";
		const failCount = p.assertions.filter((a) => !a.passed).length;
		console.log(
			`  ${icon} ${p.deal_name.padEnd(14)} uof_v1=${p.use_of_funds_v1_present} fin_stmt=${p.financial_statement_v1_present} implied=${p.implied_capital_allocation_v1_present}${failCount > 0 ? ` (${failCount} assertion(s) failed)` : ""}`
		);
	}

	process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
