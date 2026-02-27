#!/usr/bin/env node
/**
 * bin/verify-governed-summary-cache.ts
 *
 * Phase J E2E verification: proves the governed summary cache works end-to-end
 * by triggering two regenerations and comparing the resulting GovernedSummaryRecord.
 *
 * Usage:
 *   pnpm --filter worker verify:governed-summary-cache -- \
 *     --deal-id <uuid> [--deal-id <uuid> ...] \
 *     [--base http://localhost:9001] \
 *     [--poll-ms 2000] \
 *     [--timeout-ms 90000]
 *
 * Default deals (Deal Decision, WebMax, StackFactor):
 *   No --deal-id required; defaults are used.
 *
 * How it works:
 *   Round 1: POST /regenerate → poll until updated_at changes → read report_payload from DB
 *   Round 2: POST /regenerate → poll until updated_at changes → read report_payload from DB
 *   Compare:  fingerprint, created_at, source
 *
 * Expected result:
 *   Round 1: source="generated"
 *   Round 2: source="cached", fingerprint unchanged, created_at unchanged
 *
 * Print:
 *   CACHE HIT  ✅  for each deal where round 2 is cached
 *   CACHE MISS ❌  for each deal where round 2 unexpectedly regenerated
 *
 * Exit code 0 = all deals show cache hit on round 2.
 * Exit code 1 = at least one deal shows unexpected cache miss or an error.
 */

import { getPool, closePool } from "../lib/db";

const args = process.argv.slice(2);

function argValues(flag: string): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === flag) result.push(args[i + 1]!);
	}
	return result;
}
function argValue(flag: string): string | null {
	const idx = args.indexOf(flag);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : null;
}

const BASE_URL  = argValue("--base") ?? "http://localhost:9001";
const POLL_MS   = parseInt(argValue("--poll-ms") ?? "2000", 10);
const TIMEOUT   = parseInt(argValue("--timeout-ms") ?? "90000", 10);

// Default deals: Deal Decision, WebMax, StackFactor
const DEFAULT_DEALS = [
	{ name: "Deal Decision", deal_id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
	{ name: "StackFactor",   deal_id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
];

const cliIds = argValues("--deal-id");
const deals = cliIds.length > 0
	? cliIds.map((id) => ({ name: id.slice(0, 8) + "…", deal_id: id }))
	: DEFAULT_DEALS;

// ─── Types ────────────────────────────────────────────────────────────────────

interface GovernedSummaryRecord {
	schema_version: string;
	fingerprint: string;
	model: string;
	created_at: string;
	validation_ok: boolean;
	unknown_tokens: string[];
	summary: { executive_summary?: string };
	source: "generated" | "cached";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
	const url = `${BASE_URL}${path}`;
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
	return res.json();
}

async function triggerRegen(dealId: string): Promise<void> {
	await apiFetch(`/api/v1/deals/${dealId}/investor-insights/regenerate`, { method: "POST" });
}

async function pollUntilUpdated(dealId: string, previousUpdatedAt: string | null): Promise<string> {
	const deadline = Date.now() + TIMEOUT;
	while (Date.now() < deadline) {
		await sleep(POLL_MS);
		const data = await apiFetch(`/api/v1/deals/${dealId}/investor-insights`) as { updated_at?: string; status?: string };
		const updated = data.updated_at ?? null;
		if (updated && updated !== previousUpdatedAt) {
			return updated;
		}
	}
	throw new Error(`Timed out waiting for deal ${dealId} to update after ${TIMEOUT}ms`);
}

/**
 * Read report_payload.governed_summary_v1 directly from the DB.
 * The public GET endpoint intentionally omits report_payload.
 */
async function readGovernedSummaryFromDb(
	pool: Awaited<ReturnType<typeof getPool>>,
	dealId: string
): Promise<GovernedSummaryRecord | null> {
	const { rows } = await pool.query<{ report_payload: unknown }>(
		`SELECT report_payload
		   FROM public.investor_insight_reports
		  WHERE deal_id = $1::uuid
		    AND report_payload != '{}'::jsonb
		  ORDER BY updated_at DESC
		  LIMIT 1`,
		[dealId]
	);
	const payload = rows[0]?.report_payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
	const p = payload as Record<string, unknown>;
	const gsv1 = p["governed_summary_v1"];
	if (!gsv1 || typeof gsv1 !== "object" || Array.isArray(gsv1)) return null;
	const r = gsv1 as GovernedSummaryRecord;
	if (!r.fingerprint || !r.schema_version) return null;
	return r;
}

function getCurrentUpdatedAt(dealId: string): Promise<string | null> {
	return apiFetch(`/api/v1/deals/${dealId}/investor-insights`)
		.then((d) => (d as { updated_at?: string }).updated_at ?? null)
		.catch(() => null);
}

// ─── Per-deal verification ────────────────────────────────────────────────────

type DealVerifyResult =
	| { deal: string; status: "CACHE_HIT"; r1: GovernedSummaryRecord; r2: GovernedSummaryRecord }
	| { deal: string; status: "CACHE_MISS"; r1: GovernedSummaryRecord; r2: GovernedSummaryRecord }
	| { deal: string; status: "NO_RECORD"; round: 1 | 2 }
	| { deal: string; status: "ERROR"; error: string };

async function verifyDeal(
	pool: Awaited<ReturnType<typeof getPool>>,
	dealId: string,
	dealName: string
): Promise<DealVerifyResult> {
	console.log(`\n── ${dealName} (${dealId.slice(0, 8)}…) ─────────────────────────`);

	try {
		// ── Round 1 ───────────────────────────────────────────────────────────
		console.log("  [round 1] Triggering regeneration…");
		const before1 = await getCurrentUpdatedAt(dealId);
		await triggerRegen(dealId);
		const after1 = await pollUntilUpdated(dealId, before1);
		console.log(`  [round 1] Report updated at ${after1}`);

		const r1 = await readGovernedSummaryFromDb(pool, dealId);
		if (!r1) {
			console.log("  [round 1] ⚠  No governed_summary_v1 record in report_payload.");
			return { deal: dealName, status: "NO_RECORD", round: 1 };
		}

		console.log(
			JSON.stringify({
				round: 1,
				source: r1.source,
				fingerprint: r1.fingerprint.slice(0, 16) + "…",
				created_at: r1.created_at,
				validation_ok: r1.validation_ok,
				executive_summary_preview: (r1.summary?.executive_summary ?? "").slice(0, 80),
			}, null, 2)
		);

		// ── Round 2 ───────────────────────────────────────────────────────────
		console.log("  [round 2] Triggering regeneration again (expecting cache hit)…");
		await triggerRegen(dealId);
		const after2 = await pollUntilUpdated(dealId, after1);
		console.log(`  [round 2] Report updated at ${after2}`);

		const r2 = await readGovernedSummaryFromDb(pool, dealId);
		if (!r2) {
			console.log("  [round 2] ⚠  No governed_summary_v1 record in report_payload.");
			return { deal: dealName, status: "NO_RECORD", round: 2 };
		}

		console.log(
			JSON.stringify({
				round: 2,
				source: r2.source,
				fingerprint: r2.fingerprint.slice(0, 16) + "…",
				created_at: r2.created_at,
				validation_ok: r2.validation_ok,
			}, null, 2)
		);

		const isHit =
			r2.source === "cached" &&
			r2.fingerprint === r1.fingerprint &&
			r2.created_at === r1.created_at;

		return { deal: dealName, status: isHit ? "CACHE_HIT" : "CACHE_MISS", r1, r2 };
	} catch (err) {
		return { deal: dealName, status: "ERROR", error: err instanceof Error ? err.message : String(err) };
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
	const pool = await getPool();
	const results: DealVerifyResult[] = [];

	for (const { name, deal_id } of deals) {
		const result = await verifyDeal(pool, deal_id, name);
		results.push(result);
	}

	await closePool();

	// ── Summary ───────────────────────────────────────────────────────────────
	console.log("\n══════════════════════════════════════════════════════");
	console.log(" Governed Summary Cache — Phase J E2E Verification");
	console.log("══════════════════════════════════════════════════════");

	let allHit = true;

	for (const r of results) {
		if (r.status === "CACHE_HIT") {
			console.log(`  CACHE HIT  ✅  ${r.deal}`);
			console.log(`    fingerprint  : ${r.r1.fingerprint.slice(0, 32)}…`);
			console.log(`    created_at   : ${r.r1.created_at} (unchanged)`);
		} else if (r.status === "CACHE_MISS") {
			console.log(`  CACHE MISS ❌  ${r.deal}`);
			console.log(`    round 1 source: ${r.r1.source}  fp: ${r.r1.fingerprint.slice(0, 16)}…`);
			console.log(`    round 2 source: ${r.r2.source}  fp: ${r.r2.fingerprint.slice(0, 16)}…`);
			allHit = false;
		} else if (r.status === "NO_RECORD") {
			console.log(`  NO RECORD  ⚠   ${r.deal}  (round ${r.round} had no governed_summary_v1)`);
			allHit = false;
		} else {
			console.log(`  ERROR      ❌  ${r.deal}: ${r.error}`);
			allHit = false;
		}
	}

	console.log("══════════════════════════════════════════════════════\n");

	process.exit(allHit ? 0 : 1);
})();
