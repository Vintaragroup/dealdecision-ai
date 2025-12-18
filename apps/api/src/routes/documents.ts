import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Document } from "@dealdecision/contracts";
import { getPool } from "../lib/db";
import { insertEvidence } from "../services/evidence";
import { enqueueJob } from "../services/jobs";
import { autoProgressDealStage } from "../services/stageProgression";

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

export async function registerDocumentRoutes(app: FastifyInstance, pool = getPool()) {
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
        type: "ingest_document",
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
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          fileName = part.filename || "document";
        } else if (part.type === "field") {
          const fieldValue = part.value;
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
        type: "ingest_document",
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

    await enqueueJob({
      deal_id,
      document_id,
      type: "ingest_documents",
      payload: { document_id },
    });

    return reply.status(202).send({ ok: true });
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
    const parts = request.file();
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

    if (!body.assignments || body.assignments.length === 0) {
      return reply.status(400).send({
        error: "assignments are required",
      });
    }

    const results = [];

    // Note: Actual file upload and processing would happen in a separate step
    // This endpoint just records the assignments in the database
    for (const assignment of body.assignments) {
      results.push({
        filename: assignment.filename,
        dealId: assignment.dealId,
        status: "assigned",
        message: `File will be uploaded to deal ${assignment.dealId}`,
      });
    }

    // Handle new deals if requested
    if (body.newDeals && body.newDeals.length > 0) {
      for (const newDeal of body.newDeals) {
        const dealId = randomUUID();
        try {
          await pool.query(
            `INSERT INTO deals (id, name, stage, priority, updated_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [dealId, newDeal.dealName, "intake", "medium", new Date().toISOString()],
          );

          results.push({
            filename: newDeal.filename,
            dealId,
            dealName: newDeal.dealName,
            status: "deal_created",
            message: `New deal "${newDeal.dealName}" created`,
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