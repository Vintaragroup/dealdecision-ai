export type UiPreviewV1 = {
  version: "ui_preview_v1";

  // What the web app will render
  header_tiles: {
    raise: { value: string | null; label?: string | null; confidence?: number | null; sources?: any[] };
    revenue: { value: string | null; label?: string | null; scope_label?: string | null; selection_reason?: string | null; confidence?: number | null; sources?: any[] };
    growth: { value: string | null; label?: string | null; confidence?: number | null; sources?: any[] };
    customers: { value: string | null; label?: string | null; confidence?: number | null; sources?: any[] };
    business_model: {
      value: string | null;
      badge: "synthesized" | "promoted" | "none";
      confidence?: number | null;
      derived_from?: any;
      sources?: any[];
      selection_trace: {
        selected_from: "structured_summary.business_model_summary" | "structured_summary.business_model" | "null";
        reason: string;
      };
    };
    deal_type: { value: string | null; label?: string | null };
    confidence: { value: "High" | "Moderate" | "Low" | "Unknown"; verified: boolean; reason?: string };
  };

  // Score: show baseline vs deterministic preview vs applied
  score: {
    baseline: { overall_score: number | null; evidence_factor: number | null; adjustment_factor: number | null };
    deterministic: { overall_score: number | null; evidence_factor: number | null; adjustment_factor: number | null };
    delta_overall_score: number | null;
    enabled: boolean;
    blocked_by_drift_misaligned: boolean;
    drift_assessment: string;
    applied: boolean;
    applied_parts: string[];
    inputs_hash?: string | null;
    modifier?: { signal_strength: number | null; modifier: number | null; notes: string[] };
  };

  // Summaries to be shown in UI
  summaries: {
    deal_summary: { value: string | null; sources?: any[] };
    product_summary?: { value: string | null; sources?: any[] };
    market_summary?: { value: string | null; sources?: any[] };
    gtm_summary?: { value: string | null; sources?: any[] };
  };

  // Explainability anchors
  citations: {
    available: boolean;
    counts: { total_sources: number; unique_pages: number };
  };

  // Useful debug without overwhelming
  debug: {
    deal_id?: string;
    dio_id?: string;
    deck_archetype_key?: string | null;
    archetype_confidence?: number | null;
  };
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const asFiniteNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const asObject = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === "object" ? (v as Record<string, unknown>) : null;

const envFlagEnabled = (v: unknown): boolean => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
};

function fieldFromStructuredRaw(structured: any, key: string): { value: string | null; label?: string | null; confidence?: number | null; sources?: any[] } {
  const ss = asObject(structured) as any;
  const f = ss ? ss[key] : null;
  const label = asNonEmptyString(f?.label);
  const confidence = asFiniteNumber(f?.confidence);
  const sources = Array.isArray(f?.sources) ? (f.sources as any[]) : undefined;

  // Match web header selection: KPI tiles pull value.raw.
  const valueRaw = asNonEmptyString(f?.value?.raw);
  const valueDirect = asNonEmptyString(f?.value);
  const value = valueRaw ?? valueDirect ?? null;
  return { value, label: label ?? null, confidence, sources };
}

function revenueTileFromStructured(structured: any): UiPreviewV1["header_tiles"]["revenue"] {
  const ss = asObject(structured) as any;
  const f = ss ? ss.revenue : null;

  const label = asNonEmptyString(f?.label);
  const scopeLabel = asNonEmptyString(f?.scope_label);
  const selectionReason = asNonEmptyString(f?.selection_reason);
  const confidence = asFiniteNumber(f?.confidence);
  const sources = Array.isArray(f?.sources) ? (f.sources as any[]) : undefined;

  // New canonical field: structured_summary.revenue.value_raw
  const canonicalValueRaw = asNonEmptyString(f?.value_raw);

  // Back-compat: previously the UI used structured_summary.revenue.value.raw
  const legacyValueRaw = asNonEmptyString(f?.value?.raw);
  const legacyValueDirect = asNonEmptyString(f?.value);

  const value = canonicalValueRaw ?? legacyValueRaw ?? legacyValueDirect ?? null;
  return {
    value,
    label: (label ?? scopeLabel) ?? null,
    scope_label: scopeLabel ?? null,
    selection_reason: selectionReason ?? null,
    confidence,
    sources,
  };
}

function businessModelTileFromStructured(structured: any): UiPreviewV1["header_tiles"]["business_model"] {
  const ss = asObject(structured) as any;
  const synth = ss?.business_model_summary;
  const promoted = ss?.business_model;

  const synthValue = asNonEmptyString(synth?.value);
  const promotedValue = asNonEmptyString(promoted?.value);

  if (synthValue) {
    return {
      value: synthValue,
      badge: "synthesized",
      confidence: asFiniteNumber(synth?.confidence),
      derived_from: { selected_from: "structured_summary.business_model_summary", field: synth },
      sources: Array.isArray(synth?.sources) ? (synth.sources as any[]) : undefined,
      selection_trace: {
        selected_from: "structured_summary.business_model_summary",
        reason: "business_model_summary.value present; web precedence selects synthesized summary",
      },
    };
  }

  if (promotedValue) {
    return {
      value: promotedValue,
      badge: "promoted",
      confidence: asFiniteNumber(promoted?.confidence),
      derived_from: { selected_from: "structured_summary.business_model", field: promoted },
      sources: Array.isArray(promoted?.sources) ? (promoted.sources as any[]) : undefined,
      selection_trace: {
        selected_from: "structured_summary.business_model",
        reason: "business_model_summary missing; business_model.value present; web fallback selects promoted",
      },
    };
  }

  return {
    value: null,
    badge: "none",
    confidence: null,
    derived_from: null,
    sources: undefined,
    selection_trace: {
      selected_from: "null",
      reason: "No structured_summary business model fields present",
    },
  };
}

function findExecutiveSummaryFromSections(report: any): string | null {
  const sections: any[] = Array.isArray(report?.sections) ? report.sections : [];
  const byId = sections.find(
    (s: any) => typeof s?.id === "string" && ["executive-summary", "executive_summary", "executiveSummary"].includes(s.id)
  );
  const byTitle = sections.find((s: any) => typeof s?.title === "string" && /executive\s+summary/i.test(s.title));
  return asNonEmptyString((byId ?? byTitle)?.content);
}

function computeConfidenceTileFromScoreExplanation(reportMeta: any): UiPreviewV1["header_tiles"]["confidence"] {
  const scoreExp = reportMeta && typeof reportMeta === "object" ? (reportMeta as any).score_explanation : null;
  const cs = asFiniteNumber(scoreExp?.totals?.confidence_score);
  if (cs == null) {
    return {
      value: "Unknown",
      verified: false,
      reason: "score_explanation.totals.confidence_score missing",
    };
  }

  const value: "High" | "Moderate" | "Low" = cs >= 0.75 ? "High" : cs >= 0.55 ? "Moderate" : "Low";
  return {
    value,
    verified: value === "High",
    reason: `score_explanation.totals.confidence_score=${cs.toFixed(3)}`,
  };
}

function extractDealType(reportMeta: any, structured: any, report: any): { value: string | null; label?: string | null } {
  const ctx = reportMeta && typeof reportMeta === "object" ? (reportMeta as any).score_explanation?.context : null;
  const fromCtx = asNonEmptyString(ctx?.deal_type);
  const fromStructured = asNonEmptyString((structured as any)?.deal_type);
  const fromTop = asNonEmptyString((report as any)?.deal_type);
  return { value: fromCtx ?? fromStructured ?? fromTop ?? null, label: null };
}

function scorePreviewFromMetadata(args: {
  reportMeta: any;
  envEnabled: boolean;
}): UiPreviewV1["score"] {
  const meta = args.reportMeta && typeof args.reportMeta === "object" ? (args.reportMeta as any) : null;
  const preview = meta?.deterministic_score_preview_v1;
  const driftFromMeta = String(meta?.archetype_segment_drift_v1?.overall_assessment ?? "unknown");

  const baselineTotals = meta?.score_explanation?.totals;
  const baselineOverall = asFiniteNumber(baselineTotals?.overall_score);
  const baselineEvidence = asFiniteNumber(baselineTotals?.evidence_factor);
  const baselineAdj = asFiniteNumber(baselineTotals?.adjustment_factor);

  if (!preview || typeof preview !== "object") {
    return {
      baseline: {
        overall_score: baselineOverall,
        evidence_factor: baselineEvidence,
        adjustment_factor: baselineAdj,
      },
      deterministic: {
        overall_score: null,
        evidence_factor: null,
        adjustment_factor: null,
      },
      delta_overall_score: null,
      enabled: args.envEnabled,
      blocked_by_drift_misaligned: false,
      drift_assessment: driftFromMeta,
      applied: false,
      applied_parts: [],
      inputs_hash: asNonEmptyString(meta?.deterministic_score_inputs_v1?.inputs_hash),
      modifier: undefined,
    };
  }

  const enabled = Boolean((preview as any).enabled);
  const gate = (preview as any).gate && typeof (preview as any).gate === "object" ? (preview as any).gate : null;
  const drift = gate ? String(gate.drift_assessment ?? driftFromMeta ?? "unknown") : driftFromMeta;
  const blocked = Boolean(gate?.blocked_by_drift_misaligned);
  const applied = Boolean((preview as any).applied);

  const appliedParts: string[] = Array.isArray((preview as any).applied_parts)
    ? (preview as any).applied_parts.map((s: any) => String(s))
    : [];

  const modifierV1 = (preview as any).modifier_v1;
  const modifier = modifierV1 && typeof modifierV1 === "object"
    ? {
        signal_strength: asFiniteNumber(modifierV1.signal_strength),
        modifier: asFiniteNumber(modifierV1.modifier),
        notes: Array.isArray(modifierV1.notes) ? modifierV1.notes.map((n: any) => String(n)) : [],
      }
    : undefined;

  const baseline = (preview as any).baseline;
  const det = (preview as any).deterministic;

  return {
    baseline: {
      overall_score: asFiniteNumber(baseline?.overall_score) ?? baselineOverall,
      evidence_factor: asFiniteNumber(baseline?.evidence_factor) ?? baselineEvidence,
      adjustment_factor: asFiniteNumber(baseline?.adjustment_factor) ?? baselineAdj,
    },
    deterministic: {
      overall_score: asFiniteNumber(det?.overall_score),
      evidence_factor: asFiniteNumber(det?.evidence_factor),
      adjustment_factor: asFiniteNumber(det?.adjustment_factor),
    },
    delta_overall_score: asFiniteNumber((preview as any).delta_overall_score),
    enabled,
    blocked_by_drift_misaligned: blocked,
    drift_assessment: drift,
    applied,
    applied_parts: appliedParts,
    inputs_hash: asNonEmptyString((preview as any).inputs_hash) ?? asNonEmptyString(meta?.deterministic_score_inputs_v1?.inputs_hash),
    modifier,
  };
}

function dealSummaryFromReport(reportPayload: any): {
  deal_summary: { value: string | null; sources?: any[] };
  product_summary?: { value: string | null; sources?: any[] };
  market_summary?: { value: string | null; sources?: any[] };
} {
  const reportReady = reportPayload?.ready === true;
  const canonical = reportReady
    ? (reportPayload?.deal_summary ?? reportPayload?.report?.deal_summary ?? null)
    : null;

  // New preferred surfaces (tiered/canonical):
  // - deal_summary: report.deal_summary.tiers.hero
  // - product_summary: report.deal_summary.product.product_definition (or .text back-compat)
  // - market_summary: report.deal_summary.market_target.text (optionally append market_context)
  const heroTier = asNonEmptyString((canonical as any)?.tiers?.hero);
  const productDef = asNonEmptyString((canonical as any)?.product?.product_definition) ?? asNonEmptyString((canonical as any)?.product?.text);
  const productSources = Array.isArray((canonical as any)?.product?.sources) ? ((canonical as any).product.sources as any[]) : undefined;

  const marketTargetText = asNonEmptyString((canonical as any)?.market_target?.text) ?? asNonEmptyString((canonical as any)?.market_target);
  const marketTargetSources = Array.isArray((canonical as any)?.market_target?.sources) ? ((canonical as any).market_target.sources as any[]) : undefined;
  const marketContextText = asNonEmptyString((canonical as any)?.market_context?.text) ?? asNonEmptyString((canonical as any)?.market_context);

  const structuredSummary = reportPayload?.structured_summary ?? reportPayload?.report?.structured_summary ?? null;
  const ss = asObject(structuredSummary) as any;

  const legacyDeal = ss?.deal_summary_v1;
  const legacyDealValue = asNonEmptyString(legacyDeal?.value);
  const legacyDealSources = Array.isArray(legacyDeal?.sources) ? (legacyDeal.sources as any[]) : undefined;

  const legacyProduct = ss?.product_summary_v1;
  const legacyProductValue = asNonEmptyString(legacyProduct?.value);
  const legacyProductSources = Array.isArray(legacyProduct?.sources) ? (legacyProduct.sources as any[]) : undefined;

  const legacyMarket = ss?.market_summary_v1;
  const legacyMarketValue = asNonEmptyString(legacyMarket?.value);
  const legacyMarketSources = Array.isArray(legacyMarket?.sources) ? (legacyMarket.sources as any[]) : undefined;

  const dealSummaryValue = heroTier ?? legacyDealValue ?? null;
  const dealSummarySources = heroTier ? undefined : legacyDealSources;

  const out: {
    deal_summary: { value: string | null; sources?: any[] };
    product_summary?: { value: string | null; sources?: any[] };
    market_summary?: { value: string | null; sources?: any[] };
  } = {
    deal_summary: {
      value: dealSummaryValue,
      sources: dealSummarySources,
    },
  };

  if (productDef) {
    out.product_summary = { value: productDef, sources: productSources };
  } else if (legacyProductValue) {
    out.product_summary = { value: legacyProductValue, sources: legacyProductSources };
  }

  if (marketTargetText) {
    const combined = marketContextText
      ? `Target market: ${marketTargetText} Market context: ${marketContextText}`
      : marketTargetText;
    out.market_summary = { value: combined, sources: marketTargetSources };
  } else if (legacyMarketValue) {
    out.market_summary = { value: legacyMarketValue, sources: legacyMarketSources };
  }

  // If tiers missing and legacy missing, fall back further to Executive Summary.
  if (!out.deal_summary.value) {
    const legacy = findExecutiveSummaryFromSections(reportPayload);
    out.deal_summary.value = legacy;
  }

  return out;

  // Note: product/market intentionally do not fall back to Executive Summary.
}

function countCitations(ui: UiPreviewV1): { total_sources: number; unique_pages: number } {
  const allSources: any[] = [];

  const pushSources = (sources: any[] | undefined) => {
    if (!Array.isArray(sources)) return;
    for (const s of sources) allSources.push(s);
  };

  pushSources(ui.header_tiles.raise.sources);
  pushSources(ui.header_tiles.revenue.sources);
  pushSources(ui.header_tiles.growth.sources);
  pushSources(ui.header_tiles.customers.sources);
  pushSources(ui.header_tiles.business_model.sources);

  pushSources(ui.summaries.deal_summary.sources);
  pushSources(ui.summaries.product_summary?.sources);
  pushSources(ui.summaries.market_summary?.sources);
  pushSources(ui.summaries.gtm_summary?.sources);

  const unique = new Set<string>();
  for (const s of allSources) {
    if (!s || typeof s !== "object") continue;
    const doc = asNonEmptyString((s as any).document_id) ?? asNonEmptyString((s as any).source_document_id) ?? "";
    const pageIndex = asFiniteNumber((s as any).page_index);
    if (doc && pageIndex != null) {
      unique.add(`${doc}:${pageIndex}`);
      continue;
    }

    const pageRange = (s as any).page_range;
    if (doc && Array.isArray(pageRange) && pageRange.length === 2 && Number.isFinite(Number(pageRange[0])) && Number.isFinite(Number(pageRange[1]))) {
      unique.add(`${doc}:${Number(pageRange[0])}-${Number(pageRange[1])}`);
    }
  }

  return { total_sources: allSources.length, unique_pages: unique.size };
}

export function buildUiPreviewV1(input: {
  report: any;
  segmented_nodes: any[];
  env: { DETERMINISTIC_SCORE_V1_ENABLED?: string | undefined };
}): UiPreviewV1 {
  const reportPayload = input?.report;

  // /report returns both a top-level payload and a nested `report` object.
  // Prefer top-level structured_summary/metadata when present.
  const structuredSummary = reportPayload?.structured_summary ?? reportPayload?.report?.structured_summary ?? null;
  const reportMeta = reportPayload?.metadata ?? reportPayload?.report?.metadata ?? null;
  const envEnabled = envFlagEnabled(input?.env?.DETERMINISTIC_SCORE_V1_ENABLED);

  const raise = (() => {
    const ss = asObject(structuredSummary) as any;
    const f = ss?.raise;
    const value = asNonEmptyString(f?.value);
    const label = asNonEmptyString(f?.label);
    const confidence = asFiniteNumber(f?.confidence);
    const sources = Array.isArray(f?.sources) ? (f.sources as any[]) : undefined;
    return { value, label: label ?? null, confidence, sources };
  })();

  const revenue = revenueTileFromStructured(structuredSummary);
  const growth = fieldFromStructuredRaw(structuredSummary, "growth");
  const customers = fieldFromStructuredRaw(structuredSummary, "customers");
  const business_model = businessModelTileFromStructured(structuredSummary);
  const deal_type = extractDealType(reportMeta, structuredSummary, reportPayload);
  const confidence = computeConfidenceTileFromScoreExplanation(reportMeta);

  const score = scorePreviewFromMetadata({ reportMeta, envEnabled });
  const summariesBase = dealSummaryFromReport(reportPayload);
  const gtm = (() => {
    const ss = asObject(structuredSummary) as any;
    const gtmV1 = ss?.gtm_summary_v1;
    const value = asNonEmptyString(gtmV1?.value);
    const sources = Array.isArray(gtmV1?.sources) ? (gtmV1.sources as any[]) : undefined;
    return value ? { value, sources } : undefined;
  })();

  const deckArchetype = reportMeta && typeof reportMeta === "object" ? (reportMeta as any).deck_archetype : null;
  const ui: UiPreviewV1 = {
    version: "ui_preview_v1",
    header_tiles: {
      raise,
      revenue,
      growth,
      customers,
      business_model,
      deal_type,
      confidence,
    },
    score,
    summaries: {
      deal_summary: summariesBase.deal_summary,
      ...(summariesBase.product_summary ? { product_summary: summariesBase.product_summary } : {}),
      ...(summariesBase.market_summary ? { market_summary: summariesBase.market_summary } : {}),
      ...(gtm ? { gtm_summary: gtm } : {}),
    },
    citations: {
      available: false,
      counts: { total_sources: 0, unique_pages: 0 },
    },
    debug: {
      deal_id: asNonEmptyString(reportPayload?.deal_id) ?? asNonEmptyString(reportPayload?.artifact?.deal_id) ?? undefined,
      dio_id: asNonEmptyString(reportPayload?.artifact?.dio_id) ?? undefined,
      deck_archetype_key: asNonEmptyString(deckArchetype?.key),
      archetype_confidence: asFiniteNumber(deckArchetype?.confidence),
    },
  };

  const counts = countCitations(ui);
  ui.citations = {
    available: counts.total_sources > 0,
    counts,
  };

  void input.segmented_nodes; // Intentionally unused in v1; reserved for future trace/citation mapping.

  return ui;
}
