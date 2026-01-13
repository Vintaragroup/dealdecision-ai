import type { SegmentConfidenceThresholds } from '../config/segment-thresholds';

export type LineageVisualNodeForCoverage = {
  kind: 'visual_asset' | string;
  effective_segment?: string | null;
  segment_confidence?: number | null;
};

export type SegmentCoverageSummary = {
  coverage_confident: number;
  coverage_weak: number;
};

/**
 * Coverage rules:
 * - Only count as confident when segment != 'unknown' AND confidence >= thresholds.review
 * - Count as weak when segment != 'unknown' but confidence < thresholds.review
 */
export function computeSegmentCoverageSummary(
  nodes: LineageVisualNodeForCoverage[],
  thresholds: SegmentConfidenceThresholds
): SegmentCoverageSummary {
  let confident = 0;
  let weak = 0;

  for (const node of nodes) {
    if (node.kind !== 'visual_asset') continue;
    const segment = (node.effective_segment ?? '').toLowerCase();
    if (!segment || segment === 'unknown') continue;
    const confidence = typeof node.segment_confidence === 'number' ? node.segment_confidence : 0;
    if (confidence >= thresholds.review) confident += 1;
    else weak += 1;
  }

  return {
    coverage_confident: confident,
    coverage_weak: weak,
  };
}
