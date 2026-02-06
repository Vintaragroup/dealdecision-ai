import type { DealReport } from './apiClient';

export type Source = Record<string, any>;

export type HeaderField = {
  value: string | null;
  label?: string;
  sources?: Source[];
};

export type Phase1DealOverview = {
  raise?: unknown;
  business_model?: unknown;
  revenue?: unknown;
  growth?: unknown;
  customers?: unknown;
};

type FactProvenance = {
  scope: string | null;
  year: number | null;
  period: string | null;
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const fieldFromUnknown = (input: unknown): HeaderField => {
  const direct = asNonEmptyString(input);
  if (direct) return { value: direct };

  if (input && typeof input === 'object') {
    const obj = input as any;

    const valueDirect = asNonEmptyString(obj.value);
    const valueRaw = asNonEmptyString(obj.value?.raw);

    return {
      value: valueDirect ?? valueRaw ?? null,
      label: asNonEmptyString(obj.label) ?? undefined,
      sources: Array.isArray(obj.sources) ? (obj.sources as Source[]) : undefined,
    };
  }

  return { value: null };
};

const extractProvenanceFromSources = (sources: Source[] | undefined): FactProvenance => {
  const s0 = Array.isArray(sources) && sources.length > 0 ? sources[0] : null;
  if (!s0 || typeof s0 !== 'object') return { scope: null, year: null, period: null };

  const rawScope = asNonEmptyString((s0 as any).scope) ?? asNonEmptyString((s0 as any)?.meta?.scope) ?? asNonEmptyString((s0 as any)?.meta?.revenue?.scope);
  const rawPeriod =
    asNonEmptyString((s0 as any).period) ??
    asNonEmptyString((s0 as any)?.meta?.period) ??
    asNonEmptyString((s0 as any)?.meta?.revenue?.period) ??
    asNonEmptyString((s0 as any)?.meta?.subtype) ??
    asNonEmptyString((s0 as any)?.meta?.revenue?.subtype);

  const yearCandidate =
    typeof (s0 as any).year === 'number'
      ? (s0 as any).year
      : typeof (s0 as any)?.meta?.year === 'number'
        ? (s0 as any).meta.year
        : typeof (s0 as any)?.meta?.revenue?.year === 'number'
          ? (s0 as any).meta.revenue.year
          : null;

  const year = yearCandidate != null && Number.isFinite(yearCandidate) ? Math.round(yearCandidate) : null;
  return { scope: rawScope, year, period: rawPeriod };
};

const inferYearFromText = (text: string | null): number | null => {
  if (!text) return null;
  const m = text.match(/\b(20\d{2})\b/);
  if (!m?.[1]) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
};

const normalizeScope = (scope: string | null): 'company_financials_table' | 'company_total' | 'channel_attributed' | null => {
  const s = String(scope ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'channel_attributed' || s === 'attributed' || s.includes('attributed')) return 'channel_attributed';
  if (s === 'company_financials_table' || s.includes('financial') || s.includes('table')) return 'company_financials_table';
  if (s === 'company_total' || s.includes('company')) return 'company_total';
  return null;
};

const normalizePeriod = (period: string | null): 'annual' | 'ytd' | 'forecast' | null => {
  const p = String(period ?? '').trim().toLowerCase();
  if (!p) return null;
  if (p === 'ytd' || p.includes('ytd')) return 'ytd';
  if (p === 'forecast' || p === 'projection' || p === 'projections' || p.includes('forecast') || p.includes('project')) return 'forecast';
  if (p === 'annual' || p.includes('annual')) return 'annual';
  return null;
};

const computeRevenueBadgeLabel = (revenue: any): string | undefined => {
  const sources: Source[] | undefined = Array.isArray(revenue?.sources) ? (revenue.sources as Source[]) : undefined;
  const prov = extractProvenanceFromSources(sources);
  const scope = normalizeScope(prov.scope);
  const period = normalizePeriod(prov.period);

  const rawValue = asNonEmptyString(revenue?.value?.raw) ?? null;
  const rawLabel = asNonEmptyString(revenue?.label) ?? null;
  const labelYear = rawLabel && /^\d{4}$/.test(rawLabel) ? Number(rawLabel) : null;
  const valueYear = inferYearFromText(rawValue);
  const year = prov.year ?? labelYear ?? valueYear;

  const valueLower = String(rawValue ?? '').toLowerCase();
  const labelLower = String(rawLabel ?? '').toLowerCase();
  const isAttributed = scope === 'channel_attributed' || labelLower === 'attributed' || valueLower.includes('attributed');
  if (isAttributed) return 'Revenue (Attributed)';

  const isYtd = period === 'ytd' || valueLower.includes('ytd') || labelLower.includes('ytd');
  if (isYtd && typeof year === 'number' && Number.isFinite(year)) return `Revenue (${year} YTD)`;
  if (isYtd) return 'Revenue (YTD)';

  // Financial table (or otherwise year-anchored) revenue should carry the year.
  if ((scope === 'company_financials_table' || typeof year === 'number') && typeof year === 'number' && Number.isFinite(year)) {
    return `Revenue (${year})`;
  }

  // Preserve non-misleading labels; avoid showing bare “Annual”.
  if (rawLabel && rawLabel.toLowerCase() !== 'annual') return rawLabel;
  return undefined;
};

const computeGrowthBadgeLabel = (growth: any): string | undefined => {
  const sources: Source[] | undefined = Array.isArray(growth?.sources) ? (growth.sources as Source[]) : undefined;
  const prov = extractProvenanceFromSources(sources);
  const period = normalizePeriod(prov.period);

  const rawLabel = asNonEmptyString(growth?.label) ?? null;
  const rawValue = asNonEmptyString(growth?.value?.raw) ?? null;
  const valueYear = typeof growth?.value?.year === 'number' && Number.isFinite(growth.value.year) ? Math.round(growth.value.year) : null;
  const year = prov.year ?? valueYear ?? inferYearFromText(rawValue);

  const isForecast = period === 'forecast' || String(rawLabel ?? '').toLowerCase() === 'forecast' || String(rawValue ?? '').toLowerCase().includes('forecast');
  if (isForecast) {
    if (typeof year === 'number' && Number.isFinite(year)) return `Growth (Forecast ${year})`;
    // Keep legacy label when the year isn't available.
    if (rawLabel && rawLabel.toLowerCase() === 'forecast') return 'Forecast';
    return 'Forecast';
  }

  // Preserve non-misleading labels; avoid showing “Annual” as a badge.
  if (rawLabel && rawLabel.toLowerCase() !== 'annual') return rawLabel;
  return undefined;
};

/**
 * Canonical selection for Deal Workspace header tiles.
 *
 * Routing rules:
 * - If the report appears “ready” (either `report.ready === true` OR it contains `structured_summary`):
 *   ONLY read from `report.structured_summary.*`.
 * - Otherwise: ONLY read from Phase 1 (`phase1`).
 * - Preserve `label` and `sources` as-is (no inference / formatting).
 */
export function selectDealWorkspaceHeader(
  report: DealReport | null,
  phase1: Phase1DealOverview | null,
): {
  ready: boolean;
  raise: HeaderField;
  business_model_synthesized: HeaderField;
  business_model: HeaderField;
  revenue: HeaderField;
  growth: HeaderField;
  customers: HeaderField;
} {
  const structuredSummaryCandidate = (report as any)?.structured_summary;
  const readyFlag = typeof (report as any)?.ready === 'boolean' ? ((report as any).ready as boolean) : null;
  const ready = readyFlag === false ? false : readyFlag === true ? true : (!!structuredSummaryCandidate && typeof structuredSummaryCandidate === 'object');

  if (ready) {
    const structuredSummary = ((report as any)?.structured_summary ?? null) as any;

    const raise = structuredSummary?.raise;
    const businessModelSynth = structuredSummary?.business_model_summary;
    const businessModel = structuredSummary?.business_model;
    const revenue = structuredSummary?.revenue;
    const growth = structuredSummary?.growth;
    const customers = structuredSummary?.customers;

    const synthesizedValue = asNonEmptyString(businessModelSynth?.value);
    const promotedValue = asNonEmptyString(businessModel?.value);
    const chosenValue = synthesizedValue ?? promotedValue;
    const usedSynthesized = Boolean(synthesizedValue);

    const revenueLabel = computeRevenueBadgeLabel(revenue);
    const growthLabel = computeGrowthBadgeLabel(growth);

    return {
      ready: true,
      raise: {
        value: asNonEmptyString(raise?.value),
        label: asNonEmptyString(raise?.label) ?? undefined,
        sources: Array.isArray(raise?.sources) ? (raise.sources as Source[]) : undefined,
      },
      business_model_synthesized: {
        value: synthesizedValue,
        label: synthesizedValue ? 'Synthesized' : undefined,
      },
      business_model: {
        value: chosenValue,
        label: usedSynthesized ? 'Synthesized' : (asNonEmptyString(businessModel?.label) ?? undefined),
        sources: usedSynthesized ? undefined : (Array.isArray(businessModel?.sources) ? (businessModel.sources as Source[]) : undefined),
      },
      revenue: {
        value: asNonEmptyString(revenue?.value?.raw),
        label: revenueLabel,
        sources: Array.isArray(revenue?.sources) ? (revenue.sources as Source[]) : undefined,
      },
      growth: {
        value: asNonEmptyString(growth?.value?.raw),
        label: growthLabel,
        sources: Array.isArray(growth?.sources) ? (growth.sources as Source[]) : undefined,
      },
      customers: {
        value: asNonEmptyString(customers?.value?.raw),
        label: asNonEmptyString(customers?.label) ?? undefined,
        sources: Array.isArray(customers?.sources) ? (customers.sources as Source[]) : undefined,
      },
    };
  }

  return {
    ready: false,
    raise: fieldFromUnknown(phase1?.raise),
    business_model_synthesized: { value: null },
    business_model: fieldFromUnknown(phase1?.business_model),
    revenue: fieldFromUnknown(phase1?.revenue),
    growth: fieldFromUnknown(phase1?.growth),
    customers: fieldFromUnknown(phase1?.customers),
  };
}
