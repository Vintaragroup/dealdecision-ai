import { FileSpreadsheet, FileText, Presentation, HelpCircle } from 'lucide-react';
import { Fragment, useState } from 'react';
import { SourceOfTruthTableProps } from '../../../types/financialAudit';
import {
  getCardBackground,
  getConfidenceColor,
  getSupportStatusColor,
  getSourceWeight,
  getSourceWeightColor,
  getSingleSourceBackground,
  getConflictBackground
} from '../../../utils/financialAuditHelpers';

interface Props extends SourceOfTruthTableProps {
  darkMode?: boolean;
}

export function SourceOfTruthTable({ rows, scopeNote, darkMode = true }: Props) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const getSourceIcon = (source: string) => {
    if (source.includes('XLSX')) return <FileSpreadsheet className="w-3 h-3" />;
    if (source.includes('Deck')) return <Presentation className="w-3 h-3" />;
    return <FileText className="w-3 h-3" />;
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${getCardBackground(darkMode)}`}>
      {scopeNote && (
        <div className={`px-4 py-2 text-xs border-b ${
          darkMode ? 'text-gray-500 border-white/5 bg-white/[0.02]' : 'text-gray-500 border-gray-100 bg-gray-50'
        }`}>
          {scopeNote}
        </div>
      )}
      <table className="w-full">
        <thead className={darkMode ? 'bg-white/5' : 'bg-gray-50'}>
          <tr>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Metric
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Value
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Source
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Source Weight
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Confidence
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <Fragment key={idx}>
              <tr
                onMouseEnter={() => setHoveredRow(`source-${idx}`)}
                onMouseLeave={() => setHoveredRow(null)}
                className={`border-t transition-colors relative group ${
                  row.isProjectionOnly
                    ? (darkMode ? 'border-white/10 bg-amber-500/5' : 'border-gray-200 bg-amber-50/60')
                    : row.status === 'Conflicting'
                    ? getConflictBackground(darkMode)
                    : row.status === 'Single Source'
                    ? getSingleSourceBackground(darkMode)
                    : (darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50')
                }`}
              >
                <td className={`px-4 py-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  <div className="text-sm font-medium">{row.metric}</div>
                  {row.sublabel && (
                    <div className={`text-[10px] mt-0.5 leading-tight ${darkMode ? 'text-amber-400/75' : 'text-amber-600'}`}>
                      {row.sublabel}
                    </div>
                  )}
                </td>
                <td className={`px-4 py-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>{row.value}</span>
                    {row.isDerived && (
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm leading-tight ${
                        darkMode ? 'bg-violet-500/20 text-violet-300' : 'bg-violet-100 text-violet-700'
                      }`}>
                        Derived
                      </span>
                    )}
                    {row.isProvisional && !row.isDerived && (
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm leading-tight ${
                        darkMode ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
                      }`}>
                        Provisional
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
                    darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {getSourceIcon(row.source)}
                    {row.source}
                    {row.sources > 1 && (
                      <span className={`ml-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        +{row.sources - 1}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-mono ${getSourceWeightColor(row.sourceWeight, darkMode)}`}>
                    {getSourceWeight(row.sourceWeight)}
                  </span>
                </td>
                <td className="px-4 py-3 relative">
                  <div className={`text-sm font-medium flex items-center gap-1.5 ${getConfidenceColor(row.confidence, darkMode)}`}>
                    {row.confidence}
                    <HelpCircle className="w-3 h-3 opacity-50" />
                  </div>
                  {/* Tooltip on hover */}
                  {hoveredRow === `source-${idx}` && (
                    <div className={`absolute left-4 top-full mt-1 z-20 px-2 py-1 rounded text-xs whitespace-nowrap ${
                      darkMode ? 'bg-gray-900 text-gray-300 border border-white/10' : 'bg-white text-gray-700 border border-gray-200 shadow-lg'
                    }`}>
                      {row.confidenceExplanation}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${getSupportStatusColor(row.status, darkMode)}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
              {/* Phase 2: alternative fact secondary row */}
              {row.alternativeFact && (
                <tr className={`border-t ${darkMode ? 'border-white/5 bg-white/[0.02]' : 'border-gray-100 bg-gray-50/40'}`}>
                  <td colSpan={6} className="px-4 py-1.5">
                    <div className={`ml-4 pl-3 border-l-2 ${
                      darkMode ? 'border-violet-500/30' : 'border-violet-300'
                    } flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs`}>
                      <span className={`font-medium ${darkMode ? 'text-violet-300/80' : 'text-violet-600'}`}>
                        {row.alternativeFact.label}
                      </span>
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                        {row.alternativeFact.value}
                      </span>
                      {row.alternativeFact.sublabel && (
                        <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {row.alternativeFact.sublabel}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
