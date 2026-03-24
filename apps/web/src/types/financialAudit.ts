// Financial Audit Type Definitions

export type AuditStatus = 'READY' | 'PARTIAL' | 'WARNING';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
export type SupportStatus = 'Supported' | 'Conflicting' | 'Single Source';
export type SeverityLevel = 'critical' | 'validation' | 'dataQuality';
export type DataType = 'historical' | 'projected';
export type ImpactSeverity = 'high' | 'medium' | 'low';

// Investor Action Panel Types
export interface ActionItem {
  text: string;
  severity: 'critical' | 'warning' | 'success';
}

export interface InvestorActionPanelProps {
  status: AuditStatus;
  criticalActions: ActionItem[];
  validationActions: ActionItem[];
  strengths: ActionItem[];
}

// Summary Metrics Bar Types
export interface SummaryMetricsBarProps {
  completeness: number;
  criticalMetrics: string;
  conflicts: number;
  factsAnalyzed: number;
}

// Source of Truth Table Types
export interface SourceOfTruthRow {
  metric: string;
  value: string;
  source: string;
  sources: number;
  confidence: ConfidenceLevel;
  confidenceExplanation: string;
  status: SupportStatus;
  sourceWeight: number;
}

export interface SourceOfTruthTableProps {
  rows: SourceOfTruthRow[];
}

// Cross-Source Reconciliation Types
export interface ConflictSource {
  name: string;
  value: string;
}

export interface Conflict {
  metric: string;
  sourceA: ConflictSource;
  sourceB: ConflictSource;
  difference: string;
  impact: string;
  impactSeverity: ImpactSeverity;
}

export interface CrossSourceReconciliationProps {
  conflicts: Conflict[];
}

// Time Projection Audit Types
export interface TimeAuditItem {
  metric: string;
  period: string;
  type: DataType;
  clarity: 'Clear' | 'Warning' | 'Ambiguous';
  warning?: string;
}

export interface TimeProjectionAuditProps {
  items: TimeAuditItem[];
}

// Financial Snapshot Types
export interface SnapshotMetric {
  label: string;
  value: string;
  change?: string;
  confidence: ConfidenceLevel;
  confidenceReason: string;
}

export interface FinancialSnapshotProps {
  metrics: SnapshotMetric[];
}

// Risk Flags Panel Types
export interface RiskFlag {
  message: string;
}

export interface RiskFlagsPanelProps {
  critical: RiskFlag[];
  validation: RiskFlag[];
  dataQuality: RiskFlag[];
}

// Underwriting Readiness Types
export interface UnderwritingReadinessProps {
  score: number;
  status: AuditStatus;
  missingMetrics: string[];
  weakAreas: string[];
  summary: string;
}

// Formula Trace Panel Types
export interface FormulaTrace {
  metric: string;
  formula: string;
  depth: number;
  sheets: string[];
  circular: boolean;
  confidence: ConfidenceLevel;
}

export interface FormulaTracePanelProps {
  traces: FormulaTrace[];
}

// Raw Fact Explorer Types
export interface RawFact {
  metric: string;
  period: string;
  value: string;
  source: string;
  sheet: string | null;
  cell: string;
  confidence: ConfidenceLevel;
  formula: string | null;
}

export interface RawFactExplorerProps {
  facts: RawFact[];
}

// Main Financial Audit Tab Props
export interface FinancialAuditTabProps {
  financialBreakdownV1?: any;
  underwritingReadinessV1?: any;
  financialIntegrityV1?: any;
  financialSnapshotStale?: boolean;
  darkMode?: boolean;
}

// Processed Audit Data (output from hook)
export interface ProcessedAuditData {
  status: AuditStatus;
  isStale: boolean;
  /** True when the compiled report has no numeric data in any core panel — typically because the report predates XLSX extraction */
  isReportEmpty: boolean;
  lastUpdated: string;
  actionPanel: InvestorActionPanelProps;
  summaryMetrics: SummaryMetricsBarProps;
  sourceOfTruth: SourceOfTruthTableProps;
  conflicts: CrossSourceReconciliationProps;
  timeAudit: TimeProjectionAuditProps;
  snapshot: FinancialSnapshotProps;
  riskFlags: RiskFlagsPanelProps;
  readiness: UnderwritingReadinessProps;
  formulas: FormulaTracePanelProps;
  rawFacts: RawFactExplorerProps;
}