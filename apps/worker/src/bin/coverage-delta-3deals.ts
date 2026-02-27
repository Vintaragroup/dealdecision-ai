#!/usr/bin/env node
/**
 * bin/coverage-delta-3deals.ts
 *
 * Compares a coverage baseline against a new coverage report for a specific
 * set of deals, and prints a before/after delta summary.
 *
 * Usage:
 *   pnpm --filter worker coverage:delta:3deals [options]
 *
 * Options:
 *   --baseline <path>    Coverage baseline JSON (default: tmp/coverage_baseline.json)
 *   --current  <path>    New coverage report JSON (default: tmp/coverage-3deals.json)
 *   --deal-list <path>   JSON {deals:[{name,deal_id}]} to restrict to specific deals
 *                        (default: tmp/audit_3deals.json)
 *   --out <path>         Output markdown file (default: tmp/coverage-3deals-delta.md)
 */

import * as fs from "fs";
import * as path from "path";

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag: string): string | null {
	const idx = args.indexOf(flag);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : null;
}

const workerRoot    = path.resolve(__dirname, "../../");
const BASELINE_PATH = argValue("--baseline") ?? path.join(workerRoot, "tmp", "coverage_baseline.json");
const CURRENT_PATH  = argValue("--current")  ?? path.join(workerRoot, "tmp", "coverage-3deals.json");
const DEAL_LIST     = argValue("--deal-list") ?? path.join(workerRoot, "tmp", "audit_3deals.json");
const OUT_PATH      = argValue("--out")       ?? path.join(workerRoot, "tmp", "coverage-3deals-delta.md");

// ─── Types (mirroring CoverageAuditReport shape) ─────────────────────────────

interface SlotCoverageResult {
	slot:               string;
	stored_status:      string;
	recomputed_status:  string;
	classification:     string;
}

interface DealCoverageResult {
	deal_id:    string;
	deal_label: string;
	slot_results: SlotCoverageResult[];
	summary: {
		ok_match:            number;
		stale_stored:        number;
		regressed:           number;
		detector_gap:        number;
		true_absence:        number;
		dpu_load_failed:     number;
		evidence_ref_missing:number;
	};
}

interface SlotBreakdown {
	slot:          string;
	ok_match:      number;
	stale_stored:  number;
	regressed:     number;
	detector_gap:  number;
	true_absence:  number;
}

interface CoverageReport {
	generated_at:       string;
	deals:              DealCoverageResult[];
	portfolio_summary?: {
		total_deals:     number;
		slot_breakdown:  SlotBreakdown[];
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadReport(filePath: string): CoverageReport {
	if (!fs.existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`);
	}
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CoverageReport;
}

interface DealEntry { name: string; deal_id: string }

function loadDealList(filePath: string): DealEntry[] {
	if (!fs.existsSync(filePath)) {
		throw new Error(`Deal list not found: ${filePath}`);
	}
	const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { deals: DealEntry[] };
	return raw.deals;
}

const SLOT_NAMES = ["raise_terms", "market_claims", "traction_signal", "valuation_terms", "use_of_funds"];

type SlotCountMap = Record<string, Record<string, number>>;

function buildSlotCountMap(report: CoverageReport, targetIds: Set<string>): SlotCountMap {
	// { slot: { ok_match, regressed, detector_gap, stale_stored, true_absence, dpu_load_failed } }
	const map: SlotCountMap = {};
	for (const slotName of SLOT_NAMES) {
		map[slotName] = { ok_match: 0, regressed: 0, detector_gap: 0, stale_stored: 0, true_absence: 0, dpu_load_failed: 0 };
	}
	for (const deal of report.deals) {
		if (!targetIds.has(deal.deal_id)) continue;
		for (const sr of deal.slot_results) {
			if (!map[sr.slot]) continue;
			const cls = sr.classification.toLowerCase();
			if (cls === "ok_match")            map[sr.slot]!["ok_match"]!++;
			else if (cls === "regressed")      map[sr.slot]!["regressed"]!++;
			else if (cls === "detector_gap")   map[sr.slot]!["detector_gap"]!++;
			else if (cls === "stale_stored")   map[sr.slot]!["stale_stored"]!++;
			else if (cls === "true_absence")   map[sr.slot]!["true_absence"]!++;
			else if (cls === "dpu_load_failed") map[sr.slot]!["dpu_load_failed"]!++;
		}
	}
	return map;
}

function sumField(map: SlotCountMap, field: string): number {
	return SLOT_NAMES.reduce((acc, slot) => acc + (map[slot]?.[field] ?? 0), 0);
}

// ─── Markdown builder ─────────────────────────────────────────────────────────

function buildMarkdown(params: {
	baseline:    CoverageReport;
	current:     CoverageReport;
	dealList:    DealEntry[];
	baselineMap: SlotCountMap;
	currentMap:  SlotCountMap;
	targetIds:   Set<string>;
}): string {
	const { baseline, current, dealList, baselineMap, currentMap, targetIds } = params;
	const lines: string[] = [];

	lines.push("# Coverage Audit Delta — 3 Deals");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push(`Baseline:  ${BASELINE_PATH} (${baseline.generated_at})`);
	lines.push(`Current:   ${CURRENT_PATH}  (${current.generated_at})`);
	lines.push("");
	lines.push("**Deals compared:**");
	for (const d of dealList) {
		lines.push(`  - ${d.name} (\`${d.deal_id}\`)`);
	}
	lines.push("");
	lines.push("---");
	lines.push("");

	// ── Overall totals ──────────────────────────────────────────────────────
	const baseGap  = sumField(baselineMap, "detector_gap");
	const curGap   = sumField(currentMap,  "detector_gap");
	const baseReg  = sumField(baselineMap, "regressed");
	const curReg   = sumField(currentMap,  "regressed");
	const baseOk   = sumField(baselineMap, "ok_match");
	const curOk    = sumField(currentMap,  "ok_match");

	const gapDelta = curGap  - baseGap;
	const regDelta = curReg  - baseReg;
	const okDelta  = curOk   - baseOk;

	lines.push("## Portfolio Totals (3 Deals)");
	lines.push("");
	lines.push(`| Metric | Baseline | Current | Delta |`);
	lines.push(`|--------|----------|---------|-------|`);
	lines.push(`| Total DETECTOR_GAP | ${baseGap} | ${curGap} | ${gapDelta >= 0 ? "+" : ""}${gapDelta} |`);
	lines.push(`| Total REGRESSED    | ${baseReg} | ${curReg} | ${regDelta >= 0 ? "+" : ""}${regDelta} |`);
	lines.push(`| Total OK_MATCH     | ${baseOk}  | ${curOk}  | ${okDelta  >= 0 ? "+" : ""}${okDelta}  |`);
	lines.push("");

	if (regDelta > 0) {
		lines.push("> ⚠️ **WARNING: New regressions detected!**");
		lines.push("");
	} else if (regDelta <= 0 && curReg === 0) {
		lines.push("> ✅ No regressions.");
		lines.push("");
	}

	if (gapDelta < 0) {
		lines.push(`> ✅ DETECTOR_GAP improved by ${Math.abs(gapDelta)}.`);
		lines.push("");
	} else if (gapDelta === 0) {
		lines.push("> — DETECTOR_GAP unchanged.");
		lines.push("");
	}

	// ── Slot breakdown ──────────────────────────────────────────────────────
	lines.push("## Slot Breakdown");
	lines.push("");
	lines.push("| Slot | Gap Before | Gap After | Gap Δ | Reg Before | Reg After |");
	lines.push("|------|-----------|-----------|-------|------------|-----------|");
	for (const slot of SLOT_NAMES) {
		const bGap = baselineMap[slot]?.["detector_gap"] ?? 0;
		const cGap = currentMap[slot]?.["detector_gap"]  ?? 0;
		const bReg = baselineMap[slot]?.["regressed"]     ?? 0;
		const cReg = currentMap[slot]?.["regressed"]      ?? 0;
		const delta = cGap - bGap;
		const deltaStr = delta === 0 ? "—" : (delta > 0 ? `+${delta} ⚠️` : `${delta} ✅`);
		lines.push(`| ${slot} | ${bGap} | ${cGap} | ${deltaStr} | ${bReg} | ${cReg} |`);
	}
	lines.push("");

	// ── Per-deal detail ─────────────────────────────────────────────────────
	lines.push("## Per-Deal Detail");
	lines.push("");

	// Build per-deal lookup from both reports
	const baselineByDeal = new Map(baseline.deals.map((d) => [d.deal_id, d]));
	const currentByDeal  = new Map(current.deals.map((d)  => [d.deal_id, d]));

	for (const d of dealList) {
		if (!targetIds.has(d.deal_id)) continue;
		const bDeal = baselineByDeal.get(d.deal_id);
		const cDeal = currentByDeal.get(d.deal_id);

		lines.push(`### ${d.name} (\`${d.deal_id}\`)`);
		lines.push("");

		if (!bDeal && !cDeal) {
			lines.push("_No data in either report_");
			lines.push("");
			continue;
		}

		const makeSlotMap = (deal: DealCoverageResult | undefined) => {
			const m: Record<string, string> = {};
			for (const sr of deal?.slot_results ?? []) m[sr.slot] = sr.classification;
			return m;
		};

		const bSlots = makeSlotMap(bDeal);
		const cSlots = makeSlotMap(cDeal);

		lines.push("| Slot | Before | After | Changed? |");
		lines.push("|------|--------|-------|----------|");
		for (const slot of SLOT_NAMES) {
			const bCls = bSlots[slot] ?? "—";
			const cCls = cSlots[slot] ?? "—";
			const icon = bCls === cCls ? "" : (cCls === "OK_MATCH" ? " ✅" : (cCls === "REGRESSED" ? " ⚠️" : " ♻️"));
			lines.push(`| ${slot} | ${bCls} | ${cCls} |${icon} |`);
		}
		lines.push("");
	}

	// ── New regressions detail ───────────────────────────────────────────────
	if (regDelta > 0) {
		lines.push("## New Regressions");
		lines.push("");
		for (const d of dealList) {
			const bDeal = baselineByDeal.get(d.deal_id);
			const cDeal = currentByDeal.get(d.deal_id);
			if (!bDeal || !cDeal) continue;
			const bSlots = new Map(bDeal.slot_results.map((s) => [s.slot, s.classification]));
			const cSlots = new Map(cDeal.slot_results.map((s) => [s.slot, s.classification]));
			for (const slot of SLOT_NAMES) {
				const bCls = bSlots.get(slot);
				const cCls = cSlots.get(slot);
				if (bCls !== "REGRESSED" && cCls === "REGRESSED") {
					lines.push(`- **${d.name}** — \`${slot}\`: was ${bCls ?? "—"}, now REGRESSED ⚠️`);
				}
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
	console.log("[coverage-delta] Loading reports...");

	let baseline: CoverageReport;
	let current:  CoverageReport;

	try {
		baseline = loadReport(BASELINE_PATH);
	} catch (err) {
		console.error(`[coverage-delta] Cannot load baseline: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	try {
		current = loadReport(CURRENT_PATH);
	} catch (err) {
		console.error(`[coverage-delta] Cannot load current report: ${err instanceof Error ? err.message : String(err)}`);
		console.error(`  Run the coverage audit first: pnpm --filter worker audit:investor-insights:coverage -- --deal-list apps/worker/tmp/audit_3deals.json --out apps/worker/tmp/coverage-3deals`);
		process.exit(1);
	}

	let dealList: DealEntry[];
	try {
		dealList = loadDealList(DEAL_LIST);
	} catch (err) {
		console.error(`[coverage-delta] Cannot load deal list: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	const targetIds = new Set(dealList.map((d) => d.deal_id));

	// Build slot count maps for each report, filtered to the 3 deals
	const baselineMap = buildSlotCountMap(baseline, targetIds);
	const currentMap  = buildSlotCountMap(current,  targetIds);

	// Print console summary
	console.log("");
	console.log("=== Delta Summary ===");
	for (const slot of SLOT_NAMES) {
		const bGap = baselineMap[slot]?.["detector_gap"] ?? 0;
		const cGap = currentMap[slot]?.["detector_gap"]  ?? 0;
		const delta = cGap - bGap;
		const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
		console.log(`  ${slot.padEnd(20)} gap: ${String(bGap).padStart(2)} → ${String(cGap).padStart(2)}  (${sign})`);
	}
	const totalBase = SLOT_NAMES.reduce((a, s) => a + (baselineMap[s]?.["detector_gap"] ?? 0), 0);
	const totalCur  = SLOT_NAMES.reduce((a, s) => a + (currentMap[s]?.["detector_gap"]  ?? 0), 0);
	const totalDelta = totalCur - totalBase;
	const sign = totalDelta > 0 ? `+${totalDelta}` : totalDelta < 0 ? `${totalDelta}` : "±0";
	console.log(`  ${"TOTAL".padEnd(20)} gap: ${String(totalBase).padStart(2)} → ${String(totalCur).padStart(2)}  (${sign})`);
	console.log("");

	const regressions = SLOT_NAMES.reduce((a, s) => a + (currentMap[s]?.["regressed"] ?? 0), 0);
	if (regressions > 0) {
		console.warn(`  ⚠️  REGRESSIONS: ${regressions}`);
	} else {
		console.log(`  ✅  No regressions.`);
	}
	console.log("");

	// Write output
	const md = buildMarkdown({ baseline, current, dealList, baselineMap, currentMap, targetIds });
	fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
	fs.writeFileSync(OUT_PATH, md);
	console.log(`[coverage-delta] Wrote: ${OUT_PATH}`);
}

main();
