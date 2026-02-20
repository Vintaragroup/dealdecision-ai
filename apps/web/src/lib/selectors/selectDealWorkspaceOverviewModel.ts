import { normalizeDealSummaryParagraphs } from '../normalizeDealSummaryParagraphs';
import { assertEvidenceMatchesOrigin, type EvidenceOrigin, type EvidencePointer } from '../assertions/assertEvidenceMatchesOrigin';

export type DealWorkspaceOverviewOrigin = 'deterministic' | 'overlay' | 'missing';

export type DealWorkspaceOverviewField = {
  value: string;
  origin: DealWorkspaceOverviewOrigin;
  evidenceIds: string[];
  evidence: EvidencePointer[];
};

export type DealWorkspaceOverviewModel = {
  summaries: {
    short: DealWorkspaceOverviewField;
    long: {
      paragraphs: string[];
      text: string;
      origin: DealWorkspaceOverviewOrigin;
      evidenceIds: string[];
      evidence: EvidencePointer[];
    };
  };
  keyFacts: {
    product: DealWorkspaceOverviewField;
    market: DealWorkspaceOverviewField;
    business_model: DealWorkspaceOverviewField;
    raise_terms: DealWorkspaceOverviewField;
  };
};

type InputField = {
  value: unknown;
  evidenceIds?: unknown;
};

export type SelectDealWorkspaceOverviewModelInput = {
  deterministic: {
    summaries: {
      short: InputField;
      long: InputField;
      longParagraphsFallback?: unknown;
    };
    keyFacts: {
      product: InputField;
      market: InputField;
      business_model: InputField;
      raise_terms: InputField;
    };
  };
  overlay?: {
    summaries?: {
      short?: InputField;
      longParagraphs?: unknown;
    };
    keyFacts?: {
      product?: InputField;
      market?: InputField;
      business_model?: InputField;
      raise_terms?: InputField;
    };
  } | null;
};

const safeText = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s === '—') return '';
  return s;
};

const normalizeEvidenceIds = (ids: unknown): string[] => {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of ids) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 25);
};

const chooseField = (opts: {
  fieldKey: string;
  deterministic: InputField;
  overlay?: InputField;
}): DealWorkspaceOverviewField => {
  const det = safeText(opts.deterministic.value);
  const detEvidenceIds = normalizeEvidenceIds(opts.deterministic.evidenceIds);

  if (det) {
    const evidence: EvidencePointer[] = detEvidenceIds.map((id) => ({ origin: 'deterministic', kind: 'id', id }));
    return { value: det, origin: 'deterministic', evidenceIds: detEvidenceIds, evidence };
  }

  const ov = safeText(opts.overlay?.value);
  const ovEvidenceIds = normalizeEvidenceIds(opts.overlay?.evidenceIds);
  if (ov) {
    const evidence: EvidencePointer[] = ovEvidenceIds.map((id) => ({ origin: 'overlay', kind: 'id', id }));
    return { value: ov, origin: 'overlay', evidenceIds: ovEvidenceIds, evidence };
  }

  return { value: '—', origin: 'missing', evidenceIds: [], evidence: [] };
};

const chooseSummaryLong = (opts: {
  deterministicLong: InputField;
  deterministicLongParagraphsFallback?: unknown;
  overlayLongParagraphs?: unknown;
}): { paragraphs: string[]; text: string; origin: DealWorkspaceOverviewOrigin; evidenceIds: string[]; evidence: EvidencePointer[] } => {
  const detLong = safeText(opts.deterministicLong.value);
  const detEvidenceIds = normalizeEvidenceIds(opts.deterministicLong.evidenceIds);

  if (detLong) {
    const paragraphs = normalizeDealSummaryParagraphs(detLong);
    const text = paragraphs.join('\n\n');
    const evidence: EvidencePointer[] = detEvidenceIds.map((id) => ({ origin: 'deterministic', kind: 'id', id }));
    return { paragraphs, text, origin: 'deterministic', evidenceIds: detEvidenceIds, evidence };
  }

  const detFallbackParas = normalizeDealSummaryParagraphs(opts.deterministicLongParagraphsFallback);
  if (detFallbackParas.length > 0) {
    const text = detFallbackParas.join('\n\n');
    const evidence: EvidencePointer[] = detEvidenceIds.map((id) => ({ origin: 'deterministic', kind: 'id', id }));
    return { paragraphs: detFallbackParas, text, origin: 'deterministic', evidenceIds: detEvidenceIds, evidence };
  }

  const ovParas = normalizeDealSummaryParagraphs(opts.overlayLongParagraphs);
  if (ovParas.length > 0) {
    const text = ovParas.join('\n\n');
    return { paragraphs: ovParas, text, origin: 'overlay', evidenceIds: [], evidence: [] };
  }

  return { paragraphs: [], text: '', origin: 'missing', evidenceIds: [], evidence: [] };
};

export function selectDealWorkspaceOverviewModel(input: SelectDealWorkspaceOverviewModelInput): DealWorkspaceOverviewModel {
  const overlayKeyFacts = input.overlay?.keyFacts ?? null;
  const overlaySummaries = input.overlay?.summaries ?? null;

  const product = chooseField({ fieldKey: 'product', deterministic: input.deterministic.keyFacts.product, overlay: overlayKeyFacts?.product });
  const market = chooseField({ fieldKey: 'market', deterministic: input.deterministic.keyFacts.market, overlay: overlayKeyFacts?.market });
  const business_model = chooseField({ fieldKey: 'business_model', deterministic: input.deterministic.keyFacts.business_model, overlay: overlayKeyFacts?.business_model });
  const raise_terms = chooseField({ fieldKey: 'raise_terms', deterministic: input.deterministic.keyFacts.raise_terms, overlay: overlayKeyFacts?.raise_terms });

  const short = chooseField({ fieldKey: 'summary.short', deterministic: input.deterministic.summaries.short, overlay: overlaySummaries?.short });

  const long = chooseSummaryLong({
    deterministicLong: input.deterministic.summaries.long,
    deterministicLongParagraphsFallback: input.deterministic.summaries.longParagraphsFallback,
    overlayLongParagraphs: overlaySummaries?.longParagraphs,
  });

  assertEvidenceMatchesOrigin([
    { fieldKey: 'product', chosenOrigin: product.origin as EvidenceOrigin | 'missing', evidence: product.evidence },
    { fieldKey: 'market', chosenOrigin: market.origin as EvidenceOrigin | 'missing', evidence: market.evidence },
    { fieldKey: 'business_model', chosenOrigin: business_model.origin as EvidenceOrigin | 'missing', evidence: business_model.evidence },
    { fieldKey: 'raise_terms', chosenOrigin: raise_terms.origin as EvidenceOrigin | 'missing', evidence: raise_terms.evidence },
    { fieldKey: 'summary.short', chosenOrigin: short.origin as EvidenceOrigin | 'missing', evidence: short.evidence },
    { fieldKey: 'summary.long', chosenOrigin: long.origin as EvidenceOrigin | 'missing', evidence: long.evidence },
  ]);

  return {
    summaries: {
      short,
      long,
    },
    keyFacts: {
      product,
      market,
      business_model,
      raise_terms,
    },
  };
}
