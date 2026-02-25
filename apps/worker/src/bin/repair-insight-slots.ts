#!/usr/bin/env node
/**
 * repair-insight-slots
 *
 * Offline repair tool: re-evaluates deterministic Stage-1 insight slots against
 * current DPU data and updates any stale investor_insight_reports rows.
 *
 * Usage:
 *   pnpm --filter worker repair:insight-slots [options]
 *
 *   --deal-list   <path>   JSON file with array of {deal_id, label?} objects
 *                          (same format as audit_deals.json)
 *   --deal-id     <uuid>   Repair a single deal (can be repeated)
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
import { repairInsightSlotsInReport, recomputeInsightSlotBody } from "../jobs/investor-insights/processor";

// ── Arg parsing ──────────────────────────────────────────────────────────────

interface RepairOptions {
	dealList: string | null;
	dealIds: string[];
	dryRun: boolean;
	concurrency: number;
}

function parseArgs(argv: string[]): RepairOptions {
	const opts: RepairOptions = { dealList: null, dealIds: [], dryRun: false, concurrency: 2 };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		switch (arg) {
			case "--deal-list":
				opts.dealList = argv[++i] ?? null;
				break;
			case "--deal-id":
				if (argv[i + 1]) opts.dealIds.push(argv[++i]!);
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
				console.warn(`[repair] Unknown option: ${arg}`);
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
		// Support both formats:
		//   { "deals": [{name, deal_id}, ...] }  (same as audit_deals.json / parseDealListFile format)
		//   [{deal_id, label?}, ...]              (bare array)
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
					const label = typeof e["name"] === "string" ? e["name"]
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

// ── Result summary types ─────────────────────────────────────────────────────

interface RepairResult {
	deal_id:  string;
	label:    string;
	outcome:  "updated" | "unchanged" | "skipped" | "error";
	oldSlots: string | null;
	newSlots: string | null;
	error:    string | null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	const deals = loadDealIds(opts);

	if (deals.length === 0) {
		console.error("[repair] No deals specified. Use --deal-list <path> or --deal-id <uuid>.");
		process.exit(1);
	}

	const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

	console.log(`[repair] ${opts.dryRun ? "DRY-RUN — " : ""}Processing ${deals.length} deal(s) with concurrency=${opts.concurrency}`);

	const results = await pooledMap(deals, opts.concurrency, async ({ deal_id, label }) => {
		const result: RepairResult = { deal_id, label, outcome: "error", oldSlots: null, newSlots: null, error: null };
		try {
			if (opts.dryRun) {
				// In dry-run: fetch existing body + recompute but don't write
				const newBody = await recomputeInsightSlotBody(pool, deal_id);
				// Fetch old body for comparison
				const { rows: existing } = await pool.query<{ render_package: unknown }>(
					`SELECT render_package FROM public.investor_insight_reports WHERE deal_id = $1 ORDER BY updated_at DESC LIMIT 1`,
					[deal_id]
				);
				const rp = (existing[0]?.render_package ?? {}) as { sections?: Array<{ key: string; body: string }> };
				const oldBody = rp.sections?.find((s) => s.key === "insight_slots")?.body ?? null;
				result.outcome = (existing.length === 0) ? "skipped"
				               : (oldBody === newBody)   ? "unchanged"
				               :                           "updated"; // would-update
				result.oldSlots = oldBody;
				result.newSlots = newBody;
			} else {
				const { updated, newBody, oldBody } = await repairInsightSlotsInReport(pool, deal_id);
				result.outcome  = updated ? (oldBody === newBody ? "unchanged" : "updated") : "skipped";
				result.oldSlots = oldBody;
				result.newSlots = newBody;
			}
		} catch (err) {
			result.outcome = "error";
			result.error   = err instanceof Error ? err.message : String(err);
		}
		return result;
	});

	await pool.end();

	// ── Print report ─────────────────────────────────────────────────────────────
	let updatedCount   = 0;
	let unchangedCount = 0;
	let skippedCount   = 0;
	let errorCount     = 0;

	for (const r of results) {
		const tag = r.outcome === "updated"   ? "UPDATED"
		          : r.outcome === "unchanged" ? "unchanged"
		          : r.outcome === "skipped"   ? "SKIPPED"
		          : "ERROR";
		const suffix = r.error ? ` — ${r.error}` : "";
		console.log(`  [${tag}] ${r.label} (${r.deal_id.slice(0, 8)})${suffix}`);
		if (r.outcome === "updated") {
			// Print changed lines
			const oldLines = (r.oldSlots ?? "").split("\n");
			const newLines = (r.newSlots ?? "").split("\n");
			for (let i = 0; i < newLines.length; i++) {
				const nl = newLines[i] ?? "";
				const ol = oldLines[i] ?? "";
				if (nl !== ol) {
					console.log(`          old: ${ol}`);
					console.log(`          new: ${nl}`);
				}
			}
		}
		if (r.outcome === "updated")   updatedCount++;
		if (r.outcome === "unchanged") unchangedCount++;
		if (r.outcome === "skipped")   skippedCount++;
		if (r.outcome === "error")     errorCount++;
	}

	console.log();
	console.log(`[repair] Done${opts.dryRun ? " (dry-run)" : ""}: updated=${updatedCount} unchanged=${unchangedCount} skipped=${skippedCount} errors=${errorCount}`);

	if (errorCount > 0) process.exit(1);
}

main().catch((err) => {
	console.error("[repair] Fatal:", err instanceof Error ? err.message : err);
	process.exit(1);
});
