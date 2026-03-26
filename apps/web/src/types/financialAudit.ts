// Financial Audit Type Definitions

export type AuditStatus = 'READY' | 'PARTIAL' | 'WARNING';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
export type SupportStatus = 'Supported' | 'Conflicting' | 'Single Source';
export type SeverityLevel = 'critical' | 'validation' | 'dataQuality';
export type DataType = 'historical' | 'projected';
export type ImpactSeverity = 'high' | 'medium' | 'low';

// ── Canonical visible-state layer types ─────────────────────────────────────
/** Has any financial evidence been extracted? */
export type DataPresenceState = 'no_data' | 'limited_data' | 'structured_data';
/** Has integrity validation run and produced meaningful results? */
export type ValidationState = 'not_applicable' | 'unvalidated' | 'partially_validated' | 'validated';
/** Summary of integrity flag severity across all analysed facts. */
export type IntegrityState = 'unknown' | 'clean' | 'warning' | 'critical';
/** Derived underwriting readiness — blocked by validation/integrity state. */
export type ReadinessState = 'not_ready' | 'partially_ready' | 'ready';
/** Cross-source reconciliation determination. */
export type ReconciliationStatus = 'none' | 'clean' | 'conflicted' | 'unknown';
/** Tone used for colouring/icons — mapped from the canonical status label. */
export type VisibleStatusTone = 'neutral' | 'warning' | 'success' | 'critical';

/**
 * Single canonical view-model object that every Financial Audit UI section
 * must derive its display from. Prevents contradictions between sections.
 */
export interface VisibleAuditState {
  dataPresenceState: DataPresenceState;
  validationState: ValidationState;
  integrityState: IntegrityState;
  readinessState: ReadinessState;
  /** Investor-safe visible label — derived from ALL layers. NEVER shows "Ready" when validation or integrity is incomplete. */
  visibleStatusLabel: string;
  visibleStatusTone: VisibleStatusTone;
  /** Canonical conflict count: all discrepancy/cross-source flags (broader than structured reconciliation set). */
  conflictCount: number;
  hasConflicts: boolean;
  reconciliationStatus: ReconciliationStatus;
  /** Plain-language reconciliation summary for use in CrossSourceReconciliation empty state. */
  reconciliationMessage: string;
  /** True when validation has not completed or critical conflicts exist — indicates readiness score is provisional. */
  isProvisional: boolean;
}

// Investor Action Panel Types
export interface ActionItem {
  text: string;
  severity: 'critical' | 'warning' | 'success';
}

export interface InvestorActionPanelProps {
  status: AuditStatus;
  /** Canonical investor-safe label derived from all layers — shown in badge instead of raw status enum. */
  visibleStatusLabel: string;
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
  /** Extracted facts count (distinct financial signals in the payload) */
  extractedFactsCount?: number | null;
  /** Optional validated/extracted split for richer display */
  validatedFactsCount?: number | null;
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
  // Phase 2: semantic enrichment for display
  /** Human-readable sublabel shown below the metric name — e.g. "Derived from gross profit & revenue" */
  sublabel?: string | null;
  /** True when the metric was computed/inferred rather than directly observed */
  isDerived?: boolean;
  /** True when the metric is provisional (derived, projected, or low-conf deck claim) */
  isProvisional?: boolean;
  /** Secondary metric row shown when a meaningful alternative exists (e.g. workbook burn proxy) */
  alternativeFact?: { label: string; value: string; sublabel: string } | null;
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
  /** Canonical reconciliation determination from the unified state model. */
  reconciliationStatus: ReconciliationStatus;
  /** Plain-language summary shown when there are no structured conflicts to render. */
  reconciliationMessage: string;
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

// Temporal Alignment Panel Types
/**
 * Structured representation of the grouped_temporal_mismatch integrity flag.
 * Surfaced as a single amber block rather than N per-metric raw messages.
 */
export interface TemporalAlignmentBlock {
  /** True when at least one metric mixes projected and historical facts. */
  hasIssue: boolean;
  /** Metric keys affected by temporal mismatch — empty when hasIssue=false. */
  affectedMetrics: string[];
  /** Investor-readable, single-sentence summary explanation. */
  explanation: string;
}

export interface TemporalAlignmentPanelProps {
  block: TemporalAlignmentBlock;
}

// Underwriting Readiness Types
export interface UnderwritingReadinessProps {
  score: number;
  status: AuditStatus;
  /** Canonical investor-safe label — shown instead of raw status enum. */
  visibleStatusLabel: string;
  /** True when validation is incomplete or critical conflicts exist; triggers a provisional sublabel. */
  isProvisional: boolean;
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
  /** Canonical finance-specific data state. Controls which UI sections render.
   *  - structured_data: XLSX-backed structured finance present, not stale
   *  - stale:           Finance data exists but report lags newly uploaded facts
   *  - limited_data:    Financial signals from non-structured sources (deck, PDF, etc.)
   *  - no_data:         No financial data of any kind
   */
  dataState: 'no_data' | 'limited_data' | 'stale' | 'structured_data';
  isStale: boolean;
  /** True when the compiled report has no numeric data in any core panel */
  isReportEmpty: boolean;
  /** True when any financial signals exist regardless of source */
  hasAnyFinancialData: boolean;
  /** True only when XLSX-backed structured financials are present */
  hasStructuredFinancials: boolean;
  /** True when financial data exists but it is not XLSX-backed */
  hasNonXlsxFinancialData: boolean;
  hasRealCurrentState: boolean;
  hasRealProjections: boolean;
  /** Which source types contributed financial signals */
  sourceMix: {
    xlsx: boolean;
    pdf: boolean;
    deck: boolean;
    pptx: boolean;
    docx: boolean;
  };
  showTabContent: boolean;
  showCoveragePanels: boolean;
  showMetrics: boolean;
  showLimitedDataWarning: boolean;
  showStructuredBadge: boolean;
  showStaleWarning: boolean;
  /** Gates the Summary Metrics Bar — true whenever hasAnyFinancialData */
  showSummaryMetrics: boolean;
  /** Gates all detailed audit panels — true whenever hasAnyFinancialData */
  showDetailedPanels: boolean;
  /** True when integrity validation has not run or has only the synthetic no-facts baseline */
  isIntegrityIncomplete: boolean;
  /**
   * The single canonical visible-state object that all UI sections must derive from.
   * Prevents contradictions between status, conflict count, reconciliation text, and readiness.
   */
  visibleAuditState: VisibleAuditState;
  /**
   * Human-readable label describing the current financial data / validation state.
   * Safe for display in investor-facing UI.
   */
  visibleStatusLabel: string;
  /**
   * Number of distinct financial fact signals detected from the report payload.
   * null when no data is present.
   */
  extractedFactsCount: number | null;
  /**
   * Number of facts that passed integrity validation (status PASS).
   * null when integrity did not run or has no data.
   */
  validatedFactsCount: number | null;
  lastUpdated: string;
  actionPanel: InvestorActionPanelProps;
  summaryMetrics: SummaryMetricsBarProps;
  sourceOfTruth: SourceOfTruthTableProps;
  conflicts: CrossSourceReconciliationProps;
  temporalAlignment: TemporalAlignmentBlock;
  timeAudit: TimeProjectionAuditProps;
  snapshot: FinancialSnapshotProps;
  riskFlags: RiskFlagsPanelProps;
  readiness: UnderwritingReadinessProps;
  formulas: FormulaTracePanelProps;
  rawFacts: RawFactExplorerProps;
}