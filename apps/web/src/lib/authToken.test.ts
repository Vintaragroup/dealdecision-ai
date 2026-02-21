import { describe, it, expect, beforeEach } from 'vitest';
import { getAuthToken, setAuthTokenProvider, shouldRefreshToken } from './authToken';

function base64UrlEncodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwtWithExp(expSeconds: number): string {
  const header = base64UrlEncodeJson({ alg: 'none', typ: 'JWT' });
  const payload = base64UrlEncodeJson({ exp: expSeconds });
  return `${header}.${payload}.sig`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  setAuthTokenProvider(null);
});

describe('authToken refresh logic', () => {
  it('refreshes when exp is within 30s', () => {
    const now = 1000;
    expect(shouldRefreshToken(1029, now, 30)).toBe(true);
    expect(shouldRefreshToken(1030, now, 30)).toBe(false);
  });

  it('refreshes when exp missing', () => {
    const now = 1000;
    expect(shouldRefreshToken(null, now, 30)).toBe(true);
  });
});

describe('getAuthToken concurrency + cache', () => {
  it('dedupes concurrent token mints (10 callers share one in-flight promise)', async () => {
    let mintCalls = 0;
    const token = makeJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

    setAuthTokenProvider(async () => {
      mintCalls += 1;
      await sleep(25);
      return token;
    });

    const results = await Promise.all(Array.from({ length: 10 }, () => getAuthToken()));
    expect(mintCalls).toBe(1);
    expect(results.every((t) => t === token)).toBe(true);
  });

  it('reuses cached token until near exp (JWT exp-based cache)', async () => {
    let mintCalls = 0;
    const token = makeJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

    setAuthTokenProvider(async () => {
      mintCalls += 1;
      return token;
    });

    const t1 = await getAuthToken();
    const t2 = await getAuthToken();

    expect(t1).toBe(token);
    expect(t2).toBe(token);
    expect(mintCalls).toBe(1);
  });

  it('uses a short fallback TTL cache when exp is not parseable (prevents mint storms)', async () => {
    let mintCalls = 0;
    const token = 'not-a-jwt';

    setAuthTokenProvider(async () => {
      mintCalls += 1;
      await sleep(10);
      return token;
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => getAuthToken()));
    expect(mintCalls).toBe(1);
    expect(results.every((t) => t === token)).toBe(true);

    // Immediate reuse should hit cache.
    const again = await getAuthToken();
    expect(again).toBe(token);
    expect(mintCalls).toBe(1);
  });

  it('clears in-flight state on failure so subsequent calls retry', async () => {
    let mintCalls = 0;
    const token = makeJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

    setAuthTokenProvider(async () => {
      mintCalls += 1;
      if (mintCalls === 1) throw new Error('429');
      return token;
    });

    const first = await getAuthToken();
    expect(first).toBe(null);

    const second = await getAuthToken();
    expect(second).toBe(token);
    expect(mintCalls).toBe(2);
  });
});
