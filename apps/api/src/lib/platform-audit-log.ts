import { getPool } from "./db";

export type PlatformAuditSource = "ui" | "api" | "job" | "system" | "script";

export type PlatformAuditLogRow = {
  id: string;
  actor_user_id: string;
  actor_role: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  reason: string;
  source: PlatformAuditSource;
  created_at: string;
};

export type PlatformAuditLogInput = {
  actor_user_id: string;
  actor_role: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  reason: string;
  source: PlatformAuditSource;
};

export type Queryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type AuditActorContext = {
  actor_user_id: string;
  actor_role: string;
  source: PlatformAuditSource;
};

const ACTION_TYPE_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizeActionType(actionType: string): string {
  const normalized = actionType.trim().toLowerCase();
  if (!ACTION_TYPE_RE.test(normalized)) {
    throw new Error("action_type must match domain.action (lowercase snake_case)");
  }
  return normalized;
}

function normalizeSource(source: PlatformAuditSource): PlatformAuditSource {
  if (source === "ui" || source === "api" || source === "job" || source === "system" || source === "script") {
    return source;
  }
  throw new Error("source must be one of: ui, api, job, system, script");
}

export function getAuditActorContext(request: any): AuditActorContext {
  const authUserId = typeof request?.auth?.userId === "string" ? request.auth.userId.trim() : "";
  const actor_user_id = authUserId || "system:admin_token";

  let actor_role = "unknown";
  if (Boolean(request?.auth?.claims?.bypass_auth)) {
    actor_role = "dev_bypass";
  } else if (typeof request?.auth?.orgRole === "string" && request.auth.orgRole.trim().length > 0) {
    actor_role = request.auth.orgRole.trim().toLowerCase();
  } else if (authUserId) {
    actor_role = "authenticated";
  } else {
    actor_role = "admin_token";
  }

  return {
    actor_user_id,
    actor_role,
    source: "api",
  };
}

export function extractAuditReason(
  body: unknown,
  opts?: { query?: unknown; headers?: unknown; defaultReason?: string }
): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const q = (opts?.query ?? {}) as Record<string, unknown>;
  const h = (opts?.headers ?? {}) as Record<string, unknown>;

  const reasonFromBody = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reasonFromBody) return reasonFromBody;

  const reasonFromNotes = typeof b.notes === "string" ? b.notes.trim() : "";
  if (reasonFromNotes) return reasonFromNotes;

  const reasonFromQuery = typeof q.reason === "string" ? q.reason.trim() : "";
  if (reasonFromQuery) return reasonFromQuery;

  const reasonFromHeader = typeof h["x-audit-reason"] === "string" ? String(h["x-audit-reason"]).trim() : "";
  if (reasonFromHeader) return reasonFromHeader;

  const fallback = typeof opts?.defaultReason === "string" ? opts.defaultReason.trim() : "";
  return fallback || null;
}

export async function writePlatformAuditLog(
  input: PlatformAuditLogInput,
  opts?: { db?: Queryable }
): Promise<PlatformAuditLogRow> {
  const actorUserId = nonEmpty(input.actor_user_id, "actor_user_id");
  const actorRole = nonEmpty(input.actor_role, "actor_role");
  const actionType = normalizeActionType(nonEmpty(input.action_type, "action_type"));
  const entityType = nonEmpty(input.entity_type, "entity_type");
  const entityId = nonEmpty(input.entity_id, "entity_id");
  const reason = nonEmpty(input.reason, "reason");
  const source = normalizeSource(input.source);

  const beforeState = input.before_state ?? {};
  const afterState = input.after_state ?? {};

  const db = opts?.db ?? getPool();

  const { rows } = await db.query<PlatformAuditLogRow>(
    `INSERT INTO platform_audit_log (
       actor_user_id,
       actor_role,
       action_type,
       entity_type,
       entity_id,
       before_state,
       after_state,
       reason,
       source,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
     RETURNING
       id,
       actor_user_id,
       actor_role,
       action_type,
       entity_type,
       entity_id,
       before_state,
       after_state,
       reason,
       source,
       created_at`,
    [
      actorUserId,
      actorRole,
      actionType,
      entityType,
      entityId,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      reason,
      source,
    ]
  );

  return rows[0];
}
