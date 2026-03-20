/**
 * Me Routes
 * GET /api/v1/me/access    — Returns the current user's platform access and admin status.
 * GET /api/v1/me/identity  — Returns the caller's Clerk user ID from their JWT (no DB query).
 *                            Use this to discover your clerk_user_id when running with real Clerk auth.
 *
 * This is the frontend's source of truth for:
 *   - access_status (used by entitlement checks)
 *   - is_admin (used to gate /system/admin and admin API calls)
 *
 * The endpoint does NOT leak internal row IDs or provisioning details.
 */

import type { FastifyInstance } from 'fastify';
import { getPool } from '../lib/db';

export async function registerMeRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/me/identity
   * Returns the calling user's Clerk user_id (from JWT `sub`) and org context.
   * No DB query — purely from the verified auth token.
   *
   * Use case: discovering your own clerk_user_id to pass to the bootstrap endpoint.
   *
   * Works with both real Clerk JWTs and dev bypass (returns "dev_user" in bypass mode).
   */
  app.get('/api/v1/me/identity', async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return reply.send({
      clerk_user_id: userId,
      org_id: request.auth?.orgId ?? null,
      is_dev_bypass: Boolean(request.auth?.claims?.['bypass_auth']),
    });
  });

  /**
   * GET /api/v1/me/access
   * Returns the authenticated user's access row (safe subset).
   *
   * Response shape:
   *   { clerk_user_id, access_status, access_expires_at, is_admin }
   *
   * Returns 404 if no platform_access row exists (ACCESS_NOT_PROVISIONED path).
   */
  app.get('/api/v1/me/access', async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Dev auth bypass: no real DB row exists for dev_user environment.
    // Return a synthetic response so the frontend admin gate works in dev.
    if (request.auth?.claims?.['bypass_auth']) {
      return reply.send({
        clerk_user_id: userId,
        access_status: 'active',
        access_expires_at: null,
        is_admin: true, // dev bypass → treat as admin so SystemAdminPage is usable locally
        account_role: 'super_admin',
      });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT clerk_user_id, access_status, access_expires_at, is_admin, account_role
         FROM platform_access
        WHERE clerk_user_id = $1
        LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'ACCESS_NOT_PROVISIONED' });
    }

    const row = rows[0];
    return reply.send({
      clerk_user_id: row.clerk_user_id,
      access_status: row.access_status,
      access_expires_at: row.access_expires_at,
      is_admin: row.is_admin === true,
      account_role: row.account_role ?? 'client',
    });
  });
}
