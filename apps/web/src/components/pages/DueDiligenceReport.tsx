import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { ScoreCircle } from '../ui/ScoreCircle';
import { RiskMapGrid } from '../ui/RiskMapGrid';
import { ValidationChecklist } from '../ui/ValidationChecklist';
import { ExportReportModal } from '../ExportReportModal';
import {
  ArrowLeft,
  Download,
  Share2,
  Scale,
  MessageSquare,
  ChevronRight,
  CheckCircle,
  TrendingUp,
  Users,
  DollarSign,
  Target,
  BarChart3,
  Lightbulb,
  AlertTriangle,
  Award,
  Calendar,
  FileText,
  Sparkles
} from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface DueDiligenceReportProps {
  darkMode: boolean;
  dealId?: string;
  onBack?: () => void;
  onCompare?: () => void;
}

export function DueDiligenceReport({ darkMode, dealId, onBack, onCompare }: DueDiligenceReportProps) {
  const [showExportModal, setShowExportModal] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [activeSection, setActiveSection] = useState<string>('executive');

  // Check if this is the Vintara deal
  const isVintaraDeal = dealId === 'vintara-001';

  // Debug: Log the dealId
  console.log('DueDiligenceReport dealId:', dealId, 'isVintaraDeal:', isVintaraDeal);

  // Sample data - in real app would come from props or API
  const dealName = isVintaraDeal ? 'Vintara Group LLC' : 'TechVision AI Platform';
  const generatedDate = isVintaraDeal ? 'September 5, 2025' : 'December 1, 2024';
  const lastUpdated = isVintaraDeal ? 'September 5, 2025' : 'December 12, 2024';

  const sectionScores = [
    { name: 'Market', score: 90, icon: TrendingUp },
    { name: 'Team', score: 82, icon: Users },
    { name: 'Business', score: 85, icon: Target },
    { name: 'Financials', score: 88, icon: DollarSign }
  ];

  const scoreHistory = [
    { month: 'Apr', score: 72 },
    { month: 'May', score: 75 },
    { month: 'Jun', score: 78 },
    { month: 'Jul', score: 81 },
    { month: 'Aug', score: 84 },
    { month: 'Sep', score: 86 }
  ];

  const marketData = [
    { name: 'Category Tailwind', value: 0, label: 'Tequila +40% YoY' },
    { name: 'Launch Plan', value: 0, label: '3–5 states by Q4 2025' },
    { name: 'Priority Markets', value: 0, label: 'TX, FL, CO, AZ, GA' }
  ];

  const revenueProjection = [
    { period: 'Q3 2025', milestone: 'Califino Close', value: 1 },
    { period: 'Q4 2025', milestone: '3–5 State Launch', value: 2 },
    { period: 'Q1 2026', milestone: '2nd Brand Targeted', value: 3 },
    { period: 'Q2 2026', milestone: '>$3M TTM Revenue', value: 4 },
    { period: 'Q3 2026', milestone: 'HoldCo Breakeven', value: 5 },
  ];

  const teamComposition = [
    { name: 'HoldCo Ops', value: 25, color: '#6366f1' },
    { name: 'Sales & Trade', value: 35, color: '#8b5cf6' },
    { name: 'Marketing', value: 25, color: '#ec4899' },
    { name: 'Legal/Compliance', value: 15, color: '#10b981' }
  ];

  const sections = [
    { id: 'executive', label: 'Executive Summary', icon: FileText },
    { id: 'recommendation', label: 'Go/No-Go', icon: CheckCircle },
    { id: 'risks', label: 'Risk Map', icon: AlertTriangle },
    { id: 'market', label: 'Market Analysis', icon: TrendingUp },
    { id: 'team', label: 'Team Assessment', icon: Users },
    { id: 'business', label: 'Business Model', icon: Target },
    { id: 'financials', label: 'Financials', icon: DollarSign },
    { id: 'validation', label: 'Validation', icon: Award }
  ];

  // Animate overall score on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setOverallScore(86);
    }, 100);
    return () => clearTimeout(timer);
  }, [dealId]);

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections.map(s => ({
        id: s.id,
        element: document.getElementById(`section-${s.id}`)
      }));

      const scrollPosition = window.scrollY + 200;

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const section = sectionElements[i];
        if (section.element && section.element.offsetTop <= scrollPosition) {
          setActiveSection(section.id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: elementPosition - offset,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Fixed Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${ 
        darkMode ? 'bg-[#0f0f0f]/95 border-white/5' : 'bg-white/95 border-gray-200/50'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex items-center gap-4">
              {onBack && (
                <button
                  onClick={onBack}
                  className={`p-2 rounded-lg transition-colors ${
                    darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                  }`}
                >
                  <ArrowLeft className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                </button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <h1 className={`text-lg bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Due Diligence Report: {dealName}
                  </h1>
                </div>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Generated: {generatedDate} • Updated {lastUpdated}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowExportModal(true)}>
                <Download className="w-4 h-4" />
                Download PDF
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowExportModal(true)}>
                <FileText className="w-4 h-4" />
                Custom Export
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={onCompare}>
                <Scale className="w-4 h-4" />
                Compare
              </Button>
              <Button size="sm" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                AI Assistant
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content with Sticky Sidebar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex gap-6">
        {/* Sticky Side Navigation - Hidden on mobile */}
        <aside className={`hidden lg:block lg:w-64 flex-shrink-0`}>
          <div className="sticky top-24">
            <div className={`p-4 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-[#0f0f0f]/80 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <h3 className={`text-xs uppercase tracking-wider mb-3 ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>
                Jump to Section
              </h3>
              <nav className="space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;

                  return (
                    <button
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-[0_0_16px_rgba(99,102,241,0.3)]'
                          : darkMode
                            ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {section.label}
                      {isActive && <ChevronRight className="w-3 h-3 ml-auto" />}
                    </button>
                  );
                })}
              </nav>

              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className={`w-full mt-4 px-3 py-2 rounded-lg text-sm transition-colors ${
                  darkMode
                    ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                ↑ Back to Top
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 space-y-6 pb-12">
          {/* Hero Score Section */}
          <div className={`p-8 rounded-lg backdrop-blur-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
          }`}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className={`text-2xl mb-2 bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  Overall Readiness Assessment
                </h2>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  AI-powered analysis across all critical dimensions
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="flex flex-col items-center justify-center">
                <ScoreCircle score={overallScore} size="xl" darkMode={darkMode} label="Overall Readiness" />
                <div className={`mt-4 px-4 py-2 rounded-full backdrop-blur-xl border ${
                  darkMode ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                }`}>
                  <span className="text-green-600 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Ready for Investment
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Section Breakdown
                </h3>
                {sectionScores.map((section) => {
                  const Icon = section.icon;
                  return (
                    <div key={section.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                          <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {section.name}
                          </span>
                        </div>
                        <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {section.score}/100
                        </span>
                      </div>
                      <div className={`h-2 rounded-full overflow-hidden ${
                        darkMode ? 'bg-white/10' : 'bg-gray-200'
                      }`}>
                        <div
                          className={`h-full transition-all ${
                            section.score >= 85
                              ? 'bg-gradient-to-r from-green-500 to-emerald-600'
                              : section.score >= 70
                                ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                                : 'bg-gradient-to-r from-yellow-500 to-orange-500'
                          }`}
                          style={{ width: `${section.score}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}

                {/* Score History */}
                <div className="pt-4">
                  <h4 className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Score Trend (6 months)
                  </h4>
                  <ResponsiveContainer width="100%" height={80}>
                    <AreaChart data={scoreHistory}>
                      <defs>
                        <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="score"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#scoreGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Executive Summary */}
          <section id="section-executive" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  Executive Summary
                </h2>
              </div>

              <div className={`prose max-w-none ${darkMode ? 'prose-invert' : ''}`}>
                <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Vintara Group LLC is building a spirits "brand accelerator" that centralizes shared infrastructure (compliance, logistics, finance, analytics) while preserving each brand's cultural identity—aiming for <strong>rapid, capital-disciplined growth and exit optionality</strong> with an overall score of 86/100. The company has secured $5M committed equity and is well-positioned for its first brand acquisition.
                </p>

                <div className="grid grid-cols-2 gap-4 my-4">
                  <div className={`p-3 rounded-lg ${darkMode ? 'bg-green-500/10' : 'bg-green-50'}`}>
                    <h4 className="text-xs text-green-600 mb-1">Key Strengths</h4>
                    <ul className={`text-xs space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <li>✓ $5M committed equity + inventory credit line</li>
                      <li>✓ Califino Tequila LOI (majority stake, Q3 2025 close)</li>
                      <li>✓ Tequila premium segment growth (+40% YoY)</li>
                      <li>✓ Cultural marketing via celebrity/influencer networks</li>
                    </ul>
                  </div>

                  <div className={`p-3 rounded-lg ${darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50'}`}>
                    <h4 className="text-xs text-yellow-600 mb-1">Key Risks & Mitigations</h4>
                    <ul className={`text-xs space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <li>⚠ Execution risk (phased hiring + discipline mitigate)</li>
                      <li>⚠ Distribution volatility (trade marketing/incentives)</li>
                      <li>⚠ Regulatory state-by-state compliance friction</li>
                      <li>⚠ Capital sufficiency (credit line + tranche model)</li>
                    </ul>
                  </div>
                </div>

                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  The company has demonstrated strong strategic positioning with anchor brand Califino Tequila, proven industry relationships, and a clear roadmap to scale 3 brands across 3 categories in 3 markets. Recommended approach is <strong>staged tranche deployment (T0, M1, M2, M3)</strong> tied to execution milestones with &gt;$3M TTM revenue by Q2 2026 and HoldCo breakeven by Q3 2026.
                </p>
              </div>
            </div>
          </section>

          {/* Go/No-Go Recommendation */}
          <section id="section-recommendation" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border-2 shadow-[0_0_30px_rgba(99,102,241,0.2)] ${
              darkMode ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                  <CheckCircle className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      RECOMMENDED: GO
                    </h2>
                    <span className={`px-3 py-1 rounded-full text-xs ${
                      darkMode ? 'bg-green-500/20 text-green-300' : 'bg-green-200 text-green-800'
                    }`}>
                      HIGH CONFIDENCE (87%)
                    </span>
                  </div>
                  
                  <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Recommendation: GO, but deploy capital in staged tranches (T0, M1, M2, M3) tied to specific execution milestones to validate progress and reduce downside risk. The HoldCo "brand accelerator" model shows strong fundamentals with proven category tailwinds and committed capital infrastructure.
                  </p>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Investment Stage
                      </div>
                      <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        HoldCo Platform Rollout
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Target Amount
                      </div>
                      <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        $4M – $5M
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Timeline
                      </div>
                      <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        ~18 months (T0 → M3)
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Risk Map */}
          <section id="section-risks" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  Risk Assessment Map
                </h2>
              </div>

              <RiskMapGrid darkMode={darkMode} />
            </div>
          </section>

          {/* Market Analysis */}
          <section id="section-market" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Market Analysis
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Score:</span>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-24 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div className="h-full bg-gradient-to-r from-green-500 to-emerald-600" style={{ width: '92%' }}></div>
                    </div>
                    <span className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>92/100</span>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* Market Size */}
                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Market Opportunity
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {marketData.map((item) => (
                      <div key={item.name} className={`p-4 rounded-lg backdrop-blur-xl border ${
                        darkMode ? 'bg-[#6366f1]/5 border-[#6366f1]/20' : 'bg-[#6366f1]/5 border-[#6366f1]/20'
                      }`}>
                        <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {item.name}
                        </div>
                        <div className="text-2xl bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent">
                          {item.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Key Insights */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className={`text-sm mb-2 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Strengths
                    </h4>
                    <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      <li>• Premium tequila segment +40% YoY growth tailwind</li>
                      <li>• Distributor & retail relationships proven</li>
                      <li>• Celebrity marketing engine activated</li>
                      <li>• Multi-state expansion plan with priority markets</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className={`text-sm mb-2 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      Concerns
                    </h4>
                    <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      <li>• Distribution may deprioritize smaller brands</li>
                      <li>• Consumer adoption not guaranteed</li>
                      <li>• State-by-state regulatory complexity</li>
                    </ul>
                  </div>
                </div>

                {/* AI Insight */}
                <div className={`p-4 rounded-lg backdrop-blur-xl border ${
                  darkMode ? 'bg-[#6366f1]/10 border-[#6366f1]/20' : 'bg-[#6366f1]/5 border-[#6366f1]/20'
                }`}>
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-[#6366f1] mt-0.5" />
                    <div>
                      <h4 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        AI Insight
                      </h4>
                      <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Market conditions are highly favorable due to premium spirits category growth and cultural marketing trends. The tequila category specifically benefits from shifting consumer preferences toward premium brands. Recommend focusing on TX and FL markets first for highest velocity potential.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Team Assessment */}
          <section id="section-team" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Team Assessment
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Score:</span>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-24 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" style={{ width: '85%' }}></div>
                    </div>
                    <span className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>85/100</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Team Composition
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={teamComposition}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {teamComposition.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {teamComposition.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {item.name} ({item.value}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className={`text-sm mb-2 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Key Strengths
                    </h4>
                    <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      <li>• Decades of industry experience in spirits</li>
                      <li>• Entertainment/media network access (celebrity/influencer)</li>
                      <li>• Proven brand-building track record</li>
                      <li>• Deep distributor & retail relationships</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className={`text-sm mb-2 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      Gaps & Execution Risk
                    </h4>
                    <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      <li>• Need phased hiring (CFO, nat'l accounts director)</li>
                      <li>• Small initial team for multi-brand scaling</li>
                      <li>• Operating discipline critical (mitigated via tranches)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Business Model */}
          <section id="section-business" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Business Model Evaluation
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Score:</span>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-24 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" style={{ width: '81%' }}></div>
                    </div>
                    <span className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>81/100</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className={`p-4 rounded-lg backdrop-blur-xl border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                }`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Model Type
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Spirits Brand Accelerator
                  </div>
                </div>
                <div className={`p-4 rounded-lg backdrop-blur-xl border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                }`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Portfolio Strategy
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Majority Stake + Shared Infra
                  </div>
                </div>
                <div className={`p-4 rounded-lg backdrop-blur-xl border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                }`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Funding Approach
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Tranche + KPI-Gated
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  HoldCo "brand accelerator" model acquires significant stakes while preserving brand identity. Centralizes compliance, logistics, finance, and analytics for operating efficiency. Strategy targets 3 brands, 3 categories, 3 markets with capital-disciplined execution and clear exit optionality.
                </p>
              </div>
            </div>
          </section>

          {/* Financials */}
          <section id="section-financials" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-white" />
                  </div>
                  <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Financial Analysis
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Score:</span>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-24 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" style={{ width: '88%' }}></div>
                    </div>
                    <span className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>88/100</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  5-Year Revenue Projection
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={revenueProjection}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} />
                    <XAxis dataKey="period" stroke={darkMode ? '#666' : '#999'} />
                    <YAxis stroke={darkMode ? '#666' : '#999'} />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: darkMode ? '#1a1a1a' : '#fff',
                        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="value" fill="#6366f1" name="Milestones" />
                  </BarChart>
                </ResponsiveContainer>

                <div className="grid grid-cols-4 gap-4">
                  <div className={`p-3 rounded-lg backdrop-blur-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Committed Equity
                    </div>
                    <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      $5,000,000
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Credit Line
                    </div>
                    <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Inventory Financing
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Revenue Target
                    </div>
                    <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      &gt;$3M TTM (Q2 26)
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Breakeven Target
                    </div>
                    <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Q3 2026
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Validation Checklist */}
          <section id="section-validation" className="scroll-mt-24">
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                  <Award className="w-5 h-5 text-white" />
                </div>
                <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  Validation Checklist
                </h2>
              </div>

              <ValidationChecklist darkMode={darkMode} />
            </div>
          </section>
        </main>
      </div>

      {/* Export Report Modal */}
      <ExportReportModal
        isOpen={showExportModal}
        darkMode={darkMode}
        dealName={dealName}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}