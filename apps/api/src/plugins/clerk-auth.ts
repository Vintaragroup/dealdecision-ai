import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
type KeyLike = unknown;
type KeyOrKeyFunction = unknown;

import type { ClerkAuthContext } from '../types/auth';

let cachedJosePromise: Promise<any> | null = null;
async function getJose() {
  if (!cachedJosePromise) {
    cachedJosePromise = import('jose');
  }
  return cachedJosePromise;
}

function getAuthClockToleranceSeconds(): number {
  const raw = process.env.AUTH_CLOCK_TOLERANCE_SECONDS;
  const n = raw == null ? 60 : Number(raw);
  if (!Number.isFinite(n)) return 60;
  // Guardrails: allow 0..300s
  return Math.max(0, Math.min(300, Math.floor(n)));
}

function shouldBypassAuth(): boolean {
  const raw = process.env.DISABLE_CLERK_AUTH;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function isDevLike(): boolean {
  return process.env.NODE_ENV !== 'production';
}

let didWarnBypassInProd = false;

function parseBoolEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const v = value.trim().toLowerCase();
  if (!v) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function shouldRequireOrganization(): boolean {
  // Default: require org in production, allow missing org in local/dev.
  return parseBoolEnv(process.env.CLERK_REQUIRE_ORG, !isDevLike());
}

function getBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const s = raw.trim();
  if (!s.toLowerCase().startsWith('bearer ')) return null;
  const token = s.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function getQueryTokenForEvents(request: FastifyRequest): string | null {
  // Only allow query-token auth on SSE endpoint (browser-safe for native EventSource).
  if (!request.url.startsWith('/api/v1/events')) return null;
  const q: any = request.query as any;
  const raw = q?.token;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow either raw JWT or "Bearer <jwt>".
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    const t = trimmed.slice('bearer '.length).trim();
    return t.length > 0 ? t : null;
  }
  return trimmed;
}

let cachedKeyPromise: Promise<KeyLike> | null = null;
async function getVerificationKey(): Promise<KeyOrKeyFunction> {
  if (cachedKeyPromise) return cachedKeyPromise;

  cachedKeyPromise = (async () => {
    const jose = await getJose();

    // Preferred: remote JWKS (avoids pasting huge PEMs into env vars)
    const jwksUrl = process.env.CLERK_JWKS_URL?.trim();
    if (jwksUrl) {
      try {
        return jose.createRemoteJWKSet(new URL(jwksUrl));
      } catch {
        throw Object.assign(new Error('Invalid CLERK_JWKS_URL'), { statusCode: 503 });
      }
    }

    // Convenience: derive JWKS URL from issuer
    const issuer = process.env.CLERK_JWT_ISSUER?.trim();
    if (issuer) {
      try {
        const issuerUrl = new URL(issuer);
        const derived = new URL('/.well-known/jwks.json', issuerUrl);
        return jose.createRemoteJWKSet(derived);
      } catch {
        throw Object.assign(new Error('Invalid CLERK_JWT_ISSUER'), { statusCode: 503 });
      }
    }

    // Fallback: static SPKI PEM public key
    const raw = process.env.CLERK_JWT_VERIFICATION_KEY;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw Object.assign(
        new Error('Auth not configured (set CLERK_JWKS_URL or CLERK_JWT_ISSUER or CLERK_JWT_VERIFICATION_KEY)'),
        { statusCode: 503 },
      );
    }

    // Support common dotenv/docker-compose patterns where PEM newlines are provided as `\n`.
    const pem = raw.replace(/\\n/g, '\n').trim();
    return jose.importSPKI(pem, 'RS256');
  })();

  return cachedKeyPromise;
}

export function __resetAuthCachesForTest() {
  cachedKeyPromise = null;
  cachedJosePromise = null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function extractOrgFromPayload(payload: Record<string, unknown>): { orgId: string | null; orgRole: string | null } {
  const p: any = payload as any;

  const orgId =
    readNonEmptyString(p.org_id) ||
    readNonEmptyString(p.orgId) ||
    readNonEmptyString(p?.o?.id) ||
    readNonEmptyString(p?.org?.id) ||
    null;

  const orgRole = readNonEmptyString(p.org_role) || null;

  return { orgId, orgRole };
}

async function authenticateRequest(request: FastifyRequest): Promise<ClerkAuthContext> {
  // Explicit escape hatch.
  // Note: Our canonical local Docker stack runs with NODE_ENV=production for a
  // production-shaped runtime, so DISABLE_CLERK_AUTH must work even in that mode.
  if (shouldBypassAuth()) {
    if (!isDevLike() && !didWarnBypassInProd) {
      didWarnBypassInProd = true;
      request.log.warn(
        { event: 'auth_bypass_enabled', node_env: process.env.NODE_ENV },
        'DISABLE_CLERK_AUTH enabled while NODE_ENV=production; bypassing Clerk auth'
      );
    }
    return {
      userId: process.env.DEV_AUTH_USER_ID?.trim() || 'dev_user',
      orgId: process.env.DEV_AUTH_ORG_ID?.trim() || 'dev_org',
      orgRole: process.env.DEV_AUTH_ORG_ROLE?.trim() || 'org:admin',
      sessionId: null,
      claims: { dev: true, bypass_auth: true },
    };
  }

  const token = getBearerToken(request) || getQueryTokenForEvents(request);
  if (!token) {
    throw Object.assign(new Error('Missing Authorization bearer token'), { statusCode: 401 });
  }

  const key = await getVerificationKey();
  const issuer = process.env.CLERK_JWT_ISSUER;
  const audience = process.env.CLERK_JWT_AUDIENCE;

  const jose = await getJose();

  let payload: any;
  try {
    const res = await jose.jwtVerify(token, key, {
      ...(typeof issuer === 'string' && issuer.trim().length > 0 ? { issuer: issuer.trim() } : {}),
      ...(typeof audience === 'string' && audience.trim().length > 0 ? { audience: audience.trim() } : {}),
      clockTolerance: getAuthClockToleranceSeconds(),
    });
    payload = res.payload;
  } catch (err) {
    // Structured debug log: do NOT log token.
    const nowEpoch = Math.floor(Date.now() / 1000);
    let exp: number | null = null;
    let iat: number | null = null;
    let nbf: number | null = null;
    try {
      const decoded = jose.decodeJwt(token) as any;
      exp = typeof decoded?.exp === 'number' ? decoded.exp : null;
      iat = typeof decoded?.iat === 'number' ? decoded.iat : null;
      nbf = typeof decoded?.nbf === 'number' ? decoded.nbf : null;
    } catch {
      // ignore decode errors
    }

    const expMinusNow = typeof exp === 'number' ? exp - nowEpoch : null;
    const requestDateHeader = typeof request.headers.date === 'string' ? request.headers.date : null;
    const serverDateHttp = new Date().toUTCString();

    request.log.warn(
      {
        event: 'auth_verify_failed',
        reason: err instanceof Error ? err.message : String(err),
        now_epoch: nowEpoch,
        exp,
        iat,
        nbf,
        exp_minus_now: expMinusNow,
        request_date_header: requestDateHeader,
        server_date_http: serverDateHttp,
        clock_tolerance_seconds: getAuthClockToleranceSeconds(),
      },
      'JWT verify failed'
    );

    throw err;
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) {
    throw Object.assign(new Error('Invalid token: missing sub'), { statusCode: 401 });
  }

  const extracted = extractOrgFromPayload(payload as any);
  let orgId: string | null = extracted.orgId;
  let orgRole: string | null = extracted.orgRole;

  if (!orgId && shouldRequireOrganization()) {
    // Enforce Organizations usage when configured.
    throw Object.assign(new Error('Organization required (org_id missing from token)'), { statusCode: 403 });
  }

  if (!orgId) {
    const fallbackOrgId =
      process.env.CLERK_DEFAULT_ORG_ID?.trim() ||
      (isDevLike() ? (process.env.DEV_AUTH_ORG_ID?.trim() || 'dev_org') : null);
    if (!fallbackOrgId) {
      throw Object.assign(new Error('Organization missing and no default org configured'), { statusCode: 503 });
    }
    orgId = fallbackOrgId;
    if (!orgRole && isDevLike()) {
      orgRole = process.env.DEV_AUTH_ORG_ROLE?.trim() || 'org:member';
    }
  }

  const sessionId = typeof (payload as any).sid === 'string' ? String((payload as any).sid) : null;

  return {
    userId,
    orgId,
    orgRole,
    sessionId,
    claims: payload as any,
  };
}

// Exported for unit tests to verify leeway behavior with a controlled clock.
export async function verifyClerkJwtForTest(input: {
  token: string;
  key: any;
  issuer?: string;
  audience?: string;
  currentDate?: Date;
}): Promise<Record<string, unknown>> {
  const jose = await getJose();
  const res = await jose.jwtVerify(input.token, input.key, {
    ...(typeof input.issuer === 'string' && input.issuer.trim().length > 0 ? { issuer: input.issuer.trim() } : {}),
    ...(typeof input.audience === 'string' && input.audience.trim().length > 0 ? { audience: input.audience.trim() } : {}),
    clockTolerance: getAuthClockToleranceSeconds(),
    ...(input.currentDate ? { currentDate: input.currentDate } : {}),
  });
  return res.payload as any;
}

function isProtectedPath(url: string): boolean {
  // Public endpoints
  if (url === '/' || url.startsWith('/healthz') || url.startsWith('/docs')) return false;

  // Public API health probe
  if (url === '/api/v1/health' || url.startsWith('/api/v1/health')) return false;

  // Protect all API routes by default
  return url.startsWith('/api/v1/');
}

export async function registerClerkAuth(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === 'OPTIONS') return;
    if (!isProtectedPath(request.url)) return;

    try {
      request.auth = await authenticateRequest(request);
    } catch (err: any) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 401;

      // Targeted diagnostics for SSE auth issues (common when proxies strip headers).
      if (request.url.startsWith('/api/v1/events')) {
        const hasAuthHeader = typeof request.headers.authorization === 'string' && request.headers.authorization.trim().length > 0;
        request.log.warn(
          {
            event: 'auth_failed',
            path: request.url,
            method: request.method,
            status,
            has_authorization_header: hasAuthHeader,
            reason: err instanceof Error ? err.message : String(err),
          },
          'SSE auth failed'
        );
      }

      reply.status(status).send({ error: err instanceof Error ? err.message : 'Unauthorized' });
      return;
    }
  });
}
