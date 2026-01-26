import type { DocumentWithVerification } from "./db";

export type ReextractSelectionOptions = {
  dealId: string;
  explicitDocIds: boolean;
  thresholdLow: number;
  includeWarnings: boolean;
  now?: Date;
  staleProcessingMs?: number;
};

const DEFAULT_STALE_PROCESSING_MS = 15 * 60_000;

function parseTs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : NaN;
}

export function selectReextractCandidates(
  sourceDocs: DocumentWithVerification[],
  opts: ReextractSelectionOptions
): DocumentWithVerification[] {
  const nowMs = (opts.now ?? new Date()).getTime();
  const staleMs =
    typeof opts.staleProcessingMs === "number" && Number.isFinite(opts.staleProcessingMs)
      ? Math.max(0, Math.floor(opts.staleProcessingMs))
      : DEFAULT_STALE_PROCESSING_MS;

  return sourceDocs.filter((d) => {
    if (d.deal_id !== opts.dealId) return false;

    // If specific document_ids were requested, always attempt re-extraction
    // (regardless of current status/verification gating).
    if (opts.explicitDocIds) return true;

    const status = String(d.status ?? "").toLowerCase();
    if (status === "failed") return true;

    if (status === "processing") {
      const updatedAtMs = parseTs(d.updated_at);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > staleMs) return true;
    }

    // Existing criteria: only consider completed/ready docs for verification-based re-extraction.
    if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
    if (d.verification_status === "failed") return true;
    if (opts.includeWarnings && d.verification_status === "warnings") return true;
    const score = (d.verification_result as any)?.overall_score;
    if (typeof score === "number" && Number.isFinite(score) && score < opts.thresholdLow) return true;
    return false;
  });
}
