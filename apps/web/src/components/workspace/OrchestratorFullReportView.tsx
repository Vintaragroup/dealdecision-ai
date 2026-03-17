/**
 * OrchestratorFullReportView
 *
 * Composes the full AI Analysis investor report from existing analysis components.
 * This component owns the data-fetching lifecycle for a deal's investor report
 * and replaces the `if (dealId)` inline block that previously lived in AnalysisTab.
 *
 * Sections rendered in order:
 *   1. decision-overlay    → DecisionOverlay
 *   2. executive-summary   → GovernedExecutiveSummarySection (inline copy)
 *   3. deal-terms          → DealTermsCard (embedded)
 *   4. market-analysis     → MarketAnalysisCard (embedded)
 *   5. financial-analysis  → FinancialAnalysisSection
 *   6. risk-verification   → RiskVerificationSection
 *   7. evidence-appendix   → inline, from OrchestratorReportV1 data
 *
 * Design constraints:
 *   - Does NOT modify InvestorInsightsTab.tsx
 *   - Pure composition: delegates all rendering to existing analysis components
 *   - The GovernedExecutiveSummarySection parser/renderer is copied inline because
 *     it is not exported from InvestorReportView.tsx
 */

import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  FileText,
  DollarSign,
  TrendingUp,
  Scale,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  RefreshCw,
  Zap,
  AlertCircle,
  Sparkles,
  Download,
} from 'lucide-react';
import type {
  InvestorInsightsSection,
  InvestorInsightsReport,
  OrchestratorReportResponse,
} from '../../lib/apiClient';
import {
  apiRegenerateInvestorInsights,
  apiGetDealReadiness,
} from '../../lib/apiClient';
import { useInvestorInsights } from '../../hooks/useInvestorInsights';
import { useOrchestratorReport, type UseOrchestratorReportStatus } from '../../hooks/useOrchestratorReport';
import { Button } from '../ui/button';
import { EmptyFallback } from './InvestorInsightsTab';
import { DecisionOverlay } from './analysis/DecisionOverlay';
import { DealTermsCard } from './DealTermsCard';
import { MarketAnalysisCard } from './MarketAnalysisCard';
import { FinancialAnalysisSection } from './analysis/FinancialAnalysisSection';
import { RiskVerificationSection } from './analysis/RiskVerificationSection';
import { DocumentReadinessCard } from './analysis/DocumentReadinessCard';
import { ExportReportModal } from '../ExportReportModal';
import type { ReportSectionKey } from '../deals/analysis/ReportViewConfigModal';
import { parseGovernedSummaryBody } from './investorInsightsUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorFullReportViewProps {
  dealId: string | undefined;
  darkMode?: boolean;
  /** Optional display name used in the header subtitle. */
  dealName?: string;
  /** Optional callback to trigger the backend analysis job before regenerating. */
  onRunAnalysis?: () => Promise<void> | void;
  /**
   * When "export", automatically opens the Export Report modal once the report is ready.
   * Defaults to "none".
   */
  initialAction?: 'none' | 'export';
  /**
   * Restrict which report sections are rendered. When omitted (or empty) all sections
   * are shown. Controlled by the ReportViewConfigModal upstream.
   */
  visibleSections?: ReportSectionKey[];
  /**
   * Pre-fetched orchestrator report from a parent that already called
   * useOrchestratorReport(dealId). When provided, the internal hook call
   * is bypassed to avoid a redundant GET /orchestrator-report request.
   */
  orchestratorReport?: OrchestratorReportResponse | null;
  orchestratorStatus?: UseOrchestratorReportStatus;
  onRefreshOrchestrator?: () => Promise<OrchestratorReportResponse | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Governed Executive Summary V1 — inline types + parser
// (not exported from InvestorReportView — duplicated here intentionally)
// ─────────────────────────────────────────────────────────────────────────────

interface GovernedExecutiveSummaryV1 {
  schema_version: 'governed_executive_summary_v1';
  headline: string;
  /** @deprecated — omitted in new LLM contract; rendered if present in older cached records. */
  one_liner?: string;
  /** Primary paragraph array (new contract). */
  summary_paragraphs?: string[];
  /** @deprecated — backward compat for records generated before summary_paragraphs. */
  paragraphs?: string[];
  strengths: string[];
  risks: string[];
  open_questions: string[];
  coverage_note: string;
  validated: boolean;
}

function parseGovernedExecSummaryBody(body: string): GovernedExecutiveSummaryV1 | null {
  const delimiter = '---governed_executive_summary_v1_json---\n';
  const idx = body.indexOf(delimiter);
  if (idx === -1) return null;
  try {
    const json = body.slice(idx + delimiter.length).trim();
    const parsed = JSON.parse(json) as GovernedExecutiveSummaryV1;
    if (parsed?.schema_version !== 'governed_executive_summary_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BulletList — small helper (matches style from InvestorReportView)
// ─────────────────────────────────────────────────────────────────────────────

function BulletList({
  items,
  accent,
  darkMode,
}: {
  items: string[];
  accent: string;
  darkMode: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${accent}`} />
          <span
            className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
          >
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernedExecutiveSummarySection — inline renderer
// ─────────────────────────────────────────────────────────────────────────────

function GovernedExecutiveSummarySection({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
}) {
  const body = typeof section.body === 'string' ? section.body : '';
  const parsed = parseGovernedExecSummaryBody(body);

  if (!parsed) {
    return (
      <EmptyFallback
        text="Executive summary could not be parsed. Regenerate Investor Insights to rebuild."
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Provenance badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
            darkMode
              ? 'border-[#6366f1]/30 bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'border-[#6366f1]/25 bg-[#6366f1]/8 text-[#6366f1]'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          AI Governed
        </span>
        {parsed.validated && (
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              darkMode ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Numeric-parity validated
          </span>
        )}
      </div>

      {/* Headline + optional one-liner */}
      <div>
        <h4
          className={`text-base font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}
        >
          {parsed.headline}
        </h4>
        {parsed.one_liner && (
          <p className={`text-sm italic ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {parsed.one_liner}
          </p>
        )}
      </div>

      {/* Narrative paragraphs */}
      {((parsed.summary_paragraphs ?? parsed.paragraphs) ?? []).length > 0 && (
        <div className="space-y-3">
          {((parsed.summary_paragraphs ?? parsed.paragraphs) ?? []).map((para, i) => (
            <p
              key={i}
              className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
            >
              {para}
            </p>
          ))}
        </div>
      )}

      {/* Three-column grid: Strengths / Risks / Open Questions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {parsed.strengths.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-emerald-500/25 bg-emerald-500/8'
                : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-emerald-400' : 'text-emerald-700'
              }`}
            >
              Strengths
            </p>
            <BulletList
              items={parsed.strengths}
              accent={darkMode ? 'bg-emerald-400' : 'bg-emerald-500'}
              darkMode={darkMode}
            />
          </div>
        )}

        {parsed.risks.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-red-500/25 bg-red-500/8'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-red-400' : 'text-red-700'
              }`}
            >
              Risks
            </p>
            <BulletList
              items={parsed.risks}
              accent={darkMode ? 'bg-red-400' : 'bg-red-500'}
              darkMode={darkMode}
            />
          </div>
        )}

        {parsed.open_questions.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-amber-500/25 bg-amber-500/8'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-amber-400' : 'text-amber-700'
              }`}
            >
              Open Questions
            </p>
            <BulletList
              items={parsed.open_questions}
              accent={darkMode ? 'bg-amber-400' : 'bg-amber-500'}
              darkMode={darkMode}
            />
          </div>
        )}
      </div>

      {/* Coverage note */}
      {parsed.coverage_note && (
        <p
          className={`text-xs border-t pt-3 ${
            darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
          }`}
        >
          {parsed.coverage_note}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GovernedSummaryBlock — inline renderer for governed_summary_v1
// (PR36.6A: this section is Report-only; excluded from InvestorInsightsTab)
// ─────────────────────────────────────────────────────────────────────────────

function GovernedSummaryBlock({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
}) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data = parseGovernedSummaryBody(body);

  if (!data) {
    return (
      <EmptyFallback
        text="AI-Governed Investment Summary could not be parsed. Regenerate Investor Insights to rebuild."
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Provenance badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
            darkMode
              ? 'border-[#6366f1]/30 bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'border-[#6366f1]/25 bg-[#6366f1]/8 text-[#6366f1]'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          AI Governed
        </span>
        {data.validated && (
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              darkMode ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Numeric-parity validated
          </span>
        )}
      </div>

      {/* Executive summary paragraph */}
      {data.executive_summary && (
        <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {data.executive_summary}
        </p>
      )}

      {/* Three-column grid: Strengths / Risks / Open Questions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.strengths.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-emerald-500/25 bg-emerald-500/8'
                : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-emerald-400' : 'text-emerald-700'
              }`}
            >
              Strengths
            </p>
            <BulletList
              items={data.strengths}
              accent={darkMode ? 'bg-emerald-400' : 'bg-emerald-500'}
              darkMode={darkMode}
            />
          </div>
        )}

        {data.risks.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-red-500/25 bg-red-500/8'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-red-400' : 'text-red-700'
              }`}
            >
              Risks
            </p>
            <BulletList
              items={data.risks}
              accent={darkMode ? 'bg-red-400' : 'bg-red-500'}
              darkMode={darkMode}
            />
          </div>
        )}

        {data.open_questions.length > 0 && (
          <div
            className={`rounded-lg border p-4 ${
              darkMode
                ? 'border-amber-500/25 bg-amber-500/8'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                darkMode ? 'text-amber-400' : 'text-amber-700'
              }`}
            >
              Open Questions
            </p>
            <BulletList
              items={data.open_questions}
              accent={darkMode ? 'bg-amber-400' : 'bg-amber-500'}
              darkMode={darkMode}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionWrapper — mirrors ReportSection from InvestorReportView
// ─────────────────────────────────────────────────────────────────────────────

function SectionWrapper({
  id,
  title,
  icon: Icon,
  darkMode,
  children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  darkMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div
        className={`flex items-center gap-2.5 mb-4 pb-3 border-b ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
          }`}
        >
          <Icon className="w-4 h-4 text-[#6366f1]" />
        </div>
        <h3
          className={`text-base font-semibold tracking-tight ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}
        >
          {title}
        </h3>
      </div>
      <div>{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function findSection(
  sections: InvestorInsightsSection[],
  key: string,
): InvestorInsightsSection | undefined {
  return sections.find((s) => s.key === key);
}

function bandColorClass(band: string, darkMode: boolean): string {
  switch (band) {
    case 'Strong':
      return darkMode ? 'text-emerald-400' : 'text-emerald-700';
    case 'Good':
      return darkMode ? 'text-blue-400' : 'text-blue-700';
    case 'Partial':
      return darkMode ? 'text-amber-400' : 'text-amber-700';
    case 'Weak':
      return darkMode ? 'text-red-400' : 'text-red-700';
    default:
      return darkMode ? 'text-gray-400' : 'text-gray-600';
  }
}

function MetricRow({
  label,
  value,
  darkMode,
  valueClass,
}: {
  label: string;
  value: string;
  darkMode: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
      <span
        className={`text-xs font-medium tabular-nums ${valueClass ?? (darkMode ? 'text-gray-200' : 'text-gray-800')}`}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EvidenceAppendixSection — built from OrchestratorReportV1 data
// ─────────────────────────────────────────────────────────────────────────────

function EvidenceAppendixSection({
  orchStatus,
  orchData,
  darkMode,
}: {
  orchStatus: ReturnType<typeof useOrchestratorReport>['status'];
  orchData: ReturnType<typeof useOrchestratorReport>['data'];
  darkMode: boolean;
}) {
  if (orchStatus === 'loading' || orchStatus === 'idle') {
    return (
      <div
        className={`rounded-lg border p-4 text-xs ${
          darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
        }`}
      >
        Loading evidence data…
      </div>
    );
  }

  if (orchStatus === 'not_found' || !orchData?.report) {
    return (
      <EmptyFallback
        text="Orchestrator report not available. Run analysis to generate evidence data."
        darkMode={darkMode}
      />
    );
  }

  const report = orchData.report;
  const doc = report.document_confidence;
  const stage = report.stage_context;
  const dataIssues = report.segments?.risk_verification?.data_issues;
  const financialHealth = report.scores.financial_health_score;

  const fmtPct = (n: number | undefined) =>
    n !== undefined ? `${Math.round(n * 100)}%` : '—';

  const cardBase = `rounded-lg border p-4 space-y-2 ${
    darkMode ? 'border-white/10 bg-white/3' : 'border-gray-200 bg-gray-50'
  }`;

  const subHeader = `text-xs font-semibold uppercase tracking-wide mb-2 ${
    darkMode ? 'text-gray-400' : 'text-gray-500'
  }`;

  const divider = `border-t my-2 ${darkMode ? 'border-white/8' : 'border-gray-200'}`;

  return (
    <div className="space-y-4">
      {/* Document Coverage */}
      <div className={cardBase} data-testid="evidence-doc-coverage">
        <p className={subHeader}>Document Coverage</p>
        <div>
          <MetricRow
            label="Confidence score"
            value={`${doc.score} — ${doc.band}`}
            darkMode={darkMode}
            valueClass={bandColorClass(doc.band, darkMode)}
          />
          {doc.section_count !== undefined && (
            <MetricRow
              label="Sections detected"
              value={String(doc.section_count)}
              darkMode={darkMode}
            />
          )}
          {doc.ocr_page_count !== undefined && (
            <MetricRow
              label="OCR pages"
              value={String(doc.ocr_page_count)}
              darkMode={darkMode}
            />
          )}
          {doc.evidence_item_count !== undefined && (
            <MetricRow
              label="Evidence items"
              value={String(doc.evidence_item_count)}
              darkMode={darkMode}
            />
          )}
          {doc.inputs && (
            <>
              <div className={divider} />
              {doc.inputs.text_coverage_pct !== undefined && (
                <MetricRow
                  label="Text coverage"
                  value={fmtPct(doc.inputs.text_coverage_pct)}
                  darkMode={darkMode}
                />
              )}
              {doc.inputs.layout_coverage_pct !== undefined && (
                <MetricRow
                  label="Layout coverage"
                  value={fmtPct(doc.inputs.layout_coverage_pct)}
                  darkMode={darkMode}
                />
              )}
              {doc.inputs.dpu_integrity_score !== undefined && (
                <MetricRow
                  label="DPU integrity"
                  value={fmtPct(doc.inputs.dpu_integrity_score)}
                  darkMode={darkMode}
                />
              )}
              {doc.inputs.expected_pages_total !== undefined && (
                <MetricRow
                  label="Expected pages"
                  value={String(doc.inputs.expected_pages_total)}
                  darkMode={darkMode}
                />
              )}
              {doc.inputs.missing_pages_total !== undefined && doc.inputs.missing_pages_total > 0 && (
                <MetricRow
                  label="Missing pages"
                  value={String(doc.inputs.missing_pages_total)}
                  darkMode={darkMode}
                  valueClass={darkMode ? 'text-amber-400' : 'text-amber-700'}
                />
              )}
            </>
          )}
        </div>
        {doc.notes.length > 0 && (
          <>
            <div className={divider} />
            <ul className="space-y-1">
              {doc.notes.map((note, i) => (
                <li
                  key={i}
                  className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  {note}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Missing Deal Terms */}
      {stage.missing_critical_terms.length > 0 && (
        <div className={cardBase} data-testid="evidence-missing-terms">
          <p className={subHeader}>Missing Deal Terms</p>
          <div className="flex flex-wrap gap-1.5">
            {stage.missing_critical_terms.map((term) => (
              <span
                key={term}
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                  darkMode
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Verification Assessment */}
      {dataIssues && (
        <div className={cardBase} data-testid="evidence-verification">
          <p className={subHeader}>Verification Assessment</p>
          <MetricRow
            label="Coverage"
            value={fmtPct(dataIssues.coverage_pct / 100)}
            darkMode={darkMode}
          />
          <MetricRow
            label="Gates failed"
            value={String(dataIssues.gates_failed)}
            darkMode={darkMode}
            valueClass={
              dataIssues.gates_failed > 0
                ? darkMode
                  ? 'text-red-400'
                  : 'text-red-700'
                : undefined
            }
          />
          {dataIssues.missing_critical_terms.length > 0 && (
            <>
              <div className={divider} />
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Missing critical fields:
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {dataIssues.missing_critical_terms.map((term) => (
                  <span
                    key={term}
                    className={`inline-flex px-2 py-0.5 rounded text-xs border ${
                      darkMode
                        ? 'border-red-500/30 bg-red-500/10 text-red-300'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {term}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Financial Health */}
      {(financialHealth.status === 'insufficient_data' ||
        financialHealth.is_proxy ||
        financialHealth.missing_sections.length > 0) && (
        <div className={cardBase} data-testid="evidence-financial-health">
          <p className={subHeader}>Financial Health Notes</p>
          {financialHealth.is_proxy && (
            <p className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
              Score is a proxy estimate — insufficient direct financials.
            </p>
          )}
          {financialHealth.status === 'insufficient_data' && (
            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Status: insufficient data
            </p>
          )}
          {financialHealth.missing_sections.length > 0 && (
            <>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Missing financial sections:
              </p>
              <ul className="space-y-0.5 mt-1">
                {financialHealth.missing_sections.map((s) => (
                  <li
                    key={s}
                    className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                  >
                    · {s}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OrchestratorFullReportView (main export)
// ─────────────────────────────────────────────────────────────────────────────

export function OrchestratorFullReportView({
  dealId,
  darkMode = false,
  dealName,
  onRunAnalysis,
  initialAction = 'none',
  visibleSections,
  orchestratorReport: orchestratorReportProp,
  orchestratorStatus: orchestratorStatusProp,
}: OrchestratorFullReportViewProps) {
  // Helper: returns true when the section should be rendered.
  // If no explicit list is provided, all sections are visible.
  const sectionVisible = (key: ReportSectionKey) =>
    !visibleSections || visibleSections.length === 0 || visibleSections.includes(key);
  const {
    status: insightStatus,
    report: insightReport,
    error: insightError,
    generate: generateInsights,
    refresh: refreshInsights,
  } = useInvestorInsights(dealId);

  // When a parent already fetched the orchestrator report, reuse it to avoid
  // a duplicate GET /orchestrator-report. Pass undefined to skip the internal fetch.
  const internalOrch = useOrchestratorReport(
    orchestratorReportProp !== undefined ? undefined : dealId
  );
  const orchStatus: UseOrchestratorReportStatus =
    orchestratorReportProp !== undefined
      ? (orchestratorStatusProp ?? (orchestratorReportProp ? 'ready' : 'not_found'))
      : internalOrch.status;
  const orchData =
    orchestratorReportProp !== undefined ? orchestratorReportProp : internalOrch.data;

  // ── Gate 1 DPU preparing-documents state ─────────────────────────────────
  const MAX_POLL_ATTEMPTS = 40;
  type PreparingDocsState = {
    pollAfterMs: number;
    /** Normalised client blocked_reason from the API (e.g. "missing_dpu"). */
    blockedReason: string | null;
    /** DPU rows populated so far (for progress hint). */
    dpuRowsTotal: number;
    /** Total pages expected across all docs (for progress hint). */
    expectedPagesTotal: number;
    /** How many poll cycles have fired. */
    attempts: number;
    /** Set to true when maxAttempts is exhausted — show Retry CTA. */
    timedOut: boolean;
    /**
     * true when a prior render_package already exists for this deal.
     * When set, skip the full-screen spinner and show a non-blocking banner instead.
     */
    hasExistingRenderPackage: boolean;
  };
  const [preparingDocs, setPreparingDocs] = useState<PreparingDocsState | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const autoExportFiredRef = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Poll readiness then re-trigger regenerate once DPU is ready.
  // Uses setInterval with per-activation jitter (±250 ms applied once when the
  // preparing state first activates). Attempts are tracked via a ref so the
  // interval fires unconditionally; after MAX_POLL_ATTEMPTS ticks the interval
  // is cleared and timedOut is set to surface the Retry CTA.
  useEffect(() => {
    if (!preparingDocs || !dealId || preparingDocs.timedOut) return;

    // Sync the ref with the state-tracked attempt count on each effect entry.
    attemptsRef.current = preparingDocs.attempts;

    const baseMs = Math.max(500, preparingDocs.pollAfterMs);
    // ±250 ms jitter applied once per activation — prevents thundering-herd
    // when multiple tabs are open against the same deal.
    const jitter = Math.floor(Math.random() * 500) - 250;
    const pollMs = Math.max(500, baseMs + jitter);

    pollingRef.current = setInterval(() => {
      if (!mountedRef.current) return;

      const attempt = ++attemptsRef.current;
      if (attempt > MAX_POLL_ATTEMPTS) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        setPreparingDocs((prev) => (prev ? { ...prev, timedOut: true } : null));
        return;
      }

      void (async () => {
        if (!mountedRef.current) return;
        try {
          const readiness = await apiGetDealReadiness(dealId, 'page_understanding_v1');
          if (readiness.ready) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            const result = await apiRegenerateInvestorInsights(dealId);
            if (!('status' in result && result.status === 'preparing_documents')) {
              if (mountedRef.current) {
                setPreparingDocs(null);
                void refreshInsights();
              }
            }
          }
        } catch {
          // ignore transient poll errors — keep polling
        }
      })();
    }, pollMs);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [preparingDocs, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-open export modal when initialAction="export" and report is ready ─
  useEffect(() => {
    if (initialAction !== 'export') {
      // Reset so the next 'export' open can fire
      autoExportFiredRef.current = false;
      return;
    }
    if (autoExportFiredRef.current) return;
    if (insightStatus === 'ready' && insightReport && insightReport.status !== 'not_started') {
      autoExportFiredRef.current = true;
      setShowExportModal(true);
    }
  }, [initialAction, insightStatus, insightReport]);

  // ── Preparing Documents (Gate 1 DPU backfill in progress) ─────────────────
  // handleRetry is hoisted outside the early-return so it can be referenced
  // by both the full-screen spinner path and the soft-banner path.
  const handlePreparingRetry = async () => {
    if (!dealId) return;
    setPreparingDocs(null);
    const result = await apiRegenerateInvestorInsights(dealId);
    if ('status' in result && result.status === 'preparing_documents') {
      setPreparingDocs({
        pollAfterMs: result.poll_after_ms ?? 1500,
        blockedReason: result.blocked_reason ?? null,
        dpuRowsTotal: result.dpu_rows_total ?? 0,
        expectedPagesTotal: result.expected_pages_total ?? 0,
        attempts: 0,
        timedOut: false,
        hasExistingRenderPackage: result.has_existing_render_package ?? false,
      });
    } else {
      void refreshInsights();
    }
  };

  // Full-screen spinner only when there is no existing report to fall back on.
  if (preparingDocs && !preparingDocs.hasExistingRenderPackage) {
    const { blockedReason, dpuRowsTotal, expectedPagesTotal, timedOut } = preparingDocs;
    const handleRetry = handlePreparingRetry;

    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="preparing-documents-state"
      >
        <div className="text-center max-w-sm">
          {!timedOut && (
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 border-4 border-[#6366f1]/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-[#6366f1] rounded-full border-t-transparent animate-spin" />
              <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-[#6366f1]" />
            </div>
          )}
          <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {timedOut ? 'Still preparing…' : 'Preparing Documents…'}
          </h3>
          <p className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {timedOut
              ? 'Document understanding is taking longer than expected.'
              : 'Building document understanding. This may take a moment.'}
          </p>
          {blockedReason && (
            <p
              className={`text-xs mb-2 font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
              data-testid="preparing-docs-reason"
            >
              {blockedReason}
            </p>
          )}
          {expectedPagesTotal > 0 && (
            <p
              className={`text-xs mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
              data-testid="preparing-docs-progress"
            >
              {dpuRowsTotal} / {expectedPagesTotal} pages processed
            </p>
          )}
          {timedOut && (
            <button
              type="button"
              className="mt-2 px-4 py-2 rounded-md bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f46e5] transition-colors"
              data-testid="preparing-docs-retry"
              onClick={() => void handleRetry()}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (insightStatus === 'loading' || insightStatus === 'idle') {
    return (
      <div className="flex items-center justify-center h-full" data-testid="orchestrator-full-loading">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div className="absolute inset-0 border-4 border-[#6366f1]/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-[#6366f1] rounded-full border-t-transparent animate-spin" />
            <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-[#6366f1]" />
          </div>
          <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Loading Investor Report…
          </h3>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Fetching deal analysis and verification data
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (insightStatus === 'error') {
    return (
      <div className="space-y-4 p-6" data-testid="orchestrator-full-error">
        <div
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
          }`}
        >
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-red-200' : 'text-red-800'}`}>
              Failed to load investor report
            </p>
            {insightError && (
              <p
                className={`text-xs mt-0.5 ${darkMode ? 'text-red-300/80' : 'text-red-700/70'}`}
              >
                {insightError}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          darkMode={darkMode}
          onClick={() => void refreshInsights()}
          icon={<RefreshCw className="w-4 h-4" />}
        >
          Retry
        </Button>
      </div>
    );
  }

  // ── Not started ────────────────────────────────────────────────────────────
  const isNotStarted =
    insightStatus === 'ready' && (!insightReport || insightReport.status === 'not_started');

  if (isNotStarted || !insightReport) {
    return (
      <div className="space-y-4 p-6" data-testid="orchestrator-full-not-started">
        <div
          className={`text-center py-12 rounded-xl border-2 border-dashed ${
            darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
          }`}
        >
          <Sparkles
            className={`w-10 h-10 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`}
          />
          <h4
            className={`text-sm font-semibold mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
          >
            Investor report not generated yet
          </h4>
          <p className={`text-xs mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Generate insights to see the full due-diligence report.
          </p>
          <Button
            size="sm"
            variant="primary"
            darkMode={darkMode}
            icon={<Zap className="w-3.5 h-3.5" />}
            onClick={async () => {
              if (!dealId) { void generateInsights(); return; }
              const result = await apiRegenerateInvestorInsights(dealId);
              if ('status' in result && result.status === 'preparing_documents') {
                setPreparingDocs({
                  pollAfterMs: result.poll_after_ms ?? 1500,
                  blockedReason: result.blocked_reason ?? null,
                  dpuRowsTotal: result.dpu_rows_total ?? 0,
                  expectedPagesTotal: result.expected_pages_total ?? 0,
                  attempts: 0,
                  timedOut: false,
                  hasExistingRenderPackage: result.has_existing_render_package ?? false,
                });
              } else {
                void refreshInsights();
              }
            }}
          >
            Generate Report
          </Button>
        </div>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  const rawSections: InvestorInsightsSection[] =
    insightReport.render_package?.sections ?? [];

  const execSummarySection = findSection(rawSections, 'governed_executive_summary_v1');
  // PR36.6A: governed_summary_v1 is Report-only (excluded from InvestorInsightsTab via REPORT_SUMMARY_KEYS)
  const governedSummarySection = findSection(rawSections, 'governed_summary_v1');

  const companyLabel = dealName ?? 'this deal';

  return (
    <div className="space-y-4" data-testid="orchestrator-full-report">
      {/* ── Soft banner: DPU still processing but existing report is available ── */}
      {preparingDocs?.hasExistingRenderPackage && (
        <div
          className={`mx-6 mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
            darkMode
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
          data-testid="preparing-docs-banner"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <span className="font-medium">Document processing in progress</span>
            {' \u2014 '}this report may be incomplete until all pages are analyzed.
            {preparingDocs.blockedReason && (
              <span className="ml-1 font-mono opacity-60 text-xs">({preparingDocs.blockedReason})</span>
            )}
            {preparingDocs.timedOut && (
              <button
                type="button"
                className="ml-2 underline hover:no-underline text-xs"
                onClick={() => void handlePreparingRetry()}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            AI Analysis
          </h2>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Investor report for {companyLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            darkMode={darkMode}
            disabled={insightStatus !== 'ready' || !insightReport || insightReport.status === 'not_started'}
            onClick={() => setShowExportModal(true)}
            icon={<Download className="w-4 h-4" />}
          >
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            darkMode={darkMode}
            onClick={() => void refreshInsights()}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </Button>
          <Button
            variant={darkMode ? 'secondary' : 'outline'}
            size="sm"
            darkMode={darkMode}
            icon={<Zap className="w-4 h-4" />}
            onClick={async () => {
              if (!dealId) return;
              if (onRunAnalysis) await onRunAnalysis();
              const result = await apiRegenerateInvestorInsights(dealId);
              if ('status' in result && result.status === 'preparing_documents') {
                setPreparingDocs({
                  pollAfterMs: result.poll_after_ms ?? 1500,
                  blockedReason: result.blocked_reason ?? null,
                  dpuRowsTotal: result.dpu_rows_total ?? 0,
                  expectedPagesTotal: result.expected_pages_total ?? 0,
                  attempts: 0,
                  timedOut: false,
                  hasExistingRenderPackage: result.has_existing_render_package ?? false,
                });
              } else {
                void refreshInsights();
              }
            }}
          >
            Regenerate
          </Button>
        </div>
      </div>

      {/* ── Document Readiness Panel (always shown — system card) ── */}
      {dealId && (
        <DocumentReadinessCard dealId={dealId} darkMode={darkMode} />
      )}

      {/* ── Section 1: Decision Overlay ── */}
      {sectionVisible('decision_overlay') && (
        <section id="section-decision_overlay">
          <DecisionOverlay dealId={dealId} darkMode={darkMode} />
        </section>
      )}

      {/* ── Section 2: Executive Summary ── */}
      {sectionVisible('executive_summary') && (
        <SectionWrapper
          id="section-executive_summary"
          title="Executive Summary"
          icon={FileText}
          darkMode={darkMode}
        >
          {execSummarySection ? (
            <>
              <GovernedExecutiveSummarySection section={execSummarySection} darkMode={darkMode} />
              {governedSummarySection && (
                <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200/70'}`}>
                  <GovernedSummaryBlock section={governedSummarySection} darkMode={darkMode} />
                </div>
              )}
            </>
          ) : governedSummarySection ? (
            <GovernedSummaryBlock section={governedSummarySection} darkMode={darkMode} />
          ) : (
            <EmptyFallback
              text="Executive summary not available. Regenerate to rebuild."
              darkMode={darkMode}
            />
          )}
        </SectionWrapper>
      )}

      {/* ── Section 3: Deal Terms ── */}
      {sectionVisible('deal_terms') && (
        <SectionWrapper id="section-deal_terms" title="Deal Terms" icon={Scale} darkMode={darkMode}>
          {dealId ? (
            <DealTermsCard
              dealId={dealId}
              report={insightReport as InvestorInsightsReport}
              darkMode={darkMode}
              embedded
            />
          ) : (
            <EmptyFallback text="Deal ID required to load deal terms." darkMode={darkMode} />
          )}
        </SectionWrapper>
      )}

      {/* ── Section 4: Market Analysis ── */}
      {sectionVisible('market_analysis') && (
        <SectionWrapper
          id="section-market_analysis"
          title="Market Analysis"
          icon={TrendingUp}
          darkMode={darkMode}
        >
          {dealId ? (
            <MarketAnalysisCard
              dealId={dealId}
              report={insightReport}
              darkMode={darkMode}
              dealName={dealName}
              embedded
            />
          ) : (
            <EmptyFallback text="Deal ID required to load market analysis." darkMode={darkMode} />
          )}
        </SectionWrapper>
      )}

      {/* ── Section 5: Financial Analysis ── */}
      {sectionVisible('financial_analysis') && (
        <SectionWrapper
          id="section-financial_analysis"
          title="Financial Analysis"
          icon={DollarSign}
          darkMode={darkMode}
        >
          <FinancialAnalysisSection
            dealId={dealId}
            report={insightReport}
            darkMode={darkMode}
            dealName={dealName}
          />
        </SectionWrapper>
      )}

      {/* ── Section 6: Risk & Verification ── */}
      {sectionVisible('risk_verification') && (
        <SectionWrapper
          id="section-risk_verification"
          title="Risk & Verification"
          icon={AlertTriangle}
          darkMode={darkMode}
        >
          <RiskVerificationSection
            dealId={dealId}
            report={insightReport}
            darkMode={darkMode}
            dealName={dealName}
          />
        </SectionWrapper>
      )}

      {/* ── Section 7: Evidence Appendix ── */}
      {sectionVisible('evidence_appendix') && (
        <SectionWrapper
          id="section-evidence_appendix"
          title="Evidence Appendix"
          icon={BookOpen}
          darkMode={darkMode}
        >
          <EvidenceAppendixSection
            orchStatus={orchStatus}
            orchData={orchData}
            darkMode={darkMode}
          />
        </SectionWrapper>
      )}

      {/* ── Export Report Modal ── */}
      <ExportReportModal
        isOpen={showExportModal}
        darkMode={darkMode}
        dealName={dealName}
        dealId={dealId}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
