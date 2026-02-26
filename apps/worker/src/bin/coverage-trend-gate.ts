#!/usr/bin/env node
/**
 * bin/coverage-trend-gate.ts
 *
 * CI "trend gate" for the portfolio DPU coverage audit.
 *
 * Compares a current coverage-audit JSON against a committed baseline JSON
 * and fails (exit 1) if DETECTOR_GAP has increased — signalling a regression.
 *
 * Usage:
 *   pnpm --filter worker coverage-trend-gate -- \
 *     --baseline apps/worker/tmp/coverage_baseline.json \
 *     --current  <path-to-current-audit.json>
 *
 *   # Optionally gate a single named slot:
 *   pnpm --filter worker coverage-trend-gate -- \
 *     --baseline apps/worker/tmp/coverage_baseline.json \
 *     --current  <path-to-current-audit.json> \
 *     --slot     use_of_funds
 *
 * Options:
 *   --baseline <path>   Path to committed baseline coverage-audit JSON (required)
 *   --current  <path>   Path to freshly-generated coverage-audit JSON (required)
 *   --slot     <name>   One or more slot names to check individually.
 *                       May be repeated: --slot use_of_funds --slot market_claims
 *                       When omitted, ALL slots present in either report are checked.
 *
 * Exit codes:
 *   0  — current <= baseline for global total AND all gated slots (no regression)
 *   1  — current > baseline for global total OR any gated slot (regression detected)
 *
 * On failure the script prints:
 *   - per-slot baseline vs current table with deltas
 *   - top-3 regressing deals (deals with the most new DETECTOR_GAP appearances)
 */

import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────
// Types (minimal, matching CoverageAuditReport shape)
// ─────────────────────────────────────────────────────────────────────

export interface SlotBreakdown {
	slot: string;
	ok_match: number;
	stale_stored: number;
	regressed: number;
	detector_gap: number;
	true_absence: number;
}

export interface DealSlotResult {
	slot: string;
	classification: string;
	candidate_pages: Array<{ ref: string; triggeredKeywords: string[]; snippet: string }>;
}

export interface DealResult {
	deal_id: string;
	deal_label: string;
	slot_results: DealSlotResult[];
}

export interface CoverageReport {
	generated_at: string;
	portfolio_summary: {
		slot_breakdown: SlotBreakdown[];
	};
	deals: DealResult[];
}

// ─────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────

export interface ParsedArgs {
	baselinePath: string | null;
	currentPath: string | null;
	/** One or more slot names to gate. Empty = auto-detect all slots. */
	slots: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const result: ParsedArgs = { baselinePath: null, currentPath: null, slots: [] };
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--":         break;
			case "--baseline": result.baselinePath = args[++i] ?? null; break;
			case "--current":  result.currentPath  = args[++i] ?? null; break;
			case "--slot":     { const s = args[++i]; if (s) result.slots.push(s); break; }
			default:
				if (args[i]?.startsWith("--")) console.warn(`[trend-gate] Unknown option: ${args[i]}`);
		}
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function loadReport(filePath: string, label: string): CoverageReport {
	const abs = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);
	if (!fs.existsSync(abs)) {
		console.error(`[trend-gate] ERROR: ${label} file not found: ${abs}`);
		process.exit(1);
	}
	try {
		return JSON.parse(fs.readFileSync(abs, "utf-8")) as CoverageReport;
	} catch (e) {
		console.error(`[trend-gate] ERROR: Failed to parse ${label} JSON: ${abs}`);
		console.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	}
}

export function totalGap(report: CoverageReport): number {
	return report.portfolio_summary.slot_breakdown.reduce(
		(sum, s) => sum + s.detector_gap,
		0
	);
}

export function slotGap(report: CoverageReport, slot: string): number {
	return (
		report.portfolio_summary.slot_breakdown.find((s) => s.slot === slot)
			?.detector_gap ?? 0
	);
}

function topOffenders(
	report: CoverageReport,
	slot: string,
	limit = 10
): Array<{ deal: string; page: string; keywords: string[]; snippet: string }> {
	const out: Array<{ deal: string; page: string; keywords: string[]; snippet: string }> = [];
	for (const deal of report.deals) {
		for (const sr of deal.slot_results) {
			if (sr.slot !== slot || sr.classification !== "DETECTOR_GAP") continue;
			for (const cp of sr.candidate_pages) {
				out.push({
					deal: deal.deal_label,
					page: cp.ref,
					keywords: cp.triggeredKeywords,
					snippet: cp.snippet,
				});
				if (out.length >= limit) return out;
			}
		}
	}
	return out;
}

/**
 * Returns the union of all slot names present in either report's breakdown.
 */
export function allSlotNames(baseline: CoverageReport, current: CoverageReport): string[] {
	const names = new Set<string>();
	for (const s of baseline.portfolio_summary.slot_breakdown) names.add(s.slot);
	for (const s of current.portfolio_summary.slot_breakdown)  names.add(s.slot);
	return [...names].sort();
}

/**
 * Compares per-deal slot classifications between baseline and current.
 * A deal "regresses" for a slot when that slot is DETECTOR_GAP in the current
 * report but was NOT DETECTOR_GAP in the matched baseline deal (or was absent).
 * Returns top `limit` deals sorted descending by regression count.
 */
export function topRegressingDeals(
	baseline: CoverageReport,
	current: CoverageReport,
	limit = 3
): Array<{ label: string; regressions: number; slots: string[] }> {
	const baselineByDeal = new Map<string, DealResult>();
	for (const d of baseline.deals) baselineByDeal.set(d.deal_id, d);

	const dealRegressions: Array<{ label: string; regressions: number; slots: string[] }> = [];

	for (const curDeal of current.deals) {
		const baseDeal = baselineByDeal.get(curDeal.deal_id);
		const regressedSlots: string[] = [];

		for (const cur of curDeal.slot_results) {
			if (cur.classification !== "DETECTOR_GAP") continue;
			const baseSlot = baseDeal?.slot_results.find((s) => s.slot === cur.slot);
			if (!baseSlot || baseSlot.classification !== "DETECTOR_GAP") {
				// new regression: this slot wasn't a gap in baseline (or deal was new)
				regressedSlots.push(cur.slot);
			}
		}

		if (regressedSlots.length > 0) {
			dealRegressions.push({
				label:       curDeal.deal_label,
				regressions: regressedSlots.length,
				slots:       regressedSlots,
			});
		}
	}

	return dealRegressions
		.sort((a, b) => b.regressions - a.regressions || a.label.localeCompare(b.label))
		.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

/** Left-pad a number delta with a sign character. */
function fmtDelta(d: number): string {
	return (d >= 0 ? "+" : "") + String(d);
}

function main(): void {
	const args = parseArgs(process.argv);

	if (!args.baselinePath || !args.currentPath) {
		console.error(
			"[trend-gate] Usage: coverage-trend-gate -- --baseline <path> --current <path> [--slot <slot>]...\n" +
			"  When --slot is omitted, ALL slots in the report are checked automatically.\n" +
			"  Example (all slots):\n" +
			"    pnpm --filter worker coverage-trend-gate -- \\\n" +
			"      --baseline apps/worker/tmp/coverage_baseline.json \\\n" +
			"      --current  apps/worker/tmp/coverage-ci-<ts>.json\n" +
			"  Example (specific slots):\n" +
			"    pnpm --filter worker coverage-trend-gate -- \\\n" +
			"      --baseline apps/worker/tmp/coverage_baseline.json \\\n" +
			"      --current  apps/worker/tmp/coverage-ci-<ts>.json \\\n" +
			"      --slot use_of_funds --slot market_claims"
		);
		process.exit(1);
	}

	const baselineReport = loadReport(args.baselinePath, "baseline");
	const currentReport  = loadReport(args.currentPath,  "current");

	// Determine which slots to gate
	const targetSlots: string[] =
		args.slots.length > 0
			? args.slots
			: allSlotNames(baselineReport, currentReport);

	const baselineTotal = totalGap(baselineReport);
	const currentTotal  = totalGap(currentReport);
	const globalDelta   = currentTotal - baselineTotal;
	const globalRegressed = globalDelta > 0;

	console.log("=== Coverage Trend Gate ===");
	console.log(`Baseline : ${args.baselinePath}  (generated: ${baselineReport.generated_at})`);
	console.log(`Current  : ${args.currentPath}  (generated: ${currentReport.generated_at})`);
	console.log(`Checking : ${targetSlots.length > 0 ? targetSlots.join(", ") : "(all)"}`);
	console.log("");

	// ── Per-slot table ───────────────────────────────────────────────────────
	const COL = { metric: 21, base: 8, cur: 8, delta: 6, status: 9 };
	const line = (m: string, b: string, c: string, d: string, s: string) =>
		`│ ${m.padEnd(COL.metric)} │ ${b.padEnd(COL.base)} │ ${c.padEnd(COL.cur)} │ ${d.padEnd(COL.delta)} │ ${s.padEnd(COL.status)} │`;
	const rule = 
		`├${'─'.repeat(COL.metric + 2)}┼${'─'.repeat(COL.base + 2)}┼${'─'.repeat(COL.cur + 2)}┼${'─'.repeat(COL.delta + 2)}┼${'─'.repeat(COL.status + 2)}┤`;
	const top  =
		`┌${'─'.repeat(COL.metric + 2)}┬${'─'.repeat(COL.base + 2)}┬${'─'.repeat(COL.cur + 2)}┬${'─'.repeat(COL.delta + 2)}┬${'─'.repeat(COL.status + 2)}┐`;
	const bot  =
		`└${'─'.repeat(COL.metric + 2)}┴${'─'.repeat(COL.base + 2)}┴${'─'.repeat(COL.cur + 2)}┴${'─'.repeat(COL.delta + 2)}┴${'─'.repeat(COL.status + 2)}┘`;

	console.log(top);
	console.log(line("Metric", "Baseline", "Current", "Delta", "Status"));
	console.log(rule);
	console.log(line(
		"Total DETECTOR_GAP",
		String(baselineTotal), String(currentTotal),
		fmtDelta(globalDelta),
		globalRegressed ? "FAIL" : "OK"
	));

	// Track per-slot regressions
	const regressedSlotsList: string[] = [];
	for (const slot of targetSlots) {
		const bGap  = slotGap(baselineReport, slot);
		const cGap  = slotGap(currentReport,  slot);
		const delta = cGap - bGap;
		const fail  = delta > 0;
		if (fail) regressedSlotsList.push(slot);
		console.log(line(
			(`  ${slot}`).slice(0, COL.metric),
			String(bGap), String(cGap),
			fmtDelta(delta),
			fail ? "FAIL" : "OK"
		));
	}
	console.log(bot);

	const anyRegression = globalRegressed || regressedSlotsList.length > 0;

	if (!anyRegression) {
		console.log("");
		console.log("[trend-gate] PASS — no DETECTOR_GAP regression vs baseline.");
		if (globalDelta < 0) {
			console.log(`  Global improvement: baseline=${baselineTotal} current=${currentTotal} (${globalDelta})`);
		}
		for (const slot of targetSlots) {
			const delta = slotGap(currentReport, slot) - slotGap(baselineReport, slot);
			if (delta < 0) {
				console.log(`  Slot '${slot}' improvement: baseline=${slotGap(baselineReport, slot)} current=${slotGap(currentReport, slot)} (${delta})`);
			}
		}
		process.exit(0);
	}

	// ── Failure path ─────────────────────────────────────────────────────────
	console.error("");
	console.error("[trend-gate] FAIL — DETECTOR_GAP increased vs baseline.");
	if (globalRegressed) {
		console.error(`  Global total regression: baseline=${baselineTotal} current=${currentTotal} (+${globalDelta})`);
	}
	for (const slot of regressedSlotsList) {
		const bGap = slotGap(baselineReport, slot);
		const cGap = slotGap(currentReport,  slot);
		console.error(`  Slot '${slot}' regression: baseline=${bGap} current=${cGap} (+${cGap - bGap})`);
	}

	// ── Top offenders per regressed slot ────────────────────────────────────
	for (const slot of regressedSlotsList) {
		console.error("");
		console.error(`Top DETECTOR_GAP offenders for '${slot}':`);
		const offenders = topOffenders(currentReport, slot, 5);
		if (offenders.length === 0) {
			console.error("  (none)");
		} else {
			for (const o of offenders) {
				console.error(`  [${o.deal}] ${o.page}`);
				console.error(`    kw: [${o.keywords.slice(0, 5).join(", ")}]`);
				console.error(`    > ${o.snippet.slice(0, 120)}`);
			}
		}
	}

	// ── Top 3 regressing deals ───────────────────────────────────────────────
	console.error("");
	console.error("Top 3 regressing deals (new DETECTOR_GAP appearances vs baseline):");
	const regDeals = topRegressingDeals(baselineReport, currentReport, 3);
	if (regDeals.length === 0) {
		console.error("  (none — all DETECTOR_GAP slots were already present in baseline per deal)");
	} else {
		for (const d of regDeals) {
			console.error(`  [${d.label}] +${d.regressions} new gap(s) — slots: ${d.slots.join(", ")}`);
		}
	}

	process.exit(1);
}

// Guard so the script doesn't auto-run when imported as a module (e.g. in unit tests).
// In CJS (type: "commonjs") require.main === module is reliable.
if (require.main === module) {
	main();
}
