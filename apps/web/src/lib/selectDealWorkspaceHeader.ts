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

/**
 * Canonical selection for Deal Workspace header tiles.
 *
 * Routing rules:
 * - If `report?.ready === true`: ONLY read from `report.structured_summary.*`.
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
  const ready = (report as any)?.ready === true;

  if (ready) {
    const structuredSummary = (report as any)?.structured_summary as any;

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
        label: asNonEmptyString(revenue?.label) ?? undefined,
        sources: Array.isArray(revenue?.sources) ? (revenue.sources as Source[]) : undefined,
      },
      growth: {
        value: asNonEmptyString(growth?.value?.raw),
        label: asNonEmptyString(growth?.label) ?? undefined,
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
