import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Document } from "@dealdecision/contracts";
import { sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";
import { insertEvidence } from "../services/evidence";
import { enqueueJob } from "../services/jobs";
import { autoProgressDealStage } from "../services/stageProgression";
import { normalizeDealName } from "../lib/normalize-deal-name";

async function hasTable(pool: ReturnType<typeof getPool>, table: string) {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass($1) as oid",
      [table]
    );
    return rows[0]?.oid !== null;
  } catch {
    return false;
  }
}

const documentTypeSchema = z
  .enum([
    "pitch_deck",
    "financials",
    "product",
    "legal",
    "team",
    "market",
    "other",
  ])
  .optional();

type DocumentRow = {
  id: string;
  deal_id: string;
  title: string;
  type: Document["type"] | null;
  status: Document["status"];
  uploaded_at: string;
};

function mapDocument(row: DocumentRow): Document {
  return {
    document_id: row.id,
    deal_id: row.deal_id,
    title: row.title,
    type: row.type ?? "other",
    status: row.status,
    uploaded_at: new Date(row.uploaded_at).toISOString(),
  } as Document;
}

type ExtractionRecommendedAction = "proceed" | "remediate" | "re_extract" | "wait";
type ConfidenceBand = "high" | "medium" | "low" | "unknown";

const EXTRACTION_CONFIDENCE_THRESHOLDS = {
  high: 0.9,
  medium: 0.75,
} as const;

function getOverallScore(verificationResult: any): number | null {
  const score = verificationResult?.overall_score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function toConfidenceBand(score: number | null): ConfidenceBand {
  if (score === null) return "unknown";
  if (score >= EXTRACTION_CONFIDENCE_THRESHOLDS.high) return "high";
  if (score >= EXTRACTION_CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

function recommendActionForDocument(args: {
  verificationStatus: string;
  score: number | null;
  hasWarnings: boolean;
  hasRecommendations: boolean;
}): { recommended_action: ExtractionRecommendedAction; reason: string } {
  const { verificationStatus, score } = args;

  if (!verificationStatus || verificationStatus === "pending") {
    return { recommended_action: "wait", reason: "Verification has not completed" };
  }

  if (verificationStatus === "failed") {
    return {
      recommended_action: "re_extract",
      reason: "Verification failed; extraction confidence is insufficient",
    };
  }

  if (verificationStatus === "warnings") {
    // Warnings can be acceptable for many documents (e.g., short docs or limited structure).
    // If the confidence score is at least medium, allow proceeding while still surfacing the warnings.
    if (score !== null && score >= EXTRACTION_CONFIDENCE_THRESHOLDS.medium) {
      return {
        recommended_action: "proceed",
        reason: `Warnings present but extraction confidence is acceptable (score ${score.toFixed(2)}); proceed`,
      };
    }

    return {
      recommended_action: "remediate",
      reason: "Verification warnings present; remediate artifacts and re-verify",
    };
  }

  if (score === null) {
    return {
      recommended_action: "remediate",
      reason: "Missing confidence score; review or remediate extraction artifacts",
    };
  }

  const band = toConfidenceBand(score);
  if (band === "high" || band === "medium") {
    return {
      recommended_action: "proceed",
      reason: band === "high" ? "High confidence extraction" : `Verified extraction (score ${score.toFixed(2)}); proceed`,
    };
  }

  if (band === "low") {
    return {
      recommended_action: "re_extract",
      reason: `Low confidence extraction (score ${score.toFixed(2)}); re-extraction is recommended`,
    };
  }

  return {
    recommended_action: "remediate",
    reason: "Missing/unknown confidence; remediate artifacts and re-verify",
  };
}

function buildDocumentExtractionReport(d: any) {
  const verificationResult = d.verification_result as any;
  const score = getOverallScore(verificationResult);
  const warnings = Array.isArray(verificationResult?.warnings) ? verificationResult.warnings : [];
  const recommendations = Array.isArray(verificationResult?.recommendations)
    ? verificationResult.recommendations
    : [];

  const action = recommendActionForDocument({
    verificationStatus: d.verification_status || "pending",
    score,
    hasWarnings: warnings.length > 0,
    hasRecommendations: recommendations.length > 0,
  });

  return {
    id: d.id,
    title: d.title,
    type: d.type,
    status: d.status,
    verification_status: d.verification_status || "pending",
    pages: d.page_count || 0,
    file_size_bytes: d.extraction_metadata?.fileSizeBytes || 0,
    extraction_quality_score: score,
    confidence_band: toConfidenceBand(score),
    ocr_avg_confidence: verificationResult?.quality_checks?.ocr_confidence?.avg ?? null,
    verification_warnings: warnings,
    verification_recommendations: recommendations,
    recommended_action: action.recommended_action,
    recommendation_reason: action.reason,
  };
}

function buildDealExtractionReport(args: {
  dealId: string;
  documents: Array<ReturnType<typeof buildDocumentExtractionReport>>;
  totalPages: number;
}) {
  const { dealId, documents, totalPages } = args;

  const completed = documents.filter((d) => d.verification_status !== "pending");
  const failed = documents.filter((d) => d.verification_status === "failed");
  const anyWait = documents.some((d) => d.recommended_action === "wait");
  const anyReextract = documents.some((d) => d.recommended_action === "re_extract");
  const anyRemediate = documents.some((d) => d.recommended_action === "remediate");

  const weightedScore = documents.reduce(
    (acc, d) => {
      const weight = d.pages > 0 ? d.pages : 1;
      const score = typeof d.extraction_quality_score === "number" ? d.extraction_quality_score : null;
      if (score === null) return acc;
      return { sum: acc.sum + score * weight, weight: acc.weight + weight };
    },
    { sum: 0, weight: 0 }
  );

  const overallScore = weightedScore.weight > 0 ? weightedScore.sum / weightedScore.weight : null;
  const confidenceBand = toConfidenceBand(overallScore);

  let recommended_action: ExtractionRecommendedAction = "proceed";
  let recommendation_reason = "High confidence across documents";

  if (anyWait) {
    recommended_action = "wait";
    recommendation_reason = "Some documents are still processing";
  } else if (failed.length > 0 || anyReextract) {
    recommended_action = "re_extract";
    recommendation_reason = "At least one document has low confidence or failed verification";
  } else if (anyRemediate) {
    recommended_action = "remediate";
    recommendation_reason = "Some documents have warnings or medium confidence";
  }

  return {
    deal_id: dealId,
    overall_confidence_score: overallScore,
    confidence_band: confidenceBand,
    thresholds: {
      high: EXTRACTION_CONFIDENCE_THRESHOLDS.high,
      medium: EXTRACTION_CONFIDENCE_THRESHOLDS.medium,
    },
    counts: {
      total_documents: documents.length,
      completed_verification: completed.length,
      failed_verification: failed.length,
      total_pages: totalPages,
      high_confidence: documents.filter((d) => d.confidence_band === "high").length,
      medium_confidence: documents.filter((d) => d.confidence_band === "medium").length,
      low_confidence: documents.filter((d) => d.confidence_band === "low").length,
      unknown_confidence: documents.filter((d) => d.confidence_band === "unknown").length,
    },
    recommended_action,
    recommendation_reason,
    note:
      recommended_action === "re_extract"
        ? "True re-extraction requires original file bytes or storage keys to be available."
        : null,
  };
}

export async function registerDocumentRoutes(app: FastifyInstance, pool = getPool()) {
  app.get(
    "/api/v1/deals/:deal_id/documents/:document_id/visual-assets",
    {
      schema: {
        description: "List visual assets extracted for a document (safe no-op if visual tables are missing).",
        tags: ["documents"],
        params: {
          type: "object",
          properties: {
            deal_id: { type: "string" },
            document_id: { type: "string" },
          },
          required: ["deal_id", "document_id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              deal_id: { type: "string" },
              document_id: { type: "string" },
              assets: { type: "array", items: { type: "object", additionalProperties: true } },
              warnings: { type: "array", items: { type: "string" } },
            },
            required: ["deal_id", "document_id", "assets", "warnings"],
          },
        },
      },
    },
    async (request, reply) => {
    const dealId = sanitizeText((request.params as any)?.deal_id);
    const documentId = sanitizeText((request.params as any)?.document_id);
    const warnings: string[] = [];

    if (!dealId) {
      return reply.status(400).send({ error: "deal_id is required" });
    }
    if (!documentId) {
      return reply.status(400).send({ error: "document_id is required" });
    }

    // Enforce scoping consistent with other document endpoints.
    const existing = await pool.query<{ id: string }>(
      `SELECT id
         FROM documents
        WHERE deal_id = $1 AND id = $2
        LIMIT 1`,
      [dealId, documentId]
    );
    if (!existing.rows.length) {
      return reply.status(404).send({ error: "Document not found" });
    }

    // Safety: if the visual lane tables are not installed, this endpoint returns an empty response.
    const assetsOk = await hasTable(pool, "public.visual_assets");
    const extractionsOk = await hasTable(pool, "public.visual_extractions");
    const evidenceOk = await hasTable(pool, "public.evidence_links");

    if (!assetsOk || !extractionsOk || !evidenceOk) {
      warnings.push("visual extraction tables not installed");
      request.log.info(
        {
          request_id: (request as any).id,
          deal_id: dealId,
          document_id: documentId,
          counts: { assets: 0 },
          warnings_count: warnings.length,
        },
        "document.visual_assets"
      );
      return reply.send({ deal_id: dealId, document_id: documentId, assets: [], warnings });
    }

    type Row = {
      id: string;
      page_index: number;
      asset_type: string;
      bbox: any;
      image_uri: string | null;
      image_hash: string | null;
      extractor_version: string;
      confidence: number | string;
      quality_flags: any;
      created_at: string;

      extraction_id: string | null;
      ocr_text: string | null;
      ocr_blocks: any;
      structured_json: any;
      units: string | null;
      labels: any;
      model_version: string | null;
      extraction_confidence: number | string | null;
      extraction_created_at: string | null;

      evidence_count: number;
      evidence_sample_snippets: string[] | null;
    };

    // Simplest stable behavior: return a single "latest_extraction" per visual asset
    // (latest by visual_extractions.created_at), regardless of extractor_version.
    const { rows } = await pool.query<Row>(
      `WITH latest_extractions AS (
         SELECT
           ve.*,
           ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
         FROM visual_extractions ve
       )
       SELECT
         va.id,
         va.page_index,
         va.asset_type,
         va.bbox,
         va.image_uri,
         va.image_hash,
         va.extractor_version,
         va.confidence,
         va.quality_flags,
         va.created_at,
         le.id AS extraction_id,
         le.ocr_text,
         le.ocr_blocks,
         le.structured_json,
         le.units,
         le.labels,
         le.model_version,
         le.confidence AS extraction_confidence,
         le.created_at AS extraction_created_at,
         COALESCE(ev.count, 0) AS evidence_count,
         COALESCE(ev.sample_snippets, ARRAY[]::text[]) AS evidence_sample_snippets
       FROM visual_assets va
       LEFT JOIN latest_extractions le
         ON le.visual_asset_id = va.id AND le.rn = 1
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS count,
           ARRAY(
             SELECT LEFT(el2.snippet, 200)
             FROM evidence_links el2
             WHERE el2.visual_asset_id = va.id
               AND el2.snippet IS NOT NULL
               AND el2.snippet <> ''
             ORDER BY el2.created_at DESC
             LIMIT 3
           ) AS sample_snippets
         FROM evidence_links el
         WHERE el.visual_asset_id = va.id
       ) ev ON true
       JOIN documents d ON d.id = va.document_id
       WHERE d.deal_id = $1
         AND va.document_id = $2
       ORDER BY va.page_index ASC, va.created_at ASC`,
      [dealId, documentId]
    );

    const assets = rows.map((r) => {
      const createdAt = new Date(r.created_at).toISOString();
      const extractionCreatedAt = r.extraction_created_at ? new Date(r.extraction_created_at).toISOString() : null;
      const confidence = Number(r.confidence);
      const extractionConfidence = r.extraction_confidence == null ? null : Number(r.extraction_confidence);

      return {
        id: r.id,
        page_index: r.page_index,
        asset_type: r.asset_type,
        bbox: r.bbox ?? {},
        image_uri: r.image_uri,
        image_hash: r.image_hash,
        extractor_version: r.extractor_version,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        quality_flags: r.quality_flags ?? {},
        created_at: createdAt,
        latest_extraction: r.extraction_id
          ? {
              id: r.extraction_id,
              ocr_text: r.ocr_text,
              ocr_blocks: r.ocr_blocks ?? [],
              structured_json: r.structured_json ?? {},
              units: r.units,
              labels: r.labels ?? {},
              model_version: r.model_version,
              confidence: extractionConfidence != null && Number.isFinite(extractionConfidence) ? extractionConfidence : 0,
              created_at: extractionCreatedAt,
            }
          : null,
        evidence: {
          count: Number.isFinite(r.evidence_count) ? r.evidence_count : 0,
          sample_snippets: Array.isArray(r.evidence_sample_snippets) ? r.evidence_sample_snippets : [],
        },
      };
    });

    request.log.info(
      {
        request_id: (request as any).id,
        deal_id: dealId,
        document_id: documentId,
        counts: { assets: assets.length },
        warnings_count: warnings.length,
      },
      "document.visual_assets"
    );

    return reply.send({ deal_id: dealId, document_id: documentId, assets, warnings });
  });

  // JSON upload helper for automated tests (accepts base64 payload)
  app.post("/api/v1/deals/:deal_id/documents/upload", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const payload = request.body as {
      file_buffer?: string;
      file_name?: string;
      type?: string;
      title?: string;
    };

    if (!payload?.file_buffer) {
      return reply.status(400).send({ error: "file_buffer is required" });
    }

    try {
      const fileBufferB64 = payload.file_buffer;
      const fileName = payload.file_name ?? "document";
      const docType = payload.type ?? "other";
      const titleValue = payload.title ?? fileName;

      const parsedType = documentTypeSchema.safeParse(docType);
      const finalType = parsedType.success ? parsedType.data : "other";

      // Check if document with this title already exists in this deal
      const { rows: existingDocs } = await pool.query<DocumentRow>(
        `SELECT id, deal_id, title, type, status, uploaded_at FROM documents
         WHERE deal_id = $1 AND LOWER(title) = LOWER($2)
         LIMIT 1`,
        [dealId, titleValue]
      );

      if (existingDocs.length > 0) {
        // Document already exists
        return reply.status(409).send({
          error: "Document with this title already exists in this deal",
          existing_document_id: existingDocs[0].id,
          document: mapDocument(existingDocs[0]),
        });
      }

      const { rows } = await pool.query<DocumentRow>(
        `INSERT INTO documents (deal_id, title, type, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, deal_id, title, type, status, uploaded_at`,
        [dealId, titleValue, finalType, "pending"]
      );

      const documentId = rows[0].id;

      const job = await enqueueJob({
        deal_id: dealId,
        document_id: documentId,
        type: "ingest_documents",
        payload: {
          document_id: documentId,
          deal_id: dealId,
          file_buffer: fileBufferB64,
          file_name: fileName,
          attempt: 1,
        },
      });

      const progressionResult = await autoProgressDealStage(pool, dealId);

      return reply.status(202).send({
        document_id: documentId,
        document: mapDocument(rows[0]),
        job_status: "queued",
        job_id: job.job_id,
        stage_progression: progressionResult.progressed
          ? { progressed: true, newStage: progressionResult.newStage }
          : { progressed: false },
      });
    } catch (error: any) {
      console.error("Document upload error:", error);
      return reply.status(500).send({
        error: "Failed to upload document",
        message: error?.message || "Unknown error",
      });
    }
  });

  app.post("/api/v1/deals/:deal_id/documents", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    let fileBuffer: Buffer | null = null;
    let fileName = "document";
    let docType: any = "other";
    let titleValue = "document";

    try {
      // Parse multipart form data
      const parts = (request as any).parts();
      for await (const part of parts) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          fileName = part.filename || "document";
        } else if (part.type === "field") {
          const fieldValue = typeof part.value === "string" ? part.value : String(part.value ?? "");
          if (part.fieldname === "type") {
            docType = fieldValue;
          } else if (part.fieldname === "title") {
            titleValue = fieldValue;
          }
        }
      }

      if (!fileBuffer) {
        return reply.status(400).send({ error: "file is required" });
      }

      // Validate document type
      const parsedType = documentTypeSchema.safeParse(docType);
      const finalType = parsedType.success ? parsedType.data : "other";

      const fileBufferB64 = fileBuffer.toString("base64");

      const { rows } = await pool.query<DocumentRow>(
        `INSERT INTO documents (deal_id, title, type, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, deal_id, title, type, status, uploaded_at`,
        [dealId, titleValue, finalType, "pending"]
      );

      const documentId = rows[0].id;

      // Queue document processing job with file buffer
      const job = await enqueueJob({
        deal_id: dealId,
        document_id: documentId,
        type: "ingest_documents",
        payload: {
          document_id: documentId,
          deal_id: dealId,
          file_buffer: fileBufferB64,
          file_name: fileName,
          attempt: 1,
        },
      });

      // Auto-check if deal should progress based on document count
      const progressionResult = await autoProgressDealStage(pool, dealId);

      return reply.status(202).send({
        document: mapDocument(rows[0]),
        job_status: "queued",
        job_id: job.job_id,
        stage_progression: progressionResult.progressed
          ? {
              progressed: true,
              newStage: progressionResult.newStage,
            }
          : {
              progressed: false,
            },
      });
    } catch (error: any) {
      console.error("Document upload error:", error);
      return reply.status(500).send({
        error: "Failed to upload document",
        message: error?.message || "Unknown error",
      });
    }
  });

  app.get("/api/v1/deals/:deal_id/documents", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const { rows } = await pool.query<DocumentRow>(
      `SELECT id, deal_id, title, type, status, uploaded_at
       FROM documents
       WHERE deal_id = $1
       ORDER BY uploaded_at DESC`,
      [dealId]
    );

    return reply.send({ documents: rows.map(mapDocument) });
  });

  app.delete("/api/v1/deals/:deal_id/documents/:document_id", async (request, reply) => {
    const { deal_id, document_id } = request.params as { deal_id: string; document_id: string };

    const existing = await pool.query<{ id: string }>(
      `SELECT id
         FROM documents
        WHERE deal_id = $1 AND id = $2
        LIMIT 1`,
      [deal_id, document_id]
    );

    if (!existing.rows.length) {
      return reply.status(404).send({ error: "Document not found" });
    }

    try {
      await pool.query("BEGIN");

      // Evidence rows don't FK to documents; clean up best-effort by document id.
      await pool.query(
        `DELETE FROM evidence
          WHERE deal_id = $1
            AND document_id = $2`,
        [deal_id, document_id]
      );

      const deleted = await pool.query<{ id: string }>(
        `DELETE FROM documents
          WHERE deal_id = $1 AND id = $2
          RETURNING id`,
        [deal_id, document_id]
      );

      await pool.query("COMMIT");

      if (!deleted.rows.length) {
        return reply.status(404).send({ error: "Document not found" });
      }

      return reply.send({ ok: true, deal_id, document_id: deleted.rows[0].id });
    } catch (error: any) {
      try {
        await pool.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      console.error("Document delete error:", error);
      return reply.status(500).send({ error: "Failed to delete document", message: error?.message || "Unknown error" });
    }
  });

  // Fetch stored analysis/structured data for a document
  app.get("/api/v1/deals/:deal_id/documents/:document_id/analysis", async (request, reply) => {
    const { deal_id, document_id } = request.params as { deal_id: string; document_id: string };

    const { rows } = await pool.query(
      `SELECT d.id,
              d.deal_id,
              d.status,
              d.structured_data,
              d.extraction_metadata,
              j.status AS job_status,
              j.message AS job_message,
              j.progress_pct AS job_progress
         FROM documents d
         LEFT JOIN LATERAL (
           SELECT status, message, progress_pct
             FROM jobs
            WHERE document_id = d.id
            ORDER BY updated_at DESC
            LIMIT 1
         ) j ON TRUE
        WHERE d.deal_id = $1 AND d.id = $2
        LIMIT 1`,
      [deal_id, document_id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Document not found" });
    }

    const doc = rows[0];
    return reply.send({
      document_id: doc.id,
      deal_id: doc.deal_id,
      status: doc.status,
      structured_data: doc.structured_data ?? null,
      extraction_metadata: doc.extraction_metadata ?? null,
      job_status: doc.job_status ?? null,
      job_message: doc.job_message ?? null,
      job_progress: doc.job_progress ?? null,
    });
  });

  app.post("/api/v1/deals/:deal_id/documents/:document_id/retry", async (request, reply) => {
    const { deal_id, document_id } = request.params as { deal_id: string; document_id: string };

    await pool.query(
      `UPDATE documents
       SET status = 'pending', uploaded_at = uploaded_at
       WHERE deal_id = $1 AND id = $2`,
      [deal_id, document_id]
    );

    // Retry now uses persisted original bytes (stored during initial ingestion).
    const job = await enqueueJob({
      deal_id,
      document_id,
      type: "reextract_documents",
      payload: { deal_id, document_ids: [document_id] },
    });

    return reply.status(202).send({ ok: true, job_id: job.job_id });
  });

  /**
   * True re-extraction from persisted original bytes.
   *
   * If document_ids omitted, re-extracts only failed/low-confidence documents.
   */
  app.post("/api/v1/deals/:deal_id/documents/re-extract", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const body = (request.body ?? {}) as {
      document_ids?: string[];
      threshold_low?: number;
      include_warnings?: boolean;
    };

    const job = await enqueueJob({
      deal_id: dealId,
      type: "reextract_documents",
      payload: {
        deal_id: dealId,
        document_ids: Array.isArray(body.document_ids) ? body.document_ids : undefined,
        threshold_low: typeof body.threshold_low === "number" ? body.threshold_low : undefined,
        include_warnings: Boolean(body.include_warnings),
      },
    });

    return reply.status(202).send({ ok: true, job_id: job.job_id });
  });

  /**
   * Analyze batch of documents for smart grouping
   * Accepts FormData with files and returns grouping suggestions
   */
  app.post("/api/v1/documents/analyze-batch", async (request, reply) => {
    // Get all deals for matching
    const dealsResult = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM deals ORDER BY name`,
    );
    const deals = dealsResult.rows;

    // Parse multipart form data
    const parts = (request as any).file();
    const filenames: string[] = [];

    // Unfortunately Fastify's file() returns a single file iterator
    // For batch analysis, we'll accept filenames via body and analyze them
    const body = request.body as { filenames?: string[]; dealId?: string };

    if (!body.filenames || body.filenames.length === 0) {
      return reply.status(400).send({
        error: "filenames are required",
        details: "Send array of filenames to analyze",
      });
    }

    // Analyze the filenames to detect groupings
    const analysis = analyzeFilenamesForGrouping(body.filenames, deals);

    return reply.send({
      analysis,
      deals: deals.map((d) => ({ id: d.id, name: d.name })),
    });
  });

  /**
   * Bulk upload and assign documents to deals
   * Handles document grouping, creates new deals if needed, and queues processing
   */
  app.post("/api/v1/documents/bulk-assign", async (request, reply) => {
    const body = request.body as {
      assignments: Array<{
        filename: string;
        dealId: string; // Existing deal ID
        type?: string;
      }>;
      newDeals?: Array<{
        filename: string;
        dealName: string; // Create new deal
        type?: string;
      }>;
    };

    const hasAssignments = Array.isArray(body.assignments) && body.assignments.length > 0;
    const hasNewDeals = Array.isArray(body.newDeals) && body.newDeals.length > 0;
    if (!hasAssignments && !hasNewDeals) {
      return reply.status(400).send({
        error: "assignments or newDeals are required",
      });
    }

    const results = [];

    // Note: Actual file upload and processing would happen in a separate step
    // This endpoint just records the assignments in the database
    if (hasAssignments) {
      for (const assignment of body.assignments) {
        results.push({
          filename: assignment.filename,
          dealId: assignment.dealId,
          status: "assigned",
          message: `File will be uploaded to deal ${assignment.dealId}`,
        });
      }
    }

    // Handle new deals if requested
    if (body.newDeals && body.newDeals.length > 0) {
      const { rows: existingDeals } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM deals WHERE deleted_at IS NULL`
      );

      for (const newDeal of body.newDeals) {
        const normalized = normalizeDealName(newDeal.dealName);
        const match = normalized
          ? existingDeals.find((d) => normalizeDealName(d.name) === normalized)
          : undefined;

        const dealId = match?.id ?? randomUUID();
        try {
          if (!match) {
            await pool.query(
              `INSERT INTO deals (id, name, stage, priority, updated_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [sanitizeText(dealId), sanitizeText(newDeal.dealName), "intake", "medium", new Date().toISOString()],
            );
          }

          results.push({
            filename: newDeal.filename,
            dealId,
            dealName: newDeal.dealName,
            status: match ? "deal_reused" : "deal_created",
            message: match
              ? `Matched existing deal "${match.name}" (${match.id})`
              : `New deal "${newDeal.dealName}" created`,
          });
        } catch (error) {
          results.push({
            filename: newDeal.filename,
            status: "error",
            message: `Failed to create deal: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }
    }

    return reply.status(202).send({
      assignments: results,
      message: "Documents have been assigned and are ready for upload",
    });
  });

  /**
   * Trigger ingestion report generation for a deal
   * Returns the latest ingestion summary status
   */
  app.get("/api/v1/deals/:deal_id/documents/ingestion-status", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    try {
      // Get all documents for this deal
      const { rows: documents } = await pool.query(
        `SELECT id, title, type, status, verification_status, verification_result,
                page_count, extraction_metadata, ingestion_summary
           FROM documents
           WHERE deal_id = $1
           ORDER BY uploaded_at DESC`,
        [dealId]
      );

      if (documents.length === 0) {
        return reply.status(404).send({ error: "No documents found for this deal" });
      }

      // Get verification status summary
      const verifiedCount = (documents as any[]).filter((d: any) => d.verification_status === "verified").length;
      const warningCount = (documents as any[]).filter((d: any) => d.verification_status === "warnings").length;
      const failedCount = (documents as any[]).filter((d: any) => d.verification_status === "failed").length;
      const pendingCount = (documents as any[]).filter((d: any) => !d.verification_status).length;

      // Get overall readiness
      let overallReadiness: "ready" | "needs_review" | "in_progress" | "failed" = "ready";
      let readinessDetails = "All documents verified and ready for analysis";

      if (pendingCount > 0) {
        overallReadiness = "in_progress";
        readinessDetails = `Processing ${pendingCount} document(s). Please wait...`;
      } else if (failedCount > 0) {
        overallReadiness = "failed";
        readinessDetails = `${failedCount} document(s) failed verification. Please review and re-upload.`;
      } else if (warningCount > 0) {
        overallReadiness = "needs_review";
        readinessDetails = `${warningCount} document(s) have warnings. Review before proceeding.`;
      }

      // Calculate aggregate metrics
      const totalPages = (documents as any[]).reduce((sum: number, d: any) => sum + (d.page_count || 0), 0);

      const documentReports = (documents as any[]).map((d: any) => buildDocumentExtractionReport(d));
      const dealReport = buildDealExtractionReport({ dealId, documents: documentReports, totalPages });

      return reply.send({
        deal_id: dealId,
        ingestion_status: {
          files_uploaded: documents.length,
          total_pages: totalPages,
          verification_summary: {
            verified: verifiedCount,
            warnings: warningCount,
            failed: failedCount,
            pending: pendingCount,
          },
          overall_readiness: overallReadiness,
          readiness_details: readinessDetails,
        },
        extraction_report: dealReport,
        documents: documentReports,
        last_updated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Ingestion status error:", error);
      return reply.status(500).send({
        error: "Failed to get ingestion status",
        message: error?.message || "Unknown error",
      });
    }
  });

  /**
   * Get an extraction report + confidence-based recommendations for a deal.
   * This is a pure read endpoint built from stored verification results.
   */
  app.get("/api/v1/deals/:deal_id/documents/extraction-report", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    try {
      const { rows: documents } = await pool.query(
        `SELECT id, title, type, status, verification_status, verification_result,
                page_count, extraction_metadata
           FROM documents
           WHERE deal_id = $1
           ORDER BY uploaded_at DESC`,
        [dealId]
      );

      if (documents.length === 0) {
        return reply.status(404).send({ error: "No documents found for this deal" });
      }

      const totalPages = (documents as any[]).reduce((sum: number, d: any) => sum + (d.page_count || 0), 0);
      const documentReports = (documents as any[]).map((d: any) => buildDocumentExtractionReport(d));
      const dealReport = buildDealExtractionReport({ dealId, documents: documentReports, totalPages });

      return reply.send({
        deal_id: dealId,
        extraction_report: dealReport,
        documents: documentReports,
        last_updated: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Extraction report error:", error);
      return reply.status(500).send({
        error: "Failed to get extraction report",
        message: error?.message || "Unknown error",
      });
    }
  });

  /**
   * Enqueue verification for documents in a deal.
   *
   * If document_ids omitted, verifies up to the most recent 200 documents in the deal.
   */
  app.post("/api/v1/deals/:deal_id/documents/verify", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const body = (request.body ?? {}) as { document_ids?: string[] };

    try {
      const requestedIds = Array.isArray(body.document_ids) ? body.document_ids.filter(Boolean) : null;

      let documentIds: string[] = [];

      if (requestedIds && requestedIds.length > 0) {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id
             FROM documents
            WHERE deal_id = $1
              AND id = ANY($2::uuid[])
            ORDER BY uploaded_at DESC`,
          [dealId, requestedIds]
        );

        documentIds = rows.map((r) => r.id);

        if (documentIds.length !== requestedIds.length) {
          return reply.status(400).send({
            error: "Some document_ids do not belong to this deal",
            requested: requestedIds.length,
            found: documentIds.length,
          });
        }
      } else {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id
             FROM documents
            WHERE deal_id = $1
            ORDER BY uploaded_at DESC
            LIMIT 200`,
          [dealId]
        );
        documentIds = rows.map((r) => r.id);
      }

      if (documentIds.length === 0) {
        return reply.status(404).send({ error: "No documents found for this deal" });
      }

      const job = await enqueueJob({
        deal_id: dealId,
        type: "verify_documents",
        payload: { deal_id: dealId, document_ids: documentIds },
      });

      return reply.status(202).send({
        ok: true,
        deal_id: dealId,
        job_id: job.job_id,
        status: job.status,
        document_count: documentIds.length,
      });
    } catch (error: any) {
      console.error("Verify documents enqueue error:", error);
      return reply.status(500).send({
        error: "Failed to enqueue verification",
        message: error?.message || "Unknown error",
      });
    }
  });

  /**
   * Get detailed verification result for a specific document
   */
  app.get("/api/v1/deals/:deal_id/documents/:document_id/verification", async (request, reply) => {
    const { deal_id, document_id } = request.params as { deal_id: string; document_id: string };

    try {
      const { rows } = await pool.query(
        `SELECT id, title, type, status, verification_status, verification_result,
                structured_data, extraction_metadata, page_count
           FROM documents
           WHERE deal_id = $1 AND id = $2`,
        [deal_id, document_id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Document not found" });
      }

      const doc = rows[0] as any;
      const verificationResult = doc.verification_result as any;
      const structuredData = doc.structured_data as any;

      return reply.send({
        document_id: doc.id,
        title: doc.title,
        type: doc.type,
        status: doc.status,
        verification_status: doc.verification_status || "pending",
        pages: doc.page_count || 0,
        metrics_extracted: structuredData?.keyMetrics?.length || 0,
        sections_found: structuredData?.mainHeadings?.length || 0,
        verification_result: verificationResult || {
          message: "Verification in progress or not yet started",
        },
      });
    } catch (error: any) {
      console.error("Verification details error:", error);
      return reply.status(500).send({
        error: "Failed to get verification details",
        message: error?.message || "Unknown error",
      });
    }
  });
}

/**
 * Analyze filenames to detect company groupings and match to existing deals
 */
function analyzeFilenamesForGrouping(
  filenames: string[],
  deals: Array<{ id: string; name: string }>,
) {
  const groups = new Map<string, { filenames: string[]; type: string }>();
  const duplicates: Array<{ company: string; files: string[] }> = [];

  for (const filename of filenames) {
    const company = extractCompanyNameFromFilename(filename);
    const docType = detectDocTypeFromFilename(filename);

    if (!groups.has(company)) {
      groups.set(company, { filenames: [], type: docType });
    }

    const group = groups.get(company)!;
    group.filenames.push(filename);

    // Detect if multiple files of same type = duplicates
    if (group.filenames.length > 1) {
      const typesInGroup = group.filenames.map(detectDocTypeFromFilename);
      if (typesInGroup.filter((t) => t === docType).length > 1) {
        duplicates.push({ company, files: group.filenames });
      }
    }
  }

  // Match groups to deals
  const groupedResults = Array.from(groups.entries()).map(([company, group]) => {
    const matchedDeal = deals.find((d) => d.name.toLowerCase() === company.toLowerCase());
    return {
      company,
      files: group.filenames,
      fileCount: group.filenames.length,
      documentType: group.type,
      dealId: matchedDeal?.id,
      dealName: matchedDeal?.name,
      status: matchedDeal ? "matched" : "new",
      confidence: matchedDeal ? 1.0 : 0,
    };
  });

  return {
    groups: groupedResults,
    duplicates,
    summary: {
      totalFiles: filenames.length,
      totalGroups: groups.size,
      matched: groupedResults.filter((g) => g.status === "matched").length,
      new: groupedResults.filter((g) => g.status === "new").length,
      duplicateGroups: duplicates.length,
    },
  };
}

/**
 * Extract company name from filename (simplified version of frontend utility)
 */
function extractCompanyNameFromFilename(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, "");

  // Pattern: "PD - CompanyName - ..." or "BP - CompanyName - ..."
  const prefixMatch = nameWithoutExt.match(/^(?:PD|BP|WP|Financials)\s*-\s*([^-]+?)(?:\s*-|$)/);
  if (prefixMatch) {
    return prefixMatch[1].trim();
  }

  // If no prefix, try context-based extraction
  const contextMatch = nameWithoutExt.match(
    /^([^D]+?)(?:\s+Deck|\s+Fund|\s+Series|\s+Raise|\s+Valuation|\s+Overview)/i,
  );
  if (contextMatch) {
    return contextMatch[1].trim();
  }

  // Fallback
  let result = nameWithoutExt
    .replace(/\s*(v\d+|edits?|version|v[0-9a-z]+).*$/i, "")
    .trim();

  return result || "Unknown";
}

/**
 * Detect document type from filename
 */
function detectDocTypeFromFilename(filename: string): string {
  const nameLower = filename.toLowerCase();

  if (nameLower.includes("pd -") || nameLower.includes("pitch")) return "pitch_deck";
  if (nameLower.includes("bp -") || nameLower.includes("business plan")) return "business_plan";
  if (nameLower.includes("wp -") || nameLower.includes("whitepaper")) return "whitepaper";
  if (nameLower.includes("financials") || nameLower.includes("valuation")) return "financials";

  return "other";
}
