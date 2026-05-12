/**
 * WorkspaceViewModel contract
 *
 * Typed shape for what the Deal Workspace UI actually needs — not the raw API
 * payload. Built by buildWorkspaceViewModel.ts from the computed view-layer
 * inputs assembled in DealWorkspace.tsx.
 *
 * Placeholder eliminations documented here:
 *   icReadiness   — derived from coverage_ratio or confidence band
 *                   (was: hardcoded 72 in DealWorkspaceTopSection default)
 *   concerns      — derived from filteredWeaknesses.length
 *                   (was: hardcoded 0 with '/* no data source yet *\/')
 *   tam           — derived from overviewV2.market_size when available
 *                   (was: hardcoded '—')
 *   signalData    — built from analysis strengths/weaknesses
 *                   (was: hardcoded [] in DealOverviewTab render)
 */

export type KpiTile = { label: string; value: string };

export type WorkspaceSignalCard = {
  type: 'strength' | 'traction' | 'concern' | 'info';
  title: string;
  description: string;
  /**
   * 0–1 confidence float from the originating confidence band.
   * null when band is 'unknown' (pre-analysis state).
   */
  confidence?: number | null;
  /** Originating data source key. */
  source?: string | null;
};

/**
 * Overview signal in a format compatible with DealOverviewTab's internal
 * SignalData interface (name, score, explanation, confidence label).
 *
 * Defined here so buildSignalCards.ts can produce it without depending on the
 * DealOverviewTab implementation file.
 */
export type WorkspaceOverviewSignal = {
  name: string;
  /** Representative 0–100 placement score for the visual score bar. */
  score: number;
  explanation: string;
  confidence: 'Strong Evidence' | 'Partial Evidence' | 'Limited Evidence';
};

export type WorkspaceOverviewFactTrust =
  | 'structured'
  | 'governed'
  | 'interim_extraction'
  | 'not_extracted'
  | 'conflicted';

export type WorkspaceOverviewFactMeta = {
  value: string;
  trust: WorkspaceOverviewFactTrust;
  source?: string | null;
  conflict?: { with: string; value: string } | null;
};

export type WorkspaceRcS6TeamHighlight = { name: string; role: string; credential?: string | null };

export type WorkspaceRcS6UseOfFundsItem = { category: string; amountLabel?: string | null };

export type WorkspaceRcS6ProjectPipelineItem = {
  name: string;
  capitalLabel?: string | null;
  revenueLabel?: string | null;
  returnPct?: string | null;
  startDate?: string | null;
};

export type WorkspaceRcS6RevenueModel = {
  type: string | null;
  unitEconomics: string | null;
  detail: string | null;
  recurring: boolean | null;
  trust: WorkspaceOverviewFactTrust;
};

export type WorkspaceHeaderVM = {
  dealName: string;
  dealDescription: string;
  stage: string;
  raiseAmount: string;
  industry: string;
  score: number;
  verdict: 'INVEST' | 'CONSIDER' | 'PASS' | 'HARD_PASS';
  primaryIssues: string[];
  blockers: number;
  /**
   * Concern count derived from filteredWeaknesses.length.
   * Was previously hardcoded to 0 with a "no data source yet" comment.
   */
  concerns: number;
  strengths: number;
  /**
   * IC readiness score 0–100.
   * Source priority:
   *   1. scoreExplanationV1.coverage_ratio × 100 (when available)
   *   2. Confidence band mapping: high=85, med=62, low=38, unknown=0
   * Was previously hardcoded to component default of 72.
   */
  icReadiness: number;
  /** Evidence confidence 0–100. Derived from confidence band. */
  evidenceConfidence: number;
  evidenceCoverage: 'Strong' | 'Moderate' | 'Limited';
  signals: Array<{ label: string; type: 'positive' | 'negative' | 'neutral' | 'warning' }>;
  metrics: {
    financials: KpiTile[];
    traction: KpiTile[];
    deal: KpiTile[];
    businessModel: KpiTile[];
  };
  pipelineStatus: 'Active' | 'On Hold' | 'Closed';
  diligencePhase:
    | 'Initial Screening'
    | 'Early Diligence'
    | 'Deep Diligence'
    | 'IC Prep'
    | 'Term Sheet';
  lastUpdated?: string;
  analyzing: boolean;
};

export type WorkspaceOverviewVM = {
  companyName: string;
  companyDescription: string;
  snapshotFactLabels: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    tam: string;
  };
  snapshotFacts: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    /**
     * TAM / market size.
     * Derived from overviewV2.market_size when available, else '—'.
     * '—' indicates the field has not yet been extracted by the Phase 1 pipeline
     * into a structured slot accessible here; not a data error.
     */
    tam: string;
  };
  /**
   * Signals in DealOverviewTab-compatible SignalData format.
   * Was previously hardcoded to []. Now built from analysis strengths/weaknesses.
   */
  signalData: WorkspaceOverviewSignal[];
  /** Normalised signal cards for any surface that needs type-tagged signal data. */
  signalCards: WorkspaceSignalCard[];
  financials: KpiTile[];
  traction: KpiTile[];
  deal: KpiTile[];
  businessModel: KpiTile[];
  evidenceLabels: {
    product: string;
    market: string;
    businessModel: string;
    raise: string;
  };
  keyFacts: {
    product: WorkspaceOverviewFactMeta;
    market: WorkspaceOverviewFactMeta;
    businessModel: WorkspaceOverviewFactMeta;
    raise: WorkspaceOverviewFactMeta;
  };
  productSummary: string;
  marketSummary: string;
  businessModelSummary: string;
  raiseTerms: string;
  /**
   * Medium-length narrative paragraph for the Investment Snapshot body.
   * Sourced from report.investment_analysis_overview_v2.summary_medium (paragraphs[0]).
   * Empty string when not yet extracted.
   */
  investmentSnapshotBody: string;
  insightsScore: number;
  insightsConfidence: 'High' | 'Medium' | 'Low';
  rcS6: {
    teamHighlights: WorkspaceRcS6TeamHighlight[];
    useOfFunds: WorkspaceRcS6UseOfFundsItem[];
    projectPipeline: WorkspaceRcS6ProjectPipelineItem[];
    revenueModel: WorkspaceRcS6RevenueModel;
  };
};

export type WorkspaceViewModel = {
  header: WorkspaceHeaderVM;
  overview: WorkspaceOverviewVM;
  /** Top-level signal card list for surfaces outside header/overview. */
  signalCards: WorkspaceSignalCard[];
};
