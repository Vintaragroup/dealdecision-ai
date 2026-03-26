import { useMemo } from 'react';
import {
  ProcessedAuditData,
  FinancialAuditTabProps,
  AuditStatus,
  ConfidenceLevel,
  SupportStatus,
  ImpactSeverity,
  SourceOfTruthRow,
  ValidationState,
  IntegrityState,
  ReadinessState,
  ReconciliationStatus,
  VisibleStatusTone,
  VisibleAuditState,
  TemporalAlignmentBlock,
} from '../types/financialAudit';
import type {
  FinancialMetricPointLike,
} from '../lib/selectors/selectAuthoritativeFinancialBreakdownV1';
import type {
  IntegrityFlag,
} from '../lib/selectors/selectAuthoritativeFinancialIntegrityV1';

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatMetricValue(m: FinancialMetricPointLike | null | undefined): string {
  if (!m || m.value == null) return '—';
  const v = m.value;
  switch (m.unit) {
    case 'currency': {
      const pfx = !m.currency || m.currency === 'USD' ? '$' : `${m.currency} `;
      const abs = Math.abs(v);
      if (abs >= 1_000_000) return `${pfx}${(v / 1_000_000).toFixed(1)}M`;
      if (abs >= 1_000) return `${pfx}${Math.round(v / 1_000)}K`;
      return `${pfx}${v.toFixed(0)}`;
    }
    case 'percent': {
      // Support both 0–1 decimal and 0–100 percentage representations
      const pct = Math.abs(v) <= 1 ? v * 100 : v;
      return `${pct.toFixed(1)}%`;
    }
    case 'months':
      return `${v.toFixed(1)} months`;
    default:
      return String(v);
  }
}

function mapConfidence(c: string | null | undefined): ConfidenceLevel {
  if (c === 'high') return 'High';
  if (c === 'medium') return 'Medium';
  return 'Low';
}

function mapConfidenceToSourceWeight(c: string | null | undefined): number {
  if (c === 'high') return 5;
  if (c === 'medium') return 3;
  return 1;
}

function mapReadinessStatus(status: string | undefined): AuditStatus {
  if (status === 'sufficient') return 'READY';
  if (status === 'partially_sufficient') return 'PARTIAL';
  return 'WARNING';
}

function mapIntegritySeverityToImpact(s: string): ImpactSeverity {
  if (s === 'critical' || s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

function formatFlagKey(key: string): string {
  // 'cross_source_discrepancy:revenue' → 'Revenue'
  const parts = key.split(':');
  const label = parts[parts.length - 1] ?? key;
  return label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSourceKind(kind: string): string {
  if (kind === 'xlsx') return 'XLSX Model';
  if (kind === 'deck') return 'Pitch Deck';
  if (kind === 'pdf') return 'PDF Document';
  if (kind === 'webmax') return 'WebMax';
  return kind;
}

function percentDiff(a: number, b: number): string {
  if (b === 0) return 'N/A';
  const pct = ((a - b) / Math.abs(b)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function getSupportStatusFromFlags(
  factType: string,
  flags: IntegrityFlag[],
): SupportStatus {
  const relevant = flags.filter(
    (f) =>
      (f.fact_type && f.fact_type === factType) ||
      f.flag_key.includes(factType),
  );
  if (
    relevant.some(
      (f) =>
        f.flag_key.startsWith('cross_source') && f.source_a && f.source_b,
    )
  )
    return 'Conflicting';
  if (relevant.some((f) => f.flag_key.startsWith('single_source')))
    return 'Single Source';
  return 'Supported';
}

// ─── Phase 2: semantic display helpers ───────────────────────────────────────

/**
 * Converts a snake_case derivation_rule like 'burn_rate_from_total_expenses_run_rate'
 * into a readable phrase like 'From total expenses run rate'.
 */
function formatDerivationRule(rule: string): string {
  const fromIdx = rule.indexOf('_from_');
  const desc = fromIdx >= 0 ? rule.slice(fromIdx + 6) : rule;
  return 'From ' + desc.replace(/_/g, ' ');
}

/**
 * Builds a concise sublabel for a metric based on its Phase 2 semantic fields.
 * Shown below the metric name in the Source of Truth table.
 */
function buildMetricSublabel(m: FinancialMetricPointLike): string | null {
  if (m.is_derived && m.derivation_rule) {
    return formatDerivationRule(m.derivation_rule);
  }
  if (m.is_derived) return 'Workbook-derived estimate';
  if (m.selection_reason) {
    // Truncate long reasons for the table
    return m.selection_reason.length > 90
      ? m.selection_reason.slice(0, 87) + '…'
      : m.selection_reason;
  }
  return null;
}

/**
 * Converts an alternative FinancialMetricPointLike into a compact display object
 * for rendering as a secondary row in the Source of Truth table.
 */
function buildAlternativeFactDisplay(
  alt: FinancialMetricPointLike,
): { label: string; value: string; sublabel: string } {
  const isProjected = alt.is_projected === true;
  const isDerived = alt.is_derived === true;
  const period = alt.period_label;

  const label = isProjected
    ? `Projected${period ? ` (${period})` : ' estimate'}`
    : isDerived
    ? 'Workbook-derived proxy'
    : 'Alternative metric';

  const parts: string[] = [];
  if (isDerived && alt.derivation_rule) parts.push(formatDerivationRule(alt.derivation_rule));
  if (isProjected) parts.push('Provisional / forward-looking');
  else if (isDerived) parts.push('Derived / provisional');
  if (alt.source_kind) parts.push(formatSourceKind(alt.source_kind));

  return { label, value: formatMetricValue(alt), sublabel: parts.join(' · ') };
}

// ─── Canonical state-derivation helpers ──────────────────────────────────────
//
// These functions form the single source of truth for the visible audit state.
// All UI sections (status badge, conflict count, reconciliation panel, readiness)
// MUST derive their display from the output of these functions — never from
// independent readings of individual payload fields.
//
// Rule: addding a new visible contradiction → add a check here, not in a component.

/**
 * Determines how many and which flags count as "discrepancies/conflicts" for
 * the purpose of the canonical conflict count.
 *
 * Broader than the structured reconciliation set (which requires source_a/source_b).
 * Any cross-source, discrepancy, mismatch, or conflict-pattern flag is a conflict.
 */
function deriveConflictState(flags: IntegrityFlag[]): {
  discrepancyFlags: IntegrityFlag[];
  structuredConflictFlags: IntegrityFlag[];
  conflictCount: number;
  hasConflicts: boolean;
} {
  // Canonical conflict set: any flag that signals a data disagreement
  const discrepancyFlags = flags.filter(
    (f) =>
      f.flag_key.startsWith('cross_source') ||
      f.flag_key.startsWith('discrepancy:') ||
      f.flag_key.startsWith('mismatch:') ||
      f.flag_key.startsWith('conflict:'),
  );
  // Structured subset: has source_a/source_b → renderable in the reconciliation panel
  const structuredConflictFlags = discrepancyFlags.filter(
    (f) => f.source_a != null && f.source_b != null,
  );
  const conflictCount = discrepancyFlags.length;
  return { discrepancyFlags, structuredConflictFlags, conflictCount, hasConflicts: conflictCount > 0 };
}

/**
 * Derives the validation state — describes whether integrity validation has
 * run and produced meaningful results, independently of readiness score.
 */
function deriveValidationState(
  hasAnyFinancialData: boolean,
  isIntegrityIncomplete: boolean,
  flags: IntegrityFlag[],
): ValidationState {
  if (!hasAnyFinancialData) return 'not_applicable';
  if (isIntegrityIncomplete) return 'unvalidated';
  if (flags.some((f) => f.status === 'FAIL')) return 'partially_validated';
  if (flags.some((f) => f.status === 'PASS')) return 'validated';
  return 'unvalidated'; // no PASS/FAIL flags despite integrity supposedly running
}

/**
 * Derives the integrity state — summary of the severity of integrity flags.
 * 'unknown' when validation has not completed.
 */
function deriveIntegrityState(
  flags: IntegrityFlag[],
  isIntegrityIncomplete: boolean,
): IntegrityState {
  if (isIntegrityIncomplete) return 'unknown';
  if (flags.some((f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'FAIL')) return 'critical';
  if (flags.some((f) => f.status === 'WARN' || (f.status === 'FAIL' && f.severity === 'medium'))) return 'warning';
  return 'clean';
}

/**
 * Derives the readiness state — gated by validation and integrity state.
 * A deal can ONLY be 'ready' if validation has completed and no critical conflicts exist.
 */
function deriveReadinessState(
  ur: any,
  validationState: ValidationState,
  integrityState: IntegrityState,
  hasConflicts: boolean,
): ReadinessState {
  // Cannot be ready if validation hasn't run
  if (validationState === 'not_applicable' || validationState === 'unvalidated') return 'not_ready';
  // Cannot be ready if critical integrity issues exist
  if (integrityState === 'critical') return 'not_ready';
  // Conflicts or warnings downgrade to partially_ready
  if (hasConflicts || integrityState === 'warning') return 'partially_ready';
  // Now gate on the raw readiness score
  const rawStatus = ur?.status;
  if (rawStatus === 'sufficient') return 'ready';
  if (rawStatus === 'partially_sufficient') return 'partially_ready';
  return 'not_ready';
}

/**
 * Derives the canonical reconciliation state from the conflict set.
 * This drives the CrossSourceReconciliation panel's empty-state text — never hardcoded.
 */
function deriveReconciliationState(
  discrepancyFlags: IntegrityFlag[],
  structuredConflictFlags: IntegrityFlag[],
  isIntegrityIncomplete: boolean,
): { status: ReconciliationStatus; message: string } {
  if (isIntegrityIncomplete) {
    return {
      status: 'unknown',
      message: 'Cross-source reconciliation requires completed integrity validation. Re-run analysis to generate reconciliation results.',
    };
  }
  if (discrepancyFlags.length === 0) {
    return { status: 'clean', message: 'No cross-source discrepancies detected.' };
  }
  const n = discrepancyFlags.length;
  const noun = n === 1 ? 'discrepancy' : 'discrepancies';
  if (structuredConflictFlags.length > 0) {
    return { status: 'conflicted', message: `${n} cross-source ${noun} detected.` };
  }
  // Discrepancy flags exist but lack source_a/source_b (not renderable as structured cards)
  return {
    status: 'conflicted',
    message: `${n} discrepancy ${n === 1 ? 'flag' : 'flags'} detected — see Risk Flags panel for details.`,
  };
}

/**
 * Derives the investor-safe visible status label from the full union of state layers.
 *
 * INVARIANT: 'Ready for Investment Review' is ONLY returned when:
 *   - data exists
 *   - validation has completed (validated or partially_validated)
 *   - no critical integrity issues
 *   - no conflicts
 *   - readiness state is 'ready'
 */
function deriveVisibleStatus(
  hasAnyFinancialData: boolean,
  validationState: ValidationState,
  integrityState: IntegrityState,
  readinessState: ReadinessState,
  conflictCount: number,
): string {
  if (!hasAnyFinancialData) return 'No Financial Data';
  if (validationState === 'unvalidated') return 'Data Extracted — Validation Incomplete';
  if (integrityState === 'critical' || conflictCount > 0 || readinessState === 'partially_ready') return 'Partially Ready';
  if (readinessState === 'not_ready') return 'Not Ready for Investment Review';
  return 'Ready for Investment Review';
}

function deriveVisibleStatusTone(label: string): VisibleStatusTone {
  if (label === 'Ready for Investment Review') return 'success';
  if (label === 'No Financial Data') return 'neutral';
  if (label === 'Partially Ready' || label === 'Data Extracted — Validation Incomplete') return 'warning';
  return 'warning'; // Not Ready → warning
}

/**
 * Parses the `period_alignment:grouped_temporal_mismatch` integrity flag (if present)
 * into a structured TemporalAlignmentBlock for dedicated UI rendering.
 *
 * The grouped flag replaces noisy per-metric temporal scope mismatch flags since Phase 3.
 * By surfacing it as a structured block instead of a raw risk-flag message, we can:
 *   - Show it amber (not red) — it is not a numeric conflict
 *   - List affected metrics cleanly
 *   - Exclude it from criticalActions and raw riskFlags lists
 */
function extractTemporalAlignmentBlock(flags: IntegrityFlag[]): TemporalAlignmentBlock {
  const flag = flags.find((f) => f.flag_key === 'period_alignment:grouped_temporal_mismatch');
  if (!flag) {
    return { hasIssue: false, affectedMetrics: [], explanation: '' };
  }

  // Note format (from buildGroupedTemporalMismatchFlag):
  // "N metric(s) mix projected and historical facts — cross-source comparison excluded
  //  from numeric conflict count: metric1, metric2, metric3. Reason(s): ..."
  const metricsMatch = flag.note.match(/conflict count:\s*([^.]+)/);
  const affectedMetrics = metricsMatch
    ? metricsMatch[1].split(',').map((m) => m.trim()).filter(Boolean)
    : [];

  // Investor-readable explanation — concise, not the raw technical note
  const n = affectedMetrics.length;
  const metricWord = n === 1 ? 'metric mixes' : 'metrics mix';
  const explanation =
    n > 0
      ? `${n} ${metricWord} projected and historical values. Cross-source comparisons were limited to comparable periods — projected vs. realized divergence is expected, not a numeric conflict.`
      : 'Some metrics mix projected and historical values. Projected vs. realized comparisons have been excluded from the numeric conflict count.';

  return { hasIssue: true, affectedMetrics, explanation };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Maps real financial report payload fields to the Financial Audit tab's
 * component-ready data model. All data comes from:
 *   - financialBreakdownV1  (FinancialBreakdownV1Like)
 *   - underwritingReadinessV1 (UnderwritingReadinessV1Like)
 *   - financialIntegrityV1  (FinancialIntegrityV1Like)
 *   - financialSnapshotStale (boolean envelope flag)
 *
 * No API calls are made here. Fails open: missing fields render as '—'.
 */
export function useFinancialAuditData(props: FinancialAuditTabProps): ProcessedAuditData {
  const {
    financialBreakdownV1,
    underwritingReadinessV1,
    financialIntegrityV1,
    financialSnapshotStale = false,
  } = props;

  return useMemo(() => {
    const bd = financialBreakdownV1 as any ?? null;
    const ur = underwritingReadinessV1 as any ?? null;
    const fi = financialIntegrityV1 as any ?? null;

    const flags: IntegrityFlag[] = fi?.flags ?? [];
    const missing_critical: string[] = fi?.missing_critical ?? [];
    const missing_supplementary: string[] = fi?.missing_supplementary ?? [];
    const completeness: number = fi?.completeness_score ?? 0;

    // ── Canonical data-state derivation ────────────────────────────────────
    // Baseline integrity: fi is null OR contains only the synthetic "no_facts" flag
    // produced by buildEmptyFinancialIntegrityV1() when no facts exist.
    const isBaselineIntegrity =
      !fi ||
      (Number(fi.completeness_score) === 0 &&
        Array.isArray(fi.flags) &&
        fi.flags.length === 1 &&
        fi.flags[0]?.flag_key === 'completeness:no_facts');

    const hasXlsx = bd?.has_xlsx === true;
    // Check both the boolean flag AND the actual sub-object, since flags may lag
    // behind actual data availability in some payload versions.
    const hasCurrentState =
      bd?.has_current_state === true ||
      (bd?.current_state != null && typeof bd.current_state === 'object');
    const hasProjections =
      bd?.has_projections === true ||
      (bd?.projections?.periods?.length ?? 0) > 0;
    const hasCapTable = bd?.cap_table != null || bd?.has_cap_table === true;

    // hasMeaningfulIntegrity: fi is present with real (non-synthetic) data.
    const hasMeaningfulIntegrity =
      !!fi &&
      !isBaselineIntegrity &&
      ((fi.flags?.length ?? 0) > 0 || (fi.completeness_score ?? 0) > 0);

    // ── Broad presence check — gates the tab on any financial signal ────────
    // Data presence is not the same as data quality. Show the tab whenever ANY
    // financial evidence exists, regardless of source.
    const hasAnyFinancialData =
      hasCurrentState ||
      hasProjections ||
      hasCapTable ||
      hasMeaningfulIntegrity ||
      (ur != null && (ur.score ?? 0) > 0);

    // ── Structural classification ───────────────────────────────────────────
    const hasStructuredFinancials = hasXlsx;
    const hasNonXlsxFinancialData = hasAnyFinancialData && !hasXlsx;

    // Presence-based (no longer XLSX-gated) — source quality is shown via labels/warnings
    const hasRealCurrentState = hasCurrentState;
    const hasRealProjections = hasProjections;

    // ── Data state ─────────────────────────────────────────────────────────
    // Precedence: stale > no_data > structured_data > limited_data
    const isNoData = !hasAnyFinancialData;
    const isStructuredData = hasXlsx && hasAnyFinancialData;

    const dataState: 'no_data' | 'limited_data' | 'stale' | 'structured_data' =
      financialSnapshotStale
        ? 'stale'
        : isNoData
        ? 'no_data'
        : isStructuredData
        ? 'structured_data'
        : 'limited_data';

    // ── Source mix (inferred from metric source_kind fields) ────────────────
    const _allSourceKinds = new Set<string>();
    if (hasXlsx) _allSourceKinds.add('xlsx');
    const _csObj = bd?.current_state ?? null;
    if (_csObj) {
      [_csObj.revenue, _csObj.burn_rate, _csObj.cash, _csObj.runway_months, _csObj.gross_margin_pct]
        .filter(Boolean)
        .forEach((m: any) => { if (m?.source_kind) _allSourceKinds.add(m.source_kind); });
    }
    (bd?.projections?.periods ?? []).forEach((p: any) => {
      if (p?.source_kind) _allSourceKinds.add(p.source_kind);
    });
    // If non-xlsx data exists but no explicit source_kind annotations, infer 'deck'
    if (hasNonXlsxFinancialData && _allSourceKinds.size === 0) _allSourceKinds.add('deck');
    const sourceMix = {
      xlsx: _allSourceKinds.has('xlsx'),
      pdf: _allSourceKinds.has('pdf'),
      deck: _allSourceKinds.has('deck'),
      pptx: _allSourceKinds.has('pptx'),
      docx: _allSourceKinds.has('docx'),
    };

    // ── View-model gates ────────────────────────────────────────────────────
    const showTabContent = dataState !== 'no_data';
    const showCoveragePanels = hasAnyFinancialData;
    const showMetrics = hasAnyFinancialData;
    const showLimitedDataWarning = dataState === 'limited_data';
    const showStructuredBadge = dataState === 'structured_data';
    const showStaleWarning = dataState === 'stale';
    // Backward-compat aliases consumed by the component
    const showSummaryMetrics = showMetrics;
    const showDetailedPanels = showCoveragePanels;

    // ── Overall status ──────────────────────────────────────────────────────
    // Block READY/PARTIAL when integrity has not run or has no facts to analyse.
    // This prevents the tab showing READY while completeness_score = 0 or has_facts = false.
    const _rawStatus: AuditStatus = mapReadinessStatus(ur?.status);
    const hasFacts = fi?.has_facts === true || (fi?.completeness_score != null && fi.completeness_score > 0);
    // Only flag integrity-incomplete when data IS present but validation hasn't run.
    // No-data case is handled separately — it should not trigger this flag.
    const isIntegrityIncomplete = hasAnyFinancialData && (isBaselineIntegrity || !hasFacts);
    const status: AuditStatus =
      !hasAnyFinancialData
        ? 'WARNING'
        : isIntegrityIncomplete && _rawStatus !== 'WARNING'
        ? 'PARTIAL'  // downgrade READY → PARTIAL when integrity hasn't run
        : _rawStatus;

    // ── Canonical visible-state model (single source of truth for all UI sections) ─
    const { discrepancyFlags, structuredConflictFlags, conflictCount, hasConflicts } =
      deriveConflictState(flags);
    const validationState = deriveValidationState(hasAnyFinancialData, isIntegrityIncomplete, flags);
    const integrityState = deriveIntegrityState(flags, isIntegrityIncomplete);
    const readinessState = deriveReadinessState(ur, validationState, integrityState, hasConflicts);
    const visibleStatusLabel = deriveVisibleStatus(
      hasAnyFinancialData,
      validationState,
      integrityState,
      readinessState,
      conflictCount,
    );
    const visibleStatusTone = deriveVisibleStatusTone(visibleStatusLabel);
    const { status: reconciliationStatus, message: reconciliationMessage } =
      deriveReconciliationState(discrepancyFlags, structuredConflictFlags, isIntegrityIncomplete);

    // isProvisional: readiness score should not be taken at face value
    const isProvisional = validationState === 'unvalidated' || integrityState === 'critical' || hasConflicts;

    // dataPresenceState: presence-only (excludes the stale envelope flag)
    const dataPresenceState =
      isNoData ? 'no_data' : isStructuredData ? 'structured_data' : 'limited_data';

    const visibleAuditState: VisibleAuditState = {
      dataPresenceState,
      validationState,
      integrityState,
      readinessState,
      visibleStatusLabel,
      visibleStatusTone,
      conflictCount,
      hasConflicts,
      reconciliationStatus,
      reconciliationMessage,
      isProvisional,
    };

    // ── Summary Metrics ─────────────────────────────────────────────────────
    // NOTE: conflictFlags below is kept as a local alias for the structured set (for
    // backward-compat path used to build conflict detail rows). The canonical COUNT
    // comes from visibleAuditState.conflictCount (discrepancyFlags.length).
    const conflictFlags = structuredConflictFlags;
    const missingCount = missing_critical.length + (ur?.missing?.length ?? 0);
    const criticalMetricsTotal = missingCount + (ur?.reasons?.length ?? 0) + 5; // denominator estimate
    const criticalPresent = Math.max(0, criticalMetricsTotal - missingCount);

    // extractedFactsCount: how many distinct financial signals exist in the payload
    // Counts: SoT row candidates + projection periods as a proxy for raw extracted facts.
    const _sotCandidates = [
      bd?.current_state?.revenue,
      bd?.current_state?.burn_rate,
      bd?.current_state?.cash,
      bd?.current_state?.runway_months,
      bd?.current_state?.gross_margin_pct,
    ].filter((m: any) => m?.value != null).length;
    const _projPeriods = (bd?.projections?.periods ?? []).length;
    const extractedFactsCount: number | null = isNoData
      ? null
      : Math.max(_sotCandidates + _projPeriods, flags.length > 0 ? flags.length : 0) || null;

    // validatedFactsCount: facts with integrity PASS status
    const validatedFactsCount: number | null = !hasAnyFinancialData || isIntegrityIncomplete
      ? null
      : flags.filter((f) => f.status === 'PASS').length || null;

    // factsAnalyzed: single number for summary bar (use extracted count, fall back to 1 when data present)
    const factsAnalyzed = extractedFactsCount ?? (hasAnyFinancialData ? 1 : 0);

    // ── Temporal Alignment Block ────────────────────────────────────────────
    // Extract the grouped temporal mismatch flag (Phase 3) into a structured block.
    // This prevents the raw flag note from appearing in criticalActions/riskFlags
    // and surfaces it as a dedicated amber panel instead.
    const temporalAlignment = extractTemporalAlignmentBlock(flags);
    // The GROUPED_TEMPORAL_FLAG key — used to exclude it from raw message rendering below.
    const TEMPORAL_GROUPED_KEY = 'period_alignment:grouped_temporal_mismatch';

    // ── Investor Action Panel ───────────────────────────────────────────────
    const criticalActions = [
      // High/critical integrity failures — exclude the grouped temporal mismatch flag
      // (it is surfaced in the dedicated temporal alignment panel, not as a raw action item)
      ...flags
        .filter(
          (f) =>
            (f.severity === 'critical' || f.severity === 'high') &&
            f.status === 'FAIL' &&
            f.flag_key !== TEMPORAL_GROUPED_KEY,
        )
        .map((f) => ({ text: f.note, severity: 'critical' as const })),
      // Missing critical underwriting metrics
      ...(ur?.missing ?? []).map((m: string) => ({
        text: `Missing: ${m}`,
        severity: 'critical' as const,
      })),
    ];

    const validationActions = [
      // Integrity-incomplete warning: data detected but validation has not run
      ...(hasAnyFinancialData && isIntegrityIncomplete
        ? [{ text: 'Financial data has been extracted, but integrity validation is incomplete. Review source-linked values carefully before relying on them in an investment decision.', severity: 'warning' as const }]
        : []),
      // Medium severity warnings
      ...flags
        .filter((f) => f.severity === 'medium' && f.status === 'WARN')
        .map((f) => ({ text: f.note, severity: 'warning' as const })),
      // Supplementary missing fields
      ...missing_supplementary.map((m: string) => ({
        text: `Supplementary gap: ${m.replace(/_/g, ' ')}`,
        severity: 'warning' as const,
      })),
    ];

    const strengths = [
      // Passing integrity checks
      ...flags
        .filter((f) => f.status === 'PASS' && (f.severity === 'low' || f.severity === 'medium'))
        .slice(0, 5)
        .map((f) => ({ text: f.note, severity: 'success' as const })),
    ];

    // Ensure all panels have at least an empty state rather than nothing
    if (criticalActions.length === 0 && validationActions.length === 0 && strengths.length === 0) {
      if (!bd && !ur && !fi) {
        criticalActions.push({ text: 'No financial data available — run analysis first', severity: 'critical' });
      }
    }

    // ── Source of Truth Table ───────────────────────────────────────────────
    const currentState = bd?.current_state ?? null;
    const burnRunway = bd?.burn_runway ?? null;

    type MetricDef = {
      label: string;
      factType: string;
      metric: FinancialMetricPointLike | null | undefined;
      // Phase 2: alternative fact for this metric (burn proxy, projected GM, etc.)
      alternativeMetric?: FinancialMetricPointLike | null;
    };
    const metricDefs: MetricDef[] = [
      { label: 'Revenue', factType: 'revenue', metric: currentState?.revenue },
      {
        label: 'Burn Rate',
        factType: 'burn_rate',
        metric: currentState?.burn_rate ?? burnRunway?.monthly_burn,
        alternativeMetric: burnRunway?.alternative_burn_fact,
      },
      { label: 'Cash', factType: 'cash', metric: currentState?.cash ?? burnRunway?.cash },
      { label: 'Runway', factType: 'runway', metric: currentState?.runway_months ?? burnRunway?.runway_months },
      {
        label: 'Gross Margin',
        factType: 'gross_margin_pct',
        metric: currentState?.gross_margin_pct,
        alternativeMetric: currentState?.alternative_gross_margin_fact,
      },
    ];

    const sotRows: SourceOfTruthRow[] = metricDefs
      .filter((d) => d.metric?.value != null)
      .map((d) => {
        const m = d.metric!;
        const conf = mapConfidence(m.confidence);
        const supportStatus = getSupportStatusFromFlags(d.factType, flags);
        const conflictFlag = flags.find(
          (f) => f.flag_key.startsWith('cross_source') && f.fact_type === d.factType,
        );
        const confidenceExplanation = conflictFlag
          ? conflictFlag.note
          : conf === 'High'
          ? `${formatSourceKind(m.source_kind ?? 'unknown')} — high confidence`
          : conf === 'Medium'
          ? `${formatSourceKind(m.source_kind ?? 'unknown')} — single or partial source`
          : 'Low confidence — deck-only or unverified';

        // Phase 2: semantic enrichment
        const isDerived = m.is_derived === true;
        const isProvisional = m.is_provisional === true;
        const sublabel = buildMetricSublabel(m);
        const alternativeFact =
          d.alternativeMetric?.value != null
            ? buildAlternativeFactDisplay(d.alternativeMetric)
            : null;

        return {
          metric: d.label,
          value: formatMetricValue(m),
          source: formatSourceKind(m.source_kind ?? ''),
          sources: supportStatus === 'Supported' ? 2 : 1,
          confidence: conf,
          confidenceExplanation,
          status: supportStatus as SupportStatus,
          sourceWeight: mapConfidenceToSourceWeight(m.confidence),
          sublabel,
          isDerived,
          isProvisional,
          alternativeFact,
        };
      });

    // ── Cross Source Reconciliation ─────────────────────────────────────────
    const conflicts = conflictFlags.map((f) => {
      const aVal = f.source_a!.value;
      const bVal = f.source_b!.value;
      const diff = percentDiff(aVal, bVal);
      const metricLabel = f.fact_type ? f.fact_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : formatFlagKey(f.flag_key);
      return {
        metric: metricLabel,
        sourceA: {
          name: formatSourceKind(f.source_a!.source_kind),
          value: aVal.toLocaleString(),
        },
        sourceB: {
          name: formatSourceKind(f.source_b!.source_kind),
          value: bVal.toLocaleString(),
        },
        difference: diff,
        impact: f.note,
        impactSeverity: mapIntegritySeverityToImpact(f.severity),
      };
    });

    // ── Time Projection Audit ───────────────────────────────────────────────
    const projectionPeriods = bd?.projections?.periods ?? [];
    const timeItems = projectionPeriods.map((p: any) => {
      const label: string = p.period_label ?? 'Unknown period';
      // Heuristic: labels containing future years or 'Proj' are projected
      const currentYear = new Date().getFullYear();
      const looksProjected =
        /proj|forecast|estimate/i.test(label) ||
        (Number(label.match(/\d{4}/)?.[0]) > currentYear);
      const hasMissingData = p.revenue == null && p.net_income == null;

      return {
        metric: 'Revenue / Net Income',
        period: label,
        type: looksProjected ? ('projected' as const) : ('historical' as const),
        clarity: hasMissingData
          ? ('Ambiguous' as const)
          : looksProjected
          ? ('Warning' as const)
          : ('Clear' as const),
        ...(looksProjected
          ? { warning: 'Projected period — verify assumptions before relying on these figures' }
          : hasMissingData
          ? { warning: 'Period label present but revenue/net income data absent' }
          : {}),
      };
    });

    // ── Financial Snapshot ──────────────────────────────────────────────────
    const snapshotDefs = [
      { label: 'Revenue', m: currentState?.revenue },
      { label: 'Burn Rate', m: currentState?.burn_rate ?? burnRunway?.monthly_burn },
      { label: 'Cash', m: currentState?.cash ?? burnRunway?.cash },
      { label: 'Runway', m: currentState?.runway_months ?? burnRunway?.runway_months },
      { label: 'Gross Margin', m: currentState?.gross_margin_pct },
    ];

    const snapshotMetrics = snapshotDefs
      .filter((d) => d.m?.value != null)
      .map((d) => {
        const m = d.m!;
        const conf = mapConfidence(m.confidence);
        const conflictFlag = flags.find(
          (f) => f.flag_key.startsWith('cross_source') && f.fact_type?.includes(d.label.toLowerCase().replace(' ', '_')),
        );

        // Phase 2: populate `change` with a semantic qualifier for provisional/derived facts.
        // The FinancialSnapshot component renders this in amber when it doesn't start with +/-.
        let change: string | undefined;
        if (m.is_derived && m.derivation_rule) {
          const desc = m.derivation_rule.split('_from_')[1]?.replace(/_/g, ' ') ?? 'workbook model';
          change = `Derived from ${desc}`;
        } else if (m.is_derived) {
          change = 'Workbook-derived estimate';
        } else if (m.is_provisional && m.source_kind === 'deck') {
          change = 'Pitch Deck — verify independently';
        } else if (m.is_projected) {
          change = `Projected estimate${m.period_label ? ` (${m.period_label})` : ''}`;
        }

        return {
          label: d.label,
          value: formatMetricValue(m),
          confidence: conf,
          confidenceReason: conflictFlag
            ? conflictFlag.note
            : conf === 'High'
            ? `${formatSourceKind(m.source_kind ?? '')} — validated`
            : conf === 'Medium'
            ? 'Single source or partial validation'
            : 'Low confidence — verify independently',
          ...(change != null ? { change } : {}),
        };
      });

    // ── Risk Flags Panel ────────────────────────────────────────────────────
    const riskFlagsFromBreakdown = (bd?.risks ?? []) as Array<{ severity: string; message: string }>;
    // Exclude the grouped temporal mismatch flag from raw risk messages — it is
    // surfaced as a dedicated amber temporal alignment panel, not a raw critical flag.
    const riskFlagsFromIntegrity = flags.filter(
      (f) => (f.status === 'FAIL' || f.status === 'WARN') && f.flag_key !== TEMPORAL_GROUPED_KEY,
    );

    const allRiskMessages = [
      ...riskFlagsFromBreakdown.map((r) => ({ severity: r.severity, message: r.message })),
      ...riskFlagsFromIntegrity.map((f) => ({ severity: f.severity, message: f.note })),
    ];

    // De-duplicate by message
    const seen = new Set<string>();
    const uniqueRisks = allRiskMessages.filter((r) => {
      if (seen.has(r.message)) return false;
      seen.add(r.message);
      return true;
    });

    const criticalRisks = uniqueRisks
      .filter((r) => r.severity === 'critical' || r.severity === 'high')
      .map((r) => ({ message: r.message }));
    const validationRisks = uniqueRisks
      .filter((r) => r.severity === 'medium')
      .map((r) => ({ message: r.message }));
    const dataQualityRisks = uniqueRisks
      .filter((r) => r.severity === 'low')
      .map((r) => ({ message: r.message }));

    // ── Underwriting Readiness ──────────────────────────────────────────────
    const readiness = {
      score: ur?.score ?? 0,
      status,
      visibleStatusLabel,
      isProvisional,
      missingMetrics: ur?.missing ?? missing_critical.map((m: string) => m.replace(/_/g, ' ')),
      weakAreas: ur?.reasons ?? [],
      summary: ur?.narrative ?? bd?.narrative ?? 'No readiness narrative available.',
    };

    // ── Formula Trace ───────────────────────────────────────────────────────
    // financial_integrity_v1 does not carry formula traces; surface XLSX availability
    const formulas = bd?.has_xlsx
      ? {
          traces: [
            {
              metric: 'XLSX Model',
              formula: 'See XLSX document for cell-level formula tracing',
              depth: 0,
              sheets: [],
              circular: false,
              confidence: 'Medium' as ConfidenceLevel,
            },
          ],
        }
      : { traces: [] };

    // ── Raw Fact Explorer ───────────────────────────────────────────────────
    // financial_breakdown_v1 does not carry raw per-cell facts; surface what we have
    const rawFactRows = snapshotDefs
      .filter((d) => d.m?.value != null)
      .map((d) => ({
        metric: d.label,
        period: d.m!.period_label ?? 'Current',
        value: formatMetricValue(d.m),
        source: formatSourceKind(d.m!.source_kind ?? ''),
        sheet: bd?.has_xlsx ? 'XLSX' : null,
        cell: '',
        confidence: mapConfidence(d.m!.confidence),
        formula: null,
      }));

    // ── Empty-state detection ───────────────────────────────────────────────
    // isReportEmpty uses structural signals (row counts) as a UI-layer hint about
    // whether meaningful panels can be rendered. dataState is the authoritative gate.
    const isReportEmpty =
      sotRows.length === 0 &&
      snapshotMetrics.length === 0 &&
      conflicts.length === 0 &&
      timeItems.length === 0;

    // ── Assemble ────────────────────────────────────────────────────────────
    return {
      status,
      dataState,
      hasAnyFinancialData,
      hasStructuredFinancials,
      hasNonXlsxFinancialData,
      hasRealCurrentState,
      hasRealProjections,
      sourceMix,
      showTabContent,
      showCoveragePanels,
      showMetrics,
      showLimitedDataWarning,
      showStructuredBadge,
      showStaleWarning,
      showSummaryMetrics,
      showDetailedPanels,
      isIntegrityIncomplete,
      extractedFactsCount,
      validatedFactsCount,
      visibleStatusLabel,
      visibleAuditState,
      isStale: financialSnapshotStale,
      isReportEmpty,
      lastUpdated: fi?.computed_at
        ? new Date(fi.computed_at).toLocaleString()
        : 'Unknown',

      actionPanel: {
        status,
        visibleStatusLabel,
        criticalActions,
        validationActions,
        strengths,
      },

      summaryMetrics: {
        completeness,
        criticalMetrics: isNoData
          ? 'No data'
          : isIntegrityIncomplete
          ? 'Validation incomplete'
          : missingCount === 0
          ? 'All present'
          : `${missingCount} missing`,
        // Use the canonical conflict count from visibleAuditState — not just structured cross_source flags.
        conflicts: conflictCount,
        factsAnalyzed,
        extractedFactsCount,
        validatedFactsCount,
      },

      sourceOfTruth: { rows: sotRows },

      conflicts: { conflicts, reconciliationStatus, reconciliationMessage },

      temporalAlignment,

      timeAudit: { items: timeItems },

      snapshot: { metrics: snapshotMetrics },

      riskFlags: {
        critical: criticalRisks,
        validation: validationRisks,
        dataQuality: dataQualityRisks,
      },

      readiness,

      formulas,

      rawFacts: { facts: rawFactRows },
    };
  }, [financialBreakdownV1, underwritingReadinessV1, financialIntegrityV1, financialSnapshotStale]);
}
