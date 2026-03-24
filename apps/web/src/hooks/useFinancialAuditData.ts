import { useMemo } from 'react';
import {
  ProcessedAuditData,
  FinancialAuditTabProps,
  AuditStatus,
  ConfidenceLevel,
  SupportStatus,
  ImpactSeverity,
  SourceOfTruthRow,
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
    const underwritingInsufficient = !ur || ur.status === 'insufficient';

    // ── Structured vs deck-only finance ────────────────────────────────────
    // Only XLSX-backed data is underwriting-grade. Deck-extracted current_state /
    // projections are NOT sufficient to unlock the full audit surface.
    const hasStructuredFinancials = hasXlsx;
    const hasRealCurrentState = hasStructuredFinancials && hasCurrentState;
    const hasRealProjections = hasStructuredFinancials && hasProjections;

    // hasMeaningfulIntegrity: fi is present with real flags or a non-zero completeness score.
    // Replaces the old isBaselineIntegrity inversion — read positively for clarity.
    const hasMeaningfulIntegrity =
      !!fi &&
      ((fi.flags?.length ?? 0) > 0 || typeof fi.completeness_score === 'number');

    // deck_only: financial objects present but none are spreadsheet-backed
    const hasDeckOnlyFinancialSignals = !hasStructuredFinancials && (hasCurrentState || hasProjections);

    // valid: XLSX backed + at least one real signal (current state, projections, or meaningful integrity)
    const isValid =
      hasStructuredFinancials &&
      (hasRealCurrentState || hasRealProjections || hasMeaningfulIntegrity) &&
      !financialSnapshotStale;

    const isDeckOnly = !hasStructuredFinancials && hasDeckOnlyFinancialSignals;

    // no_data: nothing useful present at all
    const isNoData =
      !hasStructuredFinancials &&
      !hasCurrentState &&
      !hasProjections &&
      !hasMeaningfulIntegrity;

    // Precedence: stale > valid > deck_only > no_data
    const dataState: 'no_data' | 'deck_only' | 'stale' | 'valid' =
      financialSnapshotStale
        ? 'stale'
        : isValid
        ? 'valid'
        : isDeckOnly
        ? 'deck_only'
        : 'no_data';

    // View-model gates — only valid state unlocks the full audit surface
    const showSummaryMetrics = dataState === 'valid';
    const showDetailedPanels = dataState === 'valid';

    // Temporary debug log — remove after confirming classification is correct
    console.log('[FinancialAudit] state', {
      hasStructuredFinancials,
      hasCurrentState,
      hasProjections,
      hasMeaningfulIntegrity,
      financialSnapshotStale,
      dataState,
    });

    // ── Overall status ──────────────────────────────────────────────────────
    const status: AuditStatus = mapReadinessStatus(ur?.status);

    // ── Summary Metrics ─────────────────────────────────────────────────────
    const conflictFlags = flags.filter(
      (f) => f.flag_key.startsWith('cross_source') && f.source_a && f.source_b,
    );
    const missingCount = missing_critical.length + (ur?.missing?.length ?? 0);
    const criticalMetricsTotal = missingCount + (ur?.reasons?.length ?? 0) + 5; // denominator estimate
    const criticalPresent = Math.max(0, criticalMetricsTotal - missingCount);
    // factsAnalyzed: zero for no_data and deck_only — non-XLSX signals are not auditable facts
    const factsAnalyzed = (isBaselineIntegrity || isDeckOnly) ? 0 : (flags.length > 0 ? flags.length : (bd ? 1 : 0));

    // ── Investor Action Panel ───────────────────────────────────────────────
    const criticalActions = [
      // High/critical integrity failures
      ...flags
        .filter((f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'FAIL')
        .map((f) => ({ text: f.note, severity: 'critical' as const })),
      // Missing critical underwriting metrics
      ...(ur?.missing ?? []).map((m: string) => ({
        text: `Missing: ${m}`,
        severity: 'critical' as const,
      })),
    ];

    const validationActions = [
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

    type MetricDef = { label: string; factType: string; metric: FinancialMetricPointLike | null | undefined };
    const metricDefs: MetricDef[] = [
      { label: 'Revenue', factType: 'revenue', metric: currentState?.revenue },
      { label: 'Burn Rate', factType: 'burn_rate', metric: currentState?.burn_rate ?? burnRunway?.monthly_burn },
      { label: 'Cash', factType: 'cash', metric: currentState?.cash ?? burnRunway?.cash },
      { label: 'Runway', factType: 'runway', metric: currentState?.runway_months ?? burnRunway?.runway_months },
      { label: 'Gross Margin', factType: 'gross_margin_pct', metric: currentState?.gross_margin_pct },
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

        return {
          metric: d.label,
          value: formatMetricValue(m),
          source: formatSourceKind(m.source_kind ?? ''),
          sources: supportStatus === 'Supported' ? 2 : 1,
          confidence: conf,
          confidenceExplanation,
          status: supportStatus as SupportStatus,
          sourceWeight: mapConfidenceToSourceWeight(m.confidence),
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
        };
      });

    // ── Risk Flags Panel ────────────────────────────────────────────────────
    const riskFlagsFromBreakdown = (bd?.risks ?? []) as Array<{ severity: string; message: string }>;
    const riskFlagsFromIntegrity = flags.filter((f) => f.status === 'FAIL' || f.status === 'WARN');

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
      hasStructuredFinancials,
      hasRealCurrentState,
      hasRealProjections,
      showSummaryMetrics,
      showDetailedPanels,
      isStale: financialSnapshotStale,
      isReportEmpty,
      lastUpdated: fi?.computed_at
        ? new Date(fi.computed_at).toLocaleString()
        : 'Unknown',

      actionPanel: {
        status,
        criticalActions,
        validationActions,
        strengths,
      },

      summaryMetrics: {
        completeness,
        criticalMetrics: isNoData
          ? 'No data'
          : isDeckOnly
          ? 'Deck only'
          : missingCount === 0
          ? 'All present'
          : `${missingCount} missing`,
        conflicts: conflictFlags.length,
        factsAnalyzed,
      },

      sourceOfTruth: { rows: sotRows },

      conflicts: { conflicts },

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
