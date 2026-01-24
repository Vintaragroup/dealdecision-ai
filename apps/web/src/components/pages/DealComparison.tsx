import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Button } from '../ui/button';
import {
  ArrowLeft,
  Plus,
  X,
  Download,
  TrendingUp,
  Users,
  DollarSign,
  Rocket,
  AlertTriangle,
  Target,
  CheckCircle,
  XCircle,
  Award,
  Zap,
  BarChart3,
  PieChart as PieChartIcon,
  TrendingDown,
  Crown,
  Filter
} from 'lucide-react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { apiGetDeals } from '../../lib/apiClient';

interface DealComparisonProps {
  darkMode: boolean;
  onBack?: () => void;
}

type ComparisonRecommendation = 'strong-proceed' | 'proceed' | 'caution' | 'pass';

type ScoreBreakdownSectionKey = 'market' | 'product' | 'business_model' | 'traction' | 'risks' | 'team' | 'terms' | 'icp';

const SCORE_SECTION_LABEL: Record<ScoreBreakdownSectionKey, string> = {
  market: 'Market',
  product: 'Product',
  business_model: 'Business model',
  traction: 'Traction',
  risks: 'Risks',
  team: 'Team',
  terms: 'Terms',
  icp: 'ICP',
};

type ComparisonDeal = {
  id: string;
  name: string;
  stage: string;
  overallScore: number;
  grade: string;
  recommendation: ComparisonRecommendation;
  strengths: string[];
  weaknesses: string[];
  // Evidence defensibility / trace coverage (0-100), derived from execV2.score_breakdown_v1.
  evidenceCoverageBySection: Partial<Record<ScoreBreakdownSectionKey, number>>;
  // Keep original deal around for future deep linking.
  raw: any;
};

function normalizeStageLabel(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || '—';
}

function normalizeScore(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function gradeFromScore(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs Improvement';
}

function recommendationFromScore(score: number): ComparisonRecommendation {
  if (score >= 85) return 'strong-proceed';
  if (score >= 70) return 'proceed';
  if (score >= 55) return 'caution';
  return 'pass';
}

function toStringArray(raw: unknown, maxItems = 5): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractEvidenceCoverage(deal: any): Partial<Record<ScoreBreakdownSectionKey, number>> {
  const execV2 = deal?.ui?.executiveSummaryV2 ?? deal?.executive_summary_v2 ?? deal?.phase1?.executive_summary_v2;
  const breakdown = execV2?.score_breakdown_v1;
  const sections = Array.isArray(breakdown?.sections) ? breakdown.sections : [];
  const out: Partial<Record<ScoreBreakdownSectionKey, number>> = {};

  for (const s of sections) {
    const key = (s?.key ?? s?.section_key) as ScoreBreakdownSectionKey | undefined;
    if (!key) continue;

    const pctRaw =
      s?.node_trace_coverage_pct ??
      s?.trace_coverage_pct ??
      s?.node_coverage_pct ??
      s?.coverage_pct;
    const pct = typeof pctRaw === 'number' && Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.round(pctRaw))) : undefined;
    if (pct != null) out[key] = pct;
  }

  return out;
}

const DEAL_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'] as const;

function getScoreColor(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#3b82f6';
  if (score >= 55) return '#f59e0b';
  return '#ef4444';
}

function getRecommendationConfig(recommendation: ComparisonRecommendation) {
  switch (recommendation) {
    case 'strong-proceed':
      return { label: 'Strong proceed', color: '#10b981', icon: CheckCircle };
    case 'proceed':
      return { label: 'Proceed', color: '#3b82f6', icon: TrendingUp };
    case 'caution':
      return { label: 'Caution', color: '#f59e0b', icon: AlertTriangle };
    case 'pass':
    default:
      return { label: 'Pass', color: '#ef4444', icon: XCircle };
  }
}

export function DealComparison({ darkMode, onBack }: DealComparisonProps) {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDeals, setAvailableDeals] = useState<ComparisonDeal[]>([]);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [showDealSelector, setShowDealSelector] = useState(false);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const deals = await apiGetDeals();
      const normalized = Array.isArray(deals) ? deals : [];
      const mapped: ComparisonDeal[] = normalized
        .map((d: any) => {
          const id = String(d?.id ?? d?.deal_id ?? '');
          if (!id) return null;

          const name = typeof d?.name === 'string' && d.name.trim().length > 0 ? d.name.trim() : 'Deal';
          const stage = normalizeStageLabel(d?.stage);
          const overallScore = normalizeScore(d?.score ?? d?.overall_score);
          const grade = gradeFromScore(overallScore);
          const recommendation = recommendationFromScore(overallScore);

          const execV2 = d?.ui?.executiveSummaryV2 ?? d?.executive_summary_v2 ?? d?.phase1?.executive_summary_v2;
          const strengths = toStringArray(execV2?.highlights, 5);
          const weaknesses = toStringArray(execV2?.missing, 5);
          const evidenceCoverageBySection = extractEvidenceCoverage(d);

          return {
            id,
            name,
            stage,
            overallScore,
            grade,
            recommendation,
            strengths,
            weaknesses,
            evidenceCoverageBySection,
            raw: d,
          };
        })
        .filter(Boolean) as ComparisonDeal[];

      setAvailableDeals(mapped);
      setSelectedDealIds((prev) => {
        const stillValid = prev.filter((id) => mapped.some((d) => d.id === id));
        if (stillValid.length >= 2) return stillValid.slice(0, 4);
        return mapped.slice(0, 2).map((d) => d.id);
      });
    } catch (e) {
      setAvailableDeals([]);
      setSelectedDealIds([]);
      setError(e instanceof Error ? e.message : 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn || !orgId) {
      setLoading(false);
      setError(null);
      setAvailableDeals([]);
      setSelectedDealIds([]);
      return;
    }
    void loadDeals();
  }, [authLoaded, isSignedIn, orgId, loadDeals]);

  const selectedDeals = useMemo(() => {
    const byId = new Map(availableDeals.map((d) => [d.id, d] as const));
    return selectedDealIds.map((id) => byId.get(id)).filter(Boolean) as ComparisonDeal[];
  }, [availableDeals, selectedDealIds]);

  const addDeal = (deal: ComparisonDeal) => {
    setSelectedDealIds((prev) => {
      if (prev.length >= 4) return prev;
      if (prev.includes(deal.id)) return prev;
      return [...prev, deal.id];
    });
    setShowDealSelector(false);
  };

  const removeDeal = (dealId: string) => {
    setSelectedDealIds((prev) => (prev.length > 1 ? prev.filter((id) => id !== dealId) : prev));
  };

  const evidenceKeysToCompare = useMemo((): ScoreBreakdownSectionKey[] => {
    const keys: ScoreBreakdownSectionKey[] = ['market', 'product', 'business_model', 'traction', 'risks', 'team', 'terms', 'icp'];
    if (selectedDeals.length === 0) return [];
    return keys.filter((k) => selectedDeals.every((d) => typeof d.evidenceCoverageBySection[k] === 'number'));
  }, [selectedDeals]);

  const radarData = useMemo(() => {
    return evidenceKeysToCompare.map((key) => ({
      category: SCORE_SECTION_LABEL[key],
      ...selectedDeals.reduce((acc, deal, i) => ({
        ...acc,
        [`deal${i}`]: deal.evidenceCoverageBySection[key] ?? 0,
      }), {}),
    }));
  }, [evidenceKeysToCompare, selectedDeals]);

  const winner = selectedDeals.length > 0
    ? selectedDeals.reduce((prev, current) => (current.overallScore > prev.overallScore ? current : prev))
    : null;

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      <div className={`border-b px-6 py-4 ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={onBack}
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Back
            </Button>
            <div>
              <h1 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>Deal Comparison</h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Compare {selectedDeals.length} deals side-by-side
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" darkMode={darkMode} icon={<Download className="w-4 h-4" />} disabled>
              Export Comparison
            </Button>
            <Button variant="outline" size="sm" darkMode={darkMode} onClick={loadDeals} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {error && (
            <div className={`p-4 rounded-xl border ${darkMode ? 'bg-red-500/10 border-red-500/20 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {error}
            </div>
          )}

          {!loading && availableDeals.length === 0 && !error && (
            <div className={`p-6 rounded-xl border ${darkMode ? 'bg-[#18181b] border-white/10 text-gray-300' : 'bg-white border-gray-200 text-gray-700'}`}>
              No deals available to compare.
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            {selectedDeals.map((deal, index) => {
              const recConfig = getRecommendationConfig(deal.recommendation);
              const RecIcon = recConfig.icon;

              return (
                <div
                  key={deal.id}
                  className={`p-4 rounded-xl border-2 relative ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}
                  style={{ borderColor: DEAL_COLORS[index] + '40' }}
                >
                  {winner && deal.id === winner.id && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs flex items-center gap-1"
                      style={{ backgroundColor: DEAL_COLORS[index], color: 'white' }}
                    >
                      <Crown className="w-3 h-3" />
                      Top Pick
                    </div>
                  )}

                  <button
                    onClick={() => removeDeal(deal.id)}
                    className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      darkMode ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-red-100 hover:bg-red-200 text-red-600'
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>

                  <div className="mb-3">
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{deal.name}</h3>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{deal.stage}</div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-center">
                      <div className="text-3xl" style={{ color: getScoreColor(deal.overallScore) }}>
                        {deal.overallScore}
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>/ 100</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{deal.grade}</div>
                      <div
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs mt-1"
                        style={{ backgroundColor: recConfig.color + '20', color: recConfig.color }}
                      >
                        <RecIcon className="w-3 h-3" />
                        {recConfig.label}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {selectedDeals.length < 4 && (
              <button
                onClick={() => setShowDealSelector(true)}
                className={`p-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors ${
                  darkMode
                    ? 'bg-[#18181b] border-white/20 hover:border-white/30 hover:bg-white/5'
                    : 'bg-white border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Plus className={`w-8 h-8 mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Add deal</span>
              </button>
            )}
          </div>

          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
            <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Overall Score Comparison</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={selectedDeals.map((deal) => ({ name: deal.name, score: deal.overallScore }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff20' : '#00000010'} />
                <XAxis dataKey="name" stroke={darkMode ? '#ffffff60' : '#00000060'} />
                <YAxis stroke={darkMode ? '#ffffff60' : '#00000060'} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? '#27272a' : '#ffffff',
                    border: `1px solid ${darkMode ? '#ffffff20' : '#e5e7eb'}`,
                    borderRadius: '8px',
                    color: darkMode ? '#ffffff' : '#000000'
                  }}
                />
                <Bar dataKey="score" radius={[8, 8, 0, 0]}>
                  {selectedDeals.map((deal, i) => (
                    <Cell key={deal.id} fill={DEAL_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
            <h2 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Evidence Coverage by Category</h2>
            <p className={`text-xs mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Uses Phase 1 score trace coverage when available (not a performance score).
            </p>

            {evidenceKeysToCompare.length === 0 ? (
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                No evidence coverage data available yet for the selected deals.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={darkMode ? '#ffffff20' : '#00000020'} />
                  <PolarAngleAxis
                    dataKey="category"
                    stroke={darkMode ? '#ffffff60' : '#00000060'}
                    tick={{ fill: darkMode ? '#ffffff80' : '#00000080' }}
                  />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} stroke={darkMode ? '#ffffff40' : '#00000040'} />
                  {selectedDeals.map((deal, i) => (
                    <Radar
                      key={deal.id}
                      name={deal.name}
                      dataKey={`deal${i}`}
                      stroke={DEAL_COLORS[i]}
                      fill={DEAL_COLORS[i]}
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  ))}
                  <Legend wrapperStyle={{ color: darkMode ? '#ffffff' : '#000000', paddingTop: '20px' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: darkMode ? '#27272a' : '#ffffff',
                      border: `1px solid ${darkMode ? '#ffffff20' : '#e5e7eb'}`,
                      borderRadius: '8px',
                      color: darkMode ? '#ffffff' : '#000000'
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className={`p-6 rounded-xl border ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
              <h2 className={`text-lg mb-4 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                Strengths
              </h2>
              <div className="space-y-4">
                {selectedDeals.map((deal, i) => (
                  <div key={deal.id}>
                    <div className="text-sm mb-2" style={{ color: DEAL_COLORS[i] }}>
                      {deal.name}
                    </div>
                    {deal.strengths.length === 0 ? (
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>—</div>
                    ) : (
                      <ul className="space-y-2">
                        {deal.strengths.map((s, idx) => (
                          <li key={idx} className={`text-sm flex items-start gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className={`p-6 rounded-xl border ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
              <h2 className={`text-lg mb-4 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Gaps / Unknowns
              </h2>
              <div className="space-y-4">
                {selectedDeals.map((deal, i) => (
                  <div key={deal.id}>
                    <div className="text-sm mb-2" style={{ color: DEAL_COLORS[i] }}>
                      {deal.name}
                    </div>
                    {deal.weaknesses.length === 0 ? (
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>—</div>
                    ) : (
                      <ul className="space-y-2">
                        {deal.weaknesses.map((w, idx) => (
                          <li key={idx} className={`text-sm flex items-start gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDealSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-2xl rounded-2xl shadow-2xl ${darkMode ? 'bg-[#18181b]' : 'bg-white'}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Select Deal to Compare</h2>
              <button
                onClick={() => setShowDealSelector(false)}
                className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
              >
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            </div>

            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {availableDeals
                .filter((deal) => !selectedDeals.find((d) => d.id === deal.id))
                .map((deal) => {
                  const recConfig = getRecommendationConfig(deal.recommendation);
                  const RecIcon = recConfig.icon;
                  return (
                    <button
                      key={deal.id}
                      onClick={() => addDeal(deal)}
                      className={`w-full p-4 rounded-lg border text-left transition-colors ${
                        darkMode
                          ? 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{deal.name}</h3>
                          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{deal.stage}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl" style={{ color: getScoreColor(deal.overallScore) }}>
                            {deal.overallScore}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>/ 100</div>
                        </div>
                      </div>
                      <div
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: recConfig.color + '20', color: recConfig.color }}
                      >
                        <RecIcon className="w-3 h-3" />
                        {recConfig.label}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
