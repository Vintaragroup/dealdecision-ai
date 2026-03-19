/**
 * Invite Routes — Phase 2 Invite Code System
 *
 * Admin endpoint:
 *   POST /api/v1/admin/invite-codes        — generate a new invite code
 *   GET  /api/v1/admin/invite-codes        — list all invites (paginated)
 *   GET  /api/v1/admin/invite-codes/:code  — lookup single invite
 *
 * Public (post-Clerk-auth) endpoints:
 *   POST /api/v1/invites/validate          — validate a code (no redemption)
 *   POST /api/v1/invites/redeem            — validate + redeem + provision platform_access
 *
 * Authorization model:
 *   - Invite codes are a PROVISIONING MECHANISM only.
 *   - platform_access remains the authorization truth.
 *   - Redemption provisions or updates platform_access.
 *   - Entitlement enforcement is not modified here.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "node:crypto";
import { getPool } from "../lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_DURATIONS = [3, 5, 7, 14] as const;
type AllowedDuration = (typeof ALLOWED_DURATIONS)[number];

function isAllowedDuration(n: unknown): n is AllowedDuration {
  return ALLOWED_DURATIONS.includes(n as any);
}

// ---------------------------------------------------------------------------
// Code generation — 32 hex characters = 128 bits of entropy (not guessable)
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  return randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Admin auth guard — DB-backed (matches admin.ts)
// ---------------------------------------------------------------------------

async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  // Dev auth bypass.
  if (Boolean(request.auth?.claims?.['bypass_auth'])) return true;

  // ADMIN_TOKEN escape hatch.
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (adminToken) {
    const provided =
      (request.headers['x-admin-token'] as string | undefined) ??
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof provided === 'string' && provided.trim() === adminToken) return true;
  }

  // DB-backed check: platform_access.is_admin = true.
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
// Invite validation helper (shared by validate + redeem)
//
// Does NOT modify the DB. Returns a typed result.
// ---------------------------------------------------------------------------

type InviteValidationResult =
  | { valid: true; row: InviteRow }
  | { valid: false; code: string; reason: string };

type InviteRow = {
  id: string;
  code: string;
  email: string | null;
  org_id: string | null;
  status: string;
  access_duration_days: number;
  expires_at: string | null;
  redeemed_at: string | null;
  redeemed_by_clerk_user_id: string | null;
  redeemed_email: string | null;
  grant_source: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

async function validateInvite(
  code: string,
  callerEmail?: string | null
): Promise<InviteValidationResult> {
  const pool = getPool();
  const { rows } = await pool.query<InviteRow>(
    `SELECT id, code, email, org_id, status, access_duration_days,
            expires_at, redeemed_at, redeemed_by_clerk_user_id, redeemed_email,
            grant_source, notes, created_by_user_id, created_at, updated_at
       FROM invite_codes
      WHERE code = $1
      LIMIT 1`,
    [code]
  );

  if (rows.length === 0) {
    return { valid: false, code: "INVITE_NOT_FOUND", reason: "Invite code not found" };
  }

  const row = rows[0];

  if (row.status === "revoked") {
    return { valid: false, code: "INVITE_REVOKED", reason: "Invite has been revoked" };
  }

  if (row.status === "redeemed") {
    return { valid: false, code: "INVITE_ALREADY_REDEEMED", reason: "Invite has already been redeemed" };
  }

  // Check stored status=expired first, then check time-based expiry
  if (row.status === "expired") {
    return { valid: false, code: "INVITE_EXPIRED", reason: "Invite has expired" };
  }

  if (row.expires_at !== null) {
    const expiresMs = new Date(row.expires_at).getTime();
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
      return { valid: false, code: "INVITE_EXPIRED", reason: "Invite has expired" };
    }
  }

  // Email restriction check
  if (row.email !== null && typeof callerEmail === "string") {
    if (row.email.toLowerCase() !== callerEmail.toLowerCase()) {
      return { valid: false, code: "INVITE_EMAIL_MISMATCH", reason: "This invite is restricted to a different email address" };
    }
  }

  return { valid: true, row };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerInviteRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Admin routes — protected by requireAdminAuth
  // -------------------------------------------------------------------------

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/v1/admin/invite-codes")) {
      await requireAdminAuth(request, reply);
    }
  });

  /**
   * POST /api/v1/admin/invite-codes
   * Generate a new invite code.
   *
   * Body:
   *   access_duration_days  number   required — 3 | 5 | 7 | 14
   *   email                 string?  optional — restrict to a specific email
   *   org_id                string?  optional
   *   expires_at            string?  optional ISO-8601 (when the code itself expires)
   *   notes                 string?  optional
   */
  app.post<{
    Body: {
      access_duration_days: number;
      email?: string | null;
      org_id?: string | null;
      expires_at?: string | null;
      notes?: string | null;
    };
  }>("/api/v1/admin/invite-codes", async (request, reply) => {
    const { access_duration_days, email = null, org_id = null, expires_at = null, notes = null } =
      request.body ?? {};

    if (!isAllowedDuration(access_duration_days)) {
      return reply.status(400).send({
        error: `access_duration_days must be one of: ${ALLOWED_DURATIONS.join(", ")}`,
      });
    }

    let expiresAt: Date | null = null;
    if (expires_at != null) {
      expiresAt = new Date(expires_at);
      if (isNaN(expiresAt.getTime())) {
        return reply.status(400).send({ error: "expires_at must be a valid ISO-8601 timestamp or null" });
      }
    }

    const normalizedEmail = typeof email === "string" && email.trim().length > 0
      ? email.trim().toLowerCase()
      : null;

    const code = generateInviteCode();
    const createdBy = (request as any)?.auth?.userId ?? null;

    const pool = getPool();
    const { rows } = await pool.query<InviteRow>(
      `INSERT INTO invite_codes (
         code, email, org_id, created_by_user_id, status,
         access_duration_days, expires_at, grant_source, notes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'active', $5, $6, 'invite', $7, now(), now())
       RETURNING *`,
      [code, normalizedEmail, org_id ?? null, createdBy, access_duration_days, expiresAt?.toISOString() ?? null, notes ?? null]
    );

    const record = rows[0];
    const inviteUrl = buildInviteUrl(request, record.code);

    return reply.status(201).send({
      ok: true,
      record,
      invite_url: inviteUrl,
    });
  });

  /**
   * GET /api/v1/admin/invite-codes
   * List all invite codes (paginated).
   */
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>(
    "/api/v1/admin/invite-codes",
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const status = request.query.status ?? null;

      const validStatuses = ["active", "redeemed", "expired", "revoked"];
      if (status !== null && !validStatuses.includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${validStatuses.join(", ")}` });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        status
          ? `SELECT * FROM invite_codes WHERE status = $3 ORDER BY created_at DESC LIMIT $1 OFFSET $2`
          : `SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        status ? [limit, offset, status] : [limit, offset]
      );
      return reply.send({ records: rows, limit, offset });
    }
  );

  /**
   * GET /api/v1/admin/invite-codes/:code
   * Look up a single invite by code.
   */
  app.get<{ Params: { code: string } }>(
    "/api/v1/admin/invite-codes/:code",
    async (request, reply) => {
      const { code } = request.params;
      const pool = getPool();
      const { rows } = await pool.query<InviteRow>(
        `SELECT * FROM invite_codes WHERE code = $1 LIMIT 1`,
        [code]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: "Invite code not found" });
      }
      return reply.send({ record: rows[0] });
    }
  );

  // -------------------------------------------------------------------------
  // Public invite endpoints — require Clerk auth (not admin)
  // -------------------------------------------------------------------------

  /**
   * POST /api/v1/invites/validate
   * Validate an invite code without redeeming it.
   * Safe to call from the frontend before showing the redemption step.
   *
   * Body:
   *   code   string  required
   *   email  string? optional — if provided, checked against invite email restriction
   *
   * Response:
   *   { valid: true, access_duration_days, email_restricted }
   *   { valid: false, code, reason }
   */
  app.post<{ Body: { code: string; email?: string | null } }>(
    "/api/v1/invites/validate",
    async (request, reply) => {
      const { code, email = null } = request.body ?? {};

      if (typeof code !== "string" || code.trim().length === 0) {
        return reply.status(400).send({ error: "code is required" });
      }

      const result = await validateInvite(code.trim(), email ?? null);

      if (!result.valid) {
        return reply.send({ valid: false, code: result.code, reason: result.reason });
      }

      // Return safe metadata only — do not expose internal IDs or notes to the public
      return reply.send({
        valid: true,
        access_duration_days: result.row.access_duration_days,
        email_restricted: result.row.email !== null,
        org_id: result.row.org_id,
      });
    }
  );

  /**
   * POST /api/v1/invites/redeem
   * Validate AND redeem an invite code.
   * Requires Clerk JWT auth — the API must know who is redeeming.
   *
   * Body:
   *   code  string  required
   *
   * Flow:
   *   1. Verify Clerk JWT (done by preHandler)
   *   2. Look up code and validate (status, expiry, email match)
   *   3. Determine platform_access upsert behavior:
   *      - No existing row   → insert as active
   *      - Existing pending  → update to active
   *      - Existing expired  → update to active (refresh)
   *      - Existing active   → reject (don't silently override active access)
   *      - Existing revoked  → reject (admin must re-provision manually)
   *   4. Update invite code → redeemed
   *   5. Return success payload
   *
   * Both steps (invite update + platform_access upsert) run in a transaction.
   */
  app.post<{ Body: { code: string } }>(
    "/api/v1/invites/redeem",
    async (request, reply) => {
      const { code } = request.body ?? {};

      if (typeof code !== "string" || code.trim().length === 0) {
        return reply.status(400).send({ error: "code is required" });
      }

      const auth = (request as any)?.auth;
      const clerkUserId = auth?.userId;
      const clerkOrgId = auth?.orgId ?? null;

      if (!clerkUserId) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      // Extract email from Clerk JWT claims — Clerk puts it in claims.email
      const clerkEmail: string | null =
        typeof auth?.claims?.email === "string" ? auth.claims.email.trim().toLowerCase() : null;

      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Lock the invite row for update to prevent races
        const { rows: inviteRows } = await client.query<InviteRow>(
          `SELECT * FROM invite_codes WHERE code = $1 LIMIT 1 FOR UPDATE`,
          [code.trim()]
        );

        if (inviteRows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ valid: false, code: "INVITE_NOT_FOUND", error: "Invite code not found" });
        }

        const invite = inviteRows[0];

        // Validate status
        if (invite.status === "revoked") {
          await client.query("ROLLBACK");
          return reply.status(400).send({ valid: false, code: "INVITE_REVOKED", error: "Invite has been revoked" });
        }
        if (invite.status === "redeemed") {
          await client.query("ROLLBACK");
          return reply.status(400).send({ valid: false, code: "INVITE_ALREADY_REDEEMED", error: "Invite has already been redeemed" });
        }
        if (invite.status === "expired") {
          await client.query("ROLLBACK");
          return reply.status(400).send({ valid: false, code: "INVITE_EXPIRED", error: "Invite has expired" });
        }
        if (invite.expires_at !== null) {
          const expiresMs = new Date(invite.expires_at).getTime();
          if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
            await client.query("ROLLBACK");
            return reply.status(400).send({ valid: false, code: "INVITE_EXPIRED", error: "Invite has expired" });
          }
        }

        // Email restriction check
        // If the invite is email-bound but the JWT carries no email claim, we cannot
        // verify the restriction and must reject rather than silently bypass it.
        if (invite.email !== null && clerkEmail === null) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            valid: false,
            code: "INVITE_EMAIL_UNVERIFIABLE",
            error: "This invite is restricted to a specific email address, but your account email could not be verified. Ensure your account has a verified email address.",
          });
        }
        if (invite.email !== null && clerkEmail !== null) {
          if (invite.email.toLowerCase() !== clerkEmail) {
            await client.query("ROLLBACK");
            return reply.status(403).send({ valid: false, code: "INVITE_EMAIL_MISMATCH", error: "This invite is restricted to a different email address" });
          }
        }

        // Calculate access window
        const accessExpiresAt = new Date(Date.now() + invite.access_duration_days * 24 * 60 * 60 * 1000);
        const orgId = invite.org_id ?? clerkOrgId ?? null;

        // Check for existing platform_access
        const { rows: existingAccess } = await client.query(
          `SELECT access_status FROM platform_access WHERE clerk_user_id = $1 LIMIT 1`,
          [clerkUserId]
        );

        if (existingAccess.length > 0) {
          const currentStatus = existingAccess[0].access_status;

          // Active: do not silently override. User already has access.
          if (currentStatus === "active") {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              valid: false,
              code: "ALREADY_HAS_ACCESS",
              error: "Your account already has active platform access",
            });
          }

          // Revoked: require explicit admin re-provisioning.
          // Use 400 (not 403) so the frontend invite page handles this error itself
          // rather than the global 403 intercept redirecting to /access-denied.
          if (currentStatus === "revoked") {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              valid: false,
              code: "ACCESS_REVOKED",
              error: "Your access has been revoked. Contact your account executive.",
            });
          }

          // pending or expired → allow invite to activate access
          await client.query(
            `UPDATE platform_access SET
               access_status       = 'active',
               access_expires_at   = $1,
               org_id              = COALESCE($2, org_id),
               grant_source        = 'invite',
               granted_by_user_id  = $3,
               notes               = COALESCE($4, notes),
               updated_at          = now()
             WHERE clerk_user_id = $5`,
            [accessExpiresAt.toISOString(), orgId, invite.created_by_user_id ?? null, invite.notes, clerkUserId]
          );
        } else {
          // No existing row — insert fresh
          await client.query(
            `INSERT INTO platform_access (
               clerk_user_id, org_id, access_status, access_expires_at,
               granted_by_user_id, grant_source, notes, created_at, updated_at
             ) VALUES ($1, $2, 'active', $3, $4, 'invite', $5, now(), now())`,
            [clerkUserId, orgId, accessExpiresAt.toISOString(), invite.created_by_user_id ?? null, invite.notes]
          );
        }

        // Mark invite as redeemed
        await client.query(
          `UPDATE invite_codes SET
             status                      = 'redeemed',
             redeemed_at                 = now(),
             redeemed_by_clerk_user_id   = $1,
             redeemed_email              = $2,
             updated_at                  = now()
           WHERE id = $3`,
          [clerkUserId, clerkEmail, invite.id]
        );

        await client.query("COMMIT");

        return reply.send({
          ok: true,
          access_expires_at: accessExpiresAt.toISOString(),
          access_duration_days: invite.access_duration_days,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInviteUrl(request: FastifyRequest, code: string): string {
  // Use configured frontend URL if set, otherwise derive from request origin.
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    `${request.protocol}://${request.hostname}`;
  return `${baseUrl}/invite?code=${encodeURIComponent(code)}`;
}
