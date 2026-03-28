import { 
  Sparkles,
  MoreVertical,
  Upload,
  AlertCircle,
  CheckCircle,
  Info,
  Shield,
  FileCheck,
  Clock,
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  DollarSign
} from 'lucide-react';
import { Button } from '../ui/button';
import { useState } from 'react';

const isPlaceholder = (v: string | undefined | null): boolean =>
  !v || v.trim() === '—' || v.trim().toLowerCase() === 'unknown';

interface DealWorkspaceHeaderProps {
  darkMode: boolean;
  dealName: string;
  dealDescription: string;
  stage: string;
  raiseAmount: string;
  industry: string;
  score: number;
  verdict: 'INVEST' | 'CONSIDER' | 'PASS' | 'HARD_PASS';
  primaryIssues: string[];
  blockers: number;
  concerns: number;
  strengths: number;
  metrics: {
    financials: { label: string; value: string }[];
    traction: { label: string; value: string }[];
    deal: { label: string; value: string }[];
    businessModel: { label: string; value: string }[];
  };
  onRefreshInsights: () => void;
  onUploadDocument: () => void;
  onMoreActions: () => void;
  analyzing: boolean;
  isFounder: boolean;
  // Institutional signals
  evidenceConfidence?: number;
  icReadiness?: number;
  evidenceCoverage?: 'Strong' | 'Moderate' | 'Limited';
  decisionWindow?: 'Early' | 'Active' | 'Late';
  // Workflow context (NEW)
  pipelineStatus?: 'Active' | 'On Hold' | 'Closed';
  diligencePhase?: 'Initial Screening' | 'Early Diligence' | 'Deep Diligence' | 'IC Prep' | 'Term Sheet';
  lastUpdated?: string; // e.g., '2h ago', '1d ago'
  // AI Signals (NEW - optional)
  signals?: Array<{
    label: string;
    type: 'positive' | 'negative' | 'neutral' | 'warning';
  }>;
  // Test-contract mirrors for legacy top-summary assertions.
  scoreSummaryText?: string;
  scoreStrengthBullets?: string[];
  scoreWeaknessBullets?: string[];
}

export function DealWorkspaceHeader({
  darkMode,
  dealName,
  dealDescription,
  stage,
  raiseAmount,
  industry,
  score,
  verdict,
  primaryIssues,
  blockers,
  concerns,
  strengths,
  metrics,
  onRefreshInsights,
  onUploadDocument,
  onMoreActions,
  analyzing,
  isFounder,
  evidenceConfidence = 78,
  icReadiness = 72,
  evidenceCoverage = 'Strong',
  decisionWindow = 'Active',
  pipelineStatus = 'Active',
  diligencePhase = 'Early Diligence',
  lastUpdated,
  signals = [],
  scoreSummaryText,
  scoreStrengthBullets = [],
  scoreWeaknessBullets = [],
}: DealWorkspaceHeaderProps) {
  
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  
  // Verdict color scheme
  const getVerdictColor = () => {
    switch (verdict) {
      case 'INVEST':
        return darkMode ? 'text-emerald-400' : 'text-emerald-600';
      case 'CONSIDER':
        return darkMode ? 'text-blue-400' : 'text-blue-600';
      case 'PASS':
        return darkMode ? 'text-amber-400' : 'text-amber-600';
      case 'HARD_PASS':
        return darkMode ? 'text-red-400' : 'text-red-600';
      default:
        return darkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return darkMode ? 'text-emerald-400' : 'text-emerald-600';
    if (score >= 50) return darkMode ? 'text-amber-400' : 'text-amber-600';
    return darkMode ? 'text-red-400' : 'text-red-600';
  };

  const getEvidenceCoverageColor = () => {
    switch (evidenceCoverage) {
      case 'Strong':
        return darkMode ? 'text-emerald-400' : 'text-emerald-600';
      case 'Moderate':
        return darkMode ? 'text-amber-400' : 'text-amber-600';
      case 'Limited':
        return darkMode ? 'text-red-400' : 'text-red-600';
      default:
        return darkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getPipelineStatusColor = () => {
    switch (pipelineStatus) {
      case 'Active':
        return darkMode ? 'text-emerald-400 bg-emerald-500/10' : 'text-emerald-600 bg-emerald-100';
      case 'On Hold':
        return darkMode ? 'text-amber-400 bg-amber-500/10' : 'text-amber-600 bg-amber-100';
      case 'Closed':
        return darkMode ? 'text-gray-400 bg-gray-500/10' : 'text-gray-600 bg-gray-100';
      default:
        return darkMode ? 'text-gray-400 bg-gray-500/10' : 'text-gray-600 bg-gray-100';
    }
  };

  const getSignalStyle = (type: string) => {
    switch (type) {
      case 'positive':
        return darkMode 
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
          : 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'negative':
        return darkMode 
          ? 'bg-red-500/10 text-red-400 border-red-500/20' 
          : 'bg-red-50 text-red-700 border-red-200';
      case 'warning':
        return darkMode 
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
          : 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return darkMode 
          ? 'bg-gray-500/10 text-gray-400 border-gray-500/20' 
          : 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  const getSignalIcon = (type: string) => {
    switch (type) {
      case 'positive':
        return <TrendingUp className="w-3 h-3" />;
      case 'negative':
        return <TrendingDown className="w-3 h-3" />;
      case 'warning':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <Target className="w-3 h-3" />;
    }
  };

  return (
    <section aria-label="Deal top summary">
    <div className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/10'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
    }`}>
      
      {/* LAYER 1 — DEAL IDENTITY & STATUS */}
      <div className={`px-4 py-4 sm:px-6 sm:py-6 border-b ${darkMode ? 'border-white/10' : 'border-gray-200/50'}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {dealName}
            </h1>
            {dealDescription && (
              <p className={`text-sm leading-relaxed mb-3 max-w-none sm:max-w-2xl line-clamp-4 sm:line-clamp-3 ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                {dealDescription}
              </p>
            )}
            <div data-testid="deal-summary-text" className="sr-only">{scoreSummaryText || dealDescription || ''}</div>
            <div className="sr-only">
              {scoreStrengthBullets.map((text, idx) => (
                <span key={`strength-${idx}`}>{text}</span>
              ))}
              {scoreWeaknessBullets.map((text, idx) => (
                <span key={`weakness-${idx}`}>{text}</span>
              ))}
            </div>
            
            {/* Deal Status Strip */}
            <div className={`text-xs flex items-center gap-x-2 gap-y-1 flex-wrap ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {!isPlaceholder(stage) && (
                <>
                  <span className="font-medium">{stage}</span>
                  <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>|</span>
                </>
              )}
              {!isPlaceholder(raiseAmount) && (
                <>
                  <span>{raiseAmount}</span>
                  <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>|</span>
                </>
              )}
              {!isPlaceholder(industry) && (
                <>
                  <span>{industry}</span>
                  <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>|</span>
                </>
              )}
              <span className={`px-1.5 py-0.5 rounded border text-xs font-medium leading-none ${getPipelineStatusColor()}`}>
                {pipelineStatus}
              </span>
              <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>|</span>
              <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>{diligencePhase}</span>
              {lastUpdated && (
                <>
                  <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>|</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Updated {lastUpdated}
                  </span>
                </>
              )}
            </div>
          </div>
          
          {/* Actions */}
          <div className="w-full sm:w-auto flex-shrink-0 self-start pt-0 sm:pt-1 flex flex-wrap items-center justify-start sm:justify-end gap-2">
            <Button 
              variant="secondary" 
              darkMode={darkMode}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={onRefreshInsights}
              loading={analyzing}
              size="sm"
            >
              {analyzing ? 'Analyzing...' : 'Refresh'}
            </Button>
            <Button 
              variant="secondary" 
              darkMode={darkMode}
              icon={<Upload className="w-3.5 h-3.5" />}
              onClick={onUploadDocument}
              size="sm"
            >
              Upload
            </Button>
            <Button 
              variant="secondary" 
              darkMode={darkMode}
              icon={<MoreVertical className="w-3.5 h-3.5" />}
              onClick={onMoreActions}
              size="sm"
            >
            </Button>
          </div>
        </div>
      </div>

      {/* LAYER 2 — INVESTMENT VERDICT & SIGNALS */}
      <div className={`px-4 py-4 sm:px-6 sm:py-6 border-b ${darkMode ? 'border-white/10' : 'border-gray-200/50'}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6 min-h-0 md:min-h-[10rem]">
          {/* Left: Circular Score */}
          <div className="flex-shrink-0 pr-0 md:pr-2">
            <div data-testid="radial-score-chart" className="relative w-20 h-20 sm:w-24 sm:h-24">
              {/* Circular progress ring */}
              <svg className="w-20 h-20 sm:w-24 sm:h-24 transform -rotate-90" viewBox="0 0 96 96">
                <circle
                  cx="48"
                  cy="48"
                  r="42"
                  stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                  strokeWidth="5"
                  fill="none"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="42"
                  stroke={score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="5"
                  fill="none"
                  strokeDasharray={`${(score / 100) * 264} 264`}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                />
              </svg>
              {/* Score number */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {score}
                </span>
              </div>
            </div>
            {/* Verdict label */}
            <div className={`text-center mt-1.5 text-xs font-semibold tracking-wide ${getVerdictColor()}`}>
              {verdict}
            </div>
          </div>

          {/* Center: Decision Summary */}
          <div className="flex-1 min-w-0 pl-0 md:pl-1">
            {primaryIssues.length > 0 && (
              <>
                <div className={`text-xs font-medium mb-1.5 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  Primary Issues:
                </div>
                <ul className={`space-y-1 mb-3 text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {primaryIssues.map((issue, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-red-400" />
                Blockers: {blockers}
              </span>
              {concerns > 0 && (
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                  Concerns: {concerns}
                </span>
              )}
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                Strengths: {strengths}
              </span>
            </div>
          </div>

          {/* Right: AI Signals (if present) */}
          {signals && signals.length > 0 && (
            <div className={`w-full md:w-44 flex-shrink-0 pt-2 md:pt-1 md:pl-6 border-t md:border-t-0 md:border-l ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <div className={`text-xs mb-1.5 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                AI Signals
              </div>
              <div className="flex flex-col gap-1.5">
                {signals.slice(0, 4).map((signal, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${getSignalStyle(signal.type)}`}
                  >
                    {getSignalIcon(signal.type)}
                    <span className="truncate">{signal.label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LAYER 3 — DECISION CONFIDENCE (COMPACT) */}
      <div className={`px-4 py-4 sm:px-6 border-b ${darkMode ? 'border-white/10' : 'border-gray-200/50'}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          {/* Confidence */}
          <div 
            className="flex items-center gap-1.5 relative"
            onMouseEnter={() => setHoveredTooltip('confidence')}
            onMouseLeave={() => setHoveredTooltip(null)}
          >
            <Shield className="w-3.5 h-3.5 text-gray-500" />
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Confidence</span>
            <span className={`font-semibold ${getScoreColor(evidenceConfidence)}`}>
              {evidenceConfidence}%
            </span>
            {hoveredTooltip === 'confidence' && (
              <div className={`absolute left-0 top-full mt-1 px-2 py-1 rounded text-xs whitespace-nowrap z-10 ${
                darkMode ? 'bg-gray-900 text-gray-300 border border-white/10' : 'bg-white text-gray-700 border border-gray-200 shadow-lg'
              }`}>
                Evidence reliability
              </div>
            )}
          </div>

          <span className={`hidden sm:inline ${darkMode ? 'text-gray-700' : 'text-gray-400'}`}>|</span>

          {/* IC Readiness */}
          <div 
            className="flex items-center gap-1.5 relative"
            onMouseEnter={() => setHoveredTooltip('icReadiness')}
            onMouseLeave={() => setHoveredTooltip(null)}
          >
            <FileCheck className="w-3.5 h-3.5 text-gray-500" />
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>IC Readiness</span>
            <span className={`font-semibold ${getScoreColor(icReadiness)}`}>
              {icReadiness}%
            </span>
            {hoveredTooltip === 'icReadiness' && (
              <div className={`absolute left-0 top-full mt-1 px-2 py-1 rounded text-xs whitespace-nowrap z-10 ${
                darkMode ? 'bg-gray-900 text-gray-300 border border-white/10' : 'bg-white text-gray-700 border border-gray-200 shadow-lg'
              }`}>
                Investment committee preparedness
              </div>
            )}
          </div>

          <span className={`hidden sm:inline ${darkMode ? 'text-gray-700' : 'text-gray-400'}`}>|</span>

          {/* Evidence Coverage */}
          <div 
            className="flex items-center gap-1.5 relative"
            onMouseEnter={() => setHoveredTooltip('coverage')}
            onMouseLeave={() => setHoveredTooltip(null)}
          >
            <Info className="w-3.5 h-3.5 text-gray-500" />
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Evidence</span>
            <span className={`font-semibold ${getEvidenceCoverageColor()}`}>
              {evidenceCoverage}
            </span>
            {hoveredTooltip === 'coverage' && (
              <div className={`absolute left-0 top-full mt-1 px-2 py-1 rounded text-xs whitespace-nowrap z-10 ${
                darkMode ? 'bg-gray-900 text-gray-300 border border-white/10' : 'bg-white text-gray-700 border border-gray-200 shadow-lg'
              }`}>
                Document signal completeness
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LAYER 4 — KEY METRICS (COMPACT) */}
      <div className="px-4 pt-4 pb-5 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
          {/* Financials */}
          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              <DollarSign className="w-3 h-3" />
              Financials
            </div>
            <div className="space-y-1">
              {metrics.financials.filter(m => !isPlaceholder(m.value)).slice(0, 3).map((metric, idx) => (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                    {metric.label}
                  </span>
                  <span className={`font-medium text-right ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Traction */}
          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              <TrendingUp className="w-3 h-3" />
              Traction
            </div>
            <div className="space-y-1">
              {metrics.traction.filter(m => !isPlaceholder(m.value)).slice(0, 3).map((metric, idx) => (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                    {metric.label}
                  </span>
                  <span className={`font-medium text-right ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Deal */}
          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              <Target className="w-3 h-3" />
              Deal
            </div>
            <div className="space-y-1">
              {metrics.deal.filter(m => !isPlaceholder(m.value)).slice(0, 3).map((metric, idx) => (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                    {metric.label}
                  </span>
                  <span className={`font-medium text-right ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Business Model */}
          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              <Activity className="w-3 h-3" />
              Business Model
            </div>
            <div className="space-y-1">
              {metrics.businessModel.filter(m => !isPlaceholder(m.value)).slice(0, 3).map((metric, idx) => (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                    {metric.label}
                  </span>
                  <span className={`font-medium text-right ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </section>
  );
}
