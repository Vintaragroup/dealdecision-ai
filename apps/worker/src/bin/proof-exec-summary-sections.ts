#!/usr/bin/env node
/**
 * bin/proof-exec-summary-sections.ts
 *
 * Proof runner: validates that the governed_executive_summary_v1 section is
 * present in render_package.sections and passes content quality assertions.
 *
 * Phase 1  Fetch current report snapshot
 * Phase 2  Assert section keys and governed exec summary body
 * Phase 3  Assert output quality via validateOutputQuality
 * Phase 4  Print section key list + proof snippet
 *
 * Usage
 * ─────
 *   pnpm --filter worker proof:exec-summary-sections
 *   pnpm --filter worker proof:exec-summary-sections -- --deal-id <uuid>
 *   pnpm --filter worker proof:exec-summary-sections -- --base-url http://...
 *
 * Exit codes:  0 = all passed  |  1 = any failure
 */

import {
	parseGovernedExecSummaryBody,
	validateOutputQuality,
} from "../jobs/investor-insights/governed-executive-summary-v1";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE_URL = argValue("--base-url") ?? "http://localhost:9001";
const DEAL_ID  = argValue("--deal-id")  ?? "adb2a1cf-bbb1-4f3b-8735-e2249415124f"; // StackFactor
const DEAL_NAME = argValue("--deal-name") ?? "StackFactor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path: string): Promise<unknown> {
	const url = `${BASE_URL}${path}`;
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
	return resp.json();
}

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

function assert(name: string, condition: boolean, failDetail: string, passDetail?: string): AssertionResult {
	return {
		name,
		passed: condition,
		detail: condition ? (passDetail ?? "ok") : `FAIL — ${failDetail}`,
	};
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
	console.log(`\nProof: governed_executive_summary_v1 sections\n${"─".repeat(60)}`);
	console.log(`Deal:     ${DEAL_NAME} (${DEAL_ID})`);
	console.log(`Base URL: ${BASE_URL}`);
	console.log();

	// Phase 1 — Fetch
	console.log("Phase 1: Fetching investor-insights payload…");
	let raw: unknown;
	try {
		raw = await apiFetch(`/api/v1/deals/${DEAL_ID}/investor-insights`);
	} catch (e) {
		console.error(`ERROR: API fetch failed — ${String(e)}`);
		process.exit(1);
	}

	const d = raw as Record<string, unknown>;
	const rp = (d["render_package"] ?? {}) as Record<string, unknown>;
	const sections = (rp["sections"] ?? []) as Array<Record<string, unknown>>;
	const sectionKeys = sections.map((s) => String(s["key"] ?? "?"));

	console.log(`Status:       ${rp["status"] ?? "unknown"}`);
	console.log(`Section keys: ${sectionKeys.join(", ")}`);
	console.log();

	// Phase 2 — Section assertion
	console.log("Phase 2: Asserting governed_executive_summary_v1 presence…");
	const results: AssertionResult[] = [];

	const execSec = sections.find((s) => s["key"] === "governed_executive_summary_v1");
	results.push(assert(
		"section_present",
		!!execSec,
		"governed_executive_summary_v1 not found in render_package.sections",
		`governed_executive_summary_v1 found (body_len=${String(execSec?.["body"] ?? "").length})`,
	));

	if (!execSec) {
		printResults(results);
		process.exit(1);
	}

	const body = String(execSec["body"] ?? "");
	const parsed = parseGovernedExecSummaryBody(body);

	results.push(assert(
		"json_parseable",
		parsed !== null,
		"parseGovernedExecSummaryBody returned null — marker missing or JSON invalid",
		"JSON marker present and parseable",
	));

	if (!parsed) {
		printResults(results);
		process.exit(1);
	}

	results.push(assert(
		"schema_version",
		parsed.schema_version === "governed_executive_summary_v1",
		`schema_version mismatch: got ${parsed.schema_version}`,
		`schema_version = ${parsed.schema_version}`,
	));

	results.push(assert(
		"headline_contains_deal_name",
		parsed.headline.toLowerCase().includes(DEAL_NAME.toLowerCase()),
		`headline "${parsed.headline}" does not contain "${DEAL_NAME}"`,
		`headline = "${parsed.headline}"`,
	));

	const paragraphs = parsed.summary_paragraphs ?? [];
	results.push(assert(
		"summary_paragraphs_min_3",
		paragraphs.length >= 3,
		`summary_paragraphs.length = ${paragraphs.length} (want >= 3)`,
		`summary_paragraphs.length = ${paragraphs.length}`,
	));

	results.push(assert(
		"strengths_present",
		parsed.strengths.length >= 1,
		`strengths is empty`,
		`strengths.length = ${parsed.strengths.length}`,
	));

	results.push(assert(
		"risks_present",
		parsed.risks.length >= 1,
		`risks is empty`,
		`risks.length = ${parsed.risks.length}`,
	));

	// Phase 3 — Output quality
	console.log("Phase 3: Running validateOutputQuality…");
	const allText = [parsed.headline, ...paragraphs].join(" ");
	const quality = validateOutputQuality(allText);

	results.push(assert(
		"output_quality_ok",
		quality.ok,
		`validateOutputQuality issues: ${quality.issues.join("; ")}`,
		"No marketing filler or TAM overuse detected",
	));

	// Phase 4 — Print
	console.log();
	printResults(results);

	const passed = results.filter((r) => r.passed).length;
	const total  = results.length;
	const allPassed = results.every((r) => r.passed);

	console.log(`\n${"─".repeat(60)}`);
	console.log(`Result: ${passed}/${total} assertions passed`);

	if (allPassed) {
		console.log("\n✅ PROOF PASSED\n");
		console.log("--- Paragraph snippet ---");
		paragraphs.slice(0, 2).forEach((p, i) => console.log(`  P${i + 1}: ${p.slice(0, 120)}…`));
	} else {
		console.log("\n❌ PROOF FAILED\n");
	}

	process.exit(allPassed ? 0 : 1);
}

function printResults(results: AssertionResult[]): void {
	for (const r of results) {
		const icon = r.passed ? "✅" : "❌";
		console.log(`  ${icon} ${r.name.padEnd(35)} ${r.detail}`);
	}
}

run().catch((e) => {
	console.error("Unhandled error:", e);
	process.exit(1);
});
