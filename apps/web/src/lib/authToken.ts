export type AuthTokenProvider = () => Promise<string | null>;

let provider: AuthTokenProvider | null = null;
let cachedToken: string | null = null;
let cachedExp: number | null = null; // epoch seconds

const DEFAULT_REFRESH_WITHIN_SECONDS = 30;

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
  cachedExp = null;
}

export async function getAuthToken(opts?: { forceRefresh?: boolean; refreshWithinSeconds?: number }): Promise<string | null> {
  if (!provider) return null;

  const refreshWithinSeconds =
    typeof opts?.refreshWithinSeconds === 'number' && Number.isFinite(opts.refreshWithinSeconds)
      ? Math.max(0, Math.floor(opts.refreshWithinSeconds))
      : DEFAULT_REFRESH_WITHIN_SECONDS;

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (!opts?.forceRefresh && cachedToken) {
    if (!shouldRefreshToken(cachedExp, nowEpoch, refreshWithinSeconds)) {
      return cachedToken;
    }
  }

  try {
    const token = await provider();
    if (typeof token !== 'string' || token.trim().length === 0) {
      cachedToken = null;
      cachedExp = null;
      return null;
    }
    const trimmed = token.trim();
    cachedToken = trimmed;
    cachedExp = parseJwtExp(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}
