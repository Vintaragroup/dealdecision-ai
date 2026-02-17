import {
  normalizeCanonicalFact,
  type CanonicalFactMeta,
} from "./canonical-fact-normalizer";

import {
  assessTextQuality,
  sanitizeForDisplay,
  type SuppressReason,
  type TextQuality,
} from "../text-quality";

const normalizeWhitespace = (s: string): string => String(s).replace(/\s+/g, " ").trim();

export type DisplayFactSourceV1 = {
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  snippet: string;
  segment_key?: string | null;
  node_id?: string | null;
  evidence_id?: string | null;
};

export type DisplayFactV1 = {
  field: string;
  value: string | null;
  quality: TextQuality;
  suppressed_reasons: SuppressReason[];
  sources: DisplayFactSourceV1[];
  canonical?: CanonicalFactMeta;
  missing_reason?: string | null;
};

export type DisplayFactsV1 = {
  schema_version: "display_facts_v1";
  one_liner: DisplayFactV1;
  product: DisplayFactV1;
  market: DisplayFactV1;
  market_target: DisplayFactV1;
  market_context: DisplayFactV1;
  business_model: DisplayFactV1;
  raise_terms: DisplayFactV1;
  traction_signals: DisplayFactV1[];
  who_it_serves: DisplayFactV1;
  why_it_wins: DisplayFactV1;
};

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = normalizeWhitespace(v);
  return s.length > 0 ? s : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? normalizeWhitespace(x) : ""))
    .filter((s) => s.length > 0);
}

function coerceDealSummarySources(sources: unknown): DisplayFactSourceV1[] {
  if (!Array.isArray(sources)) return [];
  const out: DisplayFactSourceV1[] = [];
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const anyS: any = s;
    const source_document_id = asNonEmptyString(anyS.source_document_id ?? anyS.document_id);
    const page_index_raw = anyS.page_index ?? (typeof anyS.page === "number" ? anyS.page - 1 : null);
    const page_index = typeof page_index_raw === "number" && Number.isFinite(page_index_raw) ? page_index_raw : null;
    const snippet = asNonEmptyString(anyS.snippet ?? anyS.note_snippet ?? anyS.note);
    if (!source_document_id || page_index == null || !snippet) continue;
    out.push({
      source_document_id,
      page_index,
      slide_title: asNonEmptyString(anyS.slide_title) ?? null,
      snippet,
      segment_key: asNonEmptyString(anyS.segment_key) ?? null,
      node_id: asNonEmptyString(anyS.node_id) ?? null,
    });
  }
  return out;
}

function coerceStructuredSources(sources: unknown): DisplayFactSourceV1[] {
  if (!Array.isArray(sources)) return [];
  const out: DisplayFactSourceV1[] = [];
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const anyS: any = s;
    const doc = asNonEmptyString(anyS.document_id ?? anyS.source_document_id);
    if (!doc) continue;

    // structured_summary sources can be (doc,page_range) or (page/slide_title) only.
    const pageIndex = (() => {
      if (typeof anyS.page_index === "number" && Number.isFinite(anyS.page_index)) return anyS.page_index;
      if (typeof anyS.page === "number" && Number.isFinite(anyS.page)) return anyS.page - 1;
      const pr = anyS.page_range;
      if (Array.isArray(pr) && typeof pr[0] === "number" && Number.isFinite(pr[0])) return pr[0] - 1;
      return null;
    })();
    if (pageIndex == null) continue;

    const slide_title = asNonEmptyString(anyS.slide_title) ?? null;
    const note = asNonEmptyString(anyS.note) ?? asNonEmptyString(anyS.snippet) ?? "";
    out.push({
      source_document_id: doc,
      page_index: pageIndex,
      slide_title,
      snippet: note || (slide_title ? slide_title : "source"),
    });
  }
  return out;
}

function emptyFact(field: string, reason: string): DisplayFactV1 {
  return {
    field,
    value: null,
    quality: "empty",
    suppressed_reasons: ["empty"],
    sources: [],
    missing_reason: reason,
  };
}

function factFromDealSummaryLine(field: string, line: any | null, meta?: any): DisplayFactV1 {
  if (!line || typeof line !== "object") return emptyFact(field, "missing_in_deal_summary_v1");
  const value = asNonEmptyString((line as any).display_text ?? (line as any).text);
  const quality = (line as any).quality as TextQuality;
  const suppressed_reasons = Array.isArray((line as any).suppressed_reasons) ? ((line as any).suppressed_reasons as SuppressReason[]) : [];
  const sources = coerceDealSummarySources((line as any).sources);
  const canonical: CanonicalFactMeta | undefined = meta && typeof meta === "object" ? (meta.canonical as any) : undefined;
  return {
    field,
    value,
    quality: typeof quality === "string" ? quality : "empty",
    suppressed_reasons,
    sources,
    canonical,
    missing_reason: value ? null : "suppressed_or_empty",
  };
}

function factFromCanonicalText(field: string, kind: "business_model" | "raise", rawText: unknown, sources: unknown): DisplayFactV1 {
  const raw = asNonEmptyString(rawText);
  if (!raw) return emptyFact(field, "missing_in_structured_summary");
  const normalized = normalizeCanonicalFact(raw, { kind, maxLen: 220, sourceTexts: [] });
  return {
    field,
    value: normalized.display_text,
    quality: normalized.quality,
    suppressed_reasons: normalized.suppressed_reasons,
    sources: coerceStructuredSources(sources),
    canonical: normalized.meta,
    missing_reason: normalized.display_text ? null : "suppressed_or_empty",
  };
}

function factFromPlainText(field: string, rawText: unknown, sources: unknown): DisplayFactV1 {
  const raw = asNonEmptyString(rawText);
  if (!raw) return emptyFact(field, "missing_in_report");
  const assessed = assessTextQuality(sanitizeForDisplay(raw));
  return {
    field,
    value: assessed.display,
    quality: assessed.quality,
    suppressed_reasons: assessed.reasons,
    sources: coerceStructuredSources(sources),
    missing_reason: assessed.display ? null : "suppressed_or_empty",
  };
}

/**
 * Deterministic packet for governed UI synthesis.
 * Strict contract: derived only from the deterministic report payload.
 */
export function buildDisplayFactsV1(report: any): DisplayFactsV1 {
  const dealSummary = report && typeof report === "object" ? (report as any).deal_summary : null;
  const dealSummaryMeta = dealSummary && typeof dealSummary === "object" ? (dealSummary as any).meta : null;

  const structured = report && typeof report === "object" ? (report as any).structured_summary : null;

  const one_liner = factFromDealSummaryLine("one_liner", dealSummary?.one_liner ?? null, dealSummaryMeta?.one_liner);
  const product = factFromDealSummaryLine("product", dealSummary?.product ?? null, dealSummaryMeta?.product);
  const market = factFromDealSummaryLine("market", dealSummary?.market ?? null, dealSummaryMeta?.market);
  const market_target = factFromDealSummaryLine("market_target", dealSummary?.market_target ?? null, dealSummaryMeta?.market_target);
  const market_context = factFromDealSummaryLine("market_context", dealSummary?.market_context ?? null, dealSummaryMeta?.market_context);

  const businessModelRaw = structured?.business_model_summary?.value ?? structured?.business_model?.value ?? structured?.business_model;
  const businessModelSources = structured?.business_model_summary?.sources ?? structured?.business_model?.sources ?? null;
  const business_model = factFromCanonicalText("business_model", "business_model", businessModelRaw, businessModelSources);

  const raiseRaw = structured?.raise?.value_raw ?? structured?.raise?.value ?? structured?.raise;
  const raiseSources = structured?.raise?.sources ?? null;
  const raise_terms = factFromCanonicalText("raise_terms", "raise", raiseRaw, raiseSources);

  const tractionRaw = structured?.traction_signals ?? structured?.traction?.signals ?? report?.deal_overview_v2?.traction_signals ?? [];
  const traction_signals = asStringArray(tractionRaw).slice(0, 8).map((t, idx) => {
    const assessed = assessTextQuality(sanitizeForDisplay(t));
    return {
      field: `traction_signals[${idx}]`,
      value: assessed.display,
      quality: assessed.quality,
      suppressed_reasons: assessed.reasons,
      sources: [],
      missing_reason: assessed.display ? null : "suppressed_or_empty",
    };
  });

  // Compatibility: treat "who it serves" as market_target (already canonicalized).
  const who_it_serves: DisplayFactV1 = {
    ...market_target,
    field: "who_it_serves",
    missing_reason: market_target.value ? null : "derived_from_market_target_missing",
  };

  // Best-effort: this is not explicitly modeled in deal_summary_v1; keep it null unless report provides a stable field.
  const whyFromReport = asNonEmptyString(structured?.why_it_wins ?? structured?.moat ?? null);
  const why_it_wins = whyFromReport
    ? factFromPlainText("why_it_wins", whyFromReport, null)
    : emptyFact("why_it_wins", "not_available_deterministically");

  return {
    schema_version: "display_facts_v1",
    one_liner,
    product,
    market,
    market_target,
    market_context,
    business_model,
    raise_terms,
    traction_signals,
    who_it_serves,
    why_it_wins,
  };
}
