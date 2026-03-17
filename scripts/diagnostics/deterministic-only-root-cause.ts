export {};

/**
 * Deterministic-Only Root Cause Diagnostic
 *
 * For each deal, explains exactly why the investor_insight_reports row has
 * status = 'deterministic_only':
 *
 *   RC-1  old_engine_pre_gate      — report was generated before the evidence
 *                                    gate feature existed (< ~2026-02-25).
 *   RC-2  evidence_gate_failed     — E2 coverage gate blocked LLM stages.
 *                                    LLM was explicitly skipped.
 *   RC-3  governed_summary_val_failed — evidence gate passed, LLM ran, but
 *                                    buildGovernedSummarySection returned null
 *                                    because validation_ok was false.
 *   RC-4  governed_stages_not_run  — evidence gate passed, expected LLM output
 *                                    absent with no known reason (investigate).
 *   RC-5  llm_ran_completely       — all governed sections present; status is
 *                                    deterministic_only by design (engine always
 *                                    emits this status).
 *
 * SAFETY: SELECT queries only. No writes, no job enqueues.
 *
 * Usage:
 *   pnpm tsx scripts/diagnostics/deterministic-only-root-cause.ts
 *   pnpm tsx scripts/diagnostics/deterministic-only-root-cause.ts --deal <uuid>
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

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
    } catch { /* not found */ }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RootCauseCode =
  | "old_engine_pre_gate"
  | "evidence_gate_failed"
  | "governed_summary_val_failed"
  | "governed_stages_not_run"
  | "llm_ran_completely"
  | "no_report"
  | "unknown";

type GatingClass = "skipped_due_to_gate" | "failed_in_llm_stage" | "not_enqueued" | "llm_ran" | "n/a";

interface EvidenceGate {
  passed: boolean;
  blocking_reason: string | null;
  metrics?: Record<string, unknown>;
  results?: Array<{ gate: string; actual: unknown; passed: boolean; threshold?: unknown; reason_code?: string | null }>;
}

interface AuditFooter {
  stage: string;
  generated_at: string;
  engine_version?: string;
}

interface InvestorInsightRow {
  id: string;
  status: string;
  engine_version: string | null;
  created_at: string;
  updated_at: string;
  audit_footer: AuditFooter | null;
  evidence_gate: EvidenceGate | null;
  section_keys: string[];
  payload_keys: string[];
}

interface GovernedPresence {
  governed_summary_in_sections: boolean;
  governed_summary_body: boolean;
  governed_exec_in_sections: boolean;
  governed_exec_body: boolean;
  product_profile_in_sections: boolean;
  product_profile_body: boolean;
  evidence_quality_gate_in_sections: boolean;
  insight_slots_in_sections: boolean;
}

interface AnalyzeJobRow {
  status: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

interface DealRootCause {
  dealName: string;
  dealId: string;
  reportRow: InvestorInsightRow | null;
  governed: GovernedPresence | null;
  latestAnalyzeJob: AnalyzeJobRow | null;
  rootCauseCode: RootCauseCode;
  gatingClass: GatingClass;
  rootCauseSummary: string;
  evidenceGateDetail: string | null;
  governedOutputSummary: string;
  uiBadgeImpact: string;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function loadReportRow(pool: Pool, dealId: string): Promise<InvestorInsightRow | null> {
  const { rows } = await pool.query<{
    id: string;
    status: string;
    engine_version: string | null;
    created_at: string;
    updated_at: string;
    audit_footer: AuditFooter | null;
    evidence_gate: EvidenceGate | null;
    section_keys: string[];
    payload_keys: string[];
  }>(
    `SELECT
       id::text,
       status,
       engine_version,
       created_at::text,
       updated_at::text,
       render_package->'audit_footer'                     AS audit_footer,
       render_package->'evidence_gate'                    AS evidence_gate,
       COALESCE(
         ARRAY(SELECT s->>'key' FROM jsonb_array_elements(render_package->'sections') s),
         '{}'
       )                                                   AS section_keys,
       COALESCE(
         ARRAY(SELECT k FROM jsonb_object_keys(report_payload) k),
         '{}'
       )                                                   AS payload_keys
     FROM investor_insight_reports
     WHERE deal_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [dealId]
  );
  if (!rows[0]) return null;
  return rows[0] as InvestorInsightRow;
}

async function loadGovernedPresence(
  pool: Pool,
  dealId: string
): Promise<GovernedPresence> {
  const { rows } = await pool.query<{
    key: string;
    has_body: boolean;
  }>(
    `SELECT
       s->>'key'                                         AS key,
       length(coalesce(s->>'body','')) > 10             AS has_body
     FROM investor_insight_reports i,
          jsonb_array_elements(i.render_package->'sections') s
     WHERE i.deal_id = $1
     ORDER BY i.updated_at DESC
     LIMIT 50`,
    [dealId]
  );

  const sectionMap = new Map<string, boolean>();
  for (const r of rows) {
    sectionMap.set(r.key, Boolean(r.has_body));
  }

  return {
    governed_summary_in_sections: sectionMap.has("governed_summary_v1"),
    governed_summary_body: Boolean(sectionMap.get("governed_summary_v1")),
    governed_exec_in_sections: sectionMap.has("governed_executive_summary_v1"),
    governed_exec_body: Boolean(sectionMap.get("governed_executive_summary_v1")),
    product_profile_in_sections: sectionMap.has("product_profile_v1"),
    product_profile_body: Boolean(sectionMap.get("product_profile_v1")),
    evidence_quality_gate_in_sections: sectionMap.has("evidence_quality_gate"),
    insight_slots_in_sections: sectionMap.has("insight_slots"),
  };
}

async function loadLatestAnalyzeJob(
  pool: Pool,
  dealId: string
): Promise<AnalyzeJobRow | null> {
  const { rows } = await pool.query<AnalyzeJobRow>(
    `SELECT
       status,
       created_at::text,
       finished_at::text,
       error
     FROM jobs
     WHERE deal_id = $1
       AND type = 'analyze_deal'
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  return rows[0] ?? null;
}

// ── Root cause classification ─────────────────────────────────────────────────

function classifyRootCause(
  row: InvestorInsightRow,
  governed: GovernedPresence,
  job: AnalyzeJobRow | null
): {
  code: RootCauseCode;
  gatingClass: GatingClass;
  summary: string;
  evidenceGateDetail: string | null;
  governedOutputSummary: string;
  uiBadgeImpact: string;
} {
  // RC-1: No evidence_gate field = old engine
  if (row.evidence_gate === null) {
    return {
      code: "old_engine_pre_gate",
      gatingClass: "not_enqueued",
      summary:
        "Report was generated by an older engine version before the evidence gate and LLM stages were implemented. LLM stages were never part of this run.",
      evidenceGateDetail: null,
      governedOutputSummary: "No governed sections present (old engine).",
      uiBadgeImpact:
        'Overview shows deterministic-only values. "Needs review" / "No explicit citation" may appear for factual fields that have no overlay. Re-running analyze_deal with current engine will regenerate.',
    };
  }

  // RC-2: Evidence gate failed
  if (!row.evidence_gate.passed) {
    const failedGates = (row.evidence_gate.results ?? [])
      .filter((r) => !r.passed)
      .map((r) => `${r.gate} (actual=${r.actual}, threshold=${r.threshold}, reason=${r.reason_code ?? "none"})`)
      .join("; ");
    const blocking = row.evidence_gate.blocking_reason ?? "unknown";
    return {
      code: "evidence_gate_failed",
      gatingClass: "skipped_due_to_gate",
      summary: `Evidence gate failed with blocking_reason="${blocking}". LLM stages (governed_summary_v1, governed_executive_summary_v1, product_profile_v1) were explicitly skipped. Failed gate(s): ${failedGates}.`,
      evidenceGateDetail: `blocking_reason=${blocking}; failed_gates=[${failedGates}]; coverage_pct=${(row.evidence_gate.metrics as any)?.coverage_pct ?? "n/a"}`,
      governedOutputSummary:
        "Governed summaries: none (evidence gate blocked LLM call). Deterministic sections (insight_slots, canonical_fields, investor_thesis) are present.",
      uiBadgeImpact:
        '"evidence_quality_gate" section in render_package surfaces as an inline warning in the UI. Fields derived from governed overlay will show "Not extracted from evidence" (missing provenance). No "Needs review" badge since overlay is absent. "No explicit citation" may appear if evidence_basis is set to no_evidence.',
    };
  }

  // Evidence gate passed — check governed output presence
  const hasAnyGoverned =
    governed.governed_summary_in_sections ||
    governed.governed_exec_in_sections ||
    governed.product_profile_in_sections;
  const hasAllGoverned =
    governed.governed_summary_in_sections &&
    governed.governed_summary_body &&
    governed.governed_exec_in_sections &&
    governed.governed_exec_body;

  if (hasAllGoverned) {
    // RC-5: LLM ran completely (status is deterministic_only by design)
    return {
      code: "llm_ran_completely",
      gatingClass: "llm_ran",
      summary:
        "Evidence gate passed. LLM stages ran and produced governed_summary_v1 + governed_executive_summary_v1. Status is 'deterministic_only' by engine design — this is the expected happy-path status code.",
      evidenceGateDetail: `passed=true; coverage_pct=${(row.evidence_gate.metrics as any)?.coverage_pct ?? "n/a"}`,
      governedOutputSummary:
        `governed_summary_v1: ${governed.governed_summary_body ? "present (has body)" : "present (empty body)"}; ` +
        `governed_executive_summary_v1: ${governed.governed_exec_body ? "present (has body)" : "present (empty body)"}; ` +
        `product_profile_v1: ${governed.product_profile_in_sections ? (governed.product_profile_body ? "present (has body)" : "present (empty)") : "absent"}.`,
      uiBadgeImpact:
        "LLM summary is present and should render in the governed overlay. 'Needs review' badge will only appear if the overlay quality token is 'fallback'. 'No explicit citation' may appear for fields where no evidence_ids were extracted.",
    };
  }

  if (hasAnyGoverned) {
    // RC-3: Partial — some LLM sections present but governed_summary_v1 failed validation
    const present: string[] = [];
    const absent: string[] = [];
    if (governed.governed_summary_in_sections) present.push("governed_summary_v1");
    else absent.push("governed_summary_v1");
    if (governed.governed_exec_in_sections) present.push("governed_executive_summary_v1");
    else absent.push("governed_executive_summary_v1");
    if (governed.product_profile_in_sections) present.push("product_profile_v1");
    else absent.push("product_profile_v1");

    return {
      code: "governed_summary_val_failed",
      gatingClass: "failed_in_llm_stage",
      summary: `Evidence gate passed. LLM stages ran but buildGovernedSummarySection returned null (validation_ok=false, likely unknown tokens or empty corpus). Present: [${present.join(", ")}]. Absent: [${absent.join(", ")}].`,
      evidenceGateDetail: `passed=true; coverage_pct=${(row.evidence_gate.metrics as any)?.coverage_pct ?? "n/a"}`,
      governedOutputSummary:
        `governed_summary_v1: ${governed.governed_summary_in_sections ? "present" : "ABSENT (validation failed)"}; ` +
        `governed_executive_summary_v1: ${governed.governed_exec_in_sections ? (governed.governed_exec_body ? "present (has body)" : "present (empty)") : "absent"}; ` +
        `product_profile_v1: ${governed.product_profile_in_sections ? (governed.product_profile_body ? "present (has body)" : "present (empty)") : "absent"}.`,
      uiBadgeImpact:
        `Primary governed_summary_v1 is missing from render_package.sections. The executive summary (${governed.governed_exec_in_sections ? "present" : "absent"}) and product profile (${governed.product_profile_in_sections ? "present" : "absent"}) may still render. UI fields that rely on governed_summary_v1 will fall back to deterministic values. Root fix: investigate validation_ok=false cause in worker logs (GOVERNED_SUMMARY_V1_SKIP event).`,
    };
  }

  // RC-4: Evidence gate passed but NO governed output at all
  return {
    code: "governed_stages_not_run",
    gatingClass: "failed_in_llm_stage",
    summary:
      "Evidence gate passed but no governed sections (governed_summary_v1, governed_executive_summary_v1, product_profile_v1) are present. LLM stages may have crashed silently or been skipped by an older code path. Check worker logs for GOVERNED_SUMMARY_V1_SKIP or INVESTOR_INSIGHTS errors.",
    evidenceGateDetail: `passed=true; coverage_pct=${(row.evidence_gate.metrics as any)?.coverage_pct ?? "n/a"}`,
    governedOutputSummary: "All governed sections absent.",
    uiBadgeImpact:
      "UI Overview shows deterministic-only values for all key fact fields. No LLM-derived content available. Re-running analyze_deal should trigger the full LLM path.",
  };
}

// ── Per-deal analysis ─────────────────────────────────────────────────────────

async function analyzeDeal(
  pool: Pool,
  dealId: string,
  dealName: string
): Promise<DealRootCause> {
  const [row, job] = await Promise.all([
    loadReportRow(pool, dealId),
    loadLatestAnalyzeJob(pool, dealId),
  ]);

  if (!row) {
    return {
      dealName,
      dealId,
      reportRow: null,
      governed: null,
      latestAnalyzeJob: job,
      rootCauseCode: "no_report",
      gatingClass: "not_enqueued",
      rootCauseSummary: "No investor_insight_reports row found. analyze_deal may never have run for this deal.",
      evidenceGateDetail: null,
      governedOutputSummary: "No report row.",
      uiBadgeImpact: "Overview tab will show empty/loading state. Trigger analyze_deal to generate a report.",
    };
  }

  const governed = await loadGovernedPresence(pool, dealId);
  const classification = classifyRootCause(row, governed, job);

  return {
    dealName,
    dealId,
    reportRow: row,
    governed,
    latestAnalyzeJob: job,
    rootCauseCode: classification.code,
    gatingClass: classification.gatingClass,
    rootCauseSummary: classification.summary,
    evidenceGateDetail: classification.evidenceGateDetail,
    governedOutputSummary: classification.governedOutputSummary,
    uiBadgeImpact: classification.uiBadgeImpact,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const RC_LABEL: Record<RootCauseCode, string> = {
  old_engine_pre_gate:          "OLD ENGINE (pre-gate)",
  evidence_gate_failed:         "EVIDENCE GATE BLOCKED LLM",
  governed_summary_val_failed:  "LLM RAN / VALIDATION FAILED",
  governed_stages_not_run:      "LLM STAGES SKIPPED (UNKNOWN)",
  llm_ran_completely:           "LLM RAN COMPLETELY (by design)",
  no_report:                    "NO REPORT",
  unknown:                      "UNKNOWN",
};

const GC_LABEL: Record<GatingClass, string> = {
  skipped_due_to_gate: "SKIPPED_DUE_TO_GATE",
  failed_in_llm_stage: "FAILED_IN_LLM_STAGE",
  not_enqueued:        "NOT_ENQUEUED",
  llm_ran:             "LLM_RAN_OK",
  "n/a":               "N/A",
};

function printDealReport(r: DealRootCause): void {
  const sep = "─".repeat(60);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${r.dealName}`);
  console.log(`  ${r.dealId}`);
  console.log(`${"═".repeat(60)}`);

  if (!r.reportRow) {
    console.log(`  !! No investor_insight_reports row found`);
    return;
  }

  const rr = r.reportRow;
  console.log(`\n  Report`);
  console.log(`    id:             ${rr.id.slice(0, 8)}…`);
  console.log(`    status:         ${rr.status}`);
  console.log(`    engine_version: ${rr.engine_version ?? "?"}`);
  console.log(`    updated_at:     ${rr.updated_at}`);
  console.log(`    audit_footer:   stage=${rr.audit_footer?.stage ?? "?"}`);

  console.log(`\n  Evidence Gate`);
  if (!rr.evidence_gate) {
    console.log(`    null/missing (old engine)`);
  } else {
    console.log(`    passed:   ${rr.evidence_gate.passed}`);
    console.log(`    blocking: ${rr.evidence_gate.blocking_reason ?? "none"}`);
    if (rr.evidence_gate.results) {
      for (const res of rr.evidence_gate.results) {
        const mark = res.passed ? "✓" : "✗";
        console.log(
          `    ${mark} ${res.gate.padEnd(4)} actual=${res.actual} threshold=${res.threshold ?? "n/a"} reason=${res.reason_code ?? "—"}`
        );
      }
    }
  }

  if (r.governed) {
    const gp = r.governed;
    console.log(`\n  Governed Output Presence`);
    const rows: Array<[string, boolean, boolean]> = [
      ["governed_summary_v1",          gp.governed_summary_in_sections, gp.governed_summary_body],
      ["governed_executive_summary_v1", gp.governed_exec_in_sections,   gp.governed_exec_body],
      ["product_profile_v1",           gp.product_profile_in_sections, gp.product_profile_body],
      ["evidence_quality_gate",        gp.evidence_quality_gate_in_sections, false],
      ["insight_slots",                gp.insight_slots_in_sections,   true],
    ];
    for (const [key, inSecs, hasBody] of rows) {
      const mark = inSecs ? (hasBody ? "✓" : "△ (no body)") : "✗";
      console.log(`    ${mark.padEnd(14)} ${key}`);
    }
  }

  console.log(`\n  Latest analyze_deal Job`);
  if (!r.latestAnalyzeJob) {
    console.log(`    None found`);
  } else {
    const j = r.latestAnalyzeJob;
    console.log(`    status:  ${j.status}`);
    console.log(`    at:      ${j.created_at}`);
    if (j.error) {
      console.log(`    error:   ${j.error.slice(0, 120)}`);
    }
  }

  console.log(`\n  ${sep}`);
  console.log(`  ROOT CAUSE CODE:   ${RC_LABEL[r.rootCauseCode]}`);
  console.log(`  GATING CLASS:      ${GC_LABEL[r.gatingClass]}`);
  console.log(`\n  Summary:`);
  for (const line of wordWrap(r.rootCauseSummary, 56)) {
    console.log(`    ${line}`);
  }

  if (r.evidenceGateDetail) {
    console.log(`\n  Evidence Gate Detail:`);
    console.log(`    ${r.evidenceGateDetail}`);
  }

  console.log(`\n  Governed Output:`);
  for (const line of wordWrap(r.governedOutputSummary, 56)) {
    console.log(`    ${line}`);
  }

  console.log(`\n  UI Badge Impact:`);
  for (const line of wordWrap(r.uiBadgeImpact, 56)) {
    console.log(`    ${line}`);
  }
}

function wordWrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + w.length + 1 > width && current.length > 0) {
      lines.push(current);
      current = w;
    } else {
      current = current.length === 0 ? w : `${current} ${w}`;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const DEFAULT_DEALS: Array<{ id: string; name: string }> = [
  { id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f", name: "StackFactor" },
  { id: "517be946-cab9-4bc1-8982-9522ff9dab32", name: "Deal Decision" },
  { id: "c4f10092-1c94-4116-b4f0-78874868f92b", name: "Palm" },
];

async function main() {
  const repoRoot = process.cwd();
  await loadEnvFallback(repoRoot);

  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set.");
    process.exit(1);
  }

  // Parse --deal flags
  const cliDeals: Array<{ id: string; name: string }> = [];
  for (let i = 2; i < process.argv.length; i++) {
    if ((process.argv[i] === "--deal" || process.argv[i] === "--deal-id") && process.argv[i + 1]) {
      cliDeals.push({ id: process.argv[i + 1], name: process.argv[i + 1] });
      i++;
    }
  }
  const deals = cliDeals.length > 0 ? cliDeals : DEFAULT_DEALS;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Deterministic-Only Root Cause Diagnostic`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Analyzing ${deals.length} deal(s) — read-only`);
  console.log(`${"═".repeat(60)}`);

  const results: DealRootCause[] = [];

  for (const deal of deals) {
    try {
      const r = await analyzeDeal(pool, deal.id, deal.name);
      results.push(r);
      printDealReport(r);
    } catch (err) {
      console.error(`\n[ERROR] ${deal.name} (${deal.id}): ${err}`);
    }
  }

  // Summary table
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(
    `${"Deal".padEnd(20)} ${"Root Cause Code".padEnd(32)} ${"Gating Class"}`
  );
  console.log("─".repeat(72));
  for (const r of results) {
    console.log(
      `${r.dealName.padEnd(20)} ${r.rootCauseCode.padEnd(32)} ${r.gatingClass}`
    );
  }

  console.log(`\nLegend:`);
  for (const [code, label] of Object.entries(RC_LABEL)) {
    console.log(`  ${code.padEnd(36)} = ${label}`);
  }

  console.log("");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
