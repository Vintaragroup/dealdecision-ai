export type OverlayViewModel = {
  meta: {
    llm_phase_mode: string | null;
    created_at: string | null;
    input_hash: string | null;
    quality_flags: string[];
  };
  hero_summary: string | null;
  facts: {
    product: string | null;
    market_icp: string | null;
    business_model: string | null;
    raise_terms: string | null;
  };
  deal_summary: {
    hero?: string | null;
    overview?: string | null;
    deep?: string | null;
  };
  deal_summary_paragraphs: string[];
  kpis: {
    raise?: { value: string | null; label?: string | null };
    revenue?: { value: string | null; label?: string | null };
    growth?: { value: string | null; label?: string | null };
    customers?: { value: string | null; label?: string | null };
  };
  strengths: string[];
  concerns: string[];
  open_items: string[];
  coverage_gaps: string[];
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const asStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((s) => s.length > 0);
};

const safeJsonParseObject = (v: unknown): Record<string, any> | null => {
  if (!v) return null;
  if (typeof v === 'object') return v as any;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? (parsed as any) : null;
  } catch {
    return null;
  }
};

const uniqStrings = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const s = it.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const buildQualityFlagsList = (overview: any): string[] => {
  if (!overview || typeof overview !== 'object') return [];

  const flags: string[] = [];

  // Direct boolean flags (common)
  const directKeys = ['provider_error', 'model_output_not_json', 'guard_degraded'];
  for (const k of directKeys) {
    if ((overview as any)[k]) flags.push(k);
  }

  const nested = (overview as any).quality_flags ?? (overview as any).flags;
  if (Array.isArray(nested)) {
    flags.push(...asStringArray(nested));
  } else if (nested && typeof nested === 'object') {
    for (const [k, val] of Object.entries(nested as Record<string, unknown>)) {
      if (val === true) flags.push(k);
      // If upstream ever sends string reasons, include them as flag tokens.
      if (typeof val === 'string' && val.trim().length > 0) flags.push(`${k}:${val.trim()}`);
    }
  }

  return uniqStrings(flags);
};

const findClaimValueString = (claims: unknown, matcher: (label: string) => boolean): string | null => {
  if (!Array.isArray(claims)) return null;
  for (const c of claims as any[]) {
    if (!c || typeof c !== 'object') continue;
    const label = asNonEmptyString((c as any).label);
    if (!label) continue;
    if (!matcher(label)) continue;

    const valueString = asNonEmptyString((c as any).value_string);
    if (valueString) return valueString;
    const valueNumber = (c as any).value_number;
    if (typeof valueNumber === 'number' && Number.isFinite(valueNumber)) return String(valueNumber);
    const valueText = asNonEmptyString((c as any).value_text);
    if (valueText) return valueText;
  }
  return null;
};

export function buildOverlayViewModel(overviewResponse: any): OverlayViewModel {
  const overview = (overviewResponse && typeof overviewResponse === 'object' && 'overview' in overviewResponse)
    ? (overviewResponse as any).overview
    : overviewResponse;

  const llm_phase_mode = asNonEmptyString(overview?.llm_phase_mode) ?? null;
  const created_at = asNonEmptyString(overview?.created_at) ?? null;
  const input_hash = asNonEmptyString(overview?.input_hash) ?? null;

  const quality_flags = buildQualityFlagsList(overview);

  const overviewJson = safeJsonParseObject(overview?.overview_json) ?? {};
  const phase1 = (overviewJson as any)?.phase1 && typeof (overviewJson as any).phase1 === 'object' ? (overviewJson as any).phase1 : {};

  const dealSummaryV2 = (phase1 as any)?.deal_summary_v2 && typeof (phase1 as any).deal_summary_v2 === 'object'
    ? (phase1 as any).deal_summary_v2
    : null;
  const dealOverviewV2 = (phase1 as any)?.deal_overview_v2 && typeof (phase1 as any).deal_overview_v2 === 'object'
    ? (phase1 as any).deal_overview_v2
    : null;

  const oneLiner = asNonEmptyString((dealSummaryV2 as any)?.summary?.one_liner) ?? null;
  const paragraphs = asStringArray((dealSummaryV2 as any)?.summary?.paragraphs);
  const overviewText = paragraphs.length > 0 ? paragraphs[0] : null;
  const deepText = paragraphs.length > 1 ? paragraphs.slice(1).join('\n\n') : null;

  // Prefer governed_ui_copy_v1 for narrative fields; fall back to deal_overview_v2
  const governedCopy = (phase1 as any)?.governed_ui_copy_v1;
  const govOk = governedCopy != null && (governedCopy as any).schema_version === 'governed_ui_copy_v1';

  const product =
    (govOk ? asNonEmptyString((governedCopy as any)?.product_solution) : null) ??
    asNonEmptyString((dealOverviewV2 as any)?.product_solution) ??
    null;
  const market_icp =
    (govOk ? asNonEmptyString((governedCopy as any)?.market_icp) : null) ??
    asNonEmptyString((dealOverviewV2 as any)?.market_icp) ??
    null;
  const business_model =
    (govOk ? asNonEmptyString((governedCopy as any)?.business_model) : null) ??
    asNonEmptyString((dealOverviewV2 as any)?.business_model) ??
    null;
  const raise_terms =
    (govOk ? asNonEmptyString((governedCopy as any)?.raise_terms) : null) ??
    asNonEmptyString((dealOverviewV2 as any)?.raise_terms) ??
    asNonEmptyString((dealOverviewV2 as any)?.raise) ??
    null;

  // ── TRACE: governed copy path audit ─────────────────────────────────────────
  if (import.meta.env.DEV) {
    console.group('[TRACE:buildOverlayViewModel] facts resolution (FIX APPLIED)');
    console.log('governed_ui_copy_v1 present + valid?', govOk);
    console.log('product →', product, '| source:', govOk && asNonEmptyString((governedCopy as any)?.product_solution) ? 'governed_ui_copy_v1' : 'deal_overview_v2');
    console.log('market_icp →', market_icp, '| source:', govOk && asNonEmptyString((governedCopy as any)?.market_icp) ? 'governed_ui_copy_v1' : 'deal_overview_v2');
    console.log('business_model →', business_model, '| source:', govOk && asNonEmptyString((governedCopy as any)?.business_model) ? 'governed_ui_copy_v1' : 'deal_overview_v2');
    console.log('raise_terms →', raise_terms, '| source:', govOk && asNonEmptyString((governedCopy as any)?.raise_terms) ? 'governed_ui_copy_v1' : 'deal_overview_v2 (raise_terms/raise)');
    console.groupEnd();
  }

  const strengths = uniqStrings(asStringArray((dealSummaryV2 as any)?.strengths));

  const risks = uniqStrings(asStringArray((dealSummaryV2 as any)?.risks));
  const keyRisksDetected = uniqStrings(asStringArray((dealOverviewV2 as any)?.key_risks_detected));
  const concerns = uniqStrings([...risks, ...keyRisksDetected]);

  const open_items = uniqStrings(
    asStringArray((dealSummaryV2 as any)?.open_questions)
  );

  const coverage_gaps = uniqStrings(
    asStringArray((dealSummaryV2 as any)?.coverage_gaps ?? (dealSummaryV2 as any)?.gaps ?? (dealSummaryV2 as any)?.missing)
  );

  const raiseValue =
    raise_terms ??
    findClaimValueString((overview as any)?.claims, (label) => label.toLowerCase().includes('raise')) ??
    null;

  const revenueValue =
    asNonEmptyString((dealOverviewV2 as any)?.revenue) ??
    findClaimValueString((overview as any)?.claims, (label) => {
      const s = label.toLowerCase();
      return s.includes('revenue') || s === 'arr' || s === 'mrr' || s.includes('arr') || s.includes('mrr');
    }) ??
    null;

  const growthValue =
    asNonEmptyString((dealOverviewV2 as any)?.growth) ??
    findClaimValueString((overview as any)?.claims, (label) => label.toLowerCase().includes('growth') || label.toLowerCase().includes('yoy')) ??
    null;

  const customersValue =
    asNonEmptyString((dealOverviewV2 as any)?.customers) ??
    findClaimValueString((overview as any)?.claims, (label) => label.toLowerCase().includes('customer')) ??
    null;

  const kpis: OverlayViewModel['kpis'] = {
    raise: { value: raiseValue, label: null },
    revenue: { value: revenueValue, label: null },
    growth: { value: growthValue, label: null },
    customers: { value: customersValue, label: null },
  };

  return {
    meta: {
      llm_phase_mode,
      created_at,
      input_hash,
      quality_flags,
    },
    hero_summary: oneLiner,
    facts: {
      product,
      market_icp,
      business_model,
      raise_terms,
    },
    deal_summary: {
      hero: oneLiner,
      overview: overviewText,
      deep: deepText,
    },
    deal_summary_paragraphs: paragraphs,
    kpis,
    strengths,
    concerns,
    open_items,
    coverage_gaps,
  };
}
