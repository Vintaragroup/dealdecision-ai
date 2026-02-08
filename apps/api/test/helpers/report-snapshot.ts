type AnyRecord = Record<string, any>;

const normalizeWhitespace = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s : null;
};

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
};

const toPageNumber = (source: any): number | null => {
  const page = asNumber(source?.page);
  if (page != null) return page;
  const pageIndex = asNumber(source?.page_index);
  if (pageIndex != null) return pageIndex + 1;
  return null;
};

const pickPrimarySource = (
  sources: unknown
): { page: number; slide_title: string | null } | null => {
  const arr = Array.isArray(sources) ? (sources as any[]) : [];
  const normalized = arr
    .map((s) => {
      const page = toPageNumber(s);
      if (page == null) return null;
      const slide_title = normalizeWhitespace(s?.slide_title) ?? null;
      return { page, slide_title };
    })
    .filter(Boolean) as Array<{ page: number; slide_title: string | null }>;

  if (normalized.length === 0) return null;
  normalized.sort((a, b) => a.page - b.page || String(a.slide_title ?? '').localeCompare(String(b.slide_title ?? '')));
  return normalized[0] ?? null;
};

const buildKpiSnapshot = (field: any): {
  value_raw: any;
  value: any;
  scope_label: string | null;
  selection_reason: string | null;
  source: { page: number; slide_title: string | null } | null;
} => {
  const value = field?.value ?? null;

  // Some structured_summary fields have `value.raw`, others are plain strings.
  const value_raw = (() => {
    if (value && typeof value === 'object' && typeof (value as any).raw === 'string') {
      return normalizeWhitespace((value as any).raw) ?? null;
    }
    if (typeof value === 'string') return normalizeWhitespace(value) ?? null;
    return null;
  })();

  const scope_label = normalizeWhitespace(field?.label) ?? null;
  const selection_reason = normalizeWhitespace(field?.selection_reason) ?? null;
  const source = pickPrimarySource(field?.sources);

  // Preserve value object (minus volatile ordering) but keep it small/stable.
  const stableValue = (() => {
    if (!value || typeof value !== 'object') return value_raw;

    // Revenue value
    if ('amount' in (value as any) || 'currency' in (value as any) || 'period' in (value as any)) {
      return {
        amount: typeof (value as any).amount === 'number' && Number.isFinite((value as any).amount) ? (value as any).amount : null,
        currency: normalizeWhitespace((value as any).currency) ?? null,
        period: normalizeWhitespace((value as any).period) ?? null,
      };
    }

    // Customers value
    if ('count' in (value as any) || 'kind' in (value as any)) {
      return {
        count: typeof (value as any).count === 'number' && Number.isFinite((value as any).count) ? (value as any).count : null,
        kind: normalizeWhitespace((value as any).kind) ?? null,
      };
    }

    // Growth value
    if ('percent' in (value as any) || 'year' in (value as any)) {
      return {
        percent: typeof (value as any).percent === 'number' && Number.isFinite((value as any).percent) ? (value as any).percent : null,
        year: typeof (value as any).year === 'number' && Number.isFinite((value as any).year) ? (value as any).year : null,
      };
    }

    return value_raw;
  })();

  return {
    value_raw,
    value: stableValue,
    scope_label,
    selection_reason,
    source,
  };
};

const getReportObject = (report: any): any => {
  if (report && typeof report === 'object' && (report as any).report && typeof (report as any).report === 'object') {
    return (report as any).report;
  }
  return report;
};

const collectCitationPages = (sources: any[]): number[] => {
  const pages: number[] = [];
  for (const s of sources) {
    const page = toPageNumber(s);
    if (page == null) continue;
    pages.push(page);
  }
  return pages;
};

const collectDealSummaryCitations = (dealSummary: any): AnyRecord[] => {
  if (!dealSummary || typeof dealSummary !== 'object') return [];

  const lines: any[] = [];
  const maybePushLine = (line: any) => {
    if (!line || typeof line !== 'object') return;
    if (Array.isArray(line.sources)) lines.push(...line.sources);
  };

  maybePushLine(dealSummary.one_liner);
  maybePushLine(dealSummary.product);
  maybePushLine(dealSummary.market_target);
  maybePushLine(dealSummary.market_context);
  maybePushLine(dealSummary.market);

  if (Array.isArray(dealSummary.paragraphs)) {
    for (const p of dealSummary.paragraphs) maybePushLine(p);
  }

  return lines;
};

const getScoreExplanation = (reportObj: any): any => {
  if (reportObj?.metadata?.score_explanation && typeof reportObj.metadata.score_explanation === 'object') {
    return reportObj.metadata.score_explanation;
  }
  if (reportObj?.score_explanation && typeof reportObj.score_explanation === 'object') return reportObj.score_explanation;
  if (reportObj?.metadata?.scoreExplanation && typeof reportObj.metadata.scoreExplanation === 'object') return reportObj.metadata.scoreExplanation;
  return null;
};

const understandingSection = (items: unknown): { count: number; items: string[] } => {
  const arr = Array.isArray(items) ? (items as any[]) : [];
  const texts = arr
    .map((i) => normalizeWhitespace(i?.text))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  // Normalize ordering to be robust against upstream ordering changes.
  const uniq = Array.from(new Set(texts));
  uniq.sort((a, b) => a.localeCompare(b));

  return {
    count: uniq.length,
    items: uniq.slice(0, 5),
  };
};

/**
 * Extracts a compact, stable snapshot for regression testing.
 * - Strips volatile fields (ids/timestamps) by only selecting stable subfields.
 * - Normalizes whitespace.
 * - Normalizes ordering for arrays.
 */
export function pickStableReportExcerpt(report: any): any {
  const reportObj = getReportObject(report);
  const structured = (reportObj as any)?.structured_summary ?? {};
  const dealSummary = (reportObj as any)?.deal_summary ?? (report as any)?.deal_summary ?? null;

  const metadata = (reportObj as any)?.metadata ?? (report as any)?.metadata ?? {};
  const deckArchetype = metadata?.deck_archetype ?? null;

  const scoreExplanation = getScoreExplanation(reportObj);
  const understanding = scoreExplanation?.understanding_v1 ?? null;

  const kpis = {
    raise: buildKpiSnapshot(structured?.raise ?? null),
    revenue: buildKpiSnapshot(structured?.revenue ?? null),
    customers: buildKpiSnapshot(structured?.customers ?? null),
    growth: buildKpiSnapshot(structured?.growth ?? null),
  };

  const performance = (() => {
    const attributed = structured?.marketing_metrics?.attributed_revenue ?? null;
    if (!attributed || typeof attributed !== 'object') return null;

    const value_raw = normalizeWhitespace(attributed?.value_raw) ?? null;
    const channel = normalizeWhitespace(attributed?.channel) ?? null;
    const source = pickPrimarySource(attributed?.sources);

    if (!value_raw && !channel && !source) return null;

    return {
      marketing_attributed_revenue_v1: {
        value_raw,
        value: null,
        scope_label: channel,
        selection_reason: 'marketing_attributed_revenue_v1',
        source,
      },
    };
  })();

  const tiers = (dealSummary && typeof dealSummary === 'object' ? (dealSummary as any).tiers : null) ?? null;
  const tierHero = normalizeWhitespace(tiers?.hero) ?? '';
  const tierOverview = normalizeWhitespace(tiers?.overview) ?? '';
  const tierDeep = normalizeWhitespace(tiers?.deep) ?? '';

  const productSummaryV1 = structured?.product_summary_v1 && typeof structured.product_summary_v1 === 'object'
    ? structured.product_summary_v1
    : null;

  const dealSummaryV1 = structured?.deal_summary_v1 && typeof structured.deal_summary_v1 === 'object'
    ? structured.deal_summary_v1
    : null;

  const product_definition = normalizeWhitespace(productSummaryV1?.product_definition) ?? null;
  const product_validation = normalizeWhitespace(productSummaryV1?.product_validation) ?? null;

  const market_target = (() => {
    const v = normalizeWhitespace(dealSummaryV1?.market_target);
    if (v) return v;
    const fallback = normalizeWhitespace(dealSummary?.market_target?.text);
    return fallback ?? null;
  })();

  const market_context = (() => {
    const v = normalizeWhitespace(dealSummaryV1?.market_context);
    if (v) return v;
    const fallback = normalizeWhitespace(dealSummary?.market_context?.text);
    return fallback ?? null;
  })();

  // Citations: count from structured_summary KPIs + canonical deal_summary_v1 lines.
  const allCitationSources: AnyRecord[] = [];
  for (const key of ['raise', 'revenue', 'customers', 'growth']) {
    const sources = Array.isArray((structured as any)?.[key]?.sources) ? (structured as any)[key].sources : [];
    allCitationSources.push(...sources);
  }
  allCitationSources.push(...collectDealSummaryCitations(dealSummary));

  const citationPages = collectCitationPages(allCitationSources);
  const uniquePages = new Set<number>(citationPages);

  return {
    debug: {
      deck_archetype_key: normalizeWhitespace(deckArchetype?.key) ?? null,
      archetype_confidence: typeof deckArchetype?.confidence === 'number' && Number.isFinite(deckArchetype.confidence)
        ? deckArchetype.confidence
        : null,
    },

    structured_summary: {
      kpis: {
        ...kpis,
        ...(performance ? { performance } : {}),
      },
    },

    deal_summary: {
      tiers: {
        hero: tierHero,
        overview: tierOverview,
        deep: tierDeep,
      },
      tier_char_counts: {
        hero: tierHero.length,
        overview: tierOverview.length,
        deep: tierDeep.length,
      },
    },

    ...(product_definition || product_validation
      ? {
          product_summary: {
            product_definition,
            product_validation,
          },
        }
      : {}),

    ...(market_target || market_context
      ? {
          market_summary: {
            market_target,
            market_context,
          },
        }
      : {}),

    score_explanation: {
      understanding_v1: understanding
        ? {
            summary_char_count: (normalizeWhitespace(understanding?.summary) ?? '').length,
            strengths: understandingSection(understanding?.strengths),
            execution_dependencies: understandingSection(understanding?.execution_dependencies),
            diligence_open_items: understandingSection(understanding?.diligence_open_items),
          }
        : null,
    },

    citations: {
      total_sources: citationPages.length,
      unique_pages: uniquePages.size,
    },
  };
}
