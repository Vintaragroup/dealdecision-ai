/**
 * apps/web/src/components/workspace/IntelligenceTab.tsx
 * Decision Confidence — Stage 5 challenge_pass analysis.
 *
 * Answers four questions clearly:
 *   1. How confident is the system?
 *   2. Why does it believe this?
 *   3. What would change the assessment?
 *   4. How has confidence changed over time?
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGetDealIntelligence, type DealIntelligenceRecord, type DecisionReadiness, type DecisionReadinessResult } from '../../lib/apiClient';
import type { FinancialTile } from './WorkspaceRedesignedShell';
import { scoreToBadge, getScoreBadgeColors } from '../../lib/scoreBadge';

// ─── JSONB field shapes ───────────────────────────────────────────────────────

interface ChallengeFactor {
  code?: string;
  severity?: string;
  title?: string;
  explanation?: string;
}

interface EvidenceGapItem {
  evidence_type?: string;
  description?: string;
  verdict_sensitivity?: string;
  diligence_question?: string;
}

interface ContradictionSource {
  document?: string;
  location?: string;
  value?: string;
}

interface ContradictionItem {
  type?: string;
  title?: string;
  explanation?: string;
  sources?: ContradictionSource[];
}

function toChallengeFactors(raw: unknown[]): ChallengeFactor[] {
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .map((x) => x as ChallengeFactor);
}

function toEvidenceGaps(raw: unknown[]): EvidenceGapItem[] {
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .map((x) => x as EvidenceGapItem);
}

function toStringArray(raw: unknown[]): string[] {
  return raw.filter((x): x is string => typeof x === 'string');
}

function toContradictionItems(raw: unknown[]): ContradictionItem[] {
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .map((x) => x as ContradictionItem);
}

// ─── Sort / rank helpers ──────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { critical: 0, error: 1, warn: 2, info: 3 };
const SENSITIVITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// ─── Label config ─────────────────────────────────────────────────────────────

interface LabelConfig {
  badgeBg: string;
  badgeText: string;
  barColor: string;
  borderDark: string;
  borderLight: string;
}

const LABEL_CONFIG: Record<string, LabelConfig> = {
  'Robust': {
    badgeBg: 'bg-emerald-500/15', badgeText: 'text-emerald-300', barColor: 'bg-emerald-500',
    borderDark: 'border-emerald-500/20', borderLight: 'border-emerald-300/50',
  },
  'Moderate': {
    badgeBg: 'bg-blue-500/15', badgeText: 'text-blue-300', barColor: 'bg-blue-500',
    borderDark: 'border-blue-500/20', borderLight: 'border-blue-300/50',
  },
  'Fragile': {
    badgeBg: 'bg-amber-500/15', badgeText: 'text-amber-300', barColor: 'bg-amber-400',
    borderDark: 'border-amber-500/20', borderLight: 'border-amber-300/50',
  },
  'Very Fragile': {
    badgeBg: 'bg-red-500/15', badgeText: 'text-red-300', barColor: 'bg-red-500',
    borderDark: 'border-red-500/20', borderLight: 'border-red-300/50',
  },
};

const FALLBACK_CONFIG: LabelConfig = {
  badgeBg: 'bg-white/10', badgeText: 'text-gray-300', barColor: 'bg-gray-400',
  borderDark: 'border-white/10', borderLight: 'border-gray-200',
};

// ─── Decision Readiness badge config ─────────────────────────────────────────

const READINESS_CONFIG: Record<DecisionReadiness, {
  label: string;
  bg: string;
  text: string;
  border: string;
  description: string;
}> = {
  NOT_INVESTABLE: {
    label: 'Not Investable',
    bg: 'bg-red-500/20',
    text: 'text-red-300',
    border: 'border-red-500/30',
    description: 'Structural contradictions or critically low conviction block investment consideration.',
  },
  NOT_READY: {
    label: 'Not Ready',
    bg: 'bg-amber-500/20',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    description: 'Missing critical financial evidence. Provide runway, burn rate, or ARR data to advance.',
  },
  CONDITIONAL: {
    label: 'Conditional',
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-300',
    border: 'border-yellow-500/30',
    description: 'Investment possible if identified gaps are resolved — no structural contradictions.',
  },
  INVESTABLE: {
    label: 'Investable',
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
    description: 'Strong conviction with critical evidence present and no blocking flags.',
  },
};

// ─── Narrative builder ────────────────────────────────────────────────────────

/**
 * Strip the system-internal intro prefix from opposing_case_summary so only
 * the analytical content remains. The intro format is:
 *   "Challenge assessment for <name> (verdict: <V>, ORS: <N>). Primary risk signal: <T>. "
 */
function stripOpposingCaseIntro(text: string): string {
  return text
    .replace(/^Challenge assessment for[^.]+\.\s*/i, '')
    .replace(/^Primary risk signal:[^.]+\.\s*/i, '');
}

/**
 * Global leakage filter for all challenge-pass text fields.
 * Removes internal system labels that sometimes appear in LLM-generated explanations.
 */
function stripLeakage(text: string): string {
  return text
    .replace(/\bverdict:\s*(GO|CONSIDER|NO_GO)\b\.?\s*/gi, '')
    .replace(/\bORS\s*[:=]?\s*\d+\b\.?\s*/gi, '')
    .replace(/\bfor a (GO|CONSIDER|NO_GO) deal\b[^.]*\.?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Extract the first sentence from a multi-sentence explanation for use in a bullet. */
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : text.trim();
}

function buildNarrative(record: DealIntelligenceRecord, _highGaps: EvidenceGapItem[]): string {
  const label = record.verdict_resistance_label ?? '';
  const score = record.verdict_resistance_score;
  const v = (record.verdict ?? '').toUpperCase();

  // Opening sentence — uses the real verdict field when available so direction is explicit.
  let opener: string;
  if (v === 'NO_GO') {
    if (label === 'Fragile' || label === 'Very Fragile') {
      opener = `The system currently leans against this deal (${score}/100) — confidence in that judgment is limited.`;
    } else if (label === 'Moderate') {
      opener = `The system currently leans against this deal (${score}/100), though evidence to support this direction is limited.`;
    } else {
      opener = `The system currently leans against this deal (${score}/100).`;
    }
  } else if (v === 'GO') {
    if (label === 'Fragile' || label === 'Very Fragile') {
      opener = `The system currently leans in favor of this deal (${score}/100), but confidence is fragile.`;
    } else if (label === 'Moderate') {
      opener = `The system currently leans in favor of this deal (${score}/100), with moderate confidence.`;
    } else {
      opener = `The system currently leans in favor of this deal (${score}/100).`;
    }
  } else if (v === 'CONSIDER') {
    if (label === 'Very Fragile') {
      opener = `The system sees potential here but confidence is very low (${score}/100) — this judgment should not be relied upon without further evidence.`;
    } else if (label === 'Fragile') {
      opener = `The system sees potential here, but confidence is limited (${score}/100) — key evidence gaps remain unresolved.`;
    } else if (label === 'Moderate') {
      opener = `The system sees this deal as promising (${score}/100), though important questions remain open.`;
    } else {
      opener = `The system sees this deal as promising (${score}/100).`;
    }
  } else {
    // No verdict (null or pre-migration rows) — fall back to band-only phrasing
    if (label === 'Robust') {
      opener = `The assessment holds up well (${score}/100) — no material contradictions or critical gaps were detected.`;
    } else if (label === 'Moderate') {
      opener = `Confidence is moderate (${score}/100) — the assessment is partially supported but important evidence gaps remain.`;
    } else if (label === 'Fragile') {
      opener = `Confidence is limited (${score}/100) — the decision is tentative pending resolution of the identified gaps.`;
    } else if (label === 'Very Fragile') {
      opener = `Confidence is very low (${score}/100) — significant uncertainty exists and additional evidence is required before this assessment can be relied upon.`;
    } else {
      opener = `Confidence score: ${score}/100.`;
    }
  }

  // Body: opposing_case_summary contains deal-specific analytical content.
  // Strip the system-internal intro prefix, then filter any sentences that still
  // contain internal labels ("For a CONSIDER deal", "ORS NN") before rendering.
  if (record.opposing_case_summary) {
    const stripped = stripOpposingCaseIntro(record.opposing_case_summary).trim();
    if (stripped.length > 20) {
      const sentences = stripped.match(/[^.!?]+[.!?]+/g) ?? [];
      const clean = sentences.filter(
        (s) => !/for a (go|consider|no.go) deal/i.test(s) && !/\bors\s*\d+/i.test(s),
      );
      const body = clean.slice(0, 2).join(' ').trim();
      if (body) return `${opener} ${body}`;
    }
  }

  // Fallback: opener + primary challenge reason
  if (record.primary_challenge_reason) {
    const reason = stripLeakage(record.primary_challenge_reason.trim());
    if (reason) return `${opener} ${reason.endsWith('.') ? reason : `${reason}.`}`;
  }

  return opener;
}

// ─── "Why the system believes this" bullets (max 4, deduplicated) ─────────────

interface ReasonBullet {
  text: string;
  severity?: string;
}

function buildReasonBullets(
  factors: ChallengeFactor[],
  overconfidentClaims: string[],
  primaryReason: string,
): ReasonBullet[] {
  const seen = new Set<string>();
  const bullets: ReasonBullet[] = [];

  const add = (text: string, severity?: string) => {
    const key = normalize(text);
    if (!text || seen.has(key) || bullets.length >= 4) return;
    seen.add(key);
    bullets.push({ text, severity });
  };

  for (const f of factors) {
    // Prefer explanation (deal-specific analytical text) over title (category label).
    // Use only the first sentence to keep bullets scannable.
    // Strip system-internal labels before rendering.
    const raw = stripLeakage((f.explanation ?? f.title ?? '').trim());
    add(firstSentence(raw), f.severity);
  }
  if (bullets.length === 0 && primaryReason) {
    add(primaryReason.trim());
  }

  return bullets;
}

// ─── "What would increase confidence" actions (max 8, deduplicated, grouped) ──

/**
 * Maps challenge_pass evidence_type tokens to the corresponding FinancialTile label.
 * When a tile has a non-absent value, the evidence is "derived/unverified" rather than
 * truly missing — downgrade from high-sensitivity to medium and skip "obtain" framing.
 */
const FINANCIAL_EVIDENCE_TYPE_TO_TILE: Record<string, string> = {
  burn_rate: 'Monthly Burn',
  monthly_burn: 'Monthly Burn',
  runway: 'Runway',
  runway_months: 'Runway',
  revenue: 'Revenue / ARR',
  arr: 'Revenue / ARR',
  mrr: 'Revenue / ARR',
  cash: 'Cash',
  cash_balance: 'Cash',
  gross_margin: 'Gross Margin',
  gross_margin_pct: 'Gross Margin',
};

interface ConfidenceAction {
  text: string;
  sensitivity: 'high' | 'medium';
}

function buildConfidenceActions(
  missingEvidence: EvidenceGapItem[],
  diligenceGaps: EvidenceGapItem[],
  financialTiles: FinancialTile[],
): { high: ConfidenceAction[]; medium: ConfidenceAction[] } {
  const seen = new Set<string>();
  const all: ConfidenceAction[] = [];

  // Build a quick lookup: tile label → trust state for financial evidence reclassification.
  const tileTrust = new Map<string, string>(
    financialTiles.map((t) => [t.label, t.trust]),
  );

  const sorted = [...missingEvidence, ...diligenceGaps].sort(
    (a, b) =>
      (SENSITIVITY_RANK[a.verdict_sensitivity?.toLowerCase() ?? ''] ?? 99) -
      (SENSITIVITY_RANK[b.verdict_sensitivity?.toLowerCase() ?? ''] ?? 99)
  );

  for (const item of sorted) {
    if (all.length >= 8) break;
    // Only use diligence_question — description/evidence_type are state labels, not action asks.
    const text = (item.diligence_question ?? '').trim();
    if (!text) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const rawSensitivity = (item.verdict_sensitivity ?? '').toLowerCase();

    // If the challenge pass flagged this evidence_type as missing, but the Financial Snapshot
    // already shows a derived value for the corresponding metric, downgrade to medium so the
    // investor knows it needs verification — not that it's completely absent.
    const tileLabel = FINANCIAL_EVIDENCE_TYPE_TO_TILE[item.evidence_type?.toLowerCase() ?? ''];
    const tileState = tileLabel ? tileTrust.get(tileLabel) : undefined;
    const hasDerivedValue = tileState === 'interim_extraction' || tileState === 'structured';
    const effectiveSensitivity: 'high' | 'medium' =
      rawSensitivity === 'high' && hasDerivedValue ? 'medium' : rawSensitivity === 'high' ? 'high' : 'medium';

    all.push({ text, sensitivity: effectiveSensitivity });
  }

  return {
    high: all.filter((a) => a.sensitivity === 'high'),
    medium: all.filter((a) => a.sensitivity === 'medium'),
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso; }
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function ScoreBar({ score, barColor, darkMode }: { score: number; barColor: string; darkMode: boolean }) {
  return (
    <div className={`w-full rounded-full h-1.5 overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
      <div
        className={`h-full rounded-full transition-all ${barColor}`}
        style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
      />
    </div>
  );
}

function SeverityDot({ severity }: { severity?: string }) {
  const s = severity?.toLowerCase() ?? '';
  const color =
    s === 'critical' ? 'bg-red-500' :
    s === 'error'    ? 'bg-orange-400' :
    s === 'warn'     ? 'bg-amber-400' :
                       'bg-gray-400';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-[5px] ${color}`} />;
}

function CollapsibleRaw({ label, data, darkMode }: { label: string; data: unknown; darkMode: boolean }) {
  const [open, setOpen] = useState(false);
  const isEmpty = data == null || (Array.isArray(data) && (data as unknown[]).length === 0);
  const muted = darkMode ? 'text-gray-500' : 'text-gray-400';
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  return (
    <div className={`border rounded ${border} overflow-hidden`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
          darkMode ? 'bg-white/[0.02] hover:bg-white/[0.05]' : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
        <span className={muted}>{isEmpty ? 'empty' : open ? '▲' : '▼'}</span>
      </button>
      {open && !isEmpty && (
        <pre className={`text-xs p-3 overflow-auto max-h-64 ${darkMode ? 'bg-[#0d1117] text-gray-300' : 'bg-white text-gray-700'}`}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AccordionSection({
  title, subtitle, defaultOpen = false, darkMode, children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  darkMode: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  return (
    <div className={`rounded-lg border overflow-hidden ${border}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          darkMode ? 'bg-white/[0.02] hover:bg-white/[0.04]' : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div>
          <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</p>
          {subtitle && <p className={`text-xs ${muted} mt-0.5`}>{subtitle}</p>}
        </div>
        <span className={`text-xs ml-3 shrink-0 ${muted}`}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className={`px-4 py-3 border-t ${border} ${darkMode ? 'bg-white/[0.01]' : 'bg-white'}`}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IntelligenceTabProps {
  dealId: string;
  darkMode: boolean;
  /**
   * Financial tile state from the workspace. Used to distinguish between
   * "derived" (interim_extraction) and "truly missing" (not_extracted) evidence
   * so Decision Confidence actions are not marked high-priority when a derived
   * value already exists in the Financial Snapshot.
   */
  financialTiles?: FinancialTile[];
  /**
   * Deterministic investment-readiness classification from the deal report.
   * Passed down from the parent workspace which already has the report loaded.
   */
  decisionReadiness?: DecisionReadinessResult | null;
  /**
   * ISO timestamp of the most recent deal analysis run (from deal_intelligence_objects).
   * When this is significantly newer than the latest challenge pass result, a stale
   * indicator is shown to surface that Decision Confidence data is from a prior run.
   */
  lastAnalyzedAt?: string | null;
}

export function IntelligenceTab({ dealId, darkMode, financialTiles = [], decisionReadiness, lastAnalyzedAt }: IntelligenceTabProps) {
  const [records, setRecords] = useState<DealIntelligenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetDealIntelligence(dealId);
      setRecords(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load confidence data');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const border = darkMode ? 'border-white/10' : 'border-gray-200';

  if (loading) {
    return (
      <div className="py-8 text-center">
        <p className={`text-sm ${muted}`}>Loading confidence assessment…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className={`text-sm ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
        <button
          onClick={() => void load()}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            darkMode ? 'border-white/20 text-gray-300 hover:bg-white/10' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          Retry
        </button>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          No confidence assessment yet
        </p>
        <p className={`text-xs ${muted}`}>
          Decision confidence analysis runs automatically during Stage 5 processing.
        </p>
      </div>
    );
  }

  const latest = records[0];
  const priorRuns = records.slice(1);
  const cfg = LABEL_CONFIG[latest.verdict_resistance_label] ?? FALLBACK_CONFIG;

  // Parse JSONB fields
  const challengeFactors = toChallengeFactors(latest.challenge_factors).sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity?.toLowerCase() ?? ''] ?? 99) -
      (SEVERITY_RANK[b.severity?.toLowerCase() ?? ''] ?? 99)
  );
  const overconfidentClaims = toStringArray(latest.overconfident_claims);
  const missingEvidence = toEvidenceGaps(latest.missing_evidence);
  const diligenceGaps = toEvidenceGaps(latest.diligence_gaps as unknown[]);
  const contradictionItems = toContradictionItems(latest.contradiction_explanations ?? []);

  // High-sensitivity gaps for narrative
  const highGaps = [...missingEvidence, ...diligenceGaps].filter(
    (g) => (g.verdict_sensitivity ?? '').toLowerCase() === 'high'
  );

  // Derived display data
  const narrative = buildNarrative(latest, highGaps);
  const reasonBullets = buildReasonBullets(challengeFactors, overconfidentClaims, latest.primary_challenge_reason);
  const { high: highActions, medium: mediumActions } = buildConfidenceActions(missingEvidence, diligenceGaps, financialTiles);
  const hasActions = highActions.length > 0 || mediumActions.length > 0;

  return (
    <div className="space-y-3">
      {/* ─── Meta bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className={`text-xs ${muted}`}>
          {records.length} assessment{records.length !== 1 ? 's' : ''} · showing latest
        </p>
        <button
          onClick={() => void load()}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            darkMode ? 'border-white/20 text-gray-400 hover:bg-white/10' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          Refresh
        </button>
      </div>

      {/* ─── 0. Decision Readiness badge ────────────────────────────────── */}
      {decisionReadiness && (() => {
        const rcfg = READINESS_CONFIG[decisionReadiness.readiness];
        if (!rcfg) return null;
        return (
          <div className={`rounded-lg border p-3.5 space-y-2 ${darkMode ? 'border-white/10 bg-white/[0.02]' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between gap-3">
              <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>Decision Readiness</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-semibold ${rcfg.bg} ${rcfg.text} ${rcfg.border}`}>
                {rcfg.label}
              </span>
            </div>
            <p className={`text-xs leading-relaxed ${muted}`}>{decisionReadiness.reason}</p>
            {decisionReadiness.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {decisionReadiness.signals.map((s, i) => (
                  <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${darkMode ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                    {s}
                  </span>
                ))}
              </div>
            )}
            {decisionReadiness.next_actions && decisionReadiness.next_actions.length > 0 && (
              <div className={`pt-2 mt-1 space-y-1.5 border-t ${darkMode ? 'border-white/[0.06]' : 'border-gray-100'}`}>
                <p className={`text-[10px] font-medium uppercase tracking-wide opacity-60 ${muted}`}>What to do next</p>
                <ol className="space-y-1.5 list-none m-0 p-0">
                  {decisionReadiness.next_actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`shrink-0 text-[10px] font-semibold tabular-nums mt-0.5 ${muted}`}>{i + 1}.</span>
                      <span className={`text-[11px] leading-snug ${body}`}>{action}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── 1. Decision summary card ───────────────────────────────────── */}
      <div className={`rounded-lg border p-4 space-y-3 ${darkMode ? cfg.borderDark : cfg.borderLight} ${darkMode ? 'bg-white/[0.02]' : 'bg-white'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>Conclusion Robustness</p>
            {/* Badge-first: interpretation primary, score secondary */}
            {(() => {
              const dcBadge = scoreToBadge(latest.verdict_resistance_score ?? null, 'decision_confidence');
              const dcColors = getScoreBadgeColors(dcBadge.bucket, darkMode);
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-semibold ${dcColors.bg} ${dcColors.text} ${dcColors.border}`}>
                      {dcBadge.label} — {dcBadge.meaning}
                    </span>
                  </div>
                  <p className={`text-[11px] leading-relaxed ${muted}`}>
                    This measures whether the current conclusion would survive challenge and alternative interpretations.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium tabular-nums ${dcColors.text}`}>
                      {latest.verdict_resistance_score ?? '—'}
                      <span className={`text-xs font-normal ${muted}`}>/100</span>
                    </span>
                    {latest.verdict_resistance_label && (
                      <span className={`text-xs ${muted}`}>· {latest.verdict_resistance_label}</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          <div className="flex flex-col items-end shrink-0 pt-0.5 gap-0.5">
            <span className={`text-xs ${muted}`}>{fmtDateTime(latest.created_at)}</span>
            {(() => {
              if (!lastAnalyzedAt || !latest.created_at) return null;
              const staleDeltaMs = Date.parse(lastAnalyzedAt) - Date.parse(latest.created_at);
              if (staleDeltaMs <= 4 * 60 * 60 * 1000) return null;
              return (
                <span className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  From a prior analysis run
                </span>
              );
            })()}
          </div>
        </div>

        <ScoreBar score={latest.verdict_resistance_score} barColor={cfg.barColor} darkMode={darkMode} />

        {narrative && (
          <p className={`text-sm ${body} leading-relaxed`}>{narrative}</p>
        )}

        {/* Derived-vs-missing financial context — injected when the challenge pass flagged
            financial metrics that the Financial Snapshot already shows as derived values.
            This prevents misleading "X is missing" language when derived data exists. */}
        {(() => {
          const derivedTiles = financialTiles.filter((t) => t.trust === 'interim_extraction');
          if (derivedTiles.length === 0) return null;
          const derivedLabels = derivedTiles.map((t) => {
            if (t.label === 'Revenue / ARR') return 'structured ARR';
            if (t.label === 'Monthly Burn') return 'burn rate';
            return t.label.toLowerCase();
          });
          const burnRunway = derivedLabels.filter((l) => l === 'burn rate' || l === 'runway');
          const arr = derivedLabels.filter((l) => l === 'structured ARR');
          const notes: string[] = [];
          if (burnRunway.length > 0) {
            notes.push(`${burnRunway.join(' and ')} ${burnRunway.length > 1 ? 'are' : 'is'} derived from projections and require independent verification`);
          }
          if (arr.length > 0) {
            notes.push('structured ARR is not yet verified from underwritable financial evidence');
          }
          if (notes.length === 0) return null;
          return (
            <p className={`text-xs ${muted} pt-1 border-t ${border}`}>
              <span className="font-medium">Financial data note:</span>{' '}
              {notes.join('; ')}.
            </p>
          );
        })()}
      </div>

      {/* ─── 2. Why the system believes this ───────────────────────────── */}
      {reasonBullets.length > 0 && (
        <AccordionSection
          title="Why the system believes this"
          defaultOpen={true}
          darkMode={darkMode}
        >
          <div className="space-y-2.5">
            {reasonBullets.map((bullet, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <SeverityDot severity={bullet.severity} />
                <p className={`text-sm ${body} leading-snug`}>{bullet.text}</p>
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {/* ─── 3. Contradictions detected ────────────────────────────────── */}
      {contradictionItems.length > 0 && (
        <AccordionSection
          title={`Contradictions detected (${contradictionItems.length})`}
          defaultOpen={true}
          darkMode={darkMode}
        >
          <div className="space-y-4">
            {contradictionItems.map((item, i) => (
              <div key={i} className={`rounded border p-3 space-y-2 ${darkMode ? 'border-amber-500/20 bg-amber-500/5' : 'border-amber-300/50 bg-amber-50/60'}`}>
                <div className="flex items-start gap-2">
                  <SeverityDot severity="error" />
                  <p className={`text-sm font-medium leading-snug ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {stripLeakage(item.title ?? 'Contradiction detected')}
                  </p>
                </div>
                {item.explanation && (
                  <p className={`text-sm ${body} leading-relaxed pl-5`}>{stripLeakage(item.explanation)}</p>
                )}
                {item.sources && item.sources.length > 0 && (
                  <div className="pl-5 space-y-1 pt-0.5">
                    {item.sources.map((src, j) => (
                      <div key={j} className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-xs font-medium shrink-0 ${muted}`}>{src.document}</span>
                        {src.location && (
                          <span className={`text-xs ${muted}`}>· {src.location}</span>
                        )}
                        {src.value && (
                          <span className={`text-xs font-mono ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>{src.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {/* ─── 4. What would increase confidence ─────────────────────────── */}
      {hasActions && (
        <AccordionSection
          title="What would increase confidence"
          defaultOpen={true}
          darkMode={darkMode}
        >
          <div className="space-y-4">
            {highActions.length > 0 && (
              <div className="space-y-2">
                <p className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                  High impact
                </p>
                {highActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-xs shrink-0 mt-0.5 font-bold leading-snug ${darkMode ? 'text-red-400' : 'text-red-500'}`}>↑</span>
                    <p className={`text-sm ${body}`}>{action.text}</p>
                  </div>
                ))}
              </div>
            )}
            {mediumActions.length > 0 && (
              <div className="space-y-2">
                <p className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  Medium impact
                </p>
                {mediumActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-xs shrink-0 mt-0.5 leading-snug ${darkMode ? 'text-amber-400' : 'text-amber-500'}`}>↑</span>
                    <p className={`text-sm ${body}`}>{action.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AccordionSection>
      )}

      {/* ─── 5. Prior assessments ──────────────────────────────────────── */}
      {priorRuns.length > 0 && (
        <AccordionSection
          title="Prior assessments"
          subtitle={`${priorRuns.length} earlier run${priorRuns.length !== 1 ? 's' : ''}`}
          defaultOpen={false}
          darkMode={darkMode}
        >
          <div>
            {priorRuns.map((run) => {
              const runCfg = LABEL_CONFIG[run.verdict_resistance_label] ?? FALLBACK_CONFIG;
              return (
                <div key={run.id} className={`flex items-start gap-3 py-2.5 border-b last:border-0 ${border}`}>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${runCfg.badgeBg} ${runCfg.badgeText}`}>
                    {run.verdict_resistance_label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xs font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {run.verdict_resistance_score}/100
                      </span>
                      <span className={`text-xs ${muted}`}>{fmtDate(run.created_at)}</span>
                    </div>
                    {run.primary_challenge_reason && (
                      <p className={`text-xs ${body} mt-0.5 line-clamp-2`}>{run.primary_challenge_reason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </AccordionSection>
      )}

      {/* ─── 6. Internal diagnostic detail (advanced) ──────────────────── */}
      <AccordionSection
        title="Internal diagnostic detail (advanced)"
        subtitle="Raw structured output from the assessment engine"
        defaultOpen={false}
        darkMode={darkMode}
      >
        <div className="space-y-2">
          <CollapsibleRaw label="Challenge Factors" data={latest.challenge_factors} darkMode={darkMode} />
          <CollapsibleRaw label="Missing Evidence" data={latest.missing_evidence} darkMode={darkMode} />
          <CollapsibleRaw label="Diligence Gaps" data={latest.diligence_gaps} darkMode={darkMode} />
          <CollapsibleRaw label="Overconfident Claims" data={latest.overconfident_claims} darkMode={darkMode} />
          <div className={`rounded border px-3 py-2 ${border}`}>
            <p className={`text-xs font-medium ${muted} mb-1`}>Run ID</p>
            <p className={`text-xs font-mono ${muted} break-all`}>{latest.intelligence_run_id}</p>
          </div>
        </div>
      </AccordionSection>
    </div>
  );
}

