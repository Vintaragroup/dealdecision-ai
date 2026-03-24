import { FileSpreadsheet, FileText, Presentation, HelpCircle } from 'lucide-react';
import { useState } from 'react';
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

export function SourceOfTruthTable({ rows, darkMode = true }: Props) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const getSourceIcon = (source: string) => {
    if (source.includes('XLSX')) return <FileSpreadsheet className="w-3 h-3" />;
    if (source.includes('Deck')) return <Presentation className="w-3 h-3" />;
    return <FileText className="w-3 h-3" />;
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${getCardBackground(darkMode)}`}>
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
            <tr
              key={idx}
              onMouseEnter={() => setHoveredRow(`source-${idx}`)}
              onMouseLeave={() => setHoveredRow(null)}
              className={`border-t transition-colors relative group ${
                row.status === 'Conflicting' 
                  ? getConflictBackground(darkMode)
                  : row.status === 'Single Source'
                  ? getSingleSourceBackground(darkMode)
                  : (darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50')
              }`}
            >
              <td className={`px-4 py-3 text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {row.metric}
              </td>
              <td className={`px-4 py-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {row.value}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
