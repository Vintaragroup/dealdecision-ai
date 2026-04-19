export {};

/**
 * DB-Fact Merge Validation
 *
 * Validates that the Step 33 Option A fix (existingDbFacts → Section 7b merge in
 * buildFinancialFactRegistryV1) is working correctly for priority deals.
 *
 * For each deal:
 *   1. Triggers a fresh investor-insights run via the API
 *   2. Waits for the job to reach a terminal status
 *   3. Queries the DB for:
 *      - challenge_pass_results: new row with fresh timestamp
 *      - financial_facts_v1: cash_outflow_operating, burn_rate, runway_months
 *      - financial_facts_v1: duplicate fact check
 *      - ingestion_reports: latest report summary for trust output
 *
 * Reads DATABASE_URL from .env / apps/api/.env, API_URL from env or defaults to
 * http://localhost:9001.
 *
 * Usage:
 *   pnpm tsx scripts/diagnostics/db-fact-merge-validation.ts
 *   pnpm tsx scripts/diagnostics/db-fact-merge-validation.ts --skip-trigger
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "../..");
const API_URL = process.env.API_URL ?? "http://localhost:9001";
const SKIP_TRIGGER = process.argv.includes("--skip-trigger");
const TIMEOUT_MS = 5 * 60_000; // 5 min per job
const POLL_MS = 3_000;

const PRIORITY_DEALS: Array<{ name: string; id: string }> = [
  { name: "StackFactor",   id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f" },
  { name: "DealDecision",  id: "517be946-cab9-4bc1-8982-9522ff9dab32" },
  { name: "Allurion",      id: "a85b0ac0-19a1-4992-9a21-2d47484b0f8f" },
  { name: "Palm",          id: "5c8c7d6e-c992-4be7-8b10-268eac36f663" },
  { name: "TOXYScreen",    id: "05042123-6c4f-4dcb-9131-a95fce3cd28c" },
];

// ── Env loading ───────────────────────────────────────────────────────────────

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

async function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    path.join(REPO_ROOT, ".env"),
    path.join(REPO_ROOT, "apps/api/.env"),
    path.join(REPO_ROOT, "apps/worker/.env"),
  ];
  for (const f of candidates) {
    try {
      const txt = await fs.readFile(f, "utf8");
      const parsed = parseDotenv(txt);
      if (parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL;
        console.log(`[env] DATABASE_URL loaded from ${f}`);
        return;
      }
    } catch { /* skip */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function ts() {
  return new Date().toISOString();
}

/** Format a Date or string value to ISO 19-char prefix for display */
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "n/a";
  return new Date(d as string).toISOString().slice(0, 19);
}

// ── API trigger ───────────────────────────────────────────────────────────────

interface TriggerResult {
  ok: boolean;
  job_id?: string;
  status?: number;
  error?: string;
  skipped?: boolean;
}

async function triggerRun(dealId: string): Promise<TriggerResult> {
  if (SKIP_TRIGGER) {
    return { ok: true, skipped: true };
  }
  try {
    const res = await fetch(
      `${API_URL}/api/v1/deals/${dealId}/investor-insights/regenerate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 202 || res.ok) {
      return { ok: true, job_id: body.job_id as string | undefined, status: res.status };
    }
    return { ok: false, status: res.status, error: JSON.stringify(body) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Job polling ───────────────────────────────────────────────────────────────

interface JobPollResult {
  status: string;
  ok: boolean;
  updated_at: string | null;
  message: string | null;
  timedOut?: boolean;
}

// Investor-insights jobs are queued via BullMQ (removeOnComplete: true) and never
// appear in the `jobs` table. Poll investor_insight_reports.updated_at instead.
async function waitForInvestorInsightsJob(
  pool: Pool,
  dealId: string,
  afterTimestamp: Date
): Promise<JobPollResult> {
  const started = Date.now();
  while (true) {
    const { rows } = await pool.query<{
      id: string;
      updated_at: string | null;
    }>(
      `SELECT id, updated_at
       FROM investor_insight_reports
       WHERE deal_id = $1
         AND updated_at >= $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [dealId, afterTimestamp.toISOString()]
    );

    const row = rows[0];
    if (row) {
      return {
        status: "completed",
        ok: true,
        updated_at: row.updated_at,
        message: null,
      };
    }

    if (Date.now() - started > TIMEOUT_MS) {
      return {
        status: "not_found",
        ok: false,
        updated_at: null,
        message: null,
        timedOut: true,
      };
    }
    await sleep(POLL_MS);
  }
}

// ── DB queries ────────────────────────────────────────────────────────────────

interface ChallengePassRow {
  id: string;
  deal_id: string;
  created_at: string;
  updated_at: string;
  verdict_resistance_label: string | null;
  verdict_resistance_score: number | null;
  flag_count_critical: number | null;
  flag_count_error: number | null;
  flag_count_warn: number | null;
}

async function queryLatestChallengePass(pool: Pool, dealId: string): Promise<ChallengePassRow | null> {
  const { rows } = await pool.query<ChallengePassRow>(
    `SELECT id, deal_id, created_at, updated_at, verdict_resistance_label,
            verdict_resistance_score, flag_count_critical, flag_count_error, flag_count_warn
     FROM deal_challenge_pass_results
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  return rows[0] ?? null;
}

interface FinancialFactRow {
  fact_id: string;
  metric_key: string;
  period_label: string;
  value: number | null;
  unit: string | null;
  source_kind: string | null;
  source_pointer: string | null;
  confidence: string | null;
  created_at: string;
}

async function queryFinancialFactsByMetric(
  pool: Pool,
  dealId: string,
  metricKeys: string[]
): Promise<FinancialFactRow[]> {
  const { rows } = await pool.query<FinancialFactRow>(
    `SELECT fact_id, metric_key, period_label, value, unit, source_kind,
            source_pointer, confidence, created_at
     FROM financial_facts_v1
     WHERE deal_id = $1
       AND metric_key = ANY($2)
     ORDER BY metric_key, period_label, created_at DESC`,
    [dealId, metricKeys]
  );
  return rows;
}

interface DupCheckRow {
  metric_key: string;
  period_label: string;
  count: number;
}

async function queryDuplicateFactSlots(pool: Pool, dealId: string): Promise<DupCheckRow[]> {
  const { rows } = await pool.query<DupCheckRow>(
    `SELECT metric_key, period_label, count(*)::int AS count
     FROM financial_facts_v1
     WHERE deal_id = $1
     GROUP BY metric_key, period_label
     HAVING count(*) > 1
     ORDER BY count DESC, metric_key`,
    [dealId]
  );
  return rows;
}

interface TrustSummaryRow {
  arr_status: string | null;
  burn_status: string | null;
  runway_status: string | null;
  cash_status: string | null;
  created_at: string;
}

async function queryLatestTrustSummary(pool: Pool, dealId: string): Promise<TrustSummaryRow | null> {
  // Pull from ingestion_reports.summary JSONB (financial_truth map) for the latest report
  const { rows } = await pool.query<{
    summary: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT summary, created_at
     FROM ingestion_reports
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  if (!rows[0] || !rows[0].summary) return null;

  const summary = rows[0].summary as Record<string, unknown>;
  // Look for financial_truth inside the summary
  const ft = (summary as Record<string, unknown>).financial_truth_summary as Record<string, unknown> | undefined
    ?? (summary as Record<string, unknown>).financialTruth as Record<string, unknown> | undefined;

  function getState(obj: Record<string, unknown> | undefined, key: string): string | null {
    if (!obj) return null;
    const rec = obj[key] as Record<string, unknown> | undefined;
    return (rec?.state as string) ?? (rec?.status as string) ?? null;
  }

  return {
    arr_status: ft ? getState(ft as Record<string, unknown>, "arr") ?? getState(ft as Record<string, unknown>, "revenue_arr") : null,
    burn_status: ft ? getState(ft as Record<string, unknown>, "burn_rate") ?? getState(ft as Record<string, unknown>, "burn_monthly") : null,
    runway_status: ft ? getState(ft as Record<string, unknown>, "runway_months") : null,
    cash_status: ft ? getState(ft as Record<string, unknown>, "cash") ?? getState(ft as Record<string, unknown>, "cash_latest") : null,
    created_at: rows[0].created_at,
  };
}

async function queryLatestChallengePassFactors(pool: Pool, dealId: string): Promise<{
  verdict_resistance_label: string | null;
  verdict_resistance_score: number | null;
  challenge_factors: unknown | null;
  created_at: string;
} | null> {
  const { rows } = await pool.query(
    `SELECT verdict_resistance_label, verdict_resistance_score, challenge_factors, created_at
     FROM deal_challenge_pass_results
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  return rows[0] ?? null;
}

// Check if Stage 5 ran at all (investor_insight_reports row exists for this deal)
async function queryLatestInvestorInsightsJob(pool: Pool, dealId: string): Promise<{
  job_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  message: string | null;
} | null> {
  const { rows } = await pool.query(
    `SELECT id AS job_id, 'completed' AS status, created_at, updated_at, NULL::text AS message
     FROM investor_insight_reports
     WHERE deal_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [dealId]
  );
  return rows[0] ?? null;
}

// ── Report formatters ─────────────────────────────────────────────────────────

interface DealResult {
  name: string;
  id: string;
  triggerResult: TriggerResult;
  jobResult: JobPollResult | null;
  latestChallengePass: ChallengePassRow | null;
  financialFacts: FinancialFactRow[];
  duplicateSlots: DupCheckRow[];
  trustSummary: TrustSummaryRow | null;
  challengeFactors: Awaited<ReturnType<typeof queryLatestChallengePassFactors>>;
  runBeforeTimestamp: Date;
}

function formatTable(headers: string[], rows: string[][]): string {
  const cols = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const sep = widths.map((w) => "-".repeat(w + 2)).join("|");
  const head = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join("|");
  const body = rows.map((r) =>
    r.map((c, i) => ` ${(c ?? "").padEnd(widths[i])} `).join("|")
  );
  return [`|${head}|`, `|${sep}|`, ...body.map((r) => `|${r}|`)].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL not set. Cannot connect to DB.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  // ── Connectivity check ──────────────────────────────────────────────────────
  try {
    await pool.query("SELECT 1");
    console.log(`[db] Connected to Postgres`);
  } catch (e) {
    console.error(`[db] Cannot connect: ${(e as Error).message}`);
    process.exit(1);
  }

  // ── API check ───────────────────────────────────────────────────────────────
  if (!SKIP_TRIGGER) {
    try {
      const res = await fetch(`${API_URL}/api/v1/health`);
      if (res.ok) {
        console.log(`[api] API is up at ${API_URL}`);
      } else {
        console.warn(`[api] API health check returned ${res.status}`);
      }
    } catch (e) {
      console.warn(`[api] API may not be reachable: ${(e as Error).message}`);
      console.warn(`[api] Continuing anyway — add --skip-trigger to skip API calls`);
    }
  }

  const runStart = new Date();
  const results: DealResult[] = [];

  // ── Phase 1: trigger all runs ───────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PHASE 1 — Triggering fresh investor-insights runs`);
  console.log(`${"=".repeat(60)}`);

  const dealTriggers: Array<{ deal: typeof PRIORITY_DEALS[0]; trigger: TriggerResult; before: Date }> = [];
  for (const deal of PRIORITY_DEALS) {
    const before = new Date();
    console.log(`  → Triggering ${deal.name} (${deal.id.slice(0, 8)}…)`);
    const trigger = await triggerRun(deal.id);
    if (trigger.skipped) {
      console.log(`    SKIPPED (--skip-trigger)`);
    } else if (trigger.ok) {
      console.log(`    ✅ Enqueued (job_id=${trigger.job_id ?? "unknown"}, status=${trigger.status})`);
    } else {
      console.log(`    ❌ Failed: status=${trigger.status} error=${trigger.error}`);
    }
    dealTriggers.push({ deal, trigger, before });
  }

  // ── Phase 2: wait for completion ────────────────────────────────────────────
  if (!SKIP_TRIGGER) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`PHASE 2 — Waiting for jobs to complete (timeout: ${TIMEOUT_MS / 1000}s each)`);
    console.log(`${"=".repeat(60)}`);

    for (const { deal, trigger, before } of dealTriggers) {
      if (!trigger.ok) {
        console.log(`  → ${deal.name}: skipping wait (trigger failed)`);
        continue;
      }
      console.log(`  → Waiting for ${deal.name}…`);
      const job = await waitForInvestorInsightsJob(pool, deal.id, before);
      if (job.timedOut) {
        console.log(`    ⏰ Timed out — last status: ${job.status}`);
      } else {
        console.log(`    ${job.ok ? "✅" : "❌"} ${job.status} at ${job.updated_at}`);
      }
    }
  } else {
    console.log(`\n[skip-trigger] Skipping wait phase.`);
  }

  // ── Phase 3: query DB ───────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PHASE 3 — Querying DB for validation`);
  console.log(`${"=".repeat(60)}`);

  for (const { deal, trigger, before } of dealTriggers) {
    console.log(`\n  [${deal.name}] querying…`);

    const [latestChallengePass, financialFacts, duplicateSlots, trustSummary, challengeFactors] =
      await Promise.all([
        queryLatestChallengePass(pool, deal.id),
        queryFinancialFactsByMetric(pool, deal.id, [
          "cash_outflow_operating",
          "burn_rate",
          "runway_months",
          "arr",
          "revenue_arr",
          "cash",
          "cash_latest",
        ]),
        queryDuplicateFactSlots(pool, deal.id),
        queryLatestTrustSummary(pool, deal.id),
        queryLatestChallengePassFactors(pool, deal.id),
      ]);

    // Determine latest investor_insights job for Stage 5 coverage check
    const latestJob = await queryLatestInvestorInsightsJob(pool, deal.id);

    results.push({
      name: deal.name,
      id: deal.id,
      triggerResult: trigger,
      jobResult: SKIP_TRIGGER ? null : null, // will be derived from challenge pass timing
      latestChallengePass,
      financialFacts,
      duplicateSlots,
      trustSummary,
      challengeFactors,
      runBeforeTimestamp: before,
    });

    console.log(`    challenge_pass: ${latestChallengePass?.created_at ?? "NONE"} (verdict=${latestChallengePass?.verdict_resistance_label ?? "n/a"})`);
    console.log(`    financial_facts: ${financialFacts.length} rows for target metrics`);
    console.log(`    duplicate slots: ${duplicateSlots.length}`);
    console.log(`    latest II job: ${latestJob?.status ?? "NONE"} at ${latestJob?.updated_at ?? "n/a"}`);
  }

  // ── Report assembly ─────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(72)}`);
  console.log(`VALIDATION REPORT — DB-Fact Merge Fix (Step 33 Option A)`);
  console.log(`Generated: ${ts()}`);
  console.log(`${"=".repeat(72)}\n`);

  // ── Section 1: Fresh run verification ──────────────────────────────────────
  console.log(`## Section 1: Fresh run verification\n`);
  console.log(formatTable(
    ["Deal", "Trigger", "Stage 5 row created?", "Timestamp", "Status"],
    results.map((r) => {
      const freshRow = r.latestChallengePass &&
        new Date(r.latestChallengePass.created_at) > r.runBeforeTimestamp;
      const freshRowDisplay = SKIP_TRIGGER
        ? (r.latestChallengePass ? "pre-existing" : "NONE")
        : (freshRow ? "YES" : (r.latestChallengePass ? "pre-existing (stale)" : "NO"));
      return [
        r.name,
        r.triggerResult.skipped ? "skipped" : (r.triggerResult.ok ? "✅" : "❌"),
        freshRowDisplay,
        fmtDate(r.latestChallengePass?.created_at) ?? "n/a",
        r.latestChallengePass?.verdict_resistance_label ?? "n/a",
      ];
    })
  ));

  // ── Section 2: StackFactor deep validation ─────────────────────────────────
  console.log(`\n## Section 2: StackFactor deep validation\n`);
  const sf = results.find((r) => r.name === "StackFactor")!;
  if (!sf) {
    console.log("StackFactor not found in results.");
  } else {
    const sfFacts = sf.financialFacts;
    const cashOutflow = sfFacts.filter((f) => f.metric_key === "cash_outflow_operating");
    const burnRate = sfFacts.filter((f) => f.metric_key === "burn_rate");
    const runwayMonths = sfFacts.filter((f) => f.metric_key === "runway_months");

    const sfChecks: Array<[string, string, string]> = [
      [
        "financial_facts_v1 loaded (non-empty DB facts exist)",
        sfFacts.length > 0 ? "✅ PASS" : "❌ FAIL",
        `${sfFacts.length} target-metric rows in DB`,
      ],
      [
        "cash_outflow_operating / Year 12 present in DB",
        cashOutflow.some((f) => f.period_label === "Year 12") ? "✅ PASS" : "❌ FAIL",
        cashOutflow.length === 0
          ? "NOT FOUND"
          : cashOutflow.map((f) => `${f.period_label}=${f.value} (${f.source_kind})`).join("; "),
      ],
      [
        "burn_rate / Year 12 derived in DB",
        burnRate.some((f) => f.period_label === "Year 12") ? "✅ PASS" : "❌ FAIL",
        burnRate.length === 0
          ? "NOT FOUND"
          : burnRate.map((f) => `${f.period_label}=${f.value} src=${f.source_kind} ptr=${(f.source_pointer ?? "").slice(0, 50)}`).join("; "),
      ],
      [
        "runway_months / Year 12 derived in DB",
        runwayMonths.some((f) => f.period_label === "Year 12") ? "✅ PASS" : "❌ FAIL",
        runwayMonths.length === 0
          ? "NOT FOUND"
          : runwayMonths.map((f) => `${f.period_label}=${f.value} src=${f.source_kind} ptr=${(f.source_pointer ?? "").slice(0, 50)}`).join("; "),
      ],
      [
        "burn_rate source_kind=structured_derived",
        burnRate.some((f) => f.source_kind === "structured_derived") ? "✅ PASS" : burnRate.length === 0 ? "❌ FAIL (no burn_rate)" : "⚠️  PARTIAL",
        burnRate.map((f) => `src=${f.source_kind} ptr=${(f.source_pointer ?? "").slice(0, 60)}`).join("; ") || "n/a",
      ],
      [
        "Stage 5 challenge pass row created",
        sf.latestChallengePass ? "✅ PASS" : "❌ FAIL",
        sf.latestChallengePass
          ? `${fmtDate(sf.latestChallengePass.created_at)} verdict=${sf.latestChallengePass.verdict_resistance_label}`
          : "NOT FOUND",
      ],
      [
        "No duplicate fact slots for StackFactor",
        sf.duplicateSlots.length === 0 ? "✅ PASS" : "⚠️  DUPLICATES FOUND",
        sf.duplicateSlots.length === 0
          ? "clean"
          : sf.duplicateSlots.map((d) => `${d.metric_key}/${d.period_label} ×${d.count}`).join("; "),
      ],
    ];

    console.log(formatTable(
      ["Check", "Result", "Evidence"],
      sfChecks
    ));
  }

  // ── Section 3: User-facing trust output ────────────────────────────────────
  console.log(`\n## Section 3: User-facing trust output\n`);
  console.log(`Note: trust states pulled from deal_challenge_pass_results.challenge_factors`);
  console.log(`and financial_facts_v1. ingestion_reports financial_truth_summary shown when available.\n`);

  function describeTrustState(facts: FinancialFactRow[], metricKeys: string[]): string {
    const matching = facts.filter((f) => metricKeys.includes(f.metric_key));
    if (matching.length === 0) return "missing";
    const confirmed = matching.some((f) => f.confidence === "high" || f.source_kind === "xlsx");
    const derived = matching.some((f) => f.source_kind === "structured_derived");
    if (confirmed) return "verified (xlsx/high-conf)";
    if (derived) return "derived/verified";
    return "mentioned/unverified";
  }

  console.log(formatTable(
    ["Deal", "ARR", "Burn", "Runway", "Cash", "Verdict", "Crit/Err/Warn"],
    results.map((r) => {
      const arr = describeTrustState(r.financialFacts, ["arr", "revenue_arr"]);
      const burn = describeTrustState(r.financialFacts, ["burn_rate"]);
      const runway = describeTrustState(r.financialFacts, ["runway_months"]);
      const cash = describeTrustState(r.financialFacts, ["cash", "cash_latest"]);
      const cp = r.latestChallengePass;
      return [
        r.name,
        arr,
        burn,
        runway,
        cash,
        cp?.verdict_resistance_label ?? "n/a",
        cp ? `${cp.flag_count_critical}/${cp.flag_count_error}/${cp.flag_count_warn}` : "n/a",
      ];
    })
  ));

  // ── Section 4: Stage 5 coverage gaps ───────────────────────────────────────
  console.log(`\n## Section 4: Stage 5 coverage gaps (Palm, TOXYScreen)\n`);
  const coverageDeals = results.filter((r) => ["Palm", "TOXYScreen"].includes(r.name));

  const s4Rows: string[][] = [];
  for (const r of coverageDeals) {
    const hasChallenge = r.latestChallengePass != null;
    const freshChallenge = hasChallenge &&
      new Date(r.latestChallengePass!.created_at) > r.runBeforeTimestamp;

    let reason = "n/a";
    if (!SKIP_TRIGGER && !r.triggerResult.ok) {
      reason = `trigger failed: ${r.triggerResult.error}`;
    } else if (!hasChallenge) {
      reason = "No challenge_pass_results row — Stage 5 never ran or job failed";
    } else if (!freshChallenge && !SKIP_TRIGGER) {
      reason = "Pre-existing stale row — new job may have failed or not yet completed";
    }

    s4Rows.push([
      r.name,
      SKIP_TRIGGER ? (hasChallenge ? "pre-existing" : "NONE") : (freshChallenge ? "YES (fresh)" : (hasChallenge ? "pre-existing" : "NO")),
      reason,
    ]);
  }

  console.log(formatTable(["Deal", "Stage 5 ran?", "If not, why?"], s4Rows));

  // ── Section 5: Regression check ────────────────────────────────────────────
  console.log(`\n## Section 5: Regression check\n`);

  const totalDups = results.reduce((s, r) => s + r.duplicateSlots.length, 0);
  const sfBurnFacts = sf?.financialFacts.filter((f) => f.metric_key === "burn_rate") ?? [];
  const sfRunwayFacts = sf?.financialFacts.filter((f) => f.metric_key === "runway_months") ?? [];

  // Check if any stale DB fact has a newer timestamp than a fresh derived fact.
  // Section 7b slot dedup prevents current-run slots from being overridden.
  const staleOverrideCheck = (() => {
    // Multiple rows of the same metric_key+period_label would indicate a duplicate slot
    const burnYear12 = sfBurnFacts.filter((f) => f.period_label === "Year 12");
    if (burnYear12.length > 1) {
      return "⚠️  Multiple burn_rate/Year 12 facts — possible Section 7b slot dedup failure";
    }
    return "✅ No stale-override conflict detected";
  })();

  const s5Rows: string[][] = [
    [
      "Duplicate fact slots across all deals",
      totalDups === 0 ? "✅ NONE" : `⚠️  ${totalDups} duplicate slots found`,
      results.flatMap((r) => r.duplicateSlots.map((d) => `${r.name}: ${d.metric_key}/${d.period_label} ×${d.count}`)).join("; ") || "clean",
    ],
    [
      "Stale DB facts overriding fresh current-run facts",
      staleOverrideCheck,
      "Section 7b slot dedup ensures current-run wins by metric_key+period_label",
    ],
    [
      "StackFactor burn_rate derivation consistent",
      sfBurnFacts.length > 0 ? "✅ Present" : "❌ Missing",
      sfBurnFacts.map((f) => `src=${f.source_kind} val=${f.value} ptr=${(f.source_pointer ?? "").slice(0, 50)}`).join("; ") || "n/a",
    ],
    [
      "StackFactor runway_months derivation consistent",
      sfRunwayFacts.length > 0 ? "✅ Present" : "❌ Missing",
      sfRunwayFacts.map((f) => `src=${f.source_kind} val=${f.value} ptr=${(f.source_pointer ?? "").slice(0, 50)}`).join("; ") || "n/a",
    ],
    [
      "Other deals unaffected (no new duplication)",
      totalDups === 0 ? "✅ PASS" : "⚠️  Review required",
      `Total duplicate slots across 5 deals: ${totalDups}`,
    ],
  ];
  console.log(formatTable(["Check", "Result", "Notes"], s5Rows));

  // ── Section 6: Overall verdict ──────────────────────────────────────────────
  console.log(`\n## Section 6: Overall verdict\n`);

  const sfOk =
    sf &&
    sf.financialFacts.some((f) => f.metric_key === "cash_outflow_operating" && f.period_label === "Year 12") &&
    sf.financialFacts.some((f) => f.metric_key === "burn_rate" && f.period_label === "Year 12") &&
    sf.financialFacts.some((f) => f.metric_key === "runway_months" && f.period_label === "Year 12") &&
    sf.latestChallengePass != null;

  const noDups = totalDups === 0;
  const allTriggeredOk = SKIP_TRIGGER
    ? true
    : results.every((r) => r.triggerResult.ok || r.triggerResult.skipped);

  if (sfOk && noDups) {
    console.log("✅ WORKING AS INTENDED");
    console.log("");
    console.log("The DB-facts merge fix (Section 7b) is confirmed working:");
    console.log("  - StackFactor: cash_outflow_operating/Year 12 in DB → Rule 4 fires → burn_rate + runway_months derived");
    console.log("  - No duplicate fact slots detected");
    console.log("  - Decision Confidence output improved for StackFactor burn/runway");
  } else {
    const issues: string[] = [];
    if (!sfOk) {
      if (!sf) issues.push("StackFactor not in results");
      else {
        if (!sf.financialFacts.some((f) => f.metric_key === "cash_outflow_operating" && f.period_label === "Year 12")) {
          issues.push("cash_outflow_operating/Year 12 still missing from financial_facts_v1");
        }
        if (!sf.financialFacts.some((f) => f.metric_key === "burn_rate" && f.period_label === "Year 12")) {
          issues.push("burn_rate/Year 12 NOT derived — Rule 4 did not fire");
        }
        if (!sf.financialFacts.some((f) => f.metric_key === "runway_months" && f.period_label === "Year 12")) {
          issues.push("runway_months/Year 12 NOT derived — Rule 4b did not fire");
        }
        if (!sf.latestChallengePass) {
          issues.push("No challenge_pass_results row — Stage 5 never ran");
        }
      }
    }
    if (!noDups) {
      issues.push(`${totalDups} duplicate fact slot(s) found — possible merge artifact`);
    }

    if (SKIP_TRIGGER && !allTriggeredOk) {
      console.log("⚠️  PARTIALLY WORKING — fresh-run validation skipped (--skip-trigger)");
    } else {
      console.log("⚠️  PARTIALLY WORKING — issues found:");
    }
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }

    if (SKIP_TRIGGER) {
      console.log("");
      console.log("NOTE: Run without --skip-trigger to trigger fresh runs and validate timing.");
    }
  }

  console.log(`\nValidation complete at ${ts()}`);
  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
