type SupportStatus = 'supported' | 'weak' | 'missing' | 'unknown';

interface SectionRow {
  key: string;
  label: string;
  support_status?: SupportStatus;
  evidence_count_linked?: number;
  evidence_count_total?: number;
  missing_reasons?: string[];
}

interface EvidenceCard {
  evidence_id: string;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
}

// Section keys that represent traction/customer evidence areas.
const TRACTION_SECTION_KEYS = new Set([
  'traction', 'customers', 'growth', 'icp', 'traction_growth', 'customer_traction',
]);

// Broad traction signal keywords — LOIs, channels, pipelines, projected counts, etc.
const TRACTION_EVIDENCE_RE =
  /\b(loi|letter of intent|contracted|pipeline|channel|segment|distributor|reseller|arr|mrr|customer|subscriber|user|projected|forecast|booking|committed|demand)\b/i;

// Human-readable fallback labels for traction sections when alternate evidence is present.
const TRACTION_ALT_LABELS: Record<string, string> = {
  traction: 'Traction Evidence',
  customers: 'Customer Evidence',
  growth: 'Growth Evidence',
  icp: 'Target Market Evidence',
  traction_growth: 'Traction Evidence',
  customer_traction: 'Customer/Traction Evidence',
};

// SEC boilerplate patterns that indicate an unusable filing snippet.
// Items matching these are deprioritized and replaced with a fallback summary.
const SEC_BOILERPLATE_RE =
  /\b(exhibit\b|note \d+|unaudited condensed|description of the mergers?|pro forma|pursuant to|incorporated by reference|herein by reference|table of contents)\b/i;

/**
 * Returns a context-specific fallback summary for SEC boilerplate snippets.
 * Diversifies by sniffing keyword context from the raw text so multiple boilerplate
 * items do not collapse to the same generic string.
 */
function secBoilerplateFallback(rawText: string): string {
  const tl = rawText.toLowerCase();
  if (/\b(revenue recognition|net revenue|gross margin|revenue model|operating results?)\b/.test(tl)) {
    return 'SEC filings confirm revenue recognition policy and reported financial results';
  }
  if (/\b(risk factor|regulatory|compliance|litigation|legal proceeding)\b/.test(tl)) {
    return 'SEC filings highlight regulatory and operational risk factors';
  }
  if (/\b(transaction|merger|acquisition|deal term|deal structure|consideration)\b/.test(tl)) {
    return 'SEC filings describe transaction structure and deal terms';
  }
  if (/\b(product|service|technology|platform|solution)\b/.test(tl)) {
    return 'SEC filings describe core product offering and business description';
  }
  return 'SEC filings support business model and transaction structure';
}

/**
 * Translates a raw evidence card into a meaning-based { label, summary } pair.
 *
 * Label answers: "What type of claim does this prove?"
 * Summary answers: "What specific claim does this evidence support?"
 *
 * Rules:
 * - Labels are Title Case
 * - No raw keys, JSON blobs, cell paths, or generic phrases like "supports projections"
 * - Summaries reference domain topics (revenue, demand, product, customers, etc.)
 * - Max 140 chars per summary
 */
function summarizeEvidence(e: EvidenceCard): { label: string; summary: string } {
  const s = (e.source || '').toLowerCase();
  const k = (e.kind || '').toLowerCase();
  const raw = (e.text || '').trim();
  const tl = raw.toLowerCase();

  // ── JSON blob ──────────────────────────────────────────────────────────────
  if (/{[^{}]*"(min|max|value|count|amount|total|sum|avg|mean|median)"\s*:/.test(raw)) {
    // Inspect JSON keys to provide context-specific summary
    const jsonKeys = [...raw.matchAll(/"([a-z_]+)"\s*:/gi)].map((m) => m[1].toLowerCase());
    const hasRevenue = jsonKeys.some((j) => /revenue|arr|mrr|income|sales/.test(j));
    const hasChannel = jsonKeys.some((j) => /smb|enterprise|channel|segment|tier/.test(j));
    const hasRaise   = jsonKeys.some((j) => /raise|round|equity|valuation|dilut/.test(j));
    const numMatch   = raw.match(/"(?:value|amount|total|sum|count|avg|mean|median)"\s*:\s*([\d.]+)/);
    const hint       = numMatch ? ` (${numMatch[1]})` : '';
    if (hasChannel)  return { label: 'Financial Model Evidence', summary: `Financial model${hint} includes channel-level assumptions supporting segmented revenue projections` };
    if (hasRevenue)  return { label: 'Revenue Evidence',         summary: `Financial model${hint} supports revenue projections and growth assumptions` };
    if (hasRaise)    return { label: 'Capital Structure Evidence', summary: `Financial model${hint} supports raise size and ownership structure` };
    return { label: 'Financial Model Evidence', summary: `Structured financial model data${hint} supports quantitative projections` };
  }

  // ── Spreadsheet cell-path: "SheetName.col_X: value" ───────────────────────
  const cellPath = raw.match(/^([A-Za-z][\w\s]{2,})\.col_[A-Z]:\s*(.*)/);
  if (cellPath) {
    const sheet  = cellPath[1].trim();
    const sl     = sheet.toLowerCase();
    if (/smb|enterprise|channel|segment|assumption/.test(sl))
      return { label: 'Financial Model Evidence', summary: `${sheet} model assumptions support segmented revenue and channel projections` };
    if (/revenue|sales|arr|mrr/.test(sl))
      return { label: 'Revenue Evidence', summary: `Revenue model data from ${sheet} supports financial performance projections` };
    if (/alloc|cap table|equity|ownership/.test(sl))
      return { label: 'Capital Structure Evidence', summary: `${sheet} data supports ownership allocation and capital structure` };
    if (/valuation|dcf|irr/.test(sl))
      return { label: 'Capital Structure Evidence', summary: `Valuation model data from ${sheet} supports investment return analysis` };
    return { label: 'Financial Model Evidence', summary: `Financial model data from ${sheet} supports quantitative projections` };
  }

  // ── SEC boilerplate: diversified fallback, never a raw snippet ─────────────
  const isSecSource = /\b(audited|audit|s-1|10-k|10-q|prospectus|sec filing|annual report|form s-)\b/.test(tl);
  if (isSecSource && SEC_BOILERPLATE_RE.test(tl)) {
    return { label: 'SEC / Filing Evidence', summary: secBoilerplateFallback(tl) };
  }

  // ── Clean raw text for use as the summary sentence ─────────────────────────
  let cleaned = raw
    .replace(/^(?:canonical_metric|display_fact|extracted_number):[^=]+=\s*/i, '')
    .replace(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+:\s+/i, '')
    .replace(/\s+•\s+/g, ', ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\b\w{3,}\b)(\s+\1){2,}/gi, '$1')
    .trim();
  if (cleaned.length > 140) cleaned = cleaned.slice(0, 137) + '\u2026';

  // ── Keyword classification (priority order) ────────────────────────────────
  if (/\b(revenue|arr|mrr|burn|runway|cashflow|ebitda|margin|income|expense|cogs|gross profit|net loss|operating)\b/.test(tl)) {
    return {
      label: 'Revenue Evidence',
      summary: cleaned || 'Financial performance data supports revenue and growth analysis',
    };
  }
  if (/\b(valuation|pre.?money|post.?money|raise|round|equity|cap table|dilution|share|ownership)\b/.test(tl)) {
    return {
      label: 'Capital Structure Evidence',
      summary: cleaned || 'Capital structure data supports raise size and ownership analysis',
    };
  }
  if (/\b(tam|sam|market size|addressable|vertical|market demand|total market)\b/.test(tl)) {
    return {
      label: 'Market Demand Evidence',
      summary: cleaned || 'Market sizing data supports addressable opportunity assessment',
    };
  }
  if (/\b(customer|subscriber|user|loi|letter of intent|partner|channel|distributor|contracted|pipeline|booking|committed|reseller)\b/.test(tl)) {
    return {
      label: 'Customer / Traction Evidence',
      summary: cleaned || 'Customer signals and pipeline data support go-to-market traction',
    };
  }
  if (/\b(business model|revenue model|pricing|monetiz|subscription|saas|paas|license|recurring|service fee)\b/.test(tl)) {
    return {
      label: 'Business Model Evidence',
      summary: cleaned || 'Business model data supports recurring revenue structure analysis',
    };
  }
  if (/\b(risk|regulatory|compliance|litigation|legal|patent dispute|competitor|barrier|challenge|concentration)\b/.test(tl)) {
    return {
      label: 'Risk Evidence',
      summary: cleaned || 'Risk signals identified for due diligence review',
    };
  }
  if (/\b(product|feature|platform|technology|patent|capability|roadmap|mvp|launch|release)\b/.test(tl)) {
    return {
      label: 'Product Evidence',
      summary: cleaned || 'Product signals support technology and capability analysis',
    };
  }
  if (/\b(team|founder|executive|ceo|cto|experience|background|track record|headcount)\b/.test(tl)) {
    return {
      label: 'Team Evidence',
      summary: cleaned || 'Team background supports management quality assessment',
    };
  }
  if (isSecSource) {
    return {
      label: 'SEC / Filing Evidence',
      summary: cleaned || secBoilerplateFallback(tl),
    };
  }
  if (s.includes('xlsx') || s.includes('model') || k.includes('xlsx')) {
    return {
      label: 'Financial Model Evidence',
      summary: cleaned || 'Financial model data supports quantitative projections',
    };
  }
  if (s === 'phaseb_visual') {
    return {
      label: 'Visual Evidence',
      summary: cleaned || 'Visual content supports investor presentation analysis',
    };
  }
  const fallbackLabel =
    k === 'metric' ? 'Financial Metric' :
    k === 'summary' ? 'Summary Insight' :
    'Evidence';
  return { label: fallbackLabel, summary: cleaned || 'Relevant evidence found in submitted documents' };
}

/**
 * Softens raw "Add evidence for missing sections: X" language into investor-friendly copy.
 * Uses `hasSectionEvidence` (evidence_count_linked > 0) to distinguish:
 *   - Incomplete: evidence exists but section-level validation did not pass
 *   - Missing: no evidence linked to this section at all
 */
function humanizeMissingReason(reason: string, sectionLabel: string, hasSectionEvidence: boolean): string {
  if (/add evidence for missing sections?/i.test(reason) || !reason.trim()) {
    if (hasSectionEvidence) return `${sectionLabel} evidence exists, but validation is incomplete`;
    return `${sectionLabel} evidence is missing`;
  }
  if (/^missing:\s*/i.test(reason)) {
    const tail = reason.replace(/^missing:\s*/i, '');
    if (hasSectionEvidence) return `${sectionLabel} \u2014 ${tail.toLowerCase()} incomplete`;
    return tail;
  }
  return reason;
}

/**
 * Returns a priority score that ranks evidence by source trustworthiness.
 * Higher score = prefer in compact top-evidence selection.
 * SEC useful > spreadsheet/model > structured metric > deck/visual > SEC boilerplate
 */
function sourceClassScore(source: string, kind: string, text: string): number {
  const s = (source || '').toLowerCase();
  const k = (kind || '').toLowerCase();
  const t = (text || '').toLowerCase();
  // SEC / audited filing evidence — high trust, BUT boilerplate snippets are deprioritized
  if (/\b(audited|audit|s-1|10-k|10-q|prospectus|sec filing)\b/.test(t)) {
    return SEC_BOILERPLATE_RE.test(text) ? 4 : 40;
  }
  // Spreadsheet / financial model source
  if (s.includes('xlsx') || s.includes('model') || k.includes('xlsx')) return 30;
  // Structured financial metric from extraction pipeline
  if (s === 'extraction' && k === 'metric') return 20;
  // Other structured extraction
  if (s === 'extraction' && k === 'summary') return 15;
  if (s === 'extraction') return 10;
  // Fetched document source
  if (s === 'fetch_evidence') return 8;
  // Visual extraction
  if (s === 'phaseb_visual') return 5;
  return 0;
}

/**
 * Returns true if the live evidence list contains any traction-related signal
 * (LOI, channel, projected customers, ARR/MRR, contracted demand, etc.).
 * Used to avoid labeling traction sections as fully "missing" when broad
 * traction evidence exists but didn't match a phase-1 claim.
 */
function hasBroadTractionEvidence(evidence: EvidenceCard[]): boolean {
  return evidence.some((e) => TRACTION_EVIDENCE_RE.test(e.text));
}

interface Props {
  evidence: EvidenceCard[];
  evidenceLoading: boolean;
  scoreBreakdownSections: SectionRow[];
  documentTitles: Record<string, string>;
  darkMode: boolean;
  onOpenFull?: () => void;
}

export function WorkbenchEvidenceSummary({
  evidence,
  evidenceLoading,
  scoreBreakdownSections,
  documentTitles,
  darkMode,
  onOpenFull,
}: Props) {
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const sub = darkMode ? 'text-gray-300' : 'text-gray-700';
  const cardBg = darkMode ? 'bg-white/[0.03]' : 'bg-gray-50';

  const docCount = Object.keys(documentTitles).length;
  const evidenceCount = evidence.length;

  const supported = scoreBreakdownSections.filter((s) => s.support_status === 'supported');
  const unsupported = scoreBreakdownSections.filter((s) => s.support_status === 'missing');

  // Differentiate truly missing (no evidence linked) from incomplete (evidence exists but
  // not yet validated). Shown separately in the coverage header and Unsupported Claims list.
  const truelyMissing = unsupported.filter((s) => (s.evidence_count_linked ?? 0) === 0);
  const incompleteValidation = unsupported.filter((s) => (s.evidence_count_linked ?? 0) > 0);

  // Expand pool to 8 before deduplication: if top items share the same summarized text,
  // the dedup IIFE needs candidates further down the ranked list to fill 3 unique slots.
  const topEvidence = [...evidence]
    .filter((e) => typeof e.text === 'string' && e.text.trim().length > 20)
    .sort((a, b) => {
      // Primary: prefer stronger source classes (SEC > model > structured metric > deck)
      const sa = sourceClassScore(a.source, a.kind, a.text);
      const sb = sourceClassScore(b.source, b.kind, b.text);
      if (sb !== sa) return sb - sa;
      // Secondary: sort by confidence
      const ca = typeof a.confidence === 'number' ? a.confidence : 0;
      const cb = typeof b.confidence === 'number' ? b.confidence : 0;
      return cb - ca;
    })
    .slice(0, 8);

  const hasAnything =
    evidenceCount > 0 ||
    scoreBreakdownSections.length > 0 ||
    docCount > 0;

  if (evidenceLoading) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted}`}>Loading evidence…</div>
      </div>
    );
  }

  if (!hasAnything) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted} mb-3`}>Summary not available yet.</div>
        {onOpenFull && (
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full evidence explorer
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`border-t ${border} divide-y ${darkMode ? 'divide-white/5' : 'divide-gray-100'}`}>

      {/* Coverage header */}
      {(docCount > 0 || evidenceCount > 0) && (
        <div className="px-4 py-3 flex items-center gap-4">
          {docCount > 0 && (
            <div className="text-center">
              <div className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{docCount}</div>
              <div className={`text-xs ${muted}`}>Sources</div>
            </div>
          )}
          {evidenceCount > 0 && (
            <div className="text-center">
              <div className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{evidenceCount}</div>
              <div className={`text-xs ${muted}`}>Evidence items</div>
            </div>
          )}
          {supported.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-emerald-400">{supported.length}</div>
              <div className={`text-xs ${muted}`}>Sections Supported</div>
              <div className={`text-xs ${muted} opacity-60`}>analysis snapshot</div>
            </div>
          )}
          {incompleteValidation.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-amber-400">{incompleteValidation.length}</div>
              <div className={`text-xs ${muted}`}>Sections Incomplete</div>
              <div className={`text-xs ${muted} opacity-60`}>evidence unvalidated</div>
            </div>
          )}
          {truelyMissing.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-red-400">{truelyMissing.length}</div>
              <div className={`text-xs ${muted}`}>Sections Missing</div>
              <div className={`text-xs ${muted} opacity-60`}>analysis snapshot</div>
            </div>
          )}
        </div>
      )}

      {/* Section coverage summary */}
      {scoreBreakdownSections.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Section Coverage</div>
          {scoreBreakdownSections.slice(0, 6).map((s) => {
            // isIncomplete: amber ◐ — evidence exists OR traction section has broad signal
            // isMissing:    red   ○ — no evidence and no traction alt signal
            // Both checks are consistent with the header counters and Unsupported Claims logic.
            const hasSectionEvidence = (s.evidence_count_linked ?? 0) > 0;
            const isTractionAlt =
              s.support_status === 'missing' &&
              TRACTION_SECTION_KEYS.has(s.key) &&
              hasBroadTractionEvidence(evidence);
            const isIncomplete = s.support_status === 'weak' || isTractionAlt || (s.support_status === 'missing' && hasSectionEvidence);
            const dot =
              s.support_status === 'supported'
                ? 'text-emerald-400'
                : isIncomplete
                ? 'text-amber-400'
                : s.support_status === 'missing'
                ? 'text-red-400'
                : muted;
            const symbol =
              s.support_status === 'supported' ? '●' :
              isIncomplete ? '◐' :
              s.support_status === 'missing' ? '○' : '–';
            return (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <div className={`flex items-center gap-1.5 text-xs ${sub}`}>
                  <span className={dot}>{symbol}</span>
                  <span>
                    {isTractionAlt
                      ? (TRACTION_ALT_LABELS[s.key] ?? s.label ?? s.key)
                      : (s.label ?? s.key)}
                  </span>
                </div>
                {(s.evidence_count_linked != null || s.evidence_count_total != null) && (
                  <span className={`text-xs ${muted}`}>{s.evidence_count_linked ?? s.evidence_count_total} items</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unsupported claims */}
      {unsupported.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Unsupported Claims</div>
          {unsupported.slice(0, 3).map((s) => {
            // A section is "incomplete" (amber) rather than "missing" (red) when:
            // - evidence_count_linked > 0 (evidence exists at the section level), OR
            // - it's a traction section and broad traction evidence is present
            const hasSectionEvidence = (s.evidence_count_linked ?? 0) > 0;
            const isTractionAlt =
              TRACTION_SECTION_KEYS.has(s.key) && hasBroadTractionEvidence(evidence);
            const isIncomplete = hasSectionEvidence || isTractionAlt;
            return (
              <div key={s.key} className={`text-xs ${muted} flex items-start gap-1.5`}>
                <span className={`mt-0.5 shrink-0 ${isIncomplete ? 'text-amber-400' : 'text-red-400'}`}>
                  {isIncomplete ? '◐' : '○'}
                </span>
                <span>
                  {isTractionAlt
                    ? `${TRACTION_ALT_LABELS[s.key] ?? 'Customer/Traction Evidence'} — evidence present, claim not validated`
                    : humanizeMissingReason(
                        s.missing_reasons?.[0] ?? '',
                        s.label ?? s.key,
                        hasSectionEvidence,
                      )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Top linked evidence snippets */}
      {topEvidence.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Top Evidence</div>
          {(() => {
            // Deduplicate: skip items whose summary is identical to one already rendered.
            const seen = new Set<string>();
            const items: JSX.Element[] = [];
            for (const e of topEvidence) {
              const { label, summary } = summarizeEvidence(e);
              if (seen.has(summary)) continue;
              seen.add(summary);
              items.push(
                <div key={e.evidence_id} className={`text-xs ${sub} leading-relaxed`}>
                  <span className={`font-medium ${muted} mr-1`}>{label}:</span>
                  <span className="line-clamp-2">{summary}</span>
                </div>
              );
              if (items.length === 3) break;
            }
            return items;
          })()}
        </div>
      )}

      {/* CTA footer */}
      {onOpenFull && (
        <div className={`px-4 py-3 ${cardBg}`}>
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full evidence explorer →
          </button>
        </div>
      )}
    </div>
  );
}
