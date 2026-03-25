#!/usr/bin/env tsx
/**
 * audit-financials-portfolio.ts
 *
 * Portfolio-wide financial audit verification system.
 *
 * Phases:
 *   1. Discovery — query all deals × latest ingestion_reports × financial_facts_v1
 *   2. Classification — extract signals + assign primary/secondary issue codes
 *   3. Scoring — assign PASS / PARTIAL / FAIL per deal
 *   4. Output — write JSON + Markdown artifacts
 *   5. Verification — enforce cross-cutting invariants
 *   6. Aggregation — group deals by root cause, rank by severity + frequency
 *   7. Backlog — generate prioritized engineering backlog
 *
 * Usage:
 *   pnpm audit:financials
 *   pnpm audit:financials --out-dir artifacts
 *   pnpm audit:financials --fail-on-any           # exit 1 if any FAIL
 *   pnpm audit:financials --json                  # print JSON to stdout (no file output)
 *   pnpm audit:financials --summary-only          # skip per-deal status list
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FLAG_FAIL = args.includes("--fail-on-any");
const FLAG_JSON = args.includes("--json");
const FLAG_SUMMARY_ONLY = args.includes("--summary-only");
const outDirArg = (() => {
  const i = args.indexOf("--out-dir");
  return i !== -1 ? (args[i + 1] ?? "artifacts") : "artifacts";
})();

// ─── DB connection ─────────────────────────────────────────────────────────────

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

async function loadEnvFallback(repoRoot: string): Promise<void> {
  if (process.env.DATABASE_URL) return;
  for (const f of [".env", "apps/api/.env"]) {
    try {
      const txt = await fs.readFile(path.join(repoRoot, f), "utf8");
      const parsed = parseDotenv(txt);
      if (parsed.DATABASE_URL) { process.env.DATABASE_URL = parsed.DATABASE_URL; return; }
    } catch { /* ignore */ }
  }
}

type PgPool = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};

async function getPool(repoRoot: string): Promise<PgPool> {
  await loadEnvFallback(repoRoot);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Set it in your shell or in .env / apps/api/.env");
  const { Pool } = (await import("pg")) as unknown as { Pool: new (opts: { connectionString: string }) => PgPool };
  return new Pool({ connectionString });
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type AuditStatus = "PASS" | "PARTIAL" | "FAIL" | "NO_DATA";

interface FinancialIntegritySnapshot {
  has_facts: boolean | null;
  completeness_score: number | null;
  missing_critical: string[];
  flag_count_fail: number;
  flag_count_warn: number;
}

interface UnderwritingReadinessSnapshot {
  status: string | null;
  score: number | null;
  gaps: string[];
}

interface FinancialBreakdownSnapshot {
  has_xlsx: boolean | null;
  has_current_state: boolean | null;
  has_projections: boolean | null;
  has_cap_table: boolean | null;
}

interface DealAuditRecord {
  deal_id: string;
  deal_name: string;
  analysis_version: number;
  compiler_version: string | null;
  report_updated_at: string | null;

  // Signals
  breakdown: FinancialBreakdownSnapshot;
  integrity: FinancialIntegritySnapshot;
  readiness: UnderwritingReadinessSnapshot;

  // Fact counts
  total_facts: number;
  xlsx_facts: number;
  pdf_table_facts: number;
  max_fact_ts: string | null;

  // Document inventory (live, from documents table)
  xlsx_docs_in_db: number;

  // Derived flags
  missing_current_state: boolean;
  missing_projections: boolean;
  missing_cap_table_data: boolean;
  integrity_gap: boolean;     // has_facts but completeness=0
  readiness_mismatch: boolean; // FAILs in integrity but readiness not penalised

  // Score
  status: AuditStatus;
  failure_reasons: string[];
  warnings: string[];

  // System-level issue diagnosis
  primary_issue_code: IssueCode;
  secondary_issue_codes: IssueCode[];
}

interface PortfolioAuditReport {
  generated_at: string;
  total_deals: number;
  summary: {
    pass: number;
    partial: number;
    fail: number;
    no_data: number;
    coverage_pct: number;
    xlsx_coverage_pct: number;
    projections_coverage_pct: number;
    cap_table_coverage_pct: number;
  };
  by_failure_type: Record<string, number>;
  compiler_version_spread: Record<string, number>;
  deals: DealAuditRecord[];
}

// ─── Issue Codes & Metadata ───────────────────────────────────────────────────

type IssueSeverity = "critical" | "high" | "medium" | "low";

type IssueCode =
  | "NO_DATA"
  | "XLSX_NOT_DETECTED"
  | "FACTS_PRESENT_NO_BREAKDOWN"
  | "MISSING_CURRENT_STATE"
  | "MISSING_PROJECTIONS"
  | "MISSING_CAP_TABLE"
  | "INTEGRITY_NO_FACTS"
  | "INTEGRITY_ZERO_SCORE"
  | "READINESS_MISMATCH"
  | "STALE_REPORT"
  | "PDF_FACTS_ONLY"
  | "UNKNOWN";

const ISSUE_METADATA: Record<IssueCode, { severity: IssueSeverity; description: string; recommended_fixes: string[] }> = {
  NO_DATA: {
    severity: "critical",
    description: "No financial signals whatsoever — no xlsx, no facts, no breakdown compiled",
    recommended_fixes: [
      "Verify document upload completed for this deal",
      "Check worker ingestion queue for stuck jobs",
      "Re-trigger document extraction pipeline",
    ],
  },
  XLSX_NOT_DETECTED: {
    severity: "critical",
    description: "XLSX document(s) exist in DB but report was compiled without detecting them — stale cache",
    recommended_fixes: [
      "Re-trigger analysis pipeline to regenerate the cached report",
      "Validate getDocumentsForReport() returns correct mime_type for XLSX documents",
      "Verify isXlsxLikeDocument() MIME check fires for spreadsheetml MIME type",
    ],
  },
  PDF_FACTS_ONLY: {
    severity: "low",
    description: "Facts extracted from PDF/PPTX sources only — no XLSX financial model has been uploaded",
    recommended_fixes: [
      "Request a structured financial model (XLSX) from the founder",
      "Upload financial model to trigger XLSX extraction pipeline",
    ],
  },
  FACTS_PRESENT_NO_BREAKDOWN: {
    severity: "critical",
    description: "Facts extracted but financial_breakdown_v1 was not compiled into report",
    recommended_fixes: [
      "Check report compiler version — upgrade deals on old compiler",
      "Verify compileDIOToReportWithPromotedFacts() produces financial_breakdown_v1",
      "Re-run analysis to regenerate report with current compiler",
    ],
  },
  MISSING_CURRENT_STATE: {
    severity: "high",
    description: "XLSX detected but no current-state financials extracted",
    recommended_fixes: [
      "Inspect XLSX sheet structure for this deal",
      "Check financial table claim extractor routing",
      "Verify temporal_scope classification for 'current' period",
    ],
  },
  MISSING_PROJECTIONS: {
    severity: "medium",
    description: "XLSX detected but no forward-looking projections extracted",
    recommended_fixes: [
      "Check if deal's XLSX contains a projections / forecast sheet",
      "Verify isProjectedFact() logic in extract-financial-table-claims.ts",
      "Inspect period_label classification for future-dated rows",
    ],
  },
  MISSING_CAP_TABLE: {
    severity: "medium",
    description: "No cap table data found despite significant fact volume",
    recommended_fixes: [
      "Check if cap table document was uploaded",
      "Verify cap table extraction routing in worker",
      "Inspect cap-table-parser.ts for coverage gaps",
    ],
  },
  INTEGRITY_NO_FACTS: {
    severity: "high",
    description: "financial_integrity_v1 computed but has_facts=false — no financial facts present",
    recommended_fixes: [
      "Re-run financial fact extraction for this deal",
      "Check financial_facts_v1 table for this deal_id",
      "Verify fact promotion pipeline: extracted facts → financial_facts_v1",
    ],
  },
  INTEGRITY_ZERO_SCORE: {
    severity: "medium",
    description: "has_facts=true but completeness_score=0 — facts exist but metric scoring failed",
    recommended_fixes: [
      "Check fact reconciliation logic in financial_integrity pipeline",
      "Verify metric completeness scorer operates on all fact source_kinds",
      "Look for source_kind mismatch between XLSX facts and completeness checker",
    ],
  },
  READINESS_MISMATCH: {
    severity: "low",
    description: "Integrity has FAIL flags but readiness score is not penalized",
    recommended_fixes: [
      "Review underwriting_readiness_v1 scoring logic",
      "Verify integrity FAIL flags propagate to readiness gap list",
    ],
  },
  STALE_REPORT: {
    severity: "low",
    description: "Report has not been regenerated recently (> 30 days)",
    recommended_fixes: [
      "Re-run analysis to regenerate report",
      "Check if new documents have been uploaded since last run",
    ],
  },
  UNKNOWN: {
    severity: "low",
    description: "Issue does not match any known pattern — manual inspection required",
    recommended_fixes: [
      "Manual inspection required",
      "Check raw ingestion_reports.summary for anomalies",
    ],
  },
};

// Priority order for primary issue assignment (lower index = higher priority)
const ISSUE_PRIORITY: IssueCode[] = [
  "NO_DATA",
  "XLSX_NOT_DETECTED",
  "FACTS_PRESENT_NO_BREAKDOWN",
  "MISSING_CURRENT_STATE",
  "MISSING_PROJECTIONS",
  "MISSING_CAP_TABLE",
  "INTEGRITY_NO_FACTS",
  "INTEGRITY_ZERO_SCORE",
  "READINESS_MISMATCH",
  "STALE_REPORT",
  "PDF_FACTS_ONLY",
  "UNKNOWN",
];

interface IssueEntry {
  issue_code: IssueCode;
  severity: IssueSeverity;
  count: number;
  percentage: number;
  affected_deals: string[];
  sample_deals: { deal_id: string; name: string }[];
}

interface IssueAggregation {
  generated_at: string;
  total_deals: number;
  summary: { pass: number; partial: number; fail: number; no_data: number };
  issues: IssueEntry[];
}

// ─── Phase 1 — Discovery ──────────────────────────────────────────────────────

const DISCOVERY_SQL = `
WITH latest_ir AS (
  SELECT DISTINCT ON (deal_id)
    deal_id,
    analysis_version     AS ir_analysis_version,
    summary              AS ir_summary,
    GREATEST(created_at, updated_at) AS ir_report_updated_at
  FROM ingestion_reports
  ORDER BY deal_id, analysis_version DESC
),
-- DIO is the canonical live report store (API /report reads from here).
-- ingestion_reports may lag behind when analyze_deal refreshes without incrementing version.
latest_dio AS (
  SELECT DISTINCT ON (deal_id)
    deal_id,
    analysis_version     AS dio_analysis_version,
    dio_data             AS dio_summary,
    GREATEST(created_at, updated_at) AS dio_report_updated_at
  FROM deal_intelligence_objects
  ORDER BY deal_id, analysis_version DESC, updated_at DESC
),
-- Prefer DIO when it is newer than ingestion_reports for the same deal
merged AS (
  SELECT
    COALESCE(dio.deal_id, ir.deal_id)               AS deal_id,
    COALESCE(dio.dio_analysis_version,
             ir.ir_analysis_version)                 AS analysis_version,
    -- Use DIO when it has report data AND (no IR exists OR DIO updated_at >= IR updated_at)
    CASE
      WHEN dio.deal_id IS NOT NULL
        AND dio.dio_summary->'report' IS NOT NULL
        AND (ir.deal_id IS NULL
             OR dio.dio_report_updated_at >= ir.ir_report_updated_at)
      THEN dio.dio_summary
      ELSE ir.ir_summary
    END                                              AS report_summary,
    CASE
      WHEN dio.deal_id IS NOT NULL
        AND dio.dio_summary->'report' IS NOT NULL
        AND (ir.deal_id IS NULL
             OR dio.dio_report_updated_at >= ir.ir_report_updated_at)
      THEN dio.dio_report_updated_at
      ELSE ir.ir_report_updated_at
    END                                              AS report_updated_at
  FROM latest_ir ir
  FULL OUTER JOIN latest_dio dio ON dio.deal_id = ir.deal_id
),
fact_counts AS (
  SELECT
    deal_id,
    COUNT(*)                                                   AS total_facts,
    COUNT(*) FILTER (WHERE source_kind = 'xlsx')               AS xlsx_facts,
    COUNT(*) FILTER (WHERE source_kind = 'pdf_table')          AS pdf_table_facts,
    MAX(created_at)                                            AS max_fact_ts
  FROM financial_facts_v1
  GROUP BY deal_id
),
doc_xlsx AS (
  SELECT
    deal_id,
    COUNT(*) FILTER (
      WHERE mime_type ILIKE '%spreadsheetml%'
         OR mime_type ILIKE '%excel%'
         OR lower(title) LIKE '%.xlsx'
         OR lower(title) LIKE '%.xls'
    ) AS xlsx_docs_in_db
  FROM documents
  WHERE deleted_at IS NULL
  GROUP BY deal_id
)
SELECT
  d.id                                                              AS deal_id,
  d.name                                                            AS deal_name,
  mr.analysis_version,
  mr.report_updated_at,

  -- Compiler version
  mr.report_summary->'report'->>'__compiler_version'                AS compiler_version,

  -- financial_breakdown_v1
  (mr.report_summary->'report'->'financial_breakdown_v1'->>'has_xlsx')             AS has_xlsx,
  (mr.report_summary->'report'->'financial_breakdown_v1'->>'has_current_state')    AS has_current_state,
  (mr.report_summary->'report'->'financial_breakdown_v1'->>'has_projections')      AS has_projections,
  (mr.report_summary->'report'->'financial_breakdown_v1'->>'has_cap_table')        AS has_cap_table,

  -- financial_integrity_v1
  (mr.report_summary->'report'->'financial_integrity_v1'->>'has_facts')            AS fi_has_facts,
  (mr.report_summary->'report'->'financial_integrity_v1'->>'completeness_score')   AS fi_completeness_score,
  (mr.report_summary->'report'->'financial_integrity_v1'->'missing_critical')      AS fi_missing_critical,
  (mr.report_summary->'report'->'financial_integrity_v1'->'flags')                 AS fi_flags,

  -- underwriting_readiness_v1
  (mr.report_summary->'report'->'underwriting_readiness_v1'->>'status')            AS ur_status,
  (mr.report_summary->'report'->'underwriting_readiness_v1'->>'score')             AS ur_score,
  (mr.report_summary->'report'->'underwriting_readiness_v1'->'gaps')               AS ur_gaps,

  -- fact counts
  COALESCE(fc.total_facts, 0)    AS total_facts,
  COALESCE(fc.xlsx_facts, 0)     AS xlsx_facts,
  COALESCE(fc.pdf_table_facts, 0) AS pdf_table_facts,
  fc.max_fact_ts,

  COALESCE(dx.xlsx_docs_in_db, 0) AS xlsx_docs_in_db

FROM deals d
JOIN merged mr ON mr.deal_id = d.id
LEFT JOIN fact_counts fc ON fc.deal_id = d.id
LEFT JOIN doc_xlsx dx ON dx.deal_id = d.id
WHERE d.deleted_at IS NULL
ORDER BY mr.analysis_version DESC, d.name
`;

// ─── Phase 2+3 — Classification + Scoring ─────────────────────────────────────

function parseBool(v: string | null | undefined): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function parseJsonArray(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

function parseFlags(flags: unknown): { fail: number; warn: number } {
  let arr: unknown[] = [];
  if (typeof flags === "string") {
    try { arr = JSON.parse(flags); } catch { return { fail: 0, warn: 0 }; }
  } else if (Array.isArray(flags)) {
    arr = flags;
  }
  let fail = 0, warn = 0;
  for (const f of arr) {
    if (typeof f === "object" && f !== null) {
      const status = (f as { status?: string }).status ?? "";
      if (status === "FAIL") fail++;
      else if (status === "WARN") warn++;
    }
  }
  return { fail, warn };
}

// ─── Issue Code Assignment ──────────────────────────────────────────────────────────
function assignIssueCodes(opts: {
  breakdown: FinancialBreakdownSnapshot;
  integrity: FinancialIntegritySnapshot;
  readiness: UnderwritingReadinessSnapshot;
  total_facts: number;
  xlsx_facts: number;
  xlsx_docs_in_db: number;
  missing_current_state: boolean;
  missing_projections: boolean;
  missing_cap_table_data: boolean;
  integrity_gap: boolean;
  readiness_mismatch: boolean;
  report_updated_at: string | null;
}): { primary_issue_code: IssueCode; secondary_issue_codes: IssueCode[] } {
  const candidates: IssueCode[] = [];
  const { breakdown, integrity, total_facts } = opts;

  // NO_DATA: truly no financial information at all
  if (
    (breakdown.has_xlsx === null || breakdown.has_xlsx === false) &&
    integrity.has_facts === null &&
    total_facts === 0
  ) {
    candidates.push("NO_DATA");
  }

  // XLSX_NOT_DETECTED: XLSX document exists in DB but report was compiled without detecting it (stale cache)
  if (breakdown.has_xlsx === false && opts.xlsx_docs_in_db > 0) {
    candidates.push("XLSX_NOT_DETECTED");
  }

  // PDF_FACTS_ONLY: has facts but no XLSX document was ever uploaded — PDF/PPTX source only
  if (breakdown.has_xlsx === false && opts.xlsx_docs_in_db === 0 && total_facts > 0) {
    candidates.push("PDF_FACTS_ONLY");
  }

  // FACTS_PRESENT_NO_BREAKDOWN: facts in DB but financial_breakdown_v1 was never compiled
  if (breakdown.has_xlsx === null && total_facts > 0) {
    candidates.push("FACTS_PRESENT_NO_BREAKDOWN");
  }

  if (opts.missing_current_state) candidates.push("MISSING_CURRENT_STATE");
  if (opts.missing_projections)   candidates.push("MISSING_PROJECTIONS");
  if (opts.missing_cap_table_data) candidates.push("MISSING_CAP_TABLE");

  // INTEGRITY_NO_FACTS: has_facts explicitly false (null = section absent, not same thing)
  if (integrity.has_facts === false) candidates.push("INTEGRITY_NO_FACTS");
  if (opts.integrity_gap)           candidates.push("INTEGRITY_ZERO_SCORE");
  if (opts.readiness_mismatch)      candidates.push("READINESS_MISMATCH");

  // STALE_REPORT: not regenerated in 30+ days
  if (opts.report_updated_at) {
    const daysSince = (Date.now() - new Date(opts.report_updated_at).getTime()) / 86_400_000;
    if (daysSince > 30) candidates.push("STALE_REPORT");
  }

  const unique = [...new Set(candidates)];

  let primary: IssueCode = "UNKNOWN";
  for (const code of ISSUE_PRIORITY) {
    if (unique.includes(code)) { primary = code; break; }
  }

  return {
    primary_issue_code: primary,
    secondary_issue_codes: unique.filter(c => c !== primary),
  };
}

function classifyDeal(row: Record<string, unknown>): DealAuditRecord {
  const breakdown: FinancialBreakdownSnapshot = {
    has_xlsx:          parseBool(row.has_xlsx as string),
    has_current_state: parseBool(row.has_current_state as string),
    has_projections:   parseBool(row.has_projections as string),
    has_cap_table:     parseBool(row.has_cap_table as string),
  };

  const flagCounts = parseFlags(row.fi_flags);
  const integrity: FinancialIntegritySnapshot = {
    has_facts:         parseBool(row.fi_has_facts as string),
    completeness_score: row.fi_completeness_score != null ? Number(row.fi_completeness_score) : null,
    missing_critical:  parseJsonArray(row.fi_missing_critical),
    flag_count_fail:   flagCounts.fail,
    flag_count_warn:   flagCounts.warn,
  };

  const readiness: UnderwritingReadinessSnapshot = {
    status: (row.ur_status as string) || null,
    score:  row.ur_score != null ? Number(row.ur_score) : null,
    gaps:   parseJsonArray(row.ur_gaps),
  };

  const totalFacts     = Number(row.total_facts ?? 0);
  const xlsxFacts      = Number(row.xlsx_facts ?? 0);
  const pdfTableFacts  = Number(row.pdf_table_facts ?? 0);
  const xlsxDocsInDb   = Number(row.xlsx_docs_in_db ?? 0);

  // Derived flags
  const missing_current_state = breakdown.has_xlsx === true && breakdown.has_current_state !== true;
  const missing_projections   = breakdown.has_xlsx === true && breakdown.has_projections !== true;
  const missing_cap_table_data = breakdown.has_cap_table !== true && (xlsxFacts > 5 || totalFacts > 10);
  const integrity_gap = integrity.has_facts === true && integrity.completeness_score === 0;
  // Readiness mismatch: integrity has FAILs, but readiness is "sufficient" (not penalized)
  const readiness_mismatch =
    integrity.flag_count_fail > 0 &&
    readiness.status === "sufficient" &&
    (readiness.gaps ?? []).length === 0;

  // Scoring
  const failure_reasons: string[] = [];
  const warnings: string[] = [];

  // No data at all
  if (breakdown.has_xlsx === null && integrity.has_facts === null && totalFacts === 0) {
    const reportUpdatedAt = (row.report_updated_at as string) || null;
    return {
      deal_id:        row.deal_id as string,
      deal_name:      row.deal_name as string,
      analysis_version: Number(row.analysis_version),
      compiler_version: (row.compiler_version as string) || null,
      report_updated_at: reportUpdatedAt,
      breakdown,
      integrity,
      readiness,
      total_facts: totalFacts,
      xlsx_facts: xlsxFacts,
      pdf_table_facts: pdfTableFacts,
      max_fact_ts: (row.max_fact_ts as string) || null,
      xlsx_docs_in_db: xlsxDocsInDb,
      missing_current_state,
      missing_projections,
      missing_cap_table_data,
      integrity_gap,
      readiness_mismatch,
      status: "NO_DATA",
      failure_reasons: ["financial_audit_not_compiled"],
      warnings: [],
      ...assignIssueCodes({ breakdown, integrity, readiness, total_facts: totalFacts, xlsx_facts: xlsxFacts, xlsx_docs_in_db: xlsxDocsInDb, missing_current_state, missing_projections, missing_cap_table_data, integrity_gap, readiness_mismatch, report_updated_at: reportUpdatedAt }),
    };
  }

  // FAIL conditions
  if (missing_current_state)
    failure_reasons.push("xlsx_present_no_current_state");
  if (missing_projections)
    failure_reasons.push("xlsx_present_no_projections");
  if (integrity_gap)
    failure_reasons.push("facts_present_completeness_zero");
  if (breakdown.has_xlsx === false && xlsxFacts > 0)
    failure_reasons.push("has_xlsx_false_but_xlsx_facts_exist");

  // WARN conditions
  if (missing_cap_table_data)
    warnings.push("expected_cap_table_missing");
  if (readiness_mismatch)
    warnings.push("readiness_not_penalized_despite_integrity_fails");
  if (integrity.flag_count_fail > 0)
    warnings.push(`${integrity.flag_count_fail}_integrity_flags_fail`);
  if (integrity.missing_critical.length > 0)
    warnings.push(`missing_critical_metrics:${integrity.missing_critical.join(",")}`);

  let status: AuditStatus;
  if (failure_reasons.length > 0) {
    // Distinguish hard failures from recoverable gaps
    const hardFails = failure_reasons.filter(r =>
      r !== "xlsx_present_no_projections" && r !== "expected_cap_table_missing"
    );
    status = hardFails.length > 0 ? "FAIL" : "PARTIAL";
  } else if (warnings.length > 0) {
    status = "PARTIAL";
  } else if (breakdown.has_xlsx === true && breakdown.has_current_state === true) {
    status = "PASS";
  } else if (integrity.has_facts === true && (readiness.score ?? 0) >= 50) {
    status = "PASS";
  } else {
    status = "PARTIAL";
  }

  const reportUpdatedAt = (row.report_updated_at as string) || null;
  return {
    deal_id:        row.deal_id as string,
    deal_name:      row.deal_name as string,
    analysis_version: Number(row.analysis_version),
    compiler_version: (row.compiler_version as string) || null,
    report_updated_at: reportUpdatedAt,
    breakdown,
    integrity,
    readiness,
    total_facts: totalFacts,
    xlsx_facts: xlsxFacts,
    pdf_table_facts: pdfTableFacts,
    max_fact_ts: (row.max_fact_ts as string) || null,
    xlsx_docs_in_db: xlsxDocsInDb,
    missing_current_state,
    missing_projections,
    missing_cap_table_data,
    integrity_gap,
    readiness_mismatch,
    status,
    failure_reasons,
    warnings,
    ...assignIssueCodes({ breakdown, integrity, readiness, total_facts: totalFacts, xlsx_facts: xlsxFacts, xlsx_docs_in_db: xlsxDocsInDb, missing_current_state, missing_projections, missing_cap_table_data, integrity_gap, readiness_mismatch, report_updated_at: reportUpdatedAt }),
  };
}

// ─── Phase 5 — Verification invariants ───────────────────────────────────────

function runVerificationChecks(deals: DealAuditRecord[]): string[] {
  const violations: string[] = [];

  for (const d of deals) {
    // No XLSX deal should be marked has_xlsx=false
    if (d.xlsx_facts > 0 && d.breakdown.has_xlsx === false) {
      violations.push(
        `VIOLATION: ${d.deal_name} (${d.deal_id}) has ${d.xlsx_facts} xlsx facts but has_xlsx=false in report`
      );
    }

    // If readiness=sufficient but integrity has hard FAILs: contradiction
    if (d.readiness_mismatch) {
      violations.push(
        `WARNING: ${d.deal_name} readiness=sufficient despite ${d.integrity.flag_count_fail} FAIL integrity flags`
      );
    }
  }

  // Compiler version consistency check
  const compilerVersions = new Set(deals.map(d => d.compiler_version ?? "none").filter(Boolean));
  if (compilerVersions.size > 1) {
    violations.push(
      `WARNING: Multiple compiler versions detected: ${[...compilerVersions].join(", ")} — reports may not be comparable`
    );
  }

  return violations;
}

// ─── Phase 4 — Output ─────────────────────────────────────────────────────────

function buildReport(deals: DealAuditRecord[]): PortfolioAuditReport {
  const pass    = deals.filter(d => d.status === "PASS").length;
  const partial = deals.filter(d => d.status === "PARTIAL").length;
  const fail    = deals.filter(d => d.status === "FAIL").length;
  const noData  = deals.filter(d => d.status === "NO_DATA").length;

  const withBreakdown = deals.filter(d => d.breakdown.has_xlsx !== null);
  const total = deals.length;

  const xlsxDeals     = deals.filter(d => d.breakdown.has_xlsx === true).length;
  const projDeals     = deals.filter(d => d.breakdown.has_projections === true).length;
  const capDeals      = deals.filter(d => d.breakdown.has_cap_table === true).length;
  const coveredDeals  = deals.filter(d => d.status !== "NO_DATA").length;

  const by_failure_type: Record<string, number> = {};
  for (const d of deals) {
    for (const r of d.failure_reasons) {
      by_failure_type[r] = (by_failure_type[r] ?? 0) + 1;
    }
    for (const w of d.warnings) {
      by_failure_type[w] = (by_failure_type[w] ?? 0) + 1;
    }
  }

  const compiler_version_spread: Record<string, number> = {};
  for (const d of deals) {
    const cv = d.compiler_version ?? "none";
    compiler_version_spread[cv] = (compiler_version_spread[cv] ?? 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    total_deals: total,
    summary: {
      pass,
      partial,
      fail,
      no_data: noData,
      coverage_pct: total > 0 ? Math.round((coveredDeals / total) * 100) : 0,
      xlsx_coverage_pct: coveredDeals > 0 ? Math.round((xlsxDeals / coveredDeals) * 100) : 0,
      projections_coverage_pct: xlsxDeals > 0 ? Math.round((projDeals / xlsxDeals) * 100) : 0,
      cap_table_coverage_pct: coveredDeals > 0 ? Math.round((capDeals / coveredDeals) * 100) : 0,
    },
    by_failure_type,
    compiler_version_spread,
    deals,
  };
}

// ─── Aggregation — Group by Issue Code ────────────────────────────────────────────

function buildIssueAggregation(deals: DealAuditRecord[], report: PortfolioAuditReport): IssueAggregation {
  const total = deals.length;
  const severityOrder: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const byCode = new Map<IssueCode, DealAuditRecord[]>();
  for (const d of deals) {
    const code = d.primary_issue_code;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(d);
  }

  const issues: IssueEntry[] = [...byCode.entries()]
    .map(([code, affected]) => ({
      issue_code: code,
      severity: ISSUE_METADATA[code].severity,
      count: affected.length,
      percentage: Math.round((affected.length / total) * 100),
      affected_deals: affected.map(d => d.deal_id),
      sample_deals: affected.slice(0, 5).map(d => ({ deal_id: d.deal_id, name: d.deal_name })),
    }))
    .sort((a, b) => {
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      return sev !== 0 ? sev : b.count - a.count;
    });

  return {
    generated_at: new Date().toISOString(),
    total_deals: total,
    summary: {
      pass: report.summary.pass,
      partial: report.summary.partial,
      fail: report.summary.fail,
      no_data: report.summary.no_data,
    },
    issues,
  };
}

// ─── Backlog Renderer ─────────────────────────────────────────────────────────────

function renderIssueBacklog(aggregation: IssueAggregation): string {
  const { summary, issues } = aggregation;
  const severityLabel: Record<IssueSeverity, string> = {
    critical: "Priority 1 — Critical Issues",
    high:     "Priority 2 — High Issues",
    medium:   "Priority 3 — Medium Issues",
    low:      "Priority 4 — Low Issues",
  };
  const severityEmoji: Record<IssueSeverity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };

  const lines: string[] = [
    `# Financial Audit Engine — Issue Backlog`,
    ``,
    `**Generated:** ${aggregation.generated_at}`,
    ``,
    `## Summary`,
    ``,
    `- Total deals: ${aggregation.total_deals}`,
    `- PASS: ${summary.pass}`,
    `- PARTIAL: ${summary.partial}`,
    `- FAIL: ${summary.fail}`,
    `- NO_DATA (status): ${summary.no_data}`,
    ``,
    `---`,
    ``,
  ];

  const bySeverity = new Map<IssueSeverity, IssueEntry[]>();
  for (const issue of issues) {
    if (!bySeverity.has(issue.severity)) bySeverity.set(issue.severity, []);
    bySeverity.get(issue.severity)!.push(issue);
  }

  for (const severity of ["critical", "high", "medium", "low"] as IssueSeverity[]) {
    const group = bySeverity.get(severity);
    if (!group || group.length === 0) continue;

    lines.push(`## ${severityEmoji[severity]} ${severityLabel[severity]}`);
    lines.push(``);

    for (const issue of group) {
      const meta = ISSUE_METADATA[issue.issue_code];
      lines.push(`### ISSUE: \`${issue.issue_code}\``);
      lines.push(``);
      lines.push(`- **Affected deals:** ${issue.count} (${issue.percentage}%)`);
      lines.push(`- **Severity:** ${severity}`);
      lines.push(`- **Impact:** ${meta.description}`);
      lines.push(`- **Sample deals:**`);
      for (const sd of issue.sample_deals) {
        lines.push(`  - ${sd.name} (\`${sd.deal_id}\`)`);
      }
      if (issue.count > issue.sample_deals.length) {
        lines.push(`  - *(${issue.count - issue.sample_deals.length} more…)*`);
      }
      lines.push(``);
      lines.push(`**Recommended Fix:**`);
      for (const fix of meta.recommended_fixes) lines.push(`- ${fix}`);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

function renderMarkdown(report: PortfolioAuditReport, violations: string[]): string {
  const { summary, deals } = report;

  const statusEmoji: Record<AuditStatus, string> = {
    PASS: "✅",
    PARTIAL: "⚠️",
    FAIL: "❌",
    NO_DATA: "⬜",
  };

  const lines: string[] = [
    `# Financial Audit Portfolio Report`,
    ``,
    `**Generated:** ${report.generated_at}  `,
    `**Total Deals:** ${report.total_deals}`,
    ``,
    `## Summary`,
    ``,
    `| Status | Count | % |`,
    `|--------|-------|---|`,
    `| ✅ PASS | ${summary.pass} | ${Math.round(summary.pass / report.total_deals * 100)}% |`,
    `| ⚠️ PARTIAL | ${summary.partial} | ${Math.round(summary.partial / report.total_deals * 100)}% |`,
    `| ❌ FAIL | ${summary.fail} | ${Math.round(summary.fail / report.total_deals * 100)}% |`,
    `| ⬜ NO_DATA | ${summary.no_data} | ${Math.round(summary.no_data / report.total_deals * 100)}% |`,
    ``,
    `### Coverage`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Deals with audit data | ${summary.coverage_pct}% |`,
    `| XLSX detected | ${summary.xlsx_coverage_pct}% of audited deals |`,
    `| Projections detected | ${summary.projections_coverage_pct}% of XLSX deals |`,
    `| Cap table detected | ${summary.cap_table_coverage_pct}% of audited deals |`,
    ``,
  ];

  // Compiler version spread
  const cvEntries = Object.entries(report.compiler_version_spread);
  if (cvEntries.length > 0) {
    lines.push(`### Compiler Version Spread`);
    lines.push(``);
    lines.push(`| Version | Deals |`);
    lines.push(`|---------|-------|`);
    for (const [cv, count] of cvEntries.sort()) {
      lines.push(`| \`${cv}\` | ${count} |`);
    }
    lines.push(``);
  }

  // Failure type breakdown
  const ftEntries = Object.entries(report.by_failure_type).sort((a, b) => b[1] - a[1]);
  if (ftEntries.length > 0) {
    lines.push(`## Failure / Warning Breakdown`);
    lines.push(``);
    lines.push(`| Type | Count |`);
    lines.push(`|------|-------|`);
    for (const [type, count] of ftEntries) {
      lines.push(`| \`${type}\` | ${count} |`);
    }
    lines.push(``);
  }

  // Verification violations
  if (violations.length > 0) {
    lines.push(`## Verification Invariant Violations`);
    lines.push(``);
    for (const v of violations) {
      const icon = v.startsWith("VIOLATION") ? "❌" : "⚠️";
      lines.push(`- ${icon} ${v}`);
    }
    lines.push(``);
  }

  // Per-deal table (top failures first, then partials, then passes)
  const sorted = [...deals].sort((a, b) => {
    const order: Record<AuditStatus, number> = { FAIL: 0, PARTIAL: 1, NO_DATA: 2, PASS: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  lines.push(`## Deal-Level Audit Results`);
  lines.push(``);
  lines.push(`| Status | Deal | v | has_xlsx | current | proj | cap_tbl | has_facts | completeness | readiness | facts | primary_issue |`);
  lines.push(`|--------|------|---|----------|---------|------|---------|-----------|--------------|-----------|-------|---------------|`);

  for (const d of sorted) {
    const b = (v: boolean | null) => v === true ? "✅" : v === false ? "❌" : "—";
    const score = d.integrity.completeness_score !== null ? `${d.integrity.completeness_score}%` : "—";
    const rs = d.readiness.status
      ? `${d.readiness.status} (${d.readiness.score ?? "—"})`
      : "—";
    lines.push(
      `| ${statusEmoji[d.status]} ${d.status} | **${d.deal_name}** | ${d.analysis_version} | ${b(d.breakdown.has_xlsx)} | ${b(d.breakdown.has_current_state)} | ${b(d.breakdown.has_projections)} | ${b(d.breakdown.has_cap_table)} | ${b(d.integrity.has_facts)} | ${score} | ${rs} | ${d.total_facts} | \`${d.primary_issue_code}\` |`
    );
  }
  lines.push(``);

  // Deal diagnostics for non-passing deals
  const nonPassing = sorted.filter(d => d.status !== "PASS");
  if (nonPassing.length > 0) {
    lines.push(`## Diagnostics — Non-Passing Deals`);
    lines.push(``);
    for (const d of nonPassing) {
      lines.push(`### ${statusEmoji[d.status]} ${d.deal_name}`);
      lines.push(``);
      lines.push(`- **deal_id:** \`${d.deal_id}\``);
      lines.push(`- **analysis_version:** ${d.analysis_version}`);
      lines.push(`- **status:** ${d.status}`);
      lines.push(`- **primary_issue_code:** \`${d.primary_issue_code}\``);
      if (d.secondary_issue_codes.length > 0) {
        lines.push(`- **secondary_issue_codes:** ${d.secondary_issue_codes.map(c => `\`${c}\``).join(", ")}`);
      }
      lines.push(`- **total_facts:** ${d.total_facts} (xlsx: ${d.xlsx_facts}, pdf_table: ${d.pdf_table_facts})`);
      if (d.failure_reasons.length > 0) {
        lines.push(`- **failures:**`);
        for (const r of d.failure_reasons) lines.push(`  - \`${r}\``);
      }
      if (d.warnings.length > 0) {
        lines.push(`- **warnings:**`);
        for (const w of d.warnings) lines.push(`  - \`${w}\``);
      }
      if (d.integrity.missing_critical.length > 0) {
        lines.push(`- **missing_critical:** ${d.integrity.missing_critical.join(", ")}`);
      }
      if (d.readiness.gaps.length > 0) {
        lines.push(`- **readiness_gaps:** ${d.readiness.gaps.join(", ")}`);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");

  console.log("📊 Financial Audit — Portfolio-Wide Verification");
  console.log("=".repeat(60));

  const pool = await getPool(repoRoot);

  let deals: DealAuditRecord[];
  try {
    console.log("\n⏳ Phase 1 — Querying deal portfolio…");
    const { rows } = await pool.query(DISCOVERY_SQL);
    console.log(`   Found ${rows.length} ingestion report rows`);

    console.log("\n⏳ Phase 2+3 — Classifying + scoring deals…");
    deals = rows.map(classifyDeal);

    // Deduplicate: keep latest analysis_version per deal
    const seen = new Map<string, DealAuditRecord>();
    for (const d of deals) {
      const existing = seen.get(d.deal_id);
      if (!existing || d.analysis_version > existing.analysis_version) {
        seen.set(d.deal_id, d);
      }
    }
    deals = [...seen.values()].sort((a, b) => a.deal_name.localeCompare(b.deal_name));

    console.log(`   Classified ${deals.length} unique deals`);
  } finally {
    await pool.end();
  }

  console.log("\n⏳ Phase 4 — Building report…");
  const report = buildReport(deals);

  console.log("\n⏳ Phase 5 — Running verification checks…");
  const violations = runVerificationChecks(deals);

  console.log("\n⏳ Phase 6 — Aggregating issues by root cause…");
  const aggregation = buildIssueAggregation(deals, report);

  // ── Write artifacts (always, regardless of output mode) ─────────────────────
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(repoRoot, outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  const jsonPath      = path.join(outDir, "financial_audit_portfolio_report.json");
  const mdPath        = path.join(outDir, "financial_audit_portfolio_report.md");
  const aggrJsonPath  = path.join(outDir, "financial_audit_issue_aggregation.json");
  const backlogMdPath = path.join(outDir, "financial_audit_issue_backlog.md");

  await Promise.all([
    fs.writeFile(jsonPath,      JSON.stringify({ ...report, verification_violations: violations }, null, 2) + "\n"),
    fs.writeFile(mdPath,        renderMarkdown(report, violations) + "\n"),
    fs.writeFile(aggrJsonPath,  JSON.stringify(aggregation, null, 2) + "\n"),
    fs.writeFile(backlogMdPath, renderIssueBacklog(aggregation) + "\n"),
  ]);

  // ── JSON output mode ─────────────────────────────────────────────────────────
  if (FLAG_JSON) {
    process.stdout.write(
      JSON.stringify(
        { portfolio_report: { ...report, verification_violations: violations }, issue_aggregation: aggregation },
        null, 2
      ) + "\n"
    );
    return;
  }

  // ── Human-readable console output ────────────────────────────────────────────
  const { summary } = report;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  PASS:     ${summary.pass}`);
  console.log(`  PARTIAL:  ${summary.partial}`);
  console.log(`  FAIL:     ${summary.fail}`);
  console.log(`  NO_DATA:  ${summary.no_data}`);
  console.log(`  Coverage: ${summary.coverage_pct}%`);
  console.log(`  XLSX deals: ${summary.xlsx_coverage_pct}% (of audited)`);
  console.log(`  Projections: ${summary.projections_coverage_pct}% (of XLSX)`);
  console.log(`  Cap table: ${summary.cap_table_coverage_pct}% (of audited)`);
  console.log(`${"═".repeat(60)}`);

  if (violations.length > 0) {
    console.log("\n⚠️  Verification violations:");
    for (const v of violations) console.log(`   ${v}`);
  } else {
    console.log("\n✅ No verification invariant violations");
  }

  // Top issues ranked by severity + frequency
  const severityEmoji: Record<IssueSeverity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };
  if (aggregation.issues.length > 0) {
    console.log("\n🔎 Top Issues (primary_issue_code):");
    aggregation.issues.slice(0, 8).forEach((issue, i) => {
      const pct = `${issue.percentage}%`.padStart(4);
      console.log(`   ${i + 1}. ${severityEmoji[issue.severity]} ${issue.issue_code.padEnd(28)} ${issue.count} deal${issue.count !== 1 ? "s" : ""} (${pct})`);
    });
  }

  if (!FLAG_SUMMARY_ONLY) {
    console.log("\n📋 Deal Status:");
    const statusEmoji2: Record<AuditStatus, string> = { PASS: "✅", PARTIAL: "⚠️ ", FAIL: "❌", NO_DATA: "⬜" };
    for (const d of [...deals].sort((a, b) => {
      const order: Record<AuditStatus, number> = { FAIL: 0, PARTIAL: 1, NO_DATA: 2, PASS: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    })) {
      const rs = d.readiness.score !== null ? ` [readiness: ${d.readiness.score}]` : "";
      const facts = `[${d.total_facts} facts]`;
      const issue = ` [${d.primary_issue_code}]`;
      console.log(`   ${statusEmoji2[d.status]} ${d.deal_name.padEnd(20)} v${d.analysis_version}  ${facts}${rs}${issue}`);
    }
  }

  console.log(`\n📁 Artifacts written:`);
  console.log(`   ${jsonPath}`);
  console.log(`   ${mdPath}`);
  console.log(`   ${aggrJsonPath}`);
  console.log(`   ${backlogMdPath}`);

  if (FLAG_FAIL && (report.summary.fail > 0 || violations.some(v => v.startsWith("VIOLATION")))) {
    console.error("\n❌ Exiting with code 1 (--fail-on-any set and failures detected)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
