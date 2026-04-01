import React from 'react';
import { DecisionSummary } from './AI-analysis-comp/decision-summary';
import { WhyScore } from './AI-analysis-comp/why-score';
import { ImprovementActions } from './AI-analysis-comp/improvement-actions';
import { DivergenceWarning } from './AI-analysis-comp/divergence-warning';
import { DeepAnalysisSection } from './AI-analysis-comp/deep-analysis-section';
import { VentureLensPanel } from './analysis/VentureLensPanel';
import { VCScoringV2Panel } from './analysis/VCScoringV2Panel';
import { useOrchestratorReport } from '../../hooks/useOrchestratorReport';
import { resolveScoreDivergence } from '../../lib/resolveScoreDivergence';
import type { OrsDecisionLabel } from '../../lib/resolveScoreDivergence';
import type { DealFormData } from '../Modal_Legacy/NewDealModal';
import type { DealReportFinancialIntegrityV1 } from '../../lib/apiClient';
import type { FinancialBreakdownV1Like, UnderwritingReadinessV1Like } from '../../lib/selectors/selectAuthoritativeFinancialBreakdownV1';
import type { WorkspaceVerdict } from '../../lib/resolveWorkspaceVerdict';
import { Activity } from 'lucide-react';

type DisplayPosture = 'FUND' | 'INVESTIGATE' | 'MONITOR' | 'PASS';

function toDisplayPosture(
  orsPosture: string | null | undefined,
  verdictFallback: WorkspaceVerdict | null,
): DisplayPosture {
  switch (orsPosture) {
    case 'INVESTABLE':
    case 'HIGH_PRIORITY_DILIGENCE': return 'FUND';
    case 'INVESTIGATE': return 'INVESTIGATE';
    case 'MONITOR': return 'MONITOR';
    case 'PASS': return 'PASS';
  }
  switch (verdictFallback) {
    case 'FUND': return 'FUND';
    case 'CONSIDER': return 'INVESTIGATE';
    case 'PASS': return 'MONITOR';
    case 'HARD_PASS': return 'PASS';
  }
  return 'INVESTIGATE';
}

interface AnalysisTabProps {
  darkMode: boolean;
  dealData: DealFormData;
  dealId?: string;
  onRunAnalysis?: () => Promise<void> | void;
  isAnalyzing?: boolean;
  financialIntegrityV1?: DealReportFinancialIntegrityV1 | null;
  financialBreakdownV1?: FinancialBreakdownV1Like | null;
  underwritingReadinessV1?: UnderwritingReadinessV1Like | null;
  financialSnapshotStale?: boolean;
  workspaceScore?: number | null;
  workspaceVerdict?: WorkspaceVerdict | null;
}

export function AnalysisTab({
  dealData,
  dealId,
  financialIntegrityV1,
  underwritingReadinessV1,
  workspaceScore = null,
  workspaceVerdict = null,
}: AnalysisTabProps) {
  const { data: orchData } = useOrchestratorReport(dealId);

  const vcScoringV2 = orchData?.report?.vc_scoring_v2 ?? null;
  const ventureLensV1 = orchData?.report?.venture_lens_v1 ?? null;

  // Primary score — V3 > V2 > workspace
  const primaryScore =
    ventureLensV1?.final_investment_score ??
    vcScoringV2?.vc_composite_score ??
    workspaceScore ??
    0;

  // Posture
  const activeOrsPosture = ventureLensV1?.final_posture ?? vcScoringV2?.investment_posture ?? null;
  const displayPosture = toDisplayPosture(activeOrsPosture, workspaceVerdict);

  // Supporting scores (mini-gauges)
  const opportunityScore = vcScoringV2?.opportunity_score ?? null;
  const confidenceScore = vcScoringV2?.confidence_score ?? null;
  const riskScore = vcScoringV2?.risk_score ?? null;

  // One-line explanation
  const explanation = (() => {
    const firstReason = vcScoringV2?.reasoning?.[0] ?? ventureLensV1?.reasons?.[0] ?? null;
    if (firstReason) return firstReason;
    switch (displayPosture) {
      case 'FUND': return 'Strong fundamentals across key dimensions.';
      case 'INVESTIGATE': return 'Promising signals with areas requiring deeper diligence.';
      case 'MONITOR': return 'Some concerns present — monitor for resolution.';
      case 'PASS': return 'Significant concerns across multiple dimensions.';
    }
  })();

  // Strengths — top venture lens dimensions (score >= 70), formatted as bullets
  const strengths: { text: string; data: string }[] = (() => {
    if (!ventureLensV1?.breakdown) return [];
    return (Object.entries(ventureLensV1.breakdown) as [string, number][])
      .filter(([, s]) => s >= 70)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([dim, s]) => ({
        text: `Strong ${dim.charAt(0).toUpperCase()}${dim.slice(1)}`,
        data: `${s}/100`,
      }));
  })();

  // Concerns — vc_scoring_v2 reasoning bullets (or venture lens reasons as fallback)
  // Skip reasoning[0] when it is already used as the explanation to avoid duplication
  const concerns: { text: string; data: string }[] = (() => {
    const bullets = vcScoringV2?.reasoning ?? ventureLensV1?.reasons ?? [];
    const filtered = bullets.filter((r) => r !== explanation);
    return filtered.slice(0, 3).map((r) => ({ text: r, data: '' }));
  })();

  // Improvements — from underwriting readiness gaps
  const improvements: { action: string; points: number }[] = (() => {
    const gaps: unknown = (underwritingReadinessV1 as any)?.gaps;
    if (Array.isArray(gaps) && gaps.length > 0) {
      return (gaps as unknown[]).slice(0, 5).map((g, i) => ({
        action: typeof g === 'string' ? g : String(g),
        points: Math.max(3, 12 - i * 2),
      }));
    }
    return [];
  })();

  // Divergence
  const orsScore = orchData?.report?.scores?.overall_recommendation_score ?? null;
  const orsDecision = (orchData?.report?.decision?.label ?? null) as OrsDecisionLabel | null;
  const divergenceResult = resolveScoreDivergence(workspaceScore, workspaceVerdict, orsScore, orsDecision);

  const divergenceData = {
    exists: divergenceResult.isDiverging,
    system1: {
      name: 'Workspace',
      posture: workspaceVerdict ?? '—',
      score: workspaceScore ?? 0,
    },
    system2: {
      name: 'Orchestrator',
      posture: orsDecision ?? '—',
      score: orsScore ?? 0,
    },
    explanation:
      divergenceResult.kind === 'opposite_signals'
        ? 'Systems are giving opposite investment signals.'
        : `Score gap of ${Math.abs(divergenceResult.scoreDelta ?? 0)} points between systems.`,
  };

  // Deep analysis: real panels as collapsed section content
  const deepAnalysisSections = [
    ...(ventureLensV1
      ? [{
          title: 'Venture Lens Breakdown',
          content: <VentureLensPanel darkMode={true} ventureLens={ventureLensV1} />,
        }]
      : []),
    ...(vcScoringV2
      ? [{
          title: 'VC Scoring V2 Breakdown',
          content: <VCScoringV2Panel darkMode={true} vcScoringV2={vcScoringV2} />,
        }]
      : []),
    ...(financialIntegrityV1
      ? [{
          title: `Financial Integrity`,
          content: (
            <div className="space-y-2 text-sm text-zinc-300">
              <p className="text-zinc-400">Financial data integrity analysis from the compiled report.</p>
            </div>
          ),
        }]
      : []),
    ...(underwritingReadinessV1
      ? [{
          title: `Underwriting Readiness`,
          content: (
            <div className="space-y-2 text-sm text-zinc-300">
              <p className="text-zinc-400">
                {(underwritingReadinessV1 as any)?.narrative ?? 'Underwriting readiness assessment.'}
              </p>
            </div>
          ),
        }]
      : []),
  ];


  const companyName = (dealData as any)?.company ?? (dealData as any)?.name ?? null;
  const stage = (dealData as any)?.stage ?? null;
  const raise = (dealData as any)?.fundingAmount ?? null;

  return (
    <div className="min-h-full bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 rounded-xl p-8">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-400" />
              <h1 className="text-2xl text-white">AI Analysis</h1>
            </div>
            {companyName && (
              <div className="flex items-center gap-6 text-sm text-zinc-400">
                <div>
                  <span className="text-white font-medium">{companyName}</span>
                  {stage && (
                    <>
                      <span className="mx-2">•</span>
                      <span>{stage}</span>
                    </>
                  )}
                  {raise && (
                    <>
                      <span className="mx-2">•</span>
                      <span>{raise} raise</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 1: Decision Summary */}
        <DecisionSummary
          score={primaryScore}
          posture={displayPosture}
          explanation={explanation ?? ''}
          opportunity={opportunityScore}
          confidence={confidenceScore}
          risk={riskScore}
        />

        {/* Section 2: Why This Score */}
        <div className="mt-6">
          <WhyScore strengths={strengths} concerns={concerns} />
        </div>

        {/* Section 3: Improvement Actions */}
        <div className="mt-4">
          <ImprovementActions improvements={improvements} />
        </div>

        {/* Section 4: Divergence Warning (self-hidden when not diverging) */}
        <DivergenceWarning data={divergenceData} />

        {/* Section 5: Deep Analysis (collapsed panels) */}
        {deepAnalysisSections.length > 0 && (
          <div className="mt-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Deep Analysis</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Detailed scoring breakdowns and diagnostic information
              </p>
            </div>
            <DeepAnalysisSection sections={deepAnalysisSections} />
          </div>
        )}
      </div>
    </div>
  );
}
