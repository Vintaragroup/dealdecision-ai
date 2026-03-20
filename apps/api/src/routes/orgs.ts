/**
 * Orgs Routes — Organization settings and membership management
 *
 * Admin endpoints:
 *   GET  /api/v1/admin/orgs                      — list all org settings
 *   GET  /api/v1/admin/orgs/:orgId               — get org settings + seat usage
 *   PUT  /api/v1/admin/orgs/:orgId               — upsert org settings (seat limit etc.)
 *   GET  /api/v1/admin/orgs/:orgId/members       — list org members with seat info
 *   PATCH /api/v1/admin/orgs/:orgId/members/:userId/role  — update member org_role
 *   DELETE /api/v1/admin/orgs/:orgId/members/:userId      — revoke org membership
 *
 * Team endpoints (authenticated user, scoped to their org):
 *   GET  /api/v1/team/members                    — list members in the caller's org
 *   GET  /api/v1/team/seats                      — seat usage for the caller's org
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPool } from "../lib/db";

// ---------------------------------------------------------------------------
// Admin auth guard (matches admin.ts)
// ---------------------------------------------------------------------------

async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (Boolean(request.auth?.claims?.['bypass_auth'])) return true;

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

  const pool = getPool();
  let rows: any[];
  try {
    ({ rows } = await pool.query(
      `SELECT is_admin FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
      [userId]
    ));
  } catch (err) {
    request.log.error({ event: 'admin_check_db_error', err }, 'DB admin check failed');
    reply.status(503).send({ error: 'Service temporarily unavailable' });
    return false;
  }

  if (rows.length === 0 || rows[0].is_admin !== true) {
    reply.status(403).send({ error: 'Forbidden: admin access required' });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerOrgRoutes(app: FastifyInstance) {
  // Admin guard on /api/v1/admin/orgs routes
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/v1/admin/orgs")) {
      await requireAdminAuth(request, reply);
    }
  });

  // ─── Admin: org settings ──────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/orgs
   * List all organization_settings rows with active seat count.
   */
  app.get("/api/v1/admin/orgs", async (_request, reply) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT os.*,
              COUNT(om.id) FILTER (WHERE om.membership_status = 'active' AND om.seat_consuming = true)::int AS active_seats
         FROM organization_settings os
         LEFT JOIN organization_memberships om ON om.clerk_org_id = os.clerk_org_id
        GROUP BY os.id
        ORDER BY os.created_at DESC`
    );
    return reply.send({ orgs: rows });
  });

  /**
   * GET /api/v1/admin/orgs/:orgId
   * Get org settings + seat usage for a specific org.
   */
  app.get<{ Params: { orgId: string } }>(
    "/api/v1/admin/orgs/:orgId",
    async (request, reply) => {
      const { orgId } = request.params;
      const pool = getPool();

      const { rows: settingsRows } = await pool.query(
        `SELECT os.*,
                COUNT(om.id) FILTER (WHERE om.membership_status = 'active' AND om.seat_consuming = true)::int AS active_seats
           FROM organization_settings os
           LEFT JOIN organization_memberships om ON om.clerk_org_id = os.clerk_org_id
          WHERE os.clerk_org_id = $1
          GROUP BY os.id`,
        [orgId]
      );

      if (settingsRows.length === 0) {
        return reply.status(404).send({ error: "Organization settings not found" });
      }

      return reply.send({ org: settingsRows[0] });
    }
  );

  /**
   * PUT /api/v1/admin/orgs/:orgId
   * Upsert organization_settings for an org.
   *
   * Body: { organization_name?, included_seats?, seat_limit?, billing_status?, notes? }
   */
  app.put<{
    Params: { orgId: string };
    Body: {
      organization_name?: string | null;
      included_seats?: number;
      seat_limit?: number;
      billing_status?: string;
      notes?: string | null;
    };
  }>(
    "/api/v1/admin/orgs/:orgId",
    async (request, reply) => {
      const { orgId } = request.params;
      const { organization_name, included_seats, seat_limit, billing_status, notes } =
        request.body ?? {};

      const validBillingStatuses = ['trial', 'active', 'past_due', 'cancelled'];
      if (billing_status !== undefined && !validBillingStatuses.includes(billing_status)) {
        return reply.status(400).send({
          error: `billing_status must be one of: ${validBillingStatuses.join(', ')}`,
        });
      }

      if (seat_limit !== undefined && (typeof seat_limit !== 'number' || seat_limit < 1)) {
        return reply.status(400).send({ error: 'seat_limit must be a positive integer' });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO organization_settings
           (clerk_org_id, organization_name, included_seats, seat_limit, billing_status, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (clerk_org_id) DO UPDATE
           SET organization_name = COALESCE($2, organization_settings.organization_name),
               included_seats    = COALESCE($3, organization_settings.included_seats),
               seat_limit        = COALESCE($4, organization_settings.seat_limit),
               billing_status    = COALESCE($5, organization_settings.billing_status),
               notes             = COALESCE($6, organization_settings.notes),
               updated_at        = now()
         RETURNING *`,
        [
          orgId,
          organization_name ?? null,
          included_seats ?? null,
          seat_limit ?? null,
          billing_status ?? null,
          notes ?? null,
        ]
      );

      return reply.send({ ok: true, org: rows[0] });
    }
  );

  /**
   * GET /api/v1/admin/orgs/:orgId/members
   * List org members with their platform_access status.
   */
  app.get<{ Params: { orgId: string } }>(
    "/api/v1/admin/orgs/:orgId/members",
    async (request, reply) => {
      const { orgId } = request.params;
      const pool = getPool();

      const { rows } = await pool.query(
        `SELECT om.id, om.clerk_org_id, om.clerk_user_id, om.org_role,
                om.membership_status, om.seat_consuming,
                om.invited_by_clerk_user_id, om.created_at, om.updated_at,
                pa.access_status, pa.is_admin, pa.account_role
           FROM organization_memberships om
           LEFT JOIN platform_access pa ON pa.clerk_user_id = om.clerk_user_id
          WHERE om.clerk_org_id = $1
          ORDER BY om.created_at ASC`,
        [orgId]
      );

      // Count active seats
      const activeSeats = rows.filter(
        (r) => r.membership_status === 'active' && r.seat_consuming === true
      ).length;

      return reply.send({ members: rows, active_seats: activeSeats });
    }
  );

  /**
   * PATCH /api/v1/admin/orgs/:orgId/members/:userId/role
   * Update a member's org_role.
   *
   * Body: { org_role: 'org_owner' | 'org_manager' | 'org_member' }
   */
  app.patch<{
    Params: { orgId: string; userId: string };
    Body: { org_role: string };
  }>(
    "/api/v1/admin/orgs/:orgId/members/:userId/role",
    async (request, reply) => {
      const { orgId, userId } = request.params;
      const { org_role } = request.body ?? {};

      const validRoles = ['org_owner', 'org_manager', 'org_member'];
      if (!validRoles.includes(org_role)) {
        return reply.status(400).send({
          error: `org_role must be one of: ${validRoles.join(', ')}`,
        });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `UPDATE organization_memberships
            SET org_role = $1, updated_at = now()
          WHERE clerk_org_id = $2 AND clerk_user_id = $3
          RETURNING *`,
        [org_role, orgId, userId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Membership not found" });
      }

      return reply.send({ ok: true, member: rows[0] });
    }
  );

  /**
   * DELETE /api/v1/admin/orgs/:orgId/members/:userId
   * Revoke an org membership (sets membership_status = 'revoked').
   */
  app.delete<{ Params: { orgId: string; userId: string } }>(
    "/api/v1/admin/orgs/:orgId/members/:userId",
    async (request, reply) => {
      const { orgId, userId } = request.params;
      const pool = getPool();

      const { rows } = await pool.query(
        `UPDATE organization_memberships
            SET membership_status = 'revoked', updated_at = now()
          WHERE clerk_org_id = $1 AND clerk_user_id = $2
          RETURNING clerk_org_id, clerk_user_id, membership_status, updated_at`,
        [orgId, userId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Membership not found" });
      }

      return reply.send({ ok: true, member: rows[0] });
    }
  );

  // ─── Team endpoints (caller-scoped) ──────────────────────────────────────

  /**
   * GET /api/v1/team/members
   * Returns org members for the authenticated user's org.
   * No admin required — scoped to their own org_id.
   */
  app.get("/api/v1/team/members", async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    // Resolve org_id: from JWT orgId, or fall back to platform_access.org_id
    const clerkOrgId = request.auth?.orgId;
    const pool = getPool();

    let orgId: string | null = clerkOrgId ?? null;
    if (!orgId) {
      const { rows: paRows } = await pool.query(
        `SELECT org_id FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
        [userId]
      );
      orgId = paRows[0]?.org_id ?? null;
    }

    if (!orgId) {
      // User is not in an org — return empty
      return reply.send({ members: [], active_seats: 0, seat_limit: null, org_id: null });
    }

    const { rows: members } = await pool.query(
      `SELECT om.clerk_user_id, om.org_role, om.membership_status, om.seat_consuming,
              om.created_at,
              pa.access_status, pa.account_role
         FROM organization_memberships om
         LEFT JOIN platform_access pa ON pa.clerk_user_id = om.clerk_user_id
        WHERE om.clerk_org_id = $1 AND om.membership_status = 'active'
        ORDER BY om.created_at ASC`,
      [orgId]
    );

    const { rows: settingsRows } = await pool.query(
      `SELECT seat_limit, included_seats, organization_name FROM organization_settings WHERE clerk_org_id = $1 LIMIT 1`,
      [orgId]
    );

    const activeSeats = members.filter((m) => m.seat_consuming === true).length;
    const seatLimit = settingsRows[0]?.seat_limit ?? null;
    const organizationName = settingsRows[0]?.organization_name ?? null;

    return reply.send({
      org_id: orgId,
      organization_name: organizationName,
      members,
      active_seats: activeSeats,
      seat_limit: seatLimit,
    });
  });

  /**
   * GET /api/v1/team/seats
   * Returns seat usage summary for the caller's org.
   */
  app.get("/api/v1/team/seats", async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const clerkOrgId = request.auth?.orgId;
    const pool = getPool();

    let orgId: string | null = clerkOrgId ?? null;
    if (!orgId) {
      const { rows: paRows } = await pool.query(
        `SELECT org_id FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
        [userId]
      );
      orgId = paRows[0]?.org_id ?? null;
    }

    if (!orgId) {
      return reply.send({ org_id: null, active_seats: 0, seat_limit: null, seats_available: null });
    }

    const { rows: settingsRows } = await pool.query(
      `SELECT seat_limit, included_seats FROM organization_settings WHERE clerk_org_id = $1 LIMIT 1`,
      [orgId]
    );

    const { rows: seatCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM organization_memberships
        WHERE clerk_org_id = $1 AND membership_status = 'active' AND seat_consuming = true`,
      [orgId]
    );

    const seatLimit = settingsRows[0]?.seat_limit ?? null;
    const activeSeats = seatCountRows[0]?.cnt ?? 0;

    return reply.send({
      org_id: orgId,
      active_seats: activeSeats,
      seat_limit: seatLimit,
      seats_available: seatLimit !== null ? Math.max(0, seatLimit - activeSeats) : null,
    });
  });
}
