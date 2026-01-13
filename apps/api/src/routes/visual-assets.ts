import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";
import { sanitizeText } from "@dealdecision/core";

type QueryResult<T> = { rows: T[]; rowCount?: number };
type VisualAssetsPool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

function requireDestructiveAuth(request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } {
  // Allow destructive operations in non-production by default to keep tests/dev simple.
  if (process.env.NODE_ENV !== "production") return { ok: true };

  const headers = (request?.headers ?? {}) as any;
  const token = headers["x-admin-token"] ?? headers["admin-token"];
  if (typeof token === "string" && token.length >= 12) return { ok: true };
  return { ok: false, status: 401, error: "Missing admin token" };
}

export async function registerVisualAssetRoutes(app: FastifyInstance, poolOverride?: any) {
  const pool = (poolOverride ?? getPool()) as VisualAssetsPool;

  app.post(
    "/visual-assets/:id/segment-override",
    {
      schema: {
        tags: ["visual-assets"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            segment_key: { type: "string" },
            note: { type: "string" },
          },
          required: ["segment_key"],
        },
      },
    },
    async (request, reply) => {
      const auth = requireDestructiveAuth(request);
      if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

      const idRaw = (request.params as any)?.id;
      const visualAssetId = sanitizeText(typeof idRaw === "string" ? idRaw : String(idRaw ?? ""));
      if (!visualAssetId) return reply.status(400).send({ error: "visual asset id is required" });

      const bodySchema = z
        .object({
          segment_key: z.string().min(1),
          note: z.string().max(2000).optional(),
        })
        .passthrough();
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });

      const segmentKey = sanitizeText(parsed.data.segment_key.trim());
      if (!segmentKey) return reply.status(400).send({ error: "segment_key is required" });
      const note = typeof parsed.data.note === "string" && parsed.data.note.trim().length > 0 ? parsed.data.note.trim() : null;

      const { rows } = await pool.query<{ id: string; quality_flags: any }>(
        "SELECT id, quality_flags FROM visual_assets WHERE id = $1",
        [visualAssetId]
      );
      const row = rows?.[0];
      if (!row) return reply.status(404).send({ error: "visual asset not found" });

      const existingFlags = row.quality_flags && typeof row.quality_flags === "object" ? row.quality_flags : {};
      const prior = {
        segment_key: existingFlags.segment_key ?? null,
        segment_source: existingFlags.segment_source ?? null,
        source: existingFlags.source ?? null,
        segment_confidence: existingFlags.segment_confidence ?? null,
        segment_promoted_at: existingFlags.segment_promoted_at ?? null,
        segment_overridden_at: existingFlags.segment_overridden_at ?? null,
        segment_override_note: existingFlags.segment_override_note ?? null,
      };

      const updatedFlags = {
        ...existingFlags,
        segment_override_prior: prior,
        segment_key: segmentKey,
        segment_source: "human_override",
        source: "human_override",
        segment_confidence: 1.0,
        segment_overridden_at: new Date().toISOString(),
        segment_override_note: note,
      };

      const updated = await pool.query<{ id: string; quality_flags: any }>(
        "UPDATE visual_assets SET quality_flags = $2 WHERE id = $1 RETURNING id, quality_flags",
        [visualAssetId, updatedFlags]
      );

      return reply.send({
        ok: true,
        visual_asset_id: visualAssetId,
        quality_flags: updated.rows?.[0]?.quality_flags ?? updatedFlags,
      });
    }
  );

  app.delete(
    "/visual-assets/:id/segment-override",
    {
      schema: {
        tags: ["visual-assets"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const auth = requireDestructiveAuth(request);
      if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

      const idRaw = (request.params as any)?.id;
      const visualAssetId = sanitizeText(typeof idRaw === "string" ? idRaw : String(idRaw ?? ""));
      if (!visualAssetId) return reply.status(400).send({ error: "visual asset id is required" });

      const { rows } = await pool.query<{ id: string; quality_flags: any }>(
        "SELECT id, quality_flags FROM visual_assets WHERE id = $1",
        [visualAssetId]
      );
      const row = rows?.[0];
      if (!row) return reply.status(404).send({ error: "visual asset not found" });

      const existingFlags = row.quality_flags && typeof row.quality_flags === "object" ? row.quality_flags : {};
      const prior = existingFlags.segment_override_prior && typeof existingFlags.segment_override_prior === "object" ? existingFlags.segment_override_prior : null;

      const restoredFlags: any = { ...existingFlags };
      delete restoredFlags.segment_override_prior;
      delete restoredFlags.segment_overridden_at;
      delete restoredFlags.segment_override_note;

      const restoreOrDelete = (key: string, value: any) => {
        if (value === null || typeof value === "undefined") delete restoredFlags[key];
        else restoredFlags[key] = value;
      };

      if (prior) {
        restoreOrDelete("segment_key", prior.segment_key);
        restoreOrDelete("segment_source", prior.segment_source);
        restoreOrDelete("source", prior.source);
        restoreOrDelete("segment_confidence", prior.segment_confidence);
        restoreOrDelete("segment_promoted_at", prior.segment_promoted_at);
      } else {
        // If no prior exists, remove the override keys but keep any other quality flags.
        delete restoredFlags.segment_key;
        delete restoredFlags.segment_source;
        delete restoredFlags.source;
        delete restoredFlags.segment_confidence;
        delete restoredFlags.segment_promoted_at;
      }

      const updated = await pool.query<{ id: string; quality_flags: any }>(
        "UPDATE visual_assets SET quality_flags = $2 WHERE id = $1 RETURNING id, quality_flags",
        [visualAssetId, restoredFlags]
      );

      return reply.send({
        ok: true,
        visual_asset_id: visualAssetId,
        quality_flags: updated.rows?.[0]?.quality_flags ?? restoredFlags,
      });
    }
  );
}
