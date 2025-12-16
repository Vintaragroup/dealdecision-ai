import { useState, useEffect } from 'react';
import { 
  Sparkles, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Rocket, 
  AlertTriangle, 
  Target,
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
  Building2,
  Megaphone,
  Shield,
  TrendingDown,
  Briefcase
} from 'lucide-react';
import { Button } from '../ui/button';
import { DealFormData } from '../NewDealModal';
import { ProfessionalReportGenerator } from '../reports/ProfessionalReportGenerator';
import { useUserRole } from '../../contexts/UserRoleContext';

interface AnalysisTabProps {
  darkMode: boolean;
  dealData: DealFormData;
}

interface CategoryScore {
  name: string;
  score: number;
  maxScore: number;
  icon: typeof TrendingUp;
  color: string;
  issues: string[];
  strengths: string[];
  recommendations: string[];
}

interface DealAnalysis {
  overallScore: number;
  previousScore: number | null;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement';
  completeness: number;
  categories: CategoryScore[];
  redFlags: { severity: 'high' | 'medium' | 'low'; message: string; action: string }[];
  greenFlags: string[];
  quickWins: { title: string; impact: number; effort: 'low' | 'medium' | 'high' }[];
  achievements: { id: string; title: string; unlocked: boolean }[];
}

export function AnalysisTab({ darkMode, dealData }: AnalysisTabProps) {
  const [analysis, setAnalysis] = useState<DealAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const userRole = useUserRole();
  const [selectedPerspective, setSelectedPerspective] = useState<string | null>(null);
  const [runningDeepAnalysis, setRunningDeepAnalysis] = useState(false);

  useEffect(() => {
    // Auto-run analysis on mount
    runAnalysis();
  }, []);

  const runAnalysis = async () => {
    setAnalyzing(true);
    
    // Simulate AI analysis
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = analyzeDeal(dealData);
    setAnalysis(result);
    setAnalyzing(false);
  };

  const analyzeDeal = (data: DealFormData): DealAnalysis => {
    // Smart scoring algorithm based on data completeness and quality
    const categories: CategoryScore[] = [
      {
        name: 'Market Opportunity',
        score: calculateMarketScore(data),
        maxScore: 100,
        icon: TrendingUp,
        color: '#3b82f6',
        issues: getMarketIssues(data),
        strengths: getMarketStrengths(data),
        recommendations: getMarketRecommendations(data)
      },
      {
        name: 'Team Strength',
        score: calculateTeamScore(data),
        maxScore: 100,
        icon: Users,
        color: '#8b5cf6',
        issues: getTeamIssues(data),
        strengths: getTeamStrengths(data),
        recommendations: getTeamRecommendations(data)
      },
      {
        name: 'Financial Health',
        score: calculateFinancialScore(data),
        maxScore: 100,
        icon: DollarSign,
        color: '#10b981',
        issues: getFinancialIssues(data),
        strengths: getFinancialStrengths(data),
        recommendations: getFinancialRecommendations(data)
      },
      {
        name: 'Traction & Growth',
        score: calculateTractionScore(data),
        maxScore: 100,
        icon: Rocket,
        color: '#f59e0b',
        issues: getTractionIssues(data),
        strengths: getTractionStrengths(data),
        recommendations: getTractionRecommendations(data)
      },
      {
        name: 'Risk Assessment',
        score: calculateRiskScore(data),
        maxScore: 100,
        icon: AlertTriangle,
        color: '#ef4444',
        issues: getRiskIssues(data),
        strengths: getRiskStrengths(data),
        recommendations: getRiskRecommendations(data)
      },
      {
        name: 'Competitive Position',
        score: calculateCompetitiveScore(data),
        maxScore: 100,
        icon: Target,
        color: '#6366f1',
        issues: getCompetitiveIssues(data),
        strengths: getCompetitiveStrengths(data),
        recommendations: getCompetitiveRecommendations(data)
      }
    ];

    const overallScore = Math.round(
      categories.reduce((sum, cat) => sum + cat.score, 0) / categories.length
    );

    const grade = 
      overallScore >= 85 ? 'Excellent' :
      overallScore >= 70 ? 'Good' :
      overallScore >= 55 ? 'Fair' :
      'Needs Improvement';

    const completeness = calculateCompleteness(data);

    return {
      overallScore,
      previousScore: null, // Would come from backend
      grade,
      completeness,
      categories,
      redFlags: identifyRedFlags(data, categories),
      greenFlags: identifyGreenFlags(data, categories),
      quickWins: identifyQuickWins(categories),
      achievements: [
        { id: 'first-analysis', title: 'First Analysis Complete', unlocked: true },
        { id: 'complete-profile', title: 'Complete Deal Profile', unlocked: completeness >= 80 },
        { id: 'investment-ready', title: 'Investment Ready', unlocked: overallScore >= 85 },
        { id: 'perfect-score', title: 'Perfect 100', unlocked: overallScore === 100 }
      ]
    };
  };

  // Scoring functions
  const calculateMarketScore = (data: DealFormData): number => {
    let score = 0;
    if (data.industry) score += 20;
    if (data.stage) score += 15;
    if (data.targetMarket) score += 25;
    if (data.fundingAmount) score += 20;
    if (parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0') > 0) score += 20;
    return Math.min(score, 100);
  };

  const calculateTeamScore = (data: DealFormData): number => {
    let score = 40; // Base score
    if (data.teamSize && parseInt(data.teamSize) > 5) score += 20;
    if ((data.companyName?.length ?? 0) > 0) score += 20;
    if (data.founderExperience) score += 20;
    return Math.min(score, 100);
  };

  const calculateFinancialScore = (data: DealFormData): number => {
    let score = 0;
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue > 0) score += 30;
    if (revenue > 100000) score += 15;
    if (revenue > 1000000) score += 15;
    if (data.fundingAmount) score += 20;
    if (data.previousFunding) score += 20;
    return Math.min(score, 100);
  };

  const calculateTractionScore = (data: DealFormData): number => {
    let score = 0;
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue > 0) score += 40;
    if (data.customers && parseInt(data.customers) > 0) score += 30;
    if (data.growthRate) score += 30;
    return Math.min(score, 100);
  };

  const calculateRiskScore = (data: DealFormData): number => {
    let score = 70; // Start high, reduce for risks
    if (!data.revenue || parseInt(data.revenue.replace(/[^0-9]/g, '')) === 0) score -= 15;
    if (!data.customers || parseInt(data.customers) === 0) score -= 15;
    if (!data.teamSize || parseInt(data.teamSize) < 3) score -= 10;
    return Math.max(score, 0);
  };

  const calculateCompetitiveScore = (data: DealFormData): number => {
    let score = 50; // Base score
    if (data.uniqueValue) score += 25;
    if (data.competitiveAdvantage) score += 25;
    return Math.min(score, 100);
  };

  const calculateCompleteness = (data: DealFormData): number => {
    const fields = Object.values(data).filter(v => v && v.toString().length > 0);
    const totalFields = Object.keys(data).length;
    return Math.round((fields.length / totalFields) * 100);
  };

  // Issue identification functions
  const getMarketIssues = (data: DealFormData): string[] => {
    const issues = [];
    if (!data.targetMarket) issues.push('Target market not defined');
    if (!data.industry) issues.push('Industry not specified');
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue === 0) issues.push('No revenue data provided');
    return issues;
  };

  const getMarketStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    if (data.targetMarket) strengths.push('Clear target market identified');
    if (data.industry) strengths.push(`Operating in ${data.industry} sector`);
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue > 100000) strengths.push('Strong revenue traction');
    return strengths;
  };

  const getMarketRecommendations = (data: DealFormData): string[] => {
    const recs = [];
    if (!data.targetMarket) recs.push('Define your target addressable market (TAM/SAM/SOM)');
    if (!data.marketSize) recs.push('Quantify your market opportunity with specific numbers');
    if (!data.competitorAnalysis) recs.push('Add competitive landscape analysis');
    return recs;
  };

  const getTeamIssues = (data: DealFormData): string[] => {
    const issues = [];
    if (!data.teamSize || parseInt(data.teamSize) < 3) issues.push('Small team size may concern investors');
    if (!data.founderExperience) issues.push('Founder experience not highlighted');
    return issues;
  };

  const getTeamStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    if (data.teamSize && parseInt(data.teamSize) >= 5) strengths.push('Strong team size');
    if (data.founderExperience) strengths.push('Experienced founding team');
    return strengths;
  };

  const getTeamRecommendations = (data: DealFormData): string[] => {
    const recs = [];
    if (!data.founderExperience) recs.push('Highlight founder backgrounds and prior successes');
    if (!data.advisors) recs.push('Add advisory board members to strengthen credibility');
    recs.push('Include key hires and open positions in your deck');
    return recs;
  };

  const getFinancialIssues = (data: DealFormData): string[] => {
    const issues = [];
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue === 0) issues.push('No revenue generated yet');
    if (!data.fundingAmount) issues.push('Funding amount not specified');
    if (!data.burnRate) issues.push('Burn rate not disclosed');
    return issues;
  };

  const getFinancialStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue > 0) strengths.push(`${data.revenue} in revenue`);
    if (data.fundingAmount) strengths.push(`Seeking ${data.fundingAmount} funding`);
    if (data.previousFunding) strengths.push('Previously funded');
    return strengths;
  };

  const getFinancialRecommendations = (data: DealFormData): string[] => {
    const recs = [];
    if (!data.burnRate) recs.push('Add monthly burn rate and runway calculations');
    if (!data.unitEconomics) recs.push('Include unit economics (CAC, LTV, gross margin)');
    if (!data.financialProjections) recs.push('Provide 3-year financial projections');
    return recs;
  };

  const getTractionIssues = (data: DealFormData): string[] => {
    const issues = [];
    if (!data.customers || parseInt(data.customers) === 0) issues.push('No customer traction shown');
    if (!data.growthRate) issues.push('Growth rate not provided');
    if (!data.keyMetrics) issues.push('Key metrics missing');
    return issues;
  };

  const getTractionStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    if (data.customers && parseInt(data.customers) > 0) strengths.push(`${data.customers} customers acquired`);
    if (data.growthRate) strengths.push(`${data.growthRate} growth rate`);
    return strengths;
  };

  const getTractionRecommendations = (data: DealFormData): string[] => {
    return [
      'Add month-over-month growth metrics',
      'Include customer retention and churn rates',
      'Showcase key customer wins and case studies'
    ];
  };

  const getRiskIssues = (data: DealFormData): string[] => {
    const issues = [];
    if (!data.riskFactors) issues.push('Risk factors not documented');
    if (!data.mitigationStrategy) issues.push('No risk mitigation strategy');
    return issues;
  };

  const getRiskStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    if (data.riskFactors) strengths.push('Risks transparently disclosed');
    if (data.mitigationStrategy) strengths.push('Mitigation strategies in place');
    return strengths;
  };

  const getRiskRecommendations = (data: DealFormData): string[] => {
    return [
      'Document top 3-5 risk factors',
      'Provide mitigation strategies for each risk',
      'Address regulatory or compliance concerns'
    ];
  };

  const getCompetitiveIssues = (data: DealFormData): string[] => {
    const issues = [];
    if (!data.competitiveAdvantage) issues.push('Competitive advantage not clearly defined');
    if (!data.moat) issues.push('Defensibility/moat not articulated');
    return issues;
  };

  const getCompetitiveStrengths = (data: DealFormData): string[] => {
    const strengths = [];
    if (data.competitiveAdvantage) strengths.push('Clear competitive differentiation');
    if (data.uniqueValue) strengths.push('Strong unique value proposition');
    return strengths;
  };

  const getCompetitiveRecommendations = (data: DealFormData): string[] => {
    return [
      'Create a competitive matrix comparing key features',
      'Highlight your unfair advantages and barriers to entry',
      'Explain why you will win in this market'
    ];
  };

  const identifyRedFlags = (data: DealFormData, categories: CategoryScore[]): DealAnalysis['redFlags'] => {
    const flags: DealAnalysis['redFlags'] = [];
    
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    const normalizedStage = data.stage?.toLowerCase() || '';
    if (revenue === 0 && normalizedStage !== 'pre-seed') {
      flags.push({
        severity: 'high',
        message: 'No revenue for a post-seed stage company',
        action: 'Add revenue data or explain business model timeline'
      });
    }

    if (!data.customers || parseInt(data.customers) === 0) {
      flags.push({
        severity: 'medium',
        message: 'No customer traction demonstrated',
        action: 'Add customer testimonials, case studies, or LOIs'
      });
    }

    if (!data.teamSize || parseInt(data.teamSize) < 2) {
      flags.push({
        severity: 'medium',
        message: 'Solo founder with no team',
        action: 'Consider adding co-founders or highlighting key advisors'
      });
    }

    if (!data.competitiveAdvantage) {
      flags.push({
        severity: 'low',
        message: 'Competitive differentiation unclear',
        action: 'Clearly articulate your unique value proposition'
      });
    }

    return flags;
  };

  const identifyGreenFlags = (data: DealFormData, categories: CategoryScore[]): string[] => {
    const flags = [];
    
    const revenue = parseInt(data.revenue?.replace(/[^0-9]/g, '') || '0');
    if (revenue > 100000) flags.push('Strong revenue traction ($100K+ ARR)');
    if (revenue > 1000000) flags.push('Significant revenue scale ($1M+ ARR)');
    
    if (data.customers && parseInt(data.customers) > 50) {
      flags.push('Healthy customer base (50+ customers)');
    }

    if (data.teamSize && parseInt(data.teamSize) >= 10) {
      flags.push('Scaled team with 10+ employees');
    }

    if (data.previousFunding) {
      flags.push('Previously funded - validation from other investors');
    }

    if (categories.some(cat => cat.score >= 90)) {
      flags.push('Exceptional performance in key categories');
    }

    return flags;
  };

  const identifyQuickWins = (categories: CategoryScore[]): DealAnalysis['quickWins'] => {
    const wins: DealAnalysis['quickWins'] = [];

    categories.forEach(cat => {
      if (cat.score < 70 && cat.recommendations.length > 0) {
        wins.push({
          title: cat.recommendations[0],
          impact: 100 - cat.score,
          effort: cat.recommendations[0].length < 50 ? 'low' : 'medium'
        });
      }
    });

    return wins.slice(0, 3); // Top 3 quick wins
  };

  const getScoreColor = (score: number): string => {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 55) return '#f59e0b';
    return '#ef4444';
  };

  const getGradeEmoji = (grade: string): string => {
    switch (grade) {
      case 'Excellent': return '🏆';
      case 'Good': return '✅';
      case 'Fair': return '⚠️';
      default: return '🔴';
    }
  };

  if (analyzing) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div className="absolute inset-0 border-4 border-[#6366f1]/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-[#6366f1] rounded-full border-t-transparent animate-spin" />
            <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-[#6366f1]" />
          </div>
          <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Analyzing Your Deal...
          </h3>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            AI is evaluating market opportunity, team, financials, and more
          </p>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

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
              onClick={runAnalysis}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Re-analyze
            </Button>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              onClick={() => setShowReport(true)}
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
              Overall Score
            </p>
            <p className={`text-xs mt-1`} style={{ color: getScoreColor(analysis.overallScore) }}>
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
                    ? darkMode ? 'text-[#10b981]' : 'text-[#10b981]'
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
                    backgroundColor: category.color
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
                color: '#ef4444'
              },
              {
                id: 'competitor',
                name: 'Competitor',
                icon: <TrendingDown className="w-5 h-5" />,
                description: 'Market threats, weaknesses, attack vectors',
                color: '#f59e0b'
              },
              {
                id: 'marketing',
                name: 'Marketing Agency',
                icon: <Megaphone className="w-5 h-5" />,
                description: 'Brand positioning, GTM strategy, messaging',
                color: '#8b5cf6'
              },
              {
                id: 'strategic',
                name: 'Strategic Advisor',
                icon: <Briefcase className="w-5 h-5" />,
                description: 'Growth strategy, partnerships, scaling',
                color: '#10b981'
              }
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
                  alert(`Deep analysis complete from ${selectedPerspective} perspective!\n\nThis would show detailed insights, risks, and recommendations from that specific professional viewpoint.`);
                }, 2500);
              }}
            >
              {runningDeepAnalysis ? 'Analyzing...' : 'Run Deep Analysis'}
            </Button>
          </div>
        </div>
      )}

      {/* CTA Section - For Founders */}
      {userRole.isFounder && (
        <div className={`p-6 rounded-2xl border bg-gradient-to-r ${
          darkMode
            ? 'from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
            : 'from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Ready to improve your pitch?
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Address the recommendations above to increase your pitch readiness score
              </p>
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<ChevronRight className="w-4 h-4" />}
            >
              Start Improving
            </Button>
          </div>
        </div>
      )}

      {/* Professional Report Generator Modal */}
      {showReport && analysis && (
        <ProfessionalReportGenerator
          darkMode={darkMode}
          analysisData={analysis}
          dealData={dealData}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}