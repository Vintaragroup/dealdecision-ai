import { normalizeDealSummaryParagraphs } from '../normalizeDealSummaryParagraphs';
import { assertEvidenceMatchesOrigin, type EvidenceOrigin, type EvidencePointer } from '../assertions/assertEvidenceMatchesOrigin';

export type DealWorkspaceOverviewOrigin = 'deterministic' | 'overlay' | 'missing';

export type DealWorkspaceOverviewTrustState =
  | 'structured'
  | 'governed'
  | 'interim_extraction'
  | 'not_extracted'
  | 'conflicted';

export type DealWorkspaceOverviewSource =
  | 'structured_summary'
  | 'deal_summary_v1'
  | 'deterministic_slot'
  | 'overlay'
  | 'phase1'
  | null;

export type DealWorkspaceOverviewField = {
  value: string;
  origin: DealWorkspaceOverviewOrigin;
  evidenceIds: string[];
  evidence: EvidencePointer[];
  /** Trust badge to render in the UI. */
  trust: DealWorkspaceOverviewTrustState;
  /** Source key that produced the visible value. */
  source: DealWorkspaceOverviewSource;
  conflict?: {
    with: Exclude<DealWorkspaceOverviewSource, null>;
    value: string;
  };
};

export type RcS6TeamHighlight = { name: string; role: string; credential?: string | null };
export type RcS6UseOfFundsItem = { category: string; amountLabel?: string | null }; // amount parsed/normalized for UI copy only
export type RcS6ProjectPipelineItem = {
  name: string;
  capitalLabel?: string | null;
  revenueLabel?: string | null;
  returnPct?: string | null;
  startDate?: string | null;
};
export type RcS6RevenueModelField = {
  type: string | null;
  unitEconomics: string | null;
  detail: string | null;
  recurring: boolean | null;
  trust: DealWorkspaceOverviewTrustState;
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
      trust: DealWorkspaceOverviewTrustState;
      source: DealWorkspaceOverviewSource;
      conflict?: DealWorkspaceOverviewField['conflict'];
    };
  };
  keyFacts: {
    product: DealWorkspaceOverviewField;
    market: DealWorkspaceOverviewField;
    business_model: DealWorkspaceOverviewField;
    raise_terms: DealWorkspaceOverviewField;
  };
  rcS6: {
    teamHighlights: RcS6TeamHighlight[];
    useOfFunds: RcS6UseOfFundsItem[];
    projectPipeline: RcS6ProjectPipelineItem[];
    revenueModel: RcS6RevenueModelField;
  };
};

type InputField = {
  value?: unknown;
  evidenceIds?: unknown;
  ready?: boolean;
};

type OverviewFieldCandidates = {
  structured?: InputField;
  canonical?: InputField;
  deterministicSlot?: InputField;
  overlay?: InputField;
  phase1?: InputField;
};

type OverviewSummaryCandidates = {
  structured?: InputField & { paragraphs?: unknown };
  canonical?: InputField & { paragraphs?: unknown };
  deterministicSlot?: InputField & { paragraphs?: unknown };
  overlay?: InputField & { paragraphs?: unknown };
  phase1?: InputField & { paragraphs?: unknown };
};

export type SelectDealWorkspaceOverviewModelInput = {
  summaries: {
    short: OverviewFieldCandidates;
    long: OverviewSummaryCandidates;
  };
  keyFacts: {
    product: OverviewFieldCandidates;
    market: OverviewFieldCandidates;
    business_model: OverviewFieldCandidates;
    raise_terms: OverviewFieldCandidates;
  };
  rcS6?: {
    team_highlights?: unknown;
    use_of_funds_breakdown?: unknown;
    project_pipeline?: unknown;
    revenue_model?: OverviewFieldCandidates;
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

const FALLBACK_ORDER: Exclude<DealWorkspaceOverviewSource, null>[] = [
  'overlay',
  'structured_summary',
  'deal_summary_v1',
  'deterministic_slot',
  'phase1',
];

const SOURCE_TO_TRUST: Record<Exclude<DealWorkspaceOverviewSource, null>, DealWorkspaceOverviewTrustState> = {
  structured_summary: 'structured',
  deal_summary_v1: 'structured',
  deterministic_slot: 'interim_extraction',
  overlay: 'governed',
  phase1: 'interim_extraction',
};

const SOURCE_TO_ORIGIN: Record<Exclude<DealWorkspaceOverviewSource, null>, DealWorkspaceOverviewOrigin> = {
  structured_summary: 'deterministic',
  deal_summary_v1: 'deterministic',
  deterministic_slot: 'deterministic',
  overlay: 'overlay',
  phase1: 'deterministic',
};

type ResolvedField = {
  field: DealWorkspaceOverviewField;
  chosenSource: DealWorkspaceOverviewSource;
  candidate?: InputField;
};

function isMeaningfulDiff(a: string, b: string): boolean {
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

const resolveField = (fieldKey: string, candidates: OverviewFieldCandidates): ResolvedField => {
  let chosenSource: DealWorkspaceOverviewSource = null;
  let chosenCandidate: InputField | undefined;
  let value = '';
  let evidenceIds: string[] = [];
  let evidence: EvidencePointer[] = [];

  for (const source of FALLBACK_ORDER) {
    const candidate = candidates[source];
    if (!candidate) continue;
    const text = safeText(candidate.value);
    if (!text) continue;
    chosenSource = source;
    chosenCandidate = candidate;
    value = text;
    evidenceIds = normalizeEvidenceIds(candidate.evidenceIds);
    const origin = SOURCE_TO_ORIGIN[source];
    const evidenceOrigin: EvidenceOrigin = origin === 'overlay' ? 'overlay' : 'deterministic';
    evidence = evidenceIds.map((id) => ({ origin: evidenceOrigin, kind: 'id', id }));
    break;
  }

  let trust: DealWorkspaceOverviewTrustState = 'not_extracted';
  let origin: DealWorkspaceOverviewOrigin = 'missing';
  if (chosenSource) {
    trust = SOURCE_TO_TRUST[chosenSource];
    origin = SOURCE_TO_ORIGIN[chosenSource];
  }

  let conflict: DealWorkspaceOverviewField['conflict'];
  const overlayText = safeText(candidates.overlay?.value);
  if (chosenSource && overlayText && value && (chosenSource === 'structured_summary' || chosenSource === 'deal_summary_v1')) {
    if (isMeaningfulDiff(value, overlayText)) {
      trust = 'conflicted';
      conflict = { with: 'overlay', value: overlayText };
    }
  }

  const field: DealWorkspaceOverviewField = {
    value: value || '—',
    origin,
    evidenceIds,
    evidence,
    trust: chosenSource ? trust : 'not_extracted',
    source: chosenSource,
  };
  if (conflict) field.conflict = conflict;

  return { field, chosenSource, candidate: chosenCandidate };
};

const buildSummaryParagraphs = (
  chosenSource: DealWorkspaceOverviewSource,
  candidates: OverviewSummaryCandidates,
  fallbackValue: string,
): string[] => {
  if (chosenSource && candidates[chosenSource]) {
    const rawParas = candidates[chosenSource]?.paragraphs;
    const paras = normalizeDealSummaryParagraphs(rawParas ?? fallbackValue);
    if (paras.length > 0) return paras;
  }

  // If no source chosen but fallback value exists, break into paragraphs.
  if (fallbackValue) return normalizeDealSummaryParagraphs(fallbackValue);
  return [];
};

const normalizeTeamHighlights = (raw: unknown): RcS6TeamHighlight[] => {
  if (!Array.isArray(raw)) return [];
  const out: RcS6TeamHighlight[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = safeText((item as any).name);
    const role = safeText((item as any).role);
    if (!name || !role) continue;
    const key = `${name.toLowerCase()}::${role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const credential = safeText((item as any).credential) || null;
    out.push({ name, role, credential });
  }
  return out.slice(0, 8);
};

const normalizeUseOfFunds = (raw: unknown): RcS6UseOfFundsItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: RcS6UseOfFundsItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const category = safeText((item as any).category);
    if (!category) continue;
    const amountRaw = safeText((item as any).amount_raw);
    const amount = typeof (item as any).amount === 'number' && Number.isFinite((item as any).amount)
      ? (item as any).amount
      : null;
    const amountLabel = amountRaw || (amount != null ? `$${amount.toLocaleString()}` : null);
    out.push({ category, amountLabel });
  }
  return out.slice(0, 8);
};

const normalizeProjectPipeline = (raw: unknown): RcS6ProjectPipelineItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: RcS6ProjectPipelineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = safeText((item as any).name);
    if (!name) continue;
    const capitalLabel = safeText((item as any).capital_raw) || null;
    const revenueLabel = safeText((item as any).revenue_raw) || null;
    const returnPct = safeText((item as any).return_pct) || null;
    const startDate = safeText((item as any).start_date) || null;
    out.push({ name, capitalLabel, revenueLabel, returnPct, startDate });
  }
  return out.slice(0, 6);
};

const normalizeRevenueModel = (candidates?: OverviewFieldCandidates): RcS6RevenueModelField => {
  const structured = candidates?.structured;
  const value = structured?.value && typeof structured.value === 'object' ? structured.value as any : null;
  let trust: DealWorkspaceOverviewTrustState = 'not_extracted';
  let type: string | null = null;
  let unitEconomics: string | null = null;
  let detail: string | null = null;
  let recurring: boolean | null = null;

  if (value) {
    type = safeText(value.type);
    unitEconomics = safeText(value.unit_economics);
    detail = safeText(value.detail);
    recurring = typeof value.recurring === 'boolean' ? value.recurring : null;
    if (type || unitEconomics || detail) {
      trust = 'structured';
    }
  }

  return {
    type: type || null,
    unitEconomics: unitEconomics || null,
    detail: detail || null,
    recurring,
    trust,
  };
};

export function selectDealWorkspaceOverviewModel(input: SelectDealWorkspaceOverviewModelInput): DealWorkspaceOverviewModel {
  const productResolved = resolveField('product', input.keyFacts.product);
  const marketResolved = resolveField('market', input.keyFacts.market);
  const businessModelResolved = resolveField('business_model', input.keyFacts.business_model);
  const raiseTermsResolved = resolveField('raise_terms', input.keyFacts.raise_terms);

  const summaryShortResolved = resolveField('summary.short', input.summaries.short);
  const summaryLongResolved = resolveField('summary.long', input.summaries.long);

  const longParagraphs = buildSummaryParagraphs(summaryLongResolved.chosenSource, input.summaries.long, summaryLongResolved.field.value);
  const longText = longParagraphs.length > 0 ? longParagraphs.join('\n\n') : summaryLongResolved.field.value || '';
  const longField = {
    paragraphs: longParagraphs,
    text: longText,
    origin: summaryLongResolved.field.origin,
    evidenceIds: summaryLongResolved.field.evidenceIds,
    evidence: summaryLongResolved.field.evidence,
    trust: summaryLongResolved.field.trust,
    source: summaryLongResolved.field.source,
    conflict: summaryLongResolved.field.conflict,
  };

  assertEvidenceMatchesOrigin([
    { fieldKey: 'product', chosenOrigin: productResolved.field.origin as EvidenceOrigin | 'missing', evidence: productResolved.field.evidence },
    { fieldKey: 'market', chosenOrigin: marketResolved.field.origin as EvidenceOrigin | 'missing', evidence: marketResolved.field.evidence },
    { fieldKey: 'business_model', chosenOrigin: businessModelResolved.field.origin as EvidenceOrigin | 'missing', evidence: businessModelResolved.field.evidence },
    { fieldKey: 'raise_terms', chosenOrigin: raiseTermsResolved.field.origin as EvidenceOrigin | 'missing', evidence: raiseTermsResolved.field.evidence },
    { fieldKey: 'summary.short', chosenOrigin: summaryShortResolved.field.origin as EvidenceOrigin | 'missing', evidence: summaryShortResolved.field.evidence },
    { fieldKey: 'summary.long', chosenOrigin: longField.origin as EvidenceOrigin | 'missing', evidence: longField.evidence },
  ]);

  const rcInput = input.rcS6 ?? null;
  const teamHighlights = normalizeTeamHighlights(rcInput?.team_highlights);
  const useOfFunds = normalizeUseOfFunds(rcInput?.use_of_funds_breakdown);
  const projectPipeline = normalizeProjectPipeline(rcInput?.project_pipeline);
  const revenueModel = normalizeRevenueModel(rcInput?.revenue_model);

  return {
    summaries: {
      short: summaryShortResolved.field,
      long: longField,
    },
    keyFacts: {
      product: productResolved.field,
      market: marketResolved.field,
      business_model: businessModelResolved.field,
      raise_terms: raiseTermsResolved.field,
    },
    rcS6: {
      teamHighlights,
      useOfFunds,
      projectPipeline,
      revenueModel,
    },
  };
}
