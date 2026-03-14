/**
 * InvestmentQuestionsPanel — "5 Key Investment Questions"
 *
 * Renders directly below the Deal Score, inside the Overview tab.
 * Answers: "Why did this deal receive this score?"
 *
 * Signals used (all deterministic/governed — no LLM calls):
 *   - insightsData.analysis_modules.{market_opportunity, traction_growth, product_technology}
 *   - insightsData.critical_metrics.{market.tam, financial.current_arr}
 *   - insightsData.executive_summary.{top_strengths, top_risks}
 *   - insightsData.deal_signals.{overall_score, confidence_level, recommendation}
 *   - insightsData.completeness_class
 *   - dealScore + scoreBand + snapshotSummary (from score_band_v2 pipeline)
 */

import { TrendingUp, Globe, Cpu, Users, Target } from 'lucide-react';
import {
  deriveInvestmentQuestions,
  completenessClassLabel,
  type InvestorInsightsData,
  type InvestmentQuestion,
  type ReportCompletenessClass,
} from '../../types/investor-insights';

// ─── Status dot colours ───────────────────────────────────────────────────────

const STATUS_DOT: Record<InvestmentQuestion['status'], string> = {
  strong:  'bg-emerald-400',
  partial: 'bg-amber-400',
  limited: 'bg-orange-400',
  missing: 'bg-zinc-500',
};

const STATUS_LABEL: Record<InvestmentQuestion['status'], string> = {
  strong:  'Strong',
  partial: 'Partial',
  limited: 'Limited',
  missing: 'Insufficient',
};

const QUESTION_ICON: Record<InvestmentQuestion['key'], React.ReactNode> = {
  market:    <Globe    className="w-4 h-4" />,
  product:   <Cpu      className="w-4 h-4" />,
  traction:  <TrendingUp className="w-4 h-4" />,
  team:      <Users    className="w-4 h-4" />,
  readiness: <Target   className="w-4 h-4" />,
};

// ─── Completeness class badge colours ─────────────────────────────────────────

function completenessColor(c: ReportCompletenessClass, darkMode: boolean): string {
  const dark: Record<ReportCompletenessClass, string> = {
    full_analysis:    'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    partial_analysis: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    evidence_limited: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    not_generated:    'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  };
  const light: Record<ReportCompletenessClass, string> = {
    full_analysis:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial_analysis: 'bg-amber-50 text-amber-700 border-amber-200',
    evidence_limited: 'bg-orange-50 text-orange-700 border-orange-200',
    not_generated:    'bg-zinc-100 text-zinc-500 border-zinc-200',
  };
  return (darkMode ? dark : light)[c] ?? '';
}

function confidenceColor(conf: string, darkMode: boolean): string {
  if (conf === 'High') return darkMode ? 'text-emerald-300' : 'text-emerald-700';
  if (conf === 'Medium') return darkMode ? 'text-amber-300' : 'text-amber-700';
  return darkMode ? 'text-zinc-400' : 'text-zinc-500';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface InvestmentQuestionsPanelProps {
  darkMode: boolean;
  insightsData: InvestorInsightsData | null;
  /** deal_score from score_band_v2 pipeline (canonical score). */
  dealScore: number | null;
  /** Human-readable band label from score_band_v2, e.g. "Caution". */
  scoreBand: string | null;
  /** Label for the canonical score gauge, e.g. "Deal Score". */
  dealScoreLabel: string;
  /** Snapshot summary from understanding_v1 — one-liner explaining why score landed here. */
  snapshotSummary: string | null;
  /** Confidence from the top-section (derived from score_band_v2 pipeline confidence band). */
  topSectionConfidence: 'High' | 'Medium' | 'Low';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvestmentQuestionsPanel({
  darkMode,
  insightsData,
  dealScore,
  scoreBand,
  dealScoreLabel,
  snapshotSummary,
  topSectionConfidence,
}: InvestmentQuestionsPanelProps) {
  const questions = deriveInvestmentQuestions({ insightsData, dealScore, scoreBand, snapshotSummary });
  const completeness: ReportCompletenessClass = insightsData?.completeness_class ?? 'not_generated';
  const completenessLabel = completenessClassLabel(completeness);

  return (
    <div
      className={`backdrop-blur-xl border rounded-xl w-full overflow-hidden ${
        darkMode
          ? 'bg-white/[0.03] border-white/8'
          : 'bg-white/80 border-gray-200/60'
      }`}
    >
      {/* ── Panel header ── */}
      <div
        className={`px-5 py-4 border-b flex items-center justify-between gap-4 ${
          darkMode ? 'border-white/8' : 'border-gray-100'
        }`}
      >
        <div>
          <h3
            className={`text-sm font-semibold tracking-tight ${
              darkMode ? 'text-white' : 'text-gray-900'
            }`}
          >
            5 Key Investment Questions
          </h3>
          <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Based on extracted evidence from submitted materials
          </p>
        </div>

        {/* Confidence + Analysis Quality badges */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <span
            className={`text-xs font-medium ${confidenceColor(topSectionConfidence, darkMode)}`}
          >
            Confidence: {topSectionConfidence}
          </span>
          <span className={`text-xs ${darkMode ? 'text-zinc-600' : 'text-gray-300'}`}>·</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
              completenessColor(completeness, darkMode)
            }`}
          >
            {completenessLabel}
          </span>
        </div>
      </div>

      {/* ── Question rows ── */}
      <div className={`divide-y ${darkMode ? 'divide-white/5' : 'divide-gray-100'}`}>
        {questions.map((q) => (
          <QuestionRow key={q.key} question={q} darkMode={darkMode} />
        ))}
      </div>
    </div>
  );
}

// ─── Single question row ──────────────────────────────────────────────────────

function QuestionRow({
  question,
  darkMode,
}: {
  question: InvestmentQuestion;
  darkMode: boolean;
}) {
  return (
    <div className="px-5 py-3.5 flex items-start gap-3.5">
      {/* Status dot */}
      <span
        className={`mt-[5px] flex-shrink-0 w-2 h-2 rounded-full ${STATUS_DOT[question.status]}`}
        title={STATUS_LABEL[question.status]}
      />

      {/* Icon + content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {QUESTION_ICON[question.key]}
          </span>
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {question.title}
          </span>
        </div>
        <p
          className={`text-sm leading-relaxed ${
            question.status === 'missing'
              ? (darkMode ? 'text-zinc-500 italic' : 'text-gray-400 italic')
              : (darkMode ? 'text-gray-300' : 'text-gray-700')
          }`}
        >
          {question.answer}
        </p>
      </div>

      {/* Right-side chips */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {question.score !== null && (
          <span
            className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full border ${
              question.score >= 70
                ? (darkMode
                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-200')
                : question.score >= 40
                  ? (darkMode
                      ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                      : 'text-amber-700 bg-amber-50 border-amber-200')
                  : (darkMode
                      ? 'text-red-300 bg-red-500/10 border-red-500/20'
                      : 'text-red-700 bg-red-50 border-red-200')
            }`}
          >
            {question.score}/100
          </span>
        )}
        <span
          className={`text-xs ${
            darkMode ? 'text-gray-600' : 'text-gray-400'
          }`}
        >
          {STATUS_LABEL[question.status]}
        </span>
      </div>
    </div>
  );
}
