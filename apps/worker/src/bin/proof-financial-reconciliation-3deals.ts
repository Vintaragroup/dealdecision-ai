#!/usr/bin/env node
/**
 * bin/proof-financial-reconciliation-3deals.ts
 *
 * Proof runner: verifies that the financial_reconciliation_v1 section is
 * rendered correctly for 3 canonical deals (WebMax, DealDecision, StackFactor).
 *
 * For each deal:
 *   1. POST /api/v1/deals/:id/investor-insights/regenerate
 *   2. Poll until render_package is updated
 *   3. Extract the financial_reconciliation_v1 section
 *   4. Parse flags and confidence_score from body text
 *   5. Assert key invariants:
 *      - section is present in render_package
 *      - confidence_score is a number in [0, 1]
 *      - all 4 flags appear in the section body
 *
 * Artifacts
 * ─────────
 *   apps/worker/tmp/financial-reconciliation-3deals.json
 *
 * CLI flags
 * ─────────
 *   --base-url          API base URL           (default: http://localhost:9001)
 *   --timeout-seconds   Per-deal poll timeout  (default: 180)
 *   --poll-interval-ms  Poll cadence           (default: 2000)
 *
 * Exit codes
 *   0 → all 3 deals proved
 *   1 → at least one deal failed, timed out, or had assertion errors
 */

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

// ─── Canonical deal registry ─────────────────────────────────────────────────

const DEALS = [
	{ name: "WebMax",       deal_id: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4" },
	{ name: "DealDecision", deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "StackFactor",  deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
] as const;

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
function argValue(flag: string): string | null {
	const idx = cliArgs.indexOf(flag);
	return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1]! : null;
}

const BASE_URL         = argValue("--base-url")         ?? "http://localhost:9001";
const TIMEOUT_MS       = parseInt(argValue("--timeout-seconds")  ?? "180", 10) * 1000;
const POLL_INTERVAL_MS = parseInt(argValue("--poll-interval-ms") ?? "2000", 10);
const OUT_DIR          = path.resolve(argValue("--out") ?? path.join(__dirname, "../../../tmp"));

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

interface FlagProof {
	status: "PASS" | "WARN" | "FAIL" | "SKIP" | "UNKNOWN";
	reason: string;
}

interface ReconciliationProof {
	deal_id:            string;
	deal_name:          string;
	status:             "PROVED" | "FAILED" | "TIMEOUT" | "ERROR";
	section_found:      boolean;
	confidence_score:   number | null;
	data_sources_used:  string[];
	flags: {
		revenue_vs_headcount_flag:  FlagProof;
		allocation_vs_growth_flag:  FlagProof;
		raise_vs_burn_flag:         FlagProof;
		margin_vs_infra_ratio_flag: FlagProof;
	};
	assertion_errors: string[];
	raw_section_body: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

async function fetchApi(url: string, opts: RequestInit = {}): Promise<Response> {
	// Attach clerk/JWT auth if env var present.
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(opts.headers as Record<string, string> | undefined),
	};
	const apiKey = process.env["INTERNAL_API_KEY"] ?? process.env["API_SECRET_KEY"] ?? "";
	if (apiKey) headers["x-api-key"] = apiKey;
	return fetch(url, { ...opts, headers });
}

/**
 * Fetch the current updated_at timestamp for a deal's investor insight report.
 */
async function getReportUpdatedAt(dealId: string): Promise<string | null> {
	if (!pool) return null;
	try {
		const { rows } = await pool.query<{ updated_at: string }>(
			`SELECT updated_at FROM investor_insight_reports WHERE deal_id = $1 ORDER BY updated_at DESC LIMIT 1`,
			[dealId]
		);
		return rows[0]?.updated_at ?? null;
	} catch {
		return null;
	}
}

/**
 * Post a regeneration request for a deal.
 */
async function triggerRegenerate(dealId: string): Promise<boolean> {
	try {
		const res = await fetchApi(`${BASE_URL}/api/v1/deals/${dealId}/investor-insights/regenerate`, {
			method: "POST",
		});
		return res.ok || res.status === 202;
	} catch (e) {
		console.error(`  [regenerate] error for ${dealId}:`, e);
		return false;
	}
}

/**
 * Fetch the current render_package for a deal's insight report.
 */
async function fetchRenderPackage(dealId: string): Promise<Record<string, unknown> | null> {
	try {
		const res = await fetchApi(`${BASE_URL}/api/v1/deals/${dealId}/investor-insights`);
		if (!res.ok) return null;
		const data = await res.json() as Record<string, unknown>;
		return data;
	} catch {
		return null;
	}
}

/**
 * Parse a flag status + reason from the body text of the reconciliation section.
 * Looks for lines matching: `[✓|⚠|✗|-] <flag_key>: STATUS — reason`
 */
function parseFlag(body: string, flagKey: string): FlagProof {
	const re = new RegExp(
		`[✓⚠✗\\-]\\s+${flagKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s+(PASS|WARN|FAIL|SKIP)[^\\n]*—([^\\n]*)`,
		"i"
	);
	const m = body.match(re);
	if (!m) return { status: "UNKNOWN", reason: "flag not found in section body" };
	return {
		status: m[1] as FlagProof["status"],
		reason: m[2]?.trim() ?? "",
	};
}

/**
 * Extract confidence_score from the section body.
 * Looks for: `confidence_score: 0.75`
 */
function parseConfidenceScore(body: string): number | null {
	const m = body.match(/confidence_score:\s*([\d.]+)/);
	return m ? parseFloat(m[1]!) : null;
}

/**
 * Extract data_sources_used from the section body.
 * Looks for: `data_sources: source1, source2`
 */
function parseDataSources(body: string): string[] {
	const m = body.match(/data_sources:\s*([^\n]+)/);
	if (!m || m[1]?.trim() === "none") return [];
	return m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── Per-deal proof runner ────────────────────────────────────────────────────

async function proveOneDeal(
	dealId: string,
	dealName: string,
	preUpdateAt: string | null
): Promise<ReconciliationProof> {
	const proof: ReconciliationProof = {
		deal_id:           dealId,
		deal_name:         dealName,
		status:            "ERROR",
		section_found:     false,
		confidence_score:  null,
		data_sources_used: [],
		flags: {
			revenue_vs_headcount_flag:  { status: "UNKNOWN", reason: "not evaluated" },
			allocation_vs_growth_flag:  { status: "UNKNOWN", reason: "not evaluated" },
			raise_vs_burn_flag:         { status: "UNKNOWN", reason: "not evaluated" },
			margin_vs_infra_ratio_flag: { status: "UNKNOWN", reason: "not evaluated" },
		},
		assertion_errors: [],
		raw_section_body: null,
	};

	// Trigger regeneration.
	console.log(`  [${dealName}] triggering regenerate...`);
	const triggered = await triggerRegenerate(dealId);
	if (!triggered) {
		proof.assertion_errors.push("Regeneration request failed");
		return proof;
	}

	// Poll until the report updates.
	const deadline = Date.now() + TIMEOUT_MS;
	let renderPkg: Record<string, unknown> | null = null;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const currentUpdatedAt = await getReportUpdatedAt(dealId);
		if (!pool || (currentUpdatedAt && currentUpdatedAt !== preUpdateAt)) {
			renderPkg = await fetchRenderPackage(dealId);
			if (renderPkg) break;
		}
		if (!pool) {
			// No DB — just poll the API for a fresh report.
			renderPkg = await fetchRenderPackage(dealId);
			if (renderPkg) break;
		}
	}

	if (!renderPkg) {
		proof.status = "TIMEOUT";
		proof.assertion_errors.push(`Timed out waiting for render_package (${TIMEOUT_MS / 1000}s)`);
		return proof;
	}

	// Find the financial_reconciliation_v1 section.
	const sections = (renderPkg["sections"] as Array<Record<string, unknown>> | undefined) ?? [];
	const recSection = sections.find((s) => s["key"] === "financial_reconciliation_v1");

	if (!recSection) {
		proof.assertion_errors.push("financial_reconciliation_v1 section not found in render_package.sections");
		proof.status = "FAILED";
		return proof;
	}

	proof.section_found    = true;
	proof.raw_section_body = typeof recSection["body"] === "string" ? recSection["body"] : null;

	if (!proof.raw_section_body) {
		proof.assertion_errors.push("financial_reconciliation_v1 section has no body");
		proof.status = "FAILED";
		return proof;
	}

	// Parse fields from the body text.
	proof.confidence_score  = parseConfidenceScore(proof.raw_section_body);
	proof.data_sources_used = parseDataSources(proof.raw_section_body);
	proof.flags.revenue_vs_headcount_flag  = parseFlag(proof.raw_section_body, "revenue_vs_headcount_flag");
	proof.flags.allocation_vs_growth_flag  = parseFlag(proof.raw_section_body, "allocation_vs_growth_flag");
	proof.flags.raise_vs_burn_flag         = parseFlag(proof.raw_section_body, "raise_vs_burn_flag");
	proof.flags.margin_vs_infra_ratio_flag = parseFlag(proof.raw_section_body, "margin_vs_infra_ratio_flag");

	// ─── Assertions ───────────────────────────────────────────────────────────

	// Section schema invariants.
	if (proof.confidence_score == null) {
		proof.assertion_errors.push("confidence_score not parseable from section body");
	} else if (proof.confidence_score < 0 || proof.confidence_score > 1) {
		proof.assertion_errors.push(`confidence_score ${proof.confidence_score} out of range [0, 1]`);
	}

	// All 4 flags must have a known status.
	for (const [flagKey, flagProof] of Object.entries(proof.flags)) {
		if (flagProof.status === "UNKNOWN") {
			proof.assertion_errors.push(`${flagKey} status is UNKNOWN — not found in section body`);
		}
	}

	// No FAIL flags allowed (WARN is acceptable; SKIP means insufficient data).
	for (const [flagKey, flagProof] of Object.entries(proof.flags)) {
		if (flagProof.status === "FAIL") {
			proof.assertion_errors.push(`${flagKey} emitted FAIL — review thresholds for this deal`);
		}
	}

	proof.status = proof.assertion_errors.length === 0 ? "PROVED" : "FAILED";
	return proof;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log(`\n═══ Financial Reconciliation Proof — 3 Canonical Deals ═══`);
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Timeout:  ${TIMEOUT_MS / 1000}s per deal`);
	console.log(`Out dir:  ${OUT_DIR}\n`);

	// Pre-fetch current updated_at for each deal.
	const preUpdateAts = await Promise.all(
		DEALS.map((d) => getReportUpdatedAt(d.deal_id))
	);

	const proofs: ReconciliationProof[] = [];

	for (let i = 0; i < DEALS.length; i++) {
		const deal = DEALS[i]!;
		console.log(`\n─── ${deal.name} (${deal.deal_id.slice(0, 8)}) ───`);
		const proof = await proveOneDeal(deal.deal_id, deal.name, preUpdateAts[i] ?? null);
		proofs.push(proof);

		const icon = proof.status === "PROVED" ? "✓" : "✗";
		console.log(`  ${icon} Status: ${proof.status}`);
		console.log(`  confidence_score: ${proof.confidence_score ?? "n/a"}`);
		console.log(`  data_sources: ${proof.data_sources_used.join(", ") || "none"}`);
		for (const [k, v] of Object.entries(proof.flags)) {
			console.log(`  ${k}: ${v.status}`);
		}
		if (proof.assertion_errors.length) {
			console.log(`  ⚠ Assertion errors:`);
			for (const e of proof.assertion_errors) {
				console.log(`    - ${e}`);
			}
		}
	}

	// ─── Write artifact ───────────────────────────────────────────────────────

	fs.mkdirSync(OUT_DIR, { recursive: true });
	const artifactPath = path.join(OUT_DIR, "financial-reconciliation-3deals.json");
	const artifact = {
		generated_at: new Date().toISOString(),
		base_url:     BASE_URL,
		deals:        proofs,
		summary: {
			total:  proofs.length,
			proved: proofs.filter((p) => p.status === "PROVED").length,
			failed: proofs.filter((p) => p.status === "FAILED").length,
			timed_out: proofs.filter((p) => p.status === "TIMEOUT").length,
			errored:   proofs.filter((p) => p.status === "ERROR").length,
		},
	};
	fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
	console.log(`\n✓ Artifact: ${artifactPath}`);

	// ─── Exit code ────────────────────────────────────────────────────────────

	const allProved = proofs.every((p) => p.status === "PROVED");
	console.log(`\n═══ Result: ${allProved ? "ALL PROVED ✓" : "FAILURES DETECTED ✗"} ═══\n`);

	if (pool) await pool.end();
	process.exit(allProved ? 0 : 1);
}

main().catch((err) => {
	console.error("Unexpected error:", err);
	process.exit(1);
});
