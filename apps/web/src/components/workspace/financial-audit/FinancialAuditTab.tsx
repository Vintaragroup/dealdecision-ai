import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, BarChart2 } from 'lucide-react';
import { useState } from 'react';
import { FinancialAuditTabProps } from '../../../types/financialAudit';
import { useFinancialAuditData } from '../../../hooks/useFinancialAuditData';
import { InvestorActionPanel } from './InvestorActionPanel';
import { SummaryMetricsBar } from './SummaryMetricsBar';
import { SourceOfTruthTable } from './SourceOfTruthTable';
import { CrossSourceReconciliation } from './CrossSourceReconciliation';
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

  // ── no_data: unified empty state — no panels below ───────────────────────
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
            This deal has no verified structured financial data yet. Structured sources (XLSX model,
            cap table, or validated extraction) must be present before this tab can surface meaningful
            results. Re-run analysis once financial documents are uploaded.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Staleness Warning Banner */}
      {auditData.isStale && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 ${
          darkMode 
            ? 'bg-amber-500/10 border-amber-500/30' 
            : 'bg-amber-50 border-amber-200'
        }`}>
          <AlertTriangle className={`w-5 h-5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
          <div className="flex-1">
            <div className={`text-sm font-medium ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
              Financial data may be outdated
            </div>
            <div className={`text-xs mt-0.5 ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>
              Last updated {auditData.lastUpdated}. Re-run analysis to refresh the financial audit snapshot.
            </div>
          </div>
        </div>
      )}

      {/* Empty Report State Banner */}
      {auditData.isReportEmpty && (
        <div className={`p-5 rounded-xl border flex items-start gap-4 ${
          darkMode
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-blue-50 border-blue-200'
        }`}>
          <RefreshCw className={`w-5 h-5 mt-0.5 flex-shrink-0 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          <div>
            <div className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-800'}`}>
              Report compiled before financial data was available
            </div>
            <div className={`text-xs mt-1 leading-relaxed ${darkMode ? 'text-blue-400/70' : 'text-blue-600'}`}>
              The compiled report does not yet include XLSX or structured financial data. Source of Truth, 
              Snapshot, and Projection panels will be empty until analysis is re-run. Facts already 
              extracted may be visible in the Raw Facts panel after a fresh compile.
            </div>
          </div>
        </div>
      )}

      {/* 1. Investor Action Panel */}
      <InvestorActionPanel {...auditData.actionPanel} darkMode={darkMode} />

      {/* 2. Summary Metrics Bar */}
      <SummaryMetricsBar {...auditData.summaryMetrics} darkMode={darkMode} />

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

      {/* 5 & 6. Time Audit and Financial Snapshot (Side by Side) */}
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

    </div>
  );
}
