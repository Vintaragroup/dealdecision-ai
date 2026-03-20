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
import { randomBytes } from "node:crypto";

function generateInviteCode(): string {
  return randomBytes(16).toString("hex");
}

function buildInviteUrl(request: FastifyRequest, code: string): string {
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    `${request.protocol}://${request.hostname}`;
  return `${baseUrl}/invite?code=${encodeURIComponent(code)}`;
}

/**
 * Check caller is a platform admin OR an active org_owner/org_manager in their org.
 * Returns { ok, orgId } on success; sends a 401/403 reply and returns { ok: false } on failure.
 */
async function requireOrgManagerOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ ok: boolean; orgId: string | null; userId: string | null }> {
  if (Boolean(request.auth?.claims?.['bypass_auth'])) {
    return { ok: true, orgId: request.auth?.orgId ?? 'dev_org', userId: request.auth?.userId ?? 'dev_user' };
  }

  const userId = request.auth?.userId;
  if (!userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return { ok: false, orgId: null, userId: null };
  }

  const pool = getPool();

  // Platform admins always pass.
  const { rows: adminRows } = await pool.query(
    `SELECT is_admin FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
    [userId]
  );
  if (adminRows[0]?.is_admin === true) {
    // Platform admin: resolve orgId from JWT first, then platform_access.org_id,
    // then fall back to discovering the primary org from organization_settings.
    let resolvedOrgId: string | null = request.auth?.orgId ?? null;
    if (!resolvedOrgId) {
      const { rows: paOrgRows } = await pool.query(
        `SELECT org_id FROM platform_access WHERE clerk_user_id = $1 AND org_id IS NOT NULL LIMIT 1`,
        [userId]
      );
      resolvedOrgId = paOrgRows[0]?.org_id ?? null;
    }
    if (!resolvedOrgId) {
      const { rows: settingsRows } = await pool.query(
        `SELECT clerk_org_id FROM organization_settings ORDER BY created_at ASC LIMIT 1`
      );
      resolvedOrgId = settingsRows[0]?.clerk_org_id ?? null;
    }
    return { ok: true, orgId: resolvedOrgId, userId };
  }

  // Otherwise require an active org_owner or org_manager membership.
  const orgId = request.auth?.orgId ?? null;
  if (!orgId) {
    reply.status(403).send({ error: 'Forbidden: no organization found in token' });
    return { ok: false, orgId: null, userId };
  }

  const { rows: memberRows } = await pool.query(
    `SELECT org_role FROM organization_memberships
      WHERE clerk_org_id = $1 AND clerk_user_id = $2 AND membership_status = 'active'
      LIMIT 1`,
    [orgId, userId]
  );

  const orgRole = memberRows[0]?.org_role;
  if (orgRole !== 'org_owner' && orgRole !== 'org_manager') {
    reply.status(403).send({ error: 'Forbidden: org owner or manager access required' });
    return { ok: false, orgId: null, userId };
  }

  return { ok: true, orgId, userId };
}

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

    // Bypass auth (local dev): treat caller as platform admin.
    const isBypassAuth = Boolean(request.auth?.claims?.['bypass_auth']);

    // Resolve org_id: from JWT orgId, platform_access.org_id, then org discovery for platform admins.
    const clerkOrgId = request.auth?.orgId;
    const pool = getPool();

    let orgId: string | null = clerkOrgId ?? null;
    let isAdmin = isBypassAuth;

    if (!orgId) {
      const { rows: paRows } = await pool.query(
        `SELECT is_admin, org_id FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
        [userId]
      );
      isAdmin = paRows[0]?.is_admin === true;
      orgId = paRows[0]?.org_id ?? null;
    }

    // For platform admins with no org context in JWT or platform_access, discover the primary org.
    if (!orgId && isAdmin) {
      const { rows: settingsRows } = await pool.query(
        `SELECT clerk_org_id FROM organization_settings ORDER BY created_at ASC LIMIT 1`
      );
      orgId = settingsRows[0]?.clerk_org_id ?? null;
    }

    if (!orgId) {
      // User is not in an org — return empty, still surface can_manage for admins
      return reply.send({ members: [], active_seats: 0, seat_limit: null, org_id: null, can_manage: isAdmin });
    }

    const { rows: members } = await pool.query(
      `SELECT om.id, om.clerk_user_id, om.org_role, om.membership_status, om.seat_consuming,
              om.created_at, om.updated_at,
              pa.access_status, pa.is_admin, pa.account_role
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

    // Determine if the current user can manage the team (owner/manager/platform-admin).
    // Check the members list first (fast path), then fall back to a platform_access lookup
    // for super_admins who aren't in organization_memberships.
    const currentMember = (members as { clerk_user_id: string; org_role: string; is_admin: boolean | null }[])
      .find((m) => m.clerk_user_id === userId);
    let canManage =
      isAdmin || // already resolved above (bypass_auth or platform_access lookup)
      currentMember?.is_admin === true ||
      currentMember?.org_role === 'org_owner' ||
      currentMember?.org_role === 'org_manager';

    if (!canManage) {
      const { rows: paRows } = await pool.query(
        `SELECT is_admin FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
        [userId]
      );
      canManage = paRows[0]?.is_admin === true;
    }

    return reply.send({
      org_id: orgId,
      organization_name: organizationName,
      members,
      active_seats: activeSeats,
      seat_limit: seatLimit,
      can_manage: canManage,
    });
  });

  // ─── Team: invite creation ────────────────────────────────────────────────

  /**
   * POST /api/v1/team/invite
   * Create an org-scoped invite link.
   * Requires: caller is a platform admin OR an active org_owner/org_manager.
   *
   * Body: { email?, access_duration_days?: 3|5|7|14, notes? }
   */
  app.post<{
    Body: { email?: string | null; access_duration_days?: number; notes?: string | null };
  }>("/api/v1/team/invite", async (request, reply) => {
    const auth = await requireOrgManagerOrAdmin(request, reply);
    if (!auth.ok) return;

    const { orgId, userId } = auth;
    if (!orgId) {
      return reply.status(403).send({ error: 'No organization found — cannot create org-scoped invite' });
    }

    const { email = null, access_duration_days = 7, notes = null } = request.body ?? {};

    const validDurations = [3, 5, 7, 14];
    if (!validDurations.includes(Number(access_duration_days))) {
      return reply.status(400).send({ error: 'access_duration_days must be 3, 5, 7, or 14' });
    }

    const pool = getPool();

    // Check seat limit before creating the invite.
    const { rows: settingsRows } = await pool.query(
      `SELECT seat_limit FROM organization_settings WHERE clerk_org_id = $1 LIMIT 1`,
      [orgId]
    );
    const seatLimit = settingsRows[0]?.seat_limit ?? null;

    if (seatLimit !== null) {
      const { rows: seatCountRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM organization_memberships
          WHERE clerk_org_id = $1 AND membership_status = 'active' AND seat_consuming = true`,
        [orgId]
      );
      const activeSeats = seatCountRows[0]?.cnt ?? 0;
      if (activeSeats >= seatLimit) {
        return reply.status(403).send({
          error: 'SEAT_LIMIT_REACHED',
          message: 'Organization seat limit reached. Remove a member or upgrade to add more.',
        });
      }
    }

    const code = generateInviteCode();
    const inviteUrl = buildInviteUrl(request, code);

    await pool.query(
      `INSERT INTO invite_codes
         (code, email, org_id, created_by_user_id, status, access_duration_days, grant_source, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, 'invite', $6, now(), now())`,
      [code, email ?? null, orgId, userId, access_duration_days, notes ?? null]
    );

    return reply.send({ ok: true, invite_url: inviteUrl, code });
  });

  // ─── Team: member role update ─────────────────────────────────────────────

  /**
   * PATCH /api/v1/team/members/:userId/role
   * Change a team member's org_role.
   * Requires: caller is platform admin OR active org_owner in their org.
   *
   * Body: { org_role: 'org_owner' | 'org_manager' | 'org_member' }
   */
  app.patch<{
    Params: { userId: string };
    Body: { org_role: string };
  }>("/api/v1/team/members/:userId/role", async (request, reply) => {
    const auth = await requireOrgManagerOrAdmin(request, reply);
    if (!auth.ok) return;

    const { orgId } = auth;
    if (!orgId) {
      return reply.status(403).send({ error: 'No organization found in token' });
    }

    const { userId: targetUserId } = request.params;
    const { org_role } = request.body ?? {};

    const validRoles = ['org_owner', 'org_manager', 'org_member'];
    if (!validRoles.includes(org_role)) {
      return reply.status(400).send({ error: `org_role must be one of: ${validRoles.join(', ')}` });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE organization_memberships
          SET org_role = $1, updated_at = now()
        WHERE clerk_org_id = $2 AND clerk_user_id = $3
        RETURNING *`,
      [org_role, orgId, targetUserId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Membership not found in your organization' });
    }

    return reply.send({ ok: true, member: rows[0] });
  });

  // ─── Team: remove member ──────────────────────────────────────────────────

  /**
   * DELETE /api/v1/team/members/:userId
   * Revoke a team member's org membership.
   * Requires: caller is platform admin OR active org_owner in their org.
   */
  app.delete<{ Params: { userId: string } }>(
    "/api/v1/team/members/:userId",
    async (request, reply) => {
      const auth = await requireOrgManagerOrAdmin(request, reply);
      if (!auth.ok) return;

      const { orgId, userId: callerId } = auth;
      if (!orgId) {
        return reply.status(403).send({ error: 'No organization found in token' });
      }

      const { userId: targetUserId } = request.params;
      if (targetUserId === callerId) {
        return reply.status(400).send({ error: 'You cannot remove yourself from the organization' });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `UPDATE organization_memberships
            SET membership_status = 'revoked', updated_at = now()
          WHERE clerk_org_id = $1 AND clerk_user_id = $2
          RETURNING clerk_org_id, clerk_user_id, membership_status, updated_at`,
        [orgId, targetUserId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Membership not found in your organization' });
      }

      return reply.send({ ok: true, member: rows[0] });
    }
  );

  // ─── Team: list pending invites ──────────────────────────────────────────────

  /**
   * GET /api/v1/team/invites
   * Lists active (pending) invite_codes for the caller's org.
   * Requires: org_owner / org_manager / platform admin.
   */
  app.get("/api/v1/team/invites", async (request, reply) => {
    const auth = await requireOrgManagerOrAdmin(request, reply);
    if (!auth.ok) return;

    const { orgId } = auth;
    if (!orgId) {
      return reply.status(403).send({ error: 'No organization found in token' });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, code, email, org_id, status, access_duration_days,
              expires_at, created_at, created_by_user_id, notes
         FROM invite_codes
        WHERE org_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 100`,
      [orgId]
    );

    const baseUrl =
      process.env.APP_BASE_URL?.trim() ||
      process.env.FRONTEND_URL?.trim() ||
      `${request.protocol}://${request.hostname}`;

    const invites = rows.map((row) => ({
      ...row,
      invite_url: `${baseUrl}/invite?code=${encodeURIComponent(row.code)}`,
    }));

    return reply.send({ ok: true, invites });
  });

  // ─── Team: revoke invite ──────────────────────────────────────────────────────

  /**
   * DELETE /api/v1/team/invites/:code
   * Revokes a pending invite belonging to the caller's org.
   * Requires: org_owner / org_manager / platform admin.
   */
  app.delete<{ Params: { code: string } }>(
    "/api/v1/team/invites/:code",
    async (request, reply) => {
      const auth = await requireOrgManagerOrAdmin(request, reply);
      if (!auth.ok) return;

      const { orgId } = auth;
      if (!orgId) {
        return reply.status(403).send({ error: 'No organization found in token' });
      }

      const { code } = request.params;
      const pool = getPool();

      const { rows } = await pool.query(
        `UPDATE invite_codes
            SET status = 'revoked', updated_at = now()
          WHERE code = $1 AND org_id = $2 AND status = 'active'
          RETURNING id, code, status`,
        [code, orgId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Invite not found or already used/revoked' });
      }

      return reply.send({ ok: true, invite: rows[0] });
    }
  );

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
