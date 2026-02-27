#!/usr/bin/env node
/**
 * bin/verify-uof-3deals.ts
 *
 * Dev-only CLI: Verifies Use-of-Funds placement in Investor Insights for 3
 * hardcoded deals after forcing a fresh regeneration.
 *
 * Assertions are intentionally lenient:
 *   - NOT_PRESENT is a valid outcome (deal may lack UoF data) — no failure.
 *   - WIRING_BUG is a failure: `use_of_funds_v1` section is present but the
 *     insight slot was NOT promoted (Computable + DERIVED_FROM_USE_OF_FUNDS).
 *   - OK_DERIVED_FROM_USE_OF_FUNDS = PASS (XLSX-bridge worked)
 *   - OK_TEXT = PASS (text-pattern promotion)
 *
 * Usage:
 *   pnpm --filter worker verify:uof:3deals
 *   pnpm --filter worker verify:uof:3deals -- [--base-url <url>] [--timeout-seconds <n>] [--poll-interval-ms <n>] [--out <dir>]
 *
 * Outputs:
 *   apps/worker/tmp/uof-verify-3deals.json  — machine-readable per-deal results
 *   apps/worker/tmp/uof-verify-3deals.md    — human-readable markdown summary
 *
 * Exit code 0 = all deals passed (no wiring bugs).
 * Exit code 1 = at least one WIRING_BUG detected, or a hard error/timeout.
 */

import * as fs from "fs";
import * as path from "path";

// ─── Hardcoded deals ──────────────────────────────────────────────────────────

const DEALS = [
	{ name: "StackFactor",   deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
	{ name: "DealDecision",  deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "WebMax",        deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4" },
] as const;

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE_URL          = argValue("--base-url")          ?? "http://localhost:9001";
const TIMEOUT_SECONDS   = parseInt(argValue("--timeout-seconds")   ?? "120", 10);
const TIMEOUT_MS        = TIMEOUT_SECONDS * 1000;
const POLL_INTERVAL_MS  = parseInt(argValue("--poll-interval-ms")  ?? "1500", 10);
const OUT_DIR_ARG       = argValue("--out");

// ─── Evidence regex ───────────────────────────────────────────────────────────

const EVIDENCE_REF_RE = /dpu:doc:[0-9a-f]{8,}:page:\d+/;

// ─── UoF classification enum ──────────────────────────────────────────────────

export type UofOutcome =
	| "OK_DERIVED_FROM_USE_OF_FUNDS"  // XLSX-bridged slot — best outcome
	| "OK_TEXT"                       // Text-pattern promotion (no XLSX needed)
	| "NOT_PRESENT"                   // No UoF data found — acceptable, not a bug
	| "WIRING_BUG";                   // use_of_funds_v1 section present but slot not promoted

// ─── Snapshot types ───────────────────────────────────────────────────────────

export interface InsightsSnapshot {
	updated_at:           string | null;
	upstream_fingerprint: string | null;
	status:               string | null;
	gate_all_passed:      boolean | null;
	section_keys:         string[];
	insight_slots_body:   string | null;
	use_of_funds_v1_body: string | null;
}

// ─── Assertion result type ────────────────────────────────────────────────────

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

// ─── Per-deal result ──────────────────────────────────────────────────────────

interface DealUofResult {
	deal_id:    string;
	deal_name:  string;
	status:     "ok" | "fail" | "timeout" | "error";
	error?:     string;
	elapsed_ms: number;
	outcome:    UofOutcome | null;
	uof_slot_line:   string | null;
	evidence_ref:    string | null;
	has_uof_v1_section: boolean;
	pre_updated_at:  string | null;
	post_updated_at: string | null;
	assertions: AssertionResult[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${urlPath}`;
	const res = await fetch(url, opts);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

function extractSnapshot(d: unknown): InsightsSnapshot {
	const report   = d as Record<string, unknown>;
	const rp       = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"])
		? (rp["sections"] as Array<Record<string, unknown>>)
		: [];

	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));
	const gateState   = (rp["gate_state"] ?? {}) as Record<string, unknown>;
	const slotSec     = sections.find((s) => s["key"] === "insight_slots");
	const uofSec      = sections.find((s) => s["key"] === "use_of_funds_v1");

	return {
		updated_at:           typeof report["updated_at"] === "string" ? report["updated_at"] : null,
		upstream_fingerprint: typeof report["upstream_fingerprint"] === "string" ? report["upstream_fingerprint"] : null,
		status:               typeof report["status"] === "string" ? report["status"] : null,
		gate_all_passed:      typeof gateState["all_passed"] === "boolean" ? gateState["all_passed"] : null,
		section_keys:         sectionKeys,
		insight_slots_body:   typeof slotSec?.["body"] === "string" ? slotSec["body"] as string : null,
		use_of_funds_v1_body: typeof uofSec?.["body"]  === "string" ? uofSec["body"] as string  : null,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Slot parsing helpers ─────────────────────────────────────────────────────

/** Extract the `use_of_funds:` line from the insight_slots body. */
export function parseUofSlotLine(insightSlotsBody: string | null): string | null {
	if (!insightSlotsBody) return null;
	return insightSlotsBody.split("\n").find((l) => l.startsWith("use_of_funds:")) ?? null;
}

/** Extract the first evidence reference from a slot-line string. */
export function extractEvidenceRef(slotLine: string | null): string | null {
	if (!slotLine) return null;
	const m = slotLine.match(EVIDENCE_REF_RE);
	return m ? m[0] : null;
}

/**
 * Classify the UoF outcome for a deal given its post-regen snapshot.
 *
 * Rules:
 *   1. If `use_of_funds_v1` section present AND slot is Computable with
 *      DERIVED_FROM_USE_OF_FUNDS reason → OK_DERIVED_FROM_USE_OF_FUNDS.
 *   2. If `use_of_funds_v1` section present BUT slot NOT promoted → WIRING_BUG.
 *   3. If `use_of_funds_v1` section absent AND slot is Computable (text match) → OK_TEXT.
 *   4. Otherwise → NOT_PRESENT.
 */
export function classifyUofOutcome(snap: InsightsSnapshot): UofOutcome {
	const hasUofV1Section  = snap.section_keys.includes("use_of_funds_v1");
	const slotBody         = snap.insight_slots_body ?? "";
	const isComputable     = /use_of_funds:\s*Computable/.test(slotBody);
	const isDerivedFromUof = /DERIVED_FROM_USE_OF_FUNDS/.test(slotBody);

	if (hasUofV1Section) {
		if (isComputable && isDerivedFromUof) return "OK_DERIVED_FROM_USE_OF_FUNDS";
		return "WIRING_BUG";
	}

	if (isComputable) return "OK_TEXT";

	return "NOT_PRESENT";
}

// ─── Assertion builder ────────────────────────────────────────────────────────

function buildAssertions(snap: InsightsSnapshot, outcome: UofOutcome): AssertionResult[] {
	const results: AssertionResult[] = [];
	const slotLine    = parseUofSlotLine(snap.insight_slots_body);
	const evidenceRef = extractEvidenceRef(slotLine);

	// A1: outcome classification
	const outcomePass = outcome !== "WIRING_BUG";
	results.push({
		name:   "uof_outcome_not_wiring_bug",
		passed: outcomePass,
		detail: outcomePass
			? `Outcome=${outcome} — acceptable.`
			: `FAIL — WIRING_BUG: use_of_funds_v1 section is present but insight slot was not promoted. ` +
			  `Ensure evalUseOfFundsSlot checks for use_of_funds_v1 section and the ` +
			  `DERIVED_FROM_USE_OF_FUNDS bridge is triggered. slot_line: ${slotLine?.slice(0, 200) ?? "null"}`,
	});

	// A2: if DERIVED, must have a valid evidence reference
	if (outcome === "OK_DERIVED_FROM_USE_OF_FUNDS") {
		results.push({
			name:   "uof_derived_has_evidence_ref",
			passed: evidenceRef !== null,
			detail: evidenceRef !== null
				? `Evidence ref present: ${evidenceRef}`
				: `FAIL — Computable with DERIVED_FROM_USE_OF_FUNDS but no dpu:doc:… evidence ref found. ` +
				  `slot_line: ${slotLine?.slice(0, 200) ?? "null"}`,
		});
	}

	// A3: if WIRING_BUG, surface section keys for debugging
	if (outcome === "WIRING_BUG") {
		results.push({
			name:   "uof_wiring_bug_sections_debug",
			passed: false,
			detail: `section_keys=[${snap.section_keys.join(", ")}] ` +
				`insight_slots_body_excerpt=${snap.insight_slots_body?.slice(0, 200) ?? "null"}`,
		});
	}

	return results;
}

// ─── Per-deal verification ────────────────────────────────────────────────────

async function verifyDeal(deal: { name: string; deal_id: string }): Promise<DealUofResult> {
	const { deal_id, name: deal_name } = deal;
	const start = Date.now();
	let preUpdatedAt: string | null = null;

	try {
		// 1. Snapshot pre-regen updated_at
		const preRaw = await apiFetch(`/api/v1/deals/${deal_id}/investor-insights`);
		const pre    = extractSnapshot(preRaw);
		preUpdatedAt = pre.updated_at;
		console.log(`  [${deal_name}] Pre: status=${pre.status ?? "none"} updated_at=${pre.updated_at?.slice(0, 19) ?? "none"}`);

		// 2. Trigger regeneration
		await apiFetch(`/api/v1/deals/${deal_id}/investor-insights/regenerate`, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    "{}",
		});
		console.log(`  [${deal_name}] Regeneration enqueued.`);

		// 3. Poll until updated_at changes or upstream_fingerprint changes
		const deadline = start + TIMEOUT_MS;
		let post: InsightsSnapshot | null = null;
		let changed = false;

		while (Date.now() < deadline) {
			await sleep(POLL_INTERVAL_MS);
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
				error:      `Timed out after ${TIMEOUT_MS}ms — report did not update. Is the worker running?`,
				elapsed_ms: Date.now() - start,
				outcome:    null,
				uof_slot_line:      null,
				evidence_ref:       null,
				has_uof_v1_section: false,
				pre_updated_at:     preUpdatedAt,
				post_updated_at:    null,
				assertions: [],
			};
		}

		const elapsed = Date.now() - start;
		console.log(`  [${deal_name}] Updated in ${elapsed}ms. Classifying…`);

		// 4. Classify + assert
		const outcome    = classifyUofOutcome(post);
		const slotLine   = parseUofSlotLine(post.insight_slots_body);
		const evidenceRef = extractEvidenceRef(slotLine);
		const assertions = buildAssertions(post, outcome);
		const allPassed  = assertions.every((a) => a.passed);

		console.log(`  [${deal_name}] Outcome: ${outcome}`);
		for (const a of assertions) {
			const icon = a.passed ? "✓" : "✗";
			console.log(`    ${icon} ${a.name}: ${a.passed ? "PASS" : "FAIL"}`);
			if (!a.passed) console.log(`      ${a.detail}`);
		}

		return {
			deal_id, deal_name,
			status:     allPassed ? "ok" : "fail",
			elapsed_ms: elapsed,
			outcome,
			uof_slot_line:      slotLine,
			evidence_ref:       evidenceRef,
			has_uof_v1_section: post.section_keys.includes("use_of_funds_v1"),
			pre_updated_at:     preUpdatedAt,
			post_updated_at:    post.updated_at,
			assertions,
		};

	} catch (err) {
		return {
			deal_id, deal_name,
			status:     "error",
			error:      err instanceof Error ? err.message : String(err),
			elapsed_ms: Date.now() - start,
			outcome:    null,
			uof_slot_line:      null,
			evidence_ref:       null,
			has_uof_v1_section: false,
			pre_updated_at:     preUpdatedAt,
			post_updated_at:    null,
			assertions: [],
		};
	}
}

// ─── Markdown builder ─────────────────────────────────────────────────────────

function buildMarkdown(results: DealUofResult[]): string {
	const failCount = results.filter((r) => r.status === "fail").length;
	const bugCount  = results.filter((r) => r.outcome === "WIRING_BUG").length;
	const lines: string[] = [
		"# UoF 3-Deals Verify Report",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Base URL: ${BASE_URL}`,
		`Timeout: ${TIMEOUT_SECONDS}s | Poll interval: ${POLL_INTERVAL_MS}ms`,
		`Deals: ${results.length}  |  Wiring bugs: ${bugCount}  |  Failures: ${failCount}`,
		"",
		"---",
		"",
	];

	for (const r of results) {
		const statusIcon    = r.status === "ok" ? "✅" : r.status === "fail" ? "❌" : "⚠️";
		const outcomeSymbol = r.outcome === "OK_DERIVED_FROM_USE_OF_FUNDS" ? "🔗"
			: r.outcome === "OK_TEXT"    ? "📝"
			: r.outcome === "NOT_PRESENT" ? "➖"
			: r.outcome === "WIRING_BUG"  ? "🐛"
			: "❓";

		lines.push(`## ${statusIcon} ${r.deal_name} (\`${r.deal_id}\`)`);
		lines.push("");
		lines.push(`**Status:** ${r.status} | **Elapsed:** ${r.elapsed_ms}ms`);
		lines.push(`**UoF Outcome:** ${outcomeSymbol} \`${r.outcome ?? "n/a"}\``);
		lines.push(`**has_use_of_funds_v1_section:** ${r.has_uof_v1_section}`);
		lines.push("");

		if (r.status === "error" || r.status === "timeout") {
			lines.push(`> ⚠️ ${r.error}`);
			lines.push("");
			lines.push("---");
			lines.push("");
			continue;
		}

		if (r.uof_slot_line) {
			lines.push("**use_of_funds slot line:**");
			lines.push("```");
			lines.push(r.uof_slot_line);
			lines.push("```");
			lines.push("");
		}

		if (r.evidence_ref) {
			lines.push(`**Evidence ref:** \`${r.evidence_ref}\``);
			lines.push("");
		}

		if (r.assertions.length > 0) {
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
		}

		lines.push("---");
		lines.push("");
	}

	// Summary table
	lines.push("## Summary");
	lines.push("");
	lines.push("| Deal | Outcome | Status | Elapsed |");
	lines.push("|------|---------|--------|---------|");
	for (const r of results) {
		lines.push(`| ${r.deal_name} | ${r.outcome ?? "n/a"} | ${r.status} | ${r.elapsed_ms}ms |`);
	}
	lines.push("");

	if (bugCount > 0) {
		lines.push("## ❌ Wiring Bug Analysis");
		lines.push("");
		lines.push("The following deals have a `use_of_funds_v1` section in their render_package");
		lines.push("but the insight slot was **not** promoted with `DERIVED_FROM_USE_OF_FUNDS`.");
		lines.push("This indicates the XLSX→slot bridge is broken or not being triggered.");
		lines.push("");
		for (const r of results.filter((r) => r.outcome === "WIRING_BUG")) {
			lines.push(`- **${r.deal_name}** (\`${r.deal_id}\`)`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("[uof-3deals] Starting UoF 3-deal verification");
	console.log(`  base=${BASE_URL} timeout=${TIMEOUT_SECONDS}s poll=${POLL_INTERVAL_MS}ms`);
	console.log("");

	// Verify API reachability
	try {
		await apiFetch(`/api/v1/deals/${DEALS[0].deal_id}/investor-insights`);
	} catch (err) {
		console.error(`[uof-3deals] FATAL: Cannot reach ${BASE_URL} — is the API running?`);
		console.error(`  ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	const results: DealUofResult[] = [];
	for (const deal of DEALS) {
		console.log(`[uof-3deals] → ${deal.name} (${deal.deal_id})`);
		const result = await verifyDeal(deal);
		results.push(result);
		console.log(`  ← ${result.status.toUpperCase()}  outcome=${result.outcome ?? "n/a"}  ${result.elapsed_ms}ms`);
		console.log("");
	}

	// Resolve output directory
	const workerRoot = path.resolve(__dirname, "../../");
	const outDir     = OUT_DIR_ARG ? path.resolve(OUT_DIR_ARG) : path.join(workerRoot, "tmp");
	const jsonPath   = path.join(outDir, "uof-verify-3deals.json");
	const mdPath     = path.join(outDir, "uof-verify-3deals.md");

	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
	console.log(`[uof-3deals] Wrote: ${jsonPath}`);

	const md = buildMarkdown(results);
	fs.writeFileSync(mdPath, md);
	console.log(`[uof-3deals] Wrote: ${mdPath}`);

	// Final summary
	const okCount   = results.filter((r) => r.status === "ok").length;
	const failCount = results.filter((r) => r.status !== "ok").length;
	console.log("");
	console.log(`=== UoF 3-Deals Summary: ${okCount}/${results.length} ok ===`);
	for (const r of results) {
		const icon = r.status === "ok" ? "✓" : "✗";
		console.log(`  ${icon} ${r.deal_name.padEnd(16)} status=${r.status.padEnd(7)} outcome=${(r.outcome ?? "n/a").padEnd(34)} ${r.elapsed_ms}ms`);
		if (r.error) console.log(`    error: ${r.error}`);
	}
	console.log("");

	if (failCount > 0) {
		const bugCount = results.filter((r) => r.outcome === "WIRING_BUG").length;
		if (bugCount > 0) {
			console.error(`[uof-3deals] ${bugCount} WIRING_BUG(s) detected — see ${mdPath}`);
		} else {
			console.error(`[uof-3deals] ${failCount} deal(s) failed (timeout/error) — see ${mdPath}`);
		}
		process.exit(1);
	}
}

// Only run when executed directly (not when imported by tests).
// resolve(__dirname, url) works for both cjs and esm/tsx contexts.
const isMain =
	typeof require !== "undefined"
		? require.main === module
		: process.argv[1]?.endsWith("verify-uof-3deals.ts") ||
		  process.argv[1]?.endsWith("verify-uof-3deals.js");

if (isMain) {
	main().catch((err) => {
		console.error("[uof-3deals] Unhandled error:", err);
		process.exit(1);
	});
}
