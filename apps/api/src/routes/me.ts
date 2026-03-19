/**
 * Me Routes
 * GET /api/v1/me/access — Returns the current user's platform access and admin status.
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
      });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT clerk_user_id, access_status, access_expires_at, is_admin
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
    });
  });
}
