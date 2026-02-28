#!/usr/bin/env node
/**
 * bin/proof-governed-company-name.ts
 *
 * Proof runner: validates that the governed executive summary uses the real
 * company name (not "Startup Corp" or any placeholder) and contains at least
 * one product-focused sentence.
 *
 * Run against 3 canonical deals: StackFactor, DealDecision, WebMax.
 *
 * Phases
 * ──────
 *   Phase 1  Fetch current report snapshot
 *   Phase 2  Trigger regeneration + poll for updated report
 *   Phase 3  Assert: real company name, no placeholder, ≥1 product sentence
 *   Phase 4  Write report → tmp/proof-company-name.report.md
 *
 * Usage
 * ─────
 *   pnpm --filter worker proof:company-name
 *   pnpm --filter worker proof:company-name -- [options]
 *
 * CLI flags
 * ─────────
 *   --base-url          API base URL           (default: http://localhost:9001)
 *   --timeout-seconds   Per-deal poll timeout  (default: 180)
 *   --poll-interval-ms  Poll cadence           (default: 3000)
 *   --skip-regen        Skip regeneration, assert against existing report
 *   --out               Output directory       (default: apps/worker/tmp)
 *
 * Exit codes
 *   0 → all 3 deals proved
 *   1 → at least one deal failed, timed out, or errored
 */

import * as fs   from "fs";
import * as path from "path";

import {
	parseGovernedExecSummaryBody,
} from "../jobs/investor-insights/governed-executive-summary-v1";
import { validateCompanyName } from "../jobs/investor-insights/governed-summary-v1";

// ─── Deal registry ────────────────────────────────────────────────────────────

interface DealConfig {
	name:    string;
	deal_id: string;
}

const DEALS: DealConfig[] = [
	{ name: "StackFactor",   deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
	{ name: "DealDecision",  deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "WebMax",        deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4" },
];

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
const POLL_INTERVAL_MS = parseInt(argValue("--poll-interval-ms") ?? "3000", 10);
const SKIP_REGEN       = argFlag("--skip-regen");
const OUT_DIR          = path.resolve(
	argValue("--out") ?? path.join(__dirname, "../../../tmp")
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssertionResult {
	name:   string;
	passed: boolean;
	detail: string;
}

interface DealProof {
	deal_id:           string;
	deal_name:         string;
	elapsed_ms:        number;
	status:            "PROVED" | "FAILED" | "TIMEOUT" | "ERROR";
	error?:            string;
	headline:          string | null;
	paragraphs:        string[];
	assertion_results: AssertionResult[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(urlPath: string, opts?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${urlPath}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(opts?.headers as Record<string, string> | undefined),
	};
	const apiKey =
		process.env["INTERNAL_API_KEY"] ?? process.env["API_SECRET_KEY"] ?? "";
	if (apiKey) headers["x-api-key"] = apiKey;

	const res = await fetch(url, { ...opts, headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

// ─── Section extraction ───────────────────────────────────────────────────────

/**
 * Extract the `governed_executive_summary_v1` section body from a raw
 * investor-insights API response.
 */
function extractExecSummaryBody(raw: unknown): string | null {
	const rp = (raw as Record<string, unknown>)?.["render_package"];
	const sections = Array.isArray((rp as Record<string, unknown>)?.["sections"])
		? ((rp as Record<string, unknown>)?.["sections"] as Array<Record<string, unknown>>)
		: [];
	const sec = sections.find((s) => s["key"] === "governed_executive_summary_v1");
	if (!sec) return null;
	const body = sec["body"];
	return typeof body === "string" ? body : null;
}

function fetchUpdatedAt(raw: unknown): string | null {
	const rp = (raw as Record<string, unknown>)?.["render_package"];
	const ua = (rp as Record<string, unknown>)?.["updated_at"];
	return typeof ua === "string" ? ua : null;
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const PRODUCT_KW_RE =
	/\b(?:product|platform|solution|technology|software|tool|service|builds?|offers?|provides?|delivers?|enables?|helps?|solves?|automates?)\b/i;

/**
 * Assert a headline and paragraph set for one deal.
 * Returns an array of assertion results.
 */
function assertExecSummary(
	dealName: string,
	headline: string | null,
	paragraphs: string[],
	oneLiner: string | null,
): AssertionResult[] {
	const results: AssertionResult[] = [];

	// 1. headline is present
	results.push({
		name:   "headline_present",
		passed: typeof headline === "string" && headline.trim().length > 0,
		detail: headline ? `headline="${headline.slice(0, 80)}"` : "headline is null/empty",
	});

	// 2. headline contains the real deal name (case-insensitive)
	const headlineMentionsDeal =
		typeof headline === "string" &&
		headline.toLowerCase().includes(dealName.toLowerCase());
	results.push({
		name:   "headline_contains_deal_name",
		passed: headlineMentionsDeal,
		detail: headlineMentionsDeal
			? `headline contains "${dealName}"`
			: `FAIL — headline does not mention "${dealName}": "${headline ?? "(null)"}"`,
	});

	// 3. no placeholder in headline or paragraphs
	const allText = [headline ?? "", oneLiner ?? "", ...paragraphs].join(" ");
	const nameCheck = validateCompanyName(dealName, allText);
	results.push({
		name:   "no_placeholder_name",
		passed: nameCheck.ok,
		detail: nameCheck.ok
			? "No placeholder names detected"
			: `FAIL — ${nameCheck.issues.join("; ")}`,
	});

	// 4. at least one product sentence in paragraphs
	const productSentences = paragraphs.filter((p) => PRODUCT_KW_RE.test(p));
	const hasProductSentence = productSentences.length > 0;
	results.push({
		name:   "has_product_sentence",
		passed: hasProductSentence,
		detail: hasProductSentence
			? `${productSentences.length} product sentence(s) found`
			: `FAIL — no paragraph containing product context keywords`,
	});

	// 5. deal name appears in at least one paragraph or one_liner
	const bodyText = [oneLiner ?? "", ...paragraphs].join(" ");
	const bodyMentionsDeal = bodyText.toLowerCase().includes(dealName.toLowerCase());
	results.push({
		name:   "body_mentions_deal_name",
		passed: bodyMentionsDeal,
		detail: bodyMentionsDeal
			? `body mentions "${dealName}"`
			: `FAIL — paragraphs/one_liner do not mention "${dealName}"`,
	});

	return results;
}

// ─── Prove one deal ───────────────────────────────────────────────────────────

async function proveOneDeal(config: DealConfig): Promise<DealProof> {
	const start = Date.now();

	// ── Phase 1: Fetch pre-snapshot ─────────────────────────────────────────
	let preUpdatedAt: string | null = null;
	try {
		const raw = await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights`);
		preUpdatedAt = fetchUpdatedAt(raw);
		console.log(`  [${config.name}] Pre updated_at: ${preUpdatedAt ?? "none"}`);
	} catch (e) {
		return {
			deal_id:    config.deal_id,
			deal_name:  config.name,
			elapsed_ms: Date.now() - start,
			status:     "ERROR",
			error:      `Pre-fetch failed: ${String(e)}`,
			headline:   null,
			paragraphs: [],
			assertion_results: [{ name: "pre_fetch", passed: false, detail: String(e) }],
		};
	}

	// ── Phase 2: Trigger regeneration (unless skipped) ──────────────────────
	if (!SKIP_REGEN) {
		console.log(`  [${config.name}] Triggering regeneration…`);
		try {
			await apiFetch(
				`/api/v1/deals/${config.deal_id}/investor-insights/regenerate`,
				{ method: "POST", body: "{}" }
			);
		} catch (e) {
			console.warn(`  [${config.name}] WARN: regen trigger failed: ${String(e)}`);
		}

		// Poll until updated_at changes or timeout
		const deadline = start + TIMEOUT_MS;
		let settled = false;

		while (Date.now() < deadline) {
			await sleep(POLL_INTERVAL_MS);
			try {
				const raw      = await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights`);
				const newTs    = fetchUpdatedAt(raw);
				const changed  = newTs !== null && newTs !== preUpdatedAt;
				console.log(`  [${config.name}] Poll: updated_at=${newTs?.slice(0, 19) ?? "none"}${changed ? " ← changed" : ""}`);
				if (changed) { settled = true; break; }
			} catch (e) {
				console.warn(`  [${config.name}] WARN: poll failed: ${String(e)}`);
			}
		}

		if (!settled) {
			return {
				deal_id:    config.deal_id,
				deal_name:  config.name,
				elapsed_ms: Date.now() - start,
				status:     "TIMEOUT",
				headline:   null,
				paragraphs: [],
				assertion_results: [{
					name:   "regeneration_timeout",
					passed: false,
					detail: `No updated_at change within ${TIMEOUT_MS / 1000}s`,
				}],
			};
		}
	}

	// ── Phase 3: Fetch post-snapshot and assert ──────────────────────────────
	let postRaw: unknown;
	try {
		postRaw = await apiFetch(`/api/v1/deals/${config.deal_id}/investor-insights`);
	} catch (e) {
		return {
			deal_id:    config.deal_id,
			deal_name:  config.name,
			elapsed_ms: Date.now() - start,
			status:     "ERROR",
			error:      `Post-fetch failed: ${String(e)}`,
			headline:   null,
			paragraphs: [],
			assertion_results: [{ name: "post_fetch", passed: false, detail: String(e) }],
		};
	}

	const execSummaryBody = extractExecSummaryBody(postRaw);

	if (!execSummaryBody) {
		return {
			deal_id:    config.deal_id,
			deal_name:  config.name,
			elapsed_ms: Date.now() - start,
			status:     "FAILED",
			headline:   null,
			paragraphs: [],
			assertion_results: [{
				name:   "governed_executive_summary_v1_present",
				passed: false,
				detail: "governed_executive_summary_v1 section absent from render_package",
			}],
		};
	}

	const parsed = parseGovernedExecSummaryBody(execSummaryBody);

	if (!parsed) {
		return {
			deal_id:    config.deal_id,
			deal_name:  config.name,
			elapsed_ms: Date.now() - start,
			status:     "FAILED",
			headline:   null,
			paragraphs: [],
			assertion_results: [{
				name:   "exec_summary_parse",
				passed: false,
				detail: "parseGovernedExecSummaryBody returned null — JSON marker missing or invalid",
			}],
		};
	}

	const headline   = parsed.headline ?? null;
	const oneLiner   = parsed.one_liner ?? null;
	const paragraphs = parsed.summary_paragraphs ?? [];
	const assertions = assertExecSummary(config.name, headline, paragraphs, oneLiner);
	const allPassed  = assertions.every((a) => a.passed);

	return {
		deal_id:           config.deal_id,
		deal_name:         config.name,
		elapsed_ms:        Date.now() - start,
		status:            allPassed ? "PROVED" : "FAILED",
		headline,
		paragraphs,
		assertion_results: assertions,
	};
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function renderReport(proofs: DealProof[]): string {
	const lines: string[] = [];
	const passed = proofs.filter((p) => p.status === "PROVED").length;
	const total  = proofs.length;

	lines.push("# Governed Company Name Proof Report");
	lines.push("");
	lines.push(`**Result: ${passed}/${total} deals proved**`);
	lines.push(`**Timestamp: ${new Date().toISOString()}**`);
	lines.push(`**skip-regen: ${SKIP_REGEN}**`);
	lines.push("");

	for (const proof of proofs) {
		const icon = proof.status === "PROVED" ? "✅" : proof.status === "TIMEOUT" ? "⏱️" : "❌";
		lines.push(`## ${icon} ${proof.deal_name} (${proof.status})`);
		lines.push(`- deal_id: \`${proof.deal_id}\``);
		lines.push(`- elapsed: ${(proof.elapsed_ms / 1000).toFixed(1)}s`);
		if (proof.error) lines.push(`- error: ${proof.error}`);
		if (proof.headline) lines.push(`- headline: "${proof.headline}"`);
		if (proof.paragraphs.length > 0) {
			lines.push(`- paragraphs[0]: "${proof.paragraphs[0]?.slice(0, 120) ?? ""}…"`);
		}
		lines.push("");
		lines.push("| Assertion | Result | Detail |");
		lines.push("|-----------|--------|--------|");
		for (const a of proof.assertion_results) {
			const icon2 = a.passed ? "✅" : "❌";
			lines.push(`| ${a.name} | ${icon2} | ${a.detail} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
	console.log("\n=== proof-governed-company-name ===");
	console.log(`base_url:   ${BASE_URL}`);
	console.log(`skip_regen: ${SKIP_REGEN}`);
	console.log(`timeout:    ${TIMEOUT_MS / 1000}s`);
	console.log(`deals:      ${DEALS.map((d) => d.name).join(", ")}`);
	console.log("");

	const proofs: DealProof[] = [];

	for (const deal of DEALS) {
		console.log(`\n── ${deal.name} ──`);
		const proof = await proveOneDeal(deal);
		proofs.push(proof);

		for (const a of proof.assertion_results) {
			const icon = a.passed ? "  ✓" : "  ✗";
			console.log(`${icon} [${a.name}] ${a.detail}`);
		}
		console.log(`  → ${proof.status} (${(proof.elapsed_ms / 1000).toFixed(1)}s)`);
	}

	// Write report
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const reportPath = path.join(OUT_DIR, "proof-company-name.report.md");
	const jsonPath   = path.join(OUT_DIR, "proof-company-name.report.json");
	fs.writeFileSync(reportPath, renderReport(proofs), "utf8");
	fs.writeFileSync(jsonPath, JSON.stringify(proofs, null, 2), "utf8");
	console.log(`\nReport written to: ${reportPath}`);

	// Summary
	const proved  = proofs.filter((p) => p.status === "PROVED").length;
	const total   = proofs.length;
	const allGood = proved === total;

	console.log(`\n=== RESULT: ${proved}/${total} deals proved ===`);
	process.exit(allGood ? 0 : 1);
})();
