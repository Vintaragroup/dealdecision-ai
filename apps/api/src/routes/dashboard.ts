/**
 * Dashboard Routes
 * Provides visibility into database state, DIO analysis data, and report computation
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";
import { resolveVisualAssetImageUriForApi } from "../lib/visual-asset-image-uri";
import { compileDIOToReport, buildScoreExplanationFromDIO } from "@dealdecision/core";
import { getSegmentedNodesForDeal } from "../lib/segmented-nodes-for-deal";
import { classifyBusinessModelEvidenceFromDpuSlide } from "../lib/promoted-facts-from-dpu";
import { inferSegmentFromTitleRuleId, segmentDpuPage } from "../lib/segment-dpu-page";
import { normalizeAnalystSegment } from "../lib/analyst-segment";
import { getDeckArchetypeExpectedSegmentsV1 } from "../lib/deck-archetypes";
import { buildUiPreviewV1 } from "../lib/ui-preview-v1";
import { detectDeterministicScoreV1EnvSource, isDockerRuntime, registerDashboardDebugEnvRoutes } from "./dashboard-debug-env";
import type { Pool } from "pg";
import { z } from "zod";

const isUuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

type HeaderSource = Record<string, any>;

type HeaderField = {
  value: string | null;
  label?: string;
  sources?: HeaderSource[];
};

type Phase1DealOverview = {
  raise?: unknown;
  business_model?: unknown;
  revenue?: unknown;
  growth?: unknown;
  customers?: unknown;
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

function isMissingTableError(err: any): boolean {
  const code = String(err?.code ?? "");
  return code === "42P01";
}

function bulletsSnippetFromPayload(payload: any, maxLen = 200): string {
  const p = payload && typeof payload === "object" ? payload : null;
  const structured = p?.structured && typeof p.structured === "object" ? p.structured : null;
  const textBlocks = p?.text_blocks && typeof p.text_blocks === "object" ? p.text_blocks : null;

  const bulletsRaw = Array.isArray(structured?.bullets)
    ? structured.bullets
    : Array.isArray(textBlocks?.bullets)
      ? textBlocks.bullets
      : [];

  const bullets = bulletsRaw
    .filter((b: any) => typeof b === "string")
    .map((b: string) => b.trim())
    .filter(Boolean);

  const joined = bullets.join(" • ").trim();
  if (!joined) return "";
  return joined.length > maxLen ? joined.slice(0, maxLen) : joined;
}

function slideTitleFromPayload(payload: any): string | null {
  const p = payload && typeof payload === "object" ? payload : null;
  const structured = p?.structured && typeof p.structured === "object" ? p.structured : null;
  const textBlocks = p?.text_blocks && typeof p.text_blocks === "object" ? p.text_blocks : null;

  return (
    asNonEmptyString(structured?.title) ??
    asNonEmptyString(structured?.slide_title) ??
    asNonEmptyString(p?.resolved_title) ??
    asNonEmptyString(textBlocks?.title) ??
    null
  );
}

const fieldFromUnknown = (input: unknown): HeaderField => {
  const direct = asNonEmptyString(input);
  if (direct) return { value: direct };

  if (input && typeof input === "object") {
    const obj = input as any;
    const valueDirect = asNonEmptyString(obj.value);
    const valueRaw = asNonEmptyString(obj.value?.raw);
    return {
      value: valueDirect ?? valueRaw ?? null,
      label: asNonEmptyString(obj.label) ?? undefined,
      sources: Array.isArray(obj.sources) ? (obj.sources as HeaderSource[]) : undefined,
    };
  }

  return { value: null };
};

function selectHeaderCanonical(
  reportPayload: any | null,
  phase1: Phase1DealOverview | null
): {
  ready: boolean;
  raise: HeaderField;
  business_model: HeaderField;
  revenue: HeaderField;
  growth: HeaderField;
  customers: HeaderField;
} {
  const ready = reportPayload?.ready === true;

  if (ready) {
    const structuredSummary = reportPayload?.structured_summary as any;

    const raise = structuredSummary?.raise;
    const businessModel = structuredSummary?.business_model;
    const revenue = structuredSummary?.revenue;
    const growth = structuredSummary?.growth;
    const customers = structuredSummary?.customers;

    return {
      ready: true,
      raise: {
        value: asNonEmptyString(raise?.value),
        label: asNonEmptyString(raise?.label) ?? undefined,
        sources: Array.isArray(raise?.sources) ? (raise.sources as HeaderSource[]) : undefined,
      },
      business_model: {
        value: asNonEmptyString(businessModel?.value),
        label: asNonEmptyString(businessModel?.label) ?? undefined,
        sources: Array.isArray(businessModel?.sources) ? (businessModel.sources as HeaderSource[]) : undefined,
      },
      revenue: {
        value: asNonEmptyString(revenue?.value?.raw),
        label: asNonEmptyString(revenue?.label) ?? undefined,
        sources: Array.isArray(revenue?.sources) ? (revenue.sources as HeaderSource[]) : undefined,
      },
      growth: {
        value: asNonEmptyString(growth?.value?.raw),
        label: asNonEmptyString(growth?.label) ?? undefined,
        sources: Array.isArray(growth?.sources) ? (growth.sources as HeaderSource[]) : undefined,
      },
      customers: {
        value: asNonEmptyString(customers?.value?.raw),
        label: asNonEmptyString(customers?.label) ?? undefined,
        sources: Array.isArray(customers?.sources) ? (customers.sources as HeaderSource[]) : undefined,
      },
    };
  }

  return {
    ready: false,
    raise: fieldFromUnknown(phase1?.raise),
    business_model: fieldFromUnknown(phase1?.business_model),
    revenue: fieldFromUnknown(phase1?.revenue),
    growth: fieldFromUnknown(phase1?.growth),
    customers: fieldFromUnknown(phase1?.customers),
  };
}

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
	// Lightweight, no-DB debug route for verifying container runtime env.
	await registerDashboardDebugEnvRoutes(app);

  /**
   * Main Dashboard HTML Page
   */
  app.get("/api/dashboard", async (request, reply) => {
    const deckArchetypeExpectationsV1 = {
      consumer_apparel_dtc: getDeckArchetypeExpectedSegmentsV1("consumer_apparel_dtc"),
      enterprise_saas_compliance: getDeckArchetypeExpectedSegmentsV1("enterprise_saas_compliance"),
      pe_rollup_consolidation: getDeckArchetypeExpectedSegmentsV1("pe_rollup_consolidation"),
    };
    const deckArchetypeExpectationsJson = JSON.stringify(deckArchetypeExpectationsV1);

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
    .clickable-row { cursor: pointer; }
    tr.details-row:hover { background: transparent; }
    tr.details-row td { background: #f7fafc; }
    .filter-row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .summary-bar { display:flex; gap: 1rem; align-items: center; flex-wrap: wrap; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; background: #f7fafc; margin: 0.75rem 0; }
    .pill { display:inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 12px; background: #edf2f7; color: #4a5568; }
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
    /* Deterministic sub-tabs */
    .subtabs {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
      margin: 0.25rem 0 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .subtab {
      display: inline-block;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      border: 1px solid #e2e8f0;
      background: #edf2f7;
      color: #4a5568;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .subtab:hover { background: #e2e8f0; }
    .subtab.active {
      background: #667eea;
      border-color: #667eea;
      color: #fff;
    }
    .det-panel { display: none; }
    .det-panel.active { display: block; }
    /* Overflow-safe deterministic panels */
    .det-panel pre {
      max-width: 100%;
      overflow-x: auto;
      white-space: pre;
      overflow-wrap: normal;
      word-break: normal;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 0.75rem;
      border-radius: 6px;
    }
    .det-panel table { table-layout: fixed; }
    .det-panel th, .det-panel td { overflow-wrap: anywhere; word-break: break-word; }
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
      <div class="tab" onclick="switchTab('deterministic')">🧭 Deterministic</div>
      <div class="tab" onclick="switchTab('node-inspector')">🧩 Node Inspector</div>
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

    <div id="deterministic-tab" class="tab-content">
      <div class="table-container">
        <h2>Deterministic</h2>
        <p class="muted" style="margin-bottom: 1rem;">
          Invariant: <strong>If report.ready=true, canonical header must come only from structured_summary.</strong>
        </p>

        <div style="margin-bottom: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <label class="muted">
            Deal ID:
            <input
              id="deterministic-deal-id"
              type="text"
              placeholder="00000000-0000-0000-0000-000000000000"
              style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; min-width: 360px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"
            />
          </label>
          <button id="deterministic-load-btn" class="btn btn-small">Load</button>
          <button id="deterministic-view-nodeinspector-btn" class="btn btn-small btn-secondary">View in Node Inspector</button>
          <span id="deterministic-status" class="muted"></span>
        </div>

        <div class="subtabs" aria-label="Deterministic sub-tabs">
          <button id="det-subtab-btn-canonical" class="subtab active" onclick="activateDeterministicSubtab('canonical')">Canonical Header</button>
          <button id="det-subtab-btn-structured" class="subtab" onclick="activateDeterministicSubtab('structured')">Structured Summary (raw)</button>
          <button id="det-subtab-btn-legacy" class="subtab" onclick="activateDeterministicSubtab('legacy')">Legacy / Phase 1</button>
        </div>

        <div id="det-subtab-canonical" class="card det-panel active">
          <h2 style="margin-bottom: 0.5rem;">Canonical Header Output</h2>
          <div id="deterministic-header" class="muted">Enter a deal id and click Load.</div>
        </div>

        <div id="det-subtab-structured" class="card det-panel">
          <h2 style="margin-bottom: 0.5rem;">Structured Summary (raw)</h2>
          <div id="deterministic-structured" class="muted">Not loaded.</div>
        </div>

        <div id="det-subtab-legacy" class="card det-panel">
          <h2 style="margin-bottom: 0.5rem;">Legacy / Phase 1 (comparison only)</h2>
          <p class="muted" style="margin-bottom: 0.5rem;">Non-canonical. Used only when report.ready=false.</p>
          <div id="deterministic-legacy" class="muted">Not loaded.</div>
        </div>
      </div>
    </div>

    <div id="node-inspector-tab" class="tab-content">
      <div class="table-container">
        <h2>Node Inspector</h2>
        <p class="muted" style="margin-bottom: 1rem;">
          Inspect nodes derived from <span class="mono">document_page_understanding</span>, segment mapping hints, and evidence connections.
        </p>

        <div style="margin-bottom: 0.75rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <label class="muted">
            Deal ID:
            <input
              id="nodeinspector-deal-id"
              type="text"
              placeholder="00000000-0000-0000-0000-000000000000"
              style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; min-width: 360px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"
            />
          </label>
          <button id="node-inspector-load-btn" class="btn btn-small">Load</button>
          <span id="nodeinspector-status" class="muted"></span>
        </div>

        <div id="node-inspector-summary" class="summary-bar" style="display:none;"></div>

        <div id="node-inspector-kpi" class="card" style="margin: 0.75rem 0 1rem;">
          <h2 style="margin-bottom: 0.5rem;">KPI Coverage</h2>
          <p class="muted" style="margin-bottom: 0.75rem;">
            Note: If <strong>report.ready=true</strong>, UI should show <span class="mono">structured_summary</span> only (no Phase 1).
          </p>
          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; margin-bottom: 0;">
            <div class="card" style="box-shadow:none; border: 1px solid #e2e8f0;">
              <h2 style="margin-bottom: 0.5rem;">Revenue</h2>
              <div id="kpi-coverage-revenue" class="muted">Not loaded.</div>
            </div>
            <div class="card" style="box-shadow:none; border: 1px solid #e2e8f0;">
              <h2 style="margin-bottom: 0.5rem;">Growth</h2>
              <div id="kpi-coverage-growth" class="muted">Not loaded.</div>
            </div>
            <div class="card" style="box-shadow:none; border: 1px solid #e2e8f0;">
              <h2 style="margin-bottom: 0.5rem;">Customers</h2>
              <div id="kpi-coverage-customers" class="muted">Not loaded.</div>
            </div>
          </div>
        </div>

        <div id="node-inspector-report-nodes-diff-panel" class="card" style="margin: 0.75rem 0 1rem;">
          <h2 style="margin-bottom: 0.5rem;">Report ↔ Nodes Diff</h2>
          <p class="muted" style="margin-bottom: 0.75rem;">
            Shows whether <span class="mono">structured_summary</span> sources align with loaded nodes, and whether feeder nodes appear in sources.
          </p>
          <div id="node-inspector-report-nodes-diff" class="muted">Not loaded.</div>
        </div>

        <div class="filter-row">
          <label class="muted">
            Segment:
            <select id="node-inspector-segment" style="margin-left: 0.5rem; padding: 0.25rem; min-width: 220px;"></select>
          </label>
          <label class="muted" style="display:flex; gap:0.5rem; align-items:center;">
            <input id="node-inspector-unseg-only" type="checkbox" />
            Unsegmented only
          </label>
          <label class="muted" style="display:flex; gap:0.5rem; align-items:center;">
            <input id="node-inspector-overrides-only" type="checkbox" />
            Overrides only
          </label>
          <label class="muted">
            Search:
            <input
              id="node-inspector-search"
              type="text"
              placeholder="Matches title/bullets"
              style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; min-width: 320px;"
            />
          </label>
          <span id="node-inspector-filter-status" class="muted"></span>
        </div>

        <div id="node-inspector-warnings" class="muted" style="margin-bottom: 0.75rem;"></div>
        <div id="node-inspector-table" class="muted">Enter a deal id and click Load.</div>
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

    // Deterministic deck archetype expectations (display-only; no enforcement).
    const DECK_ARCHETYPE_EXPECTATIONS_V1 = ${deckArchetypeExpectationsJson};

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

    function activateDeterministicSubtab(name) {
      const target = (name === 'canonical' || name === 'structured' || name === 'legacy') ? name : 'canonical';
      const names = ['canonical', 'structured', 'legacy'];
      for (const n of names) {
        const panel = document.getElementById('det-subtab-' + n);
        const btn = document.getElementById('det-subtab-btn-' + n);
        const active = n === target;
        if (panel && panel.classList) panel.classList.toggle('active', active);
        if (btn && btn.classList) btn.classList.toggle('active', active);
      }
    }

    (function initDeterministicSubtabs() {
      try {
        activateDeterministicSubtab('canonical');
      } catch {
        // ignore
      }
    })();

    function setDeterministicDealId(dealId) {
      const input = document.querySelector('#deterministic-deal-id');
      if (input) input.value = dealId;

      const status = document.querySelector('#deterministic-status');
      if (status) status.textContent = 'Ready to load deterministic payload.';

      // Optional polish: if the Deterministic tab is active, keep focus in the input.
      try {
        const tab = document.getElementById('deterministic-tab');
        if (tab && tab.classList && tab.classList.contains('active') && input && typeof input.focus === 'function') {
          input.focus();
        }
      } catch {
        // ignore
      }

      try {
        activateDeterministicSubtab('canonical');
      } catch {
        // ignore
      }
    }

    function setNodeInspectorDealId(dealId) {
      const input = document.querySelector('#nodeinspector-deal-id');
      if (input) input.value = dealId;

      const status = document.querySelector('#nodeinspector-status');
      if (status) status.textContent = 'Ready to load node inspector payload.';

      try {
        const tab = document.getElementById('node-inspector-tab');
        if (tab && tab.classList && tab.classList.contains('active') && input && typeof input.focus === 'function') {
          input.focus();
        }
      } catch {
        // ignore
      }
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

    function getDeterministicValueString(field) {
      if (!field) return null;
      if (typeof field.value === 'string') {
        const s = field.value.trim();
        return s.length > 0 ? s : null;
      }
      if (field.value && typeof field.value === 'object') {
        const raw = field.value.raw;
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
      return null;
    }

    function renderDeterministicHeaderPanel(payload) {
      const el = document.getElementById('deterministic-header');
      if (!el) return;

      const hc = payload && payload.header_canonical ? payload.header_canonical : null;
      if (!hc || typeof hc !== 'object') {
        el.innerHTML = '<div class="muted">Missing header_canonical.</div>';
        return;
      }

      const keys = ['raise', 'business_model', 'revenue', 'growth', 'customers'];
      const rows = keys.map((k) => {
        const f = hc[k] || {};
        const value = typeof f.value === 'string' ? f.value : (getDeterministicValueString(f) || null);
        const label = typeof f.label === 'string' ? f.label : null;
        const sourcesCount = Array.isArray(f.sources) ? f.sources.length : 0;
        return ''
          + '<tr>'
          + '<td><strong>' + escapeHtml(k) + '</strong></td>'
          + '<td class="mono">' + escapeHtml(value || '-') + '</td>'
          + '<td>' + escapeHtml(label || '-') + '</td>'
          + '<td class="mono">' + escapeHtml(String(sourcesCount)) + '</td>'
          + '</tr>';
      }).join('');

      const meta = payload && payload.report ? payload.report : null;
      const ready = meta && meta.ready === true;
      const dioId = payload && payload.ids && payload.ids.dio_id ? String(payload.ids.dio_id) : '-';
      const analysisVersion = payload && payload.ids && payload.ids.analysis_version != null ? String(payload.ids.analysis_version) : '-';
      const updatedAt = payload && payload.ids && payload.ids.dio_updated_at ? String(payload.ids.dio_updated_at) : '-';

      el.innerHTML = ''
        + '<div class="muted" style="margin-bottom: 0.5rem;">'
        +   'report.ready=' + escapeHtml(String(ready))
        +   ' • dio_id=' + escapeHtml(dioId)
        +   ' • v=' + escapeHtml(analysisVersion)
        +   ' • updated_at=' + escapeHtml(updatedAt)
        + '</div>'
        + '<table>'
        + '<thead><tr><th>Field</th><th>Value</th><th>Label</th><th>Sources</th></tr></thead>'
        + '<tbody>'
        + rows
        + '</tbody>'
        + '</table>';
    }

    function normalizeSourceFields(src) {
      const s = src && typeof src === 'object' ? src : {};
      const docId = s.document_id || s.source_document_id || s.sourceDocumentId || s.doc_id || null;
      const pageIndex = (s.page_index != null ? s.page_index : (s.pageIndex != null ? s.pageIndex : null));
      const pageRange = Array.isArray(s.page_range) ? s.page_range : (Array.isArray(s.pageRange) ? s.pageRange : null);
      const slideTitle = s.slide_title || s.slideTitle || null;
      const noteSnippet = s.note_snippet || s.noteSnippet || null;
      const note = s.note || null;
      const evidenceId = s.evidence_id || s.evidenceId || null;
      return { docId, pageIndex, pageRange, slideTitle, noteSnippet, note, evidenceId };
    }

    function renderStructuredField(name, field) {
      const f = field && typeof field === 'object' ? field : null;
      const label = f && typeof f.label === 'string' ? f.label : null;
      const confidence = (f && typeof f.confidence === 'number' && Number.isFinite(f.confidence)) ? f.confidence : null;
      const sources = f && Array.isArray(f.sources) ? f.sources : [];
      const sourcesCount = sources.length;

      const valueStr = (() => {
        if (!f) return null;
        if (typeof f.value === 'string') {
          const s = f.value.trim();
          return s.length > 0 ? s : null;
        }
        if (f.value && typeof f.value === 'object') {
          const raw = f.value.raw;
          if (typeof raw === 'string' && raw.trim()) return raw.trim();
        }
        try {
          return f.value != null ? JSON.stringify(f.value) : null;
        } catch {
          return String(f.value);
        }
      })();

      const sourcesHtml = sourcesCount > 0
        ? ''
          + '<details style="margin-top: 0.25rem;">'
          +   '<summary class="muted">Sources (' + escapeHtml(String(sourcesCount)) + ')</summary>'
          +   '<table style="margin-top: 0.5rem;">'
          +     '<thead><tr><th>document_id</th><th>page</th><th>slide_title</th><th>note</th><th>evidence_id</th></tr></thead>'
          +     '<tbody>'
          +       sources.map((src) => {
                    const n = normalizeSourceFields(src);
                    const page = n.pageIndex != null
                      ? String(n.pageIndex)
                      : (n.pageRange ? (String(n.pageRange[0]) + '-' + String(n.pageRange[1])) : '-');
                    const note = n.noteSnippet || n.note;
                    return ''
                      + '<tr>'
                      + '<td class="mono">' + escapeHtml(n.docId || '-') + '</td>'
                      + '<td class="mono">' + escapeHtml(page) + '</td>'
                      + '<td>' + escapeHtml(n.slideTitle || '-') + '</td>'
                      + '<td>' + escapeHtml(note || '-') + '</td>'
                      + '<td class="mono">' + escapeHtml(n.evidenceId || '-') + '</td>'
                      + '</tr>';
                  }).join('')
          +     '</tbody>'
          +   '</table>'
          + '</details>'
        : '<div class="muted" style="margin-top:0.25rem;">No sources</div>';

      const valuePre = (() => {
        try {
          return '<pre style="margin-top:0.5rem;">' + escapeHtml(JSON.stringify(f, null, 2)) + '</pre>';
        } catch {
          return '<pre style="margin-top:0.5rem;">' + escapeHtml(String(f)) + '</pre>';
        }
      })();

      return ''
        + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
        +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items: baseline;">'
        +     '<div><strong>' + escapeHtml(name) + '</strong></div>'
        +     '<div class="muted">value=' + escapeHtml(valueStr || '-') + '</div>'
        +     '<div class="muted">label=' + escapeHtml(label || '-') + '</div>'
        +     '<div class="muted">confidence=' + escapeHtml(confidence != null ? confidence.toFixed(3) : '-') + '</div>'
        +   '</div>'
        +   sourcesHtml
        +   valuePre
        + '</div>';
    }

    function normalizePageList(pages) {
      const xs = Array.isArray(pages) ? pages : [];
      const nums = xs
        .map((x) => (typeof x === 'number' ? x : Number(x)))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.trunc(n));
      const uniq = Array.from(new Set(nums));
      uniq.sort((a, b) => a - b);
      return uniq;
    }

    function renderBusinessModelSynthesizedPanel(summary) {
      const s = summary && typeof summary === 'object' ? summary : null;
      if (!s) {
        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items: baseline;">'
          +     '<div><strong>Business Model (Synthesized)</strong></div>'
          +     '<div class="muted">Missing structured_summary.business_model_summary</div>'
          +   '</div>'
          + '</div>';
      }

      const value = (typeof s.value === 'string' && s.value.trim()) ? s.value.trim() : null;
      const conf = (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) ? s.confidence : null;
      const derived = (s.derived_from && typeof s.derived_from === 'object') ? s.derived_from : {};

      const pagesProduct = normalizePageList(derived.product_pages);
      const pagesGtm = normalizePageList(derived.gtm_pages);
      const pagesDistribution = normalizePageList(derived.distribution_pages);
      const pagesTraction = normalizePageList(derived.traction_pages);
      const pagesMarket = normalizePageList(derived.market_pages);

      const supporting = Array.isArray(s.supporting_nodes) ? s.supporting_nodes : [];
      const rows = supporting.map((n) => {
        const pageIndex = (n && (typeof n.page_index === 'number' || typeof n.page_index === 'string')) ? Number(n.page_index) : null;
        const slideTitle = (n && typeof n.slide_title === 'string') ? n.slide_title : null;
        const seg = (n && typeof n.segment_key === 'string') ? n.segment_key : (n && n.segment_key != null ? String(n.segment_key) : null);
        const note = (n && typeof n.note_snippet === 'string') ? n.note_snippet : null;
        return ''
          + '<tr>'
          +   '<td class="mono">' + escapeHtml(Number.isFinite(pageIndex) ? String(pageIndex) : '-') + '</td>'
          +   '<td>' + escapeHtml(slideTitle || '-') + '</td>'
          +   '<td class="mono">' + escapeHtml(seg || '-') + '</td>'
          +   '<td>' + escapeHtml(note || '-') + '</td>'
          + '</tr>';
      }).join('');

      const pageLine = (label, pages) => {
        const txt = pages.length > 0 ? pages.join(', ') : '-';
        return ''
          + '<div class="muted"><span class="mono">' + escapeHtml(label) + '</span>: ' + escapeHtml(txt) + '</div>';
      };

      const derivedHtml = ''
        + '<div style="margin-top: 0.35rem;">'
        +   pageLine('product_pages', pagesProduct)
        +   pageLine('gtm_pages', pagesGtm)
        +   pageLine('distribution_pages', pagesDistribution)
        +   pageLine('traction_pages', pagesTraction)
        +   pageLine('market_pages', pagesMarket)
        + '</div>';

      const supportingHtml = supporting.length > 0
        ? ''
          + '<details style="margin-top: 0.5rem;">'
          +   '<summary class="muted">supporting_nodes (' + escapeHtml(String(supporting.length)) + ')</summary>'
          +   '<table style="margin-top: 0.5rem;">'
          +     '<thead><tr><th>page</th><th>slide_title</th><th>segment</th><th>note_snippet</th></tr></thead>'
          +     '<tbody>' + rows + '</tbody>'
          +   '</table>'
          + '</details>'
        : '<div class="muted" style="margin-top:0.25rem;">No supporting_nodes</div>';

      return ''
        + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
        +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items: baseline;">'
        +     '<div><strong>Business Model (Synthesized)</strong></div>'
        +     '<div class="muted">value=' + escapeHtml(value || '-') + '</div>'
        +     '<div class="muted">confidence=' + escapeHtml(conf != null ? conf.toFixed(3) : '-') + '</div>'
        +   '</div>'
        +   '<div class="muted" style="margin-top:0.35rem;">Derived from (multi-node):</div>'
        +   derivedHtml
        +   supportingHtml
        + '</div>';
    }

    function renderSummaryV1Panel(label, summary, nodes) {
      const s = summary && typeof summary === 'object' ? summary : null;

      if (!s) {
        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items: baseline;">'
          +     '<div><strong>' + escapeHtml(label) + '</strong></div>'
          +     '<div class="muted">Missing</div>'
          +   '</div>'
          + '</div>';
      }

      const value = (typeof s.value === 'string' && s.value.trim()) ? s.value.trim() : null;
      const conf = (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) ? s.confidence : null;
      const claims = Array.isArray(s.claims) ? s.claims.map((c) => String(c)) : [];
      const derived = (s.derived_from && typeof s.derived_from === 'object') ? s.derived_from : {};
      const supporting = Array.isArray(s.supporting_nodes) ? s.supporting_nodes : [];
      const excluded = (s.debug && Array.isArray(s.debug.excluded_nodes)) ? s.debug.excluded_nodes : [];

      const findNodeByPage = (pageIndex) => {
        const p = (pageIndex != null) ? Number(pageIndex) : NaN;
        if (!Number.isFinite(p)) return null;
        for (const n of (Array.isArray(nodes) ? nodes : [])) {
          const np = (n && n.page_index != null) ? Number(n.page_index) : NaN;
          if (!Number.isFinite(np)) continue;
          if (np === p) return n;
        }
        return null;
      };

      const derivedLines = Object.keys(derived)
        .sort()
        .map((k) => {
          const pages = normalizePageList(derived[k]);
          return '<div class="muted"><span class="mono">' + escapeHtml(k) + '</span>: ' + escapeHtml(pages.length ? pages.join(', ') : '-') + '</div>';
        })
        .join('');

      const supportRows = supporting.map((n) => {
        const pageIndex = (n && (typeof n.page_index === 'number' || typeof n.page_index === 'string')) ? Number(n.page_index) : null;
        const matched = pageIndex != null ? findNodeByPage(pageIndex) : null;
        const ok = matched ? '✅ matched' : '❌ missing';
        const slideTitle = (n && typeof n.slide_title === 'string') ? n.slide_title : (matched && typeof matched.slide_title === 'string' ? matched.slide_title : null);
        const seg = (n && typeof n.segment_key === 'string') ? n.segment_key : (matched && typeof matched.segment_key === 'string' ? matched.segment_key : null);
        const note = (n && typeof n.note_snippet === 'string') ? n.note_snippet : null;
        return ''
          + '<tr>'
          +   '<td class="mono">' + escapeHtml(Number.isFinite(pageIndex) ? String(pageIndex) : '-') + '</td>'
          +   '<td>' + escapeHtml(slideTitle || '-') + '</td>'
          +   '<td class="mono">' + escapeHtml(seg || '-') + '</td>'
          +   '<td>' + escapeHtml(note || '-') + '</td>'
          +   '<td>' + escapeHtml(ok) + '</td>'
          + '</tr>';
      }).join('');

      const supportingHtml = supporting.length > 0
        ? ''
          + '<details style="margin-top: 0.5rem;">'
          +   '<summary class="muted">supporting_nodes (' + escapeHtml(String(supporting.length)) + ')</summary>'
          +   '<table style="margin-top: 0.5rem;">'
          +     '<thead><tr><th>page</th><th>slide_title</th><th>segment</th><th>note_snippet</th><th>node</th></tr></thead>'
          +     '<tbody>' + supportRows + '</tbody>'
          +   '</table>'
          + '</details>'
        : '<div class="muted" style="margin-top:0.25rem;">No supporting_nodes</div>';

      const excludedRows = excluded.slice(0, 25).map((n) => {
        const pageIndex = (n && (typeof n.page_index === 'number' || typeof n.page_index === 'string')) ? Number(n.page_index) : null;
        const slideTitle = (n && typeof n.slide_title === 'string') ? n.slide_title : null;
        const seg = (n && typeof n.segment_key === 'string') ? n.segment_key : null;
        const reason = (n && typeof n.exclusion_reason === 'string') ? n.exclusion_reason : '-';
        return ''
          + '<tr>'
          +   '<td class="mono">' + escapeHtml(Number.isFinite(pageIndex) ? String(pageIndex) : '-') + '</td>'
          +   '<td>' + escapeHtml(slideTitle || '-') + '</td>'
          +   '<td class="mono">' + escapeHtml(seg || '-') + '</td>'
          +   '<td>' + escapeHtml(reason) + '</td>'
          + '</tr>';
      }).join('');

      const excludedHtml = excluded.length > 0
        ? ''
          + '<details style="margin-top: 0.5rem;">'
          +   '<summary class="muted">excluded_nodes (' + escapeHtml(String(excluded.length)) + ')</summary>'
          +   '<table style="margin-top: 0.5rem;">'
          +     '<thead><tr><th>page</th><th>slide_title</th><th>segment</th><th>reason</th></tr></thead>'
          +     '<tbody>' + excludedRows + '</tbody>'
          +   '</table>'
          + '</details>'
        : '';

      const claimsHtml = claims.length > 0
        ? '<div class="muted" style="margin-top:0.35rem;"><span class="mono">claims</span>: ' + escapeHtml(claims.join(', ')) + '</div>'
        : '';

      return ''
        + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
        +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items: baseline;">'
        +     '<div><strong>' + escapeHtml(label) + '</strong></div>'
        +     '<div class="muted">value=' + escapeHtml(value || '-') + '</div>'
        +     '<div class="muted">confidence=' + escapeHtml(conf != null ? conf.toFixed(3) : '-') + '</div>'
        +   '</div>'
        +   claimsHtml
        +   '<div class="muted" style="margin-top: 0.35rem;">Derived from (pages):</div>'
        +   '<div style="margin-top:0.25rem;">' + derivedLines + '</div>'
        +   supportingHtml
        +   excludedHtml
        + '</div>';
    }

    function renderDeterministicStructuredPanel(payload) {
      const el = document.getElementById('deterministic-structured');
      if (!el) return;
      const ss = payload && payload.structured_summary ? payload.structured_summary : null;
      if (!ss || typeof ss !== 'object') {
        el.innerHTML = '<div class="muted">No structured_summary present.</div>';
        return;
      }

      function clamp01(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return null;
        return Math.max(0, Math.min(1, x));
      }

      function diagnosticBadge(kind) {
        const k = String(kind || '').trim();
        if (k === 'missing_required') return '<span class="badge badge-danger">missing_required</span>';
        if (k === 'overrepresentation') return '<span class="badge badge-warning">overrepresentation</span>';
        if (k === 'conflict') return '<span class="badge badge-info">conflict</span>';
        return '<span class="badge badge-info">' + escapeHtml(k || 'diagnostic') + '</span>';
      }

      function renderDeckArchetypePanel() {
        const meta = payload && payload.report && payload.report.metadata && typeof payload.report.metadata === 'object'
          ? payload.report.metadata
          : null;

        const archetype = meta && meta.deck_archetype && typeof meta.deck_archetype === 'object' ? meta.deck_archetype : null;
        const key = archetype && typeof archetype.key === 'string' ? archetype.key : null;
        const conf01 = archetype ? clamp01(archetype.confidence) : null;
        const confPct = (conf01 != null) ? Math.round(conf01 * 100) : null;

        const scoresObj = archetype && archetype.scores && typeof archetype.scores === 'object' ? archetype.scores : null;
        const scoreBreakdown = Array.isArray(archetype && archetype.score_breakdown) ? archetype.score_breakdown : null;

        const scoreTable = (() => {
          if (scoreBreakdown && scoreBreakdown.length > 0) {
            const rows = scoreBreakdown.map((r) => {
              const name = (r && (r.signal_name || r.name)) ? String(r.signal_name || r.name) : '-';
              const weight = (r && typeof r.weight === 'number') ? String(r.weight) : (r && r.weight != null ? String(r.weight) : '-');
              const contribution = (r && typeof r.contribution === 'number') ? String(r.contribution) : (r && r.contribution != null ? String(r.contribution) : '-');
              return '<tr><td class="mono">' + escapeHtml(name) + '</td><td class="mono">' + escapeHtml(weight) + '</td><td class="mono">' + escapeHtml(contribution) + '</td></tr>';
            }).join('');
            return ''
              + '<div class="muted" style="margin-top:0.5rem;">Score breakdown</div>'
              + '<table style="margin-top:0.25rem;">'
              + '<thead><tr><th>signal_name</th><th>weight</th><th>contribution</th></tr></thead>'
              + '<tbody>' + rows + '</tbody>'
              + '</table>';
          }

          if (scoresObj) {
            const entries = Object.keys(scoresObj).sort().map((k) => {
              const v = scoresObj[k];
              const s = (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(3) : String(v);
              return '<tr><td class="mono">' + escapeHtml(k) + '</td><td class="mono">' + escapeHtml(s) + '</td></tr>';
            }).join('');
            return ''
              + '<div class="muted" style="margin-top:0.5rem;">Score breakdown</div>'
              + '<table style="margin-top:0.25rem;">'
              + '<thead><tr><th>archetype</th><th>score</th></tr></thead>'
              + '<tbody>' + entries + '</tbody>'
              + '</table>';
          }
          return '<div class="muted" style="margin-top:0.5rem;">No score breakdown available.</div>';
        })();

        const signals = (() => {
          const raw = archetype && archetype.signals ? archetype.signals : (archetype && archetype.keyword_hits ? Object.keys(archetype.keyword_hits) : null);
          const items = Array.isArray(raw)
            ? raw.map((x) => String(x)).filter(Boolean)
            : (raw && typeof raw === 'object')
              ? Object.keys(raw)
              : [];
          const uniq = Array.from(new Set(items)).slice(0, 24);
          if (uniq.length === 0) return '<div class="muted" style="margin-top:0.25rem;">Signals: -</div>';
          return ''
            + '<div class="muted" style="margin-top:0.5rem;">Signals</div>'
            + '<div style="margin-top:0.25rem; display:flex; gap:0.35rem; flex-wrap:wrap;">'
            + uniq.map((s) => '<span class="pill">' + escapeHtml(s) + '</span>').join('')
            + '</div>';
        })();

        const diagnosticsArr = meta && Array.isArray(meta.archetype_diagnostics) ? meta.archetype_diagnostics : [];
        const diagnosticsHtml = diagnosticsArr.length === 0
          ? '<div class="muted" style="margin-top:0.5rem;">Diagnostics: none</div>'
          : ''
            + '<div class="muted" style="margin-top:0.75rem;">Diagnostics</div>'
            + '<ul style="margin-left:1.25rem; margin-top:0.25rem;">'
            + diagnosticsArr.map((d) => {
                const kind = d && d.kind ? String(d.kind) : '';
                const msg = d && d.message ? String(d.message) : '';
                const details = d && d.details && typeof d.details === 'object' ? d.details : null;
                const segment = details && details.segment ? String(details.segment) : null;
                const detailStr = (() => {
                  if (!details) return null;
                  try {
                    const raw = JSON.stringify(details);
                    return raw.length > 260 ? (raw.slice(0, 257) + '…') : raw;
                  } catch {
                    return null;
                  }
                })();

                return ''
                  + '<li style="margin:0.25rem 0;">'
                  + diagnosticBadge(kind)
                  + (segment ? (' <span class="pill">segment: ' + escapeHtml(segment) + '</span>') : '')
                  + (msg ? (' <span>' + escapeHtml(msg) + '</span>') : '')
                  + (detailStr ? ('<div class="muted" style="margin-top:0.15rem;"><span class="mono">details</span>: ' + escapeHtml(detailStr) + '</div>') : '')
                  + '</li>';
              }).join('')
            + '</ul>';

        const expectedHtml = (() => {
          if (!key) return '';
          const rows = (DECK_ARCHETYPE_EXPECTATIONS_V1 && DECK_ARCHETYPE_EXPECTATIONS_V1[key]) ? DECK_ARCHETYPE_EXPECTATIONS_V1[key] : [];
          if (!Array.isArray(rows) || rows.length === 0) return '';

          const trs = rows.map((r) => {
            const seg = r && r.segment ? String(r.segment) : '-';
            const mn = (r && r.expected_min != null) ? String(r.expected_min) : '-';
            const mx = (r && r.expected_max != null) ? String(r.expected_max) : '-';
            const note = r && r.note ? String(r.note) : '';
            return '<tr>'
              + '<td class="mono">' + escapeHtml(seg) + '</td>'
              + '<td class="mono">' + escapeHtml(mn) + '</td>'
              + '<td class="mono">' + escapeHtml(mx) + '</td>'
              + '<td>' + escapeHtml(note || '-') + '</td>'
              + '</tr>';
          }).join('');

          const openBtn = ''
            + '<button class="btn btn-small btn-secondary" style="margin-top:0.5rem;" data-action="open-node-inspector">Open Node Inspector</button>';

          return ''
            + '<div class="muted" style="margin-top:0.75rem;">Open Node Inspector helper</div>'
            + '<div style="margin-top:0.25rem;">'
            +   '<div style="font-weight:600;">Expected segments for this archetype</div>'
            +   '<table style="margin-top:0.35rem;">'
            +     '<thead><tr><th>segment</th><th>expected_min</th><th>expected_max</th><th>note</th></tr></thead>'
            +     '<tbody>' + trs + '</tbody>'
            +   '</table>'
            +   openBtn
            + '</div>';
        })();

        const headline = ''
          + '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +   '<div><strong>Deck Archetype (v1)</strong></div>'
          +   '<div class="muted">key=<span class="mono">' + escapeHtml(key || '-') + '</span></div>'
          +   '<div class="muted">confidence=<span class="mono">' + escapeHtml(conf01 != null ? conf01.toFixed(3) : '-') + '</span>'
          +     (confPct != null ? (' <span class="pill">' + escapeHtml(String(confPct)) + '%</span>') : '')
          +   '</div>'
          + '</div>';

        const emptyNote = (!archetype)
          ? '<div class="muted" style="margin-top:0.5rem;">No report.metadata.deck_archetype present.</div>'
          : '';

        const container = ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.25rem;">'
          + headline
          + emptyNote
          + (archetype ? (scoreTable + signals + diagnosticsHtml + expectedHtml) : '')
          + '</div>';

        return container;
      }

      function renderArchetypeAlignmentPanel() {
        const meta = payload && payload.report && payload.report.metadata ? payload.report.metadata : null;
        const drift = meta && meta.archetype_segment_drift_v1 ? meta.archetype_segment_drift_v1 : null;
        if (!drift) {
          return ''
            + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
            +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
            +     '<div><strong>Archetype ↔ Segment Alignment</strong></div>'
            +     '<div class="muted">No report.metadata.archetype_segment_drift_v1 present.</div>'
            +   '</div>'
            + '</div>';
        }

        const assessment = drift && drift.overall_assessment ? String(drift.overall_assessment) : 'unknown';
        const key = drift && drift.archetype ? String(drift.archetype) : '-';
        const conf = drift && typeof drift.confidence === 'number' ? drift.confidence : null;

        const assessmentBadge = (() => {
          const k = String(assessment);
          if (k === 'aligned') return '<span class="badge badge-success">aligned</span>';
          if (k === 'mostly_aligned') return '<span class="badge badge-warn">mostly_aligned</span>';
          if (k === 'misaligned') return '<span class="badge badge-danger">misaligned</span>';
          return '<span class="badge badge-muted">unknown</span>';
        })();

        const severityBadge = (sev) => {
          const s = String(sev || '');
          if (s === 'info') return '<span class="badge badge-info">info</span>';
          if (s === 'warn') return '<span class="badge badge-warn">warn</span>';
          if (s === 'critical') return '<span class="badge badge-danger">critical</span>';
          return '<span class="badge badge-muted">-</span>';
        };

        const statusBadge = (st) => {
          const s = String(st || '');
          if (s === 'within_range') return '<span class="pill">within_range</span>';
          if (s === 'underrepresented') return '<span class="pill">underrepresented</span>';
          if (s === 'overrepresented') return '<span class="pill">overrepresented</span>';
          return '<span class="pill">-</span>';
        };

        const rows = Array.isArray(drift.segment_analysis) ? drift.segment_analysis : [];
        const sorted = rows.slice().sort((a, b) => {
          const ak = a && a.segment_key ? String(a.segment_key) : '';
          const bk = b && b.segment_key ? String(b.segment_key) : '';
          return ak.localeCompare(bk);
        });

        const trs = sorted.map((r) => {
          const seg = r && r.segment_key ? String(r.segment_key) : '-';
          const mn = (r && r.expected_min != null) ? String(r.expected_min) : '-';
          const mx = (r && r.expected_max != null) ? String(r.expected_max) : '-';
          const ob = (r && r.observed_count != null) ? String(r.observed_count) : '-';
          const st = r && r.status ? String(r.status) : '-';
          const sev = r && r.severity ? String(r.severity) : '-';
          const highlight = (sev === 'critical') ? ' style="background:#fff5f5;"' : (sev === 'warn') ? ' style="background:#fffaf0;"' : '';
          return '<tr' + highlight + '>'
            + '<td class="mono">' + escapeHtml(seg) + '</td>'
            + '<td class="mono">' + escapeHtml(mn) + '</td>'
            + '<td class="mono">' + escapeHtml(mx) + '</td>'
            + '<td class="mono">' + escapeHtml(ob) + '</td>'
            + '<td>' + statusBadge(st) + '</td>'
            + '<td>' + severityBadge(sev) + '</td>'
            + '</tr>';
        }).join('');

        const cps = Array.isArray(drift.compensating_patterns) ? drift.compensating_patterns : [];
        const compHtml = cps.length === 0
          ? '<div class="muted" style="margin-top:0.5rem;">Compensating patterns: none</div>'
          : ''
            + '<div class="muted" style="margin-top:0.75rem;">Compensating patterns</div>'
            + '<ul style="margin-left:1.25rem; margin-top:0.25rem;">'
            + cps.map((cp) => {
                const miss = cp && cp.missing_segment ? String(cp.missing_segment) : '-';
                const by = cp && Array.isArray(cp.compensated_by) ? cp.compensated_by.map((x) => String(x)) : [];
                const rationale = cp && cp.rationale ? String(cp.rationale) : '';
                return ''
                  + '<li style="margin:0.25rem 0;">'
                  + '<span class="pill">missing: ' + escapeHtml(miss) + '</span>'
                  + (by.length > 0 ? (' <span class="pill">by: ' + escapeHtml(by.join(', ')) + '</span>') : '')
                  + (rationale ? ('<div class="muted" style="margin-top:0.15rem;">' + escapeHtml(rationale) + '</div>') : '')
                  + '</li>';
              }).join('')
            + '</ul>';

        const notes = Array.isArray(drift.structural_notes) ? drift.structural_notes : [];
        const notesHtml = notes.length === 0
          ? '<div class="muted" style="margin-top:0.5rem;">Structural notes: none</div>'
          : ''
            + '<div class="muted" style="margin-top:0.75rem;">Structural notes</div>'
            + '<ul style="margin-left:1.25rem; margin-top:0.25rem;">'
            + notes.map((n) => '<li style="margin:0.25rem 0;">' + escapeHtml(String(n)) + '</li>').join('')
            + '</ul>';

        const openBtn = '<button class="btn btn-small btn-secondary" style="margin-top:0.5rem;" data-action="open-node-inspector">Open Node Inspector</button>';

        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +     '<div><strong>Archetype ↔ Segment Alignment</strong></div>'
          +     '<div class="muted">archetype=<span class="mono">' + escapeHtml(key) + '</span></div>'
          +     '<div class="muted">confidence=<span class="mono">' + escapeHtml(conf != null ? conf.toFixed(3) : '-') + '</span></div>'
          +     '<div>' + assessmentBadge + '</div>'
          +   '</div>'
          +   '<table style="margin-top:0.5rem;">'
          +     '<thead><tr><th>segment</th><th>expected_min</th><th>expected_max</th><th>observed</th><th>status</th><th>severity</th></tr></thead>'
          +     '<tbody>' + trs + '</tbody>'
          +   '</table>'
          +   openBtn
          +   compHtml
          +   notesHtml
          + '</div>';
      }

      function renderOverrideQualityPanel() {
        const meta = payload && payload.report && payload.report.metadata ? payload.report.metadata : null;
        const oq = meta && meta.override_quality ? meta.override_quality : null;
        const title = '<div><strong>Override Quality (v1)</strong></div>';

        if (!oq) {
          return ''
            + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
            +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
            +     title
            +     '<div class="muted">No report.metadata.override_quality present.</div>'
            +   '</div>'
            + '</div>';
        }

        const total = (oq && typeof oq.total_nodes === 'number') ? oq.total_nodes : null;
        const overridden = (oq && typeof oq.overridden_nodes === 'number') ? oq.overridden_nodes : null;
        const ratio = (oq && typeof oq.override_ratio === 'number') ? oq.override_ratio : null;
        const ratioPct = (ratio != null && Number.isFinite(ratio)) ? Math.round(ratio * 100) : null;
        const assessment = oq && oq.assessment ? String(oq.assessment) : 'unknown';

        const badge = (() => {
          if (assessment === 'low') return '<span class="badge badge-success">low</span>';
          if (assessment === 'moderate') return '<span class="badge badge-warn">moderate</span>';
          if (assessment === 'high') return '<span class="badge badge-danger">high</span>';
          return '<span class="badge badge-muted">unknown</span>';
        })();

        const warning = (assessment === 'high')
          ? '<div class="badge badge-warn" style="margin-top:0.5rem;">This deck required a high number of semantic corrections. Review slide structure.</div>'
          : '';

        const byRule = (oq && oq.by_override_rule && typeof oq.by_override_rule === 'object') ? oq.by_override_rule : {};
        const byRuleSegments = (oq && oq.by_override_rule_segments && typeof oq.by_override_rule_segments === 'object') ? oq.by_override_rule_segments : {};
        const ruleKeys = Object.keys(byRule || {}).sort();

        const rows = ruleKeys.length === 0
          ? '<tr><td colspan="3" class="muted">No overrides detected.</td></tr>'
          : ruleKeys.map((k) => {
              const count = byRule[k];
              const segments = Array.isArray(byRuleSegments[k]) ? byRuleSegments[k].map((x) => String(x)).filter(Boolean) : [];
              const segStr = segments.length > 0 ? segments.join(', ') : '-';
              return '<tr>'
                + '<td class="mono">' + escapeHtml(String(k)) + '</td>'
                + '<td class="mono">' + escapeHtml(String(count)) + '</td>'
                + '<td class="mono">' + escapeHtml(segStr) + '</td>'
                + '</tr>';
            }).join('');

        const notesArr = (oq && Array.isArray(oq.notes)) ? oq.notes : [];
        const notesHtml = notesArr.length === 0
          ? '<div class="muted" style="margin-top:0.5rem;">Notes: none</div>'
          : ''
            + '<div class="muted" style="margin-top:0.75rem;">Notes</div>'
            + '<ul style="margin-left:1.25rem; margin-top:0.25rem;">'
            + notesArr.map((n) => '<li style="margin:0.25rem 0;">' + escapeHtml(String(n)) + '</li>').join('')
            + '</ul>';

        const openBtn = '<button class="btn btn-small btn-secondary" style="margin-top:0.5rem;" data-action="open-node-inspector-overrides">Open Node Inspector (Overrides Only)</button>';

        const headline = ''
          + '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +   title
          +   '<div class="muted">total_nodes=<span class="mono">' + escapeHtml(total != null ? String(total) : '-') + '</span></div>'
          +   '<div class="muted">overridden_nodes=<span class="mono">' + escapeHtml(overridden != null ? String(overridden) : '-') + '</span></div>'
          +   '<div class="muted">override_ratio=<span class="mono">' + escapeHtml(ratio != null ? ratio.toFixed(2) : '-') + '</span>'
          +     (ratioPct != null ? (' <span class="pill">' + escapeHtml(String(ratioPct)) + '%</span>') : '')
          +   '</div>'
          +   '<div>' + badge + '</div>'
          + '</div>';

        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          + headline
          + warning
          + '<div class="muted" style="margin-top:0.75rem;">Overrides by rule</div>'
          + '<table style="margin-top:0.25rem;">'
          +   '<thead><tr><th>override_rule_id</th><th>count</th><th>affected_segments</th></tr></thead>'
          +   '<tbody>' + rows + '</tbody>'
          + '</table>'
          + openBtn
          + notesHtml
          + '</div>';
      }

      // Browser-safe helper: never throws. The dashboard HTML runs in the browser,
      // so it must not depend on Node-only globals like process.env.
      function detectDeterministicScoreV1EnvSource(preview) {
        try {
          if (!preview || typeof preview !== 'object') return 'missing';
          if (typeof preview.enabled !== 'boolean') return 'missing';
          return 'process.env';
        } catch {
          return 'missing';
        }
      }

      function renderDeterministicScoreInputsPanel() {
        const meta = payload && payload.report && payload.report.metadata ? payload.report.metadata : null;
        const inputs = meta && meta.deterministic_score_inputs_v1 ? meta.deterministic_score_inputs_v1 : null;
        const preview = meta && meta.deterministic_score_preview_v1 ? meta.deterministic_score_preview_v1 : null;
        const title = '<div><strong>Score Inputs (v1)</strong></div>';

        if (!inputs || !preview) {
          return ''
            + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
            +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
            +     title
            +     '<div class="muted">No report.metadata.deterministic_score_inputs_v1 present.</div>'
            +   '</div>'
            + '</div>';
        }

        const enabled = Boolean(preview && preview.enabled);
        const drift = preview && preview.gate ? String(preview.gate.drift_assessment || 'unknown') : 'unknown';
        const blocked = Boolean(preview && preview.gate && preview.gate.blocked_by_drift_misaligned);
        const applied = Boolean(preview && preview.applied);

        const envSource = detectDeterministicScoreV1EnvSource(preview);
        const envDisplay = enabled ? 'true' : 'false';

        const badge = (() => {
          if (applied) return '<span class="badge badge-success">applied</span>';
          if (!enabled) return '<span class="badge badge-muted">disabled</span>';
          if (blocked) return '<span class="badge badge-danger">blocked</span>';
          return '<span class="badge badge-warn">preview</span>';
        })();

        const inputsHash = typeof inputs.inputs_hash === 'string' ? inputs.inputs_hash : null;

        const totalNodes = (inputs && inputs.segments && typeof inputs.segments.total_nodes === 'number') ? inputs.segments.total_nodes : null;
        const overrideRatio = (inputs && inputs.segments && typeof inputs.segments.override_ratio === 'number') ? inputs.segments.override_ratio : null;

        const baseline = preview && preview.baseline ? preview.baseline : {};
        const det = preview && preview.deterministic ? preview.deterministic : {};
        const delta = (preview && typeof preview.delta_overall_score === 'number') ? preview.delta_overall_score : null;
        const deltaUnrounded = (preview && typeof preview.delta_unrounded_overall === 'number') ? preview.delta_unrounded_overall : null;
        const deltaEvidence = (preview && typeof preview.delta_evidence_factor === 'number') ? preview.delta_evidence_factor : null;
        const deltaAdj = (preview && typeof preview.delta_adjustment_factor === 'number') ? preview.delta_adjustment_factor : null;
        const roundingNote = (preview && typeof preview.rounding_note === 'string' && preview.rounding_note.trim()) ? preview.rounding_note.trim() : null;

        const baselineUnadjusted = (baseline && typeof baseline.unadjusted_overall_score === 'number') ? baseline.unadjusted_overall_score : null;
        const baselinePinned = Boolean(
          (baseline && baseline.unadjusted_pinned === true)
          || (preview && preview.gate && preview.gate.blocked_by_unadjusted_pinned)
          || (Array.isArray(preview?.notes) && preview.notes.includes('pinned_unadjusted'))
        );
        const showPinnedBadge = baselinePinned;
        const unadjustedReason = (baseline && typeof baseline.unadjusted_reason === 'string' && baseline.unadjusted_reason.trim()) ? baseline.unadjusted_reason.trim() : null;
        const unadjustedPinReason = (baseline && typeof baseline.unadjusted_pin_reason === 'string' && baseline.unadjusted_pin_reason.trim()) ? baseline.unadjusted_pin_reason.trim() : null;

        const scoreBand = meta && meta.score_band_v2 ? meta.score_band_v2 : null;
        const scoreBandLabel = (scoreBand && typeof scoreBand.label === 'string' && scoreBand.label.trim()) ? scoreBand.label.trim() : null;
        const scoreBandKey = (scoreBand && typeof scoreBand.key === 'string' && scoreBand.key.trim()) ? scoreBand.key.trim() : null;
        const scoreBandBadgeClass = (() => {
          if (scoreBandKey === 'hard_pass') return 'badge-danger';
          if (scoreBandKey === 'consider_caution') return 'badge-warn';
          if (scoreBandKey === 'strong_consider') return 'badge-warn';
          if (scoreBandKey === 'fund_caution') return 'badge-warn';
          if (scoreBandKey === 'fund_track') return 'badge-success';
          if (scoreBandKey === 'fund_confident') return 'badge-success';
          return 'badge-muted';
        })();

        const guardrail = meta && meta.hard_pass_guardrail_v2 ? meta.hard_pass_guardrail_v2 : null;
        const guardrailTriggered = Boolean(guardrail && guardrail.triggered === true);
        const guardrailNote = (guardrail && typeof guardrail.note === 'string' && guardrail.note.trim()) ? guardrail.note.trim() : null;

        const fmt = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '-';
        const fmt2 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(2) : '-';
        const fmt3 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(3) : '-';
        const fmtSigned3 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? ((v > 0 ? '+' : '') + v.toFixed(3)) : '-';

        const kpis = Array.isArray(inputs.kpis) ? inputs.kpis : [];
        const kpiRows = kpis.length === 0
          ? '<tr><td colspan="4" class="muted">No KPIs present.</td></tr>'
          : kpis.map((k) => {
              const key = k && k.key ? String(k.key) : '-';
              const conf = (k && typeof k.confidence === 'number') ? k.confidence : null;
              const src0 = (k && Array.isArray(k.sources) && k.sources.length > 0) ? k.sources[0] : null;
              const doc = src0 && src0.document_id ? String(src0.document_id) : '-';
              const pi = (src0 && typeof src0.page_index === 'number') ? src0.page_index : null;
              const page = (pi != null) ? (pi + 1) : null;
              const raw = (k && typeof k.value_raw === 'string' && k.value_raw.trim()) ? k.value_raw.trim() : '';
              return '<tr>'
                + '<td class="mono">' + escapeHtml(key) + '</td>'
                + '<td class="mono">' + escapeHtml(conf != null ? conf.toFixed(3) : '-') + '</td>'
                + '<td class="mono">' + escapeHtml(page != null ? String(page) : '-') + '</td>'
                + '<td class="muted">' + escapeHtml(raw) + '</td>'
                + '</tr>';
            }).join('');

        const envLine = '<div class="muted">DETERMINISTIC_SCORE_V1_ENABLED=<span class="mono">' + escapeHtml(envDisplay) + '</span></div>';
        const envSourceLine = '<div class="muted">env_source=<span class="mono">' + escapeHtml(envSource) + '</span></div>';
        const driftLine = '<div class="muted">drift=<span class="mono">' + escapeHtml(drift) + '</span></div>';
        const hashLine = '<div class="muted">inputs_hash=<span class="mono">' + escapeHtml(inputsHash ? inputsHash.slice(0, 16) + '…' : '-') + '</span></div>';
        const nodesLine = '<div class="muted">total_nodes=<span class="mono">' + escapeHtml(totalNodes != null ? String(totalNodes) : '-') + '</span></div>';
        const overrideLine = '<div class="muted">override_ratio=<span class="mono">' + escapeHtml(overrideRatio != null ? overrideRatio.toFixed(2) : '-') + '</span></div>';

        const missingInsideContainerLine = envSource === 'missing'
          ? '<div class="muted" style="margin-top:0.25rem;">Flag is not set inside container. Add to <span class="mono">.env.docker.local</span> and recreate <span class="mono">api_dev</span>.</div>'
          : '';

        const scoreLine = ''
          + '<div class="muted" style="margin-top:0.5rem;">'
          + (scoreBandLabel
            ? ('<div style="margin-bottom:0.25rem;"><span class="badge ' + escapeHtml(scoreBandBadgeClass) + '">Score band: ' + escapeHtml(scoreBandLabel) + '</span></div>')
            : '')
          + (guardrailTriggered
            ? ('<div class="badge badge-danger" style="margin-bottom:0.25rem;">Hard Pass guardrail triggered</div>'
              + (guardrailNote ? ('<div class="muted" style="margin-top:0.1rem;">' + escapeHtml(guardrailNote) + '</div>') : '')
            )
            : '')
          + 'baseline_unadjusted=<span class="mono">' + escapeHtml(baselineUnadjusted != null ? String(baselineUnadjusted) : '-') + '</span>'
          + '</div>'
          + (showPinnedBadge
            ? '<div class="badge badge-danger" style="margin-top:0.5rem;">Pinned: baseline unadjusted score is not trusted' + (unadjustedPinReason ? (' (' + escapeHtml(unadjustedPinReason) + ')') : '') + '</div>'
            : '')
          + (unadjustedReason
            ? ('<div class="muted" style="margin-top:0.25rem;">' + escapeHtml(unadjustedReason) + '</div>')
            : '')
          + '<div class="muted" style="margin-top:0.5rem;">'
          + 'baseline_overall=<span class="mono">' + escapeHtml(fmt(baseline.overall_score)) + '</span>'
          + ' → deterministic_overall=<span class="mono">' + escapeHtml(fmt(det.overall_score)) + '</span>'
          + (delta != null ? (' <span class="pill">Δ ' + escapeHtml(String(delta)) + '</span>') : '')
          + '</div>'
          + '<div class="muted">baseline_evidence=<span class="mono">' + escapeHtml(fmt3(baseline.evidence_factor)) + '</span>'
          + ' → deterministic_evidence=<span class="mono">' + escapeHtml(fmt3(det.evidence_factor)) + '</span>'
          + (deltaEvidence != null ? (' <span class="pill">Δ ' + escapeHtml(fmtSigned3(deltaEvidence)) + '</span>') : '')
          + '</div>'
          + '<div class="muted">baseline_adjustment=<span class="mono">' + escapeHtml(fmt3(baseline.adjustment_factor)) + '</span>'
          + ' → deterministic_adjustment=<span class="mono">' + escapeHtml(fmt3(det.adjustment_factor)) + '</span>'
          + (deltaAdj != null ? (' <span class="pill">Δ ' + escapeHtml(fmtSigned3(deltaAdj)) + '</span>') : '')
          + '</div>'
          + '<div class="muted">delta_unrounded_overall=<span class="mono">' + escapeHtml(fmtSigned3(deltaUnrounded)) + '</span></div>'
          + (roundingNote ? ('<div class="muted" style="margin-top:0.25rem;">' + escapeHtml(roundingNote) + '</div>') : '');

        const blockedWarn = blocked
          ? '<div class="badge badge-danger" style="margin-top:0.5rem;">Blocked: drift misaligned</div>'
          : '';

        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +     title
          +     badge
          +   '</div>'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline; margin-top:0.25rem;">'
          +     envLine + envSourceLine + driftLine + hashLine + nodesLine + overrideLine
          +   '</div>'
          +   missingInsideContainerLine
          +   blockedWarn
          +   scoreLine
          +   '<div class="muted" style="margin-top:0.75rem;">KPIs (from structured_summary)</div>'
          +   '<table style="margin-top:0.25rem;">'
          +     '<thead><tr><th>kpi</th><th>confidence</th><th>page</th><th>value_raw</th></tr></thead>'
          +     '<tbody>' + kpiRows + '</tbody>'
          +   '</table>'
          + '</div>';
      }

      function renderUiPreviewV1Panel() {
        const meta = payload && payload.report && payload.report.metadata ? payload.report.metadata : null;
        const ui = meta && meta.ui_preview_v1 ? meta.ui_preview_v1 : null;
        const title = '<div><strong>UI Preview (v1)</strong></div>';

        if (!ui || typeof ui !== 'object') {
          return ''
            + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
            +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
            +     title
            +     '<div class="muted">No report.metadata.ui_preview_v1 present.</div>'
            +   '</div>'
            + '</div>';
        }

        const tiles = ui.header_tiles && typeof ui.header_tiles === 'object' ? ui.header_tiles : {};
        const score = ui.score && typeof ui.score === 'object' ? ui.score : {};
        const summaries = ui.summaries && typeof ui.summaries === 'object' ? ui.summaries : {};
        const citations = ui.citations && typeof ui.citations === 'object' ? ui.citations : {};

        const badge = (kind) => {
          const k = String(kind || '');
          if (k === 'synthesized') return '<span class="badge badge-info">synthesized</span>';
          if (k === 'promoted') return '<span class="badge badge-warn">promoted</span>';
          if (k === 'none') return '<span class="badge badge-muted">none</span>';
          return '<span class="badge badge-muted">-</span>';
        };

        const scoreBadge = (() => {
          const enabled = Boolean(score.enabled);
          const applied = Boolean(score.applied);
          const blocked = Boolean(score.blocked_by_drift_misaligned);
          if (applied) return '<span class="badge badge-success">applied</span>';
          if (!enabled) return '<span class="badge badge-muted">disabled</span>';
          if (blocked) return '<span class="badge badge-danger">blocked</span>';
          return '<span class="badge badge-warn">preview</span>';
        })();

        const tileCard = (label, value, right) => {
          return ''
            + '<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem 0.6rem; min-width: 220px;">'
            +   '<div class="muted" style="display:flex; justify-content:space-between; gap:0.5rem;">'
            +     '<span>' + escapeHtml(String(label || '')) + '</span>'
            +     (right ? ('<span>' + right + '</span>') : '')
            +   '</div>'
            +   '<div style="margin-top:0.2rem; font-weight:600;">' + escapeHtml(String(value || '-')) + '</div>'
            + '</div>';
        };

        const fmt = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '-';
        const fmt2 = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(2) : '-';

        const raise = tiles.raise && typeof tiles.raise === 'object' ? tiles.raise : {};
        const revenue = tiles.revenue && typeof tiles.revenue === 'object' ? tiles.revenue : {};
        const growth = tiles.growth && typeof tiles.growth === 'object' ? tiles.growth : {};
        const customers = tiles.customers && typeof tiles.customers === 'object' ? tiles.customers : {};
        const bm = tiles.business_model && typeof tiles.business_model === 'object' ? tiles.business_model : {};
        const dealType = tiles.deal_type && typeof tiles.deal_type === 'object' ? tiles.deal_type : {};
        const conf = tiles.confidence && typeof tiles.confidence === 'object' ? tiles.confidence : {};

        const bmTrace = bm.selection_trace && typeof bm.selection_trace === 'object' ? bm.selection_trace : {};
        const bmRight = badge(bm.badge);
        const bmValue = bm.value != null ? String(bm.value) : '-';
        const bmTraceLine = ''
          + '<div class="muted" style="margin-top:0.15rem;">'
          +   '<span class="mono">selected_from</span>=' + escapeHtml(String(bmTrace.selected_from || '-'))
          +   ' <span class="mono">reason</span>=' + escapeHtml(String(bmTrace.reason || '-'))
          + '</div>';

        const confidenceRight = (() => {
          const verified = Boolean(conf.verified);
          return verified ? '<span class="badge badge-success">verified</span>' : '<span class="badge badge-muted">unverified</span>';
        })();

        const tilesHtml = ''
          + '<div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">'
          + tileCard('Raise', raise.value, null)
          + tileCard('Revenue', revenue.value, null)
          + tileCard('Growth', growth.value, null)
          + tileCard('Customers', customers.value, null)
          + '<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem 0.6rem; min-width: 320px;">'
          +   '<div class="muted" style="display:flex; justify-content:space-between; gap:0.5rem;">'
          +     '<span>Business model</span>'
          +     '<span>' + bmRight + '</span>'
          +   '</div>'
          +   '<div style="margin-top:0.2rem; font-weight:600;">' + escapeHtml(bmValue) + '</div>'
          +   bmTraceLine
          + '</div>'
          + tileCard('Deal type', dealType.value, null)
          + tileCard('Confidence', conf.value, confidenceRight)
          + '</div>';

        const scoreLine = ''
          + '<div class="muted" style="margin-top:0.35rem;">'
          + 'baseline_overall=<span class="mono">' + escapeHtml(fmt(score.baseline && score.baseline.overall_score)) + '</span>'
          + ' → deterministic_overall=<span class="mono">' + escapeHtml(fmt(score.deterministic && score.deterministic.overall_score)) + '</span>'
          + ' <span class="pill">Δ ' + escapeHtml(fmt(score.delta_overall_score)) + '</span>'
          + '</div>'
          + '<div class="muted">baseline_adjustment=<span class="mono">' + escapeHtml(fmt2(score.baseline && score.baseline.adjustment_factor)) + '</span>'
          + ' → deterministic_adjustment=<span class="mono">' + escapeHtml(fmt2(score.deterministic && score.deterministic.adjustment_factor)) + '</span></div>';

        const gateLine = ''
          + '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline; margin-top:0.25rem;">'
          +   '<div class="muted">enabled=<span class="mono">' + escapeHtml(Boolean(score.enabled) ? 'true' : 'false') + '</span></div>'
          +   '<div class="muted">applied=<span class="mono">' + escapeHtml(Boolean(score.applied) ? 'true' : 'false') + '</span></div>'
          +   '<div class="muted">drift=<span class="mono">' + escapeHtml(String(score.drift_assessment || 'unknown')) + '</span></div>'
          +   '<div class="muted">blocked=<span class="mono">' + escapeHtml(Boolean(score.blocked_by_drift_misaligned) ? 'true' : 'false') + '</span></div>'
          +   '<div class="muted">inputs_hash=<span class="mono">' + escapeHtml(typeof score.inputs_hash === 'string' ? (score.inputs_hash.slice(0, 16) + '…') : '-') + '</span></div>'
          + '</div>';

        const dealSummary = summaries.deal_summary && typeof summaries.deal_summary === 'object' ? summaries.deal_summary : {};
        const productSummary = summaries.product_summary && typeof summaries.product_summary === 'object' ? summaries.product_summary : null;
        const marketSummary = summaries.market_summary && typeof summaries.market_summary === 'object' ? summaries.market_summary : null;
        const gtmSummary = summaries.gtm_summary && typeof summaries.gtm_summary === 'object' ? summaries.gtm_summary : null;

        const summaryBlock = (label, s) => {
          const v = s && s.value != null ? String(s.value) : '';
          return ''
            + '<div style="margin-top:0.5rem;">'
            +   '<div class="muted" style="font-weight:600;">' + escapeHtml(label) + '</div>'
            +   '<div style="margin-top:0.25rem;">' + escapeHtml(v || '-') + '</div>'
            + '</div>';
        };

        const citationsLine = (() => {
          const counts = citations.counts && typeof citations.counts === 'object' ? citations.counts : {};
          const available = Boolean(citations.available);
          const total = (typeof counts.total_sources === 'number') ? counts.total_sources : null;
          const uniq = (typeof counts.unique_pages === 'number') ? counts.unique_pages : null;
          return '<div class="muted" style="margin-top:0.5rem;">citations_available=<span class="mono">' + escapeHtml(available ? 'true' : 'false') + '</span>'
            + ' total_sources=<span class="mono">' + escapeHtml(total != null ? String(total) : '-') + '</span>'
            + ' unique_pages=<span class="mono">' + escapeHtml(uniq != null ? String(uniq) : '-') + '</span>'
            + '</div>';
        })();

        const rawJson = (() => {
          try {
            return JSON.stringify(ui, null, 2);
          } catch {
            return null;
          }
        })();

        const rawDetails = rawJson
          ? ''
            + '<details style="margin-top:0.75rem;">'
            +   '<summary class="muted">ui_preview_v1 (raw)</summary>'
            +   '<pre style="margin-top:0.5rem;">' + escapeHtml(rawJson) + '</pre>'
            + '</details>'
          : '';

        return ''
          + '<div style="border-top: 1px solid #e2e8f0; padding-top: 0.75rem; margin-top: 0.75rem;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +     title
          +     scoreBadge
          +     '<div class="muted">Mirrors DealWorkspace overview inputs (no new inference)</div>'
          +   '</div>'
          +   tilesHtml
          +   '<div class="muted" style="margin-top:0.75rem; font-weight:600;">Score preview</div>'
          +   gateLine
          +   scoreLine
          +   citationsLine
          +   '<div class="muted" style="margin-top:0.75rem; font-weight:600;">Summaries</div>'
          +   summaryBlock('Deal summary', dealSummary)
          +   (productSummary ? summaryBlock('Product summary', productSummary) : '')
          +   (marketSummary ? summaryBlock('Market summary', marketSummary) : '')
          +   (gtmSummary ? summaryBlock('GTM summary', gtmSummary) : '')
          +   rawDetails
          + '</div>';
      }

      const banner = '<div class="badge badge-info" style="margin-bottom:0.75rem;">Synthesized business model is multi-node and not tied to a single slide.</div>';

      const synthesized = renderBusinessModelSynthesizedPanel(ss.business_model_summary);
      const promoted = renderStructuredField('Business Model (Promoted / Legacy)', ss.business_model);

      const keys = ['raise', 'revenue', 'growth', 'customers'];
      const otherFields = ''
        + '<div class="muted" style="margin-top: 0.75rem;">Raw report.structured_summary fields (debug view)</div>'
        + keys.map((k) => renderStructuredField(k, ss[k])).join('');

      el.innerHTML = renderDeckArchetypePanel() + renderArchetypeAlignmentPanel() + renderOverrideQualityPanel() + renderDeterministicScoreInputsPanel() + renderUiPreviewV1Panel() + banner + synthesized + promoted + otherFields;

      // Wire the Open Node Inspector helper button (if present).
      try {
        const btn = el.querySelector('button[data-action="open-node-inspector"]');
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const dealId = payload && typeof payload.deal_id === 'string' ? payload.deal_id : (selectedDealId || null);
            if (!dealId) return;
            setNodeInspectorDealId(dealId);
            activateTab('node-inspector');
            loadNodeInspector(dealId);
          });
        }
      } catch {
        // ignore
      }

      // Wire the Open Node Inspector (Overrides Only) helper button (if present).
      try {
        const btn2 = el.querySelector('button[data-action="open-node-inspector-overrides"]');
        if (btn2) {
          btn2.addEventListener('click', (e) => {
            e.preventDefault();
            const dealId = payload && typeof payload.deal_id === 'string' ? payload.deal_id : (selectedDealId || null);
            if (!dealId) return;
            setNodeInspectorDealId(dealId);
            activateTab('node-inspector');

            // Enable overrides-only filter deterministically.
            try {
              const overridesOnly = document.getElementById('node-inspector-overrides-only');
              if (overridesOnly) overridesOnly.checked = true;
              if (typeof nodeInspectorUiState === 'object') nodeInspectorUiState.overridesOnly = true;
            } catch {
              // ignore
            }
            loadNodeInspector(dealId);
          });
        }
      } catch {
        // ignore
      }
    }

    function renderDeterministicLegacyPanel(payload) {
      const el = document.getElementById('deterministic-legacy');
      if (!el) return;
      const legacy = payload && payload.phase1 && payload.phase1.deal_overview_v2 ? payload.phase1.deal_overview_v2 : null;
      if (!legacy) {
        el.innerHTML = '<div class="muted">No Phase 1 deal_overview_v2 present.</div>';
        return;
      }
      el.innerHTML = renderMaybeJson(legacy);
    }

    async function loadDeterministic(dealId) {
      const statusEl = document.getElementById('deterministic-status');
      const headerEl = document.getElementById('deterministic-header');
      const structuredEl = document.getElementById('deterministic-structured');
      const legacyEl = document.getElementById('deterministic-legacy');

      if (!dealId || typeof dealId !== 'string' || dealId.trim().length === 0) {
        if (statusEl) statusEl.textContent = 'Enter a deal id.';
        return;
      }
      const id = dealId.trim();

      if (statusEl) statusEl.textContent = 'Loading…';
      if (headerEl) headerEl.innerHTML = '<div class="loading">Loading…</div>';
      if (structuredEl) structuredEl.innerHTML = '<div class="loading">Loading…</div>';
      if (legacyEl) legacyEl.innerHTML = '<div class="loading">Loading…</div>';

      try {
        const res = await fetch('/api/dashboard/deals/' + encodeURIComponent(id) + '/deterministic?t=' + Date.now());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (statusEl) statusEl.textContent = 'Error: ' + res.status + ' ' + (data?.message || data?.error || '');
          if (headerEl) headerEl.innerHTML = '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
          if (structuredEl) structuredEl.innerHTML = '<div class="muted">Not loaded.</div>';
          if (legacyEl) legacyEl.innerHTML = '<div class="muted">Not loaded.</div>';
          return;
        }

        if (statusEl) {
          const ready = data && data.report && data.report.ready === true;
          statusEl.textContent = 'Loaded. report.ready=' + String(ready);
        }
        renderDeterministicHeaderPanel(data);
        renderDeterministicStructuredPanel(data);
        renderDeterministicLegacyPanel(data);
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || String(e));
        if (headerEl) headerEl.innerHTML = '<div class="muted">Failed to load.</div>';
        if (structuredEl) structuredEl.innerHTML = '<div class="muted">Failed to load.</div>';
        if (legacyEl) legacyEl.innerHTML = '<div class="muted">Failed to load.</div>';
      }
    }

    // Node Inspector: keep last loaded payload in memory so filters are instant.
    let nodeInspectorCache = null;
    let nodeInspectorReportCache = null;
    const nodeInspectorUiState = {
      segment: 'all',
      unsegmentedOnly: false,
      overridesOnly: false,
      search: '',
      expanded: new Set(),
    };

    const nodeInspectorKpiState = {
      revenue: false,
      growth: false,
      customers: false,
    };

    function getStructuredSummaryValueString(field) {
      if (!field) return null;
      if (typeof field.value === 'string') {
        const s = field.value.trim();
        return s.length > 0 ? s : null;
      }
      if (field.value && typeof field.value === 'object') {
        const raw = field.value.raw;
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
      return null;
    }

    function getStructuredSummaryLabel(field) {
      if (!field) return null;
      return typeof field.label === 'string' && field.label.trim() ? field.label.trim() : null;
    }

    function kpiFieldMatches(kpi, fieldName) {
      const f = String(fieldName || '').trim().toLowerCase();
      if (!f) return false;
      // Match exact feeds_fields names per spec.
      if (kpi === 'revenue') return f === 'revenue' || f === 'revenue_v1' || f === 'structured_summary.revenue';
      if (kpi === 'growth') return f === 'growth' || f === 'growth_v1' || f === 'growth_outlook_v1' || f === 'structured_summary.growth';
      if (kpi === 'customers') return f === 'customers' || f === 'customers_v1' || f === 'structured_summary.customers';
      return false;
    }

    function getSourcePageIndexNumber(src) {
      const n = normalizeSourceFields(src);
      const raw = (n.pageIndex != null) ? n.pageIndex : (n.pageRange ? n.pageRange[0] : null);
      const num = raw != null ? Number(raw) : NaN;
      return Number.isFinite(num) ? num : null;
    }

    function getSourceDocumentIdString(src) {
      const n = normalizeSourceFields(src);
      return (typeof n.docId === 'string' && n.docId.trim()) ? n.docId.trim() : (n.docId != null ? String(n.docId) : null);
    }

    function findMatchingNodeForSource(nodes, src) {
      const pageIndex = getSourcePageIndexNumber(src);
      const docId = getSourceDocumentIdString(src);
      if (pageIndex == null || !docId) return null;
      for (const n of (Array.isArray(nodes) ? nodes : [])) {
        const nPage = (n && n.page_index != null) ? Number(n.page_index) : NaN;
        if (!Number.isFinite(nPage)) continue;
        if (nPage !== pageIndex) continue;
        const nDoc = (n && (n.source_document_id || n.document_id)) ? String(n.source_document_id || n.document_id) : '';
        if (nDoc === docId) return n;
      }
      return null;
    }

    function renderNodeInspectorReportNodesDiff() {
      const el = document.getElementById('node-inspector-report-nodes-diff');
      if (!el) return;

      const nodesPayload = nodeInspectorCache;
      const report = nodeInspectorReportCache && typeof nodeInspectorReportCache === 'object' ? nodeInspectorReportCache : null;

      if (!nodesPayload) {
        el.innerHTML = '<div class="muted">Not loaded.</div>';
        return;
      }

      const nodes = nodesPayload && Array.isArray(nodesPayload.nodes) ? nodesPayload.nodes : [];
      const ready = report && report.ready === true;
      const ss = report && report.structured_summary && typeof report.structured_summary === 'object' ? report.structured_summary : null;

      const banner = (!ready)
        ? '<div class="badge badge-warning" style="margin-bottom:0.75rem;">Report not ready: structured_summary is non-canonical; diff is informational only.</div>'
        : '';

      if (!report) {
        el.innerHTML = banner + '<div class="muted">Report payload unavailable (GET /api/v1/deals/:deal_id/report failed).</div>';
        return;
      }

      const kpis = ['revenue', 'growth', 'customers'];

      const summariesBlock = (() => {
        if (!ss) return '';
        const deck = (typeof ss.deck_type === 'string' && ss.deck_type.trim()) ? ss.deck_type.trim() : null;
        const deckLine = deck ? ('<div class="muted" style="margin-bottom:0.5rem;"><span class="mono">deck_type</span>: ' + escapeHtml(deck) + '</div>') : '';
        return ''
          + '<div style="margin-top:0.25rem;">'
          + deckLine
          + renderSummaryV1Panel('Deal Summary (v1)', ss.deal_summary_v1, nodes)
          + renderSummaryV1Panel('Product Summary (v1)', ss.product_summary_v1, nodes)
          + renderSummaryV1Panel('Market Summary (v1)', ss.market_summary_v1, nodes)
          + '</div>';
      })();

      const kpiBlocks = kpis.map((kpi) => {
        const field = ss ? ss[kpi] : null;
        const value = field ? getStructuredSummaryValueString(field) : null;
        const label = field ? getStructuredSummaryLabel(field) : null;
        const sources = field && Array.isArray(field.sources) ? field.sources : [];
        const sourcesCount = sources.length;

        const sourcesRows = sourcesCount > 0
          ? sources.map((src) => {
              const n = normalizeSourceFields(src);
              const docId = getSourceDocumentIdString(src);
              const pageIndex = getSourcePageIndexNumber(src);
              const matched = findMatchingNodeForSource(nodes, src);
              const status = matched ? '✅ matched' : '❌ missing';
              const slideTitle = (typeof n.slideTitle === 'string' && n.slideTitle.trim())
                ? n.slideTitle.trim()
                : (matched && typeof matched.slide_title === 'string' && matched.slide_title.trim() ? matched.slide_title.trim() : '-');
              const note = n.noteSnippet || n.note || '-';
              const evidenceId = n.evidenceId || '-';

              return ''
                + '<tr>'
                +   '<td class="mono">' + escapeHtml(pageIndex != null ? String(pageIndex) : '-') + '</td>'
                +   '<td>' + escapeHtml(slideTitle) + '</td>'
                +   '<td>' + escapeHtml(String(note)) + '</td>'
                +   '<td class="mono">' + escapeHtml(String(evidenceId)) + '</td>'
                +   '<td class="mono">' + escapeHtml(docId || '-') + '</td>'
                +   '<td>' + escapeHtml(status) + '</td>'
                + '</tr>';
            }).join('')
          : '<tr><td colspan="6" class="muted">No sources</td></tr>';

        const sourcePages = new Set(
          sources
            .map((s) => getSourcePageIndexNumber(s))
            .filter((v) => typeof v === 'number' && Number.isFinite(v))
        );

        const feederNodes = getNodesClaimingKpi(nodes, kpi);
        const orphanNodes = feederNodes.filter((n) => {
          const p = n && n.page_index != null ? Number(n.page_index) : NaN;
          if (!Number.isFinite(p)) return true;
          return !sourcePages.has(p);
        });

        const orphanLimit = 25;
        const orphanShown = orphanNodes.slice(0, orphanLimit);
        const orphanMore = Math.max(0, orphanNodes.length - orphanShown.length);

        const orphanList = (orphanShown.length === 0)
          ? '<div class="muted">None</div>'
          : ''
            + '<ul style="margin-left:1.25rem; margin-top:0.5rem;">'
            + orphanShown.map((n) => {
                const page = (n && n.page_index != null) ? String(n.page_index) : '-';
                const title = (n && typeof n.slide_title === 'string' && n.slide_title.trim()) ? n.slide_title.trim() : '-';
                const seg = normalizeNodeSegmentKey(n && n.segment_key) || '-';
                const feeds = n && n.connections && Array.isArray(n.connections.feeds_fields) ? n.connections.feeds_fields : [];
                return '<li>'
                  + '<span class="mono">' + escapeHtml(page) + '</span> — '
                  + escapeHtml(title)
                  + ' <span class="muted">(' + escapeHtml(seg) + ')</span>'
                  + (feeds.length ? (' <span class="muted">feeds=' + escapeHtml(feeds.join(', ')) + '</span>') : '')
                  + '</li>';
              }).join('')
            + '</ul>'
            + (orphanMore > 0 ? ('<div class="muted" style="margin-top:0.35rem;">…and ' + escapeHtml(String(orphanMore)) + ' more</div>') : '');

        return ''
          + '<div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e2e8f0;">'
          +   '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
          +     '<div><strong>' + escapeHtml(kpi) + '</strong></div>'
          +     '<div class="muted">value=<span class="mono">' + escapeHtml(value || '-') + '</span></div>'
          +     '<div class="muted">label=' + escapeHtml(label || '-') + '</div>'
          +     '<div class="muted">sources=' + escapeHtml(String(sourcesCount)) + '</div>'
          +   '</div>'
          +   '<div style="margin-top:0.5rem;">'
          +     '<div style="font-weight:600; margin-bottom:0.25rem;">Sources</div>'
          +     '<table>'
          +       '<thead><tr><th>page_index</th><th>slide_title</th><th>note</th><th>evidence_id</th><th>source_document_id</th><th>match</th></tr></thead>'
          +       '<tbody>' + sourcesRows + '</tbody>'
          +     '</table>'
          +   '</div>'
          +   '<div style="margin-top:0.75rem;">'
          +     '<div style="font-weight:600; margin-bottom:0.25rem;">Orphan feeder nodes</div>'
          +     '<div class="muted">Nodes claiming to feed KPI but their <span class="mono">page_index</span> is not present in any structured_summary sources for this KPI.</div>'
          +     orphanList
          +   '</div>'
          + '</div>';
      }).join('');

      el.innerHTML = ''
        + '<div class="muted" style="margin-bottom:0.5rem;">'
        +   'Match rule: node.page_index === source.page_index AND node.source_document_id === source.source_document_id'
        + '</div>'
        + banner
        + kpiBlocks;
    }

    function getNodesClaimingKpi(nodes, kpi) {
      const out = [];
      for (const n of (Array.isArray(nodes) ? nodes : [])) {
        const feeds = n && n.connections && Array.isArray(n.connections.feeds_fields) ? n.connections.feeds_fields : [];
        const hit = feeds.some((f) => kpiFieldMatches(kpi, f));
        if (hit) out.push(n);
      }
      // Keep stable ordering: doc/page order is already sorted server-side; preserve as-is.
      return out;
    }

    function renderKpiCard(kpi, nodesPayload, reportPayload) {
      const el = document.getElementById('kpi-coverage-' + kpi);
      if (!el) return;

      const nodes = nodesPayload && Array.isArray(nodesPayload.nodes) ? nodesPayload.nodes : [];
      const report = reportPayload && typeof reportPayload === 'object' ? reportPayload : null;
      const ready = report && report.ready === true;
      const ss = report && report.structured_summary && typeof report.structured_summary === 'object' ? report.structured_summary : null;
      const ssField = ss ? ss[kpi] : null;
      const ssValue = ssField ? getStructuredSummaryValueString(ssField) : null;
      const ssLabel = ssField ? getStructuredSummaryLabel(ssField) : null;

      const candidates = getNodesClaimingKpi(nodes, kpi);
      const count = candidates.length;

      const showAll = Boolean(nodeInspectorKpiState[kpi]);
      const limit = 10;
      const shown = showAll ? candidates : candidates.slice(0, limit);
      const moreCount = Math.max(0, candidates.length - shown.length);

      const summaryLine = ''
        + '<div class="muted" style="margin-bottom:0.5rem;">'
        +   '<span class="mono">report.ready=' + escapeHtml(String(ready)) + '</span>'
        + '</div>'
        + '<div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:baseline;">'
        +   '<div><strong>structured_summary</strong>: <span class="mono">' + escapeHtml(ssValue || '-') + '</span></div>'
        +   '<div class="muted">label=' + escapeHtml(ssLabel || '-') + '</div>'
        + '</div>'
        + '<div class="muted" style="margin-top:0.35rem;">Nodes claiming to feed: <span class="mono">' + escapeHtml(String(count)) + '</span></div>';

      const warning = (ready && count > 0 && !ssValue)
        ? '<div class="badge badge-warning" style="margin-top:0.5rem;">Nodes claim to feed KPI but report structured_summary is missing/empty.</div>'
        : '';

      const listHtml = count === 0
        ? '<div class="muted" style="margin-top:0.5rem;">No candidate nodes.</div>'
        : ''
          + '<div style="margin-top:0.5rem;">'
          +   '<div style="font-weight:600; margin-bottom:0.25rem;">Candidate nodes</div>'
          +   '<ul style="margin-left:1.25rem;">'
          +     shown.map((n) => {
                const page = (n && n.page_index != null) ? String(n.page_index) : '-';
                const title = (n && typeof n.slide_title === 'string' && n.slide_title.trim()) ? n.slide_title.trim() : '-';
                const seg = normalizeNodeSegmentKey(n && n.segment_key) || '-';
                return '<li><span class="mono">' + escapeHtml(page) + '</span> — '
                  + escapeHtml(title)
                  + ' <span class="muted">(' + escapeHtml(seg) + ')</span>'
                  + '</li>';
              }).join('')
          +   '</ul>'
          +   (moreCount > 0
                ? ('<button class="btn btn-small btn-secondary" style="margin-top:0.5rem;" data-kpi="' + escapeHtml(kpi) + '" data-kpi-action="toggle">'
                    + (showAll ? 'Show less' : ('Show more (' + moreCount + ')'))
                    + '</button>')
                : '')
          + '</div>';

      el.innerHTML = summaryLine + warning + listHtml;

      // Wire show-more toggle buttons.
      const btn = el.querySelector('button[data-kpi-action="toggle"]');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          nodeInspectorKpiState[kpi] = !nodeInspectorKpiState[kpi];
          renderNodeInspectorKpiCoverage();
        });
      }
    }

    function renderNodeInspectorKpiCoverage() {
      const nodesPayload = nodeInspectorCache;
      const reportPayload = nodeInspectorReportCache;
      const kpiPanel = document.getElementById('node-inspector-kpi');
      if (!kpiPanel) return;

      if (!nodesPayload) {
        const rev = document.getElementById('kpi-coverage-revenue');
        const gr = document.getElementById('kpi-coverage-growth');
        const cu = document.getElementById('kpi-coverage-customers');
        if (rev) rev.innerHTML = '<div class="muted">Not loaded.</div>';
        if (gr) gr.innerHTML = '<div class="muted">Not loaded.</div>';
        if (cu) cu.innerHTML = '<div class="muted">Not loaded.</div>';
        return;
      }

      renderKpiCard('revenue', nodesPayload, reportPayload);
      renderKpiCard('growth', nodesPayload, reportPayload);
      renderKpiCard('customers', nodesPayload, reportPayload);
    }

    function normalizeNodeSegmentKey(v) {
      if (typeof v !== 'string') return null;
      const s = v.trim();
      return s.length > 0 ? s : null;
    }

    function nodeMatchesSearch(node, query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return true;
      const title = (node && typeof node.slide_title === 'string') ? node.slide_title : '';
      const bullets = (node && typeof node.bullets_snippet === 'string') ? node.bullets_snippet : '';
      return (title + ' ' + bullets).toLowerCase().includes(q);
    }

    function getUniqueSegmentKeys(nodes) {
      const set = new Set();
      for (const n of (Array.isArray(nodes) ? nodes : [])) {
        const k = normalizeNodeSegmentKey(n && n.segment_key);
        if (k) set.add(k);
      }
      return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
    }

    function renderNodeInspectorSegmentOptions(nodes) {
      const sel = document.getElementById('node-inspector-segment');
      if (!sel) return;

      const keys = getUniqueSegmentKeys(nodes);
      const opts = ['<option value="all">All</option>']
        .concat(keys.map(k => '<option value="' + escapeHtml(k) + '">' + escapeHtml(k) + '</option>'))
        .join('');
      sel.innerHTML = opts;

      const current = String(nodeInspectorUiState.segment || 'all');
      const allowed = current === 'all' || keys.includes(current);
      sel.value = allowed ? current : 'all';
      nodeInspectorUiState.segment = sel.value;
    }

    function renderNodeInspectorSummary(payload) {
      const el = document.getElementById('node-inspector-summary');
      if (!el) return;
      const meta = payload && payload.metadata ? payload.metadata : {};
      const total = Number(meta.node_count) || 0;
      const segmented = Number(meta.segmented_count) || 0;
      const unseg = Number(meta.unsegmented_count) || 0;
      el.style.display = 'flex';
      el.innerHTML = ''
        + '<span class="pill">total: <strong>' + escapeHtml(String(total)) + '</strong></span>'
        + '<span class="pill">segmented: <strong>' + escapeHtml(String(segmented)) + '</strong></span>'
        + '<span class="pill">unsegmented: <strong>' + escapeHtml(String(unseg)) + '</strong></span>';
    }

    function renderNodeInspectorWarnings(payload) {
      const el = document.getElementById('node-inspector-warnings');
      if (!el) return;
      const warnings = payload && Array.isArray(payload.warnings) ? payload.warnings : [];
      if (warnings.length === 0) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = ''
        + '<details>'
        + '<summary class="muted">Warnings (' + escapeHtml(String(warnings.length)) + ')</summary>'
        + '<ul style="margin-left:1.25rem; margin-top:0.5rem;">'
        + warnings.map(w => '<li>' + escapeHtml(String(w)) + '</li>').join('')
        + '</ul>'
        + '</details>';
    }

    function getNodeInspectorFilteredNodes(payload) {
      const nodes = payload && Array.isArray(payload.nodes) ? payload.nodes : [];
      const seg = String(nodeInspectorUiState.segment || 'all');
      const unsegOnly = Boolean(nodeInspectorUiState.unsegmentedOnly);
      const overridesOnly = Boolean(nodeInspectorUiState.overridesOnly);
      const search = String(nodeInspectorUiState.search || '');

      return nodes.filter(n => {
        const didOverride = Boolean(n && n.segment_trace && n.segment_trace.did_override === true);
        if (overridesOnly && !didOverride) return false;
        const k = normalizeNodeSegmentKey(n && n.segment_key);
        if (unsegOnly) {
          if (k) return false;
        } else if (seg !== 'all') {
          if (k !== seg) return false;
        }
        return nodeMatchesSearch(n, search);
      });

      el.innerHTML = banner + summariesBlock + kpiBlocks.join('');
      return;
    }

    function formatConfidence(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
      return v.toFixed(3);
    }

    function toggleNodeInspectorExpanded(nodeId) {
      if (!nodeId) return;
      if (nodeInspectorUiState.expanded.has(nodeId)) nodeInspectorUiState.expanded.delete(nodeId);
      else nodeInspectorUiState.expanded.add(nodeId);
      renderNodeInspectorFromCache();
    }

    function renderNodeInspectorTable(payload) {
      const container = document.getElementById('node-inspector-table');
      const filterStatus = document.getElementById('node-inspector-filter-status');
      if (!container) return;

      const meta = payload && payload.metadata ? payload.metadata : {};
      const total = Number(meta.node_count) || 0;
      const filtered = getNodeInspectorFilteredNodes(payload);
      if (filterStatus) filterStatus.textContent = total > 0 ? ('Showing ' + filtered.length + ' / ' + total) : '';

      if (total === 0) {
        container.innerHTML = '<div class="muted">Empty state: this deal has 0 nodes (document_page_understanding rows not found).</div>';
        return;
      }

      const rows = filtered.map((n) => {
        const nodeId = (n && typeof n.node_id === 'string') ? n.node_id : '';
        const pageIndex = (n && typeof n.page_index === 'number')
          ? String(n.page_index)
          : (n && n.page_index != null ? String(n.page_index) : '-');
        const title = (n && typeof n.slide_title === 'string') ? n.slide_title : '';
        const seg = normalizeNodeSegmentKey(n && n.segment_key) || '-';
        const trace = (n && n.segment_trace && typeof n.segment_trace === 'object') ? n.segment_trace : null;
        const traceOriginal = trace && typeof trace.original_segment_key === 'string' ? trace.original_segment_key : null;
        const traceFinal = trace && typeof trace.final_segment_key === 'string' ? trace.final_segment_key : null;
        const didOverride = Boolean(trace && trace.did_override === true);
        const traceCellText = didOverride
          ? ((traceOriginal || '-') + ' → ' + (traceFinal || seg || '-'))
          : (traceFinal || seg || 'unknown');
        const reason = n && n.segment_reason && typeof n.segment_reason === 'object' ? n.segment_reason : {};
        const reasonSource = (reason && typeof reason.source === 'string') ? reason.source : '-';
        const conf = formatConfidence(reason && reason.classifier_confidence);
        const feeds = n && n.connections && Array.isArray(n.connections.feeds_fields) ? n.connections.feeds_fields : [];
        const feedsCount = feeds.length;

        const expanded = nodeInspectorUiState.expanded.has(nodeId);
        const bullets = (n && typeof n.bullets_snippet === 'string') ? n.bullets_snippet : '';
        const rulesHit = reason && Array.isArray(reason.rules_hit) ? reason.rules_hit : [];
        const keywordsHit = reason && Array.isArray(reason.keywords_hit) ? reason.keywords_hit : [];
        const evidenceIds = n && n.connections && Array.isArray(n.connections.evidence_ids) ? n.connections.evidence_ids : [];

        const traceTitleRule = trace && typeof trace.title_rule_id === 'string' ? trace.title_rule_id : null;
        const traceOverrideRule = trace && typeof trace.override_rule_id === 'string' ? trace.override_rule_id : null;
        const traceReason = trace && typeof trace.override_reason === 'string' ? trace.override_reason : null;
        const traceConfidence = trace && typeof trace.override_confidence === 'number' ? trace.override_confidence : (reason && typeof reason.classifier_confidence === 'number' ? reason.classifier_confidence : null);

        const detailsHtml = expanded
          ? ''
            + '<tr class="details-row">'
            + '<td colspan="7">'
            +   '<div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-start;">'
            +     '<div style="flex: 1 1 420px;">'
            +       '<div style="font-weight:600; margin-bottom:0.25rem;">Bullets</div>'
            +       '<pre style="margin:0;">' + escapeHtml(bullets || '-') + '</pre>'
            +     '</div>'
            +     '<div style="flex: 1 1 420px;">'
            +       '<div style="font-weight:600; margin-bottom:0.25rem;">Segment Trace</div>'
            +       '<div class="muted">Original: <span class="mono">' + escapeHtml(traceOriginal || '-') + '</span></div>'
            +       '<div class="muted">Final: <span class="mono">' + escapeHtml(traceFinal || seg || '-') + '</span>'
            +         (didOverride ? ' <span class="badge badge-warning" style="margin-left:0.5rem;">OVERRIDE</span>' : '')
            +       '</div>'
            +       '<div class="muted">Title rule: <span class="mono">' + escapeHtml(traceTitleRule || '-') + '</span></div>'
            +       '<div class="muted">Override rule: <span class="mono">' + escapeHtml(traceOverrideRule || '-') + '</span></div>'
            +       '<div class="muted">Reason: ' + escapeHtml(traceReason || '-') + '</div>'
            +       '<div class="muted">Confidence: <span class="mono">' + escapeHtml(traceConfidence == null ? '-' : formatConfidence(traceConfidence)) + '</span></div>'
            +       '<div style="height:0.75rem;"></div>'
            +       '<div style="font-weight:600; margin-bottom:0.25rem;">Segment reason</div>'
            +       '<div class="muted">rules_hit: ' + escapeHtml(rulesHit.length ? rulesHit.join(', ') : '-') + '</div>'
            +       '<div class="muted">keywords_hit: ' + escapeHtml(keywordsHit.length ? keywordsHit.join(', ') : '-') + '</div>'
            +       '<div style="margin-top:0.5rem; display:flex; gap:1rem; flex-wrap:wrap;">'
            +         '<div><div style="font-weight:600; margin-bottom:0.25rem;">feeds_fields</div>'
            +           (feeds.length ? ('<ul style="margin-left:1.25rem;">' + feeds.map(f => '<li class="mono">' + escapeHtml(String(f)) + '</li>').join('') + '</ul>') : '<div class="muted">-</div>')
            +         '</div>'
            +         '<div><div style="font-weight:600; margin-bottom:0.25rem;">evidence_ids</div>'
            +           (evidenceIds.length ? ('<ul style="margin-left:1.25rem;">' + evidenceIds.map(id => '<li class="mono">' + escapeHtml(String(id)) + '</li>').join('') + '</ul>') : '<div class="muted">-</div>')
            +         '</div>'
            +       '</div>'
            +     '</div>'
            +   '</div>'
            + '</td>'
            + '</tr>'
          : '';

        return ''
          + '<tr class="clickable-row" data-node-id="' + escapeHtml(nodeId) + '">' 
          +   '<td class="mono">' + escapeHtml(pageIndex) + '</td>'
          +   '<td>' + escapeHtml(title || '-') + '</td>'
          +   '<td class="mono">' + escapeHtml(seg) + '</td>'
          +   '<td class="mono">' + escapeHtml(traceCellText) + (didOverride ? ' <span class="badge badge-warning" style="margin-left:0.35rem;">OVERRIDE</span>' : '') + '</td>'
          +   '<td class="mono">' + escapeHtml(reasonSource) + '</td>'
          +   '<td class="mono">' + escapeHtml(conf) + '</td>'
          +   '<td class="mono">' + escapeHtml(String(feedsCount)) + '</td>'
          + '</tr>'
          + detailsHtml;
      }).join('');

      container.innerHTML = ''
        + '<table>'
        + '<thead><tr>'
        +   '<th>page_index</th>'
        +   '<th>slide_title</th>'
        +   '<th>segment_key</th>'
        +   '<th>segment trace</th>'
        +   '<th>reason.source</th>'
        +   '<th>reason.confidence</th>'
        +   '<th>feeds_fields_count</th>'
        + '</tr></thead>'
        + '<tbody>'
        + rows
        + '</tbody>'
        + '</table>';

      const trs = container.querySelectorAll('tr.clickable-row[data-node-id]');
      for (const tr of trs) {
        tr.addEventListener('click', (e) => {
          e.preventDefault();
          const id = tr.dataset.nodeId;
          toggleNodeInspectorExpanded(id);
        });
      }
    }

    function renderNodeInspectorFromCache() {
      if (!nodeInspectorCache) {
        const table = document.getElementById('node-inspector-table');
        if (table) table.innerHTML = '<div class="muted">Not loaded.</div>';
        return;
      }
      const payload = nodeInspectorCache;
      const nodes = payload && Array.isArray(payload.nodes) ? payload.nodes : [];
      renderNodeInspectorSegmentOptions(nodes);
      renderNodeInspectorSummary(payload);
      renderNodeInspectorWarnings(payload);
      renderNodeInspectorKpiCoverage();
      renderNodeInspectorReportNodesDiff();
      renderNodeInspectorTable(payload);
    }

    async function loadNodeInspector(dealId) {
      const statusEl = document.getElementById('nodeinspector-status');
      const tableEl = document.getElementById('node-inspector-table');
      const summaryEl = document.getElementById('node-inspector-summary');
      const warnEl = document.getElementById('node-inspector-warnings');

      if (!dealId || typeof dealId !== 'string' || dealId.trim().length === 0) {
        if (statusEl) statusEl.textContent = 'Enter a deal id.';
        return;
      }
      const id = dealId.trim();

      if (statusEl) statusEl.textContent = 'Loading…';
      if (tableEl) tableEl.innerHTML = '<div class="loading">Loading…</div>';
      if (summaryEl) summaryEl.style.display = 'none';
      if (warnEl) warnEl.innerHTML = '';

      // Reset KPI show-more toggles per load.
      nodeInspectorKpiState.revenue = false;
      nodeInspectorKpiState.growth = false;
      nodeInspectorKpiState.customers = false;

      try {
        const [nodesRes, reportRes] = await Promise.all([
          fetch('/api/dashboard/deals/' + encodeURIComponent(id) + '/nodes/inspect?t=' + Date.now()),
          fetch('/api/v1/deals/' + encodeURIComponent(id) + '/report?t=' + Date.now()),
        ]);

        const data = await nodesRes.json().catch(() => ({}));
        let reportData = null;
        if (reportRes && reportRes.ok) {
          reportData = await reportRes.json().catch(() => null);
        }

        if (!nodesRes.ok) {
          nodeInspectorCache = null;
          nodeInspectorReportCache = reportData;
          if (statusEl) statusEl.textContent = 'Error: ' + nodesRes.status + ' ' + (data?.message || data?.error || '');
          if (tableEl) tableEl.innerHTML = '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
          return;
        }

        nodeInspectorCache = data;
        nodeInspectorReportCache = reportData;
        nodeInspectorUiState.expanded = new Set();
        if (statusEl) {
          const ready = reportData && reportData.ready === true;
          statusEl.textContent = 'Loaded. report.ready=' + String(ready);
        }
        renderNodeInspectorFromCache();
      } catch (e) {
        nodeInspectorCache = null;
        nodeInspectorReportCache = null;
        if (statusEl) statusEl.textContent = 'Failed: ' + (e?.message || String(e));
        if (tableEl) tableEl.innerHTML = '<div class="muted">Failed to load.</div>';
      }
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
      setDeterministicDealId(dealId);
      setNodeInspectorDealId(dealId);
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
                <td><span class="badge badge-\${r.recommendation === 'yes' ? 'success' : 'warning'}">\${(r.metadata && r.metadata.decision_v1 && r.metadata.decision_v1.label) ? r.metadata.decision_v1.label : r.recommendation}</span></td>
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

    (function bindDeterministicTab() {
      const btn = document.getElementById('deterministic-load-btn');
      const viewBtn = document.getElementById('deterministic-view-nodeinspector-btn');
      const input = document.getElementById('deterministic-deal-id');

      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const v = input && typeof input.value === 'string' ? input.value : '';
          loadDeterministic(v);
        });
      }

      if (input && !input.dataset.bound) {
        input.dataset.bound = '1';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = typeof input.value === 'string' ? input.value : '';
            loadDeterministic(v);
          }
        });
      }

      if (viewBtn && !viewBtn.dataset.bound) {
        viewBtn.dataset.bound = '1';
        viewBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const v = input && typeof input.value === 'string' ? input.value : '';
          const dealId = String(v || '').trim();
          if (!dealId) return;
          setNodeInspectorDealId(dealId);
          activateTab('node-inspector');
        });
      }
    })();

    (function bindNodeInspectorTab() {
      const btn = document.getElementById('node-inspector-load-btn');
      const input = document.getElementById('nodeinspector-deal-id');
      const sel = document.getElementById('node-inspector-segment');
      const unseg = document.getElementById('node-inspector-unseg-only');
      const overridesOnly = document.getElementById('node-inspector-overrides-only');
      const search = document.getElementById('node-inspector-search');

      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const v = input && typeof input.value === 'string' ? input.value : '';
          loadNodeInspector(v);
        });
      }

      if (input && !input.dataset.bound) {
        input.dataset.bound = '1';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = typeof input.value === 'string' ? input.value : '';
            loadNodeInspector(v);
          }
        });
      }

      if (sel && !sel.dataset.bound) {
        sel.dataset.bound = '1';
        sel.addEventListener('change', () => {
          nodeInspectorUiState.segment = String(sel.value || 'all');
          renderNodeInspectorFromCache();
        });
      }

      if (unseg && !unseg.dataset.bound) {
        unseg.dataset.bound = '1';
        unseg.addEventListener('change', () => {
          nodeInspectorUiState.unsegmentedOnly = Boolean(unseg.checked);
          renderNodeInspectorFromCache();
        });
      }

      if (overridesOnly && !overridesOnly.dataset.bound) {
        overridesOnly.dataset.bound = '1';
        overridesOnly.addEventListener('change', () => {
          nodeInspectorUiState.overridesOnly = Boolean(overridesOnly.checked);
          renderNodeInspectorFromCache();
        });
      }

      if (search && !search.dataset.bound) {
        search.dataset.bound = '1';
        search.addEventListener('input', () => {
          nodeInspectorUiState.search = typeof search.value === 'string' ? search.value : '';
          renderNodeInspectorFromCache();
        });
      }

      if (sel && !sel.dataset.initialized) {
        sel.dataset.initialized = '1';
        sel.innerHTML = '<option value="all">All</option>';
      }
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
        await waitForStep({ stepKey: 'extract_visuals', type: 'extract_visuals_deal', dealId: selectedDealId, jobId: visuals.job_id });

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
           AND type IN ('extract_visuals', 'extract_visuals_deal')
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
   * Dashboard API: Deterministic/canonical deal payload for debugging.
   *
   * GET /api/dashboard/deals/:deal_id/deterministic
   * - Includes the exact /api/v1/deals/:deal_id/report payload
   * - Includes `header_canonical` computed with the same gating rules as the web selector:
   *   - report.ready === true => ONLY read report.structured_summary
   *   - otherwise => ONLY read Phase 1 deal_overview_v2
   */
  app.get("/api/dashboard/deals/:deal_id/deterministic", async (request, reply) => {
    const requestedAt = new Date();
    const { deal_id } = request.params as { deal_id: string };
    if (!isUuid(deal_id)) {
      return reply.status(400).send({ error: "invalid_deal_id", message: "deal_id must be a UUID" });
    }

    // Load latest DIO (for IDs + Phase 1 fallback fields).
    let dioRow: any | null = null;
    try {
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

      if (!rows || rows.length === 0) {
        return reply.status(404).send({ error: "Deal not found" });
      }
      dioRow = rows[0] as any;
    } catch (err) {
      request.log.error({ event: "dashboard.deterministic.dio_query_failed", deal_id, err }, "Failed loading DIO row");
      return reply.status(500).send({ error: "dio_query_failed", message: "Failed to load deal/DIO row" });
    }

    const dioData: any = dioRow?.dio_data ?? null;
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

    const phase1Overview = readPhase1Field("deal_overview_v2");
    const phase1DealOverview: Phase1DealOverview | null =
      phase1Overview && typeof phase1Overview === "object" ? (phase1Overview as Phase1DealOverview) : null;

    // Fetch the canonical report payload via internal inject (ensures it matches /api/v1/.../report exactly).
    let reportPayload: any = null;
    try {
      const authHeader = typeof request.headers?.authorization === "string" ? request.headers.authorization : undefined;
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${encodeURIComponent(deal_id)}/report`,
        headers: authHeader ? { authorization: authHeader } : undefined,
      });

      let parsed: any = null;
      try {
        parsed = res.json();
      } catch {
        parsed = { raw: res.body };
      }

      if (res.statusCode !== 200) {
        request.log.error(
          { event: "dashboard.deterministic.report_fetch_failed", deal_id, status: res.statusCode, body: parsed },
          "Report endpoint returned non-200"
        );
        return reply.status(500).send({
          error: "report_fetch_failed",
          message: `GET /api/v1/deals/:deal_id/report returned ${res.statusCode}`,
          report_status: res.statusCode,
          report_body: parsed,
        });
      }

      reportPayload = parsed;
    } catch (err) {
      request.log.error({ event: "dashboard.deterministic.report_inject_failed", deal_id, err }, "Failed fetching report via inject");
      return reply.status(500).send({
        error: "report_fetch_failed",
        message: "Failed to fetch report payload via internal inject",
      });
    }

    // Contract: ensure deterministic.report.metadata includes deck archetype + diagnostics keys.
    // (Null-safe, no throw if metadata missing.)
    const reportMeta = reportPayload?.metadata && typeof reportPayload.metadata === 'object' ? reportPayload.metadata : null;
    const normalizedReportMetaBase = {
      ...(reportMeta ?? {}),
      deck_archetype: reportMeta && reportMeta.deck_archetype != null ? reportMeta.deck_archetype : null,
      archetype_diagnostics: reportMeta && Array.isArray(reportMeta.archetype_diagnostics) ? reportMeta.archetype_diagnostics : null,
      archetype_segment_drift_v1: reportMeta && reportMeta.archetype_segment_drift_v1 != null ? reportMeta.archetype_segment_drift_v1 : null,
      override_quality: reportMeta && reportMeta.override_quality != null ? reportMeta.override_quality : null,
    };

    // Build a canonical, diagnostics-only UI DTO that mirrors the web app header/overview top section.
    // Best-effort: never fail the endpoint if this builder changes.
    let uiPreviewV1: any = null;
    try {
      const reportForUi = reportPayload && typeof reportPayload === 'object'
        ? { ...reportPayload, metadata: normalizedReportMetaBase }
        : reportPayload;

      uiPreviewV1 = buildUiPreviewV1({
        report: reportForUi,
        segmented_nodes: [],
        env: {
          DETERMINISTIC_SCORE_V1_ENABLED: process.env.DETERMINISTIC_SCORE_V1_ENABLED ?? "",
        },
      });
    } catch (err) {
      request.log.error({ event: "dashboard.deterministic.ui_preview_v1_failed", deal_id, err }, "Failed building ui_preview_v1");
      uiPreviewV1 = null;
    }

    const normalizedReportMeta = {
      ...normalizedReportMetaBase,
      ui_preview_v1: uiPreviewV1,
    };

    const reportNormalized = reportPayload && typeof reportPayload === 'object'
      ? { ...reportPayload, metadata: normalizedReportMeta }
      : reportPayload;

    const structuredSummary = reportNormalized?.structured_summary ?? null;
    const canonical = selectHeaderCanonical(reportNormalized, phase1DealOverview);

    const artifact = reportNormalized?.artifact && typeof reportNormalized.artifact === "object" ? reportNormalized.artifact : null;

    return {
      deal_id,
      requested_at: requestedAt.toISOString(),
      report_ready: reportNormalized?.ready === true,
      ids: {
        dio_id: artifact?.dio_id ?? dioRow?.dio_id ?? null,
        analysis_version: artifact?.analysis_version ?? dioRow?.analysis_version ?? null,
        dio_updated_at: artifact?.updated_at ?? dioRow?.dio_updated_at ?? null,
      },
      report: reportNormalized,
      structured_summary: structuredSummary,
      header_canonical: {
        raise: canonical.raise,
        business_model: canonical.business_model,
        revenue: canonical.revenue,
        customers: canonical.customers,
        growth: canonical.growth,
      },
      // De-risking: include the raw Phase 1 deal_overview_v2 source used for fallback selection.
      phase1: {
        deal_overview_v2: phase1DealOverview,
      },
    };
  });

  /**
   * Dashboard API: Node inspector (DPU + segment hints + evidence connections)
   *
   * GET /api/dashboard/deals/:deal_id/nodes/inspect
   *
   * Best-effort and explicitly diagnostic:
   * - Nodes are derived from `document_page_understanding`.
   * - Segment assignment uses (in order):
   *   1) `visual_assets.quality_flags.segment_key` (when a DPU payload references a visual_asset_id)
   *   2) `payload.structured.segment_key`
   * - Downstream connections are inferred from `evidence_items` rows (when available).
   */
  app.get("/api/dashboard/deals/:deal_id/nodes/inspect", async (request, reply) => {
    const requestedAt = new Date();
    const { deal_id } = request.params as { deal_id: string };
    if (!isUuid(deal_id)) {
      return reply.status(400).send({ error: "invalid_deal_id", message: "deal_id must be a UUID" });
    }

    const warnings: string[] = [];

    type NodeConnection = {
      feeds_fields: string[];
      evidence_ids: string[];
    };

    type NodeInspect = {
      node_id: string;
      document_id: string;
      source_document_id: string;
      page_index: number;
      slide_title: string | null;
      bullets_snippet: string;
      segment_key: string | null;
      structured_segment_key_raw: string | null;
      quality_flags_segment_key_raw: string | null;
      evidence_role: "primary" | "supporting" | "excluded" | null;
      exclusion_reason: string | null;
      segment_reason: {
        rules_hit: string[];
        keywords_hit: string[];
        classifier_confidence: number | null;
        source: "deterministic" | "hybrid" | "unknown";
      };
      segment_trace: {
        original_segment_key: string | null;
        final_segment_key: string | null;
        did_override: boolean;
        title_rule_id: string | null;
        override_rule_id: string | null;
        override_reason: string | null;
        override_confidence: number | null;
      };
      connections: NodeConnection;
    };

    let segmented: Awaited<ReturnType<typeof getSegmentedNodesForDeal>>;
    try {
      segmented = await getSegmentedNodesForDeal(pool as any, deal_id);
      warnings.push(...(segmented.warnings ?? []));
    } catch (err) {
      if (isMissingTableError(err)) {
        warnings.push("document_page_understanding table missing; cannot inspect nodes");
        return {
          deal_id,
          requested_at: requestedAt.toISOString(),
          document_ids: [],
          nodes: [],
          warnings,
          metadata: { node_count: 0, segmented_count: 0, unsegmented_count: 0 },
        };
      }

      request.log.error({ event: "dashboard.nodes_inspect.dpu_query_failed", deal_id, err }, "Failed querying DPU rows");
      return reply.status(500).send({ error: "dpu_query_failed", message: "Failed to query document_page_understanding" });
    }

    const documentIds = Array.from(new Set((segmented.nodes ?? []).map((r) => r.document_id)));

    // Evidence connections: best-effort, optional.
    // We only read evidence items derived from DPU, and map fact types to structured_summary fields.
    const evidenceByDocPage = new Map<string, Array<{ evidence_id: string; fact_type: string | null }>>();
    try {
      const { rows } = await pool.query(
        `
        WITH dpu AS (
          SELECT document_id, page_index
          FROM public.document_page_understanding
          WHERE deal_id = $1::uuid
            AND version = 'page_understanding_v1'
        )
        SELECT
          e.evidence_id::text AS evidence_id,
          e.content_json,
          e.meta
        FROM evidence_items e
        JOIN dpu
          ON (e.meta ? 'document_id')
          AND (e.meta ? 'page_index')
          AND (e.meta->>'document_id')::uuid = dpu.document_id
          AND (e.meta->>'page_index')::int = dpu.page_index
        WHERE e.deal_id = $1::uuid
          AND e.source_type = 'dpu_derived_fact'
        `,
        [deal_id]
      );

      for (const r of rows ?? []) {
        const meta = (r as any).meta && typeof (r as any).meta === "object" ? (r as any).meta : null;
        const docId = asNonEmptyString(meta?.document_id);
        const pageIndex = typeof meta?.page_index === "number" ? meta.page_index : Number(meta?.page_index);
        if (!docId || !Number.isFinite(pageIndex)) continue;
        const key = `${docId}:${pageIndex}`;
        const content = (r as any).content_json && typeof (r as any).content_json === "object" ? (r as any).content_json : null;
        const factType = asNonEmptyString(content?.fact_type);
        const bucket = evidenceByDocPage.get(key) ?? [];
        bucket.push({ evidence_id: String((r as any).evidence_id), fact_type: factType });
        evidenceByDocPage.set(key, bucket);
      }
    } catch (err) {
      if (isMissingTableError(err)) {
        warnings.push("evidence_items table missing; downstream connections unavailable");
      } else {
        warnings.push("Failed to query evidence_items; downstream connections unavailable");
      }
    }

    const factTypeToField = (factType: string | null): string | null => {
      if (!factType) return null;
      switch (factType) {
        case "raise_terms_v1":
          return "structured_summary.raise";
        case "business_model_v1":
          return "structured_summary.business_model";
        case "revenue_v1":
          return "structured_summary.revenue";
        case "customers_v1":
          return "structured_summary.customers";
        case "growth_v1":
          return "structured_summary.growth";
        default:
          return null;
      }
    };

    let segmentedCount = 0;
    const nodes: NodeInspect[] = (segmented.nodes ?? []).map((r) => {
      if (r.segment_key) segmentedCount += 1;

      const key = `${r.document_id}:${r.page_index}`;
      const ev = evidenceByDocPage.get(key) ?? [];
      const evidenceIds = Array.from(new Set(ev.map((e) => e.evidence_id)));
      const feedsFields = Array.from(
        new Set(
          ev
            .map((e) => factTypeToField(e.fact_type))
            .filter((v): v is string => typeof v === "string" && v.length > 0)
        )
      );


    // Business model evidence roles are diagnostic only. Compute deterministically.
    const assessment = (() => {
      try {
        const bullets = Array.isArray((r as any).bullets) ? (r as any).bullets : [];
        const slideText = [r.slide_title, ...bullets].filter(Boolean).join("\n");
        return classifyBusinessModelEvidenceFromDpuSlide({
          slideText,
          slideTitle: r.slide_title,
          segment_key: r.structured_segment_key_raw ?? null,
          bullets,
        });
      } catch {
        return null;
      }
    })();
    const evidence_role: NodeInspect["evidence_role"] = assessment?.role ?? null;
    const exclusion_reason: string | null = assessment?.exclusion_reason ?? null;

      const rulesHit = Array.isArray((r as any)?.segment_reason?.rules_hit) ? ((r as any).segment_reason.rules_hit as any[]) : [];
      const title_rule_id = (rulesHit.find((x) => typeof x === "string" && x.startsWith("segmenter:title:")) as string | undefined) ?? null;
      const override_rule_id = (rulesHit.find((x) => typeof x === "string" && x.startsWith("segmenter:override:")) as string | undefined) ?? null;

      const final_segment_key = r.segment_key ?? null;

      const titleOnlySegment = (() => {
        try {
          const res = segmentDpuPage({ title: r.slide_title, bullets: [] });
          return res && res.segment_key && res.segment_key !== "unknown" ? res.segment_key : null;
        } catch {
          return null;
        }
      })();

      const inferredFromTitleRule = title_rule_id ? inferSegmentFromTitleRuleId(title_rule_id) : null;
      const inferredFromTitleRuleClean = inferredFromTitleRule && inferredFromTitleRule !== "unknown" ? inferredFromTitleRule : null;

      const fallbackRaw =
        normalizeAnalystSegment(r.structured_segment_key_raw) ??
        normalizeAnalystSegment(r.quality_flags_segment_key_raw) ??
        null;

      const original_segment_key = titleOnlySegment ?? inferredFromTitleRuleClean ?? fallbackRaw ?? null;
      const did_override = Boolean(override_rule_id) && original_segment_key !== final_segment_key;

      const override_reason = (() => {
        if (!did_override || !override_rule_id) return null;
        const id = String(override_rule_id).startsWith("segmenter:override:") ? String(override_rule_id).slice("segmenter:override:".length) : String(override_rule_id);
        if (id === "gtm.intent.customers_distribution") return "bullets matched wholesale/distribution footprint";
        if (id === "traction.intent.kpi_signals") return "bullets matched KPI/traction signals";
        if (id === "gtm.intent.licensing") return "bullets matched GTM/channel language";
        return "segment override applied";
      })();

      const override_confidence = did_override ? (typeof (r as any)?.segment_reason?.classifier_confidence === "number" ? (r as any).segment_reason.classifier_confidence : null) : null;

      return {
        node_id: r.node_id,
        document_id: r.document_id,
        source_document_id: r.document_id,
        page_index: r.page_index,
        slide_title: r.slide_title,
        bullets_snippet: String(r.bullets_snippet ?? ""),
        segment_key: r.segment_key,
		structured_segment_key_raw: r.structured_segment_key_raw ?? null,
		quality_flags_segment_key_raw: r.quality_flags_segment_key_raw ?? null,
		evidence_role,
		exclusion_reason,
        segment_reason: r.segment_reason,
        segment_trace: {
          original_segment_key,
          final_segment_key,
          did_override,
          title_rule_id,
          override_rule_id,
          override_reason,
          override_confidence,
        },
        connections: {
          feeds_fields: feedsFields,
          evidence_ids: evidenceIds,
        },
      };
    });

    const unsegmentedCount = nodes.length - segmentedCount;

    if (unsegmentedCount > 0) {
      warnings.push(`${unsegmentedCount} nodes have no segment assignment (segment_key is null)`);
    }

    return {
      deal_id,
      requested_at: requestedAt.toISOString(),
      document_ids: documentIds,
      nodes,
      warnings,
      metadata: {
        node_count: nodes.length,
        segmented_count: segmentedCount,
        unsegmented_count: unsegmentedCount,
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

    // Dashboard consistency:
    // Recompute score_explanation for the RESPONSE when it's missing or stale.
    // Stale = weights missing OR metric_benchmark effective weight is not zero.
    // Do NOT write back to DB from this endpoint.
    let responseDioData = dio_data;
    if (dio_data) {
      const expl = dio_data?.score_explanation;
      const weights = expl?.aggregation?.weights;
      const metricWeight = typeof weights?.metric_benchmark === "number" ? weights.metric_benchmark : null;
      const isStale = !weights || metricWeight !== 0;

      if (!expl || isStale) {
        try {
          const recomputed = buildScoreExplanationFromDIO(dio_data);
          responseDioData = { ...dio_data, score_explanation: recomputed };
        } catch {
          // Best-effort: don't fail dashboard if explainability can't be computed
        }
      }
    }

    return { ...row, dio_data: responseDioData };
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

    const payload: any = {
      input_dio: fullDIO,
      computation_steps: computationSteps,
      output_report: report,
    };

    const resolveImageUrisInPlace = async (root: unknown): Promise<void> => {
      type Ref = { obj: Record<string, any>; key: string; value: string };
      const refs: Ref[] = [];
      const stack: unknown[] = [root];

      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;

        if (Array.isArray(cur)) {
          for (const item of cur) stack.push(item);
          continue;
        }

        const obj = cur as Record<string, any>;
        for (const [k, v] of Object.entries(obj)) {
          if (k === "image_uri" && typeof v === "string" && v.trim().length > 0) {
            refs.push({ obj, key: k, value: v });
            continue;
          }
          if (v && typeof v === "object") stack.push(v);
        }
      }

      await Promise.all(
        refs.map(async (r) => {
          r.obj[r.key] = await resolveVisualAssetImageUriForApi(r.value);
        })
      );
    };

    await resolveImageUrisInPlace(payload);
    return payload;
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
