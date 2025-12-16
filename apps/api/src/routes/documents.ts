import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Document } from "@dealdecision/contracts";
import { getPool } from "../lib/db";
import { insertEvidence } from "../services/evidence";
import { enqueueJob } from "../services/jobs";

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
  document_id: string;
  deal_id: string;
  title: string;
  type: Document["type"] | null;
  status: Document["status"];
  uploaded_at: string;
};

function mapDocument(row: DocumentRow): Document {
  return {
    document_id: row.document_id,
    deal_id: row.deal_id,
    title: row.title,
    type: row.type ?? "other",
    status: row.status,
    uploaded_at: new Date(row.uploaded_at).toISOString(),
  } as Document;
}

export async function registerDocumentRoutes(app: FastifyInstance, pool = getPool()) {
  app.post("/api/v1/deals/:deal_id/documents", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({ error: "file is required" });
    }

    const typeField = (file.fields as any)?.type?.value as string | undefined;
    const titleField = (file.fields as any)?.title?.value as string | undefined;
    const parsedType = documentTypeSchema.safeParse(typeField);
    const docType = parsedType.success ? parsedType.data : "other";

    // Drain the stream and capture a short excerpt for evidence
    const buffer = await file.toBuffer();
    const rawText = buffer.toString("utf8");
    const excerpt = rawText.trim().replace(/\s+/g, " ").slice(0, 500) || undefined;

    const documentId = randomUUID();
    const title = titleField || file.filename || "document";

    const { rows } = await pool.query<DocumentRow>(
      `INSERT INTO documents (document_id, deal_id, title, type, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING document_id, deal_id, title, type, status, uploaded_at`,
      [documentId, dealId, title, docType, "pending"]
    );

    if (excerpt) {
      await insertEvidence({
        deal_id: dealId,
        document_id: documentId,
        source: "upload",
        kind: "document",
        text: title,
        excerpt,
      });
    }

    await enqueueJob({
      deal_id: dealId,
      document_id: documentId,
      type: "ingest_documents",
      payload: { document_id: documentId },
    });

    return reply.status(202).send({
      document: mapDocument(rows[0]),
      job_status: "queued",
    });
  });

  app.get("/api/v1/deals/:deal_id/documents", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const { rows } = await pool.query<DocumentRow>(
      `SELECT document_id, deal_id, title, type, status, uploaded_at
       FROM documents
       WHERE deal_id = $1
       ORDER BY uploaded_at DESC`,
      [dealId]
    );

    return reply.send({ documents: rows.map(mapDocument) });
  });

  app.post("/api/v1/deals/:deal_id/documents/:document_id/retry", async (request, reply) => {
    const { deal_id, document_id } = request.params as { deal_id: string; document_id: string };

    await pool.query(
      `UPDATE documents
       SET status = 'pending', uploaded_at = uploaded_at
       WHERE deal_id = $1 AND document_id = $2`,
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
}