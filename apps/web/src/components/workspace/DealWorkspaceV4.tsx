import { useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  XCircle,
  TrendingUp,
  DollarSign,
  Calendar,
  Users,
  Target,
  Shield,
  Activity,
} from 'lucide-react';
import { Button } from '../ui/button';
import type {
  WorkspaceRedesignedShellProps,
  FinancialTile,
} from './WorkspaceRedesignedShell';

// ─── Props ────────────────────────────────────────────────────────────────────

export type DealWorkspaceV4Props = WorkspaceRedesignedShellProps & {
  /** Strength strings used as "Key Drivers" (from filteredStrengths in buildWorkspaceViewModel). */
  keyDrivers?: string[];
  /** Navigate back (e.g. to deals list). Optional when embedded as a tab. */
  onBack?: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLastAnalyzed(isoString: string | null): string | null {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function findTile(tiles: FinancialTile[], label: string): FinancialTile {
  return (
    tiles.find((t) => t.label === label) ?? {
      label,
      value: '—',
      trust: 'not_extracted' as const,
      nullReason: 'Not extracted',
    }
  );
}

function splitIntoParas(body: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function mapPosture(posture: string | null): 'Proceed' | 'Caution' | 'Pass' | null {
  if (!posture) return null;
  const p = posture.toUpperCase();
  if (p === 'INVEST') return 'Proceed';
  if (p === 'CONSIDER') return 'Caution';
  if (p === 'PASS' || p === 'HARD_PASS') return 'Pass';
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DealWorkspaceV4({
  darkMode,
  // identity
  companyName,
  dealType,
  stage,
  raise,
  raiseNullRule,
  lastAnalyzedAt,
  // conviction
  convictionScore,
  convictionBand: _convictionBand,
  convictionPosture,
  investmentSnapshotBody,
  // key facts
  product,
  market,
  businessModel,
  raiseTerms,
  // financial
  financialTiles,
  financialCoverage,
  financialIntegrityStatus,
  // risk
  redFlags,
  openQuestions,
  contradictions,
  blockerCount: _blockerCount,
  underwritingReadiness: _underwritingReadiness,
  // detail rows
  teamHighlights,
  useOfFunds,
  projectPipeline,
  revenueModel,
  // workbench
  deepDiveReady,
  insightsReady,
  // callbacks
  onBack,
  onRunAnalysis,
  onOpenDeepDive,
  onOpenInsights,
  onOpenEvidenceExplorer,
  // extra
  keyDrivers,
}: DealWorkspaceV4Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    team: false,
    funds: false,
    pipeline: false,
    revenue: false,
    deepDive: false,
    insights: false,
    evidence: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // ── Derived display values ───────────────────────────────────────────────

  const displayCompany = companyName ?? 'Not extracted';
  const displayDealType = dealType ?? 'Not available';
  const displayStage = stage ?? 'Not available';
  const displayRaise = raise ?? (raiseNullRule ? 'Not disclosed' : 'Not available');
  const displayLastAnalyzed = formatLastAnalyzed(lastAnalyzedAt);

  const recommendation = mapPosture(convictionPosture);
  const investmentParas = splitIntoParas(investmentSnapshotBody);
  const activeKeyDrivers = (keyDrivers ?? []).filter(Boolean);

  const revenueTile = findTile(financialTiles, 'Revenue / ARR');
  const burnTile = findTile(financialTiles, 'Monthly Burn');
  const runwayTile = findTile(financialTiles, 'Runway');

  const showIntegrityBadge =
    financialIntegrityStatus && financialIntegrityStatus !== 'validated';
  const showCoverageBadge =
    financialCoverage !== null && financialCoverage < 80;

  const hasTeam = teamHighlights.length > 0;
  const hasUoF = useOfFunds.length > 0;
  const hasPipeline = projectPipeline.length > 0;
  const hasRevenueModel =
    Boolean(revenueModel.type) || Boolean(revenueModel.unitEconomics) || Boolean(revenueModel.detail);

  // Adapt contradictions (string[]) → structured items for V4 rendering
  const contradictionItems = contradictions.map((text) => ({ severity: 'low' as const, text }));

  // ── Styling helpers ──────────────────────────────────────────────────────

  const getRecommendationColor = (rec: 'Proceed' | 'Caution' | 'Pass' | null) => {
    if (rec === 'Proceed') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (rec === 'Caution') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (rec === 'Pass') return 'bg-red-500/10 text-red-400 border-red-500/20';
    return darkMode
      ? 'bg-white/5 text-gray-400 border-white/10'
      : 'bg-gray-100 text-gray-500 border-gray-200';
  };

  const getConvictionColor = (score: number | null) => {
    if (score === null) return darkMode ? 'text-gray-500' : 'text-gray-400';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    if (severity === 'high') return 'text-red-400 bg-red-400/10 border-red-500/20';
    if (severity === 'medium') return 'text-amber-400 bg-amber-400/10 border-amber-500/20';
    return 'text-gray-400 bg-gray-400/10 border-gray-500/20';
  };

  const card = darkMode ? 'bg-white/[0.02] border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const sectionLabel = darkMode ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className={`w-full ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>

      {/* Sticky Identity Strip */}
      <div
        className={`sticky top-0 z-10 px-6 py-3 border-b backdrop-blur-xl ${
          darkMode
            ? 'bg-[#0a0a0a]/95 border-white/10'
            : 'bg-gray-50/95 border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                }`}
              >
                <ArrowLeft className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <h1 className={`text-base font-medium ${heading}`}>{displayCompany}</h1>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayDealType}</span>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayStage}</span>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayRaise}</span>
              {displayLastAnalyzed && (
                <>
                  <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
                  <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    Analyzed {displayLastAnalyzed}
                  </span>
                </>
              )}
            </div>
          </div>


        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {onRunAnalysis && (
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              className="gap-1.5"
              onClick={onRunAnalysis}
            >
              <Sparkles className="w-4 h-4" />
              Re-run Analysis
            </Button>
          </div>
        )}

        {/* Decision Layer (Above the Fold) */}
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6">

          {/* LEFT: Investment Snapshot */}
          <div className="space-y-4">
            <h2 className={`text-sm font-medium ${sectionLabel}`}>Investment Snapshot</h2>
            <div className="space-y-3">
              {investmentParas.length > 0 ? (
                investmentParas.map((para, idx) => (
                  <p key={idx} className={`text-sm leading-relaxed ${body}`}>
                    {para}
                  </p>
                ))
              ) : (
                <p className={`text-sm ${muted} italic`}>Investment thesis not yet available.</p>
              )}
            </div>
          </div>

          {/* RIGHT: Conviction + Recommendation + Key Drivers */}
          <div className="space-y-5">

            {/* Conviction Score */}
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className={`text-xs uppercase tracking-wide mb-2 ${muted}`}>
                Conviction Score
              </div>
              <div className={`text-4xl font-medium mb-1 ${getConvictionColor(convictionScore)}`}>
                {convictionScore !== null ? convictionScore : '—'}
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                {convictionScore !== null ? 'out of 100' : 'Not extracted'}
              </div>
            </div>

            {/* Recommendation */}
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className={`text-xs uppercase tracking-wide mb-3 ${muted}`}>
                Recommendation
              </div>
              <div
                className={`px-3 py-1.5 rounded-full border text-xs font-medium uppercase tracking-wide inline-block ${getRecommendationColor(recommendation)}`}
              >
                {recommendation ?? 'Not available'}
              </div>
            </div>

            {/* Key Drivers (shown only when present) */}
            {activeKeyDrivers.length > 0 && (
              <div>
                <div className={`text-xs uppercase tracking-wide mb-3 ${muted}`}>Key Drivers</div>
                <div className="space-y-2">
                  {activeKeyDrivers.slice(0, 5).map((driver, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div
                        className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                          darkMode ? 'bg-emerald-400' : 'bg-emerald-500'
                        }`}
                      />
                      <span className={`text-xs ${sectionLabel}`}>{driver}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Key Facts Grid (2×2) */}
        <div>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Key Facts</h2>
          <div className="grid grid-cols-2 gap-4">

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <Target className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Product</div>
              </div>
              <div className={`text-sm ${product.value && product.value !== '—' ? heading : muted}`}>
                {product.value && product.value !== '—' ? product.value : 'Not extracted'}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <TrendingUp className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Market</div>
              </div>
              <div className={`text-sm ${market.value && market.value !== '—' ? heading : muted}`}>
                {market.value && market.value !== '—' ? market.value : 'Not extracted'}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <Activity className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Business Model</div>
              </div>
              <div className={`text-sm ${businessModel.value && businessModel.value !== '—' ? heading : muted}`}>
                {businessModel.value && businessModel.value !== '—' ? businessModel.value : 'Not extracted'}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <DollarSign className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Raise Terms</div>
              </div>
              <div className={`text-sm ${raiseTerms.value && raiseTerms.value !== '—' ? heading : muted}`}>
                {raiseTerms.value && raiseTerms.value !== '—' ? raiseTerms.value : 'Not extracted'}
              </div>
            </div>
          </div>
        </div>

        {/* Risk Assessment (only rendered when there is risk content) */}
        {(redFlags.length > 0 || contradictionItems.length > 0 || openQuestions.length > 0) && (
          <div>
            <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Risk Assessment</h2>
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className="space-y-4">

                {redFlags.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Red Flags</h3>
                    </div>
                    <div className="space-y-2">
                      {redFlags.map((flag, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${getSeverityColor(flag.severity)}`}>
                            {flag.severity}
                          </div>
                          <span className={`text-sm flex-1 ${body}`}>{flag.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {contradictionItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-4 h-4 text-amber-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Contradictions</h3>
                    </div>
                    <div className="space-y-2">
                      {contradictionItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${getSeverityColor(item.severity)}`}>
                            {item.severity}
                          </div>
                          <span className={`text-sm flex-1 ${body}`}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {openQuestions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-gray-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Open Questions</h3>
                    </div>
                    <div className="space-y-1.5">
                      {openQuestions.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`w-1 h-1 rounded-full mt-2 shrink-0 ${darkMode ? 'bg-gray-600' : 'bg-gray-400'}`} />
                          <span className={`text-sm ${sectionLabel}`}>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Financial Snapshot (Horizontal Strip) */}
        <div>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Financial Snapshot</h2>
          <div className="flex items-center gap-3 flex-wrap">

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Revenue / ARR</div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${revenueTile.value !== '—' ? heading : muted}`}>
                  {revenueTile.value}
                </span>
                {revenueTile.value !== '—' && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
            </div>

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Burn Rate</div>
              <span className={`text-sm font-medium ${burnTile.value !== '—' ? heading : muted}`}>
                {burnTile.value}
              </span>
            </div>

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Runway</div>
              <span className={`text-sm font-medium ${runwayTile.value !== '—' ? heading : muted}`}>
                {runwayTile.value}
              </span>
            </div>

            {showIntegrityBadge && (
              <div className={`px-4 py-3 rounded-lg border border-amber-500/20 ${darkMode ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span className={`text-xs font-medium ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                    {financialIntegrityStatus === 'partial' ? 'Partial Data' : 'Unvalidated'}
                  </span>
                </div>
              </div>
            )}

            {showCoverageBadge && (
              <div className={`px-4 py-3 rounded-lg border ${card}`}>
                <div className={`text-xs mb-1 ${muted}`}>Coverage</div>
                <span className="text-sm font-medium text-amber-400">
                  {Math.round(financialCoverage!)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Team Highlights (collapsible, only when data present) */}
        {hasTeam && (
          <div>
            <button
              onClick={() => toggleSection('team')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <h2 className="text-sm font-medium">Team Highlights</h2>
              </div>
              {expandedSections.team ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.team && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-3">
                  {teamHighlights.map((member, idx) => (
                    <div key={idx}>
                      <div className={`text-xs font-medium mb-1 ${sectionLabel}`}>{member.role}</div>
                      <div className={`text-sm ${body}`}>
                        <span className="font-medium">{member.name}</span>
                        {member.credential && (
                          <span className={`block text-xs mt-0.5 ${muted}`}>{member.credential}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Use of Funds (collapsible, only when data present) */}
        {hasUoF && (
          <div>
            <button
              onClick={() => toggleSection('funds')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <h2 className="text-sm font-medium">Use of Funds</h2>
              </div>
              {expandedSections.funds ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.funds && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-2">
                  {useOfFunds.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className={`text-sm ${body}`}>{item.category}</span>
                      {item.amountLabel && (
                        <span className={`text-xs font-medium ${heading}`}>{item.amountLabel}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Project Pipeline (collapsible, only when data present) */}
        {hasPipeline && (
          <div>
            <button
              onClick={() => toggleSection('pipeline')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <h2 className="text-sm font-medium">Project Pipeline</h2>
              </div>
              {expandedSections.pipeline ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.pipeline && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-2">
                  {projectPipeline.map((item, idx) => (
                    <div key={idx} className={`pb-2 border-b last:border-0 last:pb-0 ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
                      <span className={`text-sm font-medium ${body}`}>{item.name}</span>
                      <div className={`flex flex-wrap gap-3 text-xs mt-0.5 ${muted}`}>
                        {item.startDate && <span>Start: {item.startDate}</span>}
                        {item.capitalLabel && <span>Capital: {item.capitalLabel}</span>}
                        {item.revenueLabel && <span>Revenue: {item.revenueLabel}</span>}
                        {item.returnPct && <span>Return: {item.returnPct}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Revenue Model (collapsible, only when data present) */}
        {hasRevenueModel && (
          <div>
            <button
              onClick={() => toggleSection('revenue')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                <h2 className="text-sm font-medium">Revenue Model</h2>
              </div>
              {expandedSections.revenue ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.revenue && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-3">
                  {revenueModel.type && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Model Type</div>
                      <div className={`text-sm font-medium ${heading}`}>{revenueModel.type}</div>
                    </div>
                  )}
                  {revenueModel.unitEconomics && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Unit Economics</div>
                      <div className={`text-sm ${body}`}>{revenueModel.unitEconomics}</div>
                    </div>
                  )}
                  {revenueModel.detail && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Detail</div>
                      <div className={`text-sm ${body}`}>{revenueModel.detail}</div>
                    </div>
                  )}
                  {revenueModel.recurring !== null && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Recurring</div>
                      <div className={`text-sm font-medium ${heading}`}>
                        {revenueModel.recurring ? 'Yes' : 'No'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workbench Section */}
        <div className={`pt-6 border-t ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Workbench</h2>
          <div className="space-y-3">

            {/* Deep Dive Panel */}
            <button
              onClick={() => { toggleSection('deepDive'); if (onOpenDeepDive) onOpenDeepDive(); }}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-colors ${
                darkMode
                  ? 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Search className={`w-4 h-4 ${sectionLabel}`} />
                <div className="text-left">
                  <div className={`text-sm font-medium ${heading}`}>Deep Dive Panel</div>
                  <div className={`text-xs ${muted}`}>
                    {deepDiveReady ? 'Section-by-section analysis available' : 'Run specific analyses on team, market, product'}
                  </div>
                </div>
              </div>
              {expandedSections.deepDive ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
            </button>

            {/* Investor Insights */}
            <button
              onClick={() => { toggleSection('insights'); if (onOpenInsights) onOpenInsights(); }}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-colors ${
                darkMode
                  ? 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Sparkles className={`w-4 h-4 ${sectionLabel}`} />
                <div className="text-left">
                  <div className={`text-sm font-medium ${heading}`}>Investor Insights Diagnostics</div>
                  <div className={`text-xs ${muted}`}>
                    {insightsReady ? 'AI-powered analysis ready' : 'AI-powered professional perspective analysis'}
                  </div>
                </div>
              </div>
              {expandedSections.insights ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
            </button>

            {/* Evidence Explorer */}
            <button
              onClick={() => { toggleSection('evidence'); if (onOpenEvidenceExplorer) onOpenEvidenceExplorer(); }}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-colors ${
                darkMode
                  ? 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <FileText className={`w-4 h-4 ${sectionLabel}`} />
                <div className="text-left">
                  <div className={`text-sm font-medium ${heading}`}>Evidence Explorer</div>
                  <div className={`text-xs ${muted}`}>Review source documents and data extractions</div>
                </div>
              </div>
              {expandedSections.evidence ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
