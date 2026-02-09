import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/authToken', () => ({
  getAuthToken: vi.fn(async () => null),
}));

vi.mock('../lib/debugApi', () => ({
  debugApiInferDealId: vi.fn(() => null),
  debugApiIsEnabled: vi.fn(() => false),
  debugApiLogCall: vi.fn(() => undefined),
  debugApiLogSse: vi.fn(() => undefined),
}));

describe('apiGetDealReport URL contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const makeJsonResponse = (payload: any): any => {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : ''),
      },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };

  test('apiGetDealReport calls /report (no narrate param)', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      makeJsonResponse({ ready: false, reason: 'not_generated_yet' }),
    );
    vi.stubGlobal('fetch', fetchSpy as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    await apiGetDealReport('deal-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/\/api\/v1\/deals\/deal-1\/report(\?|$)/);
    expect(url).not.toContain('narrate=1');
  });

  test('apiGetDealReportNarrated calls /report?narrate=1', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      makeJsonResponse({ ready: false, reason: 'not_generated_yet' }),
    );
    vi.stubGlobal('fetch', fetchSpy as any);

    const { apiGetDealReportNarrated } = await import('../lib/apiClient');
    await apiGetDealReportNarrated('deal-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/\/api\/v1\/deals\/deal-1\/report\?narrate=1$/);
  });
});
