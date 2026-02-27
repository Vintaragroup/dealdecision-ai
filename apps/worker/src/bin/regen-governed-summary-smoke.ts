#!/usr/bin/env node
/**
 * bin/regen-governed-summary-smoke.ts
 *
 * Dev-only smoke helper: inspect the persisted governed_summary_v1 record for
 * one or more deals and verify fingerprint/cache-source behaviour.
 *
 * Usage (read DB record for a deal):
 *   pnpm --filter worker governed-summary-smoke -- \
 *     --deal-id <uuid> [--deal-id <uuid> ...] \
 *     [--base http://localhost:9001] \
 *     [--trigger]        # also POST /admin/deals/:id/regen before reading
 *
 * What it shows per deal:
 *   - fingerprint (sha-256 of canonical input corpus)
 *   - source  ("generated" | "cached")
 *   - model
 *   - created_at
 *   - validation_ok
 *   - unknown_tokens (if any)
 *   - executive_summary (first 120 chars)
 *
 * Exit code 0 = at least one deal has a governed_summary_v1 record.
 * Exit code 1 = no records found (or all fetches failed).
 */

const args = process.argv.slice(2);

function argValues(flag: string): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === flag) result.push(args[i + 1]!);
	}
	return result;
}
function argFlag(flag: string): boolean {
	return args.includes(flag);
}
function argValue(flag: string): string | null {
	const idx = args.indexOf(flag);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : null;
}

const BASE_URL  = argValue("--base") ?? "http://localhost:9001";
const DEAL_IDS  = argValues("--deal-id");
const TRIGGER   = argFlag("--trigger");
const POLL_WAIT = parseInt(argValue("--wait-ms") ?? "6000", 10);

if (DEAL_IDS.length === 0) {
	console.error(
		"[governed-summary-smoke] ERROR: provide at least one --deal-id <uuid>"
	);
	process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
	return res.json();
}

async function triggerRegen(dealId: string): Promise<void> {
	const url = `${BASE_URL}/admin/deals/${dealId}/regen`;
	const res = await fetch(url, { method: "POST" });
	if (!res.ok) {
		console.warn(`  [trigger] WARN: POST ${url} → ${res.status} ${res.statusText}`);
	} else {
		console.log(`  [trigger] OK → ${res.status}`);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

interface GovernedSummaryRecord {
	schema_version: string;
	fingerprint: string;
	model: string;
	created_at: string;
	validation_ok: boolean;
	unknown_tokens: string[];
	summary: {
		executive_summary?: string;
		strengths?: string[];
		risks?: string[];
		open_questions?: string[];
		validated?: boolean;
	};
	source: "generated" | "cached";
}

interface ReportRow {
	governed_summary_v1?: GovernedSummaryRecord | null;
}

async function fetchRecord(dealId: string): Promise<GovernedSummaryRecord | null> {
	// Hit the debug/inspection API endpoint that returns the latest report
	const url = `${BASE_URL}/admin/deals/${dealId}/investor-insights/latest`;
	try {
		const data = fetchJSON(url) as Promise<{ report_payload?: ReportRow }>;
		const json = await data;
		const record = (json as { report_payload?: ReportRow })?.report_payload?.governed_summary_v1;
		return record ?? null;
	} catch (err) {
		console.warn(`  [fetch] WARN: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

function printRecord(dealId: string, record: GovernedSummaryRecord | null): void {
	if (!record) {
		console.log(`  [result] NO governed_summary_v1 persisted for ${dealId.slice(0, 8)}`);
		return;
	}
	const summary = record.summary?.executive_summary ?? "(empty)";
	console.log(
		JSON.stringify(
			{
				deal_id: dealId.slice(0, 8) + "…",
				schema_version: record.schema_version,
				source: record.source,
				fingerprint: record.fingerprint.slice(0, 16) + "…",
				model: record.model,
				created_at: record.created_at,
				validation_ok: record.validation_ok,
				unknown_tokens: record.unknown_tokens,
				executive_summary_preview: summary.slice(0, 120) + (summary.length > 120 ? "…" : ""),
				strength_count: record.summary?.strengths?.length ?? 0,
				risk_count: record.summary?.risks?.length ?? 0,
			},
			null,
			2
		)
	);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
	let anyFound = false;

	for (const dealId of DEAL_IDS) {
		console.log(`\n=== Deal ${dealId.slice(0, 8)}… ===`);

		if (TRIGGER) {
			console.log("  [trigger] Triggering regen…");
			await triggerRegen(dealId);
			console.log(`  [trigger] Waiting ${POLL_WAIT}ms for worker to process…`);
			await sleep(POLL_WAIT);
		}

		const record = await fetchRecord(dealId);
		printRecord(dealId, record);

		if (record) anyFound = true;
	}

	if (TRIGGER && DEAL_IDS.length === 1) {
		// Second run — should show source="cached" if inputs unchanged
		const dealId = DEAL_IDS[0]!;
		console.log(`\n=== [round 2] Triggering regen again to verify cache hit ===`);
		await triggerRegen(dealId);
		console.log(`  [trigger] Waiting ${POLL_WAIT}ms for worker to process…`);
		await sleep(POLL_WAIT);

		const record2 = await fetchRecord(dealId);
		console.log("\n  [round-2 result]");
		printRecord(dealId, record2);

		if (record2?.source === "cached") {
			console.log("\n  ✓ Cache hit confirmed — LLM was NOT called on second run.");
		} else if (record2?.source === "generated") {
			console.log("\n  ✗ Cache miss — LLM was called again (unexpected if inputs unchanged).");
		}
	}

	process.exit(anyFound ? 0 : 1);
})();
