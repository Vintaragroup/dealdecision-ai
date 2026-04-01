/**
 * AnalysisSnapshotDashboard
 *
 * Renders the local-scoring snapshot UI for the AI Analysis tab.
 * Receives pre-computed DealAnalysis data and action callbacks.
 * Owns its own interactive UX state (category selection, deep analysis perspective, toasts).
 *
 * Used by:
 *   - AnalysisTab (dealId path): snapshot visible in tab; full report in modal via onViewFullReport
 *   - AnalysisTab (local fallback path): standalone with onExportReport → ProfessionalReportGenerator
 */
import { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lightbulb,
  Award,
  ArrowUp,
  ChevronRight,
  Zap,
  FileText,
  Scale,
  Megaphone,
  TrendingDown,
  Briefcase,
} from 'lucide-react';
import { Button } from '../../ui/button';
import type { DealFormData } from '../../Modal_Legacy/NewDealModal';
import { useUserRole } from '../../../contexts/UserRoleContext';
import { ToastContainer } from '../../ui/Toast';
import { useLocalToasts } from '../../../lib/useLocalToasts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CategoryScore {
  name: string;
  score: number;
  maxScore: number;
  /** A Lucide icon component reference — set by analyzeDeal in AnalysisTab */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  color: string;
  issues: string[];
  strengths: string[];
  recommendations: string[];
}

export interface DealAnalysis {
  overallScore: number;
  previousScore: number | null;
  /**
   * Grade string displayed in the snapshot.
   * Local scoring produces: 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement'.
   * When an orchestrator report is available the overlay mapper sets this to
   * the canonical decision label: 'GO' | 'CONSIDER' | 'NO_GO'.
   */
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'GO' | 'CONSIDER' | 'NO_GO';
  completeness: number;
  categories: CategoryScore[];
  redFlags: { severity: 'high' | 'medium' | 'low'; message: string; action: string }[];
  greenFlags: string[];
  quickWins: { title: string; impact: number; effort: 'low' | 'medium' | 'high' }[];
  achievements: { id: string; title: string; unlocked: boolean }[];
}

export interface AnalysisSnapshotDashboardProps {
  darkMode: boolean;
  analysis: DealAnalysis;
  dealData: DealFormData;
  /** Called when the "Export Report" button is pressed */
  onExportReport: () => void;
  /** Called when the "Re-analyze" button is pressed */
  onReanalyze: () => void;
  /** When true, the Re-analyze button shows a loading spinner and is disabled */
  isReanalyzing?: boolean;
  /**
   * When provided, a "View Full Report" button appears in the header.
   * Used in the dealId path to open the OrchestratorFullReportView modal.
   */
  onViewFullReport?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#3b82f6';
  if (score >= 55) return '#f59e0b';
  return '#ef4444';
}

function getGradeEmoji(grade: string): string {
  switch (grade) {
    case 'Excellent': return '🏆';
    case 'Good': return '✅';
    case 'Fair': return '⚠️';
    default: return '🔴';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalysisSnapshotDashboard({
  darkMode,
  analysis,
  dealData,
  onExportReport,
  onReanalyze,
  isReanalyzing = false,
  onViewFullReport,
}: AnalysisSnapshotDashboardProps) {
  const userRole = useUserRole();
  const { toasts, addToast, removeToast } = useLocalToasts();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPerspective, setSelectedPerspective] = useState<string | null>(null);
  const [runningDeepAnalysis, setRunningDeepAnalysis] = useState(false);

  const selectedCat = analysis.categories.find(c => c.name === selectedCategory);

  return (
    <div className="space-y-6">
      {/* Header with Overall Score */}
      <div className={`p-6 rounded-2xl border ${
        darkMode
          ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
          : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
      }`}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Deal Analysis
              </h2>
              <span className="text-2xl">{getGradeEmoji(analysis.grade)}</span>
            </div>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              AI-powered due diligence analysis for {dealData.companyName}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={onReanalyze}
              disabled={isReanalyzing}
              loading={isReanalyzing}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Re-analyze
            </Button>
            {onViewFullReport && (
              <Button
                variant="outline"
                size="sm"
                darkMode={darkMode}
                onClick={onViewFullReport}
                icon={<FileText className="w-4 h-4" />}
              >
                View Full Report
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              onClick={onExportReport}
              icon={<Download className="w-4 h-4" />}
            >
              Export Report
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Overall Score */}
          <div className="text-center">
            <div className="relative w-32 h-32 mx-auto mb-3">
              <svg className="transform -rotate-90 w-32 h-32">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className={darkMode ? 'text-white/10' : 'text-gray-200'}
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke={getScoreColor(analysis.overallScore)}
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${(analysis.overallScore / 100) * 351.86} 351.86`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {analysis.overallScore}
                </span>
                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  / 100
                </span>
              </div>
            </div>
            <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Snapshot Score
            </p>
            <p className="text-xs mt-1" style={{ color: getScoreColor(analysis.overallScore) }}>
              {analysis.grade}
            </p>
          </div>

          {/* Completeness */}
          <div className="text-center">
            <div className="relative w-32 h-32 mx-auto mb-3">
              <svg className="transform -rotate-90 w-32 h-32">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className={darkMode ? 'text-white/10' : 'text-gray-200'}
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="#8b5cf6"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${(analysis.completeness / 100) * 351.86} 351.86`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {analysis.completeness}%
                </span>
              </div>
            </div>
            <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Profile Complete
            </p>
            <p className="text-xs mt-1 text-[#8b5cf6]">
              {analysis.completeness < 80 ? 'Keep going!' : 'Well done!'}
            </p>
          </div>

          {/* Achievements */}
          <div className="space-y-2">
            <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Achievements
            </p>
            {analysis.achievements.map(achievement => (
              <div
                key={achievement.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  achievement.unlocked
                    ? darkMode
                      ? 'bg-[#10b981]/20 border border-[#10b981]/30'
                      : 'bg-[#10b981]/10 border border-[#10b981]/20'
                    : darkMode
                      ? 'bg-white/5 border border-white/10'
                      : 'bg-gray-50 border border-gray-200'
                }`}
              >
                {achievement.unlocked ? (
                  <Award className="w-4 h-4 text-[#10b981]" />
                ) : (
                  <Award className={`w-4 h-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                )}
                <span className={`text-xs ${
                  achievement.unlocked
                    ? 'text-[#10b981]'
                    : darkMode ? 'text-gray-500' : 'text-gray-500'
                }`}>
                  {achievement.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category Scores */}
      <div className="grid grid-cols-3 gap-4">
        {analysis.categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.name}
              onClick={() => setSelectedCategory(category.name)}
              className={`p-4 rounded-xl border text-left transition-all ${
                selectedCategory === category.name
                  ? darkMode
                    ? 'bg-[#6366f1]/10 border-[#6366f1]'
                    : 'bg-[#6366f1]/5 border-[#6366f1]'
                  : darkMode
                    ? 'bg-[#27272a] border-white/10 hover:border-white/20'
                    : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${category.color}20` }}
                >
                  <Icon className="w-5 h-5" style={{ color: category.color }} />
                </div>
                <span
                  className="text-2xl"
                  style={{ color: getScoreColor(category.score) }}
                >
                  {category.score}
                </span>
              </div>
              <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {category.name}
              </h3>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-1000 rounded-full"
                  style={{
                    width: `${category.score}%`,
                    backgroundColor: category.color,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Category Details */}
      {selectedCat && (
        <div className={`p-6 rounded-xl border ${
          darkMode ? 'bg-[#27272a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {selectedCat.name} Details
            </h3>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={() => setSelectedCategory(null)}
            >
              Close
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Strengths */}
            {selectedCat.strengths.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Strengths
                  </h4>
                </div>
                <ul className="space-y-2">
                  {selectedCat.strengths.map((strength, i) => (
                    <li key={i} className={`text-xs flex items-start gap-2 ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      <span className="text-[#10b981] mt-0.5">•</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Issues */}
            {selectedCat.issues.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className="w-4 h-4 text-[#ef4444]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Issues
                  </h4>
                </div>
                <ul className="space-y-2">
                  {selectedCat.issues.map((issue, i) => (
                    <li key={i} className={`text-xs flex items-start gap-2 ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      <span className="text-[#ef4444] mt-0.5">•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {selectedCat.recommendations.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-[#f59e0b]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Recommendations
                  </h4>
                </div>
                <ul className="space-y-2">
                  {selectedCat.recommendations.map((rec, i) => (
                    <li key={i} className={`text-xs flex items-start gap-2 ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      <span className="text-[#f59e0b] mt-0.5">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Red Flags */}
        {analysis.redFlags.length > 0 && (
          <div className={`p-6 rounded-xl border ${
            darkMode
              ? 'bg-[#ef4444]/5 border-[#ef4444]/30'
              : 'bg-[#ef4444]/5 border-[#ef4444]/20'
          }`}>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-[#ef4444]" />
              <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Red Flags
              </h3>
            </div>
            <div className="space-y-3">
              {analysis.redFlags.map((flag, i) => (
                <div key={i} className={`p-3 rounded-lg ${
                  darkMode ? 'bg-[#27272a]' : 'bg-white'
                }`}>
                  <div className="flex items-start gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      flag.severity === 'high'
                        ? 'bg-[#ef4444] text-white'
                        : flag.severity === 'medium'
                          ? 'bg-[#f59e0b] text-white'
                          : 'bg-[#6b7280] text-white'
                    }`}>
                      {flag.severity}
                    </span>
                    <p className={`text-sm flex-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {flag.message}
                    </p>
                  </div>
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    💡 {flag.action}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Green Flags & Quick Wins */}
        <div className="space-y-6">
          {/* Green Flags */}
          {analysis.greenFlags.length > 0 && (
            <div className={`p-6 rounded-xl border ${
              darkMode
                ? 'bg-[#10b981]/5 border-[#10b981]/30'
                : 'bg-[#10b981]/5 border-[#10b981]/20'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-[#10b981]" />
                <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Green Flags
                </h3>
              </div>
              <ul className="space-y-2">
                {analysis.greenFlags.map((flag, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    <CheckCircle2 className="w-4 h-4 text-[#10b981] mt-0.5 flex-shrink-0" />
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick Wins */}
          {analysis.quickWins.length > 0 && (
            <div className={`p-6 rounded-xl border ${
              darkMode
                ? 'bg-[#f59e0b]/5 border-[#f59e0b]/30'
                : 'bg-[#f59e0b]/5 border-[#f59e0b]/20'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-[#f59e0b]" />
                <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Quick Wins
                </h3>
              </div>
              <div className="space-y-3">
                {analysis.quickWins.map((win, i) => (
                  <div key={i} className={`p-3 rounded-lg ${
                    darkMode ? 'bg-[#27272a]' : 'bg-white'
                  }`}>
                    <div className="flex items-start justify-between mb-1">
                      <p className={`text-sm flex-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {win.title}
                      </p>
                      <span className={`px-2 py-0.5 rounded text-xs ml-2 ${
                        win.effort === 'low'
                          ? 'bg-[#10b981]/20 text-[#10b981]'
                          : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                      }`}>
                        {win.effort} effort
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUp className="w-3 h-3 text-[#10b981]" />
                      <span className="text-xs text-[#10b981]">
                        +{win.impact} points potential
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CTA Section - Deep Analysis Tool (For Investors) */}
      {userRole.isInvestor && (
        <div className={`p-6 rounded-2xl border bg-gradient-to-r ${
          darkMode
            ? 'from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
            : 'from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
        }`}>
          <div className="mb-6">
            <h3 className={`text-xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              🔍 Run Deep Analysis
            </h3>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Get expert insights from different professional perspectives to uncover risks and opportunities
            </p>
          </div>

          {/* Perspective Selection */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              {
                id: 'attorney',
                name: 'Legal Attorney',
                icon: <Scale className="w-5 h-5" />,
                description: 'Compliance, IP, contracts, regulatory risks',
                color: '#ef4444',
              },
              {
                id: 'competitor',
                name: 'Competitor',
                icon: <TrendingDown className="w-5 h-5" />,
                description: 'Market threats, weaknesses, attack vectors',
                color: '#f59e0b',
              },
              {
                id: 'marketing',
                name: 'Marketing Agency',
                icon: <Megaphone className="w-5 h-5" />,
                description: 'Brand positioning, GTM strategy, messaging',
                color: '#8b5cf6',
              },
              {
                id: 'strategic',
                name: 'Strategic Advisor',
                icon: <Briefcase className="w-5 h-5" />,
                description: 'Growth strategy, partnerships, scaling',
                color: '#10b981',
              },
            ].map((perspective) => (
              <button
                key={perspective.id}
                onClick={() => setSelectedPerspective(perspective.id)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  selectedPerspective === perspective.id
                    ? darkMode
                      ? 'bg-white/10 border-[#6366f1] shadow-lg'
                      : 'bg-white border-[#6366f1] shadow-lg'
                    : darkMode
                      ? 'bg-white/5 border-white/10 hover:border-white/20'
                      : 'bg-white/50 border-gray-200 hover:border-gray-300'
                }`}
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-3"
                  style={{ backgroundColor: `${perspective.color}20` }}
                >
                  <div style={{ color: perspective.color }}>
                    {perspective.icon}
                  </div>
                </div>
                <h4 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {perspective.name}
                </h4>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {perspective.description}
                </p>
                {selectedPerspective === perspective.id && (
                  <div className="mt-3 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-[#6366f1]" />
                    <span className="text-xs text-[#6366f1]">Selected</span>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Run Button */}
          <div className="flex items-center justify-between">
            <div>
              {selectedPerspective ? (
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#6366f1]" />
                  <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Perspective selected • AI will analyze from this viewpoint
                  </span>
                </div>
              ) : (
                <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Select a perspective to begin deep analysis
                </span>
              )}
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<Zap className="w-4 h-4" />}
              disabled={!selectedPerspective}
              loading={runningDeepAnalysis}
              onClick={() => {
                setRunningDeepAnalysis(true);
                setTimeout(() => {
                  setRunningDeepAnalysis(false);
                  addToast(
                    'info',
                    'Deep analysis complete',
                    `Completed from ${selectedPerspective} perspective. (UI-only simulation)`
                  );
                }, 2500);
              }}
            >
              {runningDeepAnalysis ? 'Analyzing...' : 'Run Deep Analysis'}
            </Button>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} darkMode={darkMode} />

      {/* CTA Section - For Analysts */}
      {userRole.isAnalyst && (
        <div className={`p-6 rounded-2xl border bg-gradient-to-r ${
          darkMode
            ? 'from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
            : 'from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Ready to move toward a decision?
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Use the recommendations above to increase confidence and tighten evidence coverage
              </p>
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<ChevronRight className="w-4 h-4" />}
            >
              Next Steps
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
