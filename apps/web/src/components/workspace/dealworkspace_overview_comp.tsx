import { useMemo, useState } from 'react';
import { ChevronDown, Package, Users, DollarSign, TrendingUp, Shield, ArrowRight, AlertCircle } from 'lucide-react';

export type DealWorkspaceOverviewCompProps = {
  darkMode: boolean;
  dealOneLiner: string;
  product: string;
  marketIcp: string;
  businessModel: string;
  raiseTerms: string;
  dealSummaryParagraphs: string[];

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
  decisionLabel: 'PASS' | 'CONSIDER' | 'FUND' | '—' | string;
  confidenceLabel: string;
  confidenceVerified: boolean;
  rationale: string;
  strengths: string[];
  openItems: string[];
  coverageGaps: string[];

  onViewFullAnalysis?: () => void;
};

export function DealWorkspaceOverviewComp(props: DealWorkspaceOverviewCompProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [showInterpretation, setShowInterpretation] = useState(false);

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

  const dealSummaryExpandedText = useMemo(() => {
    const cleaned = safeLines(props.dealSummaryParagraphs);
    return cleaned.join(' ');
  }, [props.dealSummaryParagraphs]);

  const strengths = useMemo(() => safeLines(props.strengths), [props.strengths]);
  const strengthsPrimary = strengths.slice(0, 3);
  const strengthsExtra = Math.max(0, strengths.length - strengthsPrimary.length);

  const openItems = useMemo(() => safeLines(props.openItems), [props.openItems]);
  const openItemsPrimary = openItems.slice(0, 3);
  const openItemsExtra = Math.max(0, openItems.length - openItemsPrimary.length);

  const coverageGaps = useMemo(() => safeLines(props.coverageGaps), [props.coverageGaps]);
  const decisionLabelText = String(props.decisionLabel ?? '').trim() || '—';
  const scoreText = typeof props.score0_100 === 'number' && Number.isFinite(props.score0_100) ? `${Math.round(props.score0_100)} / 100` : '— / 100';

  const badgeBaseClassName = 'inline-flex items-center px-2 py-1 rounded-full border text-[11px] font-medium leading-none';

  const citationsPresent = Boolean(
    (props.dealSummaryCitations?.one_liner && props.dealSummaryCitations.one_liner.length > 0) ||
      (props.dealSummaryCitations?.product && props.dealSummaryCitations.product.length > 0) ||
      (props.dealSummaryCitations?.market && props.dealSummaryCitations.market.length > 0) ||
      (props.dealSummaryCitations?.paragraphs && props.dealSummaryCitations.paragraphs.length > 0)
  );

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
            <p className="text-zinc-100 text-lg leading-relaxed">
              {props.dealOneLiner}
            </p>
          </div>

          {/* Key Facts */}
          <div className="mb-6 space-y-3">
            <div className="flex items-start gap-3">
              <Package className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Product: </span>
                <span className="text-zinc-200 text-sm">{props.product}</span>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Market: </span>
                <span className="text-zinc-200 text-sm">{props.marketIcp}</span>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <DollarSign className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="text-zinc-400 text-sm">Business Model: </span>
                <span className="text-zinc-200 text-sm">{props.businessModel}</span>
              </div>
            </div>
          </div>

          {/* Raise / Terms */}
          <div className={`mb-5 pb-5 border-b ${dividerClassName}`}>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Raise / Terms</span>
              <span className="text-zinc-200 text-sm">{props.raiseTerms}</span>
            </div>
          </div>

          {/* Expandable Content */}
          {isExpanded && (
            <div className={`mb-5 pb-5 border-b ${dividerClassName}`}>
              <p className="text-zinc-300 text-sm leading-relaxed">
                {dealSummaryExpandedText || 'Not available'}
              </p>
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

      {/* Investment Analysis Overview Card */}
      <div className={cardClassName}>
          {/* Header Row */}
          <div className="mb-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h2 className="text-white text-xl">Investment Analysis Overview</h2>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`${badgeBaseClassName} bg-emerald-500/20 text-emerald-400 border-emerald-500/30`}>
                  {decisionLabelText}
                </span>
                {props.llmPhaseMode ? (
                  <span className={`${badgeBaseClassName} bg-zinc-500/20 text-zinc-300 border-zinc-500/30`}>
                    phase: {String(props.llmPhaseMode)}
                  </span>
                ) : null}
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">Score:</span>
                <span className="text-white">{scoreText}</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className={`w-4 h-4 ${props.confidenceVerified ? 'text-emerald-400' : 'text-zinc-500'}`} strokeWidth={1.5} />
                <span className={props.confidenceVerified ? 'text-emerald-400' : 'text-zinc-500'}>{props.confidenceLabel}</span>
              </div>
            </div>
          </div>

          {/* Rationale */}
          <div className="mb-6">
            <p className="text-zinc-200 text-sm leading-relaxed">
              {props.rationale}
            </p>
          </div>

          {/* Interpretation (governed overlay) */}
          <div className={`mb-6 pb-6 border-b ${dividerClassName}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-zinc-400 text-sm">Interpretation</div>
                <div className="text-zinc-500 text-xs">
                  LLM overlay (display-only). Deterministic report remains authoritative.
                  {interpretationSource === 'persisted' ? ' Source: persisted governed overlay (PR2).' : interpretationSource === 'narrated' ? ' Source: legacy narrated /report?narrate=1.' : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !showInterpretation;
                  setShowInterpretation(next);
                  if (next && interpretationStatus === 'idle') {
                    props.onRequestInterpretation?.();
                  }
                }}
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors text-sm group"
              >
                <span>{showInterpretation ? 'Hide interpretation' : 'Show interpretation'}</span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${showInterpretation ? 'rotate-180' : ''}`}
                  strokeWidth={1.5}
                />
              </button>
            </div>

            {showInterpretation ? (
              <div className="mt-3">
                {interpretationStatus === 'loading' ? (
                  <div className="text-zinc-300 text-sm">Generating interpretation…</div>
                ) : interpretationStatus === 'ready' ? (
                  <>
                    {interpretationText ? (
                      <div className="text-zinc-200 text-sm whitespace-pre-wrap leading-relaxed">{interpretationText}</div>
                    ) : (
                      <div className="text-zinc-400 text-sm">No overlay generated.</div>
                    )}
                    {renderPersistedClaims()}
                    {renderPersistedDisclosures()}
                  </>
                ) : interpretationStatus === 'error' ? (
                  <div className="text-zinc-300 text-sm">
                    Interpretation unavailable{interpretationErrorCode ? ` (code=${interpretationErrorCode})` : ''}.
                  </div>
                ) : (
                  <div className="text-zinc-400 text-sm">Open to generate an interpretation.</div>
                )}
              </div>
            ) : null}
          </div>

          {/* Strengths vs Concerns - Two Column Layout */}
          <div className="mb-6 grid md:grid-cols-2 gap-6">
            {/* Left Column - Strengths */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
                <h3 className="text-emerald-400 text-sm font-medium">Strengths</h3>
              </div>
              <ul className="space-y-2">
                {strengthsPrimary.map((item, idx) => (
                  <li key={`strength-${idx}`} className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-1">•</span>
                    <span className="text-zinc-300 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
              {strengthsExtra > 0 && (
                <button className="text-zinc-500 hover:text-zinc-400 text-xs mt-2 transition-colors">
                  +{strengthsExtra} more
                </button>
              )}
            </div>

            {/* Right Column - Concerns */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-amber-400" strokeWidth={1.5} />
                <h3 className="text-amber-400 text-sm font-medium">Concerns / Open Items</h3>
              </div>
              <ul className="space-y-2">
                {openItemsPrimary.map((item, idx) => (
                  <li key={`open-item-${idx}`} className="flex items-start gap-2">
                    <span className="text-amber-400 mt-1">•</span>
                    <span className="text-zinc-300 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
              {openItemsExtra > 0 && (
                <button className="text-zinc-500 hover:text-zinc-400 text-xs mt-2 transition-colors">
                  +{openItemsExtra} more
                </button>
              )}
            </div>
          </div>

          {/* Coverage Gaps */}
          <div className={`mb-5 pb-5 border-b ${dividerClassName}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-zinc-400 text-sm">Coverage gaps</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {coverageGaps.map((gap, idx) => (
                <span
                  key={`coverage-gap-${idx}`}
                  className={`${badgeBaseClassName} bg-amber-500/20 text-amber-400 border-amber-500/30`}
                >
                  {gap}
                </span>
              ))}
            </div>
          </div>

          {/* Expand Control */}
          <button
            onClick={() => props.onViewFullAnalysis?.()}
            className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors text-sm group"
          >
            <span>View full analysis</span>
            <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
      </div>
    </div>
  );
}