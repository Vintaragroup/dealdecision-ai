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

describe('apiClient admin reason payloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const okJson = (payload: unknown = { ok: true }): any => ({
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : ''),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });

  test('apiAdminRevokeAccess sends default reason', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true, record: {} }));
    vi.stubGlobal('fetch', fetchSpy as any);

    const { apiAdminRevokeAccess } = await import('../lib/apiClient');
    await apiAdminRevokeAccess('user-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown[];
    const init = (firstCall?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reason).toBe('Platform access revoked from web UI');
  });

  test('apiAdminSetAdminStatus sends explicit reason when provided', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true, record: {} }));
    vi.stubGlobal('fetch', fetchSpy as any);

    const { apiAdminSetAdminStatus } = await import('../lib/apiClient');
    await apiAdminSetAdminStatus('user-1', true, 'manual escalation');

    const firstCall = fetchSpy.mock.calls[0] as unknown[];
    const init = (firstCall?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ is_admin: true, reason: 'manual escalation' });
  });

  test('apiAdminPurgeDeal calls recovery endpoint with confirm token payload', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true, deal_id: 'deal-1', purge: {} }));
    vi.stubGlobal('fetch', fetchSpy as any);

    const { apiAdminPurgeDeal } = await import('../lib/apiClient');
    await apiAdminPurgeDeal('deal-1', {
      reason: 'cleanup',
      confirm_text: 'PURGE DEAL deal-1',
    });

    const firstCall = fetchSpy.mock.calls[0] as unknown[];
    const url = String(firstCall?.[0] ?? '');
    const init = (firstCall?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(url).toMatch(/\/api\/v1\/admin\/recovery\/deals\/deal-1\/purge$/);
    expect(body).toEqual({ reason: 'cleanup', confirm_text: 'PURGE DEAL deal-1' });
  });
});
