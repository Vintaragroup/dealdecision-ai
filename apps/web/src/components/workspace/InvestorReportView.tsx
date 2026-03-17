/**
 * InvestorReportView
 *
 * Renders a professional "Investor Report" layout from the existing
 * InvestorInsights / Due Diligence API payload (render_package.sections).
 *
 * Section mapping (all data comes from the real API – no mocked values):
 *   Executive Summary   → governed_summary_v1
 *   Deal Terms          → canonical_fields (filtered: category = raise_terms)
 *   Market              → canonical_fields (filtered: category = market) + insight_slots market rows
 *   Financials          → financial_statement_v1 / financial_health_metrics_v1 /
 *                         use_of_funds_v1 / implied_capital_allocation_v1 /
 *                         financial_layout_classifier_v1 / financial_reconciliation_v1
 *   Risk / Verification → gate_state failures + conflicts
 *   Appendix            → completeness_summary + coverage_snapshot
 *
 * Reuses section renderers exported from InvestorInsightsTab to avoid duplication.
 */

import { useRef } from 'react';
import {
  Activity,
  FileText,
  DollarSign,
  TrendingUp,
  Scale,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
} from 'lucide-react';
import type { InvestorInsightsReport, InvestorInsightsSection } from '../../lib/apiClient';
import {
  EmptyFallback,
  EvidencePill,
  GovernedSummarySection,
  ConflictsSection,
  GateStateSection,
  CoverageSnapshotSection,
} from './InvestorInsightsTab';
import { fieldLabel, parseCanonicalFieldsBody } from './investorInsightsUtils';
import type { CanonicalFieldRow } from './investorInsightsUtils';
import { DealTermsCard } from './DealTermsCard';
import { MarketAnalysisCard } from './MarketAnalysisCard';
import { FinancialAnalysisSection } from './analysis/FinancialAnalysisSection';
import { RiskVerificationSection } from './analysis/RiskVerificationSection';
import { OrchestratorSummaryCard } from './analysis/OrchestratorSummaryCard';
import { DecisionOverlay } from './analysis/DecisionOverlay';
import { Stack } from '../ui/layout';

// ─────────────────────────────────────────────────────────────────────────────
// Governed Executive Summary V1 — inline types + parser
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
// GovernedExecutiveSummarySection renderer
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
          <span className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

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

      {/* Headline + optional one-liner (deprecated — only rendered for older cached records) */}
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

      {/* Narrative paragraphs — prefer summary_paragraphs, fall back to paragraphs */}
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
        {/* Strengths */}
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

        {/* Risks */}
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

        {/* Open Questions */}
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
            darkMode
              ? 'border-white/10 text-gray-500'
              : 'border-gray-200 text-gray-400'
          }`}
        >
          {parsed.coverage_note}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InvestorReportViewProps {
  report: InvestorInsightsReport;
  darkMode: boolean;
  dealId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: look up a section by key
// ─────────────────────────────────────────────────────────────────────────────

function findSection(
  sections: InvestorInsightsSection[],
  key: string,
): InvestorInsightsSection | undefined {
  return sections.find((s) => s.key === key);
}

/** Finds the first matching section from an ordered list of keys. */
function findFirstSection(
  sections: InvestorInsightsSection[],
  keys: string[],
): InvestorInsightsSection | undefined {
  for (const k of keys) {
    const s = sections.find((s) => s.key === k);
    if (s) return s;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section nav items
// ─────────────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'decision-overlay', label: 'Decision', icon: Activity },
  { id: 'exec-summary', label: 'Executive Summary', icon: FileText },
  { id: 'deal-terms', label: 'Deal Terms', icon: Scale },
  { id: 'orchestrator-summary', label: 'Deal Score', icon: Zap },
  { id: 'market', label: 'Market', icon: TrendingUp },
  { id: 'financials', label: 'Financials', icon: DollarSign },
  { id: 'risk-verification', label: 'Risk & Verification', icon: AlertTriangle },
  { id: 'appendix', label: 'Appendix', icon: BookOpen },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Report section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function ReportSection({
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
// Deal Terms: raise_terms category from canonical_fields
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_TERMS_CATEGORIES = new Set([
  'raise_terms',
  'raise',
  'terms',
  'investment',
  'funding',
]);

function DealTermsSection({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection | undefined;
  darkMode: boolean;
}) {
  if (!section) {
    return <EmptyFallback text="No canonical field data available." darkMode={darkMode} />;
  }

  const body = typeof section.body === 'string' ? section.body : '';
  const allRows = parseCanonicalFieldsBody(body);
  const rows = allRows.filter(
    (r) =>
      DEAL_TERMS_CATEGORIES.has(r.category.toLowerCase()) ||
      r.category.toLowerCase().includes('raise') ||
      r.category.toLowerCase().includes('term'),
  );

  if (rows.length === 0) {
    // Fall back to the first 10 canonical rows if no category matches
    const fallbackRows = allRows.slice(0, 10);
    if (fallbackRows.length === 0) {
      return <EmptyFallback text="No deal term data available." darkMode={darkMode} />;
    }
    return <CanonicalFieldTable rows={fallbackRows} darkMode={darkMode} />;
  }

  return <CanonicalFieldTable rows={rows} darkMode={darkMode} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market: market / tam / growth categories from canonical_fields
// ─────────────────────────────────────────────────────────────────────────────

const MARKET_CATEGORIES = new Set(['market', 'tam', 'growth', 'traction', 'competition']);

function MarketSection({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection | undefined;
  darkMode: boolean;
}) {
  if (!section) {
    return <EmptyFallback text="No market data available." darkMode={darkMode} />;
  }

  const body = typeof section.body === 'string' ? section.body : '';
  const allRows = parseCanonicalFieldsBody(body);
  const rows = allRows.filter(
    (r) =>
      MARKET_CATEGORIES.has(r.category.toLowerCase()) ||
      r.category.toLowerCase().includes('market') ||
      r.category.toLowerCase().includes('revenue') ||
      r.category.toLowerCase().includes('growth') ||
      r.category.toLowerCase().includes('customer'),
  );

  if (rows.length === 0) {
    return <EmptyFallback text="No market-related canonical fields found." darkMode={darkMode} />;
  }

  return <CanonicalFieldTable rows={rows} darkMode={darkMode} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: canonical field table (reused by DealTerms and Market)
// ─────────────────────────────────────────────────────────────────────────────

function CanonicalFieldTable({
  rows,
  darkMode,
}: {
  rows: CanonicalFieldRow[];
  darkMode: boolean;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-lg border ${
        darkMode ? 'border-white/10' : 'border-gray-200'
      }`}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            className={`border-b ${
              darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
            }`}
          >
            {(['Field', 'Value', 'Evidence'] as const).map((col) => (
              <th
                key={col}
                className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isComputable = row.computability === 'Computable';
            return (
              <tr
                key={`${row.category}-${row.field}-${idx}`}
                className={`border-b last:border-0 ${
                  darkMode
                    ? 'border-white/5 hover:bg-white/5'
                    : 'border-gray-100 hover:bg-gray-50/50'
                }`}
              >
                {/* Field */}
                <td
                  className={`px-4 py-3 font-medium text-sm whitespace-nowrap ${
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  {fieldLabel(row.field)}
                </td>
                {/* Value */}
                <td
                  className={`px-4 py-3 text-sm ${
                    isComputable
                      ? darkMode
                        ? 'text-gray-200'
                        : 'text-gray-800'
                      : darkMode
                      ? 'text-gray-500 italic'
                      : 'text-gray-400 italic'
                  }`}
                >
                  {row.value ?? (
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>—</span>
                  )}
                </td>
                {/* Evidence */}
                <td className="px-4 py-3 text-xs">
                  {row.evidence ? (
                    <EvidencePill evidenceRef={row.evidence} darkMode={darkMode} />
                  ) : (
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Financials: message-type sections for financial data
// ─────────────────────────────────────────────────────────────────────────────

const FINANCIAL_SECTION_KEYS = [
  'financial_layout_classifier_v1',
  'financial_statement_v1',
  'financial_health_metrics_v1',
  'use_of_funds_v1',
  'implied_capital_allocation_v1',
  'financial_reconciliation_v1',
] as const;

function FinancialMessageCard({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
}) {
  const body =
    typeof section.body === 'string' && section.body.trim().length > 0
      ? section.body
      : section.fallback ?? null;

  if (!body) return null;

  return (
    <div
      className={`rounded-lg border p-4 ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
          darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'
        }`}
      >
        {section.title}
      </p>
      <pre
        className={`text-sm leading-relaxed whitespace-pre-wrap font-sans ${
          darkMode ? 'text-gray-300' : 'text-gray-700'
        }`}
      >
        {body}
      </pre>
    </div>
  );
}

function FinancialsSection({
  sections,
  darkMode,
}: {
  sections: InvestorInsightsSection[];
  darkMode: boolean;
}) {
  const financial = FINANCIAL_SECTION_KEYS.map((key) =>
    sections.find((s) => s.key === key),
  ).filter((s): s is InvestorInsightsSection => s !== undefined);

  if (financial.length === 0) {
    return (
      <EmptyFallback
        text="Financial analysis sections not yet generated."
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className="space-y-4">
      {financial.map((s) => (
        <FinancialMessageCard key={s.key} section={s} darkMode={darkMode} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk & Verification: gate_state failures + conflicts
// ─────────────────────────────────────────────────────────────────────────────

/** Shows only failed gates from gate_state section. */
function GateFailureTable({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection | undefined;
  darkMode: boolean;
}) {
  if (!section) return null;
  // Inject gate results from render_package so GateStateSection renders correctly.
  // (Already handled upstream if caller passes the injected section.)
  const items = (section.items ?? []) as Array<{
    gate: string;
    passed: boolean;
    reason_code?: string;
  }>;
  const failed = items.filter((g) => !g.passed);

  if (failed.length === 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-4 py-3 ${
          darkMode
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-emerald-50 border-emerald-200'
        }`}
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <p
          className={`text-sm font-medium ${
            darkMode ? 'text-emerald-200' : 'text-emerald-800'
          }`}
        >
          All gates passed — no blocking issues found.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 ${
          darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
        }`}
      >
        <XCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
        <p
          className={`text-xs font-medium ${darkMode ? 'text-red-300' : 'text-red-800'}`}
        >
          {failed.length} gate{failed.length > 1 ? 's' : ''} failed — review before proceeding.
        </p>
      </div>
      <GateStateSection section={section} darkMode={darkMode} />
    </div>
  );
}

function RiskAndVerificationSection({
  sections,
  gateResultsFromPkg,
  darkMode,
}: {
  sections: InvestorInsightsSection[];
  gateResultsFromPkg: Array<{ gate: string; passed: boolean; reason_code?: string }> | null;
  darkMode: boolean;
}) {
  const gateSection = sections.find((s) => s.key === 'gate_state');
  const conflictsSection = sections.find((s) => s.key === 'conflicts');

  // Inject real gate results into section if available (mirrors InvestorInsightsTab logic)
  const patchedGateSection =
    gateSection && gateResultsFromPkg
      ? { ...gateSection, items: gateResultsFromPkg }
      : gateSection;

  const hasAnything = patchedGateSection || conflictsSection;

  if (!hasAnything) {
    return (
      <EmptyFallback
        text="No risk or verification data available."
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Gate verification */}
      {patchedGateSection && (
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Key Verification Checklist
          </p>
          <GateFailureTable section={patchedGateSection} darkMode={darkMode} />
        </div>
      )}

      {/* Conflicts */}
      {conflictsSection && (
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Data Conflicts
          </p>
          <ConflictsSection section={conflictsSection} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Appendix: completeness_summary + coverage_snapshot
// ─────────────────────────────────────────────────────────────────────────────

function AppendixSection({
  sections,
  darkMode,
}: {
  sections: InvestorInsightsSection[];
  darkMode: boolean;
}) {
  const completenessSection = sections.find((s) => s.key === 'completeness_summary');
  const coverageSection = sections.find((s) => s.key === 'coverage_snapshot');

  if (!completenessSection && !coverageSection) {
    return (
      <EmptyFallback
        text="No appendix data available."
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className="space-y-6">
      {completenessSection && (
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Data Completeness
          </p>
          {/* Reuse a simple key:value table for completeness rows */}
          <CompletenessTable section={completenessSection} darkMode={darkMode} />
        </div>
      )}
      {coverageSection && (
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Coverage Snapshot
          </p>
          <CoverageSnapshotSection section={coverageSection} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}

/** Minimal inline completeness table (avoids re-importing the private one from InvestorInsightsTab). */
function CompletenessTable({
  section,
  darkMode,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
}) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return [] as Array<{ category: string; status: string }>;
      return [{ category: line.slice(0, idx).trim(), status: line.slice(idx + 1).trim() }];
    });

  if (rows.length === 0) {
    return (
      <EmptyFallback
        text={section.fallback ?? 'No completeness data.'}
        darkMode={darkMode}
      />
    );
  }

  const getStatusStyle = (status: string) => {
    if (status === 'Present')
      return darkMode
        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700';
    if (status === 'Conflicting')
      return darkMode
        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
        : 'bg-amber-50 border-amber-200 text-amber-700';
    return darkMode
      ? 'bg-white/5 border-white/15 text-gray-400'
      : 'bg-gray-100 border-gray-200 text-gray-500';
  };

  return (
    <div
      className={`overflow-x-auto rounded-lg border ${
        darkMode ? 'border-white/10' : 'border-gray-200'
      }`}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            className={`border-b ${
              darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <th
              className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Category
            </th>
            <th
              className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className={`border-b last:border-0 ${
                darkMode
                  ? 'border-white/5 hover:bg-white/5'
                  : 'border-gray-100 hover:bg-gray-50/50'
              }`}
            >
              <td
                className={`px-4 py-3 font-medium text-sm ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}
              >
                {fieldLabel(row.category)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusStyle(
                    row.status,
                  )}`}
                >
                  {row.status === 'Present' && (
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                  )}
                  {row.status === 'Conflicting' && (
                    <AlertCircle className="w-3 h-3 shrink-0" />
                  )}
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Report meta bar (status + timestamps)
// ─────────────────────────────────────────────────────────────────────────────

function ReportMetaBar({
  report,
  darkMode,
  hasGovernedExecSummary,
}: {
  report: InvestorInsightsReport;
  darkMode: boolean;
  /** When true, display provenance as 'AI Governed' rather than the raw engine status. */
  hasGovernedExecSummary?: boolean;
}) {
  const rawStatus = report.status;
  // Surface a user-readable provenance label.
  // 'deterministic_only' is an internal engine stage label — when the AI-governed
  // executive summary is present, show 'AI Governed' instead.
  const statusLabel = hasGovernedExecSummary
    ? 'AI Governed'
    : rawStatus === 'deterministic_only'
    ? 'Deterministic Only'
    : rawStatus ?? 'loading';
  const statusColor =
    hasGovernedExecSummary || rawStatus === 'complete'
      ? darkMode
        ? 'bg-[#6366f1]/15 border-[#6366f1]/30 text-[#a5b4fc]'
        : 'bg-[#6366f1]/8 border-[#6366f1]/25 text-[#6366f1]'
      : rawStatus === 'failed'
      ? darkMode
        ? 'bg-red-500/15 border-red-500/30 text-red-300'
        : 'bg-red-50 border-red-200 text-red-700'
      : darkMode
      ? 'bg-gray-500/15 border-gray-500/30 text-gray-300'
      : 'bg-gray-50 border-gray-200 text-gray-600';

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor}`}
      >
        {statusLabel}
      </span>
      {report.engine_version && (
        <span
          className={`text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
        >
          engine {report.engine_version}
        </span>
      )}
      {report.updated_at && (
        <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          · updated {new Date(report.updated_at).toLocaleString()}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function InvestorReportView({ report, darkMode, dealId }: InvestorReportViewProps) {
  const navRef = useRef<HTMLDivElement>(null);

  // Normalize sections (same logic as InvestorInsightsTab)
  const gateResultsFromPkg = report.render_package?.gate_state?.results ?? null;
  const rawSections: InvestorInsightsSection[] = (
    report.render_package?.sections ?? []
  ).map((section) => {
    if (section.key === 'gate_state' && gateResultsFromPkg !== null) {
      return { ...section, items: gateResultsFromPkg };
    }
    return section;
  });

  const canonicalSection = findSection(rawSections, 'canonical_fields');
  // Executive summary is ONLY sourced from governed_executive_summary_v1.
  // Falling back to governed_summary_v1 (deterministic stub) is intentionally disabled.
  const executiveSummarySection = findSection(rawSections, 'governed_executive_summary_v1');
  const hasGovernedExecSummary = !!executiveSummarySection;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex gap-6 relative">
      {/* ── Sticky section nav ── */}
      <nav
        ref={navRef}
        className="hidden lg:block shrink-0 w-44 sticky top-4 self-start"
        aria-label="Report sections"
      >
        <p
          className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
            darkMode ? 'text-gray-500' : 'text-gray-400'
          }`}
        >
          Sections
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => scrollTo(id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors ${
                  darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-white/10'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Report body ── */}
      <Stack gap={10} className="flex-1 min-w-0">
        {/* Report metadata */}
        <ReportMetaBar report={report} darkMode={darkMode} hasGovernedExecSummary={hasGovernedExecSummary} />

        {/* 0. Decision Overlay — top of report, above Exec Summary */}
        <section id="decision-overlay" className="scroll-mt-6">
          <DecisionOverlay dealId={dealId} darkMode={darkMode} />
        </section>

        {/* 1. Executive Summary — governed_executive_summary_v1 only, no deterministic fallback */}
        <ReportSection
          id="exec-summary"
          title="Executive Summary"
          icon={FileText}
          darkMode={darkMode}
        >
          {executiveSummarySection ? (
            <GovernedExecutiveSummarySection
              section={executiveSummarySection}
              darkMode={darkMode}
            />
          ) : (
            <div className="space-y-3">
              <EmptyFallback
                text="AI executive summary not yet generated."
                darkMode={darkMode}
              />
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Click <strong>Regenerate</strong> above to run the full AI-governed analysis.
              </p>
            </div>
          )}
        </ReportSection>

        {/* 2. Deal Terms */}
        <ReportSection
          id="deal-terms"
          title="Deal Terms"
          icon={Scale}
          darkMode={darkMode}
        >
          {dealId
            ? <DealTermsCard dealId={dealId} report={report} darkMode={darkMode} embedded />
            : <DealTermsSection section={canonicalSection} darkMode={darkMode} />
          }
        </ReportSection>

        {/* 2.5. Orchestrator Summary */}
        <ReportSection
          id="orchestrator-summary"
          title="Deal Intelligence Score"
          icon={Zap}
          darkMode={darkMode}
        >
          <OrchestratorSummaryCard dealId={dealId} darkMode={darkMode} />
        </ReportSection>

        {/* 3. Market */}
        <ReportSection
          id="market"
          title="Market"
          icon={TrendingUp}
          darkMode={darkMode}
        >
          {dealId
            ? <MarketAnalysisCard dealId={dealId} report={report} darkMode={darkMode} embedded />
            : <MarketSection section={canonicalSection} darkMode={darkMode} />
          }
        </ReportSection>

        {/* 4. Financials */}
        <ReportSection
          id="financials"
          title="Financial Analysis & Benchmarks"
          icon={DollarSign}
          darkMode={darkMode}
        >
          {dealId
            ? <FinancialAnalysisSection dealId={dealId} report={report} darkMode={darkMode} />
            : <FinancialsSection sections={rawSections} darkMode={darkMode} />
          }
        </ReportSection>

        {/* 5. Risk & Verification */}
        <ReportSection
          id="risk-verification"
          title="Risk & Verification"
          icon={AlertTriangle}
          darkMode={darkMode}
        >
          {dealId
            ? (
              <RiskVerificationSection
                dealId={dealId}
                report={report}
                darkMode={darkMode}
              />
            ) : (
              <RiskAndVerificationSection
                sections={rawSections}
                gateResultsFromPkg={gateResultsFromPkg}
                darkMode={darkMode}
              />
            )
          }
        </ReportSection>

        {/* 6. Appendix */}
        <ReportSection
          id="appendix"
          title="Appendix"
          icon={BookOpen}
          darkMode={darkMode}
        >
          <AppendixSection sections={rawSections} darkMode={darkMode} />
        </ReportSection>
      </Stack>
    </div>
  );
}
