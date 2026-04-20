/**
 * Admin Routes
 * /api/v1/admin - Administrative operations
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  isFeatureEnabled,
  getFeatureFlagsStatus,
  setFeaturePercentage,
  setFeatureEnabled,
  getFeaturePercentage,
} from "../lib/feature-flags";
import { getPool } from "../lib/db";
import { writePlatformAuditLog, getAuditActorContext, extractAuditReason } from "../lib/platform-audit-log";
import { purgeDealCascade, isPurgeDealNotFoundError } from "@dealdecision/core";
import { classifyDecisionReadiness } from "../lib/intelligence/decision-readiness";
import type { DecisionReadiness } from "../lib/intelligence/decision-readiness";

// ---------------------------------------------------------------------------
// DB-backed admin check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given Clerk user ID has is_admin = true in platform_access.
 * This is the authoritative admin check. Never rely on email or orgRole alone.
 */
async function isDbAdmin(userId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT is_admin FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0 && rows[0].is_admin === true;
}

/**
 * Returns true if the given Clerk user ID has account_role = 'super_admin'.
 * Only super_admins may assign the super_admin role to themselves or others.
 */
async function isDbSuperAdmin(userId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT account_role FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0 && rows[0].account_role === 'super_admin';
}

async function hasTable(tableName: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query<{ oid: string }>(
    `SELECT to_regclass($1) as oid`,
    [tableName]
  );
  return rows[0]?.oid != null;
}

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
     ) as exists`,
    [tableName, columnName]
  );
  return rows[0]?.exists === true;
}

const GOVERNANCE_ALERT_ACTIONS: ReadonlyArray<string> = [
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
];

function requireMutationReason(request: FastifyRequest, reply: FastifyReply, defaultReason?: string): string | null {
  const reason = extractAuditReason((request as any).body, {
    query: (request as any).query,
    headers: request.headers,
    defaultReason,
  });
  if (!reason) {
    reply.status(400).send({
      error: "reason is required for this privileged mutation",
      code: "MISSING_AUDIT_REASON",
    });
    return null;
  }
  return reason;
}

function buildPurgeConfirmationToken(args: { entityType: "deal" | "document"; entityId: string }): string {
  return `PURGE ${args.entityType.toUpperCase()} ${args.entityId}`;
}

function requirePurgeConfirmation(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string
): boolean {
  const body = ((request as any)?.body ?? {}) as Record<string, unknown>;
  const provided = typeof body.confirm_text === "string" ? body.confirm_text.trim() : "";
  if (!provided) {
    reply.status(400).send({
      error: `confirm_text is required and must match '${expectedToken}'`,
      code: "PURGE_CONFIRMATION_REQUIRED",
    });
    return false;
  }

  if (provided !== expectedToken) {
    reply.status(400).send({
      error: `confirm_text mismatch. Expected '${expectedToken}'`,
      code: "PURGE_CONFIRMATION_MISMATCH",
    });
    return false;
  }

  return true;
}

/**
 * Admin auth middleware — DB-backed.
 *
 * Allows if:
 *   1. Dev auth bypass (DISABLE_CLERK_AUTH=1) — allows locally without DB hit.
 *   2. ADMIN_TOKEN header match — narrow escape hatch for bootstrap/CLI scripts.
 *   3. platform_access.is_admin = true for the authenticated Clerk user ID.
 *
 * Production intent: path 3 is the normal path. Paths 1 and 2 are narrow
 * bootstrap helpers that should not be the long-term authorization model.
 */
async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  // Path 1: dev auth bypass — skip DB check entirely.
  const bypassedAuth = Boolean((request as any).auth?.claims?.['bypass_auth']);
  if (bypassedAuth) return true;

  // Path 2: explicit ADMIN_TOKEN header — bootstrap/script helper only.
  // Only honored when ADMIN_TOKEN env var is set to a non-empty value.
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (adminToken) {
    const providedToken = request.headers['x-admin-token'] ??
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof providedToken === 'string' && providedToken.trim() === adminToken) {
      return true;
    }
  }

  // Path 3: DB-backed admin check (normal production path).
  const userId = (request as any).auth?.userId;
  if (!userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  let adminFlag: boolean;
  try {
    adminFlag = await isDbAdmin(userId);
  } catch (err) {
    request.log.error({ event: 'admin_check_db_error', err }, 'DB admin check failed');
    reply.status(503).send({ error: 'Service temporarily unavailable' });
    return false;
  }

  if (!adminFlag) {
    reply.status(403).send({ error: 'Forbidden: admin access required' });
    return false;
  }

  return true;
}

/**
 * Super admin auth check — requires account_role = 'super_admin'.
 *
 * Use for routes that only super_admin should access:
 *   - promoting / demoting admin status
 *   - assigning super_admin role
 *
 * Note: callers must already have passed requireAdminAuth (is_admin = true).
 * This adds the additional super_admin constraint on top of that.
 */
async function requireSuperAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  // Dev auth bypass — treated as super_admin locally.
  if (Boolean((request as any).auth?.claims?.['bypass_auth'])) return true;

  // ADMIN_TOKEN escape hatch (bootstrap / CLI scripts).
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (adminToken) {
    const provided =
      (request.headers['x-admin-token'] as string | undefined) ??
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof provided === 'string' && provided.trim() === adminToken) return true;
  }

  const userId = (request as any).auth?.userId;
  if (!userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  let isSuperAdmin: boolean;
  try {
    isSuperAdmin = await isDbSuperAdmin(userId);
  } catch (err) {
    request.log.error({ event: 'super_admin_check_db_error', err }, 'DB super_admin check failed');
    reply.status(503).send({ error: 'Service temporarily unavailable' });
    return false;
  }

  if (!isSuperAdmin) {
    reply.status(403).send({
      error: 'Forbidden: super_admin role required',
      code: 'SUPER_ADMIN_REQUIRED',
    });
    return false;
  }

  return true;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  // DB-backed admin check on all /api/v1/admin/* routes.
  // Exempt: /api/v1/admin/bootstrap-first-admin (see below — has its own guard).
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/admin")) return;
    if (request.url.startsWith("/api/v1/admin/bootstrap-first-admin")) return;
    const allowed = await requireAdminAuth(request, reply);
    if (!allowed) {
      // reply already sent by requireAdminAuth
    }
  });

  /**
   * GET /api/v1/admin/feature-flags
   * Get status of all feature flags
   */
  app.get("/api/v1/admin/feature-flags", async (request, reply) => {
    const status = getFeatureFlagsStatus();
    return reply.send(status);
  });

  /**
   * GET /api/v1/system/env-check
   * Dev-only runtime check for environment flags.
   * Safe to remove later; must not mutate state.
   */
  app.get(
    "/api/v1/system/env-check",
    {
      preHandler: async (request, reply) => {
        // Dev-only endpoint: hide in production.
        // Treat NODE_ENV unset as non-production (common in local Docker dev).
        if (process.env.NODE_ENV === "production") {
          reply.status(404).send({ error: "Not found" });
          return;
        }

        // If an admin token is configured, require admin auth.
        const adminToken = process.env.ADMIN_TOKEN;
        if (typeof adminToken === "string" && adminToken.trim().length > 0) {
          await requireAdminAuth(request, reply);
        }
        // else: no admin token configured, allow in non-production
      },
    },
    async (request, reply) => {
      const raw = process.env.ENABLE_VISUAL_EXTRACTION;
      const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";

      const enabled = normalized
        ? ["1", "true", "yes", "on"].includes(normalized)
          ? "1"
          : "0"
        : null;

      return reply.send({
        api: {
          ENABLE_VISUAL_EXTRACTION: enabled,
        },
        worker_expected: true,
        notes: ["worker logs will show ENABLE_VISUAL_EXTRACTION at startup"],
      });
    }
  );

  /**
   * POST /api/v1/admin/feature-flags/:featureName/percentage
   * Set percentage rollout for a feature
   * 
   * Body: { percentage: number }
   */
  app.post<{
    Params: { featureName: string };
    Body: { percentage: number };
  }>(
    "/api/v1/admin/feature-flags/:featureName/percentage",
    async (request, reply) => {
      const { featureName } = request.params;
      const { percentage } = request.body;

      if (percentage === undefined || percentage < 0 || percentage > 100) {
        return reply
          .status(400)
          .send({ error: "Percentage must be between 0 and 100" });
      }

      try {
        setFeaturePercentage(featureName, percentage);
        return reply.send({
          feature: featureName,
          percentage,
          message: `Rollout set to ${percentage}%`,
        });
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/feature-flags/:featureName/enable
   * Enable a feature flag
   */
  app.post<{ Params: { featureName: string } }>(
    "/api/v1/admin/feature-flags/:featureName/enable",
    async (request, reply) => {
      const { featureName } = request.params;

      try {
        setFeatureEnabled(featureName, true);
        return reply.send({
          feature: featureName,
          enabled: true,
        });
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/feature-flags/:featureName/disable
   * Disable a feature flag
   */
  app.post<{ Params: { featureName: string } }>(
    "/api/v1/admin/feature-flags/:featureName/disable",
    async (request, reply) => {
      const { featureName } = request.params;

      try {
        setFeatureEnabled(featureName, false);
        return reply.send({
          feature: featureName,
          enabled: false,
        });
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  );

  /**
   * GET /api/v1/admin/health
   * Admin health check
   */
  app.get("/api/v1/admin/health", async (request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      featureFlags: getFeatureFlagsStatus(),
    });
  });

  // ─── Platform Access Provisioning ───────────────────────────────────────────
  // Phase 1: manual bootstrap endpoint used by admins to grant/update access.
  // Future: will be backed by a full invite-code workflow.
  //
  // This path is EXEMPTED from entitlement checks in clerk-auth.ts so it can be
  // called before any platform_access row exists for the actor.

  /**
   * POST /api/v1/admin/platform-access
   * Provision or update platform access for a Clerk user.
   *
   * Body:
   *   clerk_user_id   string   required
   *   access_status   string   "active" | "pending" | "expired" | "revoked"
   *   access_expires_at  string | null  ISO-8601 timestamp or null (unlimited)
   *   org_id          string | null
   *   notes           string | null
   *   grant_source    string   default "admin"
   */
  app.post<{
    Body: {
      clerk_user_id: string;
      access_status?: string;
      access_expires_at?: string | null;
      org_id?: string | null;
      notes?: string | null;
      grant_source?: string;
      reason?: string | null;
    };
  }>("/api/v1/admin/platform-access", async (request, reply) => {
    const {
      clerk_user_id,
      access_status = "active",
      access_expires_at = null,
      org_id = null,
      notes = null,
      grant_source = "admin",
    } = request.body ?? {};

    const reason = requireMutationReason(request, reply);
    if (!reason) return;
    const actor = getAuditActorContext(request);

    if (!clerk_user_id || typeof clerk_user_id !== "string" || clerk_user_id.trim().length === 0) {
      return reply.status(400).send({ error: "clerk_user_id is required" });
    }

    const validStatuses = ["active", "pending", "expired", "revoked"];
    if (!validStatuses.includes(access_status)) {
      return reply.status(400).send({ error: `access_status must be one of: ${validStatuses.join(", ")}` });
    }

    const validSources = ["manual", "invite", "admin", "system"];
    const resolvedSource = validSources.includes(grant_source) ? grant_source : "admin";

    let expiresAt: Date | null = null;
    if (access_expires_at != null) {
      expiresAt = new Date(access_expires_at);
      if (isNaN(expiresAt.getTime())) {
        return reply.status(400).send({ error: "access_expires_at must be a valid ISO-8601 timestamp or null" });
      }
    }

    const grantedBy = (request as any)?.auth?.userId ?? null;

    const pool = getPool();
    const { rows: beforeRows } = await pool.query(
      `SELECT id, clerk_user_id, org_id, access_status, access_expires_at, grant_source, notes, is_admin, account_role
         FROM platform_access
        WHERE clerk_user_id = $1
        LIMIT 1`,
      [clerk_user_id.trim()]
    );
    const { rows } = await pool.query(
      `INSERT INTO platform_access (
         clerk_user_id, org_id, access_status, access_expires_at,
         granted_by_user_id, grant_source, notes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         org_id              = EXCLUDED.org_id,
         access_status       = EXCLUDED.access_status,
         access_expires_at   = EXCLUDED.access_expires_at,
         granted_by_user_id  = EXCLUDED.granted_by_user_id,
         grant_source        = EXCLUDED.grant_source,
         notes               = EXCLUDED.notes,
         updated_at          = now()
       RETURNING id, clerk_user_id, access_status, access_expires_at, org_id, grant_source, created_at, updated_at`,
      [
        clerk_user_id.trim(),
        org_id ?? null,
        access_status,
        expiresAt?.toISOString() ?? null,
        grantedBy,
        resolvedSource,
        notes ?? null,
      ]
    );

    await writePlatformAuditLog({
      ...actor,
      action_type: "platform_access.upsert",
      entity_type: "platform_access",
      entity_id: clerk_user_id.trim(),
      before_state: beforeRows[0] ?? {},
      after_state: rows[0] ?? {},
      reason,
    });

    return reply.status(200).send({ ok: true, record: rows[0] });
  });

  /**
   * GET /api/v1/admin/platform-access/:clerkUserId
   * Look up platform access for a Clerk user.
   */
  app.get<{ Params: { clerkUserId: string } }>(
    "/api/v1/admin/platform-access/:clerkUserId",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, clerk_user_id, org_id, access_status, access_expires_at,
                granted_by_user_id, grant_source, notes, is_admin, account_role, created_at, updated_at
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerkUserId]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: "No platform_access record found for this user" });
      }
      return reply.send({ record: rows[0] });
    }
  );

  /**
   * GET /api/v1/admin/platform-access
   * List all platform_access records (paginated), including is_admin.
   */
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>(
    "/api/v1/admin/platform-access",
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const status = request.query.status ?? null;

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, clerk_user_id, org_id, access_status, access_expires_at,
                granted_by_user_id, grant_source, notes, is_admin, account_role, created_at, updated_at
           FROM platform_access
          ${status ? `WHERE access_status = $3` : ""}
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2`,
        status ? [limit, offset, status] : [limit, offset]
      );
      return reply.send({ records: rows, limit, offset });
    }
  );

  /**
   * GET /api/v1/admin/audit-logs
   * Browse canonical platform audit events with optional filters.
   */
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      actor_user_id?: string;
      action_type?: string;
      entity_type?: string;
      entity_id?: string;
      source?: string;
      from?: string;
      to?: string;
    };
  }>("/api/v1/admin/audit-logs", async (request, reply) => {
    const tableOk = await hasTable("platform_audit_log");
    if (!tableOk) {
      return reply.status(404).send({ error: "platform_audit_log_not_found" });
    }

    const limitRaw = Number(request.query.limit ?? 50);
    const offsetRaw = Number(request.query.offset ?? 0);

    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const source = typeof request.query.source === "string" ? request.query.source.trim() : "";
    const allowedSources = new Set(["ui", "api", "job", "system", "script"]);
    if (source && !allowedSources.has(source)) {
      return reply.status(400).send({ error: "source must be one of: ui, api, job, system, script" });
    }

    const from = typeof request.query.from === "string" && request.query.from.trim().length > 0
      ? new Date(request.query.from)
      : null;
    const to = typeof request.query.to === "string" && request.query.to.trim().length > 0
      ? new Date(request.query.to)
      : null;

    if (from && Number.isNaN(from.getTime())) {
      return reply.status(400).send({ error: "from must be a valid ISO-8601 timestamp" });
    }
    if (to && Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "to must be a valid ISO-8601 timestamp" });
    }

    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    const pushEq = (column: string, value: unknown) => {
      if (typeof value === "string" && value.trim().length > 0) {
        where.push(`${column} = $${i++}`);
        params.push(value.trim());
      }
    };

    pushEq("actor_user_id", request.query.actor_user_id);
    pushEq("action_type", request.query.action_type);
    pushEq("entity_type", request.query.entity_type);
    pushEq("entity_id", request.query.entity_id);
    if (source) pushEq("source", source);

    if (from) {
      where.push(`created_at >= $${i++}`);
      params.push(from.toISOString());
    }
    if (to) {
      where.push(`created_at <= $${i++}`);
      params.push(to.toISOString());
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const pool = getPool();

    const countParams = [...params];
    const { rows: countRows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM platform_audit_log ${whereSql}`,
      countParams
    );
    const total = Number(countRows[0]?.total ?? "0");

    const { rows } = await pool.query(
      `SELECT id, actor_user_id, actor_role, action_type, entity_type, entity_id,
              before_state, after_state, reason, source, created_at
         FROM platform_audit_log
         ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    return reply.send({ records: rows, limit, offset, total: Number.isFinite(total) ? total : 0 });
  });

  /**
   * GET /api/v1/admin/audit-alerts/summary
   * Returns governance alert counts and recent events from platform_audit_log.
   */
  app.get<{
    Querystring: {
      hours?: string;
      limit?: string;
    };
  }>("/api/v1/admin/audit-alerts/summary", async (request, reply) => {
    const tableOk = await hasTable("platform_audit_log");
    if (!tableOk) {
      return reply.status(404).send({ error: "platform_audit_log_not_found" });
    }

    const hoursRaw = Number(request.query.hours ?? 24);
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(168, Math.floor(hoursRaw))) : 24;
    const limitRaw = Number(request.query.limit ?? 25);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;

    const pool = getPool();

    const { rows: byActionRows } = await pool.query<{ action_type: string; count: string }>(
      `SELECT action_type, COUNT(*)::text AS count
         FROM platform_audit_log
        WHERE action_type = ANY($1::text[])
          AND created_at >= now() - make_interval(hours => $2::int)
        GROUP BY action_type
        ORDER BY COUNT(*) DESC, action_type ASC`,
      [GOVERNANCE_ALERT_ACTIONS, hours]
    );

    const { rows: totalRows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM platform_audit_log
        WHERE action_type = ANY($1::text[])
          AND created_at >= now() - make_interval(hours => $2::int)`,
      [GOVERNANCE_ALERT_ACTIONS, hours]
    );

    const { rows: recentRows } = await pool.query<{
      id: string;
      action_type: string;
      entity_type: string;
      entity_id: string;
      actor_user_id: string;
      actor_role: string;
      reason: string;
      source: string;
      created_at: string;
    }>(
      `SELECT id, action_type, entity_type, entity_id, actor_user_id, actor_role, reason, source, created_at
         FROM platform_audit_log
        WHERE action_type = ANY($1::text[])
          AND created_at >= now() - make_interval(hours => $2::int)
        ORDER BY created_at DESC
        LIMIT $3`,
      [GOVERNANCE_ALERT_ACTIONS, hours, limit]
    );

    return reply.send({
      window_hours: hours,
      total_alerts: Number(totalRows[0]?.total ?? "0"),
      by_action: byActionRows.map((r) => ({ action_type: r.action_type, count: Number(r.count) })),
      recent_events: recentRows,
    });
  });

  /**
   * GET /api/v1/admin/super-admin/ops-feed
   * Super-admin visibility endpoint for system alerts + recent errors.
   */
  app.get<{
    Querystring: {
      hours?: string;
      limit?: string;
    };
  }>("/api/v1/admin/super-admin/ops-feed", async (request, reply) => {
    const superAllowed = await requireSuperAdminAuth(request, reply);
    if (!superAllowed) return;

    const hoursRaw = Number(request.query.hours ?? 24);
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(168, Math.floor(hoursRaw))) : 24;
    const limitRaw = Number(request.query.limit ?? 25);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 25;

    const pool = getPool();
    const hasAuditLog = await hasTable("platform_audit_log");
    const hasJobs = await hasTable("jobs");

    let systemAlerts: Array<{
      id: string;
      action_type: string;
      entity_type: string;
      entity_id: string;
      actor_user_id: string;
      actor_role: string;
      reason: string;
      source: string;
      created_at: string;
    }> = [];

    let errorLogs: Array<{
      job_id: string;
      type: string | null;
      status: string;
      deal_id: string | null;
      document_id: string | null;
      message: string | null;
      error: string | null;
      created_at: string | null;
      updated_at: string | null;
    }> = [];

    if (hasAuditLog) {
      const { rows } = await pool.query<{
        id: string;
        action_type: string;
        entity_type: string;
        entity_id: string;
        actor_user_id: string;
        actor_role: string;
        reason: string;
        source: string;
        created_at: string;
      }>(
        `SELECT id, action_type, entity_type, entity_id, actor_user_id, actor_role, reason, source, created_at
           FROM platform_audit_log
          WHERE action_type = ANY($1::text[])
            AND created_at >= now() - make_interval(hours => $2::int)
          ORDER BY created_at DESC
          LIMIT $3`,
        [GOVERNANCE_ALERT_ACTIONS, hours, limit]
      );
      systemAlerts = rows;
    }

    if (hasJobs) {
      const { rows } = await pool.query<{
        job_id: string;
        type: string | null;
        status: string;
        deal_id: string | null;
        document_id: string | null;
        message: string | null;
        error: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>(
        `SELECT job_id, type, status, deal_id, document_id, message, error, created_at, updated_at
           FROM jobs
          WHERE status = 'failed'
            AND COALESCE(updated_at, created_at) >= now() - make_interval(hours => $1::int)
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT $2`,
        [hours, limit]
      );
      errorLogs = rows;
    }

    return reply.send({
      window_hours: hours,
      system_alerts: systemAlerts,
      error_logs: errorLogs,
      availability: {
        platform_audit_log: hasAuditLog,
        jobs: hasJobs,
      },
    });
  });

  /**
   * GET /api/v1/admin/users
   * Returns a merged view of Clerk users (identity) + platform_access (authorization).
   *
   * Clerk is the identity source. platform_access is the authorization source.
   * If CLERK_SECRET_KEY is not configured, returns only platform_access rows with
   * clerkAvailable: false.
   *
   * Users present in Clerk but missing from platform_access are included with
   * access_status: 'not_provisioned' so admins can see and act on them.
   */
  app.get<{ Querystring: { limit?: string } }>(
    "/api/v1/admin/users",
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit ?? 200), 500);
      const pool = getPool();

      // Fetch all platform_access rows — keyed by clerk_user_id.
      const { rows: accessRows } = await pool.query<{
        id: string;
        clerk_user_id: string;
        org_id: string | null;
        access_status: string;
        access_expires_at: string | null;
        granted_by_user_id: string | null;
        grant_source: string | null;
        notes: string | null;
        is_admin: boolean;
        account_role: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, clerk_user_id, org_id, access_status, access_expires_at,
                granted_by_user_id, grant_source, notes, is_admin, account_role, created_at, updated_at
           FROM platform_access
          ORDER BY created_at DESC`
      );
      const accessByClerkId = new Map(accessRows.map((r) => [r.clerk_user_id, r]));

      // Attempt to fetch users from Clerk Management API.
      const secretKey = process.env.CLERK_SECRET_KEY?.trim();
      let clerkAvailable = false;
      let clerkUsers: Array<{
        id: string;
        email: string | null;
        full_name: string | null;
        clerk_created_at: string | null;
      }> = [];

      if (secretKey) {
        try {
          const clerkResp = await fetch(
            `https://api.clerk.com/v1/users?limit=${limit}&order_by=-created_at`,
            {
              headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json",
              },
            }
          );
          if (clerkResp.ok) {
            const clerkData = (await clerkResp.json()) as Array<{
              id: string;
              email_addresses: Array<{ id: string; email_address: string }>;
              primary_email_address_id: string | null;
              first_name: string | null;
              last_name: string | null;
              created_at: number;
            }>;
            clerkAvailable = true;
            clerkUsers = clerkData.map((u) => {
              const primaryEmail =
                u.email_addresses.find(
                  (e) => e.id === u.primary_email_address_id
                )?.email_address ??
                u.email_addresses[0]?.email_address ??
                null;
              const nameParts = [u.first_name, u.last_name].filter(Boolean);
              return {
                id: u.id,
                email: primaryEmail,
                full_name: nameParts.length > 0 ? nameParts.join(" ") : null,
                clerk_created_at: u.created_at
                  ? new Date(u.created_at).toISOString()
                  : null,
              };
            });
          } else {
            const errText = await clerkResp.text().catch(() => "");
            app.log.warn({ status: clerkResp.status, body: errText }, "Clerk API returned error");
          }
        } catch (err) {
          app.log.warn({ err }, "Failed to reach Clerk Management API");
        }
      }

      // Build merged records.
      // If Clerk is available: Clerk users are the base; platform_access enriches.
      // If Clerk is unavailable: platform_access rows are the base (degraded mode).
      let records: object[];

      if (clerkAvailable && clerkUsers.length > 0) {
        const seenClerkIds = new Set<string>();
        records = clerkUsers.map((cu) => {
          seenClerkIds.add(cu.id);
          const access = accessByClerkId.get(cu.id);
          return {
            clerk_user_id: cu.id,
            email: cu.email,
            full_name: cu.full_name,
            clerk_created_at: cu.clerk_created_at,
            // platform_access fields — null if not provisioned
            id: access?.id ?? null,
            org_id: access?.org_id ?? null,
            access_status: access?.access_status ?? "not_provisioned",
            access_expires_at: access?.access_expires_at ?? null,
            is_admin: access?.is_admin ?? false,
            account_role: access?.account_role ?? null,
            grant_source: access?.grant_source ?? null,
            notes: access?.notes ?? null,
            granted_by_user_id: access?.granted_by_user_id ?? null,
            created_at: access?.created_at ?? null,
            updated_at: access?.updated_at ?? null,
          };
        });
        // Include any platform_access rows whose Clerk users were not in the Clerk response.
        for (const row of accessRows) {
          if (!seenClerkIds.has(row.clerk_user_id)) {
            records.push({
              clerk_user_id: row.clerk_user_id,
              email: null,
              full_name: null,
              clerk_created_at: null,
              id: row.id,
              org_id: row.org_id,
              access_status: row.access_status,
              access_expires_at: row.access_expires_at,
              is_admin: row.is_admin,
              account_role: row.account_role,
              grant_source: row.grant_source,
              notes: row.notes,
              granted_by_user_id: row.granted_by_user_id,
              created_at: row.created_at,
              updated_at: row.updated_at,
            });
          }
        }
      } else {
        // Degraded: return platform_access rows only, no Clerk identity.
        records = accessRows.map((row) => ({
          clerk_user_id: row.clerk_user_id,
          email: null,
          full_name: null,
          clerk_created_at: null,
          id: row.id,
          org_id: row.org_id,
          access_status: row.access_status,
          access_expires_at: row.access_expires_at,
          is_admin: row.is_admin,
          account_role: row.account_role,
          grant_source: row.grant_source,
          notes: row.notes,
          granted_by_user_id: row.granted_by_user_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
      }

      return reply.send({ clerkAvailable, records, total: records.length });
    }
  );

  /**
   * GET /api/v1/admin/users/:clerkUserId/analytics
   * Aggregated user analytics for admin detail view.
   *
   * Query:
   *   days?: 7 | 30 | 90 | all (default 30)
   */
  app.get<{
    Params: { clerkUserId: string };
    Querystring: { days?: string };
  }>(
    "/api/v1/admin/users/:clerkUserId/analytics",
    async (request, reply) => {
      const clerkUserId = request.params.clerkUserId;
      const daysRaw = typeof request.query.days === "string" ? request.query.days.trim().toLowerCase() : "30";
      const allowed = new Set(["7", "30", "90", "all"]);
      const normalizedDays = allowed.has(daysRaw) ? daysRaw : "30";
      const daysWindow = normalizedDays === "all" ? null : Number(normalizedDays);
      const sinceIso = daysWindow != null ? new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000).toISOString() : null;
      const staleCutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const pool = getPool();
      const hasMemberships = await hasTable("organization_memberships");
      const hasJobs = await hasTable("jobs");
      const hasNodeAnalyses = await hasTable("node_ai_analyses");
      const hasAuditLog = await hasTable("platform_audit_log");
      const hasLlmPerformanceMetrics = await hasTable("llm_performance_metrics");
      const hasLlmClerkUserId = hasLlmPerformanceMetrics && await hasColumn("llm_performance_metrics", "clerk_user_id");
      const hasDealOrgId = await hasColumn("deals", "org_id");

      const { rows: accessRows } = await pool.query<{
        clerk_user_id: string;
        org_id: string | null;
        access_status: string;
        access_expires_at: string | null;
        is_admin: boolean;
        account_role: string | null;
        grant_source: string | null;
        notes: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>(
        `SELECT clerk_user_id, org_id, access_status, access_expires_at, is_admin, account_role,
                grant_source, notes, created_at, updated_at
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerkUserId]
      );

      const access = accessRows[0] ?? null;

      const membership = hasMemberships
        ? (
            await pool.query<{
              clerk_org_id: string;
              org_role: string;
              membership_status: string;
              seat_consuming: boolean;
              updated_at: string | null;
            }>(
              `SELECT clerk_org_id, org_role, membership_status, seat_consuming, updated_at
                 FROM organization_memberships
                WHERE clerk_user_id = $1
                ORDER BY updated_at DESC
                LIMIT 1`,
              [clerkUserId]
            )
          ).rows[0] ?? null
        : null;

      const scopedOrgId = (typeof access?.org_id === "string" && access.org_id.trim().length > 0)
        ? access.org_id.trim()
        : (typeof membership?.clerk_org_id === "string" && membership.clerk_org_id.trim().length > 0)
          ? membership.clerk_org_id.trim()
          : null;
      const hasScopedOrg = Boolean(hasDealOrgId && scopedOrgId);
      const dealScopeParam = clerkUserId;
      // Personal-first analytics: keep per-user signal canonical.
      const dealScopeWhere = "(d.created_by_user_id = $1 OR d.created_by_user_id IS NULL)";
      const orgDealScopeWhere = hasScopedOrg ? "d.org_id = $1::text" : null;

      const { rows: dealAggRows } = await pool.query<{
        total_deals: string;
        active_deals: string;
        archived_deals: string;
        stale_deals_30d: string;
        current_deals_30d: string;
        last_deal_activity_at: string | null;
      }>(
        `SELECT
           COUNT(*)::text AS total_deals,
           COUNT(*) FILTER (
             WHERE COALESCE(NULLIF(d.lifecycle_status, ''), 'active') NOT IN ('archived', 'deleted')
           )::text AS active_deals,
           COUNT(*) FILTER (
             WHERE COALESCE(NULLIF(d.lifecycle_status, ''), 'active') IN ('archived', 'deleted')
           )::text AS archived_deals,
           COUNT(*) FILTER (
             WHERE COALESCE(NULLIF(d.lifecycle_status, ''), 'active') NOT IN ('archived', 'deleted')
               AND GREATEST(
                 d.updated_at,
                 COALESCE((SELECT MAX(COALESCE(doc.updated_at, doc.uploaded_at)) FROM documents doc WHERE doc.deal_id = d.id AND doc.deleted_at IS NULL), d.updated_at),
                 COALESCE((SELECT MAX(COALESCE(j.updated_at, j.created_at)) FROM jobs j WHERE j.deal_id = d.id), d.updated_at)
                 ) < $2::timestamptz
           )::text AS stale_deals_30d,
           COUNT(*) FILTER (
             WHERE COALESCE(NULLIF(d.lifecycle_status, ''), 'active') NOT IN ('archived', 'deleted')
               AND GREATEST(
                 d.updated_at,
                 COALESCE((SELECT MAX(COALESCE(doc.updated_at, doc.uploaded_at)) FROM documents doc WHERE doc.deal_id = d.id AND doc.deleted_at IS NULL), d.updated_at),
                 COALESCE((SELECT MAX(COALESCE(j.updated_at, j.created_at)) FROM jobs j WHERE j.deal_id = d.id), d.updated_at)
                 ) >= $2::timestamptz
           )::text AS current_deals_30d,
           MAX(
             GREATEST(
               d.updated_at,
               COALESCE((SELECT MAX(COALESCE(doc.updated_at, doc.uploaded_at)) FROM documents doc WHERE doc.deal_id = d.id AND doc.deleted_at IS NULL), d.updated_at),
               COALESCE((SELECT MAX(COALESCE(j.updated_at, j.created_at)) FROM jobs j WHERE j.deal_id = d.id), d.updated_at)
             )
           )::text AS last_deal_activity_at
         FROM deals d
         WHERE ${dealScopeWhere}
           AND d.deleted_at IS NULL`,
        [dealScopeParam, staleCutoffIso]
      );

      const { rows: dealRows } = await pool.query<{
        deal_id: string;
        name: string;
        stage: string | null;
        lifecycle_status: string | null;
        created_at: string;
        updated_at: string;
        document_count: string;
        total_jobs: string;
        failed_jobs: string;
        last_job_at: string | null;
        last_activity_at: string | null;
        stale_days: number | string | null;
        recommendation_action: string | null;
      }>(
        `SELECT
           d.id AS deal_id,
           d.name,
           d.stage,
           d.lifecycle_status,
           d.created_at::text,
           d.updated_at::text,
           (
             SELECT COUNT(*)::text
               FROM documents doc
              WHERE doc.deal_id = d.id
                AND doc.deleted_at IS NULL
           ) AS document_count,
           (
             SELECT COUNT(*)::text
               FROM jobs j
              WHERE j.deal_id = d.id
           ) AS total_jobs,
           (
             SELECT COUNT(*)::text
               FROM jobs j
              WHERE j.deal_id = d.id
                AND j.status = 'failed'
           ) AS failed_jobs,
           job_meta.last_job_at::text AS last_job_at,
           GREATEST(
             d.updated_at,
             COALESCE(doc_meta.last_document_activity_at, d.updated_at),
             COALESCE(job_meta.last_job_at, d.updated_at)
           )::text AS last_activity_at,
           GREATEST(
             0,
             FLOOR(
               EXTRACT(
                 EPOCH FROM (
                   now() - GREATEST(
                     d.updated_at,
                     COALESCE(doc_meta.last_document_activity_at, d.updated_at),
                     COALESCE(job_meta.last_job_at, d.updated_at)
                   )
                 )
               ) / 86400
             )
           )::int AS stale_days,
           CASE
             WHEN LOWER(COALESCE(d.stage, '')) IN ('funded', 'passed') THEN 'keep_monitoring'
             WHEN COALESCE(NULLIF(d.lifecycle_status, ''), 'active') IN ('archived', 'deleted') THEN 'already_closed'
             ELSE 'archive_or_delete'
           END AS recommendation_action
         FROM deals d
         LEFT JOIN LATERAL (
           SELECT MAX(COALESCE(doc.updated_at, doc.uploaded_at)) AS last_document_activity_at
             FROM documents doc
            WHERE doc.deal_id = d.id
              AND doc.deleted_at IS NULL
         ) doc_meta ON TRUE
         LEFT JOIN LATERAL (
           SELECT MAX(COALESCE(j.updated_at, j.created_at)) AS last_job_at
             FROM jobs j
            WHERE j.deal_id = d.id
         ) job_meta ON TRUE
         WHERE ${dealScopeWhere}
           AND d.deleted_at IS NULL
         ORDER BY GREATEST(
           d.updated_at,
           COALESCE(doc_meta.last_document_activity_at, d.updated_at),
           COALESCE(job_meta.last_job_at, d.updated_at)
         ) DESC
         LIMIT 200`,
        [dealScopeParam]
      );

      const { rows: docAggRows } = await pool.query<{
        total_documents: string;
        last_document_activity_at: string | null;
      }>(
        `SELECT
           COUNT(*)::text AS total_documents,
           MAX(COALESCE(doc.updated_at, doc.uploaded_at))::text AS last_document_activity_at
         FROM documents doc
         INNER JOIN deals d ON d.id = doc.deal_id
         WHERE ${dealScopeWhere}
           AND d.deleted_at IS NULL
           AND doc.deleted_at IS NULL
           AND (
             $2::timestamptz IS NULL
             OR COALESCE(doc.updated_at, doc.uploaded_at) >= $2::timestamptz
           )`,
        [dealScopeParam, sinceIso]
      );

      const jobAggRows = hasJobs
        ? (
            await pool.query<{
              total_jobs: string;
              failed_jobs: string;
              last_job_activity_at: string | null;
            }>(
              `SELECT
                 COUNT(*)::text AS total_jobs,
                 COUNT(*) FILTER (WHERE j.status = 'failed')::text AS failed_jobs,
                 MAX(COALESCE(j.updated_at, j.created_at))::text AS last_job_activity_at
               FROM jobs j
               INNER JOIN deals d ON d.id = j.deal_id
               WHERE ${dealScopeWhere}
                 AND d.deleted_at IS NULL
                 AND (
                   $2::timestamptz IS NULL
                   OR COALESCE(j.updated_at, j.created_at) >= $2::timestamptz
                 )`,
              [dealScopeParam, sinceIso]
            )
          ).rows
        : [{ total_jobs: "0", failed_jobs: "0", last_job_activity_at: null }];

      const aiAggRows = hasNodeAnalyses
        ? (
            await pool.query<{
              analyses_total: string;
              llm_called_total: string;
              last_ai_activity_at: string | null;
            }>(
              `SELECT
                 COUNT(*)::text AS analyses_total,
                 COUNT(*) FILTER (WHERE llm_called = true)::text AS llm_called_total,
                 MAX(na.created_at)::text AS last_ai_activity_at
               FROM node_ai_analyses na
               INNER JOIN deals d ON d.id = na.deal_id
               WHERE ${dealScopeWhere}
                 AND d.deleted_at IS NULL
                 AND (
                   $2::timestamptz IS NULL
                   OR na.created_at >= $2::timestamptz
                 )`,
              [dealScopeParam, sinceIso]
            )
          ).rows
        : [{ analyses_total: "0", llm_called_total: "0", last_ai_activity_at: null }];

      const llmAggRows = hasLlmPerformanceMetrics
        ? (
            await pool.query<{
              llm_calls: string;
              llm_total_tokens: string;
              llm_input_tokens: string;
              llm_output_tokens: string;
              llm_cost_usd: string;
              last_llm_activity_at: string | null;
            }>(
              hasLlmClerkUserId
                ? `SELECT
                     COUNT(*)::text AS llm_calls,
                     COALESCE(SUM(l.total_tokens), 0)::text AS llm_total_tokens,
                     COALESCE(SUM(l.input_tokens), 0)::text AS llm_input_tokens,
                     COALESCE(SUM(l.output_tokens), 0)::text AS llm_output_tokens,
                     COALESCE(SUM(l.cost_usd), 0)::text AS llm_cost_usd,
                     MAX(l.created_at)::text AS last_llm_activity_at
                   FROM llm_performance_metrics l
                   WHERE l.clerk_user_id = $1
                     AND (
                       $2::timestamptz IS NULL
                       OR l.created_at >= $2::timestamptz
                     )`
                : `SELECT
                     COUNT(*)::text AS llm_calls,
                     COALESCE(SUM(l.total_tokens), 0)::text AS llm_total_tokens,
                     COALESCE(SUM(l.input_tokens), 0)::text AS llm_input_tokens,
                     COALESCE(SUM(l.output_tokens), 0)::text AS llm_output_tokens,
                     COALESCE(SUM(l.cost_usd), 0)::text AS llm_cost_usd,
                     MAX(l.created_at)::text AS last_llm_activity_at
                   FROM llm_performance_metrics l
                   INNER JOIN deals d ON d.id = l.deal_id
                   WHERE ${dealScopeWhere}
                     AND d.deleted_at IS NULL
                     AND (
                       $2::timestamptz IS NULL
                       OR l.created_at >= $2::timestamptz
                     )`,
              [dealScopeParam, sinceIso]
            )
          ).rows
        : [{
            llm_calls: "0",
            llm_total_tokens: "0",
            llm_input_tokens: "0",
            llm_output_tokens: "0",
            llm_cost_usd: "0",
            last_llm_activity_at: null,
          }];

      let orgTotalDeals = 0;
      let orgTotalDocuments = 0;
      let personalDealsOrgAssociated = 0;
      let personalDealsUnassociated = 0;

      if (hasScopedOrg && orgDealScopeWhere) {
        const { rows: orgDealAggRows } = await pool.query<{ total_deals: string }>(
          `SELECT COUNT(*)::text AS total_deals
             FROM deals d
            WHERE ${orgDealScopeWhere}
              AND d.deleted_at IS NULL`,
          [scopedOrgId]
        );
        orgTotalDeals = Number(orgDealAggRows[0]?.total_deals ?? "0");

        const { rows: orgDocAggRows } = await pool.query<{ total_documents: string }>(
          `SELECT COUNT(*)::text AS total_documents
             FROM documents doc
             INNER JOIN deals d ON d.id = doc.deal_id
            WHERE ${orgDealScopeWhere}
              AND d.deleted_at IS NULL
              AND doc.deleted_at IS NULL`,
          [scopedOrgId]
        );
        orgTotalDocuments = Number(orgDocAggRows[0]?.total_documents ?? "0");

        const { rows: personalAssociationRows } = await pool.query<{
          associated: string;
          unassociated: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE d.org_id = $2::text)::text AS associated,
             COUNT(*) FILTER (WHERE d.org_id IS NULL OR d.org_id <> $2::text)::text AS unassociated
           FROM deals d
           WHERE d.deleted_at IS NULL
             AND d.created_by_user_id = $1`,
          [clerkUserId, scopedOrgId]
        );
        personalDealsOrgAssociated = Number(personalAssociationRows[0]?.associated ?? "0");
        personalDealsUnassociated = Number(personalAssociationRows[0]?.unassociated ?? "0");
      }

      const auditRows = hasAuditLog
        ? (
            await pool.query<{
              id: string;
              action_type: string;
              entity_type: string;
              entity_id: string;
              reason: string;
              source: string;
              created_at: string;
            }>(
              `SELECT id, action_type, entity_type, entity_id, reason, source, created_at::text
                 FROM platform_audit_log
                WHERE actor_user_id = $1
                  AND (
                    $2::timestamptz IS NULL
                    OR created_at >= $2::timestamptz
                  )
                ORDER BY created_at DESC
                LIMIT 20`,
              [clerkUserId, sinceIso]
            )
          ).rows
        : [];

      const recentJobs = hasJobs
        ? (
            await pool.query<{
              job_id: string;
              type: string | null;
              status: string;
              deal_id: string | null;
              message: string | null;
              error: string | null;
              at: string;
            }>(
              `SELECT
                 j.job_id,
                 j.type,
                 j.status,
                 j.deal_id::text,
                 j.message,
                 j.error,
                 COALESCE(j.updated_at, j.created_at)::text AS at
               FROM jobs j
               INNER JOIN deals d ON d.id = j.deal_id
               WHERE ${dealScopeWhere}
                 AND d.deleted_at IS NULL
                 AND (
                   $2::timestamptz IS NULL
                   OR COALESCE(j.updated_at, j.created_at) >= $2::timestamptz
                 )
               ORDER BY COALESCE(j.updated_at, j.created_at) DESC
               LIMIT 20`,
              [dealScopeParam, sinceIso]
            )
          ).rows
        : [];

      const activity = [
        ...auditRows.map((a) => ({
          id: `audit:${a.id}`,
          kind: "audit",
          at: a.created_at,
          severity: "info" as const,
          label: a.action_type,
          detail: `${a.entity_type}:${a.entity_id}${a.reason ? ` • ${a.reason}` : ""}`,
          source: a.source,
        })),
        ...recentJobs.map((j) => ({
          id: `job:${j.job_id}:${j.at}`,
          kind: "job",
          at: j.at,
          severity: j.status === "failed" ? ("warning" as const) : ("info" as const),
          label: `Job ${j.status}`,
          detail: `${j.type ?? "unknown"}${j.deal_id ? ` • deal:${j.deal_id}` : ""}${j.message ? ` • ${j.message}` : ""}`,
          source: "jobs",
        })),
      ]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 30);

      const dealAgg = dealAggRows[0] ?? {
        total_deals: "0",
        active_deals: "0",
        archived_deals: "0",
        stale_deals_30d: "0",
        current_deals_30d: "0",
        last_deal_activity_at: null,
      };
      const docAgg = docAggRows[0] ?? { total_documents: "0", last_document_activity_at: null };
      const jobAgg = jobAggRows[0] ?? { total_jobs: "0", failed_jobs: "0", last_job_activity_at: null };
      const aiAgg = aiAggRows[0] ?? { analyses_total: "0", llm_called_total: "0", last_ai_activity_at: null };
      const llmAgg = llmAggRows[0] ?? {
        llm_calls: "0",
        llm_total_tokens: "0",
        llm_input_tokens: "0",
        llm_output_tokens: "0",
        llm_cost_usd: "0",
        last_llm_activity_at: null,
      };

      if (!hasScopedOrg) {
        personalDealsUnassociated = Number(dealAgg.total_deals ?? "0");
      }

      const scopedDeals = dealRows.map((d) => {
        const lifecycle = d.lifecycle_status ?? "active";
        const lastActivityAt = d.last_activity_at ?? d.last_job_at ?? d.updated_at;
        const parsedStaleDays = typeof d.stale_days === "number"
          ? d.stale_days
          : Number.parseInt(String(d.stale_days ?? "0"), 10);
        return {
          deal_id: d.deal_id,
          name: d.name,
          stage: d.stage,
          lifecycle_status: lifecycle,
          created_at: d.created_at,
          updated_at: d.updated_at,
          last_activity_at: lastActivityAt,
          stale_days: Number.isFinite(parsedStaleDays) ? parsedStaleDays : 0,
          recommendation_action: d.recommendation_action ?? "archive_or_delete",
          document_count: Number(d.document_count ?? "0"),
          total_jobs: Number(d.total_jobs ?? "0"),
          failed_jobs: Number(d.failed_jobs ?? "0"),
          last_job_at: d.last_job_at,
        };
      });

      const staleDeals = scopedDeals
        .filter((d) => {
          const status = String(d.lifecycle_status ?? "active").toLowerCase();
          return !["archived", "deleted"].includes(status) && d.stale_days >= 30;
        })
        .sort((a, b) => b.stale_days - a.stale_days);

      const currentDeals = scopedDeals
        .filter((d) => {
          const status = String(d.lifecycle_status ?? "active").toLowerCase();
          return !["archived", "deleted"].includes(status) && d.stale_days < 30;
        })
        .sort((a, b) => new Date(b.last_activity_at ?? b.updated_at).getTime() - new Date(a.last_activity_at ?? a.updated_at).getTime());

      const lastActivityCandidates = [
        access?.updated_at ?? null,
        membership?.updated_at ?? null,
        dealAgg.last_deal_activity_at,
        docAgg.last_document_activity_at,
        jobAgg.last_job_activity_at,
        aiAgg.last_ai_activity_at,
        llmAgg.last_llm_activity_at,
        activity[0]?.at ?? null,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);

      const lastActivityAt = lastActivityCandidates.length > 0
        ? new Date(
            Math.max(...lastActivityCandidates.map((v) => new Date(v).getTime()))
          ).toISOString()
        : null;

      return reply.send({
        user: {
          clerk_user_id: clerkUserId,
          org_id: access?.org_id ?? null,
          access_status: access?.access_status ?? "not_provisioned",
          access_expires_at: access?.access_expires_at ?? null,
          is_admin: access?.is_admin ?? false,
          account_role: access?.account_role ?? null,
          grant_source: access?.grant_source ?? null,
          notes: access?.notes ?? null,
          created_at: access?.created_at ?? null,
          updated_at: access?.updated_at ?? null,
          membership: membership
            ? {
                clerk_org_id: membership.clerk_org_id,
                org_role: membership.org_role,
                membership_status: membership.membership_status,
                seat_consuming: membership.seat_consuming,
              }
            : null,
        },
        window: {
          days: daysWindow,
          since: sinceIso,
          label: daysWindow == null ? "all" : `${daysWindow}d`,
        },
        kpis: {
          total_deals: Number(dealAgg.total_deals ?? "0"),
          active_deals: Number(dealAgg.active_deals ?? "0"),
          archived_deals: Number(dealAgg.archived_deals ?? "0"),
          stale_deals_30d: Number(dealAgg.stale_deals_30d ?? "0"),
          current_deals_30d: Number(dealAgg.current_deals_30d ?? "0"),
          total_documents: Number(docAgg.total_documents ?? "0"),
          org_total_deals: orgTotalDeals,
          org_total_documents: orgTotalDocuments,
          personal_deals_org_associated: personalDealsOrgAssociated,
          personal_deals_unassociated: personalDealsUnassociated,
          total_jobs: Number(jobAgg.total_jobs ?? "0"),
          failed_jobs: Number(jobAgg.failed_jobs ?? "0"),
          ai_analyses_total: Number(aiAgg.analyses_total ?? "0"),
          ai_llm_called_total: Number(aiAgg.llm_called_total ?? "0"),
          llm_calls: Number(llmAgg.llm_calls ?? "0"),
          llm_total_tokens: Number(llmAgg.llm_total_tokens ?? "0"),
          llm_input_tokens: Number(llmAgg.llm_input_tokens ?? "0"),
          llm_output_tokens: Number(llmAgg.llm_output_tokens ?? "0"),
          llm_cost_usd: Number(llmAgg.llm_cost_usd ?? "0"),
          last_activity_at: lastActivityAt,
        },
        deals: scopedDeals.slice(0, 20),
        current_deals: currentDeals.slice(0, 50),
        stale_deals: staleDeals.slice(0, 50),
        activity,
        data_quality: {
          attributed_sources: {
            platform_access: access != null,
            organization_memberships: hasMemberships,
            deals_org_scope_enabled: hasScopedOrg,
            deals_accessible_scope: true,
            documents_via_accessible_deals: true,
            jobs_via_accessible_deals: hasJobs,
            node_ai_analyses_via_accessible_deals: hasNodeAnalyses,
            llm_metrics_via_accessible_deals: hasLlmPerformanceMetrics,
            llm_metrics_direct_user_attribution: hasLlmClerkUserId,
            audit_log_actor_events: hasAuditLog,
          },
          unsupported_metrics: {
            chat_sessions: {
              status: "unavailable",
              reason: "No per-user chat session telemetry table is available in the governed schema.",
            },
            session_duration: {
              status: "unavailable",
              reason: "No user session duration telemetry source is currently available.",
            },
          },
        },
      });
    }
  );

  // ─── Admin status management ─────────────────────────────────────────────────

  /**
   * PATCH /api/v1/admin/platform-access/:clerkUserId/admin-status
   * Set or clear is_admin for a platform_access row.
   *
   * Body: { is_admin: boolean }
   *
   * Rules:
   *   - Only admins can call this (enforced by preHandler).
   *   - An admin cannot remove their own admin status (safety guard).
   *   - Returns 409 if the target user does not have a platform_access row.
   */
  app.patch<{
    Params: { clerkUserId: string };
    Body: { is_admin: boolean; reason?: string | null };
  }>(
    "/api/v1/admin/platform-access/:clerkUserId/admin-status",
    async (request, reply) => {
      // Only super_admin may promote or demote admin access.
      // requireAdminAuth (is_admin = true) is already enforced by the preHandler above;
      // this adds the additional super_admin constraint specifically for this route.
      const superAllowed = await requireSuperAdminAuth(request, reply);
      if (!superAllowed) return;

      const { clerkUserId } = request.params;
      const { is_admin } = request.body ?? {};
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request);

      if (typeof is_admin !== "boolean") {
        return reply.status(400).send({ error: "is_admin must be a boolean" });
      }

      const actorId = (request as any).auth?.userId;

      // Prevent self-demotion. An admin can only remove their own admin status
      // through a deliberate separate step — block it here for safety.
      if (!is_admin && actorId === clerkUserId) {
        return reply.status(400).send({
          error: "You cannot remove your own admin status. Have another admin do it.",
          code: "SELF_DEMOTION_BLOCKED",
        });
      }

      const pool = getPool();

      // Verify the target user has a platform_access row.
      const check = await pool.query(
        `SELECT id, clerk_user_id, access_status, is_admin, account_role FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
        [clerkUserId]
      );
      if (check.rows.length === 0) {
        return reply.status(404).send({ error: "No platform_access record found for this user" });
      }

      const { rows } = await pool.query(
        `UPDATE platform_access
            SET is_admin = $1, updated_at = now()
          WHERE clerk_user_id = $2
          RETURNING clerk_user_id, access_status, is_admin, updated_at`,
        [is_admin, clerkUserId]
      );

      await writePlatformAuditLog({
        ...actor,
        action_type: "platform_access.set_admin_status",
        entity_type: "platform_access",
        entity_id: clerkUserId,
        before_state: check.rows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, record: rows[0] });
    }
  );

  /**
   * PATCH /api/v1/admin/platform-access/:clerkUserId/revoke
   * Revoke platform access for a user.
   */
  app.patch<{ Params: { clerkUserId: string } }>(
    "/api/v1/admin/platform-access/:clerkUserId/revoke",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const actorId = (request as any).auth?.userId;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request);

      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT clerk_user_id, access_status, is_admin, account_role, access_expires_at
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerkUserId]
      );

      // Prevent non-super_admin from revoking a super_admin's access.
      const bypassedAuth = Boolean((request as any).auth?.claims?.['bypass_auth']);
      if (!bypassedAuth) {
        const { rows: targetRows } = await pool.query(
          `SELECT account_role FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
          [clerkUserId]
        );
        if (targetRows.length > 0 && targetRows[0].account_role === 'super_admin') {
          const callerIsSuperAdmin = actorId ? await isDbSuperAdmin(actorId) : false;
          if (!callerIsSuperAdmin) {
            return reply.status(403).send({
              error: 'Forbidden: only a super_admin may revoke another super_admin',
              code: 'SUPER_ADMIN_REQUIRED',
            });
          }
        }
      }

      const { rows } = await pool.query(
        `UPDATE platform_access
            SET access_status = 'revoked', updated_at = now(),
                granted_by_user_id = $2
          WHERE clerk_user_id = $1
          RETURNING clerk_user_id, access_status, updated_at`,
        [clerkUserId, actorId ?? null]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "No platform_access record found for this user" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "platform_access.revoke",
        entity_type: "platform_access",
        entity_id: clerkUserId,
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, record: rows[0] });
    }
  );

  /**
   * PATCH /api/v1/admin/platform-access/:clerkUserId/extend
   * Extend (or set) access_expires_at for a user.
   *
   * Body: { access_duration_days: number }
   * Adds N days from now (not from current expiry).
   */
  app.patch<{
    Params: { clerkUserId: string };
    Body: { access_duration_days: number; reason?: string | null };
  }>(
    "/api/v1/admin/platform-access/:clerkUserId/extend",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const { access_duration_days } = request.body ?? {};
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request);

      if (
        typeof access_duration_days !== "number" ||
        !Number.isInteger(access_duration_days) ||
        access_duration_days < 1 ||
        access_duration_days > 365
      ) {
        return reply.status(400).send({
          error: "access_duration_days must be an integer between 1 and 365",
        });
      }

      const expiresAt = new Date(
        Date.now() + access_duration_days * 24 * 60 * 60 * 1000
      ).toISOString();

      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT clerk_user_id, access_status, access_expires_at
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerkUserId]
      );
      const { rows } = await pool.query(
        `UPDATE platform_access
            SET access_status = 'active',
                access_expires_at = $2,
                updated_at = now()
          WHERE clerk_user_id = $1
          RETURNING clerk_user_id, access_status, access_expires_at, updated_at`,
        [clerkUserId, expiresAt]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "No platform_access record found for this user" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "platform_access.extend",
        entity_type: "platform_access",
        entity_id: clerkUserId,
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, record: rows[0] });
    }
  );

  /**
   * PATCH /api/v1/admin/platform-access/:clerkUserId/account-role
   * Set the account_role for a platform_access row.
   *
   * Body: { account_role: 'super_admin' | 'admin' | 'account_executive' | 'analyst' | 'client' }
   */
  app.patch<{
    Params: { clerkUserId: string };
    Body: { account_role: string; reason?: string | null };
  }>(
    "/api/v1/admin/platform-access/:clerkUserId/account-role",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const { account_role } = request.body ?? {};
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request);

      const valid = ['super_admin', 'admin', 'account_executive', 'analyst', 'client'];
      if (!valid.includes(account_role)) {
        return reply.status(400).send({
          error: `account_role must be one of: ${valid.join(', ')}`,
        });
      }

      // Only a super_admin may assign super_admin to anyone (including themselves).
      if (account_role === 'super_admin') {
        const callerId = (request as any).auth?.userId;
        const bypassedAuth = Boolean((request as any).auth?.claims?.['bypass_auth']);
        if (!bypassedAuth) {
          if (!callerId || !(await isDbSuperAdmin(callerId))) {
            return reply.status(403).send({
              error: 'Forbidden: only a super_admin may assign the super_admin role',
              code: 'SUPER_ADMIN_REQUIRED',
            });
          }
        }
      }

      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT clerk_user_id, access_status, is_admin, account_role
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerkUserId]
      );
      const { rows } = await pool.query(
        `UPDATE platform_access
            SET account_role = $1, updated_at = now()
          WHERE clerk_user_id = $2
          RETURNING clerk_user_id, access_status, is_admin, account_role, updated_at`,
        [account_role, clerkUserId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "No platform_access record found for this user" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "platform_access.set_account_role",
        entity_type: "platform_access",
        entity_id: clerkUserId,
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, record: rows[0] });
    }
  );

  // ─── Provision user ──────────────────────────────────────────────────────────

  /**
   * POST /api/v1/admin/provision-user
   * Create a platform_access row for an existing Clerk user who has no access yet.
   * Protected by the preHandler admin check that covers all /api/v1/admin/* routes.
   *
   * Body: { clerk_user_id, account_role?, access_duration_days?, notes? }
   */
  app.post<{
    Body: {
      clerk_user_id: string;
      account_role?: string;
      access_duration_days?: number;
      notes?: string;
      reason?: string | null;
    };
  }>("/api/v1/admin/provision-user", async (request, reply) => {
    const { clerk_user_id, account_role = "client", access_duration_days, notes } = request.body ?? {};
    const reason = requireMutationReason(request, reply);
    if (!reason) return;
    const actor = getAuditActorContext(request);

    if (!clerk_user_id || typeof clerk_user_id !== "string") {
      return reply.status(400).send({ error: "clerk_user_id is required", code: "MISSING_CLERK_USER_ID" });
    }

    const validRoles = ["super_admin", "admin", "account_executive", "analyst", "client"];
    if (!validRoles.includes(account_role)) {
      return reply.status(400).send({ error: `account_role must be one of: ${validRoles.join(", ")}`, code: "INVALID_ROLE" });
    }

    // Only a super_admin may provision another user as super_admin.
    if (account_role === 'super_admin') {
      const callerId = (request as any).auth?.userId;
      const bypassedAuth = Boolean((request as any).auth?.claims?.['bypass_auth']);
      if (!bypassedAuth) {
        if (!callerId || !(await isDbSuperAdmin(callerId))) {
          return reply.status(403).send({
            error: 'Forbidden: only a super_admin may assign the super_admin role',
            code: 'SUPER_ADMIN_REQUIRED',
          });
        }
      }
    }

    const pool = getPool();
    const orgId = process.env.DEFAULT_ORG_ID ?? "dev_org";

    // Check for existing row
    const { rows: existing } = await pool.query(
      `SELECT id FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
      [clerk_user_id]
    );
    if (existing.length > 0) {
      return reply.status(409).send({ error: "User already has a platform_access record", code: "ALREADY_PROVISIONED" });
    }

    const expiresAt =
      access_duration_days != null
        ? new Date(Date.now() + access_duration_days * 86_400_000).toISOString()
        : null;

    const { rows } = await pool.query(
      `INSERT INTO platform_access
         (clerk_user_id, org_id, access_status, account_role, is_admin, grant_source, notes, access_expires_at)
       VALUES ($1, $2, 'active', $3, false, 'admin', $4, $5)
       RETURNING *`,
      [clerk_user_id, orgId, account_role, notes ?? null, expiresAt]
    );

    await writePlatformAuditLog({
      ...actor,
      action_type: "platform_access.provision_user",
      entity_type: "platform_access",
      entity_id: clerk_user_id,
      before_state: {},
      after_state: rows[0] ?? {},
      reason,
    });

    return reply.status(201).send({ ok: true, record: rows[0] });
  });

  // ─── Bootstrap endpoint ──────────────────────────────────────────────────────

  /**
   * POST /api/v1/admin/bootstrap-first-admin
   * One-time bootstrap: promote a platform_access row to is_admin = true.
   *
   * This endpoint is EXEMPT from the preHandler admin check (you need it before
   * any admin exists). It is instead protected by ADMIN_TOKEN.
   *
   * Body: { clerk_user_id: string }
   *
   * After Ryan's row is set to is_admin = true, all subsequent admin operations
   * go through the DB-backed requireAdminAuth path and this endpoint's purpose
   * is fulfilled. It can remain as a recovery mechanism.
   */
  app.post<{ Body: { clerk_user_id: string; reason?: string | null } }>(
    "/api/v1/admin/bootstrap-first-admin",
    {
      preHandler: async (request, reply) => {
        // Require ADMIN_TOKEN (or dev bypass). No is_admin check — that's the point.
        const bypassedAuth = Boolean((request as any).auth?.claims?.["bypass_auth"]);
        if (bypassedAuth) return;

        const adminToken = process.env.ADMIN_TOKEN?.trim();
        if (!adminToken) {
          reply.status(503).send({
            error: "ADMIN_TOKEN is not configured. Set it in env to use bootstrap.",
            code: "ADMIN_TOKEN_NOT_CONFIGURED",
          });
          return;
        }

        const provided =
          (request.headers["x-admin-token"] as string | undefined) ??
          request.headers.authorization?.replace(/^Bearer\s+/i, "");

        if (typeof provided !== "string" || provided.trim() !== adminToken) {
          reply.status(403).send({ error: "Invalid admin token" });
          return;
        }
      },
    },
    async (request, reply) => {
      const { clerk_user_id } = request.body ?? {};
      const reason = requireMutationReason(request, reply, "bootstrap_first_admin");
      if (!reason) return;
      const actor = getAuditActorContext(request);

      if (
        !clerk_user_id ||
        typeof clerk_user_id !== "string" ||
        clerk_user_id.trim().length === 0
      ) {
        return reply.status(400).send({ error: "clerk_user_id is required" });
      }

      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT clerk_user_id, access_status, is_admin, account_role
           FROM platform_access
          WHERE clerk_user_id = $1
          LIMIT 1`,
        [clerk_user_id.trim()]
      );

      // Upsert: if the row doesn't exist yet, create it as active+super_admin.
      // If it already exists, update is_admin and account_role.
      const { rows } = await pool.query(
        `INSERT INTO platform_access (clerk_user_id, access_status, is_admin, account_role, grant_source, notes, created_at, updated_at)
              VALUES ($1, 'active', TRUE, 'super_admin', 'admin', 'Bootstrapped as first admin', now(), now())
         ON CONFLICT (clerk_user_id) DO UPDATE
              SET is_admin = TRUE, account_role = 'super_admin', updated_at = now()
          RETURNING clerk_user_id, access_status, is_admin, account_role, updated_at`,
        [clerk_user_id.trim()]
      );

      await writePlatformAuditLog({
        ...actor,
        action_type: "platform_access.bootstrap_first_admin",
        entity_type: "platform_access",
        entity_id: clerk_user_id.trim(),
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, record: rows[0] });
    }
  );

  /**
   * POST /api/v1/admin/invite-codes/:code/revoke
   * Revoke an active invite code.
   */
  app.post<{ Params: { code: string } }>(
    "/api/v1/admin/invite-codes/:code/revoke",
    async (request, reply) => {
      const { code } = request.params;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request);
      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT code, status, redeemed_by_clerk_user_id, redeemed_at FROM invite_codes WHERE code = $1 LIMIT 1`,
        [code]
      );
      const { rows } = await pool.query(
        `UPDATE invite_codes SET status = 'revoked', updated_at = now()
          WHERE code = $1 AND status = 'active'
          RETURNING code, status, updated_at`,
        [code]
      );
      if (rows.length === 0) {
        return reply.status(404).send({
          error: "Invite code not found or not in active state",
        });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "invite.revoke",
        entity_type: "invite_code",
        entity_id: code,
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });
      return reply.send({ ok: true, record: rows[0] });
    }
  );

  app.get<{
    Querystring: { limit?: string; offset?: string; query?: string };
  }>("/api/v1/admin/recovery/deals", async (request, reply) => {
    const limitRaw = Number(request.query.limit ?? 50);
    const offsetRaw = Number(request.query.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const query = typeof request.query.query === "string" ? request.query.query.trim() : "";

    const params: unknown[] = [];
    const where: string[] = ["d.deleted_at IS NOT NULL"];
    if (query.length > 0) {
      params.push(`%${query}%`);
      const i = params.length;
      where.push(`(d.id::text ILIKE $${i} OR d.name ILIKE $${i} OR COALESCE(d.owner, '') ILIKE $${i})`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const pool = getPool();

    const { rows: countRows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM deals d ${whereSql}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.stage, d.priority, d.lifecycle_status, d.owner, d.deleted_at, d.updated_at
         FROM deals d
         ${whereSql}
        ORDER BY d.deleted_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return reply.send({
      records: rows,
      limit,
      offset,
      total: Number(countRows[0]?.total ?? "0"),
    });
  });

  app.get<{
    Querystring: { limit?: string; offset?: string; query?: string; deal_id?: string };
  }>("/api/v1/admin/recovery/documents", async (request, reply) => {
    const limitRaw = Number(request.query.limit ?? 50);
    const offsetRaw = Number(request.query.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const query = typeof request.query.query === "string" ? request.query.query.trim() : "";
    const dealId = typeof request.query.deal_id === "string" ? request.query.deal_id.trim() : "";

    const params: unknown[] = [];
    const where: string[] = ["doc.deleted_at IS NOT NULL"];

    if (dealId.length > 0) {
      params.push(dealId);
      where.push(`doc.deal_id = $${params.length}`);
    }

    if (query.length > 0) {
      params.push(`%${query}%`);
      const i = params.length;
      where.push(`(
        doc.id::text ILIKE $${i}
        OR COALESCE(doc.title, '') ILIKE $${i}
        OR doc.deal_id::text ILIKE $${i}
        OR COALESCE(d.name, '') ILIKE $${i}
      )`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const pool = getPool();

    const { rows: countRows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM documents doc
         LEFT JOIN deals d ON d.id = doc.deal_id
         ${whereSql}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT
         doc.id AS document_id,
         doc.deal_id,
         d.name AS deal_name,
         doc.title,
         doc.type,
         doc.status,
         doc.deleted_at,
         doc.updated_at,
         d.deleted_at AS deal_deleted_at
       FROM documents doc
       LEFT JOIN deals d ON d.id = doc.deal_id
       ${whereSql}
       ORDER BY doc.deleted_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return reply.send({
      records: rows,
      limit,
      offset,
      total: Number(countRows[0]?.total ?? "0"),
    });
  });

  app.post<{ Params: { dealId: string }; Body: { reason?: string | null } }>(
    "/api/v1/admin/recovery/deals/:dealId/restore",
    async (request, reply) => {
      const dealId = request.params.dealId;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request as any);
      const pool = getPool();

      const { rows: beforeRows } = await pool.query(
        `SELECT * FROM deals WHERE id = $1 LIMIT 1`,
        [dealId]
      );

      const { rows } = await pool.query(
        `UPDATE deals
            SET deleted_at = NULL,
                lifecycle_status = CASE
                  WHEN lifecycle_status = 'archived' THEN lifecycle_status
                  ELSE 'active'
                END,
                updated_at = now()
          WHERE id = $1
            AND deleted_at IS NOT NULL
          RETURNING *`,
        [dealId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Deleted deal not found" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "deal.restore",
        entity_type: "deal",
        entity_id: dealId,
        before_state: beforeRows[0] ?? {},
        after_state: rows[0] ?? {},
        reason,
      });

      return reply.send({ ok: true, deal_id: dealId });
    }
  );

  app.post<{ Params: { documentId: string }; Body: { reason?: string | null } }>(
    "/api/v1/admin/recovery/documents/:documentId/restore",
    async (request, reply) => {
      const documentId = request.params.documentId;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const actor = getAuditActorContext(request as any);
      const pool = getPool();

      const { rows: beforeRows } = await pool.query(
        `SELECT id, deal_id, title, status, deleted_at
           FROM documents
          WHERE id = $1
          LIMIT 1`,
        [documentId]
      );

      const { rows } = await pool.query<{ id: string; deal_id: string }>(
        `UPDATE documents
            SET deleted_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND deleted_at IS NOT NULL
          RETURNING id, deal_id`,
        [documentId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Deleted document not found" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "document.restore",
        entity_type: "document",
        entity_id: documentId,
        before_state: beforeRows[0] ?? {},
        after_state: { id: rows[0].id, deal_id: rows[0].deal_id, deleted_at: null },
        reason,
      });

      return reply.send({ ok: true, document_id: documentId, deal_id: rows[0].deal_id });
    }
  );

  app.post<{ Params: { dealId: string }; Body: { reason?: string | null; confirm_text?: string | null } }>(
    "/api/v1/admin/recovery/deals/:dealId/purge",
    async (request, reply) => {
      const allowed = await requireSuperAdminAuth(request, reply);
      if (!allowed) return;

      const dealId = request.params.dealId;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const expectedToken = buildPurgeConfirmationToken({ entityType: "deal", entityId: dealId });
      if (!requirePurgeConfirmation(request, reply, expectedToken)) return;

      const actor = getAuditActorContext(request as any);
      const pool = getPool();
      const { rows: beforeRows } = await pool.query(
        `SELECT * FROM deals WHERE id = $1 LIMIT 1`,
        [dealId]
      );

      try {
        const purge = await purgeDealCascade({
          deal_id: dealId,
          actor_user_id: actor.actor_user_id,
          reason,
          db: pool as any,
          logger: console as any,
        });

        await writePlatformAuditLog({
          ...actor,
          action_type: "deal.purge",
          entity_type: "deal",
          entity_id: dealId,
          before_state: beforeRows[0] ?? {},
          after_state: purge as unknown as Record<string, unknown>,
          reason,
        });

        return reply.send({ ok: true, deal_id: dealId, purge });
      } catch (err) {
        if (isPurgeDealNotFoundError(err)) {
          return reply.status(404).send({ error: "Deal not found" });
        }
        const message = err instanceof Error ? err.message : "Purge failed";
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Params: { documentId: string }; Body: { reason?: string | null; confirm_text?: string | null } }>(
    "/api/v1/admin/recovery/documents/:documentId/purge",
    async (request, reply) => {
      const allowed = await requireSuperAdminAuth(request, reply);
      if (!allowed) return;

      const documentId = request.params.documentId;
      const reason = requireMutationReason(request, reply);
      if (!reason) return;
      const expectedToken = buildPurgeConfirmationToken({ entityType: "document", entityId: documentId });
      if (!requirePurgeConfirmation(request, reply, expectedToken)) return;

      const actor = getAuditActorContext(request as any);
      const pool = getPool();

      const { rows: beforeRows } = await pool.query(
        `SELECT id, deal_id, title, status, deleted_at
           FROM documents
          WHERE id = $1
          LIMIT 1`,
        [documentId]
      );

      const { rows } = await pool.query<{ id: string; deal_id: string }>(
        `DELETE FROM documents
          WHERE id = $1
            AND deleted_at IS NOT NULL
          RETURNING id, deal_id`,
        [documentId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Deleted document not found" });
      }

      await writePlatformAuditLog({
        ...actor,
        action_type: "document.hard_delete",
        entity_type: "document",
        entity_id: documentId,
        before_state: beforeRows[0] ?? {},
        after_state: { id: rows[0].id, deal_id: rows[0].deal_id, delete_mode: "hard" },
        reason,
      });

      return reply.send({ ok: true, document_id: documentId, deal_id: rows[0].deal_id });
    }
  );

  // ---------------------------------------------------------------------------
  // Cross-Deal Intelligence Patterns  (internal admin only)
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/admin/cross-deal/patterns
   *
   * Aggregates recurring weakness patterns across all non-deleted deals.
   * Uses existing stored outputs — no new extraction or LLM calls.
   *
   * Sources:
   *   ingestion_reports.summary → conviction_v1 (contradictions, unknowns, required_next_checks, bands)
   *   deal_challenge_pass_results → missing_evidence, contradiction_explanations, challenge_factors
   *   deals → id, name, score
   */
  app.get("/api/v1/admin/cross-deal/patterns", async (_request, reply) => {
    const pool = getPool();

    // ── 1. Load all non-deleted deals ────────────────────────────────────────
    const dealsResult = await pool.query<{ id: string; name: string; score: number | null }>(
      `SELECT id, name, score FROM deals WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`
    );
    const dealMap = new Map(dealsResult.rows.map((d) => [d.id, d]));

    // ── 2. Latest ingestion_report per deal ───────────────────────────────────
    // DISTINCT ON picks the most recent row per deal_id.
    const reportsResult = await pool.query<{ deal_id: string; summary: any }>(
      `SELECT DISTINCT ON (deal_id)
         deal_id,
         summary
       FROM ingestion_reports
       WHERE deal_id IS NOT NULL
       ORDER BY deal_id, created_at DESC`
    );

    // ── 3. Latest challenge_pass result per deal ──────────────────────────────
    let challengeRows: Array<{
      deal_id: string;
      verdict: string | null;
      verdict_resistance_score: number;
      verdict_resistance_label: string;
      missing_evidence: unknown[];
      contradiction_explanations: unknown[];
      challenge_factors: unknown[];
      primary_challenge_reason: string;
      flag_count_critical: number;
    }> = [];
    try {
      const cr = await pool.query(
        `SELECT DISTINCT ON (deal_id)
           deal_id,
           verdict,
           verdict_resistance_score,
           verdict_resistance_label,
           missing_evidence,
           contradiction_explanations,
           challenge_factors,
           primary_challenge_reason,
           flag_count_critical
         FROM deal_challenge_pass_results
         ORDER BY deal_id, created_at DESC`
      );
      challengeRows = cr.rows;
    } catch {
      // Table may not exist in older deployments — degrade gracefully.
    }
    const challengeMap = new Map(challengeRows.map((r) => [r.deal_id, r]));

    // ── 4. Aggregate patterns ─────────────────────────────────────────────────

    type PatternAccum = Map<string, { label: string; deal_ids: Set<string>; severity?: string; why: string }>;

    const contradictionsByCode: PatternAccum = new Map();
    const unknownsByCode: PatternAccum = new Map();
    const requiredCheckBuckets: PatternAccum = new Map();
    const missingEvidenceByType: PatternAccum = new Map();
    const contradictionExplByType: PatternAccum = new Map();
    const challengeFactorByCode: PatternAccum = new Map();
    const bandCounts = new Map<string, number>();
    const verdictCounts = new Map<string, number>();
    const fragileDeals: Array<{
      deal_id: string; deal_name: string; score: number | null;
      conviction_score: number | null; conviction_band: string | null;
      confidence: number | null; resistance_label: string | null;
      top_reason: string | null; fragility_signals: string[];
      readiness: DecisionReadiness | null;
    }> = [];

    const acc = (map: PatternAccum, code: string, label: string, dealId: string, severity?: string, why?: string) => {
      if (!map.has(code)) map.set(code, { label, deal_ids: new Set(), severity, why: why ?? '' });
      const entry = map.get(code)!;
      entry.deal_ids.add(dealId);
      // Escalate severity if a higher one appears
      if (severity && entry.severity) {
        const rank: Record<string, number> = { Critical: 3, High: 2, Medium: 1, Low: 0 };
        if ((rank[severity] ?? 0) > (rank[entry.severity] ?? 0)) entry.severity = severity;
      }
    };

    const evaluatedDealIds = new Set<string>();
    const readinessByDeal = new Map<string, DecisionReadiness>();

    for (const row of reportsResult.rows) {
      const dealId = row.deal_id;
      if (!dealMap.has(dealId)) continue; // skip deals not in the non-deleted set
      evaluatedDealIds.add(dealId);

      const summary = row.summary as any;
      const report = summary ?? {};
      const cv1: any = report?.conviction_v1 ?? report?.structured_summary?.conviction_v1 ?? null;

      // Conviction band distribution
      const band: string = cv1?.conviction_band ?? 'unknown';
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);

      if (!cv1) continue;

      const confidence: number | null =
        typeof cv1.confidence_0_1 === 'number' ? cv1.confidence_0_1 : null;
      const covRatio: number | null =
        typeof cv1.coverage_ratio_0_1 === 'number' ? cv1.coverage_ratio_0_1 : null;
      const cvScore: number | null =
        typeof cv1.conviction_score_0_100 === 'number' ? cv1.conviction_score_0_100 : null;
      const deal = dealMap.get(dealId)!;

      // Compute decision readiness for this deal (deterministic).
      const challengeRow = challengeMap.get(dealId);
      const challengeFactors: Array<{ code?: string; severity?: string }> = Array.isArray(challengeRow?.challenge_factors)
        ? (challengeRow!.challenge_factors as Array<{ code?: string; severity?: string }>)
        : [];
      const missingEvidence: Array<{ evidence_type?: string; verdict_sensitivity?: string }> = Array.isArray(challengeRow?.missing_evidence)
        ? (challengeRow!.missing_evidence as Array<{ evidence_type?: string; verdict_sensitivity?: string }>)
        : [];
      const cv1ContradictionCount = Array.isArray(cv1.contradictions) ? (cv1.contradictions as unknown[]).length : 0;
      const cpContradictionCount = Array.isArray(challengeRow?.contradiction_explanations)
        ? (challengeRow!.contradiction_explanations as unknown[]).length
        : 0;
      const drResult = classifyDecisionReadiness({
        conviction_score: cvScore,
        challenge_factors: challengeFactors,
        missing_evidence: missingEvidence,
        contradiction_count: Math.max(cv1ContradictionCount, cpContradictionCount),
        flag_count_critical: typeof challengeRow?.flag_count_critical === 'number' ? challengeRow!.flag_count_critical : 0,
      });
      readinessByDeal.set(dealId, drResult.readiness);

      // Fragile signal: very low score (< 30) or fragile resistance label.
      // Threshold is deliberately conservative — < 30 is meaningfully low, < 40
      // is too broad for a portfolio with mostly hard_pass bands.
      const isFragile =
        (cvScore !== null && cvScore < 30) ||
        (challengeRow?.verdict_resistance_label === 'Fragile' ||
          challengeRow?.verdict_resistance_label === 'Very Fragile');

      if (isFragile) {
        const fragileSignals: string[] = [];
        if (cvScore !== null && cvScore < 30) fragileSignals.push(`Very low conviction score (${cvScore})`);
        if (challengeRow?.verdict_resistance_label === 'Very Fragile') fragileSignals.push('Verdict Very Fragile');
        else if (challengeRow?.verdict_resistance_label === 'Fragile') fragileSignals.push('Verdict Fragile');
        if (covRatio !== null && covRatio < 0.3) fragileSignals.push(`Low coverage (${(covRatio * 100).toFixed(0)}%)`);

        fragileDeals.push({
          deal_id: dealId,
          deal_name: deal.name,
          score: deal.score,
          conviction_score: cvScore,
          conviction_band: cv1.conviction_band ?? null,
          confidence,
          resistance_label: challengeRow?.verdict_resistance_label ?? null,
          top_reason: challengeRow?.primary_challenge_reason ?? null,
          fragility_signals: fragileSignals,
          readiness: drResult.readiness,
        });
      }

      // Contradictions from conviction_v1
      if (Array.isArray(cv1.contradictions)) {
        for (const c of cv1.contradictions as Array<{ code?: string; text?: string; severity?: string }>) {
          if (!c.code) continue;
          acc(contradictionsByCode, c.code,
            humanContradictionLabel(c.code, c.text),
            dealId, c.severity,
            'Conflicts between data sources reduce conviction and block high-confidence verdicts.');
        }
      }

      // Unknowns from conviction_v1
      if (Array.isArray(cv1.unknowns)) {
        for (const u of cv1.unknowns as Array<{ code?: string; text?: string }>) {
          if (!u.code) continue;
          acc(unknownsByCode, u.code,
            u.text ?? u.code,
            dealId, undefined,
            'Unknown inputs cannot be verified, which limits how high conviction can reach.');
        }
      }

      // Required next checks (confidence asks)
      if (Array.isArray(cv1.required_next_checks)) {
        for (const c of cv1.required_next_checks as Array<{ text?: string }>) {
          if (!c.text) continue;
          const bucket = bucketRequiredCheck(c.text);
          acc(requiredCheckBuckets, bucket.code, bucket.label, dealId, undefined,
            'Addressing this would directly increase decision confidence and conviction.');
        }
      }
    }

    // Aggregate from challenge_pass results
    for (const row of challengeRows) {
      const dealId = row.deal_id;
      if (!dealMap.has(dealId)) continue;

      // Verdict distribution
      const v = row.verdict ?? 'unknown';
      verdictCounts.set(v, (verdictCounts.get(v) ?? 0) + 1);

      // Missing evidence types
      if (Array.isArray(row.missing_evidence)) {
        for (const item of row.missing_evidence as Array<{ evidence_type?: string; verdict_sensitivity?: string }>) {
          if (!item.evidence_type) continue;
          const label = humanMissingEvidenceLabel(item.evidence_type);
          acc(missingEvidenceByType, item.evidence_type, label, dealId,
            item.verdict_sensitivity ?? 'Medium',
            'Without this evidence, deals cannot advance past the investigation stage.');
        }
      }

      // Contradiction explanations
      if (Array.isArray(row.contradiction_explanations)) {
        for (const item of row.contradiction_explanations as Array<{ type?: string; title?: string }>) {
          if (!item.type) continue;
          const label = humanContradictionTypeLabel(item.type, item.title);
          acc(contradictionExplByType, item.type, label, dealId, 'Medium',
            'Contradictions between documents erode trust in key metrics and delay commitment.');
        }
      }

      // Challenge factors
      if (Array.isArray(row.challenge_factors)) {
        for (const f of row.challenge_factors as Array<{ code?: string; severity?: string; title?: string }>) {
          if (!f.code || f.code === 'deterministic_only') continue;
          const label = f.title ?? humanChallengeFactorLabel(f.code);
          acc(challengeFactorByCode, f.code, label, dealId, f.severity,
            'This analytical pressure factor is a recurring driver of fragile or blocked verdicts.');
        }
      }
    }

    // ── 5. Serialize accumulator maps → sorted arrays ─────────────────────────

    const totalDeals = dealsResult.rows.length;
    const evaluatedCount = evaluatedDealIds.size;

    const serializePattern = (map: PatternAccum, limit = 10) =>
      [...map.entries()]
        .map(([code, e]) => ({
          code,
          label: e.label,
          deal_count: e.deal_ids.size,
          severity: e.severity ?? null,
          example_deals: [...e.deal_ids].slice(0, 5).map((id) => ({
            id,
            name: dealMap.get(id)?.name ?? id,
            score: dealMap.get(id)?.score ?? null,
          })),
          why_it_matters: e.why,
        }))
        .sort((a, b) => b.deal_count - a.deal_count)
        .slice(0, limit);

    const bandDist = [...bandCounts.entries()]
      .map(([band, count]) => ({ band, count, pct: evaluatedCount > 0 ? Math.round((count / evaluatedCount) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    const verdictDist = [...verdictCounts.entries()]
      .map(([verdict, count]) => ({ verdict, count, pct: challengeRows.length > 0 ? Math.round((count / challengeRows.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // Readiness distribution across all evaluated deals.
    const readinessCounts = new Map<DecisionReadiness, number>();
    for (const r of readinessByDeal.values()) {
      readinessCounts.set(r, (readinessCounts.get(r) ?? 0) + 1);
    }
    const readinessOrder: DecisionReadiness[] = ['NOT_INVESTABLE', 'NOT_READY', 'CONDITIONAL', 'INVESTABLE'];
    const readinessDist = readinessOrder
      .filter((r) => readinessCounts.has(r))
      .map((readiness) => {
        const count = readinessCounts.get(readiness) ?? 0;
        return { readiness, count, pct: evaluatedCount > 0 ? Math.round((count / evaluatedCount) * 100) : 0 };
      });

    // ── 6. Build narrative summary ────────────────────────────────────────────

    const topMissing = serializePattern(missingEvidenceByType, 1)[0];
    const topContradiction = serializePattern(contradictionExplByType, 1)[0] ?? serializePattern(contradictionsByCode, 1)[0];
    const topChallengeFactor = serializePattern(challengeFactorByCode, 1)[0];
    const fragileCount = fragileDeals.length;
    const topBand = bandDist[0];

    const narrative = {
      most_common_blocker: topChallengeFactor
        ? `The most common analytical blocker across the portfolio is "${topChallengeFactor.label}", affecting ${topChallengeFactor.deal_count} of ${evaluatedCount} evaluated deals.`
        : `No dominant analytical blocker detected across ${evaluatedCount} evaluated deals.`,
      most_common_missing: topMissing
        ? `The most frequently missing evidence type is "${topMissing.label}", absent in ${topMissing.deal_count} deal${topMissing.deal_count !== 1 ? 's' : ''}. Without it, deals cannot achieve high-confidence verdicts.`
        : `No recurring missing evidence pattern detected across evaluated deals.`,
      most_common_contradiction: topContradiction
        ? `Contradictions most often occur around "${topContradiction.label}", appearing in ${topContradiction.deal_count} deal${topContradiction.deal_count !== 1 ? 's' : ''}.`
        : `No dominant contradiction pattern detected.`,
      portfolio_health_summary: buildPortfolioSummary(evaluatedCount, totalDeals, fragileCount, topBand),
    };

    return reply.send({
      generated_at: new Date().toISOString(),
      total_deals_in_portfolio: totalDeals,
      deals_with_reports: evaluatedCount,
      deals_with_challenge_data: challengeRows.filter((r) => dealMap.has(r.deal_id)).length,
      fragile_deal_count: fragileCount,
      patterns: {
        top_contradictions: serializePattern(contradictionsByCode),
        top_contradiction_explanations: serializePattern(contradictionExplByType),
        top_missing_evidence: serializePattern(missingEvidenceByType),
        top_confidence_asks: serializePattern(requiredCheckBuckets),
        top_challenge_factors: serializePattern(challengeFactorByCode),
        top_unknowns: serializePattern(unknownsByCode),
      },
      fragile_deals: fragileDeals
        .sort((a, b) => (a.conviction_score ?? 100) - (b.conviction_score ?? 100))
        .slice(0, 30),
      conviction_band_distribution: bandDist,
      verdict_distribution: verdictDist,
      readiness_distribution: readinessDist,
      narrative,
    });
  });
}

// ─── Cross-deal pattern helpers ───────────────────────────────────────────────

function humanContradictionLabel(code: string, text?: string): string {
  if (text && text.length < 80) return text;
  const map: Record<string, string> = {
    red_flag_revenue: 'Revenue red flag',
    red_flag_team: 'Team red flag',
    red_flag_market: 'Market size red flag',
    red_flag_traction: 'Traction red flag',
    red_flag_burn: 'Burn rate red flag',
    red_flag_financial: 'Financial data red flag',
    red_flag_risk_assessment: 'Risk assessment red flag',
    business_model_absent: 'Business model absent or conflicting',
  };
  return map[code] ?? code.replace(/_/g, ' ');
}

function humanContradictionTypeLabel(type: string, title?: string): string {
  if (title && title.length < 80) return title;
  const map: Record<string, string> = {
    revenue_mismatch: 'Revenue figure mismatch',
    burn_inconsistency: 'Burn rate inconsistency',
    growth_conflict: 'Growth rate conflict',
    margin_conflict: 'Margin data conflict',
    valuation_conflict: 'Valuation conflict',
    timeline_inconsistency: 'Timeline inconsistency',
    unresolved_conflict: 'Unresolved data conflict',
    other: 'Unclassified contradiction',
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

function humanMissingEvidenceLabel(evidenceType: string): string {
  const map: Record<string, string> = {
    arr_conflict: 'ARR / revenue conflict',
    revenue_conflict: 'Revenue data conflict',
    structured_financials: 'Structured financial model',
    verified_arr: 'Verified ARR',
    verified_revenue: 'Verified revenue',
    valuation: 'Pre-money valuation',
    cap_table: 'Cap table',
    cash_position: 'Current cash position',
    cash_on_hand: 'Cash on hand / current balance',
    burn_rate: 'Monthly burn rate',
    runway: 'Cash runway',
    structured_arr: 'Structured ARR data',
    xlsx_financial_model: 'Financial model (XLSX / structured)',
    customer_traction: 'Customer traction evidence',
    weak_traction_signal: 'Traction signal (weak)',
    market_size: 'Market size evidence',
    team_bios: 'Team background',
    traction: 'Traction / customer data',
    product_stage: 'Product stage evidence',
  };
  return map[evidenceType] ?? evidenceType.replace(/_/g, ' ');
}

function humanChallengeFactorLabel(code: string): string {
  const map: Record<string, string> = {
    contradiction_cluster: 'Multiple contradictions cluster',
    multi_contradiction: 'Multiple contradictions',
    single_contradiction: 'Contradiction detected',
    evaluator_critical_flag: 'Critical evaluation flag',
    evaluator_error_flag: 'Error evaluation flag',
    financial_evidence_weak: 'Weak financial evidence',
    financial_evidence_partial: 'Partial financial evidence',
    document_quality_low: 'Low document quality',
    fail_open_condition: 'Missing provenance data',
    llm_fallback: 'Extraction fallback',
    reconciliation_conflict: 'Structured vs extracted conflict',
    score_verdict_misalignment: 'Score/verdict misalignment',
    memory_fragility: 'Pattern: similar deals weak',
    evidence_base_thin: 'Thin evidence base',
    structural_gaps_only: 'Only structural gaps (no analytical pressure)',
  };
  return map[code] ?? code.replace(/_/g, ' ');
}

function bucketRequiredCheck(text: string): { code: string; label: string } {
  const t = text.toLowerCase();
  // Handle "Provide deterministic evidence for X" pattern — very common in conviction_v1
  const deterministicMatch = t.match(/provide deterministic evidence for (\w+)/);
  if (deterministicMatch) {
    const family = deterministicMatch[1];
    if (family === 'market_demand' || family === 'market') return { code: 'verify_market', label: 'Validate market size / demand claims' };
    if (family === 'financial_truth' || family === 'financials') return { code: 'verify_revenue', label: 'Verify financial data' };
    if (family === 'capital_structure') return { code: 'verify_capital', label: 'Verify capital structure / raise terms' };
    if (family === 'traction_validation' || family === 'traction') return { code: 'verify_traction', label: 'Confirm traction / customer evidence' };
    if (family === 'external_corroboration') return { code: 'verify_corroboration', label: 'Provide external corroboration' };
    if (family === 'product_or_asset_quality' || family === 'product') return { code: 'verify_product', label: 'Clarify product / technology stage' };
    if (family === 'team_execution' || family === 'team') return { code: 'verify_team', label: 'Verify team background' };
    if (family === 'risk_dependencies' || family === 'risk') return { code: 'verify_risk', label: 'Run deliberate risk review' };
  }
  if (t.includes('risk review') || t.includes('risk assessment') || t.includes('key risk')) return { code: 'verify_risk', label: 'Run deliberate risk review' };
  if (t.includes('arr') || t.includes('recurring revenue')) return { code: 'verify_arr', label: 'Verify ARR / recurring revenue' };
  if (t.includes('revenue') || t.includes('financ')) return { code: 'verify_revenue', label: 'Verify financial data' };
  if (t.includes('business model')) return { code: 'verify_business_model', label: 'Clarify business model' };
  if (t.includes('valuation') || t.includes('raise') || t.includes('cap table')) return { code: 'verify_valuation', label: 'Clarify valuation / raise terms' };
  if (t.includes('market') || t.includes('tam') || t.includes('sam')) return { code: 'verify_market', label: 'Validate market size claims' };
  if (t.includes('team') || t.includes('founder') || t.includes('cto') || t.includes('ceo')) return { code: 'verify_team', label: 'Verify team background' };
  if (t.includes('traction') || t.includes('customer') || t.includes('user')) return { code: 'verify_traction', label: 'Confirm traction evidence' };
  if (t.includes('burn') || t.includes('runway') || t.includes('cash')) return { code: 'verify_runway', label: 'Confirm burn / runway' };
  if (t.includes('contradiction') || t.includes('conflict') || t.includes('resolve')) return { code: 'resolve_contradiction', label: 'Resolve data contradiction' };
  if (t.includes('product') || t.includes('technology')) return { code: 'verify_product', label: 'Clarify product / technology stage' };
  if (t.includes('kpi') || t.includes('benchmark')) return { code: 'verify_kpis', label: 'Provide benchmarkable KPIs' };
  return { code: 'other_check', label: 'Additional diligence required' };
}

function buildPortfolioSummary(evaluated: number, total: number, fragile: number, topBand?: { band: string; count: number; pct: number }): string {
  if (evaluated === 0) return `No deals have been evaluated yet. Run analysis on deals to populate patterns.`;
  const fragilePct = evaluated > 0 ? Math.round((fragile / evaluated) * 100) : 0;
  const bandNote = topBand
    ? ` The most common conviction band is "${topBand.band.replace(/_/g, ' ')}" (${topBand.pct}% of evaluated deals).`
    : '';
  return `${evaluated} of ${total} deals have been evaluated.${fragile > 0 ? ` ${fragile} deal${fragile !== 1 ? 's are' : ' is'} currently fragile or low-confidence (${fragilePct}%).` : ' No fragile deals detected.'}${bandNote}`;
}

