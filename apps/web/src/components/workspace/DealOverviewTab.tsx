import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Info,
  ArrowRight,
  Target,
  Users,
  Zap,
  BarChart3
} from 'lucide-react';
import { Button } from '../ui/button';

interface SignalData {
  name: string;
  score: number;
  explanation: string;
  confidence: 'Strong Evidence' | 'Partial Evidence' | 'Limited Evidence';
}

interface DealOverviewTabProps {
  darkMode: boolean;
  
  // Company Snapshot
  companyName: string;
  companyDescription: string;
  snapshotFactLabels: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    tam: string;
  };
  snapshotFacts: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    tam: string;
  };
  
  // Investment Signals
  signals: SignalData[];
  
  // Core Deal Facts
  financials: { label: string; value: string }[];
  traction: { label: string; value: string }[];
  deal: { label: string; value: string }[];
  businessModel: { label: string; value: string }[];

  evidenceLabels: {
    product: string;
    market: string;
    businessModel: string;
    raise: string;
  };
  
  // Structured Evidence
  productSummary: string;
  marketSummary: string;
  businessModelSummary: string;
  raiseTerms: string;
  
  // Investor Insights Entry
  insightsScore: number;
  insightsConfidence: 'High' | 'Medium' | 'Low';
  onOpenInsights: () => void;
}

export function DealOverviewTab({
  darkMode,
  companyName,
  companyDescription,
  snapshotFactLabels,
  snapshotFacts,
  signals,
  financials,
  traction,
  deal,
  businessModel,
  evidenceLabels,
  productSummary,
  marketSummary,
  businessModelSummary,
  raiseTerms,
  insightsScore,
  insightsConfidence,
  onOpenInsights
}: DealOverviewTabProps) {
  
  // Score color coding
  const getScoreColor = (score: number) => {
    if (score >= 70) return darkMode ? 'text-emerald-400' : 'text-emerald-600';
    if (score >= 40) return darkMode ? 'text-amber-400' : 'text-amber-600';
    return darkMode ? 'text-red-400' : 'text-red-600';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return darkMode ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200';
    if (score >= 40) return darkMode ? 'bg-amber-500/10 border-amber-500/20' : 'bg-amber-50 border-amber-200';
    return darkMode ? 'bg-red-500/10 border-red-500/20' : 'bg-red-50 border-red-200';
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'Strong Evidence') return darkMode ? 'text-emerald-400' : 'text-emerald-600';
    if (confidence === 'Partial Evidence') return darkMode ? 'text-amber-400' : 'text-amber-600';
    return darkMode ? 'text-gray-400' : 'text-gray-500';
  };

  const getSignalIcon = (name: string) => {
    if (name.includes('Market')) return <Target className="w-4 h-4" />;
    if (name.includes('Team')) return <Users className="w-4 h-4" />;
    if (name.includes('Traction')) return <TrendingUp className="w-4 h-4" />;
    if (name.includes('Product')) return <Zap className="w-4 h-4" />;
    return <BarChart3 className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      
      {/* SECTION 1: COMPANY SNAPSHOT */}
      <section>
        <h2 className={`text-sm uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Company Snapshot
        </h2>
        
        {/* Description */}
        <div className={`p-5 rounded-xl border mb-4 ${
          darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
        }`}>
          <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {companyDescription}
          </p>
        </div>
        
        {/* Compact Fact Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: snapshotFactLabels.raise, value: snapshotFacts.raise },
            { label: snapshotFactLabels.arr, value: snapshotFacts.arr },
            { label: snapshotFactLabels.growth, value: snapshotFacts.growth },
            { label: snapshotFactLabels.customers, value: snapshotFacts.customers },
            { label: snapshotFactLabels.tam, value: snapshotFacts.tam }
          ].map((fact, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {fact.label}
              </div>
              <div className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {fact.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2: INVESTMENT SIGNAL ASSESSMENT */}
      <section>
        <h2 className={`text-sm uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Investment Signal Assessment
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {signals.map((signal, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
              }`}
            >
              {/* Signal Header */}
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded-lg ${getScoreBgColor(signal.score)}`}>
                  {getSignalIcon(signal.name)}
                </div>
                <div className={`text-xs px-2 py-0.5 rounded ${
                  darkMode ? 'bg-white/5' : 'bg-gray-100'
                }`}>
                  <span className={getConfidenceColor(signal.confidence)}>
                    {signal.confidence.replace(' Evidence', '')}
                  </span>
                </div>
              </div>
              
              {/* Signal Name */}
              <h3 className={`text-xs font-medium mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {signal.name}
              </h3>
              
              {/* Score */}
              <div className="mb-3">
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-bold ${getScoreColor(signal.score)}`}>
                    {signal.score}
                  </span>
                  <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    / 100
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className={`w-full h-1 rounded-full mt-2 ${
                  darkMode ? 'bg-white/10' : 'bg-gray-200'
                }`}>
                  <div
                    className={`h-1 rounded-full transition-all ${
                      signal.score >= 70 ? 'bg-emerald-400' :
                      signal.score >= 40 ? 'bg-amber-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${signal.score}%` }}
                  />
                </div>
              </div>
              
              {/* Explanation */}
              <p className={`text-xs leading-relaxed ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {signal.explanation}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: CORE DEAL FACTS */}
      <section>
        <h2 className={`text-sm uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Core Deal Facts
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Financials */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              💰 Financials
            </h3>
            <div className="space-y-2">
              {financials.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    {item.label}
                  </span>
                  <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {item.value || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Traction */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              📈 Traction
            </h3>
            <div className="space-y-2">
              {traction.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    {item.label}
                  </span>
                  <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {item.value || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Deal */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              ⚙️ Deal
            </h3>
            <div className="space-y-2">
              {deal.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    {item.label}
                  </span>
                  <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {item.value || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Business Model */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              🏢 Business Model
            </h3>
            <div className="space-y-2">
              {businessModel.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    {item.label}
                  </span>
                  <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {item.value || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: STRUCTURED EVIDENCE */}
      <section>
        <h2 className={`text-sm uppercase tracking-wide mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Extracted Evidence
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Product */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {evidenceLabels.product}
            </h3>
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {productSummary}
            </p>
          </div>

          {/* Market */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {evidenceLabels.market}
            </h3>
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {marketSummary}
            </p>
          </div>

          {/* Business Model */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {evidenceLabels.businessModel}
            </h3>
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {businessModelSummary}
            </p>
          </div>

          {/* Raise / Terms */}
          <div className={`p-4 rounded-xl border ${
            darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-xs uppercase tracking-wide mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {evidenceLabels.raise}
            </h3>
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {raiseTerms}
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 5: INVESTOR INSIGHTS ENTRY */}
      <section>
        <div className={`p-6 rounded-xl border-2 ${
          darkMode 
            ? 'bg-gradient-to-br from-[#6366f1]/10 via-[#8b5cf6]/5 to-transparent border-[#6366f1]/30' 
            : 'bg-gradient-to-br from-[#6366f1]/5 via-[#8b5cf6]/5 to-white border-[#6366f1]/20'
        }`}>
          <div className="flex items-start justify-between gap-6">
            {/* Left: Content */}
            <div className="flex-1">
              <h2 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Investor Insights
              </h2>
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Full AI analysis of this opportunity including investment thesis, strengths, risks, and detailed module scoring.
              </p>
              
              {/* Stats Row */}
              <div className="flex items-center gap-6 mb-4">
                <div>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Overall Score
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${getScoreColor(insightsScore)}`}>
                      {insightsScore}
                    </span>
                    <span className={`text-sm ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      / 100
                    </span>
                  </div>
                </div>
                
                <div className={`w-px h-10 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
                
                <div>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Confidence
                  </div>
                  <div className={`text-sm font-medium ${
                    insightsConfidence === 'High' ? (darkMode ? 'text-emerald-400' : 'text-emerald-600') :
                    insightsConfidence === 'Medium' ? (darkMode ? 'text-amber-400' : 'text-amber-600') :
                    (darkMode ? 'text-gray-400' : 'text-gray-500')
                  }`}>
                    {insightsConfidence}
                  </div>
                </div>
              </div>
              
              <Button
                variant="primary"
                darkMode={darkMode}
                onClick={onOpenInsights}
                icon={<ArrowRight className="w-4 h-4" />}
                iconPosition="right"
              >
                Open Investor Insights
              </Button>
            </div>
            
            {/* Right: Visual Indicator */}
            <div className={`flex-shrink-0 w-24 h-24 rounded-2xl flex items-center justify-center ${
              darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
            }`}>
              <BarChart3 className={`w-12 h-12 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
            </div>
          </div>
        </div>
      </section>
      
    </div>
  );
}
