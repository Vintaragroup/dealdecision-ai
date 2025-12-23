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
    .table-container { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
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

    <div id="dios-tab" class="tab-content">
      <div class="table-container">
        <h2>DIO Analysis Objects</h2>
        <p style="margin-bottom: 1rem; color: #718096;">Inspect raw DIO data and analyzer outputs</p>
        <div id="dios-table" class="loading">Loading DIOs...</div>
      </div>

      <div class="table-container" id="score-explain-container" style="display:none;">
        <h2>Score Explainability</h2>
        <p class="muted" style="margin-bottom: 1rem;">Weighted contributions by analyzer component</p>
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
              <option value="succeeded">Succeeded</option>
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

  <script>
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
      
      document.getElementById('deals-table').innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stage</th>
              <th>Priority</th>
              <th>Documents</th>
              <th>Has DIO</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            \${deals.map(d => \`
              <tr>
                <td><strong>\${d.name}</strong></td>
                <td><span class="badge badge-info">\${d.stage}</span></td>
                <td><span class="badge badge-warning">\${d.priority}</span></td>
                <td>\${d.doc_count}</td>
                <td>\${d.has_dio ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
                <td>\${new Date(d.created_at).toLocaleDateString()}</td>
                <td>
                  <a href="/api/v1/deals/\${d.id}" class="btn btn-small" target="_blank">View</a>
                  \${d.has_dio ? \`<a href="#" onclick="viewDIO('\${d.id}'); return false;" class="btn btn-small">View DIO</a>\` : ''}
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
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

    function fmtNum(v, digits = 2) {
      if (v == null || Number.isNaN(Number(v))) return 'N/A';
      return Number(v).toFixed(digits);
    }

    function renderScoreExplainability(expl) {
      const totals = expl?.totals || {};
      const agg = expl?.aggregation || {};
      const comps = expl?.components || {};

      const rows = [
        ['slide_sequence', comps.slide_sequence],
        ['metric_benchmark', comps.metric_benchmark],
        ['visual_design', comps.visual_design],
        ['narrative_arc', comps.narrative_arc],
        ['financial_health', comps.financial_health],
        ['risk_assessment', comps.risk_assessment],
      ];

      const weightOf = (k) => (agg.weights && agg.weights[k] != null) ? agg.weights[k] : 0;

      const header =
        '<div>' +
        '<div style="display:flex; gap: 2rem; flex-wrap: wrap;">' +
        '<div><span class="muted">Overall</span><div class="stat-value">' + escapeHtml(totals.overall_score ?? 'N/A') + '</div></div>' +
        '<div><span class="muted">Coverage</span><div class="mono">' + escapeHtml(fmtNum(totals.coverage_ratio, 2)) + '</div></div>' +
        '<div><span class="muted">Confidence</span><div class="mono">' + escapeHtml(fmtNum(totals.confidence_score, 2)) + '</div></div>' +
        '<div><span class="muted">Included</span><div class="mono">' + escapeHtml((agg.included_components || []).join(', ')) + '</div></div>' +
        '</div>';

      const tableHead =
        '<div class="subtable">' +
        '<table>' +
        '<thead>' +
        '<tr>' +
        '<th>Component</th>' +
        '<th>Weight</th>' +
        '<th>Status</th>' +
        '<th>Raw</th>' +
        '<th>Inverted</th>' +
        '<th>Contribution</th>' +
        '<th>Notes</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody>';

      const tableRows = rows.map(([key, c]) => {
        const inverted = key === 'risk_assessment' ? c?.inverted_investment_score : null;
        const noteList = Array.isArray(c?.notes) ? c.notes : [];
        const notesHtml = noteList.length
          ? noteList.map(n => '<div>' + escapeHtml(n) + '</div>').join('')
          : '<span class="muted">-</span>';

        const contrib = c?.weighted_contribution == null ? 'N/A' : fmtNum(c.weighted_contribution, 3);

        return (
          '<tr>' +
          '<td class="mono">' + escapeHtml(key) + '</td>' +
          '<td>' + escapeHtml(weightOf(key)) + '</td>' +
          '<td>' + escapeHtml(c?.status ?? 'N/A') + '</td>' +
          '<td>' + escapeHtml(c?.raw_score ?? 'N/A') + '</td>' +
          '<td>' + escapeHtml(inverted ?? 'N/A') + '</td>' +
          '<td>' + escapeHtml(contrib) + '</td>' +
          '<td>' + notesHtml + '</td>' +
          '</tr>'
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
        const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
        const matchesType = typeFilter === 'all' || j.type === typeFilter;
        return matchesStatus && matchesType;
      });
      
      document.getElementById('jobs-table').innerHTML = \`
        <div style="margin-bottom: 0.5rem; color: #666;">
          Showing \${jobs.length} of \${allJobs.length} jobs
        </div>
        <table>
          <thead>
            <tr>
              <th>Job Type</th>
              <th>Deal</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Message</th>
              <th>Created</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            \${jobs.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: #999;">No jobs match the selected filters</td></tr>' : ''}
            \${jobs.map(j => {
              const statusClass = j.status === 'succeeded' || j.status === 'completed' ? 'success' 
                : j.status === 'failed' ? 'danger' 
                : 'warning';
              const progress = j.progress ? parseInt(j.progress) : 0;
              const created = new Date(j.created_at);
              const updated = new Date(j.updated_at);
              const duration = ((updated - created) / 1000).toFixed(1) + 's';
              
              return \`
                <tr>
                  <td><code>\${j.type}</code></td>
                  <td>\${j.deal_name || 'N/A'}</td>
                  <td><span class="badge badge-\${statusClass}">\${j.status}</span></td>
                  <td>\${progress}%</td>
                  <td><small>\${j.message || '-'}</small></td>
                  <td>\${created.toLocaleString()}</td>
                  <td>\${duration}</td>
                </tr>
              \`;
            }).join('')}
          </tbody>
        </table>
      \`;
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
        EXISTS(SELECT 1 FROM deal_intelligence_objects WHERE deal_id = d.id) as has_dio
      FROM deals d
      LEFT JOIN documents docs ON docs.deal_id = d.id
      WHERE d.deleted_at IS NULL
      GROUP BY d.id, d.name, d.stage, d.priority, d.created_at
      ORDER BY d.created_at DESC
      LIMIT 50
    `);

    return rows;
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
        deals.name as deal_name
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
    const { rows } = await pool.query(`
      SELECT 
        j.id,
        j.type,
        j.status,
        j.progress_pct as progress,
        j.message,
        j.created_at,
        j.updated_at,
        deals.name as deal_name
      FROM jobs j
      LEFT JOIN deals ON deals.id = j.deal_id
      ORDER BY j.created_at DESC
      LIMIT 100
    `);

    return rows;
  });
}
