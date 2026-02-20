export type AuthTokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string | null>;

let provider: AuthTokenProvider | null = null;
let cachedToken: string | null = null;
let cachedTokenExpMs: number | null = null; // epoch ms
let cachedTokenUsesJwtExp: boolean | null = null;
let inFlightPromise: Promise<string | null> | null = null;

const DEFAULT_REFRESH_WITHIN_SECONDS = 30;

const JWT_EXP_SAFETY_BUFFER_MS = 60_000;
const FALLBACK_CACHE_TTL_MS = 30_000;

function isDev(): boolean {
  try {
    return Boolean((import.meta as any)?.env?.DEV);
  } catch {
    return false;
  }
}

function base64UrlDecode(input: string): string {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const atobFn: ((data: string) => string) | undefined =
    typeof globalThis !== 'undefined' && typeof (globalThis as any).atob === 'function' ? (globalThis as any).atob : undefined;
  if (atobFn) {
    const binary = atobFn(base64);
    // Convert binary string to UTF-8
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  const BufferCtor: any = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (BufferCtor?.from) {
    return BufferCtor.from(base64, 'base64').toString('utf8');
  }
  throw new Error('No base64 decoder available');
}

export function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson) as any;
    const exp = payload?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

export function shouldRefreshToken(expEpochSeconds: number | null, nowEpochSeconds: number, refreshWithinSeconds = DEFAULT_REFRESH_WITHIN_SECONDS): boolean {
  if (typeof nowEpochSeconds !== 'number' || !Number.isFinite(nowEpochSeconds)) return true;
  if (typeof expEpochSeconds !== 'number' || !Number.isFinite(expEpochSeconds)) return true;
  return expEpochSeconds - nowEpochSeconds < refreshWithinSeconds;
}

export function setAuthTokenProvider(next: AuthTokenProvider | null) {
  provider = next;
  cachedToken = null;
  cachedTokenExpMs = null;
  cachedTokenUsesJwtExp = null;
  inFlightPromise = null;
}

export async function getAuthToken(): Promise<string | null> {
  // Safety guard: if no active session/provider, do not call Clerk.
  if (!provider) return null;

  const nowMs = Date.now();

  if (cachedToken && typeof cachedTokenExpMs === 'number' && Number.isFinite(cachedTokenExpMs)) {
    const effectiveExpiryMs = cachedTokenUsesJwtExp ? cachedTokenExpMs - JWT_EXP_SAFETY_BUFFER_MS : cachedTokenExpMs;
    if (nowMs < effectiveExpiryMs) return cachedToken;
  }

  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = (async () => {
    try {
      if (isDev()) console.debug('[authToken] minting Clerk token');
      const token = await provider();
      if (typeof token !== 'string' || token.trim().length === 0) {
        cachedToken = null;
        cachedTokenExpMs = null;
        cachedTokenUsesJwtExp = null;
        return null;
      }
      cachedToken = token.trim();

      const expSeconds = parseJwtExp(cachedToken);
      if (typeof expSeconds === 'number' && Number.isFinite(expSeconds)) {
        cachedTokenExpMs = expSeconds * 1000;
        cachedTokenUsesJwtExp = true;
      } else {
        cachedTokenExpMs = nowMs + FALLBACK_CACHE_TTL_MS;
        cachedTokenUsesJwtExp = false;
      }

      return cachedToken;
    } catch (err) {
      cachedToken = null;
      cachedTokenExpMs = null;
      cachedTokenUsesJwtExp = null;
      if (isDev()) console.debug('[authToken] token mint failed', err);
      return null;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}
