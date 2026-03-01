/**
 * Orchestrator barrel — re-exports the public API of the DDAI orchestrator
 * composition layer. Import from `@dealdecision/core` for the builder function
 * and `OrchestratorReportV1` type.
 */

export { buildOrchestratorReportV1, type InvestorInsightsRenderPackage } from './build-orchestrator-report-v1';
export type { OrchestratorRenderPackageInput } from './render-package-input';
export type {
  OrchestratorReportV1,
  OrchestratorDecision,
  OrchestratorScores,
  DocumentConfidence,
  StageContext,
  DecisionLabel,
  StageLabel,
  DciBand,
  FinancialHealthScore,
  MarketScore,
} from './types';
