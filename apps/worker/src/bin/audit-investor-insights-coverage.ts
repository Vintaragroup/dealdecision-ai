#!/usr/bin/env node
/**
 * bin/audit-investor-insights-coverage.ts
 *
 * CLI entry point for the Portfolio Full-Doc DPU Coverage Audit.
 *
 * Usage:
 *   pnpm --filter worker audit:investor-insights:coverage [options]
 *
 * Options:
 *   --deal-list <path>   JSON file {deals:[{name,deal_id},...]}  (overrides defaults)
 *   --deal-id <uuid>     Audit a single deal (can repeat)
 *   --concurrency <n>    Max parallel deal queries (default: 4)
 *   --out <prefix>       Output file prefix (default: tmp/investor-insights-coverage-audit)
 *
 * Outputs:
 *   <prefix>.json  — full machine-readable coverage report
 *   <prefix>.md    — human-readable Markdown report
 */

import * as fs from "fs";
import * as path from "path";
import { getPool, closePool } from "../lib/db";
import {
	runCoverageAudit,
	printCoverageMarkdown,
	parseDealListFile,
} from "../jobs/investor-insights/audit-investor-insights-coverage";
import type { CoverageAuditReport } from "../jobs/investor-insights/audit-investor-insights-coverage";

// ─────────────────────────────────────────────────────────────────────
// Defaults (same portfolio as audit-investor-insights.ts)
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_DEAL_IDS: string[] = [
	"adb2a1cf-bbb1-4f3b-8735-e2249415124f",
	"42be8b30-2b7d-45e0-ade0-99427a505c59",
	"da96b5a9-e5b2-46c1-a6ef-da037f876426",
	"517be946-cab9-4bc1-8982-9522ff9dab32",
	"5c8c7d6e-c992-4be7-8b10-268eac36f663",
	"61ef36dd-391a-4a4e-b30b-1f5d1f19f91e",
	"c4f10092-1c94-4116-b4f0-78874868f92b",
	"bcd59d33-7887-41cd-80b9-742bc5ba945a",
	"62c1eb0e-a046-4288-a6e7-4d528d04fe4c",
	"05042123-6c4f-4dcb-9131-a95fce3cd28c",
	"5c85f4f1-e38d-426f-b2ad-40db97f97b27",
	"0fcec035-9aa3-4f6e-88fa-818c323add09",
	"23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
	"b21b894e-4020-46bd-b753-93b2d2d5fa8f",
];

const DEFAULT_LABELS: Record<string, string> = {
	"adb2a1cf-bbb1-4f3b-8735-e2249415124f": "StackFactor",
	"42be8b30-2b7d-45e0-ade0-99427a505c59": "Probability AI",
	"da96b5a9-e5b2-46c1-a6ef-da037f876426": "Carmoola",
	"517be946-cab9-4bc1-8982-9522ff9dab32": "Deal Decision",
	"5c8c7d6e-c992-4be7-8b10-268eac36f663": "Palm3",
	"61ef36dd-391a-4a4e-b30b-1f5d1f19f91e": "3ICE",
	"c4f10092-1c94-4116-b4f0-78874868f92b": "Palm",
	"bcd59d33-7887-41cd-80b9-742bc5ba945a": "Dephil Trade",
	"62c1eb0e-a046-4288-a6e7-4d528d04fe4c": "Bear",
	"05042123-6c4f-4dcb-9131-a95fce3cd28c": "Health",
	"5c85f4f1-e38d-426f-b2ad-40db97f97b27": "Delphi",
	"0fcec035-9aa3-4f6e-88fa-818c323add09": "Cinco",
	"23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4": "WebMax",
	"b21b894e-4020-46bd-b753-93b2d2d5fa8f": "Qredible",
};

const DEFAULT_OUT = "tmp/investor-insights-coverage-audit";

// ─────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────

interface ParsedArgs {
	dealListPath:  string | null;
	singleDealIds: string[];
	concurrency:   number;
	outPrefix:     string;
}

function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const result: ParsedArgs = {
		dealListPath:  null,
		singleDealIds: [],
		concurrency:   4,
		outPrefix:     DEFAULT_OUT,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--":
				break;
			case "--deal-list":
				result.dealListPath = args[++i] ?? null;
				break;
			case "--deal-id": {
				const id = args[++i];
				if (id) result.singleDealIds.push(id);
				break;
			}
			case "--concurrency": {
				const n = parseInt(args[++i] ?? "4", 10);
				result.concurrency = isNaN(n) || n < 1 ? 4 : n;
				break;
			}
			case "--out":
				result.outPrefix = args[++i] ?? DEFAULT_OUT;
				break;
			default:
				if (arg && arg.startsWith("--")) {
					console.warn(`[coverage-audit] Unknown option: ${arg}`);
				}
		}
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────

function ensureDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeOutputs(report: CoverageAuditReport, outPrefix: string): void {
	const absPrefix = path.isAbsolute(outPrefix)
		? outPrefix
		: path.join(process.cwd(), outPrefix);
	const jsonPath = `${absPrefix}.json`;
	const mdPath   = `${absPrefix}.md`;
	ensureDir(jsonPath);
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
	fs.writeFileSync(mdPath,   printCoverageMarkdown(report),   "utf-8");
	console.error(`[coverage-audit] JSON: ${jsonPath}`);
	console.error(`[coverage-audit] MD:   ${mdPath}`);
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	// 1. Resolve deal IDs + labels
	let dealIds: string[];
	let labels: Record<string, string>;

	if (args.singleDealIds.length > 0) {
		dealIds = args.singleDealIds;
		labels  = Object.fromEntries(dealIds.map((id) => [id, DEFAULT_LABELS[id] ?? id.slice(0, 8)]));
		console.error(`[coverage-audit] Single deal mode — ${dealIds.length} deal(s)`);
	} else if (args.dealListPath) {
		const raw = JSON.parse(fs.readFileSync(path.resolve(args.dealListPath), "utf-8")) as unknown;
		const dlf = parseDealListFile(raw);
		dealIds = dlf.deals.map((d) => d.deal_id);
		labels  = Object.fromEntries(dlf.deals.map((d) => [d.deal_id, d.name]));
		console.error(`[coverage-audit] Loaded ${dealIds.length} deals from ${args.dealListPath}`);
	} else {
		dealIds = DEFAULT_DEAL_IDS;
		labels  = DEFAULT_LABELS;
		console.error(`[coverage-audit] Using default deal list (${dealIds.length} deals)`);
	}

	// 2. Run
	const pool = getPool();
	console.error(
		`[coverage-audit] Running — ${dealIds.length} deals, concurrency=${args.concurrency}, read-only=true`
	);

	const report = await runCoverageAudit(pool, dealIds, { labels, concurrency: args.concurrency });

	// 3. Write outputs
	writeOutputs(report, args.outPrefix);

	// 4. Print summary + Markdown to stdout
	const ps = report.portfolio_summary;
	console.error(
		`[coverage-audit] Done — ${ps.deals_ok}/${ps.total_deals} OK, ` +
		`${ps.deals_with_gaps} with gaps, ${ps.deals_with_stale} stale, ` +
		`${ps.deals_with_regressions} regressions`
	);
	process.stdout.write(printCoverageMarkdown(report));
	process.stdout.write("\n");

	await closePool();
}

main().catch((err) => {
	console.error(
		"[coverage-audit] Fatal error:",
		err instanceof Error ? err.message : String(err)
	);
	void closePool().finally(() => process.exit(1));
});
