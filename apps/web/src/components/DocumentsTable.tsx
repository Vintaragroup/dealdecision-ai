import { FileText, Download, ExternalLink } from 'lucide-react';

const documents = [
  { name: 'Pitch Deck - Q4 2024', type: 'Presentation', score: 9.2, amount: '$125,000', status: 'active' },
  { name: 'Executive Summary - TechCo', type: 'Document', score: 8.8, amount: '$89,500', status: 'active' },
  { name: 'Business Model Canvas', type: 'Canvas', score: 7.5, amount: '$45,200', status: 'review' },
  { name: 'Financial Projections', type: 'Spreadsheet', score: 9.0, amount: '$156,800', status: 'active' }
];

interface DocumentsTableProps {
  darkMode: boolean;
}

export function DocumentsTable({ darkMode }: DocumentsTableProps) {
  return (
    <div className={`backdrop-blur-xl border rounded-2xl p-6 relative overflow-hidden ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5 shadow-[0_0_40px_rgba(0,0,0,0.3)]'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50 shadow-lg'
    }`}>
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br opacity-50 ${
        darkMode ? 'from-[#6366f1]/3 via-transparent to-transparent' : 'from-[#6366f1]/2 via-transparent to-transparent'
      }`}></div>
      
      <div className="flex items-center justify-between mb-6 relative z-10">
        <h2 className={darkMode ? 'text-white' : 'text-gray-900'}>Recent Documents</h2>
        <button className="text-sm bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent hover:from-[#8b5cf6] hover:to-[#6366f1] transition-all">
          View All
        </button>
      </div>
      
      <div className="overflow-hidden relative z-10">
        <table className="w-full">
          <thead>
            <tr className={`border-b ${darkMode ? 'border-white/5' : 'border-gray-200/50'}`}>
              <th className={`text-left py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Name</th>
              <th className={`text-left py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Type</th>
              <th className={`text-center py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Status</th>
              <th className={`text-right py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>AI Score</th>
              <th className={`text-right py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Value</th>
              <th className={`text-right py-3 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc, index) => (
              <tr key={index} className={`border-b transition-colors group ${
                darkMode 
                  ? 'border-white/5 hover:bg-white/5' 
                  : 'border-gray-200/50 hover:bg-gray-100/50'
              }`}>
                <td className={`py-4 px-4 text-sm flex items-center gap-2 ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  <FileText className={`w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  {doc.name}
                </td>
                <td className={`py-4 px-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{doc.type}</td>
                <td className="py-4 px-4 text-sm text-center">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs backdrop-blur-xl border ${
                    doc.status === 'active' 
                      ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-emerald-500/30 text-emerald-400' 
                      : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-400'
                  }`}>
                    {doc.status === 'active' ? (
                      <>
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                        Active
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full mr-1.5"></span>
                        Review
                      </>
                    )}
                  </span>
                </td>
                <td className="py-4 px-4 text-sm text-right">
                  <span className="inline-flex items-center justify-center w-12 h-6 bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 backdrop-blur-xl border border-[#6366f1]/30 text-[#6366f1] rounded-full">
                    {doc.score}
                  </span>
                </td>
                <td className={`py-4 px-4 text-sm text-right bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>{doc.amount}</td>
                <td className="py-4 px-4 text-sm text-right">
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className={`p-1.5 backdrop-blur-xl border rounded transition-colors ${
                      darkMode 
                        ? 'bg-white/5 hover:bg-white/10 border-white/10' 
                        : 'bg-white/80 hover:bg-gray-100 border-gray-200'
                    }`}>
                      <Download className={`w-3.5 h-3.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                    </button>
                    <button className={`p-1.5 backdrop-blur-xl border rounded transition-colors ${
                      darkMode 
                        ? 'bg-white/5 hover:bg-white/10 border-white/10' 
                        : 'bg-white/80 hover:bg-gray-100 border-gray-200'
                    }`}>
                      <ExternalLink className={`w-3.5 h-3.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
