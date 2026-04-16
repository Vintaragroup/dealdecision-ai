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

/**
 * Returns a concise human-readable type label for an evidence item.
 * Avoids raw source•kind strings like "extraction • metric".
 */
function humanizeEvidenceKind(source: string, kind: string): string {
  const s = (source || '').toLowerCase();
  const k = (kind || '').toLowerCase();
  if (s === 'phaseb_visual') return 'Visual';
  if (k === 'metric') return 'Metric';
  if (k === 'summary') return 'Summary';
  if (k === 'section') return 'Insight';
  if (s === 'fetch_evidence' && k === 'document') return 'Document';
  if (s === 'fetch_evidence') return 'Source';
  if (s === 'extraction') return 'Extraction';
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Evidence';
}

/**
 * Strips raw extraction key prefixes (canonical_metric:path=, display_fact:path=, etc.)
 * and formats bullet separators for investor-readable display.
 */
function cleanEvidenceText(text: string): string {
  const t = (text || '').trim();
  if (!t) return '';
  // Strip raw key prefix patterns: canonical_metric:some:path = value
  let cleaned = t.replace(/^(?:canonical_metric|display_fact|extracted_number):[^=]+=\s*/i, '');
  // Strip remaining snake_case:label: prefixes left at start
  cleaned = cleaned.replace(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+:\s+/i, '');
  // Replace " • " bullet separators with ", " for readability
  cleaned = cleaned.replace(/\s+•\s+/g, ', ');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Cap at 140 characters
  if (cleaned.length > 140) cleaned = cleaned.slice(0, 137) + '\u2026';
  return cleaned || t.slice(0, 140);
}

/**
 * Returns a priority score that ranks evidence by source trustworthiness.
 * Higher score = prefer in compact top-evidence selection.
 * SEC/audit > spreadsheet/model > structured metric > deck/visual
 */
function sourceClassScore(source: string, kind: string, text: string): number {
  const s = (source || '').toLowerCase();
  const k = (kind || '').toLowerCase();
  const t = (text || '').toLowerCase();
  // SEC / audited filing evidence — highest trust
  if (/\b(audited|audit|s-1|10-k|10-q|prospectus|sec filing)\b/.test(t)) return 40;
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
  const weak = scoreBreakdownSections.filter((s) => s.support_status === 'weak');

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
    .slice(0, 3);

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
          {unsupported.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-red-400">{unsupported.length}</div>
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
            // For traction/customer sections marked missing: if broad traction evidence exists
            // in the live evidence list, show as partial (amber) rather than absent (red).
            const isTractionAlt =
              s.support_status === 'missing' &&
              TRACTION_SECTION_KEYS.has(s.key) &&
              hasBroadTractionEvidence(evidence);
            const dot =
              s.support_status === 'supported'
                ? 'text-emerald-400'
                : s.support_status === 'weak' || isTractionAlt
                ? 'text-amber-400'
                : s.support_status === 'missing'
                ? 'text-red-400'
                : muted;
            const symbol =
              s.support_status === 'supported' ? '●' :
              (s.support_status === 'weak' || isTractionAlt) ? '◐' :
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
            const isTractionAlt =
              TRACTION_SECTION_KEYS.has(s.key) && hasBroadTractionEvidence(evidence);
            return (
              <div key={s.key} className={`text-xs ${muted} flex items-start gap-1.5`}>
                <span className={`mt-0.5 shrink-0 ${isTractionAlt ? 'text-amber-400' : 'text-red-400'}`}>
                  {isTractionAlt ? '◐' : '○'}
                </span>
                <span>
                  {isTractionAlt
                    ? `${TRACTION_ALT_LABELS[s.key] ?? 'Customer/Traction Evidence'} — evidence present, claim not validated`
                    : `${s.label ?? s.key}${s.missing_reasons?.[0] ? ` — ${s.missing_reasons[0]}` : ''}`}
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
          {topEvidence.map((e) => {
            const typeLabel = humanizeEvidenceKind(e.source, e.kind);
            const displayText = cleanEvidenceText(e.text);
            return (
              <div key={e.evidence_id} className={`text-xs ${sub} leading-relaxed`}>
                <span className={`font-medium ${muted} mr-1`}>{typeLabel}:</span>
                <span className="line-clamp-2">{displayText}</span>
              </div>
            );
          })}
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
