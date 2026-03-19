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

/**
 * Simple admin auth middleware
 * In production, use proper authentication
 */
function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  next: () => void
): void {
  const orgRole = (request as any)?.auth?.orgRole;
  if (typeof orgRole === "string" && orgRole.toLowerCase().includes("admin")) {
    return next();
  }

  const authHeader = request.headers.authorization;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    // No admin token configured, allow all in dev
    if (process.env.NODE_ENV === "development") {
      return next();
    }
    reply.status(403).send({ error: "Admin token not configured" });
    return;
  }

  const token = authHeader?.replace("Bearer ", "");
  if (token !== adminToken) {
    reply.status(403).send({ error: "Unauthorized" });
    return;
  }

  next();
}

export async function registerAdminRoutes(app: FastifyInstance) {
  // Apply auth to all admin routes
  app.addHook("preHandler", (request, reply, next) => {
    if (request.url.startsWith("/api/v1/admin")) {
      requireAdminAuth(request, reply, next);
    } else {
      next();
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
      preHandler: (request, reply, next) => {
        // Dev-only endpoint: hide in production.
        // Treat NODE_ENV unset as non-production (common in local Docker dev).
        if (process.env.NODE_ENV === "production") {
          reply.status(404).send({ error: "Not found" });
          return;
        }

        // If an admin token is configured, require it. Otherwise allow in non-production.
        const adminToken = process.env.ADMIN_TOKEN;
        if (typeof adminToken === "string" && adminToken.trim().length > 0) {
          requireAdminAuth(request, reply, next);
          return;
        }

        next();
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
                granted_by_user_id, grant_source, notes, created_at, updated_at
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
   * List all platform_access records (paginated).
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
                granted_by_user_id, grant_source, notes, created_at, updated_at
           FROM platform_access
          ${status ? `WHERE access_status = $3` : ""}
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2`,
        status ? [limit, offset, status] : [limit, offset]
      );
      return reply.send({ records: rows, limit, offset });
    }
  );
}
