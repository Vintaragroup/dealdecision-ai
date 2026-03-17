/**
 * PR7-lite: Analyze Deal Enqueue Guarantee
 *
 * maybeEnqueueAnalyzeDealGuarantee checks three prerequisites before calling
 * the caller-supplied enqueueCallback:
 *
 *   1. Is there already an active (queued/running/retrying) analyze_deal job?
 *   2. Did analyze_deal succeed very recently (within a 2-minute freshness window)?
 *   3. Have all visual-extractable documents been finalized by the extract_visuals pipeline?
 *      XLSX/Excel docs are exempt from the finalized check.
 *
 * Only when all three guards pass does it invoke enqueueCallback.
 * This ensures idempotent, prerequisite-aware enqueuing without additional tables.
 *
 * Single DB query: uses scalar sub-selects so one round-trip covers all checks.
 *
 * Emits structured log events:
 *   ANALYZE_ENQUEUE_GUARANTEE_CHECK    — always, with prereq snapshot
 *   ANALYZE_ENQUEUE_GUARANTEE_SKIPPED  — when skipping, includes reason
 *   ANALYZE_ENQUEUE_GUARANTEE_ENQUEUED — when enqueue proceeds (or was already idempotently queued)
 */

export type GuaranteeSkipReason =
  | "missing_deal_id"
  | "analyze_already_active"
  | "analyze_recently_succeeded"
  | "prerequisites_not_met"
  | "no_docs";

export type AnalyzeEnqueueGuaranteeResult =
  | { action: "enqueued"; job_id: string | null }
  | { action: "skipped"; reason: GuaranteeSkipReason; detail?: Record<string, unknown> };

export type GuaranteeLogger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
};

export type GuaranteePool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/**
 * Idempotency-aware wrapper that checks if analyze_deal should be enqueued.
 *
 * @param args.deal_id         - UUID of the deal.
 * @param args.trigger         - Logical trigger name (used in log events only).
 * @param args.triggerJobId    - Optional job ID of the triggering job.
 * @param args.pool            - Postgres pool (or compatible mock with .query()).
 * @param args.logger          - Optional logger; defaults to console. Pass null to suppress.
 * @param args.enqueueCallback - Async callback that performs the actual enqueue.
 *                               Called only when all prerequisite guards pass.
 */
export async function maybeEnqueueAnalyzeDealGuarantee(args: {
  deal_id: string | null | undefined;
  trigger: string;
  triggerJobId?: string | null;
  pool: GuaranteePool;
  logger?: GuaranteeLogger | null;
  enqueueCallback: () => Promise<{ enqueued: boolean; jobId: string | null }>;
}): Promise<AnalyzeEnqueueGuaranteeResult> {
  const { trigger, triggerJobId, pool, enqueueCallback } = args;
  const logger: GuaranteeLogger | undefined =
    args.logger === null ? undefined : (args.logger ?? (console as unknown as GuaranteeLogger));
  const deal_id = typeof args.deal_id === "string" ? args.deal_id.trim() : "";
  const meta = { deal_id: deal_id || null, trigger, trigger_job_id: triggerJobId ?? null };

  if (!deal_id) {
    logger?.warn(
      JSON.stringify({ event: "ANALYZE_ENQUEUE_GUARANTEE_SKIPPED", ...meta, reason: "missing_deal_id" })
    );
    return { action: "skipped", reason: "missing_deal_id" };
  }

  // Single round-trip: three scalar sub-SELECTs.
  //
  // active_analyze_status:
  //   The status of the most-recent analyze_deal job that is either:
  //   (a) currently active (queued | running | retrying), OR
  //   (b) succeeded within the last 2 minutes (freshness window).
  //   NULL when no such job exists.
  //
  // total_docs:
  //   Count of non-deleted documents in this deal.
  //
  // unfinalized_visual_docs:
  //   Count of non-deleted documents that:
  //   - Have NOT yet had extract_visuals_finalized.ok = true written by the finalize phase, AND
  //   - Are NOT exempt (XLSX/XLS/Excel docs bypass the visual-extraction requirement).
  const { rows } = await pool.query(
    `SELECT
       (SELECT j.status
          FROM jobs j
         WHERE j.deal_id = $1
           AND j.type = 'analyze_deal'
           AND (
                j.status IN ('queued', 'running', 'retrying')
             OR (j.status IN ('succeeded', 'succeeded_with_warnings')
                 AND j.updated_at >= now() - interval '2 minutes')
           )
         ORDER BY j.created_at DESC
         LIMIT 1
       ) AS active_analyze_status,

       (SELECT COUNT(*)::int
          FROM documents d
         WHERE d.deal_id = $1
           AND d.deleted_at IS NULL
       ) AS total_docs,

       (SELECT COUNT(*)::int
          FROM documents d
         WHERE d.deal_id = $1
           AND d.deleted_at IS NULL
           AND NOT (d.extraction_metadata->'extract_visuals_finalized'->>'ok' = 'true')
           AND NOT (
                d.type ILIKE '%xlsx%'
             OR d.type ILIKE '%xls%'
             OR (d.extraction_metadata->>'doc_kind') ILIKE '%excel%'
           )
       ) AS unfinalized_visual_docs`,
    [deal_id]
  );

  const row = rows[0] ?? {
    active_analyze_status: null,
    total_docs: 0,
    unfinalized_visual_docs: 0,
  };

  const activeStatus: string | null =
    typeof row.active_analyze_status === "string" ? row.active_analyze_status : null;
  const totalDocs: number = typeof row.total_docs === "number" ? row.total_docs : 0;
  const unfinalizedDocs: number =
    typeof row.unfinalized_visual_docs === "number" ? row.unfinalized_visual_docs : 0;

  const snapshot = {
    active_analyze_status: activeStatus,
    total_docs: totalDocs,
    unfinalized_visual_docs: unfinalizedDocs,
    trigger,
    trigger_job_id: triggerJobId ?? null,
  };

  logger?.log(
    JSON.stringify({ event: "ANALYZE_ENQUEUE_GUARANTEE_CHECK", deal_id, ...snapshot })
  );

  // Guard 1: already active (queued | running | retrying)
  if (
    activeStatus === "queued" ||
    activeStatus === "running" ||
    activeStatus === "retrying"
  ) {
    logger?.log(
      JSON.stringify({
        event: "ANALYZE_ENQUEUE_GUARANTEE_SKIPPED",
        deal_id,
        reason: "analyze_already_active",
        ...snapshot,
      })
    );
    return { action: "skipped", reason: "analyze_already_active", detail: snapshot };
  }

  // Guard 2: recently succeeded (within freshness window)
  if (activeStatus === "succeeded" || activeStatus === "succeeded_with_warnings") {
    logger?.log(
      JSON.stringify({
        event: "ANALYZE_ENQUEUE_GUARANTEE_SKIPPED",
        deal_id,
        reason: "analyze_recently_succeeded",
        ...snapshot,
      })
    );
    return { action: "skipped", reason: "analyze_recently_succeeded", detail: snapshot };
  }

  // Guard 3: no documents in deal
  if (totalDocs === 0) {
    logger?.log(
      JSON.stringify({
        event: "ANALYZE_ENQUEUE_GUARANTEE_SKIPPED",
        deal_id,
        reason: "no_docs",
        ...snapshot,
      })
    );
    return { action: "skipped", reason: "no_docs", detail: snapshot };
  }

  // Guard 4: prerequisites not met — at least one visual-extractable doc is not yet finalized
  if (unfinalizedDocs > 0) {
    logger?.log(
      JSON.stringify({
        event: "ANALYZE_ENQUEUE_GUARANTEE_SKIPPED",
        deal_id,
        reason: "prerequisites_not_met",
        ...snapshot,
      })
    );
    return { action: "skipped", reason: "prerequisites_not_met", detail: snapshot };
  }

  // All guards passed — call the enqueue callback
  const result = await enqueueCallback();
  logger?.log(
    JSON.stringify({
      event: "ANALYZE_ENQUEUE_GUARANTEE_ENQUEUED",
      deal_id,
      job_id: result.jobId ?? null,
      already_enqueued: !result.enqueued,
      ...snapshot,
    })
  );
  return { action: "enqueued", job_id: result.jobId ?? null };
}
