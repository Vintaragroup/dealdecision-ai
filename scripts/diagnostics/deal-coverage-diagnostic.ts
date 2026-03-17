export {};

/**
 * Deal Coverage Diagnostic
 *
 * Read-only diagnostic that evaluates extraction coverage across the pipeline
 * for one or more deals and explains why UI fields may show missing citations,
 * empty slots, or unknown values.
 *
 * SAFETY: SELECT queries only. Never mutates DB state. Never enqueues jobs.
 *
 * Usage:
 *   pnpm tsx scripts/diagnostics/deal-coverage-diagnostic.ts
 *   pnpm tsx scripts/diagnostics/deal-coverage-diagnostic.ts --deal <uuid> [--deal <uuid>...]
 *   pnpm tsx scripts/diagnostics/deal-coverage-diagnostic.ts --expected-slots actual
 *   pnpm tsx scripts/diagnostics/deal-coverage-diagnostic.ts --expected-slots legacy
 *
 * Slot modes:
 *   legacy  (default) — checks the original 8 human-named UI slots:
 *                        business_model_v1, market_v1, product_v1, raise_v1,
 *                        traction_v1, customers_v1, revenue_v1, growth_v1
 *   actual             — checks the real section keys emitted by the engine:
 *                        gate_state, analysis_status, insight_slots,
 *                        canonical_fields, governed_summary_v1,
 *                        governed_executive_summary_v1, product_profile_v1,
 *                        evidence_quality_gate
 *
 * Env: DATABASE_URL (falls back to .env / apps/api/.env)
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
    ) {
      value = value.slice(1, -1);
    }
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
  for (const candidate of candidates) {
    try {
      const txt = await fs.readFile(candidate, "utf8");
      const parsed = parseDotenv(txt);
      if (!process.env.DATABASE_URL && parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL;
        console.log(`[env] Loaded DATABASE_URL from ${candidate}`);
        return;
      }
    } catch {
      // ignore
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  title: string | null;
  type: string | null;
  mime_type: string | null;
  status: string | null;
  verification_status: string | null;
  page_count: number | null;
  extraction_metadata: Record<string, unknown> | null;
}

interface DpuRow {
  document_id: string;
  total_pages: number;
  useful_pages: number;
}

interface VisualAssetRow {
  asset_type: string;
  count: number;
}

interface FinancialFactRow {
  metric_key: string;
  metric_label: string | null;
  value: number | null;
  unit: string | null;
  currency: string | null;
  source_kind: string | null;
  confidence: string | null;
}

interface EvidenceKindRow {
  kind: string;
  count: number;
}

interface EvidenceLinkRow {
  total_links: number;
  linked_assets: number;
}

interface InsightReport {
  id: string;
  status: string | null;
  render_package: Record<string, unknown> | null;
  report_payload: Record<string, unknown> | null;
  created_at: string;
}

interface JobHistoryRow {
  type: string;
  status: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

interface DealReport {
  dealId: string;
  dealName: string;
  documents: DocumentRow[];
  dpu: DpuRow[];
  visualAssets: VisualAssetRow[];
  financialFacts: FinancialFactRow[];
  evidenceByKind: EvidenceKindRow[];
  evidenceLinks: EvidenceLinkRow;
  latestReport: InsightReport | null;
  jobHistory: JobHistoryRow[];
  issues: string[];
  slotsMode: SlotsMode;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

async function queryDocuments(pool: Pool, dealId: string): Promise<DocumentRow[]> {
  const { rows } = await pool.query<DocumentRow>(
    `SELECT
       id,
       title,
       type,
       mime_type,
       status,
       verification_status,
       page_count,
       extraction_metadata
     FROM documents
     WHERE deal_id = $1
       AND deleted_at IS NULL
     ORDER BY uploaded_at ASC`,
    [dealId]
  );
  return rows;
}

async function queryDpu(pool: Pool, dealId: string): Promise<DpuRow[]> {
  const { rows } = await pool.query<DpuRow>(
    `SELECT
       document_id::text,
       count(*)::int                                                    AS total_pages,
       count(*) FILTER (
         WHERE length(coalesce(payload->>'page_text', '')) > 50
       )::int                                                           AS useful_pages
     FROM document_page_understanding
     WHERE deal_id = $1
       AND version = 'page_understanding_v1'
     GROUP BY document_id
     ORDER BY document_id`,
    [dealId]
  );
  return rows;
}

async function queryVisualAssets(
  pool: Pool,
  documentIds: string[]
): Promise<VisualAssetRow[]> {
  if (documentIds.length === 0) return [];
  const { rows } = await pool.query<VisualAssetRow>(
    `SELECT
       asset_type,
       count(*)::int AS count
     FROM visual_assets
     WHERE document_id = ANY($1::uuid[])
     GROUP BY asset_type
     ORDER BY count DESC`,
    [documentIds]
  );
  return rows;
}

async function queryFinancialFacts(
  pool: Pool,
  dealId: string
): Promise<FinancialFactRow[]> {
  const { rows } = await pool.query<FinancialFactRow>(
    `SELECT
       metric_key,
       metric_label,
       value,
       unit,
       currency,
       source_kind,
       confidence
     FROM financial_facts_v1
     WHERE deal_id = $1
     ORDER BY metric_key`,
    [dealId]
  );
  return rows;
}

async function queryEvidenceByKind(
  pool: Pool,
  dealId: string
): Promise<EvidenceKindRow[]> {
  const { rows } = await pool.query<EvidenceKindRow>(
    `SELECT
       kind,
       count(*)::int AS count
     FROM evidence
     WHERE deal_id = $1
     GROUP BY kind
     ORDER BY count DESC`,
    [dealId]
  );
  return rows;
}

async function queryEvidenceLinks(
  pool: Pool,
  documentIds: string[]
): Promise<EvidenceLinkRow> {
  if (documentIds.length === 0) {
    return { total_links: 0, linked_assets: 0 };
  }
  const { rows } = await pool.query<EvidenceLinkRow>(
    `SELECT
       count(*)::int                                    AS total_links,
       count(DISTINCT visual_asset_id)::int             AS linked_assets
     FROM evidence_links
     WHERE document_id = ANY($1::uuid[])`,
    [documentIds]
  );
  return rows[0] ?? { total_links: 0, linked_assets: 0 };
}

async function queryLatestInsightReport(
  pool: Pool,
  dealId: string
): Promise<InsightReport | null> {
  const { rows } = await pool.query<InsightReport>(
    `SELECT
       id::text,
       status,
       render_package,
       report_payload,
       created_at::text
     FROM investor_insight_reports
     WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  return rows[0] ?? null;
}

async function queryJobHistory(
  pool: Pool,
  dealId: string
): Promise<JobHistoryRow[]> {
  const { rows } = await pool.query<JobHistoryRow>(
    `SELECT
       type,
       status,
       created_at::text,
       finished_at::text,
       error
     FROM jobs
     WHERE deal_id = $1
       AND type IN ('analyze_deal', 'extract_visuals', 'deep_scan_visuals', 'populate_document_page_understanding', 'investor_insights')
     ORDER BY created_at DESC
     LIMIT 20`,
    [dealId]
  );
  return rows;
}

// ── Slot analysis ─────────────────────────────────────────────────────────────

/**
 * Legacy slot list: original 8 human-named UI slots that were expected to be
 * filled by LLM stages. These keys do NOT appear in the real engine output;
 * use ACTUAL_SLOTS to check what the engine actually emits.
 */
const LEGACY_SLOTS = [
  "business_model_v1",
  "market_v1",
  "product_v1",
  "raise_v1",
  "traction_v1",
  "customers_v1",
  "revenue_v1",
  "growth_v1",
] as const;

/**
 * Actual slot list: real section keys emitted by the engine in render_package.
 * Non-body sections (gate_state, evidence_quality_gate) are informational;
 * key LLM outputs are governed_summary_v1 and governed_executive_summary_v1.
 */
const ACTUAL_SLOTS = [
  "gate_state",
  "analysis_status",
  "insight_slots",
  "canonical_fields",
  "investor_thesis",
  "governed_summary_v1",
  "governed_executive_summary_v1",
  "product_profile_v1",
  "evidence_quality_gate",
  "coverage_snapshot",
] as const;

// Keep EXPECTED_SLOTS as an alias for backwards-compat with detectIssues
const EXPECTED_SLOTS = LEGACY_SLOTS;

type SlotsMode = "legacy" | "actual";

interface SlotAnalysis {
  key: string;
  present: boolean;
  hasBody: boolean;
  citationCount: number;
}

function analyzeSlots(
  report: InsightReport | null,
  mode: SlotsMode = "legacy"
): SlotAnalysis[] {
  const slots: ReadonlyArray<string> = mode === "actual" ? ACTUAL_SLOTS : LEGACY_SLOTS;

  if (!report?.render_package) {
    return slots.map((key) => ({
      key,
      present: false,
      hasBody: false,
      citationCount: 0,
    }));
  }

  const sections = report.render_package["sections"];
  const sectionMap = new Map<string, Record<string, unknown>>();

  if (Array.isArray(sections)) {
    for (const s of sections) {
      if (s && typeof s === "object" && typeof (s as any).key === "string") {
        sectionMap.set((s as any).key, s as Record<string, unknown>);
      }
    }
  }

  return slots.map((key) => {
    const section = sectionMap.get(key);
    if (!section) {
      return { key, present: false, hasBody: false, citationCount: 0 };
    }
    const body = section["body"];
    const hasBody =
      typeof body === "string" ? body.trim().length > 0 : body != null;
    const citations = section["citations"];
    const citationCount = Array.isArray(citations) ? citations.length : 0;
    return { key, present: true, hasBody, citationCount };
  });
}

// ── Issue detection ───────────────────────────────────────────────────────────

const FINANCIAL_INTEREST_KEYS = [
  "arr",
  "revenue",
  "mrr",
  "growth",
  "customers",
  "users",
  "runway",
  "burn_rate",
];

function detectIssues(report: DealReport): string[] {
  const issues: string[] = [];

  // Document ingestion issues
  const failedDocs = report.documents.filter(
    (d) => d.status === "failed" || d.verification_status === "failed"
  );
  if (failedDocs.length > 0) {
    issues.push(
      `${failedDocs.length} document(s) in failed/unverified state: ${failedDocs.map((d) => d.title ?? d.id).join(", ")}`
    );
  }

  const unverifiedDocs = report.documents.filter(
    (d) =>
      d.verification_status != null &&
      !["succeeded", "passed", "verified"].includes(d.verification_status)
  );
  if (unverifiedDocs.length > 0) {
    issues.push(
      `${unverifiedDocs.length} document(s) not fully verified: ${unverifiedDocs.map((d) => `${d.title ?? d.id} (${d.verification_status})`).join(", ")}`
    );
  }

  // Rendered pages coverage
  const renderedTotal = report.documents.reduce((acc, d) => {
    return (
      acc +
      Number(
        (d.extraction_metadata as any)?.rendered_pages_count ??
          (d.extraction_metadata as any)?.rendered_pages_rendered ??
          0
      )
    );
  }, 0);
  const pageTotal = report.documents.reduce(
    (acc, d) => acc + (d.page_count ?? 0),
    0
  );
  if (pageTotal > 0 && renderedTotal === 0) {
    issues.push(
      `No rendered pages found (rendered_pages_count=0 across ${pageTotal} pages)`
    );
  }

  // DPU coverage
  const totalDpuPages = report.dpu.reduce((a, r) => a + r.total_pages, 0);
  const usefulDpuPages = report.dpu.reduce((a, r) => a + r.useful_pages, 0);
  if (totalDpuPages === 0) {
    issues.push("No DPU records found — document_page_understanding is empty for this deal");
  } else {
    const coveragePct = Math.round((usefulDpuPages / totalDpuPages) * 100);
    if (coveragePct < 50) {
      issues.push(
        `Low DPU coverage: only ${coveragePct}% of pages have usable text (${usefulDpuPages}/${totalDpuPages})`
      );
    }
  }

  // Visual assets
  const totalAssets = report.visualAssets.reduce(
    (a, r) => a + Number(r.count),
    0
  );
  if (totalAssets === 0) {
    issues.push("No visual assets extracted — extract_visuals may not have run");
  }

  // Financial facts
  const factKeys = new Set(report.financialFacts.map((f) => f.metric_key.toLowerCase()));
  for (const key of FINANCIAL_INTEREST_KEYS) {
    if (![...factKeys].some((k) => k.includes(key))) {
      issues.push(`Financial metric missing: ${key.toUpperCase()} not found in financial_facts_v1`);
    }
  }

  // Evidence
  const totalEvidence = report.evidenceByKind.reduce(
    (a, r) => a + Number(r.count),
    0
  );
  if (totalEvidence === 0) {
    issues.push("No evidence records — evidence table empty for this deal");
  }

  if (report.evidenceLinks.total_links === 0) {
    issues.push(
      "No evidence_links found — visual assets not bound to evidence nodes"
    );
  }

  // Slot coverage — always check legacy slots for issue detection
  const slots = analyzeSlots(report.latestReport, "legacy");
  const missingSlots = slots.filter((s) => !s.present || !s.hasBody);
  if (missingSlots.length > 0) {
    issues.push(
      `${missingSlots.length} legacy slot(s) empty/missing: ${missingSlots.map((s) => s.key).join(", ")}. Run with --expected-slots actual to see real section keys`
    );
  }

  // Flag deterministic_only reports (LLM summarization step likely did not run)
  if (report.latestReport?.status === "deterministic_only") {
    issues.push(
      `Investor insight report is "deterministic_only" — LLM summarization step did not complete`
    );
  }

  const slotsWithNoCitations = slots.filter(
    (s) => s.present && s.hasBody && s.citationCount === 0
  );
  if (slotsWithNoCitations.length > 0) {
    issues.push(
      `${slotsWithNoCitations.length} section(s) present but have no citations (likely "No explicit citation"): ${slotsWithNoCitations.map((s) => s.key).join(", ")}`
    );
  }

  // Investor insights report
  if (!report.latestReport) {
    issues.push("No investor_insight_reports found — investor_insights job may not have run");
  } else if (report.latestReport.status !== "complete" && report.latestReport.status !== "deterministic_only") {
    issues.push(
      `Latest investor insight report status: "${report.latestReport.status}" (not complete)`
    );
  }

  // Job history
  const analyzeDealJobs = report.jobHistory.filter((j) => j.type === "analyze_deal");
  if (analyzeDealJobs.length === 0) {
    issues.push("No analyze_deal job history found");
  } else {
    const latest = analyzeDealJobs[0];
    if (latest.status === "failed") {
      issues.push(
        `Latest analyze_deal job FAILED: ${latest.error?.slice(0, 100) ?? "no error message"}`
      );
    }
  }

  return issues;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function pct(num: number, denom: number): string {
  if (denom === 0) return "N/A";
  return `${Math.round((num / denom) * 100)}%`;
}

function printReport(report: DealReport): void {
  const sep = "─".repeat(56);
  console.log(`\nDeal: ${report.dealName}`);
  console.log(`ID:   ${report.dealId}`);
  console.log(sep);

  // 1. Documents
  console.log(`\n§1  Document Ingestion`);
  console.log(`    Count:       ${report.documents.length}`);
  if (report.documents.length === 0) {
    console.log(`    ⚠  No documents found for this deal`);
  } else {
    for (const doc of report.documents) {
      const em = doc.extraction_metadata as any;
      const renderedCount =
        em?.rendered_pages_count ?? em?.rendered_pages_rendered ?? null;
      console.log(
        `    • ${doc.title ?? "(untitled)"} [${doc.mime_type ?? doc.type ?? "?"}]` +
          `  status=${doc.status ?? "?"}` +
          `  verified=${doc.verification_status ?? "?"}` +
          `  pages=${doc.page_count ?? "?"}` +
          `  rendered=${renderedCount ?? "?"}`
      );
    }
  }

  // 2. DPU coverage
  console.log(`\n§2  DPU Coverage (page_understanding_v1)`);
  const totalDpuPages = report.dpu.reduce((a, r) => a + r.total_pages, 0);
  const usefulDpuPages = report.dpu.reduce((a, r) => a + r.useful_pages, 0);
  if (report.dpu.length === 0) {
    console.log(`    ⚠  No DPU records`);
  } else {
    console.log(`    Total pages indexed:  ${totalDpuPages}`);
    console.log(`    Pages with text >50ch: ${usefulDpuPages}`);
    console.log(`    Coverage:             ${pct(usefulDpuPages, totalDpuPages)}`);
    for (const row of report.dpu) {
      console.log(
        `    • doc ${row.document_id.slice(0, 8)}…  ${row.useful_pages}/${row.total_pages} useful`
      );
    }
  }

  // 3. Visual assets
  console.log(`\n§3  Visual Assets`);
  const totalAssets = report.visualAssets.reduce(
    (a, r) => a + Number(r.count),
    0
  );
  if (totalAssets === 0) {
    console.log(`    ⚠  No visual assets found`);
  } else {
    console.log(`    Total: ${totalAssets}`);
    for (const row of report.visualAssets) {
      console.log(`    • ${row.asset_type}: ${row.count}`);
    }
  }

  // 4. Financial facts
  console.log(`\n§4  Financial Facts (financial_facts_v1)`);
  if (report.financialFacts.length === 0) {
    console.log(`    ⚠  No financial facts found`);
  } else {
    console.log(`    Total records: ${report.financialFacts.length}`);
    const ofInterest = report.financialFacts.filter((f) =>
      FINANCIAL_INTEREST_KEYS.some((k) =>
        f.metric_key.toLowerCase().includes(k)
      )
    );
    if (ofInterest.length === 0) {
      console.log(`    ⚠  None of the key metrics (ARR/revenue/growth/customers/runway) found`);
    }
    for (const f of ofInterest) {
      console.log(
        `    • ${f.metric_key}: ${f.value ?? "null"} ${f.currency ?? f.unit ?? ""}` +
          `  source=${f.source_kind ?? "?"}  confidence=${f.confidence ?? "?"}`
      );
    }
    const otherCount = report.financialFacts.length - ofInterest.length;
    if (otherCount > 0) {
      console.log(`    … +${otherCount} other metric(s) (possibly OCR noise)`);
    }
  }

  // 5. Evidence
  console.log(`\n§5  Evidence Registry`);
  const totalEvidence = report.evidenceByKind.reduce(
    (a, r) => a + Number(r.count),
    0
  );
  console.log(`    Total evidence nodes: ${totalEvidence}`);
  console.log(
    `    Evidence links (visual_assets bound): ${report.evidenceLinks.total_links}  (${report.evidenceLinks.linked_assets} distinct assets)`
  );
  if (report.evidenceByKind.length > 0) {
    for (const row of report.evidenceByKind) {
      console.log(`    • ${row.kind}: ${row.count}`);
    }
  }

  // 6. Structured slots
  const slotsMode = report.slotsMode;
  const slots = analyzeSlots(report.latestReport, slotsMode);
  const slotList = slotsMode === "actual" ? ACTUAL_SLOTS : LEGACY_SLOTS;
  const filledCount = slots.filter((s) => s.present && s.hasBody).length;
  console.log(`\n§6  Structured Slot Coverage`);
  console.log(`    ℹ  Expected slots mode: ${slotsMode}`);
  console.log(`    Filled: ${filledCount} / ${slotList.length}`);
  for (const slot of slots) {
    const status = !slot.present
      ? "✗ missing"
      : !slot.hasBody
        ? "✗ empty (key present)"
        : `✓ filled`;
    console.log(`    ${slot.key.padEnd(40)} ${status}`);
  }
  // In legacy mode: show actual section keys to aid debugging
  if (slotsMode === "legacy") {
    const actualSections = report.latestReport?.render_package?.["sections"];
    if (Array.isArray(actualSections) && actualSections.length > 0) {
      const actualKeys = actualSections
        .map((s: any) => s?.key)
        .filter(Boolean);
      const missingActual = (ACTUAL_SLOTS as ReadonlyArray<string>).filter(
        (k) => !actualKeys.includes(k)
      );
      console.log(
        `    ℹ  Actual keys in render_package (${actualKeys.length}): ${actualKeys.join(", ")}`
      );
      if (missingActual.length > 0) {
        console.log(
          `    ℹ  Missing actual keys: ${missingActual.join(", ")}`
        );
      }
    }
  }

  // 7. Investor insights report
  console.log(`\n§7  Latest Investor Insight Report`);
  if (!report.latestReport) {
    console.log(`    ⚠  No report found`);
  } else {
    console.log(`    ID:        ${report.latestReport.id.slice(0, 8)}…`);
    console.log(`    Status:    ${report.latestReport.status ?? "?"}`);
    console.log(`    Created:   ${report.latestReport.created_at}`);
    const sections = report.latestReport.render_package?.["sections"];
    const sectionCount = Array.isArray(sections) ? sections.length : 0;
    console.log(`    Sections:  ${sectionCount}`);
  }

  // 8. Job history
  console.log(`\n§8  Analysis Job History (last 20, key types only)`);
  if (report.jobHistory.length === 0) {
    console.log(`    ⚠  No matching jobs found`);
  } else {
    const byType = new Map<string, JobHistoryRow[]>();
    for (const j of report.jobHistory) {
      if (!byType.has(j.type)) byType.set(j.type, []);
      byType.get(j.type)!.push(j);
    }
    for (const [type, jobs] of byType) {
      const latest = jobs[0];
      console.log(
        `    ${type.padEnd(40)}  latest=${latest.status ?? "?"}  at=${latest.created_at?.slice(0, 19)}`
      );
    }
  }

  // Issues
  console.log(`\n  ⚡ Issues detected (${report.issues.length}):`);
  if (report.issues.length === 0) {
    console.log(`    None — coverage looks complete`);
  } else {
    for (const issue of report.issues) {
      console.log(`    ⚠  ${issue}`);
    }
  }

  console.log(`\n${sep}`);
}

// ── Core per-deal analysis ────────────────────────────────────────────────────

async function analyzeDeal(
  pool: Pool,
  dealId: string,
  dealName: string,
  slotsMode: SlotsMode = "legacy"
): Promise<DealReport> {
  const [documents, dpu, financialFacts, evidenceByKind, latestReport, jobHistory] =
    await Promise.all([
      queryDocuments(pool, dealId),
      queryDpu(pool, dealId),
      queryFinancialFacts(pool, dealId),
      queryEvidenceByKind(pool, dealId),
      queryLatestInsightReport(pool, dealId),
      queryJobHistory(pool, dealId),
    ]);

  const documentIds = documents.map((d) => d.id);

  const [visualAssets, evidenceLinks] = await Promise.all([
    queryVisualAssets(pool, documentIds),
    queryEvidenceLinks(pool, documentIds),
  ]);

  const report: DealReport = {
    dealId,
    dealName,
    documents,
    dpu,
    visualAssets,
    financialFacts,
    evidenceByKind,
    evidenceLinks,
    latestReport,
    jobHistory,
    issues: [],
    slotsMode,
  };

  report.issues = detectIssues(report);
  return report;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const DEFAULT_DEALS: Array<{ id: string; name: string }> = [
  { id: "adb2a1cf-bbb1-4f3b-8735-e2249415124f", name: "StackFactor" },
  { id: "517be946-cab9-4bc1-8982-9522ff9dab32", name: "Deal Decision" },
  { id: "c4f10092-1c94-4116-b4f0-78874868f92b", name: "Palm" },
];

async function main() {
  // Assume the script is always run from the repo root (tsx scripts/diagnostics/...)
  const repoRoot = process.cwd();

  await loadEnvFallback(repoRoot);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "ERROR: DATABASE_URL is not set. Set it in your shell or .env before running."
    );
    process.exit(1);
  }

  // Parse --deal and --expected-slots flags
  const cliDeals: Array<{ id: string; name: string }> = [];
  let slotsMode: SlotsMode = "legacy";
  for (let i = 2; i < process.argv.length; i++) {
    if ((process.argv[i] === "--deal" || process.argv[i] === "--deal-id") && process.argv[i + 1]) {
      cliDeals.push({ id: process.argv[i + 1], name: process.argv[i + 1] });
      i++;
    } else if (process.argv[i] === "--expected-slots" && process.argv[i + 1]) {
      const val = process.argv[i + 1];
      if (val === "actual" || val === "legacy") {
        slotsMode = val;
      } else {
        console.warn(`  ⚠  Unknown --expected-slots value "${val}"; use "legacy" or "actual". Defaulting to legacy.`);
      }
      i++;
    }
  }

  const deals = cliDeals.length > 0 ? cliDeals : DEFAULT_DEALS;

  const pool = new Pool({ connectionString: databaseUrl });

  console.log(`\n${"═".repeat(56)}`);
  console.log(`  Deal Coverage Diagnostic`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Analyzing ${deals.length} deal(s) — read-only`);
  console.log(`  ℹ  Expected slots mode: ${slotsMode}`);
  console.log(`${"═".repeat(56)}`);

  const reports: DealReport[] = [];

  for (const deal of deals) {
    try {
      const report = await analyzeDeal(pool, deal.id, deal.name, slotsMode);
      reports.push(report);
      printReport(report);
    } catch (err) {
      console.error(`\n[ERROR] Failed to analyze deal ${deal.name} (${deal.id}): ${err}`);
    }
  }

  // Summary table
  console.log(`\n${"═".repeat(56)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(56)}`);
  console.log(
    `${"Deal".padEnd(20)} ${"Docs".padStart(5)} ${"DPU%".padStart(6)} ${"Assets".padStart(8)} ${"FinFacts".padStart(10)} ${"Evidence".padStart(10)} ${"Slots".padStart(8)} ${"Issues".padStart(7)}`
  );
  console.log("─".repeat(80));
  for (const r of reports) {
    const totalDpu = r.dpu.reduce((a, x) => a + x.total_pages, 0);
    const usefulDpu = r.dpu.reduce((a, x) => a + x.useful_pages, 0);
    const totalAssets = r.visualAssets.reduce((a, x) => a + Number(x.count), 0);
    const totalEvidence = r.evidenceByKind.reduce((a, x) => a + Number(x.count), 0);
    const slots = analyzeSlots(r.latestReport, r.slotsMode);
    const slotTotal = r.slotsMode === "actual" ? ACTUAL_SLOTS.length : LEGACY_SLOTS.length;
    const filledSlots = slots.filter((s) => s.present && s.hasBody).length;
    const dpuPct = totalDpu > 0 ? `${Math.round((usefulDpu / totalDpu) * 100)}%` : "N/A";

    console.log(
      `${r.dealName.padEnd(20)} ${String(r.documents.length).padStart(5)} ${dpuPct.padStart(6)} ${String(totalAssets).padStart(8)} ${String(r.financialFacts.length).padStart(10)} ${String(totalEvidence).padStart(10)} ${`${filledSlots}/${slotTotal}`.padStart(8)} ${String(r.issues.length).padStart(7)}`
    );
  }
  console.log("");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
