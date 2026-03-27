import { AlertTriangle, ChevronDown, ChevronRight, BarChart2, Info, CheckCircle2, Database } from 'lucide-react';
import { useState } from 'react';
import { FinancialAuditTabProps } from '../../../types/financialAudit';
import { useFinancialAuditData } from '../../../hooks/useFinancialAuditData';
import { InvestorActionPanel } from './InvestorActionPanel';
import { SummaryMetricsBar } from './SummaryMetricsBar';
import { SourceOfTruthTable } from './SourceOfTruthTable';
import { CrossSourceReconciliation } from './CrossSourceReconciliation';
import { TemporalAlignmentPanel } from './TemporalAlignmentPanel';
import { TimeProjectionAudit } from './TimeProjectionAudit';
import { FinancialSnapshot } from './FinancialSnapshot';
import { RiskFlagsPanel } from './RiskFlagsPanel';
import { UnderwritingReadiness } from './UnderwritingReadiness';
import { FormulaTracePanel } from './FormulaTracePanel';
import { RawFactExplorer } from './RawFactExplorer';

export function FinancialAuditTab(props: FinancialAuditTabProps) {
  const { darkMode = true } = props;
  const auditData = useFinancialAuditData(props);
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    sourceOfTruth: true,
    conflicts: true,
    temporalAlignment: true,
    timeAudit: true,
    snapshot: true,
    readiness: true,
    risks: true,
    formulas: false,
    rawFacts: false
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // ── no_data: no financial signals of any kind ─────────────────────────────
  if (auditData.dataState === 'no_data') {
    return (
      <div className={`p-8 rounded-xl border flex flex-col items-center gap-4 text-center ${
        darkMode
          ? 'bg-white/5 border-white/10'
          : 'bg-gray-50 border-gray-200'
      }`}>
        <BarChart2 className={`w-10 h-10 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
        <div>
          <div className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            No financial data available
          </div>
          <div className={`text-sm leading-relaxed max-w-md ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            No financial signals have been extracted for this deal yet. Upload financial documents
            (XLSX model, cap table, PDF financials, or pitch deck) and re-run analysis.
          </div>
        </div>
      </div>
    );
  }

  // ── All other states: render the full tab with appropriate banners ─────────
  return (
    <div className="space-y-6">

      {/* Stale warning banner */}
      {auditData.showStaleWarning && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
          darkMode
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Financial data may be out of date.</span>{' '}
            New financial facts have been uploaded since the last analysis run. Re-run analysis
            to refresh this view. The data shown below reflects the last compiled report.
            <span className={`ml-2 text-xs ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>
              Last compiled: {auditData.lastUpdated}
            </span>
          </div>
        </div>
      )}

      {/* Limited data info banner */}
      {auditData.showLimitedDataWarning && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
          darkMode
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Non-structured financial data.</span>{' '}
            Financial data was extracted from non-structured sources such as decks or PDF materials.
            Coverage may be incomplete and some values may require spreadsheet-backed confirmation.
            Upload an XLSX model to unlock full audit coverage.
          </div>
        </div>
      )}

      {/* Integrity-incomplete banner (shown on any state when integrity hasn't run) */}
      {auditData.isIntegrityIncomplete && auditData.hasAnyFinancialData && !auditData.showLimitedDataWarning && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
          darkMode
            ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
            : 'bg-yellow-50 border-yellow-200 text-yellow-800'
        }`}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Integrity validation incomplete.</span>{' '}
            Financial data has been extracted, but validation is incomplete.
            Review source-linked values carefully before relying on them in an investment decision.
          </div>
        </div>
      )}

      {/* Structured financials badge */}
      {auditData.showStructuredBadge && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border w-fit text-sm ${
          darkMode
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          <Database className="w-3.5 h-3.5" />
          <span className="font-medium">Structured financials detected</span>
          <CheckCircle2 className="w-3.5 h-3.5" />
        </div>
      )}

      {/* 1. Investor Action Panel */}
      {auditData.showDetailedPanels && <InvestorActionPanel {...auditData.actionPanel} darkMode={darkMode} />}

      {/* 2. Summary Metrics Bar */}
      {auditData.showSummaryMetrics && <SummaryMetricsBar {...auditData.summaryMetrics} darkMode={darkMode} />}

      {/* 3–10. Detailed audit panels */}
      {auditData.showDetailedPanels && (
        <>
      {/* 3. Source of Truth Table */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('sourceOfTruth')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.sourceOfTruth ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Source of Truth Table
          </h2>
        </div>
        {expandedSections.sourceOfTruth && (
          <SourceOfTruthTable {...auditData.sourceOfTruth} darkMode={darkMode} />
        )}
      </section>

      {/* 4. Cross-Source Reconciliation */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('conflicts')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.conflicts ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Cross-Source Reconciliation
            {auditData.conflicts.conflicts.length > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
              }`}>
                {auditData.conflicts.conflicts.length} conflicts
              </span>
            )}
          </h2>
        </div>
        {expandedSections.conflicts && (
          <CrossSourceReconciliation {...auditData.conflicts} darkMode={darkMode} />
        )}
      </section>

      {/* 5. Temporal Alignment Issues */}
      {auditData.temporalAlignment.hasIssue && (
        <section>
          <div
            className="flex items-center justify-between mb-4 cursor-pointer"
            onClick={() => toggleSection('temporalAlignment')}
          >
            <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
              darkMode ? 'text-amber-400' : 'text-amber-600'
            }`}>
              {expandedSections.temporalAlignment ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Temporal Alignment
              <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
              }`}>
                {auditData.temporalAlignment.affectedMetrics.length} metric{auditData.temporalAlignment.affectedMetrics.length !== 1 ? 's' : ''}
              </span>
            </h2>
          </div>
          {expandedSections.temporalAlignment && (
            <TemporalAlignmentPanel block={auditData.temporalAlignment} darkMode={darkMode} />
          )}
        </section>
      )}

      {/* 6 & 7. Time Audit and Financial Snapshot (Side by Side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 5. Time & Projection Audit */}
        <section>
          <div
            className="flex items-center justify-between mb-4 cursor-pointer"
            onClick={() => toggleSection('timeAudit')}
          >
            <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {expandedSections.timeAudit ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Time & Projection Audit
            </h2>
          </div>
          {expandedSections.timeAudit && (
            <TimeProjectionAudit {...auditData.timeAudit} darkMode={darkMode} />
          )}
        </section>

        {/* 6. Financial Snapshot */}
        <section>
          <div
            className="flex items-center justify-between mb-4 cursor-pointer"
            onClick={() => toggleSection('snapshot')}
          >
            <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {expandedSections.snapshot ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Financial Snapshot
            </h2>
          </div>
          {expandedSections.snapshot && (
            <FinancialSnapshot {...auditData.snapshot} darkMode={darkMode} />
          )}
        </section>
      </div>

      {/* 7. Extraction Quality & Risk Flags */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('risks')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.risks ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Extraction Quality & Risk Flags
          </h2>
        </div>
        {expandedSections.risks && (
          <RiskFlagsPanel {...auditData.riskFlags} darkMode={darkMode} />
        )}
      </section>

      {/* 8. Underwriting Readiness */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('readiness')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.readiness ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Underwriting Readiness
          </h2>
        </div>
        {expandedSections.readiness && (
          <UnderwritingReadiness {...auditData.readiness} darkMode={darkMode} />
        )}
      </section>

      {/* 9. Formula & Model Trace */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('formulas')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.formulas ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Formula & Model Trace
            <span className={`text-xs px-2 py-0.5 rounded ${
              darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
            }`}>
              XLSX Only
            </span>
          </h2>
        </div>
        {expandedSections.formulas && (
          <FormulaTracePanel {...auditData.formulas} darkMode={darkMode} />
        )}
      </section>

      {/* 10. Raw Fact Explorer */}
      <section>
        <div
          className="flex items-center justify-between mb-4 cursor-pointer"
          onClick={() => toggleSection('rawFacts')}
        >
          <h2 className={`text-sm uppercase tracking-wide flex items-center gap-2 font-medium ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {expandedSections.rawFacts ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Raw Fact Explorer
            <span className={`text-xs px-2 py-0.5 rounded ${
              darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
            }`}>
              Advanced
            </span>
          </h2>
        </div>
        {expandedSections.rawFacts && (
          <RawFactExplorer {...auditData.rawFacts} darkMode={darkMode} />
        )}
      </section>
        </>
      )}

    </div>
  );
}
