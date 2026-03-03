import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  DealChatActionV1,
  DealChatResponseV1,
  DealChatSourceV1,
  WorkspaceChatResponse,
} from "@dealdecision/contracts";
import { buildOrchestratorReportV1, classifyQuestionIntent, buildPromptPolicyBlock, enforceAnswerSanity } from "@dealdecision/core";
import type { OrchestratorReportV1, QuestionIntent, AnswerBasis, FinancialSegment, FinancialFactV1, FinancialCoverageV1, PageRegistryRowV1, DealFactV1 } from "@dealdecision/core";
import { getPool } from "../lib/db";
import { getFinancialFactsForChat, getFinancialCoverageForChat } from "./financial-facts";
import { getPageContextForChat } from "./pages";
import { getDealFactsForChat } from "./deal-facts";

// ============================================================================
// OpenAI helper (same pattern as node-ai-analyze.ts)
// ============================================================================

type OpenAIChatCompletionResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

async function openaiChatCompletion(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
}): Promise<{ content: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
  };
  if (params.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `OpenAI request failed with ${res.status}`);
  }

  const json = (await res.json()) as OpenAIChatCompletionResponse;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenAI returned empty content");
  }
  return { content, model: json.model };
}

// ============================================================================
// Context builder
// ============================================================================

interface EvidenceItem {
  evidence_id: string;
  snippet: string;
  page_index?: number;
}

interface DealChatContext {
  dioVersionId: string | null;
  hasDio: boolean;
  orchestratorReport: OrchestratorReportV1 | null;
  /** Evidence items resolved for citation, from registry or DB */
  evidenceItems: EvidenceItem[];
  dealName: string | null;
}

async function buildDealChatContextV1(
  pool: ReturnType<typeof getPool>,
  dealId: string,
  preferredDioVersionId?: string | null
): Promise<DealChatContext> {
  let dioVersionId: string | null = preferredDioVersionId ?? null;
  let hasDio = false;
  let orchestratorReport: OrchestratorReportV1 | null = null;
  let evidenceItems: EvidenceItem[] = [];
  let dealName: string | null = null;

  // 1. Deal name
  try {
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM deals WHERE id = $1 LIMIT 1",
      [dealId]
    );
    dealName = rows[0]?.name ?? null;
  } catch {
    // non-fatal
  }

  // 2. Latest DIO version
  try {
    const dioTableExists = await hasTable(pool, "public.dio_versions");
    if (dioTableExists) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM dio_versions WHERE deal_id = $1 ORDER BY version DESC NULLS LAST LIMIT 1`,
        [dealId]
      );
      if (rows[0]?.id) {
        dioVersionId = dioVersionId ?? rows[0].id;
        hasDio = true;
      }
    }
  } catch {
    // non-fatal
  }

  // 3. Build OrchestratorReportV1 from investor_insight_reports.render_package
  try {
    const { rows } = await pool.query<{ render_package: unknown }>(
      `SELECT render_package
         FROM investor_insight_reports
         WHERE deal_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
      [dealId]
    );
    const rp = rows[0]?.render_package;
    if (rp && typeof rp === "object") {
      try {
        orchestratorReport = buildOrchestratorReportV1({ dealId, renderPackage: rp as any });
      } catch {
        // render_package present but malformed — non-fatal
      }
    }
  } catch {
    // non-fatal
  }

  // 4. Resolve evidence items for citation
  //    Primary: evidence_registry from orchestrator report (already has snippets)
  //    Fallback: DB evidence table
  if (orchestratorReport?.evidence_registry?.items?.length) {
    evidenceItems = orchestratorReport.evidence_registry.items
      .filter((item) => item.snippet && item.snippet.trim().length > 0)
      .slice(0, 8)
      .map((item) => ({
        evidence_id: item.evidence_id,
        snippet: item.snippet,
        page_index: item.page_index,
      }));
  } else {
    // Fallback: raw evidence table (query text column, aliased to excerpt for compatibility)
    try {
      const evidenceExists = await hasTable(pool, "public.evidence");
      if (evidenceExists) {
        const { rows } = await pool.query<{
          evidence_id: string;
          excerpt: string | null;
        }>(
          `SELECT evidence_id, text AS excerpt
             FROM evidence
             WHERE deal_id = $1
               AND text IS NOT NULL AND text <> ''
             ORDER BY created_at DESC
             LIMIT 8`,
          [dealId]
        );
        evidenceItems = rows
          .filter((r) => r.excerpt)
          .map((r) => ({ evidence_id: r.evidence_id, snippet: formatEvidenceForPrompt(r.excerpt!) }));
      }
    } catch {
      // non-fatal
    }
  }

  return { dioVersionId, hasDio, orchestratorReport, evidenceItems, dealName };
}

// ============================================================================
// System prompt — orchestrator-first, governed
// ============================================================================

function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

// ============================================================================
// XLSX evidence formatter
// ============================================================================

/**
 * Formats a raw evidence text for the LLM prompt.
 *
 * Handles two XLSX canonical-metric patterns produced by insertEvidence():
 *   1. "metric_key: value \u2022 sheet=X row_idx=Y col=Z value_raw=W"  (canonical_metric kind)
 *   2. "sheet=X row_idx=Y col=Z value_raw=W"                          (raw source pointer)
 *
 * Falls back to the original text for non-XLSX formats.
 * Always caps at 280 chars.
 */
/* @internal — exported only for testing */
export function formatEvidenceForPrompt(text: string): string {
  const MAX = 280;

  // Pattern 1: canonical_metric  — "metric_key: value \u2022 sheet=... row_idx=... col=... value_raw=..."
  const canonicalRe = /^([^:\u2022]+):\s*([^\u2022]+)\s*\u2022\s*(.+)$/;
  const canonicalMatch = text.match(canonicalRe);
  if (canonicalMatch) {
    const metricKey = canonicalMatch[1].trim().replace(/_/g, " ");
    const value = canonicalMatch[2].trim();
    const pointer = canonicalMatch[3].trim();
    // Try to extract sheet name and col from pointer
    const sheetMatch = pointer.match(/sheet=(\S+)/);
    const colMatch = pointer.match(/col=(\S+)/);
    const parts = [metricKey, "=", value];
    if (sheetMatch) parts.push(`(sheet \"${sheetMatch[1]}\"​${colMatch ? `, col "${colMatch[1]}"` : ""})`);
    return cap(parts.join(" "), MAX);
  }

  // Pattern 2: raw source pointer — "sheet=X row_idx=Y col=Z value_raw=W"
  const pointerRe = /sheet=(\S+)\s+row_idx=(\d+)\s+col=(\S+)\s+value_raw=(\S+)/;
  const pointerMatch = text.match(pointerRe);
  if (pointerMatch) {
    const [, sheet, rowIdx, col, valueRaw] = pointerMatch;
    return cap(`${valueRaw} (sheet "${sheet}", row ${rowIdx}, col "${col}")`, MAX);
  }

  // Default: return as-is, capped
  return cap(text, MAX);
}

// ============================================================================
// Financial Intelligence block builder
// ============================================================================

/**
 * Produces a compact, deterministic FINANCIAL INTELLIGENCE block from
 * OrchestratorReportV1.segments.financial.
 * Capped at ~1200 chars. Omits fields that are empty/default.
 */
function buildFinancialIntelligenceBlock(fin: FinancialSegment): string {
  const lines: string[] = [`FINANCIAL INTELLIGENCE (from XLSX/PDF tables):` ];

  // Layout flags
  const lc = fin.layout_classification;
  const flags: string[] = [];
  if (lc.has_income_statement) flags.push("IS=yes");
  if (lc.has_balance_sheet)    flags.push("BS=yes");
  if (lc.has_cash_flow)        flags.push("CF=yes");
  if (lc.has_saas_kpis)        flags.push("SaaS_KPIs=yes");
  if (lc.has_cap_table)        flags.push("CapTable=yes");
  if (lc.has_use_of_funds)     flags.push("UoF=yes");
  if (flags.length > 0) {
    lines.push(`- Statements present: ${flags.join(", ")}`);
  }

  // Key benchmarks (prefer financial KPIs, max 5)
  const KEY_TOKENS = new Set(["burn", "runway", "gross", "revenue", "ebitda", "arr", "mrr", "cash", "margin", "net"]);
  const preferred = fin.benchmarks.filter((b) =>
    KEY_TOKENS.has(b.label.toLowerCase().split(/[\s_]/)[0])
  ).slice(0, 5);
  const benchmarksToShow = preferred.length > 0 ? preferred : fin.benchmarks.slice(0, 5);
  if (benchmarksToShow.length > 0) {
    const signals = benchmarksToShow.map((b) => `${b.label}=${b.value}`).join(", ");
    lines.push(`- Key signals: ${cap(signals, 300)}`);
  }

  // Reconciliation summary
  const rec = fin.reconciliation;
  const confLabel =
    rec.confidence_score >= 0.75 ? "high" :
    rec.confidence_score >= 0.50 ? "medium" : "low";
  const failCount = rec.flags.filter((f) => f.status === "FAIL").length;
  lines.push(`- Reconciliation: confidence=${confLabel} (${Math.round(rec.confidence_score * 100)}%); fail_flags=${failCount}`);

  // Top 3 strengths
  fin.strengths.slice(0, 3).forEach((s) => lines.push(`- Strength: ${cap(s, 180)}`));

  // Top 3 concerns
  fin.considerations.slice(0, 3).forEach((c) => lines.push(`- Concern: ${cap(c, 180)}`));

  return cap(lines.join("\n"), 1200);
}

/**
 * Build a compact FINANCIAL FACTS block from the registry.
 * Capped at ~1500 chars. Returns empty string when facts array is empty.
 *
 * @internal — exported for testing
 */
export function buildFactsBlock(facts: FinancialFactV1[]): string {
  if (facts.length === 0) return "";
  const lines: string[] = ["FINANCIAL FACTS (registry):"];
  for (const f of facts) {
    const unitSuffix = f.unit === "percent" ? "%" : f.unit === "currency" ? (f.currency ? ` ${f.currency}` : "") : "";
    const valueStr = f.unit === "percent"
      ? `${f.value.toFixed(1)}%`
      : f.unit === "currency"
        ? `$${f.value >= 1_000_000 ? (f.value / 1_000_000).toFixed(2) + "M" : f.value >= 1_000 ? (f.value / 1_000).toFixed(1) + "K" : f.value.toFixed(0)}`
        : String(f.value);
    const label = f.metric_label ?? f.metric_key;
    const periodStr = f.period_label !== "current" ? ` ${f.period_label}` : "";
    const evidenceTag = f.evidence_id ? ` [evidence_id=${f.evidence_id}]` : "";
    const confStr = f.confidence === "high" ? "" : ` (${f.confidence} conf)`;
    lines.push(`- ${label}${periodStr}: ${valueStr}${unitSuffix}${evidenceTag}${confStr}`);
  }
  const raw = lines.join("\n");
  return raw.length > 1500 ? raw.slice(0, 1497) + "..." : raw;
}

// ======================================================================
// Financial Coverage blocks (registry-based)
// ======================================================================

/**
 * Build a FINANCIAL COVERAGE summary block from the registry-based profile.
 * Shows which statements + periods are present. Caps at ~800 chars.
 */
export function buildCoverageSummaryBlock(coverage: FinancialCoverageV1): string {
  if (!coverage || coverage.total_facts === 0) return "";
  const lines: string[] = ["--- FINANCIAL COVERAGE ---"];

  const stmts: string[] = [];
  if (coverage.statements.income_statement) stmts.push("Income Statement");
  if (coverage.statements.balance_sheet)    stmts.push("Balance Sheet");
  if (coverage.statements.cash_flow)        stmts.push("Cash Flow");
  if (coverage.statements.forecast)         stmts.push("Forecast");
  if (stmts.length > 0) lines.push(`Statements present: ${stmts.join(", ")}`);

  if (coverage.periods.yearly.length > 0)
    lines.push(`Annual periods: ${coverage.periods.yearly.join(", ")}`);
  if (coverage.periods.quarterly.length > 0)
    lines.push(`Quarterly: ${coverage.periods.quarterly.slice(0, 6).join(", ")}`);
  if (coverage.periods.monthly.length > 0)
    lines.push(`Monthly: ${coverage.periods.monthly.slice(0, 4).join(", ")}`);
  if (coverage.periods.ttm.length > 0)
    lines.push(`TTM/LTM: ${coverage.periods.ttm.join(", ")}`);

  const { high, medium, low } = coverage.confidence_distribution;
  lines.push(`Fact confidence: ${high} high / ${medium} medium / ${low} low (${coverage.total_facts} total)`);

  lines.push("--- END FINANCIAL COVERAGE ---");
  const raw = lines.join("\n");
  return raw.length > 800 ? raw.slice(0, 797) + "..." : raw;
}

/**
 * Build a CONFLICT WARNING block when the same metric has conflicting values.
 * Instructs the model to disclose the conflict rather than picking one value.
 */
export function buildConflictWarningBlock(coverage: FinancialCoverageV1): string {
  if (!coverage || coverage.conflicts.length === 0) return "";
  const lines: string[] = ["⚠ CONFLICTING FINANCIAL VALUES:"];
  for (const c of coverage.conflicts.slice(0, 5)) {
    const timeStr = c.timeframe ? ` (${c.timeframe})` : "";
    const valsStr = c.values.map((v) => `$${(v / 1_000).toFixed(0)}K`).join(" vs ");
    lines.push(`  - ${c.metric}${timeStr}: ${valsStr} — Do NOT pick one value; state that conflicting figures appear in the materials.`);
  }
  return lines.join("\n");
}

/**
 * Build a NOTE about expected-but-missing metrics.
 * Instructs the model to honestly state when data is absent.
 */
export function buildMissingMetricsNote(coverage: FinancialCoverageV1): string {
  if (!coverage || coverage.metrics_missing.length === 0) return "";
  const list = coverage.metrics_missing.slice(0, 6).join(", ");
  return `NOTE: The following financial metrics are not present in the uploaded materials: ${list}. If asked about these, state clearly that the materials do not include this data.`;
}

// ======================================================================
// Page Registry — intent → page_type mapping + context block
// ======================================================================

/**
 * Maps QuestionIntent to the most relevant page_type in page_registry_v1.
 * undefined = no page registry lookup for this intent.
 */
const INTENT_TO_PAGE_TYPE: Partial<Record<QuestionIntent, string>> = {
  terms:    "ask",       // deal terms / raise amount → ask pages
  product:  "product",
  ai:       "product",  // AI intent → product pages
  traction: "traction",
  team:     "team",
  risk:     "risks",
  // financial — handled by the financial facts block; page registry not used
  // general   — no specific page type; fall through to orchestrator data
};

const PAGE_CONTEXT_CHAR_CAP = 1200;

/**
 * Build a PAGE CONTEXT block from page registry rows.
 * Cap: 4 pages max, total ~1200 chars.
 * Each page: page_type, page_number, up to 2 key_claims, 1 numeric_claim if present.
 */
function buildPageContextBlock(rows: PageRegistryRowV1[]): string {
  if (rows.length === 0) return "";

  const capped = rows.slice(0, 4);
  const lines: string[] = ["--- PAGE CONTEXT (cite page_number in your answer) ---"];

  let totalChars = 0;
  for (const row of capped) {
    if (totalChars >= PAGE_CONTEXT_CHAR_CAP) break;

    const header = `[${row.page_type.toUpperCase()} — p.${row.page_number}]`;
    const claims = row.key_claims
      .slice(0, 2)
      .map((c) => `  • ${cap(c.text, 200)}`);
    const numericLine =
      row.numeric_claims.length > 0
        ? `  ≡ ${cap(row.numeric_claims[0].raw, 80)}: ${row.numeric_claims[0].value} ${row.numeric_claims[0].unit}${row.numeric_claims[0].currency ? ` (${row.numeric_claims[0].currency})` : ""}`
        : null;

    const pageBlock = [header, ...claims, ...(numericLine ? [numericLine] : [])].join("\n");
    totalChars += pageBlock.length;
    if (totalChars > PAGE_CONTEXT_CHAR_CAP) break;
    lines.push(pageBlock);
  }

  lines.push("--- END PAGE CONTEXT ---");
  return lines.join("\n");
}

const DEAL_FACTS_CHAR_CAP = 1400;

/**
 * Render a compact deal-facts context block for the system prompt.
 * Only included for non-financial intents where deal facts were fetched.
 */
function buildDealFactsBlock(facts: DealFactV1[]): string {
  if (facts.length === 0) return "";
  const lines: string[] = ["--- DEAL FACTS (registry, evidence-backed) ---"];
  let charCount = 0;
  for (const f of facts) {
    const valueStr = (() => {
      const v = f.value;
      switch (v.kind) {
        case "money":   return `${v.currency ?? ""}${v.value}`;
        case "number":  return `${v.value}${v.unit ? ` ${v.unit}` : ""}`;
        case "range":   return `${v.min ?? "?"}\u2013${v.max ?? "?"}${v.unit ? ` ${v.unit}` : ""}`;
        case "string":  return v.value;
        case "list":    return v.items.slice(0, 5).join("; ");
        case "entity":  return `${v.value}${v.kind2 ? ` (${v.kind2})` : ""}`;
        case "unknown": return "(unconfirmed)";
      }
    })();
    const timeStr = f.timeframe ? ` [${f.timeframe}]` : "";
    const conflictNote = (f.conflicts_with_fact_ids?.length ?? 0) > 0
      ? " ⚠ conflicting values in materials"
      : "";
    const confStr = f.confidence !== "high" ? ` [${f.confidence}]` : "";
    const line = `${f.label}: ${valueStr}${timeStr}${confStr}${conflictNote}`;
    charCount += line.length + 1;
    if (charCount > DEAL_FACTS_CHAR_CAP) break;
    lines.push(line);
  }
  lines.push("--- END DEAL FACTS ---");
  return lines.join("\n");
}

function buildSystemPrompt(
  ctx: DealChatContext,
  intent: QuestionIntent,
  opts: { forceFinancialBlock?: boolean; facts?: FinancialFactV1[]; coverage?: FinancialCoverageV1 | null; pageRows?: PageRegistryRowV1[]; dealFacts?: DealFactV1[] } = {}
): string {
  const companyLabel = ctx.dealName ? `**${ctx.dealName}**` : "this deal";
  const r = ctx.orchestratorReport;
  const pp = r?.segments.product_profile_v1 ?? null;

  const lines: string[] = [];

  // ── 0. Answer Policy Block (intent-aware hard rules, injected first) ──────
  lines.push(buildPromptPolicyBlock(intent, pp, r ?? undefined));

  lines.push(
    `You are Deal Assistant, an AI investment analyst embedded in the DealDecision platform.`,
    `You help investors and analysts evaluate ${companyLabel} based on grounded analysis data.`,
    ``,
    `GOVERNANCE RULES:`,
    `- You may ONLY state a numeric score, metric, or fact if it appears explicitly in the ORCHESTRATOR DATA below.`,
    `- If asked for something not in the data, say you cannot confirm it and suggest running a fresh analysis.`,
    `- Respond conversationally in 1–3 short paragraphs. No bullet lists unless the user asks.`,
    `- Respond ONLY in this exact JSON format (no extra keys):`,
    `  {"message":"<your reply>","confidence":"high"|"medium"|"low","cited_evidence_ids":["<id>",...],"suggested_action_types":["<type>",...],"answer_basis":"<basis>","unknowns_used":["<field>",...]}`
    ,
    `  - confidence: "high" = strong evidence present; "medium" = partial; "low" = data absent or no report.`,
    `  - cited_evidence_ids: up to 6 evidence IDs from EVIDENCE below that support your answer. Empty array if none.`,
    `  - suggested_action_types: 0–3 items from: RUN_ANALYZE, REGENERATE_INSIGHTS, OPEN_FULL_REPORT, SHOW_SOURCES, EXPORT_PDF`,
    `  - answer_basis: one of "product_profile_v1"|"orchestrator_report"|"evidence_only"|"insufficient_data" — which data source primarily grounded your answer.`,
    `  - unknowns_used: up to 3 field names you acknowledged as unknown (e.g. "ai_usage_summary", "target_customer"). Empty array if none.`,
    ``
  );

  if (!r) {
    lines.push(
      `--- ANALYSIS DATA ---`,
      `No analysis report is available yet for this deal.`,
      `Instruct the user to run analysis to generate grounded context.`,
      `--- END ---`
    );
  } else {
    lines.push(`--- ORCHESTRATOR DATA (authoritative, use this first) ---`);

    // Decision
    const dec = r.decision;
    lines.push(
      `DECISION: ${dec.label} — Confidence: ${dec.confidence_band}`,
      `OVERALL SCORE: ${r.scores.overall_recommendation_score}/100 | RISK SCORE: ${r.scores.risk_severity_score}/100 (higher = worse)`
    );

    const mktScore = r.scores.market_score.raw;
    const fhScore = r.scores.financial_health_score;
    lines.push(
      `MARKET SCORE: ${mktScore}/100 | FINANCIAL HEALTH: ${fhScore.status === "insufficient_data" ? "insufficient data" : `${fhScore.score}/100`}`
    );

    // Stage context
    const sc = r.stage_context;
    const stageTokens: string[] = [`STAGE: ${sc.stage}`];
    if (sc.raise_amount) stageTokens.push(`RAISE: ${sc.raise_amount}`);
    if (sc.valuation_pre) stageTokens.push(`PRE-MONEY: ${sc.valuation_pre}`);
    if (sc.missing_critical_terms.length > 0) {
      stageTokens.push(`MISSING TERMS: ${sc.missing_critical_terms.join(", ")}`);
    }
    lines.push(stageTokens.join(" | "));

    // Document confidence
    lines.push(`DOCUMENT CONFIDENCE: ${r.document_confidence.band} (score: ${r.document_confidence.score}%)`);

    // ── Product profile — authoritative structured product data ──
    // Placed BEFORE narrative sections so model weights structured fields highest.
    if (pp && (pp.company_description || pp.product_type !== "Unknown")) {
      lines.push(``, `PRODUCT PROFILE:`);
      lines.push(
        `Type: ${pp.product_type} | Delivery: ${pp.delivery_model} | Maturity: ${pp.product_maturity}`
      );
      if (pp.company_description) lines.push(`What they do: ${cap(pp.company_description, 200)}`);
      if (pp.problem_statement) lines.push(`Problem: ${cap(pp.problem_statement, 200)}`);
      if (pp.solution_summary) lines.push(`Solution: ${cap(pp.solution_summary, 200)}`);
      if (pp.target_customer) lines.push(`Target: ${cap(pp.target_customer, 150)}`);
      if (pp.ai_claims_present && pp.ai_usage_summary) {
        lines.push(
          `AI: ${pp.ai_usage_type} — ${cap(pp.ai_usage_summary, 200)} [Evidence strength: ${pp.ai_evidence_strength}]`
        );
        if (pp.ai_evidence_strength === "marketing_only" || pp.ai_evidence_strength === "weak") {
          lines.push(
            `  NOTE: AI evidence is ${pp.ai_evidence_strength}. Do not assert AI capabilities as proven; suggest OPEN_FULL_REPORT or REGENERATE_INSIGHTS.`
          );
        }
      } else {
        lines.push(`AI: None claimed in documentation.`);
      }
      if (pp.core_features.length > 0)
        lines.push(`Features: ${pp.core_features.slice(0, 5).join("; ")}`);
      if (pp.differentiation_claims.length > 0)
        lines.push(`Differentiation: ${pp.differentiation_claims.slice(0, 3).join("; ")}`);
    }

    // Decision rationale (green flags)
    if (dec.rationale_bullets.length > 0) {
      lines.push(``, `DECISION RATIONALE:`);
      dec.rationale_bullets.slice(0, 5).forEach((b) => lines.push(`- ${cap(b, 200)}`));
    }

    // Executive summary strengths + risks
    const es = r.segments.executive_summary;
    if (es.strengths.length > 0) {
      lines.push(``, `STRENGTHS:`);
      es.strengths.slice(0, 4).forEach((s) => lines.push(`- ${cap(s, 200)}`));
    }
    if (es.risks.length > 0) {
      lines.push(``, `RISKS:`);
      es.risks.slice(0, 4).forEach((s) => lines.push(`- ${cap(s, 200)}`));
    }

    // P0/P1 verification requests
    const reqs = r.segments.risk_verification.verification_requests;
    const p0 = reqs.filter((x) => x.priority === "P0");
    const p1 = reqs.filter((x) => x.priority === "P1").slice(0, 4);
    if (p0.length > 0 || p1.length > 0) {
      lines.push(``, `VERIFICATION REQUESTS:`);
      for (const req of p0) {
        const evIds = req.evidence_refs.slice(0, 3).join(", ");
        lines.push(`[P0 — MUST RESOLVE${evIds ? ` | refs: ${evIds}` : ""}] ${cap(req.request, 180)} — Why: ${cap(req.why, 150)}`);
      }
      for (const req of p1) {
        const evIds = req.evidence_refs.slice(0, 2).join(", ");
        lines.push(`[P1 — IMPORTANT${evIds ? ` | refs: ${evIds}` : ""}] ${cap(req.request, 180)}`);
      }
    }

    // ── Financial Intelligence block (intent-gated) ──────────────────────────
    // Injected when intent is financial OR message contains explicit currency/numbers.
    const showFinancialBlock = intent === "financial" || (opts.forceFinancialBlock === true);
    if (showFinancialBlock && r?.segments.financial) {
      lines.push(``, buildFinancialIntelligenceBlock(r.segments.financial));
    }

    // ── Financial Facts block (registry, precision layer) ─────────────────────
    if (showFinancialBlock && opts.facts && opts.facts.length > 0) {
      const factsBlock = buildFactsBlock(opts.facts);
      if (factsBlock) lines.push(``, factsBlock);
    }

    // ── Financial Coverage block (what's present / missing / conflicting) ──────
    if (showFinancialBlock && opts.coverage) {
      const covBlock = buildCoverageSummaryBlock(opts.coverage);
      if (covBlock) lines.push(``, covBlock);
      const conflictBlock = buildConflictWarningBlock(opts.coverage);
      if (conflictBlock) lines.push(``, conflictBlock);
      const missingBlock = buildMissingMetricsNote(opts.coverage);
      if (missingBlock) lines.push(``, missingBlock);
    }

    lines.push(`--- END ORCHESTRATOR DATA ---`);
  }

  // ── Page Context block (non-financial intents, page-level grounding) ─────
  if (opts.pageRows && opts.pageRows.length > 0) {
    const pageBlock = buildPageContextBlock(opts.pageRows);
    if (pageBlock) lines.push(``, pageBlock);
  }

  // ── Deal Facts block (non-financial intents, registry-level grounding) ────
  if (intent !== "financial" && !opts.forceFinancialBlock && opts.dealFacts && opts.dealFacts.length > 0) {
    const dfBlock = buildDealFactsBlock(opts.dealFacts);
    if (dfBlock) lines.push(``, dfBlock);
  }

  // Evidence for citation (ordered by relevance; registry items first)
  if (ctx.evidenceItems.length > 0) {
    lines.push(``, `--- EVIDENCE (cite by evidence_id) ---`);
    for (const item of ctx.evidenceItems) {
      const pageStr = item.page_index != null ? ` p.${item.page_index}` : "";
      lines.push(`[${item.evidence_id}${pageStr}] ${cap(item.snippet, 280)}`);
    }
    lines.push(`--- END EVIDENCE ---`);
  }

  return lines.join("\n");
}

// ============================================================================
// Zod schemas
// ============================================================================

const workspaceChatSchema = z.object({
  message: z.string().min(1, "message is required"),
});

const dealChatSchema = z.object({
  message: z.string().min(1, "message is required"),
  deal_id: z.string().min(1, "deal_id is required"),
  dio_version_id: z.string().optional().nullable(),
});

async function hasTable(pool: ReturnType<typeof getPool>, table: string) {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass($1) as oid",
      [table]
    );
    return rows[0]?.oid !== null;
  } catch {
    return false;
  }
}

// ============================================================================
// Route registration
// ============================================================================

export async function registerChatRoutes(
  app: FastifyInstance,
  pool = getPool()
) {
  // Workspace chat — static prompt (no deal context)
  app.post("/api/v1/chat/workspace", async (request, reply) => {
    const parsed = workspaceChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const response: WorkspaceChatResponse = {
      reply:
        "I can run deal analysis, fetch evidence, and summarize findings. Share a deal ID to get started.",
      suggested_actions: [],
    };

    return reply.send(response);
  });

  // Deal chat — governed LLM response with grounded context
  app.post("/api/v1/chat/deal", async (request, reply) => {
    const parsed = dealChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { deal_id, dio_version_id, message } = parsed.data;

    // Classify question intent (deterministic, before LLM call)
    const intent = classifyQuestionIntent(message);

    // Build grounded context from DB
    const ctx = await buildDealChatContextV1(pool, deal_id, dio_version_id);

    // Fallback suggested actions (overridden by LLM output below)
    const fallbackActions: DealChatActionV1[] = ctx.orchestratorReport
      ? [
          { type: "REGENERATE_INSIGHTS", deal_id },
          { type: "OPEN_FULL_REPORT", deal_id },
        ]
      : [{ type: "RUN_ANALYZE", deal_id }];

    // Graceful no-key path
    if (!process.env.OPENAI_API_KEY) {
      const response: DealChatResponseV1 = {
        message: ctx.orchestratorReport
          ? `Analysis context is loaded for this deal. However, the AI service is not configured — please contact your administrator to enable Deal Assistant.`
          : `No analysis has been run for this deal yet. Run analysis first to enable grounded Deal Assistant responses.`,
        confidence: "low",
        suggested_actions: fallbackActions,
      };
      return reply.send(response);
    }

    // Detect currency/number pattern in message → force financial block even without financial intent keyword
    const forceFinancialBlock = /[$\u20ac\u00a3\u00a5]\d|\b\d[\d,]*(?:\.\d+)?\s*(?:million|M\b|K\b|B\b|%)/i.test(message);
    const showFinancialIntent = intent === "financial" || forceFinancialBlock;

    // Fetch financial facts from registry (intent-gated, non-blocking)
    const registryFacts: FinancialFactV1[] = showFinancialIntent
      ? await getFinancialFactsForChat(pool, deal_id)
      : [];

    // Fetch financial coverage (intent-gated, non-blocking, best-effort)
    const registryCoverage: FinancialCoverageV1 | null = showFinancialIntent
      ? await getFinancialCoverageForChat(pool, deal_id)
      : null;

    // Fetch page registry context for non-financial intents
    const pageRegistryType = INTENT_TO_PAGE_TYPE[intent];
    const pageRows: PageRegistryRowV1[] =
      !showFinancialIntent && pageRegistryType
        ? await getPageContextForChat(pool, deal_id, pageRegistryType, 4)
        : [];

    // Fetch deal fact registry context (non-financial intents only, graceful fail)
    const dealFacts: DealFactV1[] = !showFinancialIntent
      ? await getDealFactsForChat(pool, deal_id, intent, 20)
      : [];

    const systemPrompt = buildSystemPrompt(ctx, intent, { forceFinancialBlock, facts: registryFacts, coverage: registryCoverage, pageRows, dealFacts });

    let llmMessage = "";
    let confidence: DealChatResponseV1["confidence"] = "low";
    let sources: DealChatSourceV1[] | undefined;
    let suggested_actions: DealChatActionV1[] = fallbackActions;
    let answer_basis: AnswerBasis | undefined;
    let unknowns_used: string[] | undefined;

    try {
      const result = await openaiChatCompletion({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.2,
        maxTokens: 900,
        jsonMode: true,
      });

      // Parse structured JSON from LLM
      let llmParsed: {
        message?: string;
        confidence?: string;
        cited_evidence_ids?: unknown[];
        suggested_action_types?: unknown[];
        answer_basis?: string;
        unknowns_used?: unknown[];
      } = {};
      try {
        llmParsed = JSON.parse(result.content);
      } catch {
        // LLM didn't honour JSON mode — use raw text
        llmParsed = { message: result.content };
      }

      llmMessage =
        typeof llmParsed.message === "string" && llmParsed.message.trim()
          ? llmParsed.message.trim()
          : result.content;

      confidence =
        llmParsed.confidence === "high" || llmParsed.confidence === "medium"
          ? (llmParsed.confidence as DealChatResponseV1["confidence"])
          : "low";

      // Parse answer_basis
      const VALID_ANSWER_BASES = new Set<string>([
        "product_profile_v1",
        "orchestrator_report",
        "evidence_only",
        "insufficient_data",
      ]);
      if (
        typeof llmParsed.answer_basis === "string" &&
        VALID_ANSWER_BASES.has(llmParsed.answer_basis)
      ) {
        answer_basis = llmParsed.answer_basis as AnswerBasis;
      }

      // Parse unknowns_used (max 3 strings)
      if (Array.isArray(llmParsed.unknowns_used)) {
        const parsed_unknowns = llmParsed.unknowns_used
          .filter((u): u is string => typeof u === "string")
          .slice(0, 3);
        if (parsed_unknowns.length > 0) unknowns_used = parsed_unknowns;
      }

      // ── Deterministic sanity filter ───────────────────────────────────────
      const pp = ctx.orchestratorReport?.segments.product_profile_v1 ?? null;
      const sanity = enforceAnswerSanity({
        intent,
        productProfile: pp,
        orchReport: ctx.orchestratorReport ?? undefined,
        message: llmMessage,
        confidence,
        evidenceTexts: ctx.evidenceItems.map((e) => e.snippet),
        cited_evidence_ids: Array.isArray(llmParsed.cited_evidence_ids)
          ? llmParsed.cited_evidence_ids.filter((id): id is string => typeof id === "string")
          : [],
      });
      if (sanity.downgraded) {
        llmMessage = sanity.message;
        confidence = sanity.confidence;
        // Sanity rewrites suggest running analysis for more detail
        if (!answer_basis) answer_basis = "insufficient_data";
        console.log(JSON.stringify({
          event: "ANSWER_SANITY_DOWNGRADE",
          intent,
          reason: sanity.reason,
          deal_id,
        }));
      }

      // Build evidence map from context items
      const evidenceMap = new Map(
        ctx.evidenceItems.map((item) => [item.evidence_id, item])
      );

      // Map cited IDs back to source objects
      if (Array.isArray(llmParsed.cited_evidence_ids)) {
        const citedIds = llmParsed.cited_evidence_ids
          .filter((id): id is string => typeof id === "string")
          .slice(0, 6);
        if (citedIds.length > 0) {
          const resolved = citedIds
            .filter((id) => evidenceMap.has(id))
            .map(
              (id): DealChatSourceV1 => ({
                evidence_id: id,
                excerpt: evidenceMap.get(id)?.snippet ?? undefined,
                page: evidenceMap.get(id)?.page_index ?? undefined,
              })
            );
          if (resolved.length > 0) sources = resolved;
        }
      }

      // Map LLM-suggested action types → typed DealChatActionV1 objects
      const VALID_ACTION_TYPES = new Set([
        "RUN_ANALYZE",
        "REGENERATE_INSIGHTS",
        "OPEN_FULL_REPORT",
        "SHOW_SOURCES",
        "EXPORT_PDF",
      ]);
      const llmActionTypes = Array.isArray(llmParsed.suggested_action_types)
        ? llmParsed.suggested_action_types
            .filter(
              (t): t is string =>
                typeof t === "string" && VALID_ACTION_TYPES.has(t)
            )
            .slice(0, 3)
        : [];

      if (llmActionTypes.length > 0) {
        const actionSet = new Set<string>(llmActionTypes);
        // Always surface SHOW_SOURCES if we actually have sources
        if (sources && sources.length > 0) actionSet.add("SHOW_SOURCES");

        suggested_actions = Array.from(actionSet).map((t): DealChatActionV1 => {
          switch (t) {
            case "RUN_ANALYZE":
              return { type: "RUN_ANALYZE", deal_id };
            case "REGENERATE_INSIGHTS":
              return { type: "REGENERATE_INSIGHTS", deal_id };
            case "OPEN_FULL_REPORT":
              return { type: "OPEN_FULL_REPORT", deal_id };
            case "SHOW_SOURCES":
              return { type: "SHOW_SOURCES" };
            case "EXPORT_PDF":
              return { type: "EXPORT_PDF", deal_id };
            default:
              return { type: "OPEN_FULL_REPORT", deal_id };
          }
        });
      } else {
        // LLM gave no suggestions — use fallback, but inject SHOW_SOURCES if relevant
        if (sources && sources.length > 0) {
          suggested_actions = [
            { type: "SHOW_SOURCES" },
            ...fallbackActions.slice(0, 2),
          ];
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chat/deal] LLM call failed:", msg);

      return reply.status(503).send({
        error: "llm_unavailable",
        message:
          "Deal Assistant is temporarily unavailable. Please try again in a moment.",
      });
    }

    const response: DealChatResponseV1 = {
      message: llmMessage,
      confidence,
      sources,
      suggested_actions,
      ...(answer_basis ? { answer_basis } : {}),
      ...(unknowns_used ? { unknowns_used } : {}),
    };

    return reply.send(response);
  });
}
