import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "crypto";
import { z } from "zod";

import { getPool } from "../lib/db";
import { sanitizeText } from "@dealdecision/core";
import { compactForAiSource } from "../lib/ai-compact";

type QueryResult<T> = { rows: T[]; rowCount?: number };

type Pool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

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

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...TRUNCATED...";
}

function requireAiAnalyzeAuth(request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } {
  const required = process.env.AI_ANALYZE_TOKEN;
  if (!required || required.trim().length === 0) return { ok: true };
  const headers = (request?.headers ?? {}) as any;
  const token = headers["x-ai-analyze-token"] ?? headers["ai-analyze-token"];
  if (typeof token === "string" && token === required) return { ok: true };
  return { ok: false, status: 401, error: "Missing or invalid AI analyze token" };
}

function createRateLimiter() {
  // In-process guardrails (best-effort; resets on restart).
  const state = new Map<string, { windowStartMs: number; count: number }>();
  const windowMs = 60_000;
  const maxPerWindow = (() => {
    const v = process.env.AI_ANALYZE_RPM;
    const parsed = typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  })();

  return (request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } => {
    const key = String((request as any)?.ip ?? (request as any)?.headers?.["x-forwarded-for"] ?? "unknown");
    const now = Date.now();
    const cur = state.get(key);
    if (!cur || now - cur.windowStartMs >= windowMs) {
      state.set(key, { windowStartMs: now, count: 1 });
      return { ok: true };
    }
    if (cur.count >= maxPerWindow) {
      return { ok: false, status: 429, error: `AI analyze rate limit exceeded (${maxPerWindow}/min)` };
    }
    cur.count += 1;
    return { ok: true };
  };
}

async function openaiChatCompletion(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  maxTokens: number;
}): Promise<{ content: string; model: string; usage?: OpenAIChatCompletionResponse["usage"] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

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

const bodySchema = z
  .object({
    audience: z.enum(["investor", "analyst"]),
    question: z.string().max(2000).optional(),
    force: z.boolean().optional(),
    node: z
      .object({
        kind: z.string().min(1),
      })
      .passthrough()
      .optional(),
    source_json: z.any().optional(),
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

function toNodeKey(dealId: string, node: any | null | undefined): string {
  const kind = typeof node?.kind === "string" ? node.kind : "unknown";
  if (kind === "deal") return `deal:${dealId}`;
  if (kind === "document" && typeof node?.document_id === "string") return `document:${node.document_id}`;
  if (kind === "visual_asset" && typeof node?.visual_asset_id === "string") return `visual_asset:${node.visual_asset_id}`;
  if (kind === "visual_group" && typeof node?.segment_id === "string") return `visual_group:${node.segment_id}`;
  if (kind === "evidence_group" && typeof node?.evidence_group_id === "string") return `evidence_group:${node.evidence_group_id}`;
  if (kind === "evidence" && typeof node?.visual_asset_id === "string") return `evidence:${node.visual_asset_id}`;

  // Fallback: stable-ish hash of node payload.
  const raw = (() => {
    try {
      return JSON.stringify({ kind, node }, null, 0);
    } catch {
      return String(kind);
    }
  })();
  return `selection:${sha256Hex(raw).slice(0, 24)}`;
}

function stringifyCapped(obj: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + "\n...TRUNCATED...";
  } catch {
    return clampText(String(obj), maxLen);
  }
}

export async function registerNodeAiAnalyzeRoutes(app: FastifyInstance, poolOverride?: any) {
  const pool = (poolOverride ?? getPool()) as Pool;
  const checkRate = createRateLimiter();

  app.post(
    "/api/v1/deals/:deal_id/ai-analyze",
    {
      schema: {
        tags: ["deals"],
        params: {
          type: "object",
          properties: { deal_id: { type: "string" } },
          required: ["deal_id"],
        },
        body: {
          type: "object",
          properties: {
            audience: { type: "string", enum: ["investor", "analyst"] },
            question: { type: "string" },
            force: { type: "boolean" },
            node: { type: "object" },
            source_json: {},
          },
          required: ["audience"],
        },
      },
    },
    async (request, reply) => {
      const startedAt = Date.now();

      const dealIdRaw = (request.params as any)?.deal_id;
      const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
      if (!dealId) return reply.status(400).send({ error: "deal_id is required" });

      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });

      const auth = requireAiAnalyzeAuth(request);
      if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });
      const rate = checkRate(request);
      if (!rate.ok) return reply.status(rate.status).send({ error: rate.error });

      const { audience } = parsed.data;
      const force = parsed.data.force === true;

      const question = typeof parsed.data.question === "string" && parsed.data.question.trim().length > 0 ? parsed.data.question.trim() : null;
      const defaultQuestion =
        audience === "investor"
          ? "Summarize what this node represents, extract the most important facts and numbers, and list investor takeaways and 3-6 diligence questions. Use ONLY SOURCE_JSON and include evidence paths for any specific claims."
          : "Analyze this node as an investment analyst: explain what it contains, note any data quality gaps, and list 3-6 next steps to validate. Use ONLY SOURCE_JSON and include evidence paths for any specific claims.";
      const effectiveQuestion = question ?? defaultQuestion;

      const nodeKey = toNodeKey(dealId, parsed.data.node);

      // Build SOURCE_JSON
      let sourceJson: any = parsed.data.source_json;
      const node = parsed.data.node as any | undefined;

      if (typeof sourceJson === "undefined") {
        // Fetch minimal grounding material for common node kinds.
        if (node?.kind === "deal") {
          const dealRow = await pool
            .query<{ id: string; name: string | null; stage: string | null }>(
              `SELECT id, name, stage FROM deals WHERE id = $1 LIMIT 1`,
              [dealId]
            )
            .then((r) => r.rows?.[0] ?? null)
            .catch(() => null);

          const docs = await pool
            .query<{ id: string; title: string | null; type: string | null; page_count: number | null }>(
              `SELECT id, title, type, page_count
                 FROM documents
                WHERE deal_id = $1
                ORDER BY uploaded_at ASC NULLS LAST, created_at ASC NULLS LAST
                LIMIT 50`,
              [dealId]
            )
            .then((r) => r.rows ?? [])
            .catch(() => []);

          sourceJson = {
            node_kind: "deal",
            deal: dealRow,
            documents: docs,
          };
        } else if (node?.kind === "document" && typeof node?.document_id === "string") {
          const docId = sanitizeText(node.document_id);
          const docRow = await pool
            .query<any>(
              `SELECT id,
                      deal_id,
                      title,
                      type,
                      page_count,
                      full_text,
                      full_content,
                      structured_data
                 FROM documents
                WHERE id = $1 AND deal_id = $2
                LIMIT 1`,
              [docId, dealId]
            )
            .then((r) => r.rows?.[0] ?? null);

          if (!docRow) return reply.status(404).send({ error: "document not found" });

          sourceJson = {
            node_kind: "document",
            document: {
              id: docRow.id,
              deal_id: docRow.deal_id,
              title: docRow.title,
              type: docRow.type,
              page_count: docRow.page_count,
            },
            // Cap large fields.
            full_text: typeof docRow.full_text === "string" ? clampText(docRow.full_text, 24_000) : null,
            full_content: typeof docRow.full_content === "string" ? clampText(docRow.full_content, 24_000) : docRow.full_content ?? null,
            structured_data: docRow.structured_data ?? null,
          };
        } else if (node?.kind === "visual_asset" && typeof node?.visual_asset_id === "string") {
          const vaId = sanitizeText(node.visual_asset_id);
          const row = await pool
            .query<any>(
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
               WHERE va.id = $1 AND d.deal_id = $2`,
              [vaId, dealId]
            )
            .then((r) => r.rows?.[0] ?? null);

          if (!row) return reply.status(404).send({ error: "visual asset not found" });

          sourceJson = {
            node_kind: "visual_asset",
            visual_asset: {
              id: row.id,
              document_id: row.document_id,
              deal_id: row.deal_id,
              page_index: row.page_index,
              extraction_created_at: row.extraction_created_at,
            },
            extraction: compactForAiSource({
              structuredJson: row.structured_json ?? null,
              ocrText: row.ocr_text ?? null,
              ocrBlocks: row.ocr_blocks ?? null,
            }),
          };
        } else if (node?.kind === "evidence" && typeof node?.visual_asset_id === "string") {
          const vaId = sanitizeText(node.visual_asset_id);
          const evidence = await pool
            .query<{ snippet: string | null; confidence: number | null; created_at: string }>(
              `SELECT snippet, confidence, created_at
                 FROM evidence_links el
                 JOIN documents d ON d.id = el.document_id
                WHERE d.deal_id = $1 AND el.visual_asset_id = $2
                ORDER BY el.created_at DESC
                LIMIT 30`,
              [dealId, vaId]
            )
            .then((r) => r.rows ?? [])
            .catch(() => []);

          sourceJson = {
            node_kind: "evidence",
            visual_asset_id: vaId,
            evidence_links: evidence,
          };
        }
      }

      if (typeof sourceJson === "undefined") {
        return reply.status(400).send({ error: "Provide source_json or a supported node kind" });
      }

      const compactStr = stringifyCapped(sourceJson, 140_000);
      const sourceHash = sha256Hex(compactStr);
      const questionHash = sha256Hex(`${audience}\n${effectiveQuestion}\n${sourceHash}`);

      // Cache lookup (if table exists).
      if (!force) {
        try {
          const cached = await pool.query<{ response_json: any; model: string | null; usage: any | null; created_at: string }>(
            `SELECT response_json, model, usage, created_at
               FROM node_ai_analyses
              WHERE node_key = $1 AND audience = $2 AND question_hash = $3
              ORDER BY created_at DESC
              LIMIT 1`,
            [nodeKey, audience, questionHash]
          );

          const hit = cached.rows?.[0];
          if (hit && hit.response_json) {
            return reply.send({
              ok: true,
              deal_id: dealId,
              node_key: nodeKey,
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
          // Table may not exist yet.
        }
      }

      const system =
        "You are a grounded investment analysis assistant. Use ONLY the provided SOURCE_JSON as your source of truth. " +
        "Do not guess, do not add external facts, and do not invent numbers. " +
        "Every factual claim MUST be supported by an item in the evidence list with an exact JSON path. " +
        "If information is missing, say so explicitly. " +
        "Output MUST be valid JSON and MUST match this shape: {audience, title?, answer_markdown, evidence:[{path,value?,note?}], limitations:[], followups:[]}.";

      const user =
        `AUDIENCE: ${audience}\n` +
        `QUESTION: ${effectiveQuestion}\n` +
        `DEAL_ID: ${dealId}\n` +
        `NODE_KEY: ${nodeKey}\n` +
        `SOURCE_JSON:\n${compactStr}`;

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
          deal_id: dealId,
          node_key: nodeKey,
          audience,
          ...(responseJsonToPersist ?? {}),
          model: completion.model,
          usage: completion.usage,
          cached: false,
          analysis_created_at: new Date().toISOString(),
          llm_called: true,
          duration_ms: durationMs,
        };
      }

      if (!responseToSend) {
        const validated = modelOutputSchema.safeParse(out);
        responseJsonToPersist = validated.success
          ? validated.data
          : {
              audience,
              title: null,
              answer_markdown: rawText,
              evidence: [],
              limitations: ["model_output_schema_mismatch"],
              followups: [],
            };

        responseToSend = {
          ok: true,
          deal_id: dealId,
          node_key: nodeKey,
          audience,
          ...(responseJsonToPersist ?? {}),
          model: completion.model,
          usage: completion.usage,
          cached: false,
          analysis_created_at: new Date().toISOString(),
          llm_called: true,
          duration_ms: durationMs,
        };
      }

      // Persist (best-effort)
      try {
        await pool.query(
          `INSERT INTO node_ai_analyses (node_key, deal_id, audience, question_hash, question, response_json, model, usage, llm_called, duration_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (node_key, audience, question_hash)
           DO UPDATE SET response_json = EXCLUDED.response_json,
                         model = EXCLUDED.model,
                         usage = EXCLUDED.usage,
                         llm_called = EXCLUDED.llm_called,
                         duration_ms = EXCLUDED.duration_ms,
                         question = EXCLUDED.question,
                         updated_at = now()`,
          [
            nodeKey,
            dealId,
            audience,
            questionHash,
            effectiveQuestion,
            responseJsonToPersist ?? {},
            completion.model,
            completion.usage ?? null,
            true,
            durationMs,
          ]
        );
      } catch {
        // Ignore persistence failures.
      }

      return reply.send(responseToSend);
    }
  );
}
