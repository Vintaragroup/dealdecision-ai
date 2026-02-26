#!/usr/bin/env node
/**
 * repair-gate-state
 *
 * Offline repair tool: re-evaluates all investor-insight gates for the given
 * deals and patches any stale investor_insight_reports.render_package.gate_state
 * rows in place.
 *
 * Primary use-case: reports that contain obsolete reason codes (e.g.
 * GATE_STRUCTURED_JSON_UNREADABLE) written by an older version of gates.ts.
 *
 * Usage:
 *   pnpm --filter worker repair:gate-state [options]
 *
 *   --deal-list   <path>   JSON file with array of {deal_id, label?} objects
 *                          (same format as audit_deals.json / tmp/audit_deals.json)
 *   --deal-id     <uuid>   Repair a single deal (can be repeated)
 *   --engine      <ver>    Engine version tag to pass to evaluateGates (default: "v1")
 *   --dry-run              Print what would change; do not write to DB
 *   --concurrency <n>      Parallel workers (default: 2)
 *   --help / -h            Print this help
 *
 * Exit codes:
 *   0  All repairs applied (or --dry-run with no errors)
 *   1  One or more deals had errors
 *
 * Required env vars (loaded via load-env.cjs preloader):
 *   DATABASE_URL
 */
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { repairGateStateInReport, evaluateGates } from "../jobs/investor-insights/gates";
import type { GateState } from "../contracts/investor-insights/schemas";

// ── Arg parsing ──────────────────────────────────────────────────────────────

interface RepairOptions {
	dealList: string | null;
	dealIds: string[];
	engineVersion: string;
	dryRun: boolean;
	concurrency: number;
}

function parseArgs(argv: string[]): RepairOptions {
	const opts: RepairOptions = { dealList: null, dealIds: [], engineVersion: "v1", dryRun: false, concurrency: 2 };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		switch (arg) {
			case "--deal-list":
				opts.dealList = argv[++i] ?? null;
				break;
			case "--deal-id":
				if (argv[i + 1]) opts.dealIds.push(argv[++i]!);
				break;
			case "--engine":
				opts.engineVersion = argv[++i] ?? "v1";
				break;
			case "--dry-run":
				opts.dryRun = true;
				break;
			case "--concurrency":
				opts.concurrency = Math.max(1, parseInt(argv[++i] ?? "2", 10) || 2);
				break;
			case "--help":
			case "-h":
			case "--":
				break;
			default:
				console.warn(`[repair-gate-state] Unknown option: ${arg}`);
		}
	}
	return opts;
}

// ── Deal list loading ────────────────────────────────────────────────────────

function loadDealIds(opts: RepairOptions): Array<{ deal_id: string; label: string }> {
	const out: Array<{ deal_id: string; label: string }> = [];

	if (opts.dealList) {
		const raw = fs.readFileSync(path.resolve(opts.dealList), "utf8");
		const parsed: unknown = JSON.parse(raw);
		let arr: unknown[] = [];
		if (Array.isArray(parsed)) {
			arr = parsed;
		} else if (parsed !== null && typeof parsed === "object") {
			const obj = parsed as Record<string, unknown>;
			if (Array.isArray(obj["deals"])) {
				arr = obj["deals"] as unknown[];
			}
		}
		for (const entry of arr) {
			if (typeof entry === "object" && entry !== null) {
				const e = entry as Record<string, unknown>;
				const id = typeof e["deal_id"] === "string" ? e["deal_id"] : null;
				if (id) {
					const label =
						typeof e["name"] === "string" ? e["name"]
						: typeof e["label"] === "string" ? e["label"]
						: id.slice(0, 8);
					out.push({ deal_id: id, label });
				}
			}
		}
	}

	for (const id of opts.dealIds) {
		out.push({ deal_id: id, label: id.slice(0, 8) });
	}

	return out;
}

// ── Concurrency helper ───────────────────────────────────────────────────────

async function pooledMap<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let idx = 0;
	async function worker() {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await fn(items[i]!);
		}
	}
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
	await Promise.all(workers);
	return results;
}

// ── Result types ─────────────────────────────────────────────────────────────

interface RepairResult {
	deal_id: string;
	label: string;
	outcome: "updated" | "skipped" | "error";
	oldGateState: GateState | null;
	newGateState: GateState | null;
	error: string | null;
}

function summarizeGateState(gs: GateState | null): string {
	if (!gs) return "(none)";
	const failing = gs.results.filter((r) => !r.passed);
	if (gs.all_passed) return `all_passed=true (${gs.results.length} gates)`;
	return `all_passed=false, failing: ${failing.map((r) => `${r.gate}${r.reason_code ? `[${r.reason_code}]` : ""}`).join(", ")}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	const deals = loadDealIds(opts);

	if (deals.length === 0) {
		console.error(
			"[repair-gate-state] No deals specified. Use --deal-list <path> or --deal-id <uuid>."
		);
		process.exit(1);
	}

	const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

	console.log(
		`[repair-gate-state] ${opts.dryRun ? "DRY-RUN — " : ""}Processing ${deals.length} deal(s) with concurrency=${opts.concurrency}, engine=${opts.engineVersion}`
	);

	const results = await pooledMap(deals, opts.concurrency, async ({ deal_id, label }) => {
		const result: RepairResult = {
			deal_id,
			label,
			outcome: "error",
			oldGateState: null,
			newGateState: null,
			error: null,
		};
		try {
			if (opts.dryRun) {
				// In dry-run: compute new gate_state and fetch old, but don't write
				const newGateState = await evaluateGates(pool, { dealId: deal_id, engineVersion: opts.engineVersion });
				const { rows: existing } = await pool.query<{ render_package: unknown }>(
					`SELECT render_package FROM public.investor_insight_reports WHERE deal_id = $1 ORDER BY updated_at DESC LIMIT 1`,
					[deal_id]
				);
				if (existing.length === 0) {
					result.outcome = "skipped";
					result.newGateState = newGateState;
				} else {
					const rp = (existing[0]?.render_package ?? {}) as Record<string, unknown>;
					const oldGateState = (rp["gate_state"] as GateState | null | undefined) ?? null;
					result.outcome = "updated"; // would-update
					result.oldGateState = oldGateState;
					result.newGateState = newGateState;
				}
			} else {
				const { updated, newGateState, oldGateState } = await repairGateStateInReport(
					pool,
					deal_id,
					opts.engineVersion
				);
				result.outcome = updated ? "updated" : "skipped";
				result.oldGateState = oldGateState;
				result.newGateState = newGateState;
			}
		} catch (err) {
			result.outcome = "error";
			result.error = err instanceof Error ? err.message : String(err);
		}
		return result;
	});

	await pool.end();

	// ── Print report ─────────────────────────────────────────────────────────────
	let updatedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;

	for (const r of results) {
		const tag =
			r.outcome === "updated" ? "UPDATED"
			: r.outcome === "skipped" ? "SKIPPED"
			: "ERROR";
		const suffix = r.error ? ` — ${r.error}` : "";
		console.log(`  [${tag}] ${r.label} (${r.deal_id.slice(0, 8)})${suffix}`);
		if (r.outcome === "updated") {
			const oldSummary = summarizeGateState(r.oldGateState);
			const newSummary = summarizeGateState(r.newGateState);
			if (oldSummary !== newSummary) {
				console.log(`          old: ${oldSummary}`);
				console.log(`          new: ${newSummary}`);
			} else {
				console.log(`          (no gate state change)`);
			}
		}
		if (r.outcome === "updated") updatedCount++;
		if (r.outcome === "skipped") skippedCount++;
		if (r.outcome === "error") errorCount++;
	}

	console.log();
	console.log(
		`[repair-gate-state] Done${opts.dryRun ? " (dry-run)" : ""}: updated=${updatedCount} skipped=${skippedCount} errors=${errorCount}`
	);

	if (errorCount > 0) process.exit(1);
}

main().catch((err) => {
	console.error("[repair-gate-state] Fatal:", err instanceof Error ? err.message : err);
	process.exit(1);
});
