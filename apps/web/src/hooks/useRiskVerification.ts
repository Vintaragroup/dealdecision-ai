/**
 * useRiskVerification
 *
 * AI Analysis Tab–exclusive hook.  Reads deterministic risk/verification
 * sections from an already-fetched InvestorInsightsReport, computes a
 * Risk Score (0–100, higher = more risk), builds deterministic key risks
 * and coverage tiles, then calls the lightweight
 * POST /api/v1/deals/:id/analysis/risk-verification endpoint for the
 * AI Governed narrative panel.
 *
 * SCOPE: used by RiskVerificationSection.  Must NOT be imported by
 * InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiPostRiskVerification,
  type RiskVerificationNarrativeResult,
  type RiskVerificationPayload,
  type InvestorInsightsReport,
  type InvestorInsightsSection,
} from '../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Section key constants
// ─────────────────────────────────────────────────────────────────────────────

const GATE_STATE_KEY          = 'gate_state';
const CONFLICTS_KEY           = 'conflicts';
const COVERAGE_KEY            = 'coverage_snapshot';
const CANONICAL_FIELDS_KEY    = 'canonical_fields';
const RECONCILIATION_KEY      = 'financial_reconciliation_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export type GateItem = {
  gate: string;
  passed: boolean;
  reason_code: string | null;
  actual: unknown;
  threshold: unknown;
};

export type ConflictEntry = {
  field: string;
  value_a: string;
  value_b: string;
  evidence_a: string | null;
  evidence_b: string | null;
  source_a: string | null;
  source_b: string | null;
  reason: string | null;
};

export type CoverageData = {
  docs_count: number | null;
  dpu_page_count: number | null;
  dpu_nonempty_pages: number | null;
  evidence_count: number | null;
  visuals_count: number | null;
  structured_json_available: boolean;
  overlay_available: boolean;
  text_coverage_pct: number | null;   // derived: nonempty/page_count
};

export type ReconciliationFlag = {
  key: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  reason: string;
};

export type ReconciliationData = {
  confidence_score: number;
  flags: ReconciliationFlag[];
};

export type CanonicalField = {
  category: string;
  field: string;
  computability: string;
  value: string | null;
  reason: string | null;
  /** Evidence confidence level from PR36.6 — e.g. "STRONG_EVIDENCE" | "WEAK_EVIDENCE" */
  confidence?: string;
};

export type RiskCategory =
  | 'Disclosure'
  | 'Consistency'
  | 'Coverage'
  | 'Financial Plausibility'
  | 'Verification';

export type KeyRisk = {
  category: RiskCategory;
  text: string;
};

export type RiskSections = {
  gates: GateItem[];
  conflicts: ConflictEntry[];
  coverage: CoverageData | null;
  reconciliation: ReconciliationData | null;
  canonicalFields: CanonicalField[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Critical canonical fields for risk scoring
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_CANONICAL_FIELDS = new Set([
  'raise_amount',
  'raise_instrument',
  'raise_cap',
  'raise_discount',
  'valuation_post',
  'valuation_cap',
  'use_of_funds_buckets',
  'tam',
  'sam',
  'som',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Parsers (pure, exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export function parseGateItems(section: InvestorInsightsSection | null): GateItem[] {
  if (!section) return [];
  const items = (section.items ?? []) as Array<Record<string, unknown>>;
  return items.map((it) => ({
    gate:        String(it['gate'] ?? ''),
    passed:      Boolean(it['passed']),
    reason_code: it['reason_code'] != null ? String(it['reason_code']) : null,
    actual:      it['actual'] ?? null,
    threshold:   it['threshold'] ?? null,
  }));
}

/**
 * Parse conflicts body.
 * Format: `field=X | value_a="Y" | evidence_a=Z | source_a=W | value_b="V" | evidence_b=U | source_b=T | reason=S`
 */
export function parseConflicts(section: InvestorInsightsSection | null): ConflictEntry[] {
  if (!section) return [];
  const body = typeof section.body === 'string' ? section.body : '';
  const entries: ConflictEntry[] = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split by the pipe-separated key=value pattern
    const segMap: Record<string, string> = {};
    for (const seg of line.split(' | ')) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx === -1) continue;
      const k = seg.slice(0, eqIdx).trim();
      const v = seg.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      segMap[k] = v;
    }

    const field = segMap['field'];
    if (!field) continue;

    entries.push({
      field,
      value_a:    segMap['value_a']    ?? '—',
      value_b:    segMap['value_b']    ?? '—',
      evidence_a: segMap['evidence_a'] ?? null,
      evidence_b: segMap['evidence_b'] ?? null,
      source_a:   segMap['source_a']   ?? null,
      source_b:   segMap['source_b']   ?? null,
      reason:     segMap['reason']     ?? null,
    });
  }

  return entries;
}

/**
 * Parse coverage_snapshot body.
 * Format: `key: value` lines.
 */
export function parseCoverage(section: InvestorInsightsSection | null): CoverageData | null {
  if (!section) return null;
  const body = typeof section.body === 'string' ? section.body : '';
  if (!body.trim()) return null;

  const kv: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) kv[k] = v;
  }

  const parseIntOrNull = (v: string | undefined) => {
    if (!v || v === 'none') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  const pageCount  = parseIntOrNull(kv['dpu_page_count']);
  const nonempty   = parseIntOrNull(kv['dpu_nonempty_pages']);
  const textCovPct = (pageCount && nonempty && pageCount > 0)
    ? Math.round((nonempty / pageCount) * 100)
    : null;

  return {
    docs_count:               parseIntOrNull(kv['docs_count']),
    dpu_page_count:           pageCount,
    dpu_nonempty_pages:       nonempty,
    evidence_count:           parseIntOrNull(kv['evidence_count']),
    visuals_count:            parseIntOrNull(kv['visuals_count']),
    structured_json_available: kv['structured_json_available'] === 'true',
    overlay_available:        kv['overlay_available'] === 'true',
    text_coverage_pct:        textCovPct,
  };
}

/**
 * Parse financial_reconciliation_v1 body.
 * Format: `confidence_score: 0.XX` + flag lines `✓/⚠/✗/- key: STATUS — reason`
 */
export function parseReconciliation(section: InvestorInsightsSection | null): ReconciliationData | null {
  if (!section) return null;
  const body = typeof section.body === 'string' ? section.body : '';
  if (!body.trim()) return null;

  let confidence = 0;
  const flags: ReconciliationFlag[] = [];

  const flagRe = /^[✓⚠✗\-]\s+(\w[\w._-]*):\s+(PASS|WARN|FAIL|SKIP)\s+—\s+(.+)$/;

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('confidence_score:')) {
      const n = parseFloat(trimmed.split(':')[1]?.trim() ?? '0');
      if (Number.isFinite(n)) confidence = n;
    } else {
      const m = flagRe.exec(trimmed);
      if (m) {
        flags.push({
          key:    m[1]!,
          status: m[2] as ReconciliationFlag['status'],
          reason: m[3]!.trim(),
        });
      }
    }
  }

  return { confidence_score: confidence, flags };
}

/**
 * Parse canonical_fields body.
 * Format: `category=X | field=Y | computability=Z | value="V" | evidence=E | reason=R`
 */
export function parseCanonicalFields(section: InvestorInsightsSection | null): CanonicalField[] {
  if (!section) return [];
  const body = typeof section.body === 'string' ? section.body : '';
  const fields: CanonicalField[] = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const segMap: Record<string, string> = {};
    for (const seg of line.split(' | ')) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx === -1) continue;
      const k = seg.slice(0, eqIdx).trim();
      const v = seg.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      segMap[k] = v;
    }

    const field = segMap['field'];
    if (!field) continue;

    fields.push({
      category:     segMap['category']     ?? '',
      field,
      computability: segMap['computability'] ?? '',
      value:        segMap['value']         || null,
      reason:       segMap['reason']        || null,
      confidence:   segMap['confidence']    || undefined,
    });
  }

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section extractor
// ─────────────────────────────────────────────────────────────────────────────

export function extractRiskSections(report: InvestorInsightsReport | null): RiskSections {
  const sections = report?.render_package?.sections ?? [];
  const gateResults = report?.render_package?.gate_state?.results ?? null;

  const find = (key: string) => sections.find((s) => s.key === key) ?? null;

  // Merge real gate results into the section items if available.
  // If no gate_state section exists in sections[] but gateResults are present
  // in render_package.gate_state.results, synthesise a minimal section so that
  // parseGateItems (which reads section.items) can still produce gate rows.
  const gateSection = find(GATE_STATE_KEY);
  const patchedGateSection = gateResults
    ? {
        ...(gateSection ?? { key: GATE_STATE_KEY, title: 'Gate State', kind: 'message' as const, body: '' }),
        items: gateResults,
      }
    : gateSection;

  return {
    gates:          parseGateItems(patchedGateSection),
    conflicts:      parseConflicts(find(CONFLICTS_KEY)),
    coverage:       parseCoverage(find(COVERAGE_KEY)),
    reconciliation: parseReconciliation(find(RECONCILIATION_KEY)),
    canonicalFields: parseCanonicalFields(find(CANONICAL_FIELDS_KEY)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk score (deterministic, no LLM)
// ─────────────────────────────────────────────────────────────────────────────

export function computeRiskScore(
  sections: RiskSections,
): { score: number; label: string; confidenceLabel: 'High' | 'Medium' | 'Low' } {
  let risk = 50;

  // +10 if any gate FAIL
  const anyGateFailed = sections.gates.some((g) => !g.passed);
  if (anyGateFailed) risk += 10;

  // + (count of NotComputable critical fields * 3), cap +30
  const criticalNotComputable = sections.canonicalFields.filter(
    (f) =>
      CRITICAL_CANONICAL_FIELDS.has(f.field) &&
      f.computability !== 'Computable',
  ).length;
  risk += Math.min(criticalNotComputable * 3, 30);

  // +5 per CONFLICTING critical field — PR36.7 (cap +15)
  const criticalConflicting = sections.canonicalFields.filter(
    (f) => CRITICAL_CANONICAL_FIELDS.has(f.field) && f.confidence === 'CONFLICTING',
  ).length;
  risk += Math.min(criticalConflicting * 5, 15);

  // + round((1 - confidence_score) * 20) if reconciliation present
  const recon = sections.reconciliation;
  if (recon !== null) {
    risk += Math.round((1 - recon.confidence_score) * 20);
  }

  // +10 if low text coverage (nonempty < 60% of pages)
  const cov = sections.coverage;
  if (cov !== null) {
    const isLowCoverage =
      cov.text_coverage_pct !== null
        ? cov.text_coverage_pct < 60
        : cov.dpu_nonempty_pages !== null &&
          cov.dpu_page_count !== null &&
          cov.dpu_page_count > 0 &&
          cov.dpu_nonempty_pages / cov.dpu_page_count < 0.6;
    if (isLowCoverage) risk += 10;
  }

  // +10 if conflicts present and non-empty
  if (sections.conflicts.length > 0) risk += 10;

  const score = Math.max(0, Math.min(100, risk));

  const label =
    score >= 75
      ? 'High verification risk — key disclosures missing or inconsistent'
      : score >= 50
      ? 'Moderate risk — proceed with targeted diligence'
      : 'Lower risk — disclosures relatively complete';

  // Confidence label based on coverage + reconciliation
  const confScore = recon?.confidence_score ?? null;
  const textCovPct = cov?.text_coverage_pct ?? null;
  const confidenceLabel: 'High' | 'Medium' | 'Low' =
    confScore !== null && confScore >= 0.7 && (textCovPct === null || textCovPct >= 70)
      ? 'High'
      : confScore !== null && confScore >= 0.5
      ? 'Medium'
      : 'Low';

  return { score, label, confidenceLabel };
}

// ─────────────────────────────────────────────────────────────────────────────
// Key risks builder (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

export function buildKeyRisks(sections: RiskSections): KeyRisk[] {
  const risks: KeyRisk[] = [];

  // Gate failures
  for (const g of sections.gates.filter((g) => !g.passed)) {
    const reason = g.reason_code ?? g.gate;
    risks.push({
      category: 'Verification',
      text: `Readiness gate ${g.gate} failed: ${reason}`,
    });
  }

  // Critical canonical fields NotComputable
  const missingCritical = sections.canonicalFields.filter(
    (f) => CRITICAL_CANONICAL_FIELDS.has(f.field) && f.computability !== 'Computable',
  );
  for (const f of missingCritical) {
    const label = f.field.replaceAll('_', ' ');
    risks.push({
      category: 'Disclosure',
      text: `"${label}" not disclosed${f.reason ? ` — ${f.reason}` : ''}`,
    });
  }

  // CONFLICTING critical canonical fields — PR36.7
  const conflictingCritical = sections.canonicalFields.filter(
    (f) => CRITICAL_CANONICAL_FIELDS.has(f.field) && f.confidence === 'CONFLICTING',
  );
  for (const f of conflictingCritical) {
    const label = f.field.replaceAll('_', ' ');
    risks.push({
      category: 'Consistency',
      text: `"${label}" shows conflicting signals from multiple sources — verify before relying on this value`,
    });
  }

  // Reconciliation WARN/FAIL flags
  const recon = sections.reconciliation;
  if (recon) {
    for (const flag of recon.flags.filter((f) => f.status === 'WARN' || f.status === 'FAIL')) {
      risks.push({
        category: 'Financial Plausibility',
        text: flag.reason || `${flag.key}: ${flag.status}`,
      });
    }
  }

  // Low coverage
  const cov = sections.coverage;
  if (cov !== null) {
    const isLow =
      cov.text_coverage_pct !== null
        ? cov.text_coverage_pct < 60
        : cov.dpu_nonempty_pages !== null &&
          cov.dpu_page_count !== null &&
          cov.dpu_page_count > 0 &&
          cov.dpu_nonempty_pages / cov.dpu_page_count < 0.6;
    if (isLow) {
      const pct =
        cov.text_coverage_pct !== null
          ? `${cov.text_coverage_pct}%`
          : cov.dpu_nonempty_pages !== null && cov.dpu_page_count
          ? `${Math.round((cov.dpu_nonempty_pages / cov.dpu_page_count) * 100)}%`
          : 'low';
      risks.push({
        category: 'Coverage',
        text: `Low text coverage (${pct}) — key terms may be hidden in unscannable pages`,
      });
    }
  }

  // Conflicts
  if (sections.conflicts.length > 0) {
    risks.push({
      category: 'Consistency',
      text: `${sections.conflicts.length} data conflict${sections.conflicts.length > 1 ? 's' : ''} detected — verify which source is authoritative`,
    });
  }

  // Limit to 6
  return risks.slice(0, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────────────────────────────────────

function buildPayload(
  sections: RiskSections,
  dealName: string | undefined,
): RiskVerificationPayload {
  const missingCritical = sections.canonicalFields
    .filter((f) => CRITICAL_CANONICAL_FIELDS.has(f.field) && f.computability !== 'Computable')
    .map((f) => f.field);

  const cov = sections.coverage;

  return {
    deal_name: dealName,
    gates: sections.gates.map((g) => ({
      id:     g.gate,
      status: g.passed ? 'pass' : 'fail' as 'pass' | 'fail' | 'not_run',
      reason: g.reason_code ?? undefined,
    })),
    missing_critical_terms: missingCritical.length > 0 ? missingCritical : undefined,
    conflicts: sections.conflicts.length > 0
      ? sections.conflicts.map((c) => ({
          field:   c.field,
          value_a: c.value_a,
          value_b: c.value_b,
        }))
      : undefined,
    coverage: cov
      ? {
          docs_count:       cov.docs_count    ?? undefined,
          dpu_pages:        cov.dpu_page_count ?? undefined,
          nonempty_pages:   cov.dpu_nonempty_pages ?? undefined,
          evidence_count:   cov.evidence_count ?? undefined,
          text_coverage_pct: cov.text_coverage_pct ?? undefined,
        }
      : undefined,
    reconciliation: sections.reconciliation
      ? {
          confidence_score: sections.reconciliation.confidence_score,
          flags: sections.reconciliation.flags.map((f) => ({
            name:   f.key,
            status: f.status,
            reason: f.reason,
          })),
        }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useRiskVerification hook
// ─────────────────────────────────────────────────────────────────────────────

type NarrativeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'no_data';

interface UseRiskVerificationReturn {
  hasData: boolean;
  sections: RiskSections;
  riskScore: number;
  riskLabel: string;
  confidenceLabel: 'High' | 'Medium' | 'Low';
  keyRisks: KeyRisk[];
  narrativeStatus: NarrativeStatus;
  narrative: RiskVerificationNarrativeResult | null;
  narrativeError: string | null;
  refreshNarrative: () => void;
}

export function useRiskVerification(
  dealId: string | undefined,
  report: InvestorInsightsReport | null,
  dealName?: string,
): UseRiskVerificationReturn {
  const sections = extractRiskSections(report);

  // hasData: we have at least some gate state or coverage data
  const hasData =
    sections.gates.length > 0 ||
    sections.coverage !== null ||
    sections.canonicalFields.length > 0 ||
    sections.conflicts.length > 0 ||
    sections.reconciliation !== null;

  const { score, label, confidenceLabel } = computeRiskScore(sections);
  const keyRisks = buildKeyRisks(sections);

  // Narrative state
  const [narrativeStatus, setNarrativeStatus] = useState<NarrativeStatus>(
    dealId && hasData ? 'loading' : 'no_data',
  );
  const [narrative, setNarrative] = useState<RiskVerificationNarrativeResult | null>(null);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  // Stale-closure guards
  const mountedRef   = useRef(true);
  const dealIdRef    = useRef(dealId);
  const fpRef        = useRef('');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    dealIdRef.current = dealId;
  }, [dealId]);

  const runNarrative = useCallback(async () => {
    if (!dealIdRef.current || !hasData) {
      setNarrativeStatus('no_data');
      return;
    }

    const payload = buildPayload(sections, dealName);
    const fp = JSON.stringify(payload).slice(0, 200);
    if (fp === fpRef.current && narrativeStatus === 'ready') return;
    fpRef.current = fp;

    setNarrativeStatus('loading');
    setNarrativeError(null);

    try {
      const result = await apiPostRiskVerification(dealIdRef.current, payload);
      if (!mountedRef.current) return;
      setNarrative(result);
      setNarrativeStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Narrative synthesis failed';
      setNarrativeError(msg);
      setNarrativeStatus('error');
    }
  }, [dealId, hasData, sections, dealName]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshNarrative = useCallback(() => {
    fpRef.current = '';
    runNarrative();
  }, [runNarrative]);

  // Auto-trigger when dealId + hasData are available
  useEffect(() => {
    if (dealId && hasData) {
      runNarrative();
    } else if (!hasData) {
      setNarrativeStatus('no_data');
    }
  }, [dealId, hasData]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    hasData,
    sections,
    riskScore:      score,
    riskLabel:      label,
    confidenceLabel,
    keyRisks,
    narrativeStatus,
    narrative,
    narrativeError,
    refreshNarrative,
  };
}
