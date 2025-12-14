import { useState } from 'react';
import { Button } from '../ui/Button';
import { FileCode, Calendar, Target, FileText, Eye, Download, Share2, Search } from 'lucide-react';

interface ReportsGeneratedProps {
  darkMode: boolean;
  onViewReport?: (dealId?: string) => void;
}

export function ReportsGenerated({ darkMode, onViewReport }: ReportsGeneratedProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const reports = [
    {
      id: 'vintara-001',
      name: 'Vintara Group LLC',
      subtitle: 'Due Diligence Report',
      industry: 'Beverage Alcohol / CPG',
      stage: 'Series A',
      funding: '$2M-$3M',
      generatedDate: 'Sep 5, 2025',
      score: 86,
      pages: 48,
      status: 'Complete'
    },
    {
      id: 'techvision-001',
      name: 'TechVision AI Platform',
      subtitle: 'Due Diligence Report',
      industry: 'Enterprise SaaS',
      stage: 'Series A',
      funding: '$5M',
      generatedDate: 'Dec 1, 2024',
      score: 87,
      pages: 52,
      status: 'Complete'
    }
  ];

  const filteredReports = reports.filter(report =>
    report.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    report.industry.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Reports Generated
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Access and manage all your AI-generated due diligence reports
              </p>
            </div>
            <div className={`px-4 py-2 rounded-lg border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
            }`}>
              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Total Reports</div>
              <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>{reports.length}</div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`} />
            <input
              type="text"
              placeholder="Search reports by company name or industry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm transition-colors ${
                darkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:bg-white/10 focus:border-[#6366f1]/50'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:bg-gray-50 focus:border-[#6366f1]/50'
              } focus:outline-none`}
            />
          </div>
        </div>

        {/* Reports Grid */}
        <div className="space-y-4">
          {filteredReports.length === 0 ? (
            <div className={`backdrop-blur-xl border rounded-2xl p-12 text-center ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <FileCode className={`w-16 h-16 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <h3 className={`text-lg mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                No reports found
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Try adjusting your search query
              </p>
            </div>
          ) : (
            filteredReports.map((report) => (
              <div
                key={report.id}
                className={`backdrop-blur-xl border rounded-2xl p-6 transition-all hover:shadow-lg ${
                  darkMode
                    ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5 hover:bg-white/5'
                    : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50 hover:border-[#6366f1]/30'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      darkMode ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20' : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10'
                    }`}>
                      <FileCode className="w-7 h-7 text-[#6366f1]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {report.name}
                        </h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {report.status}
                        </span>
                      </div>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {report.subtitle}
                      </p>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        {report.industry} • {report.stage} • {report.funding}
                      </p>
                      
                      {/* Metadata */}
                      <div className="flex items-center gap-6 flex-wrap">
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Generated: {report.generatedDate}
                          </span>
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          <span className="flex items-center gap-1">
                            <Target className="w-3.5 h-3.5" />
                            Score: {report.score}/100
                          </span>
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {report.pages} pages
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="primary"
                    darkMode={darkMode}
                    icon={<Eye className="w-4 h-4" />}
                    onClick={() => {
                      if (report.id === 'vintara-001') {
                        onViewReport?.(report.id);
                      } else {
                        alert('Opening TechVision AI report...');
                      }
                    }}
                  >
                    View Report
                  </Button>
                  <Button
                    variant="secondary"
                    darkMode={darkMode}
                    icon={<Download className="w-4 h-4" />}
                    onClick={() => alert('Export functionality coming soon!')}
                  >
                    Export
                  </Button>
                  <Button
                    variant="secondary"
                    darkMode={darkMode}
                    icon={<Share2 className="w-4 h-4" />}
                    onClick={() => alert('Share functionality coming soon!')}
                  >
                    Share
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
