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

/**
 * Simple admin auth middleware
 * In production, use proper authentication
 */
function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  next: () => void
): void {
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
}
