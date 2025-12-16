import { useState } from 'react';
import { Button } from '../ui/button';
import { ExportOptionsModal, ExportOptions } from './ExportOptionsModal';
import { generatePDF, generateShareableLink, emailReport, saveExportHistory } from '../../utils/pdfExport';
import {
  Download,
  Share2,
  Settings,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Users,
  DollarSign,
  Target,
  Rocket,
  Shield,
  Sparkles,
  Award,
  ArrowRight,
  FileText,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Eye,
  Printer,
  Mail
} from 'lucide-react';

interface ReportSection {
  id: string;
  title: string;
  enabled: boolean;
  required: boolean;
}

interface ReportGeneratorProps {
  darkMode: boolean;
  analysisData: any; // This would be the full analysis data from AnalysisTab
  dealData: any;
  onClose?: () => void;
}

export function ProfessionalReportGenerator({ 
  darkMode, 
  analysisData, 
  dealData,
  onClose 
}: ReportGeneratorProps) {
  const [reportSections, setReportSections] = useState<ReportSection[]>([
    { id: 'cover', title: 'Cover Page', enabled: true, required: true },
    { id: 'executive', title: 'Executive Summary', enabled: true, required: true },
    { id: 'scores', title: 'Overall Assessment & Scores', enabled: true, required: true },
    { id: 'market', title: 'Market Analysis', enabled: true, required: false },
    { id: 'financial', title: 'Financial Review', enabled: true, required: false },
    { id: 'team', title: 'Team Evaluation', enabled: true, required: false },
    { id: 'traction', title: 'Traction & Growth Metrics', enabled: true, required: false },
    { id: 'risk', title: 'Risk Assessment', enabled: true, required: false },
    { id: 'competitive', title: 'Competitive Position', enabled: true, required: false },
    { id: 'recommendation', title: 'Investment Recommendation', enabled: true, required: true },
    { id: 'actionItems', title: 'Action Items & Next Steps', enabled: true, required: false },
    { id: 'appendix', title: 'Appendix & Supporting Data', enabled: false, required: false }
  ]);

  const [showPreview, setShowPreview] = useState(true);
  const [customNotes, setCustomNotes] = useState('');
  const [includeBranding, setIncludeBranding] = useState(true);
  const [reportFormat, setReportFormat] = useState<'standard' | 'executive' | 'detailed'>('standard');
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExport = async (options: ExportOptions) => {
    try {
      const filename = `${dealData?.companyName || dealData?.name || 'Deal'}_Due_Diligence_Report`;
      
      // Save to export history
      saveExportHistory(
        dealData?.id || 'unknown',
        'download',
        options
      );

      // Generate PDF
      await generatePDF('report-content', filename, options);
      
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export report. Please try again.');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const toggleSection = (id: string) => {
    setReportSections(prev => 
      prev.map(section => 
        section.id === id && !section.required 
          ? { ...section, enabled: !section.enabled }
          : section
      )
    );
  };

  const getScoreColor = (score: number): string => {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 55) return '#f59e0b';
    return '#ef4444';
  };

  const getRecommendation = (score: number): { text: string; color: string; icon: any } => {
    if (score >= 85) {
      return { 
        text: 'Strong Proceed', 
        color: '#10b981',
        icon: CheckCircle
      };
    }
    if (score >= 70) {
      return { 
        text: 'Proceed with Diligence', 
        color: '#3b82f6',
        icon: CheckCircle
      };
    }
    if (score >= 55) {
      return { 
        text: 'Proceed with Caution', 
        color: '#f59e0b',
        icon: AlertTriangle
      };
    }
    return { 
      text: 'Pass / High Risk', 
      color: '#ef4444',
      icon: XCircle
    };
  };

  // Mock data - would come from analysisData prop
  const overallScore = 73;
  const grade = 'Good';
  const completeness = 68;
  
  const categories = [
    { name: 'Market Opportunity', score: 75, icon: TrendingUp, color: '#3b82f6' },
    { name: 'Team Strength', score: 60, icon: Users, color: '#8b5cf6' },
    { name: 'Financial Health', score: 55, icon: DollarSign, color: '#10b981' },
    { name: 'Traction & Growth', score: 71, icon: Rocket, color: '#f59e0b' },
    { name: 'Risk Assessment', score: 65, icon: AlertTriangle, color: '#ef4444' },
    { name: 'Competitive Position', score: 80, icon: Target, color: '#6366f1' }
  ];

  const redFlags = [
    { severity: 'high', message: 'No revenue for post-seed stage', action: 'Add revenue data or timeline' },
    { severity: 'medium', message: 'Small team size (2 founders)', action: 'Add key advisors or co-founders' }
  ];

  const greenFlags = [
    'Strong market opportunity ($2.5B TAM)',
    'Experienced founding team with prior exits',
    'Clear competitive differentiation'
  ];

  const recommendation = getRecommendation(overallScore);
  const RecommendationIcon = recommendation.icon;

  return (
    <div className={`fixed inset-0 z-50 flex ${darkMode ? 'bg-black' : 'bg-gray-100'}`}>
      {/* Left Sidebar - Configuration */}
      <div className={`w-80 border-r overflow-y-auto ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="p-6 border-b border-white/10">
          <h2 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Report Generator
          </h2>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Customize your due diligence report
          </p>
        </div>

        {/* Format Selection */}
        <div className="p-6 border-b border-white/10">
          <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Report Format
          </h3>
          <div className="space-y-2">
            {[
              { id: 'executive', label: 'Executive (5 pages)', desc: 'High-level overview' },
              { id: 'standard', label: 'Standard (12 pages)', desc: 'Balanced detail' },
              { id: 'detailed', label: 'Detailed (20+ pages)', desc: 'Comprehensive analysis' }
            ].map(format => (
              <button
                key={format.id}
                onClick={() => setReportFormat(format.id as any)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  reportFormat === format.id
                    ? darkMode
                      ? 'bg-[#6366f1]/20 border-[#6366f1]'
                      : 'bg-[#6366f1]/10 border-[#6366f1]'
                    : darkMode
                      ? 'bg-white/5 border-white/10 hover:border-white/20'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {format.label}
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {format.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Section Selection */}
        <div className="p-6 border-b border-white/10">
          <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Include Sections
          </h3>
          <div className="space-y-2">
            {reportSections.map(section => (
              <label
                key={section.id}
                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                  section.enabled
                    ? darkMode ? 'bg-white/5' : 'bg-gray-50'
                    : ''
                } ${section.required ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10'}`}
              >
                <input
                  type="checkbox"
                  checked={section.enabled}
                  onChange={() => toggleSection(section.id)}
                  disabled={section.required}
                  className="w-4 h-4 rounded accent-[#6366f1]"
                />
                <span className={`text-sm flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {section.title}
                </span>
                {section.required && (
                  <span className="text-xs px-2 py-0.5 bg-[#6366f1]/20 text-[#6366f1] rounded">
                    Required
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="p-6 border-b border-white/10">
          <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Options
          </h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBranding}
                onChange={(e) => setIncludeBranding(e.target.checked)}
                className="w-4 h-4 rounded accent-[#6366f1]"
              />
              <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Include company branding
              </span>
            </label>
          </div>
        </div>

        {/* Custom Notes */}
        <div className="p-6">
          <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Custom Notes
          </h3>
          <textarea
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            placeholder="Add any additional notes or context..."
            className={`w-full h-32 p-3 rounded-lg border text-sm resize-none ${
              darkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>
      </div>

      {/* Main Content - Report Preview */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className={`border-b px-6 py-4 flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={onClose}
            >
              Back
            </Button>
            <div>
              <h1 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Due Diligence Report Preview
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {dealData?.name || 'TechVision AI Platform'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Eye className="w-4 h-4" />}
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Hide' : 'Show'} Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Printer className="w-4 h-4" />}
              onClick={handlePrint}
            >
              Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Mail className="w-4 h-4" />}
            >
              Email
            </Button>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Share2 className="w-4 h-4" />}
            >
              Share
            </Button>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              icon={<Download className="w-4 h-4" />}
              onClick={() => setShowExportModal(true)}
            >
              Export PDF
            </Button>
          </div>
        </div>

        {/* Report Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div 
            id="report-content"
            className={`max-w-4xl mx-auto space-y-8 p-12 rounded-lg shadow-2xl ${
              darkMode ? 'bg-white text-gray-900' : 'bg-white text-gray-900'
            }`} 
            style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
          >
            
            {/* Cover Page */}
            {reportSections.find(s => s.id === 'cover')?.enabled && (
              <div className="min-h-screen flex flex-col justify-center items-center text-center border-b-2 border-gray-200 pb-12">
                <div className="mb-8">
                  <Sparkles className="w-16 h-16 text-[#6366f1] mx-auto mb-4" />
                  <h1 className="text-5xl mb-4 text-gray-900">
                    Due Diligence Report
                  </h1>
                  <div className="text-2xl text-gray-600 mb-8">
                    {dealData?.name || 'TechVision AI Platform'}
                  </div>
                </div>

                <div className="mb-12">
                  <div 
                    className="inline-flex items-center justify-center w-32 h-32 rounded-full border-8 mb-4"
                    style={{ 
                      borderColor: getScoreColor(overallScore),
                      backgroundColor: `${getScoreColor(overallScore)}10`
                    }}
                  >
                    <div>
                      <div className="text-4xl font-bold" style={{ color: getScoreColor(overallScore) }}>
                        {overallScore}
                      </div>
                      <div className="text-sm text-gray-600">/ 100</div>
                    </div>
                  </div>
                  <div className="text-xl mb-2" style={{ color: getScoreColor(overallScore) }}>
                    {grade}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <RecommendationIcon className="w-5 h-5" style={{ color: recommendation.color }} />
                    <span className="text-lg" style={{ color: recommendation.color }}>
                      {recommendation.text}
                    </span>
                  </div>
                </div>

                <div className="text-gray-500 space-y-1">
                  <div>Generated by DealDecision AI</div>
                  <div>December 7, 2025</div>
                  <div className="text-sm text-gray-400 mt-4">
                    Confidential & Proprietary
                  </div>
                </div>
              </div>
            )}

            {/* Executive Summary */}
            {reportSections.find(s => s.id === 'executive')?.enabled && (
              <div className="py-12">
                <h2 className="text-3xl mb-6 text-gray-900 border-b-2 border-[#6366f1] pb-3">
                  Executive Summary
                </h2>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl mb-3 text-gray-800">Overview</h3>
                    <p className="text-gray-700 leading-relaxed">
                      {dealData?.name || 'TechVision AI Platform'} is seeking {dealData?.fundingAmount || '$5M'} in {dealData?.stage || 'Series A'} funding. 
                      Our comprehensive AI-powered analysis has evaluated the opportunity across six critical dimensions: 
                      market opportunity, team strength, financial health, traction & growth, risk factors, and competitive position.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Industry</div>
                      <div className="text-lg text-gray-900">{dealData?.industry || 'Enterprise SaaS'}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Stage</div>
                      <div className="text-lg text-gray-900">{dealData?.stage || 'Series A'}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Current Revenue</div>
                      <div className="text-lg text-gray-900">{dealData?.revenue || '$850,000'}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Team Size</div>
                      <div className="text-lg text-gray-900">{dealData?.teamSize || '8'} members</div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xl mb-3 text-gray-800">Key Findings</h3>
                    <div className="space-y-3">
                      {greenFlags.slice(0, 3).map((flag, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
                          <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">{flag}</span>
                        </div>
                      ))}
                      {redFlags.slice(0, 2).map((flag, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">{flag.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`p-6 rounded-lg`} style={{ backgroundColor: `${recommendation.color}10` }}>
                    <div className="flex items-center gap-3 mb-3">
                      <RecommendationIcon className="w-6 h-6" style={{ color: recommendation.color }} />
                      <h3 className="text-xl text-gray-900">Investment Recommendation</h3>
                    </div>
                    <div className="text-2xl mb-2" style={{ color: recommendation.color }}>
                      {recommendation.text}
                    </div>
                    <p className="text-gray-700">
                      {overallScore >= 85 
                        ? 'This opportunity demonstrates strong fundamentals across all evaluation criteria. The market timing, team composition, and early traction support a recommendation to proceed with investment discussions.'
                        : overallScore >= 70
                        ? 'This opportunity shows promise with some areas requiring additional diligence. We recommend proceeding with detailed evaluation of the identified concerns before making an investment decision.'
                        : overallScore >= 55
                        ? 'This opportunity has potential but presents significant concerns that require careful consideration. Proceed with caution and address all red flags before advancing to term sheet discussions.'
                        : 'This opportunity presents substantial risk factors that outweigh the potential upside at this stage. We recommend passing on this investment or revisiting after the company addresses the critical issues identified.'
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Overall Assessment & Scores */}
            {reportSections.find(s => s.id === 'scores')?.enabled && (
              <div className="py-12 border-t-2 border-gray-200">
                <h2 className="text-3xl mb-6 text-gray-900 border-b-2 border-[#6366f1] pb-3">
                  Overall Assessment & Scores
                </h2>

                <div className="grid grid-cols-3 gap-6 mb-8">
                  <div className="text-center p-6 bg-gray-50 rounded-lg">
                    <div className="text-5xl mb-2" style={{ color: getScoreColor(overallScore) }}>
                      {overallScore}
                    </div>
                    <div className="text-sm text-gray-600 mb-1">Overall Score</div>
                    <div className="text-lg" style={{ color: getScoreColor(overallScore) }}>
                      {grade}
                    </div>
                  </div>
                  <div className="text-center p-6 bg-gray-50 rounded-lg">
                    <div className="text-5xl mb-2 text-[#8b5cf6]">
                      {completeness}%
                    </div>
                    <div className="text-sm text-gray-600 mb-1">Profile Complete</div>
                    <div className="text-lg text-gray-700">
                      {completeness >= 80 ? 'Excellent' : 'In Progress'}
                    </div>
                  </div>
                  <div className="text-center p-6 bg-gray-50 rounded-lg">
                    <div className="text-5xl mb-2 text-gray-900">
                      {categories.filter(c => c.score >= 70).length}/6
                    </div>
                    <div className="text-sm text-gray-600 mb-1">Strong Categories</div>
                    <div className="text-lg text-gray-700">
                      Passing Grade
                    </div>
                  </div>
                </div>

                <h3 className="text-xl mb-4 text-gray-800">Category Breakdown</h3>
                <div className="space-y-4">
                  {categories.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <div key={cat.name} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-10 h-10 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `${cat.color}20` }}
                            >
                              <Icon className="w-5 h-5" style={{ color: cat.color }} />
                            </div>
                            <div>
                              <div className="text-lg text-gray-900">{cat.name}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl mb-1" style={{ color: getScoreColor(cat.score) }}>
                              {cat.score}
                            </div>
                            <div className="text-sm text-gray-600">/ 100</div>
                          </div>
                        </div>
                        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all"
                            style={{ 
                              width: `${cat.score}%`,
                              backgroundColor: cat.color
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Risk Assessment */}
            {reportSections.find(s => s.id === 'risk')?.enabled && (
              <div className="py-12 border-t-2 border-gray-200">
                <h2 className="text-3xl mb-6 text-gray-900 border-b-2 border-[#6366f1] pb-3">
                  Risk Assessment
                </h2>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl mb-4 text-gray-800 flex items-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-red-600" />
                      Red Flags & Concerns
                    </h3>
                    <div className="space-y-3">
                      {redFlags.map((flag, i) => (
                        <div key={i} className="p-4 bg-red-50 rounded-lg border-l-4 border-red-500">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-1 rounded text-xs text-white ${
                              flag.severity === 'high' 
                                ? 'bg-red-600'
                                : flag.severity === 'medium'
                                ? 'bg-orange-500'
                                : 'bg-yellow-500'
                            }`}>
                              {flag.severity.toUpperCase()}
                            </span>
                            <span className="text-lg text-gray-900">{flag.message}</span>
                          </div>
                          <div className="text-sm text-gray-700">
                            <strong>Recommended Action:</strong> {flag.action}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xl mb-4 text-gray-800 flex items-center gap-2">
                      <CheckCircle className="w-6 h-6 text-emerald-600" />
                      Positive Indicators
                    </h3>
                    <div className="space-y-2">
                      {greenFlags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
                          <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-700">{flag}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Items */}
            {reportSections.find(s => s.id === 'actionItems')?.enabled && (
              <div className="py-12 border-t-2 border-gray-200">
                <h2 className="text-3xl mb-6 text-gray-900 border-b-2 border-[#6366f1] pb-3">
                  Action Items & Next Steps
                </h2>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl mb-4 text-gray-800 flex items-center gap-2">
                      <Lightbulb className="w-6 h-6 text-yellow-600" />
                      Quick Wins (High Impact, Low Effort)
                    </h3>
                    <div className="space-y-3">
                      {redFlags.map((flag, i) => (
                        <div key={i} className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-900">{flag.action}</span>
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                              +5-10 pts potential
                            </span>
                          </div>
                          <div className="text-sm text-gray-600">
                            Estimated effort: 2-3 days
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xl mb-4 text-gray-800">Recommended Next Steps</h3>
                    <ol className="space-y-3">
                      {[
                        'Schedule detailed financial review with CFO',
                        'Request customer references and conduct interviews',
                        'Perform technical due diligence on product architecture',
                        'Review legal documents and IP assignments',
                        'Conduct background checks on key team members'
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <span className="flex items-center justify-center w-6 h-6 bg-[#6366f1] text-white rounded-full text-sm flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-gray-700 pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="py-8 border-t-2 border-gray-300 text-center text-sm text-gray-500">
              <div className="mb-2">
                This report was generated by DealDecision AI on December 7, 2025
              </div>
              <div className="mb-4">
                Confidential & Proprietary - Not for Distribution
              </div>
              <div className="flex items-center justify-center gap-2 text-[#6366f1]">
                <Sparkles className="w-4 h-4" />
                <span>Powered by DealDecision AI</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export Options Modal */}
      {showExportModal && (
        <ExportOptionsModal
          darkMode={darkMode}
          dealName={dealData?.name || dealData?.companyName || 'Deal'}
          onClose={() => setShowExportModal(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}