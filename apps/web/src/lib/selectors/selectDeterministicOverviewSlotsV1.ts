/**
 * PR22 — Deterministic Overview Slots selector (v1)
 *
 * Reads render_package.deterministic_overview_slots from the investor-
 * insights report and returns normalised slot values for the Overview tab.
 *
 * These are last-resort fallback values: the web layer uses them ONLY when
 * authoritative governed/structured-summary values are absent.
 */

export interface DeterministicOverviewSlotResult {
  value: string;
  confidence: number;
  provenance: 'deterministic_fallback_v1';
}

export interface DeterministicOverviewSlotsResult {
  product: DeterministicOverviewSlotResult | null;
  market: DeterministicOverviewSlotResult | null;
  business_model: DeterministicOverviewSlotResult | null;
  /** True when at least one slot has a value. */
  hasAny: boolean;
}

const EMPTY: DeterministicOverviewSlotsResult = {
  product: null,
  market: null,
  business_model: null,
  hasAny: false,
};

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function parseSlot(raw: unknown): DeterministicOverviewSlotResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const value = asNonEmptyString(r.value);
  const confidence = asFiniteNumber(r.confidence);
  if (!value || confidence === null) return null;
  return { value, confidence, provenance: 'deterministic_fallback_v1' };
}

/**
 * Select deterministic overview slots from an investor-insights report object.
 *
 * Usage:
 *   const slots = selectDeterministicOverviewSlotsV1(investorInsights.report);
 *   const productFallback = slots.product?.value ?? null;
 */
export function selectDeterministicOverviewSlotsV1(
  report: unknown
): DeterministicOverviewSlotsResult {
  if (!report || typeof report !== 'object') return EMPTY;

  const r = report as Record<string, unknown>;
  const rp = r.render_package as Record<string, unknown> | null | undefined;
  if (!rp || typeof rp !== 'object') return EMPTY;

  const slots = rp.deterministic_overview_slots as Record<string, unknown> | null | undefined;
  if (!slots || typeof slots !== 'object') return EMPTY;

  const product = parseSlot(slots.product);
  const market = parseSlot(slots.market);
  const businessModel = parseSlot(slots.business_model);

  const hasAny = Boolean(product || market || businessModel);
  return { product, market, business_model: businessModel, hasAny };
}
