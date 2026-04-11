type SourceLike = Record<string, any>;

export type DeterministicDealSummaryCitation = {
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  snippet: string;
};

export type DeterministicDealSummaryLine = {
  text: string | null;
  sources: DeterministicDealSummaryCitation[];
};

export type DeterministicDealSummaryV1 = {
  version: 'deal_summary_v1';
  ready: boolean;
  reason: string | null;
  tiers: {
    hero: string;
    overview: string;
    deep: string;
  };
  one_liner: DeterministicDealSummaryLine | null;
  product: DeterministicDealSummaryLine | null;
  market: DeterministicDealSummaryLine | null;
  paragraphs: DeterministicDealSummaryLine[];
  warnings: string[];
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();

const formatMoneyUsdShort = (amount: number): string => {
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

const normalizeCitations = (sources: unknown): DeterministicDealSummaryCitation[] => {
  if (!Array.isArray(sources)) return [];

  const out: DeterministicDealSummaryCitation[] = [];
  for (const raw of sources) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as SourceLike;

    const source_document_id = String(s.source_document_id ?? s.document_id ?? s.documentId ?? '').trim();
    const page_index_raw = s.page_index ?? s.pageIndex;
    const page_index = typeof page_index_raw === 'number' && Number.isFinite(page_index_raw) ? Math.floor(page_index_raw) : null;

    if (!source_document_id || page_index == null) continue;

    const slide_title = asNonEmptyString(s.slide_title ?? s.page_slide_title ?? s.title) ?? null;
    const snippet =
      asNonEmptyString(s.snippet) ??
      asNonEmptyString(s.note_snippet) ??
      asNonEmptyString(s.note) ??
      '';

    out.push({
      source_document_id,
      page_index,
      slide_title,
      snippet,
    });
  }

  // Dedupe by doc+page.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.source_document_id}::${c.page_index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const mergeCitations = (...blocks: Array<DeterministicDealSummaryCitation[]>): DeterministicDealSummaryCitation[] => {
  const out: DeterministicDealSummaryCitation[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const c of Array.isArray(b) ? b : []) {
      const k = `${c.source_document_id}::${c.page_index}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
};

const buildLine = (text: string | null, sources: DeterministicDealSummaryCitation[]): DeterministicDealSummaryLine | null => {
  const t = asNonEmptyString(text);
  if (!t) return null;
  return { text: t, sources: Array.isArray(sources) ? sources : [] };
};

const kpiDisplayFromStructured = (structured: any, key: string): string | null => {
  const node = structured?.[key];
  if (!node || typeof node !== 'object') return null;
  const raw = asNonEmptyString((node as any)?.value?.raw) ?? asNonEmptyString((node as any)?.value_raw) ?? asNonEmptyString((node as any)?.value);
  return raw;
};

/** Filter the "Unknown" sentinel value that LLM extraction can leave in KPI fields when
 * a guard has cleared the canonical value but the raw text said "Unknown". */
const sanitizeKpiText = (text: string | null): string | null => {
  if (!text) return null;
  const s = text.trim();
  return s.toLowerCase() === 'unknown' ? null : s;
};

/** Detect obvious OCR allocation / pie-chart percentage shards.
 * These appear when OCR reads stacked-bar or pie-chart labels — e.g. "20% 35% 45%"
 * or "50% Engineering 25% Marketing 15% Operations". Suppress the entire field. */
const isOcrPercentageShard = (text: string): boolean => {
  // Three or more bare percentage tokens in sequence (e.g. "20% 35% 45%")
  if (/(?:\d+(?:\.\d+)?%\s+){2,}\d+(?:\.\d+)?%/.test(text)) return true;
  // Allocation breakdown: "XX% [word]" repeated 2+ times (e.g. "50% Eng 25% Sales 25% Ops")
  if (/(?:\d+(?:\.\d+)?%\s+\w+\s*){2,}\d+(?:\.\d+)?%/.test(text)) return true;
  return false;
};

export function buildDeterministicDealSummaryV1FromStructuredSummary(input: {
  structured_summary: any;
}): DeterministicDealSummaryV1 {
  const structured = input?.structured_summary && typeof input.structured_summary === 'object' ? input.structured_summary : {};

  const raiseAmountRaw = structured?.raise?.value_json?.amount?.amount;
  const raiseAmount = typeof raiseAmountRaw === 'number' && Number.isFinite(raiseAmountRaw) ? raiseAmountRaw : null;
  const raiseRound = asNonEmptyString(structured?.raise?.round_label) ?? null;
  const raiseDisplay = (() => {
    if (raiseAmount != null) return formatMoneyUsdShort(raiseAmount);
    const raw = asNonEmptyString(structured?.raise?.value);
    if (!raw) return null;
    // Treat sentinel "Unknown" as no-data — do not emit "Raise: Unknown." in summary tiers
    if (raw.toLowerCase() === 'unknown') return null;
    return raw;
  })();
  const raiseSources = normalizeCitations(structured?.raise?.sources);

  const productText = (() => {
    const t = asNonEmptyString(structured?.product_summary_v1?.value) ?? asNonEmptyString(structured?.product_summary?.value) ?? null;
    return t && !isOcrPercentageShard(t) ? t : null;
  })();
  const productSources = normalizeCitations(structured?.product_summary_v1?.sources ?? structured?.product_summary?.sources);

  const marketText = (() => {
    const t = asNonEmptyString(structured?.market_summary_v1?.value) ?? asNonEmptyString(structured?.market_summary?.value) ?? null;
    return t && !isOcrPercentageShard(t) ? t : null;
  })();
  const marketSources = normalizeCitations(structured?.market_summary_v1?.sources ?? structured?.market_summary?.sources);

  const businessModelText = (() => {
    const t = asNonEmptyString(structured?.business_model?.value) ?? asNonEmptyString(structured?.business_model_summary?.value) ?? null;
    return t && !isOcrPercentageShard(t) ? t : null;
  })();
  const businessModelSources = normalizeCitations(structured?.business_model?.sources ?? structured?.business_model_summary?.sources);

  const revenueText = sanitizeKpiText(kpiDisplayFromStructured(structured, 'revenue'));
  const revenueSources = normalizeCitations(structured?.revenue?.sources);

  const customersText = sanitizeKpiText(kpiDisplayFromStructured(structured, 'customers'));
  const customersSources = normalizeCitations(structured?.customers?.sources);

  const growthText = (() => {
    const g = structured?.growth;
    const pct = g?.value?.percent;
    if (typeof pct === 'number' && Number.isFinite(pct)) return `${pct}%`;
    return sanitizeKpiText(kpiDisplayFromStructured(structured, 'growth'));
  })();
  const growthSources = normalizeCitations(structured?.growth?.sources);

  const hero = productText ?? marketText ?? businessModelText ?? null;

  const overviewParts: string[] = [];
  if (marketText) overviewParts.push(marketText.replace(/\s*\.$/, '.'));
  if (raiseDisplay) {
    const raiseLabel = raiseRound ? `${raiseDisplay} (${raiseRound})` : raiseDisplay;
    overviewParts.push(`Raise: ${raiseLabel}.`);
  }
  const overview = overviewParts.join(' ');

  const revenueIsProjected = !!(structured?.revenue as any)?.is_projected;
  const deepParts: string[] = [];
  if (businessModelText) deepParts.push(`Business model: ${businessModelText.replace(/\s*\.$/, '.')}`);
  if (revenueText) {
    const revLabel = revenueIsProjected
      ? `Revenue (projected): ${revenueText.replace(/\s*\.$/, '.')}`
      : `Revenue: ${revenueText.replace(/\s*\.$/, '.')}`;
    deepParts.push(revLabel);
  }
  if (customersText) deepParts.push(`Customers: ${customersText.replace(/\s*\.$/, '.')}`);
  if (growthText) deepParts.push(`Growth: ${growthText.replace(/\s*\.$/, '.')}`);

  const deep = deepParts.map((s) => normalizeWhitespace(s)).filter(Boolean).join(' ');

  const ready = Boolean(asNonEmptyString(hero) || asNonEmptyString(overview) || asNonEmptyString(deep));

  const warnings: string[] = [];
  if (raiseAmount == null && raiseDisplay) warnings.push('raise_amount_missing');
  if (!productText) warnings.push('product_missing');
  if (!marketText) warnings.push('market_missing');

  const oneLinerLine = buildLine(hero, productSources.length > 0 ? productSources : marketSources);
  const productLine = buildLine(productText, productSources);
  const marketLine = buildLine(marketText, marketSources);

  const paragraphs: DeterministicDealSummaryLine[] = [];
  const overviewSources = mergeCitations(productSources, marketSources, raiseSources);
  const deepSources = mergeCitations(raiseSources, businessModelSources, revenueSources, customersSources, growthSources);

  const overviewLine = buildLine(overview, overviewSources);
  if (overviewLine) paragraphs.push(overviewLine);

  const deepLine = buildLine(deep, deepSources);
  if (deepLine) paragraphs.push(deepLine);

  return {
    version: 'deal_summary_v1',
    ready,
    reason: ready ? null : 'missing_inputs',
    tiers: {
      hero: asNonEmptyString(hero) ?? '',
      overview: asNonEmptyString(overview) ?? '',
      deep: asNonEmptyString(deep) ?? '',
    },
    one_liner: oneLinerLine,
    product: productLine,
    market: marketLine,
    paragraphs,
    warnings,
  };
}
