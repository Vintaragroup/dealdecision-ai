import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  FolderOpen,
  Search,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  X,
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
import { SystemProgressCard } from '../ui/SystemProgressCard';
import type { SystemProgressStatus } from '../ui/SystemProgressCard';
import type {
  WorkspaceRedesignedShellProps,
  FinancialTile,
} from './WorkspaceRedesignedShell';
import type { WorkspaceOverviewFactTrust } from './contracts/workspaceViewModel';
import { EvidenceChipRow } from './EvidenceChip';
import { EvidenceTraceDrawer } from './EvidenceTraceDrawer';
import { DocumentsTab } from '../documents/DocumentsTab';
import { DecisionRationaleSection, type DecisionRationaleV1 } from './analysis/DecisionRationaleSection';

// ─── Props ────────────────────────────────────────────────────────────────────

export type RerunAnalysisProgress = {
  active: boolean;
  terminal?: 'success' | 'error' | null;
  jobId?: string | null;
  type?: string | null;
  status?: string | null;
  stage?: string | null;
  progressPct?: number | null;
  message?: string | null;
  error?: string | null;
  warning?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
  queuedSeconds?: number | null;
  elapsedSeconds?: number | null;
  previousAnalysisVisible?: boolean;
  pollConnection?: {
    status: 'connected' | 'disconnected';
    consecutiveFailures: number;
    lastError: string | null;
  } | null;
};

/**
 * Compact section coverage row sourced from score_breakdown_v1.sections.
 * Threaded from DealWorkspace.tsx → DealWorkspaceV4 for Phase 4A evidence coverage panel.
 */
export type SectionCoverageItem = {
  key: string;
  support_status: 'supported' | 'weak' | 'missing' | 'unknown';
  evidence_count: number;
  trace_coverage_pct?: number | null;
  coverage_pct?: number | null;
  hint?: string | null;
};

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
  /** Real rerun job state from the parent workspace, with lifecycle fallback while the job is being accepted. */
  analysisProgress?: RerunAnalysisProgress | null;
  /**
   * Score breakdown sections from score_breakdown_v1, threaded from DealWorkspace.tsx.
   * Used for Phase 4A section evidence coverage panel. Optional — gracefully absent.
   */
  scoreBreakdownSections?: SectionCoverageItem[];
  /** The deal's UUID — used to scope the Documents modal to this deal. */
  dealId?: string;
  /** Increment to force-refresh the Documents modal document list (e.g. after re-extraction). */
  documentsReloadKey?: number;
  /**
   * Validated LLM decision rationale from Phase 4.
   * Only rendered when rationale.status === 'validated'. Absent = hidden, no error.
   */
  decisionRationale?: DecisionRationaleV1 | null;
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

const FINANCIAL_TRUTH_BADGE_STYLES: Record<
  'verified' | 'directional' | 'unverified' | 'conflicted',
  { label: string; cls: string }
> = {
  verified:    { label: 'Verified',    cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  directional: { label: 'Directional', cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  unverified:  { label: 'Unverified',  cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  conflicted:  { label: 'Conflicted',  cls: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
};

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
      readiness: 'Under Investigation',
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

type _Contributor = { key: string; label: string; scoreDelta: number | null; evidence_refs?: string[] };

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
 * Infers a human-readable category label for a contradiction item.
 * Used to show a small badge prefix so users understand the type of conflict.
 */
function inferContradictionCategory(text: string): string {
  const t = text.toLowerCase();
  if (/regulatory|approval|timeline|permit|license|compliance/i.test(t)) return 'Regulatory Risk';
  if (/revenue|arr|mrr|income|sales|recurring/i.test(t)) return 'Revenue Signal';
  if (/burn|runway|cash|spend|capex/i.test(t)) return 'Financial Signal';
  if (/market|tam|addressable|demand/i.test(t)) return 'Market Claim';
  if (/team|founder|executive|management/i.test(t)) return 'Team Signal';
  return 'Signal Conflict';
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
  level: 'Strong' | 'Moderate' | 'Weak' | 'Fragile' | 'Unknown';
  tone: 'emerald' | 'blue' | 'amber' | 'rose';
  summary: string;
} {
  if (financialTruthBadge?.tier === 'conflicted') {
    return {
      level: 'Fragile',
      tone: 'rose',
      summary: 'Financial sources conflict and need reconciliation before underwriting.',
    };
  }

  if (financialTruthBadge?.tier === 'unverified') {
    return {
      level: 'Weak',
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
      level: 'Strong',
      tone: 'emerald',
      summary: 'Core financial inputs are available and better supported.',
    };
  }

  if (financialIntegrityStatus === 'validated' && (financialCoverage ?? 0) >= 80) {
    return {
      level: 'Strong',
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
    level: financialCoverage === null && financialIntegrityStatus === null ? 'Unknown' : 'Weak',
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
            Evidence Confidence
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
  trust,
  isProjected,
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
  trust?: WorkspaceOverviewFactTrust | null;
  isProjected?: boolean | null;
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

  // Map trust level → compact investor-facing source badge label
  const sourceBadge: string | null = (() => {
    if (!trust || trust === 'not_extracted') return null;
    if (trust === 'structured') return null; // confirmed structured data — no badge needed
    if (trust === 'governed') return 'Verified';
    if (trust === 'interim_extraction') {
      // Deck-sourced projection — investor-facing: 'Management Claim'
      if (isProjected) return 'Management Claim';
      // Otherwise: computed/derived from raw extraction
      return 'Derived';
    }
    if (trust === 'conflicted') return 'Conflict';
    return null;
  })();

  return (
    <div className={`rounded-lg border ${priority ? 'px-4 py-3' : 'px-3 py-2.5'} ${card}`}>
      <div className={`text-[11px] uppercase tracking-wide ${muted}`}>{label}</div>
      <div className={`mt-1.5 ${priority ? 'text-base' : 'text-sm'} font-medium ${statusTone}`}>{value}</div>
      {note ? <div className={`mt-0.5 text-[11px] leading-snug ${muted}`}>{note}</div> : null}
      {(sourceBadge || isProjected) && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {sourceBadge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
              trust === 'conflicted'
                ? darkMode ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' : 'text-rose-700 border-rose-200 bg-rose-50'
                : trust === 'structured'
                ? darkMode ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-emerald-700 border-emerald-200 bg-emerald-50'
                : darkMode ? 'text-gray-500 border-white/10 bg-white/5' : 'text-gray-500 border-gray-200 bg-gray-50'
            }`}>
              {sourceBadge}
            </span>
          )}
          {isProjected && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
              darkMode ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' : 'text-blue-700 border-blue-200 bg-blue-50'
            }`}>
              Projected
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type ConfidenceLevel = 'Strong' | 'Moderate' | 'Weak' | 'Fragile' | 'Unknown';
type SeverityLevel = 'Critical' | 'Major' | 'Validation' | 'Diagnostic' | 'Unknown';

function normalizeConfidenceLevel(label: string | null | undefined, score: number | null | undefined): ConfidenceLevel {
  const raw = label?.trim().toLowerCase() ?? '';
  if (/very\s+fragile|fragile/.test(raw)) return 'Fragile';
  if (/robust|strong|high/.test(raw)) return 'Strong';
  if (/moderate|medium|partial|promising/.test(raw)) return 'Moderate';
  if (/weak|low|limited|uncertain|broken/.test(raw)) return 'Weak';

  if (score == null || !Number.isFinite(score)) return 'Unknown';
  if (score >= 70) return 'Strong';
  if (score >= 55) return 'Moderate';
  if (score >= 40) return 'Fragile';
  return 'Weak';
}

function confidenceTone(level: ConfidenceLevel, darkMode: boolean): string {
  const tones: Record<ConfidenceLevel, string> = {
    Strong: darkMode ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-emerald-700 border-emerald-200 bg-emerald-50',
    Moderate: darkMode ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' : 'text-blue-700 border-blue-200 bg-blue-50',
    Weak: darkMode ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-amber-700 border-amber-200 bg-amber-50',
    Fragile: darkMode ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' : 'text-rose-700 border-rose-200 bg-rose-50',
    Unknown: darkMode ? 'text-gray-400 border-white/10 bg-white/5' : 'text-gray-600 border-gray-200 bg-gray-50',
  };
  return tones[level];
}

function severityTone(level: SeverityLevel, darkMode: boolean): string {
  const tones: Record<SeverityLevel, string> = {
    Critical: darkMode ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' : 'text-rose-700 border-rose-200 bg-rose-50',
    Major: darkMode ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-amber-700 border-amber-200 bg-amber-50',
    Validation: darkMode ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' : 'text-blue-700 border-blue-200 bg-blue-50',
    Diagnostic: darkMode ? 'text-gray-400 border-white/10 bg-white/5' : 'text-gray-600 border-gray-200 bg-gray-50',
    Unknown: darkMode ? 'text-gray-500 border-white/10 bg-white/5' : 'text-gray-500 border-gray-200 bg-gray-50',
  };
  return tones[level];
}

function compactList(items: string[], count = 2): string[] {
  return items.filter(Boolean).slice(0, count);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'Unknown' : `${Math.round(value)}%`;
}

type AnalysisProgressStep = {
  key: string;
  label: string;
  waitingLabel: string;
  estimatedPct: number;
};

const ANALYSIS_PROGRESS_STEPS: AnalysisProgressStep[] = [
  { key: 'accepted', label: 'Accepted', waitingLabel: 'Starting analysis', estimatedPct: 8 },
  { key: 'queued', label: 'Queued', waitingLabel: 'Waiting for analysis job', estimatedPct: 15 },
  { key: 'processing_documents', label: 'Processing documents', waitingLabel: 'Processing documents', estimatedPct: 35 },
  { key: 'extracting_evidence', label: 'Extracting evidence', waitingLabel: 'Extracting evidence', estimatedPct: 50 },
  { key: 'reconciling_signals', label: 'Reconciling signals', waitingLabel: 'Reconciling signals', estimatedPct: 65 },
  { key: 'updating_recommendation', label: 'Updating recommendation', waitingLabel: 'Updating recommendation', estimatedPct: 80 },
  { key: 'refreshing_results', label: 'Refreshing results', waitingLabel: 'Refreshing workspace', estimatedPct: 92 },
];

function normalizeProgressToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function deriveAnalysisProgressIndex(progress: RerunAnalysisProgress): number {
  const status = normalizeProgressToken(progress.status);
  const stage = normalizeProgressToken(progress.stage);

  if (progress.terminal === 'success' || status === 'succeeded' || status === 'succeeded_with_warnings') {
    return ANALYSIS_PROGRESS_STEPS.length;
  }
  if (progress.terminal === 'error' || status === 'failed' || status === 'cancelled') {
    return Math.max(0, ANALYSIS_PROGRESS_STEPS.findIndex((step) => step.key === 'processing_documents'));
  }
  if (!progress.jobId) return 0;
  if (status === 'queued' || status === 'blocked') return 1;

  if (stage.includes('refresh')) return 6;
  if (stage.includes('final') || stage.includes('recommendation') || stage.includes('scor')) return 5;
  if (stage.includes('reconcil') || stage.includes('signal') || stage.includes('risk')) return 4;
  if (stage.includes('evidence') || stage.includes('extract')) return 3;
  if (stage.includes('document') || stage.includes('render') || stage.includes('ocr') || stage.includes('prepar')) return 2;

  const pct = typeof progress.progressPct === 'number' ? progress.progressPct : null;
  if (pct !== null) {
    if (pct >= 90) return 6;
    if (pct >= 75) return 5;
    if (pct >= 60) return 4;
    if (pct >= 45) return 3;
    if (pct >= 20) return 2;
  }

  return status === 'running' || status === 'retrying' ? 2 : 1;
}

function formatAnalysisProgressTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isMeaningfulBackendAnalysisStage(stage: string): boolean {
  if (!stage) return false;
  return !['queued', 'running', 'blocked', 'preparing_documents'].includes(stage);
}

function getTimeSmoothedAnalysisProgress(elapsedSeconds: number, status: string, hasJob: boolean): number {
  if (!hasJob) return 8;
  if (status === 'queued' || status === 'blocked') return Math.min(24, 15 + Math.floor(elapsedSeconds / 10));
  if (elapsedSeconds < 2) return 10;
  if (elapsedSeconds < 5) return 22;
  if (elapsedSeconds < 10) return 35;
  if (elapsedSeconds < 20) return 50;
  if (elapsedSeconds < 35) return 65;
  if (elapsedSeconds < 60) return 78;
  return 88;
}

function getTimeSmoothedAnalysisStage(elapsedSeconds: number, status: string, hasJob: boolean): string {
  if (!hasJob) return 'Starting analysis';
  if (status === 'queued' || status === 'blocked') return 'Waiting for analysis job';
  if (elapsedSeconds < 2) return 'Starting analysis';
  if (elapsedSeconds < 5) return 'Processing documents';
  if (elapsedSeconds < 10) return 'Extracting evidence';
  if (elapsedSeconds < 20) return 'Reconciling signals';
  if (elapsedSeconds < 35) return 'Updating recommendation';
  return 'Refreshing workspace';
}

function humanizeAnalysisStage(stage: string | null | undefined): string | null {
  const normalized = normalizeProgressToken(stage);
  if (!normalized) return null;
  if (normalized.includes('prepar') || normalized.includes('document') || normalized.includes('render') || normalized.includes('ocr')) return 'Processing documents';
  if (normalized.includes('evidence') || normalized.includes('extract')) return 'Extracting evidence';
  if (normalized.includes('reconcil') || normalized.includes('signal') || normalized.includes('risk')) return 'Reconciling signals';
  if (normalized.includes('recommendation') || normalized.includes('scor') || normalized.includes('final')) return 'Updating recommendation';
  if (normalized.includes('refresh')) return 'Refreshing workspace';
  if (normalized === 'queued') return 'Waiting for analysis job';
  if (normalized === 'running') return null;
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCompactAnalysisProgress(progress: RerunAnalysisProgress): {
  percent: number;
  stageLabel: string;
  source: 'backend' | 'estimated';
} {
  const status = normalizeProgressToken(progress.status);
  const stage = normalizeProgressToken(progress.stage);
  const isSuccess = progress.terminal === 'success' || status === 'succeeded' || status === 'succeeded_with_warnings';
  const isFailure = progress.terminal === 'error' || status === 'failed' || status === 'cancelled';
  if (isSuccess) return { percent: 100, stageLabel: 'Complete', source: 'backend' };
  if (isFailure) return { percent: 100, stageLabel: 'Failed', source: 'backend' };

  const backendPct = typeof progress.progressPct === 'number' && Number.isFinite(progress.progressPct)
    ? Math.max(0, Math.min(99, Math.round(progress.progressPct)))
    : null;
  const hasMeaningfulStage = isMeaningfulBackendAnalysisStage(stage);
  if (backendPct !== null && hasMeaningfulStage) {
    return {
      percent: backendPct,
      stageLabel: humanizeAnalysisStage(stage) ?? 'Running analysis',
      source: 'backend',
    };
  }

  const elapsed = typeof progress.elapsedSeconds === 'number' ? progress.elapsedSeconds : 0;
  const currentIndex = deriveAnalysisProgressIndex(progress);
  const stagedPct = ANALYSIS_PROGRESS_STEPS[Math.max(0, Math.min(currentIndex, ANALYSIS_PROGRESS_STEPS.length - 1))]?.estimatedPct ?? 25;
  const smoothedPct = getTimeSmoothedAnalysisProgress(elapsed, status, Boolean(progress.jobId));
  return {
    percent: Math.max(stagedPct, smoothedPct),
    stageLabel: humanizeAnalysisStage(stage) ?? getTimeSmoothedAnalysisStage(elapsed, status, Boolean(progress.jobId)),
    source: 'estimated',
  };
}

function RerunStatusStrip({
  darkMode,
  progress,
}: {
  darkMode: boolean;
  progress: RerunAnalysisProgress;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const status = normalizeProgressToken(progress.status);
  const isFailure = progress.terminal === 'error' || status === 'failed' || status === 'cancelled';
  const isSuccess = progress.terminal === 'success' || status === 'succeeded' || status === 'succeeded_with_warnings';
  const currentIndex = deriveAnalysisProgressIndex(progress);
  const compact = getCompactAnalysisProgress(progress);
  const timestamp = formatAnalysisProgressTimestamp(progress.updatedAt ?? progress.startedAt ?? progress.createdAt);
  const showLongRunning = typeof progress.elapsedSeconds === 'number' && progress.elapsedSeconds >= 15 * 60;
  const connectionWarning = progress.pollConnection?.status === 'disconnected'
    ? 'Job polling disconnected. Previous analysis remains visible; retry polling from the Jobs view if needed.'
    : null;
  const message = isFailure
    ? (progress.error || 'Analysis rerun failed. Your previous analysis is still visible. Try again.')
    : isSuccess
      ? 'Analysis updated'
      : (progress.message || 'Previous analysis remains visible until the new run completes.');

  const wrapper = darkMode
    ? 'border-white/10 bg-white/[0.035]'
    : 'border-gray-200 bg-gray-50';
  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const body = darkMode ? 'text-gray-400' : 'text-gray-600';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const activeTone = isFailure
    ? darkMode ? 'text-rose-300' : 'text-rose-700'
    : isSuccess
      ? darkMode ? 'text-emerald-300' : 'text-emerald-700'
      : darkMode ? 'text-blue-300' : 'text-blue-700';

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 ${wrapper}`} data-testid="rerun-status-strip" aria-live="polite">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {isSuccess ? (
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${activeTone}`} />
            ) : isFailure ? (
              <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${activeTone}`} />
            ) : (
              <Loader2 className={`w-3.5 h-3.5 shrink-0 animate-spin ${activeTone}`} />
            )}
            <span className={`shrink-0 text-xs font-semibold ${heading}`}>
              {isSuccess ? 'Analysis updated' : isFailure ? 'Analysis rerun failed' : 'Re-running analysis'}
            </span>
            {!isSuccess && !isFailure ? <span className={`shrink-0 text-xs ${muted}`}>·</span> : null}
            {!isSuccess && !isFailure ? <span className={`min-w-0 truncate text-xs ${muted}`}>{compact.stageLabel}</span> : null}
          </div>
        </div>
        <span className={`justify-self-end text-xs tabular-nums ${activeTone}`}>{compact.percent}%</span>
        <div className={`col-span-2 h-1.5 overflow-hidden rounded-full ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
          <div
            className={`h-full rounded-full transition-all duration-700 ${isFailure ? 'bg-rose-400' : isSuccess ? 'bg-emerald-400' : 'bg-blue-400'}`}
            style={{ width: `${compact.percent}%` }}
          />
        </div>
        <div className={`col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug ${isFailure ? activeTone : body}`}>
          <span>
            {isFailure ? message : progress.previousAnalysisVisible ? 'Previous analysis remains visible' : message}
          </span>
          <span className={`text-[10px] uppercase tracking-wide ${muted}`}>
            {compact.source === 'estimated' && !isSuccess && !isFailure ? 'Staged estimate' : timestamp ? `Updated ${timestamp}` : ''}
          </span>
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            className={`text-[11px] underline-offset-2 hover:underline ${muted}`}
          >
            {showDetails ? 'Hide run details' : 'View run details'}
          </button>
        </div>
      </div>

      {showDetails && (
        <div className={`mt-2 rounded-md border px-2.5 py-2 ${darkMode ? 'border-white/10 bg-black/15' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {progress.jobId && <span className={`tabular-nums ${muted}`}>Job {progress.jobId}</span>}
            {progress.status && <span className={muted}>Status {progress.status.replace(/_/g, ' ')}</span>}
            {typeof progress.queuedSeconds === 'number' && progress.queuedSeconds > 0 && <span className={muted}>Queued {progress.queuedSeconds}s</span>}
            {timestamp && <span className={muted}>Updated {timestamp}</span>}
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {ANALYSIS_PROGRESS_STEPS.map((step, index) => {
              const complete = isSuccess || index < currentIndex;
              const active = !isSuccess && !isFailure && index === currentIndex;
              const failed = isFailure && index === currentIndex;
              const tone = failed
                ? darkMode ? 'text-rose-300' : 'text-rose-700'
                : complete
                  ? darkMode ? 'text-emerald-300' : 'text-emerald-700'
                  : active
                    ? darkMode ? 'text-blue-300' : 'text-blue-700'
                    : muted;
              return (
                <div key={step.key} className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
                  {complete ? (
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                  ) : active ? (
                    <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                  ) : failed ? (
                    <AlertCircle className="w-3 h-3 shrink-0" />
                  ) : (
                    <Circle className="w-3 h-3 shrink-0" />
                  )}
                  <span className="truncate">{step.label}</span>
                </div>
              );
            })}
          </div>
          {(progress.warning || connectionWarning || showLongRunning) && (
            <p className={`mt-2 text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
              {progress.warning || connectionWarning || 'Analysis is taking longer than usual. Previous analysis remains visible while the job continues.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Floating card that anchors below the sticky header Re-run button.
// Rendered with absolute positioning inside a relative wrapper — does NOT push content down.
// Map smooth progress value (0–100) to a human-readable stage label.
// Smooth elapsed-time based progress target (never reaches 100 on its own).
function getSmoothEstimatedProgress(elapsedMs: number): number {
  if (elapsedMs < 1000) return 8;
  if (elapsedMs < 3000) return 15;
  if (elapsedMs < 6000) return 25;
  if (elapsedMs < 10000) return 38;
  if (elapsedMs < 16000) return 52;
  if (elapsedMs < 24000) return 68;
  if (elapsedMs < 35000) return 82;
  return 90;
}

function ExecutiveDecisionHero({
  darkMode,
  decisionStatus,
  recommendation,
  primaryReason,
  confidenceLevel,
  confidenceScore,
  convictionScore,
  evidenceCoverage,
  mainBlocker,
  nextAction,
  lastAnalyzed,
  onRunAnalysis,
  analysisRunning,
}: {
  darkMode: boolean;
  decisionStatus: DecisionStatus;
  recommendation: 'Proceed' | 'Investigate' | 'Caution' | 'Pass' | null;
  primaryReason: string;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number | null;
  convictionScore: number | null;
  evidenceCoverage: number | null;
  mainBlocker: string;
  nextAction: string;
  lastAnalyzed: string | null;
  onRunAnalysis?: () => void;
  analysisRunning?: boolean;
}) {
  const accentMap: Record<DecisionStatus['tier'], { border: string; bg: string; text: string }> = {
    go: darkMode
      ? { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.04]', text: 'text-emerald-400' }
      : { border: 'border-emerald-200', bg: 'bg-emerald-50/80', text: 'text-emerald-700' },
    investigate: darkMode
      ? { border: 'border-amber-500/30', bg: 'bg-amber-500/[0.04]', text: 'text-amber-400' }
      : { border: 'border-amber-200', bg: 'bg-amber-50/80', text: 'text-amber-700' },
    caution: darkMode
      ? { border: 'border-orange-500/30', bg: 'bg-orange-500/[0.04]', text: 'text-orange-400' }
      : { border: 'border-orange-200', bg: 'bg-orange-50/80', text: 'text-orange-700' },
    pass: darkMode
      ? { border: 'border-red-500/30', bg: 'bg-red-500/[0.04]', text: 'text-red-400' }
      : { border: 'border-red-200', bg: 'bg-red-50/80', text: 'text-red-700' },
    unknown: darkMode
      ? { border: 'border-white/10', bg: 'bg-white/[0.02]', text: 'text-gray-400' }
      : { border: 'border-gray-200', bg: 'bg-white', text: 'text-gray-600' },
  };
  const accent = accentMap[decisionStatus.tier];
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const subCard = darkMode ? 'bg-black/20 border-white/10' : 'bg-white/80 border-gray-200';
  const recommendationLabel = recommendation ? recommendation.toUpperCase() : 'PENDING';
  const scoreLabel = convictionScore === null ? 'Unknown' : `${convictionScore} / 100`;
  const confidenceScoreLabel = confidenceScore === null ? 'Unknown' : `${confidenceScore} / 100`;

  return (
    <section className={`rounded-xl border p-4 sm:p-5 ${accent.border} ${accent.bg}`} data-testid="executive-decision-hero">
      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.95fr] gap-4">
        <div className="min-w-0">
          <div className={`text-[10px] uppercase tracking-widest font-semibold ${accent.text}`}>Executive Decision</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className={`text-xl sm:text-2xl font-semibold tracking-tight ${heading}`}>
              {recommendationLabel}
            </h2>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${accent.border} ${accent.text}`}>
              {decisionStatus.readiness}
            </span>
          </div>
          <p className={`mt-1.5 text-sm font-medium ${heading}`}>{decisionStatus.headline}</p>
          <div className="mt-3">
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Primary reason</div>
            <p className={`mt-1 text-sm leading-relaxed ${body}`}>{primaryReason}</p>
          </div>
          <div className="mt-3">
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Main blocker</div>
            <p className={`mt-1 text-sm font-medium leading-snug pl-2.5 border-l-2 ${accent.border} ${decisionStatus.tier === 'go' ? body : accent.text}`}>{mainBlocker}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 content-start">
          <div className={`rounded-lg border p-3 sm:p-4 ${subCard}`}>
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Confidence</div>
            <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${confidenceTone(confidenceLevel, darkMode)}`}>
              {confidenceLevel}
            </span>
            <div className={`mt-1.5 text-xs ${muted}`}>{confidenceScoreLabel}</div>
          </div>
          <div className={`rounded-lg border p-3 sm:p-4 ${subCard}`}>
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Decision Score</div>
            <div className={`mt-2 text-xl font-semibold tabular-nums ${heading}`}>{scoreLabel}</div>
          </div>
          <div className={`rounded-lg border p-3 sm:p-4 ${subCard}`}>
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Evidence Coverage</div>
            <div className={`mt-2 text-xl font-semibold tabular-nums ${heading}`}>{formatPercent(evidenceCoverage)}</div>
          </div>
          <div className={`rounded-lg border p-3 sm:p-4 ${subCard}`}>
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Last Analyzed</div>
            <div className={`mt-2 text-sm font-medium ${heading}`}>{lastAnalyzed ?? 'Not analyzed'}</div>
          </div>
          <div className={`col-span-2 rounded-lg border p-3 sm:p-4 ${subCard}`}>
            <div className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Next required action</div>
            <div className={`mt-2 text-sm leading-snug ${body}`}>{nextAction}</div>
            {onRunAnalysis && (
              <button
                type="button"
                onClick={onRunAnalysis}
                disabled={analysisRunning}
                aria-busy={analysisRunning || undefined}
                className={`mt-2 shrink-0 flex items-center gap-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {analysisRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {analysisRunning ? 'Re-running...' : 'Re-run analysis'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DecisionSignalsSummary({
  darkMode,
  positives,
  blockers,
  validation,
}: {
  darkMode: boolean;
  positives: string[];
  blockers: string[];
  validation: string[];
}) {
  const card = darkMode ? 'bg-white/[0.02] border-white/10' : 'bg-white border-gray-200';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';

  const groups = [
    { label: 'Primary Blockers', items: blockers, severity: 'Critical' as SeverityLevel },
    { label: 'Required Validation', items: validation, severity: 'Validation' as SeverityLevel },
    { label: 'Supporting Positives', items: positives, severity: 'Diagnostic' as SeverityLevel },
  ];

  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${card}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className={`text-sm font-medium ${heading}`}>Decision Signals</h2>
        <span className={`text-[10px] uppercase tracking-wide ${muted}`}>Compact summary</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {groups.map((group) => {
          const isCritical = group.severity === 'Critical';
          const isValidation = group.severity === 'Validation';
          const groupCardCls = isCritical
            ? darkMode
              ? 'border-rose-500/35 bg-rose-500/[0.07]'
              : 'border-rose-200 bg-rose-50/80'
            : isValidation
            ? darkMode
              ? 'border-amber-500/25 bg-amber-500/[0.05]'
              : 'border-amber-200/80 bg-amber-50/50'
            : darkMode
            ? 'border-white/[0.06] bg-white/[0.02]'
            : 'border-gray-200 bg-gray-50/60';
          const groupLabelCls = isCritical
            ? darkMode ? 'text-rose-400' : 'text-rose-600'
            : isValidation
            ? darkMode ? 'text-amber-400' : 'text-amber-600'
            : muted;
          const itemCls = isCritical
            ? darkMode ? 'text-[12.5px] leading-snug font-medium text-gray-200' : 'text-[12.5px] leading-snug font-medium text-gray-800'
            : isValidation
            ? `text-xs leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`
            : `text-xs leading-snug ${muted}`;
          return (
            <div key={group.label} className={`rounded-lg border p-3 ${groupCardCls}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className={`text-[10px] uppercase tracking-wide font-medium ${groupLabelCls}`}>{group.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityTone(group.severity, darkMode)}`}>
                  {group.items.length}
                </span>
              </div>
              {group.items.length > 0 ? (
                <ul className={isCritical ? 'space-y-2' : 'space-y-1.5'}>
                  {compactList(group.items).map((item, index) => (
                    <li key={`${group.label}-${index}`} className={itemCls}>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`text-xs italic ${muted}`}>No items surfaced.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollapsiblePreviewSection({
  id,
  title,
  icon,
  preview,
  count,
  expanded,
  onToggle,
  darkMode,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  preview: string;
  count?: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  darkMode: boolean;
  children: React.ReactNode;
}) {
  const card = darkMode ? 'bg-white/[0.02] border-white/10' : 'bg-white border-gray-200';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const row = darkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-gray-50';

  return (
    <div className={`rounded-lg border overflow-hidden ${card}`}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className={`w-full flex items-center justify-between gap-4 p-4 text-left transition-colors ${row}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={muted}>{icon}</span>
          <div className="min-w-0">
            <div className={`text-sm font-medium ${heading}`}>{title}</div>
            <div className={`text-xs leading-snug truncate ${muted}`}>
              {preview}
              {typeof count === 'number' ? ` · ${count} item${count === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
        {expanded ? <ChevronDown className={`w-4 h-4 shrink-0 ${muted}`} /> : <ChevronRight className={`w-4 h-4 shrink-0 ${muted}`} />}
      </button>
      {expanded && <div className={`border-t p-4 ${darkMode ? 'border-white/10 bg-white/[0.02]' : 'border-gray-200 bg-white'}`}>{children}</div>}
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
  analysisProgress,
  // extra
  keyDrivers,
  financialTruthBadge,
  signalTension,
  scoreBreakdownSections,
  structuredContradictions,
  missingEvidenceItems = [],
  financialCoverageBreakdown = [],
  dealId,
  documentsReloadKey = 0,
  decisionRationale,
}: DealWorkspaceV4Props) {
  const [showDocsModal, setShowDocsModal] = useState(false);

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

  const [evidenceDrawer, setEvidenceDrawer] = useState<{ refs: string[]; context?: string } | null>(null);

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
  // Prefer structuredContradictions (with evidence_refs + diagnostic_type) over plain strings.
  const contradictionItems: Array<{ text: string; severity: string; evidence_refs: string[]; diagnostic_type?: 'risk' | 'contradiction' }> =
    structuredContradictions && structuredContradictions.length > 0
      ? structuredContradictions
      : contradictions.map((text) => ({ severity: 'low' as const, text, evidence_refs: [] as string[], diagnostic_type: 'contradiction' as const }));

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
    ...(financialCoverage !== null && financialCoverage < 80
      ? ['Most underwriting-grade financial evidence is still missing']
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
  const confidenceLevel = normalizeConfidenceLevel(verdictResistanceLabel, verdictResistanceScore ?? convictionScore);
  const primaryReason = opportunitySummaryLine ?? decisionStatus.narrative;
  const blockerTexts = dedupeText([
    ...dealBreakers.map((item) => item.text),
    ...topNegativeContributors.map((c) => enforceFinancialTruth(mapContributorToSignal(c.key, c.label, 'negative'), financialTruthBadge)),
    ...fragilityItems.map((item) => item.text),
  ]);
  const positiveTexts = dedupeText(
    topPositiveContributors.map((c) => enforceFinancialTruth(mapContributorToSignal(c.key, c.label, 'positive'), financialTruthBadge)),
  );
  const validationTexts = validationItems.map((item) => item.text);
  const mainBlocker =
    blockerTexts[0] ??
    missingForUnderwriting[0] ??
    validationTexts[0] ??
    (decisionStatus.tier === 'go' ? 'No primary blocker surfaced.' : 'Primary blocker not identified.');
  const nextRequiredAction =
    validationTexts[0] ??
    missingForUnderwriting[0] ??
    (onRunAnalysis ? 'Re-run analysis with the latest documents.' : 'No required action surfaced.');
  const analysisRunning = Boolean(analysisProgress?.active);

  // Smooth frontend-simulated progress — bar never jumps from coarse backend status.
  const [displayProgress, setDisplayProgress] = useState(0);
  useEffect(() => {
    if (!analysisRunning) {
      const isSuccess =
        analysisProgress?.terminal === 'success' ||
        normalizeProgressToken(analysisProgress?.status) === 'succeeded' ||
        normalizeProgressToken(analysisProgress?.status) === 'succeeded_with_warnings';
      if (isSuccess) setDisplayProgress(100);
      return;
    }
    setDisplayProgress(8);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const smoothTarget = getSmoothEstimatedProgress(elapsedMs);
      // Only trust backend progressPct when it looks granular (not a coarse fallback like 10/20/40).
      const rawPct = analysisProgress?.progressPct;
      const backendLooksGranular =
        typeof rawPct === 'number' && rawPct > 0 && rawPct < 100 && ![10, 20, 40].includes(rawPct);
      const target = backendLooksGranular
        ? Math.max(rawPct, smoothTarget)
        : smoothTarget;
      setDisplayProgress((prev) => Math.min(target, prev + 2));
    }, 750);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisRunning]);

  const miniAccentText = {
    go: darkMode ? 'text-emerald-400' : 'text-emerald-700',
    investigate: darkMode ? 'text-amber-400' : 'text-amber-700',
    caution: darkMode ? 'text-orange-400' : 'text-orange-700',
    pass: darkMode ? 'text-red-400' : 'text-red-700',
    unknown: darkMode ? 'text-gray-400' : 'text-gray-600',
  }[decisionStatus.tier];

  return (
    <>
    <div className={`w-full ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>

      {/* Sticky Identity Strip */}
      <div
        className={`sticky top-0 z-20 backdrop-blur-xl border-b ${
          darkMode
            ? 'bg-[#0a0a0a]/95 border-white/10'
            : 'bg-gray-50/95 border-gray-200'
        }`}
      >
        {/* Row 1 — fixed height identity row */}
        <div className="flex h-12 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                }`}
              >
                <ArrowLeft className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            )}
            <div className="flex items-center gap-x-2.5 gap-y-0 min-w-0 overflow-hidden">
              <h1 className={`shrink-0 text-sm font-semibold ${heading}`}>{displayCompany}</h1>
              <span className={`shrink-0 ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
              <span className={`shrink-0 text-sm ${muted}`}>{displayDealType}</span>
              <span className={`shrink-0 ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
              <span className={`shrink-0 text-sm ${muted}`}>{displayStage}</span>
              <span className={`shrink-0 ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
              <span className={`shrink-0 text-sm ${muted}`}>{displayRaise}</span>
              {displayLastAnalyzed && (
                <>
                  <span className={`shrink-0 hidden lg:inline ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
                  <span className={`shrink-0 hidden lg:inline text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    {displayLastAnalyzed}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 hidden sm:flex items-center gap-2 ml-4">
          {dealId && (
              <Button
                variant="outline"
                size="sm"
                darkMode={darkMode}
                className="whitespace-nowrap gap-1.5"
                onClick={() => setShowDocsModal(true)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Documents
              </Button>
          )}
          {onRunAnalysis && (
            <div className="relative shrink-0">
              <Button
                variant="outline"
                size="sm"
                darkMode={darkMode}
                className="whitespace-nowrap gap-1.5"
                onClick={onRunAnalysis}
                disabled={analysisRunning}
                loading={analysisRunning}
              >
                {analysisRunning ? 'Re-running...' : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Re-run Analysis
                  </>
                )}
              </Button>
              {analysisProgress && (analysisProgress.active || analysisProgress.terminal || analysisProgress.error) && (() => {
                const s = normalizeProgressToken(analysisProgress.status);
                const cardStatus: SystemProgressStatus =
                  analysisProgress.terminal === 'success' || s === 'succeeded' || s === 'succeeded_with_warnings'
                    ? 'success'
                    : analysisProgress.terminal === 'error' || s === 'failed' || s === 'cancelled'
                      ? 'failed'
                      : 'running';
                return (
                  <SystemProgressCard
                    darkMode={darkMode}
                    status={cardStatus}
                    progress={displayProgress}
                    title="Re-running"
                    successTitle="Analysis updated"
                    errorMessage={analysisProgress.error ?? undefined}
                    anchor="header"
                  />
                );
              })()}
            </div>
          )}
          </div>
        </div>

        {/* Row 2 — mini decision summary (only when analysis has run) */}
        {(recommendation !== null || convictionScore !== null) && (
          <div className={`flex items-center gap-x-2 px-4 sm:px-6 py-1.5 border-t ${
            darkMode ? 'border-white/[0.08] bg-white/[0.01]' : 'border-gray-200/80 bg-gray-50/60'
          }`}>
            {recommendation && (
              <span className={`text-[10.5px] font-semibold uppercase tracking-widest shrink-0 ${miniAccentText}`}>{recommendation}</span>
            )}
            {convictionScore !== null && (
              <>
                <span className={`shrink-0 text-[11px] ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{convictionScore}/100</span>
              </>
            )}
            {financialCoverage !== null && (
              <>
                <span className={`shrink-0 text-[11px] ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
                <span className={`shrink-0 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Financial Data {Math.round(financialCoverage)}%</span>
              </>
            )}
            {mainBlocker && mainBlocker !== 'No primary blocker surfaced.' && mainBlocker !== 'Primary blocker not identified.' && (
              <>
                <span className={`shrink-0 text-[11px] ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
                <span className={`text-[11px] truncate min-w-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  <span className={`hidden sm:inline ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Blocker: </span>{mainBlocker}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 pt-5 pb-8 space-y-6">
        <ExecutiveDecisionHero
          darkMode={darkMode}
          decisionStatus={decisionStatus}
          recommendation={recommendation}
          primaryReason={primaryReason}
          confidenceLevel={confidenceLevel}
          confidenceScore={verdictResistanceScore ?? convictionScore}
          convictionScore={convictionScore}
          evidenceCoverage={financialCoverage}
          mainBlocker={mainBlocker}
          nextAction={nextRequiredAction}
          lastAnalyzed={displayLastAnalyzed}
          onRunAnalysis={onRunAnalysis}
          analysisRunning={analysisRunning}
        />

        {/* Investment Readiness Summary — institutional IC memo takeaway panel */}
        {recommendation !== null && (
          <div className={`rounded-xl border p-5 ${card}`}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${muted}`}>
                  Investment Readiness
                </div>
                <div className={`text-sm font-semibold ${heading}`}>{decisionStatus.headline}</div>
              </div>
              <div className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${
                decisionStatus.tier === 'go'
                  ? darkMode ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-emerald-700 border-emerald-200 bg-emerald-50'
                  : decisionStatus.tier === 'investigate'
                  ? darkMode ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-amber-700 border-amber-200 bg-amber-50'
                  : decisionStatus.tier === 'pass'
                  ? darkMode ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' : 'text-rose-700 border-rose-200 bg-rose-50'
                  : darkMode ? 'text-orange-400 border-orange-500/30 bg-orange-500/10' : 'text-orange-700 border-orange-200 bg-orange-50'
              }`}>
                {decisionStatus.readiness}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Why Not Ready — hidden when recommendation is Proceed */}
              {recommendation !== 'Proceed' && (
                <div>
                  <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${
                    darkMode ? 'text-rose-400' : 'text-rose-600'
                  }`}>
                    Why Not Ready
                  </div>
                  <ul className="space-y-1.5">
                    {dedupeText([...blockerTexts.slice(0, 2), ...missingForUnderwriting.slice(0, 1)])
                      .slice(0, 3)
                      .map((t, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-rose-500' : 'bg-rose-400'}`} />
                          <span className={`text-[11px] leading-snug ${body}`}>{t}</span>
                        </li>
                      ))}
                    {dedupeText([...blockerTexts.slice(0, 2), ...missingForUnderwriting.slice(0, 1)]).length === 0 && (
                      <li className={`text-[11px] ${muted}`}>No specific blockers identified</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Strongest Signals */}
              <div>
                <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${
                  darkMode ? 'text-emerald-400' : 'text-emerald-600'
                }`}>
                  Strongest Signals
                </div>
                <ul className="space-y-1.5">
                  {positiveTexts.slice(0, 3).map((t, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-emerald-500' : 'bg-emerald-500'}`} />
                      <span className={`text-[11px] leading-snug ${body}`}>{t}</span>
                    </li>
                  ))}
                  {positiveTexts.length === 0 && (
                    <li className={`text-[11px] ${muted}`}>No confirmed positive signals</li>
                  )}
                </ul>
              </div>

              {/* Critical Evidence Gaps */}
              <div>
                <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${
                  darkMode ? 'text-amber-400' : 'text-amber-600'
                }`}>
                  Critical Gaps
                </div>
                <ul className="space-y-1.5">
                  {missingEvidenceItems.slice(0, 3).map((m, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-amber-500' : 'bg-amber-500'}`} />
                      <span className={`text-[11px] leading-snug ${body}`}>{m.description}</span>
                    </li>
                  ))}
                  {missingEvidenceItems.length === 0 && missingForUnderwriting.slice(0, 3).map((t, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-amber-500' : 'bg-amber-500'}`} />
                      <span className={`text-[11px] leading-snug ${body}`}>{t}</span>
                    </li>
                  ))}
                  {missingEvidenceItems.length === 0 && missingForUnderwriting.length === 0 && (
                    <li className={`text-[11px] ${muted}`}>No critical gaps identified</li>
                  )}
                </ul>
              </div>

              {/* Financial Readiness */}
              <div>
                <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${
                  darkMode ? 'text-blue-400' : 'text-blue-600'
                }`}>
                  Financial Readiness
                </div>
                <div className={`text-2xl font-semibold tabular-nums ${
                  financialCoverage === null
                    ? darkMode ? 'text-gray-500' : 'text-gray-400'
                    : financialCoverage < 30
                    ? darkMode ? 'text-rose-400' : 'text-rose-600'
                    : financialCoverage < 60
                    ? darkMode ? 'text-amber-400' : 'text-amber-600'
                    : darkMode ? 'text-emerald-400' : 'text-emerald-600'
                }`}>
                  {financialCoverage !== null ? `${Math.round(financialCoverage)}%` : '\u2014'}
                </div>
                <div className={`text-[10px] mt-0.5 ${muted}`}>
                  {financialCoverage !== null ? 'of required underwriting fields' : 'Not assessed'}
                </div>
                <div className={`mt-2 text-[10px] leading-snug ${muted}`}>{financialConfidence.summary}</div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 5: Decision Rationale — validated LLM IC-memo narrative */}
        {decisionRationale?.status === 'validated' && (
          <DecisionRationaleSection
            rationale={decisionRationale}
            darkMode={darkMode}
          />
        )}

        {/* Decision Layer (Above the Fold) */}
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6">

          {/* LEFT: Opportunity Signal — decision surface */}
          <div className="space-y-4">
            <DecisionSignalsSummary
              darkMode={darkMode}
              positives={positiveTexts}
              blockers={blockerTexts}
              validation={validationTexts}
            />

            {financialTruthBadge && (() => {
              const { label, cls } = FINANCIAL_TRUTH_BADGE_STYLES[financialTruthBadge.tier];
              return (
                <div className={`flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg border ${darkMode ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`text-[10px] uppercase tracking-wide font-medium ${muted}`}>Financial Truth</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{label}</span>
                  <span className={`text-xs leading-relaxed ${muted}`}>{financialTruthBadge.text}</span>
                </div>
              );
            })()}
          </div>

          {/* RIGHT: Decision Confidence — scores, model diagnostics, robustness */}
          <div className="space-y-5">

            {/* Decision Confidence — scores, model output, robustness indicators */}
            <div className={`p-5 rounded-lg border ${card}`}>
              <div className={`text-xs uppercase tracking-wide mb-2.5 ${muted}`}>
                Decision Confidence
              </div>
              {(() => {
                const confidenceCopy: Record<ConfidenceLevel, string> = {
                  Strong: 'Decision-ready',
                  Moderate: 'Conclusion mostly stable',
                  Weak: 'Evidence support is weak',
                  Fragile: 'Conclusion can change with validation',
                  Unknown: 'Not evaluated',
                };
                return (
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-md border text-xs font-semibold ${confidenceTone(confidenceLevel, darkMode)}`}>
                        {confidenceLevel}
                      </span>
                      <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {confidenceCopy[confidenceLevel]}
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
                    <div className={`text-sm font-medium tabular-nums ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {verdictResistanceScore !== null && verdictResistanceScore !== undefined
                        ? `${verdictResistanceScore} / 100`
                        : convictionScore !== null
                        ? `${convictionScore} / 100`
                        : '—'}
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

              {/* Phase 4A: Conviction Factor Breakdown — "Why the Decision Scored This Way" */}
              {(topPositiveContributors.length > 0 || topNegativeContributors.length > 0) && (
                <details className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/5' : 'border-gray-100'}`}>
                  <summary className={`cursor-pointer list-none text-[11px] font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Why the Decision Scored This Way
                  </summary>
                  <div className="mt-2.5 space-y-2.5">
                    {topPositiveContributors.length > 0 && (
                      <div>
                        <div className={`text-[10px] uppercase tracking-wide mb-1.5 ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>Positive drivers</div>
                        <ul className="space-y-1.5">
                          {topPositiveContributors.map((c) => (
                            <li key={c.key} className="flex items-start gap-2">
                              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${darkMode ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
                              <span className={`text-[11px] leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {c.label}
                                {c.scoreDelta != null && Math.abs(c.scoreDelta) >= 1 && (
                                  <span className={`ml-1.5 tabular-nums text-[10px] ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                                    +{Math.round(c.scoreDelta)}
                                  </span>
                                )}
                                <EvidenceChipRow
                                  evidenceRefs={c.evidence_refs ?? []}
                                  context={c.label}
                                  darkMode={darkMode}
                                  onOpen={(refs, ctx) => setEvidenceDrawer({ refs, context: ctx })}
                                />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {topNegativeContributors.length > 0 && (
                      <div>
                        <div className={`text-[10px] uppercase tracking-wide mb-1.5 ${darkMode ? 'text-rose-400' : 'text-rose-700'}`}>Negative drivers</div>
                        <ul className="space-y-1.5">
                          {topNegativeContributors.map((c) => (
                            <li key={c.key} className="flex items-start gap-2">
                              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${darkMode ? 'bg-rose-400' : 'bg-rose-500'}`} />
                              <span className={`text-[11px] leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {c.label}
                                {c.scoreDelta != null && Math.abs(c.scoreDelta) >= 1 && (
                                  <span className={`ml-1.5 tabular-nums text-[10px] ${darkMode ? 'text-rose-400' : 'text-rose-700'}`}>
                                    {Math.round(c.scoreDelta)}
                                  </span>
                                )}
                                <EvidenceChipRow
                                  evidenceRefs={c.evidence_refs ?? []}
                                  context={c.label}
                                  darkMode={darkMode}
                                  onOpen={(refs, ctx) => setEvidenceDrawer({ refs, context: ctx })}
                                />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
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
          <div className={`pt-2 border-t ${darkMode ? 'border-white/[0.04]' : 'border-gray-100/80'}`}>
            <h2 className={`text-sm font-medium mb-4 ${sectionLabel}`}>Risk Assessment</h2>
            <div className={`rounded-xl border p-4 sm:p-5 ${card}`}>
              <div className="space-y-3">
                <DecisionListGroup
                  title="Critical Issues"
                  items={dealBreakers.length > 0 ? dealBreakers : fragilityItems.slice(0, 1)}
                  tone={dealBreakers.length > 0 ? 'critical' : 'warning'}
                  darkMode={darkMode}
                  body={body}
                  muted={muted}
                  emphasis="strong"
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <details className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                    <summary className={`cursor-pointer list-none text-[11px] font-medium ${sectionLabel}`}>
                      Major Concerns · {fragilityItems.length}
                    </summary>
                    <div className="mt-2.5">
                      <DecisionListGroup
                        title="Major Concerns"
                        items={fragilityItems}
                        tone="warning"
                        darkMode={darkMode}
                        body={body}
                        muted={muted}
                      />
                    </div>
                  </details>
                  <details className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                    <summary className={`cursor-pointer list-none text-[11px] font-medium ${sectionLabel}`}>
                      Required Validation · {validationItems.length}
                    </summary>
                    <div className="mt-2.5">
                      <DecisionListGroup
                        title="Required Validation"
                        items={validationItems}
                        tone="neutral"
                        darkMode={darkMode}
                        body={body}
                        muted={muted}
                      />
                    </div>
                  </details>
                </div>

                {/* Phase 4A: Contradiction Callouts — explicit panel when contradictions exist */}
                {contradictionItems.length > 0 && (
                  <details className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                    <summary className={`cursor-pointer list-none text-[11px] font-medium ${
                      darkMode ? 'text-rose-400' : 'text-rose-700'
                    }`}>
                      {/* If every item is a risk signal (not a genuine factual conflict), label the panel
                          accordingly so it doesn't mislead reviewers into thinking claims contradict. */}
                      {(() => {
                        const allRisks = contradictionItems.every(item => item.diagnostic_type === 'risk');
                        const allConflicts = contradictionItems.every(item => item.diagnostic_type !== 'risk');
                        if (allRisks) return `Risk Signals Detected \u00b7 ${contradictionItems.length}`;
                        if (allConflicts) return `Contradictions Detected \u00b7 ${contradictionItems.length}`;
                        return `Signal Diagnostics \u00b7 ${contradictionItems.length}`;
                      })()}
                    </summary>
                    <div className="mt-2.5 space-y-2">
                      {contradictionItems.map((item, idx) => {
                        // Humanize the text, then truncate to first sentence (≤140 chars) to
                        // prevent long narrative blobs from duplicating the Major Concerns panel.
                        const humanized = humanizeContradiction(item.text);
                        const firstSentence = humanized.match(/^[^.!?]+[.!?]/)?.[0] ?? humanized;
                        const display = firstSentence.length <= 140 ? firstSentence : firstSentence.slice(0, 137) + '…';
                        const category = inferContradictionCategory(item.text);
                        return (
                          <div key={idx} className="flex items-start gap-2">
                            <AlertCircle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                              (item.severity as string) === 'high'
                                ? darkMode ? 'text-rose-400' : 'text-rose-600'
                                : (item.severity as string) === 'medium'
                                ? darkMode ? 'text-amber-400' : 'text-amber-600'
                                : darkMode ? 'text-gray-500' : 'text-gray-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <span className={`inline-block text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded mr-1.5 mb-0.5 ${
                                darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {category}
                              </span>
                              <span className={`text-[11px] leading-snug ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {display}
                              </span>
                            </div>
                            <EvidenceChipRow
                              evidenceRefs={item.evidence_refs ?? []}
                              context={display}
                              darkMode={darkMode}
                              onOpen={(refs, ctx) => setEvidenceDrawer({ refs, context: ctx })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {riskDiagnostics.length > 0 && (
                  <details className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                    <summary className={`cursor-pointer list-none text-[11px] font-medium ${sectionLabel}`}>
                      Signal Notes · {riskDiagnostics.length}
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
        <div className={`pt-2 border-t ${darkMode ? 'border-white/[0.04]' : 'border-gray-100/80'}`}>
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
              coverageText={financialCoverage !== null ? `${Math.round(financialCoverage)}%` : 'Unknown'}
              financialTruthText={financialTruthBadge?.text ?? null}
            />

            <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
              <FinancialMetricCard
                label={revenueTile.isProjected ? 'Projected Revenue' : 'Revenue / ARR'}
                value={metricIsPresent(revenueTile) ? revenueTile.value : 'Missing'}
                note={metricIsPresent(revenueTile) ? (metricIsEstimated(revenueTile) ? 'Modeled — not confirmed revenue' : 'Available') : null}
                status={!metricIsPresent(revenueTile) ? 'missing' : metricIsEstimated(revenueTile) ? 'estimated' : 'present'}
                darkMode={darkMode}
                heading={heading}
                muted={muted}
                card={subCard}
                priority
                trust={revenueTile.trust}
                isProjected={revenueTile.isProjected}
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
                trust={burnTile.trust}
                isProjected={burnTile.isProjected}
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
                trust={runwayTile.trust}
                isProjected={runwayTile.isProjected}
              />
              <FinancialMetricCard
                label="Financial Data Coverage"
                value={financialCoverage !== null ? `${Math.round(financialCoverage)}%` : 'Unknown'}
                note={financialCoverage !== null ? 'of required underwriting fields present' : null}
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

        {/* Phase 4A: Section Evidence Coverage — sourced from score_breakdown_v1.sections */}
        {scoreBreakdownSections && scoreBreakdownSections.length > 0 && (() => {
          const SECTION_LABELS: Record<string, string> = {
            market: 'Market', product: 'Product', business_model: 'Business Model',
            traction: 'Traction', financials: 'Financials', team: 'Team',
            risks: 'Risks', terms: 'Terms', icp: 'ICP',
          };
          // Only show sections that have some coverage data
          const visibleSections = scoreBreakdownSections.filter(
            (s) => s.trace_coverage_pct != null || s.coverage_pct != null || s.support_status !== 'unknown',
          );
          if (visibleSections.length === 0) return null;
          return (
            <div className={`pt-2 border-t ${darkMode ? 'border-white/[0.04]' : 'border-gray-100/80'}`}>
              <details>
                <summary className={`cursor-pointer list-none text-sm font-medium mb-4 ${sectionLabel}`}>
                  Evidence Support · {visibleSections.length} sections
                </summary>
                <div className={`mt-3 rounded-xl border p-4 ${card}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {visibleSections.map((section) => {
                      const label = SECTION_LABELS[section.key] ?? section.key;
                      // Status label: 'supported' maps to 'Partial' (evidence found but underwriting
                      // completeness is not guaranteed). 'Strong' would require verified + corroborated
                      // evidence that the backend does not currently signal via this field.
                      const statusLabel =
                        section.support_status === 'supported' ? 'Partial'
                        : section.support_status === 'weak' ? 'Weak'
                        : section.support_status === 'missing' ? 'Missing'
                        : 'Unknown';
                      const statusColor =
                        section.support_status === 'supported'
                          ? darkMode ? 'text-blue-400' : 'text-blue-700'
                          : section.support_status === 'weak'
                          ? darkMode ? 'text-amber-400' : 'text-amber-700'
                          : section.support_status === 'missing'
                          ? darkMode ? 'text-rose-400' : 'text-rose-700'
                          : darkMode ? 'text-gray-500' : 'text-gray-400';
                      // Bar fill by status: Partial=65%, Weak=25%, Missing=0%, Unknown=10%
                      const barFill =
                        section.support_status === 'supported' ? 65
                        : section.support_status === 'weak' ? 25
                        : section.support_status === 'missing' ? 0
                        : 10;
                      const barColor =
                        barFill >= 60
                          ? darkMode ? 'bg-blue-500' : 'bg-blue-500'
                          : barFill >= 20
                          ? darkMode ? 'bg-amber-500' : 'bg-amber-500'
                          : darkMode ? 'bg-rose-500' : 'bg-rose-500';
                      return (
                        <div key={section.key} className={`rounded-lg border px-3 py-2.5 ${subCard}`}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className={`text-[11px] font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
                            <span className={`text-[10px] font-semibold ${statusColor}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <div className={`h-1 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${Math.min(barFill, 100)}%` }}
                            />
                          </div>
                          {section.hint && (
                            <p className={`mt-1 text-[10px] leading-snug ${muted}`}>{section.hint}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className={`mt-3 text-[10px] leading-relaxed ${muted}`}>
                    Evidence support reflects the extraction quality per section. “Partial” means evidence was found but completeness is not guaranteed — claims may be management-sourced. “Weak” means sparse or low-confidence extraction only. “Strong” would require verified, corroborated evidence.
                  </p>
                </div>
              </details>
            </div>
          );
        })()}

        {/* Team Highlights (collapsible, only when data present) */}
        {hasTeam && (
          <CollapsiblePreviewSection
            id="team"
            title="Team Highlights"
            icon={<Users className="w-4 h-4" />}
            preview={teamHighlights[0]?.credential || `${teamHighlights[0]?.name ?? 'Team'} · ${teamHighlights[0]?.role ?? 'role extracted'}`}
            count={teamHighlights.length}
            expanded={expandedSections.team}
            onToggle={toggleSection}
            darkMode={darkMode}
          >
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
          </CollapsiblePreviewSection>
        )}

        {/* Use of Funds (collapsible, only when data present) */}
        {hasUoF && (
          <CollapsiblePreviewSection
            id="funds"
            title="Use of Funds"
            icon={<DollarSign className="w-4 h-4" />}
            preview={`${useOfFunds[0]?.category ?? 'Allocation'}${useOfFunds[0]?.amountLabel ? ` · ${useOfFunds[0].amountLabel}` : ''}`}
            count={useOfFunds.length}
            expanded={expandedSections.funds}
            onToggle={toggleSection}
            darkMode={darkMode}
          >
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
          </CollapsiblePreviewSection>
        )}

        {/* Project Pipeline (collapsible, only when data present) */}
        {hasPipeline && (
          <CollapsiblePreviewSection
            id="pipeline"
            title="Project Pipeline"
            icon={<Calendar className="w-4 h-4" />}
            preview={`${projectPipeline[0]?.name ?? 'Pipeline item'}${projectPipeline[0]?.capitalLabel ? ` · Capital: ${projectPipeline[0].capitalLabel}` : ''}`}
            count={projectPipeline.length}
            expanded={expandedSections.pipeline}
            onToggle={toggleSection}
            darkMode={darkMode}
          >
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
          </CollapsiblePreviewSection>
        )}

        {/* Revenue Model (collapsible, only when data present) */}
        {hasRevenueModel && (
          <CollapsiblePreviewSection
            id="revenue"
            title="Revenue Model"
            icon={<Activity className="w-4 h-4" />}
            preview={revenueModel.unitEconomics || revenueModel.type || revenueModel.detail || 'Revenue model extracted'}
            expanded={expandedSections.revenue}
            onToggle={toggleSection}
            darkMode={darkMode}
          >
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
          </CollapsiblePreviewSection>
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

    {/* Phase 4B.1: Evidence Trace Drawer */}
    <EvidenceTraceDrawer
      open={evidenceDrawer !== null}
      onClose={() => setEvidenceDrawer(null)}
      evidenceRefs={evidenceDrawer?.refs ?? []}
      context={evidenceDrawer?.context}
      darkMode={darkMode}
    />

    {/* Documents Modal */}
    {showDocsModal && dealId && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowDocsModal(false)}
        />
        {/* Card */}
        <div className={`relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.5)] border overflow-hidden ${
          darkMode
            ? 'bg-zinc-900 border-white/10'
            : 'bg-white border-gray-200'
        }`}>
          {/* Modal header */}
          <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <div className="flex items-center gap-2">
              <FolderOpen className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              <span className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Documents
              </span>
            </div>
            <button
              onClick={() => setShowDocsModal(false)}
              className={`p-1.5 rounded-lg transition-colors ${
                darkMode ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              aria-label="Close documents"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Modal body */}
          <div className="flex-1 overflow-y-auto p-5">
            <DocumentsTab
              dealId={dealId}
              darkMode={darkMode}
              reloadKey={documentsReloadKey}
            />
          </div>
        </div>
      </div>
    )}
    </>
  );
}
