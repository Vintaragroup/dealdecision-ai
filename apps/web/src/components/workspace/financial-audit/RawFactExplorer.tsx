import { ChevronDown, ChevronRight, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { useState } from 'react';
import { RawFactExplorerProps } from '../../../types/financialAudit';
import { getCardBackground, getConfidenceColor } from '../../../utils/financialAuditHelpers';

interface Props extends RawFactExplorerProps {
  darkMode?: boolean;
}

export function RawFactExplorer({ facts, darkMode = true }: Props) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} style={{ width: '40px' }}>
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Metric
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Period
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Value
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Source
            </th>
            <th className={`text-left px-4 py-3 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact, idx) => (
            <>
              <tr
                key={idx}
                className={`border-t cursor-pointer transition-colors ${
                  darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => toggleRow(`fact-${idx}`)}
              >
                <td className="px-4 py-3">
                  {expandedRows[`fact-${idx}`] ? (
                    <ChevronDown className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  ) : (
                    <ChevronRight className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  )}
                </td>
                <td className={`px-4 py-3 text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {fact.metric}
                </td>
                <td className={`px-4 py-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {fact.period}
                </td>
                <td className={`px-4 py-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {fact.value}
                </td>
                <td className="px-4 py-3">
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
                    darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {getSourceIcon(fact.source)}
                    {fact.source}
                  </div>
                </td>
                <td className={`px-4 py-3 text-sm font-medium ${getConfidenceColor(fact.confidence, darkMode)}`}>
                  {fact.confidence}
                </td>
              </tr>
              
              {/* Expandable Row Details */}
              {expandedRows[`fact-${idx}`] && (
                <tr className={darkMode ? 'bg-white/5 border-t border-white/10' : 'bg-gray-50 border-t border-gray-200'}>
                  <td colSpan={6} className="px-4 py-4">
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <div className={`mb-1 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          Sheet / Page
                        </div>
                        <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                          {fact.sheet || fact.cell}
                        </div>
                      </div>
                      <div>
                        <div className={`mb-1 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          Cell / Reference
                        </div>
                        <div className={`font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {fact.cell}
                        </div>
                      </div>
                      <div>
                        <div className={`mb-1 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          Formula
                        </div>
                        <div className={`font-mono ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          {fact.formula || 'Direct value'}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
