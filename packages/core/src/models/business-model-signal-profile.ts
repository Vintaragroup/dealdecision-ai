export type BusinessModelSignalProfileV1 = {
  present: boolean;
  pricing_present: boolean;
  revenue_model_present: boolean;
  customer_segment_present: boolean;
  monetization_mechanics_present: boolean;
  confidence: 'low' | 'medium' | 'high';
  signals: Array<{ code: string; present: boolean }>;
};

type StructuredSummaryLike = any;

type PromotedFactLike = any;

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const getStructuredFieldText = (field: any): string | null => {
  if (!field) return null;
  if (typeof field === 'string') return asNonEmptyString(field);
  if (typeof field !== 'object') return null;
  return asNonEmptyString(field.value ?? field.display ?? field.raw ?? null);
};

const hasAnyValue = (v: any): boolean => {
  if (v == null) return false;
  if (typeof v === 'string') return !!asNonEmptyString(v);
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    const text = getStructuredFieldText(v);
    if (text) return true;
    return Object.keys(v).length > 0;
  }
  return false;
};

const promotedFactTypeOf = (pf: PromotedFactLike): string => {
  const root = asNonEmptyString(pf?.fact_type);
  if (root) return root;
  const nested = asNonEmptyString(pf?.content_json?.fact_type);
  return nested ?? '';
};

const stringIncludesAny = (text: string, patterns: RegExp[]): boolean => {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
};

export function inferBusinessModelSignalProfileV1(input: {
  structured_summary?: any;
  promoted_facts?: any[] | null;
}): BusinessModelSignalProfileV1 {
  const structured: StructuredSummaryLike = input.structured_summary ?? null;
  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  // Step 2 rules
  // present = structured_summary.business_model exists
  const businessModelText = getStructuredFieldText(structured?.business_model);
  const present = businessModelText != null;

  // pricing_present = pricing fields OR fact_type like pricing_model_v1
  const pricingFromStructured =
    hasAnyValue(structured?.pricing) ||
    hasAnyValue(structured?.pricing_model) ||
    hasAnyValue(structured?.pricingModel) ||
    hasAnyValue(structured?.price) ||
    hasAnyValue(structured?.price_model) ||
    hasAnyValue(structured?.priceModel);

  const pricingFromFacts = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    return ft === 'pricing_model_v1' || ft.includes('pricing');
  });

  const pricing_present = pricingFromStructured || pricingFromFacts;

  // revenue_model_present = recurring/revenue_model keywords in structured_summary only
  const revenue_model_present = (() => {
    const t = (businessModelText ?? '').toLowerCase();
    if (!t) return false;
    return stringIncludesAny(t, [
      /\brecurring\b/i,
      /\bsubscription\b/i,
      /\bsaas\b/i,
      /\b(mrr|arr)\b/i,
      /\brevenue\s+model\b/i,
      /\brevenue\s+stream\b/i,
      /\btake\s*-?rate\b/i,
      /\bcommission\b/i,
      /\btransaction\s+fee\b/i,
      /\busage\s*-?based\b/i,
      /\blicens(e|ing)\b/i,
    ]);
  })();

  // customer_segment_present = customer_type fields present
  const customerTypeText =
    getStructuredFieldText(structured?.customer_type) ??
    getStructuredFieldText(structured?.customerType) ??
    getStructuredFieldText(structured?.customer_segment) ??
    getStructuredFieldText(structured?.customerSegment) ??
    null;

  const customerKind = asNonEmptyString(structured?.customers?.value?.kind ?? null);
  const customer_segment_present = !!(customerTypeText || customerKind);

  // monetization_mechanics_present = unit economics present OR margin signals present
  const monetizationFromStructured =
    hasAnyValue(structured?.unit_economics) ||
    hasAnyValue(structured?.unitEconomics) ||
    hasAnyValue(structured?.gross_margin) ||
    hasAnyValue(structured?.grossMargin) ||
    hasAnyValue(structured?.contribution_margin) ||
    hasAnyValue(structured?.contributionMargin) ||
    hasAnyValue(structured?.ltv_to_cac) ||
    hasAnyValue(structured?.ltvToCac) ||
    hasAnyValue(structured?.payback_months) ||
    hasAnyValue(structured?.paybackMonths) ||
    hasAnyValue(structured?.cac) ||
    hasAnyValue(structured?.ltv) ||
    hasAnyValue(structured?.aov) ||
    hasAnyValue(structured?.arpu);

  const monetizationFromFacts = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    if (!ft) return false;
    if (ft.includes('unit_economics')) return true;
    if (ft.includes('gross_margin') || ft.includes('contribution_margin') || ft.includes('margin')) return true;
    if (ft.includes('ltv') || ft.includes('cac') || ft.includes('payback')) return true;
    if (ft.includes('aov') || ft.includes('arpu')) return true;
    return false;
  });

  const monetization_mechanics_present = monetizationFromStructured || monetizationFromFacts;

  const scoreCount = [
    pricing_present,
    revenue_model_present,
    customer_segment_present,
    monetization_mechanics_present,
  ].filter(Boolean).length;

  const confidence: BusinessModelSignalProfileV1['confidence'] =
    scoreCount >= 3 ? 'high' : scoreCount === 2 ? 'medium' : 'low';

  const signals: BusinessModelSignalProfileV1['signals'] = [
    { code: 'business_model_present', present },
    { code: 'pricing_present', present: pricing_present },
    { code: 'revenue_model_present', present: revenue_model_present },
    { code: 'customer_segment_present', present: customer_segment_present },
    { code: 'monetization_mechanics_present', present: monetization_mechanics_present },
  ];

  return {
    present,
    pricing_present,
    revenue_model_present,
    customer_segment_present,
    monetization_mechanics_present,
    confidence,
    signals,
  };
}
