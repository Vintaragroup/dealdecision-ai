import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
type KeyLike = unknown;

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

function getBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const s = raw.trim();
  if (!s.toLowerCase().startsWith('bearer ')) return null;
  const token = s.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}

let cachedKeyPromise: Promise<KeyLike> | null = null;
async function getVerificationKey(): Promise<KeyLike> {
  if (cachedKeyPromise) return cachedKeyPromise;

  cachedKeyPromise = (async () => {
    const pem = process.env.CLERK_JWT_VERIFICATION_KEY;
    if (typeof pem !== 'string' || pem.trim().length === 0) {
      throw new Error('CLERK_JWT_VERIFICATION_KEY is not configured');
    }

    // Clerk provides an RSA public key (SPKI) for JWT verification.
    const jose = await getJose();
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

  const { orgId, orgRole } = extractOrg(payload as any);
  if (!orgId) {
    // Enforce Organizations usage.
    throw Object.assign(new Error('Organization required (org_id missing from token)'), { statusCode: 403 });
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
      if (typeof pem !== 'string' || pem.trim().length === 0) {
        reply.status(503).send({ error: 'Auth not configured (missing CLERK_JWT_VERIFICATION_KEY)' });
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
