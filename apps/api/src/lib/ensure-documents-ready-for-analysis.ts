import type { FastifyBaseLogger } from "fastify";
import { getDocumentCapabilities, sanitizeText } from "@dealdecision/core";
import { fetchPageUnderstandingReadinessForDeal, type PageUnderstandingReadiness } from "./deal-page-understanding-readiness";
import type { EnqueueJobInput, EnqueueJobOptions } from "../services/jobs";

type QueryResult<T> = { rows: T[] };

type PoolLike = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export type EnsureDocumentsReadyResult = {
  ready: boolean;
  enqueued: {
    render_document_pages: string[];
    document_intelligence_extract: string[];
    extract_visuals_deal: boolean;
    populate_document_page_understanding: string[];
  };
  readiness: PageUnderstandingReadiness;
  blocked_reason: string | null;
  poll_after_ms: number;
  /**
   * Machine-readable action hint for callers.
   * 'enqueue_dpu_backfill' — DPU rows are missing, stale, or partially covered;
   * the caller should display a waiting UI and poll until DPU is ready.
   * null — no DPU-specific action required (may still be not-ready for other reasons).
   */
  action: 'enqueue_dpu_backfill' | null;
  /**
   * Stable content-address string derived from deal + DPU counts.
   * Used by callers for idempotency checks (no duplicate backfill for same state).
   */
  docs_fingerprint: string | null;
};

async function hasColumn(pool: PoolLike, table: string, column: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 as ok FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const isNonEmptyText = (value: unknown, minLen = 1): boolean => {
  if (typeof value !== "string") return false;
  return value.trim().length >= minLen;
};

const readTextProbeWantsOcr = (meta: any): boolean => {
  if (!meta || typeof meta !== "object") return false;
  const probe = (meta as any).textProbe;
  if (!probe || typeof probe !== "object") return false;
  const decision = (probe as any).decision;
  if (decision && typeof decision === "object" && (decision as any).run === true) return true;
  if ((probe as any).run === true) return true;
  if ((probe as any).should_run_ocr === true) return true;
  return false;
};

function computeEffectiveReadiness(args: {
  readiness: PageUnderstandingReadiness;
  visualDocsMissingPageCount: string[];
}): { readiness: PageUnderstandingReadiness; ready: boolean; blocked_reason: string | null; poll_after_ms: number } {
  const base = args.readiness;
  if (!Array.isArray(args.visualDocsMissingPageCount) || args.visualDocsMissingPageCount.length === 0) {
    return { readiness: base, ready: !!base.ready, blocked_reason: (base as any).blocked_reason ?? null, poll_after_ms: (base as any).poll_after_ms ?? 2000 };
  }

  const blocked_reason = "PAGE_COUNT_UNKNOWN";
  const readiness = {
    ...(base as any),
    ready: false,
    blocked_reason,
    poll_after_ms: 2000,
    action: { type: "render_document_pages", deal_id: base.deal_id, version: base.version },
    render_missing_page_count_documents: args.visualDocsMissingPageCount,
  } as PageUnderstandingReadiness & { render_missing_page_count_documents?: string[] };

  return { readiness, ready: false, blocked_reason, poll_after_ms: 2000 };
}

export async function ensureDocumentsReadyForAnalysis(args: {
  pool: PoolLike;
  dealId: string;
  requirePageUnderstanding: boolean;
  pageUnderstandingVersion: string;
  forceRefresh?: boolean;
  minDpuCreatedAt?: string | null;
  logger?: FastifyBaseLogger;
  enqueue: (input: EnqueueJobInput, opts?: EnqueueJobOptions) => Promise<{ job_id: string; status: string }>;
}): Promise<EnsureDocumentsReadyResult> {
  const { pool, dealId, requirePageUnderstanding, pageUnderstandingVersion, enqueue } = args;
  const log = args.logger;
  const forceRefresh = args.forceRefresh === true;
  const minDpuCreatedAt = typeof args.minDpuCreatedAt === 'string' && args.minDpuCreatedAt.trim().length > 0 ? args.minDpuCreatedAt.trim() : null;

  const isAfterOrEqualIso = (actual: string | null | undefined, min: string | null | undefined): boolean => {
    if (!actual || !min) return true;
    const a = Date.parse(actual);
    const b = Date.parse(min);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    return a >= b;
  };

  const hasMimeType = await hasColumn(pool, "documents", "mime_type");
  const hasFileName = await hasColumn(pool, "documents", "file_name");
  const hasFilename = hasFileName ? false : await hasColumn(pool, "documents", "filename");

  const fileNameExpr = hasFileName ? "d.file_name" : hasFilename ? "d.filename" : "NULL::text";
  const mimeTypeExpr = hasMimeType ? "d.mime_type" : "NULL::text";

  type DocRow = {
    id: string;
    title: string | null;
    status: string | null;
    page_count: number | null;
    extraction_metadata: any;
    full_text: string | null;
    full_text_absent_reason: string | null;
    file_name: string | null;
    mime_type: string | null;
  };

  const { rows: docs } = await pool.query<DocRow>(
    `SELECT d.id,
            d.title,
            d.status,
            COALESCE(d.page_count, 0) AS page_count,
            d.extraction_metadata,
            d.full_text,
            d.full_text_absent_reason,
            ${fileNameExpr} AS file_name,
            ${mimeTypeExpr} AS mime_type
       FROM documents d
      WHERE d.deal_id = $1
        AND d.deleted_at IS NULL`,
    [sanitizeText(dealId)]
  );

  const hasRenderedPagesInMeta = (d: DocRow): boolean => {
    const metaObj = d.extraction_metadata && typeof d.extraction_metadata === 'object' ? (d.extraction_metadata as any) : null;
    const renderedR2 = metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === 'object' ? (metaObj.rendered_pages_r2 as any) : null;
    const renderedDir = typeof metaObj?.rendered_pages_dir === 'string' ? metaObj.rendered_pages_dir.trim() : '';
    const renderedCount = typeof metaObj?.rendered_pages_count === 'number' && Number.isFinite(metaObj.rendered_pages_count)
      ? Math.max(0, Math.trunc(metaObj.rendered_pages_count))
      : 0;
    return !!renderedR2 || renderedDir.length > 0 || renderedCount > 0;
  };

  const visualDocs = (docs ?? []).filter((d) => {
    const caps = getDocumentCapabilities({
      fileName: typeof d.file_name === "string" ? d.file_name : null,
      mimeType: typeof d.mime_type === "string" ? d.mime_type : null,
    });
    return !!caps.visualExtractable;
  });

  // Fallback: some legacy rows may not have mime_type/file_name populated, but still have rendered_pages_*.
  // For force_refresh, we prefer refreshing DPU when we can see rendered pages metadata.
  const visualDocsOrRenderedFallback = (() => {
    if (visualDocs.length > 0) return visualDocs;
    return (docs ?? []).filter((d) => {
      const pageCount = Math.max(0, toInt(d.page_count, 0));
      if (pageCount <= 0) return false;
      return hasRenderedPagesInMeta(d);
    });
  })();

  const renderChunkSize = (() => {
    const raw = toInt(process.env.VISUAL_PAGE_IMAGE_MAX_PAGES, 10);
    return Math.max(1, Math.min(1000, raw || 10));
  })();

  const enqueued = {
    render_document_pages: [] as string[],
    document_intelligence_extract: [] as string[],
    extract_visuals_deal: false,
    populate_document_page_understanding: [] as string[],
  };

  const visualDocsMissingPageCount: string[] = [];
  const visualDocIdsNeedingRender: string[] = [];
  const visualDocIdsNeedingOcr: string[] = [];

  for (const d of visualDocs) {
    const caps = getDocumentCapabilities({
      fileName: typeof d.file_name === "string" ? d.file_name : null,
      mimeType: typeof d.mime_type === "string" ? d.mime_type : null,
    });

    const pageCount = Math.max(0, toInt(d.page_count, 0));
    if (pageCount <= 0 && caps.supports_page_rendering) {
      visualDocsMissingPageCount.push(d.id);
    }

    const metaObj = d.extraction_metadata && typeof d.extraction_metadata === "object" ? (d.extraction_metadata as any) : null;
    const renderedR2 = metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
    const renderedDir = typeof metaObj?.rendered_pages_dir === "string" ? metaObj.rendered_pages_dir.trim() : "";
    const renderedCount = typeof metaObj?.rendered_pages_count === "number" && Number.isFinite(metaObj.rendered_pages_count) ? Math.max(0, Math.trunc(metaObj.rendered_pages_count)) : 0;
    const renderedRendered = typeof metaObj?.rendered_pages_rendered === "number" && Number.isFinite(metaObj.rendered_pages_rendered) ? Math.max(0, Math.trunc(metaObj.rendered_pages_rendered)) : null;

    const fullTextOk = isNonEmptyText(d.full_text, 50);
    const needsOcr =
      String(d.status ?? "").toLowerCase() === "needs_ocr" ||
      readTextProbeWantsOcr(metaObj) ||
      metaObj?.needsOcr === true ||
      metaObj?.needs_ocr === true ||
      (!fullTextOk && isNonEmptyText(d.full_text_absent_reason, 1));

    if (needsOcr) {
      visualDocIdsNeedingOcr.push(d.id);
    }

    // Render prerequisites can be satisfied via:
    // - R2-backed rendered pages (rendered_pages_r2)
    // - Local rendered pages (rendered_pages_dir)
    // In dev/local mode we often render to local disk, so requiring rendered_pages_r2
    // will cause /prepare to continuously enqueue render jobs and never advance to DPU.
    const hasRenderedPagesLocation = !!renderedR2 || renderedDir.length > 0;
    const hasRenderProgress = renderedCount > 0 && renderedRendered != null && renderedRendered >= renderedCount;
    const needsRender = caps.supports_page_rendering && (pageCount <= 0 || !hasRenderedPagesLocation || !hasRenderProgress);

    if (needsRender) {
      visualDocIdsNeedingRender.push(d.id);
    }
  }

  // 1) Render prerequisites
  for (const docId of visualDocIdsNeedingRender) {
    const forceOcr = visualDocIdsNeedingOcr.includes(docId);

    // IMPORTANT: for force_ocr, avoid dedupe so we don't get stuck behind an earlier non-force render.
    const opts: EnqueueJobOptions | undefined = forceOcr ? undefined : { dedupe: { by: "document" } };

    try {
      await enqueue(
        {
          deal_id: dealId,
          document_id: docId,
          type: "render_document_pages",
          page_start: 0,
          page_end: renderChunkSize,
          payload: {
            deal_id: dealId,
            document_id: docId,
            page_start: 0,
            page_end: renderChunkSize,
            ...(forceOcr ? { force_ocr: true } : {}),
          },
        },
        opts
      );
      enqueued.render_document_pages.push(docId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ event: "render_document_pages.enqueue_failed", deal_id: dealId, document_id: docId, err: msg }, "Failed to enqueue render_document_pages");
    }

    if (forceOcr) {
      try {
        await enqueue(
          {
            deal_id: dealId,
            document_id: docId,
            type: "document_intelligence_extract",
            payload: { deal_id: dealId, document_id: docId, reason: "analysis_preflight_needs_ocr" },
          },
          { dedupe: { by: "document" } }
        );
        enqueued.document_intelligence_extract.push(docId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.warn(
          { event: "document_intelligence_extract.enqueue_failed", deal_id: dealId, document_id: docId, err: msg },
          "Failed to enqueue document_intelligence_extract"
        );
      }
    }
  }

  // 1b) Force refresh path: enqueue DPU rebuild + document intelligence extraction even if readiness is already satisfied.
  // This is used for "rerun analysis" flows to avoid using stale DPU-derived promoted facts.
  if (requirePageUnderstanding && forceRefresh) {
    for (const d of visualDocsOrRenderedFallback) {
      const docId = String(d.id);
      const pageCount = Math.max(0, toInt(d.page_count, 0));
      if (!docId || pageCount <= 0) continue;

      try {
        await enqueue(
          {
            deal_id: dealId,
            document_id: docId,
            type: "populate_document_page_understanding",
            payload: {
              page_understanding_version: pageUnderstandingVersion,
              page_start: 0,
              page_end: pageCount,
              force_refresh: true,
              ...(minDpuCreatedAt ? { min_dpu_created_at: minDpuCreatedAt } : {}),
              reason: "analysis_force_refresh",
            },
          },
          // IMPORTANT: avoid dedupe so reruns actually enqueue fresh work.
          undefined
        );
        enqueued.populate_document_page_understanding.push(docId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.warn(
          { event: "populate_document_page_understanding.enqueue_failed", deal_id: dealId, document_id: docId, err: msg },
          "Failed to enqueue populate_document_page_understanding (force_refresh)"
        );
      }

      try {
        await enqueue(
          {
            deal_id: dealId,
            document_id: docId,
            type: "document_intelligence_extract",
            payload: {
              deal_id: dealId,
              document_id: docId,
              reason: "analysis_force_refresh",
              force: true,
            },
          },
          // IMPORTANT: avoid dedupe so reruns can refresh evidence_items with new provenance.
          undefined
        );
        enqueued.document_intelligence_extract.push(docId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.warn(
          { event: "document_intelligence_extract.enqueue_failed", deal_id: dealId, document_id: docId, err: msg },
          "Failed to enqueue document_intelligence_extract (force_refresh)"
        );
      }
    }
  }

  // 2) Page understanding readiness
  const readiness = requirePageUnderstanding
    ? await fetchPageUnderstandingReadinessForDeal(pool as any, dealId, pageUnderstandingVersion)
    : ({
        deal_id: dealId,
        version: pageUnderstandingVersion,
        documents: [],
        expected_pages_total: 0,
        dpu_rows_total: 0,
        missing_pages_total: 0,
        blocked_reason: null,
        poll_after_ms: null,
        action: null,
        ready: true,
      } as PageUnderstandingReadiness);

  const effective = computeEffectiveReadiness({ readiness, visualDocsMissingPageCount });

  // Freshness gate: when a caller supplies a min_dpu_created_at token (typically from force_refresh),
  // treat readiness as not-ready until DPU has been recreated at/after that timestamp.
  if (requirePageUnderstanding && minDpuCreatedAt) {
    const latest = (effective.readiness as any)?.latest_dpu_created_at as string | null | undefined;
    if (!isAfterOrEqualIso(latest, minDpuCreatedAt)) {
      (effective.readiness as any).ready = false;
      (effective.readiness as any).blocked_reason = (effective.readiness as any).blocked_reason ?? "DPU_STALE";
      (effective.readiness as any).poll_after_ms = (effective.readiness as any).poll_after_ms ?? 2000;
      (effective.readiness as any).action = (effective.readiness as any).action ?? { type: "rebuild_page_understanding", deal_id: dealId, version: effective.readiness.version };
      (effective as any).ready = false;
      (effective as any).blocked_reason = (effective.readiness as any).blocked_reason;
      (effective as any).poll_after_ms = (effective.readiness as any).poll_after_ms;
    }
  }

  // If we're still missing render prerequisites, don't enqueue downstream visual extraction yet.
  const hasRenderWorkEnqueued = enqueued.render_document_pages.length > 0;

  if (requirePageUnderstanding && !effective.ready && !hasRenderWorkEnqueued) {
    const missingDocs = (effective.readiness.documents ?? [])
      .filter((d: any) => {
        const hard = Array.isArray(d?.hard_missing_pages) ? d.hard_missing_pages : null;
        if (hard && hard.length > 0) return true;
        // Back-compat: if hard-missing isn't present, fall back to missing_pages.
        return Array.isArray(d?.missing_pages) && d.missing_pages.length > 0;
      })
      .map((d) => d.document_id);

    const missingSet = new Set(missingDocs);
    const visualMissingDocs = visualDocs
      .map((d) => d.id)
      .filter((id) => missingSet.has(id));

    if (visualMissingDocs.length > 0) {
      for (const docId of visualMissingDocs.slice(0, 50)) {
        try {
          await enqueue(
            {
              deal_id: dealId,
              document_id: docId,
              type: "populate_document_page_understanding",
              payload: { page_understanding_version: pageUnderstandingVersion },
            },
            { dedupe: { by: "document" } }
          );
          enqueued.populate_document_page_understanding.push(docId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log?.warn(
            { event: "populate_document_page_understanding.enqueue_failed", deal_id: dealId, document_id: docId, err: msg },
            "Failed to enqueue populate_document_page_understanding"
          );
        }
      }

      try {
        await enqueue(
          {
            deal_id: dealId,
            type: "extract_visuals_deal",
            queue: "extract_visuals",
            payload: {
              document_ids: visualMissingDocs,
              enqueue_deep_scan: true,
            },
          },
          { dedupe: { by: "deal" } }
        );
        enqueued.extract_visuals_deal = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.error(
          { event: "extract_visuals_deal.enqueue_failed", deal_id: dealId, err: msg },
          "Failed to enqueue extract_visuals_deal for DPU gaps"
        );
      }
    }
  }

  // DPU_STALE self-heal: when the freshness gate is the only blocker (rows exist but
  // predate min_dpu_created_at), re-enqueue populate_document_page_understanding so that
  // any failed or evicted jobs get a fresh nudge.
  //
  // This fires on non-force_refresh calls — typically the web polling retry that comes
  // after the initial force_refresh 202 response.  It intentionally does NOT delete
  // existing rows (no force_refresh flag), keeping the worker's backfill + enrich path
  // in play.  A job-existence guard prevents queue spam on every poll tick.
  if (
    requirePageUnderstanding &&
    !forceRefresh &&
    minDpuCreatedAt &&
    (effective as any).blocked_reason === "DPU_STALE" &&
    !hasRenderWorkEnqueued &&
    enqueued.populate_document_page_understanding.length === 0
  ) {
    let hasRecentDpuJob = false;
    try {
      const res = await pool.query<{ c: number }>(
        `SELECT 1::int AS c
           FROM jobs
          WHERE deal_id = $1
            AND type = 'populate_document_page_understanding'
            AND created_at >= (now() - interval '5 minutes')
          LIMIT 1`,
        [dealId]
      );
      hasRecentDpuJob = Array.isArray((res as any).rows) && (res as any).rows.length > 0;
    } catch {
      // best-effort: if the check fails, allow re-enqueue (conservative)
    }

    if (!hasRecentDpuJob) {
      for (const d of visualDocs) {
        const docId = String(d.id);
        const pageCount = Math.max(0, toInt(d.page_count, 0));
        if (!docId || pageCount <= 0) continue;
        try {
          await enqueue(
            {
              deal_id: dealId,
              document_id: docId,
              type: "populate_document_page_understanding",
              payload: {
                page_understanding_version: pageUnderstandingVersion,
                reason: "dpu_stale_self_heal",
              },
            },
            { dedupe: { by: "document" } }
          );
          enqueued.populate_document_page_understanding.push(docId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log?.warn(
            { event: "populate_document_page_understanding.stale_heal_enqueue_failed", deal_id: dealId, document_id: docId, err: msg },
            "Failed to enqueue populate_document_page_understanding for DPU_STALE self-heal"
          );
        }
      }
      if (enqueued.populate_document_page_understanding.length > 0) {
        log?.info(
          { event: "DPU_STALE_SELF_HEAL", deal_id: dealId, enqueued_docs: enqueued.populate_document_page_understanding },
          "DPU_STALE detected with no recent jobs — re-enqueued populate_document_page_understanding"
        );
      }
    }
  }

  const pollAfter = effective.poll_after_ms ?? 2000;

  // Compute machine-readable action field for Gate 1 DPU cases.
  // Conditions that indicate a DPU backfill is the right remediation:
  //   - blocked_reason is the DPU_STALE freshness marker, OR
  //   - no DPU rows exist for an expected page set (missing_dpu), OR
  //   - DPU rows exist but gaps remain (dpu_partial)
  // PAGE_COUNT_UNKNOWN and render-related blockers are NOT DPU backfill actions.
  const dpuBackfillAction = ((): 'enqueue_dpu_backfill' | null => {
    if (effective.ready) return null;
    const reason = effective.blocked_reason;
    if (reason === 'DPU_STALE') return 'enqueue_dpu_backfill';
    // null blocked_reason with DPU gaps (missing or partial coverage)
    if (reason === null && requirePageUnderstanding) {
      const expPages = effective.readiness.expected_pages_total ?? 0;
      const dpuRows = effective.readiness.dpu_rows_total ?? 0;
      const missingPages = effective.readiness.missing_pages_total ?? 0;
      if (expPages > 0 && (dpuRows === 0 || missingPages > 0)) return 'enqueue_dpu_backfill';
    }
    return null;
  })();

  const docsFingerprint = `${dealId}::${effective.readiness.expected_pages_total ?? 0}::${effective.readiness.dpu_rows_total ?? 0}::${effective.readiness.missing_pages_total ?? 0}`;

  return {
    ready: effective.ready,
    readiness: effective.readiness,
    blocked_reason: effective.blocked_reason,
    poll_after_ms: pollAfter,
    enqueued,
    action: dpuBackfillAction,
    docs_fingerprint: docsFingerprint,
  };
}
