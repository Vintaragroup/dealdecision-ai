#!/usr/bin/env node
/**
 * bin/audit-investor-insights.ts
 *
 * CLI entry point for the Investor Insights governance audit runner.
 *
 * Usage:
 *   pnpm --filter worker audit:investor-insights [options]
 *
 * Options:
 *   --deal-list <path>      JSON file {deals:[{name,deal_id},...]}
 *   --concurrency <n>       Max parallel deal queries (default: 4)
 *   --baseline <path>       Previous audit JSON for delta comparison
 *   --fail-on <tags>        Comma-separated FailureTag list to gate on
 *   --max-failures <n>      Max allowed occurrences per tag (default: 0)
 *   --read-only             Enforce read-only pool mode (default: on)
 */

import * as fs from "fs";
import * as path from "path";
import { getPool, closePool } from "../lib/db";
import {
	runInvestorInsightsAudit,
	printAuditMarkdown,
	parseDealListFile,
	checkGate,
	type AuditReport,
	type FailureTag,
} from "../jobs/investor-insights/audit-investor-insights";

// ─────────────────────────────────────────────────────────────────────
// Defaults
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

// ─────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────

interface ParsedArgs {
	dealListPath:  string | null;
	concurrency:   number;
	baselinePath:  string | null;
	failOn:        FailureTag[];
	maxFailures:   number;
}

function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const result: ParsedArgs = {
		dealListPath: null,
		concurrency:  4,
		baselinePath: null,
		failOn:       [],
		maxFailures:  0,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--":
				// pnpm passes the end-of-options separator literally — ignore it
				break;
			case "--deal-list":
				result.dealListPath = args[++i] ?? null;
				break;
			case "--concurrency": {
				const n = parseInt(args[++i] ?? "4", 10);
				result.concurrency = isNaN(n) || n < 1 ? 4 : n;
				break;
			}
			case "--baseline":
				result.baselinePath = args[++i] ?? null;
				break;
			case "--fail-on": {
				const raw = (args[++i] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
				result.failOn = raw as FailureTag[];
				break;
			}
			case "--max-failures": {
				const n = parseInt(args[++i] ?? "0", 10);
				result.maxFailures = isNaN(n) || n < 0 ? 0 : n;
				break;
			}
			case "--read-only":
				// read-only is always on — flag is a no-op (kept for CI scripts)
				break;
			default:
				if (arg.startsWith("--")) {
					console.warn(`[audit] Unknown option: ${arg}`);
				}
		}
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────

function ensureTmpDir(): void {
	const dir = path.join(process.cwd(), "tmp");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeOutputs(report: AuditReport): void {
	ensureTmpDir();
	const jsonPath = path.join(process.cwd(), "tmp", "investor-insights-audit.json");
	const mdPath   = path.join(process.cwd(), "tmp", "investor-insights-audit.md");
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
	fs.writeFileSync(mdPath,   printAuditMarkdown(report),      "utf-8");
	console.error(`[audit] JSON: ${jsonPath}`);
	console.error(`[audit] MD:   ${mdPath}`);
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	// 1. Resolve deal IDs + labels
	let dealIds: string[];
	let labels: Record<string, string>;

	if (args.dealListPath) {
		const raw = JSON.parse(fs.readFileSync(path.resolve(args.dealListPath), "utf-8")) as unknown;
		const dlf = parseDealListFile(raw);
		dealIds = dlf.deals.map((d) => d.deal_id);
		labels  = Object.fromEntries(dlf.deals.map((d) => [d.deal_id, d.name]));
		console.error(`[audit] Loaded ${dealIds.length} deals from ${args.dealListPath}`);
	} else {
		dealIds = DEFAULT_DEAL_IDS;
		labels  = DEFAULT_LABELS;
		console.error(`[audit] Using default deal list (${dealIds.length} deals)`);
	}

	// 2. Resolve baseline
	let baseline: AuditReport | undefined;
	if (args.baselinePath) {
		const raw = JSON.parse(fs.readFileSync(path.resolve(args.baselinePath), "utf-8")) as unknown;
		baseline = raw as AuditReport;
		console.error(`[audit] Baseline: ${args.baselinePath} (generated: ${baseline.generated_at})`);
	}

	// 3. Run
	const pool = getPool();
	console.error(`[audit] Running audit — ${dealIds.length} deals, concurrency=${args.concurrency}, read-only=true`);

	const report = await runInvestorInsightsAudit(pool, dealIds, {
		labels,
		concurrency: args.concurrency,
		readOnly:    true,
		baseline,
	});

	// 4. Write outputs
	writeOutputs(report);

	// 5. CI gate
	if (args.failOn.length > 0) {
		const gate = checkGate(report, { failOn: args.failOn, maxFailures: args.maxFailures });
		if (!gate.passed) {
			process.stderr.write("\n[audit:CI-GATE] FAILED — violations:\n");
			for (const v of gate.violations) {
				process.stderr.write(`  ${v.tag}: ${v.count} occurrences (max allowed: ${v.max_allowed})\n`);
			}
			process.stderr.write("\n");
			await closePool();
			process.exit(1);
		} else {
			console.error("[audit:CI-GATE] PASSED");
		}
	}

	// 6. Print Markdown to stdout
	process.stdout.write(printAuditMarkdown(report));
	process.stdout.write("\n");

	await closePool();
}

main().catch((err) => {
	console.error("[audit] Fatal error:", err instanceof Error ? err.message : String(err));
	void closePool().finally(() => process.exit(1));
});
