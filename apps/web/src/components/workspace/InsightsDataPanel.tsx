/**
 * InsightsDataPanel — PR33
 *
 * Renders the data/diagnostic sections from the investor-insights payload that
 * belong in the Data tab rather than the Investor Insights decision surface.
 *
 * Groups:
 *   1. Extracted Canonical Facts   — insight_slots, canonical_fields
 *   2. Conflicts & Uncertainty     — completeness_summary, conflicts
 *   3. Coverage & Extraction       — coverage_snapshot, debug.normalization_diff
 *
 * This component fetches its own report data so DataTab does not need to pass
 * insights props down from DealWorkspace.
 */

import { AlertCircle, Loader2, Database } from 'lucide-react';
import type { InvestorInsightsSection } from '../../lib/apiClient';
import { useInvestorInsightsStatusSummary } from '../../hooks/useInvestorInsightsStatusSummary';
import {
  EmptyFallback,
  InsightSlotsSection,
  CanonicalFieldsSection,
  CompletenessSummarySection,
  ConflictsSection,
  CoverageSnapshotSection,
  NormalizationDiffSection,
} from './InvestorInsightsTab';

// ── Types ───────────────────────────────────────────────────────────────────

interface InsightsDataPanelProps {
  dealId: string;
  darkMode: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function DataGroup({
  title,
  description,
  darkMode,
  children,
}: {
  title: string;
  description?: string;
  darkMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </h3>
        {description && (
          <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SectionBlock({
  title,
  section,
  darkMode,
  children,
  collapsible = false,
}: {
  title: string;
  section: InvestorInsightsSection;
  darkMode: boolean;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const inner = (
    <div className={`rounded-xl border p-5 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
      {!collapsible && (
        <h4 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {title}
        </h4>
      )}
      {children}
    </div>
  );

  if (!collapsible) return inner;

  return (
    <details className={`rounded-xl border ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
      <summary className={`px-5 py-3 cursor-pointer text-xs font-semibold uppercase tracking-wide select-none ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
        {title}
        {typeof section.title === 'string' && section.title !== title && (
          <span className={`ml-2 normal-case font-normal ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            — {section.title}
          </span>
        )}
      </summary>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </details>
  );
}

function AbsentSection({
  label,
  darkMode,
}: {
  label: string;
  darkMode: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {label} — not present in this report.
      </p>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function InsightsDataPanel({ dealId, darkMode }: InsightsDataPanelProps) {
  const { status, report, error } = useInvestorInsightsStatusSummary(dealId);

  const sections: InvestorInsightsSection[] = report?.render_package?.sections ?? [];

  const getSection = (key: string) => sections.find((s) => s.key === key);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div
        className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${
          darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
        }`}
        data-testid="insights-data-panel-loading"
      >
        <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Loading extracted data…
        </span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
          darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
        }`}
        data-testid="insights-data-panel-error"
      >
        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div>
          <p className={`text-sm font-medium ${darkMode ? 'text-red-200' : 'text-red-800'}`}>
            Failed to load insights data
          </p>
          {error && (
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-red-300/80' : 'text-red-700/70'}`}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Not started / no sections ──────────────────────────────────────────────

  const reportStatus = report?.status ?? null;
  const isNotStarted = !report || reportStatus === 'not_started';
  if (status === 'ready' && (isNotStarted || sections.length === 0)) {
    return (
      <div
        className={`text-center py-8 rounded-xl border-2 border-dashed ${
          darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
        }`}
        data-testid="insights-data-panel-empty"
      >
        <Database className={`w-8 h-8 mx-auto mb-3 opacity-35 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          No extracted data yet
        </p>
        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          Run Investor Insights analysis to populate extracted fields, conflicts, and coverage.
        </p>
      </div>
    );
  }

  // ── Data sections ──────────────────────────────────────────────────────────

  const insightSlots = getSection('insight_slots');
  const canonicalFields = getSection('canonical_fields');
  const completeness = getSection('completeness_summary');
  const conflicts = getSection('conflicts');
  const coverage = getSection('coverage_snapshot');
  const normDiff = getSection('debug.normalization_diff');

  const hasCanonicalFacts = insightSlots !== undefined || canonicalFields !== undefined;
  const hasConflicts = completeness !== undefined || conflicts !== undefined;
  const hasCoverage = coverage !== undefined || normDiff !== undefined;

  if (!hasCanonicalFacts && !hasConflicts && !hasCoverage) {
    return (
      <div
        className={`rounded-xl border px-4 py-3 ${
          darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
        }`}
        data-testid="insights-data-panel-no-data-sections"
      >
        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          This report does not include data sections.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="insights-data-panel">
      {/* Group 1: Extracted Canonical Facts */}
      {hasCanonicalFacts && (
        <DataGroup
          title="Extracted Canonical Facts"
          description="Slot values and canonical field values extracted from deal documents."
          darkMode={darkMode}
        >
          {insightSlots ? (
            <SectionBlock
              title={insightSlots.title ?? 'Insight Slots'}
              section={insightSlots}
              darkMode={darkMode}
            >
              <InsightSlotsSection section={insightSlots} darkMode={darkMode} />
            </SectionBlock>
          ) : (
            <AbsentSection label="Insight Slots" darkMode={darkMode} />
          )}
          {canonicalFields ? (
            <SectionBlock
              title={canonicalFields.title ?? 'Canonical Fields'}
              section={canonicalFields}
              darkMode={darkMode}
            >
              <CanonicalFieldsSection section={canonicalFields} darkMode={darkMode} />
            </SectionBlock>
          ) : (
            <AbsentSection label="Canonical Fields" darkMode={darkMode} />
          )}
        </DataGroup>
      )}

      {/* Group 2: Conflicts & Uncertainty */}
      {hasConflicts && (
        <DataGroup
          title="Conflicts & Uncertainty"
          description="Data completeness summary and any detected contradictions between documents."
          darkMode={darkMode}
        >
          {completeness ? (
            <SectionBlock
              title={completeness.title ?? 'Completeness Summary'}
              section={completeness}
              darkMode={darkMode}
            >
              <CompletenessSummarySection section={completeness} darkMode={darkMode} />
            </SectionBlock>
          ) : (
            <AbsentSection label="Completeness Summary" darkMode={darkMode} />
          )}
          {conflicts ? (
            <SectionBlock
              title={conflicts.title ?? 'Conflicts'}
              section={conflicts}
              darkMode={darkMode}
            >
              <ConflictsSection section={conflicts} darkMode={darkMode} />
            </SectionBlock>
          ) : (
            <AbsentSection label="Conflicts" darkMode={darkMode} />
          )}
        </DataGroup>
      )}

      {/* Group 3: Coverage & Extraction */}
      {hasCoverage && (
        <DataGroup
          title="Coverage & Extraction"
          description="OCR page coverage metrics and normalization diagnostics."
          darkMode={darkMode}
        >
          {coverage ? (
            <SectionBlock
              title={coverage.title ?? 'Coverage Snapshot'}
              section={coverage}
              darkMode={darkMode}
            >
              <CoverageSnapshotSection section={coverage} darkMode={darkMode} />
            </SectionBlock>
          ) : (
            <AbsentSection label="Coverage Snapshot" darkMode={darkMode} />
          )}
          {normDiff ? (
            <SectionBlock
              title={normDiff.title ?? 'OCR Normalization Diff'}
              section={normDiff}
              darkMode={darkMode}
              collapsible
            >
              <NormalizationDiffSection section={normDiff} darkMode={darkMode} />
            </SectionBlock>
          ) : null}
        </DataGroup>
      )}
    </div>
  );
}

// Re-export EmptyFallback so test files that import from InsightsDataPanel don't
// need a separate import from InvestorInsightsTab.
export { EmptyFallback };
