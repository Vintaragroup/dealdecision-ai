import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ChatAction,
  ChatCitation,
  DealChatResponse,
  WorkspaceChatResponse,
} from "@dealdecision/contracts";
import { getPool } from "../lib/db";

const workspaceChatSchema = z.object({
  message: z.string().min(1, "message is required"),
});

const dealChatSchema = z.object({
  message: z.string().min(1, "message is required"),
  deal_id: z.string().min(1, "deal_id is required"),
  dio_version_id: z.string().optional(),
});

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

export async function registerChatRoutes(app: FastifyInstance, pool = getPool()) {
  app.post("/api/v1/chat/workspace", async (request, reply) => {
    const parsed = workspaceChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const replyText =
      "I can run deal analysis, fetch evidence, and summarize findings. Share a deal ID to get started.";

    const response: WorkspaceChatResponse = {
      reply: replyText,
      suggested_actions: [],
    };

    return reply.send(response);
  });

  app.post("/api/v1/chat/deal", async (request, reply) => {
    const parsed = dealChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { deal_id, dio_version_id, message } = parsed.data;

    let latestDioVersion: string | undefined = dio_version_id;
    let hasDio = false;
    let citations: ChatCitation[] | undefined;

    const dioTableExists = await hasTable(pool, "public.dio_versions");
    if (dioTableExists) {
      try {
        const { rows } = await pool.query<{ dio_version_id: string | null }>(
          `SELECT id as dio_version_id
             FROM dio_versions
             WHERE deal_id = $1
             ORDER BY version DESC NULLS LAST
             LIMIT 1`,
          [deal_id]
        );
        if (rows[0]?.dio_version_id) {
          latestDioVersion = latestDioVersion ?? rows[0].dio_version_id;
          hasDio = true;
        }
      } catch {
        // ignore and keep hasDio false
      }
    }

    const evidenceTableExists = await hasTable(pool, "public.evidence");
    if (evidenceTableExists) {
      try {
        const { rows } = await pool.query<{ evidence_id: string; excerpt: string | null }>(
          `SELECT evidence_id, excerpt
             FROM evidence
             WHERE deal_id = $1
             ORDER BY created_at DESC
             LIMIT 3`,
          [deal_id]
        );
        if (rows.length > 0) {
          citations = rows.map((row) => ({
            evidence_id: row.evidence_id,
            excerpt: row.excerpt ?? undefined,
          }));
        }
      } catch {
        // ignore and omit citations if the query fails
      }
    }

    const suggested_actions: ChatAction[] = [
      { type: "run_analysis", deal_id },
      { type: "fetch_evidence", deal_id },
    ];

    const replyText = hasDio
      ? `Using your latest DIO${latestDioVersion ? ` (${latestDioVersion})` : ""}, I can summarize risks, fetch evidence, or run a new analysis.`
      : "I don't see a DIO yet. Run analysis to generate one, and upload documents for better evidence coverage.";

    const response: DealChatResponse = {
      reply: replyText,
      citations,
      suggested_actions,
    };

    // Echo back the last message for now to show interactivity
    if (message) {
      response.reply = `${replyText} You asked: ${message}`;
    }

    if (!citations || citations.length === 0) {
      delete response.citations;
    }

    return reply.send(response);
  });
}
