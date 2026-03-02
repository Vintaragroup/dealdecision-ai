/**
 * Render-Package Helpers for the Orchestrator
 *
 * Pure parsing utilities for extracting structured data from the
 * investor insights render package sections.
 *
 * No I/O, no DB, no LLM — deterministic only.
 */

import type { OrchestratorRenderPackageInput } from './render-package-input';
import type { StageLabel, ProductProfileV1 } from './types';

// ─── Section lookup ──────────────────────────────────────────────────────────

/** Return the body string of a section by key, or null if not present. */
export function findSectionBody(rp: OrchestratorRenderPackageInput, key: string): string | null {
  const sec = rp.sections.find((s) => s.key === key);
  return typeof sec?.body === "string" ? sec.body : null;
}

/** Return the items array of a section by key, or [] if not present. */
export function findSectionItems(rp: OrchestratorRenderPackageInput, key: string): unknown[] {
  const sec = rp.sections.find((s) => s.key === key);
  return Array.isArray(sec?.items) ? sec.items : [];
}

/** Return true when a section key exists in the render package sections. */
export function hasSectionKey(rp: OrchestratorRenderPackageInput, key: string): boolean {
  return rp.sections.some((s) => s.key === key);
}

// ─── Key: value body parser ──────────────────────────────────────────────────

/**
 * Parse a `key: value` line-format body string into a Record.
 * Lines that don't contain ':' are skipped.
 */
export function parseKvBody(body: string | null): Record<string, string> {
  if (!body) return {};
  const kv: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) kv[k] = v;
  }
  return kv;
}

// ─── CoverageSnapshot ────────────────────────────────────────────────────────

export interface ParsedCoverageSnapshot {
  docs_count: number;
  dpu_page_count: number;
  dpu_nonempty_pages: number;
  evidence_count: number;
  visuals_count: number;
  /** Derived: dpu_nonempty_pages / dpu_page_count * 100, or 0 */
  text_coverage_pct: number;
}

export function parseCoverageSnapshot(body: string | null): ParsedCoverageSnapshot {
  const kv = parseKvBody(body);

  const readInt = (k: string): number => {
    const v = kv[k];
    if (!v || v === "none") return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const dpu_page_count = readInt("dpu_page_count");
  const dpu_nonempty_pages = readInt("dpu_nonempty_pages");
  const text_coverage_pct =
    dpu_page_count > 0 ? Math.round((dpu_nonempty_pages / dpu_page_count) * 100) : 0;

  return {
    docs_count: readInt("docs_count"),
    dpu_page_count,
    dpu_nonempty_pages,
    evidence_count: readInt("evidence_count"),
    visuals_count: readInt("visuals_count"),
    text_coverage_pct,
  };
}

// ─── FinancialLayoutClassifier ───────────────────────────────────────────────

export interface ParsedLayoutClassifier {
  layout_coverage_pct: number;
  has_income_statement: boolean;
  has_use_of_funds: boolean;
  has_budget_model: boolean;
  has_cap_table: boolean;
  has_cash_flow: boolean;
  has_balance_sheet: boolean;
  has_saas_kpis: boolean;
  has_bank_txns: boolean;
  total_xl_pages: number;
  classified_pages: number;
}

export function parseLayoutClassifier(body: string | null): ParsedLayoutClassifier | null {
  if (!body) return null;
  const kv = parseKvBody(body);

  const readBool = (k: string): boolean => kv[k] === "true";
  const readPct = (k: string): number => {
    // Value is stored as "72.5%" — strip the % sign
    const v = kv[k]?.replace("%", "").trim();
    if (!v) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const readInt = (k: string): number => {
    const v = kv[k];
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  return {
    layout_coverage_pct: readPct("layout_coverage_pct"),
    has_income_statement: readBool("has_income_statement"),
    has_use_of_funds: readBool("has_use_of_funds"),
    has_budget_model: readBool("has_budget_model"),
    has_cap_table: readBool("has_cap_table"),
    has_cash_flow: readBool("has_cash_flow"),
    has_balance_sheet: readBool("has_balance_sheet"),
    has_saas_kpis: readBool("has_saas_kpis"),
    has_bank_txns: readBool("has_bank_txns"),
    total_xl_pages: readInt("total_xl_pages"),
    classified_pages: readInt("classified_pages"),
  };
}

// ─── FinancialReconciliation ─────────────────────────────────────────────────

export interface ParsedReconciliationFlag {
  key: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  reason: string;
}

export interface ParsedReconciliation {
  confidence_score: number;
  flags: ParsedReconciliationFlag[];
}

export function parseReconciliation(body: string | null): ParsedReconciliation | null {
  if (!body?.trim()) return null;

  let confidence = 0;
  const flags: ParsedReconciliationFlag[] = [];

  // Flag lines: `✓ flag_key: PASS — reason`
  const flagRe = /^[✓⚠✗\-]\s+(\w[\w._-]*):\s+(PASS|WARN|FAIL|SKIP)\s+—\s+(.+)$/;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("confidence_score:")) {
      const n = parseFloat(trimmed.split(":")[1]?.trim() ?? "0");
      if (Number.isFinite(n)) confidence = n;
    } else {
      const m = flagRe.exec(trimmed);
      if (m) {
        flags.push({
          key: m[1]!,
          status: m[2] as ParsedReconciliationFlag["status"],
          reason: m[3]!.trim(),
        });
      }
    }
  }

  if (flags.length === 0 && confidence === 0) return null;
  return { confidence_score: confidence, flags };
}

// ─── CanonicalFields ─────────────────────────────────────────────────────────

export interface ParsedCanonicalField {
  category: string;
  field: string;
  computability: string;
  value: string | null;
  evidence: string | null;
  reason: string | null;
  /** "xlsx" | "deck" | "derived" | "unknown" */
  source_type: string;
}

/**
 * Parse the `canonical_fields` section body.
 * Line format: `category=X | field=Y | computability=Z | value="V" | evidence=E | reason=R | source=S`
 */
export function parseCanonicalFieldsBody(body: string | null): ParsedCanonicalField[] {
  if (!body) return [];
  const fields: ParsedCanonicalField[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("---") || !line.includes("field=")) continue;

    const parts: Record<string, string> = {};
    for (const seg of line.split("|")) {
      const eqIdx = seg.indexOf("=");
      if (eqIdx < 0) continue;
      const k = seg.slice(0, eqIdx).trim().toLowerCase();
      const v = seg.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
      if (k) parts[k] = v;
    }

    const field = parts["field"] ?? "";
    if (!field) continue;

    const computability = parts["computability"] ?? "";
    const value = computability === "NotComputable" ? null : (parts["value"] || null);
    const evidence = parts["evidence"] && parts["evidence"] !== "none" ? parts["evidence"] : null;
    const reason = parts["reason"] && parts["reason"] !== "none" ? parts["reason"] : null;

    fields.push({
      category: parts["category"] ?? "",
      field,
      computability,
      value,
      evidence,
      reason,
      source_type: parts["source"] ?? "unknown",
    });
  }

  return fields;
}

// ─── Conflicts ───────────────────────────────────────────────────────────────

export interface ParsedConflict {
  field: string;
  value_a: string | null;
  value_b: string | null;
  evidence_a: string | null;
  evidence_b: string | null;
  source_a: string;
  source_b: string;
  reason: string | null;
}

/**
 * Parse the `conflicts` section body.
 * Line format: `field=X | value_a="A" | evidence_a=E | source_a=S | value_b="B" | ...`
 */
export function parseConflictsBody(body: string | null): ParsedConflict[] {
  if (!body) return [];
  const entries: ParsedConflict[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const seg: Record<string, string> = {};
    for (const part of line.split(" | ")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const k = part.slice(0, eqIdx).trim();
      const v = part.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
      seg[k] = v;
    }

    const field = seg["field"];
    if (!field) continue;

    entries.push({
      field,
      value_a: seg["value_a"] ?? null,
      value_b: seg["value_b"] ?? null,
      evidence_a: seg["evidence_a"] ?? null,
      evidence_b: seg["evidence_b"] ?? null,
      source_a: seg["source_a"] ?? "unknown",
      source_b: seg["source_b"] ?? "unknown",
      reason: seg["reason"] ?? null,
    });
  }

  return entries;
}

// ─── DeckFinancialSignals ────────────────────────────────────────────────────

export interface ParsedDeckFinancialSignals {
  has_revenue: boolean;
  has_burn: boolean;
  has_runway: boolean;
  has_pricing: boolean;
  has_arr_mrr: boolean;
  has_unit_economics: boolean;
  /** True when at least `has_revenue || has_arr_mrr || has_burn` */
  has_any_financial: boolean;
}

export function parseDeckFinancialSignals(body: string | null): ParsedDeckFinancialSignals {
  const kv = parseKvBody(body);
  const rb = (k: string) => kv[k] === "true";
  const has_revenue = rb("has_revenue");
  const has_burn = rb("has_burn");
  const has_runway = rb("has_runway");
  const has_arr_mrr = rb("has_arr_mrr");
  return {
    has_revenue,
    has_burn,
    has_runway,
    has_pricing: rb("has_pricing"),
    has_arr_mrr,
    has_unit_economics: rb("has_unit_economics"),
    has_any_financial: has_revenue || has_arr_mrr || has_burn,
  };
}

// ─── GovernedExecutiveSummary ────────────────────────────────────────────────

export interface ParsedExecutiveSummary {
  headline: string;
  summary_paragraphs: string[];
  strengths: string[];
  risks: string[];
  open_questions: string[];
}

const EXEC_SUMMARY_JSON_DELIMITER = "---governed_executive_summary_v1_json---\n";

/**
 * Parse the `governed_executive_summary_v1` section body.
 * The body contains narrative text followed by an optional embedded JSON block
 * after the delimiter: `---governed_executive_summary_v1_json---`
 */
export function parseExecutiveSummaryBody(body: string | null): ParsedExecutiveSummary | null {
  if (!body?.trim()) return null;

  const delimIdx = body.indexOf(EXEC_SUMMARY_JSON_DELIMITER);
  if (delimIdx !== -1) {
    const jsonStr = body.slice(delimIdx + EXEC_SUMMARY_JSON_DELIMITER.length).trim();
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const toStrArr = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      return {
        headline: typeof parsed["headline"] === "string" ? parsed["headline"] : "",
        summary_paragraphs: toStrArr(parsed["summary_paragraphs"]),
        strengths: toStrArr(parsed["strengths"]),
        risks: toStrArr(parsed["risks"]),
        open_questions: toStrArr(parsed["open_questions"]),
      };
    } catch {
      // fall through to text-only parse
    }
  }

  // No JSON block — use the text body as a single paragraph
  const text = body.trim();
  return {
    headline: "",
    summary_paragraphs: text ? [text.slice(0, 500)] : [],
    strengths: [],
    risks: [],
    open_questions: [],
  };
}

// ─── Stage detection ─────────────────────────────────────────────────────────

const SEED_PATTERNS = /\bpre[-\s]?seed\b|\bseed\b/i;
const SERIES_A_PATTERNS = /\bseries\s+a\b/i;

/** Parse a currency amount string like "$2M", "$1.5MM", "$500k" → number in millions (or null). */
function parseAmountToMillions(s: string | null): number | null {
  if (!s) return null;
  // Strip currency symbols and commas
  const clean = s.replace(/[$€£,\s]/g, "");
  const m = /^([\d.]+)(MM?|BB?|[kKtT]?)?$/i.exec(clean);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const suffix = (m[2] ?? "").toUpperCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (suffix === "B" || suffix === "BB") return n * 1000;
  if (suffix === "MM") return n;
  if (suffix === "M") return n;
  if (suffix === "K") return n / 1000;
  if (suffix === "T") return n * 1_000_000;
  return n; // bare number — assume already in millions
}

/**
 * Detect deal stage from canonical fields.
 * Heuristic only — no LLM.
 */
export function detectStage(fields: ParsedCanonicalField[]): StageLabel {
  const get = (fieldName: string): string | null =>
    fields.find((f) => f.field === fieldName && f.computability === "Computable")?.value ?? null;

  const raiseAmount = get("raise_amount");
  const raiseRound = get("raise_round");
  const raiseInstrument = get("raise_instrument");

  // Check text signals first (explicit round mention is most reliable)
  const textHint = [raiseRound, raiseInstrument, raiseAmount].filter(Boolean).join(" ");
  if (SERIES_A_PATTERNS.test(textHint)) return "SeriesA";
  if (SEED_PATTERNS.test(textHint)) return "Seed";

  // Fallback: parse raise amount numerically
  const amountM = parseAmountToMillions(raiseAmount);
  if (amountM !== null) {
    if (amountM <= 3) return "Seed";
    if (amountM <= 15) return "SeriesA";
    return "Growth";
  }

  return "Unknown";
}

// ─── Product Profile parser ────────────────────────────────────────────────────

/**
 * Parse a product_profile_v1 section body (JSON string) into a ProductProfileV1.
 * Returns null when the body is absent, malformed, or missing schema_version.
 */
export function parseProductProfileBody(body: string | null): ProductProfileV1 | null {
  if (!body || !body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed?.schema_version !== "product_profile_v1") return null;
    return parsed as unknown as ProductProfileV1;
  } catch {
    return null;
  }
}
