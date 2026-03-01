/**
 * RiskVerificationSection  — AI Analysis Tab exclusive component
 *
 * Renders a visual risk & verification panel with:
 *  • Risk Score panel (0–100; higher = more risk; deterministic)
 *  • Verification Checklist (gate items with Pass/Fail badges)
 *  • Key Risks (deterministic bullets derived from gate failures,
 *    missing critical fields, reconciliation issues, and data conflicts)
 *  • Conflicts panel (field-level discrepancy table)
 *  • Coverage tiles (docs, pages, evidence counts + low-coverage callout)
 *  • AI Governed narrative panel (from POST /analysis/risk-verification)
 *
 * All deterministic data is derived from render_package.sections — no numbers
 * are invented.  Missing data shows "TBD" tiles and "No data" placeholders.
 *
 * SCOPE: used by InvestorReportView.tsx only.
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSearch,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { InvestorInsightsReport, RiskVerificationNarrativeResult } from '../../../lib/apiClient';
import {
  useRiskVerification,
  type CoverageData,
  type ConflictEntry,
  type GateItem,
  type KeyRisk,
} from '../../../hooks/useRiskVerification';

// ─────────────────────────────────────────────────────────────────────────────
// Prop types
// ─────────────────────────────────────────────────────────────────────────────

interface RiskVerificationSectionProps {
  dealId: string | undefined;
  report: InvestorInsightsReport | null;
  darkMode?: boolean;
  dealName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Score Panel
// ─────────────────────────────────────────────────────────────────────────────

function ScorePanel({
  score,
  label,
  confidenceLabel,
  darkMode,
}: {
  score: number;
  label: string;
  confidenceLabel: 'High' | 'Medium' | 'Low';
  darkMode: boolean;
}) {
  const pct = Math.max(0, Math.min(100, score));

  // For risk score: red = high risk, amber = moderate, emerald = low
  const ringColor =
    pct >= 75
      ? (darkMode ? 'stroke-red-500' : 'stroke-red-500')
      : pct >= 50
      ? (darkMode ? 'stroke-amber-500' : 'stroke-amber-500')
      : 'stroke-emerald-500';

  const textColor =
    pct >= 75
      ? (darkMode ? 'text-red-400' : 'text-red-600')
      : pct >= 50
      ? (darkMode ? 'text-amber-400' : 'text-amber-600')
      : (darkMode ? 'text-emerald-400' : 'text-emerald-600');

  const barColor =
    pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500';

  const confPill = {
    High:   darkMode ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    Medium: darkMode ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-700 border border-amber-200',
    Low:    darkMode ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700 border border-red-200',
  }[confidenceLabel];

  return (
    <div
      className={`rounded-xl border p-5 flex items-center gap-5 ${
        darkMode ? 'bg-white/3 border-white/10' : 'bg-slate-50 border-slate-200'
      }`}
      data-testid="rv-score-panel"
    >
      {/* Circular score display */}
      <div className="relative shrink-0 w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26"
            className={darkMode ? 'stroke-white/10' : 'stroke-slate-200'}
            strokeWidth="6" fill="none" />
          <circle
            cx="32" cy="32" r="26"
            className={ringColor}
            strokeWidth="6" fill="none"
            strokeDasharray={`${(pct / 100) * 163.4} 163.4`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums ${textColor}`}
          data-testid="rv-score-value"
        >
          {pct}
        </span>
      </div>

      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Verification Risk Score
        </p>
        <p className={`text-base font-semibold ${darkMode ? 'text-zinc-100' : 'text-slate-800'}`}>
          {pct} / 100
        </p>
        <p className={`text-xs mt-0.5 ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}
          data-testid="rv-score-label">
          {label}
        </p>

        {/* Score bar */}
        <div
          className={`mt-2 h-1.5 rounded-full overflow-hidden w-40 ${
            darkMode ? 'bg-white/10' : 'bg-slate-200'
          }`}
        >
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>

        {/* Confidence pill */}
        <div className="mt-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${confPill}`}>
            Data confidence: {confidenceLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification Checklist (gate items)
// ─────────────────────────────────────────────────────────────────────────────

type GateBadgeStatus = 'pass' | 'fail' | 'not_run';

function GateBadge({
  status,
  darkMode,
}: {
  status: GateBadgeStatus;
  darkMode: boolean;
}) {
  if (status === 'pass') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
          darkMode ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}
        data-testid="rv-gate-badge"
      >
        <CheckCircle2 className="w-3 h-3" />
        Pass
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
          darkMode ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700 border border-red-200'
        }`}
        data-testid="rv-gate-badge"
      >
        <XCircle className="w-3 h-3" />
        Fail
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
        darkMode ? 'bg-zinc-700/50 text-zinc-400' : 'bg-slate-100 text-slate-500'
      }`}
      data-testid="rv-gate-badge"
    >
      Not Run
    </span>
  );
}

function GateChecklist({
  gates,
  darkMode,
}: {
  gates: GateItem[];
  darkMode: boolean;
}) {
  if (gates.length === 0) {
    return (
      <div
        className={`rounded-lg border p-4 text-center ${
          darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
        }`}
        data-testid="rv-gate-checklist"
      >
        <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
          No gate data available in this report.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        darkMode ? 'border-white/10' : 'border-slate-200'
      }`}
      data-testid="rv-gate-checklist"
    >
      {gates.map((gate, i) => {
        const status: GateBadgeStatus = gate.passed ? 'pass' : 'fail';
        const reasonText =
          gate.reason_code ??
          (gate.actual != null ? `${gate.actual}` : null);

        return (
          <div
            key={gate.gate}
            className={`flex items-center justify-between gap-3 px-4 py-3 ${
              i > 0
                ? (darkMode ? 'border-t border-white/5' : 'border-t border-slate-100')
                : ''
            } ${
              darkMode ? 'bg-white/2' : 'bg-white'
            }`}
            data-testid="rv-gate-item"
          >
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold truncate ${
                darkMode ? 'text-zinc-200' : 'text-slate-700'
              }`}>
                {gate.gate}
              </p>
              {reasonText && (
                <p className={`text-xs mt-0.5 truncate ${
                  darkMode ? 'text-zinc-500' : 'text-slate-400'
                }`}>
                  {reasonText}
                </p>
              )}
            </div>
            <GateBadge status={status} darkMode={darkMode} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Risks
// ─────────────────────────────────────────────────────────────────────────────

const RISK_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Disclosure:              <AlertCircle  className="w-3.5 h-3.5 shrink-0" />,
  Consistency:             <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
  Coverage:                <Database     className="w-3.5 h-3.5 shrink-0" />,
  'Financial Plausibility': <ShieldAlert  className="w-3.5 h-3.5 shrink-0" />,
  Verification:            <FileSearch   className="w-3.5 h-3.5 shrink-0" />,
};

const RISK_CATEGORY_COLORS: Record<string, { dark: string; light: string }> = {
  Disclosure:              { dark: 'text-amber-400',  light: 'text-amber-600'  },
  Consistency:             { dark: 'text-red-400',    light: 'text-red-600'    },
  Coverage:                { dark: 'text-blue-400',   light: 'text-blue-600'   },
  'Financial Plausibility': { dark: 'text-violet-400', light: 'text-violet-600' },
  Verification:            { dark: 'text-orange-400', light: 'text-orange-600' },
};

function KeyRisksPanel({
  keyRisks,
  darkMode,
}: {
  keyRisks: KeyRisk[];
  darkMode: boolean;
}) {
  if (keyRisks.length === 0) {
    return (
      <div
        className={`rounded-lg border p-4 flex items-center gap-2 ${
          darkMode ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-100 bg-emerald-50'
        }`}
        data-testid="rv-key-risks"
      >
        <ShieldCheck className={`w-4 h-4 shrink-0 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
        <p className={`text-xs ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
          No material risk signals detected in available data.
        </p>
      </div>
    );
  }

  return (
    <ul
      className={`rounded-xl border divide-y ${
        darkMode ? 'border-white/10 divide-white/5 bg-white/2' : 'border-slate-200 divide-slate-100 bg-white'
      }`}
      data-testid="rv-key-risks"
    >
      {keyRisks.map((risk, i) => {
        const color = RISK_CATEGORY_COLORS[risk.category] ?? { dark: 'text-zinc-400', light: 'text-slate-500' };
        const icon  = RISK_CATEGORY_ICONS[risk.category] ?? <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;

        return (
          <li
            key={i}
            className="flex items-start gap-3 px-4 py-3"
            data-testid="rv-risk-item"
          >
            <span className={darkMode ? color.dark : color.light}>
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <span className={`text-xs font-semibold uppercase tracking-wider mr-2 ${
                darkMode ? color.dark : color.light
              }`}>
                {risk.category}
              </span>
              <p className={`text-xs mt-0.5 leading-relaxed ${
                darkMode ? 'text-zinc-300' : 'text-slate-700'
              }`}>
                {risk.text}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflicts Panel
// ─────────────────────────────────────────────────────────────────────────────

function ConflictsPanel({
  conflicts,
  darkMode,
}: {
  conflicts: ConflictEntry[];
  darkMode: boolean;
}) {
  if (conflicts.length === 0) {
    return (
      <div
        className={`rounded-lg border p-4 flex items-center gap-2 ${
          darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
        }`}
        data-testid="rv-conflicts-panel"
      >
        <CheckCircle2 className={`w-4 h-4 shrink-0 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
        <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          No conflicts detected across data sources.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        darkMode ? 'border-white/10' : 'border-slate-200'
      }`}
      data-testid="rv-conflicts-panel"
    >
      <div className={`overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={darkMode ? 'bg-white/5' : 'bg-slate-50'}>
              {['Field', 'Source A', 'Source B'].map((h) => (
                <th
                  key={h}
                  className={`text-left px-3 py-2 font-semibold ${
                    darkMode ? 'text-zinc-400' : 'text-slate-500'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c, i) => (
              <tr
                key={i}
                className={`${
                  i > 0 ? (darkMode ? 'border-t border-white/5' : 'border-t border-slate-100') : ''
                }`}
                data-testid="rv-conflict-row"
              >
                <td className={`px-3 py-2.5 font-medium ${
                  darkMode ? 'text-zinc-200' : 'text-slate-700'
                }`}>
                  {c.field.replaceAll('_', ' ')}
                </td>
                <td className={`px-3 py-2.5 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
                  {c.value_a}
                  {c.source_a && (
                    <span className={`block text-xs mt-0.5 ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                      {c.source_a}
                    </span>
                  )}
                </td>
                <td className={`px-3 py-2.5 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
                  {c.value_b}
                  {c.source_b && (
                    <span className={`block text-xs mt-0.5 ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                      {c.source_b}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {conflicts.some((c) => c.reason) && (
        <div className={`border-t px-3 pb-3 pt-2 ${
          darkMode ? 'border-white/5 bg-white/2' : 'border-slate-100 bg-slate-50/60'
        }`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-zinc-500' : 'text-slate-400'
          }`}>
            Reasons
          </p>
          <ul className="space-y-1">
            {conflicts.filter((c) => c.reason).map((c, i) => (
              <li key={i} className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                <span className="font-medium">{c.field.replaceAll('_', ' ')}:</span> {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage Tiles
// ─────────────────────────────────────────────────────────────────────────────

function CoverageTile({
  label,
  value,
  darkMode,
}: {
  label: string;
  value: string | null;
  darkMode: boolean;
}) {
  const isTbd = value === null || value === 'TBD';
  return (
    <div
      className={`rounded-lg border p-3 space-y-1 ${
        darkMode ? 'bg-white/3 border-white/8' : 'bg-white border-slate-100'
      }`}
      data-testid="rv-coverage-tile"
    >
      <p className={`text-xs font-semibold uppercase tracking-wider ${
        darkMode ? 'text-zinc-400' : 'text-slate-500'
      }`}>
        {label}
      </p>
      <p className={`text-sm font-semibold leading-snug ${
        isTbd
          ? (darkMode ? 'text-zinc-500 italic' : 'text-slate-400 italic')
          : (darkMode ? 'text-zinc-100' : 'text-slate-800')
      }`}>
        {value ?? 'TBD'}
      </p>
    </div>
  );
}

function CoverageTiles({
  coverage,
  darkMode,
}: {
  coverage: CoverageData | null;
  darkMode: boolean;
}) {
  if (!coverage) {
    return (
      <div
        className={`rounded-lg border p-4 text-center ${
          darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
        }`}
        data-testid="rv-coverage-tiles"
      >
        <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
          Document coverage data not available.
        </p>
      </div>
    );
  }

  const pagesPct =
    coverage.text_coverage_pct !== null
      ? `${coverage.text_coverage_pct}%`
      : coverage.dpu_nonempty_pages !== null && coverage.dpu_page_count != null && coverage.dpu_page_count > 0
      ? `${Math.round((coverage.dpu_nonempty_pages / coverage.dpu_page_count) * 100)}%`
      : null;

  const isLow = (coverage.text_coverage_pct !== null && coverage.text_coverage_pct < 60) ||
    (coverage.dpu_nonempty_pages !== null && coverage.dpu_page_count !== null &&
      coverage.dpu_page_count > 0 && coverage.dpu_nonempty_pages / coverage.dpu_page_count < 0.6);

  return (
    <div data-testid="rv-coverage-tiles">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CoverageTile
          label="Documents"
          value={coverage.docs_count !== null ? String(coverage.docs_count) : null}
          darkMode={darkMode}
        />
        <CoverageTile
          label="Total Pages"
          value={coverage.dpu_page_count !== null ? String(coverage.dpu_page_count) : null}
          darkMode={darkMode}
        />
        <CoverageTile
          label="Text Coverage"
          value={pagesPct}
          darkMode={darkMode}
        />
        <CoverageTile
          label="Evidence Count"
          value={coverage.evidence_count !== null ? String(coverage.evidence_count) : null}
          darkMode={darkMode}
        />
      </div>

      {isLow && (
        <div
          className={`mt-3 rounded-lg border p-3 flex items-start gap-2 ${
            darkMode ? 'border-amber-500/25 bg-amber-500/8' : 'border-amber-200 bg-amber-50'
          }`}
          data-testid="rv-low-coverage-callout"
        >
          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
            darkMode ? 'text-amber-400' : 'text-amber-600'
          }`} />
          <p className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
            Low text coverage — key terms and disclosures may be missing from unscannable or image-only pages.
            Request source files with embedded text or OCR-processed versions.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Governed Narrative Panel
// ─────────────────────────────────────────────────────────────────────────────

function NarrativePanel({
  status,
  narrative,
  error,
  onRefresh,
  darkMode,
}: {
  status: string;
  narrative: RiskVerificationNarrativeResult | null;
  error: string | null;
  onRefresh: () => void;
  darkMode: boolean;
}) {
  const headerClass = `text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
    darkMode ? 'text-indigo-400' : 'text-indigo-600'
  }`;
  const panelClass = `rounded-xl border p-4 ${
    darkMode ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50/60 border-indigo-100'
  }`;

  if (status === 'loading') {
    return (
      <div className={panelClass} data-testid="rv-narrative-loading">
        <p className={`${headerClass} mb-3`}>
          <Sparkles className="w-3.5 h-3.5" /> Risk & Verification Summary
        </p>
        <div className="space-y-2 animate-pulse">
          {[80, 60, 70].map((w) => (
            <div
              key={w}
              className={`h-3 rounded ${darkMode ? 'bg-white/10' : 'bg-indigo-100'}`}
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={panelClass} data-testid="rv-narrative-error">
        <p className={`${headerClass} mb-3`}>
          <Sparkles className="w-3.5 h-3.5" /> Risk & Verification Summary
        </p>
        <div className={`flex items-start gap-2 text-xs rounded-lg border p-3 mb-3 ${
          darkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error ?? 'Narrative synthesis failed.'}</span>
        </div>
        <button
          onClick={onRefresh}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-300 hover:bg-white/5'
              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
          data-testid="rv-narrative-retry-btn"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (status === 'ready' && narrative) {
    return (
      <div className={panelClass} data-testid="rv-narrative-panel">
        <div className="flex items-center justify-between mb-3">
          <p className={headerClass}>
            <Sparkles className="w-3.5 h-3.5" /> Risk & Verification Summary
          </p>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              darkMode
                ? 'bg-indigo-500/20 text-indigo-300'
                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}>
              AI Governed
            </span>
            <button
              onClick={onRefresh}
              title="Regenerate narrative"
              className={`p-1 rounded transition-colors ${
                darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600'
              }`}
              data-testid="rv-narrative-refresh-btn"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Summary paragraphs */}
        <div className="space-y-2 mb-4">
          {narrative.summary_paragraphs.map((p, i) => (
            <p
              key={i}
              className={`text-sm leading-relaxed ${darkMode ? 'text-zinc-100' : 'text-slate-700'}`}
              data-testid="rv-narrative-paragraph"
            >
              {p}
            </p>
          ))}
        </div>

        {/* Top risks + Verification requests */}
        {(narrative.top_risks.length > 0 || narrative.verification_requests.length > 0) && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t ${
            darkMode ? 'border-white/8' : 'border-indigo-100'
          }`}>
            {narrative.top_risks.length > 0 && (
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  darkMode ? 'text-red-400' : 'text-red-600'
                }`}>
                  Top Risks
                </p>
                <ul className="space-y-1">
                  {narrative.top_risks.map((r, i) => (
                    <li
                      key={i}
                      className={`text-xs leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}
                    >
                      • {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {narrative.verification_requests.length > 0 && (
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  darkMode ? 'text-indigo-400' : 'text-indigo-600'
                }`}>
                  Verification Requests
                </p>
                <ul className="space-y-1">
                  {narrative.verification_requests.map((v, i) => (
                    <li
                      key={i}
                      className={`text-xs leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}
                    >
                      • {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// No-data fallback
// ─────────────────────────────────────────────────────────────────────────────

function NoDataFallback({ darkMode }: { darkMode: boolean }) {
  return (
    <div
      className={`rounded-lg border p-6 text-center ${
        darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
      }`}
      data-testid="rv-no-data"
    >
      <ShieldAlert className={`w-8 h-8 mx-auto mb-3 ${darkMode ? 'text-zinc-600' : 'text-slate-300'}`} />
      <p className={`text-sm font-medium ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
        No risk & verification signals found
      </p>
      <p className={`text-xs mt-1 ${darkMode ? 'text-zinc-600' : 'text-slate-400'}`}>
        Gate results and verification sections are not yet available in this report.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function RiskSkeleton({ darkMode }: { darkMode: boolean }) {
  const base = darkMode ? 'bg-white/8' : 'bg-slate-200';
  return (
    <div className="space-y-6 animate-pulse" data-testid="rv-loading-skeleton">
      <div className={`h-24 rounded-xl ${base}`} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={`h-16 rounded-lg ${base}`} />
        ))}
      </div>
      <div className={`h-32 rounded-lg ${base}`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RiskVerificationSection
 *
 * Renders inside InvestorReportView's "Risk & Verification" ReportSection.
 * Always embedded (the outer heading is provided by ReportSection).
 *
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
export function RiskVerificationSection({
  dealId,
  report,
  darkMode = false,
  dealName,
}: RiskVerificationSectionProps) {
  const {
    hasData,
    sections,
    riskScore,
    riskLabel,
    confidenceLabel,
    keyRisks,
    narrativeStatus,
    narrative,
    narrativeError,
    refreshNarrative,
  } = useRiskVerification(dealId, report, dealName);

  // When report hasn't arrived yet, show skeleton
  if (report === null) {
    return <RiskSkeleton darkMode={darkMode} />;
  }

  // No risk sections in this report
  if (!hasData) {
    return <NoDataFallback darkMode={darkMode} />;
  }

  return (
    <div className="space-y-6" data-testid="rv-analysis-card">
      {/* Sub-header */}
      <div>
        <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          Gate results, disclosure completeness, data conflicts, and coverage quality
        </p>
      </div>

      {/* A. Risk Score panel */}
      <ScorePanel
        score={riskScore}
        label={riskLabel}
        confidenceLabel={confidenceLabel}
        darkMode={darkMode}
      />

      {/* B. Verification Checklist (gates) */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Readiness Gates
        </h4>
        <GateChecklist gates={sections.gates} darkMode={darkMode} />
      </div>

      {/* C. Key Risks */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Key Risk Signals
        </h4>
        <KeyRisksPanel keyRisks={keyRisks} darkMode={darkMode} />
      </div>

      {/* D. Conflicts */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Data Conflicts
        </h4>
        <ConflictsPanel conflicts={sections.conflicts} darkMode={darkMode} />
      </div>

      {/* E. Coverage tiles */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Document Coverage
        </h4>
        <CoverageTiles coverage={sections.coverage} darkMode={darkMode} />
      </div>

      {/* F. AI Governed narrative */}
      {narrativeStatus !== 'idle' && (
        <NarrativePanel
          status={narrativeStatus}
          narrative={narrative}
          error={narrativeError}
          onRefresh={refreshNarrative}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}
