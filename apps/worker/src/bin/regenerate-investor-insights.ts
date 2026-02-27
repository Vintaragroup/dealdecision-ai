#!/usr/bin/env node
/**
 * bin/regenerate-investor-insights.ts
 *
 * Dev-only CLI: trigger investor-insights regen for one or more deals,
 * poll until the report changes, then print a concise before/after diff.
 *
 * Usage:
 *   pnpm --filter worker regen:investor-insights -- \
 *     --deal-list apps/worker/tmp/audit_3deals.json \
 *     [--base http://localhost:9001] \
 *     [--timeout-ms 180000] \
 *     [--poll-ms 1500]
 *
 *   pnpm --filter worker regen:investor-insights -- \
 *     --deal-id 517be946-cab9-4bc1-8982-9522ff9dab32
 *
 * Outputs:
 *   tmp/regenerate-verify.json  — machine-readable pre/post per deal
 *   tmp/regenerate-verify.md    — human-readable markdown summary
 */

import * as fs from "fs";
import * as path from "path";

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag: string): string | null {
	const idx = args.indexOf(flag);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : null;
}
function argValues(flag: string): string[] {
	const vals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === flag && i + 1 < args.length) vals.push(args[i + 1]!);
	}
	return vals;
}

const BASE_URL   = argValue("--base")       ?? "http://localhost:9001";
const DEAL_LIST  = argValue("--deal-list");
const TIMEOUT_MS = parseInt(argValue("--timeout-ms") ?? "180000", 10);
const POLL_MS    = parseInt(argValue("--poll-ms")    ?? "1500",   10);

interface DealEntry { name: string; deal_id: string }

let deals: DealEntry[];
if (DEAL_LIST) {
	const raw = JSON.parse(fs.readFileSync(DEAL_LIST, "utf-8")) as { deals: DealEntry[] };
	deals = raw.deals;
} else {
	const ids = argValues("--deal-id");
	if (ids.length === 0) {
		console.error("[regen] ERROR: provide --deal-list <file> or one or more --deal-id <uuid>");
		process.exit(1);
	}
	deals = ids.map((id) => ({ name: id.slice(0, 8), deal_id: id }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${path}`;
	const res = await fetch(url, opts);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

interface InsightsSnapshot {
	updated_at:           string | null;
	upstream_fingerprint: string | null;
	gate_all_passed:      boolean | null;
	g3_row:               unknown | null;
	insight_slots_body:   string | null;
	canonical_fields_body:string | null;
	section_keys:         string[];
	has_financial_stmt:   boolean;
	has_canonical_revenue:boolean;
}

function extractSnapshot(d: unknown): InsightsSnapshot {
	const report = d as Record<string, unknown>;
	const rp = (report["render_package"] ?? {}) as Record<string, unknown>;
	const sections = Array.isArray(rp["sections"]) ? (rp["sections"] as Array<Record<string, unknown>>) : [];
	const sectionKeys = sections.map((s) => String(s["key"] ?? ""));

	const gateState = (rp["gate_state"] ?? {}) as Record<string, unknown>;
	const gateResults = Array.isArray(gateState["results"]) ? (gateState["results"] as Array<Record<string,unknown>>) : [];
	const g3Row = gateResults.find((r) => r["gate"] === "G3") ?? null;

	const insightSlotsSection = sections.find((s) => s["key"] === "insight_slots");
	const canonicalSection    = sections.find((s) => s["key"] === "canonical_fields");

	const insightSlotsBody    = typeof insightSlotsSection?.["body"] === "string" ? insightSlotsSection["body"] as string : null;
	const canonicalFieldsBody = typeof canonicalSection?.["body"] === "string"    ? canonicalSection["body"] as string    : null;

	const hasFinancialStmt = sectionKeys.includes("financial_statement_v1");

	// canonical_fields body — check for revenue_value: Computable
	const hasCanonicalRevenue = typeof canonicalFieldsBody === "string"
		&& /revenue_value:\s*Computable/i.test(canonicalFieldsBody);

	return {
		updated_at:           typeof report["updated_at"] === "string" ? report["updated_at"] : null,
		upstream_fingerprint: typeof report["upstream_fingerprint"] === "string" ? report["upstream_fingerprint"] : null,
		gate_all_passed:      typeof gateState["all_passed"] === "boolean" ? gateState["all_passed"] : null,
		g3_row:               g3Row,
		insight_slots_body:   insightSlotsBody,
		canonical_fields_body:canonicalFieldsBody,
		section_keys:         sectionKeys,
		has_financial_stmt:   hasFinancialStmt,
		has_canonical_revenue:hasCanonicalRevenue,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function slotLines(body: string | null): Record<string, string> {
	if (!body) return {};
	const map: Record<string, string> = {};
	for (const line of body.split("\n")) {
		const m = /^(\w+):\s*(.+)$/.exec(line.trim());
		if (m) map[m[1]!] = m[2]!;
	}
	return map;
}

function diffSlots(preBody: string | null, postBody: string | null): string[] {
	const pre  = slotLines(preBody);
	const post = slotLines(postBody);
	const lines: string[] = [];
	const names = new Set([...Object.keys(pre), ...Object.keys(post)]);
	for (const name of [...names].sort()) {
		const p = pre[name]  ?? "(missing)";
		const q = post[name] ?? "(missing)";
		if (p === q) {
			lines.push(`  ${name}: ${q}`);
		} else {
			lines.push(`  ${name}: CHANGED`);
			lines.push(`    before: ${p}`);
			lines.push(`    after:  ${q}`);
		}
	}
	return lines;
}

function diffCanonical(preBody: string | null, postBody: string | null): string[] {
	const pre  = slotLines(preBody);
	const post = slotLines(postBody);
	const lines: string[] = [];
	const names = new Set([...Object.keys(pre), ...Object.keys(post)]);
	for (const name of [...names].sort()) {
		const p = pre[name]  ?? "(missing)";
		const q = post[name] ?? "(missing)";
		if (p !== q) {
			lines.push(`  ${name}: CHANGED`);
			lines.push(`    before: ${p}`);
			lines.push(`    after:  ${q}`);
		} else {
			lines.push(`  ${name}: ${q}`);
		}
	}
	return lines;
}

// ─── Per-deal regen + poll ────────────────────────────────────────────────────

interface DealVerifyResult {
	deal_id:     string;
	deal_name:   string;
	status:      "ok" | "timeout" | "error";
	error?:      string;
	pre:         InsightsSnapshot | null;
	post:        InsightsSnapshot | null;
	elapsed_ms:  number;
}

async function regenAndVerify(deal: DealEntry): Promise<DealVerifyResult> {
	const { deal_id, name: deal_name } = deal;
	const start = Date.now();
	let pre: InsightsSnapshot | null = null;

	try {
		// 1. Snapshot pre-state
		const preRaw = await apiFetch(`/api/v1/deals/${deal_id}/investor-insights`);
		pre = extractSnapshot(preRaw);

		if (pre.updated_at === null) {
			console.warn(`  [${deal_name}] WARNING: no existing report (status=not_started). Will still trigger regen.`);
		}

		// 2. Trigger regen
		await apiFetch(`/api/v1/deals/${deal_id}/investor-insights/regenerate`, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    "{}",
		});
		console.log(`  [${deal_name}] Regen enqueued (pre.updated_at=${pre.updated_at?.slice(0, 19) ?? "none"})`);

		// 3. Poll until updated_at or upstream_fingerprint changes
		const deadline = start + TIMEOUT_MS;
		let post: InsightsSnapshot | null = null;
		let changed = false;

		while (Date.now() < deadline) {
			await sleep(POLL_MS);
			const postRaw = await apiFetch(`/api/v1/deals/${deal_id}/investor-insights`);
			const snap    = extractSnapshot(postRaw);

			const fpChanged = snap.upstream_fingerprint !== pre.upstream_fingerprint && snap.upstream_fingerprint !== null;
			const tsChanged = snap.updated_at !== null && snap.updated_at !== pre.updated_at;

			if (tsChanged || fpChanged) {
				post    = snap;
				changed = true;
				break;
			}
		}

		if (!changed) {
			return {
				deal_id, deal_name,
				status:     "timeout",
				error:      `Timed out after ${TIMEOUT_MS}ms — updated_at did not change. Is the worker running?`,
				pre,
				post:       null,
				elapsed_ms: Date.now() - start,
			};
		}

		console.log(`  [${deal_name}] Done in ${Date.now() - start}ms. post.updated_at=${post?.updated_at?.slice(0, 19)}`);
		return { deal_id, deal_name, status: "ok", pre, post, elapsed_ms: Date.now() - start };

	} catch (err) {
		return {
			deal_id, deal_name,
			status:     "error",
			error:      err instanceof Error ? err.message : String(err),
			pre,
			post:       null,
			elapsed_ms: Date.now() - start,
		};
	}
}

// ─── Markdown report builder ──────────────────────────────────────────────────

function buildMarkdown(results: DealVerifyResult[]): string {
	const lines: string[] = [
		"# Investor Insights Regen — Verify Report",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Base URL: ${BASE_URL}`,
		"",
		"---",
		"",
	];

	for (const r of results) {
		lines.push(`## ${r.deal_name} (\`${r.deal_id}\`)`);
		lines.push("");
		lines.push(`**Status:** ${r.status} | **Elapsed:** ${r.elapsed_ms}ms`);
		lines.push("");

		if (r.status === "error" || r.status === "timeout") {
			lines.push(`> ERROR: ${r.error}`);
			lines.push("");
			if (r.pre) {
				lines.push(`**Pre-state:** updated_at=${r.pre.updated_at?.slice(0,19) ?? "none"}`);
				lines.push("");
			}
			lines.push("---");
			lines.push("");
			continue;
		}

		const pre  = r.pre!;
		const post = r.post!;

		// Gate state
		lines.push("### Gate State");
		lines.push("");
		lines.push(`| Field | Before | After |`);
		lines.push(`|-------|--------|-------|`);
		lines.push(`| all_passed | ${pre.gate_all_passed} | ${post.gate_all_passed} |`);
		const preG3  = (pre.g3_row  as Record<string,unknown> | null);
		const postG3 = (post.g3_row as Record<string,unknown> | null);
		lines.push(`| G3 passed | ${preG3?.["passed"] ?? "n/a"} | ${postG3?.["passed"] ?? "n/a"} |`);
		lines.push(`| G3 status | ${preG3?.["status"] ?? "n/a"} | ${postG3?.["status"] ?? "n/a"} |`);
		lines.push("");

		// Timestamps
		lines.push("### Report Metadata");
		lines.push("");
		lines.push(`| Field | Before | After |`);
		lines.push(`|-------|--------|-------|`);
		lines.push(`| updated_at | ${pre.updated_at?.slice(0,19) ?? "none"} | ${post.updated_at?.slice(0,19) ?? "none"} |`);
		lines.push(`| upstream_fingerprint | ${pre.upstream_fingerprint?.slice(0,16) ?? "none"}… | ${post.upstream_fingerprint?.slice(0,16) ?? "none"}… |`);
		lines.push(`| financial_statement_v1 section | ${pre.has_financial_stmt} | ${post.has_financial_stmt} |`);
		lines.push(`| canonical revenue Computable | ${pre.has_canonical_revenue} | ${post.has_canonical_revenue} |`);
		lines.push("");

		// Section keys diff
		const addedSections   = post.section_keys.filter((k) => !pre.section_keys.includes(k));
		const removedSections = pre.section_keys.filter((k)  => !post.section_keys.includes(k));
		if (addedSections.length || removedSections.length) {
			lines.push("### Section Changes");
			lines.push("");
			if (addedSections.length)   lines.push(`**Added:** ${addedSections.join(", ")}`);
			if (removedSections.length) lines.push(`**Removed:** ${removedSections.join(", ")}`);
			lines.push("");
		}

		// Insight slots diff
		lines.push("### Insight Slots");
		lines.push("");
		const slotDiff = diffSlots(pre.insight_slots_body, post.insight_slots_body);
		lines.push("```");
		lines.push(...slotDiff);
		lines.push("```");
		lines.push("");

		// Canonical fields diff (only changed lines)
		const canonDiffLines = diffCanonical(pre.canonical_fields_body, post.canonical_fields_body);
		const changed = canonDiffLines.filter((l) => l.includes("CHANGED"));
		if (changed.length > 0) {
			lines.push("### Canonical Fields — Changes");
			lines.push("");
			lines.push("```");
			lines.push(...canonDiffLines);
			lines.push("```");
			lines.push("");
		} else {
			lines.push("### Canonical Fields — No Changes");
			lines.push("");
		}

		lines.push("---");
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log(`[regen] Starting for ${deals.length} deal(s) — base=${BASE_URL} timeout=${TIMEOUT_MS}ms poll=${POLL_MS}ms`);
	console.log("");

	// Verify API is reachable first
	try {
		await apiFetch("/api/v1/deals/" + deals[0]!.deal_id + "/investor-insights");
	} catch (err) {
		console.error(`[regen] FATAL: Cannot reach ${BASE_URL} — is the API running?`);
		console.error(`  ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	const results: DealVerifyResult[] = [];
	for (const deal of deals) {
		console.log(`[regen] Processing: ${deal.name} (${deal.deal_id})`);
		const result = await regenAndVerify(deal);
		results.push(result);
		if (result.status === "timeout") {
			console.warn(`  TIMEOUT — ${result.error}`);
		} else if (result.status === "error") {
			console.error(`  ERROR — ${result.error}`);
		}
		console.log("");
	}

	// Write JSON
	const workerRoot = path.resolve(__dirname, "../../");
	const jsonPath = path.join(workerRoot, "tmp", "regenerate-verify.json");
	const mdPath   = path.join(workerRoot, "tmp", "regenerate-verify.md");

	fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
	fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
	console.log(`[regen] Wrote: ${jsonPath}`);

	const md = buildMarkdown(results);
	fs.writeFileSync(mdPath, md);
	console.log(`[regen] Wrote: ${mdPath}`);

	// Print summary to stdout
	console.log("");
	console.log("=== Summary ===");
	for (const r of results) {
		const status  = r.status.toUpperCase().padEnd(7);
		const elapsed = `${r.elapsed_ms}ms`.padStart(8);
		const ts      = r.post?.updated_at?.slice(0, 19) ?? r.pre?.updated_at?.slice(0, 19) ?? "none";
		const fin     = r.post?.has_financial_stmt   ?? r.pre?.has_financial_stmt   ?? false;
		const rev     = r.post?.has_canonical_revenue ?? r.pre?.has_canonical_revenue ?? false;
		console.log(`  ${status}  ${elapsed}  ${r.deal_name.padEnd(18)}  updated_at=${ts}  financial_stmt=${fin}  canonical_rev=${rev}`);
		if (r.status !== "ok") console.log(`           ${r.error}`);
	}
	console.log("");

	// Exit with error if any deal failed
	const failed = results.filter((r) => r.status !== "ok");
	if (failed.length > 0) {
		console.error(`[regen] ${failed.length} deal(s) failed — check output above`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("[regen] Unhandled error:", err);
	process.exit(1);
});
