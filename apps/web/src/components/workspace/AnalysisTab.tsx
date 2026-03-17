import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  TrendingUp,
  Users,
  DollarSign,
  Rocket,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { Button } from '../ui/button';
import type { DealFormData } from '../Modal_Legacy/NewDealModal';
import { ProfessionalReportGenerator } from '../reports/ProfessionalReportGenerator';
import { OrchestratorFullReportView } from './OrchestratorFullReportView';
import { Dialog, DialogContent } from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import {
  AnalysisSnapshotDashboard,
  type DealAnalysis,
  type CategoryScore,
} from '../deals/analysis/AnalysisSnapshotDashboard';
import { useOrchestratorReport } from '../../hooks/useOrchestratorReport';
import { mergeSnapshotWithOrchestrator } from '../deals/analysis/mergeSnapshotWithOrchestrator';
import {
  ReportViewConfigModal,
  type ReportViewConfig,
  DEFAULT_REPORT_VIEW_CONFIG,
} from '../deals/analysis/ReportViewConfigModal';
import { ReportGeneratorPreviewSplit } from '../deals/analysis/ReportGeneratorPreviewSplit';

interface AnalysisTabProps {
  darkMode: boolean;
  dealData: DealFormData;
  /** When provided the tab renders snapshot + full-report modal instead of local-only UI. */
  dealId?: string;
  // Optional hook to trigger the real backend analysis flow (DealWorkspace: apiPostAnalyze + jobs)
  onRunAnalysis?: () => Promise<void> | void;
  /**
   * Reflects DealWorkspace's `analyzing` state — true while the SSE-tracked job is running.
   * When it transitions false the orchestrator report is refreshed automatically.
   */
  isAnalyzing?: boolean;
}

export function AnalysisTab({ darkMode, dealData, onRunAnalysis, dealId, isAnalyzing = false }: AnalysisTabProps) {
  const [analysis, setAnalysis] = useState<DealAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Lifted here (single fetch) so both the snapshot overlay and the
  // OrchestratorFullReportView modal can share the same data without
  // a redundant GET /orchestrator-report call.
  const {
    status: orchStatus,
    data: orchData,
    refresh: refreshOrchestrator,
  } = useOrchestratorReport(dealId);

  // Refresh the orchestrator report when DealWorkspace signals the backend job is done.
  // `isAnalyzing` goes true→false once SSE reports completion, at which point new data
  // is available from the orchestrator endpoint.
  const prevIsAnalyzing = useRef<boolean>(false);
  useEffect(() => {
    if (prevIsAnalyzing.current && !isAnalyzing && dealId) {
      void refreshOrchestrator();
    }
    prevIsAnalyzing.current = isAnalyzing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing]);
  const [showReport, setShowReport] = useState(false);          // local fallback ProfessionalReportGenerator
  const [isConfigOpen, setIsConfigOpen] = useState(false);         // config pre-screen
  const [isFullReportOpen, setIsFullReportOpen] = useState(false); // dealId path OrchestratorFullReportView modal
  const [fullReportInitialAction, setFullReportInitialAction] = useState<'none' | 'export'>('none');
  const [reportViewConfig, setReportViewConfig] = useState<ReportViewConfig>(DEFAULT_REPORT_VIEW_CONFIG);
  /** 'snapshot' → normal tab view; 'report_preview' → inline split export view */
  const [viewMode, setViewMode] = useState<'snapshot' | 'report_preview'>('snapshot');

  useEffect(() => {
    // Always run local scoring so the snapshot is populated in both paths.
    runAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    
    // Simulate AI analysis
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = analyzeDeal(dealData);
    setAnalysis(result);
    setAnalyzing(false);
  };

  const handleReAnalyze = async () => {
    // Always recompute local UI analysis for immediate feedback, but if a backend analysis hook
    // is provided (DealWorkspace), also trigger that existing flow.
    setAnalyzing(true);
    try {
      if (onRunAnalysis) {
        await onRunAnalysis();
        // Note: orchestrator refresh is driven by the isAnalyzing effect (SSE job completion).
        // No immediate refresh needed here since the job is just starting.
      }
      const result = analyzeDeal(dealData);
      setAnalysis(result);
    } finally {
      setAnalyzing(false);
    }
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

  // ── Loading state (both paths) ─────────────────────────────────────────────
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

  // Overlay server-driven values on top of local scoring when the orchestrator
  // report is available. Falls back to local-only when orch data is missing.
  const mergedAnalysis = mergeSnapshotWithOrchestrator(analysis, orchData?.report);

  // ── dealId path: snapshot dashboard + full-report modal ───────────────────
  if (dealId) {
    // Inline split view: replaces the full tab when 'Export Report' is clicked
    if (viewMode === 'report_preview') {
      return (
        <ReportGeneratorPreviewSplit
          dealId={dealId}
          darkMode={darkMode}
          dealName={dealData.companyName || dealData.name || undefined}
          onBack={() => setViewMode('snapshot')}
          onRunAnalysis={onRunAnalysis}
        />
      );
    }

    return (
      <>
        <AnalysisSnapshotDashboard
          darkMode={darkMode}
          analysis={mergedAnalysis}
          dealData={dealData}
          onExportReport={() => setViewMode('report_preview')}
          onReanalyze={handleReAnalyze}
          isReanalyzing={isAnalyzing || analyzing}
          onViewFullReport={() => { setFullReportInitialAction('none'); setIsConfigOpen(true); }}
        />
        {/* Step 1: Config pre-screen */}
        <ReportViewConfigModal
          open={isConfigOpen}
          onOpenChange={setIsConfigOpen}
          initialConfig={reportViewConfig}
          darkMode={darkMode}
          continueLabel={fullReportInitialAction === 'export' ? 'Export Report' : 'View Report'}
          onContinue={(cfg) => {
            setReportViewConfig(cfg);
            setIsConfigOpen(false);
            setIsFullReportOpen(true);
          }}
        />
        {/* Step 2: Full report modal */}
        <Dialog
          open={isFullReportOpen}
          onOpenChange={(open) => {
            setIsFullReportOpen(open);
            if (!open) setFullReportInitialAction('none');
          }}
        >
          <DialogContent className="w-[96vw] max-w-7xl h-[92vh] overflow-hidden p-0 flex flex-col">
            <ScrollArea className="h-full">
              <div className="p-6">
                <OrchestratorFullReportView
                  dealId={dealId}
                  darkMode={darkMode}
                  dealName={dealData.companyName || dealData.name || undefined}
                  onRunAnalysis={onRunAnalysis}
                  initialAction={fullReportInitialAction}
                  visibleSections={reportViewConfig.visibleSections}
                  orchestratorReport={orchData}
                  orchestratorStatus={orchStatus}
                  onRefreshOrchestrator={refreshOrchestrator}
                />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ── Local fallback: no dealId — snapshot + ProfessionalReportGenerator ────
  return (
    <>
      <AnalysisSnapshotDashboard
        darkMode={darkMode}
        analysis={mergedAnalysis}
        dealData={dealData}
        onExportReport={() => setShowReport(true)}
        onReanalyze={handleReAnalyze}
        isReanalyzing={isAnalyzing || analyzing}
      />
      {showReport && (
        <ProfessionalReportGenerator
          darkMode={darkMode}
          analysisData={analysis}
          dealData={dealData}
          onClose={() => setShowReport(false)}
        />
      )}
    </>
  );
}

