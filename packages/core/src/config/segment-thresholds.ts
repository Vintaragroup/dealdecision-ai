export type SegmentConfidenceThresholds = {
  auto_accept: number;
  review: number;
  reject: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseEnvNumber(env: Record<string, string | undefined>, key: string): number | null {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Segment confidence thresholds used for:
 * - auto-persistence (promotion)
 * - score coverage (PhaseB)
 *
 * Defaults (per product requirements):
 * - auto_accept >= 0.85
 * - review >= 0.65
 * - reject < 0.65 (modeled as anything below review)
 */
export function getSegmentConfidenceThresholds(
  env: Record<string, string | undefined> = (typeof process !== 'undefined' ? (process.env as any) : {})
): SegmentConfidenceThresholds {
  const autoAccept = parseEnvNumber(env, 'DDAI_SEGMENT_AUTO_ACCEPT_THRESHOLD');
  const review = parseEnvNumber(env, 'DDAI_SEGMENT_REVIEW_THRESHOLD');
  const reject = parseEnvNumber(env, 'DDAI_SEGMENT_REJECT_THRESHOLD');

  const defaults: SegmentConfidenceThresholds = {
    auto_accept: 0.85,
    review: 0.65,
    // Keep configurable for existing “review_low/reject” bands, but default ties to review.
    reject: 0.65,
  };

  const out: SegmentConfidenceThresholds = {
    auto_accept: clamp01(autoAccept ?? defaults.auto_accept),
    review: clamp01(review ?? defaults.review),
    reject: clamp01(reject ?? defaults.reject),
  };

  // Enforce monotonic thresholds.
  const lo = Math.min(out.reject, out.review);
  out.reject = lo;
  out.review = Math.max(out.review, out.reject);
  out.auto_accept = Math.max(out.auto_accept, out.review);

  return out;
}
