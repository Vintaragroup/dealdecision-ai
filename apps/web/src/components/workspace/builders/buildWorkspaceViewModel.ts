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
import { getPolicyFamily } from '../../../lib/policyUtils';

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
  /** Medium-length narrative for the Investment Snapshot body. Empty string when absent. */
  investmentSnapshotBody: string;

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

  // ── Policy routing ────────────────────────────────────────────────────────
  selectedPolicyId?: string | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const DASH = '—';
const MISSING_EVIDENCE_TEXT = 'Not extracted from evidence';

const STARTUP_TAXONOMY_RE = /\b(omnichannel|d2c|dtc|b2c|b2b|saas|subscription|marketplace|arr|mrr|customers?|users?)\b/i;
const REAL_ESTATE_SEMANTICS_RE = /\b(real\s*estate|asset|property|facility|submarket|occupan|noi|irr|cap\s*rate|ltv|dscr|preferred\s+equity|debt|equity|term)\b/i;

function asDisplayValue(v: string | null | undefined): string {
  if (!v || v.trim() === '' || v === DASH) return DASH;
  return v.trim();
}

function sanitizeShortDisplayValue(v: string | null | undefined): string {
  const s = asDisplayValue(v);
  if (s === DASH) return DASH;
  if (/^\$\s*[,.-]*\s*$/i.test(s)) return DASH;
  if (/[\d]/.test(s) === false && /^[-,./\s$%]+$/.test(s)) return DASH;
  if (/\$/.test(s) && /\d/.test(s) === false) return DASH;
  return s;
}

function normalizeSemanticText(value: string | null | undefined): string {
  const s = asDisplayValue(value);
  if (s === DASH) return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMoneyTokens(value: string | null | undefined): string[] {
  const s = asDisplayValue(value);
  if (s === DASH) return [];
  const matches = s.match(/\$\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (!/\d/.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function toConciseRaiseTerms(value: string | null | undefined): string {
  const tokens = extractMoneyTokens(value);
  if (tokens.length === 0) return DASH;
  return tokens.slice(0, 2).join(' + ');
}

function sanitizeRealEstateNoi(value: string | null | undefined): string {
  const s = asDisplayValue(value);
  if (s === DASH) return DASH;
  if (!/\d/.test(s)) return DASH;
  if (/^\$\s*[,.-]*\s*$/i.test(s)) return DASH;
  const directMoney = s.match(/\$\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?/i);
  if (directMoney) return directMoney[0].replace(/\s+/g, ' ').trim();
  const num = s.match(/[\d,]+(?:\.\d+)?/);
  if (!num) return DASH;
  return `$${num[0]}`;
}

function sanitizeEvidenceText(value: string | null | undefined, opts: { isRealEstateSchema: boolean }): string {
  const display = asDisplayValue(value);
  if (display === DASH) return MISSING_EVIDENCE_TEXT;

  if (opts.isRealEstateSchema) {
    const startupTaxonomyLeak = STARTUP_TAXONOMY_RE.test(display) && !REAL_ESTATE_SEMANTICS_RE.test(display);
    if (startupTaxonomyLeak) return MISSING_EVIDENCE_TEXT;
  }

  return display;
}

function isRealEstateBusinessModelDisplaySafe(value: string | null | undefined): boolean {
  const display = asDisplayValue(value);
  if (display === DASH) return false;
  if (REAL_ESTATE_SEMANTICS_RE.test(display)) return true;
  return !STARTUP_TAXONOMY_RE.test(display);
}

/**
 * Whether a string looks like a structured numeric/formatted KPI value —
 * i.e., it contains a digit, a percentage, or a money symbol.
 * Strings that pass contain a real number the user can read.
 * Strings that fail are qualitative mentions ("Growing", "Multiple") or
 * junk fallbacks and should be shown as "Mentioned".
 */
function looksNumericKpi(v: string): boolean {
  // Has digits, a $ sign, or a % — treat as numeric/formatted.
  return /[\d$%]/.test(v);
}

/**
 * Display value for traction KPI tiles (Growth, Customers).
 * When the header is ready and a raw value is available but contains no
 * numeric content, show "Mentioned" to signal qualitative evidence
 * rather than showing a confusing textual blob or the no-data "—".
 */
function asTractionDisplay(v: string | null | undefined): string {
  if (!v || v.trim() === '' || v === DASH) return DASH;
  const trimmed = v.trim();
  return looksNumericKpi(trimmed) ? trimmed : 'Mentioned';
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
 * Normalise snake_case machine keys to Title Case.
 * Safe no-op on already human-readable strings.
 * Examples:  "market_traction" → "Market Traction",  "SaaS" → "SaaS".
 */
function toTitleCase(s: string): string {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s.trim())
    ? s.trim().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : s;
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
    investmentSnapshotBody,
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
    selectedPolicyId,
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

  const policyFamily = getPolicyFamily(selectedPolicyId ?? null);
  const isStartupSchema = policyFamily === 'startup' || policyFamily === 'other';
  const isRealEstateSchema = policyFamily === 'real_estate';
  const isFundSchema = policyFamily === 'fund';

  const raiseDisplayRaw = (() => {
    const fromHeader = selectedHeaderReady ? sanitizeShortDisplayValue(raiseValue) : DASH;
    if (fromHeader !== DASH) return fromHeader;
    if (isRealEstateSchema) {
      const fromGoverned = sanitizeShortDisplayValue(governedRaise);
      if (fromGoverned !== DASH) return fromGoverned;
      const fromBusinessModel = sanitizeShortDisplayValue(governedBusinessModel);
      if (fromBusinessModel !== DASH) return fromBusinessModel;
    }
    return DASH;
  })();

  const raiseDisplay = isRealEstateSchema
    ? (() => {
      const concise = toConciseRaiseTerms(raiseDisplayRaw);
      return concise !== DASH ? concise : raiseDisplayRaw;
    })()
    : raiseDisplayRaw;

  const revDisplay = isRealEstateSchema
    ? sanitizeRealEstateNoi(revenueValue)
    : selectedHeaderReady && revenueAllowed && isStartupSchema
      ? asDisplayValue(revenueValue)
      : DASH;
  // Growth: prefer structured report value (numeric); fall back to header value.
  // If neither is numeric, show 'Mentioned' — qualitative evidence still informs investors.
  const growthDisplay = isRealEstateSchema
    ? sanitizeShortDisplayValue(growthValue)
    : selectedHeaderReady
      ? (
        isStartupSchema
          ? asTractionDisplay(
              sanitizeShortDisplayValue(reportStructuredGrowthValue) !== DASH
                ? (reportStructuredGrowthValue as string)
                : (growthValue ?? null),
            )
          : sanitizeShortDisplayValue(growthValue)
      )
      : DASH;
  // Customers: startup schema keeps the qualitative fallback; non-startup keeps raw mapped metric.
  const customersDisplay = isRealEstateSchema
    ? sanitizeShortDisplayValue(customersValue)
    : selectedHeaderReady
      ? (
        isStartupSchema
          ? asTractionDisplay(customersValue ?? null)
          : sanitizeShortDisplayValue(customersValue)
      )
      : DASH;

  const businessModelDisplay = (() => {
    if (isRealEstateSchema) {
      if (isRealEstateBusinessModelDisplaySafe(governedBusinessModel)) {
        return asDisplayValue(governedBusinessModel);
      }
      if (isRealEstateBusinessModelDisplaySafe(businessModelValue)) {
        return asDisplayValue(businessModelValue);
      }
      const governedFallback = asDisplayValue(governedBusinessModel);
      return governedFallback !== DASH ? governedFallback : DASH;
    }

    const fromSelected = asDisplayValue(businessModelValue);
    if (fromSelected !== DASH) return fromSelected;
    const fromGoverned = asDisplayValue(governedBusinessModel);
    return fromGoverned !== DASH ? fromGoverned : 'Unknown';
  })();

  const raiseAndBusinessModelCollide = isRealEstateSchema
    && normalizeSemanticText(raiseDisplay) !== ''
    && normalizeSemanticText(raiseDisplay) === normalizeSemanticText(businessModelDisplay);

  const raiseDisplayFinal = raiseAndBusinessModelCollide ? DASH : raiseDisplay;

  const financialTiles = isRealEstateSchema
    ? [
        { label: selectedHeaderReady ? (raiseLabel ?? 'Raise / terms') : 'Raise / terms', value: raiseDisplayFinal },
        { label: 'NOI', value: revDisplay },
        { label: 'Target IRR', value: growthDisplay },
        { label: 'Term', value: customersDisplay },
      ]
    : isFundSchema
      ? [
          { label: selectedHeaderReady ? (raiseLabel ?? 'Fund size / raise') : 'Fund size / raise', value: raiseDisplay },
          { label: 'Revenue', value: DASH },
          { label: 'Runway', value: asDisplayValue(runwayTileValue) },
          { label: 'Burn', value: asDisplayValue(burnTileValue) },
        ]
      : [
          { label: selectedHeaderReady ? (raiseLabel ?? 'Raise') : 'Raise', value: raiseDisplay },
          { label: revenueTileLabel, value: revDisplay },
          { label: 'Runway', value: asDisplayValue(runwayTileValue) },
          { label: 'Burn', value: asDisplayValue(burnTileValue) },
        ];

  const tractionTiles = isRealEstateSchema
    ? [
        { label: 'Target IRR', value: growthDisplay },
        {
          label: 'Term',
          value: customersDisplay,
        },
      ]
    : isFundSchema
      ? [
          { label: 'Target return', value: growthDisplay },
          {
            label: 'Vehicle term',
            value: customersDisplay,
          },
        ]
      : [
          { label: selectedHeaderReady ? (growthLabel ?? 'Growth') : 'Growth', value: growthDisplay },
          {
            label: selectedHeaderReady ? (customersLabel ?? 'Customers') : 'Customers',
            value: customersDisplay,
          },
        ];

  const dealTiles = [
    { label: 'Stage', value: dealStageLabel },
    // Normalise snake_case deal types (e.g. 'series_a' → 'Series A').
    { label: 'Type', value: toTitleCase(topSectionDealType) || DASH },
  ];

  const bmTiles = [
    {
      label: selectedHeaderReady
        ? (isRealEstateSchema
          ? 'Deal structure'
          : isFundSchema
            ? 'Fund strategy'
            : (businessModelLabel ?? 'Model'))
        : (isRealEstateSchema ? 'Deal structure' : isFundSchema ? 'Fund strategy' : 'Model'),
      value: businessModelDisplay !== DASH ? businessModelDisplay : 'Unknown',
    },
  ];

  const snapshotFactLabels = isRealEstateSchema
    ? {
        raise: selectedHeaderReady ? (raiseLabel ?? 'Raise / Terms') : 'Raise / Terms',
        arr: 'NOI',
        growth: 'Target IRR',
        customers: 'Term',
        tam: 'Submarket',
      }
    : {
        raise: selectedHeaderReady ? (raiseLabel ?? 'Raise') : 'Raise',
        arr: revenueTileLabel,
        growth: selectedHeaderReady ? (growthLabel ?? 'Growth') : 'Growth',
        customers: selectedHeaderReady ? (customersLabel ?? 'Customers') : 'Customers',
        tam: 'TAM',
      };

  const evidenceLabels = isRealEstateSchema
    ? {
        product: 'Asset / Facility',
        market: 'Submarket / Demand',
        businessModel: 'Deal Structure',
        raise: 'Raise / Terms',
      }
    : {
        product: 'Product',
        market: 'Market',
        businessModel: 'Business Model',
        raise: 'Raise / Terms',
      };

  // ── Pipeline status derived from stage ───────────────────────────────────
  // (Already computed by DealWorkspace — passed through here for completeness.)

  // ── Diligence phase ───────────────────────────────────────────────────────
  // (Already computed by DealWorkspace — passed through here for completeness.)

  // ── Assemble ──────────────────────────────────────────────────────────────

  const header: WorkspaceHeaderVM = {
    dealName: displayName,
    dealDescription,
    stage: dealStageLabel,
    raiseAmount: raiseDisplayFinal,
    industry,
    score: reportViewScore,
    verdict,
    // Normalise any residual snake_case machine keys to Title Case.
    primaryIssues: filteredWeaknesses.map(toTitleCase),
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
    snapshotFactLabels,
    snapshotFacts: {
      raise: raiseDisplayFinal,
      arr: isRealEstateSchema ? revDisplay : (isStartupSchema ? revDisplay : DASH),
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
    evidenceLabels,
    productSummary: sanitizeEvidenceText(governedProduct, { isRealEstateSchema }),
    marketSummary: sanitizeEvidenceText(governedMarket, { isRealEstateSchema }),
    businessModelSummary: sanitizeEvidenceText(governedBusinessModel, { isRealEstateSchema }),
    raiseTerms: sanitizeEvidenceText(governedRaise, { isRealEstateSchema: false }),
    investmentSnapshotBody,
    insightsScore,
    insightsConfidence,
  };

  return {
    header,
    overview,
    signalCards,
  };
}
