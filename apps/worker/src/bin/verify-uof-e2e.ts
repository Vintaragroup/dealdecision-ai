#!/usr/bin/env node
/**
 * bin/verify-uof-e2e.ts
 *
 * Dev-only CLI: E2E verification that XLSX Use-of-Funds data flows through the
 * full investor-insights pipeline.
 *
 * Proves the chain:
 *   XLSX DPU excel_range page
 *     → parseUseOfFundsV1 → bestUseOfFundsStatement
 *     → use_of_funds_v1 render_package section
 *     → use_of_funds insight slot (reason=DERIVED_FROM_USE_OF_FUNDS)
 *     → governed_summary_v1 corpus receives UoF body
 *     → governed_summary_v1 section present in render_package
 *
 * Assertions run on the POST-regen render_package returned via:
 *   GET /api/v1/deals/:deal_id/investor-insights → render_package.sections
 *
 * When DEV_GOVERNED_MARKERS=1, the governed_summary_v1 body is expected to
 * contain "%%inputs_included:..." markers for deeper corpus verification.
 *
 * Usage:
 *   pnpm --filter worker verify:uof:e2e -- \
 *     --deal-id <uuid>
 *
 *   pnpm --filter worker verify:uof:e2e -- \
 *     --deal-list apps/worker/tmp/audit_3deals.json \
 *     [--base http://localhost:9001] \
 *     [--timeout-ms 120000] \
 *     [--poll-ms 1500] \
 *     [--no-expect-uof]     # skip UoF assertions for deals without XLSX UoF data
 *
 * Environment:
 *   DEV_GOVERNED_MARKERS=1  — also assert corpus inclusion markers in governed body
 *
 * Outputs:
 *   tmp/uof-e2e-verify.json  — machine-readable results per deal
 *   tmp/uof-e2e-verify.md    — human-readable markdown summary
 *
 * Exit code 0 = all assertions passed for all deals.
 * Exit code 1 = at least one deal failed or timed out.
 */

import * as fs from "fs";
import * as path from "path";

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}
function argValues(flag: string): string[] {
	const vals: string[] = [];
	for (let i = 0; i < cliArgs.length; i++) {
		if (cliArgs[i] === flag && i + 1 < cliArgs.length) vals.push(cliArgs[i + 1]!);
	}
	return vals;
}
function argFlag(flag: string): boolean {
	return cliArgs.includes(flag);
}

const BASE_URL     = argValue("--base")         ?? "http://localhost:9001";
const DEAL_LIST    = argValue("--deal-list");
const TIMEOUT_MS   = parseInt(argValue("--timeout-ms") ?? "120000", 10);
const POLL_MS      = parseInt(argValue("--poll-ms")    ?? "1500",   10);
// --no-expect-uof disables UoF-specific assertions (for deals without XLSX UoF data)
const EXPECT_UOF   = !argFlag("--no-expect-uof");
const DEV_MARKERS  = process.env["DEV_GOVERNED_MARKERS"] === "1";

interface DealEntry { name: string; deal_id: string }

let deals: DealEntry[];
if (DEAL_LIST) {
	const raw = JSON.parse(fs.readFileSync(DEAL_LIST, "utf-8")) as { deals: DealEntry[] };
	deals = raw.deals;
} else {
	const ids = argValues("--deal-id");
	if (ids.length === 0) {
		console.error("[uof-e2e] ERROR: provide --deal-list <file> or one or more --deal-id <uuid>");
		process.exit(1);
	}
	deals = ids.map((id) => ({ name: id.slice(0, 8), deal_id: id }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${urlPath}`;
	const res = await fetch(url, opts);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

interface InsightsSnapshot {
	updated_at:            string | null;
	upstream_fingerprint:  string | null;
	status:                string | null;
	gate_all_passed:       boolean | null;
	section_keys:          string[];
	insight_slots_body:    string | null;
	use_of_funds_v1_body:  string | null;
	governed_summary_body: string | null;
}

function extractSnapshot(d: unknown): InsightsSnapshot {
	const report   = d as Record<string, unknown>;
	const rp       = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];
	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));

	const gateState  = (rp["gate_state"] ?? {}) as Record<string, unknown>;
	const slotSec    = sections.find((s) => s["key"] === "insight_slots");
	const uofSec     = sections.find((s) => s["key"] === "use_of_funds_v1");
	const govSec     = sections.find((s) => s["key"] === "governed_summary_v1");

	return {
		updated_at:            typeof report["updated_at"] === "string" ? report["updated_at"] : null,
		upstream_fingerprint:  typeof report["upstream_fingerprint"] === "string" ? report["upstream_fingerprint"] : null,
		status:                typeof report["status"] === "string" ? report["status"] : null,
		gate_all_passed:       typeof gateState["all_passed"] === "boolean" ? gateState["all_passed"] : null,
		section_keys:          sectionKeys,
		insight_slots_body:    typeof slotSec?.["body"] === "string" ? slotSec["body"] as string : null,
		use_of_funds_v1_body:  typeof uofSec?.["body"]  === "string" ? uofSec["body"] as string  : null,
		governed_summary_body: typeof govSec?.["body"]  === "string" ? govSec["body"] as string  : null,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── UoF assertion checks ─────────────────────────────────────────────────────

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

function checkUofAssertions(snap: InsightsSnapshot, expectUof: boolean): AssertionResult[] {
	const results: AssertionResult[] = [];

	// A1: use_of_funds_v1 section present
	if (expectUof) {
		const hasUofSection = snap.section_keys.includes("use_of_funds_v1");
		results.push({
			name:   "use_of_funds_v1_section_present",
			passed: hasUofSection,
			detail: hasUofSection
				? `Section present (section_keys=[${snap.section_keys.join(", ")}])`
				: `MISSING — use_of_funds_v1 not in section_keys=[${snap.section_keys.join(", ")}]. ` +
				  "Ensure XLSX document has an excel_range DPU page with UoF headers.",
		});
	}

	// A2: use_of_funds slot is Computable with DERIVED_FROM_USE_OF_FUNDS
	if (expectUof) {
		const slotBody = snap.insight_slots_body ?? "";
		const slotMatch = /use_of_funds:\s*Computable/.test(slotBody);
		const reasonMatch = /DERIVED_FROM_USE_OF_FUNDS/.test(slotBody);

		if (!slotMatch) {
			results.push({
				name:   "use_of_funds_slot_computable",
				passed: false,
				detail: `FAIL — insight_slots body does not contain use_of_funds: Computable. ` +
					`Body excerpt: ${slotBody.slice(0, 200)}`,
			});
		} else {
			results.push({
				name:   "use_of_funds_slot_computable",
				passed: true,
				detail: "use_of_funds: Computable found in insight_slots body.",
			});
		}

		results.push({
			name:   "use_of_funds_slot_reason_derived_from_xlsx",
			passed: reasonMatch,
			detail: reasonMatch
				? "reason=DERIVED_FROM_USE_OF_FUNDS confirmed in insight_slots body."
				: `FAIL — DERIVED_FROM_USE_OF_FUNDS not found in insight_slots body. ` +
				  `The bridge in evalUseOfFundsSlot did not trigger. Body: ${slotBody.slice(0, 200)}`,
		});
	}

	// A3: governed_summary_v1 section present
	const hasGoverned = snap.section_keys.includes("governed_summary_v1");
	results.push({
		name:   "governed_summary_v1_section_present",
		passed: hasGoverned,
		detail: hasGoverned
			? "governed_summary_v1 section present."
			: "governed_summary_v1 section MISSING — LLM may have failed or gates did not pass.",
	});

	// A4 (optional): DEV_GOVERNED_MARKERS corpus inclusion markers
	if (DEV_MARKERS && hasGoverned) {
		const govBody = snap.governed_summary_body ?? "";
		const markerMatch = /%%inputs_included:.*use_of_funds_v1=true/.test(govBody);
		results.push({
			name:   "governed_corpus_includes_uof_v1_marker",
			passed: markerMatch,
			detail: markerMatch
				? "%%inputs_included: use_of_funds_v1=true marker confirmed in governed body."
				: `FAIL (DEV_GOVERNED_MARKERS=1) — corpus inclusion marker not found. ` +
				  `Ensure DEV_GOVERNED_MARKERS=1 is set in the worker's environment too. ` +
				  `Body tail: ${govBody.slice(-200)}`,
		});

		if (expectUof) {
			const slotMarker = /%%inputs_included:.*use_of_funds_slot=true/.test(govBody);
			results.push({
				name:   "governed_corpus_includes_uof_slot_marker",
				passed: slotMarker,
				detail: slotMarker
					? "%%inputs_included: use_of_funds_slot=true marker confirmed."
					: `FAIL — use_of_funds_slot=true marker not found. ` +
					  `Body tail: ${govBody.slice(-200)}`,
			});
		}
	}

	return results;
}

// ─── Per-deal verify ──────────────────────────────────────────────────────────

interface DealUofVerifyResult {
	deal_id:     string;
	deal_name:   string;
	status:      "ok" | "fail" | "timeout" | "error";
	error?:      string;
	elapsed_ms:  number;
	pre:         InsightsSnapshot | null;
	post:        InsightsSnapshot | null;
	assertions:  AssertionResult[];
}

async function verifyDeal(deal: DealEntry): Promise<DealUofVerifyResult> {
	const { deal_id, name: deal_name } = deal;
	const start = Date.now();
	let pre: InsightsSnapshot | null = null;

	try {
		// 1. Snapshot pre-regen state
		const preRaw = await apiFetch(`/api/v1/deals/${deal_id}/investor-insights`);
		pre = extractSnapshot(preRaw);
		console.log(`  [${deal_name}] Pre-state: status=${pre.status ?? "none"} updated_at=${pre.updated_at?.slice(0, 19) ?? "none"}`);

		// 2. Trigger regeneration
		await apiFetch(`/api/v1/deals/${deal_id}/investor-insights/regenerate`, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    "{}",
		});
		console.log(`  [${deal_name}] Regen enqueued.`);

		// 3. Poll until report timestamp changes
		const deadline = start + TIMEOUT_MS;
		let post: InsightsSnapshot | null = null;
		let changed = false;

		while (Date.now() < deadline) {
			await sleep(POLL_MS);
			const postRaw = await apiFetch(`/api/v1/deals/${deal_id}/investor-insights`);
			const snap    = extractSnapshot(postRaw);

			const tsChanged = snap.updated_at !== null && snap.updated_at !== pre.updated_at;
			const fpChanged = snap.upstream_fingerprint !== null &&
				snap.upstream_fingerprint !== pre.upstream_fingerprint;

			if (tsChanged || fpChanged) {
				post    = snap;
				changed = true;
				break;
			}
		}

		if (!changed || !post) {
			return {
				deal_id, deal_name,
				status:     "timeout",
				error:      `Timed out after ${TIMEOUT_MS}ms — updated_at did not change. Is the worker running?`,
				elapsed_ms: Date.now() - start,
				pre,
				post:       null,
				assertions: [],
			};
		}

		const elapsed = Date.now() - start;
		console.log(`  [${deal_name}] Report updated in ${elapsed}ms. Checking assertions…`);

		// 4. Run UoF assertions
		const assertions = checkUofAssertions(post, EXPECT_UOF);
		const allPassed   = assertions.every((a) => a.passed);

		for (const a of assertions) {
			const icon = a.passed ? "✓" : "✗";
			console.log(`    ${icon} ${a.name}: ${a.passed ? "PASS" : "FAIL"}`);
			if (!a.passed) console.log(`      ${a.detail}`);
		}

		return {
			deal_id, deal_name,
			status:     allPassed ? "ok" : "fail",
			elapsed_ms: elapsed,
			pre,
			post,
			assertions,
		};

	} catch (err) {
		return {
			deal_id, deal_name,
			status:     "error",
			error:      err instanceof Error ? err.message : String(err),
			elapsed_ms: Date.now() - start,
			pre,
			post:       null,
			assertions: [],
		};
	}
}

// ─── Markdown report builder ──────────────────────────────────────────────────

function buildMarkdown(results: DealUofVerifyResult[]): string {
	const passCount = results.filter((r) => r.status === "ok").length;
	const lines: string[] = [
		"# UoF E2E Verify Report",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Base URL: ${BASE_URL}`,
		`Expect UoF assertions: ${EXPECT_UOF}`,
		`DEV_GOVERNED_MARKERS: ${DEV_MARKERS}`,
		`Deals: ${results.length}  |  Passed: ${passCount}  |  Failed: ${results.length - passCount}`,
		"",
		"---",
		"",
	];

	for (const r of results) {
		const statusIcon = r.status === "ok" ? "✅" : "❌";
		lines.push(`## ${statusIcon} ${r.deal_name} (\`${r.deal_id}\`)`);
		lines.push("");
		lines.push(`**Status:** ${r.status} | **Elapsed:** ${r.elapsed_ms}ms`);
		lines.push("");

		if (r.status === "error" || r.status === "timeout") {
			lines.push(`> ⚠️ ${r.error}`);
			lines.push("");
			lines.push("---");
			lines.push("");
			continue;
		}

		const post = r.post!;
		lines.push(`**Report status:** ${post.status ?? "n/a"}`);
		lines.push(`**Gate all_passed:** ${post.gate_all_passed ?? "n/a"}`);
		lines.push(`**Section keys:** ${post.section_keys.join(", ")}`);
		lines.push(`**Updated at:** ${post.updated_at ?? "n/a"}`);
		lines.push("");

		// Assertions table
		lines.push("### Assertions");
		lines.push("");
		lines.push("| # | Assertion | Result | Detail |");
		lines.push("|---|-----------|--------|--------|");
		r.assertions.forEach((a, i) => {
			const icon   = a.passed ? "✅ PASS" : "❌ FAIL";
			const detail = a.detail.replace(/\|/g, "/").slice(0, 120);
			lines.push(`| ${i + 1} | \`${a.name}\` | ${icon} | ${detail} |`);
		});
		lines.push("");

		// use_of_funds_v1 section body
		if (post.use_of_funds_v1_body) {
			lines.push("### use_of_funds_v1 Section Body");
			lines.push("```");
			lines.push(post.use_of_funds_v1_body.slice(0, 800));
			lines.push("```");
			lines.push("");
		}

		// insight_slots excerpt
		if (post.insight_slots_body) {
			const uofLine = post.insight_slots_body
				.split("\n")
				.find((l) => l.startsWith("use_of_funds:"));
			if (uofLine) {
				lines.push("### use_of_funds Slot Line");
				lines.push("```");
				lines.push(uofLine);
				lines.push("```");
				lines.push("");
			}
		}

		// governed_summary_v1 tail (markers)
		if (post.governed_summary_body && DEV_MARKERS) {
			const tail = post.governed_summary_body.split("\n").slice(-4).join("\n");
			lines.push("### Governed Summary Body (tail — corpus markers)");
			lines.push("```");
			lines.push(tail);
			lines.push("```");
			lines.push("");
		}

		lines.push("---");
		lines.push("");
	}

	// Summary table
	lines.push("## Summary");
	lines.push("");
	lines.push("| Deal | Status | Elapsed | Assertions |");
	lines.push("|------|--------|---------|------------|");
	for (const r of results) {
		const passed = r.assertions.filter((a) => a.passed).length;
		const total  = r.assertions.length;
		lines.push(`| ${r.deal_name} | ${r.status} | ${r.elapsed_ms}ms | ${passed}/${total} |`);
	}
	lines.push("");

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log(
		`[uof-e2e] Starting UoF E2E verification for ${deals.length} deal(s)`,
		`base=${BASE_URL} timeout=${TIMEOUT_MS}ms poll=${POLL_MS}ms`,
		`expect_uof=${EXPECT_UOF} dev_markers=${DEV_MARKERS}`
	);
	console.log("");

	// Verify API is reachable
	try {
		await apiFetch(`/api/v1/deals/${deals[0]!.deal_id}/investor-insights`);
	} catch (err) {
		console.error(`[uof-e2e] FATAL: Cannot reach ${BASE_URL} — is the API running?`);
		console.error(`  ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	const results: DealUofVerifyResult[] = [];
	for (const deal of deals) {
		console.log(`[uof-e2e] Processing: ${deal.name} (${deal.deal_id})`);
		const result = await verifyDeal(deal);
		results.push(result);
		console.log(`  → ${result.status.toUpperCase()} in ${result.elapsed_ms}ms`);
		console.log("");
	}

	// Write artifacts
	const workerRoot = path.resolve(__dirname, "../../");
	const outDir     = path.join(workerRoot, "tmp");
	const jsonPath   = path.join(outDir, "uof-e2e-verify.json");
	const mdPath     = path.join(outDir, "uof-e2e-verify.md");

	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
	console.log(`[uof-e2e] Wrote: ${jsonPath}`);

	const md = buildMarkdown(results);
	fs.writeFileSync(mdPath, md);
	console.log(`[uof-e2e] Wrote: ${mdPath}`);

	// Print final summary
	const passCount = results.filter((r) => r.status === "ok").length;
	const failCount = results.length - passCount;
	console.log("");
	console.log(`=== UoF E2E Summary: ${passCount}/${results.length} passed ===`);
	for (const r of results) {
		const icon   = r.status === "ok" ? "✓" : "✗";
		const passed = r.assertions.filter((a) => a.passed).length;
		const total  = r.assertions.length;
		console.log(`  ${icon} ${r.deal_name.padEnd(20)} ${r.status.padEnd(7)} assertions=${passed}/${total} elapsed=${r.elapsed_ms}ms`);
		if (r.status !== "ok" && r.error) console.log(`    ${r.error}`);
	}
	console.log("");

	if (failCount > 0) {
		console.error(`[uof-e2e] ${failCount} deal(s) failed UoF E2E assertions — see ${mdPath}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("[uof-e2e] Unhandled error:", err);
	process.exit(1);
});
