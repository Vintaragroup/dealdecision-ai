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
  const bypassedAuth = Boolean(request.auth?.claims?.['bypass_auth']);
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
  const userId = request.auth?.userId;
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
  if (Boolean(request.auth?.claims?.['bypass_auth'])) return true;

  // ADMIN_TOKEN escape hatch (bootstrap / CLI scripts).
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (adminToken) {
    const provided =
      (request.headers['x-admin-token'] as string | undefined) ??
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof provided === 'string' && provided.trim() === adminToken) return true;
  }

  const userId = request.auth?.userId;
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
    Body: { is_admin: boolean };
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

      if (typeof is_admin !== "boolean") {
        return reply.status(400).send({ error: "is_admin must be a boolean" });
      }

      const actorId = request.auth?.userId;

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
        `SELECT id FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
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
      const actorId = request.auth?.userId;

      const pool = getPool();

      // Prevent non-super_admin from revoking a super_admin's access.
      const bypassedAuth = Boolean(request.auth?.claims?.['bypass_auth']);
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
    Body: { access_duration_days: number };
  }>(
    "/api/v1/admin/platform-access/:clerkUserId/extend",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const { access_duration_days } = request.body ?? {};

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
    Body: { account_role: string };
  }>(
    "/api/v1/admin/platform-access/:clerkUserId/account-role",
    async (request, reply) => {
      const { clerkUserId } = request.params;
      const { account_role } = request.body ?? {};

      const valid = ['super_admin', 'admin', 'account_executive', 'analyst', 'client'];
      if (!valid.includes(account_role)) {
        return reply.status(400).send({
          error: `account_role must be one of: ${valid.join(', ')}`,
        });
      }

      // Only a super_admin may assign super_admin to anyone (including themselves).
      if (account_role === 'super_admin') {
        const callerId = request.auth?.userId;
        const bypassedAuth = Boolean(request.auth?.claims?.['bypass_auth']);
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
    };
  }>("/api/v1/admin/provision-user", async (request, reply) => {
    const { clerk_user_id, account_role = "client", access_duration_days, notes } = request.body ?? {};

    if (!clerk_user_id || typeof clerk_user_id !== "string") {
      return reply.status(400).send({ error: "clerk_user_id is required", code: "MISSING_CLERK_USER_ID" });
    }

    const validRoles = ["super_admin", "admin", "account_executive", "analyst", "client"];
    if (!validRoles.includes(account_role)) {
      return reply.status(400).send({ error: `account_role must be one of: ${validRoles.join(", ")}`, code: "INVALID_ROLE" });
    }

    // Only a super_admin may provision another user as super_admin.
    if (account_role === 'super_admin') {
      const callerId = request.auth?.userId;
      const bypassedAuth = Boolean(request.auth?.claims?.['bypass_auth']);
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
  app.post<{ Body: { clerk_user_id: string } }>(
    "/api/v1/admin/bootstrap-first-admin",
    {
      preHandler: async (request, reply) => {
        // Require ADMIN_TOKEN (or dev bypass). No is_admin check — that's the point.
        const bypassedAuth = Boolean(request.auth?.claims?.["bypass_auth"]);
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

      if (
        !clerk_user_id ||
        typeof clerk_user_id !== "string" ||
        clerk_user_id.trim().length === 0
      ) {
        return reply.status(400).send({ error: "clerk_user_id is required" });
      }

      const pool = getPool();

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
      const pool = getPool();
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
      return reply.send({ ok: true, record: rows[0] });
    }
  );
}

