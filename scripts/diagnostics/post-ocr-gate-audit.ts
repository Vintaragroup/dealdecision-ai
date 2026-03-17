/**
 * Post-OCR Gate Audit (PR29)
 *
 * Read-only diagnostic that measures the effect of PR28's OCR backfill on
 * DPU coverage, evidence gate E2, and Investor Insights report status.
 *
 * For each deal, shows:
 *   - DPU page count / nonempty pages
 *   - OCR forced / attempted page counts (PR28 provenance tags)
 *   - Effective coverage pct (with xlsx bonus)
 *   - Evidence gate pass/fail + blocking reason
 *   - Latest investor_insight_reports status
 *   - Governed sections present in latest report
 *
 * SAFETY: SELECT queries only. Never mutates DB state. Never enqueues jobs.
 *
 * Usage:
 *   pnpm tsx scripts/diagnostics/post-ocr-gate-audit.ts
 *   pnpm tsx scripts/diagnostics/post-ocr-gate-audit.ts --deal <uuid> [--deal <uuid>...]
 *   pnpm tsx scripts/diagnostics/post-ocr-gate-audit.ts --json
 *
 * Env: DATABASE_URL (falls back to .env / apps/api/.env / apps/worker/.env)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// ─── Constants (mirrors worker thresholds) ────────────────────────────────────

/** Matches EVIDENCE_GATE_COVERAGE_THRESHOLD in evidence-gate-v1.ts */
export const COVERAGE_THRESHOLD = 0.55;

/** Matches EVIDENCE_GATE_MIN_EVIDENCE_COUNT in evidence-gate-v1.ts */
export const MIN_EVIDENCE_COUNT = 25;

/** Matches DPU_OCR_BACKFILL_TEXT_THRESHOLD in dpu-ocr-backfill-v1.ts */
export const NONEMPTY_MIN_CHARS = 1;

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Compute effective coverage fraction (same formula as processor.ts line 470).
 * Returns 0 when dpuPageCount is 0 to avoid NaN.
 */
export function computeEffectiveCoverage(
  dpuNonemptyPages: number,
  xlsxBonusPages: number,
  dpuPageCount: number
): number {
  if (dpuPageCount <= 0) return 0;
  return (dpuNonemptyPages + xlsxBonusPages) / dpuPageCount;
}

/**
 * Format a coverage ratio as a percentage string with 1 decimal place.
 * e.g. 0.673 → "67.3%"
 */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Produce a short pass/fail label for a coverage ratio vs threshold.
 * e.g. "67.3% ✓ (≥55%)" or "42.1% ✗ (need ≥55%)"
 */
export function coverageLabel(ratio: number, threshold: number): string {
  const pctStr = formatPct(ratio);
  const thresholdStr = formatPct(threshold);
  return ratio >= threshold
    ? `${pctStr} ✓ (≥${thresholdStr})`
    : `${pctStr} ✗ (need ≥${thresholdStr})`;
}

/**
 * Describe the impact of OCR backfill in a short human-readable delta string.
 * Returns empty string when no OCR was attempted.
 */
export function ocrDeltaLabel(
  forcedPages: number,
  attemptedPages: number
): string {
  if (forcedPages === 0 && attemptedPages === 0) return "none";
  const parts: string[] = [];
  if (forcedPages > 0) parts.push(`${forcedPages} written`);
  if (attemptedPages > 0) parts.push(`${attemptedPages} attempted-only`);
  return parts.join(", ");
}

/**
 * Determine whether the Evidence Gate E2 passes based on raw coverage inputs.
 * Mirrors computeEvidenceGateV1 in evidence-gate-v1.ts.
 */
export function evaluateEvidenceGate(
  docsCount: number,
  dpuPageCount: number,
  nonemptyAdjusted: number,
  evidenceCount: number
): { passed: boolean; blockingReason: string | null } {
  if (docsCount < 1) return { passed: false, blockingReason: "EVIDENCE_GATE_NO_DOCUMENTS" };
  if (dpuPageCount < 1) return { passed: false, blockingReason: "EVIDENCE_GATE_NO_PAGES" };
  const pct = nonemptyAdjusted / dpuPageCount;
  if (pct < COVERAGE_THRESHOLD)
    return { passed: false, blockingReason: "EVIDENCE_GATE_LOW_COVERAGE" };
  if (evidenceCount < MIN_EVIDENCE_COUNT)
    return { passed: false, blockingReason: "EVIDENCE_GATE_LOW_EVIDENCE" };
  return { passed: true, blockingReason: null };
}

/**
 * Determine whether governed LLM sections exist in a render_package.
 * Looks for at least one of: governed_summary_v1, governed_executive_summary_v1
 * in the render_package sections array or in report_payload top-level keys.
 */
export function hasGovernedSections(
  renderPackage: Record<string, unknown> | null,
  reportPayload: Record<string, unknown> | null
): boolean {
  const governedKeys = new Set([
    "governed_summary_v1",
    "governed_executive_summary_v1",
  ]);

  // Check sections array in render_package
  const sections = renderPackage?.["sections"];
  if (Array.isArray(sections)) {
    for (const s of sections) {
      if (
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>)["key"] === "string" &&
        governedKeys.has((s as Record<string, unknown>)["key"] as string)
      ) {
        return true;
      }
    }
  }

  // Check report_payload keys
  if (reportPayload) {
    for (const k of Object.keys(reportPayload)) {
      if (governedKeys.has(k)) return true;
    }
  }

  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealCoverageMetrics {
  dealId: string;
  dealName: string | null;
  docsCount: number;
  dpuPageCount: number;
  dpuNonemptyPages: number;
  xlsxBonusPages: number;
  ocrForcedPages: number;
  ocrForceAttemptedPages: number;
  effectiveCoverage: number;
  evidenceCount: number;
  evidenceGatePassed: boolean;
  blockingReason: string | null;
  reportStatus: string | null;
  reportEngineVersion: string | null;
  reportCreatedAt: string | null;
  reportBlockingReason: string | null;
  governedSectionsPresent: boolean;
}

// ─── Env loading ──────────────────────────────────────────────────────────────

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
    )
      value = value.slice(1, -1);
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

async function loadEnvFallback(repoRoot: string) {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "apps/api/.env"),
    path.join(repoRoot, "apps/worker/.env"),
  ];
  for (const c of candidates) {
    try {
      const txt = await fs.readFile(c, "utf8");
      const parsed = parseDotenv(txt);
      if (!process.env.DATABASE_URL && parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL;
        console.log(`[env] DATABASE_URL loaded from ${c}`);
        return;
      }
    } catch {
      /* not found */
    }
  }
}

// ─── Deal audit ───────────────────────────────────────────────────────────────

/**
 * Gather all audit metrics for a single deal.
 * All sub-queries are best-effort; failures return 0/null rather than throwing.
 */
async function auditDeal(
  pool: Pool,
  dealId: string
): Promise<DealCoverageMetrics> {
  let dealName: string | null = null;
  let docsCount = 0;
  let dpuPageCount = 0;
  let dpuNonemptyPages = 0;
  let xlsxBonusPages = 0;
  let ocrForcedPages = 0;
  let ocrForceAttemptedPages = 0;
  let evidenceCount = 0;
  let reportStatus: string | null = null;
  let reportEngineVersion: string | null = null;
  let reportCreatedAt: string | null = null;
  let reportBlockingReason: string | null = null;
  let governedSectionsPresent = false;

  await Promise.allSettled([
    // Deal name
    pool
      .query<{ name: string }>(`SELECT name FROM public.deals WHERE id = $1::uuid LIMIT 1`, [dealId])
      .then(({ rows }) => { dealName = rows[0]?.name ?? null; }),

    // Document count
    pool
      .query<{ c: string }>(`SELECT COUNT(*)::bigint AS c FROM public.documents WHERE deal_id = $1::uuid`, [dealId])
      .then(({ rows }) => { docsCount = Number(rows[0]?.c ?? 0); }),

    // DPU coverage metrics (nonempty = page_text non-empty, i.e. length > 0)
    pool
      .query<{
        total: string;
        non_empty: string;
        ocr_forced: string;
        ocr_attempted: string;
        xlsx_bonus: string;
      }>(
        `SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (
             WHERE COALESCE(payload->>'page_text', '') <> ''
           )::bigint AS non_empty,
           COUNT(*) FILTER (
             WHERE COALESCE((payload->'quality_flags'->>'ocr_forced')::boolean, false) = true
           )::bigint AS ocr_forced,
           COUNT(*) FILTER (
             WHERE COALESCE((payload->'quality_flags'->>'ocr_force_attempted')::boolean, false) = true
           )::bigint AS ocr_attempted,
           COUNT(*) FILTER (
             WHERE payload->>'page_type' = 'excel_range'
               AND COALESCE(length(payload->>'page_text'), 0) < 80
               AND jsonb_typeof(payload->'rows') = 'array'
           )::bigint AS xlsx_bonus
         FROM public.document_page_understanding
        WHERE deal_id = $1::uuid`,
        [dealId]
      )
      .then(({ rows }) => {
        dpuPageCount = Number(rows[0]?.total ?? 0);
        dpuNonemptyPages = Number(rows[0]?.non_empty ?? 0);
        ocrForcedPages = Number(rows[0]?.ocr_forced ?? 0);
        ocrForceAttemptedPages = Number(rows[0]?.ocr_attempted ?? 0);
        xlsxBonusPages = Number(rows[0]?.xlsx_bonus ?? 0);
      }),

    // Evidence count
    pool
      .query<{ c: string }>(`SELECT COUNT(*)::bigint AS c FROM public.evidence_items WHERE deal_id = $1::uuid`, [dealId])
      .then(({ rows }) => { evidenceCount = Number(rows[0]?.c ?? 0); }),

    // Latest investor_insight_reports row
    pool
      .query<{
        status: string;
        engine_version: string | null;
        created_at: string;
        render_package: unknown;
        report_payload: unknown;
      }>(
        `SELECT
           status,
           engine_version,
           created_at::text,
           render_package,
           report_payload
         FROM public.investor_insight_reports
        WHERE deal_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 1`,
        [dealId]
      )
      .then(({ rows }) => {
        if (!rows[0]) return;
        const row = rows[0];
        reportStatus = row.status;
        reportEngineVersion = row.engine_version ?? null;
        reportCreatedAt = row.created_at ?? null;

        const rp =
          typeof row.render_package === "string"
            ? (JSON.parse(row.render_package) as Record<string, unknown>)
            : (row.render_package as Record<string, unknown> | null) ?? null;

        const payload =
          typeof row.report_payload === "string"
            ? (JSON.parse(row.report_payload) as Record<string, unknown>)
            : (row.report_payload as Record<string, unknown> | null) ?? null;

        // Extract blocking reason from the persisted evidence_gate in render_package
        const eg = rp?.["evidence_gate"] as Record<string, unknown> | undefined;
        if (eg && typeof eg["blocking_reason"] === "string") {
          reportBlockingReason = eg["blocking_reason"];
        }

        governedSectionsPresent = hasGovernedSections(rp, payload);
      }),
  ]);

  const effectiveCoverage = computeEffectiveCoverage(dpuNonemptyPages, xlsxBonusPages, dpuPageCount);
  const gate = evaluateEvidenceGate(docsCount, dpuPageCount, dpuNonemptyPages + xlsxBonusPages, evidenceCount);

  return {
    dealId,
    dealName,
    docsCount,
    dpuPageCount,
    dpuNonemptyPages,
    xlsxBonusPages,
    ocrForcedPages,
    ocrForceAttemptedPages,
    effectiveCoverage,
    evidenceCount,
    evidenceGatePassed: gate.passed,
    blockingReason: gate.blockingReason,
    reportStatus,
    reportEngineVersion,
    reportCreatedAt,
    reportBlockingReason,
    governedSectionsPresent,
  };
}

// ─── Reporting ────────────────────────────────────────────────────────────────

const SEPARATOR = "-".repeat(50);

function printDealReport(m: DealCoverageMetrics): void {
  const label = m.dealName ? `${m.dealName} (${m.dealId})` : m.dealId;
  console.log(`\nDeal: ${label}`);
  console.log(SEPARATOR);
  console.log(`DPU page count:        ${m.dpuPageCount}`);
  console.log(`DPU nonempty pages:    ${m.dpuNonemptyPages}`);
  console.log(`XLSX bonus pages:      ${m.xlsxBonusPages}`);
  console.log(`OCR forced pages:      ${m.ocrForcedPages}`);
  console.log(`OCR force attempted:   ${m.ocrForceAttemptedPages}`);
  console.log(`OCR delta:             ${ocrDeltaLabel(m.ocrForcedPages, m.ocrForceAttemptedPages)}`);
  console.log(`Coverage pct:          ${coverageLabel(m.effectiveCoverage, COVERAGE_THRESHOLD)}`);
  console.log(`Evidence count:        ${m.evidenceCount} (need ≥${MIN_EVIDENCE_COUNT})`);
  console.log(`Evidence gate passed:  ${m.evidenceGatePassed ? "✓ yes" : "✗ no"}`);
  console.log(`Blocking reason:       ${m.blockingReason ?? "none"}`);
  console.log(`Report status:         ${m.reportStatus ?? "no report"}`);
  if (m.reportBlockingReason) {
    console.log(`Report gate reason:    ${m.reportBlockingReason}`);
  }
  if (m.reportCreatedAt) {
    console.log(`Report created at:     ${m.reportCreatedAt}`);
  }
  console.log(`Governed sections:     ${m.governedSectionsPresent ? "yes" : "no"}`);
  console.log(SEPARATOR);
}

// ─── Default deals (same as audit-populate-registries.ts) ────────────────────

const DEFAULT_DEALS: Record<string, string> = {
  "DealDecision (failing deal)": "517be946-cab9-4bc1-8982-9522ff9dab32",
  WebMax: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
  Cinco: "0fcec035-9aa3-4f6e-88fa-818c323add09",
};

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const repoRoot = process.cwd();
  await loadEnvFallback(repoRoot);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[post-ocr-gate-audit] ERROR: DATABASE_URL not set.");
    process.exit(1);
  }

  // Collect --deal <uuid> args
  const dealArgs: Array<[string, string]> = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--deal" && process.argv[i + 1]) {
      const id = process.argv[i + 1]!;
      dealArgs.push([id, id]);
      i++;
    }
  }
  const jsonMode = process.argv.includes("--json");

  const dealsToAudit: Array<[string, string]> =
    dealArgs.length > 0 ? dealArgs : Object.entries(DEFAULT_DEALS);

  const pool = new Pool({ connectionString: dbUrl, max: 3 });

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Post-OCR Gate Audit — ${new Date().toISOString()}`);
  console.log(`Deals audited: ${dealsToAudit.length}`);
  console.log(`Coverage threshold: ${formatPct(COVERAGE_THRESHOLD)}`);
  console.log(`=`.repeat(50));

  const results: DealCoverageMetrics[] = [];

  for (const [_label, dealId] of dealsToAudit) {
    try {
      const metrics = await auditDeal(pool, dealId);
      results.push(metrics);
      if (!jsonMode) printDealReport(metrics);
    } catch (err) {
      console.error(`[post-ocr-gate-audit] ERROR auditing deal ${dealId}:`, err);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    // Summary table
    const pass = results.filter((r) => r.evidenceGatePassed).length;
    const fail = results.length - pass;
    const ocrActive = results.filter((r) => r.ocrForcedPages > 0).length;
    const governed = results.filter((r) => r.governedSectionsPresent).length;

    console.log(`\n${"=".repeat(50)}`);
    console.log("SUMMARY");
    console.log(`${"=".repeat(50)}`);
    console.log(`Deals:           ${results.length}`);
    console.log(`E2 pass:         ${pass} / ${results.length}`);
    console.log(`E2 fail:         ${fail} / ${results.length}`);
    console.log(`OCR active:      ${ocrActive} (deals with ocr_forced_pages > 0)`);
    console.log(`Governed sects:  ${governed} / ${results.length}`);
    console.log(`=`.repeat(50));
  }

  await pool.end();
}

// Guard: only auto-run when invoked directly, not when imported by tests.
const _isDirectRun = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(self);
  } catch {
    return false;
  }
})();

if (_isDirectRun) {
  main().catch((err) => {
    console.error("[post-ocr-gate-audit] FATAL", err);
    process.exit(1);
  });
}
