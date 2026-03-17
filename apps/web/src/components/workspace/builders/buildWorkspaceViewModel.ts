/**
 * buildWorkspaceViewModel
 *
 * Single assembly layer for the Deal Workspace UI.
 * Accepts computed view-layer inputs from DealWorkspace.tsx and returns a
 * strongly-typed WorkspaceViewModel that all tab surfaces can consume.
 *
 * Architecture:
 *   DB / Worker
 *     → API Routes
 *     → apiClient.ts (normalizeDeal, selectors)
 *     → DealWorkspace.tsx (hooks, memos)
 *     → buildWorkspaceViewModel()          ← you are here
 *     → WorkspaceViewModel
 *     → DealWorkspaceHeader / DealOverviewTab / …
 *
 * Placeholder eliminations performed here:
 *   icReadiness   — coverage_ratio × 100 or band fallback  (was: 72 default)
 *   concerns      — filteredWeaknesses.length              (was: 0)
 *   tam           — overviewV2.market_size fallback chain   (was: '—')
 *   signalData    — buildSignalCards + toOverviewSignalData (was: [])
 */

import type { WorkspaceViewModel, WorkspaceHeaderVM, WorkspaceOverviewVM } from '../contracts/workspaceViewModel';
import { buildSignalCards, toOverviewSignalData } from './buildSignalCards';

// ─── Input contract ──────────────────────────────────────────────────────────

export interface WorkspaceViewModelInputs {
  // ── Identity ────────────────────────────────────────────────────────────
  displayName: string;
  dealDescription: string;
  dealStageLabel: string;
  dealStageRaw: string;
  industry: string;
  lastUpdated?: string;
  analyzing: boolean;

  // ── Score / verdict ──────────────────────────────────────────────────────
  reportViewScore: number;
  verdict: 'INVEST' | 'CONSIDER' | 'PASS' | 'HARD_PASS';
  blockers: number;

  // ── Signal quality ───────────────────────────────────────────────────────
  /** Filtered strength strings from scoreExplanationV1.primary_strengths. */
  filteredStrengths: string[];
  /** Filtered weakness strings from scoreExplanationV1.primary_constraints. */
  filteredWeaknesses: string[];
  /** Overall confidence band derived from Phase 1 confidence data. */
  confidenceBand: 'high' | 'med' | 'low' | 'unknown';
  /**
   * Coverage ratio 0–1 from scoreExplanationV1.coverage_ratio.
   * Used as the primary source for icReadiness; falls back to band if null.
   */
  coverageRatio: number | null;
  evidenceCoverage: 'Strong' | 'Moderate' | 'Limited';

  // ── Governed / canonical narrative ──────────────────────────────────────
  governedDealOneLiner: string;
  governedProduct: string;
  governedMarket: string;
  governedBusinessModel: string;
  governedRaise: string;

  // ── KPI tiles ────────────────────────────────────────────────────────────
  selectedHeaderReady: boolean;
  raiseValue: string | null;
  raiseLabel: string | null;
  revenueValue: string | null;
  revenueTileLabel: string;
  revenueAllowed: boolean;
  growthValue: string | null;
  growthLabel: string | null;
  customersValue: string | null;
  customersLabel: string | null;
  businessModelValue: string | null;
  businessModelLabel: string | null;
  runwayTileValue: string | null;
  burnTileValue: string | null;
  reportStructuredGrowthValue: string | null;

  // ── TAM ─────────────────────────────────────────────────────────────────
  /**
   * TAM / market size string extracted from Phase 1 data.
   * Pass overviewV2?.market_size ?? overviewV2?.tam ?? null.
   * Null signals not-yet-available; builder outputs '—'.
   */
  tamValue?: string | null;

  // ── Deal context ─────────────────────────────────────────────────────────
  topSectionDealType: string;
  pipelineStatus: 'Active' | 'On Hold' | 'Closed';
  diligencePhase:
    | 'Initial Screening'
    | 'Early Diligence'
    | 'Deep Diligence'
    | 'IC Prep'
    | 'Term Sheet';

  // ── Investor insights entry ──────────────────────────────────────────────
  insightsScore: number;
  insightsConfidence: 'High' | 'Medium' | 'Low';
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const DASH = '—';

function asDisplayValue(v: string | null | undefined): string {
  if (!v || v.trim() === '' || v === DASH) return DASH;
  return v.trim();
}

/**
 * Derive IC readiness 0–100.
 * Priority: coverage_ratio × 100 → band mapping → 0.
 */
function deriveIcReadiness(
  coverageRatio: number | null,
  band: 'high' | 'med' | 'low' | 'unknown',
): number {
  if (coverageRatio != null && Number.isFinite(coverageRatio)) {
    return Math.round(Math.max(0, Math.min(100, coverageRatio * 100)));
  }
  switch (band) {
    case 'high':
      return 85;
    case 'med':
      return 62;
    case 'low':
      return 38;
    default:
      return 0;
  }
}

/**
 * Derive evidence confidence 0–100 from band.
 */
function deriveEvidenceConfidence(band: 'high' | 'med' | 'low' | 'unknown'): number {
  switch (band) {
    case 'high':
      return 85;
    case 'med':
      return 60;
    case 'low':
      return 35;
    default:
      return 0;
  }
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Build the WorkspaceViewModel from pre-computed view-layer inputs.
 *
 * This is a pure function with no side effects. Safe to call in useMemo.
 */
export function buildWorkspaceViewModel(inputs: WorkspaceViewModelInputs): WorkspaceViewModel {
  const {
    displayName,
    dealDescription,
    dealStageLabel,
    dealStageRaw,
    industry,
    lastUpdated,
    analyzing,
    reportViewScore,
    verdict,
    blockers,
    filteredStrengths,
    filteredWeaknesses,
    confidenceBand,
    coverageRatio,
    evidenceCoverage,
    governedDealOneLiner,
    governedProduct,
    governedMarket,
    governedBusinessModel,
    governedRaise,
    selectedHeaderReady,
    raiseValue,
    raiseLabel,
    revenueValue,
    revenueTileLabel,
    revenueAllowed,
    growthValue,
    growthLabel,
    customersValue,
    customersLabel,
    businessModelValue,
    businessModelLabel,
    runwayTileValue,
    burnTileValue,
    reportStructuredGrowthValue,
    tamValue,
    topSectionDealType,
    pipelineStatus,
    diligencePhase,
    insightsScore,
    insightsConfidence,
  } = inputs;

  // ── Derived values ────────────────────────────────────────────────────────

  const icReadiness = deriveIcReadiness(coverageRatio, confidenceBand);
  const evidenceConfidence = deriveEvidenceConfidence(confidenceBand);
  const concerns = filteredWeaknesses.length;
  const strengths = filteredStrengths.length;

  const tam = (typeof tamValue === 'string' && tamValue.trim() !== '' && tamValue !== DASH)
    ? tamValue.trim()
    : DASH;

  // ── Signals ───────────────────────────────────────────────────────────────

  const signalCards = buildSignalCards(filteredStrengths, filteredWeaknesses, confidenceBand);
  const signalData = toOverviewSignalData(signalCards, confidenceBand);

  const headerSignals: WorkspaceHeaderVM['signals'] = [
    ...filteredStrengths.slice(0, 2).map((s) => ({ label: s, type: 'positive' as const })),
    ...filteredWeaknesses.slice(0, 2).map((w) => ({ label: w, type: 'negative' as const })),
  ];

  // ── KPI tiles ─────────────────────────────────────────────────────────────

  const raiseDisplay = selectedHeaderReady ? asDisplayValue(raiseValue) : DASH;
  const revDisplay = selectedHeaderReady && revenueAllowed ? asDisplayValue(revenueValue) : DASH;
  const growthDisplay = selectedHeaderReady
    ? asDisplayValue(reportStructuredGrowthValue) !== DASH
      ? (reportStructuredGrowthValue as string)
      : asDisplayValue(growthValue)
    : DASH;
  const customersDisplay = selectedHeaderReady ? asDisplayValue(customersValue) : DASH;

  const financialTiles = [
    { label: selectedHeaderReady ? (raiseLabel ?? 'Raise') : 'Raise', value: raiseDisplay },
    { label: revenueTileLabel, value: revDisplay },
    { label: 'Runway', value: asDisplayValue(runwayTileValue) },
    { label: 'Burn', value: asDisplayValue(burnTileValue) },
  ];

  const tractionTiles = [
    { label: selectedHeaderReady ? (growthLabel ?? 'Growth') : 'Growth', value: growthDisplay },
    {
      label: selectedHeaderReady ? (customersLabel ?? 'Customers') : 'Customers',
      value: customersDisplay,
    },
  ];

  const dealTiles = [
    { label: 'Stage', value: dealStageLabel },
    { label: 'Type', value: topSectionDealType || DASH },
  ];

  const bmTiles = [
    {
      label: selectedHeaderReady ? (businessModelLabel ?? 'Model') : 'Model',
      value: asDisplayValue(businessModelValue) !== DASH ? (businessModelValue as string) : 'Unknown',
    },
  ];

  // ── Pipeline status derived from stage ───────────────────────────────────
  // (Already computed by DealWorkspace — passed through here for completeness.)

  // ── Diligence phase ───────────────────────────────────────────────────────
  // (Already computed by DealWorkspace — passed through here for completeness.)

  // ── Assemble ──────────────────────────────────────────────────────────────

  const header: WorkspaceHeaderVM = {
    dealName: displayName,
    dealDescription,
    stage: dealStageLabel,
    raiseAmount: raiseDisplay,
    industry,
    score: reportViewScore,
    verdict,
    primaryIssues: filteredWeaknesses,
    blockers,
    concerns,
    strengths,
    icReadiness,
    evidenceConfidence,
    evidenceCoverage,
    signals: headerSignals,
    metrics: {
      financials: financialTiles,
      traction: tractionTiles,
      deal: dealTiles,
      businessModel: bmTiles,
    },
    pipelineStatus,
    diligencePhase,
    lastUpdated,
    analyzing,
  };

  const overview: WorkspaceOverviewVM = {
    companyName: displayName,
    companyDescription: governedDealOneLiner,
    snapshotFacts: {
      raise: raiseDisplay,
      arr: revDisplay,
      growth: growthDisplay,
      customers: customersDisplay,
      tam,
    },
    signalData,
    signalCards,
    financials: financialTiles,
    traction: tractionTiles,
    deal: dealTiles,
    businessModel: bmTiles,
    productSummary: governedProduct,
    marketSummary: governedMarket,
    businessModelSummary: governedBusinessModel,
    raiseTerms: governedRaise,
    insightsScore,
    insightsConfidence,
  };

  return {
    header,
    overview,
    signalCards,
  };
}
