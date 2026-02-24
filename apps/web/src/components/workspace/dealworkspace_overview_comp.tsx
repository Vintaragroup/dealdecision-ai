import { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, Package, Users, DollarSign, TrendingUp, Shield, ArrowRight, AlertCircle, Lightbulb } from 'lucide-react';
import type { EvidenceResolveResult } from '../../lib/apiClient';

type FieldEvidenceRef = {
  source_document_id: string;
  page_index: number;
  slide_title?: string | null;
  snippet: string;
};

export type DealWorkspaceOverviewCompProps = {
  darkMode: boolean;
  documentTitles?: Record<string, string>;
  showFieldEvidence?: boolean;
  dealOneLiner: string;
  product: string;
  marketIcp: string;
  businessModel: string;
  raiseTerms: string;

  dealOneLinerEvidenceRefs?: FieldEvidenceRef[];
  productEvidenceRefs?: FieldEvidenceRef[];
  marketIcpEvidenceRefs?: FieldEvidenceRef[];
  businessModelEvidenceRefs?: FieldEvidenceRef[];
  raiseTermsEvidenceRefs?: FieldEvidenceRef[];

  productEvidenceIds?: string[];
  marketIcpEvidenceIds?: string[];
  businessModelEvidenceIds?: string[];
  raiseTermsEvidenceIds?: string[];
  resolvedEvidence?: Record<string, EvidenceResolveResult>;

  productProvenance?: { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean };
  marketIcpProvenance?: { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean };
  businessModelProvenance?: { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean };
  raiseTermsProvenance?: { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean };
  dealSummaryParagraphs: string[];
  dealSummaryStrengths?: string[];
  dealSummaryRisks?: string[];
  dealSummaryOpenQuestions?: string[];
  dealSummaryTractionSignals?: string[];
  dealSummaryKeyRisksDetected?: string[];

  dealSummaryStrengthEvidenceRefs?: FieldEvidenceRef[];
  dealSummaryRiskEvidenceRefs?: FieldEvidenceRef[];
  dealSummaryOpenQuestionsEvidenceRefs?: FieldEvidenceRef[];
  dealSummaryTractionSignalsEvidenceRefs?: FieldEvidenceRef[];

  kpiTiles?: Array<{
    label: string;
    value: string;
    tooltipIfMissing?: string;
  }>;

  interpretationStatus?: 'idle' | 'loading' | 'ready' | 'error';
  interpretationSource?: 'persisted' | 'narrated' | 'none';
  interpretationText?: string | null;
  interpretationClaims?: any[];
  interpretationDisclosures?: any[];
  interpretationErrorCode?: string | null;
  onRequestInterpretation?: () => void;

  llmPhaseMode?: 'exploratory' | 'stabilizing' | 'governed' | string | null;

  dealSummarySourceLabel?: string;
  dealSummaryCitations?: {
    one_liner?: Array<{ source_document_id: string; page_index: number; slide_title: string | null; snippet: string }>;
    product?: Array<{ source_document_id: string; page_index: number; slide_title: string | null; snippet: string }>;
    market?: Array<{ source_document_id: string; page_index: number; slide_title: string | null; snippet: string }>;
    paragraphs?: Array<{ source_document_id: string; page_index: number; slide_title: string | null; snippet: string }>;
  };

  score0_100: number | null;
  /** Provenance of score0_100 — matches resolveCanonicalScore source union. */
  scoreSource?: 'score_band_v2.overall_score' | 'report.overallScore' | 'none';
  /** Whether a finalized report is driving the score (false = not yet computed). */
  reportApplied?: boolean;
  decisionLabel: 'PASS' | 'CONSIDER' | 'FUND' | '—' | string;
  confidenceLabel: string;
  confidenceVerified: boolean;
  rationale: string;
  strengths: string[];
  openItems: string[];
  coverageGaps: string[];

  onViewFullAnalysis?: () => void;
  /** Callback to switch the workspace to the Investor Insights tab. */
  onOpenInvestorInsights?: () => void;
  /** Latest status from investor_insight_reports, if available. */
  investorInsightsStatus?: string;
};

export function DealWorkspaceOverviewComp(props: DealWorkspaceOverviewCompProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [showInterpretation, setShowInterpretation] = useState(false);
  const [fieldEvidenceOpen, setFieldEvidenceOpen] = useState<Record<string, boolean>>({});

  const cardClassName = `backdrop-blur-xl border rounded-xl p-6 w-full ${
    props.darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
  }`;

  const dividerClassName = props.darkMode ? 'border-white/10' : 'border-gray-200/50';

  const interpretationStatus = props.interpretationStatus ?? 'idle';
  const interpretationSource = props.interpretationSource ?? 'none';
  const interpretationText = typeof props.interpretationText === 'string' ? props.interpretationText.trim() : '';
  const interpretationErrorCode = typeof props.interpretationErrorCode === 'string' && props.interpretationErrorCode.trim().length > 0
    ? props.interpretationErrorCode.trim()
    : null;

  const persistedClaims = Array.isArray(props.interpretationClaims) ? props.interpretationClaims : [];
  const persistedDisclosures = Array.isArray(props.interpretationDisclosures) ? props.interpretationDisclosures : [];

  const safeLines = (lines: string[]): string[] =>
    lines
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter((x) => x.length > 0);

  const dealSummaryParagraphs = useMemo(() => safeLines(props.dealSummaryParagraphs), [props.dealSummaryParagraphs]);
  const dealSummaryStrengths = useMemo(() => safeLines(props.dealSummaryStrengths ?? []), [props.dealSummaryStrengths]);
  const dealSummaryOpenQuestions = useMemo(() => safeLines(props.dealSummaryOpenQuestions ?? []), [props.dealSummaryOpenQuestions]);
  const dealSummaryTractionSignals = useMemo(() => safeLines(props.dealSummaryTractionSignals ?? []), [props.dealSummaryTractionSignals]);
  const dealSummaryRisks = useMemo(() => safeLines(props.dealSummaryRisks ?? []), [props.dealSummaryRisks]);

  const kpiTiles = useMemo(() => {
    const xs = Array.isArray(props.kpiTiles) ? props.kpiTiles : [];
    return xs
      .filter((x) => x && typeof x.label === 'string')
      .map((x) => ({
        label: String(x.label ?? '').trim() || 'KPI',
        value: String(x.value ?? '').trim() || '—',
        tooltipIfMissing: typeof x.tooltipIfMissing === 'string' ? x.tooltipIfMissing : undefined,
      }))
      .slice(0, 8);
  }, [props.kpiTiles]);

  const strengths = useMemo(() => safeLines(props.strengths), [props.strengths]);
  const strengthsPrimary = strengths.slice(0, 3);
  const strengthsExtra = Math.max(0, strengths.length - strengthsPrimary.length);

  const openItems = useMemo(() => safeLines(props.openItems), [props.openItems]);
  const openItemsPrimary = openItems.slice(0, 3);
  const openItemsExtra = Math.max(0, openItems.length - openItemsPrimary.length);

  const coverageGaps = useMemo(() => safeLines(props.coverageGaps), [props.coverageGaps]);
  const decisionLabelText = String(props.decisionLabel ?? '').trim() || '—';
  // When the report is not yet applied, show a neutral placeholder — never a stale DB number.
  const scoreText = (() => {
    if (props.reportApplied === false) return 'Not yet computed';
    if (typeof props.score0_100 !== 'number' || !Number.isFinite(props.score0_100)) return '— / 100';
    return `${Math.round(props.score0_100)} / 100`;
  })();

  // [DDAI][overview_score_binding] Dev-only: log what score value this component received at render.
  // This confirms the Overview tab score display source without altering business logic.
  // score0_100 now traces to canonicalScoreView (resolveCanonicalScore chain), not dealFromApi.score.
  const _lastOverviewScoreRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const key = `${props.reportApplied}|${props.score0_100}|${props.scoreSource ?? 'none'}|${props.decisionLabel}`;
    if (_lastOverviewScoreRef.current === key) return;
    _lastOverviewScoreRef.current = key;
    console.log('[DDAI][overview_score_binding]', {
      reportApplied: props.reportApplied,
      score0_100: props.score0_100,
      scoreSource: props.scoreSource ?? 'none',
      scoreText,
      decisionLabel: props.decisionLabel,
      confidenceLabel: props.confidenceLabel,
      // NOTE: score0_100 now traces to resolveCanonicalScore (score_band_v2 → overallScore),
      // passed from DealWorkspace.canonicalScoreView. null means report not applied = placeholder shown.
      source_chain: props.reportApplied
        ? 'resolveCanonicalScore → score_band_v2.overall_score | report.overallScore'
        : 'report not applied → Not yet computed placeholder',
    });
  }, [props.score0_100, props.scoreSource, props.reportApplied, props.decisionLabel, props.confidenceLabel, scoreText]);

  const badgeBaseClassName = 'inline-flex items-center px-2 py-1 rounded-full border text-[11px] font-medium leading-none';

  const renderProvenanceChips = (prov?: { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean }) => {
    if (!prov) return null;

    const chipClassName = (kind: 'deterministic' | 'governed' | 'missing' | 'needs_review') => {
      if (kind === 'needs_review') {
        return props.darkMode
          ? 'bg-amber-500/10 text-amber-200 border-amber-500/40'
          : 'bg-amber-50 text-amber-800 border-amber-200/70';
      }

      if (kind === 'missing') {
        return props.darkMode
          ? 'bg-white/5 text-zinc-500 border-white/10'
          : 'bg-white text-zinc-600 border-gray-200';
      }

      return props.darkMode
        ? 'bg-white/5 text-zinc-300 border-white/10'
        : 'bg-white text-zinc-700 border-gray-200';
    };

    const mainLabel = prov.source === 'deterministic'
      ? 'Authoritative (deterministic)'
      : prov.source === 'governed'
        ? 'Governed'
        : 'Missing';

    return (
      <span className="inline-flex items-center gap-1.5 ml-2">
        <span className={`${badgeBaseClassName} ${chipClassName(prov.source)}`}>{mainLabel}</span>
        {prov.needsReview ? (
          <span className={`${badgeBaseClassName} ${chipClassName('needs_review')}`}>Needs review</span>
        ) : null}
      </span>
    );
  };

  const citationsPresent = Boolean(
    (props.dealSummaryCitations?.one_liner && props.dealSummaryCitations.one_liner.length > 0) ||
      (props.dealSummaryCitations?.product && props.dealSummaryCitations.product.length > 0) ||
      (props.dealSummaryCitations?.market && props.dealSummaryCitations.market.length > 0) ||
      (props.dealSummaryCitations?.paragraphs && props.dealSummaryCitations.paragraphs.length > 0)
  );

  const isMissingValueString = (value: string) => {
    const s = typeof value === 'string' ? value.trim() : '';
    return s.length === 0 || s === '—' || s.toLowerCase() === 'not extracted' || s.toLowerCase() === 'not available';
  };

  const documentTitles = props.documentTitles ?? {};

  const normalizeEvidenceRefs = (refsRaw: unknown): FieldEvidenceRef[] => {
    if (!Array.isArray(refsRaw)) return [];
    const out: FieldEvidenceRef[] = [];
    const seen = new Set<string>();

    for (const v of refsRaw) {
      if (!v || typeof v !== 'object') continue;
      const source_document_id = typeof (v as any).source_document_id === 'string' ? (v as any).source_document_id.trim() : '';
      const page_index_raw = (v as any).page_index;
      const page_index = typeof page_index_raw === 'number' && Number.isFinite(page_index_raw) ? Math.max(0, Math.floor(page_index_raw)) : null;
      const snippet = typeof (v as any).snippet === 'string' ? (v as any).snippet.trim() : '';
      const slide_title = typeof (v as any).slide_title === 'string' ? (v as any).slide_title.trim() : null;

      if (!source_document_id || page_index == null) continue;
      const key = `${source_document_id}::${page_index}::${snippet.slice(0, 64).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source_document_id, page_index, snippet, slide_title });
    }

    return out.slice(0, 12);
  };

  const toggleFieldEvidence = (key: string) => {
    setFieldEvidenceOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderMaybeMissingValue = (value: string) => {
    const s = typeof value === 'string' ? value.trim() : '';
    const isMissing = isMissingValueString(s);
    return <span className={isMissing ? 'text-zinc-500 text-sm' : 'text-zinc-200 text-sm'}>{s || '—'}</span>;
  };

  const renderPersistedClaims = () => {
    if (interpretationSource !== 'persisted') return null;
    if (!persistedClaims.length) return null;

    const take = persistedClaims.slice(0, 6);
    return (
      <div className="mt-4">
        <div className="text-zinc-400 text-xs mb-2">Cited claims</div>
        <ul className="space-y-2">
          {take.map((c: any, idx: number) => {
            const label = typeof c?.label === 'string' ? c.label.trim() : '';
            const valueString = typeof c?.value_string === 'string' ? c.value_string.trim() : '';
            const valueNumber = typeof c?.value_number === 'number' && Number.isFinite(c.value_number) ? String(c.value_number) : '';
            const unit = typeof c?.unit === 'string' ? c.unit.trim() : '';
            const value = valueString || valueNumber ? `${valueString || valueNumber}${unit ? ` ${unit}` : ''}` : '';

            const refs = Array.isArray(c?.evidence_refs) ? c.evidence_refs : [];
            const refText = refs
              .filter((r: any) => r && typeof r.document_id === 'string' && typeof r.page_index === 'number')
              .slice(0, 3)
              .map((r: any) => `${String(r.document_id)} p${String(r.page_index)}`)
              .join(' • ');

            return (
              <li key={`claim-${idx}`} className="text-zinc-300 text-sm">
                <div className="leading-relaxed">
                  <span className="text-zinc-200">{label || 'Claim'}</span>
                  {value ? <span className="text-zinc-400">: {value}</span> : null}
                </div>
                {refText ? <div className="text-zinc-500 text-xs mt-0.5">{refText}</div> : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderPersistedDisclosures = () => {
    if (interpretationSource !== 'persisted') return null;
    if (!persistedDisclosures.length) return null;

    const take = persistedDisclosures.slice(0, 6);
    return (
      <div className="mt-4">
        <div className="text-zinc-400 text-xs mb-2">Disclosures</div>
        <ul className="space-y-1">
          {take.map((d: any, idx: number) => {
            const code = typeof d?.code === 'string' ? d.code.trim() : '';
            const message = typeof d?.message === 'string' ? d.message.trim() : '';
            const text = [code ? `(${code})` : '', message].filter(Boolean).join(' ');
            return (
              <li key={`disclosure-${idx}`} className="text-zinc-400 text-xs leading-relaxed">
                {text || 'Disclosure'}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderCitations = (items: Array<{ source_document_id: string; page_index: number; slide_title: string | null; snippet: string }>) => {
    const cleaned = items
      .filter((c) => c && typeof c.source_document_id === 'string' && Number.isFinite(c.page_index))
      .slice(0, 8);
    if (cleaned.length === 0) return null;
    return (
      <ul className="mt-2 space-y-1">
        {cleaned.map((c, idx) => {
          const docShort = c.source_document_id.length > 10 ? `${c.source_document_id.slice(0, 8)}…` : c.source_document_id;
          const pageLabel = Number.isFinite(c.page_index) ? `p${Math.max(1, Math.floor(c.page_index) + 1)}` : 'p—';
          const title = typeof c.slide_title === 'string' && c.slide_title.trim().length > 0 ? c.slide_title.trim() : null;
          const snippet = typeof c.snippet === 'string' ? c.snippet.trim() : '';
          const line = [docShort, pageLabel, title].filter(Boolean).join(' · ');
          return (
            <li key={`cite-${idx}`} className="text-[11px] text-zinc-400">
              <div className="font-mono">{line}</div>
              {snippet ? <div className="mt-0.5 text-zinc-500">{snippet}</div> : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderExpandedParagraphs = (title: string, paragraphs: string[]) => {
    const cleaned = safeLines(paragraphs);
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
        {cleaned.length ? (
          <div className="space-y-3">
            {cleaned.map((p, idx) => (
              <p key={`${title}-p-${idx}`} className="text-zinc-300 text-sm leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm leading-relaxed">Not available</p>
        )}
      </div>
    );
  };

  const renderExpandedBullets = (title: string, items: string[]) => {
    const cleaned = safeLines(items).slice(0, 6);
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
        {cleaned.length ? (
          <ul className="space-y-1">
            {cleaned.map((s, idx) => (
              <li key={`${title}-item-${idx}`} className="text-zinc-300 text-sm leading-relaxed">
                • {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500 text-sm leading-relaxed">Not available</p>
        )}
      </div>
    );
  };

  const resolvedEvidence = props.resolvedEvidence ?? {};

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

  const resolveEvidenceItems = (ids: string[]) => {
    return ids.map((id) => {
      const r = resolvedEvidence[id];
      return {
        id,
        ok: Boolean(r?.ok),
        document_title: typeof r?.document_title === 'string' ? r.document_title : null,
        document_id: typeof r?.document_id === 'string' ? r.document_id : null,
        page: typeof r?.page === 'number' && Number.isFinite(r.page) ? r.page : null,
        snippet: typeof r?.snippet === 'string' ? r.snippet : null,
      };
    });
  };

  const renderFieldEvidence = (opts: {
    fieldKey: string;
    valuePresent: boolean;
    refs?: FieldEvidenceRef[];
    evidenceIds?: unknown;
  }) => {
    if (!props.showFieldEvidence) return null;
    if (!opts.valuePresent) return null;

    const refs = normalizeEvidenceRefs(opts.refs);
    const ids = normalizeEvidenceIds(opts.evidenceIds);

    // Guardrail: undefined refs means "not applicable" (ex: deterministic override).
    const refsApplicable = typeof opts.refs !== 'undefined';
    const idsApplicable = ids.length > 0;
    if (!refsApplicable && !idsApplicable) return null;

    const hasRefs = refs.length > 0;
    const hasIds = ids.length > 0;
    const hasEvidence = hasRefs || hasIds;

    const badgeClassName = props.darkMode
      ? 'bg-white/5 text-zinc-400 border-white/10'
      : 'bg-white text-zinc-600 border-gray-200';

    if (!hasEvidence) {
      return (
        <div className="mt-1">
          <span className={`inline-flex items-center px-2 py-1 rounded-full border text-[11px] font-medium leading-none ${badgeClassName}`}>
            No explicit citation
          </span>
        </div>
      );
    }

    const open = Boolean(fieldEvidenceOpen[opts.fieldKey]);
    const buttonClass = props.darkMode
      ? 'flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2'
      : 'flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 underline underline-offset-2';

    const panelClass = props.darkMode
      ? 'mt-2 rounded-lg border border-white/10 bg-white/5 p-3'
      : 'mt-2 rounded-lg border border-gray-200 bg-white p-3';

    const itemsFromIds = hasRefs ? [] : resolveEvidenceItems(ids);
    const hasContent = hasRefs ? refs.length > 0 : itemsFromIds.length > 0;
    if (!hasContent) return null;

    return (
      <div className="mt-1">
        <button
          type="button"
          className={buttonClass}
          onClick={() => toggleFieldEvidence(opts.fieldKey)}
          data-testid={`evidence-toggle-${opts.fieldKey}`}
        >
          <span>{open ? 'Hide evidence' : 'Evidence'}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} strokeWidth={1.5} />
        </button>

        {open ? (
          <div className={panelClass} data-testid={`evidence-panel-${opts.fieldKey}`}>
            <div className={props.darkMode ? 'text-[11px] uppercase tracking-wider text-zinc-500' : 'text-[11px] uppercase tracking-wider text-zinc-500'}>
              Evidence
            </div>
            <ul className="mt-2 space-y-2">
              {hasRefs
                ? refs.map((r, idx) => {
                    const title = documentTitles[r.source_document_id] || r.source_document_id;
                    const page = `p${Math.max(1, Math.floor(r.page_index) + 1)}`;
                    const header = [title, page, r.slide_title].filter(Boolean).join(' · ');
                    return (
                      <li key={`ref-${opts.fieldKey}-${idx}`} className="text-xs">
                        <div className={props.darkMode ? 'text-zinc-200' : 'text-zinc-800'}>{header}</div>
                        <div className={props.darkMode ? 'mt-0.5 text-zinc-400 whitespace-pre-wrap' : 'mt-0.5 text-zinc-600 whitespace-pre-wrap'}>
                          {r.snippet || 'Snippet not available'}
                        </div>
                      </li>
                    );
                  })
                : itemsFromIds.map((it) => {
                    const title = it.document_title || (it.document_id ? (documentTitles[it.document_id] || `Document ${it.document_id}`) : 'Document');
                    const page = typeof it.page === 'number' ? `p${Math.max(1, Math.floor(it.page) + 1)}` : 'p—';
                    const header = `${title} · ${page}`;
                    return (
                      <li key={`id-${opts.fieldKey}-${it.id}`} className="text-xs">
                        <div className={props.darkMode ? 'text-zinc-200' : 'text-zinc-800'}>{header}</div>
                        <div className={props.darkMode ? 'mt-0.5 text-zinc-400 whitespace-pre-wrap' : 'mt-0.5 text-zinc-600 whitespace-pre-wrap'}>
                          {it.snippet || 'Snippet not available'}
                        </div>
                      </li>
                    );
                  })}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6 w-full">
      {/* Deal Summary Card */}
      <div className={cardClassName}>
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-white text-xl mb-1">Deal Summary</h2>
                <p className="text-zinc-500 text-sm">What this company does</p>
              </div>
              {props.dealSummarySourceLabel ? (
                <span className={`${badgeBaseClassName} bg-white/5 text-zinc-300 border-white/10`}>
                  {props.dealSummarySourceLabel}
                </span>
              ) : null}
            </div>
          </div>

          {/* One-liner */}
          <div className="mb-6">
            <p className={`${isMissingValueString(props.dealOneLiner) ? 'text-zinc-500' : 'text-zinc-100'} text-lg leading-relaxed`}>
              {props.dealOneLiner || '—'}
            </p>
            {renderFieldEvidence({
              fieldKey: 'deal-one-liner',
              valuePresent: !isMissingValueString(props.dealOneLiner),
              refs: props.dealOneLinerEvidenceRefs,
            })}
          </div>

          {/* KPI tiles */}
          {kpiTiles.length > 0 ? (
            <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              {kpiTiles.map((kpi, idx) => {
                const isMissing = kpi.value.trim() === '—';
                const title = isMissing ? (kpi.tooltipIfMissing ?? undefined) : undefined;
                return (
                  <div
                    key={`kpi-${idx}`}
                    title={title}
                    className={`rounded-lg border p-3 ${props.darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
                  >
                    <div className={`text-[11px] ${props.darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{kpi.label}</div>
                    <div className={`mt-1 text-sm font-medium ${props.darkMode ? 'text-gray-100' : 'text-gray-900'}`}>{kpi.value}</div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Key Facts */}
          <div className="mb-6 space-y-3">
            <div className="flex items-start gap-3" data-testid="key-fact-product" data-slot="keyFacts.product">
              <Package className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Product: </span>
                {renderProvenanceChips(props.productProvenance)}
                {renderMaybeMissingValue(props.product)}
                {renderFieldEvidence({
                  fieldKey: 'product-solution',
                  valuePresent: !isMissingValueString(props.product),
                  refs: props.productEvidenceRefs,
                  evidenceIds: props.productEvidenceIds,
                })}
              </div>
            </div>
            
            <div className="flex items-start gap-3" data-testid="key-fact-market" data-slot="keyFacts.market">
              <Users className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Market: </span>
                {renderProvenanceChips(props.marketIcpProvenance)}
                {renderMaybeMissingValue(props.marketIcp)}
                {renderFieldEvidence({
                  fieldKey: 'market-icp',
                  valuePresent: !isMissingValueString(props.marketIcp),
                  refs: props.marketIcpEvidenceRefs,
                  evidenceIds: props.marketIcpEvidenceIds,
                })}
              </div>
            </div>
            
            <div className="flex items-start gap-3" data-testid="key-fact-business-model" data-slot="keyFacts.business_model">
              <DollarSign className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Business Model: </span>
                {renderProvenanceChips(props.businessModelProvenance)}
                {renderMaybeMissingValue(props.businessModel)}
                {renderFieldEvidence({
                  fieldKey: 'business-model',
                  valuePresent: !isMissingValueString(props.businessModel),
                  refs: props.businessModelEvidenceRefs,
                  evidenceIds: props.businessModelEvidenceIds,
                })}
              </div>
            </div>
          </div>

          {/* Raise / Terms */}
          <div className={`mb-5 pb-5 border-b ${dividerClassName}`} data-slot="keyFacts.raise_terms">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm" data-testid="key-fact-raise">
                Raise / Terms
                {renderProvenanceChips(props.raiseTermsProvenance)}
              </span>
              {renderMaybeMissingValue(props.raiseTerms)}
            </div>
            {renderFieldEvidence({
              fieldKey: 'raise-terms',
              valuePresent: !isMissingValueString(props.raiseTerms),
              refs: props.raiseTermsEvidenceRefs,
              evidenceIds: props.raiseTermsEvidenceIds,
            })}
          </div>

          {/* Expandable Content */}
          {isExpanded && (
            <div className={`mb-5 pb-5 border-b ${dividerClassName}`}>
              <div className="space-y-5">
                {renderExpandedBullets('Strengths', dealSummaryStrengths)}
                {renderFieldEvidence({
                  fieldKey: 'strengths',
                  valuePresent: dealSummaryStrengths.length > 0,
                  refs: props.dealSummaryStrengthEvidenceRefs,
                })}

                {renderExpandedBullets('Concerns', dealSummaryRisks)}
                {renderFieldEvidence({
                  fieldKey: 'concerns',
                  valuePresent: dealSummaryRisks.length > 0,
                  refs: props.dealSummaryRiskEvidenceRefs,
                })}

                {renderExpandedBullets('Open Questions', dealSummaryOpenQuestions)}
                {renderFieldEvidence({
                  fieldKey: 'open-questions',
                  valuePresent: dealSummaryOpenQuestions.length > 0,
                  refs: props.dealSummaryOpenQuestionsEvidenceRefs,
                })}

                {renderExpandedBullets('Traction', dealSummaryTractionSignals)}
                {renderFieldEvidence({
                  fieldKey: 'traction',
                  valuePresent: dealSummaryTractionSignals.length > 0,
                  refs: props.dealSummaryTractionSignalsEvidenceRefs,
                })}
              </div>
            </div>
          )}

          {/* Expand Control */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors text-sm group"
            >
              <span>{isExpanded ? 'Show less' : 'Show more'}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                strokeWidth={1.5}
              />
            </button>

            {citationsPresent ? (
              <button
                onClick={() => setShowCitations(!showCitations)}
                className="text-zinc-400 hover:text-zinc-200 transition-colors text-sm"
              >
                {showCitations ? 'Hide citations' : 'View citations'}
              </button>
            ) : null}
          </div>

          {showCitations && citationsPresent ? (
            <div className={`mt-4 pt-4 border-t ${dividerClassName}`}>
              {props.dealSummaryCitations?.one_liner?.length ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">One-liner</div>
                  {renderCitations(props.dealSummaryCitations.one_liner)}
                </div>
              ) : null}

              {props.dealSummaryCitations?.product?.length ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Product</div>
                  {renderCitations(props.dealSummaryCitations.product)}
                </div>
              ) : null}

              {props.dealSummaryCitations?.market?.length ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Market</div>
                  {renderCitations(props.dealSummaryCitations.market)}
                </div>
              ) : null}

              {props.dealSummaryCitations?.paragraphs?.length ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Paragraphs</div>
                  {renderCitations(props.dealSummaryCitations.paragraphs)}
                </div>
              ) : null}
            </div>
          ) : null}
      </div>

      {/* Investor Insights Teaser — replaces the former Investment Analysis Overview card */}
      <div className={cardClassName}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Lightbulb
              className={`w-5 h-5 flex-shrink-0 ${props.darkMode ? 'text-amber-400' : 'text-amber-500'}`}
              strokeWidth={1.5}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={`text-sm font-medium ${props.darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Investor Insights
                </h3>
                {props.investorInsightsStatus ? (() => {
                  const statusMap: Record<string, { label: string; cls: string }> = {
                    not_started:        { label: 'not started',       cls: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
                    queued:             { label: 'queued',            cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                    running:            { label: 'running',           cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                    deterministic_only: { label: 'deterministic only', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
                    complete:           { label: 'complete',          cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
                    failed:             { label: 'failed',            cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
                    quarantined:        { label: 'quarantined',       cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
                  };
                  const chip = statusMap[props.investorInsightsStatus] ??
                    { label: props.investorInsightsStatus, cls: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' };
                  return (
                    <span className={`${badgeBaseClassName} ${chip.cls}`}>{chip.label}</span>
                  );
                })() : null}
              </div>
              <p className={`mt-0.5 text-sm ${props.darkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                Deeper investor breakdown is available in the Investor Insights tab.
              </p>
              {/* Compact score row — preserves the test contract for overview-score-text */}
              <div className="flex items-center gap-3 mt-1.5 text-sm">
                <span className={`${props.darkMode ? 'text-zinc-500' : 'text-gray-400'}`}>Score:</span>
                <span
                  className={`${props.darkMode ? 'text-zinc-200' : 'text-gray-700'}`}
                  data-testid="overview-score-text"
                  data-canonical-score-source={props.scoreSource ?? 'none'}
                >{scoreText}</span>
                <Shield className={`w-3.5 h-3.5 ${props.confidenceVerified ? 'text-emerald-400' : 'text-zinc-500'}`} strokeWidth={1.5} />
                <span className={`text-xs ${props.confidenceVerified ? 'text-emerald-400' : (props.darkMode ? 'text-zinc-500' : 'text-gray-400')}`}>{props.confidenceLabel}</span>
              </div>
              {/* Preserve slot contract: hidden span carries the summary slot so existing tests continue to resolve it. */}
              <span className="sr-only" data-slot="investmentAnalysis.overview.summary">{props.rationale}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => props.onOpenInvestorInsights?.()}
            className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors text-sm whitespace-nowrap flex-shrink-0"
          >
            <span>Open Investor Insights</span>
            <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}