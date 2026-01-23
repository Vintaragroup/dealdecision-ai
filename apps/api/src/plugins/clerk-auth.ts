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

function shouldBypassAuth(): boolean {
  const raw = process.env.DISABLE_CLERK_AUTH;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function isDevLike(): boolean {
  return process.env.NODE_ENV !== 'production';
}

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

function extractOrg(payload: Record<string, unknown>): { orgId: string | null; orgRole: string | null } {
  const orgId = typeof payload.org_id === 'string' ? payload.org_id : null;
  const orgRole = typeof payload.org_role === 'string' ? payload.org_role : null;
  return { orgId, orgRole };
}

async function authenticateRequest(request: FastifyRequest): Promise<ClerkAuthContext> {
  // Local dev escape hatch (explicit).
  if (shouldBypassAuth() && isDevLike()) {
    return {
      userId: process.env.DEV_AUTH_USER_ID?.trim() || 'dev_user',
      orgId: process.env.DEV_AUTH_ORG_ID?.trim() || 'dev_org',
      orgRole: process.env.DEV_AUTH_ORG_ROLE?.trim() || 'org:admin',
      sessionId: null,
      claims: { dev: true },
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    throw Object.assign(new Error('Missing Authorization bearer token'), { statusCode: 401 });
  }

  const key = await getVerificationKey();
  const issuer = process.env.CLERK_JWT_ISSUER;
  const audience = process.env.CLERK_JWT_AUDIENCE;

  const jose = await getJose();
  const { payload } = await jose.jwtVerify(token, key, {
    ...(typeof issuer === 'string' && issuer.trim().length > 0 ? { issuer: issuer.trim() } : {}),
    ...(typeof audience === 'string' && audience.trim().length > 0 ? { audience: audience.trim() } : {}),
  });

  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) {
    throw Object.assign(new Error('Invalid token: missing sub'), { statusCode: 401 });
  }

  const extracted = extractOrg(payload as any);
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

    // If auth is not configured in production, fail closed with a clear error.
    if (!isDevLike() && !shouldBypassAuth()) {
      const pem = process.env.CLERK_JWT_VERIFICATION_KEY;
      const jwksUrl = process.env.CLERK_JWKS_URL;
      const issuer = process.env.CLERK_JWT_ISSUER;
      const hasPem = typeof pem === 'string' && pem.trim().length > 0;
      const hasJwksUrl = typeof jwksUrl === 'string' && jwksUrl.trim().length > 0;
      const hasIssuer = typeof issuer === 'string' && issuer.trim().length > 0;

      if (!hasPem && !hasJwksUrl && !hasIssuer) {
        reply.status(503).send({
          error:
            'Auth not configured (set CLERK_JWKS_URL or CLERK_JWT_ISSUER or CLERK_JWT_VERIFICATION_KEY)',
        });
        return;
      }
    }

    try {
      request.auth = await authenticateRequest(request);
    } catch (err: any) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 401;
      reply.status(status).send({ error: err instanceof Error ? err.message : 'Unauthorized' });
      return;
    }
  });
}
