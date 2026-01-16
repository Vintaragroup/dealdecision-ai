import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "crypto";
import { z } from "zod";
import { getPool } from "../lib/db";
import { sanitizeText } from "@dealdecision/core";
import { compactForAiSource } from "../lib/ai-compact";

type OpenAIChatCompletionResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

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

  // In-process guardrails (best-effort; resets on restart).
  const aiAnalyzeRateState = new Map<string, { windowStartMs: number; count: number }>();
  const AI_ANALYZE_WINDOW_MS = 60_000;
  const AI_ANALYZE_MAX_PER_WINDOW = (() => {
    const v = process.env.AI_ANALYZE_RPM;
    const parsed = typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  })();

  function requireAiAnalyzeAuth(request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } {
    const required = process.env.AI_ANALYZE_TOKEN;
    if (!required || required.trim().length === 0) return { ok: true };
    const headers = (request?.headers ?? {}) as any;
    const token = headers["x-ai-analyze-token"] ?? headers["ai-analyze-token"];
    if (typeof token === "string" && token === required) return { ok: true };
    return { ok: false, status: 401, error: "Missing or invalid AI analyze token" };
  }

  function checkAiAnalyzeRateLimit(request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } {
    const key = String((request as any)?.ip ?? (request as any)?.headers?.["x-forwarded-for"] ?? "unknown");
    const now = Date.now();
    const cur = aiAnalyzeRateState.get(key);
    if (!cur || now - cur.windowStartMs >= AI_ANALYZE_WINDOW_MS) {
      aiAnalyzeRateState.set(key, { windowStartMs: now, count: 1 });
      return { ok: true };
    }
    if (cur.count >= AI_ANALYZE_MAX_PER_WINDOW) {
      return { ok: false, status: 429, error: `AI analyze rate limit exceeded (${AI_ANALYZE_MAX_PER_WINDOW}/min)` };
    }
    cur.count += 1;
    return { ok: true };
  }

  function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  const analyzeBodySchema = z
    .object({
      audience: z.enum(["investor", "analyst"]),
      question: z.string().max(2000).optional(),
      force: z.boolean().optional(),
    })
    .passthrough();

  const modelOutputSchema = z
    .object({
      audience: z.enum(["investor", "analyst"]),
      title: z.string().optional().nullable(),
      answer_markdown: z.string().min(1),
      evidence: z
        .array(
          z
            .object({
              path: z.string().min(1),
              value: z.any().optional().nullable(),
              note: z.string().optional().nullable(),
            })
            .passthrough()
        )
        .optional()
        .default([]),
      limitations: z.array(z.string()).optional().default([]),
      followups: z.array(z.string()).optional().default([]),
    })
    .passthrough();

  // NOTE: structured_json compaction lives in ../lib/ai-compact.ts so it can be reused
  // across routes and supports OCR-only assets as a fallback.

  async function openaiChatCompletion(params: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature: number;
    maxTokens: number;
  }): Promise<{ content: string; model: string; usage?: OpenAIChatCompletionResponse["usage"] }>{
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `OpenAI request failed with ${res.status}`);
    }

    const json = (await res.json()) as OpenAIChatCompletionResponse;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("OpenAI returned empty content");
    }
    return { content, model: json.model, usage: json.usage };
  }

  app.post(
    "/visual-assets/:id/ai-analyze",
    {
      schema: {
        tags: ["visual-assets"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            audience: { type: "string", enum: ["investor", "analyst"] },
            question: { type: "string" },
            force: { type: "boolean" },
          },
          required: ["audience"],
        },
      },
    },
    async (request, reply) => {
      const startedAt = Date.now();
      const idRaw = (request.params as any)?.id;
      const visualAssetId = sanitizeText(typeof idRaw === "string" ? idRaw : String(idRaw ?? ""));
      if (!visualAssetId) return reply.status(400).send({ error: "visual asset id is required" });

      const parsed = analyzeBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });

      const { audience } = parsed.data;
      const force = parsed.data.force === true;

      const auth = requireAiAnalyzeAuth(request);
      if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });
      const rate = checkAiAnalyzeRateLimit(request);
      if (!rate.ok) return reply.status(rate.status).send({ error: rate.error });

      const question = typeof parsed.data.question === "string" && parsed.data.question.trim().length > 0 ? parsed.data.question.trim() : null;
      const defaultQuestion =
        audience === "investor"
          ? "Explain what this sheet is showing in plain English, highlight the key numbers/trends, and list the most important investor takeaways and 3-6 diligence questions. Use ONLY SOURCE_JSON and include evidence paths for any specific claims."
          : "Explain what this sheet is showing, what calculations/assumptions appear to be present, note any data quality gaps or missing values, and list 3-6 analyst next steps to validate the numbers. Use ONLY SOURCE_JSON and include evidence paths for any specific claims.";
      const effectiveQuestion = question ?? defaultQuestion;
      const questionHash = sha256Hex(`${audience}\n${effectiveQuestion}`);

      let row: any = null;
      try {
        const q = await pool.query<any>(
          `WITH latest_extractions AS (
             SELECT
               ve.*,
               ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
             FROM visual_extractions ve
           )
           SELECT
             va.id,
             va.document_id,
             va.page_index,
             d.deal_id,
             le.ocr_text,
             le.ocr_blocks,
             le.structured_json,
             le.created_at AS extraction_created_at
           FROM visual_assets va
           JOIN documents d ON d.id = va.document_id
           LEFT JOIN latest_extractions le
             ON le.visual_asset_id = va.id AND le.rn = 1
           WHERE va.id = $1`,
          [visualAssetId]
        );
        row = q.rows?.[0] ?? null;
      } catch (err) {
        request.log?.warn?.({ err, visual_asset_id: visualAssetId }, "visual_assets.ai_analyze.query_failed");
        return reply.status(501).send({ error: "visual_assets schema missing required tables/columns" });
      }

      if (!row) return reply.status(404).send({ error: "visual asset not found" });

      const compact = compactForAiSource({
        structuredJson: row.structured_json ?? null,
        ocrText: row.ocr_text ?? null,
        ocrBlocks: row.ocr_blocks ?? null,
      });
      if (!compact) {
        return reply.status(400).send({
          error: "visual asset does not have structured_json suitable for AI analysis",
        });
      }

      // Server-side cache: reuse prior analysis across sessions without re-calling the LLM.
      if (!force) {
        try {
          const cached = await pool.query<{ response_json: any; model: string | null; usage: any | null; created_at: string }>(
            `SELECT response_json, model, usage, created_at
               FROM visual_asset_ai_analyses
              WHERE visual_asset_id = $1 AND audience = $2 AND question_hash = $3
              ORDER BY created_at DESC
              LIMIT 1`,
            [visualAssetId, audience, questionHash]
          );

          const hit = cached.rows?.[0];
          if (hit && hit.response_json) {
            return reply.send({
              ok: true,
              visual_asset_id: visualAssetId,
              deal_id: row.deal_id,
              document_id: row.document_id,
              audience,
              ...(hit.response_json ?? {}),
              model: hit.model ?? undefined,
              usage: hit.usage ?? undefined,
              cached: true,
              analysis_created_at: hit.created_at,
              llm_called: false,
              duration_ms: Date.now() - startedAt,
            });
          }
        } catch {
          // Cache table may not exist yet; fall through to live call.
        }
      }

      const compactStr = (() => {
        try {
          const s = JSON.stringify(compact, null, 2);
          // Hard cap to avoid runaway payloads.
          if (s.length <= 120_000) return s;
          return s.slice(0, 120_000) + "\n...TRUNCATED...";
        } catch {
          return String(compact);
        }
      })();

      const system =
        "You are a grounded investment analysis assistant. Use ONLY the provided SOURCE_JSON as your source of truth. " +
        "Do not guess, do not add external facts, and do not invent numbers. " +
        "Every factual claim MUST be supported by an item in the evidence list with an exact JSON path. " +
        "If information is missing, say so explicitly. " +
        "Output MUST be valid JSON and MUST match this shape: {audience, title?, answer_markdown, evidence:[{path,value?,note?}], limitations:[], followups:[]}.";

      const user =
        `AUDIENCE: ${audience}\n` +
        `QUESTION: ${effectiveQuestion}\n` +
        `VISUAL_ASSET_ID: ${visualAssetId}\n` +
        `DOCUMENT_ID: ${typeof row.document_id === "string" ? row.document_id : ""}\n` +
        `DEAL_ID: ${typeof row.deal_id === "string" ? row.deal_id : ""}\n` +
        `PAGE_INDEX: ${typeof row.page_index === "number" ? row.page_index : ""}\n` +
        `SOURCE_JSON:\n${compactStr}`;

      try {
        const model = process.env.OPENAI_MODEL_VISUAL_ANALYZE || "gpt-4o-mini";
        const completion = await openaiChatCompletion({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          maxTokens: 900,
        });

        const rawText = completion.content.trim();
        const durationMs = Date.now() - startedAt;

        let responseJsonToPersist: any = null;
        let responseToSend: any = null;

        let out: any;
        try {
          out = JSON.parse(rawText);
        } catch {
          responseJsonToPersist = {
            audience,
            title: null,
            answer_markdown: rawText,
            evidence: [],
            limitations: ["model_output_not_json"],
            followups: [],
          };
          responseToSend = {
            ok: true,
            visual_asset_id: visualAssetId,
            deal_id: row.deal_id,
            document_id: row.document_id,
            audience,
            answer_markdown: rawText,
            evidence: [],
            limitations: ["model_output_not_json"],
            followups: [],
            model: completion.model,
            usage: completion.usage ?? null,
            llm_called: true,
            cached: false,
            analysis_created_at: new Date().toISOString(),
            duration_ms: durationMs,
          };
        }

        if (!responseToSend) {
          const validated = modelOutputSchema.safeParse(out);
          if (!validated.success) {
            responseJsonToPersist = {
              audience,
              title: null,
              answer_markdown: rawText,
              evidence: [],
              limitations: ["model_output_schema_invalid"],
              followups: [],
            };
            responseToSend = {
              ok: true,
              visual_asset_id: visualAssetId,
              deal_id: row.deal_id,
              document_id: row.document_id,
              audience,
              answer_markdown: rawText,
              evidence: [],
              limitations: ["model_output_schema_invalid"],
              followups: [],
              model: completion.model,
              usage: completion.usage ?? null,
              llm_called: true,
              cached: false,
              analysis_created_at: new Date().toISOString(),
              duration_ms: durationMs,
            };
          } else {
            responseJsonToPersist = validated.data;
            responseToSend = {
              ok: true,
              visual_asset_id: visualAssetId,
              deal_id: row.deal_id,
              document_id: row.document_id,
              model: completion.model,
              usage: completion.usage ?? null,
              llm_called: true,
              cached: false,
              analysis_created_at: new Date().toISOString(),
              duration_ms: durationMs,
              ...validated.data,
            };
          }
        }

        // Best-effort persistence to DB cache.
        try {
          await pool.query(
            `INSERT INTO visual_asset_ai_analyses (
               visual_asset_id,
               audience,
               question,
               question_hash,
               response_json,
               model,
               usage,
               llm_called,
               duration_ms
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (visual_asset_id, audience, question_hash)
             DO UPDATE SET
               question = EXCLUDED.question,
               response_json = EXCLUDED.response_json,
               model = EXCLUDED.model,
               usage = EXCLUDED.usage,
               llm_called = EXCLUDED.llm_called,
               duration_ms = EXCLUDED.duration_ms,
               created_at = now()`,
            [
              visualAssetId,
              audience,
              effectiveQuestion,
              questionHash,
              responseJsonToPersist,
              completion.model,
              completion.usage ?? null,
              true,
              durationMs,
            ]
          );
        } catch {
          // ignore cache persistence failures
        }

        return reply.send(responseToSend);
      } catch (err: any) {
        request.log?.warn?.({ err, visual_asset_id: visualAssetId }, "visual_assets.ai_analyze.failed");
        return reply.status(503).send({
          error: "AI analysis unavailable",
          details: String(err?.message ?? err),
          llm_called: false,
          duration_ms: Date.now() - startedAt,
        });
      }
    }
  );

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
