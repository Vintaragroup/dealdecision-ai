import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
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

/**
 * Hard-enforces Financial Truth state over any legacy financial narrative phrase.
 * Replaces "financial data supports this analysis" (and variants) with the
 * truth-state-aware label derived from the badge tier.
 * No-op when badge is absent — preserves text unchanged for pre-FTRL cached reports.
 */
type _FinancialTruthBadgeRef = { tier: 'verified' | 'directional' | 'unverified' | 'conflicted'; text: string } | null | undefined;

const FINANCIAL_TRUTH_TIER_LABELS: Record<'verified' | 'directional' | 'unverified' | 'conflicted', string> = {
  verified:    'verified financial evidence',
  directional: 'directional financial model support',
  unverified:  'unverified financial claims',
  conflicted:  'conflicting financial sources',
};

function enforceFinancialTruth(text: string, badge: _FinancialTruthBadgeRef): string {
  if (!badge || !text) return text;
  return text.replace(
    /financial data supports this analysis/gi,
    FINANCIAL_TRUTH_TIER_LABELS[badge.tier],
  );
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
  financialTruthBadge,
}: {
  recommendation: 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null;
  convictionScore: number | null;
  convictionRationale: string | null;
  topPositiveContributors: _Contributor[];
  topNegativeContributors: _Contributor[];
  humanizedChecks: string[];
  financialTruthBadge?: { tier: 'verified' | 'directional' | 'unverified' | 'conflicted'; text: string } | null;
}): string[] {
  const lines: string[] = [];
  const hasAnySignals =
    recommendation !== null ||
    convictionScore !== null ||
    topPositiveContributors.length > 0 ||
    topNegativeContributors.length > 0;

  if (!hasAnySignals) return lines;

  // Opening: non-mechanical conviction rationale, or constructed posture sentence.
  // enforceFinancialTruth kills legacy LLM-authored financial phrasing before it reaches the UI.
  const rawRationale = !isMechanicalConvictionText(convictionRationale) ? convictionRationale : null;
  const rationale = rawRationale ? enforceFinancialTruth(rawRationale, financialTruthBadge) : null;
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

  // Hard-enforce Financial Truth: CONFLICT and UNVERIFIED must not appear as positive signals.
  const ftbTier = financialTruthBadge?.tier;
  const ftIsWarning = ftbTier === 'conflicted' || ftbTier === 'unverified';
  const ftConcern: string | null = ftIsWarning
    ? (ftbTier === 'conflicted' ? 'conflicting financial sources' : 'unverified financial claims')
    : null;

  // Strengths sentence: strip financial_truth from positives when it is a warning state.
  if (topPositiveContributors.length > 0) {
    const signals = topPositiveContributors
      .filter((c) => !(c.key === 'financial_truth' && ftIsWarning))
      .slice(0, 3)
      .map((c) => mapContributorToSignal(c.key, c.label, 'positive').toLowerCase());
    if (signals.length > 0) {
      const joined =
        signals.length === 1
          ? signals[0]
          : signals.length === 2
            ? `${signals[0]} and ${signals[1]}`
            : `${signals[0]}, ${signals[1]}, and ${signals[2]}`;
      lines.push(`Supporting evidence indicates ${joined}.`);
    }
  }

  // Concerns sentence: deduplicate financial_truth if ftConcern already covers it.
  const negContributors = topNegativeContributors.filter(
    (c) => !(c.key === 'financial_truth' && ftConcern),
  );
  const allConcerns: string[] = [
    ...negContributors
      .slice(0, ftConcern ? 1 : 2)
      .map((c) => mapContributorToSignal(c.key, c.label, 'negative').toLowerCase()),
    ...(ftConcern ? [ftConcern] : []),
  ];
  if (allConcerns.length > 0) {
    const joined =
      allConcerns.length === 1
        ? allConcerns[0]
        : `${allConcerns[0]}, and ${allConcerns[1]}`;
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

  // Final pass: enforce Financial Truth on every line before returning.
  return lines.map((l) => enforceFinancialTruth(l, financialTruthBadge));
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

function makeListKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dedupeText(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    const key = makeListKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function metricIsPresent(tile: FinancialTile): boolean {
  return tile.value !== '—';
}

function metricIsEstimated(tile: FinancialTile): boolean {
  return tile.isProjected === true || tile.trust === 'interim_extraction';
}

function summarizeMissingMetrics(labels: string[]): string[] {
  if (labels.includes('burn rate') && labels.includes('runway')) {
    return ['Burn rate and runway'];
  }
  return labels.map((label) => label.charAt(0).toUpperCase() + label.slice(1));
}

function deriveFinancialConfidence({
  financialTruthBadge,
  financialCoverage,
  financialIntegrityStatus,
}: {
  financialTruthBadge?: { tier: 'verified' | 'directional' | 'unverified' | 'conflicted'; text: string } | null;
  financialCoverage: number | null;
  financialIntegrityStatus: 'validated' | 'unvalidated' | 'partial' | null;
}): {
  level: 'High' | 'Moderate' | 'Low';
  tone: 'emerald' | 'blue' | 'amber' | 'rose';
  summary: string;
} {
  if (financialTruthBadge?.tier === 'conflicted') {
    return {
      level: 'Low',
      tone: 'rose',
      summary: 'Financial sources conflict and need reconciliation before underwriting.',
    };
  }

  if (financialTruthBadge?.tier === 'unverified') {
    return {
      level: 'Low',
      tone: 'amber',
      summary: 'Key underwriting inputs are still missing or unverified.',
    };
  }

  if (financialTruthBadge?.tier === 'directional') {
    return {
      level: 'Moderate',
      tone: 'blue',
      summary: 'Available figures are directional and still need verification.',
    };
  }

  if (financialTruthBadge?.tier === 'verified') {
    return {
      level: 'High',
      tone: 'emerald',
      summary: 'Core financial inputs are available and better supported.',
    };
  }

  if (financialIntegrityStatus === 'validated' && (financialCoverage ?? 0) >= 80) {
    return {
      level: 'High',
      tone: 'emerald',
      summary: 'Core underwriting inputs appear present and validated.',
    };
  }

  if (financialIntegrityStatus === 'partial' || (financialCoverage ?? 0) >= 55) {
    return {
      level: 'Moderate',
      tone: 'blue',
      summary: 'The financial picture is usable directionally but not fully supported.',
    };
  }

  return {
    level: 'Low',
    tone: 'amber',
    summary: 'Key underwriting inputs are still missing.',
  };
}

function toneClasses(
  tone: 'critical' | 'warning' | 'neutral' | 'emerald' | 'blue' | 'amber' | 'rose',
  darkMode: boolean,
): { border: string; bg: string; text: string; pill: string } {
  const map = {
    critical: darkMode
      ? { border: 'border-red-500/20', bg: 'bg-red-500/5', text: 'text-red-400', pill: 'bg-red-500/10 border-red-500/20 text-red-400' }
      : { border: 'border-red-200', bg: 'bg-red-50/70', text: 'text-red-700', pill: 'bg-red-100 border-red-200 text-red-700' },
    warning: darkMode
      ? { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', pill: 'bg-amber-500/10 border-amber-500/20 text-amber-400' }
      : { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', pill: 'bg-amber-100 border-amber-200 text-amber-700' },
    neutral: darkMode
      ? { border: 'border-white/10', bg: 'bg-white/[0.02]', text: 'text-gray-400', pill: 'bg-white/5 border-white/10 text-gray-300' }
      : { border: 'border-gray-200', bg: 'bg-white', text: 'text-gray-700', pill: 'bg-gray-100 border-gray-200 text-gray-700' },
    emerald: darkMode
      ? { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', pill: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' }
      : { border: 'border-emerald-200', bg: 'bg-emerald-50/70', text: 'text-emerald-700', pill: 'bg-emerald-100 border-emerald-200 text-emerald-700' },
    blue: darkMode
      ? { border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-400', pill: 'bg-blue-500/10 border-blue-500/20 text-blue-400' }
      : { border: 'border-blue-200', bg: 'bg-blue-50/70', text: 'text-blue-700', pill: 'bg-blue-100 border-blue-200 text-blue-700' },
    amber: darkMode
      ? { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', pill: 'bg-amber-500/10 border-amber-500/20 text-amber-400' }
      : { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', pill: 'bg-amber-100 border-amber-200 text-amber-700' },
    rose: darkMode
      ? { border: 'border-rose-500/20', bg: 'bg-rose-500/5', text: 'text-rose-400', pill: 'bg-rose-500/10 border-rose-500/20 text-rose-400' }
      : { border: 'border-rose-200', bg: 'bg-rose-50/70', text: 'text-rose-700', pill: 'bg-rose-100 border-rose-200 text-rose-700' },
  };
  return map[tone];
}

function DecisionListGroup({
  title,
  items,
  tone,
  darkMode,
  body,
  muted,
  emphasis = 'standard',
}: {
  title: string;
  items: Array<{ text: string; severity?: 'high' | 'medium' | 'low' }>;
  tone: 'critical' | 'warning' | 'neutral';
  darkMode: boolean;
  body: string;
  muted: string;
  emphasis?: 'strong' | 'standard';
}) {
  const tones = toneClasses(tone, darkMode);
  const dotClass =
    tone === 'critical'
      ? 'bg-red-400'
      : tone === 'warning'
      ? 'bg-amber-400'
      : darkMode
      ? 'bg-gray-500'
      : 'bg-gray-400';

  return (
    <div
      className={`rounded-lg border ${
        emphasis === 'strong'
          ? `p-4 border-l-4 ${darkMode ? 'shadow-[0_0_0_1px_rgba(239,68,68,0.06)]' : ''}`
          : 'p-3'
      } ${tones.border} ${tones.bg}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div>
          <div className={`text-[10px] uppercase tracking-wide font-medium ${tones.text}`}>{title}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones.pill}`}>
          {items.length}
        </span>
      </div>
      {items.length > 0 ? (
        <ul className={emphasis === 'strong' ? 'space-y-2.5' : 'space-y-2'}>
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex items-start gap-2">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
              <div className="min-w-0 flex-1">
                <span className={`${emphasis === 'strong' ? 'text-[13px]' : 'text-xs'} leading-snug ${body}`}>{item.text}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`text-xs ${muted}`}>No items surfaced.</p>
      )}
    </div>
  );
}

function FinancialConfidenceHeader({
  darkMode,
  heading,
  body,
  sectionLabel,
  subCard,
  financialConfidenceTone,
  level,
  summary,
  coverageText,
  financialTruthText,
}: {
  darkMode: boolean;
  heading: string;
  body: string;
  sectionLabel: string;
  subCard: string;
  financialConfidenceTone: { border: string; bg: string; text: string; pill: string };
  level: string;
  summary: string;
  coverageText: string;
  financialTruthText?: string | null;
}) {
  return (
    <div className={`rounded-lg border p-4 ${financialConfidenceTone.border} ${financialConfidenceTone.bg}`}>
      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_0.95fr] gap-4 items-start">
        <div className="min-w-0">
          <div className={`text-[10px] uppercase tracking-wide font-medium ${financialConfidenceTone.text}`}>
            Financial Confidence
          </div>
          <div className="mt-2 flex items-end gap-3 flex-wrap">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${financialConfidenceTone.pill}`}>
              {level}
            </span>
            <span className={`text-xs ${body}`}>{summary}</span>
          </div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${subCard}`}>
          <div className={`text-[10px] uppercase tracking-wide font-medium ${sectionLabel}`}>Coverage</div>
          <div className={`mt-1 text-2xl font-semibold tracking-tight ${heading}`}>{coverageText}</div>
          {financialTruthText ? (
            <div className={`mt-1 text-[11px] leading-snug ${sectionLabel}`}>Financial Truth: {financialTruthText}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FinancialMetricCard({
  label,
  value,
  note,
  status,
  darkMode,
  heading,
  muted,
  card,
  priority = false,
}: {
  label: string;
  value: string;
  note?: string | null;
  status?: 'present' | 'estimated' | 'missing';
  darkMode: boolean;
  heading: string;
  muted: string;
  card: string;
  priority?: boolean;
}) {
  const statusTone =
    status === 'missing'
      ? darkMode
        ? 'text-amber-400'
        : 'text-amber-700'
      : status === 'estimated'
      ? darkMode
        ? 'text-blue-400'
        : 'text-blue-700'
      : heading;

  return (
    <div className={`rounded-lg border ${priority ? 'px-4 py-3' : 'px-3 py-2.5'} ${card}`}>
      <div className={`text-[11px] uppercase tracking-wide ${muted}`}>{label}</div>
      <div className={`mt-1.5 ${priority ? 'text-base' : 'text-sm'} font-medium ${statusTone}`}>{value}</div>
      {note ? <div className={`mt-0.5 text-[11px] leading-snug ${muted}`}>{note}</div> : null}
    </div>
  );
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
  financialTruthBadge,
  signalTension,
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
    financialTruthBadge,
  });

  // One-sentence summary for the Financial Truth context line.
  const opportunitySummaryLine: string | null =
    convictionNarrativeLines.length > 0
      ? convictionNarrativeLines[0]
      : investmentParas.length > 0
      ? enforceFinancialTruth(investmentParas[0], financialTruthBadge)
      : null;

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

  const getConvictionColor = (score: number | null) => {
    if (score === null) return darkMode ? 'text-gray-500' : 'text-gray-400';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  const card = darkMode ? 'bg-white/[0.02] border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const sectionLabel = darkMode ? 'text-gray-400' : 'text-gray-600';
  const subCard = darkMode ? 'bg-white/[0.03] border-white/10' : 'bg-gray-50/80 border-gray-200';

  const dealBreakers = redFlags
    .filter((flag) => flag.severity === 'high')
    .map((flag) => ({ text: flag.message, severity: flag.severity }));

  const fragilityItems = dedupeText([
    ...redFlags
      .filter((flag) => flag.severity !== 'high')
      .map((flag) => flag.message),
    ...contradictionItems.map((item) => humanizeContradiction(item.text)),
    ...(financialCoverage !== null && financialCoverage < 80
      ? [`Only ${Math.round(financialCoverage)}% of tracked financial inputs are currently covered`]
      : []),
    ...(financialIntegrityStatus === 'partial'
      ? ['Financial figures are only partially validated']
      : financialIntegrityStatus === 'unvalidated'
      ? ['Financial figures are not yet validated']
      : []),
  ]).map((text) => ({ text, severity: 'medium' as const }));

  const validationItems = dedupeText([
    ...humanizedChecks,
    ...openQuestions.map(formatDiligenceItem),
  ]).map((text) => ({ text, severity: 'low' as const }));

  const riskDiagnostics = dedupeText([
    ...contradictions.map((item) => humanizeContradiction(item)),
    ...(financialIntegrityStatus && financialIntegrityStatus !== 'validated'
      ? [`Financial integrity status: ${financialIntegrityStatus}`]
      : []),
  ]);

  const financialConfidence = deriveFinancialConfidence({
    financialTruthBadge,
    financialCoverage,
    financialIntegrityStatus,
  });
  const financialConfidenceTone = toneClasses(financialConfidence.tone, darkMode);

  const missingMetricLabels = [
    !metricIsPresent(revenueTile) ? 'revenue' : null,
    !metricIsPresent(burnTile) ? 'burn rate' : null,
    !metricIsPresent(runwayTile) ? 'runway' : null,
  ].filter((label): label is string => Boolean(label));

  const missingForUnderwriting = dedupeText([
    ...summarizeMissingMetrics(missingMetricLabels),
    ...humanizedChecks.filter((item) => /revenue|burn|runway|financial|model|cash/i.test(item)),
  ]);

  const financialNotes = dedupeText([
    metricIsEstimated(revenueTile) ? 'Revenue is projection-based' : '',
    metricIsEstimated(burnTile) ? 'Burn rate is derived rather than directly verified' : '',
    metricIsEstimated(runwayTile) ? 'Runway is derived from projected inputs' : '',
    financialIntegrityStatus === 'partial' ? 'Financial figures are only partially validated' : '',
    financialIntegrityStatus === 'unvalidated' ? 'Financial figures are unaudited or unvalidated' : '',
    humanizedChecks.some((item) => /financial statements|financial model/i.test(item))
      ? 'A verified financial model or statements are still needed'
      : '',
  ]);
  const compactFinancialNotes = financialNotes.slice(0, 3);

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

          {/* LEFT: Opportunity Signal — decision surface */}
          <div className="space-y-4">
            {/* Financial Truth context line — shown only when FT tier is available */}
            {financialTruthBadge && (() => {
              const FT_INLINE: Record<
                'verified' | 'directional' | 'unverified' | 'conflicted',
                { label: string; cls: string }
              > = {
                verified:    { label: 'Verified',    cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
                directional: { label: 'Directional', cls: 'text-blue-400   border-blue-500/30   bg-blue-500/10'   },
                unverified:  { label: 'Unverified',  cls: 'text-amber-400  border-amber-500/30  bg-amber-500/10'  },
                conflicted:  { label: 'Conflicted',  cls: 'text-rose-400   border-rose-500/30   bg-rose-500/10'   },
              };
              const { label, cls } = FT_INLINE[financialTruthBadge.tier];
              return (
                <div className={`flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg border ${darkMode ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Financial Truth</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{label}</span>
                  {opportunitySummaryLine && (
                    <span className={`text-xs leading-relaxed ${muted}`}>{opportunitySummaryLine}</span>
                  )}
                </div>
              );
            })()}

            {/* Reasons: Why it looks promising | What blocks commitment */}
            {(topPositiveContributors.length > 0 || topNegativeContributors.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg border ${darkMode ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-200 bg-emerald-50/50'}`}>
                  <div className={`text-[10px] uppercase tracking-wide font-medium mb-2 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                    Why it looks promising
                  </div>
                  {topPositiveContributors.length > 0 ? (
                    <ul className="space-y-1.5">
                      {topPositiveContributors.map((c, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className={`shrink-0 mt-px text-xs font-bold ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`}>+</span>
                          <span className={`text-xs leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {enforceFinancialTruth(mapContributorToSignal(c.key, c.label, 'positive'), financialTruthBadge)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-xs italic ${muted}`}>No positive signals found.</p>
                  )}
                </div>
                <div className={`p-3 rounded-lg border ${darkMode ? 'border-red-500/20 bg-red-500/5' : 'border-red-200 bg-red-50/50'}`}>
                  <div className={`text-[10px] uppercase tracking-wide font-medium mb-2 ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                    What blocks commitment
                  </div>
                  {(topNegativeContributors.length > 0 || (signalTension != null && signalTension.level !== 'LOW' && signalTension.reasons.length > 0)) ? (
                    <ul className="space-y-1.5">
                      {topNegativeContributors.map((c, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className={`shrink-0 mt-px text-xs font-bold ${darkMode ? 'text-red-400' : 'text-red-500'}`}>−</span>
                          <span className={`text-xs leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {enforceFinancialTruth(mapContributorToSignal(c.key, c.label, 'negative'), financialTruthBadge)}
                          </span>
                        </li>
                      ))}
                      {signalTension != null && signalTension.level !== 'LOW' && signalTension.reasons.map((reason, i) => (
                        <li key={`st-${i}`} className="flex items-start gap-1.5">
                          <span className={`shrink-0 mt-px text-xs font-bold ${signalTension.level === 'HIGH' ? (darkMode ? 'text-rose-400' : 'text-rose-500') : (darkMode ? 'text-amber-400' : 'text-amber-500')}`}>!</span>
                          <span className={`text-xs leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-xs italic ${muted}`}>No blocking issues identified.</p>
                  )}
                </div>
              </div>
            )}

            {/* 3. Required next checks — numbered action checklist, visually distinct */}
            {humanizedChecks.length > 0 && (
              <div className={`p-3 rounded-lg border-l-4 border-l-amber-500 border ${darkMode ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50 border-amber-200'}`}>
                <div className={`text-[10px] uppercase tracking-wide font-medium mb-2 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  Required next checks
                </div>
                <ul className="space-y-1.5">
                  {humanizedChecks.slice(0, 4).map((check, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`shrink-0 w-4 h-4 mt-px rounded border flex items-center justify-center text-[10px] font-medium ${darkMode ? 'border-amber-500/40 text-amber-400' : 'border-amber-400 text-amber-600'}`}>
                        {i + 1}
                      </span>
                      <span className={`text-xs leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{check}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* RIGHT: Decision Confidence — scores, model diagnostics, robustness */}
          <div className="space-y-5">

            {/* Decision Confidence — scores, model output, robustness indicators */}
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className={`text-xs uppercase tracking-wide mb-2.5 ${muted}`}>
                Decision Confidence
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
        {(dealBreakers.length > 0 || fragilityItems.length > 0 || validationItems.length > 0) && (
          <div>
            <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Risk Assessment</h2>
            <div className={`rounded-xl border p-4 sm:p-5 ${card}`}>
              <div className="space-y-3">
                <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1fr_1fr] gap-3">
                  <DecisionListGroup
                    title="Deal Breakers"
                    items={dealBreakers}
                    tone="critical"
                    darkMode={darkMode}
                    body={body}
                    muted={muted}
                    emphasis="strong"
                  />
                  <DecisionListGroup
                    title="Why The Decision Is Fragile"
                    items={fragilityItems}
                    tone="warning"
                    darkMode={darkMode}
                    body={body}
                    muted={muted}
                  />
                  <DecisionListGroup
                    title="What Must Be Validated"
                    items={validationItems}
                    tone="neutral"
                    darkMode={darkMode}
                    body={body}
                    muted={muted}
                  />
                </div>

                {riskDiagnostics.length > 0 && (
                  <details className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                    <summary className={`cursor-pointer list-none text-[11px] font-medium ${sectionLabel}`}>
                      Supporting diagnostics
                    </summary>
                    <div className="mt-2.5 space-y-1.5">
                      {riskDiagnostics.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <XCircle className={`mt-0.5 h-3.5 w-3.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                          <span className={`text-[11px] leading-snug ${sectionLabel}`}>{item}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Financial Snapshot (Horizontal Strip) */}
        <div>
          <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Financial Snapshot</h2>
          <div className={`rounded-xl border p-4 sm:p-5 ${card}`}>
            <FinancialConfidenceHeader
              darkMode={darkMode}
              heading={heading}
              body={body}
              sectionLabel={sectionLabel}
              subCard={subCard}
              financialConfidenceTone={financialConfidenceTone}
              level={financialConfidence.level}
              summary={financialConfidence.summary}
              coverageText={financialCoverage !== null ? `${Math.round(financialCoverage)}%` : 'Missing'}
              financialTruthText={financialTruthBadge?.text ?? null}
            />

            <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
              <FinancialMetricCard
                label="Revenue"
                value={metricIsPresent(revenueTile) ? revenueTile.value : 'Missing'}
                note={metricIsPresent(revenueTile) ? (metricIsEstimated(revenueTile) ? 'Projected' : 'Available') : null}
                status={!metricIsPresent(revenueTile) ? 'missing' : metricIsEstimated(revenueTile) ? 'estimated' : 'present'}
                darkMode={darkMode}
                heading={heading}
                muted={muted}
                card={subCard}
                priority
              />
              <FinancialMetricCard
                label="Burn Rate"
                value={metricIsPresent(burnTile) ? burnTile.value : 'Missing'}
                note={metricIsPresent(burnTile) ? (metricIsEstimated(burnTile) ? 'Derived' : 'Available') : null}
                status={!metricIsPresent(burnTile) ? 'missing' : metricIsEstimated(burnTile) ? 'estimated' : 'present'}
                darkMode={darkMode}
                heading={heading}
                muted={muted}
                card={subCard}
              />
              <FinancialMetricCard
                label="Runway"
                value={metricIsPresent(runwayTile) ? runwayTile.value : 'Missing'}
                note={metricIsPresent(runwayTile) ? (metricIsEstimated(runwayTile) ? 'Projected' : 'Available') : null}
                status={!metricIsPresent(runwayTile) ? 'missing' : metricIsEstimated(runwayTile) ? 'estimated' : 'present'}
                darkMode={darkMode}
                heading={heading}
                muted={muted}
                card={subCard}
              />
              <FinancialMetricCard
                label="Coverage"
                value={financialCoverage !== null ? `${Math.round(financialCoverage)}%` : 'Missing'}
                note={financialCoverage !== null ? 'Tracked inputs covered' : null}
                status={financialCoverage === null ? 'missing' : financialCoverage < 55 ? 'missing' : financialCoverage < 80 ? 'estimated' : 'present'}
                darkMode={darkMode}
                heading={heading}
                muted={muted}
                card={subCard}
                priority
              />
            </div>

            <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1.1fr_1.2fr] gap-3">
              <div className={`rounded-lg border p-3 ${subCard}`}>
                <div className={`text-[10px] uppercase tracking-wide font-medium mb-1.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  Missing For Underwriting
                </div>
                {missingForUnderwriting.length > 0 ? (
                  <ul className="space-y-1.5">
                    {missingForUnderwriting.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <AlertCircle className={`mt-0.5 h-3.5 w-3.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                        <span className={`text-xs leading-snug ${body}`}>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-xs ${muted}`}>No additional underwriting gaps surfaced.</p>
                )}
              </div>

              <div className={`rounded-lg border p-3 ${subCard}`}>
                <div className={`text-[10px] uppercase tracking-wide font-medium mb-1.5 ${sectionLabel}`}>
                  Compact Notes
                </div>
                {compactFinancialNotes.length > 0 ? (
                  <ul className="space-y-1.5">
                    {compactFinancialNotes.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`} />
                        <span className={`text-xs leading-snug ${body}`}>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-xs ${muted}`}>No additional financial caveats surfaced.</p>
                )}
              </div>
            </div>

            {(financialProseLines.length > 0 || underwritingNarrative) && (
              <details className={`mt-4 rounded-lg border px-3 py-2.5 ${subCard}`}>
                <summary className={`cursor-pointer list-none text-[11px] font-medium ${sectionLabel}`}>
                  Source notes and diagnostics
                </summary>
                <div className="mt-2.5 space-y-1.5">
                  {financialProseLines.map((line, idx) => (
                    <p key={idx} className={`text-[11px] leading-snug ${sectionLabel}`}>{line}</p>
                  ))}
                  {underwritingNarrative && (
                    <p className={`text-[11px] leading-snug ${sectionLabel}`}>{underwritingNarrative}</p>
                  )}
                </div>
              </details>
            )}
          </div>
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
