/**
 * Dashboard Routes
 * Provides visibility into database state, DIO analysis data, and report computation
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";
import { compileDIOToReport, buildScoreExplanationFromDIO } from "@dealdecision/core";
import type { Pool } from "pg";

type ReportDocRow = {
  id: string;
  title: string;
  type: string | null;
  page_count: number | null;
  extraction_metadata: any | null;
  structured_data: any | null;
};

function safeNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function docInventoryFromDocs(docs: ReportDocRow[]) {
  return docs.map((doc) => {
    const em: any = doc.extraction_metadata ?? {};
    const completenessScore = safeNumber(em?.completeness?.score);
    const totalPages = safeNumber(em?.totalPages) ?? safeNumber(doc.page_count) ?? 0;
    const totalWords = safeNumber(em?.totalWords) ?? 0;

    return {
      document_id: doc.id,
      title: doc.title,
      contentType: typeof em?.contentType === "string" ? em.contentType : (doc.type ?? "unknown"),
      totalPages,
      totalWords,
      headingsCount: safeNumber(em?.headingsCount) ?? 0,
      summaryLength: safeNumber(em?.summaryLength) ?? 0,
      fileSizeBytes: safeNumber(em?.fileSizeBytes) ?? 0,
      completenessScore: completenessScore ?? 0,
    };
  });
}

function getStructured(doc: ReportDocRow): any {
  return doc.structured_data ?? {};
}

function countKeyMetrics(doc: ReportDocRow): number {
  const sd = getStructured(doc);
  return Array.isArray(sd?.keyMetrics) ? sd.keyMetrics.length : 0;
}

function hasKeyFinancialMetrics(doc: ReportDocRow): boolean {
  const sd = getStructured(doc);
  const kfm = sd?.keyFinancialMetrics;
  return !!kfm && typeof kfm === "object" && Object.keys(kfm).length > 0;
}

function sumByDocIds<T extends { document_id: string }>(
  inventory: T[],
  sourceDocs: string[],
  field: keyof T
): number {
  const allowed = new Set(sourceDocs);
  let sum = 0;
  for (const item of inventory) {
    if (!allowed.has(item.document_id)) continue;
    const v = item[field];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

function buildAnalyzerInputsUsed(docs: ReportDocRow[], inventory: Array<any>) {
  const allDocIds = docs.map((d) => d.id);
  const pitchDeckDocIds = docs.filter((d) => d.type === "pitch_deck").map((d) => d.id);
  const primaryDocs = pitchDeckDocIds.length > 0 ? pitchDeckDocIds : allDocIds;
  const financialDocs = docs.filter((d) => d.type === "financials").map((d) => d.id);

  const metricsCountAll = docs.reduce((sum, d) => sum + countKeyMetrics(d), 0);
  const anyKeyFinancialMetrics = docs.some((d) => hasKeyFinancialMetrics(d));
  const hasFinancialFields = financialDocs.length > 0 || anyKeyFinancialMetrics;

  const combinedTextLenAll = sumByDocIds(inventory, allDocIds, "totalWords");

  return {
    slide_sequence: {
      source_docs: primaryDocs,
      derived_fields: {
        headings_count: sumByDocIds(inventory, primaryDocs, "headingsCount"),
        total_pages: sumByDocIds(inventory, primaryDocs, "totalPages"),
        combined_text_len: sumByDocIds(inventory, primaryDocs, "totalWords"),
      },
    },
    visual_design: {
      source_docs: primaryDocs,
      derived_fields: {
        total_pages: sumByDocIds(inventory, primaryDocs, "totalPages"),
        file_size_bytes: sumByDocIds(inventory, primaryDocs, "fileSizeBytes"),
        headings_count: sumByDocIds(inventory, primaryDocs, "headingsCount"),
      },
    },
    narrative_arc: {
      source_docs: primaryDocs,
      derived_fields: {
        slides_or_text_len: Math.max(
          sumByDocIds(inventory, primaryDocs, "totalPages"),
          sumByDocIds(inventory, primaryDocs, "totalWords")
        ),
      },
    },
    metric_benchmark: {
      source_docs: allDocIds,
      derived_fields: {
        metrics_count: metricsCountAll,
        text_len: combinedTextLenAll,
        has_keyFinancialMetrics: anyKeyFinancialMetrics,
      },
    },
    financial_health: {
      source_docs: financialDocs.length > 0 ? financialDocs : allDocIds,
      derived_fields: {
        has_financial_fields: hasFinancialFields,
      },
    },
    risk_assessment: {
      source_docs: allDocIds,
      derived_fields: {
        text_len: combinedTextLenAll,
        metrics_count: metricsCountAll,
      },
    },
  };
}

function buildInclusionDecisions(scoreExplanation: any) {
  const aggregation = scoreExplanation?.aggregation;
  const components = scoreExplanation?.components;
  const excluded = new Map<string, string>();
  for (const ex of (aggregation?.excluded_components ?? []) as Array<any>) {
    if (ex?.component) excluded.set(String(ex.component), String(ex.reason ?? "unknown"));
  }

  const keys = [
    "slide_sequence",
    "visual_design",
    "narrative_arc",
    "metric_benchmark",
    "financial_health",
    "risk_assessment",
  ];

  const perComponent: Record<string, any> = {};
  for (const key of keys) {
    const included = Array.isArray(aggregation?.included_components)
      ? aggregation.included_components.includes(key)
      : false;

    perComponent[key] = {
      included,
      reason: included ? "included" : (excluded.get(key) ?? "excluded"),
      status: components?.[key]?.status ?? null,
      notes: Array.isArray(components?.[key]?.notes) ? components[key].notes : [],
    };
  }

  return {
    aggregation,
    components: perComponent,
  };
}

export async function registerDashboardRoutes(app: FastifyInstance, pool: Pool = getPool()) {

  /**
   * Main Dashboard HTML Page
   */
  app.get("/api/dashboard", async (request, reply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DealDecision AI - Database Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #2d3748;
      line-height: 1.6;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .header p { opacity: 0.9; }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .card h2 { 
      font-size: 1.25rem;
      margin-bottom: 1rem;
      color: #4a5568;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 0.5rem;
    }
    .stat { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; }
    .stat-label { color: #718096; font-weight: 500; }
    .stat-value { 
      font-size: 1.5rem;
      font-weight: 700;
      color: #667eea;
    }
    .table-container { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { 
      background: #f7fafc;
      padding: 0.75rem;
      text-align: left;
      font-weight: 600;
      color: #4a5568;
      border-bottom: 2px solid #e2e8f0;
    }
    td { 
      padding: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:hover { background: #f7fafc; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .badge-success { background: #c6f6d5; color: #22543d; }
    .badge-warning { background: #feebc8; color: #744210; }
    .badge-info { background: #bee3f8; color: #2c5282; }
    .badge-danger { background: #fed7d7; color: #742a2a; }
    .btn {
      display: inline-block;
      padding: 0.5rem 1rem;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.2s;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #5a67d8; }
    .btn-small { padding: 0.25rem 0.75rem; font-size: 0.875rem; }
    .tabs {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      border-bottom: 2px solid #e2e8f0;
    }
    .tab {
      padding: 0.75rem 1.5rem;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
      font-weight: 500;
      color: #718096;
    }
    .tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
    }
    .tab:hover { color: #667eea; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .code-block {
      background: #2d3748;
      color: #e2e8f0;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.875rem;
      margin-top: 1rem;
    }
    .loading { text-align: center; padding: 2rem; color: #718096; }
    .subtable { margin-top: 1rem; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
    .subtable table { width: 100%; border-collapse: collapse; }
    .subtable th { background: #edf2f7; font-size: 0.875rem; }
    .subtable td { font-size: 0.875rem; vertical-align: top; }
    .muted { color: #718096; }
    .mono { font-family: 'Monaco', 'Courier New', monospace; }
    /* Prevent long text (especially Jobs.message) from forcing horizontal overflow */
    .jobs-table { table-layout: fixed; }
    .jobs-table th, .jobs-table td { overflow-wrap: anywhere; word-break: break-word; }
    .jobs-table td.job-message { white-space: normal; }
    .jobs-table td.mono { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jobs-table td.job-deal { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Visual Assets: allow horizontal scroll instead of compressing columns */
    .hscroll { overflow-x: auto; width: 100%; }
    .va-table { width: max-content; min-width: 1400px; }
    .va-table th, .va-table td { white-space: nowrap; }
    .va-table td.va-doc, .va-table td.va-title { white-space: normal; min-width: 280px; }
    /* Modal for detailed inspection (Visual Assets) */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      z-index: 9999;
    }
    .modal {
      width: min(1100px, 96vw);
      max-height: 92vh;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid #e2e8f0;
      background: #f7fafc;
    }
    .modal-title { font-size: 1rem; font-weight: 700; color: #2d3748; }
    .modal-body { padding: 1rem 1.25rem; overflow: auto; }
    .modal-body h3 { margin-top: 1rem; margin-bottom: 0.5rem; color: #4a5568; }
    .modal-body pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 0.75rem;
      border-radius: 6px;
    }
    .kv {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0 0.75rem;
      font-size: 0.95rem;
    }
    .kv div:nth-child(odd) { color: #718096; }
    .kv div:nth-child(even) { color: #2d3748; }
    .inspect-image { margin: 0.5rem 0 0.75rem; }
    .inspect-image img {
      max-width: 350px;
      width: 100%;
      height: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
    }
    .inspect-image a { display: inline-block; }
    .row-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .btn-danger { background: #e53e3e; }
    .btn-danger:hover { background: #c53030; }
    .btn-secondary { background: #4a5568; }
    .btn-secondary:hover { background: #2d3748; }

    .progress-panel {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    .progress-log {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 6px;
      padding: 0.75rem;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
    }
    .progress-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.5rem 0 0.75rem;
      font-size: 0.9rem;
    }
    .progress-table th, .progress-table td {
      border-bottom: 1px solid #e2e8f0;
      padding: 0.4rem 0.5rem;
      text-align: left;
      vertical-align: top;
    }
    .progress-table th { color: #4a5568; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <h1>🎯 DealDecision AI Dashboard</h1>
      <p>Database visibility, DIO analysis inspection, and report computation debugging</p>
    </div>
  </div>

  <div class="container">
    <!-- Stats Overview -->
    <div class="grid" id="stats-grid">
      <div class="loading">Loading statistics...</div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab active" onclick="switchTab('deals')">📊 Deals</div>
      <div class="tab" onclick="switchTab('documents')">📄 Documents</div>
      <div class="tab" onclick="switchTab('visual-assets')">🧾 Visual Assets</div>
      <div class="tab" onclick="switchTab('dios')">🧠 DIO Analysis</div>
      <div class="tab" onclick="switchTab('reports')">📈 Report Computation</div>
      <div class="tab" onclick="switchTab('jobs')">⚙️ Jobs</div>
    </div>

    <!-- Tab Contents -->
    <div id="deals-tab" class="tab-content active">
      <div class="table-container">
        <h2>Active Deals</h2>
        <div id="deals-table" class="loading">Loading deals...</div>
      </div>
    </div>

    <div id="documents-tab" class="tab-content">
      <div class="table-container">
        <h2>Recent Documents</h2>
        <div id="documents-table" class="loading">Loading documents...</div>
      </div>
    </div>

    <div id="visual-assets-tab" class="tab-content">
      <div class="table-container">
        <h2>Visual Assets</h2>
        <div style="margin-bottom: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <label class="muted">
            Deal:
            <select id="visual-assets-deal-select" style="margin-left: 0.5rem; padding: 0.25rem; min-width: 360px;"></select>
          </label>
          <button id="visual-assets-load-btn" class="btn btn-small">Load</button>
          <button id="visual-assets-refresh-btn" class="btn btn-small btn-secondary">Refresh</button>
          <button id="visual-assets-analyze-deal-btn" class="btn btn-small">Analyze (deal)</button>
          <button id="visual-assets-deep-scan-deal-btn" class="btn btn-small">Deep scan (deal)</button>
          <button id="visual-assets-run-process-btn" class="btn btn-small">Run full process</button>
          <button id="documents-reextract-deal-btn" class="btn btn-small btn-danger">Re-extract documents (deal)</button>
          <button id="visual-assets-reextract-deal-btn" class="btn btn-small btn-danger">Re-extract visuals (deal)</button>
          <button id="visual-assets-reextract-all-btn" class="btn btn-small btn-danger">Re-extract visuals (all deals)</button>
          <button id="visual-assets-reextract-stop-btn" class="btn btn-small btn-secondary">Stop polling</button>
          <button id="visual-assets-reextract-clear-btn" class="btn btn-small btn-secondary">Clear progress</button>
          <button id="documents-reextract-clear-btn" class="btn btn-small btn-secondary">Clear doc re-extract</button>
          <button id="visual-assets-process-clear-btn" class="btn btn-small btn-secondary">Clear full process</button>
          <span id="visual-assets-selected" class="muted"></span>
        </div>

        <div id="deal-summary-container" class="card" style="margin-bottom: 1rem;">
          <h2 style="margin-bottom: 0.75rem;">Deal Summary (Phase 1)</h2>
          <div id="deal-summary" class="muted">Select a deal to view summary.</div>
        </div>

        <div id="va-reextract-panel" class="progress-panel" style="display:none;">
          <div style="display:flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem;">
            <strong>Re-extract visuals progress</strong>
            <span id="va-reextract-summary" class="muted"></span>
          </div>
          <div id="va-reextract-table"></div>
          <div id="va-reextract-log" class="progress-log"></div>
        </div>

        <div id="doc-reextract-panel" class="progress-panel" style="display:none;">
          <div style="display:flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem;">
            <strong>Re-extract documents progress</strong>
            <span id="doc-reextract-summary" class="muted"></span>
          </div>
          <div id="doc-reextract-table"></div>
          <div id="doc-reextract-log" class="progress-log"></div>
        </div>

        <div id="full-process-panel" class="progress-panel" style="display:none;">
          <div style="display:flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem;">
            <strong>Full process</strong>
            <span id="full-process-summary" class="muted"></span>
          </div>
          <div id="full-process-table"></div>
          <div id="full-process-log" class="progress-log"></div>
        </div>
        <div id="visual-assets-table" class="muted">Select a deal to load extracted visual nodes.</div>
      </div>
    </div>

    <div id="dios-tab" class="tab-content">
      <div class="table-container">
        <h2>DIO Analysis Objects</h2>
        <p style="margin-bottom: 1rem; color: #718096;">Inspect raw DIO data and analyzer outputs</p>
        <div id="dios-table" class="loading">Loading DIOs...</div>
      </div>

      <div class="table-container" id="score-explain-container" style="display:none;">
        <h2>Score Explainability</h2>
        <p class="muted" style="margin-bottom: 1rem;">Effective v2 weights + contributions (only financial_health + risk_assessment affect overall score; others are diagnostic-only)</p>
        <div id="score-explain" class="loading">Loading explanation...</div>
      </div>
    </div>

    <div id="reports-tab" class="tab-content">
      <div class="table-container">
        <h2>Report Computation Inspector</h2>
        <p style="margin-bottom: 1rem; color: #718096;">See how reports are computed from DIO data</p>
        <div id="reports-table" class="loading">Loading reports...</div>
      </div>
    </div>

    <div id="jobs-tab" class="tab-content">
      <div class="table-container">
        <h2>Recent Jobs</h2>
        <div style="margin-bottom: 1rem; display: flex; gap: 1rem; align-items: center;">
          <label>
            Filter by status:
            <select id="job-status-filter" onchange="loadJobs()" style="margin-left: 0.5rem; padding: 0.25rem;">
              <option value="all">All</option>
              <option value="queued">Queued</option>
              <option value="succeeded">Succeeded</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
            </select>
          </label>
          <label>
            Filter by type:
            <select id="job-type-filter" onchange="loadJobs()" style="margin-left: 0.5rem; padding: 0.25rem;">
              <option value="all">All</option>
              <option value="analyze_deal">Analyze Deal</option>
              <option value="ingest_document">Ingest Document</option>
            </select>
          </label>
          <button onclick="loadJobs()" class="btn btn-small">Refresh</button>
        </div>
        <div id="jobs-table" class="loading">Loading jobs...</div>
      </div>
    </div>
  </div>

  <div id="modal-overlay" class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-header">
        <div id="modal-title" class="modal-title">Inspect</div>
        <button id="modal-close" class="btn btn-small btn-secondary">Close</button>
      </div>
      <div id="modal-body" class="modal-body"></div>
    </div>
  </div>

  <script>
    let selectedDealId = null;
    let selectedDealName = null;
    let lastDeals = [];
    const dealNameById = {};
    const visualAssetById = {};
    const segmentAuditCacheByDealId = {};
    const dealSummaryFingerprintByDealId = {};
    let dealSummaryRefreshToken = 0;

    const visualReextractState = {
      active: false,
      runId: null,
      startedAt: null,
      mode: null, // 'deal' | 'all'
      itemsByDealId: {},
      jobIds: [],
      pollTimer: null,
      pollEveryMs: 1500,
      lastPollAt: null,
    };

    const docReextractState = {
      active: false,
      dealId: null,
      dealName: null,
      startedAt: null,
      jobId: null,
      status: null,
      progress: null,
      stage: null,
      message: null,
      updatedAt: null,
      pollTimer: null,
      pollEveryMs: 1500,
    };

    const fullProcessState = {
      active: false,
      dealId: null,
      dealName: null,
      startedAt: null,
      pollEveryMs: 1500,
      currentStep: null, // 'reextract_documents' | 'extract_visuals' | 'analyze_deal'
      steps: {
        reextract_documents: { label: 'Re-extract documents', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
        extract_visuals: { label: 'Extract visuals + page understanding', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
        analyze_deal: { label: 'Analyze deal', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
      },
      stopRequested: false,
    };

    function setSelectedDeal(dealId) {
      selectedDealId = dealId || null;
      const name = selectedDealId && typeof dealNameById[selectedDealId] === 'string' ? dealNameById[selectedDealId] : null;
      selectedDealName = name && name.length > 0 ? name : null;

      const label = document.getElementById('visual-assets-selected');
      if (label) {
        label.textContent = selectedDealId
          ? ('Selected: ' + (selectedDealName || selectedDealId))
          : '';
      }

      const sel = document.getElementById('visual-assets-deal-select');
      if (sel && selectedDealId && sel.value !== selectedDealId) {
        sel.value = selectedDealId;
      }

      loadDealSummary();
    }

    function normalizeBullets(value) {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean);
      if (typeof value === 'string') {
        const raw = value.trim();
        if (!raw) return [];
        // Split on common list delimiters, but keep single-paragraph summaries as one bullet.
        const parts = raw.split(/\\r?\\n|\\s*[•*-]\\s+/g).map(s => s.trim()).filter(Boolean);
        return parts.length >= 2 ? parts.slice(0, 12) : [raw];
      }
      return [];
    }

    function scheduleDealSummaryRefresh(reason, opts) {
      const dealId = selectedDealId;
      if (!dealId) return;

      const token = ++dealSummaryRefreshToken;
      const startFingerprint = typeof dealSummaryFingerprintByDealId[dealId] === 'string' ? dealSummaryFingerprintByDealId[dealId] : null;
      const maxAttempts = (opts && typeof opts.maxAttempts === 'number') ? opts.maxAttempts : 10;
      const delayMs = (opts && typeof opts.delayMs === 'number') ? opts.delayMs : 2500;
      const initialDelayMs = (opts && typeof opts.initialDelayMs === 'number') ? opts.initialDelayMs : 1200;

      let attempts = 0;

      const tick = async () => {
        if (token !== dealSummaryRefreshToken) return;
        if (selectedDealId !== dealId) return;

        attempts++;
        await loadDealSummary({ silent: true, reason: reason || 'auto' });

        const nextFingerprint = typeof dealSummaryFingerprintByDealId[dealId] === 'string' ? dealSummaryFingerprintByDealId[dealId] : null;
        if (startFingerprint && nextFingerprint && nextFingerprint !== startFingerprint) return;
        if (attempts >= maxAttempts) return;
        setTimeout(tick, delayMs);
      };

      setTimeout(tick, initialDelayMs);
    }

    let scoreExplainRefreshToken = 0;

    function scheduleExplainScoreRefresh(reason, opts) {
      const dealId = selectedDealId;
      if (!dealId) return;

      const token = ++scoreExplainRefreshToken;
      const startFingerprint = typeof dealSummaryFingerprintByDealId[dealId] === 'string' ? dealSummaryFingerprintByDealId[dealId] : null;
      const maxAttempts = (opts && typeof opts.maxAttempts === 'number') ? opts.maxAttempts : 10;
      const delayMs = (opts && typeof opts.delayMs === 'number') ? opts.delayMs : 2500;
      const initialDelayMs = (opts && typeof opts.initialDelayMs === 'number') ? opts.initialDelayMs : 1500;

      let attempts = 0;

      const tick = async () => {
        if (token !== scoreExplainRefreshToken) return;
        if (selectedDealId !== dealId) return;

        attempts++;

        try {
          const res = await fetch('/api/dashboard/deals/' + encodeURIComponent(dealId) + '/summary?t=' + Date.now());
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (attempts < maxAttempts) setTimeout(tick, delayMs);
            return;
          }

          const dio = data?.dio || {};
          const nextFingerprint = String(dio?.analysis_version ?? '') + '|' + String(dio?.updated_at ?? '');
          const dioId = dio?.dio_id;

          // If we have a prior fingerprint, wait for it to change; otherwise best-effort explain once a DIO exists.
          const ready = Boolean(dioId) && (!startFingerprint || (nextFingerprint && nextFingerprint !== startFingerprint));
          if (ready) {
            try {
              await loadDIOs();
              await loadReports();
            } catch {
              // best-effort
            }
            explainScore(String(dioId));
            return;
          }
        } catch {
          // ignore and retry
        }

        if (attempts >= maxAttempts) return;
        setTimeout(tick, delayMs);
      };

      setTimeout(tick, initialDelayMs);
    }

    async function loadDealSummary(opts) {
      const container = document.getElementById('deal-summary-container');
      const slot = document.getElementById('deal-summary');
      if (!slot) return;

      if (!selectedDealId) {
        if (container) container.style.display = 'block';
        slot.innerHTML = '<div class="muted">Select a deal to view summary.</div>';
        return;
      }

      if (container) container.style.display = 'block';
      if (!(opts && opts.silent)) {
        slot.innerHTML = '<div class="loading">Loading summary...</div>';
      }

      try {
        const res = await fetch('/api/dashboard/deals/' + encodeURIComponent(selectedDealId) + '/summary?t=' + Date.now());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!(opts && opts.silent)) {
            slot.innerHTML = '<div class="muted">Summary unavailable: ' + escapeHtml(res.status) + ' ' + escapeHtml(data?.error || '') + '</div>';
          }
          return;
        }

        const deal = data?.deal || {};
        const dio = data?.dio || {};

        try {
          const fp = String(dio?.analysis_version ?? '') + '|' + String(dio?.updated_at ?? '');
          dealSummaryFingerprintByDealId[selectedDealId] = fp;
        } catch {
          // ignore
        }

        const summary = data?.summary || {};
        const phase1 = summary?.phase1 || {};
        const overview = phase1?.deal_overview_v2 || {};
        const decision = phase1?.decision_summary_v1 || {};
        const archetype = phase1?.business_archetype_v1 || {};

        const sections = [];

        const businessBullets = [];
        if (typeof overview?.deal_type === 'string' && overview.deal_type.trim()) businessBullets.push('Deal type: ' + overview.deal_type.trim());
        if (typeof overview?.business_model === 'string' && overview.business_model.trim()) businessBullets.push('Business model: ' + overview.business_model.trim());
        if (typeof archetype?.value === 'string' && archetype.value.trim()) {
          const conf = (typeof archetype?.confidence === 'number' && Number.isFinite(archetype.confidence)) ? archetype.confidence : null;
          businessBullets.push('Business archetype: ' + archetype.value.trim() + (conf != null ? (' (conf ' + conf.toFixed(2) + ')') : ''));
        }
        if (businessBullets.length > 0) sections.push({ title: 'Business', bullets: businessBullets });

        const ps = normalizeBullets(overview?.product_solution);
        if (ps.length > 0) sections.push({ title: 'What they do / Product', bullets: ps });

        const icp = normalizeBullets(overview?.market_icp);
        if (icp.length > 0) sections.push({ title: 'Market / ICP', bullets: icp });

        const gtm = normalizeBullets(overview?.go_to_market);
        if (gtm.length > 0) sections.push({ title: 'Go-to-market', bullets: gtm });

        const traction = normalizeBullets(overview?.traction_signals);
        if (traction.length > 0) sections.push({ title: 'Traction', bullets: traction });

        const raiseBullets = [];
        const raise = normalizeBullets(overview?.raise);
        const terms = normalizeBullets(overview?.raise_terms);
        if (raise.length > 0) raiseBullets.push('Raise: ' + raise[0]);
        if (terms.length > 0) raiseBullets.push('Terms: ' + terms[0]);
        if (raiseBullets.length > 0) sections.push({ title: 'Raise', bullets: raiseBullets });

        const risks = normalizeBullets(overview?.key_risks_detected);
        if (risks.length > 0) sections.push({ title: 'Key risks (detected)', bullets: risks });

        const decisionBullets = [];
        if (typeof decision?.recommendation === 'string' && decision.recommendation.trim()) decisionBullets.push('Recommendation: ' + decision.recommendation.trim());
        if (typeof decision?.confidence === 'number' && Number.isFinite(decision.confidence)) decisionBullets.push('Confidence: ' + decision.confidence.toFixed(0));
        const reasons = normalizeBullets(decision?.reasons);
        if (reasons.length > 0) decisionBullets.push('Reasons: ' + reasons.slice(0, 4).join(' • '));
        const blockers = normalizeBullets(decision?.blockers);
        if (blockers.length > 0) decisionBullets.push('Blockers: ' + blockers.slice(0, 4).join(' • '));
        const nextReq = normalizeBullets(decision?.next_requests);
        if (nextReq.length > 0) decisionBullets.push('Next requests: ' + nextReq.slice(0, 4).join(' • '));
        if (decisionBullets.length > 0) sections.push({ title: 'Decision readiness', bullets: decisionBullets });

        const header = ''
          + '<div style="margin-bottom:0.75rem;">'
          +   '<div><strong>' + escapeHtml(deal?.name || selectedDealName || selectedDealId) + '</strong></div>'
          +   '<div class="muted">Stage: ' + escapeHtml(deal?.stage || '-') + ' • Priority: ' + escapeHtml(deal?.priority || '-')
          +     (dio?.analysis_version != null ? (' • DIO v' + escapeHtml(dio.analysis_version)) : '')
          +   '</div>'
          +   '<div style="margin-top:0.5rem; display:flex; gap:0.5rem; flex-wrap: wrap; align-items:center;">'
          +     (dio?.dio_id
            ? (
              '<span class="mono muted">dio_id=' + escapeHtml(String(dio.dio_id)) + '</span>'
                + '<button class="btn btn-small" data-dio-id="' + escapeHtml(String(dio.dio_id)) + '" onclick="inspectDIO(this.dataset.dioId)">Inspect DIO</button>'
                + '<button class="btn btn-small" data-dio-id="' + escapeHtml(String(dio.dio_id)) + '" onclick="explainScore(this.dataset.dioId)">Explain Score</button>'
                + (dio?.analysis_version != null
                  ? '<button class="btn btn-small" data-deal-id="' + escapeHtml(String(deal?.id || selectedDealId)) + '" data-version="' + escapeHtml(String(dio.analysis_version)) + '" onclick="viewReport(this.dataset.dealId, Number(this.dataset.version))">View Report</button>'
                  : '')
            )
            : (
              '<span class="muted">No DIO yet. Use “Analyze (deal)” or “Run full process”.</span>'
            ))
          +   '</div>'
          + '</div>';

        const sectionHtml = sections.length > 0
          ? sections.map(s => {
              return ''
                + '<div style="margin: 0.75rem 0;">'
                +   '<div style="font-weight: 600; margin-bottom: 0.25rem;">' + escapeHtml(s.title) + '</div>'
                +   '<ul style="margin-left: 1.25rem;">'
                +     s.bullets.map(b => '<li>' + escapeHtml(b) + '</li>').join('')
                +   '</ul>'
                + '</div>';
            }).join('')
          : '<div class="muted">No Phase 1 summary fields found yet for this deal.</div>';

        slot.innerHTML = header + sectionHtml;
      } catch (e) {
        if (!(opts && opts.silent)) {
          slot.innerHTML = '<div class="muted">Failed to load summary: ' + escapeHtml(e?.message || String(e)) + '</div>';
        }
      }
    }

    function populateVisualAssetsDealSelect(deals) {
      const sel = document.getElementById('visual-assets-deal-select');
      if (!sel) return;

      const items = Array.isArray(deals)
        ? deals
          .map(d => ({ id: (d && typeof d.id === 'string') ? d.id : '', name: (d && typeof d.name === 'string') ? d.name : '' }))
          .filter(x => x.id.length > 0)
        : [];

      items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const opts = ['<option value="">-- Select a deal --</option>']
        .concat(items.map(x => '<option value="' + escapeHtml(x.id) + '">' + escapeHtml(x.name || x.id) + '</option>'))
        .join('');

      sel.innerHTML = opts;
      if (selectedDealId) sel.value = selectedDealId;
    }

    // Tab switching
    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabName + '-tab').classList.add('active');
    }

    function activateTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tabName + '-tab').classList.add('active');

      // Best-effort: mark the matching tab header active
      const tabs = Array.from(document.querySelectorAll('.tab'));
      const match = tabs.find(t => String(t.getAttribute('onclick') || '').includes("'" + tabName + "'"));
      if (match) match.classList.add('active');
    }

    // Fetch and render stats
    async function loadStats() {
      const res = await fetch('/api/dashboard/stats');
      const data = await res.json();
      
      document.getElementById('stats-grid').innerHTML = \`
        <div class="card">
          <h2>Deals</h2>
          <div class="stat">
            <span class="stat-label">Total Active</span>
            <span class="stat-value">\${data.deals.total}</span>
          </div>
          <div class="stat">
            <span class="stat-label">With Analysis</span>
            <span class="stat-value">\${data.deals.with_analysis}</span>
          </div>
        </div>
        <div class="card">
          <h2>Documents</h2>
          <div class="stat">
            <span class="stat-label">Total Uploaded</span>
            <span class="stat-value">\${data.documents.total}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Processed</span>
            <span class="stat-value">\${data.documents.processed}</span>
          </div>
        </div>
        <div class="card">
          <h2>DIO Objects</h2>
          <div class="stat">
            <span class="stat-label">Total Created</span>
            <span class="stat-value">\${data.dios.total}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Latest Version</span>
            <span class="stat-value">\${data.dios.latest_version}</span>
          </div>
        </div>
        <div class="card">
          <h2>Jobs</h2>
          <div class="stat">
            <span class="stat-label">Completed</span>
            <span class="stat-value">\${data.jobs.completed}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Failed</span>
            <span class="stat-value" style="color: #e53e3e">\${data.jobs.failed}</span>
          </div>
        </div>
      \`;
    }

    // Fetch and render deals
    async function loadDeals() {
      const res = await fetch('/api/dashboard/deals');
      const deals = await res.json();

      // Cache deals for bulk actions (re-extract across deals) so we don't need a second fetch.
      lastDeals = Array.isArray(deals) ? deals : [];

      // Keep a client-side deal name index for safe selection without injecting strings into onclick.
      try {
        for (const d of (Array.isArray(deals) ? deals : [])) {
          if (d && typeof d.id === 'string') dealNameById[d.id] = typeof d.name === 'string' ? d.name : '';
        }
      } catch {
        // ignore
      }

      // Keep Visual Assets deal selector in sync with fetched deals.
      populateVisualAssetsDealSelect(deals);

      const container = document.getElementById('deals-table');
      const rowsHtml = Array.isArray(deals)
        ? deals.map(d => {
          const dealId = typeof d?.id === 'string' ? d.id : '';
          const dealIdAttr = escapeHtml(dealId);
          const dealIdEnc = encodeURIComponent(dealId);
          const dealName = typeof d?.name === 'string' ? d.name : '';
          const hasDio = Boolean(d?.has_dio);
          const created = d?.created_at ? new Date(d.created_at).toLocaleDateString() : '-';
          const viewDioBtn = hasDio
            ? '<button data-deal-action="view-dio" data-deal-id="' + dealIdAttr + '" class="btn btn-small">View DIO</button>'
            : '';

          const qaPass = (d?.visual_quality_pass === true)
            ? true
            : (d?.visual_quality_pass === false)
              ? false
              : null;
          const qaKnownGarbage = Number.isFinite(Number(d?.visual_quality_known_garbage))
            ? Number(d.visual_quality_known_garbage)
            : null;
          const qaLowSig = Number.isFinite(Number(d?.visual_quality_low_signal_non_empty))
            ? Number(d.visual_quality_low_signal_non_empty)
            : null;
          const qaEmpty = Number.isFinite(Number(d?.visual_quality_empty))
            ? Number(d.visual_quality_empty)
            : null;
          const qaBadge = (qaPass === true)
            ? '<span class="badge badge-success">Pass</span>'
            : (qaPass === false)
              ? '<span class="badge badge-danger">Fail</span>'
              : '<span class="muted">-</span>';
          const qaDetails = (qaKnownGarbage != null || qaLowSig != null || qaEmpty != null)
            ? '<span class="muted">g=' + escapeHtml(qaKnownGarbage ?? '-')
              + ' low=' + escapeHtml(qaLowSig ?? '-')
              + ' empty=' + escapeHtml(qaEmpty ?? '-')
              + '</span>'
            : '';

          return ''
            + '<tr>'
            +   '<td><strong>' + escapeHtml(dealName) + '</strong></td>'
            +   '<td><span class="badge badge-info">' + escapeHtml(d?.stage ?? '') + '</span></td>'
            +   '<td><span class="badge badge-warning">' + escapeHtml(d?.priority ?? '') + '</span></td>'
            +   '<td>' + escapeHtml(d?.doc_count ?? 0) + '</td>'
            +   '<td>' + (hasDio ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>') + '</td>'
            +   '<td>' + qaBadge + (qaDetails ? '<br />' + qaDetails : '') + '</td>'
            +   '<td>' + created + '</td>'
            +   '<td>'
            +     '<div class="row-actions">'
            +       '<button data-deal-action="select" data-deal-id="' + dealIdAttr + '" class="btn btn-small btn-secondary">Select</button>'
            +       '<a href="/api/v1/deals/' + dealIdEnc + '" class="btn btn-small" target="_blank">View</a>'
            +       viewDioBtn
            +       '<button data-deal-action="analyze" data-deal-id="' + dealIdAttr + '" class="btn btn-small">Analyze</button>'
            +       '<button data-deal-action="extract-visuals" data-deal-id="' + dealIdAttr + '" class="btn btn-small">Extract visuals</button>'
            +       '<button data-deal-action="deep-scan-visuals" data-deal-id="' + dealIdAttr + '" class="btn btn-small">Deep scan</button>'
            +       '<button data-deal-action="remediate-extraction" data-deal-id="' + dealIdAttr + '" class="btn btn-small btn-danger">Remediate</button>'
            +     '</div>'
            +   '</td>'
            + '</tr>';
        }).join('')
        : '';

      container.innerHTML = ''
        + '<table>'
        +   '<thead>'
        +     '<tr>'
        +       '<th>Name</th>'
        +       '<th>Stage</th>'
        +       '<th>Priority</th>'
        +       '<th>Documents</th>'
        +       '<th>Has DIO</th>'
        +       '<th>Visual QA</th>'
        +       '<th>Created</th>'
        +       '<th>Actions</th>'
        +     '</tr>'
        +   '</thead>'
        +   '<tbody>'
        +     rowsHtml
        +   '</tbody>'
        + '</table>';

      // Wire up action buttons without injecting onclick strings.
      for (const btn of container.querySelectorAll('button[data-deal-action]')) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.dataset.dealAction;
          const dealId = btn.dataset.dealId;
          if (!dealId) return;
          if (action === 'select') return selectDeal(dealId);
          if (action === 'view-dio') return viewDIO(dealId);
          return enqueueDealJob(dealId, action);
        });
      }
    }

    function selectDeal(dealId) {
      setSelectedDeal(dealId);
      // When selecting a deal, jump to visual assets for node-level debugging.
      activateTab('visual-assets');
      loadVisualAssets();
    }

    async function enqueueDealJob(dealId, action) {
      const routes = {
        'analyze': '/api/v1/deals/' + encodeURIComponent(dealId) + '/analyze',
        'extract-visuals': '/api/v1/deals/' + encodeURIComponent(dealId) + '/extract-visuals',
        'deep-scan-visuals': '/api/v1/deals/' + encodeURIComponent(dealId) + '/deep-scan-visuals',
        'remediate-extraction': '/api/v1/deals/' + encodeURIComponent(dealId) + '/remediate-extraction',
      };
      const url = routes[action];
      if (!url) {
        alert('Unknown action: ' + action);
        return;
      }

      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert('Failed to enqueue: ' + res.status + ' ' + (data?.error || ''));
          return;
        }

        // Prefer selecting the deal after enqueue.
        setSelectedDeal(dealId);
        activateTab('jobs');
        await loadJobs();
        if (data?.job_id) {
          alert('Enqueued job ' + data.job_id);
        } else {
          alert('Enqueued job');
        }
      } catch (e) {
        alert('Failed to enqueue: ' + (e?.message || String(e)));
      }
    }

    async function loadVisualAssets() {
      const slot = document.getElementById('visual-assets-table');
      if (!selectedDealId) {
        slot.innerHTML = '<div class="muted">No deal selected.</div>';
        return;
      }
      slot.innerHTML = '<div class="loading">Loading visual assets...</div>';
      try {
        const res = await fetch('/api/v1/deals/' + encodeURIComponent(selectedDealId) + '/visual-assets?include_page_ocr_v2=1&include_page_understanding_v1=1&t=' + Date.now());
        const data = await res.json();
        const assets = Array.isArray(data?.visual_assets) ? data.visual_assets : [];
        // Index by id for Inspect modal.
        try {
          for (const a of assets) {
            const vid = a && (a.visual_asset_id || a.id) ? String(a.visual_asset_id || a.id) : null;
            if (vid) visualAssetById[vid] = a;
          }
        } catch {
          // ignore
        }
        const headerHtml = ''
          + '<div style="margin-bottom: 0.75rem; color: #666;">'
          +   'Deal: <span class="mono">' + escapeHtml(selectedDealName || selectedDealId) + '</span>'
          +   ' • ' + assets.length + ' assets'
          + '</div>';

        const rowsHtml = assets.map(a => {
          const doc = (a.document && a.document.title) || a.document_title || a.document_id || 'N/A';
          const page = a.page_index != null ? a.page_index : '-';
          const title = a.slide_title || '-';
          const seg = a.effective_segment || a.segment || 'unknown';
          const segSource = a.segment_source || '-';
          const persisted = a.persisted_segment_key || '-';
          const computed = a.computed_segment || '-';
          const kind = a.structured_kind || a.asset_type || '-';
          const extractor = a.extractor_version || '-';
          const hasStructured = a.structured_json ? 'yes' : (a.structured_summary ? 'summary' : 'no');
          const ocrSuppressed = a.ocr_suppressed === true;
          const ocrLen = typeof a.ocr_text === 'string' ? a.ocr_text.length : 0;
          const ocrCell = ocrSuppressed ? 'suppressed' : String(ocrLen);

          const pageOcrV2TextClean = typeof a.page_ocr_v2_text_clean === 'string' ? a.page_ocr_v2_text_clean : '';
          const pageOcrV2TextRaw = typeof a.page_ocr_v2_text === 'string' ? a.page_ocr_v2_text : '';
          const pageOcrV2Text = pageOcrV2TextClean || pageOcrV2TextRaw;
          const pageOcrV2Mode = pageOcrV2TextClean ? 'clean' : (pageOcrV2TextRaw ? 'raw' : '-');
          const pageOcrV2Snippet = pageOcrV2Text
            ? (pageOcrV2Text.length > 140 ? (pageOcrV2Text.slice(0, 140) + '…') : pageOcrV2Text)
            : '';
          const pageOcrV2Conf = (typeof a.page_ocr_v2_avg_confidence === 'number' && Number.isFinite(a.page_ocr_v2_avg_confidence))
            ? a.page_ocr_v2_avg_confidence.toFixed(3)
            : (typeof a.page_ocr_v2_avg_confidence === 'string' && a.page_ocr_v2_avg_confidence.trim() ? a.page_ocr_v2_avg_confidence : '-');
          const pageOcrV2Provider = typeof a.page_ocr_v2_provider === 'string' ? a.page_ocr_v2_provider : '';
          const pageOcrV2Kept = (typeof a.page_ocr_v2_kept_blocks === 'number' && Number.isFinite(a.page_ocr_v2_kept_blocks))
            ? a.page_ocr_v2_kept_blocks
            : null;
          const pageOcrV2Total = (typeof a.page_ocr_v2_total_blocks === 'number' && Number.isFinite(a.page_ocr_v2_total_blocks))
            ? a.page_ocr_v2_total_blocks
            : null;
          const pageOcrV2BlocksMeta = (pageOcrV2Kept != null && pageOcrV2Total != null)
            ? (' • blocks ' + pageOcrV2Kept + '/' + pageOcrV2Total)
            : '';
          const pageOcrV2Cell = pageOcrV2Snippet
            ? (
                escapeHtml(pageOcrV2Snippet)
                + '<br/><span class="muted">'
                + escapeHtml(pageOcrV2Provider || 'ocr_v2')
                + ' conf=' + escapeHtml(pageOcrV2Conf)
                + ' • ' + escapeHtml(pageOcrV2Mode)
                + escapeHtml(pageOcrV2BlocksMeta)
                + '</span>'
              )
            : '<span class="muted">-</span>';
          const updatedRaw = a.page_understanding_v1_updated_at || a.updated_at || a.created_at;
          const updated = updatedRaw ? new Date(updatedRaw).toLocaleString() : '-';
          const updatedSuffix = a.page_understanding_v1_updated_at ? ' (PU)' : '';
          const vaId = a.visual_asset_id || a.id || '';
          const vaIdAttr = escapeHtml(String(vaId));

          const aiBtns = vaId
            ? ''
              + '<button class="btn btn-small btn-secondary" data-va-action="inspect" data-va-id="' + vaIdAttr + '">Inspect</button>'
              + '<button class="btn btn-small" data-va-action="ai" data-va-id="' + vaIdAttr + '" data-audience="investor">AI (investor)</button>'
              + '<button class="btn btn-small" data-va-action="ai" data-va-id="' + vaIdAttr + '" data-audience="analyst">AI (analyst)</button>'
            : '<span class="muted">-</span>';

          return ''
            + '<tr>'
            +   '<td class="va-doc">' + escapeHtml(doc) + '</td>'
            +   '<td class="mono">' + escapeHtml(page) + '</td>'
            +   '<td class="va-title">' + escapeHtml(title) + '</td>'
            +   '<td class="mono">' + escapeHtml(seg) + '</td>'
            +   '<td class="mono">' + escapeHtml(segSource) + '</td>'
            +   '<td class="mono">' + escapeHtml(persisted) + '</td>'
            +   '<td class="mono">' + escapeHtml(computed) + '</td>'
            +   '<td class="mono">' + escapeHtml(kind) + '</td>'
            +   '<td class="mono">' + escapeHtml(extractor) + '</td>'
            +   '<td>' + hasStructured + '</td>'
            +   '<td class="mono">' + escapeHtml(ocrCell) + '</td>'
            +   '<td class="va-ocr-v2">' + pageOcrV2Cell + '</td>'
            +   '<td>' + escapeHtml(updated + updatedSuffix) + '</td>'
            +   '<td>' + aiBtns + '</td>'
            + '</tr>';
        }).join('');

        slot.innerHTML = ''
          + headerHtml
          + '<div class="hscroll">'
          + '<table class="va-table">'
          +   '<thead>'
          +     '<tr>'
          +       '<th>Doc</th>'
          +       '<th>Page</th>'
          +       '<th>Title</th>'
          +       '<th>Segment</th>'
          +       '<th>Source</th>'
          +       '<th>Persisted</th>'
          +       '<th>Computed</th>'
          +       '<th>Kind</th>'
          +       '<th>Extractor</th>'
          +       '<th>Structured</th>'
          +       '<th>OCR</th>'
          +       '<th>Page OCR v2</th>'
          +       '<th>Updated</th>'
          +       '<th>Actions</th>'
          +     '</tr>'
          +   '</thead>'
          +   '<tbody>'
          +     rowsHtml
          +   '</tbody>'
          + '</table>'
          + '</div>';

        for (const btn of slot.querySelectorAll('button[data-va-action]')) {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const action = btn.dataset.vaAction;
            const visualAssetId = btn.dataset.vaId;
            if (!visualAssetId) return;
            if (action === 'inspect') return inspectVisualAsset(visualAssetId);
            if (action === 'ai') return aiAnalyzeVisualAsset(visualAssetId, btn.dataset.audience);
          });
        }
      } catch (e) {
        slot.innerHTML = '<div class="muted">Failed to load visual assets: ' + escapeHtml(e?.message || String(e)) + '</div>';
      }
    }

    async function aiAnalyzeVisualAsset(visualAssetId, audience) {
      try {
        const res = await fetch('/visual-assets/' + encodeURIComponent(visualAssetId) + '/ai-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audience: audience || 'investor' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert('AI analyze failed: ' + res.status + ' ' + (data?.error || ''));
          return;
        }

        const modal = window.open('', 'AI Analyze', 'width=1100,height=800');
        modal.document.write(
          ''
            + '<html>'
            +   '<head>'
            +     '<title>AI Analyze - ' + escapeHtml(visualAssetId) + '</title>'
            +     '<style>'
            +       'body { font-family: monospace; padding: 1.5rem; background: #1e1e1e; color: #d4d4d4; }'
            +       'h1 { color: #4ec9b0; }'
            +       'pre { background: #2d2d2d; padding: 1rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }'
            +     '</style>'
            +   '</head>'
            +   '<body>'
            +     '<h1>AI Analyze</h1>'
            +     '<p><strong>visual_asset_id:</strong> ' + escapeHtml(visualAssetId) + '</p>'
            +     '<p><strong>audience:</strong> ' + escapeHtml(audience) + '</p>'
            +     '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>'
            +   '</body>'
            + '</html>'
        );
        modal.document.close();
      } catch (e) {
        alert('AI analyze failed: ' + (e?.message || String(e)));
      }
    }

    // Fetch and render documents
    async function loadDocuments() {
      const res = await fetch('/api/dashboard/documents');
      const docs = await res.json();
      
      document.getElementById('documents-table').innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Deal</th>
              <th>Type</th>
              <th>Status</th>
              <th>PDF v2</th>
              <th>OCR v2</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            \${docs.map(d => \`
              <tr>
                <td>\${d.title}</td>
                <td>\${d.deal_name || 'N/A'}</td>
                <td><span class="badge badge-info">\${d.type}</span></td>
                <td><span class="badge badge-\${d.status === 'completed' ? 'success' : 'warning'}">\${d.status}</span></td>
                <td>
                  \${d.pdf_v2_status
                    ? '<span class="badge badge-' + (d.pdf_v2_status === 'ok' ? 'success' : (d.pdf_v2_status === 'error' ? 'danger' : 'warning')) + '">' + d.pdf_v2_status + '</span> <span class="muted">(' + Number(d.pdf_v2_pages || 0) + ')</span>'
                    : '<span class="muted">—</span>'}
                </td>
                <td>
                  \${Number(d.pdf_v2_pages_with_ocr_v2 || 0) > 0
                    ? '<span class="badge badge-success">' + Number(d.pdf_v2_pages_with_ocr_v2 || 0) + '/' + Number(d.pdf_v2_pages || 0) + '</span>'
                    : '<span class="muted">—</span>'}
                </td>
                <td>\${new Date(d.uploaded_at).toLocaleDateString()}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    // Fetch and render DIOs
    async function loadDIOs() {
      const res = await fetch('/api/dashboard/dios');
      const dios = await res.json();
      
      document.getElementById('dios-table').innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Deal Name</th>
              <th>Version</th>
              <th>Analyzers</th>
              <th>Overall Score</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            \${dios.map(d => \`
              <tr>
                <td><strong>\${d.deal_name}</strong></td>
                <td>\${d.analysis_version}</td>
                <td>\${d.analyzer_count} analyzers</td>
                <td><span class="stat-value" style="font-size: 1.25rem">\${d.overall_score ?? 'N/A'}</span></td>
                <td>\${new Date(d.created_at).toLocaleString()}</td>
                <td>
                  <button onclick="inspectDIO('\${d.dio_id}')" class="btn btn-small">Inspect DIO</button>
                  <button onclick="viewReport('\${d.deal_id}', \${d.analysis_version})" class="btn btn-small">View Report</button>
                  <button onclick="explainScore('\${d.dio_id}')" class="btn btn-small">Explain Score</button>
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    // Fetch and render reports
    async function loadReports() {
      const res = await fetch('/api/dashboard/reports');
      const reports = await res.json();
      
      document.getElementById('reports-table').innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Deal Name</th>
              <th>Version</th>
              <th>Overall Score</th>
              <th>Grade</th>
              <th>Recommendation</th>
              <th>Categories</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            \${reports.map(r => \`
              <tr>
                <td><strong>\${r.deal_name}</strong></td>
                <td>\${r.version}</td>
                <td><span class="stat-value" style="font-size: 1.25rem">\${r.overallScore}</span></td>
                <td><span class="badge badge-\${r.grade === 'Excellent' ? 'success' : r.grade === 'Good' ? 'info' : 'warning'}">\${r.grade}</span></td>
                <td><span class="badge badge-\${r.recommendation === 'yes' ? 'success' : 'warning'}">\${r.recommendation}</span></td>
                <td>\${r.categories.length} categories</td>
                <td>
                  <button onclick="inspectReport('\${r.dealId}', \${r.version})" class="btn btn-small">Inspect</button>
                  \${r.dio_id ? '<button data-dio-id="' + r.dio_id + '" onclick="explainScore(this.dataset.dioId)" class="btn btn-small">Explain Score</button>' : ''}
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function openModal(title, bodyHtml) {
      const overlay = document.getElementById('modal-overlay');
      const titleEl = document.getElementById('modal-title');
      const bodyEl = document.getElementById('modal-body');
      if (titleEl) titleEl.textContent = title || 'Inspect';
      if (bodyEl) bodyEl.innerHTML = bodyHtml || '';
      if (overlay) overlay.style.display = 'flex';
    }

    function closeModal() {
      const overlay = document.getElementById('modal-overlay');
      if (overlay) overlay.style.display = 'none';
    }

    function setModalBody(bodyHtml) {
      const bodyEl = document.getElementById('modal-body');
      if (bodyEl) bodyEl.innerHTML = bodyHtml || '';
    }

    (function bindModalClose() {
      const btn = document.getElementById('modal-close');
      const overlay = document.getElementById('modal-overlay');
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
      }
      if (overlay && !overlay.dataset.bound) {
        overlay.dataset.bound = '1';
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeModal();
        });
      }
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
      });
    })();

    async function getSegmentAuditForDeal(dealId) {
      if (!dealId) return null;
      const cached = segmentAuditCacheByDealId[dealId];
      if (cached && cached.data) return cached.data;
      segmentAuditCacheByDealId[dealId] = { data: null, fetching: true };
      const url = '/api/v1/deals/' + encodeURIComponent(dealId) + '/lineage?debug_segments=1&segment_audit=1&group_pptx=1';
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      segmentAuditCacheByDealId[dealId] = { data: json, fetching: false };
      return json;
    }

    function findSegmentAuditItem(auditJson, base) {
      const report = auditJson && auditJson.segment_audit_report ? auditJson.segment_audit_report : null;
      const docs = report && Array.isArray(report.documents) ? report.documents : [];
      const wantVaId = base && (base.visual_asset_id || base.id) ? String(base.visual_asset_id || base.id) : null;
      const wantDocId = base && base.document_id ? String(base.document_id) : null;
      const wantPage = base && base.page_index != null ? Number(base.page_index) : null;

      for (const d of docs) {
        const items = d && Array.isArray(d.items) ? d.items : [];
        for (const it of items) {
          const itVaId = it && (it.visual_asset_id || it.id) ? String(it.visual_asset_id || it.id) : null;
          if (wantVaId && itVaId && itVaId === wantVaId) return it;
          const itDocId = it && it.document_id ? String(it.document_id) : null;
          const itPage = it && it.page_index != null ? Number(it.page_index) : null;
          if (wantDocId && wantPage != null && itDocId === wantDocId && itPage === wantPage) return it;
        }
      }
      return null;
    }

    function renderMaybeJson(obj) {
      try {
        return '<pre>' + escapeHtml(JSON.stringify(obj, null, 2)) + '</pre>';
      } catch {
        return '<pre>' + escapeHtml(String(obj)) + '</pre>';
      }
    }

    function renderKv(pairs) {
      return '<div class="kv">'
        + pairs.map(([k, v]) => '<div>' + escapeHtml(k) + '</div><div>' + escapeHtml(v == null ? '-' : String(v)) + '</div>').join('')
        + '</div>';
    }

    async function inspectVisualAsset(visualAssetId) {
      const base = visualAssetId ? visualAssetById[String(visualAssetId)] : null;
      if (!base) {
        openModal('Visual Asset Inspect', '<div class="muted">Missing base visual asset data for id: ' + escapeHtml(visualAssetId) + '</div>');
        return;
      }

      const docTitle = (base.document && base.document.title) || base.document_title || base.document_id || 'N/A';
      const page = base.page_index != null ? base.page_index : '-';
      const title = base.slide_title || '-';
      const seg = base.effective_segment || base.segment || 'unknown';

      openModal(
        'Visual Asset • ' + String(docTitle) + ' • page ' + String(page),
        '<div class="muted">Loading…</div>'
      );

      const basePairs = [
        ['visual_asset_id', base.visual_asset_id || base.id],
        ['document', docTitle],
        ['document_id', base.document_id],
        ['page_index', page],
        ['slide_title', title],
        ['segment', seg],
        ['segment_source', base.segment_source],
        ['segment_confidence', base.segment_confidence],
        ['computed_segment', base.computed_segment],
        ['computed_confidence', base.computed_confidence],
        ['persisted_segment_key', base.persisted_segment_key],
        ['persisted_segment_source', base.persisted_segment_source],
        ['segment_promoted_at', base.segment_promoted_at],
        ['segment_overridden_at', base.segment_overridden_at],
        ['segment_override_note', base.segment_override_note],
      ];

      const imageUri = typeof base.image_uri === 'string' ? base.image_uri : '';

      const evidenceSnips = Array.isArray(base.evidence_sample_snippets) ? base.evidence_sample_snippets : [];
      const ocrSuppressed = base.ocr_suppressed === true;
      const ocrText = typeof base.ocr_text === 'string' ? base.ocr_text : '';
      const pageUnderstandingV1 = (base.page_understanding_v1 && typeof base.page_understanding_v1 === 'object') ? base.page_understanding_v1 : null;
      const pageUnderstandingV1UpdatedAt = base.page_understanding_v1_updated_at || null;

      let html = '';
      html += '<h3>Summary</h3>';
      html += renderKv(basePairs);
      html += '<h3>Preview</h3>';
      html += imageUri
        ? '<div class="inspect-image">'
          + '<a href="' + escapeHtml(imageUri) + '" target="_blank" rel="noopener noreferrer">'
          + '<img src="' + escapeHtml(imageUri) + '" alt="Visual asset preview" loading="lazy" />'
          + '</a>'
          + '<div class="muted">Click image to open full size</div>'
          + '</div>'
        : '<div class="muted">No image_uri available for this visual asset.</div>';
      html += '<h3>Evidence Snippets</h3>';
      html += evidenceSnips.length > 0
        ? '<ul>' + evidenceSnips.map(s => '<li><span class="mono">' + escapeHtml(s) + '</span></li>').join('') + '</ul>'
        : '<div class="muted">No linked evidence snippets.</div>';
      html += '<h3>OCR</h3>';
      html += ocrSuppressed
        ? '<div class="muted">OCR suppressed (structured extraction available). Use API include_ocr=true to view OCR.</div>'
        : ocrText
          ? '<pre>' + escapeHtml(ocrText) + '</pre>'
          : '<div class="muted">No OCR text found on latest extraction.</div>';

      html += '<h3>Page Understanding v1 (persisted)</h3>';
      if (pageUnderstandingV1) {
        const pu = pageUnderstandingV1;
        const puSummary = (typeof pu.resolved_summary === 'string')
          ? (pu.resolved_summary.length > 240 ? (pu.resolved_summary.slice(0, 240) + '…') : pu.resolved_summary)
          : null;
        html += renderKv([
          ['resolved_title', pu.resolved_title],
          ['resolved_slide_type', pu.resolved_slide_type],
          ['resolved_summary', puSummary],
          ['generated_at', pu.generated_at],
          ['persisted_at', pageUnderstandingV1UpdatedAt],
          ['region_asset_count', pu.inputs && pu.inputs.region_asset_count != null ? pu.inputs.region_asset_count : null],
          ['regions', Array.isArray(pu.regions) ? pu.regions.length : null],
          ['key_metrics', Array.isArray(pu.key_metrics) ? pu.key_metrics.length : null],
        ]);
        html += '<details style="margin-top: 0.5rem;">'
          + '<summary class="muted">Raw page_understanding_v1 JSON</summary>'
          + renderMaybeJson(pu)
          + '</details>';
      } else {
        html += '<div class="muted">None</div>';
      }

      html += '<h3>Structured Summary</h3>';
      html += base.structured_summary ? renderMaybeJson(base.structured_summary) : '<div class="muted">None</div>';
      html += '<h3>Structured JSON</h3>';
      html += base.structured_json ? renderMaybeJson(base.structured_json) : '<div class="muted">None</div>';

      setModalBody(html + '<h3>Segment Decision (debug)</h3><div class="muted">Loading from lineage debug…</div>');

      try {
        const audit = await getSegmentAuditForDeal(selectedDealId);
        const item = findSegmentAuditItem(audit, base);
        let debugHtml = '';
        if (!audit || audit.error) {
          debugHtml = '<div class="muted">Segment audit unavailable: ' + escapeHtml(audit?.error || 'unknown_error') + '</div>';
        } else if (!item) {
          debugHtml = '<div class="muted">No matching segment audit item found for this visual asset.</div>';
        } else {
          const reason = item.computed_reason || item.reason || null;
          const headerBits = (() => {
            if (!reason) return null;
            const get = (obj, key) => {
              if (!obj || typeof obj !== 'object') return null;
              return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null;
            };
            const detected = get(reason, 'detected_header');
            const trusted = get(reason, 'detected_header_trusted');
            const detectedSeg = get(reason, 'detected_header_segment');
            const applied = get(reason, 'applied_header');
            const appliedSource = get(reason, 'applied_header_source');
            const out = {
              detected: detected == null ? null : String(detected),
              trusted: trusted == null ? null : String(trusted),
              detectedSeg: detectedSeg == null ? null : String(detectedSeg),
              applied: applied == null ? null : String(applied),
              appliedSource: appliedSource == null ? null : String(appliedSource),
            };
            const any = Object.values(out).some((v) => v != null && String(v).length > 0);
            return any ? out : null;
          })();
          const keywordEvidence = (() => {
            if (!reason) return null;
            if (Array.isArray(reason.matched_keywords)) return reason.matched_keywords;
            if (Array.isArray(reason.keywords)) return reason.keywords;
            if (Array.isArray(reason.matched)) return reason.matched;
            if (Array.isArray(reason.keyword_hits)) return reason.keyword_hits;
            if (Array.isArray(reason.signals)) return reason.signals;
            return null;
          })();

          debugHtml += renderKv([
            ['segment (audit)', item.segment],
            ['source (audit)', item.segment_source],
            ['rule_id', reason && reason.rule_id ? reason.rule_id : '-'],
            ['unknown_reason_code', (item.reason && item.reason.unknown_reason_code) ? item.reason.unknown_reason_code : (reason && reason.unknown_reason_code ? reason.unknown_reason_code : '-')],
            ['confidence', item.confidence],
            ['runner_up', item.runner_up_segment],
            ['runner_up_score', item.runner_up_score],
            ...(headerBits ? [
              ['detected_header', headerBits.detected],
              ['detected_header_trusted', headerBits.trusted],
              ['detected_header_segment', headerBits.detectedSeg],
              ['applied_header', headerBits.applied],
              ['applied_header_source', headerBits.appliedSource],
            ] : []),
          ]);

          debugHtml += '<h3>Keywords / Signals Used</h3>';
          if (keywordEvidence && keywordEvidence.length > 0) {
            debugHtml += renderMaybeJson(keywordEvidence);
          } else {
            debugHtml += '<div class="muted">No explicit keyword list present in debug payload. Showing full computed_reason below.</div>';
          }

          debugHtml += '<h3>computed_reason</h3>';
          debugHtml += renderMaybeJson(item.computed_reason || item.reason || item);
        }

        setModalBody(html + '<h3>Segment Decision (debug)</h3>' + debugHtml);
      } catch (e) {
        setModalBody(html + '<h3>Segment Decision (debug)</h3><div class="muted">Failed to load debug lineage: ' + escapeHtml(e?.message || String(e)) + '</div>');
      }
    }

    function fmtNum(v, digits = 2) {
      if (v == null || Number.isNaN(Number(v))) return 'N/A';
      return Number(v).toFixed(digits);
    }

    function renderScoreExplainability(expl) {
      const totals = expl?.totals || {};
      const agg = expl?.aggregation || {};
      const comps = expl?.components || {};

      const order = ['financial_health', 'risk_assessment', 'metric_benchmark', 'slide_sequence', 'visual_design', 'narrative_arc'];
      const rows = order.map((k) => [k, comps?.[k]]);

      const weightOf = (k) => (agg.weights && agg.weights[k] != null) ? agg.weights[k] : 0;
      const scoringKeys = order.filter((k) => Number(weightOf(k)) > 0);
      const excluded = Array.isArray(agg.excluded_components) ? agg.excluded_components : [];

      const excludedHtml = excluded.length
        ? '<div style="margin-top:0.25rem;" class="muted">Excluded: '
            + excluded.map(e => escapeHtml(String(e.component)) + (e.reason ? (' (' + escapeHtml(String(e.reason)) + ')') : '')).join(', ')
            + '</div>'
        : '';

      const header = ''
        + '<div>'
        + '<div style="display:flex; gap: 1.75rem; flex-wrap: wrap; align-items: flex-end;">'
        + '<div><span class="muted">Overall</span><div class="stat-value">' + escapeHtml(totals.overall_score ?? 'N/A') + '</div></div>'
        + '<div><span class="muted">Unadjusted</span><div class="mono">' + escapeHtml(totals.unadjusted_overall_score ?? 'N/A') + '</div></div>'
        + '<div><span class="muted">Adjustment</span><div class="mono">' + escapeHtml(fmtNum(totals.adjustment_factor, 3)) + ' (evidence ' + escapeHtml(fmtNum(totals.evidence_factor, 3)) + ' • diligence ' + escapeHtml(fmtNum(totals.due_diligence_factor, 3)) + ')</div></div>'
        + '<div><span class="muted">Coverage</span><div class="mono">' + escapeHtml(fmtNum(totals.coverage_ratio, 2)) + '</div></div>'
        + '<div><span class="muted">Confidence</span><div class="mono">' + escapeHtml(fmtNum(totals.confidence_score, 2)) + '</div></div>'
        + '</div>'
        + '<div style="margin-top:0.5rem;" class="muted">Policy: <span class="mono">' + escapeHtml(agg.policy_id ?? 'N/A') + '</span></div>'
        + '<div style="margin-top:0.25rem;" class="muted">Score-bearing components (effective v2 weights): <span class="mono">'
          + escapeHtml(scoringKeys.length ? scoringKeys.join(', ') : '(none)')
          + '</span></div>'
        + '<div style="margin-top:0.25rem;" class="muted">Included: <span class="mono">' + escapeHtml((agg.included_components || []).join(', ')) + '</span></div>'
        + excludedHtml
        + '</div>';

      const tableHead = ''
        + '<div class="subtable">'
        + '<table>'
        + '<thead>'
        + '<tr>'
        + '<th>Component</th>'
        + '<th>Effective Weight</th>'
        + '<th>Role</th>'
        + '<th>Status</th>'
        + '<th>Raw</th>'
        + '<th>Used</th>'
        + '<th>Penalty</th>'
        + '<th>Coverage</th>'
        + '<th>Conf</th>'
        + '<th>Inverted</th>'
        + '<th>Contribution</th>'
        + '<th>Notes</th>'
        + '</tr>'
        + '</thead>'
        + '<tbody>';

      const roleBadge = (w) => {
        const weight = Number(w || 0);
        const cls = weight > 0 ? 'badge-success' : 'badge-info';
        const label = weight > 0 ? 'score-bearing' : 'diagnostic-only';
        return '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
      };

      const tableRows = rows.map(([key, c]) => {
        const w = weightOf(key);
        const inverted = key === 'risk_assessment' ? c?.inverted_investment_score : null;
        const noteList = Array.isArray(c?.notes) ? c.notes : [];
        const notesHtml = noteList.length
          ? noteList.map(n => '<div>' + escapeHtml(n) + '</div>').join('')
          : '<span class="muted">-</span>';

        const contrib = c?.weighted_contribution == null ? 'N/A' : fmtNum(c.weighted_contribution, 3);

        return (
          '<tr>'
          + '<td class="mono">' + escapeHtml(key) + '</td>'
          + '<td class="mono">' + escapeHtml(String(w)) + '</td>'
          + '<td>' + roleBadge(w) + '</td>'
          + '<td>' + escapeHtml(c?.status ?? 'N/A') + '</td>'
          + '<td class="mono">' + escapeHtml(c?.raw_score ?? 'N/A') + '</td>'
          + '<td class="mono">' + escapeHtml(c?.used_score ?? 'N/A') + '</td>'
          + '<td class="mono">' + escapeHtml(c?.penalty ?? 'N/A') + '</td>'
          + '<td class="mono">' + escapeHtml(fmtNum(c?.coverage, 2)) + '</td>'
          + '<td class="mono">' + escapeHtml(fmtNum(c?.confidence, 2)) + '</td>'
          + '<td class="mono">' + escapeHtml(inverted ?? 'N/A') + '</td>'
          + '<td class="mono">' + escapeHtml(contrib) + '</td>'
          + '<td>' + notesHtml + '</td>'
          + '</tr>'
        );
      }).join('');

      const footer = '</tbody></table></div></div>';

      return header + tableHead + tableRows + footer;
    }

    async function explainScore(dioId) {
      // Ensure the explainability table is visible
      activateTab('dios');
      const container = document.getElementById('score-explain-container');
      const slot = document.getElementById('score-explain');
      container.style.display = 'block';
      slot.innerHTML = '<div class="loading">Loading explanation...</div>';

      const res = await fetch('/api/dashboard/dios/' + encodeURIComponent(dioId));
      if (!res.ok) {
        slot.innerHTML = '<div class="muted">Failed to load DIO (' + res.status + ')</div>';
        return;
      }
      const data = await res.json();
      const expl = data?.dio_data?.score_explanation;
      if (!expl) {
        slot.innerHTML = '<div class="muted">No score_explanation available on this DIO.</div>';
        return;
      }

      slot.innerHTML = renderScoreExplainability(expl);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Fetch and render jobs
    async function loadJobs() {
      const res = await fetch('/api/dashboard/jobs');
      const allJobs = await res.json();
      
      // Apply filters
      const statusFilter = document.getElementById('job-status-filter')?.value || 'all';
      const typeFilter = document.getElementById('job-type-filter')?.value || 'all';
      
      const jobs = allJobs.filter(j => {
        const matchesType = typeFilter === 'all' || j.type === typeFilter;

        // Back-compat: treat "pending" filter as "queued".
        const effectiveStatusFilter = statusFilter === 'pending' ? 'queued' : statusFilter;
        const matchesStatus = effectiveStatusFilter === 'all' || j.status === effectiveStatusFilter;

        // If a deal is selected, scope jobs to that deal.
        const matchesDeal = !selectedDealId || j.deal_id === selectedDealId;

        return matchesStatus && matchesType && matchesDeal;
      });

      const emptyRow = jobs.length === 0
        ? '<tr><td colspan="9" style="text-align: center; color: #999;">No jobs match the selected filters</td></tr>'
        : '';

      const rowsHtml = jobs.map(j => {
        const statusClass = j.status === 'succeeded' || j.status === 'completed' ? 'success'
          : j.status === 'failed' ? 'danger'
          : 'warning';
        const progress = j.progress ? parseInt(j.progress) : 0;
        const stage = j.status_detail && j.status_detail.progress && j.status_detail.progress.stage
          ? String(j.status_detail.progress.stage)
          : '-';
        const created = new Date(j.created_at);
        const updated = j.updated_at ? new Date(j.updated_at) : created;
        const duration = ((updated - created) / 1000).toFixed(1) + 's';
        const jobId = j.job_id || j.id;
        const jobHtml = jobId
          ? '<a href="/api/v1/jobs/' + encodeURIComponent(jobId) + '" target="_blank">' + escapeHtml(String(jobId).slice(0, 8)) + '…</a>'
          : '<span class="muted">-</span>';

        return ''
          + '<tr>'
          +   '<td><code>' + escapeHtml(j.type) + '</code></td>'
          +   '<td class="mono">' + jobHtml + '</td>'
          +   '<td class="job-deal">' + escapeHtml(j.deal_name || 'N/A') + '</td>'
          +   '<td><span class="badge badge-' + escapeHtml(statusClass) + '">' + escapeHtml(j.status) + '</span></td>'
          +   '<td>' + escapeHtml(progress) + '%</td>'
          +   '<td class="mono">' + escapeHtml(stage) + '</td>'
          +   '<td class="job-message"><small>' + escapeHtml(j.message || '-') + '</small></td>'
          +   '<td>' + escapeHtml(created.toLocaleString()) + '</td>'
          +   '<td>' + escapeHtml(duration) + '</td>'
          + '</tr>';
      }).join('');

      document.getElementById('jobs-table').innerHTML = ''
        + '<div style="margin-bottom: 0.5rem; color: #666;">'
        +   'Showing ' + escapeHtml(jobs.length) + ' of ' + escapeHtml(allJobs.length) + ' jobs'
        + '</div>'
        + '<table class="jobs-table">'
        +   '<thead>'
        +     '<tr>'
        +       '<th>Job Type</th>'
        +       '<th>Job</th>'
        +       '<th>Deal</th>'
        +       '<th>Status</th>'
        +       '<th>Progress</th>'
        +       '<th>Stage</th>'
        +       '<th>Message</th>'
        +       '<th>Created</th>'
        +       '<th>Duration</th>'
        +     '</tr>'
        +   '</thead>'
        +   '<tbody>'
        +     emptyRow
        +     rowsHtml
        +   '</tbody>'
        + '</table>';
    }

    function setVisualReextractButtonsDisabled(disabled) {
      const ids = [
        'visual-assets-deep-scan-deal-btn',
        'visual-assets-run-process-btn',
        'visual-assets-process-clear-btn',
        'documents-reextract-deal-btn',
        'visual-assets-reextract-deal-btn',
        'visual-assets-reextract-all-btn',
        'visual-assets-load-btn',
        'visual-assets-refresh-btn',
      ];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.disabled = Boolean(disabled);
      }
    }

    function showFullProcessPanel(show) {
      const panel = document.getElementById('full-process-panel');
      if (panel) panel.style.display = show ? 'block' : 'none';
    }

    function setFullProcessSummary(text) {
      const el = document.getElementById('full-process-summary');
      if (el) el.textContent = text || '';
    }

    function appendFullProcessLog(line) {
      const el = document.getElementById('full-process-log');
      if (!el) return;
      const ts = new Date().toLocaleTimeString();
      el.textContent = (el.textContent || '') + '[' + ts + '] ' + String(line || '') + '\\n';
      el.scrollTop = el.scrollHeight;
    }

    function clearFullProcessProgress() {
      fullProcessState.active = false;
      fullProcessState.stopRequested = false;
      fullProcessState.dealId = null;
      fullProcessState.dealName = null;
      fullProcessState.startedAt = null;
      fullProcessState.currentStep = null;
      fullProcessState.steps = {
        reextract_documents: { label: 'Re-extract documents', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
        extract_visuals: { label: 'Extract visuals + page understanding', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
        analyze_deal: { label: 'Analyze deal', job_id: null, status: 'pending', progress: 0, stage: null, message: null, updated_at: null },
      };

      const log = document.getElementById('full-process-log');
      if (log) log.textContent = '';
      const tbl = document.getElementById('full-process-table');
      if (tbl) tbl.innerHTML = '';
      setFullProcessSummary('');
      showFullProcessPanel(false);
      setVisualReextractButtonsDisabled(false);
    }

    function renderFullProcessTable() {
      const tbl = document.getElementById('full-process-table');
      if (!tbl) return;

      const steps = [
        { key: 'reextract_documents', ...fullProcessState.steps.reextract_documents },
        { key: 'extract_visuals', ...fullProcessState.steps.extract_visuals },
        { key: 'analyze_deal', ...fullProcessState.steps.analyze_deal },
      ];

      const dealName = fullProcessState.dealName || fullProcessState.dealId || '-';
      const elapsed = fullProcessState.startedAt
        ? Math.max(0, (Date.now() - new Date(fullProcessState.startedAt).getTime()) / 1000)
        : 0;
      setFullProcessSummary(
        'deal=' + dealName
          + ' • step=' + (fullProcessState.currentStep || '-')
          + ' • elapsed=' + elapsed.toFixed(1) + 's'
      );

      const rowsHtml = steps.map((s) => {
        const jobId = s.job_id ? String(s.job_id) : '';
        const jobLink = jobId
          ? '<a href="/api/v1/jobs/' + encodeURIComponent(jobId) + '" target="_blank">' + escapeHtml(jobId.slice(0, 8)) + '…</a>'
          : '<span class="muted">-</span>';
        const pct = s.progress != null ? String(s.progress) : '-';
        const stage = s.stage ? String(s.stage) : '-';
        const msg = s.message ? String(s.message) : '';
        const updated = s.updated_at ? new Date(s.updated_at).toLocaleTimeString() : '-';
        const status = s.status || '-';

        return ''
          + '<tr>'
          + '<td><strong>' + escapeHtml(s.label) + '</strong></td>'
          + '<td class="mono">' + jobLink + '</td>'
          + '<td class="mono">' + escapeHtml(String(status)) + '</td>'
          + '<td class="mono">' + escapeHtml(String(pct)) + '%</td>'
          + '<td class="mono">' + escapeHtml(stage) + '</td>'
          + '<td><small>' + escapeHtml(msg) + '</small></td>'
          + '<td class="mono">' + escapeHtml(updated) + '</td>'
          + '</tr>';
      }).join('');

      tbl.innerHTML = ''
        + '<table class="progress-table">'
        + '<thead><tr>'
        + '<th>Step</th>'
        + '<th>Job</th>'
        + '<th>Status</th>'
        + '<th>Progress</th>'
        + '<th>Stage</th>'
        + '<th>Message</th>'
        + '<th>Updated</th>'
        + '</tr></thead>'
        + '<tbody>'
        + rowsHtml
        + '</tbody>'
        + '</table>';
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function fetchJobSnapshot(params) {
      const dealId = params.dealId;
      const type = params.type;
      const jobId = params.jobId;
      const q = '/api/dashboard/jobs?type=' + encodeURIComponent(type) + '&limit=50&deal_id=' + encodeURIComponent(String(dealId || ''));
      const res = await fetch(q);
      const jobs = await res.json().catch(() => ([]));
      const match = (Array.isArray(jobs) ? jobs : []).find((j) => j && String(j.job_id) === String(jobId));
      return match || null;
    }

    async function enqueueAnalyzeDeal(dealId) {
      const url = '/api/v1/deals/' + encodeURIComponent(dealId) + '/analyze';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('enqueue failed: ' + res.status + ' ' + (data?.error || ''));
      const jobId = data?.job_id ? String(data.job_id) : null;
      if (!jobId) throw new Error('enqueue succeeded but no job_id returned');
      return { job_id: jobId, status: data?.status || 'queued' };
    }

    async function waitForStep(params) {
      const key = params.stepKey;
      const type = params.type;
      const dealId = params.dealId;
      const jobId = params.jobId;
      const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 15 * 60 * 1000;
      const deadline = Date.now() + timeoutMs;

      while (fullProcessState.active && !fullProcessState.stopRequested) {
        if (Date.now() > deadline) {
          throw new Error('timeout waiting for ' + String(type) + ' job=' + String(jobId));
        }

        const snap = await fetchJobSnapshot({ dealId, type, jobId }).catch(() => null);
        if (snap) {
          const stage = snap.status_detail && snap.status_detail.progress && snap.status_detail.progress.stage
            ? String(snap.status_detail.progress.stage)
            : null;

          fullProcessState.steps[key].status = snap.status;
          fullProcessState.steps[key].progress = snap.progress;
          fullProcessState.steps[key].message = snap.message;
          fullProcessState.steps[key].stage = stage || fullProcessState.steps[key].stage;
          fullProcessState.steps[key].updated_at = snap.updated_at;
          renderFullProcessTable();

          const st = String(snap.status || '');
          const isTerminal = st === 'succeeded' || st === 'completed' || st === 'succeeded_with_warnings' || st === 'failed';
          if (isTerminal) {
            appendFullProcessLog(type + ' reached terminal state: ' + st);
            if (st === 'failed') {
              throw new Error((snap.message || 'job failed') + ' (type=' + type + ')');
            }
            return;
          }
        }

        await sleep(fullProcessState.pollEveryMs);
      }

      if (fullProcessState.stopRequested) {
        appendFullProcessLog('Stop requested; leaving polling loop.');
      }
    }

    async function runFullProcessSelectedDeal() {
      if (!selectedDealId) {
        alert('Select a deal first.');
        return;
      }

      const dealName = selectedDealName || (dealNameById[selectedDealId] || selectedDealId);
      const ok = confirm(
        'Run the full process for this deal?\\n\\n'
          + '1) Re-extract documents (from persisted original bytes)\\n'
          + '2) Extract visuals + persist page understanding\\n'
          + '3) Analyze deal\\n\\n'
          + 'Deal: ' + dealName
      );
      if (!ok) return;

      clearFullProcessProgress();
      showFullProcessPanel(true);
      setVisualReextractButtonsDisabled(true);

      fullProcessState.active = true;
      fullProcessState.stopRequested = false;
      fullProcessState.dealId = selectedDealId;
      fullProcessState.dealName = dealName;
      fullProcessState.startedAt = new Date().toISOString();

      appendFullProcessLog('Starting full process for deal: ' + dealName);
      renderFullProcessTable();

      try {
        // Step 1: re-extract documents
        fullProcessState.currentStep = 'reextract_documents';
        fullProcessState.steps.reextract_documents.status = 'queued';
        renderFullProcessTable();
        const docIds = await fetchDealDocumentIds(selectedDealId);
        if (!docIds || docIds.length === 0) throw new Error('No documents found for this deal');
        appendFullProcessLog('Re-extracting documents: ' + docIds.length + ' docs');
        const reextract = await enqueueReextractDocuments(selectedDealId, docIds);
        fullProcessState.steps.reextract_documents.job_id = reextract.job_id;
        fullProcessState.steps.reextract_documents.status = reextract.status;
        renderFullProcessTable();
        await waitForStep({ stepKey: 'reextract_documents', type: 'reextract_documents', dealId: selectedDealId, jobId: reextract.job_id });

        // Step 2: extract visuals
        fullProcessState.currentStep = 'extract_visuals';
        fullProcessState.steps.extract_visuals.status = 'queued';
        renderFullProcessTable();
        appendFullProcessLog('Enqueueing extract_visuals (force_reextract=true)');
        const visuals = await enqueueExtractVisuals(selectedDealId);
        fullProcessState.steps.extract_visuals.job_id = visuals.job_id;
        fullProcessState.steps.extract_visuals.status = visuals.status;
        renderFullProcessTable();
        await waitForStep({ stepKey: 'extract_visuals', type: 'extract_visuals', dealId: selectedDealId, jobId: visuals.job_id });

        // Step 3: analyze
        fullProcessState.currentStep = 'analyze_deal';
        fullProcessState.steps.analyze_deal.status = 'queued';
        renderFullProcessTable();
        appendFullProcessLog('Enqueueing analyze_deal');
        const analyze = await enqueueAnalyzeDeal(selectedDealId);
        fullProcessState.steps.analyze_deal.job_id = analyze.job_id;
        fullProcessState.steps.analyze_deal.status = analyze.status;
        renderFullProcessTable();
        await waitForStep({ stepKey: 'analyze_deal', type: 'analyze_deal', dealId: selectedDealId, jobId: analyze.job_id });

        fullProcessState.currentStep = null;
        appendFullProcessLog('Full process completed successfully.');

        // Best-effort refreshes
        scheduleDealSummaryRefresh('full_process', { initialDelayMs: 1200, delayMs: 2500, maxAttempts: 12 });
        scheduleExplainScoreRefresh('full_process', { initialDelayMs: 2500, delayMs: 2500, maxAttempts: 14 });
        setTimeout(() => { if (selectedDealId === fullProcessState.dealId) loadVisualAssets(); }, 1200);
      } catch (e) {
        appendFullProcessLog('Full process failed: ' + (e?.message || String(e)));
      } finally {
        fullProcessState.active = false;
        fullProcessState.stopRequested = false;
        setVisualReextractButtonsDisabled(false);
        renderFullProcessTable();
      }
    }

    function showDocReextractPanel(show) {
      const panel = document.getElementById('doc-reextract-panel');
      if (panel) panel.style.display = show ? 'block' : 'none';
    }

    function setDocReextractSummary(text) {
      const el = document.getElementById('doc-reextract-summary');
      if (el) el.textContent = text || '';
    }

    function appendDocReextractLog(line) {
      const el = document.getElementById('doc-reextract-log');
      if (!el) return;
      const ts = new Date().toLocaleTimeString();
      el.textContent = (el.textContent || '') + '[' + ts + '] ' + String(line || '') + '\\n';
      el.scrollTop = el.scrollHeight;
    }

    function stopDocReextractPolling() {
      if (docReextractState.pollTimer) {
        clearInterval(docReextractState.pollTimer);
        docReextractState.pollTimer = null;
        appendDocReextractLog('Stopped polling.');
      }
    }

    function clearDocReextractProgress() {
      if (docReextractState.pollTimer) {
        clearInterval(docReextractState.pollTimer);
        docReextractState.pollTimer = null;
      }
      docReextractState.active = false;
      docReextractState.dealId = null;
      docReextractState.dealName = null;
      docReextractState.startedAt = null;
      docReextractState.jobId = null;
      docReextractState.status = null;
      docReextractState.progress = null;
      docReextractState.stage = null;
      docReextractState.message = null;
      docReextractState.updatedAt = null;

      const log = document.getElementById('doc-reextract-log');
      if (log) log.textContent = '';
      const tbl = document.getElementById('doc-reextract-table');
      if (tbl) tbl.innerHTML = '';
      setDocReextractSummary('');
      showDocReextractPanel(false);
      setVisualReextractButtonsDisabled(false);
    }

    function renderDocReextractTable() {
      const tbl = document.getElementById('doc-reextract-table');
      if (!tbl) return;

      const jobId = docReextractState.jobId ? String(docReextractState.jobId) : '';
      const jobLink = jobId
        ? '<a href="/api/v1/jobs/' + encodeURIComponent(jobId) + '" target="_blank">' + escapeHtml(jobId.slice(0, 8)) + '…</a>'
        : '<span class="muted">-</span>';
      const pct = docReextractState.progress != null ? String(docReextractState.progress) : '-';
      const stage = docReextractState.stage ? String(docReextractState.stage) : '-';
      const msg = docReextractState.message ? String(docReextractState.message) : '';
      const updated = docReextractState.updatedAt ? new Date(docReextractState.updatedAt).toLocaleTimeString() : '-';
      const dealName = docReextractState.dealName || docReextractState.dealId || '-';
      const status = docReextractState.status || '-';

      const elapsed = docReextractState.startedAt
        ? Math.max(0, (Date.now() - new Date(docReextractState.startedAt).getTime()) / 1000)
        : 0;
      setDocReextractSummary(
        'deal=' + (dealName || '-')
          + ' • status=' + status
          + ' • elapsed=' + elapsed.toFixed(1) + 's'
      );

      tbl.innerHTML = ''
        + '<table class="progress-table">'
        + '<thead><tr>'
        + '<th>Deal</th>'
        + '<th>Job</th>'
        + '<th>Status</th>'
        + '<th>Progress</th>'
        + '<th>Stage</th>'
        + '<th>Message</th>'
        + '<th>Updated</th>'
        + '</tr></thead>'
        + '<tbody>'
        + '<tr>'
        + '<td><strong>' + escapeHtml(dealName) + '</strong></td>'
        + '<td class="mono">' + jobLink + '</td>'
        + '<td class="mono">' + escapeHtml(String(status)) + '</td>'
        + '<td class="mono">' + escapeHtml(String(pct)) + '%</td>'
        + '<td class="mono">' + escapeHtml(stage) + '</td>'
        + '<td><small>' + escapeHtml(msg) + '</small></td>'
        + '<td class="mono">' + escapeHtml(updated) + '</td>'
        + '</tr>'
        + '</tbody>'
        + '</table>';
    }

    async function pollDocReextractJobsOnce() {
      if (!docReextractState.active) return;
      if (!docReextractState.jobId) return;

      try {
        const q = '/api/dashboard/jobs?type=reextract_documents&limit=50&deal_id=' + encodeURIComponent(String(docReextractState.dealId || ''));
        const res = await fetch(q);
        const jobs = await res.json();
        const jobId = String(docReextractState.jobId);
        const match = (Array.isArray(jobs) ? jobs : []).find((j) => j && String(j.job_id) === jobId);
        if (!match) return;

        const stage = match.status_detail && match.status_detail.progress && match.status_detail.progress.stage
          ? String(match.status_detail.progress.stage)
          : null;

        docReextractState.status = match.status;
        docReextractState.progress = match.progress;
        docReextractState.message = match.message;
        docReextractState.stage = stage || docReextractState.stage;
        docReextractState.updatedAt = match.updated_at;
        renderDocReextractTable();

        const st = String(match.status || '');
        const isTerminal = st === 'succeeded' || st === 'completed' || st === 'succeeded_with_warnings' || st === 'failed';
        if (isTerminal) {
          appendDocReextractLog('Job reached terminal state: ' + st);
          stopDocReextractPolling();
          docReextractState.active = false;
          setVisualReextractButtonsDisabled(false);

          // Phase 1 outputs may be recomputed asynchronously elsewhere; do a best-effort refresh.
          scheduleDealSummaryRefresh('reextract_documents', { initialDelayMs: 1500, delayMs: 2500, maxAttempts: 12 });
        }
      } catch (e) {
        appendDocReextractLog('Polling failed: ' + (e?.message || String(e)));
      }
    }

    function startDocReextractPolling() {
      if (docReextractState.pollTimer) clearInterval(docReextractState.pollTimer);
      docReextractState.pollTimer = setInterval(() => {
        pollDocReextractJobsOnce();
      }, docReextractState.pollEveryMs);
    }

    async function fetchDealDocumentIds(dealId) {
      const url = '/api/v1/deals/' + encodeURIComponent(dealId) + '/documents';
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error('failed to fetch documents: ' + res.status + ' ' + (data?.error || ''));
      }
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      return docs
        .map((d) => {
          if (!d || typeof d !== 'object') return null;
          if (typeof d.document_id === 'string') return d.document_id;
          if (typeof d.id === 'string') return d.id;
          return null;
        })
        .filter((x) => x && x.length > 0);
    }

    async function enqueueReextractDocuments(dealId, documentIds) {
      const url = '/api/v1/deals/' + encodeURIComponent(dealId) + '/documents/re-extract';
      const body = {
        include_warnings: true,
        document_ids: Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : undefined,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error('enqueue failed: ' + res.status + ' ' + (data?.error || ''));
      }
      const jobId = data?.job_id ? String(data.job_id) : null;
      if (!jobId) throw new Error('enqueue succeeded but no job_id returned');
      return { job_id: jobId, status: data?.status || 'queued' };
    }

    async function reextractDocumentsSelectedDeal() {
      if (!selectedDealId) {
        alert('Select a deal first.');
        return;
      }

      const dealName = selectedDealName || (dealNameById[selectedDealId] || selectedDealId);

      let documentIds = [];
      try {
        documentIds = await fetchDealDocumentIds(selectedDealId);
      } catch (e) {
        alert('Failed to list deal documents: ' + (e?.message || String(e)));
        return;
      }
      if (documentIds.length === 0) {
        alert('No documents found for this deal.');
        return;
      }

      const ok = confirm(
        'Re-extract ALL documents for this deal ('
          + documentIds.length
          + ' docs)? This reprocesses from persisted original bytes and may take time.'
      );
      if (!ok) return;

      showDocReextractPanel(true);
      setVisualReextractButtonsDisabled(true);
      docReextractState.active = true;
      docReextractState.dealId = selectedDealId;
      docReextractState.dealName = dealName;
      docReextractState.startedAt = new Date().toISOString();
      docReextractState.jobId = null;
      docReextractState.status = 'queued';
      docReextractState.progress = 0;
      docReextractState.stage = 'enqueued';
      docReextractState.message = 'enqueued';
      docReextractState.updatedAt = new Date().toISOString();
      renderDocReextractTable();

      appendDocReextractLog('Starting re-extract documents for deal: ' + dealName);

      try {
        const enq = await enqueueReextractDocuments(selectedDealId, documentIds);
        docReextractState.jobId = enq.job_id;
        docReextractState.status = enq.status;
        docReextractState.stage = 'enqueued';
        docReextractState.message = 'enqueued';
        docReextractState.updatedAt = new Date().toISOString();
        appendDocReextractLog('Enqueued reextract_documents job_id=' + enq.job_id);
        renderDocReextractTable();
        startDocReextractPolling();
        await pollDocReextractJobsOnce();
      } catch (e) {
        appendDocReextractLog('Failed to enqueue: ' + (e?.message || String(e)));
        docReextractState.active = false;
        setVisualReextractButtonsDisabled(false);
      }
    }

    function showVisualReextractPanel(show) {
      const panel = document.getElementById('va-reextract-panel');
      if (panel) panel.style.display = show ? 'block' : 'none';
    }

    function setVisualReextractSummary(text) {
      const el = document.getElementById('va-reextract-summary');
      if (el) el.textContent = text || '';
    }

    function appendVisualReextractLog(line) {
      const el = document.getElementById('va-reextract-log');
      if (!el) return;
      const ts = new Date().toLocaleTimeString();
      el.textContent = (el.textContent || '') + '[' + ts + '] ' + String(line || '') + '\\n';
      el.scrollTop = el.scrollHeight;
    }

    function clearVisualReextractProgress() {
      if (visualReextractState.pollTimer) {
        clearInterval(visualReextractState.pollTimer);
        visualReextractState.pollTimer = null;
      }
      visualReextractState.active = false;
      visualReextractState.runId = null;
      visualReextractState.startedAt = null;
      visualReextractState.mode = null;
      visualReextractState.itemsByDealId = {};
      visualReextractState.jobIds = [];
      visualReextractState.lastPollAt = null;

      const log = document.getElementById('va-reextract-log');
      if (log) log.textContent = '';
      const tbl = document.getElementById('va-reextract-table');
      if (tbl) tbl.innerHTML = '';
      setVisualReextractSummary('');
      showVisualReextractPanel(false);
      setVisualReextractButtonsDisabled(false);
    }

    function stopVisualReextractPolling() {
      if (visualReextractState.pollTimer) {
        clearInterval(visualReextractState.pollTimer);
        visualReextractState.pollTimer = null;
        appendVisualReextractLog('Stopped polling (jobs continue in background).');
      }
    }

    function renderVisualReextractTable() {
      const tbl = document.getElementById('va-reextract-table');
      if (!tbl) return;

      const items = Object.entries(visualReextractState.itemsByDealId)
        .map(([dealId, it]) => ({ dealId, ...it }))
        .sort((a, b) => String(a.deal_name || '').localeCompare(String(b.deal_name || '')));

      const counts = { total: items.length, queued: 0, running: 0, succeeded: 0, failed: 0, other: 0 };
      for (const it of items) {
        const st = String(it.status || '');
        if (st === 'queued' || st === 'pending') counts.queued++;
        else if (st === 'running') counts.running++;
        else if (st === 'succeeded' || st === 'completed' || st === 'succeeded_with_warnings') counts.succeeded++;
        else if (st === 'failed') counts.failed++;
        else counts.other++;
      }

      const elapsed = visualReextractState.startedAt
        ? Math.max(0, (Date.now() - new Date(visualReextractState.startedAt).getTime()) / 1000)
        : 0;
      setVisualReextractSummary(
        'mode=' + (visualReextractState.mode || '-')
          + ' • deals=' + counts.total
          + ' • running=' + counts.running
          + ' • queued=' + counts.queued
          + ' • done=' + counts.succeeded
          + ' • failed=' + counts.failed
          + ' • elapsed=' + elapsed.toFixed(1) + 's'
      );

      const rowsHtml = items.map((it) => {
        const jobId = it.job_id ? String(it.job_id) : '';
        const jobLink = jobId
          ? '<a href="/api/v1/jobs/' + encodeURIComponent(jobId) + '" target="_blank">' + escapeHtml(jobId.slice(0, 8)) + '…</a>'
          : '<span class="muted">-</span>';
        const pct = it.progress != null ? String(it.progress) : '-';
        const msg = it.message ? String(it.message) : '';
        const stage = it.stage ? String(it.stage) : '-';
        const updated = it.updated_at ? new Date(it.updated_at).toLocaleTimeString() : '-';

        return ''
          + '<tr>'
          + '<td><strong>' + escapeHtml(it.deal_name || it.dealId) + '</strong></td>'
          + '<td class="mono">' + jobLink + '</td>'
          + '<td class="mono">' + escapeHtml(String(it.status || '-')) + '</td>'
          + '<td class="mono">' + escapeHtml(String(pct)) + '%</td>'
          + '<td class="mono">' + escapeHtml(stage) + '</td>'
          + '<td><small>' + escapeHtml(msg) + '</small></td>'
          + '<td class="mono">' + escapeHtml(updated) + '</td>'
          + '</tr>';
      }).join('');

      tbl.innerHTML = ''
        + '<table class="progress-table">'
        + '<thead><tr>'
        + '<th>Deal</th>'
        + '<th>Job</th>'
        + '<th>Status</th>'
        + '<th>Progress</th>'
        + '<th>Stage</th>'
        + '<th>Message</th>'
        + '<th>Updated</th>'
        + '</tr></thead>'
        + '<tbody>'
        + (rowsHtml || '<tr><td colspan="7" class="muted">No jobs enqueued yet.</td></tr>')
        + '</tbody>'
        + '</table>';
    }

    async function pollVisualReextractJobsOnce() {
      if (!visualReextractState.active) return;
      const jobIds = Array.isArray(visualReextractState.jobIds) ? visualReextractState.jobIds : [];
      if (jobIds.length === 0) return;
      visualReextractState.lastPollAt = new Date().toISOString();

      try {
        const res = await fetch('/api/dashboard/jobs?type=extract_visuals&limit=500');
        const jobs = await res.json();
        const jobsById = new Map();
        for (const j of (Array.isArray(jobs) ? jobs : [])) {
          if (j && j.job_id) jobsById.set(String(j.job_id), j);
        }

        let anyChanged = false;
        for (const dealId of Object.keys(visualReextractState.itemsByDealId)) {
          const item = visualReextractState.itemsByDealId[dealId];
          const jobId = item && item.job_id ? String(item.job_id) : null;
          if (!jobId) continue;
          const j = jobsById.get(jobId);
          if (!j) continue;
          const stage = j.status_detail && j.status_detail.progress && j.status_detail.progress.stage
            ? String(j.status_detail.progress.stage)
            : null;

          const next = {
            ...item,
            status: j.status,
            progress: j.progress,
            message: j.message,
            stage: stage || item.stage || null,
            updated_at: j.updated_at,
          };
          const prevKey = JSON.stringify({ s: item.status, p: item.progress, m: item.message, st: item.stage });
          const nextKey = JSON.stringify({ s: next.status, p: next.progress, m: next.message, st: next.stage });
          if (prevKey !== nextKey) {
            visualReextractState.itemsByDealId[dealId] = next;
            anyChanged = true;
          }
        }

        if (anyChanged) renderVisualReextractTable();

        const items = Object.values(visualReextractState.itemsByDealId);
        const allTerminal = items.length > 0 && items.every((it) => {
          const st = String(it.status || '');
          return st === 'succeeded' || st === 'completed' || st === 'succeeded_with_warnings' || st === 'failed';
        });
        if (allTerminal) {
          appendVisualReextractLog('All re-extract jobs reached terminal state.');
          stopVisualReextractPolling();
          visualReextractState.active = false;
          setVisualReextractButtonsDisabled(false);
        }
      } catch (e) {
        appendVisualReextractLog('Polling failed: ' + (e?.message || String(e)));
      }
    }

    function startVisualReextractPolling() {
      if (visualReextractState.pollTimer) clearInterval(visualReextractState.pollTimer);
      visualReextractState.pollTimer = setInterval(() => {
        pollVisualReextractJobsOnce();
      }, visualReextractState.pollEveryMs);
    }

    async function enqueueExtractVisuals(dealId) {
      const url = '/api/v1/deals/' + encodeURIComponent(dealId) + '/extract-visuals';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_reextract: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error('enqueue failed: ' + res.status + ' ' + (data?.error || ''));
      }
      const jobId = data?.job_id ? String(data.job_id) : null;
      if (!jobId) throw new Error('enqueue succeeded but no job_id returned');
      return { job_id: jobId, status: data?.status || 'queued' };
    }

    async function reextractVisualsSelectedDeal() {
      if (!selectedDealId) {
        alert('Select a deal first.');
        return;
      }

      showVisualReextractPanel(true);
      setVisualReextractButtonsDisabled(true);
      visualReextractState.active = true;
      visualReextractState.runId = 'deal-' + selectedDealId + '-' + Date.now();
      visualReextractState.startedAt = new Date().toISOString();
      visualReextractState.mode = 'deal';
      visualReextractState.itemsByDealId = {};
      visualReextractState.jobIds = [];

      const dealName = selectedDealName || (dealNameById[selectedDealId] || selectedDealId);
      appendVisualReextractLog('Starting re-extract visuals for deal: ' + dealName);

      try {
        const enq = await enqueueExtractVisuals(selectedDealId);
        visualReextractState.itemsByDealId[selectedDealId] = {
          deal_name: dealName,
          job_id: enq.job_id,
          status: enq.status,
          progress: 0,
          stage: 'enqueued',
          message: 'enqueued',
          updated_at: new Date().toISOString(),
        };
        visualReextractState.jobIds.push(enq.job_id);
        appendVisualReextractLog('Enqueued extract_visuals job_id=' + enq.job_id);
        renderVisualReextractTable();
        startVisualReextractPolling();
        await pollVisualReextractJobsOnce();
      } catch (e) {
        appendVisualReextractLog('Failed to enqueue: ' + (e?.message || String(e)));
        visualReextractState.active = false;
        setVisualReextractButtonsDisabled(false);
      }
    }

    async function reextractVisualsAllDeals() {
      showVisualReextractPanel(true);
      setVisualReextractButtonsDisabled(true);
      visualReextractState.active = true;
      visualReextractState.runId = 'all-' + Date.now();
      visualReextractState.startedAt = new Date().toISOString();
      visualReextractState.mode = 'all';
      visualReextractState.itemsByDealId = {};
      visualReextractState.jobIds = [];
      appendVisualReextractLog('Starting re-extract visuals for ALL deals...');

      let deals = Array.isArray(lastDeals) && lastDeals.length > 0 ? lastDeals : null;
      if (!deals) {
        try {
          const res = await fetch('/api/dashboard/deals');
          deals = await res.json();
        } catch {
          deals = [];
        }
      }

      const ids = (Array.isArray(deals) ? deals : [])
        .map((d) => (d && typeof d.id === 'string') ? d.id : null)
        .filter((x) => x && x.length > 0);

      if (ids.length === 0) {
        appendVisualReextractLog('No deals found to process.');
        visualReextractState.active = false;
        setVisualReextractButtonsDisabled(false);
        return;
      }

      appendVisualReextractLog('Deals queued for enqueue: ' + ids.length);
      renderVisualReextractTable();
      startVisualReextractPolling();

      for (let i = 0; i < ids.length; i += 1) {
        const dealId = ids[i];
        const dealName = (dealNameById[dealId] || dealId);
        appendVisualReextractLog('Enqueueing ' + (i + 1) + '/' + ids.length + ': ' + dealName);
        try {
          const enq = await enqueueExtractVisuals(dealId);
          visualReextractState.itemsByDealId[dealId] = {
            deal_name: dealName,
            job_id: enq.job_id,
            status: enq.status,
            progress: 0,
            stage: 'enqueued',
            message: 'enqueued',
            updated_at: new Date().toISOString(),
          };
          visualReextractState.jobIds.push(enq.job_id);
          renderVisualReextractTable();
        } catch (e) {
          visualReextractState.itemsByDealId[dealId] = {
            deal_name: dealName,
            job_id: null,
            status: 'failed',
            progress: 0,
            stage: 'enqueue_failed',
            message: (e?.message || String(e)),
            updated_at: new Date().toISOString(),
          };
          appendVisualReextractLog('Enqueue failed for ' + dealName + ': ' + (e?.message || String(e)));
          renderVisualReextractTable();
        }
      }

      appendVisualReextractLog('Enqueue phase complete. Polling job progress...');
      await pollVisualReextractJobsOnce();
    }

    // Inspect DIO in modal
    async function inspectDIO(dioId) {
      const res = await fetch(\`/api/dashboard/dios/\${dioId}\`);
      const data = await res.json();
      
      const modal = window.open('', 'DIO Inspector', 'width=1000,height=800');
      modal.document.write(\`
        <html>
          <head>
            <title>DIO Inspector - \${dioId}</title>
            <style>
              body { font-family: monospace; padding: 2rem; background: #1e1e1e; color: #d4d4d4; }
              h1 { color: #4ec9b0; }
              pre { background: #2d2d2d; padding: 1rem; border-radius: 4px; overflow-x: auto; }
            </style>
          </head>
          <body>
            <h1>DIO Inspector</h1>
            <p><strong>DIO ID:</strong> \${dioId}</p>
            <p><strong>Deal:</strong> \${data.deal_name} (v\${data.analysis_version})</p>
            <h2>Raw DIO Data:</h2>
            <pre>\${JSON.stringify(data.dio_data, null, 2)}</pre>
          </body>
        </html>
      \`);
    }

    // Inspect report computation
    async function inspectReport(dealId, version) {
      try {
        const res = await fetch(\`/api/dashboard/reports/\${dealId}/\${version}/inspect\`);
        if (!res.ok) {
          alert('Failed to fetch report data: ' + res.status);
          return;
        }
        const data = await res.json();
        
        console.log('Report inspection data:', data);
        
        const modal = window.open('', 'Report Inspector', 'width=1200,height=900');
        modal.document.write(\`
          <html>
            <head>
              <title>Report Computation Inspector</title>
              <style>
                body { font-family: monospace; padding: 2rem; background: #1e1e1e; color: #d4d4d4; }
                h1, h2 { color: #4ec9b0; }
                h3 { color: #dcdcaa; }
                pre { background: #2d2d2d; padding: 1rem; border-radius: 4px; overflow-x: auto; }
                .section { margin-bottom: 2rem; border-bottom: 1px solid #444; padding-bottom: 1rem; }
              </style>
            </head>
            <body>
              <h1>Report Computation Inspector</h1>
              <div class="section">
                <h2>Input DIO Data</h2>
                <pre>\${data.input_dio ? JSON.stringify(data.input_dio, null, 2) : 'No input DIO data available'}</pre>
              </div>
              <div class="section">
                <h2>Computation Steps</h2>
                <pre>\${data.computation_steps ? JSON.stringify(data.computation_steps, null, 2) : 'No computation steps available'}</pre>
              </div>
              <div class="section">
                <h2>Output Report</h2>
                <pre>\${data.output_report ? JSON.stringify(data.output_report, null, 2) : 'No output report available'}</pre>
              </div>
            </body>
          </html>
        \`);
        modal.document.close();
      } catch (error) {
        console.error('Error inspecting report:', error);
        alert('Error inspecting report: ' + error.message);
      }
    }

    function viewDIO(dealId) {
      window.open(\`/api/v1/deals/\${dealId}/report\`, '_blank');
    }

    function viewReport(dealId, version) {
      window.open(\`/api/v1/deals/\${dealId}/report/\${version}\`, '_blank');
    }

    // Load all data on page load
    loadStats();
    loadDeals();
    loadDocuments();
    loadDIOs();
    loadReports();
    loadJobs();

    // Visual Assets selector wiring
    (function bindVisualAssetsControls() {
      const sel = document.getElementById('visual-assets-deal-select');
      const loadBtn = document.getElementById('visual-assets-load-btn');
      const refreshBtn = document.getElementById('visual-assets-refresh-btn');
      const analyzeDealBtn = document.getElementById('visual-assets-analyze-deal-btn');
      const deepScanDealBtn = document.getElementById('visual-assets-deep-scan-deal-btn');
      const runProcessBtn = document.getElementById('visual-assets-run-process-btn');
      const reextractDocsDealBtn = document.getElementById('documents-reextract-deal-btn');
      const reextractDealBtn = document.getElementById('visual-assets-reextract-deal-btn');
      const reextractAllBtn = document.getElementById('visual-assets-reextract-all-btn');
      const stopBtn = document.getElementById('visual-assets-reextract-stop-btn');
      const clearBtn = document.getElementById('visual-assets-reextract-clear-btn');
      const clearDocBtn = document.getElementById('documents-reextract-clear-btn');
      const clearProcessBtn = document.getElementById('visual-assets-process-clear-btn');

      if (sel && !sel.dataset.bound) {
        sel.dataset.bound = '1';
        sel.addEventListener('change', () => {
          const dealId = sel.value;
          setSelectedDeal(dealId);
        });
      }

      if (loadBtn && !loadBtn.dataset.bound) {
        loadBtn.dataset.bound = '1';
        loadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const dealId = sel ? sel.value : null;
          if (!dealId) {
            alert('Select a deal first.');
            return;
          }
          setSelectedDeal(dealId);
          loadVisualAssets();
        });
      }

      if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = '1';
        refreshBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (!selectedDealId) {
            alert('Select a deal first.');
            return;
          }
          loadVisualAssets();
        });
      }

      if (analyzeDealBtn && !analyzeDealBtn.dataset.bound) {
        analyzeDealBtn.dataset.bound = '1';
        analyzeDealBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!selectedDealId) {
            alert('Select a deal first.');
            return;
          }
          const ok = confirm('Analyze this deal now? This enqueues a background job and refreshes Phase 1 outputs.');
          if (!ok) return;
          await enqueueDealJob(selectedDealId, 'analyze');
          scheduleDealSummaryRefresh('analyze', { initialDelayMs: 1500, delayMs: 2500, maxAttempts: 12 });
          scheduleExplainScoreRefresh('analyze', { initialDelayMs: 3000, delayMs: 2500, maxAttempts: 20 });
        });
      }

      if (deepScanDealBtn && !deepScanDealBtn.dataset.bound) {
        deepScanDealBtn.dataset.bound = '1';
        deepScanDealBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!selectedDealId) {
            alert('Select a deal first.');
            return;
          }
          const ok = confirm('Run deep scan for this deal? This enqueues a background job.');
          if (!ok) return;
          await enqueueDealJob(selectedDealId, 'deep-scan-visuals');
        });
      }

      if (runProcessBtn && !runProcessBtn.dataset.bound) {
        runProcessBtn.dataset.bound = '1';
        runProcessBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await runFullProcessSelectedDeal();
        });
      }

      if (reextractDealBtn && !reextractDealBtn.dataset.bound) {
        reextractDealBtn.dataset.bound = '1';
        reextractDealBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await reextractVisualsSelectedDeal();
        });
      }

      if (reextractDocsDealBtn && !reextractDocsDealBtn.dataset.bound) {
        reextractDocsDealBtn.dataset.bound = '1';
        reextractDocsDealBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await reextractDocumentsSelectedDeal();
        });
      }

      if (reextractAllBtn && !reextractAllBtn.dataset.bound) {
        reextractAllBtn.dataset.bound = '1';
        reextractAllBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const ok = confirm('Re-extract visuals for ALL active deals? This may enqueue many jobs.');
          if (!ok) return;
          await reextractVisualsAllDeals();
        });
      }

      if (stopBtn && !stopBtn.dataset.bound) {
        stopBtn.dataset.bound = '1';
        stopBtn.addEventListener('click', (e) => {
          e.preventDefault();
          stopVisualReextractPolling();
        });
      }

      if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.dataset.bound = '1';
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          clearVisualReextractProgress();
        });
      }

      if (clearDocBtn && !clearDocBtn.dataset.bound) {
        clearDocBtn.dataset.bound = '1';
        clearDocBtn.addEventListener('click', (e) => {
          e.preventDefault();
          clearDocReextractProgress();
        });
      }

      if (clearProcessBtn && !clearProcessBtn.dataset.bound) {
        clearProcessBtn.dataset.bound = '1';
        clearProcessBtn.addEventListener('click', (e) => {
          e.preventDefault();
          clearFullProcessProgress();
        });
      }
    })();

    // Auto-refresh every 30 seconds
    setInterval(() => {
      loadStats();
      loadDeals();
      loadDocuments();
      loadDIOs();
      loadReports();
      loadJobs();
    }, 30000);
  </script>
</body>
</html>
    `;

    reply.type('text/html').send(html);
  });

  /**
   * Dashboard API: Stats
   */
  app.get("/api/dashboard/stats", async (request, reply) => {
    const [dealsResult, docsResult, diosResult, jobsResult] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN EXISTS(SELECT 1 FROM deal_intelligence_objects WHERE deal_id = deals.id) THEN 1 END) as with_analysis
        FROM deals WHERE deleted_at IS NULL
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as processed
        FROM documents
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          MAX(analysis_version) as latest_version
        FROM deal_intelligence_objects
      `),
      pool.query(`
        SELECT 
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
        FROM jobs
      `)
    ]);

    return {
      deals: {
        total: parseInt(dealsResult.rows[0].total),
        with_analysis: parseInt(dealsResult.rows[0].with_analysis)
      },
      documents: {
        total: parseInt(docsResult.rows[0].total),
        processed: parseInt(docsResult.rows[0].processed)
      },
      dios: {
        total: parseInt(diosResult.rows[0].total),
        latest_version: parseInt(diosResult.rows[0].latest_version || 0)
      },
      jobs: {
        completed: parseInt(jobsResult.rows[0].completed || 0),
        failed: parseInt(jobsResult.rows[0].failed || 0)
      }
    };
  });

  /**
   * Dashboard API: Deals with analysis status
   */
  app.get("/api/dashboard/deals", async (request, reply) => {
    const { rows } = await pool.query(`
      SELECT 
        d.id,
        d.name,
        d.stage,
        d.priority,
        d.created_at,
        COUNT(docs.id) as doc_count,
        EXISTS(SELECT 1 FROM deal_intelligence_objects WHERE deal_id = d.id) as has_dio,
        j.status AS extract_visuals_status,
        j.updated_at AS extract_visuals_updated_at,
        (j.status_detail->'progress'->'meta'->'visual_quality_audit'->>'pass')::boolean AS visual_quality_pass,
        (j.status_detail->'progress'->'meta'->'visual_quality_audit'->'totals'->>'visuals')::int AS visual_quality_visuals,
        (j.status_detail->'progress'->'meta'->'visual_quality_audit'->'totals'->>'evidence_first_known_garbage')::int AS visual_quality_known_garbage,
        (j.status_detail->'progress'->'meta'->'visual_quality_audit'->'totals'->>'evidence_first_low_signal_non_empty')::int AS visual_quality_low_signal_non_empty,
        (j.status_detail->'progress'->'meta'->'visual_quality_audit'->'totals'->>'evidence_first_empty')::int AS visual_quality_empty
      FROM deals d
      LEFT JOIN documents docs ON docs.deal_id = d.id
      LEFT JOIN LATERAL (
        SELECT status, updated_at, status_detail
          FROM jobs
         WHERE deal_id = d.id
           AND type = 'extract_visuals'
         ORDER BY updated_at DESC
         LIMIT 1
      ) j ON true
      WHERE d.deleted_at IS NULL
      GROUP BY d.id, d.name, d.stage, d.priority, d.created_at, j.status, j.updated_at, j.status_detail
      ORDER BY d.created_at DESC
      LIMIT 50
    `);

    return rows;
  });

  /**
   * Dashboard API: Phase 1 summary for a deal (used by the dev dashboard)
   */
  app.get("/api/dashboard/deals/:deal_id/summary", async (request, reply) => {
    const { deal_id } = request.params as { deal_id: string };
    if (!deal_id || typeof deal_id !== "string") return reply.status(400).send({ error: "Missing deal_id" });

    const { rows } = await pool.query(
      `
      SELECT
        d.id AS deal_id,
        d.name AS deal_name,
        d.stage,
        d.priority,
        dio.dio_id,
        dio.analysis_version,
        dio.updated_at AS dio_updated_at,
        dio.dio_data
      FROM deals d
      LEFT JOIN LATERAL (
        SELECT dio_id, analysis_version, updated_at, dio_data
        FROM deal_intelligence_objects
        WHERE deal_id = d.id
        ORDER BY analysis_version DESC, updated_at DESC
        LIMIT 1
      ) dio ON true
      WHERE d.id = $1
        AND d.deleted_at IS NULL
      LIMIT 1
      `,
      [deal_id]
    );

    if (!rows || rows.length === 0) return reply.status(404).send({ error: "Deal not found" });
    const row = rows[0] as any;

    const dioData: any = row?.dio_data ?? null;
    const phase1: any =
      (dioData?.phase1 && typeof dioData.phase1 === "object" ? dioData.phase1 : null) ??
      (dioData?.dio?.phase1 && typeof dioData.dio.phase1 === "object" ? dioData.dio.phase1 : null) ??
      (dioData?.phase_1 && typeof dioData.phase_1 === "object" ? dioData.phase_1 : null) ??
      (dioData && typeof dioData === "object" ? dioData : null);

    const readPhase1Field = (key: string): any => {
      if (!dioData || typeof dioData !== "object") return null;

      const direct = (dioData as any)?.[key];
      if (direct !== undefined && direct !== null) return direct;

      const fromPhase1 = phase1 && typeof phase1 === "object" ? (phase1 as any)?.[key] : undefined;
      if (fromPhase1 !== undefined && fromPhase1 !== null) return fromPhase1;

      const fromNestedPhase1 = (dioData as any)?.dio?.phase1 && typeof (dioData as any).dio.phase1 === "object"
        ? (dioData as any).dio.phase1?.[key]
        : undefined;
      if (fromNestedPhase1 !== undefined && fromNestedPhase1 !== null) return fromNestedPhase1;

      return null;
    };

    return {
      deal: {
        id: row.deal_id,
        name: row.deal_name,
        stage: row.stage,
        priority: row.priority,
      },
      dio: row.dio_id
        ? {
            dio_id: row.dio_id,
            analysis_version: row.analysis_version,
            updated_at: row.dio_updated_at,
          }
        : null,
      summary: {
        phase1: row.dio_id
          ? {
              deal_overview_v2: readPhase1Field("deal_overview_v2"),
              deal_summary_v2: readPhase1Field("deal_summary_v2"),
              decision_summary_v1: readPhase1Field("decision_summary_v1"),
              business_archetype_v1: readPhase1Field("business_archetype_v1"),
              executive_summary_v2: readPhase1Field("executive_summary_v2"),
            }
          : null,
      },
    };
  });

  /**
   * Dashboard API: Recent documents
   */
  app.get("/api/dashboard/documents", async (request, reply) => {
    const { rows } = await pool.query(`
      SELECT 
        d.id,
        d.title,
        d.type,
        d.status,
        d.uploaded_at,
        deals.name as deal_name,
        (d.full_content->'pdf_v2'->>'status') as pdf_v2_status,
        jsonb_array_length(COALESCE(d.full_content->'pdf_v2'->'pages', '[]'::jsonb)) as pdf_v2_pages,
        (
          SELECT count(*)
          FROM jsonb_array_elements(COALESCE(d.full_content->'pdf_v2'->'pages', '[]'::jsonb)) pg
          WHERE pg ? 'ocr_v2'
        ) as pdf_v2_pages_with_ocr_v2
      FROM documents d
      LEFT JOIN deals ON deals.id = d.deal_id
      ORDER BY d.uploaded_at DESC
      LIMIT 100
    `);

    return rows;
  });

  /**
   * Dashboard API: DIO objects with metadata
   */
  app.get("/api/dashboard/dios", async (request, reply) => {
    // Show only the latest DIO per deal (avoid duplicates across versions).
    // Also include how many times analysis has run for that deal.
    // IMPORTANT: don't select jsonb_object_keys() directly.
    // It expands one DIO row into N rows (one per key).
    const { rows } = await pool.query(`
      WITH ranked AS (
        SELECT
          dio.dio_id,
          dio.deal_id,
          dio.analysis_version,
          dio.created_at,
          dio.updated_at,
          dio.overall_score,
          deals.name as deal_name,
          COALESCE((SELECT COUNT(*) FROM jsonb_object_keys(dio.dio_data->'analyzer_results')), 0) as analyzer_count,
          COUNT(*) OVER (PARTITION BY dio.deal_id) AS run_count,
          ROW_NUMBER() OVER (PARTITION BY dio.deal_id ORDER BY dio.analysis_version DESC, dio.updated_at DESC) AS rn
        FROM deal_intelligence_objects dio
        LEFT JOIN deals ON deals.id = dio.deal_id
        WHERE deals.deleted_at IS NULL
      )
      SELECT dio_id, deal_id, analysis_version, created_at, updated_at, overall_score, deal_name, analyzer_count, run_count
      FROM ranked
      WHERE rn = 1
      ORDER BY updated_at DESC
      LIMIT 50
    `);

    return rows;
  });

  /**
   * Dashboard API: Get single DIO with full data
   */
  app.get("/api/dashboard/dios/:dio_id", async (request, reply) => {
    const { dio_id } = request.params as { dio_id: string };
    
    const { rows } = await pool.query(`
      SELECT 
        dio.*,
        deals.name as deal_name
      FROM deal_intelligence_objects dio
      LEFT JOIN deals ON deals.id = dio.deal_id
      WHERE dio.dio_id = $1
    `, [dio_id]);

    if (rows.length === 0) {
      return reply.status(404).send({ error: "DIO not found" });
    }

    const row = rows[0];
    const dio_data = row.dio_data;

    if (dio_data && !dio_data.score_explanation) {
      try {
        dio_data.score_explanation = buildScoreExplanationFromDIO(dio_data);
      } catch {
        // Best-effort: don't fail dashboard if explainability can't be computed
      }
    }

    return { ...row, dio_data };
  });

  /**
   * Dashboard API: Reports with computation details
   */
  app.get("/api/dashboard/reports", async (request, reply) => {
    const { rows } = await pool.query(`
      WITH ranked AS (
        SELECT
          dio.dio_id,
          dio.deal_id,
          dio.analysis_version,
          dio.overall_score,
          dio.dio_data,
          dio.created_at,
          dio.updated_at,
          deals.name as deal_name,
          docs.documents as documents,
          ROW_NUMBER() OVER (PARTITION BY dio.deal_id ORDER BY dio.analysis_version DESC, dio.updated_at DESC) AS rn
        FROM deal_intelligence_objects dio
        JOIN deals ON deals.id = dio.deal_id AND deals.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', d.id,
                'title', d.title,
                'type', d.type,
                'page_count', d.page_count,
                'extraction_metadata', d.extraction_metadata,
                'structured_data', d.structured_data
              )
              ORDER BY d.uploaded_at DESC
            ),
            '[]'::json
          ) as documents
          FROM documents d
          WHERE d.deal_id = dio.deal_id
        ) docs ON TRUE
        WHERE dio.dio_data IS NOT NULL
      )
      SELECT dio_id, deal_id, analysis_version, overall_score, dio_data, created_at, updated_at, deal_name, documents
      FROM ranked
      WHERE rn = 1
      ORDER BY updated_at DESC
      LIMIT 50
    `);

    // Defensive: ensure we only return the latest DIO per deal even if
    // the underlying query ever returns multiple rows per deal.
    const latestByDeal = new Map<string, any>();
    for (const row of rows) {
      const dealId = String((row as any).deal_id);
      const existing = latestByDeal.get(dealId);

      const av = typeof (row as any).analysis_version === 'number' ? (row as any).analysis_version : Number((row as any).analysis_version ?? -1);
      const existingAv = existing ? (typeof existing.analysis_version === 'number' ? existing.analysis_version : Number(existing.analysis_version ?? -1)) : -1;

      const updatedAt = (row as any).updated_at ? new Date((row as any).updated_at).getTime() : 0;
      const existingUpdatedAt = existing && existing.updated_at ? new Date(existing.updated_at).getTime() : 0;

      if (!existing || av > existingAv || (av === existingAv && updatedAt >= existingUpdatedAt)) {
        latestByDeal.set(dealId, row);
      }
    }

    const dedupedRows = Array.from(latestByDeal.values()).sort((a, b) => {
      const ta = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });

    // Compile reports for each DIO
    const reports = dedupedRows.map((row) => {
      try {
        // Reconstruct DIO object from database row
        // Spread dio_data first, then override with current database values
        const dio = {
          ...row.dio_data, // Spread the JSONB data (contains analyzer_results, etc.)
          dio_id: row.dio_id,
          deal_id: row.deal_id, // Override with current deal_id from database
          analysis_version: row.analysis_version,
          overall_score: row.overall_score == null ? null : parseFloat(row.overall_score),
          created_at: row.created_at,
          updated_at: (row as any).updated_at,
          score_explanation: row.dio_data?.score_explanation || buildScoreExplanationFromDIO(row.dio_data),
        };
        
        const report = compileDIOToReport(dio as any);

        const docs: ReportDocRow[] = Array.isArray((row as any).documents)
          ? ((row as any).documents as ReportDocRow[])
          : [];

        const docInventory = docInventoryFromDocs(docs);
        const analyzerInputsUsed = buildAnalyzerInputsUsed(docs, docInventory);
        const scoreExplanation = (report as any)?.metadata?.score_explanation;

        if (scoreExplanation) {
          (scoreExplanation as any).debug = {
            doc_inventory: docInventory,
            analyzer_inputs_used: analyzerInputsUsed,
            context_used: (dio as any).dio_context,
            inclusion_decisions: buildInclusionDecisions(scoreExplanation),
          };
        }

        const primaryDocType = (dio as any)?.dio_context?.primary_doc_type ?? null;

        const normalizedScoreExplanation = scoreExplanation
          ? {
              ...scoreExplanation,
              context: {
                ...(scoreExplanation as any).context,
                primary_doc_type: (scoreExplanation as any)?.context?.primary_doc_type ?? primaryDocType,
              },
            }
          : {
              ...(dio as any)?.score_explanation,
              context: {
                ...((dio as any)?.score_explanation?.context || {}),
                primary_doc_type: (dio as any)?.score_explanation?.context?.primary_doc_type ?? primaryDocType,
              },
            };

        const normalizedMetadata = {
          ...((report as any)?.metadata || {}),
          documentCount: docs.length,
          score_explanation: normalizedScoreExplanation,
        };

        return {
          ...report,
          // Required stable identifiers for UI mapping
          dealId: row.deal_id,
          dealName: row.deal_name,
          dioId: row.dio_id,
          overallScore: (report as any).overallScore,
          recommendation: (report as any).recommendation,
          metadata: normalizedMetadata,

          // Backwards-compatible aliases (legacy snake_case)
          deal_name: row.deal_name,
          dio_id: row.dio_id,
          dio_data: {
            score_explanation: (dio as any).score_explanation,
            dio_context: (dio as any).dio_context,
          },
        };
      } catch (error) {
        return {
          dealId: row.deal_id,
          dealName: row.deal_name,
          deal_name: row.deal_name,
          dioId: row.dio_id,
          version: row.analysis_version,
          error: error instanceof Error ? error.message : "Failed to compile report"
        };
      }
    });

    return reports;
  });

  /**
   * Dashboard API: Inspect report computation
   */
  app.get("/api/dashboard/reports/:deal_id/:version/inspect", async (request, reply) => {
    const { deal_id, version } = request.params as { deal_id: string; version: string };
    
    const { rows } = await pool.query(`
      SELECT 
        dio.dio_id,
        dio.deal_id,
        dio.analysis_version,
        dio.overall_score,
        dio.dio_data,
        dio.created_at
      FROM deal_intelligence_objects dio
      WHERE dio.deal_id = $1 AND dio.analysis_version = $2
    `, [deal_id, parseInt(version)]);

    if (rows.length === 0) {
      return reply.status(404).send({ error: "DIO not found" });
    }

    const row = rows[0];
    const dioData = row.dio_data;
    const results = dioData.analyzer_results || {};
    
    // Reconstruct full DIO object
    // Spread dioData first, then override with current database values
    const fullDIO = {
      ...dioData,
      dio_id: row.dio_id,
      deal_id: row.deal_id, // Override with current deal_id from database
      analysis_version: row.analysis_version,
      overall_score: parseFloat(row.overall_score),
      created_at: row.created_at,
    };
    
    // Compile report and track computation steps
    const computationSteps = {
      step1_extract_analyzers: {
        slide_sequence: results.slide_sequence,
        metric_benchmark: results.metric_benchmark,
        visual_design: results.visual_design,
        narrative_arc: results.narrative_arc,
        financial_health: results.financial_health,
        risk_assessment: results.risk_assessment
      },
      step2_calculate_scores: {
        presentation_quality: (results.slide_sequence?.score || 0) * 100 + (results.visual_design?.design_score || 0),
        business_metrics: results.metric_benchmark?.overall_score || 0,
        narrative: results.narrative_arc?.pacing_score || 0,
        financial: results.financial_health?.health_score || 0,
        risk: 100 - (results.risk_assessment?.overall_risk_score || 0)
      },
      step3_overall_score_calculation: "Average of all category scores",
      step4_grade_assignment: "Based on overall score thresholds",
      step5_recommendation: "Derived from grade and risk assessment"
    };

    const report = compileDIOToReport(fullDIO as any);

    return {
      input_dio: fullDIO,
      computation_steps: computationSteps,
      output_report: report
    };
  });

  /**
   * Dashboard API: Recent jobs
   */
  app.get("/api/dashboard/jobs", async (request, reply) => {
    const q = (request.query ?? {}) as any;
    const type = typeof q.type === "string" && q.type.trim().length > 0 ? q.type.trim() : null;
    const dealId = typeof q.deal_id === "string" && q.deal_id.trim().length > 0 ? q.deal_id.trim() : null;
    const limitRaw = typeof q.limit === "string" ? parseInt(q.limit, 10) : (typeof q.limit === "number" ? q.limit : 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;

    const where: string[] = [];
    const params: any[] = [];
    if (type) {
      params.push(type);
      where.push(`j.type = $${params.length}`);
    }
    if (dealId) {
      params.push(dealId);
      where.push(`j.deal_id = $${params.length}`);
    }
    params.push(limit);

    const sql = `
      SELECT 
        j.job_id,
        j.deal_id,
        j.document_id,
        j.type,
        j.status,
        j.progress_pct as progress,
        j.message,
        j.status_detail,
        j.created_at,
        j.updated_at,
        deals.name as deal_name
      FROM jobs j
      LEFT JOIN deals ON deals.id = j.deal_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(j.updated_at, j.created_at) DESC
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    return rows;
  });
}
