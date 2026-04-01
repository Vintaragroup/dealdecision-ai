#!/usr/bin/env node
/**
 * bin/inspect-intelligence-run.ts
 *
 * Dev-only CLI: inspect all intelligence layer artifacts for a given deal,
 * querying `deal_decision_memory`, `deal_evaluation_flags`,
 * `deal_confidence_assessments`, and `deal_challenge_pass_results`.
 *
 * Usage:
 *   pnpm --filter worker exec tsx src/bin/inspect-intelligence-run.ts \
 *     --deal-id <uuid>
 *     [--run-id <uuid>]     # scope to a specific intelligence_run_id
 *     [--verbose]           # show full JSONB fields
 *
 * Reads DATABASE_URL from environment (same as the worker).
 *
 * Exit code 0 = at least one row found across intelligence tables.
 * Exit code 1 = no rows found (Stage 5 has not run for this deal).
 */

import pg from "pg";

// ─── Load env ─────────────────────────────────────────────────────────────────

// DATABASE_URL must be set in the environment before running this script.
// Use a .env file loader of your choice if running locally outside Docker.
// e.g.: export DATABASE_URL=postgres://... && pnpm exec tsx src/bin/inspect-intelligence-run.ts ...

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function arg(flag: string): string | null {
	const i = argv.indexOf(flag);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}
function flag(f: string): boolean { return argv.includes(f); }

const DEAL_ID = arg("--deal-id");
const RUN_ID  = arg("--run-id");
const VERBOSE = flag("--verbose");

if (!DEAL_ID) {
	console.error("Usage: inspect-intelligence-run --deal-id <uuid> [--run-id <uuid>] [--verbose]");
	process.exit(1);
}

const DB_URL = process.env["DATABASE_URL"];
if (!DB_URL) {
	console.error("DATABASE_URL is not set");
	process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hr(label: string): void {
	const pad = "─".repeat(Math.max(0, 60 - label.length - 2));
	console.log(`\n── ${label} ${pad}`);
}

function row(label: string, value: unknown): void {
	const v =
		value === null || value === undefined
			? "(null)"
			: typeof value === "object"
			? VERBOSE
				? JSON.stringify(value, null, 2)
				: "[object — use --verbose to expand]"
			: String(value);
	console.log(`  ${label.padEnd(32)} ${v}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });

	const runClause = RUN_ID
		? " AND intelligence_run_id = $2"
		: "";
	const baseParams: unknown[] = [DEAL_ID];
	if (RUN_ID) baseParams.push(RUN_ID);

	let totalRows = 0;

	// ── 1. decision memory ───────────────────────────────────────────────────
	hr("decision_memory  [deal_decision_memory]");
	const memR = await pool.query<Record<string, unknown>>(
		`SELECT id, upstream_fingerprint,
			ors_score, dci_score, fhc_score, urss_score, verdict,
			arr, burn_rate, runway_months, raise_amount, stage,
			evidence_count, financial_completeness_pct,
			created_at, updated_at
		FROM public.deal_decision_memory
		WHERE deal_id = $1
		ORDER BY updated_at DESC
		LIMIT 5`,
		[DEAL_ID]
	);
	if (memR.rows.length === 0) {
		console.log("  (no rows)");
	} else {
		totalRows += memR.rows.length;
		for (const r of memR.rows) {
			console.log(`  ID: ${r["id"]}  updated: ${r["updated_at"]}`);
			row("  fingerprint",            r["upstream_fingerprint"]);
			row("  verdict",               r["verdict"]);
			row("  ors / dci / fhc / urss", `${r["ors_score"]} / ${r["dci_score"]} / ${r["fhc_score"]} / ${r["urss_score"]}`);
			row("  arr",                    r["arr"]);
			row("  burn_rate",              r["burn_rate"]);
			row("  runway_months",          r["runway_months"]);
			row("  raise_amount",           r["raise_amount"]);
			row("  evidence_count",         r["evidence_count"]);
			row("  financial_completeness", r["financial_completeness_pct"]);
			console.log();
		}
	}

	// ── 2. evaluation flags ──────────────────────────────────────────────────
	hr("evaluation_flags  [deal_evaluation_flags]");
	const flagQ = `SELECT id, intelligence_run_id, flag_type, severity, source_stage,
		impacted_score, description, resolution_status, created_at
	FROM public.deal_evaluation_flags
	WHERE deal_id = $1${runClause}
	ORDER BY severity, created_at DESC`;
	const flagR = await pool.query<Record<string, unknown>>(flagQ, baseParams);
	if (flagR.rows.length === 0) {
		console.log("  (no rows)");
	} else {
		totalRows += flagR.rows.length;
		const bySeverity: Record<string, typeof flagR.rows> = {};
		for (const r of flagR.rows) {
			const s = String(r["severity"] ?? "unknown");
			(bySeverity[s] ??= []).push(r);
		}
		for (const [sev, rows] of Object.entries(bySeverity)) {
			console.log(`  [${sev.toUpperCase()}] ${rows.length} flag(s):`);
			for (const r of rows) {
				console.log(`    • [${r["flag_type"]}] ${r["description"]}  (${r["resolution_status"]})`);
			}
		}
		console.log(`  Total: ${flagR.rows.length} flag(s)`);
	}

	// ── 3. confidence assessments ────────────────────────────────────────────
	hr("confidence  [deal_confidence_assessments]");
	const confQ = `SELECT id, intelligence_run_id,
		overall_confidence_score, overall_confidence_band,
		rationale,
		jsonb_array_length(penalties_applied) AS penalty_count,
		jsonb_array_length(conclusions) AS conclusion_count,
		penalties_applied,
		created_at
	FROM public.deal_confidence_assessments
	WHERE deal_id = $1${runClause}
	ORDER BY created_at DESC
	LIMIT 3`;
	const confR = await pool.query<Record<string, unknown>>(confQ, baseParams);
	if (confR.rows.length === 0) {
		console.log("  (no rows)");
	} else {
		totalRows += confR.rows.length;
		for (const r of confR.rows) {
			console.log(`  Run: ${r["intelligence_run_id"]}  created: ${r["created_at"]}`);
			row("  score / band",    `${r["overall_confidence_score"]} / ${r["overall_confidence_band"]}`);
			row("  penalty_count",   r["penalty_count"]);
			row("  conclusion_count",r["conclusion_count"]);
			row("  rationale",       r["rationale"]);
			if (VERBOSE) row("  penalties_applied", r["penalties_applied"]);
			console.log();
		}
	}

	// ── 4. challenge-pass results ────────────────────────────────────────────
	hr("challenge_pass  [deal_challenge_pass_results]");
	const chalQ = `SELECT id, intelligence_run_id,
		verdict_resistance_score, verdict_resistance_label,
		flag_count_critical, flag_count_error, flag_count_warn,
		opposing_case_summary,
		jsonb_array_length(overconfident_claims) AS overconfident_claims_count,
		jsonb_array_length(missing_evidence)     AS missing_evidence_count,
		jsonb_array_length(diligence_gaps)       AS diligence_gaps_count,
		overconfident_claims, missing_evidence, diligence_gaps,
		created_at
	FROM public.deal_challenge_pass_results
	WHERE deal_id = $1${runClause}
	ORDER BY created_at DESC
	LIMIT 3`;
	const chalR = await pool.query<Record<string, unknown>>(chalQ, baseParams);
	if (chalR.rows.length === 0) {
		console.log("  (no rows)");
	} else {
		totalRows += chalR.rows.length;
		for (const r of chalR.rows) {
			console.log(`  Run: ${r["intelligence_run_id"]}  created: ${r["created_at"]}`);
			row("  resistance score/label", `${r["verdict_resistance_score"]} / ${r["verdict_resistance_label"]}`);
			row("  flags C/E/W",            `${r["flag_count_critical"]} / ${r["flag_count_error"]} / ${r["flag_count_warn"]}`);
			row("  overconfident_claims",   r["overconfident_claims_count"]);
			row("  missing_evidence",       r["missing_evidence_count"]);
			row("  diligence_gaps",         r["diligence_gaps_count"]);
			row("  opposing_case_summary",  r["opposing_case_summary"]);
			if (VERBOSE) {
				row("  overconfident_claims", r["overconfident_claims"]);
				row("  missing_evidence",     r["missing_evidence"]);
				row("  diligence_gaps",       r["diligence_gaps"]);
			}
			console.log();
		}
	}

	// ── Summary ──────────────────────────────────────────────────────────────
	hr("Summary");
	console.log(`  deal_id:    ${DEAL_ID}`);
	if (RUN_ID) console.log(`  run_id:     ${RUN_ID}`);
	console.log(`  total rows: ${totalRows} across 4 intelligence tables`);

	await pool.end();
	process.exit(totalRows > 0 ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
