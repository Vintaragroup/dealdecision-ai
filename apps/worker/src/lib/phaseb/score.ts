import { PhaseBFeatures, PhaseBPenalty, PhaseBProvenanceItem, PhaseBScoreResult } from './types';

const MAX_MISSING_PENALTY = 30;
const MAX_THIN_PENALTY = 15;
const MAX_NO_EVIDENCE_PENALTY = 20;
const MAX_LOW_CONF_PENALTY = 10;

export function computePhaseBScore(features: PhaseBFeatures): PhaseBScoreResult {
  const { segments = [], total_evidence = 0 } = features;

  let score = 100;
  const penalties: PhaseBPenalty[] = [];

  // Missing segment penalty
  const missingSegments = segments.filter((s: PhaseBFeatures['segments'][number]) => !s || !s.segment_key);
  if (missingSegments.length > 0) {
    const total = Math.min(missingSegments.length * 6, MAX_MISSING_PENALTY);
    if (total > 0) {
      score -= total;
      penalties.push({ code: 'missing_segment', label: 'Missing coverage segments', amount: -total, meta: { count: missingSegments.length } });
    }
  }

  // Present but thin penalties
  let thinPenaltyAcc = 0;
  let noEvidencePenaltyAcc = 0;
  let lowConfPenaltyAcc = 0;

  for (const seg of segments) {
    const hasKey = Boolean(seg.segment_key);
    if (!hasKey) continue;
    const visuals = typeof seg.visual_count === 'number' ? seg.visual_count : 0;
    const evidence = typeof seg.evidence_count === 'number' ? seg.evidence_count : 0;
    const avgConf = typeof seg.avg_confidence === 'number' ? seg.avg_confidence : null;

    if (visuals === 0) thinPenaltyAcc += 3;
    if (visuals > 0 && evidence === 0) noEvidencePenaltyAcc += 4;
    if (avgConf != null && avgConf < 0.55) lowConfPenaltyAcc += 2;
  }

  if (thinPenaltyAcc > 0) {
    const amt = Math.min(thinPenaltyAcc, MAX_THIN_PENALTY);
    score -= amt;
    penalties.push({ code: 'thin_segments', label: 'Segments lack visuals', amount: -amt, meta: { raw: thinPenaltyAcc } });
  }
  if (noEvidencePenaltyAcc > 0) {
    const amt = Math.min(noEvidencePenaltyAcc, MAX_NO_EVIDENCE_PENALTY);
    score -= amt;
    penalties.push({ code: 'no_evidence', label: 'Segments missing evidence', amount: -amt, meta: { raw: noEvidencePenaltyAcc } });
  }
  if (lowConfPenaltyAcc > 0) {
    const amt = Math.min(lowConfPenaltyAcc, MAX_LOW_CONF_PENALTY);
    score -= amt;
    penalties.push({ code: 'low_confidence', label: 'Low-confidence segments', amount: -amt, meta: { raw: lowConfPenaltyAcc } });
  }

  score = Math.max(0, Math.min(100, score));

  // Confidence
  const presentSegments = segments.filter((s: PhaseBFeatures['segments'][number]) => s && s.segment_key);
  const presentBonus = Math.min(presentSegments.length, 7) * 0.05; // up to +0.35
  const evidenceBonus = total_evidence >= 50 ? 0.15 : total_evidence >= 25 ? 0.10 : total_evidence >= 10 ? 0.05 : 0;
  let confidence = 0.35 + presentBonus + evidenceBonus;
  confidence = Math.max(0, Math.min(1, confidence));

  // Recommendation
  const recommendation = score >= 75 && confidence >= 0.65 ? 'invest' : score >= 55 ? 'watch' : 'pass';

  // Provenance: surface top segments by missingness / evidence
  const provenance: PhaseBProvenanceItem[] = [];
  const sorted = [...segments].sort((a: PhaseBFeatures['segments'][number], b: PhaseBFeatures['segments'][number]) => {
    const evA = typeof a.evidence_count === 'number' ? a.evidence_count : 0;
    const evB = typeof b.evidence_count === 'number' ? b.evidence_count : 0;
    return evA - evB;
  });
  for (const seg of sorted.slice(0, 5)) {
    provenance.push({
      segment_key: seg.segment_key,
      segment_label: seg.segment_label,
      document_id: seg.document_ids?.[0],
      visual_count: seg.visual_count,
      evidence_count: seg.evidence_count,
      avg_confidence: seg.avg_confidence ?? null,
      notes: seg.evidence_count === 0 ? 'No evidence observed' : undefined,
    });
  }

  return {
    version: '1.0.0',
    score_0_100: score,
    recommendation,
    confidence_0_1: confidence,
    breakdown: {
      market: score,
      traction: score,
      product: score,
      team: score,
      financials: score,
      risks: score,
      docs: score,
      evidence: score,
    },
    penalties,
    provenance,
  };
}
