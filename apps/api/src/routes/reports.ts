/**
 * Report Routes
 *
 * Endpoints for generating and retrieving deal analysis reports.
 *
 * Important contract:
 * - /api/v1/deals/:deal_id/report must NOT 404 in normal pre-analysis / in-progress states.
 * - Readiness is determined from persisted Postgres artifacts (deal_intelligence_objects).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { compileDIOToReport, compileDIOToReportWithPromotedFacts } from '@dealdecision/core';
import { buildDeterministicScoreInputsV1 } from '@dealdecision/core';
import { computeDecisionV1, computeHardPassGuardrailV2, getScoreBandV2 } from '@dealdecision/core';
import { loadPromotedFactsForDeal } from '../lib/promoted-facts';
import { derivePromotedFactsFromDpuForDeal } from '../lib/promoted-facts-from-dpu';
import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import { getSegmentedNodesForDeal } from '../lib/segmented-nodes-for-deal';
import { inferDeckArchetypeV1 } from '../lib/deck-archetypes';
import { compileStructuredSummaryExtras } from '../lib/structured-summary-extras';
import { buildBusinessModelSummaryV1 } from '../lib/reports/business-model-summary';
import { computeArchetypeSegmentDriftV1 } from '../lib/archetype-segment-drift-v1';
import { computeOverrideQualityV1 } from '../lib/override-quality-v1';
import { computeDeterministicModifierV1, computeDeterministicScorePreviewV1Diagnostics, shouldPinUnadjusted } from '../lib/deterministic-score-preview-v1';

const isUuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

const envFlagEnabled = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const asFiniteNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

type ReportRecommendationV0 = 'strong_yes' | 'yes' | 'consider' | 'pass';
type ReportGradeV0 = 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'Insufficient Information';

function mapDecisionV1ToReportRecommendation(decisionKey: unknown): ReportRecommendationV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'pass';
    case 'consider':
      return 'consider';
    case 'strong_consider':
      return 'consider';
    case 'fund_caution':
      return 'yes';
    case 'fund_track':
      return 'yes';
    case 'fund_confident':
      return 'strong_yes';
    default:
      return null;
  }
}

function mapDecisionV1ToReportGrade(decisionKey: unknown): ReportGradeV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'Needs Improvement';
    case 'consider':
      return 'Fair';
    case 'strong_consider':
      return 'Good';
    case 'fund_caution':
      return 'Good';
    case 'fund_track':
      return 'Excellent';
    case 'fund_confident':
      return 'Excellent';
    default:
      return null;
  }
}

function alignReportFieldsToDecisionV1(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : null;
    const report = args.report && typeof args.report === 'object' ? args.report : null;
    if (!meta || !report) return;

    if (meta.decision_v1_report_alignment_v1 === true) return;

    const decision = meta.decision_v1 && typeof meta.decision_v1 === 'object' ? meta.decision_v1 : null;
    const decisionKey = (decision as any)?.recommendation_key;

    const mappedRec = mapDecisionV1ToReportRecommendation(decisionKey);
    const mappedGrade = mapDecisionV1ToReportGrade(decisionKey);
    if (!mappedRec && !mappedGrade) return;

    const existingRecommendation = typeof report.recommendation === 'string' ? (report.recommendation as string) : null;
    const existingGrade = typeof report.grade === 'string' ? (report.grade as string) : null;

    if (meta.legacy_recommendation_v0 == null && existingRecommendation) meta.legacy_recommendation_v0 = existingRecommendation;
    if (meta.legacy_grade_v0 == null && existingGrade) meta.legacy_grade_v0 = existingGrade;

    if (mappedRec) report.recommendation = mappedRec;
    if (mappedGrade) report.grade = mappedGrade;

    meta.decision_v1_report_alignment_v1 = true;
  } catch {
    // ignore
  }
}

function attachScoreBandAndGuardrailV2(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
    const scoreExp = args.report?.metadata?.score_explanation ?? null;
    const totals = scoreExp && scoreExp.totals ? scoreExp.totals : null;

    const overall = asFiniteNumber(totals?.overall_score) ?? asFiniteNumber(args.report?.overallScore);
    if (overall == null) return;

    const band = getScoreBandV2(overall);
    meta.score_band_v2 = {
      key: band.key,
      label: band.label,
      overall_score: overall,
      thresholds_version: 'v2',
    };

    const coverageRatio = asFiniteNumber(totals?.coverage_ratio);
    const unadjusted = asFiniteNumber(totals?.unadjusted_overall_score);

    const inputs = meta?.deterministic_score_inputs_v1 ?? null;
    const kpisRaw: any[] = Array.isArray(inputs?.kpis) ? inputs.kpis : [];
    const kpis = kpisRaw
      .map((k) => ({
        key: typeof k?.key === 'string' ? k.key : 'unknown',
        confidence: asFiniteNumber(k?.confidence) ?? 0,
        value_raw: (typeof k?.value_raw === 'string' ? k.value_raw : null),
      }))
      .filter((k) => typeof k.key === 'string');

    const driftAssessment = (() => {
      const drift = meta?.archetype_segment_drift_v1?.overall_assessment;
      const a = typeof drift === 'string' && drift.trim() ? drift.trim() : null;
      if (a) return a;
      const fromInputs = inputs?.deck?.drift_assessment;
      return (typeof fromInputs === 'string' && fromInputs.trim()) ? fromInputs.trim() : 'unknown';
    })();

    const guardrail = computeHardPassGuardrailV2({
      overall_score: overall,
      coverage_ratio: coverageRatio,
      unadjusted_overall_score: unadjusted,
      kpis,
      drift_assessment: driftAssessment,
    });

    meta.hard_pass_guardrail_v2 = {
      triggered: guardrail.triggered,
      reason: guardrail.reason,
      note: guardrail.note,
      criteria_snapshot: guardrail.criteria_snapshot,
    };

    // Derived decision_v1: stable UI contract.
    try {
      const preview = meta?.deterministic_score_preview_v1 ?? null;
      const blockedByDrift = Boolean(preview?.gate?.blocked_by_drift_misaligned);
      const blockedByPinned = Boolean(preview?.gate?.blocked_by_unadjusted_pinned);

      const overrideQuality = meta?.override_quality ?? null;
      const overrideAssessment = typeof overrideQuality?.assessment === 'string' ? String(overrideQuality.assessment) : null;
      const overrideRatio = asFiniteNumber(overrideQuality?.override_ratio);

      const unadjustedPinned = Boolean((totals as any)?.unadjusted_pinned === true);
      const unadjustedReason = (totals && typeof (totals as any).unadjusted_reason === 'string' && String((totals as any).unadjusted_reason).trim())
        ? String((totals as any).unadjusted_reason).trim()
        : null;

      meta.decision_v1 = computeDecisionV1({
        score_band_key: band.key,
        score_band_label: band.label,
        hard_pass_guardrail_triggered: guardrail.triggered,
        hard_pass_guardrail_reason: guardrail.reason,
        hard_pass_guardrail_note: guardrail.note,
        drift_assessment: driftAssessment,
        override_quality_assessment: overrideAssessment,
        override_ratio: overrideRatio,
        unadjusted_pinned: unadjustedPinned,
        unadjusted_reason: unadjustedReason,
        coverage_ratio: coverageRatio,
        blocked_by_drift_misaligned: blockedByDrift,
        blocked_by_unadjusted_pinned: blockedByPinned,
      });
    } catch {
      // ignore
    }

    // Prompt 15: decision_v1 is the single source of truth for recommendation/grade.
    // Preserve legacy values in metadata and ensure idempotency.
    alignReportFieldsToDecisionV1({ nextMetadata: meta, report: args.report });

    args.nextMetadata = meta;
  } catch {
    // Best-effort: never fail /report for metadata enrichment.
  }
}

interface ReportParams {
  deal_id: string;
}

export async function registerReportRoutes(
  app: FastifyInstance,
  pool: Pool
) {
  
  /**
   * GET /api/v1/deals/:deal_id/report
   * Get compiled report from latest DIO
   * 
   * Returns ReportDTO with structured sections, scores, and evidence
   */
  app.get<{ Params: ReportParams }>(
    "/api/v1/deals/:deal_id/report",
    async (request: FastifyRequest<{ Params: ReportParams }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id } = request.params;
        request.log.info({ msg: "deal.report.start", deal_id, start_ts: new Date(startTs).toISOString() });

        if (!isUuid(deal_id)) {
          return reply.status(400).send({ error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
        }

        // 404 only when the deal itself does not exist.
        const { rows: dealRows } = await pool.query<{ id: string }>(
          `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [deal_id]
        );
        if (dealRows.length === 0) {
          return reply.status(404).send({ error: 'Deal not found' });
        }

        // Canonical persisted analysis artifact: the latest Deal Intelligence Object (DIO).
        // Do NOT infer readiness from job messages.
        const { rows: dioRows } = await pool.query<{
          dio_id: string;
          analysis_version: number | null;
          recommendation: string | null;
          overall_score: number | null;
          dio_data: any;
          updated_at: string | null;
        }>(
          `SELECT dio_id, analysis_version, recommendation, overall_score, dio_data, updated_at
             FROM deal_intelligence_objects
            WHERE deal_id = $1
            ORDER BY analysis_version DESC,
                     updated_at DESC NULLS LAST,
                     dio_id DESC
            LIMIT 1`,
          [deal_id]
        );

        if (dioRows.length === 0) {
          return reply.status(200).send({ ready: false, reason: 'not_generated_yet' });
        }

        const row = dioRows[0];
        const version = typeof row.analysis_version === 'number' && Number.isFinite(row.analysis_version)
          ? row.analysis_version
          : undefined;

        const artifact = {
          kind: 'deal_intelligence_object',
          dio_id: row.dio_id,
          analysis_version: row.analysis_version,
          updated_at: row.updated_at,
          recommendation: row.recommendation,
          overall_score: row.overall_score,
        };

        // Deterministic deal summary (no LLM): derived from segmented DPU nodes.
        // Best-effort: never fail the whole /report response if this compilation fails.
        let dealSummaryV1: any = null;
        let segmentedNodes: { nodes: any[]; warnings: string[] } | null = null;
        try {
          segmentedNodes = await getSegmentedNodesForDeal(pool as any, deal_id);
        } catch (err) {
          request.log.warn({ event: 'deal.report.segmented_nodes_failed', deal_id, dio_id: row.dio_id, err }, 'segmented nodes lookup failed');
          segmentedNodes = null;
        }
        try {
          dealSummaryV1 = await compileDealSummaryV1(pool as any, deal_id, { prefetched: segmentedNodes ?? undefined } as any);
        } catch (err) {
          request.log.warn({ event: 'deal.report.deal_summary_v1_failed', deal_id, dio_id: row.dio_id, err }, 'deal_summary_v1 compilation failed');
          dealSummaryV1 = {
            version: 'deal_summary_v1',
            ready: false,
            reason: 'compile_failed',
            one_liner: null,
            product: null,
            market: null,
            paragraphs: [],
            warnings: [],
          };
        }

        // Backward compatibility: include the compiled report payload so existing clients
        // can continue to render without needing to understand the readiness envelope.
        let report: any = null;
        let promotedFacts: any[] = [];
        try {
          promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);

      // Deterministic fallback: if evidence_items did not get populated yet, derive
      // promoted-like facts directly from document_page_understanding payloads.
      // This keeps /report structured_summary accurate with page-level citations.
      const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
      const hasRaise = promotedFacts.some((r: any) => factTypeOf(r) === 'raise_terms_v1');
      const hasModel = promotedFacts.some((r: any) => factTypeOf(r) === 'business_model_v1');
      const hasKpi = promotedFacts.some((r: any) => {
        const ft = factTypeOf(r);
        return ft === 'revenue_v1' || ft === 'customers_v1' || ft === 'growth_v1' || ft === 'growth_outlook_v1';
      });

      // If any of the key structured_summary items are missing, derive them deterministically
      // from document_page_understanding and attach as promotedFacts inputs.
      if (!hasRaise || !hasModel || !hasKpi) {
        const derived = await derivePromotedFactsFromDpuForDeal(pool as any, deal_id);
        const existingEvidenceIds = new Set(promotedFacts.map((r: any) => String(r?.evidence_id ?? '')).filter(Boolean));
        for (const r of derived) {
          const evidenceId = String((r as any)?.evidence_id ?? '');
          if (evidenceId && existingEvidenceIds.has(evidenceId)) continue;

          const ft = factTypeOf(r);
          if (ft === 'raise_terms_v1' && hasRaise) continue;
          if (ft === 'business_model_v1' && hasModel) continue;
          promotedFacts.push(r as any);
          if (evidenceId) existingEvidenceIds.add(evidenceId);
        }
      }

          report = promotedFacts.length > 0
            ? compileDIOToReportWithPromotedFacts(row.dio_data, { promotedFacts })
            : compileDIOToReport(row.dio_data);

          // Deterministic structured_summary additions (no LLM): market/product/gtm/deal summaries.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && segmentedNodes?.nodes) {
              const extras = compileStructuredSummaryExtras({ nodes: segmentedNodes.nodes as any, structured_summary: (report as any).structured_summary });
              Object.assign((report as any).structured_summary, extras);
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.structured_summary_extras_failed', deal_id, dio_id: row.dio_id, err }, 'structured_summary extras compilation failed');
          }

          // Deterministic synthesized business model summary (non-promoted, node-derived).
          // Hard rule: multi-node synthesis; must not replace structured_summary.business_model.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && Array.isArray(segmentedNodes?.nodes) && segmentedNodes!.nodes.length > 0) {
              const businessModelSummary = buildBusinessModelSummaryV1(segmentedNodes!.nodes as any);
              if (businessModelSummary) {
                (report as any).structured_summary.business_model_summary = { ...businessModelSummary };
              }
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.business_model_summary_failed', deal_id, dio_id: row.dio_id, err }, 'business_model_summary_v1 synthesis failed');
          }
        } catch (compileErr) {
          request.log.error({ event: 'deal.report.compile_failed', deal_id, dio_id: row.dio_id, err: compileErr }, 'deal.report.compile_failed');
          // Still return readiness + persisted artifact; the report is an optional view.
          report = null;
        }
        
        const payload: any = { ready: true, version: version ?? report?.version ?? 1, artifact };
        payload.deal_summary = dealSummaryV1;

        // Deterministic deck archetype inference (diagnostics only; no enforcement).
        try {
          if (Array.isArray(segmentedNodes?.nodes) && segmentedNodes!.nodes.length > 0) {
            const inferred = inferDeckArchetypeV1(segmentedNodes!.nodes as any, {
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            nextMetadata.deck_archetype = inferred.deck_archetype;
            nextMetadata.archetype_diagnostics = inferred.diagnostics;
            nextMetadata.archetype_segment_drift_v1 = computeArchetypeSegmentDriftV1({
              deck_archetype: inferred.deck_archetype,
              diagnostics: inferred.diagnostics,
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            nextMetadata.override_quality = computeOverrideQualityV1(segmentedNodes!.nodes as any);

            // Prompt 14: Deterministic Segmentation → Scoring Bridge (v1)
            // Diagnostics-first: always attach inputs + preview; apply to score only when env-flag enabled and drift not misaligned.
            try {
              const inputs = buildDeterministicScoreInputsV1({
                structured_summary: (report as any)?.structured_summary ?? null,
                segmented_nodes: segmentedNodes!.nodes as any,
                metadata: nextMetadata,
              });

              const enabled = envFlagEnabled(process.env.DETERMINISTIC_SCORE_V1_ENABLED);
              const driftAssessment = String((nextMetadata as any)?.archetype_segment_drift_v1?.overall_assessment ?? 'unknown');
              const driftMisaligned = driftAssessment === 'misaligned';

              const scoreExp = (report as any)?.metadata?.score_explanation ?? null;
              const totals = scoreExp && scoreExp.totals ? scoreExp.totals : null;

              const baseEvidence = (totals && typeof totals.evidence_factor === 'number') ? totals.evidence_factor : null;
              const baseDD = (totals && typeof totals.due_diligence_factor === 'number') ? totals.due_diligence_factor : null;
              const baseAdj = (totals && typeof totals.adjustment_factor === 'number') ? totals.adjustment_factor : null;
              const coverageRatio = (totals && typeof (totals as any).coverage_ratio === 'number') ? (totals as any).coverage_ratio : null;
              const scoreConfidence = (totals && typeof (totals as any).confidence_score === 'number') ? (totals as any).confidence_score : null;
              const baseUnadjustedReason = (totals && typeof (totals as any).unadjusted_reason === 'string' && String((totals as any).unadjusted_reason).trim())
                ? String((totals as any).unadjusted_reason).trim()
                : null;
              const baseUnadjustedMissing = (totals && Array.isArray((totals as any).unadjusted_missing_inputs))
                ? ((totals as any).unadjusted_missing_inputs as any[]).map((x) => String(x)).filter((s) => s.trim())
                : [];
              const baseUnadjusted = (totals && typeof totals.unadjusted_overall_score === 'number') ? totals.unadjusted_overall_score : null;
              const baseOverall = (totals && typeof totals.overall_score === 'number') ? totals.overall_score : (typeof (report as any)?.overallScore === 'number' ? (report as any).overallScore : null);

              const mod = computeDeterministicModifierV1(inputs);

              const kpis: any[] = Array.isArray(inputs?.kpis) ? inputs.kpis : [];
              const kpiCount = kpis.filter((k) => typeof k?.key === 'string' && k.key.trim()).length;

              const pin = shouldPinUnadjusted({
                coverageRatio,
                kpiCount,
                driftAssessment,
                scoreConfidence,
              });
              const baseUnadjustedPinned = Boolean(pin.pinned || ((totals as any)?.unadjusted_pinned === true));
              const baseUnadjustedPinReason = (pin.reason ?? null);

              // When baseline unadjusted is pinned (low-signal), we keep the deterministic preview frozen to baseline.
              // This prevents the preview from suggesting a score move that cannot be applied.
              let detEvidence = baseEvidence == null ? null : clamp01(baseEvidence * mod.modifier);
              let detAdj = (detEvidence == null || baseDD == null) ? null : clamp01(detEvidence * baseDD);
              let detOverall = (baseUnadjusted == null || detAdj == null)
                ? null
                : Math.round(baseUnadjusted * detAdj + 50 * (1 - detAdj));

              if (baseUnadjustedPinned) {
                detEvidence = baseEvidence;
                detAdj = baseAdj;
                detOverall = baseOverall;
              }

              const deltaOverallScore = (baseOverall != null && detOverall != null) ? (detOverall - baseOverall) : null;

              const canApply = Boolean(enabled && !driftMisaligned && !baseUnadjustedPinned && detOverall != null && scoreExp && totals);
              const appliedParts = canApply
                ? ['score_explanation.totals.evidence_factor', 'score_explanation.totals.adjustment_factor', 'score_explanation.totals.overall_score', 'report.overallScore']
                : [];

              const deltaDiagnostics = computeDeterministicScorePreviewV1Diagnostics({
                applied: canApply,
                delta_overall_score: deltaOverallScore,
                base_unadjusted_overall_score: baseUnadjusted,
                base_adjustment_factor: baseAdj,
                det_adjustment_factor: detAdj,
                base_evidence_factor: baseEvidence,
                det_evidence_factor: detEvidence,
              });

              (nextMetadata as any).deterministic_score_inputs_v1 = inputs;
              (nextMetadata as any).deterministic_score_preview_v1 = {
                version: 'deterministic_score_preview_v1',
                enabled,
                gate: {
                  drift_assessment: driftAssessment,
                  blocked_by_drift_misaligned: driftMisaligned,
                  blocked_by_unadjusted_pinned: baseUnadjustedPinned,
                },
                notes: baseUnadjustedPinned ? ['pinned_unadjusted'] : [],
                inputs_hash: inputs.inputs_hash,
                modifier_v1: {
                  signal_strength: mod.signal_strength,
                  modifier: mod.modifier,
                  notes: mod.notes,
                },
                baseline: {
                  overall_score: baseOverall,
                  unadjusted_overall_score: baseUnadjusted,
                  unadjusted_pinned: baseUnadjustedPinned,
                  unadjusted_pin_reason: baseUnadjustedPinReason,
                  unadjusted_reason: baseUnadjustedReason,
                  unadjusted_missing_inputs: baseUnadjustedMissing,
                  evidence_factor: baseEvidence,
                  due_diligence_factor: baseDD,
                  adjustment_factor: baseAdj,
                },
                deterministic: {
                  overall_score: detOverall,
                  evidence_factor: detEvidence,
                  adjustment_factor: detAdj,
                },
                delta_overall_score: deltaOverallScore,
                delta_unrounded_overall: deltaDiagnostics.delta_unrounded_overall,
                delta_adjustment_factor: deltaDiagnostics.delta_adjustment_factor,
                delta_evidence_factor: deltaDiagnostics.delta_evidence_factor,
                rounding_note: deltaDiagnostics.rounding_note,
                applied: canApply,
                applied_parts: appliedParts,
              };

              if (canApply) {
                // Mutate the compiled report view only (reversible; does not persist into DB).
                try {
                  scoreExp.totals.evidence_factor = detEvidence;
                  scoreExp.totals.adjustment_factor = detAdj;
                  scoreExp.totals.overall_score = detOverall;
                  (report as any).overallScore = detOverall;

                  // Ensure explainability reflects the deterministic bridge.
                  if (scoreExp?.components?.metric_benchmark?.notes && Array.isArray(scoreExp.components.metric_benchmark.notes)) {
                    scoreExp.components.metric_benchmark.notes.push(`deterministic_score_v1 applied (inputs_hash=${inputs.inputs_hash.slice(0, 12)}…, modifier=${mod.modifier.toFixed(3)})`);
                  }
                } catch {
                  // If score explanation shape changes, do not fail /report.
                }
              }
            } catch (err) {
              request.log.warn({ event: 'deal.report.deterministic_score_inputs_failed', deal_id, dio_id: row.dio_id, err }, 'deterministic score inputs v1 failed');
            }

            // Score bands v2 + hard-pass guardrail v2 (metadata only; does not alter score).
            attachScoreBandAndGuardrailV2({ nextMetadata, report });

            (payload as any).metadata = nextMetadata;
            if (report && typeof report === 'object') (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.deck_archetype_failed', deal_id, dio_id: row.dio_id, err }, 'deck_archetype_v1 inference failed');
        }

        // Always attach score band v2 + guardrail v2 when a score exists (best-effort).
        try {
          if (report && typeof report === 'object') {
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (payload as any).metadata = nextMetadata;
            (report as any).metadata = nextMetadata;
          }
        } catch {
          // ignore
        }

        if (Array.isArray(promotedFacts) && promotedFacts.length > 0) {
          payload.promoted_facts = promotedFacts.map((r: any) => ({
            fact_type: r?.content_json?.fact_type ?? r?.fact_type ?? null,
            value_json: r?.content_json?.value_json ?? null,
            confidence: r?.confidence ?? null,
            source_path: r?.source_path ?? null,
            evidence_id: r?.evidence_id ?? null,
            extracted_at: r?.extracted_at ?? null,
          }));
        }
        if (report && typeof report === 'object') {
          // Keep deal_summary nested under the compiled report as well.
          (report as any).deal_summary = dealSummaryV1;
          payload.report = report;
          // Spread the report into the response for compatibility with older consumers.
          // (Older clients expected the ReportDTO shape directly.)
          Object.assign(payload, report);
        }
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.done",
          deal_id,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(payload);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/deals/:deal_id/report/:version
   * Get compiled report from specific DIO version
   */
  app.get<{ Params: ReportParams & { version: string } }>(
    "/api/v1/deals/:deal_id/report/:version",
    async (request: FastifyRequest<{ Params: ReportParams & { version: string } }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id, version } = request.params;
        request.log.info({ msg: "deal.report.version.start", deal_id, version, start_ts: new Date(startTs).toISOString() });
        if (!isUuid(deal_id)) {
          return reply.status(400).send({ error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
        }
        const versionNum = parseInt(version);
        
        if (isNaN(versionNum) || versionNum < 1) {
          return reply.status(400).send({
            error: 'Invalid version number'
          });
        }

        // 404 only when the deal itself does not exist.
        const { rows: dealRows } = await pool.query<{ id: string }>(
          `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [deal_id]
        );
        if (dealRows.length === 0) {
          return reply.status(404).send({ error: 'Deal not found' });
        }
        
        // Get specific DIO version (persisted canonical artifact).
        const { rows: dioRows } = await pool.query<{ dio_data: any }>(
          `SELECT dio_data
             FROM deal_intelligence_objects
            WHERE deal_id = $1 AND analysis_version = $2
            ORDER BY updated_at DESC NULLS LAST,
                     dio_id DESC
            LIMIT 1`,
          [deal_id, versionNum]
        );

        if (dioRows.length === 0) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id} version ${version}`
          });
        }

        // Compile DIO into ReportDTO
        let promotedFacts: any[] = [];
        try {
          promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);
        } catch {
          promotedFacts = [];
        }
        const report = promotedFacts.length > 0
          ? compileDIOToReportWithPromotedFacts(dioRows[0].dio_data, { promotedFacts })
          : compileDIOToReport(dioRows[0].dio_data);

        // Best-effort: attach deterministic deck archetype metadata for versioned reports too.
        try {
          const segmented = await getSegmentedNodesForDeal(pool as any, deal_id);
          if (Array.isArray(segmented?.nodes) && segmented.nodes.length > 0) {
            const inferred = inferDeckArchetypeV1(segmented.nodes as any, {
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            const nextMetadata = { ...((report as any)?.metadata ?? {}) };
            nextMetadata.deck_archetype = inferred.deck_archetype;
            nextMetadata.archetype_diagnostics = inferred.diagnostics;
            nextMetadata.archetype_segment_drift_v1 = computeArchetypeSegmentDriftV1({
              deck_archetype: inferred.deck_archetype,
              diagnostics: inferred.diagnostics,
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            nextMetadata.override_quality = computeOverrideQualityV1(segmented.nodes as any);

            // Best-effort: also attach deterministic score inputs v1 (for KPIs/drift) so guardrail can be evaluated.
            try {
              const inputs = buildDeterministicScoreInputsV1({
                structured_summary: (report as any)?.structured_summary ?? null,
                segmented_nodes: segmented.nodes as any,
                metadata: nextMetadata,
              });
              (nextMetadata as any).deterministic_score_inputs_v1 = inputs;
            } catch {
              // ignore
            }

            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.version.deck_archetype_failed', deal_id, version: versionNum, err }, 'deck_archetype_v1 inference failed (versioned)');
        }

        // Always attach score band v2 + guardrail v2 when a score exists (best-effort).
        try {
          if (report && typeof report === 'object') {
            const nextMetadata = { ...((report as any)?.metadata ?? {}) };
            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (report as any).metadata = nextMetadata;
          }
        } catch {
          // ignore
        }
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.version.done",
          deal_id,
          version: versionNum,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(report);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate versioned report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
}
