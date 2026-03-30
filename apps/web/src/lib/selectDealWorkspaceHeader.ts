import type { DealReport } from './apiClient';
import { selectAuthoritativeBusinessModelV1 } from './selectors/selectAuthoritativeBusinessModelV1';

export type Source = Record<string, any>;

export type HeaderField = {
  value: string | null;
  label?: string;
  sources?: Source[];
};

export type Phase1DealOverview = {
  raise?: unknown;
  business_model?: unknown;
  business_model_arbitration_v1?: unknown;
  revenue?: unknown;
  growth?: unknown;
  customers?: unknown;
};

const formatMoney = (amount: number): string => {
  const v = typeof amount === 'number' && Number.isFinite(amount) ? amount : NaN;
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) {
    const x = v / 1e9;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}B`;
  }
  if (v >= 1e6) {
    const x = v / 1e6;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}M`;
  }
  if (v >= 1e3) {
    const x = v / 1e3;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}K`;
  }
  return `$${Math.round(v).toLocaleString()}`;
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

const isLikelyRaiseSource = (source: Source): boolean => {
  const segmentKey = asNonEmptyString((source as any)?.segment_key)?.toLowerCase() ?? null;
  if (segmentKey === 'team' || segmentKey === 'advisors') return false;

  const title = asNonEmptyString((source as any)?.slide_title)?.toLowerCase() ?? '';
  const note = asNonEmptyString((source as any)?.note_snippet)?.toLowerCase() ?? '';
  const text = `${title} ${note}`;

  const hasRaiseIntent =
    /\b(raising|raise|fundraise|fundraising|ask|seeking|series\s*[a-z]|pre[\s-]?seed|seed)\b/.test(text);
  const hasNonRaiseValueContext =
    /\b(in\s+value|created\s+over|valuation|enterprise\s+value|tam|sam|som|market\s+size)\b/.test(text);

  if (hasNonRaiseValueContext && !hasRaiseIntent) return false;
  return true;
};

const isTrustworthyRaise = (structuredRaise: any, kpiRaise: any): boolean => {
  const roundLabel = asNonEmptyString(structuredRaise?.round_label) ?? asNonEmptyString(kpiRaise?.label);
  if (roundLabel) return true;

  const sources = Array.isArray(structuredRaise?.sources)
    ? (structuredRaise.sources as Source[])
    : Array.isArray(kpiRaise?.sources)
      ? (kpiRaise.sources as Source[])
      : [];
  if (sources.length === 0) return true;

  return sources.some((s) => isLikelyRaiseSource(s));
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

    // KPI normalization must occur server-side only to prevent drift.
    const kpis = structuredSummary && typeof structuredSummary === 'object' ? (structuredSummary as any).kpis : null;

    const structuredRaise = structuredSummary && typeof structuredSummary === 'object' ? (structuredSummary as any).raise : null;
    const raiseAmountRaw = structuredRaise?.value_json?.amount?.amount;
    const raiseAmount = typeof raiseAmountRaw === 'number' && Number.isFinite(raiseAmountRaw) ? raiseAmountRaw : null;
    const raiseRoundLabel = asNonEmptyString(structuredRaise?.round_label);

    const kpiRaise = kpis?.raise;

    const businessModel = kpis?.business_model;
    const revenue = kpis?.revenue;
    const growth = kpis?.growth;
    const customers = kpis?.customers;

    const bm = selectAuthoritativeBusinessModelV1({ report, phase1 });
    const promotedValue = asNonEmptyString(businessModel?.value);

    const revenueLabel = computeRevenueBadgeLabel(revenue);
    const growthLabel = computeGrowthBadgeLabel(growth);

    const raiseTrusted = isTrustworthyRaise(structuredRaise, kpiRaise);

    const raiseValue = (() => {
      if (!raiseTrusted) return null;
      if (raiseAmount != null) return formatMoney(raiseAmount);
      return asNonEmptyString(kpiRaise?.value) ?? asNonEmptyString(kpiRaise?.value?.raw) ?? null;
    })();
    const raiseLabel = raiseTrusted ? (raiseRoundLabel ?? asNonEmptyString(kpiRaise?.label)) : null;
    const raiseSources = Array.isArray(structuredRaise?.sources)
      ? (structuredRaise.sources as Source[])
      : (Array.isArray(kpiRaise?.sources) ? (kpiRaise.sources as Source[]) : undefined);

    return {
      ready: true,
      raise: {
        value: raiseValue,
        // Optional stage/round label is separate from the numeric value.
        label: raiseValue != null ? (raiseLabel ?? undefined) : undefined,
        sources: raiseSources,
      },
      business_model_synthesized: {
        value: null,
      },
      business_model: {
        value: bm.value,
        label: bm.is_arbitrated
          ? (bm.label ?? undefined)
          : promotedValue
            ? (asNonEmptyString(businessModel?.label) ?? undefined)
            : undefined,
        sources: bm.is_arbitrated
          ? undefined
          : (Array.isArray(businessModel?.sources) ? (businessModel.sources as Source[]) : undefined),
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
        value:
          asNonEmptyString(customers?.value?.raw) ??
          (typeof customers?.value?.count === 'number' && Number.isFinite(customers.value.count)
            ? `${Math.round(customers.value.count)} customers`
            : null),
        label: asNonEmptyString(customers?.label) ?? undefined,
        sources: Array.isArray(customers?.sources) ? (customers.sources as Source[]) : undefined,
      },
    };
  }

  return {
    ready: false,
    raise: fieldFromUnknown(phase1?.raise),
    business_model_synthesized: { value: null },
    business_model: (() => {
      const bm = selectAuthoritativeBusinessModelV1({ report: null, phase1 });
      if (bm.is_arbitrated && bm.value) {
        return { value: bm.value, label: bm.label ?? undefined };
      }
      return fieldFromUnknown(phase1?.business_model);
    })(),
    revenue: fieldFromUnknown(phase1?.revenue),
    growth: fieldFromUnknown(phase1?.growth),
    customers: fieldFromUnknown(phase1?.customers),
  };
}
