import type { Pool } from "pg";
import { createHash } from "crypto";

import { OpenAIGPT4oProvider } from "./llm/providers/openai-provider";
import type { ProviderConfig } from "./llm/types";

import type {
  EvidenceRefV1,
  GovernedLLMClaimV1,
  GovernedLLMOverviewV1,
  LLMPhaseMode,
} from "@dealdecision/contracts";

import { buildPhase1KpiReconciliationV1 } from "./phase1/kpiReconciliationV1";
import {
  computeDeterministicDiagnostics,
  computeDriftMetrics,
  computeOverlayGovernanceMetrics,
  type DocumentIndexLite,
} from "./analysis-diagnostics";

const SCHEMA_VERSION = "governed_llm_overview_v1" as const;

type DisplayFactsBasisV1 = "direct_snippet" | "no_evidence";

type DisplayFactFieldV1 = {
  text: string | null;
  evidence_ids: string[];
  evidence_basis: DisplayFactsBasisV1;
};

type DisplayFactsV1 = {
  schema_version: "display_facts_v1";
  product_solution: DisplayFactFieldV1;
  market_icp: DisplayFactFieldV1;
  business_model: DisplayFactFieldV1;
  raise_terms: DisplayFactFieldV1;
};

type DisplayFactsQualityV1 = {
  generated_at: string;
  model: string | null;
  ok: boolean;
  guard_degraded: boolean;
  skipped_reason?: string;
  errors?: string[];
};

type GovernedUiCopyV1 = {
  schema_version: "governed_ui_copy_v1";
  // Back-compat: hero_summary was the original top-line string. New contract prefers deal_summary_mid.
  deal_summary_mid?: string | null;
  hero_summary: string | null;
  product_solution: string | null;
  market_icp: string | null;
  business_model: string | null;
  raise_terms: string | null;
  traction?: string[];
  strengths?: string[];
  concerns?: string[];
  open_questions?: string[];

  evidence_map: {
    deal_summary_mid: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    product_solution: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    market_icp: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    business_model: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    raise_terms: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    traction: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    strengths: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    concerns: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
    open_questions: Array<{ source_document_id: string; page_index: number; node_id?: string; snippet?: string }>;
  };
  // Evidence ids are authoritative (not model-provided). Keyed to the same fields.
  evidence_ids: {
    product_solution: string[];
    market_icp: string[];
    business_model: string[];
    raise_terms: string[];
    hero_summary: string[];
  };
};

type GovernedUiCopyQualityV1 = {
  generated_at: string;
  model: string | null;
  ok: boolean;
  guard_degraded: boolean;
  skipped_reason?: string;
  errors?: string[];
};

function safeJsonParseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deterministicUuidFromKey(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 5 (name-based)
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Variant RFC 4122
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clampText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function isUuidLike(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function logDiagnosticsPersistFailure(args: {
  dealId: string;
  reportId: string;
  llm_phase_mode: LLMPhaseMode;
  err: unknown;
}) {
  const e: any = args.err;
  const payload: any = {
    event: "DIAGNOSTICS_PERSIST_FAILED",
    deal_id: args.dealId,
    report_id: args.reportId,
    llm_phase_mode: args.llm_phase_mode,
    error_message: e instanceof Error ? e.message : String(e ?? "unknown_error"),
  };

  if (e && typeof e === "object") {
    if (typeof e.code === "string") payload.error_code = e.code;
    if (typeof e.detail === "string") payload.error_detail = e.detail;
    if (typeof e.hint === "string") payload.error_hint = e.hint;
    if (typeof e.where === "string") payload.error_where = e.where;
    if (typeof e.stack === "string") payload.error_stack = e.stack;
  }

  try {
    console.warn(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

type DiagnosticsColumnSupport = {
  provider_error_count: boolean;
  model_output_truncated_count: boolean;
  model_output_not_json_count: boolean;
  guard_degraded_count: boolean;
};

const diagnosticsColumnSupportCache = new WeakMap<object, DiagnosticsColumnSupport>();
const diagnosticsColumnSupportInFlight = new WeakMap<object, Promise<DiagnosticsColumnSupport>>();

async function getDiagnosticsColumnSupport(pool: Pool): Promise<DiagnosticsColumnSupport> {
  const key: any = pool as any;
  if (!key || (typeof key !== "object" && typeof key !== "function")) {
    return {
      provider_error_count: false,
      model_output_truncated_count: false,
      model_output_not_json_count: false,
      guard_degraded_count: false,
    };
  }

  const cached = diagnosticsColumnSupportCache.get(key);
  if (cached) return cached;

  const inFlight = diagnosticsColumnSupportInFlight.get(key);
  if (inFlight) return inFlight;

  const p = (async () => {
    const targetCols = [
      "provider_error_count",
      "model_output_truncated_count",
      "model_output_not_json_count",
      "guard_degraded_count",
    ];

    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='deal_analysis_diagnostics'
            AND column_name = ANY($1::text[])`,
        [targetCols]
      );
      const present = new Set(
        (rows ?? [])
          .map((r) => (typeof r?.column_name === "string" ? r.column_name.trim() : ""))
          .filter(Boolean)
      );
      const support: DiagnosticsColumnSupport = {
        provider_error_count: present.has("provider_error_count"),
        model_output_truncated_count: present.has("model_output_truncated_count"),
        model_output_not_json_count: present.has("model_output_not_json_count"),
        guard_degraded_count: present.has("guard_degraded_count"),
      };
      diagnosticsColumnSupportCache.set(key, support);
      return support;
    } catch {
      const support: DiagnosticsColumnSupport = {
        provider_error_count: false,
        model_output_truncated_count: false,
        model_output_not_json_count: false,
        guard_degraded_count: false,
      };
      diagnosticsColumnSupportCache.set(key, support);
      return support;
    } finally {
      diagnosticsColumnSupportInFlight.delete(key);
    }
  })();

  diagnosticsColumnSupportInFlight.set(key, p);
  return p;
}

type Disclosure = { code: string; message: string };

function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;
    if (v === undefined) return { __type: "undefined" };
    if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
    if (typeof v === "bigint") return { __type: "bigint", value: v.toString() };
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (v instanceof Date) return { __type: "date", value: v.toISOString() };
    if (Array.isArray(v)) return v.map(normalize);
    if (v instanceof Set) return { __type: "set", value: Array.from(v).map(normalize) };
    if (v instanceof Map) {
      const entries = Array.from(v.entries()).map(([k, val]) => [normalize(k), normalize(val)]);
      entries.sort((a, b) => {
        const ak = JSON.stringify(a[0]);
        const bk = JSON.stringify(b[0]);
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      });
      return { __type: "map", value: entries };
    }

    if (typeof v === "object") {
      if (seen.has(v)) return { __type: "circular" };
      seen.add(v);
      const out: Record<string, any> = {};
      for (const key of Object.keys(v).sort()) out[key] = normalize(v[key]);
      return out;
    }

    return { __type: typeof v, value: String(v) };
  };

  return JSON.stringify(normalize(value));
}

function stripNonDeterministicFieldsDeep(value: unknown): unknown {
  const dropExact = new Set([
    "created_at",
    "updated_at",
    "generated_at",
    "computed_at",
    "ts",
    "timestamp",
    "start_ts",
    "end_ts",
  ]);

  const walk = (v: any): any => {
    if (v == null) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== "object") return v;
    const out: Record<string, any> = {};
    for (const key of Object.keys(v)) {
      if (dropExact.has(key)) continue;
      out[key] = walk(v[key]);
    }
    return out;
  };

  return walk(value);
}

export function computeGovernedLlmOverviewInputHash(deterministicInputs: unknown): string {
  return createHash("sha256").update(stableJsonStringify(deterministicInputs)).digest("hex");
}

export function isNumericClaim(claim: GovernedLLMClaimV1): boolean {
  return typeof claim.value_number === "number" && Number.isFinite(claim.value_number);
}

function isNumericClaimWithoutEvidence(claim: GovernedLLMClaimV1): boolean {
  if (!isNumericClaim(claim)) return false;
  const refs = Array.isArray(claim.evidence_refs) ? claim.evidence_refs : [];
  return refs.length === 0;
}

function appendDisclosureOnce(disclosures: Disclosure[], code: string, message: string): Disclosure[] {
  if (disclosures.some((d) => d.code === code)) return disclosures;
  return [...disclosures, { code, message }];
}

export function enforcePhaseMode(
  overlay: GovernedLLMOverviewV1,
  phase: "exploratory" | "stabilizing" | "governed"
): GovernedLLMOverviewV1 {
  try {
    const originalClaims = Array.isArray(overlay.claims) ? overlay.claims : [];
    const originalDisclosures = Array.isArray(overlay.disclosures) ? overlay.disclosures : [];

    const numericWithoutEvidence = originalClaims.filter((c) => isNumericClaimWithoutEvidence(c));
    if (numericWithoutEvidence.length === 0) {
      return { ...overlay, claims: originalClaims, disclosures: originalDisclosures };
    }

    if (phase === "exploratory") {
      return {
        ...overlay,
        claims: originalClaims,
        disclosures: appendDisclosureOnce(
          originalDisclosures,
          "numeric_claim_missing_evidence",
          "Exploratory mode: numeric claims may be present without evidence; treat cautiously."
        ),
      };
    }

    if (phase === "stabilizing") {
      const filtered = originalClaims.filter((c) => !isNumericClaimWithoutEvidence(c));
      return {
        ...overlay,
        claims: filtered,
        disclosures: appendDisclosureOnce(
          originalDisclosures,
          "stabilizing_removed_numeric_without_evidence",
          "Stabilizing mode: removed numeric claims that lacked evidence."
        ),
      };
    }

    // governed
    return {
      ...overlay,
      claims: [],
      disclosures: appendDisclosureOnce(
        originalDisclosures,
        "governed_mode_validation_failed",
        "Governed mode: suppressed overlay claims due to numeric claims lacking evidence."
      ),
    };
  } catch {
    // Never throw; enforcement must be fail-open.
    return overlay;
  }
}

function isPhaseMode(v: unknown): v is LLMPhaseMode {
  return v === "exploratory" || v === "stabilizing" || v === "governed";
}

function isEvidenceRefV1(v: unknown): v is EvidenceRefV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (typeof o.document_id !== "string" || !o.document_id.trim()) return false;
  if (typeof o.page_index !== "number" || !Number.isFinite(o.page_index) || Math.floor(o.page_index) !== o.page_index) return false;
  if (o.page_index < 0) return false;
  if (o.dpu_id != null && (typeof o.dpu_id !== "string" || !o.dpu_id.trim())) return false;
  if (o.block_id != null && (typeof o.block_id !== "string" || !o.block_id.trim())) return false;
  if (o.char_range != null) {
    if (!Array.isArray(o.char_range) || o.char_range.length !== 2) return false;
    const a = o.char_range[0];
    const b = o.char_range[1];
    if (typeof a !== "number" || typeof b !== "number") return false;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (Math.floor(a) !== a || Math.floor(b) !== b) return false;
    if (a < 0 || b < 0) return false;
  }
  return true;
}

function isGovernedClaimV1(v: unknown): v is GovernedLLMClaimV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.claim_type !== "kpi" && o.claim_type !== "risk" && o.claim_type !== "summary" && o.claim_type !== "other") return false;
  if (typeof o.label !== "string" || !o.label.trim()) return false;
  if (o.value_string != null && typeof o.value_string !== "string") return false;
  if (o.value_number != null && (typeof o.value_number !== "number" || !Number.isFinite(o.value_number))) return false;
  if (o.unit != null && typeof o.unit !== "string") return false;
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) return false;
  if (!Array.isArray(o.evidence_refs)) return false;
  for (const e of o.evidence_refs) {
    if (!isEvidenceRefV1(e)) return false;
  }
  return true;
}

function isKpiLike(claim: GovernedLLMClaimV1): boolean {
  if (claim.claim_type === "kpi") return true;
  if (typeof claim.value_number === "number") return true;
  const label = String(claim.label ?? "").toLowerCase();
  return /\b(arr|mrr|revenue|runway|burn|gmv|cac|ltv|margin|growth)\b/.test(label);
}

export function validateGovernedLlmOverviewV1(
  candidate: GovernedLLMOverviewV1
): { ok: true; data: GovernedLLMOverviewV1 } | { ok: false; error: unknown } {
  if (!candidate || typeof candidate !== "object") return { ok: false as const, error: "candidate_not_object" };
  if ((candidate as any).schema_version !== SCHEMA_VERSION) return { ok: false as const, error: "invalid_schema_version" };
  if (typeof candidate.deal_id !== "string" || !candidate.deal_id.trim()) return { ok: false as const, error: "missing_deal_id" };
  if (typeof candidate.input_hash !== "string" || !candidate.input_hash.trim()) return { ok: false as const, error: "missing_input_hash" };
  if (!isPhaseMode((candidate as any).llm_phase_mode)) return { ok: false as const, error: "invalid_llm_phase_mode" };
  if (typeof candidate.summary_text !== "string") return { ok: false as const, error: "invalid_summary_text" };
  if (!Array.isArray(candidate.claims)) return { ok: false as const, error: "invalid_claims" };
  if (!Array.isArray(candidate.disclosures)) return { ok: false as const, error: "invalid_disclosures" };

  for (const c of candidate.claims as any[]) {
    if (!isGovernedClaimV1(c)) return { ok: false as const, error: "invalid_claim" };
    if (isKpiLike(c) && (!Array.isArray(c.evidence_refs) || c.evidence_refs.length === 0)) {
      return {
        ok: false as const,
        error: {
          code: "kpi_claim_missing_evidence",
          message: "Numeric/KPI-like claims must include >= 1 evidence_ref",
          claim_label: c.label,
        },
      };
    }
  }

  for (const d of candidate.disclosures as any[]) {
    if (!d || typeof d !== "object") return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).code !== "string" || !(d as any).code.trim()) return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).message !== "string" || !(d as any).message.trim()) return { ok: false as const, error: "invalid_disclosure" };
  }

  return { ok: true as const, data: candidate };
}

function validateGovernedLlmOverviewSchemaV1(
  candidate: GovernedLLMOverviewV1
): { ok: true; data: GovernedLLMOverviewV1 } | { ok: false; error: unknown } {
  if (!candidate || typeof candidate !== "object") return { ok: false as const, error: "candidate_not_object" };
  if ((candidate as any).schema_version !== SCHEMA_VERSION) return { ok: false as const, error: "invalid_schema_version" };
  if (typeof candidate.deal_id !== "string" || !candidate.deal_id.trim()) return { ok: false as const, error: "missing_deal_id" };
  if (typeof candidate.input_hash !== "string" || !candidate.input_hash.trim()) return { ok: false as const, error: "missing_input_hash" };
  if (!isPhaseMode((candidate as any).llm_phase_mode)) return { ok: false as const, error: "invalid_llm_phase_mode" };
  if (typeof candidate.summary_text !== "string") return { ok: false as const, error: "invalid_summary_text" };
  if (!Array.isArray(candidate.claims)) return { ok: false as const, error: "invalid_claims" };
  if (!Array.isArray(candidate.disclosures)) return { ok: false as const, error: "invalid_disclosures" };

  for (const c of candidate.claims as any[]) {
    if (!isGovernedClaimV1(c)) return { ok: false as const, error: "invalid_claim" };
  }

  for (const d of candidate.disclosures as any[]) {
    if (!d || typeof d !== "object") return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).code !== "string" || !(d as any).code.trim()) return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).message !== "string" || !(d as any).message.trim()) return { ok: false as const, error: "invalid_disclosure" };
  }

  return { ok: true as const, data: candidate };
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildSummaryText(input: {
  dealName?: string | null;
  dealOverviewV2?: any;
  businessArchetypeV1?: any;
}): string {
  const name = typeof input.dealName === "string" && input.dealName.trim() ? input.dealName.trim() : null;
  const overview = input.dealOverviewV2 && typeof input.dealOverviewV2 === "object" ? input.dealOverviewV2 : null;

  const raise = typeof (overview as any)?.raise === "string" ? String((overview as any).raise).trim() : "";
  const model = typeof (overview as any)?.business_model === "string" ? String((overview as any).business_model).trim() : "";
  const product = typeof (overview as any)?.product_solution === "string" ? String((overview as any).product_solution).trim() : "";
  const market = typeof (overview as any)?.market_icp === "string" ? String((overview as any).market_icp).trim() : "";

  const bits: string[] = [];
  if (name) bits.push(`Deal: ${name}.`);
  if (raise) bits.push(`Raise: ${raise}.`);
  if (model) bits.push(`Business model: ${model}.`);
  if (product) bits.push(`Product: ${product}.`);
  if (market) bits.push(`Market/ICP: ${market}.`);

  if (bits.length === 0) return "";
  return bits.join(" ");
}

function toEvidenceRefFromKpiClaim(claim: { document_id: string; page: number }): EvidenceRefV1 | null {
  const document_id = typeof claim.document_id === "string" ? claim.document_id.trim() : "";
  const page = typeof claim.page === "number" && Number.isFinite(claim.page) ? Math.floor(claim.page) : NaN;
  if (!document_id) return null;
  if (!Number.isFinite(page) || page <= 0) return null;
  return {
    document_id,
    page_index: page - 1,
    dpu_id: `dpu:${document_id}:p${page - 1}`,
  };
}

// ---------------------------------------------------------------------------
// Governed output consistency validator
// Non-blocking post-generation check: verifies that the LLM-generated UI copy
// properly reflects the deterministic input signals. Returns warning codes only.
// ---------------------------------------------------------------------------

/** Warning codes emitted by the governed output consistency validator. */
export type GovernedOutputConsistencyWarning =
  | "HERO_MISSING_RAISE_CONTEXT"
  | "BUSINESS_MODEL_NOT_REFLECTED"
  | "TRACTION_NOT_SURFACED"
  | "ICP_NOT_REFLECTED";

/**
 * Pure function — no I/O. Returns an array of warning codes (empty = all good).
 * Intended to run post-generation, pre-persistence as a sanity gate.
 */
export function validateGovernedOutputConsistency(args: {
  heroSummary: string | null;
  product: string | null;
  market: string | null;
  businessModel: string | null;
  deterministicBasis: {
    raise_terms?: { text?: string | null };
    market_icp?: { text?: string | null };
    business_model?: { text?: string | null };
  } | null;
  tractionSignals: string[];
}): GovernedOutputConsistencyWarning[] {
  const warnings: GovernedOutputConsistencyWarning[] = [];
  const lo = (s: string | null | undefined): string => (s ?? "").toLowerCase();

  // Rule 1 — HERO_MISSING_RAISE_CONTEXT
  // If raise_terms basis contains a dollar amount (e.g. "$3M", "$500K"), the
  // hero_summary should reference the raise or the amount. Missing it suggests
  // the model either hallucinated or silently dropped a key context signal.
  {
    const raiseText = lo(args.deterministicBasis?.raise_terms?.text);
    const hero = lo(args.heroSummary);
    if (raiseText) {
      const amountPattern = /\$[\d.,]+\s*[mbk]?i?l?l?i?o?n?|\d[\d.,]*\s*[mbk]\b|\d[\d.,]*\s*million/i;
      const hasAmount = amountPattern.test(raiseText);
      if (hasAmount) {
        // Extract the first numeric token (e.g. "3" from "$3M" or "500" from "$500K")
        const numericMatch = raiseText.match(/[\d.,]+/);
        const numStr = numericMatch ? numericMatch[0].replace(/,/g, "") : null;
        const heroMentionsRaise = /rais|fundrais|capital|investment|round|seeking|ask\b/.test(hero);
        const heroMentionsAmount = numStr ? hero.includes(numStr) : false;
        if (!heroMentionsRaise && !heroMentionsAmount) {
          warnings.push("HERO_MISSING_RAISE_CONTEXT");
        }
      }
    }
  }

  // Rule 2 — BUSINESS_MODEL_NOT_REFLECTED
  // The governed business_model text should echo the revenue mechanism from the
  // deterministic basis. If none of the revenue-type keywords from the basis
  // appear in the generated copy, the model may have replaced them with vague prose.
  {
    const basisBm = lo(args.deterministicBasis?.business_model?.text);
    const governedBm = lo(args.businessModel);
    if (basisBm && governedBm) {
      const revenueKeywords = [
        "subscription", "licens", "wholesale", "transaction", "saas",
        "fee", "revenue", "arr", "mrr", "recurring", "commission",
        "marketplace", "usage", "per-seat", "per seat",
      ];
      const basisKeywords = revenueKeywords.filter((kw) => basisBm.includes(kw));
      if (basisKeywords.length > 0) {
        const governedHasAny = basisKeywords.some((kw) => governedBm.includes(kw));
        if (!governedHasAny) {
          warnings.push("BUSINESS_MODEL_NOT_REFLECTED");
        }
      }
    }
  }

  // Rule 3 — TRACTION_NOT_SURFACED
  // If traction signals contain numeric evidence (e.g. "3x YoY", "$2M ARR"),
  // at least one numeric should appear in the hero summary or product text.
  // Pure absence of any number suggests the overlay has no traction grounding.
  {
    const signals = args.tractionSignals;
    if (signals.length > 0) {
      // Extract all digit sequences from all signals
      const numerics = signals.flatMap((s) => {
        const matches = s.match(/\d[\d.,]*/g) ?? [];
        return matches.map((m) => m.replace(/,/g, ""));
      });
      if (numerics.length > 0) {
        const combined = lo(args.heroSummary) + " " + lo(args.product);
        const anyFound = numerics.some((n) => combined.includes(n));
        if (!anyFound) {
          warnings.push("TRACTION_NOT_SURFACED");
        }
      }
    }
  }

  // Rule 4 — ICP_NOT_REFLECTED
  // The deterministic basis market_icp text contains the true ICP signal.
  // The governed market_icp copy should echo at least one significant descriptor
  // word from it (beyond stop-words). Absence suggests the model generalised.
  {
    const basisIcp = lo(args.deterministicBasis?.market_icp?.text);
    const governedMarket = lo(args.market);
    if (basisIcp && governedMarket) {
      const STOP_WORDS = new Set([
        "the", "and", "for", "with", "are", "that", "this", "have",
        "from", "they", "will", "been", "has", "was", "not", "all",
        "its", "who", "our", "their", "your", "can", "also", "into",
        "more", "most", "very", "than", "but", "we", "in", "of",
        "to", "a", "an", "is", "it", "at", "on", "or", "by",
        "as", "be", "do", "up",
      ]);
      const significantWords = basisIcp
        .split(/\W+/)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
        .slice(0, 4);
      if (significantWords.length > 0) {
        const anyReflected = significantWords.some((w) => governedMarket.includes(w));
        if (!anyReflected) {
          warnings.push("ICP_NOT_REFLECTED");
        }
      }
    }
  }

  return warnings;
}

type PersistableGovernedOverviewRow = GovernedLLMOverviewV1 & {
  overview_json?: unknown;
  consistency_warnings?: unknown;
};

async function persistGovernedOverview(pool: Pool, overview: PersistableGovernedOverviewRow): Promise<{ inserted: boolean }> {
  const res = await pool.query(
    `INSERT INTO governed_llm_overviews (deal_id, schema_version, llm_phase_mode, input_hash, run_id, step_run_id, summary_text, claims, disclosures, overview_json, consistency_warnings)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
     ON CONFLICT (deal_id, input_hash, schema_version) DO NOTHING`,
    [
      overview.deal_id,
      overview.schema_version,
      overview.llm_phase_mode,
      overview.input_hash,
      overview.run_id ?? null,
      overview.step_run_id ?? null,
      overview.summary_text,
      JSON.stringify(overview.claims ?? []),
      JSON.stringify(overview.disclosures ?? []),
      JSON.stringify((overview as any).overview_json ?? null),
      JSON.stringify((overview as any).consistency_warnings ?? []),
    ]
  );

  return { inserted: (res as any)?.rowCount === 1 };
}

async function persistDiagnosticsSnapshotBestEffort(args: {
  pool: Pool;
  dealId: string;
  reportId: string;
  llm_phase_mode: LLMPhaseMode;
  overlay?: Pick<GovernedLLMOverviewV1, "llm_phase_mode" | "claims"> | null;
  provider_error_count?: number;
  model_output_truncated_count?: number;
  model_output_not_json_count?: number;
  guard_degraded_count?: number;
}): Promise<void> {
  const pool = args.pool;

  try {
    const tableOk = await hasTable(pool, "deal_analysis_diagnostics");
    if (!tableOk) return;

    const claims = Array.isArray(args.overlay?.claims) ? args.overlay.claims : [];
    const docIdsRaw: string[] = [];
    for (const c of claims as any[]) {
      const refs = Array.isArray(c?.evidence_refs) ? c.evidence_refs : [];
      for (const r of refs) {
        const id = typeof r?.document_id === "string" ? String(r.document_id).trim() : "";
        if (id) docIdsRaw.push(id);
      }
    }

    const docIds = Array.from(new Set(docIdsRaw)).filter(isUuidLike);

    let documentsById: DocumentIndexLite | null = null;
    if (docIds.length > 0) {
      const { rows } = await pool.query<{ id: string; page_count: number | null }>(
        `SELECT id::text AS id, page_count
           FROM documents
          WHERE id = ANY($1::uuid[])`,
        [docIds]
      );
      documentsById = new Map();
      for (const r of rows) {
        if (!r?.id) continue;
        documentsById.set(r.id, { page_count: typeof r.page_count === "number" ? r.page_count : null });
      }
    }

    // Drift + deterministic coverage are derived from the latest persisted DIO snapshot.
    let dioData: any = null;
    try {
      const { rows } = await pool.query<{ dio_data: any }>(
        `SELECT dio_data
           FROM deal_intelligence_objects
          WHERE deal_id = $1::uuid
          ORDER BY analysis_version DESC
          LIMIT 1`,
        [args.dealId]
      );
      dioData = rows?.[0]?.dio_data ?? null;
    } catch {
      dioData = null;
    }

    // Evidence coverage: node-backed evidence is approximated by presence of visual_asset_id.
    let evidenceVisualAssetById: Map<string, string> | null = null;
    try {
      const sectionsCandidates: any[] = [
        dioData?.computed_score_breakdown_v1,
        dioData?.dio?.phase1?.executive_summary_v2?.score_breakdown_v1,
        dioData?.dio?.phase1?.score_breakdown_v1,
        dioData?.dio?.phase1?.executive_summary_v1?.score_breakdown_v1,
      ];
      let sections: any[] = [];
      for (const cand of sectionsCandidates) {
        if (Array.isArray(cand?.sections)) {
          sections = cand.sections;
          break;
        }
      }

      const linkedIdsAll: string[] = [];
      for (const s of sections) {
        const linked = Array.isArray(s?.evidence_ids_linked)
          ? s.evidence_ids_linked.filter((v: any) => typeof v === "string" && v.trim().length > 0)
          : [];
        for (const id of linked) linkedIdsAll.push(String(id).trim());
      }

      const uniqueLinkedIds = Array.from(new Set(linkedIdsAll)).filter(isUuidLike);

      if (uniqueLinkedIds.length > 0) {
        const { rows: evRows } = await pool.query<{ id: string; visual_asset_id: string | null }>(
          `SELECT id::text AS id, visual_asset_id::text AS visual_asset_id
             FROM evidence
            WHERE deal_id = $1::uuid
              AND id = ANY($2::uuid[])`,
          [args.dealId, uniqueLinkedIds]
        );
        evidenceVisualAssetById = new Map();
        for (const r of evRows) {
          const id = typeof r?.id === "string" ? r.id.trim() : "";
          const va = typeof r?.visual_asset_id === "string" ? r.visual_asset_id.trim() : "";
          if (id) evidenceVisualAssetById.set(id, va);
        }
      }
    } catch {
      evidenceVisualAssetById = null;
    }

    const overlayMetrics = args.overlay
      ? computeOverlayGovernanceMetrics({ overlay: args.overlay, documentsById })
      : {
        llm_phase_mode: args.llm_phase_mode,
        citation_integrity_percent: null,
        numeric_claims_without_evidence: 0,
        hallucination_count: 0,
      };
    const driftMetrics = computeDriftMetrics({ dioData });
    const deterministicDiagnostics = computeDeterministicDiagnostics({ dioData, evidenceVisualAssetById });

    const providerErrorCount = typeof args.provider_error_count === "number" && Number.isFinite(args.provider_error_count) ? args.provider_error_count : 0;
    const truncatedCount = typeof args.model_output_truncated_count === "number" && Number.isFinite(args.model_output_truncated_count) ? args.model_output_truncated_count : 0;
    const notJsonCount = typeof args.model_output_not_json_count === "number" && Number.isFinite(args.model_output_not_json_count) ? args.model_output_not_json_count : 0;
    const guardDegradedCount = typeof args.guard_degraded_count === "number" && Number.isFinite(args.guard_degraded_count) ? args.guard_degraded_count : 0;

    // Log computed metrics before insert/upsert. Keep this compact (no raw text, no excerpts).
    try {
      console.log(
        JSON.stringify({
          event: "DIAGNOSTICS_METRICS_COMPUTED",
          deal_id: args.dealId,
          report_id: args.reportId,
          llm_phase_mode: args.llm_phase_mode,
          metrics: {
            overlay: {
              citation_integrity_percent: overlayMetrics.citation_integrity_percent,
              numeric_claims_without_evidence: overlayMetrics.numeric_claims_without_evidence,
              hallucination_count: overlayMetrics.hallucination_count,
            },
            drift: {
              semantic_drift_score: driftMetrics.semantic_drift_score,
            },
            deterministic: {
              deterministic_coverage_ratio: deterministicDiagnostics.deterministic_coverage_ratio,
            },
            error_counts: {
              provider_error_count: providerErrorCount,
              model_output_truncated_count: truncatedCount,
              model_output_not_json_count: notJsonCount,
              guard_degraded_count: guardDegradedCount,
            },
          },
          context: {
            overlay_claims_count: Array.isArray(args.overlay?.claims) ? args.overlay!.claims.length : 0,
            overlay_doc_ids_unique_uuid_like_count: docIds.length,
            evidence_visual_asset_map_size: evidenceVisualAssetById ? evidenceVisualAssetById.size : 0,
            dio_loaded: Boolean(dioData),
          },
          ts: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }

    const support = await getDiagnosticsColumnSupport(pool);

    const baseColumns = [
      "deal_id",
      "report_id",
      "llm_phase_mode",
      "citation_integrity_percent",
      "numeric_claims_without_evidence",
      "semantic_drift_score",
      "hallucination_count",
      "deterministic_coverage_ratio",
    ];

    const optionalCols: Array<{ name: keyof DiagnosticsColumnSupport; col: string; value: number }> = [
      { name: "provider_error_count", col: "provider_error_count", value: providerErrorCount },
      { name: "model_output_truncated_count", col: "model_output_truncated_count", value: truncatedCount },
      { name: "model_output_not_json_count", col: "model_output_not_json_count", value: notJsonCount },
      { name: "guard_degraded_count", col: "guard_degraded_count", value: guardDegradedCount },
    ];

    const columns: string[] = [...baseColumns];
    const values: any[] = [
      args.dealId,
      args.reportId,
      args.llm_phase_mode,
      overlayMetrics.citation_integrity_percent,
      overlayMetrics.numeric_claims_without_evidence,
      driftMetrics.semantic_drift_score,
      overlayMetrics.hallucination_count,
      deterministicDiagnostics.deterministic_coverage_ratio,
    ];

    for (const opt of optionalCols) {
      if ((support as any)[opt.name] === true) {
        columns.push(opt.col);
        values.push(opt.value);
      }
    }

    const placeholders = columns.map((_, idx) => (idx === 0 ? "$1::uuid" : `$${idx + 1}`));
    const updateAssignments = columns
      .filter((c) => c !== "deal_id" && c !== "report_id" && c !== "llm_phase_mode")
      .map((c) => `${c} = EXCLUDED.${c}`);

    const sql =
      `INSERT INTO deal_analysis_diagnostics (${columns.join(", ")})\n` +
      `VALUES (${placeholders.join(", ")})\n` +
      `ON CONFLICT (deal_id, report_id, llm_phase_mode) DO UPDATE SET ${updateAssignments.join(", ")}\n` +
      `RETURNING (xmax = 0) AS inserted`; // best-effort insert vs update signal

    // Structured pre-insert log for visibility in cases where the query errors or is cancelled.
    try {
      console.log(
        JSON.stringify({
          event: "DIAGNOSTICS_PERSIST_ATTEMPT",
          deal_id: args.dealId,
          report_id: args.reportId,
          llm_phase_mode: args.llm_phase_mode,
          cols: columns,
          optional_cols_supported: support,
          ts: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }

    const res = await pool.query<{ inserted: boolean }>(sql, values);
    const inserted = Boolean((res as any)?.rows?.[0]?.inserted);

    try {
      console.log(
        JSON.stringify({
          event: "DIAGNOSTICS_PERSIST_OK",
          deal_id: args.dealId,
          report_id: args.reportId,
          llm_phase_mode: args.llm_phase_mode,
          inserted,
          updated: !inserted,
          cols: columns,
          ts: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }
  } catch (err) {
    // Best-effort only. Must never interfere with deterministic or overlay persistence.
    logDiagnosticsPersistFailure({ dealId: args.dealId, reportId: args.reportId, llm_phase_mode: args.llm_phase_mode, err });
  }
}

async function readDealPhaseMode(pool: Pool, dealId: string): Promise<LLMPhaseMode> {
  try {
    const { rows } = await pool.query<{ llm_phase_mode: string | null }>(
      `SELECT llm_phase_mode::text as llm_phase_mode
         FROM deals
        WHERE id = $1::uuid
          AND deleted_at IS NULL
        LIMIT 1`,
      [dealId]
    );
    const mode = String(rows?.[0]?.llm_phase_mode ?? "").trim();
    if (mode === "exploratory" || mode === "stabilizing" || mode === "governed") return mode;
  } catch {
    // ignore
  }
  return "exploratory";
}

async function hasTable(pool: Pool, table: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name=$1
       ) as exists`,
      [table]
    );
    return Boolean((rows as any)?.[0]?.exists);
  } catch {
    return false;
  }
}

async function hasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 as ok
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=$1
          AND column_name=$2
        LIMIT 1`,
      [table, column]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

function coerceSourceArray(value: unknown): Array<{ document_id: string; page_range?: [number, number]; note?: string }> {
  const xs = Array.isArray(value) ? value : [];
  const out: Array<{ document_id: string; page_range?: [number, number]; note?: string }> = [];
  for (const x of xs as any[]) {
    const document_id = typeof x?.document_id === "string" ? x.document_id.trim() : "";
    if (!document_id) continue;
    const pr = Array.isArray(x?.page_range) && x.page_range.length === 2 ? x.page_range : null;
    const page1 = pr && typeof pr[0] === "number" && Number.isFinite(pr[0]) ? Math.floor(pr[0]) : null;
    const page2 = pr && typeof pr[1] === "number" && Number.isFinite(pr[1]) ? Math.floor(pr[1]) : null;
    const note = typeof x?.note === "string" && x.note.trim() ? x.note.trim() : undefined;
    out.push({
      document_id,
      ...(page1 != null && page2 != null ? { page_range: [page1, page2] as [number, number] } : {}),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

async function fetchDpuSnippet(pool: Pool, input: { documentId: string; pageIndex: number }): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ payload: any }>(
      "SELECT payload FROM document_page_understanding WHERE document_id = $1 AND page_index = $2 AND version = 'page_understanding_v1' LIMIT 1",
      [input.documentId, input.pageIndex]
    );
    const payload = rows?.[0]?.payload ?? null;
    if (!payload || typeof payload !== "object") return null;

    const normalized = clampText((payload as any).normalized_text, 2000);
    if (normalized && normalized.length >= 40) return normalized;

    const blocks = (payload as any).text_blocks && typeof (payload as any).text_blocks === "object" ? (payload as any).text_blocks : null;
    const snippet = clampText(blocks?.text_snippet, 2000);
    if (snippet && snippet.length >= 30) return snippet;

    const pageText = clampText((payload as any).page_text, 2000);
    if (pageText && pageText.length >= 30) return pageText;

    const ocrText = clampText(blocks?.ocr_text, 2000);
    return ocrText;
  } catch {
    return null;
  }
}

async function upsertDisplayFactEvidenceBestEffort(pool: Pool, input: {
  dealId: string;
  field: "product_solution" | "market_icp" | "business_model" | "raise_terms";
  documentId: string;
  pageIndex: number;
  snippet: string;
}): Promise<string | null> {
  try {
    const ok = await hasTable(pool, "evidence");
    if (!ok) return null;

    const [hasId, hasEvidenceId] = await Promise.all([
      hasColumn(pool, "evidence", "id"),
      hasColumn(pool, "evidence", "evidence_id"),
    ]);
    // Compatibility: prefer evidence_id (canonical migrations), but accept id for older schemas.
    const pkCol = hasEvidenceId ? "evidence_id" : hasId ? "id" : null;
    if (!pkCol) return null;

    const [hasDealId, hasDocumentId, hasSource, hasKind, hasText, hasExcerpt, hasPage, hasPageNumber, hasConfidence] = await Promise.all([
      hasColumn(pool, "evidence", "deal_id"),
      hasColumn(pool, "evidence", "document_id"),
      hasColumn(pool, "evidence", "source"),
      hasColumn(pool, "evidence", "kind"),
      hasColumn(pool, "evidence", "text"),
      hasColumn(pool, "evidence", "excerpt"),
      hasColumn(pool, "evidence", "page"),
      hasColumn(pool, "evidence", "page_number"),
      hasColumn(pool, "evidence", "confidence"),
    ]);

    if (!hasDealId || !hasSource || !hasKind || !hasText) return null;

    const evidenceId = deterministicUuidFromKey(
      `display_fact_v1|${input.dealId}|${input.field}|${input.documentId}|${String(input.pageIndex)}`
    );

    const cols: string[] = [pkCol, "deal_id"];
    const values: unknown[] = [evidenceId, input.dealId];

    // If both columns exist, populate both with the same deterministic identifier.
    if (pkCol === "evidence_id" && hasId) {
      cols.push("id");
      values.push(evidenceId);
    } else if (pkCol === "id" && hasEvidenceId) {
      cols.push("evidence_id");
      values.push(evidenceId);
    }

    if (hasDocumentId) {
      cols.push("document_id");
      values.push(input.documentId);
    }

    cols.push("source", "kind", "text");
    values.push("display_fact", `display_fact:${input.field}`, input.snippet);

    if (hasExcerpt) {
      cols.push("excerpt");
      values.push(input.snippet.length > 500 ? `${input.snippet.slice(0, 497)}...` : input.snippet);
    }

    const pageNumber = input.pageIndex + 1;
    if (hasPageNumber) {
      cols.push("page_number");
      values.push(pageNumber);
    } else if (hasPage) {
      cols.push("page");
      values.push(pageNumber);
    }

    if (hasConfidence) {
      cols.push("confidence");
      values.push(0.75);
    }

    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
    const updateAssignments = cols
      .filter((c) => c !== pkCol)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");

    const { rows } = await pool.query<{ id?: unknown; evidence_id?: unknown }>(
      `INSERT INTO evidence (${cols.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (${pkCol}) DO UPDATE SET ${updateAssignments}
       RETURNING ${pkCol} AS id, ${pkCol} AS evidence_id`,
      values
    );

    const returned = (rows as any)?.[0] ?? null;
    const picked = (returned as any)?.evidence_id ?? (returned as any)?.id;
    if (typeof picked === "string" && picked.trim()) return picked.trim();
    // Fall back to the deterministic id we attempted to insert.
    return evidenceId;
  } catch {
    return null;
  }
}

function isFallbackSource(note: string | undefined): boolean {
  const n = (note ?? "").toLowerCase();
  return n.includes("fallback_") || n.includes("du fallback_");
}

function sourceKey(s: { document_id: string; page_range?: [number, number] }): string {
  const pr = s.page_range;
  if (!pr) return `${s.document_id}|_`;
  return `${s.document_id}|${String(pr[0])}-${String(pr[1])}`;
}

function classifySnippetSignals(snippetHead: string): {
  isRaiseTerms: boolean;
  isProduct: boolean;
  isMarketIcp: boolean;
  isBusinessModel: boolean;
} {
  const t = snippetHead.toLowerCase();
  const isRaiseTerms =
    /(\braising\b|\braise\b|\bfunding\b|\bterms\b|\bvaluation\b|\bmultiple\b|\bask\b|\$\s*\d|\bpre[-\s]?money\b|\bpost[-\s]?money\b|\bseed\b|\bseries\s*[a-d]\b)/i.test(
      t
    );
  const isMarketIcp = /(\bcustomer\b|\bcustomers\b|\btarget\b|\baudience\b|\bmarket\b|\bicp\b|\bwho\s+we\s+serve\b)/i.test(t);
  const isBusinessModel =
    /(\brevenue\b|\bbusiness\s*model\b|\bsubscription\b|\bmarketplace\b|\blicens\w*\b|\bpricing\b|\bhow\s+we\s+make\s+money\b)/i.test(t);
  const isProduct =
    /(\bproduct\b|\bplatform\b|\bsolution\b|\bwhat\s+we\s+do\b|\bdescription\b|\boverview\b|\bdefinition\b|\btagline\b)/i.test(t) &&
    !isRaiseTerms;
  return { isRaiseTerms, isProduct, isMarketIcp, isBusinessModel };
}

async function pickSourcesForField(pool: Pool, input: {
  sources: Array<{ document_id: string; page_range?: [number, number]; note?: string }>;
  field: "product_solution" | "market_icp" | "business_model" | "raise_terms";
  usedKeys: Set<string>;
  avoidDuplicateWithUsed?: boolean;
  /** Source keys (via sourceKey()) already claimed by raise_terms; hard-excluded from product_solution unless pool exhausted. */
  diversityExcludeSrcKeys?: Set<string>;
}): Promise<Array<{ document_id: string; page_range?: [number, number]; note?: string }>> {
  const usable = input.sources.filter((s) => !isFallbackSource(s.note));
  if (usable.length === 0) return [];

  // Diversity guard: exclude raise_terms-claimed pages from product_solution; fall back to full pool if needed.
  const applyDiversityGuard = (
    xs: Array<{ document_id: string; page_range?: [number, number]; note?: string }>
  ) => {
    if (!input.diversityExcludeSrcKeys?.size) return xs;
    const filtered = xs.filter((s) => !input.diversityExcludeSrcKeys!.has(sourceKey(s)));
    if (filtered.length === 0) {
      if (process.env.NODE_ENV !== "production") {
        try {
          console.log(
            JSON.stringify({
              event: "GOVERNED_DIVERSITY_GUARD_FALLBACK",
              field: input.field,
              all_raise_pages_claimed: xs.length,
            })
          );
        } catch { /* ignore */ }
      }
      return xs; // fallback: pool exhausted, allow reuse
    }
    return filtered;
  };
  const usableForField = applyDiversityGuard(usable);

  const noteRx =
    input.field === "raise_terms"
      ? /(raise|raising|funding|ask|raise_terms|terms|valuation)/i
      : input.field === "business_model"
        ? /(business\s*model|business_model|revenue|saas|subscription|marketplace|licens|services|pricing)/i
        : input.field === "market_icp"
          ? /(icp|market|customers|who\s+we\s+serve|target|audience)/i
          : /(definition|tagline|product|scored:product|from heading|verb|platform|solution|what we do|overview)/i;

  const raiseLikeNoteRx = /(raise|raising|funding|terms|valuation|ask)/i;

  const applyDedupePreference = (xs: Array<{ document_id: string; page_range?: [number, number]; note?: string }>) => {
    if (!input.avoidDuplicateWithUsed) return xs;
    const preferred = xs.filter((s) => !input.usedKeys.has(sourceKey(s)));
    return preferred.length > 0 ? preferred : xs;
  };

  // 1) Note regex first.
  let direct = usableForField.filter((s) => noteRx.test(String(s.note ?? "")));
  if (input.field === "product_solution") {
    // Hard guard: never pick raise-like sources for product_solution.
    direct = direct.filter((s) => !raiseLikeNoteRx.test(String(s.note ?? "")));
  }
  direct = applyDedupePreference(direct);
  if (direct.length > 0) return direct.slice(0, 3);

  // 2) Lightweight snippet classifier (first ~400 chars) as best-effort routing.
  const scored: Array<{ s: { document_id: string; page_range?: [number, number]; note?: string }; score: number }> = [];
  for (const s of applyDedupePreference(usableForField)) {
    const startPage = s.page_range?.[0];
    const page = typeof startPage === "number" && Number.isFinite(startPage) ? startPage : null;
    const pageIndex = page != null ? Math.max(0, page - 1) : null;
    if (pageIndex == null) continue;
    const snippet = await fetchDpuSnippet(pool, { documentId: s.document_id, pageIndex });
    const head = (snippet ?? "").slice(0, 400);
    if (!head) continue;
    const signals = classifySnippetSignals(head);

    let score = 0;
    if (input.field === "raise_terms" && signals.isRaiseTerms) score += 3;
    if (input.field === "product_solution" && signals.isProduct) score += 3;
    if (input.field === "market_icp" && signals.isMarketIcp) score += 3;
    if (input.field === "business_model" && signals.isBusinessModel) score += 3;

    // Additional guardrails.
    if (input.field === "product_solution" && signals.isRaiseTerms) score -= 5;
    if (input.field !== "raise_terms" && signals.isRaiseTerms) score -= 1;

    if (score > 0) scored.push({ s, score });
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map((x) => x.s);
  }

  // 3) Final fallback: best-effort ordering assumption from builder (product, market, raise, business model),
  // but with a hard guard for product_solution to avoid raise-like notes.
  const preferredIdx =
    input.field === "product_solution" ? 0 : input.field === "market_icp" ? 1 : input.field === "raise_terms" ? 2 : 3;
  const idx = Math.min(Math.max(0, preferredIdx), Math.max(0, usableForField.length - 1));
  const sliced = usableForField.slice(idx, idx + 1);
  if (input.field === "product_solution" && sliced.length > 0) {
    const picked = sliced[0];
    if (raiseLikeNoteRx.test(String(picked.note ?? ""))) {
      const alt = usableForField.find((s) => !raiseLikeNoteRx.test(String(s.note ?? "")));
      if (alt) return [alt];
    }
  }
  return sliced;
}

export type GlobalSummarySource = {
  document_id: string;
  page_range: [number, number];
  note: string;
};

/**
 * Gathers a broad, deterministic source list spanning the full deck.
 * Hard constraint: max 1 source per page.
 * Pages are bucketed across the deck and top-scored entries per bucket are picked first,
 * then remaining slots filled by score DESC for deck-wide coverage.
 * Stable across repeated runs for the same database state.
 */
export async function gatherGlobalSummarySources(
  pool: Pool,
  input: {
    documentIds: string[];
    targetCount?: number;
  }
): Promise<{ sources: GlobalSummarySource[]; total_pages: number }> {
  const { documentIds, targetCount = 30 } = input;
  const validIds = documentIds.filter(
    (id) => typeof id === "string" && id.trim().length > 8
  );
  if (!validIds.length) return { sources: [], total_pages: 0 };

  let rows: Array<{ document_id: string; page_index: number; payload: unknown }> = [];
  try {
    const result = await pool.query<{
      document_id: string;
      page_index: number;
      payload: unknown;
    }>(
      `SELECT document_id::text AS document_id, page_index, payload
       FROM document_page_understanding
       WHERE document_id = ANY($1::uuid[])
         AND version = 'page_understanding_v1'
       ORDER BY document_id, page_index`,
      [validIds]
    );
    rows = Array.isArray(result.rows) ? result.rows : [];
  } catch {
    return { sources: [], total_pages: 0 };
  }

  type ScoredEntry = {
    document_id: string;
    page_index: number;
    signals: ReturnType<typeof classifySnippetSignals>;
    score: number;
  };
  const entries: ScoredEntry[] = [];
  const seenPageKeys = new Set<string>();

  for (const row of rows) {
    const key = `${row.document_id}:${row.page_index}`;
    if (seenPageKeys.has(key)) continue; // enforce max 1 per page
    seenPageKeys.add(key);
    const payload =
      row.payload && typeof row.payload === "object" ? (row.payload as any) : null;
    const snippet =
      clampText(payload?.normalized_text, 2000) ||
      clampText(payload?.text_blocks?.text_snippet, 2000) ||
      clampText(payload?.page_text, 2000) ||
      clampText(payload?.text_blocks?.ocr_text, 2000) ||
      "";
    if (!snippet || snippet.length < 20) continue;

    const signals = classifySnippetSignals(snippet.slice(0, 400));
    const score =
      (signals.isProduct ? 2 : 0) +
      (signals.isMarketIcp ? 2 : 0) +
      (signals.isBusinessModel ? 2 : 0) +
      (signals.isRaiseTerms ? 1 : 0) +
      (snippet.length > 100 ? 1 : 0);

    entries.push({ document_id: row.document_id, page_index: row.page_index, signals, score });
  }

  const total_pages = entries.length;
  if (!total_pages) return { sources: [], total_pages: 0 };

  const BUCKET_COUNT = Math.min(8, Math.max(5, Math.ceil(total_pages / 5)));
  const bucketSize = Math.max(1, Math.ceil(total_pages / BUCKET_COUNT));
  const buckets: ScoredEntry[][] = Array.from({ length: BUCKET_COUNT }, () => []);

  for (let i = 0; i < entries.length; i++) {
    const bucketIdx = Math.min(BUCKET_COUNT - 1, Math.floor(i / bucketSize));
    buckets[bucketIdx].push(entries[i]);
  }

  // Sort each bucket: score DESC, page_index ASC for deterministic ordering.
  for (const bucket of buckets) {
    bucket.sort((a, b) => b.score - a.score || a.page_index - b.page_index);
  }

  const perBucketTarget = Math.max(1, Math.ceil(targetCount / BUCKET_COUNT));
  const selected: ScoredEntry[] = [];
  const selectedKeys = new Set<string>();

  // Round 1: pick top-K per bucket for coverage.
  for (const bucket of buckets) {
    let picked = 0;
    for (const e of bucket) {
      if (picked >= perBucketTarget) break;
      const key = `${e.document_id}:${e.page_index}`;
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(e);
      picked++;
    }
  }

  // Round 2: fill remaining slots by score DESC from not-yet-selected entries.
  if (selected.length < targetCount) {
    const remaining = entries
      .filter((e) => !selectedKeys.has(`${e.document_id}:${e.page_index}`))
      .sort((a, b) => b.score - a.score || a.page_index - b.page_index);
    for (const e of remaining) {
      if (selected.length >= targetCount) break;
      selected.push(e);
    }
  }

  // Stable final sort: document_id ASC, page_index ASC.
  selected.sort(
    (a, b) => a.document_id.localeCompare(b.document_id) || a.page_index - b.page_index
  );

  const sources: GlobalSummarySource[] = selected.map((e) => {
    const page1Based = e.page_index + 1;
    const note =
      e.signals.isProduct
        ? "global_product"
        : e.signals.isMarketIcp
          ? "global_market"
          : e.signals.isBusinessModel
            ? "global_business_model"
            : e.signals.isRaiseTerms
              ? "global_raise_terms"
              : "global_context";
    return { document_id: e.document_id, page_range: [page1Based, page1Based], note };
  });

  return { sources, total_pages };
}

async function generateDisplayFactsV1BestEffort(args: {
  pool: Pool;
  dealId: string;
  nowIso: string;
  llm_phase_mode: LLMPhaseMode;
  phase1_deal_overview_v2?: unknown;
  /** Broad coverage sources from gatherGlobalSummarySources; extends per-field evidence pool. */
  global_summary_sources?: GlobalSummarySource[];
}): Promise<{ display_facts_v1: DisplayFactsV1 | null; quality: DisplayFactsQualityV1; deterministic_input: unknown; providerMeta?: { model: string } }>{
  const overview = args.phase1_deal_overview_v2 && typeof args.phase1_deal_overview_v2 === "object" ? (args.phase1_deal_overview_v2 as any) : null;
  const narrowSources = coerceSourceArray(overview?.sources);
  // Extend the candidate pool with global sources (narrow sources take priority; dups removed by sourceKey).
  const narrowSrcKeys = new Set(narrowSources.map(sourceKey));
  const globalFiltered = (args.global_summary_sources ?? []).filter(
    (gs) => !narrowSrcKeys.has(sourceKey(gs))
  );
  const extendedPool = [...narrowSources, ...globalFiltered];

  type Ev = { evidence_id: string; document_id: string; page_index: number; snippet: string };

  const buildEvidenceForField = async (
    field: "product_solution" | "market_icp" | "business_model" | "raise_terms",
    picked: Array<{ document_id: string; page_range?: [number, number]; note?: string }>
  ): Promise<Ev[]> => {
    const out: Ev[] = [];
    for (const s of picked) {
      const startPage = s.page_range?.[0];
      const endPage = s.page_range?.[1];
      const page = typeof startPage === "number" && Number.isFinite(startPage) ? startPage : null;
      const pageIndex = page != null ? Math.max(0, page - 1) : null;
      if (pageIndex == null) continue;
      const snippet = await fetchDpuSnippet(args.pool, { documentId: s.document_id, pageIndex });
      if (!snippet) continue;
      const evidence_id = await upsertDisplayFactEvidenceBestEffort(args.pool, {
        dealId: args.dealId,
        field,
        documentId: s.document_id,
        pageIndex,
        snippet,
      });
      if (!evidence_id) continue;
      out.push({ evidence_id, document_id: s.document_id, page_index: pageIndex, snippet });
      if (out.length >= 3) break;
    }
    return out;
  };

  // Source picking order: raise_terms first so its claimed pages can be excluded from product_solution
  // via the diversity guard, preventing raise/hiring slides from polluting product copy.
  const usedKeys = new Set<string>();

  const pickedRaise = await pickSourcesForField(args.pool, {
    sources: extendedPool,
    field: "raise_terms",
    usedKeys,
    avoidDuplicateWithUsed: true,
  });
  for (const s of pickedRaise) usedKeys.add(sourceKey(s));

  // Pages claimed by raise_terms are hard-excluded from product_solution (diversity guard).
  const raiseClaimedSrcKeys = new Set(pickedRaise.map(sourceKey));

  const pickedProduct = await pickSourcesForField(args.pool, {
    sources: extendedPool,
    field: "product_solution",
    usedKeys,
    avoidDuplicateWithUsed: true,
    diversityExcludeSrcKeys: raiseClaimedSrcKeys,
  });
  for (const s of pickedProduct) usedKeys.add(sourceKey(s));

  const pickedMarket = await pickSourcesForField(args.pool, {
    sources: extendedPool,
    field: "market_icp",
    usedKeys,
    avoidDuplicateWithUsed: true,
  });
  for (const s of pickedMarket) usedKeys.add(sourceKey(s));

  const pickedModel = await pickSourcesForField(args.pool, {
    sources: extendedPool,
    field: "business_model",
    usedKeys,
    avoidDuplicateWithUsed: true,
  });

  const [productEvidence, raiseEvidence, marketEvidence, modelEvidence] = await Promise.all([
    buildEvidenceForField("product_solution", pickedProduct),
    buildEvidenceForField("raise_terms", pickedRaise),
    buildEvidenceForField("market_icp", pickedMarket),
    buildEvidenceForField("business_model", pickedModel),
  ]);

  const deterministic_input = {
    schema_version: "display_facts_v1_input_v1",
    product_solution: productEvidence.map((e) => ({ evidence_id: e.evidence_id, document_id: e.document_id, page_index: e.page_index, snippet_head: e.snippet.slice(0, 120) })),
    market_icp: marketEvidence.map((e) => ({ evidence_id: e.evidence_id, document_id: e.document_id, page_index: e.page_index, snippet_head: e.snippet.slice(0, 120) })),
    business_model: modelEvidence.map((e) => ({ evidence_id: e.evidence_id, document_id: e.document_id, page_index: e.page_index, snippet_head: e.snippet.slice(0, 120) })),
    raise_terms: raiseEvidence.map((e) => ({ evidence_id: e.evidence_id, document_id: e.document_id, page_index: e.page_index, snippet_head: e.snippet.slice(0, 120) })),
  };

  const allEvidenceIds = new Set<string>([
    ...productEvidence.map((e) => e.evidence_id),
    ...marketEvidence.map((e) => e.evidence_id),
    ...modelEvidence.map((e) => e.evidence_id),
    ...raiseEvidence.map((e) => e.evidence_id),
  ]);

  const qualityBase: DisplayFactsQualityV1 = {
    generated_at: args.nowIso,
    model: null,
    ok: false,
    guard_degraded: false,
  };

  if (allEvidenceIds.size === 0) {
    const noEvidence: DisplayFactFieldV1 = { text: null, evidence_ids: [], evidence_basis: "no_evidence" };
    return {
      display_facts_v1: {
        schema_version: "display_facts_v1",
        product_solution: noEvidence,
        market_icp: noEvidence,
        business_model: noEvidence,
        raise_terms: noEvidence,
      },
      quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" },
      deterministic_input,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      display_facts_v1: null,
      quality: { ...qualityBase, skipped_reason: "missing_openai_api_key" },
      deterministic_input,
    };
  }

  const providerConfig: ProviderConfig = {
    type: "openai",
    enabled: true,
    priority: 1,
    apiKey,
    timeout: 30_000,
    retries: 2,
  };

  const provider = new OpenAIGPT4oProvider(providerConfig);

  const system =
    "You are a deal analyst. Convert noisy deterministic OCR snippets into clean, investor-readable short statements. " +
    "Use ONLY the provided snippets. Do not invent facts or numbers. " +
    "IMPORTANT: evidence_ids MUST be chosen ONLY from the allowed IDs for that field. " +
    "Allowed IDs for each field are provided as allowed_evidence_ids.<field> and also appear as fields.<field>[].evidence_id. " +
    "Never output evidence_ids that are not in the allowed list for that field. " +
    "If the snippets are insufficient for a field, set text=null, evidence_ids=[], evidence_basis=\"no_evidence\". " +
    "Output MUST be valid JSON only (no markdown). " +
    "Return JSON with EXACT keys: product_solution, market_icp, business_model, raise_terms. " +
    "Each value MUST be an object {text: string|null, evidence_ids: string[], evidence_basis: \"direct_snippet\"|\"no_evidence\"}. " +
    "If evidence_ids is non-empty, evidence_basis MUST be \"direct_snippet\" and text MUST be non-empty. " +
    "Keep each text under 220 characters. Remove OCR artifacts (duplicated spaces, broken words, stray punctuation).";

  const payload = {
    deal_id: args.dealId,
    llm_phase_mode: args.llm_phase_mode,
    allowed_evidence_ids: {
      product_solution: productEvidence.map((e) => e.evidence_id),
      market_icp: marketEvidence.map((e) => e.evidence_id),
      business_model: modelEvidence.map((e) => e.evidence_id),
      raise_terms: raiseEvidence.map((e) => e.evidence_id),
    },
    fields: {
      product_solution: productEvidence,
      market_icp: marketEvidence,
      business_model: modelEvidence,
      raise_terms: raiseEvidence,
    },
  };

  const response = await provider.complete({
    task: "synthesis",
    model: "gpt-4o-mini" as any,
    temperature: 0,
    max_tokens: 700,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) },
    ],
    metadata: { dealId: args.dealId, kind: "display_facts_v1" },
  });

  const parsed = safeJsonParseObject(response?.content);
  if (!parsed) {
    return {
      display_facts_v1: null,
      quality: { ...qualityBase, model: "gpt-4o-mini", ok: false, guard_degraded: false, errors: ["model_output_not_json"] },
      deterministic_input,
      providerMeta: { model: "gpt-4o-mini" },
    };
  }

  const errors: string[] = [];
  const noEvidenceField: DisplayFactFieldV1 = { text: null, evidence_ids: [], evidence_basis: "no_evidence" };

  const allowedIdsByField: Record<keyof DisplayFactsV1, string[]> = {
    product_solution: productEvidence.map((e) => e.evidence_id),
    market_icp: marketEvidence.map((e) => e.evidence_id),
    business_model: modelEvidence.map((e) => e.evidence_id),
    raise_terms: raiseEvidence.map((e) => e.evidence_id),
    schema_version: [],
  } as any;

  const repairFieldEvidenceIdsBestEffort = (key: keyof DisplayFactsV1) => {
    if (key === "schema_version") return;
    const raw = (parsed as any)[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;

    const allowed = allowedIdsByField[key] ?? [];
    if (allowed.length === 0) return;
    const allowedSet = new Set(allowed);

    const evidence_ids_raw: unknown[] = Array.isArray((raw as any).evidence_ids) ? ((raw as any).evidence_ids as unknown[]) : [];
    const evidenceIdsInput = Array.from(
      new Set(
        evidence_ids_raw
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim())
      )
    ).slice(0, 6);

    const hasAnyOutOfField = evidenceIdsInput.some((id) => !allowedSet.has(id));
    const hasAnyInField = evidenceIdsInput.some((id) => allowedSet.has(id));
    if (!hasAnyOutOfField && hasAnyInField) return;

    // If the model returned bogus/cross-field ids but we have deterministic candidates for this field,
    // prefer a repair that keeps text when possible.
    const repairedIds = allowed.slice(0, 3);
    const text = clampText((raw as any).text, 220);
    const hasText = typeof text === "string" && text.trim().length > 0;

    if (!hasText) {
      (raw as any).text = null;
      (raw as any).evidence_ids = [];
      (raw as any).evidence_basis = "no_evidence";
      errors.push(`${String(key)}_evidence_ids_repaired_no_text`);
      return;
    }

    (raw as any).text = text;
    (raw as any).evidence_ids = repairedIds;
    (raw as any).evidence_basis = "direct_snippet";
    errors.push(`${String(key)}_evidence_ids_repaired_to_allowed`);
  };

  repairFieldEvidenceIdsBestEffort("product_solution" as any);
  repairFieldEvidenceIdsBestEffort("market_icp" as any);
  repairFieldEvidenceIdsBestEffort("business_model" as any);
  repairFieldEvidenceIdsBestEffort("raise_terms" as any);

  // Coerce and sanitize one field at a time.
  // Key behavior change: out-of-scope evidence_ids no longer fail the entire display_facts_v1;
  // they are filtered per-field and may downgrade that field to no_evidence.
  const coerceField = (key: keyof DisplayFactsV1): DisplayFactFieldV1 => {
    const raw = (parsed as any)[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${String(key)}_missing`);
      return noEvidenceField;
    }

    const evidence_basis = (raw as any).evidence_basis;
    const basis: DisplayFactsBasisV1 | null =
      evidence_basis === "direct_snippet" || evidence_basis === "no_evidence" ? evidence_basis : null;

    const evidence_ids_raw: unknown[] = Array.isArray((raw as any).evidence_ids) ? ((raw as any).evidence_ids as unknown[]) : [];
    const evidence_ids_input: string[] = Array.from(
      new Set(
        evidence_ids_raw
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim())
      )
    ).slice(0, 6);

    const inScopeEvidenceIds: string[] = evidence_ids_input.filter((id) => allEvidenceIds.has(id));
    const sawOutOfScope = evidence_ids_input.some((id) => !allEvidenceIds.has(id));
    if (sawOutOfScope) {
      errors.push(`${String(key)}_evidence_id_out_of_scope_sanitized`);
    }

    const text = clampText((raw as any).text, 220);

    // Strictness: never allow text without evidence, and never allow direct_snippet without evidence.
    if (inScopeEvidenceIds.length > 0) {
      if (basis !== "direct_snippet") {
        errors.push(`${String(key)}_basis_invalid_for_evidence`);
        return noEvidenceField;
      }
      if (!text) {
        errors.push(`${String(key)}_text_missing_with_evidence`);
        return noEvidenceField;
      }
      return { text: text ?? null, evidence_ids: inScopeEvidenceIds, evidence_basis: "direct_snippet" };
    }

    if (basis !== "no_evidence") {
      // Evidence-free fields must explicitly use no_evidence.
      errors.push(`${String(key)}_basis_expected_no_evidence`);
    }
    if (text != null) {
      errors.push(`${String(key)}_text_present_without_evidence`);
    }
    return noEvidenceField;
  };

  const product_solution = coerceField("product_solution" as any);
  const market_icp = coerceField("market_icp" as any);
  const business_model = coerceField("business_model" as any);
  const raise_terms = coerceField("raise_terms" as any);

  const anyEvidenceAfter =
    product_solution.evidence_ids.length > 0 ||
    market_icp.evidence_ids.length > 0 ||
    business_model.evidence_ids.length > 0 ||
    raise_terms.evidence_ids.length > 0;

  // If the provider returned JSON but sanitization/strictness zeroed all evidence, treat as no_evidence.
  if (!anyEvidenceAfter) {
    return {
      display_facts_v1: {
        schema_version: "display_facts_v1",
        product_solution: noEvidenceField,
        market_icp: noEvidenceField,
        business_model: noEvidenceField,
        raise_terms: noEvidenceField,
      },
      quality: {
        ...qualityBase,
        model: "gpt-4o-mini",
        ok: true,
        skipped_reason: "no_evidence",
        guard_degraded: errors.length > 0,
        ...(errors.length > 0 ? { errors } : {}),
      },
      deterministic_input,
      providerMeta: { model: "gpt-4o-mini" },
    };
  }

  return {
    display_facts_v1: {
      schema_version: "display_facts_v1",
      product_solution,
      market_icp,
      business_model,
      raise_terms,
    },
    quality: {
      ...qualityBase,
      model: "gpt-4o-mini",
      ok: true,
      guard_degraded: errors.length > 0,
      ...(errors.length > 0 ? { errors } : {}),
    },
    deterministic_input,
    providerMeta: { model: "gpt-4o-mini" },
  };
}

function extractNumericTokens(s: string): string[] {
  if (!s) return [];
  const out = new Set<string>();
  const matches = s.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const m of matches) out.add(m);
  return Array.from(out);
}

function violatesNumericCitationGuard(args: { output: string; input: string }): boolean {
  const outNums = extractNumericTokens(args.output);
  if (outNums.length === 0) return false;
  const input = args.input ?? "";
  for (const n of outNums) {
    if (!input.includes(n)) return true;
  }
  return false;
}

function clampMaybeText(v: unknown, maxLen: number): string | null {
  const s = clampText(v, maxLen);
  return s ? s : null;
}

/**
 * Phrases that indicate internal scoring mechanics and must never appear in
 * UI-visible strengths / concerns / open_questions lists.
 */
export const SCORE_MECHANIC_BLOCK_PHRASES: readonly string[] = [
  "narrative pacing",
  "score computed",
  "component weighting",
  "score mechanic",
  "weighted score",
  "scoring component",
  "deck score",
  "slide score",
  "scoring engine",
  "score: ",
];

/**
 * Filters a list of strings to remove any that contain score-mechanic language.
 * Exported for unit testing.
 */
export function sanitizeGovernedListField(items: string[]): string[] {
  return items.filter((s) => {
    const lower = s.toLowerCase();
    return !SCORE_MECHANIC_BLOCK_PHRASES.some((phrase) => lower.includes(phrase));
  });
}

async function generateGovernedUiCopyV1BestEffort(args: {
  dealId: string;
  nowIso: string;
  llm_phase_mode: LLMPhaseMode;
  display_facts_v1: DisplayFactsV1 | null;
  display_facts_v1_input_v1: any | null;
  phase1_deal_summary_v2?: unknown;
  phase1_deal_overview_v2?: unknown;
}): Promise<{ governed_ui_copy_v1: GovernedUiCopyV1 | null; quality: GovernedUiCopyQualityV1; deterministic_input: unknown }> {
  const qualityBase: GovernedUiCopyQualityV1 = {
    generated_at: args.nowIso,
    model: null,
    ok: false,
    guard_degraded: false,
  };

  const df = args.display_facts_v1;
  if (!df) {
    return {
      governed_ui_copy_v1: null,
      quality: { ...qualityBase, ok: true, skipped_reason: "missing_display_facts_v1" },
      deterministic_input: { schema_version: "governed_ui_copy_v1_input_v1", skipped: true },
    };
  }

  const basis = {
    product_solution: { text: df.product_solution?.text ?? null, evidence_ids: Array.isArray(df.product_solution?.evidence_ids) ? df.product_solution.evidence_ids : [] },
    market_icp: { text: df.market_icp?.text ?? null, evidence_ids: Array.isArray(df.market_icp?.evidence_ids) ? df.market_icp.evidence_ids : [] },
    business_model: { text: df.business_model?.text ?? null, evidence_ids: Array.isArray(df.business_model?.evidence_ids) ? df.business_model.evidence_ids : [] },
    raise_terms: { text: df.raise_terms?.text ?? null, evidence_ids: Array.isArray(df.raise_terms?.evidence_ids) ? df.raise_terms.evidence_ids : [] },
  };

  const collapseWs = (s: string): string => String(s).replace(/\s+/g, " ").trim();

  const coerceEvidenceRefs = (arr: any): Array<{ source_document_id: string; page_index: number; snippet?: string }> => {
    const xs = Array.isArray(arr) ? arr : [];
    const out: Array<{ source_document_id: string; page_index: number; snippet?: string }> = [];
    for (const x of xs) {
      const source_document_id = typeof x?.document_id === "string" ? x.document_id.trim() : "";
      const page_index = typeof x?.page_index === "number" && Number.isFinite(x.page_index) ? Math.max(0, Math.floor(x.page_index)) : null;
      if (!source_document_id || page_index == null) continue;
      const snippetHead = typeof x?.snippet_head === "string" ? collapseWs(x.snippet_head) : "";
      out.push({
        source_document_id,
        page_index,
        ...(snippetHead ? { snippet: snippetHead.slice(0, 420) } : {}),
      });
      if (out.length >= 6) break;
    }
    return out;
  };

  const dfInput = args.display_facts_v1_input_v1 && typeof args.display_facts_v1_input_v1 === "object" ? args.display_facts_v1_input_v1 : null;
  const evidence_map_fields = {
    product_solution: coerceEvidenceRefs(dfInput?.product_solution),
    market_icp: coerceEvidenceRefs(dfInput?.market_icp),
    business_model: coerceEvidenceRefs(dfInput?.business_model),
    raise_terms: coerceEvidenceRefs(dfInput?.raise_terms),
  };
  const deal_summary_mid_refs = Array.from(
    new Map(
      [...evidence_map_fields.product_solution, ...evidence_map_fields.market_icp, ...evidence_map_fields.business_model, ...evidence_map_fields.raise_terms]
        .map((r) => [`${r.source_document_id}|${r.page_index}|${r.snippet ?? ""}`, r] as const)
    ).values()
  ).slice(0, 8);

  const coerceStringArray = (v: unknown, max: number): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of v) {
      if (typeof x !== "string") continue;
      const s = collapseWs(x);
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  };

  const phase1Summary = args.phase1_deal_summary_v2 && typeof args.phase1_deal_summary_v2 === "object" ? (args.phase1_deal_summary_v2 as any) : null;
  const tractionFromOverview = args.phase1_deal_overview_v2 && typeof args.phase1_deal_overview_v2 === "object" ? (args.phase1_deal_overview_v2 as any).traction_signals : null;
  const rawStrengths = coerceStringArray(phase1Summary?.strengths, 10);
  const rawConcerns = coerceStringArray(phase1Summary?.risks, 10);
  const rawOpenQuestions = coerceStringArray(phase1Summary?.open_questions, 10);
  const traction = coerceStringArray(tractionFromOverview, 10);

  // Sanitize internal score-mechanic language from any upstream source.
  const strengths = sanitizeGovernedListField(rawStrengths);
  const concerns = sanitizeGovernedListField(rawConcerns);
  const open_questions = sanitizeGovernedListField(rawOpenQuestions);

  const deterministic_input = {
    schema_version: "governed_ui_copy_v1_input_v1",
    deal_id: args.dealId,
    llm_phase_mode: args.llm_phase_mode,
    basis,
    evidence_map_basis_v1: {
      deal_summary_mid: deal_summary_mid_refs,
      ...evidence_map_fields,
    },
    mirrored_lists_v1: {
      traction,
      strengths,
      concerns,
      open_questions,
    },
  };

  // If there is no evidence anywhere, fail closed (no governed copy).
  const anyEvidence =
    basis.product_solution.evidence_ids.length > 0 ||
    basis.market_icp.evidence_ids.length > 0 ||
    basis.business_model.evidence_ids.length > 0 ||
    basis.raise_terms.evidence_ids.length > 0;

  if (!anyEvidence) {
    return {
      governed_ui_copy_v1: {
        schema_version: "governed_ui_copy_v1",
        deal_summary_mid: null,
        hero_summary: null,
        product_solution: null,
        market_icp: null,
        business_model: null,
        raise_terms: null,
        traction: [],
        strengths: [],
        concerns: [],
        open_questions: [],
        evidence_map: {
          deal_summary_mid: [],
          product_solution: [],
          market_icp: [],
          business_model: [],
          raise_terms: [],
          traction: [],
          strengths: [],
          concerns: [],
          open_questions: [],
        },
        evidence_ids: {
          product_solution: [],
          market_icp: [],
          business_model: [],
          raise_terms: [],
          hero_summary: [],
        },
      },
      quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" },
      deterministic_input,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      governed_ui_copy_v1: null,
      quality: { ...qualityBase, skipped_reason: "missing_openai_api_key" },
      deterministic_input,
    };
  }

  const providerConfig: ProviderConfig = {
    type: "openai",
    enabled: true,
    priority: 1,
    apiKey,
    timeout: 30_000,
    retries: 2,
  };
  const provider = new OpenAIGPT4oProvider(providerConfig);

  const system =
    "You are a deal analyst writing investor-grade UI copy. " +
    "Rewrite ONLY the provided basis texts. DO NOT invent facts, numbers, features, customers, or claims not present in the basis. " +
    "Use any number ONLY if it appears verbatim in the basis texts or traction_signals. " +
    "If a basis field has text=null, return null for that field. " +
    "Output MUST be valid JSON only (no markdown, no explanation). " +
    "Return JSON with EXACT keys: hero_summary, product_solution, market_icp, business_model, raise_terms. " +
    "Each value MUST be a string or null. " +
    // ── hero_summary ──────────────────────────────────────────────────────
    "hero_summary MUST follow this 2–4 sentence composition contract: " +
    "[S1] What the company does and who it serves — combine product_solution + market_icp into one sentence. " +
    "[S2] How it makes money — from business_model; OMIT if business_model is null. " +
    "[S3, optional] One traction fact — use FIRST item from traction_signals verbatim ONLY if non-empty; otherwise omit. " +
    "[S4, optional] Raise context — one brief sentence from raise_terms ONLY if it has text; otherwise omit. " +
    "hero_summary must be 2–4 sentences total. " +
    // ── product_solution ─────────────────────────────────────────────────
    "product_solution MUST be exactly 2 sentences: " +
    "Sentence 1: what the product or service is AND who it serves (combine both into one sentence). " +
    "Sentence 2: the differentiation, positioning, or delivery model as stated in the basis — " +
    "if neither differentiation nor positioning is present, state the delivery mode or category context. " +
    "Do NOT mention raise, funding, or investment. Do NOT speculate. " +
    // ── market_icp ───────────────────────────────────────────────────────
    "market_icp MUST be exactly 2 sentences: " +
    "Sentence 1: define the ICP — who buys or uses the product (be specific, not generic). " +
    "Sentence 2: industry context, TAM, competitive environment, or growth signal — ONLY if that evidence is present in the basis; " +
    "if no TAM or industry-sizing evidence exists, write exactly: " +
    "'Market size and growth dynamics are not quantified in the provided materials.' " +
    "Do NOT write 'The market is growing' or similar unless the basis explicitly states it. " +
    // ── business_model ───────────────────────────────────────────────────
    "business_model MUST be 1–2 sentences: " +
    "Sentence 1: state the revenue mechanism (subscription, licensing, wholesale, transaction fee, etc.) from the basis. " +
    "Sentence 2 (optional): pricing tier, margin structure, or distribution channel — ONLY if evidence is present. " +
    "If no business model information is present in the basis, return exactly: 'Business model not clearly defined in provided materials.' " +
    // ── quality guards ───────────────────────────────────────────────────
    "NEVER mention internal scoring, confidence levels, or narrative pacing in any field. " +
    "NEVER use vague filler phrases such as 'strong presence', 'significant opportunity', or 'robust growth' unless the basis explicitly uses that language. " +
    "Keep each field under 320 characters.";

  const payload = {
    deal_id: args.dealId,
    llm_phase_mode: args.llm_phase_mode,
    basis,
    // traction_signals are included for optional S3; do NOT fabricate — use verbatim or omit.
    traction_signals: traction.slice(0, 3),
  };

  const response = await provider.complete({
    task: "synthesis",
    model: "gpt-4o-mini" as any,
    temperature: 0,
    max_tokens: 700,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) },
    ],
    metadata: { dealId: args.dealId, kind: "governed_ui_copy_v1" },
  });

  const parsed = safeJsonParseObject(response?.content);
  if (!parsed) {
    return {
      governed_ui_copy_v1: null,
      quality: { ...qualityBase, model: "gpt-4o-mini", ok: false, guard_degraded: false, errors: ["model_output_not_json"] },
      deterministic_input,
    };
  }

  const errors: string[] = [];
  const coerceText = (key: "hero_summary" | "product_solution" | "market_icp" | "business_model" | "raise_terms"): string | null => {
    const raw = (parsed as any)[key];
    if (raw === null) return null;
    const clamped = clampMaybeText(raw, 320);
    if (!clamped) {
      errors.push(`${key}_empty_or_invalid`);
      return null;
    }
    return clamped;
  };

  const hero_summary = coerceText("hero_summary");
  const product_solution = coerceText("product_solution");
  const market_icp = coerceText("market_icp");
  const business_model = coerceText("business_model");
  const raise_terms = coerceText("raise_terms");

  // Fail closed: if basis text is null, output must be null.
  const mustBeNull: Array<[keyof typeof basis, string | null]> = [
    ["product_solution", product_solution],
    ["market_icp", market_icp],
    ["business_model", business_model],
    ["raise_terms", raise_terms],
  ];
  for (const [k, v] of mustBeNull) {
    if (!basis[k].text && v) errors.push(`${String(k)}_present_without_basis`);
  }

  const allBasisText = [
    basis.product_solution.text,
    basis.market_icp.text,
    basis.business_model.text,
    basis.raise_terms.text,
    // Include traction signals so numeric guard can verify numbers in S3 are sourced.
    ...traction,
  ]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join(" \n");

  const numericChecks: Array<[string, string | null]> = [
    ["hero_summary", hero_summary],
    ["product_solution", product_solution],
    ["market_icp", market_icp],
    ["business_model", business_model],
    ["raise_terms", raise_terms],
  ];
  for (const [k, v] of numericChecks) {
    if (!v) continue;
    if (violatesNumericCitationGuard({ output: v, input: allBasisText })) errors.push(`${k}_numeric_not_in_basis`);
  }

  if (errors.length > 0) {
    return {
      governed_ui_copy_v1: null,
      quality: { ...qualityBase, model: "gpt-4o-mini", ok: false, guard_degraded: true, errors },
      deterministic_input,
    };
  }

  // Evidence ids are authoritative; do not accept any evidence ids from model.
  // Sorted lexicographically for determinism across repeated calls.
  const heroEvidence = Array.from(
    new Set([
      ...basis.product_solution.evidence_ids,
      ...basis.market_icp.evidence_ids,
      ...basis.business_model.evidence_ids,
      ...basis.raise_terms.evidence_ids,
    ])
  ).sort().slice(0, 10);

  return {
    governed_ui_copy_v1: {
      schema_version: "governed_ui_copy_v1",
      deal_summary_mid: hero_summary,
      hero_summary,
      product_solution,
      market_icp,
      business_model,
      raise_terms,
      traction,
      strengths,
      concerns,
      open_questions,
      evidence_map: {
        deal_summary_mid: deal_summary_mid_refs,
        product_solution: evidence_map_fields.product_solution,
        market_icp: evidence_map_fields.market_icp,
        business_model: evidence_map_fields.business_model,
        raise_terms: evidence_map_fields.raise_terms,
        traction: [],
        strengths: [],
        concerns: [],
        open_questions: [],
      },
      evidence_ids: {
        product_solution: basis.product_solution.evidence_ids,
        market_icp: basis.market_icp.evidence_ids,
        business_model: basis.business_model.evidence_ids,
        raise_terms: basis.raise_terms.evidence_ids,
        hero_summary: heroEvidence,
      },
    },
    quality: { ...qualityBase, model: "gpt-4o-mini", ok: true, guard_degraded: false },
    deterministic_input,
  };
}

export async function generateAndPersistGovernedLlmOverviewBestEffort(args: {
  pool: Pool;
  dealId: string;
  runId?: string | null;
  stepRunId?: string | null;
  dealName?: string | null;
  phase1_deal_overview_v2?: unknown;
  phase1_business_archetype_v1?: unknown;
  phase1_update_report_v1?: unknown;
  phase1_deal_summary_v2?: unknown;
  phase1_documents?: Array<{ document_id: string; type?: string | null }>;
}): Promise<{ ok: boolean; inserted: boolean; input_hash: string | null; validation_failed: boolean }> {
  const startedAt = Date.now();
  const pool = args.pool;

  const nowIso = new Date().toISOString();

  let llm_phase_mode: LLMPhaseMode = "exploratory";
  let input_hash: string | null = null;
  let validation_failed = false;
  let inserted = false;
  let overlayForDiagnostics: Pick<GovernedLLMOverviewV1, "llm_phase_mode" | "claims"> | null = null;

  // PR3.1: capture overlay-attempt failure state; diagnostics must persist even on failures.
  let provider_error_count = 0;
  let model_output_truncated_count = 0;
  let model_output_not_json_count = 0;
  let guard_degraded_count = 0;

  const classifyAttemptError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const normalized = msg.toLowerCase();
    provider_error_count = 1;
    if (normalized.includes("guard_degraded")) guard_degraded_count = 1;
    if (normalized.includes("truncat") || normalized.includes("max token") || normalized.includes("context length") || normalized.includes("finish_reason")) {
      model_output_truncated_count = 1;
    }
    if (normalized.includes("unexpected token") || normalized.includes("non-json") || (normalized.includes("json") && normalized.includes("parse"))) {
      model_output_not_json_count = 1;
    }
  };

  const persistDiagnosticsAlways = async () => {
    try {
      const reportId = input_hash || `overlay_attempt:${args.dealId}:${nowIso}`;
      await persistDiagnosticsSnapshotBestEffort({
        pool,
        dealId: args.dealId,
        reportId,
        llm_phase_mode,
        overlay: overlayForDiagnostics,
        provider_error_count,
        model_output_truncated_count,
        model_output_not_json_count,
        guard_degraded_count,
      });
    } catch {
      // ignore
    }
  };

  try {
    const tableOk = await hasTable(pool, "governed_llm_overviews");
    if (!tableOk) {
      return { ok: true, inserted: false, input_hash: null, validation_failed: false };
    }

    llm_phase_mode = await readDealPhaseMode(pool, args.dealId);

    // Attempt overlay generation + persistence.
    try {
      let kpiClaims: any[] = [];
      try {
        const docs = Array.isArray(args.phase1_documents) ? args.phase1_documents : [];
        const out = await buildPhase1KpiReconciliationV1({
          pool,
          dealId: args.dealId,
          documents: docs.map((d) => ({ document_id: String(d.document_id), type: d.type ?? null })),
          nowIso,
        });
        kpiClaims = Array.isArray(out?.claims) ? out.claims : [];
      } catch {
        kpiClaims = [];
      }

      // Gather broad deck-wide sources for expanded evidence coverage (fail-open).
      let globalSummarySources: GlobalSummarySource[] = [];
      let totalDpuPages = 0;
      try {
        const docs = Array.isArray(args.phase1_documents) ? args.phase1_documents : [];
        const docIds = docs
          .map((d) => String(d.document_id))
          .filter((id) => id.trim().length > 8);
        if (docIds.length > 0) {
          const gathered = await gatherGlobalSummarySources(pool, {
            documentIds: docIds,
            targetCount: 30,
          });
          globalSummarySources = gathered.sources;
          totalDpuPages = gathered.total_pages;
        }
      } catch {
        globalSummarySources = [];
        totalDpuPages = 0;
      }

      // display_facts_v1: derived from deterministic evidence (DPU snippets) + guarded LLM paraphrase.
      let display_facts_v1: DisplayFactsV1 | null = null;
      let display_facts_v1_quality: DisplayFactsQualityV1 | null = null;
      let display_facts_v1_input: unknown = null;
      try {
        const out = await generateDisplayFactsV1BestEffort({
          pool,
          dealId: args.dealId,
          nowIso,
          llm_phase_mode,
          phase1_deal_overview_v2: args.phase1_deal_overview_v2 ?? null,
          global_summary_sources: globalSummarySources,
        });
        display_facts_v1 = out.display_facts_v1;
        display_facts_v1_quality = out.quality;
        display_facts_v1_input = out.deterministic_input;
        if (out.quality.guard_degraded) guard_degraded_count = Math.max(guard_degraded_count, 1);
        if (out.quality.errors?.includes("model_output_not_json")) model_output_not_json_count = Math.max(model_output_not_json_count, 1);
      } catch (err) {
        classifyAttemptError(err);
        display_facts_v1 = null;
        display_facts_v1_quality = {
          generated_at: nowIso,
          model: null,
          ok: false,
          guard_degraded: false,
          skipped_reason: "exception",
          errors: [err instanceof Error ? err.message : String(err ?? "unknown_error")],
        };
        display_facts_v1_input = null;
      }

      // governed_ui_copy_v1: rewrite-only UI copy derived from display_facts_v1.
      let governed_ui_copy_v1: GovernedUiCopyV1 | null = null;
      let governed_ui_copy_v1_quality: GovernedUiCopyQualityV1 | null = null;
      let governed_ui_copy_v1_input: unknown = null;
      try {
        const out = await generateGovernedUiCopyV1BestEffort({
          dealId: args.dealId,
          nowIso,
          llm_phase_mode,
          display_facts_v1,
          display_facts_v1_input_v1: display_facts_v1_input && typeof display_facts_v1_input === "object" ? display_facts_v1_input : null,
          phase1_deal_summary_v2: args.phase1_deal_summary_v2 ?? null,
          phase1_deal_overview_v2: args.phase1_deal_overview_v2 ?? null,
        });
        governed_ui_copy_v1 = out.governed_ui_copy_v1;
        governed_ui_copy_v1_quality = out.quality;
        governed_ui_copy_v1_input = out.deterministic_input;
        if (out.quality.guard_degraded) guard_degraded_count = Math.max(guard_degraded_count, 1);
        if (out.quality.errors?.includes("model_output_not_json")) model_output_not_json_count = Math.max(model_output_not_json_count, 1);
      } catch (err) {
        classifyAttemptError(err);
        governed_ui_copy_v1 = null;
        governed_ui_copy_v1_quality = {
          generated_at: nowIso,
          model: null,
          ok: false,
          guard_degraded: false,
          skipped_reason: "exception",
          errors: [err instanceof Error ? err.message : String(err ?? "unknown_error")],
        };
        governed_ui_copy_v1_input = null;
      }

      // Non-blocking consistency check: verify the generated UI copy reflects
      // the deterministic input signals (raise context, BM keywords, traction
      // numerics, ICP descriptors). Warnings are stored alongside the row and
      // logged in non-production environments for iterative prompt improvement.
      const consistency_warnings = validateGovernedOutputConsistency({
        heroSummary: governed_ui_copy_v1?.hero_summary ?? null,
        product: governed_ui_copy_v1?.product_solution ?? null,
        market: governed_ui_copy_v1?.market_icp ?? null,
        businessModel: governed_ui_copy_v1?.business_model ?? null,
        deterministicBasis: (governed_ui_copy_v1_input as any)?.basis ?? null,
        tractionSignals: Array.isArray(governed_ui_copy_v1?.traction) ? governed_ui_copy_v1.traction : [],
      });
      if (process.env.NODE_ENV !== "production" && consistency_warnings.length > 0) {
        try {
          console.log(
            JSON.stringify({
              event: "GOVERNED_OUTPUT_VALIDATION",
              deal_id: args.dealId,
              llm_phase_mode,
              warnings: consistency_warnings,
              ts: new Date().toISOString(),
            })
          );
        } catch {
          // ignore dev-log failure
        }
      }

      const deterministicInputs = {
        schema_version: SCHEMA_VERSION,
        deal_id: args.dealId,
        llm_phase_mode,
        phase1: {
          deal_overview_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_overview_v2 ?? null),
          business_archetype_v1: stripNonDeterministicFieldsDeep(args.phase1_business_archetype_v1 ?? null),
          update_report_v1: stripNonDeterministicFieldsDeep(args.phase1_update_report_v1 ?? null),
          deal_summary_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_summary_v2 ?? null),
        },
        phase1_kpi_claims_v1: kpiClaims.map((c) => ({
          claim_id: (c as any)?.claim_id ?? null,
          metric: (c as any)?.metric ?? null,
          value: (c as any)?.value ?? null,
          document_id: (c as any)?.document_id ?? null,
          page: (c as any)?.page ?? null,
          confidence: (c as any)?.confidence ?? null,
        })),
        display_facts_v1_input_v1: stripNonDeterministicFieldsDeep(display_facts_v1_input),
        governed_ui_copy_v1_input_v1: stripNonDeterministicFieldsDeep(governed_ui_copy_v1_input),
      };

      input_hash = computeGovernedLlmOverviewInputHash(deterministicInputs);

      // DEV-ONLY: log the deterministic packet fed to the governed LLM so evidence
      // selection can be audited without changing the API response shape.
      if (process.env.NODE_ENV !== "production") {
        try {
          const dfInput =
            display_facts_v1_input && typeof display_facts_v1_input === "object"
              ? (display_facts_v1_input as any)
              : null;
          const productEv: any[] = Array.isArray(dfInput?.product_solution) ? dfInput.product_solution : [];
          const marketEv: any[] = Array.isArray(dfInput?.market_icp) ? dfInput.market_icp : [];
          const modelEv: any[] = Array.isArray(dfInput?.business_model) ? dfInput.business_model : [];
          const raiseEv: any[] = Array.isArray(dfInput?.raise_terms) ? dfInput.raise_terms : [];
          const allEv = [...productEv, ...marketEv, ...modelEv, ...raiseEv];
          const allEvidenceIds = new Set(
            allEv.map((e: any) => e?.evidence_id).filter((id: any) => typeof id === "string" && id.trim())
          );
          const allPages = new Set(
            allEv
              .map((e: any) => `${String(e?.document_id ?? "")}:${e?.page_index}` )
              .filter((k) => k !== ":undefined" && k.length > 1)
          );
          const pageCounts = new Map<string, number>();
          for (const e of allEv) {
            if (e?.document_id && typeof e?.page_index === "number") {
              const pk = `page:${String(e.document_id).slice(-8)}:${e.page_index}`;
              pageCounts.set(pk, (pageCounts.get(pk) ?? 0) + 1);
            }
          }
          const topPages = Array.from(pageCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, count]) => ({ page: k, source_count: count }));
          console.log(
            JSON.stringify({
              event: "GOVERNED_OVERVIEW_PACKET_DEBUG",
              deal_id: args.dealId,
              llm_phase_mode,
              input_hash,
              evidence_id_count: allEvidenceIds.size,
              distinct_page_count: allPages.size,
              doc_page_coverage_pct:
                totalDpuPages > 0
                  ? Math.round((allPages.size / totalDpuPages) * 1000) / 10
                  : null,
              top_pages_by_source_count: topPages,
              topic_breakdown: {
                product: productEv.length,
                market: marketEv.length,
                business_model: modelEv.length,
                raise_terms: raiseEv.length,
              },
            })
          );
        } catch {
          // ignore debug log failure
        }
      }

      const summary_text = buildSummaryText({
        dealName: args.dealName ?? null,
        dealOverviewV2: args.phase1_deal_overview_v2 ?? null,
        businessArchetypeV1: args.phase1_business_archetype_v1 ?? null,
      });

      const claims: GovernedLLMClaimV1[] = [];
      for (const c of kpiClaims) {
        const metric = typeof (c as any)?.metric === "string" ? String((c as any).metric) : "";
        const value = typeof (c as any)?.value === "number" && Number.isFinite((c as any).value) ? (c as any).value : null;
        const conf = clamp01((c as any)?.confidence, 0.7);
        const ev = toEvidenceRefFromKpiClaim({ document_id: String((c as any)?.document_id ?? ""), page: Number((c as any)?.page ?? NaN) });
        if (!metric || value == null) continue;
        if (!ev) continue;
        claims.push({
          claim_type: "kpi",
          label: metric,
          value_number: value,
          unit: "USD",
          confidence: conf,
          evidence_refs: [ev],
        });
      }

      const disclosures: Disclosure[] = [];

      const candidate: GovernedLLMOverviewV1 = {
        schema_version: SCHEMA_VERSION,
        deal_id: args.dealId,
        run_id: args.runId ?? undefined,
        step_run_id: args.stepRunId ?? undefined,
        input_hash,
        created_at: nowIso,
        llm_phase_mode,
        summary_text,
        claims,
        disclosures,
      };

      const overview_json = {
        phase1: {
          deal_overview_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_overview_v2 ?? null),
          deal_summary_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_summary_v2 ?? null),
          business_archetype_v1: stripNonDeterministicFieldsDeep(args.phase1_business_archetype_v1 ?? null),
          update_report_v1: stripNonDeterministicFieldsDeep(args.phase1_update_report_v1 ?? null),
          governed_ui_copy_v1: governed_ui_copy_v1 ? stripNonDeterministicFieldsDeep(governed_ui_copy_v1) : null,
          governed_ui_copy_v1_quality: governed_ui_copy_v1_quality ? stripNonDeterministicFieldsDeep(governed_ui_copy_v1_quality) : null,
        },
        display_facts_v1: display_facts_v1 ? stripNonDeterministicFieldsDeep(display_facts_v1) : null,
        display_facts_v1_quality: display_facts_v1_quality ? stripNonDeterministicFieldsDeep(display_facts_v1_quality) : null,
      };

      const schemaValidated = validateGovernedLlmOverviewSchemaV1(candidate);
      let toPersist: GovernedLLMOverviewV1;
      if (!schemaValidated.ok) {
        toPersist = {
          ...candidate,
          claims: [],
          disclosures: [
            ...disclosures,
            {
              code: "governed_llm_overlay_validation_failed",
              message: "Governed LLM overlay failed schema validation; claims omitted.",
            },
          ],
        };
      } else {
        const enforced = enforcePhaseMode(schemaValidated.data, llm_phase_mode);
        if (llm_phase_mode === "exploratory") {
          toPersist = enforced;
        } else {
          const strictValidated = validateGovernedLlmOverviewV1(enforced);
          toPersist = strictValidated.ok
            ? strictValidated.data
            : {
              ...enforced,
              claims: [],
              disclosures: [
                ...(Array.isArray(enforced.disclosures) ? enforced.disclosures : []),
                {
                  code: "governed_llm_overlay_validation_failed",
                  message: "Governed LLM overlay failed strict validation; claims omitted.",
                },
              ],
            };
        }
      }

      // Diagnostics should be as complete as possible even if overlay persistence fails.
      overlayForDiagnostics = { llm_phase_mode, claims: Array.isArray(toPersist.claims) ? toPersist.claims : [] };

      const persisted = await persistGovernedOverview(pool, { ...(toPersist as any), overview_json, consistency_warnings });
      inserted = persisted.inserted;
      validation_failed = !schemaValidated.ok;

      console.log(
        JSON.stringify({
          event: "GOVERNED_LLM_OVERLAY_V1",
          deal_id: args.dealId,
          schema_version: SCHEMA_VERSION,
          llm_phase_mode,
          input_hash,
          inserted: persisted.inserted,
          claims_count: Array.isArray(toPersist.claims) ? toPersist.claims.length : 0,
          validation_failed: !schemaValidated.ok,
          run_id: args.runId ?? null,
          step_run_id: args.stepRunId ?? null,
          duration_ms: Date.now() - startedAt,
          ts: new Date().toISOString(),
        })
      );
    } catch (err) {
      classifyAttemptError(err);
      throw err;
    } finally {
      // PR3.1: ALWAYS persist diagnostics after attempting overlay generation.
      await persistDiagnosticsAlways();
    }

    return { ok: true, inserted, input_hash, validation_failed };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err ?? "unknown_error");
    try {
      console.warn(
        JSON.stringify({
          event: "GOVERNED_LLM_OVERLAY_V1_FAILED",
          deal_id: args.dealId,
          run_id: args.runId ?? null,
          step_run_id: args.stepRunId ?? null,
          error: msg,
          ts: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }
    // Fail-safe: never block deterministic pipeline.
    return { ok: false, inserted: false, input_hash: null, validation_failed: false };
  }
}
