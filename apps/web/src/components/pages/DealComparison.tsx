import { useState } from 'react';
import { Button } from '../ui/Button';
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';

interface DealComparisonProps {
  darkMode: boolean;
  onBack?: () => void;
}

interface ComparisonDeal {
  id: string;
  name: string;
  stage: string;
  industry: string;
  overallScore: number;
  grade: string;
  fundingAmount: string;
  scores: {
    market: number;
    team: number;
    financial: number;
    traction: number;
    risk: number;
    competitive: number;
  };
  metrics: {
    revenue: string;
    growth: string;
    teamSize: number;
    runway: string;
    customers: number;
  };
  recommendation: 'strong-proceed' | 'proceed' | 'caution' | 'pass';
  strengths: string[];
  weaknesses: string[];
}

export function DealComparison({ darkMode, onBack }: DealComparisonProps) {
  // Mock deals data - in production, this would come from API/state
  const availableDeals: ComparisonDeal[] = [
    {
      id: '1',
      name: 'TechVision AI',
      stage: 'Series A',
      industry: 'Enterprise SaaS',
      overallScore: 87,
      grade: 'Excellent',
      fundingAmount: '$5M',
      scores: { market: 92, team: 85, financial: 88, traction: 90, risk: 75, competitive: 92 },
      metrics: { revenue: '$1.2M ARR', growth: '+180% YoY', teamSize: 12, runway: '18 months', customers: 45 },
      recommendation: 'strong-proceed',
      strengths: [
        'Strong market opportunity ($12B TAM)',
        'Experienced founding team with prior exits',
        'Rapid revenue growth and customer adoption'
      ],
      weaknesses: [
        'Limited runway (18 months)',
        'Small team for market size'
      ]
    },
    {
      id: '2',
      name: 'HealthTech Pro',
      stage: 'Seed',
      industry: 'HealthTech',
      overallScore: 73,
      grade: 'Good',
      fundingAmount: '$2M',
      scores: { market: 88, team: 70, financial: 65, traction: 75, risk: 68, competitive: 72 },
      metrics: { revenue: '$350K ARR', growth: '+120% YoY', teamSize: 8, runway: '12 months', customers: 28 },
      recommendation: 'proceed',
      strengths: [
        'Large addressable market',
        'Unique regulatory moat',
        'Strong early customer traction'
      ],
      weaknesses: [
        'Limited financial track record',
        'Competitive regulatory environment',
        'Small team with limited healthcare experience'
      ]
    },
    {
      id: '3',
      name: 'FinanceFlow',
      stage: 'Series A',
      industry: 'FinTech',
      overallScore: 65,
      grade: 'Fair',
      fundingAmount: '$4M',
      scores: { market: 75, team: 60, financial: 58, traction: 70, risk: 55, competitive: 72 },
      metrics: { revenue: '$800K ARR', growth: '+95% YoY', teamSize: 10, runway: '10 months', customers: 62 },
      recommendation: 'caution',
      strengths: [
        'Good market positioning',
        'Decent customer base',
        'Clear product-market fit'
      ],
      weaknesses: [
        'High burn rate with limited runway',
        'Weak founding team credentials',
        'Significant competitive pressure',
        'Below-average revenue growth'
      ]
    },
    {
      id: '4',
      name: 'EduConnect',
      stage: 'Pre-Seed',
      industry: 'EdTech',
      overallScore: 52,
      grade: 'Needs Improvement',
      fundingAmount: '$500K',
      scores: { market: 65, team: 48, financial: 42, traction: 55, risk: 45, competitive: 58 },
      metrics: { revenue: '$50K ARR', growth: '+60% YoY', teamSize: 4, runway: '6 months', customers: 12 },
      recommendation: 'pass',
      strengths: [
        'Addressing real pain point',
        'Passionate founding team'
      ],
      weaknesses: [
        'Very limited traction and revenue',
        'Inexperienced team',
        'Crowded market with low differentiation',
        'Critical runway issues',
        'Weak unit economics'
      ]
    }
  ];

  const [selectedDeals, setSelectedDeals] = useState<ComparisonDeal[]>([
    availableDeals[0],
    availableDeals[1]
  ]);
  const [showDealSelector, setShowDealSelector] = useState(false);

  const addDeal = (deal: ComparisonDeal) => {
    if (selectedDeals.length < 4 && !selectedDeals.find(d => d.id === deal.id)) {
      setSelectedDeals([...selectedDeals, deal]);
    }
    setShowDealSelector(false);
  };

  const removeDeal = (dealId: string) => {
    if (selectedDeals.length > 1) {
      setSelectedDeals(selectedDeals.filter(d => d.id !== dealId));
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 55) return '#f59e0b';
    return '#ef4444';
  };

  const getRecommendationConfig = (rec: string) => {
    switch (rec) {
      case 'strong-proceed':
        return { label: 'Strong Proceed', color: '#10b981', icon: CheckCircle };
      case 'proceed':
        return { label: 'Proceed', color: '#3b82f6', icon: CheckCircle };
      case 'caution':
        return { label: 'Caution', color: '#f59e0b', icon: AlertTriangle };
      case 'pass':
        return { label: 'Pass', color: '#ef4444', icon: XCircle };
      default:
        return { label: 'Unknown', color: '#6b7280', icon: AlertTriangle };
    }
  };

  // Prepare radar chart data
  const radarData = [
    {
      category: 'Market',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.market }), {})
    },
    {
      category: 'Team',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.team }), {})
    },
    {
      category: 'Financial',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.financial }), {})
    },
    {
      category: 'Traction',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.traction }), {})
    },
    {
      category: 'Risk',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.risk }), {})
    },
    {
      category: 'Competitive',
      ...selectedDeals.reduce((acc, deal, i) => ({ ...acc, [`deal${i}`]: deal.scores.competitive }), {})
    }
  ];

  const dealColors = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981'];

  // Find the winner (highest overall score)
  const winner = selectedDeals.reduce((prev, current) => 
    (current.overallScore > prev.overallScore) ? current : prev
  );

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`border-b px-6 py-4 ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
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
              <h1 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Deal Comparison
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Compare {selectedDeals.length} deals side-by-side
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Download className="w-4 h-4" />}
            >
              Export Comparison
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Deal Selector Cards */}
          <div className="grid grid-cols-4 gap-4">
            {selectedDeals.map((deal, index) => {
              const recConfig = getRecommendationConfig(deal.recommendation);
              const RecIcon = recConfig.icon;
              
              return (
                <div
                  key={deal.id}
                  className={`p-4 rounded-xl border-2 relative ${
                    darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
                  }`}
                  style={{ borderColor: dealColors[index] + '40' }}
                >
                  {deal.id === winner.id && (
                    <div 
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs flex items-center gap-1"
                      style={{ backgroundColor: dealColors[index], color: 'white' }}
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
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {deal.name}
                    </h3>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {deal.stage} • {deal.industry}
                    </div>
                  </div>

                  <div className="flex items-center justify-center mb-3">
                    <div 
                      className="w-20 h-20 rounded-full border-4 flex items-center justify-center"
                      style={{ 
                        borderColor: getScoreColor(deal.overallScore),
                        backgroundColor: getScoreColor(deal.overallScore) + '10'
                      }}
                    >
                      <div className="text-center">
                        <div className="text-2xl" style={{ color: getScoreColor(deal.overallScore) }}>
                          {deal.overallScore}
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          / 100
                        </div>
                      </div>
                    </div>
                  </div>

                  <div 
                    className="text-center text-sm py-1 rounded-lg"
                    style={{ 
                      backgroundColor: recConfig.color + '20',
                      color: recConfig.color
                    }}
                  >
                    {recConfig.label}
                  </div>
                </div>
              );
            })}

            {/* Add Deal Button */}
            {selectedDeals.length < 4 && (
              <button
                onClick={() => setShowDealSelector(true)}
                className={`p-6 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-colors ${
                  darkMode 
                    ? 'border-white/20 hover:border-white/40 hover:bg-white/5' 
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Plus className={`w-8 h-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Add Deal
                </div>
              </button>
            )}
          </div>

          {/* Overall Score Comparison Bar Chart */}
          <div className={`p-6 rounded-xl border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Overall Score Comparison
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={selectedDeals.map((deal, i) => ({ 
                name: deal.name, 
                score: deal.overallScore,
                fill: dealColors[i]
              }))}>
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
                    <Bar key={deal.id} dataKey="score" fill={dealColors[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Category Radar Chart */}
          <div className={`p-6 rounded-xl border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Category Breakdown
            </h2>
            <ResponsiveContainer width="100%" height={400}>
              <RadarChart data={radarData}>
                <PolarGrid stroke={darkMode ? '#ffffff20' : '#00000020'} />
                <PolarAngleAxis 
                  dataKey="category" 
                  stroke={darkMode ? '#ffffff60' : '#00000060'}
                  tick={{ fill: darkMode ? '#ffffff80' : '#00000080' }}
                />
                <PolarRadiusAxis 
                  angle={90} 
                  domain={[0, 100]} 
                  stroke={darkMode ? '#ffffff40' : '#00000040'}
                />
                {selectedDeals.map((deal, i) => (
                  <Radar
                    key={deal.id}
                    name={deal.name}
                    dataKey={`deal${i}`}
                    stroke={dealColors[i]}
                    fill={dealColors[i]}
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                ))}
                <Legend 
                  wrapperStyle={{ 
                    color: darkMode ? '#ffffff' : '#000000',
                    paddingTop: '20px'
                  }}
                />
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
          </div>

          {/* Detailed Category Comparison */}
          <div className={`p-6 rounded-xl border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-lg mb-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Detailed Score Breakdown
            </h2>

            <div className="space-y-6">
              {[
                { key: 'market', label: 'Market Opportunity', icon: TrendingUp },
                { key: 'team', label: 'Team Strength', icon: Users },
                { key: 'financial', label: 'Financial Health', icon: DollarSign },
                { key: 'traction', label: 'Traction & Growth', icon: Rocket },
                { key: 'risk', label: 'Risk Assessment', icon: AlertTriangle },
                { key: 'competitive', label: 'Competitive Position', icon: Target }
              ].map(category => {
                const Icon = category.icon;
                return (
                  <div key={category.key}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                        {category.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      {selectedDeals.map((deal, i) => {
                        const score = deal.scores[category.key as keyof typeof deal.scores];
                        return (
                          <div key={deal.id} className={`p-3 rounded-lg ${
                            darkMode ? 'bg-white/5' : 'bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {deal.name}
                              </span>
                              <span className="text-lg" style={{ color: getScoreColor(score) }}>
                                {score}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full transition-all"
                                style={{ 
                                  width: `${score}%`,
                                  backgroundColor: dealColors[i]
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key Metrics Comparison */}
          <div className={`p-6 rounded-xl border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Key Metrics Comparison
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                    <th className={`text-left py-3 px-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Metric
                    </th>
                    {selectedDeals.map((deal, i) => (
                      <th 
                        key={deal.id} 
                        className="text-center py-3 px-4"
                        style={{ color: dealColors[i] }}
                      >
                        {deal.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'fundingAmount', label: 'Funding Amount', format: (v: any) => v },
                    { key: 'revenue', label: 'Revenue (ARR)', format: (v: any) => v },
                    { key: 'growth', label: 'Growth Rate', format: (v: any) => v },
                    { key: 'teamSize', label: 'Team Size', format: (v: any) => `${v} people` },
                    { key: 'runway', label: 'Runway', format: (v: any) => v },
                    { key: 'customers', label: 'Customers', format: (v: any) => v }
                  ].map(metric => (
                    <tr 
                      key={metric.key}
                      className={`border-b ${darkMode ? 'border-white/5' : 'border-gray-100'}`}
                    >
                      <td className={`py-3 px-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {metric.label}
                      </td>
                      {selectedDeals.map(deal => (
                        <td 
                          key={deal.id} 
                          className={`text-center py-3 px-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}
                        >
                          {metric.format(
                            metric.key === 'fundingAmount' 
                              ? deal.fundingAmount
                              : (deal.metrics as any)[metric.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-2 gap-6">
            {/* Strengths */}
            <div className={`p-6 rounded-xl border ${
              darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
            }`}>
              <h2 className={`text-lg mb-4 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                Strengths Comparison
              </h2>

              <div className="space-y-4">
                {selectedDeals.map((deal, i) => (
                  <div key={deal.id}>
                    <div 
                      className="text-sm mb-2"
                      style={{ color: dealColors[i] }}
                    >
                      {deal.name}
                    </div>
                    <ul className="space-y-2">
                      {deal.strengths.map((strength, idx) => (
                        <li 
                          key={idx}
                          className={`text-sm flex items-start gap-2 ${
                            darkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}
                        >
                          <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <span>{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Weaknesses */}
            <div className={`p-6 rounded-xl border ${
              darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
            }`}>
              <h2 className={`text-lg mb-4 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Weaknesses Comparison
              </h2>

              <div className="space-y-4">
                {selectedDeals.map((deal, i) => (
                  <div key={deal.id}>
                    <div 
                      className="text-sm mb-2"
                      style={{ color: dealColors[i] }}
                    >
                      {deal.name}
                    </div>
                    <ul className="space-y-2">
                      {deal.weaknesses.map((weakness, idx) => (
                        <li 
                          key={idx}
                          className={`text-sm flex items-start gap-2 ${
                            darkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}
                        >
                          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <span>{weakness}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Investment Recommendations */}
          <div className={`p-6 rounded-xl border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Investment Recommendations
            </h2>

            <div className="grid grid-cols-4 gap-4">
              {selectedDeals.map((deal, i) => {
                const recConfig = getRecommendationConfig(deal.recommendation);
                const RecIcon = recConfig.icon;
                
                return (
                  <div 
                    key={deal.id}
                    className="p-4 rounded-lg"
                    style={{ backgroundColor: recConfig.color + '10' }}
                  >
                    <div className="text-sm mb-2" style={{ color: dealColors[i] }}>
                      {deal.name}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <RecIcon className="w-5 h-5" style={{ color: recConfig.color }} />
                      <span className="text-lg" style={{ color: recConfig.color }}>
                        {recConfig.label}
                      </span>
                    </div>
                    <div className="text-2xl mb-1" style={{ color: recConfig.color }}>
                      {deal.overallScore}/100
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {deal.grade}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Deal Selector Modal */}
      {showDealSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-2xl rounded-2xl shadow-2xl ${
            darkMode ? 'bg-[#18181b]' : 'bg-white'
          }`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Select Deal to Compare
              </h2>
              <button
                onClick={() => setShowDealSelector(false)}
                className={`p-2 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                }`}
              >
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            </div>

            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {availableDeals
                .filter(deal => !selectedDeals.find(d => d.id === deal.id))
                .map(deal => {
                  const recConfig = getRecommendationConfig(deal.recommendation);
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
                          <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {deal.name}
                          </h3>
                          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {deal.stage} • {deal.industry}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl" style={{ color: getScoreColor(deal.overallScore) }}>
                            {deal.overallScore}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            / 100
                          </div>
                        </div>
                      </div>
                      <div 
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                        style={{ 
                          backgroundColor: recConfig.color + '20',
                          color: recConfig.color
                        }}
                      >
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
