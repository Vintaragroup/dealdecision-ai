/**
 * PDF Export API routes
 *
 * POST /api/v1/deals/:deal_id/report/export-pdf
 *   Accepts a ReportExportConfig, creates a deal_report_exports row, enqueues
 *   an export_report_pdf BullMQ job, and returns { ok, export_id, job_id }.
 *
 * GET  /api/v1/deals/:deal_id/report/export-pdf/:export_id
 *   Polls the status of a specific export job.
 *   Returns { status } | { status: 'completed', download_url, r2_key } | { status: 'failed', error_message }
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { getQueues } from "../lib/queue";
import type {
  ReportExportConfig,
  ExportPdfResponse,
  ExportPdfStatusResponse,
} from "@dealdecision/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Config validator (mirrors the UI-side ReportExportConfig shape)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_KEYS = [
  "decision_overlay",
  "executive_summary",
  "deal_terms",
  "market_analysis",
  "financial_analysis",
  "risk_verification",
  "evidence_appendix",
] as const;

const reportExportConfigSchema = z.object({
  preset: z.enum(["complete", "investor", "quick", "custom"]),
  format: z.enum(["standard", "pdf", "word"]),
  sections: z
    .array(z.enum(SECTION_KEYS))
    .min(1, "At least one section is required"),
  includeCoverPage: z.boolean().optional(),
  includePageNumbers: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function getUserId(request: FastifyRequest): string | null {
  const auth = (request as any)?.auth as { userId?: string | null } | undefined;
  const uid = auth?.userId;
  return typeof uid === "string" && uid.trim().length > 0 ? uid.trim() : null;
}

export interface ExportPdfRouteDeps {
  pool?: Pool;
  exportReportPdfQueue?: { add: (...args: any[]) => Promise<any> };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

export async function registerExportPdfRoutes(
  app: FastifyInstance,
  pool: Pool,
  deps: ExportPdfRouteDeps = {}
): Promise<void> {

  // ── POST /api/v1/deals/:deal_id/report/export-pdf ───────────────────────

  app.post<{ Params: { deal_id: string }; Body: { config?: unknown } }>(
    "/api/v1/deals/:deal_id/report/export-pdf",
    async (request, reply) => {
      const { deal_id: rawDealId } = request.params;

      if (!isUuid(rawDealId)) {
        return reply.status(400).send({ error: "invalid_deal_id", message: "deal_id must be a UUID" });
      }
      const dealId = rawDealId;

      // Validate config
      const configParsed = reportExportConfigSchema.safeParse(
        (request.body as any)?.config
      );
      if (!configParsed.success) {
        return reply.status(400).send({
          error: "invalid_config",
          message: "config validation failed",
          issues: configParsed.error.issues,
        });
      }
      const config: ReportExportConfig = configParsed.data;

      // Auth: get userId (optional — allowed anonymous in dev)
      const userId = getUserId(request);

      // Verify deal exists
      const db = deps.pool ?? pool;
      const { rows: dealRows } = await db.query<{ id: string }>(
        "SELECT id FROM deals WHERE id = $1 LIMIT 1",
        [dealId]
      );
      if (dealRows.length === 0) {
        return reply.status(404).send({ error: "deal_not_found" });
      }

      // Create export row
      const exportId = randomUUID();
      const jobId = `export_report_pdf__${dealId}__${exportId}`;

      await db.query(
        `INSERT INTO deal_report_exports
           (id, deal_id, requested_by, status, export_config, job_id)
         VALUES ($1, $2, $3, 'pending', $4::jsonb, $5)`,
        [exportId, dealId, userId, JSON.stringify(config), jobId]
      );

      // Enqueue BullMQ job
      const queue =
        deps.exportReportPdfQueue ??
        (getQueues().exportReportPdfQueue as any);

      try {
        await queue.add(
          "export_report_pdf",
          {
            deal_id: dealId,
            export_id: exportId,
            config,
            requested_by: userId,
          },
          { jobId, removeOnComplete: true, removeOnFail: false }
        );
      } catch (err) {
        app.log.error(err, "[export-pdf] enqueue failed");
        // Mark export as failed immediately so UI can show error
        await db
          .query(
            `UPDATE deal_report_exports
             SET status = 'failed', error_message = $2, updated_at = now()
             WHERE id = $1`,
            [exportId, err instanceof Error ? err.message : String(err)]
          )
          .catch(() => undefined); // best-effort
        return reply.status(500).send({ error: "enqueue_failed" });
      }

      const body: ExportPdfResponse = {
        ok: true,
        export_id: exportId,
        job_id: jobId,
        status: "pending",
      };
      return reply.status(202).send(body);
    }
  );

  // ── GET /api/v1/deals/:deal_id/report/export-pdf/:export_id ────────────

  app.get<{ Params: { deal_id: string; export_id: string } }>(
    "/api/v1/deals/:deal_id/report/export-pdf/:export_id",
    async (request, reply) => {
      const { deal_id: rawDealId, export_id: rawExportId } = request.params;

      if (!isUuid(rawDealId) || !isUuid(rawExportId)) {
        return reply.status(400).send({ error: "invalid_params" });
      }

      const db = deps.pool ?? pool;
      const { rows } = await db.query<{
        status: string;
        r2_key: string | null;
        download_url: string | null;
        error_message: string | null;
      }>(
        `SELECT status, r2_key, download_url, error_message
         FROM deal_report_exports
         WHERE id = $1 AND deal_id = $2
         LIMIT 1`,
        [rawExportId, rawDealId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "not_found" });
      }

      const row = rows[0];
      let body: ExportPdfStatusResponse;

      if (row.status === "completed" && row.download_url) {
        body = { status: "completed", download_url: row.download_url, r2_key: row.r2_key ?? "" };
      } else if (row.status === "failed") {
        body = { status: "failed", error_message: row.error_message };
      } else {
        body = { status: row.status as "pending" | "processing" };
      }

      return reply.status(200).send(body);
    }
  );

  // ── GET /api/v1/deals/:deal_id/report/exports (list) ───────────────────
  // Returns the 10 most recent export jobs for a deal (useful for UI history).

  app.get<{ Params: { deal_id: string } }>(
    "/api/v1/deals/:deal_id/report/exports",
    async (request, reply) => {
      const { deal_id: rawDealId } = request.params;

      if (!isUuid(rawDealId)) {
        return reply.status(400).send({ error: "invalid_deal_id" });
      }

      const db = deps.pool ?? pool;
      const { rows } = await db.query<{
        id: string;
        status: string;
        export_config: unknown;
        download_url: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, status, export_config, download_url, error_message, created_at, updated_at
         FROM deal_report_exports
         WHERE deal_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [rawDealId]
      );

      return reply.status(200).send({ ok: true, exports: rows });
    }
  );
}
