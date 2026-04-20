import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  XCircle,
  TrendingUp,
  DollarSign,
  Calendar,
  Users,
  Target,
  Shield,
  Activity,
} from 'lucide-react';
import { Button } from '../ui/button';
import { scoreToBadge, getScoreBadgeColors } from '../../lib/scoreBadge';
import type {
  WorkspaceRedesignedShellProps,
  FinancialTile,
} from './WorkspaceRedesignedShell';

// ─── Props ────────────────────────────────────────────────────────────────────

export type DealWorkspaceV4Props = WorkspaceRedesignedShellProps & {
  /** Strength strings used as "Key Drivers" fallback (from filteredStrengths in buildWorkspaceViewModel). */
  keyDrivers?: string[];
  /** Navigate back (e.g. to deals list). Optional when embedded as a tab. */
  onBack?: () => void;
  /** Compact inline summary rendered inside the Deep Dive accordion body. */
  deepDivePanel?: React.ReactNode;
  /** Compact inline summary rendered inside the Investor Insights accordion body. */
  insightsPanel?: React.ReactNode;
  /** Compact inline summary rendered inside the Evidence Explorer accordion body. */
  evidencePanel?: React.ReactNode;
  /** Compact inline summary rendered inside the Intelligence (challenge_pass) accordion body. */
  intelligencePanel?: React.ReactNode;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLastAnalyzed(isoString: string | null): string | null {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function findTile(tiles: FinancialTile[], label: string): FinancialTile {
  return (
    tiles.find((t) => t.label === label) ?? {
      label,
      value: '—',
      trust: 'not_extracted' as const,
      nullReason: 'Not extracted',
    }
  );
}

function splitIntoParas(body: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function mapPosture(posture: string | null): 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null {
  if (!posture) return null;
  const p = posture.toUpperCase();
  // 'INVEST' — from workspaceVerdict fallback path
  // 'YES' / 'STRONG_YES' — from conviction_v1.recommendation_posture (fund bands)
  if (p === 'INVEST' || p === 'YES' || p === 'STRONG_YES') return 'Proceed';
  if (p === 'INVESTIGATE') return 'Investigate';
  if (p === 'CONSIDER') return 'Caution';
  if (p === 'PASS' || p === 'HARD_PASS') return 'Pass';
  return null;
}

// ─── Presentation-layer copy helpers ─────────────────────────────────────────
// All functions below operate on the rendered output only.
// They never mutate backend payloads or introduce mock data.

/**
 * Maps a conviction dimension key + direction to investor-facing signal phrasing.
 * Falls back to the raw label (already human-readable from familyLabel) when the
 * key is not in the map.
 */
const CONTRIBUTOR_SIGNAL: Record<string, { positive: string; negative: string }> = {
  // financial_truth: label is derived at the selector layer from financial_truth_summary
  // so it is intentionally excluded here to allow the truth-state-aware label to pass through.
  capital_structure:        { positive: 'Capital structure and ownership terms are clear',   negative: 'Capital structure or ownership terms need clarification' },
  traction_validation:      { positive: 'Traction metrics confirmed by primary evidence',   negative: 'Traction claims lack primary-source verification' },
  market_demand:            { positive: 'Market demand is supported by available evidence', negative: 'Market demand lacks sufficient confirming evidence' },
  product_or_asset_quality: { positive: 'Product or asset quality is evidenced',            negative: 'Product or asset quality evidence is limited' },
  team_execution:           { positive: 'Team demonstrates credible execution capability',  negative: 'Execution track record is thin or unverified' },
  risk_dependencies:        { positive: 'Key risk dependencies are identifiable',           negative: 'Risk dependencies remain unresolved' },
  external_corroboration:   { positive: 'Claims are corroborated by third-party sources',  negative: 'Limited third-party validation for key claims' },
  evidence_quality:         { positive: 'Evidence quality is strong across documents',      negative: 'Evidence quality is insufficient to underwrite' },
  coverage:                 { positive: 'Documentation coverage is comprehensive',          negative: 'Material gaps in documentation coverage' },
  contradictions:           { positive: 'No material contradictions detected',              negative: 'Contradictions present across evidence sources' },
};

function mapContributorToSignal(key: string, label: string, direction: 'positive' | 'negative'): string {
  const entry = CONTRIBUTOR_SIGNAL[key];
  if (entry) return entry[direction];
  return label; // familyLabel values are already human-readable
}

/**
 * Maps internal check-code tokens inside auto-generated required-check text to
 * investor-readable diligence prompts.
 *
 * Handles two auto-generated patterns from buildConvictionV1:
 *   "Provide deterministic evidence for {code}."
 *   "Resolve contradiction: {text}"
 *
 * Strings that don't match either pattern (e.g. diligenceOpenItems) are passed through.
 */
const CHECK_CODE_PROMPTS: Record<string, string> = {
  business_model:           'Confirm the business model with supporting documentation',
  product_or_asset_quality: 'Submit independent evidence of product or asset quality',
  key_risks_detected:       'Detail identified risks and provide mitigation evidence',
  external_corroboration:   'Provide third-party validation for core claims',
  financial_truth:          'Submit verified financial statements or a financial model',
  market_demand:            'Evidence market demand — cohorts, letters of intent, or contracts',
  traction_validation:      'Validate traction metrics with primary-source data',
  capital_structure:        'Clarify cap table, ownership terms, and any convertible instruments',
  coverage:                 'Increase documentation coverage across key due diligence areas',
  evidence_quality:         'Upgrade evidence quality to audited or primary-source documents',
  team_execution:           'Submit team credentials and relevant execution history',
  risk_dependencies:        'Identify and address material dependencies or risk factors',
  traction:                 'Provide traction evidence — revenue, cohorts, or signed agreements',
};

const LABEL_REMAP: Array<[RegExp, string]> = [
  [/\bProduct\/Asset Quality\b/gi, 'product or asset quality'],
  [/\bproduct_or_asset_quality\b/gi, 'product or asset quality'],
  [/\bFinancial Truth\b/gi, 'financial data'],
  [/\bfinancial_truth\b/gi, 'financial data'],
  [/\bExternal Corroboration\b/gi, 'third-party validation'],
  [/\bexternal_corroboration\b/gi, 'third-party validation'],
  [/\bCapital Structure\b/gi, 'capital structure'],
  [/\bMarket Demand\b/gi, 'market demand'],
  [/\bTeam Execution\b/gi, 'team credentials'],
  [/\bTraction Validation\b/gi, 'traction claims'],
  [/\bEvidence Quality\b/gi, 'evidence quality'],
  [/\bCoverage\b(?!\s+ratio)/gi, 'documentation coverage'],
];

function applyLabelRemap(text: string): string {
  let out = text;
  for (const [pattern, replacement] of LABEL_REMAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function humanizeRequiredCheck(raw: string): string {
  // Pattern A: "Provide deterministic evidence for {code}."
  const detEvMatch = raw.match(/^Provide deterministic evidence for ([a-z_A-Z0-9]+)\.?$/i);
  if (detEvMatch) {
    const code = detEvMatch[1].toLowerCase();
    return CHECK_CODE_PROMPTS[code] ?? `Provide evidence for ${code.replace(/_/g, ' ')}`;
  }

  // Pattern B: "Resolve contradiction: {text}"
  const resolveMatch = raw.match(/^Resolve contradiction:\s*(.+)$/i);
  if (resolveMatch) {
    const inner = resolveMatch[1].replace(/\s*has conflicting support\s*\([^)]*\)\.?/gi, '').trim();
    const remapped = applyLabelRemap(inner).replace(/\.$/, '');
    return `Address conflicting signals in ${remapped}`;
  }

  // Passthrough for natural-language items (e.g. diligenceOpenItems text)
  return raw;
}

function humanizeContradiction(text: string): string {
  // Pattern: "X has conflicting support (code)."
  const match = text.match(/^(.+?)\s+has conflicting support\s*\(([^)]*)\)\.?$/i);
  if (match) {
    const dim = applyLabelRemap(match[1].trim());
    return `${dim} shows conflicting signals`;
  }
  return text;
}

/**
 * Light formatting pass for open-question / diligence strings.
 * - Capitalizes first letter
 * - Appends '?' when the string starts with a question word and doesn't already end with '?'
 * No fabrication — operates only on the supplied string.
 */
function formatDiligenceItem(s: string): string {
  if (!s) return s;
  const cap = s.charAt(0).toUpperCase() + s.slice(1);
  if (/^(what|who|where|when|why|how|is|are|does|did|has|have|will|should|can|could|would)\b/i.test(cap) && !cap.endsWith('?')) {
    return cap + '?';
  }
  return cap;
}

// ─── Top-level Decision Status ───────────────────────────────────────────────

interface DecisionStatus {
  /** Rendering tier — drives accent colour and icon choice. */
  tier: 'go' | 'investigate' | 'caution' | 'pass' | 'unknown';
  /** Short investor-facing headline. */
  headline: string;
  /** Brief readiness label shown as a pill beside the headline. */
  readiness: string;
  /** One sentence that gives the primary reason for the stance. */
  narrative: string;
}

/**
 * Derives a single top-level decision stance from existing workspace props.
 * No new backend calls — all inputs are already present in DealWorkspaceV4Props.
 *
 * Priority order: recommendation posture > conviction score > neither.
 */
function deriveDecisionStatus({
  recommendation,
  convictionScore,
  verdictResistanceScore,
}: {
  recommendation: 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null;
  convictionScore: number | null;
  verdictResistanceScore: number | null;
}): DecisionStatus {
  // Pass: negative posture — no other signals matter.
  if (recommendation === 'Pass') {
    return {
      tier: 'pass',
      headline: 'Do Not Proceed',
      readiness: 'Not Investment Ready',
      narrative: 'Current evidence does not support investment at this stage.',
    };
  }

  // Proceed: positive posture — check score + confidence to determine depth.
  if (recommendation === 'Proceed') {
    const scoreOk = convictionScore !== null && convictionScore >= 65;
    const confidenceOk = verdictResistanceScore === null || verdictResistanceScore >= 55;
    if (scoreOk && confidenceOk) {
      return {
        tier: 'go',
        headline: 'Ready to Advance',
        readiness: 'Decision Ready',
        narrative: 'Core evidence supports advancing this deal. Key conditions appear met.',
      };
    }
    return {
      tier: 'investigate',
      headline: 'Promising — Further Validation Required',
      readiness: 'Not Yet Ready to Commit',
      narrative: 'Initial signals are positive, but the evidence base requires strengthening before committing capital.',
    };
  }

  // Investigate: explicitly flag for further work.
  if (recommendation === 'Investigate') {
    return {
      tier: 'investigate',
      headline: 'Investigate — Not Ready to Commit',
      readiness: 'Not Ready to Commit',
      narrative: 'This opportunity shows potential, but key evidence gaps or contradictions prevent a confident investment decision.',
    };
  }

  // Caution/Consider: promise but conditions not met.
  if (recommendation === 'Caution') {
    const score = convictionScore ?? 0;
    if (score >= 55) {
      return {
        tier: 'investigate',
        headline: 'Promising — Further Validation Required',
        readiness: 'Validate Before Committing',
        narrative: 'Initial signals are promising, but key conditions must be validated before committing capital.',
      };
    }
    return {
      tier: 'caution',
      headline: 'Caution — Key Conditions Not Met',
      readiness: 'Not Ready to Commit',
      narrative: 'Material conditions are unmet. Substantive evidence is required before this deal can advance.',
    };
  }

  // Score-only fallback: no posture from conviction model.
  if (convictionScore !== null) {
    if (convictionScore >= 65) {
      return {
        tier: 'investigate',
        headline: 'Promising — Further Validation Required',
        readiness: 'Further Validation Required',
        narrative: 'Initial analysis shows promise. Full conviction posture is not yet established.',
      };
    }
    return {
      tier: 'caution',
      headline: 'Uncertain — Insufficient Signal',
      readiness: 'Not Ready to Commit',
      narrative: 'Signal is mixed or below threshold. Additional evidence and analysis are required.',
    };
  }

  // No data.
  return {
    tier: 'unknown',
    headline: 'Assessment Pending',
    readiness: 'Not yet evaluated',
    narrative: 'Run analysis to generate a decision assessment for this deal.',
  };
}

/**
 * Returns true for auto-generated conviction summary strings that are mechanically
 * derived from the score number and contributor labels — redundant given the UI already
 * shows both. Suppressing them avoids repeating information in a less readable form.
 */
function isMechanicalConvictionText(text: string | null): boolean {
  if (!text) return true;
  if (/^conviction\s+\d+\/100/i.test(text)) return true;
  if (/^primary deterministic support is led by/i.test(text)) return true;
  if (/^conviction is constrained by limited deterministic support/i.test(text)) return true;
  return false;
}

// ─── Section-level narrative composition ─────────────────────────────────────
// Pure presentation-layer functions. All output is derived from props that are
// already in scope. No content is invented. Every sentence traces back to a
// deterministic field or a conviction signal.

type _Contributor = { key: string; label: string; scoreDelta: number | null };

/**
 * Strips known internal system artifacts from governed copy strings.
 * Targeted: standalone "deterministic" / "governed" adjective use.
 * Conservative — does not stem or rewrite sentences.
 */
function cleanCopy(s: string | null): string | null {
  if (!s) return null;
  let out = s;
  out = out.replace(/\bdeterministic\s+(?=evidence|signal|support|data|model|score)/gi, '');
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return out || null;
}

/** Ensures a string ends with a period and starts with a capital letter. */
function normalizeSentence(s: string): string {
  const capped = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + '.';
}

/**
 * Composes an investor-memo-style narrative for the Investment Snapshot from conviction props.
 * Returns an array of paragraph strings, rendered as separate <p> elements.
 * Returns an empty array when conviction data is fully absent (caller falls back to summary text).
 */
function composeInvestmentNarrative({
  recommendation,
  convictionScore,
  convictionRationale,
  topPositiveContributors,
  topNegativeContributors,
  humanizedChecks,
}: {
  recommendation: 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null;
  convictionScore: number | null;
  convictionRationale: string | null;
  topPositiveContributors: _Contributor[];
  topNegativeContributors: _Contributor[];
  humanizedChecks: string[];
}): string[] {
  const lines: string[] = [];
  const hasAnySignals =
    recommendation !== null ||
    convictionScore !== null ||
    topPositiveContributors.length > 0 ||
    topNegativeContributors.length > 0;

  if (!hasAnySignals) return lines;

  // Opening: non-mechanical conviction rationale, or constructed posture sentence.
  const rationale = !isMechanicalConvictionText(convictionRationale) ? convictionRationale : null;
  if (rationale) {
    lines.push(normalizeSentence(rationale));
  } else if (recommendation || convictionScore !== null) {
    const scorePhrase = convictionScore !== null ? ` (${convictionScore}/100)` : '';
    if (recommendation === 'Proceed') {
      lines.push(`Initial analysis supports proceeding${scorePhrase}.`);
    } else if (recommendation === 'Investigate') {
      lines.push(`Initial analysis warrants further investigation${scorePhrase} — not yet ready to pass or commit.`);
    } else if (recommendation === 'Caution') {
      lines.push(`Initial analysis warrants caution${scorePhrase} — key conditions must be met before committing capital.`);
    } else if (recommendation === 'Pass') {
      lines.push(`Initial analysis indicates this deal does not meet the required conviction threshold${scorePhrase}.`);
    }
  }

  // Strengths sentence: up to 3 positive signals joined as prose.
  if (topPositiveContributors.length > 0) {
    const signals = topPositiveContributors
      .slice(0, 3)
      .map((c) => mapContributorToSignal(c.key, c.label, 'positive').toLowerCase());
    const joined =
      signals.length === 1
        ? signals[0]
        : signals.length === 2
          ? `${signals[0]} and ${signals[1]}`
          : `${signals[0]}, ${signals[1]}, and ${signals[2]}`;
    lines.push(`Supporting evidence indicates ${joined}.`);
  }

  // Concerns sentence: up to 2 negative signals.
  if (topNegativeContributors.length > 0) {
    const concerns = topNegativeContributors
      .slice(0, 2)
      .map((c) => mapContributorToSignal(c.key, c.label, 'negative').toLowerCase());
    const joined =
      concerns.length === 1
        ? concerns[0]
        : `${concerns[0]}, and ${concerns[1]}`;
    lines.push(`Areas requiring further validation: ${joined}.`);
  }

  // Next-steps sentence: first 2 humanized checks.
  if (humanizedChecks.length > 0) {
    const checks = humanizedChecks.slice(0, 2).map((c) => c.replace(/\.$/, '').toLowerCase());
    const sentence =
      checks.length === 1
        ? `Before proceeding: ${checks[0]}.`
        : `Before proceeding, validate: ${checks[0]}, and ${checks[1]}.`;
    lines.push(sentence);
  }

  return lines;
}

/**
 * Composes a product card narrative. Returns `primary` (the governed value, cleaned and
 * normalized) and an optional `signal` line sourced from conviction contributor keys.
 */
function composeProductNarrative({
  productValue,
  topPositiveContributors,
  topNegativeContributors,
}: {
  productValue: string | null;
  topPositiveContributors: _Contributor[];
  topNegativeContributors: _Contributor[];
}): { primary: string | null; signal: string | null } {
  const primary = productValue
    ? normalizeSentence(cleanCopy(productValue) ?? productValue)
    : null;

  const hasQualityPositive = topPositiveContributors.some(
    (c) => c.key === 'product_or_asset_quality' || c.key === 'traction_validation',
  );
  const hasQualityNegative = topNegativeContributors.some(
    (c) => c.key === 'product_or_asset_quality' || c.key === 'evidence_quality',
  );

  const signal = hasQualityPositive
    ? 'Product quality is evidenced by available documentation.'
    : hasQualityNegative
      ? 'Product quality evidence is limited — independent verification required.'
      : null;

  return { primary, signal };
}

/**
 * Composes a market card narrative. Cleans internal artifacts from the governed value
 * and appends a demand-validation signal line sourced from conviction contributor keys.
 */
function composeMarketNarrative({
  marketValue,
  topPositiveContributors,
  topNegativeContributors,
}: {
  marketValue: string | null;
  topPositiveContributors: _Contributor[];
  topNegativeContributors: _Contributor[];
}): { primary: string | null; signal: string | null } {
  const primary = marketValue
    ? normalizeSentence(cleanCopy(marketValue) ?? marketValue)
    : null;

  const hasDemandPositive = topPositiveContributors.some(
    (c) => c.key === 'market_demand' || c.key === 'external_corroboration',
  );
  const hasDemandNegative = topNegativeContributors.some(
    (c) => c.key === 'market_demand' || c.key === 'external_corroboration' || c.key === 'traction_validation',
  );

  const signal = hasDemandPositive
    ? 'Market demand is substantiated by available evidence.'
    : hasDemandNegative
      ? 'Market demand validation is limited — traction or third-party corroboration is needed.'
      : null;

  return { primary, signal };
}

/**
 * Composes the Financial Snapshot prose section from targeted sub-model summaries,
 * tile availability, and integrity status. Returns up to 3 investor-readable sentences.
 */
function composeFinancialNarrative({
  financialCurrentStateSummary,
  financialBurnRunwaySummary,
  financialNarrative,
  revenueTile,
  burnTile,
  runwayTile,
  financialIntegrityStatus,
}: {
  financialCurrentStateSummary: string | null;
  financialBurnRunwaySummary: string | null;
  financialNarrative: string | null;
  revenueTile: FinancialTile;
  burnTile: FinancialTile;
  runwayTile: FinancialTile;
  financialIntegrityStatus: 'validated' | 'unvalidated' | 'partial' | null;
}): string[] {
  const lines: string[] = [];

  // Primary: targeted summaries from sub-models (already null-state filtered by selector).
  if (financialCurrentStateSummary) lines.push(normalizeSentence(financialCurrentStateSummary));
  if (financialBurnRunwaySummary) lines.push(normalizeSentence(financialBurnRunwaySummary));
  // Fallback: top-level narrative when both sub-summaries are absent.
  if (lines.length === 0 && financialNarrative) lines.push(normalizeSentence(financialNarrative));

  // Validation note.
  if (financialIntegrityStatus === 'unvalidated' || financialIntegrityStatus === 'partial') {
    lines.push('Financial figures are unaudited — independent validation is required before relying on these projections.');
  }

  // Missing data note: only add when we have some context (at least one prose line).
  if (lines.length > 0) {
    // Derived: metric exists but sourced from projections — not directly verified.
    const derivedLabels = [
      revenueTile.trust === 'interim_extraction' ? 'revenue' : null,
      burnTile.trust === 'interim_extraction' ? 'burn rate' : null,
      runwayTile.trust === 'interim_extraction' ? 'runway' : null,
    ].filter((l): l is string => l !== null);

    // Truly absent: extraction made no attempt or came back empty.
    const missingLabels = [
      revenueTile.trust === 'not_extracted' ? 'revenue' : null,
      burnTile.trust === 'not_extracted' ? 'burn rate' : null,
      runwayTile.trust === 'not_extracted' ? 'runway' : null,
    ].filter((l): l is string => l !== null);

    const joinLabels = (labels: string[]) =>
      labels.length === 1
        ? labels[0]
        : labels.length === 2
          ? `${labels[0]} and ${labels[1]}`
          : `${labels[0]}, ${labels[1]}, and ${labels[2]}`;

    if (derivedLabels.length > 0) {
      const joined = joinLabels(derivedLabels);
      const verb = derivedLabels.length === 1 ? 'is' : 'are';
      lines.push(
        `${joined.charAt(0).toUpperCase() + joined.slice(1)} ${verb} derived from projections and not directly verified — treat as estimated.`,
      );
    }

    if (missingLabels.length > 0) {
      const joined = joinLabels(missingLabels);
      lines.push(
        `${joined.charAt(0).toUpperCase() + joined.slice(1)} data is not available and should be obtained before proceeding.`,
      );
    }
  }

  return lines;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DealWorkspaceV4({
  darkMode,
  // identity
  companyName,
  dealType,
  stage,
  raise,
  raiseNullRule,
  lastAnalyzedAt,
  // conviction
  convictionScore,
  convictionBand,
  convictionPosture,
  convictionHeadline,
  convictionRationale,
  convictionProvisional,
  topPositiveContributors,
  topNegativeContributors,
  requiredNextChecks,
  investmentSnapshotBody,
  // key facts
  product,
  market,
  businessModel,
  raiseTerms,
  // financial
  financialTiles,
  financialCoverage,
  financialIntegrityStatus,
  financialNarrative,
  financialCurrentStateSummary,
  financialBurnRunwaySummary,
  underwritingNarrative,
  // risk
  redFlags,
  openQuestions,
  contradictions,
  blockerCount: _blockerCount,
  underwritingReadiness: _underwritingReadiness,
  // detail rows
  teamHighlights,
  useOfFunds,
  projectPipeline,
  revenueModel,
  // workbench
  deepDiveReady,
  insightsReady,
  // callbacks
  onBack,
  onRunAnalysis,
  onOpenDeepDive,
  onOpenInsights,
  onOpenEvidenceExplorer,
  // workbench scores
  verdictResistanceScore,
  verdictResistanceLabel,
  // panel slots
  deepDivePanel,
  insightsPanel,
  evidencePanel,
  intelligencePanel,
  // extra
  keyDrivers,
}: DealWorkspaceV4Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    team: false,
    funds: false,
    pipeline: false,
    revenue: false,
    deepDive: false,
    insights: false,
    evidence: false,
    intelligence: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // ── Derived display values ───────────────────────────────────────────────

  const displayCompany = companyName ?? 'Not extracted';
  const displayDealType = dealType ?? 'Not available';
  const displayStage = stage ?? 'Not available';
  const displayRaise = raise ?? (raiseNullRule ? 'Not disclosed' : 'Not available');
  const displayLastAnalyzed = formatLastAnalyzed(lastAnalyzedAt);

  const recommendation = mapPosture(convictionPosture);
  const investmentParas = splitIntoParas(investmentSnapshotBody);
  const activeKeyDrivers = (keyDrivers ?? []).filter(Boolean);

  // ── TRACE: final props received by DealWorkspaceV4 ──────────────────────────
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.group('[TRACE:DealWorkspaceV4] final rendered props');
    console.log('product:              ', product ?? null);
    console.log('market:               ', market ?? null);
    console.log('raiseTerms:           ', raiseTerms ?? null);
    console.log('businessModel:        ', businessModel ?? null);
    console.log('investmentSnapshotBody:', investmentSnapshotBody ?? null);
    console.log('convictionScore:      ', convictionScore ?? null);
    console.log('convictionPosture:    ', convictionPosture ?? null);
    console.groupEnd();
  }, [product, market, raiseTerms, businessModel, investmentSnapshotBody, convictionScore, convictionPosture]);

  // Deduplicate required checks after humanizing to avoid showing equivalent prompts twice
  const humanizedChecks: string[] = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of requiredNextChecks) {
      const humanized = humanizeRequiredCheck(raw);
      const key = humanized.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(humanized);
      }
    }
    return out;
  })();

  // ── Top-level decision status ────────────────────────────────────────────
  const decisionStatus = deriveDecisionStatus({
    recommendation,
    convictionScore,
    verdictResistanceScore: verdictResistanceScore ?? null,
  });

  const revenueTile = findTile(financialTiles, 'Revenue / ARR');
  const burnTile = findTile(financialTiles, 'Monthly Burn');
  const runwayTile = findTile(financialTiles, 'Runway');

  const showIntegrityBadge =
    financialIntegrityStatus && financialIntegrityStatus !== 'validated';
  const showCoverageBadge =
    financialCoverage !== null && financialCoverage < 80;

  // ── Section-level composition ────────────────────────────────────────────

  // Investment Snapshot: composed from conviction signals. Falls back to investmentParas
  // when conviction data is absent (e.g. analysis not yet run).
  const convictionNarrativeLines = composeInvestmentNarrative({
    recommendation,
    convictionScore,
    convictionRationale,
    topPositiveContributors,
    topNegativeContributors,
    humanizedChecks,
  });

  // Product / Market: primary governed value + optional signal line from contributors.
  const { primary: productPrimary, signal: productSignal } = composeProductNarrative({
    productValue: product.value && product.value !== '—' ? product.value : null,
    topPositiveContributors,
    topNegativeContributors,
  });
  const { primary: marketPrimary, signal: marketSignal } = composeMarketNarrative({
    marketValue: market.value && market.value !== '—' ? market.value : null,
    topPositiveContributors,
    topNegativeContributors,
  });

  // Financial Snapshot: targeted summaries + tile availability + integrity context.
  const financialProseLines = composeFinancialNarrative({
    financialCurrentStateSummary,
    financialBurnRunwaySummary,
    financialNarrative,
    revenueTile,
    burnTile,
    runwayTile,
    financialIntegrityStatus,
  });

  const hasTeam = teamHighlights.length > 0;
  const hasUoF = useOfFunds.length > 0;
  const hasPipeline = projectPipeline.length > 0;
  const hasRevenueModel =
    Boolean(revenueModel.type) || Boolean(revenueModel.unitEconomics) || Boolean(revenueModel.detail);

  // Adapt contradictions (string[]) → structured items for V4 rendering
  const contradictionItems = contradictions.map((text) => ({ severity: 'low' as const, text }));

  // ── Styling helpers ──────────────────────────────────────────────────────

  const getRecommendationColor = (rec: 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null) => {
    if (rec === 'Proceed') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (rec === 'Investigate') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (rec === 'Caution') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (rec === 'Pass') return 'bg-red-500/10 text-red-400 border-red-500/20';
    return darkMode
      ? 'bg-white/5 text-gray-400 border-white/10'
      : 'bg-gray-100 text-gray-500 border-gray-200';
  };

  const getConvictionColor = (score: number | null) => {
    if (score === null) return darkMode ? 'text-gray-500' : 'text-gray-400';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    if (severity === 'high') return 'text-red-400 bg-red-400/10 border-red-500/20';
    if (severity === 'medium') return 'text-amber-400 bg-amber-400/10 border-amber-500/20';
    return 'text-gray-400 bg-gray-400/10 border-gray-500/20';
  };

  const card = darkMode ? 'bg-white/[0.02] border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const sectionLabel = darkMode ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className={`w-full ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>

      {/* Sticky Identity Strip */}
      <div
        className={`sticky top-0 z-10 px-6 py-3 border-b backdrop-blur-xl ${
          darkMode
            ? 'bg-[#0a0a0a]/95 border-white/10'
            : 'bg-gray-50/95 border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                }`}
              >
                <ArrowLeft className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <h1 className={`text-base font-medium ${heading}`}>{displayCompany}</h1>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayDealType}</span>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayStage}</span>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              <span className={`text-sm ${muted}`}>{displayRaise}</span>
              {displayLastAnalyzed && (
                <>
                  <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
                  <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    Analyzed {displayLastAnalyzed}
                  </span>
                </>
              )}
            </div>
          </div>


        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {onRunAnalysis && (
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              className="gap-1.5"
              onClick={onRunAnalysis}
            >
              <Sparkles className="w-4 h-4" />
              Re-run Analysis
            </Button>
          </div>
        )}

        {/* ── Decision Status ── primary stance — everything below supports this ── */}
        {(() => {
          const ds = decisionStatus;
          const accentMap: Record<DecisionStatus['tier'], { borderL: string; bg: string; text: string; pillBg: string; pillBorder: string }> = {
            go:          { borderL: 'border-l-emerald-500',  bg: darkMode ? 'bg-emerald-500/[0.04]'  : 'bg-emerald-50',   text: darkMode ? 'text-emerald-400'  : 'text-emerald-700', pillBg: darkMode ? 'bg-emerald-500/10'  : 'bg-emerald-100',  pillBorder: darkMode ? 'border-emerald-500/30'  : 'border-emerald-300' },
            investigate: { borderL: 'border-l-amber-500',   bg: darkMode ? 'bg-amber-500/[0.04]'   : 'bg-amber-50',    text: darkMode ? 'text-amber-400'    : 'text-amber-700',  pillBg: darkMode ? 'bg-amber-500/10'   : 'bg-amber-100',   pillBorder: darkMode ? 'border-amber-500/30'   : 'border-amber-300'  },
            caution:     { borderL: 'border-l-orange-500',  bg: darkMode ? 'bg-orange-500/[0.04]'  : 'bg-orange-50',   text: darkMode ? 'text-orange-400'   : 'text-orange-700', pillBg: darkMode ? 'bg-orange-500/10'  : 'bg-orange-100',  pillBorder: darkMode ? 'border-orange-500/30'  : 'border-orange-300' },
            pass:        { borderL: 'border-l-red-500',     bg: darkMode ? 'bg-red-500/[0.04]'     : 'bg-red-50',      text: darkMode ? 'text-red-400'      : 'text-red-700',    pillBg: darkMode ? 'bg-red-500/10'     : 'bg-red-100',     pillBorder: darkMode ? 'border-red-500/30'     : 'border-red-300'    },
            unknown:     { borderL: darkMode ? 'border-l-white/10' : 'border-l-gray-300', bg: darkMode ? 'bg-white/[0.02]' : 'bg-gray-50', text: darkMode ? 'text-gray-500' : 'text-gray-500', pillBg: darkMode ? 'bg-white/5' : 'bg-gray-100', pillBorder: darkMode ? 'border-white/10' : 'border-gray-200' },
          };
          const acc = accentMap[ds.tier];
          return (
            <div className={`p-5 rounded-lg border-l-4 ${acc.borderL} ${acc.bg} ${darkMode ? 'border border-white/10' : 'border border-gray-200'}`}>
              <div className={`text-[10px] uppercase tracking-widest font-medium mb-1.5 ${acc.text}`}>
                Decision Status
              </div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {ds.headline}
                </span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${acc.pillBg} ${acc.text} ${acc.pillBorder}`}>
                  {ds.readiness}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {ds.narrative}
              </p>
            </div>
          );
        })()}

        {/* Decision Layer (Above the Fold) */}
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6">

          {/* LEFT: Opportunity Signal — why this deal looks interesting or weak */}
          <div className="space-y-4">
            <div>
              <h2 className={`text-sm font-medium ${sectionLabel}`}>Opportunity Signal</h2>
              <p className={`text-xs mt-0.5 ${muted}`}>Why this deal looks interesting or weak</p>
            </div>
{/* Opportunity Signal — badge-first score signal, recommendation secondary */}
            {(recommendation || convictionScore !== null) && (() => {
              const snapBadge = scoreToBadge(convictionScore, 'deal_score');
              const snapColors = getScoreBadgeColors(snapBadge.bucket, darkMode);
              return (
                <div className="space-y-2">
                  {convictionScore !== null && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${snapColors.bg} ${snapColors.text} ${snapColors.border}`}>
                        {snapBadge.label} — {snapBadge.meaning}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {recommendation && (
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-medium uppercase tracking-wide ${getRecommendationColor(recommendation)}`}>
                        {recommendation}
                      </span>
                    )}
                    {convictionScore !== null && (
                      <span className={`text-xs ${muted}`}>Score: {convictionScore}/100</span>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-3">
              {convictionNarrativeLines.length > 0 ? (
                convictionNarrativeLines.map((line, idx) => (
                  <p key={idx} className={`text-sm leading-relaxed ${body}`}>
                    {line}
                  </p>
                ))
              ) : investmentParas.length > 0 ? (
                investmentParas.map((para, idx) => (
                  <p key={idx} className={`text-sm leading-relaxed ${body}`}>
                    {para}
                  </p>
                ))
              ) : (
                <p className={`text-sm ${muted} italic`}>Investment thesis not yet available.</p>
              )}
            </div>
          </div>

          {/* RIGHT: Capital Readiness + Key Drivers (supporting lenses for the decision status above) */}
          <div className="space-y-5">

            {/* Capital Readiness — would I commit capital right now? */}
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className={`text-xs uppercase tracking-wide mb-2.5 ${muted}`}>
                Capital Readiness
              </div>
              {(() => {
                const cvBadge = scoreToBadge(convictionScore, 'conviction');
                const cvColors = getScoreBadgeColors(cvBadge.bucket, darkMode);
                return (
                  <div className="space-y-1.5 mb-3">
                    {/* Primary: badge label + meaning */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-md border text-xs font-semibold ${cvColors.bg} ${cvColors.text} ${cvColors.border}`}>
                        {cvBadge.label}
                      </span>
                      <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {cvBadge.meaning}
                      </span>
                      {convictionProvisional && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                          darkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-50 text-amber-600 border border-amber-200'
                        }`}>
                          Provisional
                        </span>
                      )}
                    </div>
                    {/* One-liner interpretation — capital-readiness specific */}
                    <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      This reflects whether capital would commit to this deal at current evidence levels.
                    </p>
                    {/* Secondary: raw score */}
                    <div className={`text-sm font-medium tabular-nums ${cvColors.text}`}>
                      {convictionScore !== null ? `${convictionScore} / 100` : '—'}
                    </div>
                  </div>
                );
              })()}
              {convictionHeadline && !isMechanicalConvictionText(convictionHeadline) && (
                <p className={`text-xs font-medium leading-snug mb-1 ${heading}`}>
                  {convictionHeadline}
                </p>
              )}
              {convictionRationale && !isMechanicalConvictionText(convictionRationale) && (
                <p className={`text-xs leading-relaxed ${sectionLabel}`}>
                  {convictionRationale}
                </p>
              )}
              {/* Score context: three-dimension explanation */}
              {(verdictResistanceScore != null || convictionBand != null) && (
                <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
                  <div className={`text-[10px] uppercase tracking-wide mb-1.5 ${muted}`}>Score context</div>
                  <div className={`space-y-1.5 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {/* Row 1: Deal quality */}
                    <div className="flex items-start gap-1.5">
                      <span className={`shrink-0 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Deal quality</span>
                      <span>—</span>
                      <span>{convictionScore != null ? `${convictionScore}/100 · overall investment signal` : 'not yet evaluated'}</span>
                    </div>
                    {/* Row 2: Capital readiness */}
                    <div className="flex items-start gap-1.5">
                      <span className={`shrink-0 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Capital readiness</span>
                      <span>—</span>
                      <span>
                        {recommendation != null
                          ? `${recommendation} · would capital commit?`
                          : 'not yet evaluated'}
                        {convictionBand && convictionBand.toLowerCase() !== recommendation?.toLowerCase()
                          ? ` (quantitative model: ${convictionBand})`
                          : null}
                      </span>
                    </div>
                    {/* Row 3: Decision Confidence */}
                    {verdictResistanceScore != null && (
                      <div className="flex items-start gap-1.5">
                        <span className={`shrink-0 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Conclusion robustness</span>
                        <span>—</span>
                        <span>
                          <span className={getConvictionColor(verdictResistanceScore)}>{verdictResistanceScore}/100</span>
                          {verdictResistanceLabel ? ` · ${verdictResistanceLabel}` : ''}
                          {' '}· how stable the conclusion is against challenge
                        </span>
                      </div>
                    )}
                    {/* Gap explanation */}
                    {convictionScore != null && verdictResistanceScore != null && Math.abs(convictionScore - verdictResistanceScore) >= 10 && (
                      <p className={`pt-1 text-[11px] leading-relaxed ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                        {convictionScore > verdictResistanceScore
                          ? 'The quality signal is stronger than the evidence base currently supports — verdict confidence lags the score.'
                          : 'The evidence is more robust than the headline score reflects — the verdict is better supported than the number suggests.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Key Drivers: prefer conviction contributors, fall back to legacy keyDrivers */}
            {(topPositiveContributors.length > 0 || topNegativeContributors.length > 0) ? (
              <div>
                <div className={`text-xs uppercase tracking-wide mb-3 ${muted}`}>Key Drivers</div>
                <div className="space-y-2">
                  {topPositiveContributors.map((c, idx) => (
                    <div key={`pos-${idx}`} className="flex items-start gap-2">
                      <div
                        className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                          darkMode ? 'bg-emerald-400' : 'bg-emerald-500'
                        }`}
                      />
                      <span className={`text-xs ${sectionLabel}`}>{mapContributorToSignal(c.key, c.label, 'positive')}</span>
                    </div>
                  ))}
                  {topNegativeContributors.map((c, idx) => (
                    <div key={`neg-${idx}`} className="flex items-start gap-2">
                      <div
                        className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                          darkMode ? 'bg-red-400' : 'bg-red-500'
                        }`}
                      />
                      <span className={`text-xs ${sectionLabel}`}>{mapContributorToSignal(c.key, c.label, 'negative')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeKeyDrivers.length > 0 && (
              <div>
                <div className={`text-xs uppercase tracking-wide mb-3 ${muted}`}>Key Drivers</div>
                <div className="space-y-2">
                  {activeKeyDrivers.slice(0, 5).map((driver, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div
                        className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                          darkMode ? 'bg-emerald-400' : 'bg-emerald-500'
                        }`}
                      />
                      <span className={`text-xs ${sectionLabel}`}>{driver}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Required Next Checks (diligence checklist from conviction) */}
            {humanizedChecks.length > 0 && (
              <div>
                <div className={`text-xs uppercase tracking-wide mb-3 ${muted}`}>Required Checks</div>
                <div className="space-y-2">
                  {humanizedChecks.map((check, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div
                        className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                          darkMode ? 'bg-amber-400' : 'bg-amber-500'
                        }`}
                      />
                      <span className={`text-xs ${sectionLabel}`}>{check}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Key Facts Grid (2×2) */}
        <div>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Key Facts</h2>
          <div className="grid grid-cols-2 gap-4">

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <Target className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Product</div>
              </div>
              <div className="space-y-1.5">
                {productPrimary ? (
                  <p className={`text-sm leading-relaxed ${body}`}>{productPrimary}</p>
                ) : (
                  <p className={`text-sm ${muted}`}>Not extracted</p>
                )}
                {productSignal && (
                  <p className={`text-xs leading-relaxed ${muted}`}>{productSignal}</p>
                )}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <TrendingUp className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Market</div>
              </div>
              <div className="space-y-1.5">
                {marketPrimary ? (
                  <p className={`text-sm leading-relaxed ${body}`}>{marketPrimary}</p>
                ) : (
                  <p className={`text-sm ${muted}`}>Not extracted</p>
                )}
                {marketSignal && (
                  <p className={`text-xs leading-relaxed ${muted}`}>{marketSignal}</p>
                )}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <Activity className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Business Model</div>
              </div>
              <div className={`text-sm ${businessModel.value && businessModel.value !== '—' ? heading : muted}`}>
                {businessModel.value && businessModel.value !== '—' ? businessModel.value : 'Not extracted'}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <DollarSign className={`w-4 h-4 mt-0.5 ${muted}`} />
                <div className={`text-xs uppercase tracking-wide ${muted}`}>Raise Terms</div>
              </div>
              <div className={`text-sm ${raiseTerms.value && raiseTerms.value !== '—' ? heading : muted}`}>
                {raiseTerms.value && raiseTerms.value !== '—' ? raiseTerms.value : 'Not extracted'}
              </div>
            </div>
          </div>
        </div>

        {/* Risk Assessment (only rendered when there is risk content) */}
        {(redFlags.length > 0 || contradictionItems.length > 0 || openQuestions.length > 0) && (
          <div>
            <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Risk Assessment</h2>
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className="space-y-4">

                {redFlags.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Red Flags</h3>
                    </div>
                    <div className="space-y-2">
                      {redFlags.map((flag, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${getSeverityColor(flag.severity)}`}>
                            {flag.severity}
                          </div>
                          <span className={`text-sm flex-1 ${body}`}>{flag.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {contradictionItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-4 h-4 text-amber-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Contradictions</h3>
                    </div>
                    <div className="space-y-2">
                      {contradictionItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${getSeverityColor(item.severity)}`}>
                            {item.severity}
                          </div>
                          <span className={`text-sm flex-1 ${body}`}>{humanizeContradiction(item.text)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {openQuestions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-gray-400" />
                      <h3 className={`text-sm font-medium ${heading}`}>Open Questions</h3>
                    </div>
                    <div className="space-y-1.5">
                      {openQuestions.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className={`w-1 h-1 rounded-full mt-2 shrink-0 ${darkMode ? 'bg-gray-600' : 'bg-gray-400'}`} />
                          <span className={`text-sm ${sectionLabel}`}>{formatDiligenceItem(item)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Financial Snapshot (Horizontal Strip) */}
        <div>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Financial Snapshot</h2>
          {financialProseLines.length > 0 && (
            <div className="space-y-2 mb-4">
              {financialProseLines.map((line, idx) => (
                <p key={idx} className={`text-sm leading-relaxed ${body}`}>{line}</p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Revenue / ARR</div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${revenueTile.value !== '—' ? heading : muted}`}>
                  {revenueTile.value}
                </span>
                {revenueTile.value !== '—' && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
            </div>

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Burn Rate</div>
              <span className={`text-sm font-medium ${burnTile.value !== '—' ? heading : muted}`}>
                {burnTile.value}
              </span>
            </div>

            <div className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg border ${card}`}>
              <div className={`text-xs mb-1 ${muted}`}>Runway</div>
              <span className={`text-sm font-medium ${runwayTile.value !== '—' ? heading : muted}`}>
                {runwayTile.value}
                {runwayTile.isProjected && runwayTile.value !== '—' && (
                  <span className={`ml-1 text-[10px] font-normal ${muted}`}>proj.</span>
                )}
              </span>
            </div>

            {showIntegrityBadge && (
              <div className={`px-4 py-3 rounded-lg border border-amber-500/20 ${darkMode ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span className={`text-xs font-medium ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                    {financialIntegrityStatus === 'partial' ? 'Partial Data' : 'Unvalidated'}
                  </span>
                </div>
              </div>
            )}

            {showCoverageBadge && (
              <div className={`px-4 py-3 rounded-lg border ${card}`}>
                <div className={`text-xs mb-1 ${muted}`}>Coverage</div>
                <span className="text-sm font-medium text-amber-400">
                  {Math.round(financialCoverage!)}%
                </span>
              </div>
            )}
          </div>
          {underwritingNarrative && (
            <p className={`text-xs leading-relaxed mt-3 ${muted}`}>{underwritingNarrative}</p>
          )}
        </div>

        {/* Team Highlights (collapsible, only when data present) */}
        {hasTeam && (
          <div>
            <button
              onClick={() => toggleSection('team')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <h2 className="text-sm font-medium">Team Highlights</h2>
              </div>
              {expandedSections.team ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.team && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-3">
                  {teamHighlights.map((member, idx) => (
                    <div key={idx}>
                      <div className={`text-xs font-medium mb-1 ${sectionLabel}`}>{member.role}</div>
                      <div className={`text-sm ${body}`}>
                        <span className="font-medium">{member.name}</span>
                        {member.credential && (
                          <span className={`block text-xs mt-0.5 ${muted}`}>{member.credential}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Use of Funds (collapsible, only when data present) */}
        {hasUoF && (
          <div>
            <button
              onClick={() => toggleSection('funds')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <h2 className="text-sm font-medium">Use of Funds</h2>
              </div>
              {expandedSections.funds ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.funds && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-2">
                  {useOfFunds.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className={`text-sm ${body}`}>{item.category}</span>
                      {item.amountLabel && (
                        <span className={`text-xs font-medium ${heading}`}>{item.amountLabel}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Project Pipeline (collapsible, only when data present) */}
        {hasPipeline && (
          <div>
            <button
              onClick={() => toggleSection('pipeline')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <h2 className="text-sm font-medium">Project Pipeline</h2>
              </div>
              {expandedSections.pipeline ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.pipeline && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-2">
                  {projectPipeline.map((item, idx) => (
                    <div key={idx} className={`pb-2 border-b last:border-0 last:pb-0 ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
                      <span className={`text-sm font-medium ${body}`}>{item.name}</span>
                      <div className={`flex flex-wrap gap-3 text-xs mt-0.5 ${muted}`}>
                        {item.startDate && <span>Start: {item.startDate}</span>}
                        {item.capitalLabel && <span>Capital: {item.capitalLabel}</span>}
                        {item.revenueLabel && <span>Revenue: {item.revenueLabel}</span>}
                        {item.returnPct && <span>Return: {item.returnPct}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Revenue Model (collapsible, only when data present) */}
        {hasRevenueModel && (
          <div>
            <button
              onClick={() => toggleSection('revenue')}
              className={`w-full flex items-center justify-between py-3 ${sectionLabel} hover:opacity-80 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                <h2 className="text-sm font-medium">Revenue Model</h2>
              </div>
              {expandedSections.revenue ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {expandedSections.revenue && (
              <div className={`mt-3 p-4 rounded-lg border ${card}`}>
                <div className="space-y-3">
                  {revenueModel.type && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Model Type</div>
                      <div className={`text-sm font-medium ${heading}`}>{revenueModel.type}</div>
                    </div>
                  )}
                  {revenueModel.unitEconomics && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Unit Economics</div>
                      <div className={`text-sm ${body}`}>{revenueModel.unitEconomics}</div>
                    </div>
                  )}
                  {revenueModel.detail && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Detail</div>
                      <div className={`text-sm ${body}`}>{revenueModel.detail}</div>
                    </div>
                  )}
                  {revenueModel.recurring !== null && (
                    <div>
                      <div className={`text-xs mb-1 ${muted}`}>Recurring</div>
                      <div className={`text-sm font-medium ${heading}`}>
                        {revenueModel.recurring ? 'Yes' : 'No'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workbench Section */}
        <div className={`pt-6 border-t ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Workbench</h2>
          <div className="space-y-3">

            {/* Deep Dive Panel */}
            <div className={`rounded-lg border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <button
                onClick={() => toggleSection('deepDive')}
                className={`w-full flex items-center justify-between p-4 transition-colors ${
                  darkMode
                    ? 'bg-white/[0.02] hover:bg-white/[0.04]'
                    : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Search className={`w-4 h-4 ${sectionLabel}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${heading}`}>Deep Dive Panel</div>
                    <div className={`text-xs ${muted}`}>
                      {deepDiveReady ? 'Section-by-section analysis available' : 'Run specific analyses on team, market, product'}
                    </div>
                  </div>
                </div>
                {expandedSections.deepDive ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
              </button>
              {expandedSections.deepDive && deepDivePanel}
            </div>

            {/* Investor Insights */}
            <div className={`rounded-lg border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <button
                onClick={() => toggleSection('insights')}
                className={`w-full flex items-center justify-between p-4 transition-colors ${
                  darkMode
                    ? 'bg-white/[0.02] hover:bg-white/[0.04]'
                    : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Sparkles className={`w-4 h-4 ${sectionLabel}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${heading}`}>Investor Insights Diagnostics</div>
                    <div className={`text-xs ${muted}`}>
                      {insightsReady ? 'AI-powered analysis ready' : 'AI-powered professional perspective analysis'}
                    </div>
                  </div>
                </div>
                {expandedSections.insights ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
              </button>
              {expandedSections.insights && insightsPanel}
            </div>

            {/* Evidence Explorer */}
            <div className={`rounded-lg border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <button
                onClick={() => toggleSection('evidence')}
                className={`w-full flex items-center justify-between p-4 transition-colors ${
                  darkMode
                    ? 'bg-white/[0.02] hover:bg-white/[0.04]'
                    : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileText className={`w-4 h-4 ${sectionLabel}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${heading}`}>Evidence Explorer</div>
                    <div className={`text-xs ${muted}`}>Review source documents and data extractions</div>
                  </div>
                </div>
                {expandedSections.evidence ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
              </button>
              {expandedSections.evidence && evidencePanel}
            </div>

            {/* Intelligence Panel */}
            <div className={`rounded-lg border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <button
                onClick={() => toggleSection('intelligence')}
                className={`w-full flex items-center justify-between p-4 transition-colors ${
                  darkMode
                    ? 'bg-white/[0.02] hover:bg-white/[0.04]'
                    : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Shield className={`w-4 h-4 ${sectionLabel}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${heading}`}>Decision Confidence</div>
                    <div className={`text-xs ${muted}`}>Verdict resistance and challenge case analysis</div>
                  </div>
                </div>
                {expandedSections.intelligence ? <ChevronDown className={`w-4 h-4 ${sectionLabel}`} /> : <ChevronRight className={`w-4 h-4 ${sectionLabel}`} />}
              </button>
              {expandedSections.intelligence && (
                <div className={`p-4 border-t ${darkMode ? 'border-white/10 bg-white/[0.02]' : 'border-gray-200 bg-white'}`}>
                  {intelligencePanel}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
