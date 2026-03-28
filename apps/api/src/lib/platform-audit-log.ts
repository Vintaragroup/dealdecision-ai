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

const GOVERNANCE_ALERT_ACTIONS = new Set<string>([
  "deal.purge",
  "document.hard_delete",
  "platform_access.set_admin_status",
  "platform_access.set_account_role",
  "organization_membership.set_role",
  "platform_access.revoke",
  "organization_membership.revoke",
  "invite.create",
  "invite.revoke",
  "invite.redeem",
  "invite.expired",
  "invite.redeem_failed",
]);

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
  opts?: {
    db?: Queryable;
    alertDispatcher?: (row: PlatformAuditLogRow) => Promise<void> | void;
  }
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

  const insertedRow = rows[0];
  if (insertedRow && GOVERNANCE_ALERT_ACTIONS.has(insertedRow.action_type)) {
    const dispatch = opts?.alertDispatcher ?? dispatchGovernanceAlert;
    void Promise.resolve(dispatch(insertedRow)).catch((err) => {
      console.error("governance_alert_dispatch_failed", {
        action_type: insertedRow.action_type,
        entity_type: insertedRow.entity_type,
        entity_id: insertedRow.entity_id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return insertedRow;
}

async function dispatchGovernanceAlert(row: PlatformAuditLogRow): Promise<void> {
  const payload = {
    event: "governance_alert",
    action_type: row.action_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role,
    source: row.source,
    reason: row.reason,
    created_at: row.created_at,
  };

  console.warn("governance_alert", payload);

  const webhookUrl = process.env.GOVERNANCE_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("governance_alert_webhook_non_2xx", {
        status: response.status,
        body,
        action_type: row.action_type,
      });
    }
  } catch (err) {
    console.error("governance_alert_webhook_failed", {
      action_type: row.action_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
}
